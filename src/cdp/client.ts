import type { CdpEvent, CdpRequest, CdpResponse } from "./types.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

interface PendingRequest {
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

export class CdpClient {
	private ws: WebSocket;
	private nextId = 1;
	private pending = new Map<number, PendingRequest>();
	private listeners = new Map<string, Set<(params: unknown) => void>>();
	private isConnected = false;

	private constructor(ws: WebSocket) {
		this.ws = ws;
		this.isConnected = true;
		this.setupHandlers();
	}

	static async connect(wsUrl: string): Promise<CdpClient> {
		return new Promise<CdpClient>((resolve, reject) => {
			const ws = new WebSocket(wsUrl);

			const onOpen = () => {
				ws.removeEventListener("error", onError);
				const client = new CdpClient(ws);
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

	async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
		if (!this.isConnected) {
			throw new Error("CDP client is not connected");
		}

		const id = this.nextId++;
		const request: CdpRequest = { id, method };
		if (params !== undefined) {
			request.params = params;
		}

		return new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`CDP request timed out: ${method} (id=${id})`));
			}, DEFAULT_TIMEOUT_MS);

			this.pending.set(id, { resolve, reject, timer });
			this.ws.send(JSON.stringify(request));
		});
	}

	on(event: string, handler: (params: unknown) => void): void {
		let handlers = this.listeners.get(event);
		if (!handlers) {
			handlers = new Set();
			this.listeners.set(event, handlers);
		}
		handlers.add(handler);
	}

	off(event: string, handler: (params: unknown) => void): void {
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
			const handlers = this.listeners.get(event.method);
			if (handlers) {
				for (const handler of handlers) {
					handler(event.params);
				}
			}
		}
	}
}
