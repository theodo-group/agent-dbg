# agent-dbg

Node.js debugger CLI built for AI agents. Fast, token-efficient, no fluff.

**Why?** Agents waste tokens on print-debugging. A real debugger gives precise state inspection in minimal output — variables, stack, breakpoints — all via short `@ref` handles.

## Install

Requires [Bun](https://bun.sh).

```bash
bun install --global agent-dbg
npx skills add theodo-group/agent-dbg # Install skills
```

## Usage

```bash
agent-dbg launch --brk node app.js
# Session "default" started (pid 12345)
# Paused at app.js:1:1

agent-dbg break src/handler.ts:42
# BP#1 src/handler.ts:42

agent-dbg continue
# Paused at src/handler.ts:42:5 (breakpoint)

agent-dbg vars
# @v1  x      42
# @v2  name   "alice"
# @v3  opts   {timeout: 3000}

agent-dbg props @v3
# @o1  timeout  3000

agent-dbg eval "x + 1"
# 43

agent-dbg step over
# Paused at src/handler.ts:43:5 (step)

agent-dbg set @v1 100
# @v1 changed to 100

agent-dbg stop
```

## Commands

| Category | Commands |
|---|---|
| Session | `launch`, `attach`, `stop`, `status`, `sessions` |
| Execution | `continue`, `step [over\|into\|out]`, `pause`, `run-to`, `restart-frame` |
| Inspection | `state`, `vars`, `stack`, `eval`, `props`, `source`, `scripts`, `search`, `console`, `exceptions` |
| Breakpoints | `break`, `break-rm`, `break-ls`, `break-toggle`, `breakable`, `logpoint`, `catch` |
| Mutation | `set`, `set-return`, `hotpatch` |
| Blackbox | `blackbox`, `blackbox-ls`, `blackbox-rm` |

Run `agent-dbg --help` or `agent-dbg --help-agent` for the full reference.
