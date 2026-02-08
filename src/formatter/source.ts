export interface SourceLine {
	lineNumber: number;
	content: string;
	isCurrent?: boolean;
	hasBreakpoint?: boolean;
}

export function formatSource(lines: SourceLine[]): string {
	if (lines.length === 0) return "";

	// Determine the max line number width for alignment
	const maxLineNum = Math.max(...lines.map((l) => l.lineNumber));
	const numWidth = String(maxLineNum).length;

	return lines
		.map((line) => {
			const num = String(line.lineNumber).padStart(numWidth);
			let marker = "  ";
			if (line.isCurrent && line.hasBreakpoint) {
				marker = "\u2192\u25CF";
			} else if (line.isCurrent) {
				marker = " \u2192";
			} else if (line.hasBreakpoint) {
				marker = " \u25CF";
			}
			return `${marker} ${num}\u2502${line.content}`;
		})
		.join("\n");
}
