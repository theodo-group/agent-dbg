import { registerCommand } from "../cli/registry.ts";
import { DaemonClient } from "../daemon/client.ts";
import { formatSource } from "../formatter/source.ts";
import type { SourceLine } from "../formatter/source.ts";
import { formatStack } from "../formatter/stack.ts";
import type { StackFrame } from "../formatter/stack.ts";
import { formatVariables } from "../formatter/variables.ts";
import type { Variable } from "../formatter/variables.ts";
import type { StateSnapshot } from "../daemon/session.ts";

registerCommand("state", async (args) => {
	const session = args.global.session;

	if (!DaemonClient.isRunning(session)) {
		console.error(`No active session "${session}"`);
		console.error("  -> Try: ndbg launch --brk node app.js");
		return 1;
	}

	const client = new DaemonClient(session);

	const stateArgs: Record<string, unknown> = {};

	if (args.flags.vars === true) stateArgs.vars = true;
	if (args.flags.stack === true) stateArgs.stack = true;
	if (args.flags.breakpoints === true) stateArgs.breakpoints = true;
	if (args.flags.code === true) stateArgs.code = true;
	if (args.flags.compact === true) stateArgs.compact = true;
	if (args.flags["all-scopes"] === true) stateArgs.allScopes = true;
	if (typeof args.flags.depth === "string") {
		stateArgs.depth = parseInt(args.flags.depth, 10);
	}
	if (typeof args.flags.lines === "string") {
		stateArgs.lines = parseInt(args.flags.lines, 10);
	}
	if (typeof args.flags.frame === "string") {
		stateArgs.frame = args.flags.frame;
	}
	if (args.flags.generated === true) stateArgs.generated = true;

	const response = await client.request("state", stateArgs);

	if (!response.ok) {
		console.error(`${response.error}`);
		if (response.suggestion) console.error(`  ${response.suggestion}`);
		return 1;
	}

	const data = response.data as StateSnapshot;

	if (args.global.json) {
		console.log(JSON.stringify(data, null, 2));
		return 0;
	}

	// Non-paused states
	if (data.status !== "paused") {
		const icon = data.status === "running" ? "\u25B6" : "\u25CB";
		console.log(`${icon} ${data.status === "running" ? "Running" : "Idle"}`);
		return 0;
	}

	// Paused state — header
	const loc = data.location
		? `${data.location.url}:${data.location.line}`
		: "unknown";
	const reason = data.reason ?? "unknown";
	console.log(`\u23F8 Paused at ${loc} (${reason})`);

	const showAll = !stateArgs.vars && !stateArgs.stack && !stateArgs.breakpoints && !stateArgs.code;

	// Source section
	if ((showAll || stateArgs.code) && data.source?.lines) {
		console.log("");
		console.log("Source:");
		const sourceLines: SourceLine[] = data.source.lines.map((l) => ({
			lineNumber: l.line,
			content: l.text,
			isCurrent: l.current,
		}));
		console.log(formatSource(sourceLines));
	}

	// Locals section
	if ((showAll || stateArgs.vars) && data.locals) {
		console.log("");
		console.log("Locals:");
		const vars: Variable[] = data.locals.map((v) => ({
			ref: v.ref,
			name: v.name,
			value: v.value,
		}));
		const formatted = formatVariables(vars);
		if (formatted) {
			console.log(formatted);
		} else {
			console.log("  (no locals)");
		}
	}

	// Stack section
	if ((showAll || stateArgs.stack) && data.stack) {
		console.log("");
		console.log("Stack:");
		const frames: StackFrame[] = data.stack.map((f) => ({
			ref: f.ref,
			functionName: f.functionName,
			file: f.file,
			line: f.line,
			column: f.column,
			isAsync: f.isAsync,
		}));
		console.log(formatStack(frames));
	}

	// Breakpoints section
	if ((showAll || stateArgs.breakpoints) && data.breakpointCount !== undefined) {
		console.log("");
		console.log(`Breakpoints: ${data.breakpointCount} active`);
	}

	return 0;
});
