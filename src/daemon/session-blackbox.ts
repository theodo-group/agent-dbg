import type { DebugSession } from "./session.ts";

export async function addBlackbox(session: DebugSession, patterns: string[]): Promise<string[]> {
	if (!session.cdp) {
		throw new Error("No active debug session");
	}

	for (const p of patterns) {
		if (!session.blackboxPatterns.includes(p)) {
			session.blackboxPatterns.push(p);
		}
	}

	await session.cdp.send("Debugger.setBlackboxPatterns", {
		patterns: session.blackboxPatterns,
	});

	return [...session.blackboxPatterns];
}

export function listBlackbox(session: DebugSession): string[] {
	return [...session.blackboxPatterns];
}

export async function removeBlackbox(session: DebugSession, patterns: string[]): Promise<string[]> {
	if (!session.cdp) {
		throw new Error("No active debug session");
	}

	if (patterns.includes("all")) {
		session.blackboxPatterns = [];
	} else {
		session.blackboxPatterns = session.blackboxPatterns.filter((p) => !patterns.includes(p));
	}

	await session.cdp.send("Debugger.setBlackboxPatterns", {
		patterns: session.blackboxPatterns,
	});

	return [...session.blackboxPatterns];
}
