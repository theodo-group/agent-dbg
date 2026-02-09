import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export function getSocketDir(): string {
	const xdgRuntime = process.env.XDG_RUNTIME_DIR;
	if (xdgRuntime) {
		return join(xdgRuntime, "agent-dbg");
	}
	const tmpdir = process.env.TMPDIR || "/tmp";
	return join(tmpdir, `agent-dbg-${process.getuid?.() ?? 0}`);
}

export function getSocketPath(session: string): string {
	return join(getSocketDir(), `${session}.sock`);
}

export function getLockPath(session: string): string {
	return join(getSocketDir(), `${session}.lock`);
}

export function ensureSocketDir(): void {
	const dir = getSocketDir();
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}
