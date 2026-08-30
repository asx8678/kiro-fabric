---
name: fabric-exec
description: >-
  Managed Kiro reference for writing type-checked fabric_exec programs with
  bounded coding tools, discovery, MCP, memory, and optional Kiro ACP agents.
  Use after an argument-shape error or when an exact API contract is needed.
---

# fabric_exec for managed Kiro

Each call runs one type-checked TypeScript function body. Top-level `await` and
`return` are supported. Only the returned value reaches the model;
`print()`/`console.log()` are progress output. Named input strings are available
as `π.key`; `π` is not a tool.

Managed Kiro exposes only capabilities mounted for the current profile:

- `k` is the built-in, project-confined coding-tool namespace.
- `tools` discovers and calls mounted provider actions.
- `mcp` and `memory` exist only when enabled.
- `agents` exists only with the trusted `--allow-shell --subagents` opt-in and
  is never present inside a child.
- `state`, `schema`, `mesh`, `components`, `compact`, `extensions`, `pi`, and
  the global `agent()` helper are unavailable. Do not write programs that use
  them.

## Built-in `k` tools

| Call | Result |
|---|---|
| `k.read(pathOrOptions)` | bounded text, or an attached image note |
| `k.grep(patternOrOptions)` | matching path/line text |
| `k.find(patternOrOptions)` | matching project-relative paths |
| `k.ls(pathOrOptions?)` | sorted directory entries |
| `k.bash(commandOrOptions)` | `{ok:true,output,details}` |
| `k.edit({path,edits})` | `{ok,output,details}` |
| `k.write({path,content})` | `{ok,output,details}` |
| `k.readArtifact({id,offset?,limit?})` | a bounded overflow-artifact chunk |

String-primary calls accept a bare string or an options object. `grep` and
`find` also accept `(pattern, path?, limit?)`; `write` accepts `(path, content)`;
`edit` accepts `(path, oldText, newText)`. For exact replacements prefer:

```ts
const hits = await k.grep({ pattern: "targetSymbol", path: "src", context: 2 });
const source = await k.read({ path: "src/engine.ts", offset: 120, limit: 80 });
return { hits, source };
```

Search before reading. Text reads are bounded to 2,000 lines or 50KB, repository
search respects `.gitignore`, and shell output is retained in bounded memory.
Use offsets for later file windows and the returned artifact path/id for
overflow output.

`k.bash` rejects on a nonzero exit. Add `settle: true` only when a nonzero exit
is expected and belongs in control flow:

```ts
const result = await k.bash({ command: "test -f optional.txt", settle: true });
return result.ok ? "present" : { present: false, exitCode: result.exitCode };
```

Timeout, cancellation, approval, confinement, and spawn failures still reject.
For `bash`, `edit`, and `write`, read the `.output` field rather than treating
the result envelope as a string.

Keep multiline or syntax-heavy payloads out of `code`; pass them through
`strings` and read `π.key`, especially for shell heredocs.

## Discovery and generic calls

Use direct calls when the action is known. For uncertainty, read, describe,
retry:

```ts
const matches = await tools.search({ query: "project memory" });
const contract = await tools.describe({ ref: matches[0]!.ref });
return { contract, value: await tools.call({ ref: matches[0]!.ref, args: {} }) };
```

Refs are namespaced; bare names fail. `tools.providers()`, `tools.catalog()`,
`tools.search()`, `tools.describe()`, `tools.list()`, and `tools.call()` reflect
the current capability view. An unavailable provider is omitted and fails
closed if called.

## Optional providers

Managed memory is project-scoped:

- `memory.get({key})`
- `memory.set({key,value})`
- `memory.search({query,limit?})`
- `memory.index()`

For configured MCP servers, read
`<skill-dir>/references/mcp.md`. For explicitly enabled Kiro ACP children, read
`<skill-dir>/references/agents.md`. Those references describe only the managed
Kiro surface.

## Error recovery

Use the line-numbered type or validation error, inspect the effective action
with `tools.describe({ref})`, match its `inputSchema`, and retry once with the
correct shape. Do not guess provider names, add an unavailable namespace, or
turn an approval failure into a different call path.
