# Checked guest API

## Top-level `fabric_exec` input

- `code: string` — required TypeScript function body; 1 to the enforced source limit
- `payloads?: Record<string, string>` — named immutable string inputs
- `resultFormat?: "auto" | "json" | "text"`
- `timeoutMs?: number` — invocation request bounded by Agent policy

No extra input fields are accepted. Type errors stop execution before QuickJS or any provider call.

## Local and bootstrap facades

All calls below run inside `fabric_exec`, cross the bounded JSON registry bridge, validate closed schemas and follow exact inner approval policy. There are no native Kiro tools. Paths default to the verified workspace, never process cwd. Missing/ambiguous roots allow bootstrap, not workspace effects.

Call-shape catalogue, not an executable program: await each selected call inside fabric_exec. Workspace selection must be its own execution, separate from all workspace effects. Use the tagged [recipes](recipes.md) for complete executable programs.

```ts
fabric.info()
fabric.help({topic: "overview", offset: 0, limit: 4000}) // topics: api, skill, guide, recipes, workflow, review; zero-based UTF-16 paging
fabric.workspace({action: "status"}) // or "list"
fabric.workspace({action: "select", rootId: "root-id"})

local.list({path: ".", limit: 100}) // inspect the workspace before selecting files
local.read({path: "discovered/file.md", offset: 1, limit: 80}) // use an observed path
local.grep({pattern: "TODO", path: "src", literal: true, ignoreCase: false, limit: 20})
local.find({pattern: "**/*.ts", path: "src", limit: 20})
local.list({path: "src", limit: 20})
local.write({path: "note.txt", content: payloads.content})
local.edit({path: "note.txt", oldText: payloads.old, newText: payloads.next})
local.shell({command: "pnpm test", timeoutMs: 120000, settle: true})
```

For that shell example pass **outer `timeoutMs:180000`**. Await each call and return only needed results. Optional `cwd` is canonical/verified but not shell confinement. Shell `timeoutMs` is at most 900000. Provider-generated `review` carries the exact canonical command/cwd or diff for approval; it is not caller-supplied authorization. There is no background job guarantee.

Use supplied/observed task paths directly, without routine listing/help. For an unknown layout begin inspection with `local.list({path:".",limit:100})`, then discover relevant files (for example `local.find({pattern:"README*",path:".",limit:20})`) and read observed paths. A root README is not required. Check `truncated` before treating a discovery result as complete. Do not batch a speculative file read with the discovery it depends on. Search before reading unfamiliar files. Batch independent work; sequence dependent search/read/edit/test steps. `local` handles workspace coding, `mcp` configured external capabilities, `memory` intentional durable facts, and `state` revisioned task progress.

- `read({path,offset?,limit?})`: one-based lines (offset defaults 1), default 200/max 2000 lines per call; returns `{text:string,path,totalLines,truncated,nextOffset?,sha256,identity}`; `totalLines` is the whole-file line count (zero for an empty file). Use `.text.split(/\r?\n/,1)[0]` for a complete first line, not `.text[0]`; `.lines`/`.content` and bare-string methods are invalid. Read returns whole lines, never line fragments. `truncated` means unread file suffix, not necessarily missing requested content: for inclusive end line E, `nextOffset > E` means the requested range is covered. For explicitly requested ranges, continue only while the next unread line is in range, with bounded progress/hash checks; stop at the requested end. For reviews, cover relevant unread content or mark it unreviewed; see [review guidance](review.md). Binary/invalid UTF-8, special files and oversized single lines reject rather than inventing continuation.
- `grep({pattern,path?,glob?,literal?,ignoreCase?,hidden?,limit?})`: `{matches:[{path,line,text}],scope,truncated}`; line numbers are one-based, returned count is not total. `find({pattern,path?,hidden?,limit?})`: `{paths,scope,truncated}`; `pattern` is a glob, not a regular expression. Use `**/*_test.exs`, not `_test\.exs$`. Empty results from an incorrect pattern do not establish that files are absent. Search requires a trusted external `rg`, resolved and version-checked at provider startup; missing search fails early, never falls back to native tools. Executable identity stays pinned even if PATH later changes. Enumeration is deterministic and bounded, with ripgrep ignore rules and no config or shell interpolation. `hidden:true` includes dotfiles/CI directories (default false); an explicitly named hidden path can also be searched. Ignore rules still apply; positive globs only narrow that enumeration. VCS metadata (`.git`, `.hg`, `.svn`) and symlink traversal remain excluded. `scope:{path,glob?,hidden,ignoreFiles:true}` records the enumeration scope. Even `truncated:false` does not establish whole-repository absence. For a repository review, prefer one bounded `local.find({pattern:"**/*",hidden:true,limit:200})` manifest; partition by relevant subdirectory on truncation.
- `list({path?,limit?})`: sorted bounded direct children, including hidden entries; returns `{entries:[{path,type}],truncated}`. Only `path` and `limit` are accepted, not `depth`; this is not recursive. Use `find` for nested files or list an observed child directory.
- `write({path,content,overwrite?})`: create-only unless `overwrite:true`. `edit({path,oldText,newText,all?})`: nonempty exact unique anchor unless `all:true`. Both return `{path,changed,sha256,...}` bounded verification metadata; changed identity/content before publication rejects. No implicit multi-operation transaction.
- `readMany({windows:[{path,offset?,limit?,expectedSha256?}],maxChars?})`: numbered `files` with ranges, totalLines, hashes and suffix metadata; aggregate default 32000 JSON chars, maxChars 1000..40000, clamped to runtime budgets. Continue `remaining` verbatim; changed-file continuations fail. `complete` covers requested ranges only. Default 200/max 2000 lines per window, at most 32 windows. Lower maxChars when returning other substantial data. No automatic claim of inspection.
- `shell({command,cwd?,timeoutMs?,settle?})`: `{ok,exitCode,signal,stdout,stderr,truncated,stdoutTruncated,stderrTruncated}`. Ordinary nonzero exits return data with `settle:true`; otherwise they reject with the same bounded data on `error.result` (narrow to `Error` first). Failed outer execution also exposes the last ordinary nonzero result as `lastShellFailure`. Both streams retain deterministic head and tail with truncation flags; output is not embedded into audit/error messages. Denial, spawn failure, cancellation, timeout and uncertain cleanup always fail. `command` uses `/bin/sh` on supported POSIX hosts. Alternatively pass `{script,interpreter:"bash"|"sh",args?,cwd?,timeoutMs?,settle?}`; script defaults to sh, with literal script/positional arguments and no outer expansion or scratch file. Specify exactly one of command/script; bounded streams/deadline, process-group TERM/KILL cleanup, no managed background jobs. Deliberate process-group escape is not contained.

Use `tools.describe({ref:"local.read"})` (and the other exact refs) for current numeric bounds/defaults and complete schemas; limits also depend on the configured bridge budget. Over-budget requests fail rather than authorizing invisible suffixes. Local path checks reject traversal, symlink components, multiply linked and special files. They are defense in depth, not race-proof OS isolation against same-user filesystem attackers. Within one Code Mode execution, write/edit/shell calls queue FIFO before preparation and approval (including `tools.call`); a failed predecessor stops remaining local effects. Reads/searches remain concurrent. Across executions/processes, write/edit/shell conflicts still reject before approval; external editors do not obey Fabric locks.

`fabric.help({topic:"overview"|"api"|"skill"|"guide"|"recipes"|"workflow"|"review",offset?,limit?})` pages immutable compiled help/declarations by zero-based UTF-16 character offset; it does not read a workspace or bundled file at request time. Workspace helpers return JSON objects. Selection returns `{status:"pending",committed:false,nextExecutionRequired:true}` in guest code. After successful settlement the MCP response carries bounded `Workspace transition` sideband evidence with `committed:true`; failure/cancellation does not commit. Never mix selection with workspace effects in either order. Compatibility attach/detach remain validated operator operations, not an ambient model tool. `fabric.info`/`fabric.help` remain usable for recovery without native reads.

## Client approval readiness

Missing approval overrides default to `read: allow`, `write: ask`, `execute: allow`, `network: ask`. Shell execution is enabled by default in a verified workspace and does not require client elicitation. Shell commands have host authority, including filesystem writes and network access; separate write/network policies do not confine them. Explicit `ask`/`deny` settings are preserved on update and remain authoritative. Outer `fabric_exec` permission is not nested approval. `approval was denied or unavailable` can mean an explicit restriction, decline, cancellation or a broken/missing confirmation path. Stop affected effects and inspect the cause; do not repeatedly retry, use native fallback, or switch to blanket allow.

If the client logs `No handler registered for method: _kiro/mcp/elicitation`, its approval UI handler is missing in that session even if `fabric.info()` reports form elicitation support. This was observed with Kiro CLI 2.21.2 v3; do not assume every client/version is affected. Default shell execution does not need this handler, but operations configured as `ask` still do. Check for an official client fix and start a new conversation; reinstalling Fabric cannot supply a Kiro UI handler. Report affected approval-dependent operations as blocked and preserve `ask` policies.

A healthy installation doctor, valid profile, build, tests or advertised capability is not live coding-readiness evidence. Verify actual shell results and exact edited bytes. To qualify the approval UI rather than default shell execution, configure `execute: ask` and require an explicitly human-approved shell command and file edit through the actual v3 UI, retaining declined/no-effect controls. Use disposable fixtures; never count automatic fixture approvals as human interaction.

## Globals

```ts
payloads: Readonly<Record<string, string>>
print(...values: unknown[]): void
parallel(items, mapper, options?): Promise<unknown[]>
parallel(tasks, options?): Promise<unknown[]>

tools.providers(): Promise<Array<{
  name: string; description: string; available: boolean; reason?: string
}>>
tools.list(): Promise<FabricActionSummary[]>
tools.search(input: string | { query: string; limit?: number }): Promise<FabricActionSummary[]>
tools.describe(input: string | { ref: string }): Promise<FabricActionSummary>
tools.call(input: { ref: string; args?: JsonObject }): Promise<JsonValue>

artifacts.read(args: { id: string; offset?: number; limit?: number }): Promise<JsonValue>

memory.get(args: { key: string }): Promise<JsonValue>
memory.set(args: { key: string; value: JsonValue }): Promise<JsonValue>
memory.search(args: { query: string; limit?: number }): Promise<JsonValue>
memory.index(args?: Record<string, never>): Promise<JsonValue>
memory.delete(args: { key: string }): Promise<JsonValue>

state.get(args: { key: string }): Promise<JsonValue>
state.set(args: { key: string; value: JsonValue; expectedRevision?: number }): Promise<JsonValue>
state.list(args?: { limit?: number }): Promise<JsonValue>
state.delete(args: { key: string; expectedRevision?: number }): Promise<JsonValue>

mcp.servers(args?: Record<string, never>): Promise<JsonValue>
mcp.tools(args: { server: string }): Promise<FabricMcpToolSummary[]>
mcp.describe(args: { server: string; tool: string }): Promise<FabricMcpToolSummary>
mcp.call(args: { server: string; tool: string; args?: JsonObject; expectedDescriptorDigest?: string }): Promise<JsonValue>
```

`FabricActionSummary.ref` is the exact `provider.action` reference. Action summaries include the full bounded public descriptor plus `descriptorDigest`; search ranks exact refs/names and token matches across descriptions, providers, namespaces, annotations, and schemas deterministically. `tools.call` validates the exact descriptor schema before approval and invocation. `mcp.tools` and `mcp.describe` contact only one explicitly configured server after network approval (and stdio/OAuth execution approval where applicable), returning bounded descriptors tied to transport/configuration and definition digests. For stdio, that transport digest binds the resolved executable plus every argument that resolved to a regular file when the transport was first bound for that server (path, inode, and content); the bound set is frozen for the runtime, so files an approved server itself creates (pid, log, or socket targets named by its own arguments) never shift the digest, while literal argument strings stay bound. It does not recursively attest a script's imported dependency graph. Standard MCP tool annotations are preserved in the descriptor digest but never grant approval. `mcp.call` rediscovers and validates the exact advertised remote schema at invocation time; pass `expectedDescriptorDigest` from discovery to reject intervening descriptor drift before the tool call.

`parallel` preserves input order and runs at most the requested number of mapper tasks, capped by `executor.maxConcurrentProviderCalls`. All guest-to-host calls share one execution-wide queue at that same cap, including nested `parallel` helpers and direct `Promise.all`, so excess bridge work waits instead of crossing the host concurrency quota.

All values crossing the bridge must fit the JSON budgets. Cycles, proxies, unsupported values, over-depth objects, over-budget logs/results, and malformed provider output fail closed. `print` output is returned in a bounded `Fabric logs` sideband after the formatted value. Cancellation and the effective request deadline propagate through nested calls.

QuickJS intentionally has no host imports, dynamic import, built-in modules, process object, environment variables, timers, filesystem, shell, or unrestricted network.
