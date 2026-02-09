import { relative } from "node:path";

const cwd = process.cwd();

/** Shorten a file path for display: strip file:// prefix, make relative to cwd. */
export function shortPath(path: string): string {
	// Strip file:// protocol
	if (path.startsWith("file://")) {
		path = path.slice(7);
	}

	// Keep node: and other protocol URLs as-is
	if (path.includes("://") || path.startsWith("node:")) {
		return path;
	}

	// Make relative to cwd
	if (path.startsWith("/")) {
		const rel = relative(cwd, path);
		// Only use relative if it's actually shorter and doesn't escape too far
		if (!rel.startsWith("../../..") && rel.length < path.length) {
			return rel.startsWith("..") ? rel : `./${rel}`;
		}
	}

	return path;
}
