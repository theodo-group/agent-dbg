import { describe, expect, test } from "bun:test";
import { withDebuggerSession } from "../../helpers.ts";

describe("stack --filter", () => {
	test("filter returns only frames matching keyword", () =>
		withDebuggerSession(
			"test-stack-filter",
			"tests/fixtures/js/inspect-app.js",
			async (session) => {
				const allFrames = session.getStack();
				expect(allFrames.length).toBeGreaterThan(0);

				// Filter for a function name that exists in the stack
				const topFn = allFrames[0]!.functionName;
				const filtered = session.getStack({ filter: topFn });
				expect(filtered.length).toBeGreaterThan(0);
				for (const f of filtered) {
					expect(f.functionName.toLowerCase()).toContain(topFn.toLowerCase());
				}
			},
		));

	test("filter with no match returns empty array", () =>
		withDebuggerSession(
			"test-stack-filter-empty",
			"tests/fixtures/js/inspect-app.js",
			async (session) => {
				const filtered = session.getStack({ filter: "nonexistent_function_xyz" });
				expect(filtered).toEqual([]);
			},
		));

	test("filter matches on file path too", () =>
		withDebuggerSession(
			"test-stack-filter-file",
			"tests/fixtures/js/inspect-app.js",
			async (session) => {
				const filtered = session.getStack({ filter: "inspect-app" });
				expect(filtered.length).toBeGreaterThan(0);
				for (const f of filtered) {
					expect(f.file).toContain("inspect-app");
				}
			},
		));

	test("filter is case-insensitive", () =>
		withDebuggerSession(
			"test-stack-filter-case",
			"tests/fixtures/js/inspect-app.js",
			async (session) => {
				const allFrames = session.getStack();
				const topFn = allFrames[0]!.functionName;
				const filtered = session.getStack({ filter: topFn.toUpperCase() });
				expect(filtered.length).toBeGreaterThan(0);
			},
		));
});
