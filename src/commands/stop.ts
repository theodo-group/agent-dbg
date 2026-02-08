import { registerCommand } from "../cli/registry.ts";
import { DaemonClient } from "../daemon/client.ts";

registerCommand("stop", async (args) => {
	const session = args.global.session;

	if (!DaemonClient.isRunning(session)) {
		console.error(`No active session "${session}"`);
		return 1;
	}

	const client = new DaemonClient(session);
	const response = await client.request("stop");

	if (!response.ok) {
		console.error(`${response.error}`);
		return 1;
	}

	if (args.global.json) {
		console.log(JSON.stringify({ ok: true, session }));
	} else {
		console.log(`Session "${session}" stopped`);
	}

	return 0;
});
