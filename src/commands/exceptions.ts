import { registerCommand } from "../cli/registry.ts";
import { DaemonClient } from "../daemon/client.ts";
import type { ExceptionEntry } from "../daemon/session.ts";

function formatTimestamp(ts: number): string {
	const d = new Date(ts);
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	const ss = String(d.getSeconds()).padStart(2, "0");
	return `${hh}:${mm}:${ss}`;
}

registerCommand("exceptions", async (args) => {
	const session = args.global.session;

	if (!DaemonClient.isRunning(session)) {
		console.error(`No active session "${session}"`);
		console.error("  -> Try: ndbg launch --brk node app.js");
		return 1;
	}

	const client = new DaemonClient(session);

	const exceptionsArgs: Record<string, unknown> = {};
	if (typeof args.flags.since === "string") {
		exceptionsArgs.since = parseInt(args.flags.since, 10);
	}

	const response = await client.request("exceptions", exceptionsArgs);

	if (!response.ok) {
		console.error(`${response.error}`);
		if (response.suggestion) console.error(`  ${response.suggestion}`);
		return 1;
	}

	const entries = response.data as ExceptionEntry[];

	if (args.global.json) {
		console.log(JSON.stringify(entries, null, 2));
		return 0;
	}

	if (entries.length === 0) {
		console.log("(no exceptions)");
		return 0;
	}

	for (const entry of entries) {
		const ts = formatTimestamp(entry.timestamp);
		console.log(`[${ts}] ${entry.text}`);
		if (entry.description) {
			console.log(`  ${entry.description}`);
		}
		if (entry.stackTrace) {
			console.log(entry.stackTrace);
		}
	}

	return 0;
});
