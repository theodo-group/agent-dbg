import { registerCommand } from "../cli/registry.ts";
import { DaemonClient } from "../daemon/client.ts";
import type { SessionStatus } from "../daemon/session.ts";

registerCommand("run-to", async (args) => {
	const session = args.global.session;

	if (!DaemonClient.isRunning(session)) {
		console.error(`No active session "${session}"`);
		console.error("  -> Try: ndbg launch --brk node app.js");
		return 1;
	}

	// Parse file:line from subcommand
	// e.g., "ndbg run-to src/file.ts:42" -> subcommand = "src/file.ts:42"
	const target = args.subcommand ?? args.positionals[0];
	if (!target) {
		console.error("No target specified");
		console.error("  -> Try: ndbg run-to src/file.ts:42");
		return 1;
	}

	const lastColon = target.lastIndexOf(":");
	if (lastColon === -1 || lastColon === 0) {
		console.error(`Invalid target format: "${target}"`);
		console.error("  -> Expected: <file>:<line>");
		return 1;
	}

	const file = target.slice(0, lastColon);
	const line = parseInt(target.slice(lastColon + 1), 10);
	if (Number.isNaN(line) || line <= 0) {
		console.error(`Invalid line number in "${target}"`);
		console.error("  -> Expected: <file>:<line>");
		return 1;
	}

	const client = new DaemonClient(session);
	const response = await client.request("run-to", { file, line });

	if (!response.ok) {
		console.error(`${response.error}`);
		if (response.suggestion) console.error(`  ${response.suggestion}`);
		return 1;
	}

	const data = response.data as SessionStatus;

	if (args.global.json) {
		console.log(JSON.stringify(data, null, 2));
	} else {
		printStatus(data);
	}

	return 0;
});

function printStatus(data: SessionStatus): void {
	if (data.state === "paused" && data.pauseInfo) {
		const col = data.pauseInfo.column !== undefined ? `:${data.pauseInfo.column + 1}` : "";
		const loc = data.pauseInfo.url
			? `${data.pauseInfo.url}:${(data.pauseInfo.line ?? 0) + 1}${col}`
			: "unknown";
		console.log(`Paused at ${loc} (${data.pauseInfo.reason})`);
	} else if (data.state === "running") {
		console.log("Running");
	} else {
		console.log(`${data.state}`);
	}
}
