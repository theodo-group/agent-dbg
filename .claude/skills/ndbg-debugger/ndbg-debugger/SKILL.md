---
name: ndbg-debugger
description: >
  Debug Node.js/TypeScript/JavaScript applications using the ndbg CLI debugger.
  Use when: (1) investigating runtime bugs by stepping through code, (2) inspecting
  variable values at specific execution points, (3) setting breakpoints and conditional
  breakpoints, (4) evaluating expressions in a paused context, (5) hot-patching code
  without restarting, (6) debugging test failures by attaching to a running process,
  (7) any task where understanding runtime behavior requires a debugger.
  Triggers: "debug this", "set a breakpoint", "step through", "inspect variables",
  "why is this value wrong", "trace execution", "attach debugger", "runtime error".
---

# ndbg Debugger

`ndbg` is a CLI debugger for Node.js wrapping the V8 Inspector (CDP). It uses short `@refs` for all entities -- use them instead of long IDs.

## Core Debug Loop

```bash
# 1. Launch with breakpoint at first line
ndbg launch --brk node app.js

# 2. Set breakpoints at suspicious locations
ndbg break src/handler.ts:42
ndbg break src/utils.ts:15 --condition "count > 10"

# 3. Run to breakpoint
ndbg continue

# 4. Inspect state (shows location, source, locals, stack)
ndbg state

# 5. Drill into values
ndbg props @v1              # expand object
ndbg props @v1 --depth 3    # expand nested 3 levels
ndbg eval "items.filter(x => x.active)"

# 6. Fix and verify
ndbg set count 0            # change variable
ndbg hotpatch src/utils.js  # live-edit (reads file from disk)
ndbg continue               # verify fix
```

## Debugging Strategies

### Bug investigation -- narrow down with breakpoints
```bash
ndbg launch --brk node app.js
ndbg break src/api.ts:50                    # suspect line
ndbg break src/api.ts:60 --condition "!user" # conditional
ndbg continue
ndbg vars                                    # check locals
ndbg eval "JSON.stringify(req.body)"         # inspect deeply
ndbg step over                               # advance one line
ndbg state                                   # see new state
```

### Attach to running/test process
```bash
# Start node with inspector
node --inspect app.js
# Or attach by PID
ndbg attach 12345
ndbg state
```

### Trace execution flow with logpoints (no pause)
```bash
ndbg logpoint src/auth.ts:20 "login attempt: ${username}"
ndbg logpoint src/auth.ts:45 "auth result: ${result}"
ndbg continue
ndbg console    # see logged output
```

### Exception debugging
```bash
ndbg catch uncaught          # pause on uncaught exceptions
ndbg continue                # runs until exception
ndbg state                   # see where it threw
ndbg eval "err.message"      # inspect the error
ndbg stack                   # full call stack
```

### TypeScript source map support
ndbg automatically resolves `.ts` paths via source maps. Set breakpoints using `.ts` paths, see `.ts` source in output. Use `--generated` to see compiled `.js` if needed.

## Ref System

Every output assigns short refs. Use them everywhere:
- `@v1..@vN` -- variables: `ndbg props @v1`, `ndbg set @v2 true`
- `@f0..@fN` -- stack frames: `ndbg eval --frame @f1 "this"`
- `BP#1..N` -- breakpoints: `ndbg break-rm BP#1`, `ndbg break-toggle BP#1`
- `LP#1..N` -- logpoints: `ndbg break-rm LP#1`

Refs `@v`/`@f` reset on each pause. `BP#`/`LP#` persist until removed.

## Key Flags

- `--json` -- machine-readable JSON output on any command
- `--session NAME` -- target a specific session (default: "default")
- `--generated` -- bypass source maps, show compiled JS (on state/source/stack)

## Command Reference

See [references/commands.md](references/commands.md) for full command details and options.

## Tips

- `ndbg state` after stepping always shows location + source + locals -- usually enough context
- `ndbg state -c` for source only, `-v` for vars only, `-s` for stack only -- save tokens
- `ndbg eval` supports `await` -- useful for async inspection
- `ndbg blackbox "node_modules/**"` -- skip stepping into dependencies
- `ndbg hotpatch file` reads the file from disk -- edit the file first, then hotpatch
- Execution commands (`continue`, `step`, `pause`, `run-to`) auto-return status
- `ndbg stop` kills the debugged process and daemon
