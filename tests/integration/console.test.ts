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

describe("Console capture", () => {
	test("captures console.log, console.warn, and console.error messages", async () => {
		const session = new DebugSession("test-console-capture");
		try {
			await session.launch(["node", "tests/fixtures/console-app.js"], { brk: true });
			await waitForState(session, "paused");

			// Continue to the debugger statement — this will execute the console calls
			await session.continue();
			await waitForState(session, "paused", 5000);

			// Allow a small delay for console events to be processed
			await Bun.sleep(100);

			const messages = session.getConsoleMessages();
			expect(messages.length).toBeGreaterThanOrEqual(3);

			const levels = messages.map((m) => m.level);
			expect(levels).toContain("log");
			expect(levels).toContain("warning");
			expect(levels).toContain("error");

			// Check that text is captured
			const logMsg = messages.find((m) => m.text.includes("hello from app"));
			expect(logMsg).toBeDefined();

			const warnMsg = messages.find((m) => m.text.includes("warning message"));
			expect(warnMsg).toBeDefined();

			const errMsg = messages.find((m) => m.text.includes("error message"));
			expect(errMsg).toBeDefined();
		} finally {
			await session.stop();
		}
	});

	test("captures console messages with objects", async () => {
		const session = new DebugSession("test-console-objects");
		try {
			await session.launch(["node", "tests/fixtures/console-app.js"], { brk: true });
			await waitForState(session, "paused");

			await session.continue();
			await waitForState(session, "paused", 5000);
			await Bun.sleep(100);

			const messages = session.getConsoleMessages();
			const objectMsg = messages.find((m) => m.text.includes("object:"));
			expect(objectMsg).toBeDefined();
			// The object should contain something about key/value
			expect(objectMsg?.text).toContain("key");
		} finally {
			await session.stop();
		}
	});

	test("filters console messages by level", async () => {
		const session = new DebugSession("test-console-filter");
		try {
			await session.launch(["node", "tests/fixtures/console-app.js"], { brk: true });
			await waitForState(session, "paused");

			await session.continue();
			await waitForState(session, "paused", 5000);
			await Bun.sleep(100);

			const errorMessages = session.getConsoleMessages({ level: "error" });
			expect(errorMessages.length).toBeGreaterThanOrEqual(1);
			for (const msg of errorMessages) {
				expect(msg.level).toBe("error");
			}

			const warnMessages = session.getConsoleMessages({ level: "warning" });
			expect(warnMessages.length).toBeGreaterThanOrEqual(1);
			for (const msg of warnMessages) {
				expect(msg.level).toBe("warning");
			}
		} finally {
			await session.stop();
		}
	});

	test("console --since returns only last N entries", async () => {
		const session = new DebugSession("test-console-since");
		try {
			await session.launch(["node", "tests/fixtures/console-app.js"], { brk: true });
			await waitForState(session, "paused");

			await session.continue();
			await waitForState(session, "paused", 5000);
			await Bun.sleep(100);

			const allMessages = session.getConsoleMessages();
			expect(allMessages.length).toBeGreaterThanOrEqual(3);

			const lastTwo = session.getConsoleMessages({ since: 2 });
			expect(lastTwo.length).toBe(2);

			// The last two messages should match the tail of all messages
			expect(lastTwo[0]?.text).toBe(allMessages[allMessages.length - 2]?.text);
			expect(lastTwo[1]?.text).toBe(allMessages[allMessages.length - 1]?.text);
		} finally {
			await session.stop();
		}
	});

	test("console --clear clears the buffer after returning", async () => {
		const session = new DebugSession("test-console-clear");
		try {
			await session.launch(["node", "tests/fixtures/console-app.js"], { brk: true });
			await waitForState(session, "paused");

			await session.continue();
			await waitForState(session, "paused", 5000);
			await Bun.sleep(100);

			const messages = session.getConsoleMessages({ clear: true });
			expect(messages.length).toBeGreaterThanOrEqual(3);

			// After clearing, buffer should be empty
			const afterClear = session.getConsoleMessages();
			expect(afterClear.length).toBe(0);
		} finally {
			await session.stop();
		}
	});

	test("clearConsole() empties the buffer", async () => {
		const session = new DebugSession("test-console-clear-method");
		try {
			await session.launch(["node", "tests/fixtures/console-app.js"], { brk: true });
			await waitForState(session, "paused");

			await session.continue();
			await waitForState(session, "paused", 5000);
			await Bun.sleep(100);

			expect(session.getConsoleMessages().length).toBeGreaterThan(0);
			session.clearConsole();
			expect(session.getConsoleMessages().length).toBe(0);
		} finally {
			await session.stop();
		}
	});

	test("stop() clears console and exception buffers", async () => {
		const session = new DebugSession("test-console-stop-clears");
		try {
			await session.launch(["node", "tests/fixtures/console-app.js"], { brk: true });
			await waitForState(session, "paused");

			await session.continue();
			await waitForState(session, "paused", 5000);
			await Bun.sleep(100);

			expect(session.getConsoleMessages().length).toBeGreaterThan(0);
		} finally {
			await session.stop();
		}

		// After stop, buffers should be cleared
		expect(session.getConsoleMessages().length).toBe(0);
		expect(session.getExceptions().length).toBe(0);
	});
});

describe("Exception capture", () => {
	test("captures uncaught exceptions", async () => {
		const session = new DebugSession("test-exception-capture");
		try {
			await session.launch(["node", "tests/fixtures/exception-app.js"], { brk: true });
			await waitForState(session, "paused");

			// Continue — the setTimeout will throw after 50ms and the process will crash
			await session.continue();
			// Wait for the process to exit (state becomes idle)
			await waitForState(session, "idle", 5000);
			await Bun.sleep(100);

			const exceptions = session.getExceptions();
			expect(exceptions.length).toBeGreaterThanOrEqual(1);

			const entry = exceptions[0];
			expect(entry).toBeDefined();
			expect(entry?.text).toContain("Uncaught");
			expect(entry?.description).toContain("uncaught!");
		} finally {
			await session.stop();
		}
	});

	test("exception entries have timestamp", async () => {
		const session = new DebugSession("test-exception-timestamp");
		const before = Date.now();
		try {
			await session.launch(["node", "tests/fixtures/exception-app.js"], { brk: true });
			await waitForState(session, "paused");

			await session.continue();
			await waitForState(session, "idle", 5000);
			await Bun.sleep(100);

			const exceptions = session.getExceptions();
			expect(exceptions.length).toBeGreaterThanOrEqual(1);

			const entry = exceptions[0];
			expect(entry).toBeDefined();
			expect(entry!.timestamp).toBeGreaterThanOrEqual(before);
			expect(entry!.timestamp).toBeLessThanOrEqual(Date.now());
		} finally {
			await session.stop();
		}
	});

	test("exceptions --since returns only last N entries", async () => {
		const session = new DebugSession("test-exception-since");
		try {
			await session.launch(["node", "tests/fixtures/exception-app.js"], { brk: true });
			await waitForState(session, "paused");

			await session.continue();
			await waitForState(session, "idle", 5000);
			await Bun.sleep(100);

			const allExceptions = session.getExceptions();
			expect(allExceptions.length).toBeGreaterThanOrEqual(1);

			const lastOne = session.getExceptions({ since: 1 });
			expect(lastOne.length).toBe(1);
			expect(lastOne[0]?.text).toBe(allExceptions[allExceptions.length - 1]?.text);
		} finally {
			await session.stop();
		}
	});

	test("console messages have timestamps", async () => {
		const session = new DebugSession("test-console-timestamps");
		const before = Date.now();
		try {
			await session.launch(["node", "tests/fixtures/console-app.js"], { brk: true });
			await waitForState(session, "paused");

			await session.continue();
			await waitForState(session, "paused", 5000);
			await Bun.sleep(100);

			const messages = session.getConsoleMessages();
			expect(messages.length).toBeGreaterThan(0);

			for (const msg of messages) {
				expect(msg.timestamp).toBeGreaterThanOrEqual(before);
				expect(msg.timestamp).toBeLessThanOrEqual(Date.now());
			}
		} finally {
			await session.stop();
		}
	});
});
