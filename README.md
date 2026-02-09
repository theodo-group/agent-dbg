# agent-dbg

Node.js debugger CLI built for AI agents. Fast, token-efficient, no fluff.

**Why?** Agents waste tokens on print-debugging. A real debugger gives precise state inspection in minimal output — variables, stack, breakpoints — all via short `@ref` handles.

## Install

Requires [Bun](https://bun.sh).

```bash
bun install --global agent-dbg
npx skills add theodo-group/agent-dbg # Install skills
```

## Example
```bash
> agent-dbg launch --brk tsx src/app.ts
Session "default" started (pid 70445)
Paused at ./src/app.ts:0:1

> agent-dbg break src/app.ts:19
BP#1 set at src/app.ts:19

> agent-dbg continue
⏸ Paused at ./src/app.ts:19:21 (other)

Source:
   16│
   17│const alice: Person = { name: "Alice", age: 30 };
   18│const greeting: string = greet(alice);
 → 19│const sum: number = add(2, 3);
                          ^
   20│console.log(greeting);
   21│console.log("Sum:", sum);
   22│

Locals:
@v1  greet     Function greet(person)
@v2  add       Function add(a,b)
@v3  alice     Object { name: "Alice", age: 30 }
@v4  greeting  "Hello, Alice! Age: 30"

Stack:
@f0  (anonymous)  ./src/app.ts:19:21
@f1  run          node:internal/modules/esm/module_job:413:25

Breakpoints: 1 active
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
