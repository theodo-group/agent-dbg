import { registerCommand } from "../cli/registry.ts";
import { DaemonClient } from "../daemon/client.ts";
import type { SessionStatus } from "../daemon/session.ts";

registerCommand("step", async (args) => {
	const session = args.global.session;

	if (!DaemonClient.isRunning(session)) {
		console.error(`No active session "${session}"`);
		console.error("  -> Try: ndbg launch --brk node app.js");
		return 1;
	}

	// The subcommand is the step mode: over, into, or out (default: over)
	const validModes = new Set(["over", "into", "out"]);
	const mode = args.subcommand && validModes.has(args.subcommand) ? args.subcommand : "over";

	const client = new DaemonClient(session);
	const response = await client.request("step", { mode });

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
		const loc = data.pauseInfo.url
			? `${data.pauseInfo.url}:${(data.pauseInfo.line ?? 0) + 1}`
			: "unknown";
		console.log(`Paused at ${loc} (${data.pauseInfo.reason})`);
	} else if (data.state === "running") {
		console.log("Running");
	} else {
		console.log(`${data.state}`);
	}
}
