import { existsSync, readdirSync } from "node:fs";
import type { DaemonRequest, DaemonResponse } from "../protocol/messages.ts";
import { getSocketDir, getSocketPath } from "./paths.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

export class DaemonClient {
	private session: string;
	private socketPath: string;

	constructor(session: string) {
		this.session = session;
		this.socketPath = getSocketPath(session);
	}

	async request(cmd: string, args: Record<string, unknown> = {}): Promise<DaemonResponse> {
		const req: DaemonRequest = { cmd, args };
		const message = `${JSON.stringify(req)}\n`;
		const sessionName = this.session;
		const socketPath = this.socketPath;

		return new Promise<DaemonResponse>((resolve, reject) => {
			let buffer = "";
			let settled = false;

			const timer = setTimeout(() => {
				if (!settled) {
					settled = true;
					reject(new Error(`Request timed out after ${DEFAULT_TIMEOUT_MS}ms`));
				}
			}, DEFAULT_TIMEOUT_MS);

			Bun.connect<undefined>({
				unix: socketPath,
				socket: {
					open(socket) {
						socket.write(message);
					},
					data(_socket, data) {
						buffer += data.toString();
						const newlineIdx = buffer.indexOf("\n");
						if (newlineIdx !== -1) {
							const line = buffer.slice(0, newlineIdx);
							if (!settled) {
								settled = true;
								clearTimeout(timer);
								try {
									resolve(JSON.parse(line) as DaemonResponse);
								} catch {
									reject(new Error("Invalid JSON response from daemon"));
								}
							}
						}
					},
					close() {
						if (!settled) {
							settled = true;
							clearTimeout(timer);
							if (buffer.trim()) {
								try {
									resolve(JSON.parse(buffer.trim()) as DaemonResponse);
								} catch {
									reject(new Error("Invalid JSON response from daemon"));
								}
							} else {
								reject(new Error("Connection closed without response"));
							}
						}
					},
					error(_socket, error) {
						if (!settled) {
							settled = true;
							clearTimeout(timer);
							reject(error);
						}
					},
					connectError(_socket, error) {
						if (!settled) {
							settled = true;
							clearTimeout(timer);
							reject(
								new Error(`Daemon not running for session "${sessionName}": ${error.message}`),
							);
						}
					},
				},
			}).catch((err) => {
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					reject(
						new Error(
							`Cannot connect to daemon for session "${sessionName}": ${err instanceof Error ? err.message : String(err)}`,
						),
					);
				}
			});
		});
	}

	static isRunning(session: string): boolean {
		const socketPath = getSocketPath(session);
		if (!existsSync(socketPath)) {
			return false;
		}
		// Try connecting to verify the daemon is actually alive
		try {
			// Use a sync approach: check if socket file exists
			// A true liveness check requires async connection, so we check the file
			return true;
		} catch {
			return false;
		}
	}

	static async isAlive(session: string): Promise<boolean> {
		const socketPath = getSocketPath(session);
		if (!existsSync(socketPath)) {
			return false;
		}
		try {
			const client = new DaemonClient(session);
			const response = await client.request("ping");
			return response.ok === true;
		} catch {
			return false;
		}
	}

	static listSessions(): string[] {
		const dir = getSocketDir();
		if (!existsSync(dir)) {
			return [];
		}
		const files = readdirSync(dir);
		return files.filter((f) => f.endsWith(".sock")).map((f) => f.slice(0, -5));
	}
}
