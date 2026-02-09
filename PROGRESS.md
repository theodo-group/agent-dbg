# agent-dbg Development Progress

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
- [x] Unix socket server (listen on `$XDG_RUNTIME_DIR/agent-dbg/<session>.sock`)
- [x] CLI-to-daemon request/response protocol (newline-delimited JSON)
- [x] Daemon auto-termination on process exit
- [x] Daemon idle timeout (configurable, default 300s)
- [x] Lock file to prevent duplicate daemons per session
- [x] Crash recovery: detect dead socket, suggest `agent-dbg attach`

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
- [x] `agent-dbg gc-refs` — clear accumulated `@o` refs

### 1.4 Output Formatter

- [x] Variable formatting (Objects, Arrays, Functions, Promises, Errors, Buffers, Map, Set)
- [x] Smart truncation (~80 chars per value)
- [x] Source code display (line numbers, `→` current line, `●` breakpoint markers)
- [x] Stack trace display (`@f` refs, async gap markers, blackboxed frame collapsing)
- [x] Error output with actionable suggestions (`→ Try: ...`)
- [x] `--color` flag for ANSI terminal colors
- [x] `--json` flag for JSON output mode
- [x] Truncation hints (`... (agent-dbg props @oN for more)`)

---

## Phase 2 — Session Management

- [x] `agent-dbg launch [--brk] [--session NAME] <command...>` — spawn + attach
- [x] `agent-dbg launch --brk` — spawn with `--inspect-brk`, pause on first line
- [x] `agent-dbg launch --port PORT` — use specific inspector port
- [x] `agent-dbg launch --timeout SECS` — configure daemon idle timeout
- [x] `agent-dbg attach <pid | ws-url | port>` — attach to running process
- [x] `agent-dbg stop [--session NAME]` — kill process + daemon
- [x] `agent-dbg sessions` — list active sessions (PID, status, name)
- [x] `agent-dbg sessions --cleanup` — kill orphaned daemons
- [x] `agent-dbg status` — session info (PID, pause state, breakpoints, memory, uptime)
- [x] Multi-session support (`--session NAME` on any command)

---

## Phase 3 — State Snapshot

- [x] `agent-dbg state` — full state snapshot (source + locals + stack + breakpoints)
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

- [x] `agent-dbg break <file>:<line>` — set breakpoint (`Debugger.setBreakpointByUrl`)
- [x] `agent-dbg break --condition <expr>` — conditional breakpoint
- [x] `agent-dbg break --hit-count <n>` — pause on Nth hit
- [x] `agent-dbg break --continue` — set breakpoint + immediately continue
- [ ] `agent-dbg break --log <template>` — shortcut to logpoint
- [x] `agent-dbg break --pattern <urlRegex>:<line>` — regex pattern breakpoint
- [ ] `agent-dbg break-fn <expr>` — breakpoint on function call
- [ ] `agent-dbg break-on-load [--sourcemap]` — break on new script parse
- [x] `agent-dbg break-rm <BP# | LP# | all>` — remove breakpoints
- [x] `agent-dbg break-ls` — list all breakpoints/logpoints with locations and conditions
- [x] `agent-dbg break-toggle [BP# | all]` — enable/disable breakpoints
- [x] `agent-dbg breakable <file>:<start>-<end>` — list valid breakpoint locations
- [x] `agent-dbg logpoint <file>:<line> <template>` — set logpoint (no pause)
- [ ] Logpoint `--max <n>` — auto-pause after N emissions (default: 100)
- [x] Logpoint `--condition <expr>` — conditional logpoint
- [x] `agent-dbg catch [all | uncaught | caught | none]` — pause-on-exception config

---

## Phase 5 — Execution Control

- [x] `agent-dbg continue` — resume execution (+ auto-state return)
- [x] `agent-dbg step over` — step one statement over (default)
- [x] `agent-dbg step into` — step into function call
- [x] `agent-dbg step out` — step out of current function
- [ ] `agent-dbg step into --break-on-async` — pause on first async task
- [ ] `agent-dbg step --skip <pattern>` — inline blackboxing during step
- [x] `agent-dbg run-to <file>:<line>` — continue to location (no persistent breakpoint)
- [x] `agent-dbg restart-frame [@fN]` — re-execute frame from beginning
- [x] `agent-dbg pause` — interrupt running process
- [ ] `agent-dbg kill-execution` — terminate JS execution, keep session alive

---

## Phase 6 — Inspection

- [x] `agent-dbg vars [name1, name2, ...]` — show local variables with `@v` refs
- [x] `agent-dbg stack [--async-depth N]` — show call stack with `@f` refs
- [x] `agent-dbg eval <expression>` — evaluate in current frame context
- [x] `agent-dbg eval` with `await` support (CDP `awaitPromise`)
- [x] `agent-dbg eval` with `@ref` interpolation
- [x] `agent-dbg eval --frame @fN` — evaluate in specific frame
- [x] `agent-dbg eval --silent` — suppress exception reporting
- [x] `agent-dbg eval --timeout MS` — kill after N ms (default: 5000)
- [x] `agent-dbg eval --side-effect-free` — throw on side effects
- [x] `agent-dbg props <@ref>` — expand object properties (returns `@o` refs)
- [x] `agent-dbg props --own` — only own properties
- [x] `agent-dbg props --depth N` — recursive expansion
- [x] `agent-dbg props --private` — include private fields
- [x] `agent-dbg props --internal` — V8 internal properties (`[[PromiseState]]`)
- [ ] `agent-dbg instances <expression>` — find all live instances of prototype
- [ ] `agent-dbg globals` — list global let/const/class declarations
- [x] `agent-dbg source [--lines N] [--file <path>] [--all]` — show source code
- [x] `agent-dbg search <query> [--regex] [--case-sensitive] [--file <id>]` — search scripts
- [x] `agent-dbg scripts [--filter <pattern>]` — list loaded scripts
- [x] `agent-dbg console [--follow] [--since N] [--level] [--clear]` — console output
- [x] `agent-dbg exceptions [--follow] [--since N]` — captured exceptions

---

## Phase 7 — Mutation

- [x] `agent-dbg set <@vRef | varName> <value>` — change variable value
- [x] `agent-dbg set-return <value>` — change return value (at return point)
- [x] `agent-dbg hotpatch <file>` — live-edit script source (`Debugger.setScriptSource`)
- [x] `agent-dbg hotpatch --dry-run` — check without applying

---

## Phase 8 — Blackboxing

- [x] `agent-dbg blackbox <pattern...>` — skip stepping into matching scripts
- [x] `agent-dbg blackbox-ls` — list current patterns
- [x] `agent-dbg blackbox-rm <pattern | all>` — remove patterns

---

## Phase 9 — Source Map Support

- [x] Fetch and cache source maps from `Debugger.scriptParsed` events
- [x] Resolve `.ts` locations to `.js` for breakpoint setting
- [x] Display source-mapped paths in all output (stack traces, source, breakpoints)
- [x] Show original source (TypeScript) in `agent-dbg source`
- [x] Graceful fallback when no source map exists
- [x] `agent-dbg sourcemap <file>` — show source map info
- [x] `agent-dbg sourcemap --disable` — disable resolution globally
- [x] `--generated` flag — bypass source map resolution per-command (state, source, stack)

---

## Phase 10 — CPU Profiling

- [ ] `agent-dbg cpu start [--interval <us>]` — start V8 CPU profiler
- [ ] `agent-dbg cpu stop [--top N]` — stop profiling + report (function, file:line, self%, total%, deopt)
- [ ] Save full profile to file for external tools
- [ ] `agent-dbg coverage start [--detailed]` — start code coverage
- [ ] `agent-dbg coverage stop [--file] [--uncovered]` — stop + report

---

## Phase 11 — Memory / Heap

- [ ] `agent-dbg heap usage` — quick heap statistics
- [ ] `agent-dbg heap snapshot [--tag <name>]` — full heap snapshot (assigns `HS#` ref)
- [ ] `agent-dbg heap diff <HS#a> <HS#b> [--top N]` — compare snapshots
- [ ] `agent-dbg heap sample start [--interval] [--include-gc]` — sampling profiler
- [ ] `agent-dbg heap sample stop [--top N]` — stop sampling + report
- [ ] `agent-dbg heap track start` — allocation tracking (timeline)
- [ ] `agent-dbg heap track stop` — stop tracking + report
- [ ] `agent-dbg heap inspect <heapObjectId>` — get runtime ref from snapshot node
- [ ] `agent-dbg gc` — force garbage collection

---

## Phase 12 — Advanced / Utility

- [ ] `agent-dbg inject-hook <name>` — create runtime binding (`__agent-dbg_<name>()`)
- [ ] `agent-dbg hooks [--follow]` — view hook invocations
- [ ] `agent-dbg contexts` — list V8 execution contexts
- [ ] `agent-dbg async-depth <N>` — set async call stack depth
- [ ] `agent-dbg config [key] [value]` — get/set daemon configuration
- [ ] `agent-dbg gc-refs` — clear `@o` refs to free memory
- [ ] `agent-dbg --help-agent` — compact LLM-optimized reference card

---

## Phase 13 — Distribution & Integration

- [ ] `bun build --compile` producing standalone binaries (linux-x64, darwin-arm64, etc.)
- [ ] npm package (`npx agent-dbg` support)
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
