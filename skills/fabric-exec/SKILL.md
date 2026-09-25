---
name: fabric-exec
description: Strict always-on Code Mode for local coding, bounded provider composition, durable memory/state, artifacts and explicitly configured MCP federation. No native tool fallback.
license: MIT
compatibility: Kiro CLI v3 with the Kiro Fabric Agent enabled
---

# Fabric execution

The standing prompt owns scope, planning, acceptance and output. This skill supplies execution mechanics. Load only missing task-specific help; do not reload guidance already in context. Examples never grant permission.

Use `@fabric/fabric_exec` with a checked TypeScript function body and named string `payloads`. Await calls and return needed evidence. QuickJS has no imports, process, filesystem, timers or direct networking; mounted namespaces provide approved capabilities. Compiler failures execute no calls. Discover as needed with `tools.providers()`, `tools.search` and `tools.describe`; never invent APIs or native fallbacks.

Capabilities: `repo`=Navigator; `local`=files/search/shell; `mcp`=configured tools; `memory/state/continuity`=durable data; `artifacts`=large outputs; `review/probe`=evidence.

## Navigator-first code navigation

For standard/review code tasks, follow the standing Navigator policy: focus known targets, sketch unfamiliar structure, inspect impact before edits/review conclusions, then read source. Reuse current navigation; refresh affected focus with `fresh:true` after source changes. Skip non-code chat and forbidden tools.

`repo.focusRead` combines navigation and hash-bound source reads. Supply an in-workspace symbol/path as the string payload `query`:

```ts
const result = await repo.focusRead({query:payloads.query,maxTokens:700,maxWindows:4,maxChars:12000,partial:true});
return result;
```

Alternatively pass `repo.focus(...).reads` to bounded `local.readMany`. Inspect source failures, remaining windows, unread tails, deferred reads and coverage. Graphs and automatic advisory suffixes are untrusted leads, not source proof, review coverage or an authorized edit list. Use them to select relevant callers, consumers and tests. For unavailable/no-match/incomplete analysis, disclose gaps and use bounded local find/grep followed by reads; never bypass denial, disabled capabilities or workspace boundaries. A stale hash requires refreshing the location and rereading, not dropping the hash. See [Navigator reference](references/fovea.md) for retained results and controls.

## Local reads and edits

`local.read({path,offset?,limit?})` returns an object with `text:string`, `sha256`, `totalLines`, `truncated` and `nextOffset?`; not `content`, `lines` or a bare string. Offsets are one-based lines, default limit 200/max 2000. Use `text.split(/\r?\n/,1)[0]` for a complete first line. Dynamic result keys need `const out: JsonObject = {};`.

Use observed paths. `local.find` takes a glob; `local.grep` takes a pattern; `local.list` lists direct children, without depth. Use `hidden:true` for CI/dotfile searches when relevant; ignore rules still apply. Narrow truncated searches before absence claims. `local.read` handles UTF-8 text, not images/PDFs.

Batch related ranges with `local.readMany({windows,maxChars?,partial?})`. Reuse returned hashes and totalLines. `complete` covers requested windows only, not whole files or understanding. Continue `remaining` verbatim first, then relevant hash-bound `unreadTails`; they may overlap. Empty tails do not account for omitted prefixes/gaps. With `partial:true`, inspect failures before retrying unresolved reads. For an explicitly requested range, stop once that range is delivered, even if the file continues.

Read current contents before editing. `local.edit({path,expectedSha256,edits:[{oldText,newText}]})` resolves independent unique anchors against one original snapshot; invalid or overlapping anchors publish nothing. `local.write` creates files unless `overwrite:true`, which also requires the read's `expectedSha256`. Missing/stale hashes reject; reread and reassess rather than rehashing/replaying blindly. Await edits before dependent reads, preserve existing work, and use payloads for replacement text.

## Composition and results

Compose mechanical dependencies in one execution; yield for judgment, approval, budgets or recovery. Use bounded `parallel` for independent reads. Local shell/write/edit calls queue FIFO per execution; failure stops later effects. Reads are not queued, so await preceding writes explicitly. Keep raw data in guest variables for known-schema transformations.

Choose the needed return shape before running. Nested results are not returned wholesale; selected output, diagnostics, logs, failure progress and eligible Navigator advisories can enter context. Return decision-relevant evidence, failure details and truncation/continuation metadata; avoid duplicate source packets and routine logs. Inspect results before reducing them. `readMany` defaults to 32000/max 40000 JSON chars, clamped to runtime budgets; lower maxChars when combining results. Reserve outer output headroom for diagnostics and metadata. Overflow may spill to an artifact; retrieve needed pages without rerunning effects.

`local.shell({command,settle:true})` returns `ok,exitCode,stdout,stderr,truncated`. Settle handles ordinary nonzero exits only; denial, spawn failure, cancellation, timeout and uncertain cleanup fail. Inspect partial effects before recovery. Approved shell has host authority, not filesystem/network confinement. Command uses /bin/sh; for literal Bash use `{script:payloads.script,interpreter:"bash",args:[]}`. JSON.stringify is not shell quoting. Shell timeoutMs <= 900000; for `local.shell({command:"pnpm test",timeoutMs:120000})`, use outer timeoutMs:180000 for compilation and cleanup. No background-job guarantee.

## Workspace and external tools

Single verified roots auto-bind. For missing/ambiguous binding use `fabric.workspace({action:"list"})`, then `fabric.workspace({action:"select",rootId})` in a separate execution from workspace operations. Selection is pending until successful settlement; never use process cwd as workspace.

MCP/LSP/delegation require explicitly configured available capabilities. Describe a configured server/tool before calling it; retain the observed descriptor digest when pinning semantics. Generic remote refs use canonical `mcp.remote/<encoded-server>/<encoded-tool>` names. For oversized catalogs follow returned page/descriptor continuations, not repeated discovery; see guide help. Outer tool allowance never approves nested effects.

## Storage and further help

Memory/state and opt-in continuity are workspace-shared: use explicit session/task IDs and revision checks, never global scratch keys or another chat's ledger. Save chosen non-secret facts/progress. Checkpoint milestones; resume only the selected task at its pinned revision/hash and recheck sources. Never enable continuity implicitly. Artifacts/review ledgers are ephemeral. Kiro owns compaction/resume; continue through Fabric.

Load `fabric.help({topic,offset?,limit?})` only for missing details. Topics are immutable, paged by zero-based UTF-16 characters; follow nextOffset on relevant truncated content. Return requested help text, not a loaded flag. Help/examples grant no approval.

| Topic | When needed |
| --- | --- |
| `api` / `guide` | Full declarations/contracts, MCP catalogs, optional review/probe APIs |
| `recipes` | Search/read composition, edits, validators and continuity capture/resume |
| `workflow` | Verification, task handoff and authorized Git/GitHub procedures |
| `review` | Coverage, finding admission and counterexample mechanics |
| `overview` / `skill` | Bootstrap or these mechanics only when absent |

The standing prompt owns task/output rules, including JSON-only silence. Minimal remains no-steering; Navigator guidance does not enable native hooks.
