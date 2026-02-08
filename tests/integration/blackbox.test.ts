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

describe("Blackbox patterns", () => {
	test("add blackbox patterns", async () => {
		const session = new DebugSession("test-blackbox-add");
		try {
			await session.launch(["node", "tests/fixtures/step-app.js"], {
				brk: true,
			});
			await waitForState(session, "paused");

			const result = await session.addBlackbox(["node_modules", "internal"]);
			expect(result).toEqual(["node_modules", "internal"]);
			expect(session.listBlackbox()).toEqual(["node_modules", "internal"]);
		} finally {
			await session.stop();
		}
	});

	test("list blackbox patterns", async () => {
		const session = new DebugSession("test-blackbox-list");
		try {
			await session.launch(["node", "tests/fixtures/step-app.js"], {
				brk: true,
			});
			await waitForState(session, "paused");

			// Initially empty
			expect(session.listBlackbox()).toEqual([]);

			// Add some patterns
			await session.addBlackbox(["node_modules", "vendor"]);

			// Verify they are listed
			const patterns = session.listBlackbox();
			expect(patterns).toEqual(["node_modules", "vendor"]);
		} finally {
			await session.stop();
		}
	});

	test("remove specific pattern", async () => {
		const session = new DebugSession("test-blackbox-rm-specific");
		try {
			await session.launch(["node", "tests/fixtures/step-app.js"], {
				brk: true,
			});
			await waitForState(session, "paused");

			await session.addBlackbox(["node_modules", "vendor"]);
			expect(session.listBlackbox()).toEqual(["node_modules", "vendor"]);

			const result = await session.removeBlackbox(["node_modules"]);
			expect(result).toEqual(["vendor"]);
			expect(session.listBlackbox()).toEqual(["vendor"]);
		} finally {
			await session.stop();
		}
	});

	test("remove all patterns", async () => {
		const session = new DebugSession("test-blackbox-rm-all");
		try {
			await session.launch(["node", "tests/fixtures/step-app.js"], {
				brk: true,
			});
			await waitForState(session, "paused");

			await session.addBlackbox(["node_modules", "vendor", "internal"]);
			expect(session.listBlackbox()).toHaveLength(3);

			const result = await session.removeBlackbox(["all"]);
			expect(result).toEqual([]);
			expect(session.listBlackbox()).toEqual([]);
		} finally {
			await session.stop();
		}
	});

	test("blackbox persists across continue", async () => {
		const session = new DebugSession("test-blackbox-persist");
		try {
			await session.launch(["node", "tests/fixtures/step-app.js"], {
				brk: true,
			});
			await waitForState(session, "paused");

			// Set a breakpoint further in the file so we can continue to it
			await session.setBreakpoint("step-app.js", 12);

			// Add blackbox patterns
			await session.addBlackbox(["node_modules"]);
			expect(session.listBlackbox()).toEqual(["node_modules"]);

			// Continue to the breakpoint
			await session.continue();
			await waitForState(session, "paused");

			// Patterns should still be present
			expect(session.listBlackbox()).toEqual(["node_modules"]);
		} finally {
			await session.stop();
		}
	});

	test("blackbox throws when no session", async () => {
		const session = new DebugSession("test-blackbox-no-session");
		try {
			await expect(session.addBlackbox(["node_modules"])).rejects.toThrow(
				"No active debug session",
			);

			await expect(session.removeBlackbox(["node_modules"])).rejects.toThrow(
				"No active debug session",
			);
		} finally {
			await session.stop();
		}
	});
});
