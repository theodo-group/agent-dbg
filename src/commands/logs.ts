import type { FSWatcher } from "node:fs";
import {
	closeSync,
	existsSync,
	openSync,
	readFileSync,
	readSync,
	watch,
	writeFileSync,
} from "node:fs";
import type { CdpLogEntry } from "../cdp/logger.ts";
import { registerCommand } from "../cli/registry.ts";
import { getLogPath } from "../daemon/paths.ts";
import { formatLogEntry } from "../formatter/logs.ts";

function parseEntries(text: string): CdpLogEntry[] {
	const entries: CdpLogEntry[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			entries.push(JSON.parse(line) as CdpLogEntry);
		} catch {
			// skip malformed lines
		}
	}
	return entries;
}

function filterByDomain(entries: CdpLogEntry[], domain: string): CdpLogEntry[] {
	return entries.filter((e) => e.method.startsWith(`${domain}.`));
}

function printEntries(entries: CdpLogEntry[], json: boolean): void {
	for (const entry of entries) {
		if (json) {
			console.log(JSON.stringify(entry));
		} else {
			console.log(formatLogEntry(entry));
		}
	}
}

registerCommand("logs", async (args) => {
	const session = args.global.session;
	const logPath = getLogPath(session);

	// --clear: truncate log file
	if (args.flags.clear === true) {
		if (existsSync(logPath)) {
			writeFileSync(logPath, "");
			console.log("Log cleared");
		} else {
			console.log("No log file to clear");
		}
		return 0;
	}

	if (!existsSync(logPath)) {
		console.error(`No log file for session "${session}"`);
		console.error("  -> Try: agent-dbg launch --brk node app.js");
		return 1;
	}

	const isJson = args.global.json;
	const domain = typeof args.flags.domain === "string" ? args.flags.domain : undefined;
	const limit = typeof args.flags.limit === "string" ? parseInt(args.flags.limit, 10) : 50;
	const follow = args.flags.follow === true;

	// Read existing entries
	const content = readFileSync(logPath, "utf-8");
	let entries = parseEntries(content);
	if (domain) entries = filterByDomain(entries, domain);

	// Apply limit (show last N) — in follow mode, show all existing
	const sliced = follow ? entries : entries.slice(-limit);
	printEntries(sliced, isJson);

	if (!follow) return 0;

	// Follow mode: watch for new lines appended to the file
	let offset = Buffer.byteLength(content, "utf-8");
	let watcher: FSWatcher | undefined;

	const readNew = () => {
		try {
			const size = Bun.file(logPath).size;
			if (size <= offset) return;

			const fd = openSync(logPath, "r");
			const buf = Buffer.alloc(size - offset);
			readSync(fd, buf, 0, buf.length, offset);
			closeSync(fd);
			offset = size;

			let newEntries = parseEntries(buf.toString("utf-8"));
			if (domain) newEntries = filterByDomain(newEntries, domain);
			printEntries(newEntries, isJson);
		} catch {
			// File may have been truncated or removed
		}
	};

	watcher = watch(logPath, () => {
		readNew();
	});

	// Keep alive until Ctrl+C
	await new Promise<void>((resolve) => {
		process.on("SIGINT", () => {
			watcher?.close();
			resolve();
		});
	});

	return 0;
});
