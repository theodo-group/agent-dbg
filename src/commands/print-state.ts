import type { StateSnapshot } from "../daemon/session.ts";
import type { SourceLine } from "../formatter/source.ts";
import { formatSource } from "../formatter/source.ts";
import type { StackFrame } from "../formatter/stack.ts";
import { formatStack } from "../formatter/stack.ts";
import type { Variable } from "../formatter/variables.ts";
import { formatVariables } from "../formatter/variables.ts";

/**
 * Shared formatting for StateSnapshot output.
 * Used by state, step, continue, pause, run-to commands.
 */
export function printState(data: StateSnapshot): void {
	// Non-paused states
	if (data.status !== "paused") {
		const icon = data.status === "running" ? "\u25B6" : "\u25CB";
		console.log(`${icon} ${data.status === "running" ? "Running" : "Idle"}`);
		return;
	}

	// Paused state — header
	const loc = data.location
		? `${data.location.url}:${data.location.line}${data.location.column !== undefined ? `:${data.location.column}` : ""}`
		: "unknown";
	const reason = data.reason ?? "unknown";
	console.log(`\u23F8 Paused at ${loc} (${reason})`);

	// Source section
	if (data.source?.lines) {
		console.log("");
		console.log("Source:");
		const sourceLines: SourceLine[] = data.source.lines.map((l) => ({
			lineNumber: l.line,
			content: l.text,
			isCurrent: l.current,
			currentColumn: l.current ? data.location?.column : undefined,
		}));
		console.log(formatSource(sourceLines));
	}

	// Locals section
	if (data.locals) {
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
	if (data.stack) {
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
	if (data.breakpointCount !== undefined) {
		console.log("");
		console.log(`Breakpoints: ${data.breakpointCount} active`);
	}
}
