# ndbg Command Reference

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
ndbg launch [--brk] <command...>     # Start + attach debugger (--brk pauses at first line)
ndbg attach <pid|ws-url|port>        # Attach to running process
ndbg stop                            # Kill process + daemon
ndbg sessions [--cleanup]            # List active sessions
ndbg status                          # Session info (pid, state, pause location)
```

## Execution

All execution commands automatically return session status (state + pause info).

```bash
ndbg continue                        # Resume to next breakpoint or completion
ndbg step [over|into|out]            # Step one statement (default: over)
ndbg run-to <file>:<line>            # Continue to specific location
ndbg pause                           # Interrupt running process
ndbg restart-frame [@fN]             # Re-execute frame from beginning
```

## Inspection

### state -- composite snapshot
```bash
ndbg state                           # Full snapshot: location, source, locals, stack, breakpoints
ndbg state -v                        # Locals only
ndbg state -s                        # Stack only
ndbg state -c                        # Source code only
ndbg state -b                        # Breakpoints only
ndbg state --depth 3                 # Expand object values to depth 3
ndbg state --lines 10                # Show 10 lines of source context
ndbg state --frame @f1               # Inspect a different stack frame
ndbg state --all-scopes              # Include closure scope variables
ndbg state --compact                 # Compact output
ndbg state --generated               # Show compiled JS paths instead of TS
```

### vars -- local variables
```bash
ndbg vars                            # All locals in current frame
ndbg vars name1 name2                # Filter specific variables
ndbg vars --frame @f1                # Variables from a different frame
ndbg vars --all-scopes               # Include closure scope
```

### stack -- call stack
```bash
ndbg stack                           # Full call stack
ndbg stack --async-depth 5           # Include async frames
ndbg stack --generated               # Show compiled JS paths
```

### eval -- evaluate expression
```bash
ndbg eval <expression>               # Evaluate in current frame
ndbg eval "await fetchUser(id)"      # Await supported
ndbg eval --frame @f1 "this"         # Evaluate in different frame
ndbg eval --silent "setup()"         # No output (side effects only)
ndbg eval --side-effect-free "x + 1" # Abort if side effects detected
ndbg eval --timeout 5000 "slowFn()"  # Custom timeout in ms
```

### props -- expand object
```bash
ndbg props @v1                       # Expand object properties
ndbg props @v1 --depth 3             # Nested expansion
ndbg props @v1 --own                 # Own properties only
ndbg props @v1 --private             # Include private fields
ndbg props @v1 --internal            # Include internal slots
```

### source -- view source code
```bash
ndbg source                          # Source around current line
ndbg source --lines 20               # 20 lines of context
ndbg source --file src/app.ts        # Source of a specific file
ndbg source --all                    # Entire file
ndbg source --generated              # Show compiled JS
```

### Other inspection
```bash
ndbg search "query"                  # Search loaded scripts
ndbg search "pattern" --regex        # Regex search
ndbg search "text" --case-sensitive  # Case-sensitive search
ndbg search "text" --file <id>       # Search in specific script
ndbg scripts                         # List loaded scripts
ndbg scripts --filter "src/"         # Filter by pattern
ndbg console                         # Show console output
ndbg console --since 5               # Last 5 messages
ndbg console --level error           # Filter by level
ndbg console --clear                 # Clear console buffer
ndbg exceptions                      # Show captured exceptions
ndbg exceptions --since 3            # Last 3 exceptions
```

## Breakpoints

```bash
ndbg break <file>:<line>             # Set breakpoint
ndbg break src/app.ts:42 --condition "x > 10"  # Conditional
ndbg break src/app.ts:42 --hit-count 5         # Break on Nth hit
ndbg break src/app.ts:42 --continue            # Log but don't pause
ndbg break --pattern "handler":15              # Regex URL match
ndbg break-rm BP#1                   # Remove specific breakpoint
ndbg break-rm all                    # Remove all breakpoints
ndbg break-ls                        # List all breakpoints
ndbg break-toggle BP#1               # Disable/enable one breakpoint
ndbg break-toggle all                # Disable/enable all
ndbg breakable src/app.ts:10-50      # List valid breakpoint locations
ndbg logpoint src/app.ts:20 "x=${x}" # Log without pausing
ndbg logpoint src/app.ts:20 "x=${x}" --condition "x > 0"
ndbg catch all                       # Pause on all exceptions
ndbg catch uncaught                  # Pause on uncaught only
ndbg catch none                      # Don't pause on exceptions
```

## Mutation

```bash
ndbg set <@ref|name> <value>         # Change variable value
ndbg set count 0                     # By name
ndbg set @v2 true                    # By ref
ndbg set-return "newValue"           # Change return value (at return point)
ndbg hotpatch <file>                 # Live-edit script from disk
ndbg hotpatch <file> --dry-run       # Preview without applying
```

## Blackboxing

Skip stepping into matching scripts (useful for node_modules).

```bash
ndbg blackbox "node_modules/**"      # Add pattern
ndbg blackbox "lib/**" "vendor/**"   # Multiple patterns
ndbg blackbox-ls                     # List patterns
ndbg blackbox-rm "node_modules/**"   # Remove specific pattern
ndbg blackbox-rm all                 # Remove all patterns
```

## Source Maps

ndbg auto-detects source maps from `Debugger.scriptParsed` events. TypeScript `.ts` paths work transparently for breakpoints and display.

```bash
ndbg sourcemap                       # List all loaded source maps
ndbg sourcemap src/app.ts            # Info for specific file
ndbg sourcemap --disable             # Disable resolution globally
```

## Global Flags

```bash
--session NAME                       # Target session (default: "default")
--json                               # JSON output
--color                              # Enable ANSI colors
--help-agent                         # LLM-optimized reference card
--help                               # Human help
```
