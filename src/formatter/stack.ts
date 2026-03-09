import { colorize } from "./color.ts";
import { shortPath } from "./path.ts";

export interface StackFrame {
	ref: string;
	functionName: string;
	file: string;
	line: number;
	column?: number;
	isAsync?: boolean;
	isBlackboxed?: boolean;
}

export interface FormatStackOptions {
	color?: boolean;
}

export function formatStack(frames: StackFrame[], opts?: FormatStackOptions): string {
	const cc = colorize(opts?.color ?? false);
	const outputLines: string[] = [];

	// First pass: collapse consecutive blackboxed frames and compute column widths
	const segments: (StackFrame | { blackboxedCount: number })[] = [];

	let i = 0;
	while (i < frames.length) {
		const frame = frames[i];
		if (!frame) break;
		if (frame.isBlackboxed) {
			let count = 0;
			while (i < frames.length && frames[i]?.isBlackboxed) {
				count++;
				i++;
			}
			segments.push({ blackboxedCount: count });
		} else {
			segments.push(frame);
			i++;
		}
	}

	// Compute column widths from visible frames
	let maxRefLen = 0;
	let maxNameLen = 0;
	for (const seg of segments) {
		if ("ref" in seg) {
			maxRefLen = Math.max(maxRefLen, seg.ref.length);
			maxNameLen = Math.max(maxNameLen, seg.functionName.length);
		}
	}

	for (const seg of segments) {
		if ("blackboxedCount" in seg) {
			const label =
				seg.blackboxedCount === 1
					? "\u250A ... 1 framework frame (blackboxed)"
					: `\u250A ... ${seg.blackboxedCount} framework frames (blackboxed)`;
			outputLines.push(cc(label, "gray"));
			continue;
		}

		const frame = seg;

		if (frame.isAsync) {
			outputLines.push(cc("\u250A async gap", "gray"));
		}

		const ref = frame.ref.padEnd(maxRefLen);
		const name = frame.functionName.padEnd(maxNameLen);
		const file = shortPath(frame.file);
		const loc =
			frame.column !== undefined
				? `${file}:${frame.line}:${frame.column}`
				: `${file}:${frame.line}`;

		outputLines.push(`${cc(ref, "gray")}  ${cc(name, "yellow")}  ${cc(loc, "gray")}`);
	}

	return outputLines.join("\n");
}
