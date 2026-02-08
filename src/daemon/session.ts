import type { Subprocess } from "bun";
import { CdpClient } from "../cdp/client.ts";
import { formatValue } from "../formatter/values.ts";
import type { RemoteObject } from "../formatter/values.ts";
import { RefTable } from "../refs/ref-table.ts";
import { SourceMapResolver } from "../sourcemap/resolver.ts";

export interface PauseInfo {
	reason: string;
	scriptId?: string;
	url?: string;
	line?: number;
	column?: number;
	callFrameCount?: number;
}

export interface StateOptions {
	vars?: boolean;
	stack?: boolean;
	breakpoints?: boolean;
	code?: boolean;
	compact?: boolean;
	depth?: number;
	lines?: number;
	frame?: string; // @fN ref
	allScopes?: boolean;
	generated?: boolean;
}

export interface StateSnapshot {
	status: string; // "paused" | "running" | "idle"
	reason?: string;
	location?: { url: string; line: number; column?: number };
	source?: { lines: Array<{ line: number; text: string; current?: boolean }> };
	locals?: Array<{ ref: string; name: string; value: string }>;
	stack?: Array<{ ref: string; functionName: string; file: string; line: number; column?: number; isAsync?: boolean }>;
	breakpointCount?: number;
}

export interface ConsoleMessage {
	timestamp: number;
	level: string; // "log" | "warn" | "error" | "info" | "debug" | "trace"
	text: string;
	args?: string[]; // formatted args
	url?: string;
	line?: number;
}

export interface ExceptionEntry {
	timestamp: number;
	text: string;
	description?: string;
	url?: string;
	line?: number;
	column?: number;
	stackTrace?: string;
}

export interface ScriptInfo {
	scriptId: string;
	url: string;
	sourceMapURL?: string;
}

export interface LaunchResult {
	pid: number;
	wsUrl: string;
	paused: boolean;
	pauseInfo?: PauseInfo;
}

export interface AttachResult {
	wsUrl: string;
}

export interface SessionStatus {
	session: string;
	state: "idle" | "running" | "paused";
	pid?: number;
	wsUrl?: string;
	pauseInfo?: PauseInfo;
	uptime: number;
	scriptCount: number;
}

const INSPECTOR_URL_REGEX = /Debugger listening on (wss?:\/\/\S+)/;
const INSPECTOR_TIMEOUT_MS = 5_000;

export class DebugSession {
	cdp: CdpClient | null = null;
	refs: RefTable = new RefTable();
	sourceMapResolver: SourceMapResolver = new SourceMapResolver();
	private childProcess: Subprocess<"ignore", "pipe", "pipe"> | null = null;
	private state: "idle" | "running" | "paused" = "idle";
	private pauseInfo: PauseInfo | null = null;
	private pausedCallFrames: unknown[] = [];
	private scripts: Map<string, ScriptInfo> = new Map();
	private wsUrl: string | null = null;
	private startTime: number = Date.now();
	private session: string;
	private onProcessExit: (() => void) | null = null;
	private consoleMessages: Array<ConsoleMessage> = [];
	private exceptionEntries: Array<ExceptionEntry> = [];
	private blackboxPatterns: string[] = [];
	private disabledBreakpoints: Map<string, { breakpointId: string; meta: Record<string, unknown> }> = new Map();

	constructor(session: string) {
		this.session = session;
	}

	async launch(
		command: string[],
		options: { brk?: boolean; port?: number } = {},
	): Promise<LaunchResult> {
		if (this.state !== "idle") {
			throw new Error("Session already has an active debug target");
		}

		if (command.length === 0) {
			throw new Error("Command array must not be empty");
		}

		const brk = options.brk ?? true;
		const port = options.port ?? 0;
		const inspectFlag = brk ? `--inspect-brk=${port}` : `--inspect=${port}`;

		// Build the args: inject inspect flag after the runtime (first element)
		const runtime = command[0] as string;
		const rest = command.slice(1);
		const spawnArgs = [runtime, inspectFlag, ...rest];

		const proc = Bun.spawn(spawnArgs, {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		});
		this.childProcess = proc;

		// Monitor child process exit in the background
		this.monitorProcessExit(proc);

		// Read stderr to find the inspector URL
		const wsUrl = await this.readInspectorUrl(proc.stderr);
		this.wsUrl = wsUrl;

		// Connect CDP
		await this.connectCdp(wsUrl);

		// If brk mode, ensure the session enters "paused" state.
		// On older Node.js versions, Debugger.paused fires automatically after
		// Debugger.enable. On newer versions (v24+), the initial --inspect-brk
		// pause does not emit the event, so we request an explicit pause and then
		// signal Runtime.runIfWaitingForDebugger so the process starts execution
		// and immediately hits our pause request.
		if (brk) {
			await this.waitForBrkPause();
		}

		const result: LaunchResult = {
			pid: proc.pid,
			wsUrl,
			paused: this.sessionState === "paused",
		};

		if (this.pauseInfo) {
			result.pauseInfo = this.pauseInfo;
		}

		return result;
	}

	async attach(target: string): Promise<AttachResult> {
		if (this.state !== "idle" && !this.cdp) {
			throw new Error("Session already has an active debug target");
		}

		let wsUrl: string;

		if (target.startsWith("ws://") || target.startsWith("wss://")) {
			wsUrl = target;
		} else {
			// Treat as a port number
			const port = parseInt(target, 10);
			if (Number.isNaN(port) || port <= 0 || port > 65535) {
				throw new Error(
					`Invalid attach target: "${target}". Provide a ws:// URL or a port number.`,
				);
			}
			wsUrl = await this.discoverWsUrl(port);
		}

		this.wsUrl = wsUrl;
		await this.connectCdp(wsUrl);

		return { wsUrl };
	}

	getStatus(): SessionStatus {
		const status: SessionStatus = {
			session: this.session,
			state: this.state,
			uptime: Math.floor((Date.now() - this.startTime) / 1000),
			scriptCount: this.scripts.size,
		};

		if (this.childProcess) {
			status.pid = this.childProcess.pid;
		}

		if (this.wsUrl) {
			status.wsUrl = this.wsUrl;
		}

		if (this.pauseInfo) {
			// Source-map translate pauseInfo for display
			const translated = { ...this.pauseInfo };
			if (translated.scriptId && translated.line !== undefined) {
				const resolved = this.resolveOriginalLocation(
					translated.scriptId,
					translated.line + 1, // pauseInfo.line is 0-based
					translated.column ?? 0,
				);
				if (resolved) {
					translated.url = resolved.url;
					translated.line = resolved.line - 1; // back to 0-based for pauseInfo
					if (resolved.column !== undefined) {
						translated.column = resolved.column - 1;
					}
				}
			}
			status.pauseInfo = translated;
		}

		return status;
	}

	async buildState(options: StateOptions = {}): Promise<StateSnapshot> {
		if (this.state !== "paused" || !this.cdp || !this.pauseInfo) {
			return { status: this.state };
		}

		// Clear volatile refs at the START of building state
		this.refs.clearVolatile();

		const showAll = !options.vars && !options.stack && !options.breakpoints && !options.code;
		const linesContext = options.lines ?? 3;
		const snapshot: StateSnapshot = {
			status: "paused",
			reason: this.pauseInfo.reason,
		};

		// Determine which frame to inspect
		let frameIndex = 0;
		if (options.frame) {
			const entry = this.refs.resolve(options.frame);
			if (entry?.meta?.["frameIndex"] !== undefined) {
				frameIndex = entry.meta["frameIndex"] as number;
			}
		}

		const callFrames = this.pausedCallFrames;
		const targetFrame = callFrames[frameIndex] as Record<string, unknown> | undefined;

		if (!targetFrame) {
			return snapshot;
		}

		const frameLocation = targetFrame.location as Record<string, unknown> | undefined;
		const frameScriptId = frameLocation?.scriptId as string | undefined;
		const frameLine = (frameLocation?.lineNumber as number | undefined) ?? 0;
		const frameColumn = frameLocation?.columnNumber as number | undefined;
		let frameUrl = frameScriptId ? this.scripts.get(frameScriptId)?.url ?? "" : "";
		let displayLine = frameLine + 1; // CDP is 0-based, display 1-based
		let displayColumn = frameColumn !== undefined ? frameColumn + 1 : undefined;

		// Try source map translation for pause location (unless --generated)
		if (frameScriptId && !options.generated) {
			const resolved = this.resolveOriginalLocation(frameScriptId, frameLine + 1, frameColumn ?? 0);
			if (resolved) {
				frameUrl = resolved.url;
				displayLine = resolved.line;
				displayColumn = resolved.column;
			}
		}

		snapshot.location = {
			url: frameUrl,
			line: displayLine,
		};
		if (displayColumn !== undefined) {
			snapshot.location.column = displayColumn;
		}

		// Source code
		if (showAll || options.code) {
			try {
				if (frameScriptId) {
					let scriptSource: string | null = null;
					let useOriginalLines = false;

					if (!options.generated) {
						// Try to get original source from source map
						const smOriginal = this.sourceMapResolver.toOriginal(frameScriptId, frameLine + 1, frameColumn ?? 0);
						if (smOriginal) {
							scriptSource = this.sourceMapResolver.getOriginalSource(frameScriptId, smOriginal.source);
							useOriginalLines = scriptSource !== null;
						}
						// Fallback: script has source map but line is unmapped — still show original source
						if (!scriptSource) {
							const primarySource = this.sourceMapResolver.getScriptOriginalUrl(frameScriptId);
							if (primarySource) {
								scriptSource = this.sourceMapResolver.getOriginalSource(frameScriptId, primarySource);
								useOriginalLines = scriptSource !== null;
							}
						}
					}

					if (!scriptSource) {
						const sourceResult = await this.cdp.send("Debugger.getScriptSource", {
							scriptId: frameScriptId,
						});
						scriptSource = (sourceResult as Record<string, unknown>).scriptSource as string;
					}

					const sourceLines = scriptSource.split("\n");
					// Use original line for windowing if we have source-mapped content
					const currentLine0 = useOriginalLines ? displayLine - 1 : frameLine;
					const startLine = Math.max(0, currentLine0 - linesContext);
					const endLine = Math.min(sourceLines.length - 1, currentLine0 + linesContext);

					const lines: Array<{ line: number; text: string; current?: boolean }> = [];
					for (let i = startLine; i <= endLine; i++) {
						const entry: { line: number; text: string; current?: boolean } = {
							line: i + 1, // 1-based
							text: sourceLines[i] ?? "",
						};
						if (i === currentLine0) {
							entry.current = true;
						}
						lines.push(entry);
					}
					snapshot.source = { lines };
				}
			} catch {
				// Source not available
			}
		}

		// Stack frames
		if (showAll || options.stack) {
			const stackFrames: Array<{ ref: string; functionName: string; file: string; line: number; column?: number; isAsync?: boolean }> = [];

			for (let i = 0; i < callFrames.length; i++) {
				const frame = callFrames[i] as Record<string, unknown>;
				const callFrameId = frame.callFrameId as string;
				const funcName = (frame.functionName as string) || "(anonymous)";
				const loc = frame.location as Record<string, unknown>;
				const sid = loc.scriptId as string;
				const lineNum = (loc.lineNumber as number) + 1; // 1-based
				const colNum = loc.columnNumber as number | undefined;
				let url = this.scripts.get(sid)?.url ?? "";
				let stackLine = lineNum;
				let stackCol = colNum !== undefined ? colNum + 1 : undefined;
				let resolvedName: string | null = null;

				if (!options.generated) {
					const resolved = this.resolveOriginalLocation(sid, lineNum, colNum ?? 0);
					if (resolved) {
						url = resolved.url;
						stackLine = resolved.line;
						stackCol = resolved.column;
					}
					// Get original function name from exact mapping
					const smOriginal = this.sourceMapResolver.toOriginal(sid, lineNum, colNum ?? 0);
					resolvedName = smOriginal?.name ?? null;
				}

				const ref = this.refs.addFrame(callFrameId, funcName, { frameIndex: i });

				const stackEntry: { ref: string; functionName: string; file: string; line: number; column?: number; isAsync?: boolean } = {
					ref,
					functionName: resolvedName ?? funcName,
					file: url,
					line: stackLine,
				};
				if (stackCol !== undefined) {
					stackEntry.column = stackCol;
				}

				stackFrames.push(stackEntry);
			}

			snapshot.stack = stackFrames;
		}

		// Local variables
		if (showAll || options.vars) {
			try {
				const scopeChain = targetFrame.scopeChain as Array<Record<string, unknown>> | undefined;
				if (scopeChain) {
					const locals: Array<{ ref: string; name: string; value: string }> = [];

					for (const scope of scopeChain) {
						const scopeType = scope.type as string;

						// By default only show "local" scope; with --all-scopes include "closure" too
						if (scopeType === "local" || (options.allScopes && scopeType === "closure")) {
							const scopeObj = scope.object as Record<string, unknown>;
							const objectId = scopeObj.objectId as string;

							const propsResult = await this.cdp.send("Runtime.getProperties", {
								objectId,
								ownProperties: true,
								generatePreview: true,
							});

							const properties = (propsResult as Record<string, unknown>).result as Array<Record<string, unknown>>;

							for (const prop of properties) {
								const propName = prop.name as string;
								const propValue = prop.value as RemoteObject | undefined;

								if (!propValue) continue;

								// Skip internal properties
								if (propName.startsWith("__")) continue;

								const remoteId = propValue.objectId ?? `primitive:${propName}`;
								const ref = this.refs.addVar(
									remoteId as string,
									propName,
								);

								locals.push({
									ref,
									name: propName,
									value: formatValue(propValue),
								});
							}
						}

						// Skip "global" scope unless explicitly requested
						if (scopeType === "global") continue;
					}

					snapshot.locals = locals;
				}
			} catch {
				// Variables not available
			}
		}

		// Breakpoint count
		if (showAll || options.breakpoints) {
			const bpEntries = this.refs.list("BP");
			snapshot.breakpointCount = bpEntries.length;
		}

		return snapshot;
	}

	async setBreakpoint(
		file: string,
		line: number,
		options?: { condition?: string; hitCount?: number; urlRegex?: string },
	): Promise<{ ref: string; location: { url: string; line: number; column?: number } }> {
		if (!this.cdp) {
			throw new Error("No active debug session");
		}

		const condition = this.buildBreakpointCondition(options?.condition, options?.hitCount);

		// Try source map translation (.ts → .js) before setting breakpoint
		let originalFile: string | null = null;
		let originalLine: number | null = null;
		let actualLine = line;
		let actualFile = file;

		if (!options?.urlRegex) {
			const generated = this.sourceMapResolver.toGenerated(file, line, 0);
			if (generated) {
				originalFile = file;
				originalLine = line;
				actualLine = generated.line;
				// Find the URL of the generated script
				const scriptInfo = this.scripts.get(generated.scriptId);
				if (scriptInfo) {
					actualFile = scriptInfo.url;
				}
			}
		}

		const params: Record<string, unknown> = {
			lineNumber: actualLine - 1, // CDP uses 0-based lines
		};

		let url: string | null = null;
		if (options?.urlRegex) {
			// Use urlRegex directly without resolving file path
			params.urlRegex = options.urlRegex;
		} else {
			url = this.findScriptUrl(actualFile);
			if (url) {
				params.url = url;
			} else {
				// Fall back to urlRegex to match partial paths
				params.urlRegex = actualFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$";
			}
		}
		if (condition) {
			params.condition = condition;
		}

		const result = await this.cdp.send("Debugger.setBreakpointByUrl", params);
		const r = result as {
			breakpointId: string;
			locations: Array<{ lineNumber: number; columnNumber: number; scriptId: string }>;
		};

		const loc = r.locations[0];
		const resolvedUrl = originalFile ?? url ?? file;
		const resolvedLine = originalLine ?? (loc ? loc.lineNumber + 1 : line); // Convert back to 1-based
		const resolvedColumn = loc?.columnNumber;

		const meta: Record<string, unknown> = {
			url: resolvedUrl,
			line: resolvedLine,
		};
		if (originalFile) {
			meta.originalUrl = originalFile;
			meta.originalLine = originalLine;
			meta.generatedUrl = url ?? actualFile;
			meta.generatedLine = loc ? loc.lineNumber + 1 : actualLine;
		}
		if (resolvedColumn !== undefined) {
			meta.column = resolvedColumn;
		}
		if (options?.condition) {
			meta.condition = options.condition;
		}
		if (options?.hitCount) {
			meta.hitCount = options.hitCount;
		}
		if (options?.urlRegex) {
			meta.urlRegex = options.urlRegex;
		}

		const ref = this.refs.addBreakpoint(r.breakpointId, meta);

		const location: { url: string; line: number; column?: number } = {
			url: resolvedUrl,
			line: resolvedLine,
		};
		if (resolvedColumn !== undefined) {
			location.column = resolvedColumn;
		}

		return { ref, location };
	}

	async removeBreakpoint(ref: string): Promise<void> {
		if (!this.cdp) {
			throw new Error("No active debug session");
		}

		const entry = this.refs.resolve(ref);
		if (!entry) {
			throw new Error(`Unknown ref: ${ref}`);
		}

		if (entry.type !== "BP" && entry.type !== "LP") {
			throw new Error(`Ref ${ref} is not a breakpoint or logpoint`);
		}

		await this.cdp.send("Debugger.removeBreakpoint", {
			breakpointId: entry.remoteId,
		});

		this.refs.remove(ref);
	}

	async removeAllBreakpoints(): Promise<void> {
		if (!this.cdp) {
			throw new Error("No active debug session");
		}

		const bps = this.refs.list("BP");
		const lps = this.refs.list("LP");
		const all = [...bps, ...lps];

		for (const entry of all) {
			await this.cdp.send("Debugger.removeBreakpoint", {
				breakpointId: entry.remoteId,
			});
			this.refs.remove(entry.ref);
		}
	}

	listBreakpoints(): Array<{
		ref: string;
		type: "BP" | "LP";
		url: string;
		line: number;
		column?: number;
		condition?: string;
		hitCount?: number;
		template?: string;
		disabled?: boolean;
		originalUrl?: string;
		originalLine?: number;
	}> {
		const bps = this.refs.list("BP");
		const lps = this.refs.list("LP");
		const all = [...bps, ...lps];

		const results: Array<{
			ref: string;
			type: "BP" | "LP";
			url: string;
			line: number;
			column?: number;
			condition?: string;
			hitCount?: number;
			template?: string;
			disabled?: boolean;
			originalUrl?: string;
			originalLine?: number;
		}> = all.map((entry) => {
			const meta = entry.meta ?? {};
			const item: {
				ref: string;
				type: "BP" | "LP";
				url: string;
				line: number;
				column?: number;
				condition?: string;
				hitCount?: number;
				template?: string;
				disabled?: boolean;
				originalUrl?: string;
				originalLine?: number;
			} = {
				ref: entry.ref,
				type: entry.type as "BP" | "LP",
				url: meta.url as string,
				line: meta.line as number,
			};

			if (meta.column !== undefined) {
				item.column = meta.column as number;
			}
			if (meta.condition !== undefined) {
				item.condition = meta.condition as string;
			}
			if (meta.hitCount !== undefined) {
				item.hitCount = meta.hitCount as number;
			}
			if (meta.template !== undefined) {
				item.template = meta.template as string;
			}
			if (meta.originalUrl !== undefined) {
				item.originalUrl = meta.originalUrl as string;
				item.originalLine = meta.originalLine as number;
			}

			return item;
		});

		// Include disabled breakpoints
		for (const [ref, entry] of this.disabledBreakpoints) {
			const meta = entry.meta;
			const item: {
				ref: string;
				type: "BP" | "LP";
				url: string;
				line: number;
				column?: number;
				condition?: string;
				hitCount?: number;
				template?: string;
				disabled?: boolean;
			} = {
				ref,
				type: (meta.type as "BP" | "LP") ?? "BP",
				url: meta.url as string,
				line: meta.line as number,
				disabled: true,
			};

			if (meta.column !== undefined) {
				item.column = meta.column as number;
			}
			if (meta.condition !== undefined) {
				item.condition = meta.condition as string;
			}
			if (meta.hitCount !== undefined) {
				item.hitCount = meta.hitCount as number;
			}
			if (meta.template !== undefined) {
				item.template = meta.template as string;
			}

			results.push(item);
		}

		return results;
	}

	async toggleBreakpoint(ref: string): Promise<{ ref: string; state: "enabled" | "disabled" }> {
		if (!this.cdp) {
			throw new Error("No active debug session");
		}

		if (ref === "all") {
			// Toggle all: if any are enabled, disable all; otherwise enable all
			const activeBps = this.refs.list("BP");
			const activeLps = this.refs.list("LP");
			const allActive = [...activeBps, ...activeLps];

			if (allActive.length > 0) {
				// Disable all active breakpoints
				for (const entry of allActive) {
					await this.cdp.send("Debugger.removeBreakpoint", {
						breakpointId: entry.remoteId,
					});
					const meta = { ...(entry.meta ?? {}), type: entry.type };
					this.disabledBreakpoints.set(entry.ref, {
						breakpointId: entry.remoteId,
						meta,
					});
					this.refs.remove(entry.ref);
				}
				return { ref: "all", state: "disabled" };
			}
			// Re-enable all disabled breakpoints
			const disabledRefs = [...this.disabledBreakpoints.keys()];
			for (const dRef of disabledRefs) {
				const entry = this.disabledBreakpoints.get(dRef);
				if (!entry) continue;
				await this.reEnableBreakpoint(dRef, entry);
			}
			return { ref: "all", state: "enabled" };
		}

		// Single breakpoint toggle
		// Check if it's currently active
		const activeEntry = this.refs.resolve(ref);
		if (activeEntry && (activeEntry.type === "BP" || activeEntry.type === "LP")) {
			// Disable it
			await this.cdp.send("Debugger.removeBreakpoint", {
				breakpointId: activeEntry.remoteId,
			});
			const meta = { ...(activeEntry.meta ?? {}), type: activeEntry.type };
			this.disabledBreakpoints.set(ref, {
				breakpointId: activeEntry.remoteId,
				meta,
			});
			this.refs.remove(ref);
			return { ref, state: "disabled" };
		}

		// Check if it's disabled
		const disabledEntry = this.disabledBreakpoints.get(ref);
		if (disabledEntry) {
			await this.reEnableBreakpoint(ref, disabledEntry);
			return { ref, state: "enabled" };
		}

		throw new Error(`Unknown breakpoint ref: ${ref}`);
	}

	async getBreakableLocations(
		file: string,
		startLine: number,
		endLine: number,
	): Promise<Array<{ line: number; column: number }>> {
		if (!this.cdp) {
			throw new Error("No active debug session");
		}

		const scriptUrl = this.findScriptUrl(file);
		if (!scriptUrl) {
			throw new Error(`No loaded script matches "${file}"`);
		}

		// Find the scriptId for this URL
		let scriptId: string | undefined;
		for (const [sid, info] of this.scripts) {
			if (info.url === scriptUrl) {
				scriptId = sid;
				break;
			}
		}

		if (!scriptId) {
			throw new Error(`No scriptId found for "${file}"`);
		}

		const result = await this.cdp.send("Debugger.getPossibleBreakpoints", {
			start: { scriptId, lineNumber: startLine - 1 },
			end: { scriptId, lineNumber: endLine },
		});

		const r = result as {
			locations: Array<{ scriptId: string; lineNumber: number; columnNumber?: number }>;
		};

		return r.locations.map((loc) => ({
			line: loc.lineNumber + 1, // Convert to 1-based
			column: (loc.columnNumber ?? 0) + 1, // Convert to 1-based
		}));
	}

	async restartFrame(frameRef?: string): Promise<{ status: string }> {
		if (!this.isPaused()) {
			throw new Error("Cannot restart frame: process is not paused");
		}
		if (!this.cdp) {
			throw new Error("Cannot restart frame: no CDP connection");
		}

		let callFrameId: string;
		if (frameRef) {
			const entry = this.refs.resolve(frameRef);
			if (!entry) {
				throw new Error(`Unknown frame ref: ${frameRef}`);
			}
			callFrameId = entry.remoteId;
		} else {
			const topFrame = this.pausedCallFrames[0] as Record<string, unknown> | undefined;
			if (!topFrame) {
				throw new Error("No call frames available");
			}
			callFrameId = topFrame.callFrameId as string;
		}

		const waiter = this.createPauseWaiter();
		await this.cdp.send("Debugger.restartFrame", { callFrameId, mode: "StepInto" });
		await waiter;

		return { status: "restarted" };
	}

	private async reEnableBreakpoint(
		ref: string,
		entry: { breakpointId: string; meta: Record<string, unknown> },
	): Promise<void> {
		if (!this.cdp) return;

		const meta = entry.meta;
		const line = meta.line as number;
		const url = meta.url as string | undefined;
		const condition = meta.condition as string | undefined;
		const hitCount = meta.hitCount as number | undefined;
		const urlRegex = meta.urlRegex as string | undefined;

		const builtCondition = this.buildBreakpointCondition(condition, hitCount);

		const params: Record<string, unknown> = {
			lineNumber: line - 1,
		};

		if (urlRegex) {
			params.urlRegex = urlRegex;
		} else if (url) {
			params.url = url;
		}

		if (builtCondition) {
			params.condition = builtCondition;
		}

		const result = await this.cdp.send("Debugger.setBreakpointByUrl", params);
		const r = result as {
			breakpointId: string;
			locations: Array<{ lineNumber: number; columnNumber: number; scriptId: string }>;
		};

		// Re-create the ref entry in the ref table
		const type = (meta.type as string) === "LP" ? "LP" : "BP";
		const newMeta = { ...meta };
		delete newMeta.type; // type is stored in the ref entry, not meta
		if (type === "BP") {
			this.refs.addBreakpoint(r.breakpointId, newMeta);
		} else {
			this.refs.addLogpoint(r.breakpointId, newMeta);
		}

		this.disabledBreakpoints.delete(ref);
	}

	async setLogpoint(
		file: string,
		line: number,
		template: string,
		options?: { condition?: string; maxEmissions?: number },
	): Promise<{ ref: string; location: { url: string; line: number; column?: number } }> {
		if (!this.cdp) {
			throw new Error("No active debug session");
		}

		const url = this.findScriptUrl(file);

		// Build the logpoint condition: evaluate console.log(...), then return false
		// so execution does not pause.
		let logExpr = `console.log(${template})`;
		if (options?.condition) {
			logExpr = `(${options.condition}) ? (${logExpr}, false) : false`;
		} else {
			logExpr = `${logExpr}, false`;
		}

		const params: Record<string, unknown> = {
			lineNumber: line - 1, // CDP uses 0-based lines
			condition: logExpr,
		};
		if (url) {
			params.url = url;
		} else {
			params.urlRegex = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$";
		}

		const result = await this.cdp.send("Debugger.setBreakpointByUrl", params);
		const r = result as {
			breakpointId: string;
			locations: Array<{ lineNumber: number; columnNumber: number; scriptId: string }>;
		};

		const loc = r.locations[0];
		const resolvedUrl = url ?? file;
		const resolvedLine = loc ? loc.lineNumber + 1 : line;
		const resolvedColumn = loc?.columnNumber;

		const meta: Record<string, unknown> = {
			url: resolvedUrl,
			line: resolvedLine,
			template,
		};
		if (resolvedColumn !== undefined) {
			meta.column = resolvedColumn;
		}
		if (options?.condition) {
			meta.condition = options.condition;
		}
		if (options?.maxEmissions) {
			meta.maxEmissions = options.maxEmissions;
		}

		const ref = this.refs.addLogpoint(r.breakpointId, meta);

		const location: { url: string; line: number; column?: number } = {
			url: resolvedUrl,
			line: resolvedLine,
		};
		if (resolvedColumn !== undefined) {
			location.column = resolvedColumn;
		}

		return { ref, location };
	}

	async setExceptionPause(mode: "all" | "uncaught" | "caught" | "none"): Promise<void> {
		if (!this.cdp) {
			throw new Error("No active debug session");
		}

		// CDP only supports "none", "all", and "uncaught".
		// Map "caught" to "all" since CDP does not have a "caught-only" mode.
		let cdpState: string;
		switch (mode) {
			case "all":
				cdpState = "all";
				break;
			case "uncaught":
				cdpState = "uncaught";
				break;
			case "caught":
				cdpState = "all";
				break;
			case "none":
				cdpState = "none";
				break;
		}

		await this.cdp.send("Debugger.setPauseOnExceptions", { state: cdpState });
	}

	getConsoleMessages(options: {
		level?: string;
		since?: number;
		clear?: boolean;
	} = {}): ConsoleMessage[] {
		let messages = [...this.consoleMessages];
		if (options.level) {
			messages = messages.filter((m) => m.level === options.level);
		}
		if (options.since !== undefined && options.since > 0) {
			messages = messages.slice(-options.since);
		}
		if (options.clear) {
			this.consoleMessages = [];
		}
		return messages;
	}

	getExceptions(options: {
		since?: number;
	} = {}): ExceptionEntry[] {
		let entries = [...this.exceptionEntries];
		if (options.since !== undefined && options.since > 0) {
			entries = entries.slice(-options.since);
		}
		return entries;
	}

	clearConsole(): void {
		this.consoleMessages = [];
	}

	async addBlackbox(patterns: string[]): Promise<string[]> {
		if (!this.cdp) {
			throw new Error("No active debug session");
		}

		for (const p of patterns) {
			if (!this.blackboxPatterns.includes(p)) {
				this.blackboxPatterns.push(p);
			}
		}

		await this.cdp.send("Debugger.setBlackboxPatterns", {
			patterns: this.blackboxPatterns,
		});

		return [...this.blackboxPatterns];
	}

	listBlackbox(): string[] {
		return [...this.blackboxPatterns];
	}

	async removeBlackbox(patterns: string[]): Promise<string[]> {
		if (!this.cdp) {
			throw new Error("No active debug session");
		}

		if (patterns.includes("all")) {
			this.blackboxPatterns = [];
		} else {
			this.blackboxPatterns = this.blackboxPatterns.filter(
				(p) => !patterns.includes(p),
			);
		}

		await this.cdp.send("Debugger.setBlackboxPatterns", {
			patterns: this.blackboxPatterns,
		});

		return [...this.blackboxPatterns];
	}

	async eval(
		expression: string,
		options: {
			frame?: string;
			awaitPromise?: boolean;
			throwOnSideEffect?: boolean;
			timeout?: number;
		} = {},
	): Promise<{
		ref: string;
		type: string;
		value: string;
		objectId?: string;
	}> {
		if (!this.cdp) {
			throw new Error("No active debug session");
		}
		if (this.state !== "paused") {
			throw new Error("Cannot eval: process is not paused");
		}

		// Determine which frame to evaluate in
		let frameIndex = 0;
		if (options.frame) {
			const entry = this.refs.resolve(options.frame);
			if (entry?.meta?.["frameIndex"] !== undefined) {
				frameIndex = entry.meta["frameIndex"] as number;
			}
		}

		const targetFrame = this.pausedCallFrames[frameIndex] as
			| Record<string, unknown>
			| undefined;
		if (!targetFrame) {
			throw new Error("No call frame available");
		}

		const callFrameId = targetFrame.callFrameId as string;

		// Resolve @ref patterns in the expression
		let resolvedExpression = expression;
		const refPattern = /@[vof]\d+/g;
		const refMatches = expression.match(refPattern);
		if (refMatches) {
			const refEntries: Array<{
				ref: string;
				name: string;
				objectId: string;
			}> = [];
			for (const ref of refMatches) {
				const remoteId = this.refs.resolveId(ref);
				if (remoteId) {
					const argName = `__ndbg_ref_${ref.slice(1)}`;
					resolvedExpression = resolvedExpression.replace(
						ref,
						argName,
					);
					refEntries.push({
						ref,
						name: argName,
						objectId: remoteId,
					});
				}
			}

			// If we have ref entries, use callFunctionOn to bind them
			if (refEntries.length > 0) {
				const argNames = refEntries.map((e) => e.name);
				const funcBody = `return (function(${argNames.join(", ")}) { return ${resolvedExpression}; })(...arguments)`;
				const firstObjectId = refEntries[0]?.objectId;
				if (!firstObjectId) {
					throw new Error("No object ID for ref resolution");
				}

				const evalParams: Record<string, unknown> = {
					functionDeclaration: `function() { ${funcBody} }`,
					arguments: refEntries.map((e) => ({
						objectId: e.objectId,
					})),
					objectId: firstObjectId,
					returnByValue: false,
					generatePreview: true,
				};

				if (options.awaitPromise) {
					evalParams.awaitPromise = true;
				}

				const evalPromise = this.cdp.send(
					"Runtime.callFunctionOn",
					evalParams,
				);

				let evalResponse: Record<string, unknown>;
				if (options.timeout) {
					const timeoutPromise = Bun.sleep(options.timeout).then(
						() => {
							throw new Error(
								`Evaluation timed out after ${options.timeout}ms`,
							);
						},
					);
					evalResponse = (await Promise.race([
						evalPromise,
						timeoutPromise,
					])) as Record<string, unknown>;
				} else {
					evalResponse = (await evalPromise) as Record<
						string,
						unknown
					>;
				}

				return this.processEvalResult(evalResponse, expression);
			}
		}

		// Standard evaluation on call frame
		const evalParams: Record<string, unknown> = {
			callFrameId,
			expression: resolvedExpression,
			returnByValue: false,
			generatePreview: true,
		};

		if (options.throwOnSideEffect) {
			evalParams.throwOnSideEffect = true;
		}

		const evalPromise = this.cdp.send(
			"Debugger.evaluateOnCallFrame",
			evalParams,
		);

		let evalResponse: Record<string, unknown>;
		if (options.timeout) {
			const timeoutPromise = Bun.sleep(options.timeout).then(() => {
				throw new Error(
					`Evaluation timed out after ${options.timeout}ms`,
				);
			});
			evalResponse = (await Promise.race([
				evalPromise,
				timeoutPromise,
			])) as Record<string, unknown>;
		} else {
			evalResponse = (await evalPromise) as Record<string, unknown>;
		}

		return this.processEvalResult(evalResponse, expression);
	}

	async getVars(
		options: {
			frame?: string;
			names?: string[];
			allScopes?: boolean;
		} = {},
	): Promise<
		Array<{ ref: string; name: string; type: string; value: string }>
	> {
		if (!this.cdp) {
			throw new Error("No active debug session");
		}
		if (this.state !== "paused") {
			throw new Error("Cannot get vars: process is not paused");
		}

		// Clear volatile refs at the start
		this.refs.clearVolatile();

		// Determine which frame to inspect
		let frameIndex = 0;
		if (options.frame) {
			const entry = this.refs.resolve(options.frame);
			if (entry?.meta?.["frameIndex"] !== undefined) {
				frameIndex = entry.meta["frameIndex"] as number;
			}
		}

		const targetFrame = this.pausedCallFrames[frameIndex] as
			| Record<string, unknown>
			| undefined;
		if (!targetFrame) {
			return [];
		}

		const scopeChain = targetFrame.scopeChain as
			| Array<Record<string, unknown>>
			| undefined;
		if (!scopeChain) {
			return [];
		}

		const variables: Array<{
			ref: string;
			name: string;
			type: string;
			value: string;
		}> = [];

		for (const scope of scopeChain) {
			const scopeType = scope.type as string;

			// Include local, module, block, and script scopes by default.
			// Include closure scope only with allScopes. Always skip global.
			const includeScope =
				scopeType === "local" ||
				scopeType === "module" ||
				scopeType === "block" ||
				scopeType === "script" ||
				(options.allScopes && scopeType === "closure");

			if (includeScope) {
				const scopeObj = scope.object as Record<string, unknown>;
				const objectId = scopeObj.objectId as string;

				const propsResult = await this.cdp.send(
					"Runtime.getProperties",
					{
						objectId,
						ownProperties: true,
						generatePreview: true,
					},
				);

				const properties = (propsResult as Record<string, unknown>)
					.result as Array<Record<string, unknown>>;

				for (const prop of properties) {
					const propName = prop.name as string;
					const propValue = prop.value as RemoteObject | undefined;

					if (!propValue) continue;

					// Skip internal properties
					if (propName.startsWith("__")) continue;

					// Apply name filter if provided
					if (options.names && options.names.length > 0) {
						if (!options.names.includes(propName)) continue;
					}

					const remoteId =
						(propValue.objectId as string) ??
						`primitive:${propName}`;
					const ref = this.refs.addVar(remoteId, propName);

					variables.push({
						ref,
						name: propName,
						type: propValue.type,
						value: formatValue(propValue),
					});
				}
			}

			// Skip "global" scope
			if (scopeType === "global") continue;
		}

		return variables;
	}

	async getProps(
		ref: string,
		options: {
			own?: boolean;
			internal?: boolean;
			depth?: number;
		} = {},
	): Promise<
		Array<{
			ref?: string;
			name: string;
			type: string;
			value: string;
			isOwn?: boolean;
			isAccessor?: boolean;
		}>
	> {
		if (!this.cdp) {
			throw new Error("No active debug session");
		}

		const entry = this.refs.resolve(ref);
		if (!entry) {
			throw new Error(`Unknown ref: ${ref}`);
		}

		const objectId = entry.remoteId;

		// Verify it's a valid object ID (not a primitive placeholder)
		if (
			objectId.startsWith("primitive:") ||
			objectId.startsWith("eval:")
		) {
			throw new Error(
				`Ref ${ref} is a primitive and has no properties`,
			);
		}

		const propsParams: Record<string, unknown> = {
			objectId,
			ownProperties: options.own ?? true,
			generatePreview: true,
		};

		if (options.internal) {
			propsParams.accessorPropertiesOnly = false;
		}

		const propsResult = await this.cdp.send(
			"Runtime.getProperties",
			propsParams,
		);
		const r = propsResult as Record<string, unknown>;
		const properties =
			(r.result as Array<Record<string, unknown>>) ?? [];
		const internalProps = options.internal
			? ((r.internalProperties as Array<Record<string, unknown>>) ??
				[])
			: [];

		const result: Array<{
			ref?: string;
			name: string;
			type: string;
			value: string;
			isOwn?: boolean;
			isAccessor?: boolean;
		}> = [];

		for (const prop of properties) {
			const propName = prop.name as string;
			const propValue = prop.value as RemoteObject | undefined;
			const isOwn = prop.isOwn as boolean | undefined;
			const getDesc = prop.get as RemoteObject | undefined;
			const setDesc = prop.set as RemoteObject | undefined;
			const isAccessor =
				!!(getDesc?.type && getDesc.type !== "undefined") ||
				!!(setDesc?.type && setDesc.type !== "undefined");

			if (!propValue && !isAccessor) continue;

			const displayValue = propValue
				? propValue
				: ({
						type: "function",
						description: "getter/setter",
					} as RemoteObject);

			let propRef: string | undefined;
			if (propValue?.objectId) {
				propRef = this.refs.addObject(propValue.objectId, propName);
			}

			const item: {
				ref?: string;
				name: string;
				type: string;
				value: string;
				isOwn?: boolean;
				isAccessor?: boolean;
			} = {
				name: propName,
				type: displayValue.type,
				value: formatValue(displayValue),
			};

			if (propRef) {
				item.ref = propRef;
			}
			if (isOwn !== undefined) {
				item.isOwn = isOwn;
			}
			if (isAccessor) {
				item.isAccessor = true;
			}

			result.push(item);
		}

		// Add internal properties
		for (const prop of internalProps) {
			const propName = prop.name as string;
			const propValue = prop.value as RemoteObject | undefined;

			if (!propValue) continue;

			let propRef: string | undefined;
			if (propValue.objectId) {
				propRef = this.refs.addObject(propValue.objectId, propName);
			}

			const item: {
				ref?: string;
				name: string;
				type: string;
				value: string;
				isOwn?: boolean;
				isAccessor?: boolean;
			} = {
				name: `[[${propName}]]`,
				type: propValue.type,
				value: formatValue(propValue),
			};

			if (propRef) {
				item.ref = propRef;
			}

			result.push(item);
		}

		return result;
	}

	async setVariable(
		varName: string,
		value: string,
		options: { frame?: string } = {},
	): Promise<{ name: string; oldValue?: string; newValue: string; type: string }> {
		if (!this.cdp) {
			throw new Error("No active debug session");
		}
		if (!this.isPaused()) {
			throw new Error("Cannot set variable: process is not paused");
		}

		// Determine which frame to evaluate in
		let callFrameId: string;
		if (options.frame) {
			const entry = this.refs.resolve(options.frame);
			if (entry?.remoteId) {
				callFrameId = entry.remoteId;
			} else {
				throw new Error(`Unknown frame ref: ${options.frame}`);
			}
		} else {
			const topFrame = this.pausedCallFrames[0] as Record<string, unknown> | undefined;
			if (!topFrame) {
				throw new Error("No call frame available");
			}
			callFrameId = topFrame.callFrameId as string;
		}

		// Try to get old value first (best-effort)
		let oldValue: string | undefined;
		try {
			const oldResult = await this.cdp.send("Debugger.evaluateOnCallFrame", {
				callFrameId,
				expression: varName,
				returnByValue: false,
				generatePreview: true,
			});
			const oldRemote = (oldResult as Record<string, unknown>).result as RemoteObject | undefined;
			if (oldRemote) {
				oldValue = formatValue(oldRemote);
			}
		} catch {
			// Old value not available
		}

		// Set the new value
		const expression = `${varName} = ${value}`;
		const setResult = await this.cdp.send("Debugger.evaluateOnCallFrame", {
			callFrameId,
			expression,
			returnByValue: false,
			generatePreview: true,
		});

		const evalResult = (setResult as Record<string, unknown>).result as RemoteObject | undefined;
		const exceptionDetails = (setResult as Record<string, unknown>).exceptionDetails as Record<string, unknown> | undefined;

		if (exceptionDetails) {
			const exception = exceptionDetails.exception as RemoteObject | undefined;
			const errorText = exception
				? formatValue(exception)
				: ((exceptionDetails.text as string) ?? "Assignment error");
			throw new Error(errorText);
		}

		if (!evalResult) {
			throw new Error("No result from assignment");
		}

		const result: { name: string; oldValue?: string; newValue: string; type: string } = {
			name: varName,
			newValue: formatValue(evalResult),
			type: evalResult.type,
		};
		if (oldValue !== undefined) {
			result.oldValue = oldValue;
		}

		return result;
	}

	async setReturnValue(value: string): Promise<{ value: string; type: string }> {
		if (!this.cdp) {
			throw new Error("No active debug session");
		}
		if (!this.isPaused()) {
			throw new Error("Cannot set return value: process is not paused");
		}

		const topFrame = this.pausedCallFrames[0] as Record<string, unknown> | undefined;
		if (!topFrame) {
			throw new Error("No call frame available");
		}

		const callFrameId = topFrame.callFrameId as string;

		// Evaluate the value expression to get a RemoteObject
		const evalResult = await this.cdp.send("Debugger.evaluateOnCallFrame", {
			callFrameId,
			expression: value,
			returnByValue: false,
			generatePreview: true,
		});

		const result = (evalResult as Record<string, unknown>).result as RemoteObject | undefined;
		const exceptionDetails = (evalResult as Record<string, unknown>).exceptionDetails as Record<string, unknown> | undefined;

		if (exceptionDetails) {
			const exception = exceptionDetails.exception as RemoteObject | undefined;
			const errorText = exception
				? formatValue(exception)
				: ((exceptionDetails.text as string) ?? "Evaluation error");
			throw new Error(errorText);
		}

		if (!result) {
			throw new Error("No result from evaluation");
		}

		// Set the return value using the evaluated RemoteObject
		await this.cdp.send("Debugger.setReturnValue", {
			newValue: result as unknown as Record<string, unknown>,
		});

		return {
			value: formatValue(result),
			type: result.type,
		};
	}

	async hotpatch(
		file: string,
		newSource: string,
		options: { dryRun?: boolean } = {},
	): Promise<{ status: string; callFrames?: unknown[]; exceptionDetails?: unknown }> {
		if (!this.cdp) {
			throw new Error("No active debug session");
		}

		// Find the script URL and then look up the scriptId
		const scriptUrl = this.findScriptUrl(file);
		if (!scriptUrl) {
			throw new Error(`No loaded script matches "${file}"`);
		}

		let scriptId: string | undefined;
		for (const [sid, info] of this.scripts) {
			if (info.url === scriptUrl) {
				scriptId = sid;
				break;
			}
		}

		if (!scriptId) {
			throw new Error(`Could not find script ID for "${file}"`);
		}

		const params: Record<string, unknown> = {
			scriptId,
			scriptSource: newSource,
		};
		if (options.dryRun) {
			params.dryRun = true;
		}

		const result = await this.cdp.send("Debugger.setScriptSource", params);
		const r = result as Record<string, unknown>;

		const response: { status: string; callFrames?: unknown[]; exceptionDetails?: unknown } = {
			status: (r.status as string) ?? "Ok",
		};
		if (r.callFrames) {
			response.callFrames = r.callFrames as unknown[];
		}
		if (r.exceptionDetails) {
			response.exceptionDetails = r.exceptionDetails;
		}

		return response;
	}

	async stop(): Promise<void> {
		if (this.cdp) {
			this.cdp.disconnect();
			this.cdp = null;
		}

		if (this.childProcess) {
			try {
				this.childProcess.kill();
			} catch {
				// Process may already be dead
			}
			this.childProcess = null;
		}

		this.state = "idle";
		this.pauseInfo = null;
		this.wsUrl = null;
		this.scripts.clear();
		this.refs.clearAll();
		this.consoleMessages = [];
		this.exceptionEntries = [];
		this.disabledBreakpoints.clear();
		this.sourceMapResolver.clear();
	}

	get sessionState(): "idle" | "running" | "paused" {
		return this.state;
	}

	get targetPid(): number | null {
		return this.childProcess?.pid ?? null;
	}

	async continue(): Promise<void> {
		if (!this.isPaused()) {
			throw new Error("Cannot continue: process is not paused");
		}
		if (!this.cdp) {
			throw new Error("Cannot continue: no CDP connection");
		}
		const waiter = this.createPauseWaiter();
		await this.cdp.send("Debugger.resume");
		await waiter;
	}

	async step(mode: "over" | "into" | "out"): Promise<void> {
		if (!this.isPaused()) {
			throw new Error("Cannot step: process is not paused");
		}
		if (!this.cdp) {
			throw new Error("Cannot step: no CDP connection");
		}

		const methodMap = {
			over: "Debugger.stepOver",
			into: "Debugger.stepInto",
			out: "Debugger.stepOut",
		} as const;

		const waiter = this.createPauseWaiter();
		await this.cdp.send(methodMap[mode]);
		await waiter;
	}

	async pause(): Promise<void> {
		if (this.state !== "running") {
			throw new Error("Cannot pause: process is not running");
		}
		if (!this.cdp) {
			throw new Error("Cannot pause: no CDP connection");
		}
		const waiter = this.createPauseWaiter();
		await this.cdp.send("Debugger.pause");
		await waiter;
	}

	async runTo(file: string, line: number): Promise<void> {
		if (!this.isPaused()) {
			throw new Error("Cannot run-to: process is not paused");
		}
		if (!this.cdp) {
			throw new Error("Cannot run-to: no CDP connection");
		}

		// Find the script URL matching the given file (by suffix)
		const scriptUrl = this.findScriptUrl(file);
		if (!scriptUrl) {
			throw new Error(`Cannot run-to: no loaded script matches "${file}"`);
		}

		// Set a temporary breakpoint (CDP lines are 0-based)
		const result = await this.cdp.send("Debugger.setBreakpointByUrl", {
			lineNumber: line - 1,
			urlRegex: scriptUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
		}) as { breakpointId?: string } | undefined;

		const breakpointId = result?.breakpointId;

		// Resume execution — set up waiter before sending resume
		const waiter = this.createPauseWaiter();
		await this.cdp.send("Debugger.resume");
		await waiter;

		// Remove the temporary breakpoint
		if (breakpointId && this.cdp) {
			try {
				await this.cdp.send("Debugger.removeBreakpoint", { breakpointId });
			} catch {
				// Breakpoint may already be gone if process exited
			}
		}
	}

	async getSource(options: {
		file?: string;
		lines?: number;
		all?: boolean;
		generated?: boolean;
	} = {}): Promise<{
		url: string;
		lines: Array<{ line: number; text: string; current?: boolean }>;
	}> {
		if (!this.cdp) {
			throw new Error("No active debug session");
		}

		let scriptId: string | undefined;
		let url = "";
		let currentLine: number | undefined;

		if (options.file) {
			// Find the script by file name
			const scriptUrl = this.findScriptUrl(options.file);
			if (!scriptUrl) {
				throw new Error(`No loaded script matches "${options.file}"`);
			}
			url = scriptUrl;
			// Find the scriptId for this URL
			for (const [sid, info] of this.scripts) {
				if (info.url === scriptUrl) {
					scriptId = sid;
					break;
				}
			}
			// If we are paused in this file, mark the current line
			if (this.state === "paused" && this.pauseInfo && this.pauseInfo.scriptId === scriptId) {
				currentLine = this.pauseInfo.line;
			}
		} else {
			// Use current pause location
			if (this.state !== "paused" || !this.pauseInfo?.scriptId) {
				throw new Error("Not paused; specify --file to view source");
			}
			scriptId = this.pauseInfo.scriptId;
			url = this.scripts.get(scriptId)?.url ?? "";
			currentLine = this.pauseInfo.line;
		}

		if (!scriptId) {
			throw new Error("Could not determine script to show");
		}

		// Try to get original source from source map (unless --generated)
		let scriptSource: string | null = null;
		let useOriginalSource = false;
		let originalCurrentLine: number | undefined;

		if (!options.generated) {
			// Check if this file is being requested by original source path
			const smMatch = this.sourceMapResolver.findScriptForSource(options.file ?? "");
			if (smMatch) {
				scriptId = smMatch.scriptId;
				const origSource = this.sourceMapResolver.getOriginalSource(scriptId, options.file ?? "");
				if (origSource) {
					scriptSource = origSource;
					useOriginalSource = true;
					url = options.file ?? url;
				}
			}

			// Also try source map for the current scriptId (when paused at a .js file that has a .ts source)
			if (!useOriginalSource) {
				const smInfo = this.sourceMapResolver.getInfo(scriptId);
				if (smInfo && smInfo.sources.length > 0) {
					const primarySource = smInfo.sources[0];
					if (primarySource) {
						const origSource = this.sourceMapResolver.getOriginalSource(scriptId, primarySource);
						if (origSource) {
							scriptSource = origSource;
							useOriginalSource = true;
							url = primarySource;
							// Translate current line to original
							if (currentLine !== undefined) {
								const original = this.sourceMapResolver.toOriginal(scriptId, currentLine + 1, 0);
								if (original) {
									originalCurrentLine = original.line - 1; // 0-based
								}
							}
						}
					}
				}
			}
		}

		if (!scriptSource) {
			const sourceResult = await this.cdp.send("Debugger.getScriptSource", {
				scriptId,
			});
			scriptSource = (sourceResult as Record<string, unknown>).scriptSource as string;
		}

		const sourceLines = scriptSource.split("\n");
		const effectiveCurrentLine = useOriginalSource && originalCurrentLine !== undefined
			? originalCurrentLine
			: currentLine;

		const linesContext = options.lines ?? 5;
		let startLine: number;
		let endLine: number;

		if (options.all) {
			startLine = 0;
			endLine = sourceLines.length - 1;
		} else if (effectiveCurrentLine !== undefined) {
			startLine = Math.max(0, effectiveCurrentLine - linesContext);
			endLine = Math.min(sourceLines.length - 1, effectiveCurrentLine + linesContext);
		} else {
			// No current line (viewing a different file while paused), show from the top
			startLine = 0;
			endLine = Math.min(sourceLines.length - 1, linesContext * 2);
		}

		const lines: Array<{ line: number; text: string; current?: boolean }> = [];
		for (let i = startLine; i <= endLine; i++) {
			const entry: { line: number; text: string; current?: boolean } = {
				line: i + 1, // 1-based
				text: sourceLines[i] ?? "",
			};
			if (effectiveCurrentLine !== undefined && i === effectiveCurrentLine) {
				entry.current = true;
			}
			lines.push(entry);
		}

		return { url, lines };
	}

	getScripts(filter?: string): Array<{ scriptId: string; url: string; sourceMapURL?: string }> {
		const result: Array<{ scriptId: string; url: string; sourceMapURL?: string }> = [];
		for (const info of this.scripts.values()) {
			// Filter out empty-URL scripts
			if (!info.url) continue;
			// Apply filter if provided
			if (filter && !info.url.includes(filter)) continue;

			const entry: { scriptId: string; url: string; sourceMapURL?: string } = {
				scriptId: info.scriptId,
				url: info.url,
			};
			if (info.sourceMapURL) {
				entry.sourceMapURL = info.sourceMapURL;
			}
			result.push(entry);
		}
		return result;
	}

	getStack(options: {
		asyncDepth?: number;
		generated?: boolean;
	} = {}): Array<{
		ref: string;
		functionName: string;
		file: string;
		line: number;
		column?: number;
		isAsync?: boolean;
	}> {
		if (this.state !== "paused" || !this.cdp) {
			throw new Error("Not paused");
		}

		// Clear volatile refs so frame refs are fresh
		this.refs.clearVolatile();

		const callFrames = this.pausedCallFrames;
		const stackFrames: Array<{
			ref: string;
			functionName: string;
			file: string;
			line: number;
			column?: number;
			isAsync?: boolean;
		}> = [];

		for (let i = 0; i < callFrames.length; i++) {
			const frame = callFrames[i] as Record<string, unknown>;
			const callFrameId = frame.callFrameId as string;
			const funcName = (frame.functionName as string) || "(anonymous)";
			const loc = frame.location as Record<string, unknown>;
			const sid = loc.scriptId as string;
			const lineNum = (loc.lineNumber as number) + 1; // 1-based
			const colNum = loc.columnNumber as number | undefined;
			let url = this.scripts.get(sid)?.url ?? "";
			let displayLine = lineNum;
			let displayCol = colNum !== undefined ? colNum + 1 : undefined;
			let resolvedName: string | null = null;

			if (!options.generated) {
				const resolved = this.resolveOriginalLocation(sid, lineNum, colNum ?? 0);
				if (resolved) {
					url = resolved.url;
					displayLine = resolved.line;
					displayCol = resolved.column;
				}
				const smOriginal = this.sourceMapResolver.toOriginal(sid, lineNum, colNum ?? 0);
				resolvedName = smOriginal?.name ?? null;
			}

			const ref = this.refs.addFrame(callFrameId, funcName, { frameIndex: i });

			const stackEntry: {
				ref: string;
				functionName: string;
				file: string;
				line: number;
				column?: number;
				isAsync?: boolean;
			} = {
				ref,
				functionName: resolvedName ?? funcName,
				file: url,
				line: displayLine,
			};
			if (displayCol !== undefined) {
				stackEntry.column = displayCol;
			}

			stackFrames.push(stackEntry);
		}

		return stackFrames;
	}

	async searchInScripts(
		query: string,
		options: {
			scriptId?: string;
			isRegex?: boolean;
			caseSensitive?: boolean;
		} = {},
	): Promise<Array<{ url: string; line: number; column: number; content: string }>> {
		if (!this.cdp) {
			throw new Error("No active debug session");
		}

		const results: Array<{ url: string; line: number; column: number; content: string }> = [];

		const scriptsToSearch: Array<{ scriptId: string; url: string }> = [];

		if (options.scriptId) {
			const info = this.scripts.get(options.scriptId);
			if (info) {
				scriptsToSearch.push({ scriptId: options.scriptId, url: info.url });
			}
		} else {
			for (const [sid, info] of this.scripts) {
				if (!info.url) continue;
				scriptsToSearch.push({ scriptId: sid, url: info.url });
			}
		}

		for (const script of scriptsToSearch) {
			try {
				const searchResult = await this.cdp.send("Debugger.searchInContent", {
					scriptId: script.scriptId,
					query,
					isRegex: options.isRegex ?? false,
					caseSensitive: options.caseSensitive ?? false,
				});
				const matches = (searchResult as Record<string, unknown>).result as
					| Array<Record<string, unknown>>
					| undefined;
				if (matches) {
					for (const match of matches) {
						results.push({
							url: script.url,
							line: ((match.lineNumber as number) ?? 0) + 1, // 1-based
							column: ((match.columnNumber as number) ?? 0) + 1, // 1-based
							content: (match.lineContent as string) ?? "",
						});
					}
				}
			} catch {
				// Script may have been garbage collected, skip
			}
		}

		return results;
	}

	private processEvalResult(
		result: Record<string, unknown>,
		expression: string,
	): { ref: string; type: string; value: string; objectId?: string } {
		const evalResult = result.result as RemoteObject | undefined;
		const exceptionDetails = result.exceptionDetails as
			| Record<string, unknown>
			| undefined;

		if (exceptionDetails) {
			const exception = exceptionDetails.exception as
				| RemoteObject
				| undefined;
			const errorText = exception
				? formatValue(exception)
				: ((exceptionDetails.text as string) ?? "Evaluation error");
			throw new Error(errorText);
		}

		if (!evalResult) {
			throw new Error("No result from evaluation");
		}

		const remoteId =
			(evalResult.objectId as string) ?? `eval:${Date.now()}`;
		const ref = this.refs.addVar(remoteId, expression);
		const resultData: {
			ref: string;
			type: string;
			value: string;
			objectId?: string;
		} = {
			ref,
			type: evalResult.type,
			value: formatValue(evalResult),
		};
		if (evalResult.objectId) {
			resultData.objectId = evalResult.objectId;
		}
		return resultData;
	}

	private findScriptUrl(file: string): string | null {
		// Try exact suffix match first
		for (const script of this.scripts.values()) {
			if (script.url && script.url.endsWith(file)) {
				return script.url;
			}
		}
		// Try matching after stripping file:// prefix
		for (const script of this.scripts.values()) {
			if (!script.url) continue;
			const stripped = script.url.startsWith("file://")
				? script.url.slice(7)
				: script.url;
			if (stripped.endsWith(file)) {
				return script.url;
			}
		}
		// Try matching just the basename
		const needle = file.includes("/") ? file : `/${file}`;
		for (const script of this.scripts.values()) {
			if (!script.url) continue;
			const stripped = script.url.startsWith("file://")
				? script.url.slice(7)
				: script.url;
			if (stripped.endsWith(needle)) {
				return script.url;
			}
		}
		// Fallback: try source map resolver for .ts files etc.
		const smMatch = this.sourceMapResolver.findScriptForSource(file);
		if (smMatch) {
			return smMatch.url;
		}
		return null;
	}

	/**
	 * Creates a promise that resolves when the next `Debugger.paused` event
	 * fires, the process exits, or the timeout expires. Must be created
	 * BEFORE sending the CDP command that triggers execution so we don't
	 * miss events. Does NOT check current state — the caller is about to
	 * send a resume/step command.
	 */
	private createPauseWaiter(timeoutMs = 30_000): Promise<void> {
		return new Promise<void>((resolve) => {
			let settled = false;

			const settle = () => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				clearInterval(pollTimer);
				this.cdp?.off("Debugger.paused", handler);
				this.onProcessExit = null;
				resolve();
			};

			const timer = setTimeout(() => {
				// Don't reject — the process is still running, just not paused yet
				settle();
			}, timeoutMs);

			const handler = () => {
				settle();
			};

			// Poll as a fallback in case the event/callback is missed
			// (e.g., process exits and monitorProcessExit runs before
			// onProcessExit is set, or CDP disconnects clearing listeners)
			const pollTimer = setInterval(() => {
				if (this.isPaused() || this.state === "idle") {
					settle();
				}
			}, 100);

			this.cdp?.on("Debugger.paused", handler);
			// Also resolve if the process exits during execution
			this.onProcessExit = settle;
		});
	}

	private buildBreakpointCondition(
		condition?: string,
		hitCount?: number,
	): string | undefined {
		if (hitCount && hitCount > 0) {
			const countVar = `__ndbg_bp_count_${Date.now()}`;
			const hitExpr = `(typeof ${countVar} === "undefined" ? (${countVar} = 1) : ++${countVar}) >= ${hitCount}`;
			if (condition) {
				return `(${hitExpr}) && (${condition})`;
			}
			return hitExpr;
		}
		return condition;
	}

	/**
	 * Resolve a generated location to its original source-mapped location.
	 * Option A: when toOriginal returns null but the script has a source map,
	 * still return the original source URL (with the generated line number).
	 */
	private resolveOriginalLocation(
		scriptId: string,
		line1Based: number,
		column: number,
	): { url: string; line: number; column?: number } | null {
		const original = this.sourceMapResolver.toOriginal(scriptId, line1Based, column);
		if (original) {
			return { url: original.source, line: original.line, column: original.column + 1 };
		}
		// Fallback: script has a source map but this line has no mapping
		const primaryUrl = this.sourceMapResolver.getScriptOriginalUrl(scriptId);
		if (primaryUrl) {
			return { url: primaryUrl, line: line1Based };
		}
		return null;
	}

	private isPaused(): boolean {
		return this.state === "paused";
	}

	private async waitForBrkPause(): Promise<void> {
		// Give the Debugger.paused event a moment to arrive (older Node.js)
		if (!this.isPaused()) {
			await Bun.sleep(100);
		}
		// On Node.js v24+, --inspect-brk does not emit Debugger.paused when the
		// debugger connects after the process is already paused. We request an
		// explicit pause and then signal Runtime.runIfWaitingForDebugger so the
		// process starts execution and immediately hits our pause request.
		if (!this.isPaused() && this.cdp) {
			await this.cdp.send("Debugger.pause");
			await this.cdp.send("Runtime.runIfWaitingForDebugger");
			const deadline = Date.now() + 2_000;
			while (!this.isPaused() && Date.now() < deadline) {
				await Bun.sleep(50);
			}
		}
		// On Node.js v24+, the initial --inspect-brk pause lands in an internal
		// bootstrap module (node:internal/...) rather than the user script.
		// Resume past internal pauses until we reach user code.
		let skips = 0;
		while (
			this.isPaused() &&
			this.cdp &&
			this.pauseInfo?.url?.startsWith("node:") &&
			skips < 5
		) {
			skips++;
			const waiter = this.createPauseWaiter(5_000);
			await this.cdp.send("Debugger.resume");
			await waiter;
		}
	}

	private async connectCdp(wsUrl: string): Promise<void> {
		const cdp = await CdpClient.connect(wsUrl);
		this.cdp = cdp;

		// Set up event handlers before enabling domains so we don't miss any events
		this.setupCdpEventHandlers(cdp);

		await cdp.enableDomains();

		// Re-apply blackbox patterns if any exist
		if (this.blackboxPatterns.length > 0) {
			await cdp.send("Debugger.setBlackboxPatterns", {
				patterns: this.blackboxPatterns,
			});
		}

		// Update state to running if not already paused
		if (this.state === "idle") {
			this.state = "running";
		}
	}

	private setupCdpEventHandlers(cdp: CdpClient): void {
		cdp.on("Debugger.paused", (params: unknown) => {
			this.state = "paused";
			const p = params as Record<string, unknown> | undefined;
			const callFrames = p?.callFrames as Array<Record<string, unknown>> | undefined;
			this.pausedCallFrames = (callFrames as unknown[]) ?? [];
			const topFrame = callFrames?.[0];
			const location = topFrame?.location as Record<string, unknown> | undefined;
			const scriptId = location?.scriptId as string | undefined;
			const url = scriptId ? this.scripts.get(scriptId)?.url : undefined;

			this.pauseInfo = {
				reason: (p?.reason as string) ?? "unknown",
				scriptId,
				url,
				line: location?.lineNumber as number | undefined,
				column: location?.columnNumber as number | undefined,
				callFrameCount: callFrames?.length,
			};
		});

		cdp.on("Debugger.resumed", () => {
			this.state = "running";
			this.pauseInfo = null;
			this.pausedCallFrames = [];
			this.refs.clearVolatile();
		});

		cdp.on("Debugger.scriptParsed", (params: unknown) => {
			const p = params as Record<string, unknown> | undefined;
			const scriptId = p?.scriptId as string | undefined;
			if (scriptId) {
				const info: ScriptInfo = {
					scriptId,
					url: (p?.url as string) ?? "",
				};
				const sourceMapURL = p?.sourceMapURL as string | undefined;
				if (sourceMapURL) {
					info.sourceMapURL = sourceMapURL;
					// Load source map asynchronously (fire-and-forget)
					this.sourceMapResolver.loadSourceMap(scriptId, info.url, sourceMapURL).catch(() => {});
				}
				this.scripts.set(scriptId, info);
			}
		});

		cdp.on("Runtime.executionContextDestroyed", () => {
			// The main execution context has been destroyed — the script has
			// finished. The Node.js process may stay alive because the
			// inspector connection keeps the event loop running, but debugging
			// is effectively over.
			this.state = "idle";
			this.pauseInfo = null;
		});

		cdp.on("Runtime.consoleAPICalled", (params: unknown) => {
			const p = params as Record<string, unknown>;
			const type = (p.type as string) ?? "log";
			const args = (p.args as Array<Record<string, unknown>>) ?? [];
			// Format each arg using formatValue
			const formattedArgs = args.map((a) => formatValue(a as unknown as RemoteObject));
			const text = formattedArgs.join(" ");
			// Get stack trace info if available
			const stackTrace = p.stackTrace as Record<string, unknown> | undefined;
			const callFrames = stackTrace?.callFrames as Array<Record<string, unknown>> | undefined;
			const topFrame = callFrames?.[0];
			const msg: ConsoleMessage = {
				timestamp: Date.now(),
				level: type,
				text,
				args: formattedArgs,
				url: topFrame?.url as string | undefined,
				line: topFrame?.lineNumber !== undefined ? (topFrame.lineNumber as number) + 1 : undefined,
			};
			this.consoleMessages.push(msg);
			if (this.consoleMessages.length > 1000) {
				this.consoleMessages.shift();
			}
		});

		cdp.on("Runtime.exceptionThrown", (params: unknown) => {
			const p = params as Record<string, unknown>;
			const details = p.exceptionDetails as Record<string, unknown> | undefined;
			if (!details) return;
			const exception = details.exception as Record<string, unknown> | undefined;
			const entry: ExceptionEntry = {
				timestamp: Date.now(),
				text: (details.text as string) ?? "Exception",
				description: exception?.description as string | undefined,
				url: details.url as string | undefined,
				line: details.lineNumber !== undefined ? (details.lineNumber as number) + 1 : undefined,
				column: details.columnNumber !== undefined ? (details.columnNumber as number) + 1 : undefined,
			};
			// Extract stack trace string
			const stackTrace = details.stackTrace as Record<string, unknown> | undefined;
			if (stackTrace?.callFrames) {
				const frames = stackTrace.callFrames as Array<Record<string, unknown>>;
				entry.stackTrace = frames
					.map((f) => {
						const fn = (f.functionName as string) || "(anonymous)";
						const frameUrl = f.url as string;
						const frameLine = (f.lineNumber as number) + 1;
						return `  at ${fn} (${frameUrl}:${frameLine})`;
					})
					.join("\n");
			}
			this.exceptionEntries.push(entry);
			if (this.exceptionEntries.length > 1000) {
				this.exceptionEntries.shift();
			}
		});
	}

	private monitorProcessExit(proc: Subprocess<"ignore", "pipe", "pipe">): void {
		proc.exited
			.then(() => {
				// Child process has exited
				this.childProcess = null;
				if (this.cdp) {
					this.cdp.disconnect();
					this.cdp = null;
				}
				this.state = "idle";
				this.pauseInfo = null;
				this.onProcessExit?.();
			})
			.catch(() => {
				// Error waiting for exit, treat as exited
				this.childProcess = null;
				this.state = "idle";
				this.pauseInfo = null;
			});
	}

	private async readInspectorUrl(stderr: ReadableStream<Uint8Array>): Promise<string> {
		const reader = stderr.getReader();
		const decoder = new TextDecoder();
		let accumulated = "";

		const timeout = setTimeout(() => {
			reader.cancel().catch(() => {});
		}, INSPECTOR_TIMEOUT_MS);

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				accumulated += decoder.decode(value, { stream: true });

				const match = INSPECTOR_URL_REGEX.exec(accumulated);
				if (match?.[1]) {
					clearTimeout(timeout);
					// Release the reader so the stream is not locked
					reader.releaseLock();
					return match[1];
				}
			}
		} catch {
			// Reader was cancelled (timeout) or stream errored
		}

		clearTimeout(timeout);
		throw new Error(
			`Failed to detect inspector URL within ${INSPECTOR_TIMEOUT_MS}ms. Stderr: ${accumulated.slice(0, 500)}`,
		);
	}

	private async discoverWsUrl(port: number): Promise<string> {
		const url = `http://127.0.0.1:${port}/json`;
		let response: Response;
		try {
			response = await fetch(url);
		} catch (err) {
			throw new Error(
				`Cannot connect to inspector at port ${port}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}

		if (!response.ok) {
			throw new Error(`Inspector at port ${port} returned HTTP ${response.status}`);
		}

		const targets = (await response.json()) as Array<Record<string, unknown>>;
		const target = targets[0];
		if (!target) {
			throw new Error(`No debug targets found at port ${port}`);
		}

		const wsUrl = target.webSocketDebuggerUrl as string | undefined;
		if (!wsUrl) {
			throw new Error(`Debug target at port ${port} has no webSocketDebuggerUrl`);
		}

		return wsUrl;
	}
}
