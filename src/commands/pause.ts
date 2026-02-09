import { registerCommand } from "../cli/registry.ts";
import { DaemonClient } from "../daemon/client.ts";
import type { SessionStatus } from "../daemon/session.ts";

registerCommand("pause", async (args) => {
	const session = args.global.session;

	if (!DaemonClient.isRunning(session)) {
		console.error(`No active session "${session}"`);
		console.error("  -> Try: agent-dbg launch --brk node app.js");
		return 1;
	}

	const client = new DaemonClient(session);
	const response = await client.request("pause");

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
