import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping.js";
import type { CdpLogger } from "./logger.ts";
import type { CdpEvent, CdpRequest, CdpResponse } from "./types.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

type CdpCommand = keyof ProtocolMapping.Commands;
type CdpEventName = keyof ProtocolMapping.Events;

// biome-ignore lint/suspicious/noExplicitAny: Required for handler map that stores both typed and untyped handlers
type AnyHandler = (...args: any[]) => void;

interface PendingRequest {
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

export class CdpClient {
	private ws: WebSocket;
	private nextId = 1;
	private pending = new Map<number, PendingRequest>();
	private listeners = new Map<string, Set<AnyHandler>>();
	private isConnected = false;
	private logger: CdpLogger | null;
	/** Map request id → method name for response logging */
	private sentMethods = new Map<number, string>();

	private constructor(ws: WebSocket, logger?: CdpLogger) {
		this.ws = ws;
		this.logger = logger ?? null;
		this.isConnected = true;
		this.setupHandlers();
	}

	static async connect(wsUrl: string, logger?: CdpLogger): Promise<CdpClient> {
		return new Promise<CdpClient>((resolve, reject) => {
			const ws = new WebSocket(wsUrl);

			const onOpen = () => {
				ws.removeEventListener("error", onError);
				const client = new CdpClient(ws, logger);
				resolve(client);
			};

			const onError = (event: Event) => {
				ws.removeEventListener("open", onOpen);
				const message = event instanceof ErrorEvent ? event.message : "WebSocket connection failed";
				reject(new Error(message));
			};

			ws.addEventListener("open", onOpen, { once: true });
			ws.addEventListener("error", onError, { once: true });
		});
	}

	async send<T extends CdpCommand>(
		method: T,
		...params: ProtocolMapping.Commands[T]["paramsType"]
	): Promise<ProtocolMapping.Commands[T]["returnType"]>;
	async send(method: string, ...args: unknown[]): Promise<unknown> {
		if (!this.isConnected) {
			throw new Error("CDP client is not connected");
		}

		const params = args[0] as Record<string, unknown> | undefined;
		const id = this.nextId++;
		const request: CdpRequest = { id, method };
		if (params !== undefined) {
			request.params = params;
		}

		this.sentMethods.set(id, method);
		this.logger?.logSend(id, method, params as Record<string, unknown> | undefined);

		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				this.sentMethods.delete(id);
				reject(new Error(`CDP request timed out: ${method} (id=${id})`));
			}, DEFAULT_TIMEOUT_MS);

			this.pending.set(id, { resolve, reject, timer });
			this.ws.send(JSON.stringify(request));
		});
	}

	on<T extends CdpEventName>(event: T, handler: (...args: ProtocolMapping.Events[T]) => void): void;
	on(event: string, handler: (params: unknown) => void): void;
	on(event: string, handler: AnyHandler): void {
		let handlers = this.listeners.get(event);
		if (!handlers) {
			handlers = new Set();
			this.listeners.set(event, handlers);
		}
		handlers.add(handler);
	}

	off<T extends CdpEventName>(
		event: T,
		handler: (...args: ProtocolMapping.Events[T]) => void,
	): void;
	off(event: string, handler: (params: unknown) => void): void;
	off(event: string, handler: AnyHandler): void {
		const handlers = this.listeners.get(event);
		if (handlers) {
			handlers.delete(handler);
			if (handlers.size === 0) {
				this.listeners.delete(event);
			}
		}
	}

	async enableDomains(): Promise<void> {
		await Promise.all([
			this.send("Debugger.enable"),
			this.send("Runtime.enable"),
			this.send("Profiler.enable"),
			this.send("HeapProfiler.enable"),
		]);
	}

	async runIfWaitingForDebugger(): Promise<void> {
		await this.send("Runtime.runIfWaitingForDebugger");
	}

	disconnect(): void {
		if (!this.isConnected) {
			return;
		}
		this.isConnected = false;

		const error = new Error("CDP client disconnected");
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timer);
			pending.reject(error);
			this.pending.delete(id);
		}

		this.listeners.clear();
		this.ws.close();
	}

	get connected(): boolean {
		return this.isConnected;
	}

	/** Exposed for testing: directly handle a raw message string. */
	handleMessage(data: string): void {
		this.onMessage(data);
	}

	private setupHandlers(): void {
		this.ws.addEventListener("message", (event: MessageEvent) => {
			const data = typeof event.data === "string" ? event.data : String(event.data);
			this.onMessage(data);
		});

		this.ws.addEventListener("close", () => {
			this.isConnected = false;
			const error = new Error("WebSocket connection closed");
			for (const [id, pending] of this.pending) {
				clearTimeout(pending.timer);
				pending.reject(error);
				this.pending.delete(id);
			}
		});

		this.ws.addEventListener("error", () => {
			// Error events are followed by close events, so cleanup happens there.
		});
	}

	private onMessage(data: string): void {
		let parsed: CdpResponse | CdpEvent;
		try {
			parsed = JSON.parse(data) as CdpResponse | CdpEvent;
		} catch {
			return;
		}

		if ("id" in parsed && typeof parsed.id === "number") {
			const response = parsed as CdpResponse;
			const method = this.sentMethods.get(response.id) ?? "unknown";
			this.sentMethods.delete(response.id);
			this.logger?.logResponse(response.id, method, response.result, response.error);

			const pending = this.pending.get(response.id);
			if (!pending) {
				return;
			}
			this.pending.delete(response.id);
			clearTimeout(pending.timer);

			if (response.error) {
				pending.reject(new Error(`CDP error (${response.error.code}): ${response.error.message}`));
			} else {
				pending.resolve(response.result);
			}
		} else if ("method" in parsed) {
			const event = parsed as CdpEvent;
			this.logger?.logEvent(event.method, event.params);

			const handlers = this.listeners.get(event.method);
			if (handlers) {
				for (const handler of handlers) {
					handler(event.params);
				}
			}
		}
	}
}
