import { registry } from "./registry.ts";
import type { GlobalFlags, ParsedArgs } from "./types.ts";

const GLOBAL_FLAGS = new Set(["session", "json", "color", "help-agent", "help"]);
const BOOLEAN_FLAGS = new Set([
	"json",
	"color",
	"help-agent",
	"help",
	"brk",
	"compact",
	"all-scopes",
	"vars",
	"stack",
	"breakpoints",
	"code",
	"own",
	"private",
	"internal",
	"regex",
	"case-sensitive",
	"detailed",
	"follow",
	"clear",
	"uncovered",
	"include-gc",
	"silent",
	"side-effect-free",
	"sourcemap",
	"dry-run",
	"continue",
	"all",
	"cleanup",
	"disable",
	"generated",
]);

export function parseArgs(argv: string[]): ParsedArgs {
	const flags: Record<string, string | boolean> = {};
	const positionals: string[] = [];
	let command = "";
	let subcommand: string | null = null;

	let i = 0;

	// Extract command (first non-flag argument)
	while (i < argv.length) {
		const arg = argv[i];
		if (arg === undefined) break;
		if (arg.startsWith("-")) break;
		if (!command) {
			command = arg;
		} else if (!subcommand) {
			subcommand = arg;
		} else {
			positionals.push(arg);
		}
		i++;
	}

	// Parse remaining arguments
	while (i < argv.length) {
		const arg = argv[i];
		if (arg === undefined) {
			i++;
			continue;
		}

		if (arg === "--") {
			// Everything after -- is positional
			i++;
			while (i < argv.length) {
				const rest = argv[i];
				if (rest !== undefined) positionals.push(rest);
				i++;
			}
			break;
		}

		if (arg.startsWith("--")) {
			const key = arg.slice(2);
			if (BOOLEAN_FLAGS.has(key)) {
				flags[key] = true;
			} else {
				const next = argv[i + 1];
				if (next !== undefined && !next.startsWith("-")) {
					flags[key] = next;
					i++;
				} else {
					flags[key] = true;
				}
			}
		} else if (arg.startsWith("-") && arg.length === 2) {
			// Short flags
			const key = arg.slice(1);
			const shortMap: Record<string, string> = {
				v: "vars",
				s: "stack",
				b: "breakpoints",
				c: "code",
			};
			const mapped = shortMap[key];
			if (mapped) {
				flags[mapped] = true;
			} else {
				flags[key] = true;
			}
		} else {
			positionals.push(arg);
		}
		i++;
	}

	const global: GlobalFlags = {
		session: typeof flags.session === "string" ? flags.session : "default",
		json: flags.json === true,
		color: flags.color === true,
		helpAgent: flags["help-agent"] === true,
		help: flags.help === true,
	};

	// Remove global flags from flags map
	for (const key of GLOBAL_FLAGS) {
		delete flags[key];
	}

	return { command, subcommand, positionals, flags, global };
}

export async function run(args: ParsedArgs): Promise<number> {
	if (args.global.helpAgent) {
		printHelpAgent();
		return 0;
	}

	if (!args.command || args.global.help) {
		printHelp();
		return args.command ? 0 : 1;
	}

	const handler = registry.get(args.command);
	if (!handler) {
		console.error(`✗ Unknown command: ${args.command}`);
		console.error("  → Try: ndbg --help");
		return 1;
	}

	try {
		return await handler(args);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`✗ ${message}`);
		return 1;
	}
}

function printHelp(): void {
	console.log(`ndbg — Node.js debugger CLI for AI agents

Usage: ndbg <command> [options]

Session:
  launch [--brk] <command...>    Start + attach debugger
  attach <pid|ws-url|port>       Attach to running process
  stop                           Kill process + daemon
  sessions [--cleanup]           List active sessions
  status                         Session info

Execution (returns state automatically):
  continue                       Resume execution
  step [over|into|out]           Step one statement
  run-to <file>:<line>           Continue to location
  pause                          Interrupt running process

Inspection:
  state [-v|-s|-b|-c]            Debug state snapshot
  vars [name...]                 Show local variables
  stack                          Show call stack
  eval <expression>              Evaluate expression
  props <@ref>                   Expand object properties
  source [--lines N]             Show source code

Breakpoints:
  break <file>:<line>            Set breakpoint
  break-rm <BP#|all>             Remove breakpoint
  break-ls                       List breakpoints
  logpoint <file>:<line> <tpl>   Set logpoint
  catch [all|uncaught|none]      Pause on exceptions

Mutation:
  set <@ref|name> <value>        Change variable value
  hotpatch <file>                Live-edit script source

Profiling:
  cpu start|stop                 CPU profiling
  heap usage|snapshot|diff       Heap analysis

Global flags:
  --session NAME                 Target session (default: "default")
  --json                         JSON output
  --color                        ANSI colors
  --help-agent                   LLM reference card
  --help                         Show this help`);
}

function printHelpAgent(): void {
	console.log(`ndbg — Node.js debugger CLI for AI agents

CORE LOOP:
  1. ndbg launch --brk "node app.js"    → pauses at first line, returns state
  2. ndbg break src/file.ts:42          → set breakpoint
  3. ndbg continue                      → run to breakpoint, returns state
  4. Inspect: ndbg vars, ndbg eval, ndbg props @v1
  5. Mutate/fix: ndbg set @v1 value, ndbg hotpatch src/file.ts
  6. Repeat from 3

REFS: Every output assigns @refs. Use them everywhere:
  @v1..@vN  variables    |  ndbg props @v1, ndbg set @v2 true
  @f0..@fN  stack frames |  ndbg eval --frame @f1
  BP#1..N   breakpoints  |  ndbg break-rm BP#1
  HS#1..N   heap snaps   |  ndbg heap diff HS#1 HS#2

EXECUTION (all return state automatically):
  ndbg continue              Resume to next breakpoint
  ndbg step [over|into|out]  Step one statement
  ndbg run-to file:line      Continue to location
  ndbg pause                 Interrupt running process
  ndbg restart-frame @f0     Re-run current function

BREAKPOINTS:
  ndbg break file:line [--condition expr]
  ndbg logpoint file:line "template \${var}"
  ndbg catch [all|uncaught|none]
  ndbg blackbox "node_modules/**"

INSPECTION:
  ndbg state [-v|-s|-b|-c] [--depth N]
  ndbg vars [name...]
  ndbg eval <expr>                    (await supported)
  ndbg props @ref [--depth N]
  ndbg search "query" [--regex]

MUTATION:
  ndbg set @v1 <value>        Change variable
  ndbg hotpatch <file>        Live-edit code (no restart!)

PROFILING:
  ndbg cpu start / stop [--top N]
  ndbg heap usage | snapshot | diff | gc`);
}
