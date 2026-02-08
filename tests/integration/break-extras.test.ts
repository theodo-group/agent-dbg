import { describe, expect, test } from "bun:test";
import { DebugSession } from "../../src/daemon/session.ts";

/**
 * Polls until the session reaches the expected state, or times out.
 */
async function waitForState(
	session: DebugSession,
	state: "idle" | "running" | "paused",
	timeoutMs = 5000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (session.sessionState !== state && Date.now() < deadline) {
		await Bun.sleep(50);
	}
}

describe("break-toggle", () => {
	test("toggle disables and re-enables a breakpoint", async () => {
		const session = new DebugSession("test-break-toggle");
		try {
			await session.launch(["node", "tests/fixtures/simple-app.js"], { brk: true });
			await waitForState(session, "paused");

			const bp = await session.setBreakpoint("tests/fixtures/simple-app.js", 5);
			expect(bp.ref).toBe("BP#1");

			// Should have 1 active breakpoint
			let list = session.listBreakpoints();
			expect(list.length).toBe(1);
			expect(list[0]?.disabled).toBeUndefined();

			// Disable the breakpoint
			const disableResult = await session.toggleBreakpoint("BP#1");
			expect(disableResult.state).toBe("disabled");

			// Should be listed as disabled
			list = session.listBreakpoints();
			expect(list.length).toBe(1);
			expect(list[0]?.disabled).toBe(true);

			// Re-enable the breakpoint
			const enableResult = await session.toggleBreakpoint("BP#1");
			expect(enableResult.state).toBe("enabled");

			// Should be listed as enabled (no disabled flag)
			list = session.listBreakpoints();
			expect(list.length).toBe(1);
			expect(list[0]?.disabled).toBeUndefined();
		} finally {
			await session.stop();
		}
	});

	test("toggle all disables and re-enables all breakpoints", async () => {
		const session = new DebugSession("test-break-toggle-all");
		try {
			await session.launch(["node", "tests/fixtures/simple-app.js"], { brk: true });
			await waitForState(session, "paused");

			await session.setBreakpoint("tests/fixtures/simple-app.js", 5);
			await session.setBreakpoint("tests/fixtures/simple-app.js", 11);

			let list = session.listBreakpoints();
			expect(list.length).toBe(2);

			// Disable all
			const disableResult = await session.toggleBreakpoint("all");
			expect(disableResult.state).toBe("disabled");

			list = session.listBreakpoints();
			expect(list.length).toBe(2);
			for (const bp of list) {
				expect(bp.disabled).toBe(true);
			}

			// Re-enable all
			const enableResult = await session.toggleBreakpoint("all");
			expect(enableResult.state).toBe("enabled");

			list = session.listBreakpoints();
			expect(list.length).toBe(2);
			for (const bp of list) {
				expect(bp.disabled).toBeUndefined();
			}
		} finally {
			await session.stop();
		}
	});

	test("toggle unknown ref throws error", async () => {
		const session = new DebugSession("test-break-toggle-unknown");
		try {
			await session.launch(["node", "tests/fixtures/simple-app.js"], { brk: true });
			await waitForState(session, "paused");

			await expect(session.toggleBreakpoint("BP#99")).rejects.toThrow("Unknown breakpoint ref");
		} finally {
			await session.stop();
		}
	});
});

describe("breakable", () => {
	test("returns valid breakable locations", async () => {
		const session = new DebugSession("test-breakable");
		try {
			await session.launch(["node", "tests/fixtures/simple-app.js"], { brk: true });
			await waitForState(session, "paused");

			const locations = await session.getBreakableLocations(
				"tests/fixtures/simple-app.js",
				4,
				8,
			);

			expect(Array.isArray(locations)).toBe(true);
			expect(locations.length).toBeGreaterThan(0);

			// All locations should have line and column
			for (const loc of locations) {
				expect(loc.line).toBeGreaterThanOrEqual(4);
				expect(loc.line).toBeLessThanOrEqual(8);
				expect(loc.column).toBeGreaterThan(0);
			}
		} finally {
			await session.stop();
		}
	});

	test("throws for unknown file", async () => {
		const session = new DebugSession("test-breakable-unknown");
		try {
			await session.launch(["node", "tests/fixtures/simple-app.js"], { brk: true });
			await waitForState(session, "paused");

			await expect(
				session.getBreakableLocations("nonexistent.js", 1, 5),
			).rejects.toThrow("No loaded script matches");
		} finally {
			await session.stop();
		}
	});

	test("throws without CDP connection", async () => {
		const session = new DebugSession("test-breakable-no-cdp");
		await expect(
			session.getBreakableLocations("file.js", 1, 5),
		).rejects.toThrow("No active debug session");
	});
});

describe("restart-frame", () => {
	test("restarts the current frame", async () => {
		const session = new DebugSession("test-restart-frame");
		try {
			await session.launch(["node", "tests/fixtures/step-app.js"], { brk: true });
			await waitForState(session, "paused");

			// Step to get inside helper function
			let currentLine = session.getStatus().pauseInfo?.line ?? 0;
			while (currentLine < 10 && session.sessionState === "paused") {
				await session.step("over");
				currentLine = session.getStatus().pauseInfo?.line ?? currentLine;
			}

			// Step into helper()
			await session.step("into");
			let line = session.getStatus().pauseInfo?.line;
			if (line !== undefined && line >= 10) {
				await session.step("into");
				line = session.getStatus().pauseInfo?.line;
			}

			expect(session.sessionState).toBe("paused");
			const lineInHelper = session.getStatus().pauseInfo?.line;
			expect(lineInHelper).toBeDefined();

			// Restart the frame
			const result = await session.restartFrame();
			expect(result.status).toBe("restarted");
			expect(session.sessionState).toBe("paused");
		} finally {
			await session.stop();
		}
	});

	test("throws when not paused", async () => {
		const session = new DebugSession("test-restart-frame-not-paused");
		try {
			await session.launch(
				["node", "-e", "setInterval(() => {}, 100)"],
				{ brk: false },
			);
			expect(session.sessionState).toBe("running");

			await expect(session.restartFrame()).rejects.toThrow("not paused");
		} finally {
			await session.stop();
		}
	});
});

describe("break --continue", () => {
	test("setBreakpoint then continue works", async () => {
		const session = new DebugSession("test-break-continue");
		try {
			await session.launch(["node", "tests/fixtures/step-app.js"], { brk: true });
			await waitForState(session, "paused");

			// Set a breakpoint on line 12
			const bp = await session.setBreakpoint("tests/fixtures/step-app.js", 12);
			expect(bp.ref).toBe("BP#1");

			// Continue to the breakpoint (simulating --continue flag behavior)
			await session.continue();

			expect(session.sessionState).toBe("paused");
			const status = session.getStatus();
			expect(status.pauseInfo).toBeDefined();
			// Should be at or near line 12 (0-based line 11)
			if (status.pauseInfo?.line !== undefined) {
				expect(status.pauseInfo.line).toBe(11);
			}
		} finally {
			await session.stop();
		}
	});
});

describe("break --pattern", () => {
	test("set breakpoint with urlRegex", async () => {
		const session = new DebugSession("test-break-pattern");
		try {
			await session.launch(["node", "tests/fixtures/simple-app.js"], { brk: true });
			await waitForState(session, "paused");

			const result = await session.setBreakpoint("simple-app", 5, {
				urlRegex: "simple-app\\.js",
			});

			expect(result.ref).toBe("BP#1");
			expect(result.location.line).toBeGreaterThan(0);
		} finally {
			await session.stop();
		}
	});
});
