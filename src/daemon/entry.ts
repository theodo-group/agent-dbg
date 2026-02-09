import type { DaemonRequest, DaemonResponse } from "../protocol/messages.ts";
import { DaemonServer } from "./server.ts";
import { DebugSession } from "./session.ts";

// Session name follows --daemon in argv
const daemonIdx = process.argv.indexOf("--daemon");
const session = daemonIdx !== -1 ? process.argv[daemonIdx + 1] : process.argv[2];
if (!session) {
	console.error("Usage: agent-dbg --daemon <session> [--timeout <seconds>]");
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
			const { command, brk = true, port } = req.args;
			const result = await debugSession.launch(command, { brk, port });
			return { ok: true, data: result };
		}

		case "attach": {
			const { target } = req.args;
			const result = await debugSession.attach(target);
			return { ok: true, data: result };
		}

		case "status":
			return { ok: true, data: debugSession.getStatus() };

		case "state": {
			const stateResult = await debugSession.buildState(req.args);
			return { ok: true, data: stateResult };
		}

		case "continue": {
			await debugSession.continue();
			return { ok: true, data: debugSession.getStatus() };
		}

		case "step": {
			const { mode = "over" } = req.args;
			await debugSession.step(mode);
			return { ok: true, data: debugSession.getStatus() };
		}

		case "pause": {
			await debugSession.pause();
			return { ok: true, data: debugSession.getStatus() };
		}

		case "run-to": {
			const { file, line } = req.args;
			await debugSession.runTo(file, line);
			return { ok: true, data: debugSession.getStatus() };
		}

		case "break": {
			const { file, line, condition, hitCount, urlRegex } = req.args;
			const bpResult = await debugSession.setBreakpoint(file, line, {
				condition,
				hitCount,
				urlRegex,
			});
			return { ok: true, data: bpResult };
		}

		case "break-rm": {
			const { ref } = req.args;
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
			const { file, line, template, condition, maxEmissions } = req.args;
			const lpResult = await debugSession.setLogpoint(file, line, template, {
				condition,
				maxEmissions,
			});
			return { ok: true, data: lpResult };
		}

		case "catch": {
			const { mode } = req.args;
			await debugSession.setExceptionPause(mode);
			return { ok: true, data: mode };
		}

		case "source": {
			const sourceResult = await debugSession.getSource(req.args);
			return { ok: true, data: sourceResult };
		}

		case "scripts": {
			const { filter } = req.args;
			const scriptsResult = debugSession.getScripts(filter);
			return { ok: true, data: scriptsResult };
		}

		case "stack": {
			const stackResult = debugSession.getStack(req.args);
			return { ok: true, data: stackResult };
		}

		case "search": {
			const { query, ...searchOptions } = req.args;
			const searchResult = await debugSession.searchInScripts(query, searchOptions);
			return { ok: true, data: searchResult };
		}

		case "console": {
			const consoleResult = debugSession.getConsoleMessages(req.args);
			return { ok: true, data: consoleResult };
		}

		case "exceptions": {
			const exceptionsResult = debugSession.getExceptions(req.args);
			return { ok: true, data: exceptionsResult };
		}

		case "eval": {
			const { expression, ...evalOptions } = req.args;
			const evalResult = await debugSession.eval(expression, evalOptions);
			return { ok: true, data: evalResult };
		}

		case "vars": {
			const varsResult = await debugSession.getVars(req.args);
			return { ok: true, data: varsResult };
		}

		case "props": {
			const { ref, ...propsOptions } = req.args;
			const propsResult = await debugSession.getProps(ref, propsOptions);
			return { ok: true, data: propsResult };
		}

		case "blackbox": {
			const { patterns } = req.args;
			const result = await debugSession.addBlackbox(patterns);
			return { ok: true, data: result };
		}

		case "blackbox-ls": {
			return { ok: true, data: debugSession.listBlackbox() };
		}

		case "blackbox-rm": {
			const { patterns } = req.args;
			const result = await debugSession.removeBlackbox(patterns);
			return { ok: true, data: result };
		}

		case "set": {
			const { name, value, frame } = req.args;
			const result = await debugSession.setVariable(name, value, { frame });
			return { ok: true, data: result };
		}

		case "set-return": {
			const { value } = req.args;
			const result = await debugSession.setReturnValue(value);
			return { ok: true, data: result };
		}

		case "hotpatch": {
			const { file, source, dryRun } = req.args;
			const result = await debugSession.hotpatch(file, source, { dryRun });
			return { ok: true, data: result };
		}

		case "break-toggle": {
			const { ref } = req.args;
			const toggleResult = await debugSession.toggleBreakpoint(ref);
			return { ok: true, data: toggleResult };
		}

		case "breakable": {
			const { file, startLine, endLine } = req.args;
			const breakableResult = await debugSession.getBreakableLocations(file, startLine, endLine);
			return { ok: true, data: breakableResult };
		}

		case "restart-frame": {
			const { frameRef } = req.args;
			const restartResult = await debugSession.restartFrame(frameRef);
			return { ok: true, data: restartResult };
		}

		case "sourcemap": {
			const { file: smFile } = req.args;
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
	}
});

await server.start();
