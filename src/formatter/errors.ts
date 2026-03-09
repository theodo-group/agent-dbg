import { colorize } from "./color.ts";

export interface FormatErrorOptions {
	color?: boolean;
}

export function formatError(
	message: string,
	details?: string[],
	suggestion?: string,
	opts?: FormatErrorOptions,
): string {
	const cc = colorize(opts?.color ?? false);

	const lines: string[] = [`${cc("\u2717", "red")} ${cc(message, "red")}`];

	if (details) {
		for (const detail of details) {
			lines.push(`  ${detail}`);
		}
	}

	if (suggestion) {
		lines.push(`  ${cc("\u2192 Try:", "cyan")} ${suggestion}`);
	}

	return lines.join("\n");
}
