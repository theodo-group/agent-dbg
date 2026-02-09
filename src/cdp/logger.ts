import { appendFileSync, writeFileSync } from "node:fs";

export interface CdpLogEntry {
	ts: number;
	dir: "send" | "recv" | "event";
	method: string;
	id?: number;
	params?: Record<string, unknown>;
	result?: unknown;
	error?: { code: number; message: string };
	ms?: number;
}

export class CdpLogger {
	private logPath: string;
	/** Map request id → { method, sentAt } for latency tracking */
	private pending = new Map<number, { method: string; sentAt: number }>();

	constructor(logPath: string) {
		this.logPath = logPath;
		// Truncate log file on creation (new session = fresh log)
		writeFileSync(logPath, "");
	}

	logSend(id: number, method: string, params?: Record<string, unknown>): void {
		this.pending.set(id, { method, sentAt: Date.now() });
		const entry: CdpLogEntry = { ts: Date.now(), dir: "send", method, id };
		if (params !== undefined) {
			entry.params = params;
		}
		this.append(entry);
	}

	logResponse(
		id: number,
		method: string,
		result?: unknown,
		error?: { code: number; message: string },
	): void {
		const pending = this.pending.get(id);
		const ms = pending ? Date.now() - pending.sentAt : undefined;
		if (pending) this.pending.delete(id);

		const entry: CdpLogEntry = { ts: Date.now(), dir: "recv", method, id };
		if (ms !== undefined) entry.ms = ms;
		if (error) {
			entry.error = error;
		} else if (result !== undefined) {
			entry.result = result;
		}
		this.append(entry);
	}

	logEvent(method: string, params?: unknown): void {
		const entry: CdpLogEntry = { ts: Date.now(), dir: "event", method };
		if (params !== undefined) {
			entry.params = params as Record<string, unknown>;
		}
		this.append(entry);
	}

	clear(): void {
		writeFileSync(this.logPath, "");
	}

	private append(entry: CdpLogEntry): void {
		appendFileSync(this.logPath, `${JSON.stringify(entry)}\n`);
	}
}
