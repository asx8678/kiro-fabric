# Kiro Fabric

Kiro Fabric gives Kiro CLI a way to run several tool operations as one checked TypeScript program, with repository navigation to help it find the code that matters.

## Problems it solves

| Problem | How Fabric helps |
| --- | --- |
| A task needs many model/tool round trips. | A program can search, read, branch on results and collect evidence in one execution. |
| Tool catalogs and raw output crowd the conversation. | Kiro discovers the capabilities it needs, processes intermediate results in code and returns selected evidence. |
| Search finds names but misses how code connects. | Fovea maps symbols and relationships, suggests relevant source ranges and estimates change impact. |
| A file changes between reading and editing. | File reads return SHA-256 hashes; `local.edit` requires the expected hash and rechecks the source before publishing the edit. |

[Install](#install) | [API and examples](skills/fabric-exec/references/api.md) | [Architecture](docs/architecture.md)

## Code Mode and programmatic tool calling

**Code Mode** means Kiro writes a small program to use its tools. The Fabric agent profile exposes one execution tool, `@fabric/fabric_exec`, whose `code` field accepts a TypeScript function body with `await` and `return`.

**Programmatic tool calling** is what happens inside that program: tools become async function calls whose results can feed variables, conditions, loops and bounded parallel work. Intermediate steps execute without another model turn. Kiro still chooses the plan and interprets the evidence; you describe the task in chat.

For example, this program finds `createKiroRuntime` in this repository and reads up to four suggested source windows:

```ts
const map = await repo.focus({ query: "createKiroRuntime", maxTokens: 700 });
const windows = map.reads.slice(0, 4);
const sources = windows.length
  ? await local.readMany({ windows, maxChars: 14000, partial: true })
  : null;

return {
  navigation: map.text,
  coverage: map.coverage,
  truncated: map.truncated,
  sources,
  deferredReads: map.reads.slice(4),
};
```

Navigation and source reading happen in one tool call. The returned coverage, unread ranges and deferred windows show what still needs inspection. `repo.focusRead` provides a shortcut for this workflow.

## How Kiro Fabric works

```text
Kiro -> fabric_exec -> TypeScript check -> fresh QuickJS execution
                                              |
                                       Action registry
                                              |
                             Local tools / Navigator / MCP / state
                                              |
Kiro <---------- bounded results <------------+
```

Kiro owns the conversation and reasoning. A private MCP backend runs Fabric: it checks the program's types, executes it in a fresh QuickJS context, and routes tool calls through an action registry. Each action still receives argument validation, workspace checks where required, approval policy and execution limits.

Programs can use local file/search/edit/shell tools, Navigator, workspace memory and state, review evidence, retained probes, and explicitly configured MCP servers. `tools.providers()`, `tools.search()` and `tools.describe()` expose availability and schemas as needed.

Only returned values and printed logs become ordinary program output; Fabric also reports failures and output overflow. Guest variables end with each execution. Workspace memory/state persist separately, and optional [task recovery](docs/configuration.md#deterministic-task-recovery-opt-in) stores declared checkpoints.

Direct file writes default to asking for approval. Shell execution defaults to allowed and runs with host OS authority: QuickJS isolation and separate file/network policies do not confine shell effects. Completed effects are not rolled back if a later step fails. See [configuration and boundaries](docs/configuration.md).

## Fovea: repository intelligence

**Navigator** is the current public name for Fabric's Fovea component; its API is `repo.*`. It uses ast-grep to extract code structure, builds a graph of symbols and relationships, and ranks relevant code within a token budget. A persistent analysis process reuses graph state across calls.

| Feature | API | What it provides |
| --- | --- | --- |
| Repository overview | `repo.sketch` | A compact architecture map with extraction coverage. |
| Focus and exploration | `repo.focus`, `repo.dwell` | Find symbols, approximate names, paths, routes or protocol IDs; expand into related code. |
| Change impact | `repo.impact` | Likely affected code from files, symbols, uncommitted changes or a Git base, with historical co-change suggestions. |
| Source inspection | `repo.focusRead` | Compose navigation with actual file reads that validate the suggested source hashes. |
| Hybrid search | `repo.grep` | Combine exact local matches with separate graph hints; configurable off, augment or replace modes. |
| Result reuse | `repo.result`, `repo.searchResult` | Page or search a retained result without repeating analysis. |
| Project knowledge | `repo.anchors`, `repo.rules`, `repo.adoptRules` | Inspect feature anchors and rules; explicitly approve project rules by content hash. |
| Controls | `repo.status`, `repo.settings`, `repo.configure` | Check availability and manage session, project or global settings. |

Standard and review profiles instruct Kiro to use Navigator for repository tasks. Brief context hints can also accompany successful file operations in the same execution. `repo.sync` explicitly reconciles observations; `repo.reset` clears navigation, while `repo.reload` restarts the shared analysis engine.

Graph results guide inspection. Read the source and check coverage before drawing conclusions; co-change suggests files worth checking, not mandatory edits. If a source hash is stale, refresh navigation and read again. See [Navigator usage and limits](skills/fabric-exec/references/fovea.md).

## Install

Requires macOS or glibc Linux, Node >=24, pnpm **11.20.0**, ripgrep (`rg`) and Kiro CLI >=2.21.1 with v3 support.

From the Kiro Fabric checkout (not with `sudo`):

```sh
bash ./install.sh
```

The installer builds Fabric, copies it to `~/.kiro/kiro-fabric`, and writes the `kiro-fabric` agent profile. Your data directory is preserved across updates.

Then, from the project you want Kiro to work on:

```sh
~/.kiro/kiro-fabric/bin/kiro-fabric
```

Restart existing sessions after updates. See [installation and troubleshooting](docs/installer.md).

## Current limitations

As of Kiro CLI 2.24.0 (2026-09-25), reads work but approval-dependent edits fail: the client reports `No handler registered for method: _kiro/mcp/elicitation`, so `ask` policies cannot be approved and fail closed. Complete model-visible tool filtering is also unverified.

Explicit Navigator analysis is implemented; automatic native prompt/turn delivery, session isolation and restoration remain unqualified. Same-call hints do not establish those guarantees.

## Development

| Command | Scope |
| --- | --- |
| `pnpm run check` | Guidance consistency, typecheck, build, dead-code lint and the test suite. |
| `pnpm test` | Vitest suite (serial by design). |
| `pnpm run build` | Fresh runtime output; Kiro loads `dist/`, so finish changes with this. |
| `pnpm run agent:dev` | Run the built MCP server against `.tmp/agent-dev-data`. |

[Detailed architecture](docs/architecture.md) | [Runtime diagrams](docs/diagram-descriptions.md) | [Configuration](docs/configuration.md)
