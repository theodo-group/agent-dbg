import { registerCommand } from "../cli/registry.ts";
import { DaemonClient } from "../daemon/client.ts";

registerCommand("modules", async (args) => {
	const session = args.global.session;

	if (!DaemonClient.isRunning(session)) {
		console.error(`No active session "${session}"`);
		console.error("  -> Try: dbg launch --brk node app.js");
		return 1;
	}

	const client = new DaemonClient(session);

	const modulesArgs: Record<string, unknown> = {};
	const filter =
		args.subcommand ?? (typeof args.flags.filter === "string" ? args.flags.filter : undefined);
	if (filter) {
		modulesArgs.filter = filter;
	}

	const response = await client.request("modules", modulesArgs);

	if (!response.ok) {
		console.error(`${response.error}`);
		if (response.suggestion) console.error(`  ${response.suggestion}`);
		return 1;
	}

	const data = response.data as Array<{
		id: string;
		name: string;
		path?: string;
		symbolStatus?: string;
	}>;

	if (args.global.json) {
		console.log(JSON.stringify(data, null, 2));
		return 0;
	}

	if (data.length === 0) {
		console.log("No modules loaded");
		return 0;
	}

	// Format output: name, symbolStatus, path
	const nameWidth = Math.max(...data.map((m) => m.name.length), 4);
	const statusWidth = Math.max(...data.map((m) => (m.symbolStatus ?? "").length), 7);

	for (const mod of data) {
		const name = mod.name.padEnd(nameWidth);
		const status = (mod.symbolStatus ?? "unknown").padEnd(statusWidth);
		const path = mod.path ?? "";
		console.log(`  ${name}  ${status}  ${path}`);
	}

	return 0;
});
