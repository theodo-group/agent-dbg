# agent-dbg Command Reference

## Table of Contents
- [Session](#session)
- [Execution](#execution)
- [Inspection](#inspection)
- [Breakpoints](#breakpoints)
- [Mutation](#mutation)
- [Blackboxing](#blackboxing)
- [Source Maps](#source-maps)
- [Global Flags](#global-flags)

## Session

```bash
agent-dbg launch [--brk] <command...>     # Start + attach debugger (--brk pauses at first line)
agent-dbg attach <pid|ws-url|port>        # Attach to running process
agent-dbg stop                            # Kill process + daemon
agent-dbg sessions [--cleanup]            # List active sessions
agent-dbg status                          # Session info (pid, state, pause location)
```

## Execution

All execution commands automatically return session status (state + pause info).

```bash
agent-dbg continue                        # Resume to next breakpoint or completion
agent-dbg step [over|into|out]            # Step one statement (default: over)
agent-dbg run-to <file>:<line>            # Continue to specific location
agent-dbg pause                           # Interrupt running process
agent-dbg restart-frame [@fN]             # Re-execute frame from beginning
```

## Inspection

### state -- composite snapshot
```bash
agent-dbg state                           # Full snapshot: location, source, locals, stack, breakpoints
agent-dbg state -v                        # Locals only
agent-dbg state -s                        # Stack only
agent-dbg state -c                        # Source code only
agent-dbg state -b                        # Breakpoints only
agent-dbg state --depth 3                 # Expand object values to depth 3
agent-dbg state --lines 10                # Show 10 lines of source context
agent-dbg state --frame @f1               # Inspect a different stack frame
agent-dbg state --all-scopes              # Include closure scope variables
agent-dbg state --compact                 # Compact output
agent-dbg state --generated               # Show compiled JS paths instead of TS
```

### vars -- local variables
```bash
agent-dbg vars                            # All locals in current frame
agent-dbg vars name1 name2                # Filter specific variables
agent-dbg vars --frame @f1                # Variables from a different frame
agent-dbg vars --all-scopes               # Include closure scope
```

### stack -- call stack
```bash
agent-dbg stack                           # Full call stack
agent-dbg stack --async-depth 5           # Include async frames
agent-dbg stack --generated               # Show compiled JS paths
```

### eval -- evaluate expression
```bash
agent-dbg eval <expression>               # Evaluate in current frame
agent-dbg eval "await fetchUser(id)"      # Await supported
agent-dbg eval --frame @f1 "this"         # Evaluate in different frame
agent-dbg eval --silent "setup()"         # No output (side effects only)
agent-dbg eval --side-effect-free "x + 1" # Abort if side effects detected
agent-dbg eval --timeout 5000 "slowFn()"  # Custom timeout in ms
```

### props -- expand object
```bash
agent-dbg props @v1                       # Expand object properties
agent-dbg props @v1 --depth 3             # Nested expansion
agent-dbg props @v1 --own                 # Own properties only
agent-dbg props @v1 --private             # Include private fields
agent-dbg props @v1 --internal            # Include internal slots
```

### source -- view source code
```bash
agent-dbg source                          # Source around current line
agent-dbg source --lines 20               # 20 lines of context
agent-dbg source --file src/app.ts        # Source of a specific file
agent-dbg source --all                    # Entire file
agent-dbg source --generated              # Show compiled JS
```

### Other inspection
```bash
agent-dbg search "query"                  # Search loaded scripts
agent-dbg search "pattern" --regex        # Regex search
agent-dbg search "text" --case-sensitive  # Case-sensitive search
agent-dbg search "text" --file <id>       # Search in specific script
agent-dbg scripts                         # List loaded scripts
agent-dbg scripts --filter "src/"         # Filter by pattern
agent-dbg console                         # Show console output
agent-dbg console --since 5               # Last 5 messages
agent-dbg console --level error           # Filter by level
agent-dbg console --clear                 # Clear console buffer
agent-dbg exceptions                      # Show captured exceptions
agent-dbg exceptions --since 3            # Last 3 exceptions
```

## Breakpoints

```bash
agent-dbg break <file>:<line>             # Set breakpoint
agent-dbg break src/app.ts:42 --condition "x > 10"  # Conditional
agent-dbg break src/app.ts:42 --hit-count 5         # Break on Nth hit
agent-dbg break src/app.ts:42 --continue            # Log but don't pause
agent-dbg break --pattern "handler":15              # Regex URL match
agent-dbg break-rm BP#1                   # Remove specific breakpoint
agent-dbg break-rm all                    # Remove all breakpoints
agent-dbg break-ls                        # List all breakpoints
agent-dbg break-toggle BP#1               # Disable/enable one breakpoint
agent-dbg break-toggle all                # Disable/enable all
agent-dbg breakable src/app.ts:10-50      # List valid breakpoint locations
agent-dbg logpoint src/app.ts:20 "x=${x}" # Log without pausing
agent-dbg logpoint src/app.ts:20 "x=${x}" --condition "x > 0"
agent-dbg catch all                       # Pause on all exceptions
agent-dbg catch uncaught                  # Pause on uncaught only
agent-dbg catch none                      # Don't pause on exceptions
```

## Mutation

```bash
agent-dbg set <@ref|name> <value>         # Change variable value
agent-dbg set count 0                     # By name
agent-dbg set @v2 true                    # By ref
agent-dbg set-return "newValue"           # Change return value (at return point)
agent-dbg hotpatch <file>                 # Live-edit script from disk
agent-dbg hotpatch <file> --dry-run       # Preview without applying
```

## Blackboxing

Skip stepping into matching scripts (useful for node_modules).

```bash
agent-dbg blackbox "node_modules/**"      # Add pattern
agent-dbg blackbox "lib/**" "vendor/**"   # Multiple patterns
agent-dbg blackbox-ls                     # List patterns
agent-dbg blackbox-rm "node_modules/**"   # Remove specific pattern
agent-dbg blackbox-rm all                 # Remove all patterns
```

## Source Maps

agent-dbg auto-detects source maps from `Debugger.scriptParsed` events. TypeScript `.ts` paths work transparently for breakpoints and display.

```bash
agent-dbg sourcemap                       # List all loaded source maps
agent-dbg sourcemap src/app.ts            # Info for specific file
agent-dbg sourcemap --disable             # Disable resolution globally
```

## Global Flags

```bash
--session NAME                       # Target session (default: "default")
--json                               # JSON output
--color                              # Enable ANSI colors
--help-agent                         # LLM-optimized reference card
--help                               # Human help
```
