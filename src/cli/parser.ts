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
				f: "follow",
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
		console.error("  → Try: agent-dbg --help");
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
	console.log(`agent-dbg — Node.js debugger CLI for AI agents

Usage: agent-dbg <command> [options]

Session:
  launch [--brk] <command...>      Start + attach debugger
  attach <pid|ws-url|port>         Attach to running process
  stop                             Kill process + daemon
  sessions [--cleanup]             List active sessions
  status                           Session info

Execution (returns state automatically):
  continue                         Resume execution
  step [over|into|out]             Step one statement
  run-to <file>:<line>             Continue to location
  pause                            Interrupt running process
  restart-frame [@fN]              Re-execute frame from beginning

Inspection:
  state [-v|-s|-b|-c]              Debug state snapshot
    [--depth N] [--lines N] [--frame @fN] [--all-scopes] [--compact] [--generated]
  vars [name...]                   Show local variables
    [--frame @fN] [--all-scopes]
  stack [--async-depth N]          Show call stack
    [--generated]
  eval <expression>                Evaluate expression
    [--frame @fN] [--silent] [--timeout MS] [--side-effect-free]
  props <@ref>                     Expand object properties
    [--own] [--depth N] [--private] [--internal]
  source [--lines N]               Show source code
    [--file <path>] [--all] [--generated]
  search <query>                   Search loaded scripts
    [--regex] [--case-sensitive] [--file <id>]
  scripts [--filter <pattern>]     List loaded scripts
  console [--since N] [--level]    Console output
    [--clear]
  exceptions [--since N]           Captured exceptions

Breakpoints:
  break <file>:<line>              Set breakpoint
    [--condition <expr>] [--hit-count <n>] [--continue] [--pattern <regex>:<line>]
  break-rm <BP#|all>               Remove breakpoint
  break-ls                         List breakpoints
  break-toggle <BP#|all>           Enable/disable breakpoints
  breakable <file>:<start>-<end>   List valid breakpoint locations
  logpoint <file>:<line> <tpl>     Set logpoint
    [--condition <expr>]
  catch [all|uncaught|caught|none] Pause on exceptions

Mutation:
  set <@ref|name> <value>          Change variable value
  set-return <value>               Change return value (at return point)
  hotpatch <file> [--dry-run]      Live-edit script source

Blackboxing:
  blackbox <pattern...>            Skip stepping into matching scripts
  blackbox-ls                      List current patterns
  blackbox-rm <pattern|all>        Remove patterns

Source Maps:
  sourcemap [file]                 Show source map info
  sourcemap --disable              Disable resolution globally

Diagnostics:
  logs [-f|--follow]               Show CDP protocol log
    [--limit N] [--domain <name>] [--clear]

Global flags:
  --session NAME                   Target session (default: "default")
  --json                           JSON output
  --color                          ANSI colors
  --help-agent                     LLM reference card
  --help                           Show this help`);
}

function printHelpAgent(): void {
	console.log(`agent-dbg — Node.js debugger CLI for AI agents

CORE LOOP:
  1. agent-dbg launch --brk "node app.js"    → pauses at first line, returns state
  2. agent-dbg break src/file.ts:42          → set breakpoint
  3. agent-dbg continue                      → run to breakpoint, returns state
  4. Inspect: agent-dbg vars, agent-dbg eval, agent-dbg props @v1
  5. Mutate/fix: agent-dbg set @v1 value, agent-dbg hotpatch src/file.ts
  6. Repeat from 3

REFS: Every output assigns @refs. Use them everywhere:
  @v1..@vN  variables    |  agent-dbg props @v1, agent-dbg set @v2 true
  @f0..@fN  stack frames |  agent-dbg eval --frame @f1
  BP#1..N   breakpoints  |  agent-dbg break-rm BP#1, agent-dbg break-toggle BP#1

EXECUTION (all return state automatically):
  agent-dbg continue              Resume to next breakpoint
  agent-dbg step [over|into|out]  Step one statement
  agent-dbg run-to file:line      Continue to location
  agent-dbg pause                 Interrupt running process
  agent-dbg restart-frame [@fN]   Re-run frame from beginning

BREAKPOINTS:
  agent-dbg break file:line [--condition expr] [--hit-count N] [--continue]
  agent-dbg break --pattern "regex":line
  agent-dbg break-rm <BP#|all>    Remove breakpoints
  agent-dbg break-ls              List breakpoints
  agent-dbg break-toggle <BP#|all>  Enable/disable breakpoints
  agent-dbg breakable file:start-end  Valid breakpoint locations
  agent-dbg logpoint file:line "template \${var}" [--condition expr]
  agent-dbg catch [all|uncaught|caught|none]

INSPECTION:
  agent-dbg state [-v|-s|-b|-c] [--depth N] [--lines N] [--frame @fN] [--all-scopes] [--compact] [--generated]
  agent-dbg vars [name...] [--frame @fN] [--all-scopes]
  agent-dbg stack [--async-depth N] [--generated]
  agent-dbg eval <expr> [--frame @fN] [--silent] [--timeout MS] [--side-effect-free]
  agent-dbg props @ref [--own] [--depth N] [--private] [--internal]
  agent-dbg source [--lines N] [--file path] [--all] [--generated]
  agent-dbg search "query" [--regex] [--case-sensitive] [--file id]
  agent-dbg scripts [--filter pattern]
  agent-dbg console [--since N] [--level type] [--clear]
  agent-dbg exceptions [--since N]

MUTATION:
  agent-dbg set <@ref|name> <value>   Change variable
  agent-dbg set-return <value>        Change return value (at return point)
  agent-dbg hotpatch <file> [--dry-run]  Live-edit code (no restart!)

BLACKBOXING:
  agent-dbg blackbox <pattern...>     Skip stepping into matching scripts
  agent-dbg blackbox-ls               List current patterns
  agent-dbg blackbox-rm <pattern|all> Remove patterns

SOURCE MAPS:
  agent-dbg sourcemap [file]          Show source map info
  agent-dbg sourcemap --disable       Disable resolution globally

DIAGNOSTICS:
  agent-dbg logs [-f|--follow]        Show CDP protocol log
  agent-dbg logs --limit 100          Show last N entries (default: 50)
  agent-dbg logs --domain Debugger    Filter by CDP domain
  agent-dbg logs --clear              Clear the log file`);
}
