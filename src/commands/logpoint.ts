import { registerCommand } from "../cli/registry.ts";
import { DaemonClient } from "../daemon/client.ts";

registerCommand("logpoint", async (args) => {
	const session = args.global.session;

	if (!DaemonClient.isRunning(session)) {
		console.error(`No active session "${session}"`);
		console.error("  -> Try: ndbg launch --brk node app.js");
		return 1;
	}

	const target = args.subcommand;
	if (!target) {
		console.error("No target specified");
		console.error('  -> Try: ndbg logpoint src/app.ts:42 "x =", x');
		return 1;
	}

	// Parse file:line from the target
	const lastColon = target.lastIndexOf(":");
	if (lastColon === -1 || lastColon === 0) {
		console.error(`Invalid logpoint target: "${target}"`);
		console.error('  -> Try: ndbg logpoint src/app.ts:42 "x =", x');
		return 1;
	}

	const file = target.slice(0, lastColon);
	const line = parseInt(target.slice(lastColon + 1), 10);
	if (Number.isNaN(line) || line <= 0) {
		console.error(`Invalid line number in "${target}"`);
		console.error('  -> Try: ndbg logpoint src/app.ts:42 "x =", x');
		return 1;
	}

	// Template is the first positional argument (after the subcommand)
	const template = args.positionals[0];
	if (!template) {
		console.error("No log template specified");
		console.error('  -> Try: ndbg logpoint src/app.ts:42 "x =", x');
		return 1;
	}

	const condition = typeof args.flags.condition === "string" ? args.flags.condition : undefined;
	const maxEmissions =
		typeof args.flags["max-emissions"] === "string"
			? parseInt(args.flags["max-emissions"], 10)
			: undefined;

	const client = new DaemonClient(session);
	const response = await client.request("logpoint", {
		file,
		line,
		template,
		condition,
		maxEmissions,
	});

	if (!response.ok) {
		console.error(`${response.error}`);
		if (response.suggestion) console.error(`  ${response.suggestion}`);
		return 1;
	}

	const data = response.data as {
		ref: string;
		location: { url: string; line: number; column?: number };
	};

	if (args.global.json) {
		console.log(JSON.stringify(data, null, 2));
	} else {
		const loc = `${data.location.url}:${data.location.line}`;
		console.log(`${data.ref} set at ${loc} (log: ${template})`);
	}

	return 0;
});
