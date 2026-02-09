import { describe, expect, test } from "bun:test";
import { DebugSession } from "../../src/daemon/session.ts";

/**
 * Polls until the session reaches the expected state, or times out.
 */
async function waitForState(
	session: DebugSession,
	state: "idle" | "running" | "paused",
	timeoutMs = 2000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (session.sessionState !== state && Date.now() < deadline) {
		await Bun.sleep(50);
	}
}

describe("buildState integration", () => {
	test("state returns source, locals, and stack when paused", async () => {
		const session = new DebugSession("test-state-full");
		try {
			await session.launch(["node", "tests/fixtures/simple-app.js"], {
				brk: true,
			});
			await waitForState(session, "paused");

			const snapshot = await session.buildState();

			expect(snapshot.status).toBe("paused");
			expect(snapshot.reason).toBeDefined();
			expect(snapshot.location).toBeDefined();
			expect(snapshot.location?.line).toBeGreaterThan(0);

			// Source should be present with lines around the current position
			expect(snapshot.source).toBeDefined();
			expect(snapshot.source?.lines.length).toBeGreaterThan(0);
			// At least one line should be marked as current
			const currentLine = snapshot.source?.lines.find((l) => l.current === true);
			expect(currentLine).toBeDefined();

			// Stack should be present
			expect(snapshot.stack).toBeDefined();
			expect(snapshot.stack?.length).toBeGreaterThan(0);
			// First frame should have a ref starting with @f
			const firstFrame = snapshot.stack?.[0];
			expect(firstFrame?.ref).toMatch(/^@f/);
			expect(firstFrame?.line).toBeGreaterThan(0);

			// Locals should be present (may be empty at entry point, but the array should exist)
			expect(snapshot.vars).toBeDefined();

			// Breakpoint count should be present
			expect(snapshot.breakpointCount).toBeDefined();
			expect(snapshot.breakpointCount).toBeGreaterThanOrEqual(0);
		} finally {
			await session.stop();
		}
	});

	test("state returns running status when not paused", async () => {
		const session = new DebugSession("test-state-running");
		try {
			await session.launch(["node", "-e", "setTimeout(() => {}, 30000)"], {
				brk: false,
			});

			const snapshot = await session.buildState();

			expect(snapshot.status).toBe("running");
			// When running, no source/locals/stack should be present
			expect(snapshot.source).toBeUndefined();
			expect(snapshot.vars).toBeUndefined();
			expect(snapshot.stack).toBeUndefined();
		} finally {
			await session.stop();
		}
	});

	test("state with vars filter returns only locals", async () => {
		const session = new DebugSession("test-state-vars");
		try {
			await session.launch(["node", "tests/fixtures/simple-app.js"], {
				brk: true,
			});
			await waitForState(session, "paused");

			const snapshot = await session.buildState({ vars: true });

			expect(snapshot.status).toBe("paused");
			// Locals should be present
			expect(snapshot.vars).toBeDefined();
			// Source and stack should NOT be present (filtered out)
			expect(snapshot.source).toBeUndefined();
			expect(snapshot.stack).toBeUndefined();
			expect(snapshot.breakpointCount).toBeUndefined();
		} finally {
			await session.stop();
		}
	});

	test("state with stack filter returns only stack", async () => {
		const session = new DebugSession("test-state-stack");
		try {
			await session.launch(["node", "tests/fixtures/simple-app.js"], {
				brk: true,
			});
			await waitForState(session, "paused");

			const snapshot = await session.buildState({ stack: true });

			expect(snapshot.status).toBe("paused");
			// Stack should be present
			expect(snapshot.stack).toBeDefined();
			expect(snapshot.stack?.length).toBeGreaterThan(0);
			// Source, locals, and breakpoints should NOT be present (filtered out)
			expect(snapshot.source).toBeUndefined();
			expect(snapshot.vars).toBeUndefined();
			expect(snapshot.breakpointCount).toBeUndefined();
		} finally {
			await session.stop();
		}
	});

	test("state with code filter returns only source", async () => {
		const session = new DebugSession("test-state-code");
		try {
			await session.launch(["node", "tests/fixtures/simple-app.js"], {
				brk: true,
			});
			await waitForState(session, "paused");

			const snapshot = await session.buildState({ code: true });

			expect(snapshot.status).toBe("paused");
			// Source should be present
			expect(snapshot.source).toBeDefined();
			expect(snapshot.source?.lines.length).toBeGreaterThan(0);
			// Locals, stack, and breakpoints should NOT be present (filtered out)
			expect(snapshot.vars).toBeUndefined();
			expect(snapshot.stack).toBeUndefined();
			expect(snapshot.breakpointCount).toBeUndefined();
		} finally {
			await session.stop();
		}
	});

	test("state returns idle status when no target", async () => {
		const session = new DebugSession("test-state-idle");
		const snapshot = await session.buildState();
		expect(snapshot.status).toBe("idle");
	});

	test("state assigns refs to variables and frames", async () => {
		const session = new DebugSession("test-state-refs");
		try {
			await session.launch(["node", "tests/fixtures/simple-app.js"], {
				brk: true,
			});
			await waitForState(session, "paused");

			const snapshot = await session.buildState();

			// Check that variable refs are assigned
			if (snapshot.vars && snapshot.vars.length > 0) {
				const firstLocal = snapshot.vars[0];
				expect(firstLocal?.ref).toMatch(/^@v\d+$/);
				expect(firstLocal?.name).toBeDefined();
				expect(firstLocal?.value).toBeDefined();

				// The ref should be resolvable in the ref table
				const entry = session.refs.resolve(firstLocal?.ref ?? "");
				expect(entry).toBeDefined();
			}

			// Check that frame refs are assigned
			if (snapshot.stack && snapshot.stack.length > 0) {
				const firstFrame = snapshot.stack[0];
				expect(firstFrame?.ref).toMatch(/^@f\d+$/);

				// The ref should be resolvable in the ref table
				const entry = session.refs.resolve(firstFrame?.ref ?? "");
				expect(entry).toBeDefined();
			}
		} finally {
			await session.stop();
		}
	});

	test("state with custom lines context", async () => {
		const session = new DebugSession("test-state-lines");
		try {
			await session.launch(["node", "tests/fixtures/simple-app.js"], {
				brk: true,
			});
			await waitForState(session, "paused");

			// Request more context lines
			const snapshot = await session.buildState({ code: true, lines: 5 });

			expect(snapshot.source).toBeDefined();
			// With 5 lines context, we should get up to 11 lines (5 above + current + 5 below)
			// but may be fewer if near the start/end of file
			expect(snapshot.source?.lines.length).toBeGreaterThan(0);
		} finally {
			await session.stop();
		}
	});
});
