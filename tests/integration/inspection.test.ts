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

/**
 * Launch and advance to the debugger statement in inspect-app.js (line 7).
 */
async function launchAndPauseAtDebugger(sessionName: string): Promise<DebugSession> {
	const session = new DebugSession(sessionName);
	await session.launch(["node", "tests/fixtures/inspect-app.js"], {
		brk: true,
	});
	await waitForState(session, "paused");

	// Continue past initial brk pause to the `debugger;` statement
	await session.continue();
	await waitForState(session, "paused");

	return session;
}

describe("Inspection: eval", () => {
	test("eval evaluates a simple expression", async () => {
		const session = await launchAndPauseAtDebugger("test-eval-simple");
		try {
			expect(session.sessionState).toBe("paused");

			const result = await session.eval("1 + 2");
			expect(result.ref).toMatch(/^@v/);
			expect(result.type).toBe("number");
			expect(result.value).toBe("3");
		} finally {
			await session.stop();
		}
	});

	test("eval accesses local variables", async () => {
		const session = await launchAndPauseAtDebugger("test-eval-locals");
		try {
			const result = await session.eval("num");
			expect(result.ref).toMatch(/^@v/);
			expect(result.type).toBe("number");
			expect(result.value).toBe("123");
		} finally {
			await session.stop();
		}
	});

	test("eval accesses object properties", async () => {
		const session = await launchAndPauseAtDebugger("test-eval-obj-prop");
		try {
			const result = await session.eval("obj.name");
			expect(result.ref).toMatch(/^@v/);
			expect(result.type).toBe("string");
			expect(result.value).toContain("test");
		} finally {
			await session.stop();
		}
	});

	test("eval with string concatenation", async () => {
		const session = await launchAndPauseAtDebugger("test-eval-concat");
		try {
			const result = await session.eval("str + ' world'");
			expect(result.type).toBe("string");
			expect(result.value).toContain("hello world");
		} finally {
			await session.stop();
		}
	});

	test("eval returns object with objectId", async () => {
		const session = await launchAndPauseAtDebugger("test-eval-object");
		try {
			const result = await session.eval("obj");
			expect(result.ref).toMatch(/^@v/);
			expect(result.type).toBe("object");
			expect(result.objectId).toBeDefined();
			expect(result.value).toContain("name");
		} finally {
			await session.stop();
		}
	});

	test("eval syntax error throws", async () => {
		const session = await launchAndPauseAtDebugger("test-eval-syntax-err");
		try {
			await expect(session.eval("if (")).rejects.toThrow();
		} finally {
			await session.stop();
		}
	});

	test("eval throws when not paused", async () => {
		const session = new DebugSession("test-eval-not-paused");
		try {
			await session.launch(["node", "-e", "setInterval(() => {}, 100)"], { brk: false });
			expect(session.sessionState).toBe("running");

			await expect(session.eval("1 + 1")).rejects.toThrow("not paused");
		} finally {
			await session.stop();
		}
	});

	test("eval with @ref interpolation", async () => {
		const session = await launchAndPauseAtDebugger("test-eval-ref-interp");
		try {
			// First get vars to establish refs
			const vars = await session.getVars();
			const objVar = vars.find((v) => v.name === "obj");
			expect(objVar).toBeDefined();

			if (objVar) {
				// Use the ref in an expression
				const result = await session.eval(`${objVar.ref}.count`);
				expect(result.type).toBe("number");
				expect(result.value).toBe("42");
			}
		} finally {
			await session.stop();
		}
	});
});

describe("Inspection: vars", () => {
	test("getVars returns local variables with refs", async () => {
		const session = await launchAndPauseAtDebugger("test-vars-basic");
		try {
			const vars = await session.getVars();

			expect(vars.length).toBeGreaterThan(0);

			// Check that expected variables are present
			const names = vars.map((v) => v.name);
			expect(names).toContain("obj");
			expect(names).toContain("arr");
			expect(names).toContain("str");
			expect(names).toContain("num");

			// Each variable should have a ref
			for (const v of vars) {
				expect(v.ref).toMatch(/^@v/);
				expect(v.type).toBeDefined();
				expect(v.value).toBeDefined();
			}

			// Check specific values
			const numVar = vars.find((v) => v.name === "num");
			expect(numVar?.type).toBe("number");
			expect(numVar?.value).toBe("123");

			const strVar = vars.find((v) => v.name === "str");
			expect(strVar?.type).toBe("string");
			expect(strVar?.value).toContain("hello");
		} finally {
			await session.stop();
		}
	});

	test("getVars with name filter", async () => {
		const session = await launchAndPauseAtDebugger("test-vars-filter");
		try {
			const vars = await session.getVars({ names: ["num", "str"] });

			expect(vars.length).toBe(2);
			const names = vars.map((v) => v.name);
			expect(names).toContain("num");
			expect(names).toContain("str");
		} finally {
			await session.stop();
		}
	});

	test("getVars throws when not paused", async () => {
		const session = new DebugSession("test-vars-not-paused");
		try {
			await session.launch(["node", "-e", "setInterval(() => {}, 100)"], { brk: false });
			expect(session.sessionState).toBe("running");

			await expect(session.getVars()).rejects.toThrow("not paused");
		} finally {
			await session.stop();
		}
	});
});

describe("Inspection: props", () => {
	test("getProps expands an object", async () => {
		const session = await launchAndPauseAtDebugger("test-props-basic");
		try {
			// First get vars to get a ref for obj
			const vars = await session.getVars();
			const objVar = vars.find((v) => v.name === "obj");
			expect(objVar).toBeDefined();

			if (objVar) {
				const props = await session.getProps(objVar.ref);

				expect(props.length).toBeGreaterThan(0);

				const propNames = props.map((p) => p.name);
				expect(propNames).toContain("name");
				expect(propNames).toContain("count");
				expect(propNames).toContain("nested");

				// Check property values
				const nameProp = props.find((p) => p.name === "name");
				expect(nameProp?.type).toBe("string");
				expect(nameProp?.value).toContain("test");

				const countProp = props.find((p) => p.name === "count");
				expect(countProp?.type).toBe("number");
				expect(countProp?.value).toBe("42");

				// nested should be an object with a ref
				const nestedProp = props.find((p) => p.name === "nested");
				expect(nestedProp?.type).toBe("object");
				expect(nestedProp?.ref).toMatch(/^@o/);
			}
		} finally {
			await session.stop();
		}
	});

	test("getProps assigns @o refs for object-type properties", async () => {
		const session = await launchAndPauseAtDebugger("test-props-orefs");
		try {
			const vars = await session.getVars();
			const objVar = vars.find((v) => v.name === "obj");
			expect(objVar).toBeDefined();

			if (objVar) {
				const props = await session.getProps(objVar.ref);

				// nested is an object, should have @o ref
				const nestedProp = props.find((p) => p.name === "nested");
				expect(nestedProp?.ref).toMatch(/^@o/);

				// Primitive properties may or may not have refs depending on V8
				// but object-type ones definitely should
				if (nestedProp?.ref) {
					// Can expand the nested object further
					const nestedProps = await session.getProps(nestedProp.ref);
					const deepProp = nestedProps.find((p) => p.name === "deep");
					expect(deepProp).toBeDefined();
					expect(deepProp?.value).toBe("true");
				}
			}
		} finally {
			await session.stop();
		}
	});

	test("getProps expands an array", async () => {
		const session = await launchAndPauseAtDebugger("test-props-array");
		try {
			const vars = await session.getVars();
			const arrVar = vars.find((v) => v.name === "arr");
			expect(arrVar).toBeDefined();

			if (arrVar) {
				const props = await session.getProps(arrVar.ref);
				expect(props.length).toBeGreaterThan(0);

				// Array should have numeric indices
				const zeroProp = props.find((p) => p.name === "0");
				expect(zeroProp?.value).toBe("1");
			}
		} finally {
			await session.stop();
		}
	});

	test("getProps on unknown ref throws", async () => {
		const session = await launchAndPauseAtDebugger("test-props-unknown");
		try {
			await expect(session.getProps("@v999")).rejects.toThrow("Unknown ref");
		} finally {
			await session.stop();
		}
	});

	test("getProps on primitive ref throws gracefully", async () => {
		const session = await launchAndPauseAtDebugger("test-props-primitive");
		try {
			const vars = await session.getVars();
			const numVar = vars.find((v) => v.name === "num");
			expect(numVar).toBeDefined();

			if (numVar) {
				await expect(session.getProps(numVar.ref)).rejects.toThrow("primitive");
			}
		} finally {
			await session.stop();
		}
	});
});
