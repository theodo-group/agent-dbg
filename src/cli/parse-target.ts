/**
 * Parse a file:line or file:line:column target string.
 * Returns null if the format is invalid.
 */
export function parseFileLineColumn(
	target: string,
): { file: string; line: number; column?: number } | null {
	const lastColon = target.lastIndexOf(":");
	if (lastColon === -1 || lastColon === 0) return null;

	const afterLast = target.slice(lastColon + 1);
	const maybeNum = parseInt(afterLast, 10);
	if (Number.isNaN(maybeNum) || maybeNum <= 0) return null;

	const beforeLast = target.slice(0, lastColon);
	const secondColon = beforeLast.lastIndexOf(":");
	if (secondColon > 0) {
		const afterSecond = beforeLast.slice(secondColon + 1);
		const maybeLine = parseInt(afterSecond, 10);
		if (!Number.isNaN(maybeLine) && maybeLine > 0) {
			return {
				file: beforeLast.slice(0, secondColon),
				line: maybeLine,
				column: maybeNum,
			};
		}
	}

	return { file: beforeLast, line: maybeNum };
}

/**
 * Parse a file:line target string (no column).
 * Returns null if the format is invalid.
 */
export function parseFileLine(target: string): { file: string; line: number } | null {
	const lastColon = target.lastIndexOf(":");
	if (lastColon === -1 || lastColon === 0) return null;

	const file = target.slice(0, lastColon);
	const line = parseInt(target.slice(lastColon + 1), 10);
	if (Number.isNaN(line) || line <= 0) return null;

	return { file, line };
}
