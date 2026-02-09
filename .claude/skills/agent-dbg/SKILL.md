---
name: agent-dbg
description: >
  Debug Node.js/TypeScript/JavaScript applications using the agent-dbg CLI debugger.
  Use when: (1) investigating runtime bugs by stepping through code, (2) inspecting
  variable values at specific execution points, (3) setting breakpoints and conditional
  breakpoints, (4) evaluating expressions in a paused context, (5) hot-patching code
  without restarting, (6) debugging test failures by attaching to a running process,
  (7) any task where understanding runtime behavior requires a debugger.
  Triggers: "debug this", "set a breakpoint", "step through", "inspect variables",
  "why is this value wrong", "trace execution", "attach debugger", "runtime error".
---

# agent-dbg Debugger

`agent-dbg` is a CLI debugger for Node.js wrapping the V8 Inspector (CDP). It uses short `@refs` for all entities -- use them instead of long IDs.

## Core Debug Loop

```bash
# 1. Launch with breakpoint at first line
agent-dbg launch --brk node app.js

# 2. Set breakpoints at suspicious locations
agent-dbg break src/handler.ts:42
agent-dbg break src/utils.ts:15 --condition "count > 10"

# 3. Run to breakpoint
agent-dbg continue

# 4. Inspect state (shows location, source, locals, stack)
agent-dbg state

# 5. Drill into values
agent-dbg props @v1              # expand object
agent-dbg props @v1 --depth 3    # expand nested 3 levels
agent-dbg eval "items.filter(x => x.active)"

# 6. Fix and verify
agent-dbg set count 0            # change variable
agent-dbg hotpatch src/utils.js  # live-edit (reads file from disk)
agent-dbg continue               # verify fix
```

## Debugging Strategies

### Bug investigation -- narrow down with breakpoints
```bash
agent-dbg launch --brk node app.js
agent-dbg break src/api.ts:50                    # suspect line
agent-dbg break src/api.ts:60 --condition "!user" # conditional
agent-dbg continue
agent-dbg vars                                    # check locals
agent-dbg eval "JSON.stringify(req.body)"         # inspect deeply
agent-dbg step over                               # advance one line
agent-dbg state                                   # see new state
```

### Attach to running/test process
```bash
# Start node with inspector
node --inspect app.js
# Or attach by PID
agent-dbg attach 12345
agent-dbg state
```

### Trace execution flow with logpoints (no pause)
```bash
agent-dbg logpoint src/auth.ts:20 "login attempt: ${username}"
agent-dbg logpoint src/auth.ts:45 "auth result: ${result}"
agent-dbg continue
agent-dbg console    # see logged output
```

### Exception debugging
```bash
agent-dbg catch uncaught          # pause on uncaught exceptions
agent-dbg continue                # runs until exception
agent-dbg state                   # see where it threw
agent-dbg eval "err.message"      # inspect the error
agent-dbg stack                   # full call stack
```

### TypeScript source map support
agent-dbg automatically resolves `.ts` paths via source maps. Set breakpoints using `.ts` paths, see `.ts` source in output. Use `--generated` to see compiled `.js` if needed.

## Ref System

Every output assigns short refs. Use them everywhere:
- `@v1..@vN` -- variables: `agent-dbg props @v1`, `agent-dbg set @v2 true`
- `@f0..@fN` -- stack frames: `agent-dbg eval --frame @f1 "this"`
- `BP#1..N` -- breakpoints: `agent-dbg break-rm BP#1`, `agent-dbg break-toggle BP#1`
- `LP#1..N` -- logpoints: `agent-dbg break-rm LP#1`

Refs `@v`/`@f` reset on each pause. `BP#`/`LP#` persist until removed.

## Key Flags

- `--json` -- machine-readable JSON output on any command
- `--session NAME` -- target a specific session (default: "default")
- `--generated` -- bypass source maps, show compiled JS (on state/source/stack)

## Command Reference

See [references/commands.md](references/commands.md) for full command details and options.

## Tips

- `agent-dbg state` after stepping always shows location + source + locals -- usually enough context
- `agent-dbg state -c` for source only, `-v` for vars only, `-s` for stack only -- save tokens
- `agent-dbg eval` supports `await` -- useful for async inspection
- `agent-dbg blackbox "node_modules/**"` -- skip stepping into dependencies
- `agent-dbg hotpatch file` reads the file from disk -- edit the file first, then hotpatch
- Execution commands (`continue`, `step`, `pause`, `run-to`) auto-return status
- `agent-dbg stop` kills the debugged process and daemon
