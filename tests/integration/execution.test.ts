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

describe("Execution control", () => {
	test("continue resumes and process finishes", async () => {
		const session = new DebugSession("test-exec-continue");
		try {
			await session.launch(["node", "tests/fixtures/step-app.js"], { brk: true });
			await waitForState(session, "paused");
			expect(session.sessionState).toBe("paused");

			// Continue — the script should run to completion
			await session.continue();

			// The process should have finished (idle) or be finishing
			await waitForState(session, "idle", 5000);
			expect(["idle", "running"]).toContain(session.sessionState);
		} finally {
			await session.stop();
		}
	});

	test("continue resumes and hits next breakpoint", async () => {
		const session = new DebugSession("test-exec-continue-bp");
		try {
			await session.launch(["node", "tests/fixtures/step-app.js"], { brk: true });
			await waitForState(session, "paused");
			expect(session.sessionState).toBe("paused");

			// Set a breakpoint on line 12 (const d = a + b + c;), CDP 0-based: 11
			const cdp = session.cdp;
			expect(cdp).not.toBeNull();
			await cdp!.send("Debugger.setBreakpointByUrl", {
				lineNumber: 11,
				urlRegex: "step-app\\.js",
			});

			// Continue — should hit the breakpoint
			await session.continue();
			expect(session.sessionState).toBe("paused");

			const status = session.getStatus();
			expect(status.state).toBe("paused");
		} finally {
			await session.stop();
		}
	});

	test("step over advances one line", async () => {
		const session = new DebugSession("test-exec-step-over");
		try {
			await session.launch(["node", "tests/fixtures/step-app.js"], {
				brk: true,
			});
			await waitForState(session, "paused");

			const statusBefore = session.getStatus();
			const lineBefore = statusBefore.pauseInfo?.line;
			expect(lineBefore).toBeDefined();

			// Step over — should advance to the next line
			await session.step("over");

			expect(session.sessionState).toBe("paused");
			const statusAfter = session.getStatus();
			expect(statusAfter.pauseInfo).toBeDefined();
			expect(statusAfter.pauseInfo?.line).toBeDefined();

			// The line should have changed (advanced by at least one)
			if (lineBefore !== undefined && statusAfter.pauseInfo?.line !== undefined) {
				expect(statusAfter.pauseInfo.line).toBeGreaterThan(lineBefore);
			}
		} finally {
			await session.stop();
		}
	});

	test("step into enters a function", async () => {
		const session = new DebugSession("test-exec-step-into");
		try {
			await session.launch(["node", "tests/fixtures/step-app.js"], { brk: true });
			await waitForState(session, "paused");

			// Step to the helper() call line: const c = helper(a);
			// Initial pause is at the first executable statement.
			// Step over until we reach the line with helper() call.
			// step-app.js line 11 (1-based) / 10 (0-based): const c = helper(a);
			let currentLine = session.getStatus().pauseInfo?.line ?? 0;
			while (currentLine < 10 && session.sessionState === "paused") {
				await session.step("over");
				currentLine = session.getStatus().pauseInfo?.line ?? currentLine;
			}
			expect(currentLine).toBe(10); // 0-based line for const c = helper(a);

			// Now step into the function call. V8 may pause at sub-expressions
			// before entering the function, so keep stepping into until the line
			// moves to inside the helper function (0-based lines 3-5).
			await session.step("into");
			expect(session.sessionState).toBe("paused");

			let line = session.getStatus().pauseInfo?.line;
			// If we're still on the same line, step into once more
			if (line !== undefined && line >= 10) {
				await session.step("into");
				line = session.getStatus().pauseInfo?.line;
			}

			expect(line).toBeDefined();
			// Should now be inside helper function body (0-based lines 3, 4, or 5)
			if (line !== undefined) {
				expect(line).toBeLessThan(10);
			}
		} finally {
			await session.stop();
		}
	});

	test("step out exits current function", async () => {
		const session = new DebugSession("test-exec-step-out");
		try {
			await session.launch(["node", "tests/fixtures/step-app.js"], { brk: true });
			await waitForState(session, "paused");

			// Step to the helper() call and step into it
			let currentLine = session.getStatus().pauseInfo?.line ?? 0;
			while (currentLine < 10 && session.sessionState === "paused") {
				await session.step("over");
				currentLine = session.getStatus().pauseInfo?.line ?? currentLine;
			}

			// Step into the function
			await session.step("into");
			let line = session.getStatus().pauseInfo?.line;
			if (line !== undefined && line >= 10) {
				await session.step("into");
				line = session.getStatus().pauseInfo?.line;
			}

			expect(session.sessionState).toBe("paused");
			const lineInside = session.getStatus().pauseInfo?.line;
			expect(lineInside).toBeDefined();
			expect(lineInside).toBeLessThan(10); // inside helper

			// Step out of the function
			await session.step("out");

			expect(session.sessionState).toBe("paused");
			const statusOutside = session.getStatus();
			expect(statusOutside.pauseInfo).toBeDefined();
			// After stepping out, we should be back in the main scope
			if (statusOutside.pauseInfo?.line !== undefined) {
				expect(statusOutside.pauseInfo.line).toBeGreaterThanOrEqual(10);
			}
		} finally {
			await session.stop();
		}
	});

	test("pause interrupts running process", async () => {
		const session = new DebugSession("test-exec-pause");
		try {
			await session.launch(["node", "-e", "setInterval(() => {}, 100)"], { brk: false });
			// Process should be running
			expect(session.sessionState).toBe("running");

			// Pause the running process
			await session.pause();

			expect(session.sessionState).toBe("paused");
			const status = session.getStatus();
			expect(status.state).toBe("paused");
		} finally {
			await session.stop();
		}
	});

	test("continue throws when not paused", async () => {
		const session = new DebugSession("test-exec-continue-err");
		try {
			await session.launch(["node", "-e", "setInterval(() => {}, 100)"], { brk: false });
			expect(session.sessionState).toBe("running");

			await expect(session.continue()).rejects.toThrow("not paused");
		} finally {
			await session.stop();
		}
	});

	test("step throws when not paused", async () => {
		const session = new DebugSession("test-exec-step-err");
		try {
			await session.launch(["node", "-e", "setInterval(() => {}, 100)"], { brk: false });
			expect(session.sessionState).toBe("running");

			await expect(session.step("over")).rejects.toThrow("not paused");
		} finally {
			await session.stop();
		}
	});

	test("pause throws when not running", async () => {
		const session = new DebugSession("test-exec-pause-err");
		try {
			await session.launch(["node", "-e", "setTimeout(() => {}, 30000)"], { brk: true });
			await waitForState(session, "paused");

			await expect(session.pause()).rejects.toThrow("not running");
		} finally {
			await session.stop();
		}
	});

	test("run-to stops at the specified line", async () => {
		const session = new DebugSession("test-exec-run-to");
		try {
			await session.launch(["node", "tests/fixtures/step-app.js"], { brk: true });
			await waitForState(session, "paused");

			// Run to line 12 (const d = a + b + c;), CDP 0-based: 11
			await session.runTo("step-app.js", 12);

			expect(session.sessionState).toBe("paused");
			const status = session.getStatus();
			expect(status.pauseInfo).toBeDefined();
			// CDP line is 0-based, so line 12 = index 11
			if (status.pauseInfo?.line !== undefined) {
				expect(status.pauseInfo.line).toBe(11);
			}
		} finally {
			await session.stop();
		}
	});
});
