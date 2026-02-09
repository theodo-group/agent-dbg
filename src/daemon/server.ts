import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import {
	type DaemonRequest,
	DaemonRequestSchema,
	type DaemonResponse,
} from "../protocol/messages.ts";
import { ensureSocketDir, getLockPath, getSocketPath } from "./paths.ts";

type RequestHandler = (req: DaemonRequest) => Promise<DaemonResponse>;

export class DaemonServer {
	private session: string;
	private idleTimeout: number;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private handler: RequestHandler | null = null;
	private listener: ReturnType<typeof Bun.listen> | null = null;
	private socketPath: string;
	private lockPath: string;

	constructor(session: string, options: { idleTimeout: number }) {
		this.session = session;
		this.idleTimeout = options.idleTimeout;
		this.socketPath = getSocketPath(session);
		this.lockPath = getLockPath(session);
	}

	onRequest(handler: RequestHandler): void {
		this.handler = handler;
	}

	async start(): Promise<void> {
		ensureSocketDir();

		// Check for existing lock file with a running process
		if (existsSync(this.lockPath)) {
			const existingPid = parseInt(await Bun.file(this.lockPath).text(), 10);
			if (!Number.isNaN(existingPid) && isProcessRunning(existingPid)) {
				throw new Error(
					`Daemon already running for session "${this.session}" (pid ${existingPid})`,
				);
			}
			// Stale lock file, clean up
			unlinkSync(this.lockPath);
		}

		// Remove stale socket file
		if (existsSync(this.socketPath)) {
			unlinkSync(this.socketPath);
		}

		// Write lock file with our PID
		writeFileSync(this.lockPath, String(process.pid));

		const server = this;

		this.listener = Bun.listen<{ buffer: string }>({
			unix: this.socketPath,
			socket: {
				open(socket) {
					socket.data = { buffer: "" };
					server.resetIdleTimer();
				},
				data(socket, data) {
					socket.data.buffer += data.toString();
					const newlineIdx = socket.data.buffer.indexOf("\n");
					if (newlineIdx === -1) return;

					const line = socket.data.buffer.slice(0, newlineIdx);
					socket.data.buffer = socket.data.buffer.slice(newlineIdx + 1);

					server.handleMessage(socket, line);
				},
				close() {},
				error(_socket, error) {
					console.error(`[daemon] socket error: ${error.message}`);
				},
			},
		});

		this.resetIdleTimer();
	}

	private handleMessage(
		socket: { write(data: string | Buffer | Uint8Array): number; end(): void },
		line: string,
	): void {
		let json: unknown;
		try {
			json = JSON.parse(line);
		} catch {
			const errResponse: DaemonResponse = {
				ok: false,
				error: "Invalid JSON",
			};
			socket.write(`${JSON.stringify(errResponse)}\n`);
			socket.end();
			return;
		}

		const parsed = DaemonRequestSchema.safeParse(json);
		if (!parsed.success) {
			const obj = json as Record<string, unknown> | null;
			const cmd =
				obj && typeof obj === "object" && typeof obj.cmd === "string" ? obj.cmd : undefined;
			const errResponse: DaemonResponse = cmd
				? {
						ok: false,
						error: `Unknown command: ${cmd}`,
						suggestion: "-> Try: agent-dbg --help",
					}
				: {
						ok: false,
						error: "Invalid request: must have { cmd: string, args: object }",
					};
			socket.write(`${JSON.stringify(errResponse)}\n`);
			socket.end();
			return;
		}
		const request: DaemonRequest = parsed.data;

		if (!this.handler) {
			const errResponse: DaemonResponse = {
				ok: false,
				error: "No request handler registered",
			};
			socket.write(`${JSON.stringify(errResponse)}\n`);
			socket.end();
			return;
		}

		this.handler(request)
			.then((response) => {
				socket.write(`${JSON.stringify(response)}\n`);
				socket.end();
			})
			.catch((err) => {
				const errResponse: DaemonResponse = {
					ok: false,
					error: err instanceof Error ? err.message : String(err),
				};
				socket.write(`${JSON.stringify(errResponse)}\n`);
				socket.end();
			});
	}

	resetIdleTimer(): void {
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
		}
		if (this.idleTimeout > 0) {
			this.idleTimer = setTimeout(() => {
				this.stop();
			}, this.idleTimeout * 1000);
		}
	}

	async stop(): Promise<void> {
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}

		if (this.listener) {
			this.listener.stop(true);
			this.listener = null;
		}

		// Clean up socket and lock files
		if (existsSync(this.socketPath)) {
			unlinkSync(this.socketPath);
		}
		if (existsSync(this.lockPath)) {
			unlinkSync(this.lockPath);
		}
	}
}

function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
