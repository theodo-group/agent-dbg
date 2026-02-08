import { describe, expect, test } from "bun:test";
import { DebugSession } from "../../src/daemon/session.ts";

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

describe("Source map integration", () => {
	test("stack trace shows .ts paths after source map resolution", async () => {
		const session = new DebugSession("test-sm-stack");
		try {
			await session.launch(["node", "tests/fixtures/ts-app/dist/app.js"], { brk: true });
			await waitForState(session, "paused");
			expect(session.sessionState).toBe("paused");

			// Wait a moment for source maps to load
			await Bun.sleep(100);

			// Set breakpoint inside the greet function (line 8 of app.ts)
			const bp = await session.setBreakpoint("app.ts", 8);
			expect(bp.ref).toMatch(/^BP#\d+$/);

			// Continue to hit the breakpoint
			await session.continue();
			await waitForState(session, "paused");
			expect(session.sessionState).toBe("paused");

			const stack = session.getStack();
			expect(stack.length).toBeGreaterThan(0);

			// Top frame should reference .ts source
			const topFrame = stack[0];
			expect(topFrame).toBeDefined();
			expect(topFrame!.file).toContain("app.ts");
		} finally {
			await session.stop();
		}
	});

	test("setBreakpoint on .ts file works via source map translation", async () => {
		const session = new DebugSession("test-sm-break");
		try {
			await session.launch(["node", "tests/fixtures/ts-app/dist/app.js"], { brk: true });
			await waitForState(session, "paused");

			// Wait for source maps to load
			await Bun.sleep(100);

			// Set breakpoint on TS file line (add function at line 13 of app.ts)
			const bp = await session.setBreakpoint("app.ts", 13);
			expect(bp.ref).toMatch(/^BP#\d+$/);
			// The location should report the original .ts file
			expect(bp.location.url).toContain("app.ts");
			expect(bp.location.line).toBe(13);

			// Continue and it should actually pause
			await session.continue();
			await waitForState(session, "paused");
			expect(session.sessionState).toBe("paused");
		} finally {
			await session.stop();
		}
	});

	test("getSource shows original TypeScript source with type annotations", async () => {
		const session = new DebugSession("test-sm-source");
		try {
			await session.launch(["node", "tests/fixtures/ts-app/dist/app.js"], { brk: true });
			await waitForState(session, "paused");

			// Wait for source maps to load
			await Bun.sleep(100);

			const source = await session.getSource({ file: "app.ts", all: true });
			expect(source.lines.length).toBeGreaterThan(0);

			// Should contain TypeScript type annotations
			const allText = source.lines.map((l) => l.text).join("\n");
			expect(allText).toContain("Person");
			expect(allText).toContain(": string");
			expect(allText).toContain(": number");
		} finally {
			await session.stop();
		}
	});

	test("buildState shows source-mapped .ts location", async () => {
		const session = new DebugSession("test-sm-state");
		try {
			await session.launch(["node", "tests/fixtures/ts-app/dist/app.js"], { brk: true });
			await waitForState(session, "paused");

			// Wait for source maps to load
			await Bun.sleep(100);

			// Set breakpoint and continue to it
			await session.setBreakpoint("app.ts", 8);
			await session.continue();
			await waitForState(session, "paused");

			const state = await session.buildState();
			expect(state.status).toBe("paused");
			expect(state.location).toBeDefined();
			expect(state.location!.url).toContain("app.ts");
		} finally {
			await session.stop();
		}
	});

	test("buildState source shows TypeScript content", async () => {
		const session = new DebugSession("test-sm-state-source");
		try {
			await session.launch(["node", "tests/fixtures/ts-app/dist/app.js"], { brk: true });
			await waitForState(session, "paused");

			// Wait for source maps to load
			await Bun.sleep(100);

			// Set breakpoint and continue to it
			await session.setBreakpoint("app.ts", 8);
			await session.continue();
			await waitForState(session, "paused");

			const state = await session.buildState({ code: true });
			expect(state.source).toBeDefined();
			expect(state.source!.lines.length).toBeGreaterThan(0);

			// Source should contain TS type annotations
			const allText = state.source!.lines.map((l) => l.text).join("\n");
			expect(allText).toContain("Person");
		} finally {
			await session.stop();
		}
	});

	test("listBreakpoints shows .ts file locations", async () => {
		const session = new DebugSession("test-sm-breakls");
		try {
			await session.launch(["node", "tests/fixtures/ts-app/dist/app.js"], { brk: true });
			await waitForState(session, "paused");

			// Wait for source maps to load
			await Bun.sleep(100);

			await session.setBreakpoint("app.ts", 8);

			const bps = session.listBreakpoints();
			expect(bps.length).toBe(1);
			const bp = bps[0];
			expect(bp).toBeDefined();
			// URL should be the original .ts file
			expect(bp!.url).toContain("app.ts");
			expect(bp!.originalUrl).toContain("app.ts");
			expect(bp!.originalLine).toBe(8);
		} finally {
			await session.stop();
		}
	});

	test("graceful fallback: plain .js files work exactly as before", async () => {
		const session = new DebugSession("test-sm-fallback");
		try {
			await session.launch(["node", "tests/fixtures/simple-app.js"], { brk: true });
			await waitForState(session, "paused");

			// Set breakpoint on plain JS file — should work as before
			const bp = await session.setBreakpoint("simple-app.js", 5);
			expect(bp.ref).toMatch(/^BP#\d+$/);
			expect(bp.location.url).toContain("simple-app.js");

			await session.continue();
			await waitForState(session, "paused");
			expect(session.sessionState).toBe("paused");

			const stack = session.getStack();
			expect(stack.length).toBeGreaterThan(0);
			expect(stack[0]!.file).toContain("simple-app.js");

			const state = await session.buildState();
			expect(state.location!.url).toContain("simple-app.js");
		} finally {
			await session.stop();
		}
	});

	test("source map info is available via resolver", async () => {
		const session = new DebugSession("test-sm-info");
		try {
			await session.launch(["node", "tests/fixtures/ts-app/dist/app.js"], { brk: true });
			await waitForState(session, "paused");

			// Wait for source maps to load
			await Bun.sleep(100);

			const infos = session.sourceMapResolver.getAllInfos();
			expect(infos.length).toBeGreaterThan(0);

			const appInfo = infos.find((i) => i.generatedUrl.includes("app.js"));
			expect(appInfo).toBeDefined();
			expect(appInfo!.sources.length).toBeGreaterThan(0);
			expect(appInfo!.sources.some((s) => s.includes("app.ts"))).toBe(true);
			expect(appInfo!.hasSourcesContent).toBe(true);
		} finally {
			await session.stop();
		}
	});
});
