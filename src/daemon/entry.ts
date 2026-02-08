import type { DaemonRequest, DaemonResponse } from "../protocol/messages.ts";
import { DaemonServer } from "./server.ts";
import { DebugSession } from "./session.ts";

// Session name follows --daemon in argv
const daemonIdx = process.argv.indexOf("--daemon");
const session = daemonIdx !== -1 ? process.argv[daemonIdx + 1] : process.argv[2];
if (!session) {
	console.error("Usage: ndbg --daemon <session> [--timeout <seconds>]");
	process.exit(1);
}

let timeout = 300; // default 5 minutes
const timeoutIdx = process.argv.indexOf("--timeout");
if (timeoutIdx !== -1) {
	const val = process.argv[timeoutIdx + 1];
	if (val) {
		timeout = parseInt(val, 10);
		if (Number.isNaN(timeout) || timeout < 0) {
			timeout = 300;
		}
	}
}

const server = new DaemonServer(session, { idleTimeout: timeout });
const debugSession = new DebugSession(session);

server.onRequest(async (req: DaemonRequest): Promise<DaemonResponse> => {
	switch (req.cmd) {
		case "ping":
			return { ok: true, data: "pong" };

		case "launch": {
			const command = req.args.command as string[];
			const brk = (req.args.brk as boolean | undefined) ?? true;
			const port = req.args.port as number | undefined;
			const result = await debugSession.launch(command, { brk, port });
			return { ok: true, data: result };
		}

		case "attach": {
			const target = req.args.target as string;
			const result = await debugSession.attach(target);
			return { ok: true, data: result };
		}

		case "status":
			return { ok: true, data: debugSession.getStatus() };

		case "state": {
			const stateOptions = {
				vars: req.args.vars as boolean | undefined,
				stack: req.args.stack as boolean | undefined,
				breakpoints: req.args.breakpoints as boolean | undefined,
				code: req.args.code as boolean | undefined,
				compact: req.args.compact as boolean | undefined,
				depth: req.args.depth as number | undefined,
				lines: req.args.lines as number | undefined,
				frame: req.args.frame as string | undefined,
				allScopes: req.args.allScopes as boolean | undefined,
				generated: req.args.generated as boolean | undefined,
			};
			const stateResult = await debugSession.buildState(stateOptions);
			return { ok: true, data: stateResult };
		}

		case "continue": {
			await debugSession.continue();
			return { ok: true, data: debugSession.getStatus() };
		}

		case "step": {
			const mode = (req.args.mode as "over" | "into" | "out") ?? "over";
			await debugSession.step(mode);
			return { ok: true, data: debugSession.getStatus() };
		}

		case "pause": {
			await debugSession.pause();
			return { ok: true, data: debugSession.getStatus() };
		}

		case "run-to": {
			const file = req.args.file as string;
			const line = req.args.line as number;
			await debugSession.runTo(file, line);
			return { ok: true, data: debugSession.getStatus() };
		}

		case "break": {
			const file = req.args.file as string;
			const line = req.args.line as number;
			const condition = req.args.condition as string | undefined;
			const hitCount = req.args.hitCount as number | undefined;
			const urlRegex = req.args.urlRegex as string | undefined;
			const bpResult = await debugSession.setBreakpoint(file, line, { condition, hitCount, urlRegex });
			return { ok: true, data: bpResult };
		}

		case "break-rm": {
			const ref = req.args.ref as string;
			if (ref === "all") {
				await debugSession.removeAllBreakpoints();
				return { ok: true, data: "all removed" };
			}
			await debugSession.removeBreakpoint(ref);
			return { ok: true, data: "removed" };
		}

		case "break-ls":
			return { ok: true, data: debugSession.listBreakpoints() };

		case "logpoint": {
			const lpFile = req.args.file as string;
			const lpLine = req.args.line as number;
			const template = req.args.template as string;
			const lpCondition = req.args.condition as string | undefined;
			const maxEmissions = req.args.maxEmissions as number | undefined;
			const lpResult = await debugSession.setLogpoint(lpFile, lpLine, template, {
				condition: lpCondition,
				maxEmissions,
			});
			return { ok: true, data: lpResult };
		}

		case "catch": {
			const mode = req.args.mode as "all" | "uncaught" | "caught" | "none";
			await debugSession.setExceptionPause(mode);
			return { ok: true, data: mode };
		}

		case "source": {
			const sourceOptions = {
				file: req.args.file as string | undefined,
				lines: req.args.lines as number | undefined,
				all: req.args.all as boolean | undefined,
				generated: req.args.generated as boolean | undefined,
			};
			const sourceResult = await debugSession.getSource(sourceOptions);
			return { ok: true, data: sourceResult };
		}

		case "scripts": {
			const filter = req.args.filter as string | undefined;
			const scriptsResult = debugSession.getScripts(filter);
			return { ok: true, data: scriptsResult };
		}

		case "stack": {
			const stackOptions = {
				asyncDepth: req.args.asyncDepth as number | undefined,
				generated: req.args.generated as boolean | undefined,
			};
			const stackResult = debugSession.getStack(stackOptions);
			return { ok: true, data: stackResult };
		}

		case "search": {
			const query = req.args.query as string;
			const searchOptions = {
				scriptId: req.args.scriptId as string | undefined,
				isRegex: req.args.isRegex as boolean | undefined,
				caseSensitive: req.args.caseSensitive as boolean | undefined,
			};
			const searchResult = await debugSession.searchInScripts(query, searchOptions);
			return { ok: true, data: searchResult };
		}

		case "console": {
			const consoleOptions = {
				level: req.args.level as string | undefined,
				since: req.args.since as number | undefined,
				clear: req.args.clear as boolean | undefined,
			};
			const consoleResult = debugSession.getConsoleMessages(consoleOptions);
			return { ok: true, data: consoleResult };
		}

		case "exceptions": {
			const exceptionsOptions = {
				since: req.args.since as number | undefined,
			};
			const exceptionsResult = debugSession.getExceptions(exceptionsOptions);
			return { ok: true, data: exceptionsResult };
		}

		case "eval": {
			const expression = req.args.expression as string;
			const evalOptions = {
				frame: req.args.frame as string | undefined,
				awaitPromise: req.args.awaitPromise as boolean | undefined,
				throwOnSideEffect: req.args.throwOnSideEffect as boolean | undefined,
				timeout: req.args.timeout as number | undefined,
			};
			const evalResult = await debugSession.eval(expression, evalOptions);
			return { ok: true, data: evalResult };
		}

		case "vars": {
			const varsOptions = {
				frame: req.args.frame as string | undefined,
				names: req.args.names as string[] | undefined,
				allScopes: req.args.allScopes as boolean | undefined,
			};
			const varsResult = await debugSession.getVars(varsOptions);
			return { ok: true, data: varsResult };
		}

		case "props": {
			const propsRef = req.args.ref as string;
			const propsOptions = {
				own: req.args.own as boolean | undefined,
				internal: req.args.internal as boolean | undefined,
				depth: req.args.depth as number | undefined,
			};
			const propsResult = await debugSession.getProps(propsRef, propsOptions);
			return { ok: true, data: propsResult };
		}

		case "blackbox": {
			const patterns = req.args.patterns as string[];
			const result = await debugSession.addBlackbox(patterns);
			return { ok: true, data: result };
		}

		case "blackbox-ls": {
			return { ok: true, data: debugSession.listBlackbox() };
		}

		case "blackbox-rm": {
			const patterns = req.args.patterns as string[];
			const result = await debugSession.removeBlackbox(patterns);
			return { ok: true, data: result };
		}

		case "set": {
			const name = req.args.name as string;
			const value = req.args.value as string;
			const frame = req.args.frame as string | undefined;
			const result = await debugSession.setVariable(name, value, { frame });
			return { ok: true, data: result };
		}

		case "set-return": {
			const value = req.args.value as string;
			const result = await debugSession.setReturnValue(value);
			return { ok: true, data: result };
		}

		case "hotpatch": {
			const file = req.args.file as string;
			const source = req.args.source as string;
			const dryRun = req.args.dryRun as boolean | undefined;
			const result = await debugSession.hotpatch(file, source, { dryRun });
			return { ok: true, data: result };
		}

		case "break-toggle": {
			const toggleRef = req.args.ref as string;
			const toggleResult = await debugSession.toggleBreakpoint(toggleRef);
			return { ok: true, data: toggleResult };
		}

		case "breakable": {
			const breakableFile = req.args.file as string;
			const startLine = req.args.startLine as number;
			const endLine = req.args.endLine as number;
			const breakableResult = await debugSession.getBreakableLocations(breakableFile, startLine, endLine);
			return { ok: true, data: breakableResult };
		}

		case "restart-frame": {
			const frameRef = req.args.frameRef as string | undefined;
			const restartResult = await debugSession.restartFrame(frameRef);
			return { ok: true, data: restartResult };
		}

		case "sourcemap": {
			const smFile = req.args.file as string | undefined;
			if (smFile) {
				const match = debugSession.sourceMapResolver.findScriptForSource(smFile);
				if (match) {
					const info = debugSession.sourceMapResolver.getInfo(match.scriptId);
					return { ok: true, data: info ? [info] : [] };
				}
				return { ok: true, data: [] };
			}
			return { ok: true, data: debugSession.sourceMapResolver.getAllInfos() };
		}

		case "sourcemap-disable": {
			debugSession.sourceMapResolver.setDisabled(true);
			return { ok: true, data: "disabled" };
		}

		case "stop":
			await debugSession.stop();
			setTimeout(() => {
				server.stop();
				process.exit(0);
			}, 50);
			return { ok: true, data: "stopped" };

		default:
			return {
				ok: false,
				error: `Unknown command: ${req.cmd}`,
				suggestion: "-> Try: ndbg --help",
			};
	}
});

await server.start();
