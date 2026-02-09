import type { CdpLogEntry } from "../cdp/logger.ts";

function formatTime(ts: number): string {
	const d = new Date(ts);
	const h = String(d.getHours()).padStart(2, "0");
	const m = String(d.getMinutes()).padStart(2, "0");
	const s = String(d.getSeconds()).padStart(2, "0");
	const ms = String(d.getMilliseconds()).padStart(3, "0");
	return `${h}:${m}:${s}.${ms}`;
}

function truncate(s: string, max: number): string {
	return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

type Summarizer = (entry: CdpLogEntry) => string;

const eventSummarizers: Record<string, Summarizer> = {
	"Debugger.scriptParsed": (e) => {
		const p = e.params ?? {};
		const url = (p.url as string) || "(anonymous)";
		const lines = p.endLine != null ? Number(p.endLine) + 1 : "?";
		const hasMap = p.sourceMapURL ? "yes" : "no";
		return `scriptId=${p.scriptId} url=${url} lines=${lines} sourceMap=${hasMap}`;
	},
	"Debugger.paused": (e) => {
		const p = e.params ?? {};
		const reason = (p.reason as string) ?? "unknown";
		const frames = p.callFrames as Array<Record<string, unknown>> | undefined;
		const top = frames?.[0];
		let loc = "";
		if (top) {
			const location = top.location as Record<string, unknown> | undefined;
			const url = (top.url as string) || `script:${location?.scriptId}`;
			loc = ` location=${url}:${location?.lineNumber}`;
		}
		const count = frames?.length ?? 0;
		return `reason=${reason}${loc} callFrames=${count}`;
	},
	"Debugger.resumed": () => "",
	"Runtime.consoleAPICalled": (e) => {
		const p = e.params ?? {};
		const type = (p.type as string) ?? "log";
		const args = p.args as Array<unknown> | undefined;
		return `type=${type} args=${args?.length ?? 0}`;
	},
	"Runtime.exceptionThrown": (e) => {
		const p = e.params ?? {};
		const detail = p.exceptionDetails as Record<string, unknown> | undefined;
		const text = (detail?.text as string) ?? "";
		return truncate(text, 80);
	},
	"Runtime.executionContextCreated": (e) => {
		const p = e.params ?? {};
		const ctx = p.context as Record<string, unknown> | undefined;
		return `contextId=${ctx?.id}`;
	},
	"Runtime.executionContextDestroyed": (e) => {
		const p = e.params ?? {};
		return `executionContextId=${p.executionContextId}`;
	},
};

const responseSummarizers: Record<string, Summarizer> = {
	"Debugger.setBreakpointByUrl": (e) => {
		const r = (e.result ?? {}) as Record<string, unknown>;
		return `breakpointId=${r.breakpointId}`;
	},
	"Debugger.setBreakpoint": (e) => {
		const r = (e.result ?? {}) as Record<string, unknown>;
		return `breakpointId=${r.breakpointId}`;
	},
};

function summarizeParams(entry: CdpLogEntry): string {
	const p = entry.params;
	if (!p || Object.keys(p).length === 0) return "";
	return truncate(JSON.stringify(p), 120);
}

function summarizeResult(entry: CdpLogEntry): string {
	const summarizer = responseSummarizers[entry.method];
	if (summarizer) return summarizer(entry);
	// Don't dump large results by default
	return "";
}

export function formatLogEntry(entry: CdpLogEntry): string {
	const time = `[${formatTime(entry.ts)}]`;

	if (entry.dir === "send") {
		const params = summarizeParams(entry);
		return `${time}  -> ${entry.method}${params ? `  ${params}` : ""}`;
	}

	if (entry.dir === "recv") {
		const idStr = entry.id != null ? ` #${entry.id}` : "";
		const msStr = entry.ms != null ? ` (${entry.ms}ms)` : "";
		if (entry.error) {
			return `${time}  <- ${entry.method}${idStr}${msStr}  ERROR: ${entry.error.message}`;
		}
		const summary = summarizeResult(entry);
		return `${time}  <- ${entry.method}${idStr}${msStr}${summary ? `  ${summary}` : ""}`;
	}

	// event
	const summarizer = eventSummarizers[entry.method];
	const summary = summarizer ? summarizer(entry) : summarizeParams(entry);
	return `${time}  <- ${entry.method}${summary ? `  ${summary}` : ""}`;
}
