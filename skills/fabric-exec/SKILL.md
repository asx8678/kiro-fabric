---
name: fabric-exec
description: Code Mode mechanics for Kiro Fabric - checked TypeScript programs that navigate, read, edit, run shell commands, keep durable state and call configured MCP tools through the single fabric_exec tool.
license: MIT
compatibility: Kiro CLI v3 with the Kiro Fabric Agent enabled
---

# Fabric execution

This skill covers how to write `fabric_exec` programs. The standing prompt decides what to do; nothing here grants permission for an effect.

A program is a TypeScript function body. `await` calls and `return` the evidence you need; pass long strings as named string `payloads`. The sandbox has no imports, process, filesystem, timers or direct networking. A type error runs nothing, so fix it and resend. Discover unfamiliar APIs with `tools.providers()`, `tools.search({query})` and `tools.describe({ref})` instead of guessing.

Namespaces: `repo` (Navigator), `local` (files, search, shell), `state` (durable workspace data), `mcp` (configured external tools), `artifacts` (large outputs), `fabric` (help, info, workspace).

## Navigator-first code navigation

Navigator maps symbols and their relationships. Use it to find and understand code you have not read yet. `repo.focusRead` combines focus with hash-bound source reads; pass an in-workspace symbol or path as the string payload `query`:

```ts
const {navigation, sources, deferredReads} = await repo.focusRead({query:payloads.query,maxTokens:700,maxWindows:4,maxChars:12000,partial:true});
return {map:navigation.text, truncated:navigation.truncated, files:(sources?.files ?? []).map(file => ({path:file.path, sha256:file.sha256, source:file.source})), remaining:sources?.remaining ?? [], deferred:deferredReads};
```

- `repo.focus({query})`: known symbol or path. `repo.sketch({})`: unfamiliar repository. `repo.impact({files})`: likely affected code before a change. Add `fresh:true` after edits.
- Pass `repo.focus(...).reads` to `local.readMany` when you want to choose windows yourself.
- Results are leads, not proof. Check `coverage`, deferred reads and unread tails before concluding. Coverage detail lists are summarized as counts; `repo.result({resultId})` replays the full packet when you need them. On unavailable/no-match results, say so and fall back to `local.find`/`local.grep` plus reads. A sparse sketch reflects index coverage, not code volume: PowerShell, C#, Helm templates and pipeline YAML get no symbol graph, so inventory them with `local.find`.
- A stale hash means the file changed: refresh and reread; never drop the hash. See [Navigator reference](references/fovea.md) for retained results and settings.

## One program, many steps

Chain dependent mechanical steps in one execution and return only what matters:

```ts
const hits = await local.grep({pattern:payloads.symbol, glob:"src/**/*.ts", limit:20});
const paths = [...new Set(hits.matches.map(match => match.path))].slice(0, 6);
const source = await local.readMany({windows:paths.map(path => ({path, limit:200})), maxChars:20000, partial:true});
return {matches:hits.matches.length, truncated:hits.truncated, files:source.files.map(file => ({path:file.path, sha256:file.sha256, source:file.source})), remaining:source.remaining};
```

Use `parallel(items, item => call(item))` for independent calls. Local shell/write/edit calls run in order within an execution and a failure stops the later ones; reads are not queued, so await a write before reading what it changed.

## Reading

- `local.read({path,offset?,limit?})` returns `{text, sha256, totalLines, truncated, nextOffset?}`: one-based lines, default 200, max 2000. It reads UTF-8 text only.
- `local.readMany({windows,maxChars?,partial?})` batches up to 32 windows and returns `{files, remaining, complete, unreadTails}`. Continue `remaining` exactly as given, then any relevant `unreadTails`. `complete` covers the requested windows, not whole files. With `partial:true`, per-window failures are reported instead of aborting.
- Result shapes differ: `local.read` returns `text`; each `local.readMany` file has `path`, `startLine`, `endLine`, `totalLines`, `sha256`, `source` and `truncated`, with no `text`; `local.grep` returns `matches` of `{path, line, text}`; `local.find` returns `paths`, not `matches`. `readMany` accepts `maxChars` up to 40000: split larger reads or follow `remaining`.
- `local.find({pattern})` globs paths; `local.grep({pattern,glob?,literal?})` searches contents; `local.list({path})` lists direct children only. Use `hidden:true` for dotfiles and CI config. If a search is truncated, narrow it before claiming something is absent.

## Editing

Read the current file first, then edit using that read's hash:

```ts
const file = await local.read({path:payloads.path, limit:1});
return await local.edit({path:payloads.path, expectedSha256:file.sha256,
  edits:[{oldText:payloads.oldText, newText:payloads.newText}]});
```

- `edits` apply to one snapshot of the file; each `oldText` must match exactly once (or set `all:true`). Invalid or overlapping edits change nothing.
- `local.write({path,content})` creates a file; replacing one needs `overwrite:true` plus `expectedSha256`.
- On a hash conflict, reread and reconsider. Never rehash and retry blindly.

## Shell

`local.shell({command, settle:true, timeoutMs?})` returns `{ok, exitCode, stdout, stderr, truncated}`. `settle:true` turns an ordinary nonzero exit into data; denial, timeout, cancellation and spawn failures still throw. `command` runs under `/bin/sh`. For Bash use `{script:payloads.script, interpreter:"bash", args:[]}`; args are passed literally, and `JSON.stringify` is not shell quoting. Shell timeoutMs <= 900000. Give the outer `fabric_exec` call extra time for compilation and cleanup: for `local.shell({command:"pnpm test",timeoutMs:120000})`, use outer timeoutMs: 180000. Shell runs with host authority, and background jobs are not managed.

## Results and output size

Everything you return stays in the conversation and is re-sent on later turns. Return decisions, evidence, failures and truncation/continuation flags, not whole files, packets or command logs. A returned string is shown as plain text; other values are shown as JSON. `readMany` defaults to 32000 JSON characters (max 40000); lower `maxChars` when you return several results. Oversized output can spill into an artifact; page it with `artifacts.read({id,offset})` rather than rerunning effects.

## Workspace, state and external tools

- A single verified workspace binds automatically. Only when needed: `fabric.workspace({action:"list"})`, then `fabric.workspace({action:"select",rootId})` in a separate execution; the switch applies after that execution succeeds.
- `state.get/set/list/search/delete` persist across restarts and are shared by every chat on the workspace. Use task-specific keys and `expectedRevision` on updates.
- MCP servers are available only when configured: `mcp.servers()`, `mcp.tools({server})`, `mcp.describe({server,tool})`, then `mcp.call`. Follow returned page continuations for large catalogs.

## Help topics

`fabric.help({topic,offset?,limit?})` pages bundled reference text (zero-based character offsets; follow `nextOffset`). Load only what the task needs.

| Topic | Contents |
| --- | --- |
| `api` / `guide` | Full type declarations and contracts, MCP catalogs |
| `recipes` | Search/read composition, edits and validators |
| `workflow` | Investigation evidence, verification, reporting and Git/GitHub procedures |
| `review` | Coverage tracking, finding evidence and counterexamples |
| `overview` / `skill` | Short bootstrap or this text |
