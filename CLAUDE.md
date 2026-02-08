# ndbg — Node.js Debugger CLI for AI Agents

## Project Overview
CLI debugger for Node.js built with Bun, optimized for AI agent consumption.
See `ndbg-spec.md` for full specification, `PROGRESS.md` for implementation status.

## Tech Stack
- **Runtime**: Bun (compiled to standalone binary via `bun build --compile`)
- **Language**: TypeScript (strict mode)
- **Linting/Formatting**: Biome
- **Testing**: bun:test
- **Validation**: Zod v4 (mini)
- **Dependencies**: Minimal — leverage Bun built-ins (WebSocket, test runner, file I/O)

## Project Structure
```
src/
  cli/          # CLI argument parsing, command routing
  daemon/       # Background daemon process, Unix socket server
  cdp/          # Chrome DevTools Protocol WebSocket client
  refs/         # @ref system (mapping short refs to V8 IDs)
  formatter/    # Output formatting (variables, source, stack traces)
  commands/     # Command implementations (break, step, eval, etc.)
  protocol/     # CLI-to-daemon JSON protocol types
tests/
  unit/         # Unit tests
  integration/  # Integration tests
  fixtures/     # Test fixture scripts
```

## Commands
- `bun run dev` — run in development
- `bun test` — run all tests
- `bun run build` — compile standalone binary
- `bun run lint` — lint with biome
- `bun run format` — format with biome

## Guidelines
- Use Bun APIs over Node.js equivalents (WebSocket, Bun.serve, Bun.$, etc.)
- No ANSI colors by default (token efficiency for AI agents)
- Every error should suggest the next valid command
- Keep output compact — one entity per line where possible
- Use @refs for all inspectable entities in output
