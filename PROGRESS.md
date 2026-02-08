# ndbg Development Progress

> Status legend: `[ ]` Not started | `[~]` In progress | `[x]` Done | `[-]` Blocked

---

## Phase 0 — Project Setup

- [x] Initialize Bun project with TypeScript `bun init`
- [x] Set up project structure (src/, tests/, fixtures/)
- [x] Configure `bun build --compile` for standalone binary
- [x] Set up test framework (bun:test)
- [x] Set up CLI argument parser (command + subcommands + flags)
- [x] Configure linting / formatting

---

## Phase 1 — Core Infrastructure

### 1.1 Daemon Architecture

- [x] Daemon process spawning and backgrounding
- [x] Unix socket server (listen on `$XDG_RUNTIME_DIR/ndbg/<session>.sock`)
- [x] CLI-to-daemon request/response protocol (newline-delimited JSON)
- [x] Daemon auto-termination on process exit
- [x] Daemon idle timeout (configurable, default 300s)
- [x] Lock file to prevent duplicate daemons per session
- [x] Crash recovery: detect dead socket, suggest `ndbg attach`

### 1.2 CDP (Chrome DevTools Protocol) Connection

- [x] WebSocket client to V8 inspector (`ws://127.0.0.1:<port>`)
- [x] CDP message send/receive with request ID tracking
- [x] CDP event subscription and dispatching
- [x] Enable required CDP domains (Debugger, Runtime, Profiler, HeapProfiler)
- [x] `Runtime.runIfWaitingForDebugger` on attach

### 1.3 @ref System

- [x] Ref table data structure (map short refs to V8 remote object IDs)
- [x] `@v` refs — variable/value refs (regenerated on each pause)
- [x] `@f` refs — stack frame refs (regenerated on each pause)
- [x] `@o` refs — expanded object refs (append-only, persist across pauses)
- [x] `BP#` refs — breakpoint refs (persist until removed)
- [x] `LP#` refs — logpoint refs (persist until removed)
- [x] `HS#` refs — heap snapshot refs (persist until session ends)
- [x] Ref resolution: resolve `@ref` in CLI arguments to V8 IDs
- [x] `ndbg gc-refs` — clear accumulated `@o` refs

### 1.4 Output Formatter

- [x] Variable formatting (Objects, Arrays, Functions, Promises, Errors, Buffers, Map, Set)
- [x] Smart truncation (~80 chars per value)
- [x] Source code display (line numbers, `→` current line, `●` breakpoint markers)
- [x] Stack trace display (`@f` refs, async gap markers, blackboxed frame collapsing)
- [x] Error output with actionable suggestions (`→ Try: ...`)
- [x] `--color` flag for ANSI terminal colors
- [x] `--json` flag for JSON output mode
- [x] Truncation hints (`... (ndbg props @oN for more)`)

---

## Phase 2 — Session Management

- [x] `ndbg launch [--brk] [--session NAME] <command...>` — spawn + attach
- [x] `ndbg launch --brk` — spawn with `--inspect-brk`, pause on first line
- [x] `ndbg launch --port PORT` — use specific inspector port
- [x] `ndbg launch --timeout SECS` — configure daemon idle timeout
- [x] `ndbg attach <pid | ws-url | port>` — attach to running process
- [x] `ndbg stop [--session NAME]` — kill process + daemon
- [x] `ndbg sessions` — list active sessions (PID, status, name)
- [x] `ndbg sessions --cleanup` — kill orphaned daemons
- [x] `ndbg status` — session info (PID, pause state, breakpoints, memory, uptime)
- [x] Multi-session support (`--session NAME` on any command)

---

## Phase 3 — State Snapshot

- [x] `ndbg state` — full state snapshot (source + locals + stack + breakpoints)
- [x] State filtering: `-v` / `--vars` (locals only)
- [x] State filtering: `-s` / `--stack` (stack trace only)
- [x] State filtering: `-b` / `--breakpoints` (breakpoints/logpoints only)
- [x] State filtering: `-c` / `--code` (source context only)
- [x] `--compact` flag — one-line-per-section summary
- [x] `--depth N` — object expansion depth (default: 1)
- [x] `--lines N` — source context lines (default: 3)
- [x] `--frame @fN` — state from perspective of frame N
- [x] `--all-scopes` — include closure and global scope
- [x] `--json` — full state as JSON
- [x] Auto-state return after execution commands (continue, step, etc.)

---

## Phase 4 — Breakpoints

- [x] `ndbg break <file>:<line>` — set breakpoint (`Debugger.setBreakpointByUrl`)
- [x] `ndbg break --condition <expr>` — conditional breakpoint
- [x] `ndbg break --hit-count <n>` — pause on Nth hit
- [x] `ndbg break --continue` — set breakpoint + immediately continue
- [ ] `ndbg break --log <template>` — shortcut to logpoint
- [x] `ndbg break --pattern <urlRegex>:<line>` — regex pattern breakpoint
- [ ] `ndbg break-fn <expr>` — breakpoint on function call
- [ ] `ndbg break-on-load [--sourcemap]` — break on new script parse
- [x] `ndbg break-rm <BP# | LP# | all>` — remove breakpoints
- [x] `ndbg break-ls` — list all breakpoints/logpoints with locations and conditions
- [x] `ndbg break-toggle [BP# | all]` — enable/disable breakpoints
- [x] `ndbg breakable <file>:<start>-<end>` — list valid breakpoint locations
- [x] `ndbg logpoint <file>:<line> <template>` — set logpoint (no pause)
- [ ] Logpoint `--max <n>` — auto-pause after N emissions (default: 100)
- [x] Logpoint `--condition <expr>` — conditional logpoint
- [x] `ndbg catch [all | uncaught | caught | none]` — pause-on-exception config

---

## Phase 5 — Execution Control

- [x] `ndbg continue` — resume execution (+ auto-state return)
- [x] `ndbg step over` — step one statement over (default)
- [x] `ndbg step into` — step into function call
- [x] `ndbg step out` — step out of current function
- [ ] `ndbg step into --break-on-async` — pause on first async task
- [ ] `ndbg step --skip <pattern>` — inline blackboxing during step
- [x] `ndbg run-to <file>:<line>` — continue to location (no persistent breakpoint)
- [x] `ndbg restart-frame [@fN]` — re-execute frame from beginning
- [x] `ndbg pause` — interrupt running process
- [ ] `ndbg kill-execution` — terminate JS execution, keep session alive

---

## Phase 6 — Inspection

- [x] `ndbg vars [name1, name2, ...]` — show local variables with `@v` refs
- [x] `ndbg stack [--async-depth N]` — show call stack with `@f` refs
- [x] `ndbg eval <expression>` — evaluate in current frame context
- [x] `ndbg eval` with `await` support (CDP `awaitPromise`)
- [x] `ndbg eval` with `@ref` interpolation
- [x] `ndbg eval --frame @fN` — evaluate in specific frame
- [x] `ndbg eval --silent` — suppress exception reporting
- [x] `ndbg eval --timeout MS` — kill after N ms (default: 5000)
- [x] `ndbg eval --side-effect-free` — throw on side effects
- [x] `ndbg props <@ref>` — expand object properties (returns `@o` refs)
- [x] `ndbg props --own` — only own properties
- [x] `ndbg props --depth N` — recursive expansion
- [x] `ndbg props --private` — include private fields
- [x] `ndbg props --internal` — V8 internal properties (`[[PromiseState]]`)
- [ ] `ndbg instances <expression>` — find all live instances of prototype
- [ ] `ndbg globals` — list global let/const/class declarations
- [x] `ndbg source [--lines N] [--file <path>] [--all]` — show source code
- [x] `ndbg search <query> [--regex] [--case-sensitive] [--file <id>]` — search scripts
- [x] `ndbg scripts [--filter <pattern>]` — list loaded scripts
- [x] `ndbg console [--follow] [--since N] [--level] [--clear]` — console output
- [x] `ndbg exceptions [--follow] [--since N]` — captured exceptions

---

## Phase 7 — Mutation

- [x] `ndbg set <@vRef | varName> <value>` — change variable value
- [x] `ndbg set-return <value>` — change return value (at return point)
- [x] `ndbg hotpatch <file>` — live-edit script source (`Debugger.setScriptSource`)
- [x] `ndbg hotpatch --dry-run` — check without applying

---

## Phase 8 — Blackboxing

- [x] `ndbg blackbox <pattern...>` — skip stepping into matching scripts
- [x] `ndbg blackbox-ls` — list current patterns
- [x] `ndbg blackbox-rm <pattern | all>` — remove patterns

---

## Phase 9 — Source Map Support

- [x] Fetch and cache source maps from `Debugger.scriptParsed` events
- [x] Resolve `.ts` locations to `.js` for breakpoint setting
- [x] Display source-mapped paths in all output (stack traces, source, breakpoints)
- [x] Show original source (TypeScript) in `ndbg source`
- [x] Graceful fallback when no source map exists
- [x] `ndbg sourcemap <file>` — show source map info
- [x] `ndbg sourcemap --disable` — disable resolution globally
- [x] `--generated` flag — bypass source map resolution per-command (state, source, stack)

---

## Phase 10 — CPU Profiling

- [ ] `ndbg cpu start [--interval <us>]` — start V8 CPU profiler
- [ ] `ndbg cpu stop [--top N]` — stop profiling + report (function, file:line, self%, total%, deopt)
- [ ] Save full profile to file for external tools
- [ ] `ndbg coverage start [--detailed]` — start code coverage
- [ ] `ndbg coverage stop [--file] [--uncovered]` — stop + report

---

## Phase 11 — Memory / Heap

- [ ] `ndbg heap usage` — quick heap statistics
- [ ] `ndbg heap snapshot [--tag <name>]` — full heap snapshot (assigns `HS#` ref)
- [ ] `ndbg heap diff <HS#a> <HS#b> [--top N]` — compare snapshots
- [ ] `ndbg heap sample start [--interval] [--include-gc]` — sampling profiler
- [ ] `ndbg heap sample stop [--top N]` — stop sampling + report
- [ ] `ndbg heap track start` — allocation tracking (timeline)
- [ ] `ndbg heap track stop` — stop tracking + report
- [ ] `ndbg heap inspect <heapObjectId>` — get runtime ref from snapshot node
- [ ] `ndbg gc` — force garbage collection

---

## Phase 12 — Advanced / Utility

- [ ] `ndbg inject-hook <name>` — create runtime binding (`__ndbg_<name>()`)
- [ ] `ndbg hooks [--follow]` — view hook invocations
- [ ] `ndbg contexts` — list V8 execution contexts
- [ ] `ndbg async-depth <N>` — set async call stack depth
- [ ] `ndbg config [key] [value]` — get/set daemon configuration
- [ ] `ndbg gc-refs` — clear `@o` refs to free memory
- [ ] `ndbg --help-agent` — compact LLM-optimized reference card

---

## Phase 13 — Distribution & Integration

- [ ] `bun build --compile` producing standalone binaries (linux-x64, darwin-arm64, etc.)
- [ ] npm package (`npx ndbg` support)
- [ ] SKILL.md for Claude Code agent integration
- [ ] `--help-agent` output matching spec reference card
- [ ] GitHub releases with prebuilt binaries

---

## Phase 14 — Testing

### Unit Tests

- [ ] Ref system: creation, resolution, lifecycle, collision handling
- [ ] Output formatters: variable formatting, truncation, source display
- [ ] Source map resolution: .ts → .js mapping, inline source maps, missing maps
- [ ] Command argument parsing

### Integration Tests

- [ ] Launch + attach + breakpoint + step + inspect + stop lifecycle
- [ ] Conditional breakpoints with expression evaluation
- [ ] Logpoint emission and flood throttling
- [ ] Source map resolution end-to-end (TypeScript project)
- [ ] Hotpatch: edit, verify, dry-run, blocked scenarios
- [ ] Multi-session: two concurrent debug sessions
- [ ] Heap snapshot, diff, sampling
- [ ] CPU profiling and coverage collection
- [ ] Daemon crash recovery and orphan cleanup

### Agent Simulation Tests

- [ ] Race condition debugging scenario (bash script)
- [ ] Circular dependency tracing scenario
- [ ] Memory leak detection scenario
- [ ] Metric: total tool calls needed
- [ ] Metric: total tokens in output
- [ ] Metric: success rate vs MCP-based debuggers
