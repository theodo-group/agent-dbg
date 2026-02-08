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

describe("Inspection commands", () => {
	test("getSource returns lines around pause location with current marker", async () => {
		const session = new DebugSession("test-source-basic");
		try {
			await session.launch(["node", "tests/fixtures/step-app.js"], { brk: true });
			await waitForState(session, "paused");
			expect(session.sessionState).toBe("paused");

			const result = await session.getSource();
			expect(result.url).toBeDefined();
			expect(result.lines.length).toBeGreaterThan(0);

			// There should be exactly one line marked as current
			const currentLines = result.lines.filter((l) => l.current === true);
			expect(currentLines.length).toBe(1);

			// All lines should have line numbers and text
			for (const line of result.lines) {
				expect(typeof line.line).toBe("number");
				expect(typeof line.text).toBe("string");
			}
		} finally {
			await session.stop();
		}
	});

	test("getSource with file option shows source of specified file", async () => {
		const session = new DebugSession("test-source-file");
		try {
			await session.launch(["node", "tests/fixtures/step-app.js"], { brk: true });
			await waitForState(session, "paused");
			expect(session.sessionState).toBe("paused");

			const result = await session.getSource({ file: "step-app.js" });
			expect(result.url).toContain("step-app.js");
			expect(result.lines.length).toBeGreaterThan(0);
		} finally {
			await session.stop();
		}
	});

	test("getSource with all option returns entire file", async () => {
		const session = new DebugSession("test-source-all");
		try {
			await session.launch(["node", "tests/fixtures/step-app.js"], { brk: true });
			await waitForState(session, "paused");
			expect(session.sessionState).toBe("paused");

			const result = await session.getSource({ all: true });
			expect(result.lines.length).toBeGreaterThan(0);

			// step-app.js has 13 lines of content; with all, we should see all of them
			// The file has content on lines including function helper, const a, etc.
			expect(result.lines.length).toBeGreaterThanOrEqual(10);
		} finally {
			await session.stop();
		}
	});

	test("getScripts lists loaded scripts including step-app.js", async () => {
		const session = new DebugSession("test-scripts-list");
		try {
			await session.launch(["node", "tests/fixtures/step-app.js"], { brk: true });
			await waitForState(session, "paused");
			expect(session.sessionState).toBe("paused");

			const scripts = session.getScripts();
			expect(scripts.length).toBeGreaterThan(0);

			// step-app.js should be in the list
			const stepApp = scripts.find((s) => s.url.includes("step-app.js"));
			expect(stepApp).toBeDefined();
			expect(stepApp!.scriptId).toBeDefined();
			expect(stepApp!.url).toContain("step-app.js");
		} finally {
			await session.stop();
		}
	});

	test("getScripts with filter narrows results", async () => {
		const session = new DebugSession("test-scripts-filter");
		try {
			await session.launch(["node", "tests/fixtures/step-app.js"], { brk: true });
			await waitForState(session, "paused");
			expect(session.sessionState).toBe("paused");

			const allScripts = session.getScripts();
			const filtered = session.getScripts("step-app");

			// Filtered should contain step-app.js
			expect(filtered.length).toBeGreaterThan(0);
			const stepApp = filtered.find((s) => s.url.includes("step-app.js"));
			expect(stepApp).toBeDefined();

			// Filtered should be a subset of all scripts
			expect(filtered.length).toBeLessThanOrEqual(allScripts.length);
		} finally {
			await session.stop();
		}
	});

	test("getStack returns stack frames with refs and correct format", async () => {
		const session = new DebugSession("test-stack-basic");
		try {
			await session.launch(["node", "tests/fixtures/step-app.js"], { brk: true });
			await waitForState(session, "paused");
			expect(session.sessionState).toBe("paused");

			const stack = session.getStack();
			expect(stack.length).toBeGreaterThan(0);

			// Each frame should have ref, functionName, file, line
			for (const frame of stack) {
				expect(frame.ref).toMatch(/^@f\d+$/);
				expect(typeof frame.functionName).toBe("string");
				expect(typeof frame.file).toBe("string");
				expect(typeof frame.line).toBe("number");
				expect(frame.line).toBeGreaterThan(0); // 1-based
			}
		} finally {
			await session.stop();
		}
	});

	test("getStack while inside a function shows multiple frames", async () => {
		const session = new DebugSession("test-stack-nested");
		try {
			await session.launch(["node", "tests/fixtures/step-app.js"], { brk: true });
			await waitForState(session, "paused");

			// Step to the helper() call and step into it
			let currentLine = session.getStatus().pauseInfo?.line ?? 0;
			while (currentLine < 10 && session.sessionState === "paused") {
				await session.step("over");
				currentLine = session.getStatus().pauseInfo?.line ?? currentLine;
			}

			await session.step("into");
			const line = session.getStatus().pauseInfo?.line;
			if (line !== undefined && line >= 10) {
				await session.step("into");
			}

			expect(session.sessionState).toBe("paused");

			const stack = session.getStack();
			// Should have at least 2 frames: helper + main module
			expect(stack.length).toBeGreaterThanOrEqual(2);

			// Top frame should be the helper function
			const topFrame = stack[0];
			expect(topFrame).toBeDefined();
			expect(topFrame!.functionName).toBe("helper");
		} finally {
			await session.stop();
		}
	});

	test("searchInScripts finds a string in step-app.js", async () => {
		const session = new DebugSession("test-search-basic");
		try {
			await session.launch(["node", "tests/fixtures/step-app.js"], { brk: true });
			await waitForState(session, "paused");
			expect(session.sessionState).toBe("paused");

			const results = await session.searchInScripts("helper");
			expect(results.length).toBeGreaterThan(0);

			// At least one match should be in step-app.js
			const stepAppMatch = results.find((r) => r.url.includes("step-app.js"));
			expect(stepAppMatch).toBeDefined();
			expect(stepAppMatch!.line).toBeGreaterThan(0);
			expect(stepAppMatch!.content).toContain("helper");
		} finally {
			await session.stop();
		}
	});

	test("searchInScripts with no matches returns empty array", async () => {
		const session = new DebugSession("test-search-empty");
		try {
			await session.launch(["node", "tests/fixtures/step-app.js"], { brk: true });
			await waitForState(session, "paused");
			expect(session.sessionState).toBe("paused");

			const results = await session.searchInScripts("xyzzy_nonexistent_string_12345");
			expect(results.length).toBe(0);
		} finally {
			await session.stop();
		}
	});
});
