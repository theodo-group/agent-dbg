export function formatError(message: string, details?: string[], suggestion?: string): string {
	const lines: string[] = [`\u2717 ${message}`];

	if (details) {
		for (const detail of details) {
			lines.push(`  ${detail}`);
		}
	}

	if (suggestion) {
		lines.push(`  \u2192 Try: ${suggestion}`);
	}

	return lines.join("\n");
}
