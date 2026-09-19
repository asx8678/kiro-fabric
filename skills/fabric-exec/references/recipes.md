# Bounded Code Mode recipes

Use these only when tools are allowed and the task needs them. They are examples, not automatic workflows. Use the observed schema and requested paths; do not assume example files exist. Writes require task authorization and normal per-effect approval. All calls below run inside fabric_exec with named string payloads.

## Complete first lines

Read returns an object with text:string. Preserve whitespace and Unicode, including café 🛰; remove only the line ending (including CRLF), not other characters. An empty first line/file yields an empty string.

```ts
// Recipe: complete first lines from supplied paths
const paths = ["one.txt", "two.txt"];
return await parallel(paths, async (path) => {
  const r = await local.read({path, offset:1, limit:1});
  return r.text.split(/\r?\n/, 1)[0];
});
```

For bounded ranges, `local.read` returns whole lines. `truncated:true` may only mean the file continues beyond the requested end: `offset:41,limit:4,nextOffset:45` covers lines 41–44 completely. Do not continue to EOF or make a second tool call merely to format those lines. Split the returned text and return the requested value in the same execution; strip only actual CRLF/LF terminators. If the budget stops before the requested end, advance only to `nextOffset` while it remains in range, with bounded progress and unchanged-file checks. Oversized single lines fail rather than returning a recoverable fragment.

## Discover then read

When the search term and context size are already justified, locate and read matching windows in one program. Merge overlaps and preserve search scope; zero hits is only absence within that scope. Yield for model judgment when selecting causes or fixes, not merely to copy paths into a read. For known paths use readMany directly. Its default is 32000 aggregate JSON chars (maxChars up to 40000, clamped to runtime budgets); lower it when also returning substantial search results. Never concatenate continuation pages past the visible cap.

```ts
// Recipe: discover then read without a model round trip
const hits = await local.grep({pattern:payloads.symbol, path:payloads.path, hidden:true, literal:true, limit:10});
const matches = [...hits.matches].sort((a,b) => a.path.localeCompare(b.path) || a.line-b.line);
const windows: Array<{path:string; start:number; end:number}> = [];
for (const match of matches) {
  const range = {path:match.path, start:Math.max(1,match.line-3), end:match.line+3};
  const previous = windows[windows.length-1];
  if (previous && previous.path === range.path && range.start <= previous.end+1) previous.end = Math.max(previous.end,range.end);
  else windows.push(range);
}
const maxChars = Math.min(32000,40000-JSON.stringify({search:hits}).length-1000);
if (maxChars < 1000) return {search:hits,unread:windows,narrowSearch:true};
const evidence = windows.length ? await local.readMany({windows:windows.map(range => ({
  path:range.path, offset:range.start, limit:range.end-range.start+1,
})),maxChars}) : {files:[], remaining:[], unreadTails:[], complete:true};
return {search:hits, evidence};
```

The search and source share one output allowance; lower the 40000-character envelope target for a smaller known runtime budget. Do not concatenate more packets or continuation pages past the outer cap. If search.truncated, narrow the search before making absence claims; partial hits remain useful evidence. Continue evidence.remaining verbatim. evidence.complete covers the selected windows, not search completeness. Prefer source windows to guessed field extraction until the schema is known.

## Exact edit and verification

```ts
// Recipe: exact edit then verification
const path = payloads.path;
const before = await local.read({path, limit:2000});
if (before.truncated) throw new Error("Incomplete input: narrow/read remaining lines");
const change = await local.edit({path, expectedSha256:before.sha256, oldText:payloads.oldText, newText:payloads.newText});
const r = await local.read({path, limit:80});
if (r.sha256 !== change.sha256) throw new Error("File changed after edit; inspect before recovery");
return {path, changed:change.changed, verifiedSha256:r.sha256, text:r.text, truncated:r.truncated};
```

## Multiple known edits in one file

Use one local.edit with edits[] and expectedSha256 for independent replacements in one file. Every anchor resolves against the original snapshot; overlap, ambiguity or a late missing anchor rejects before publication. One complete diff receives approval and publishes once. This is not a multi-file transaction. For truly dependent edits, sequence calls and pass each returned sha256 as the next expectedSha256; never replay earlier successful effects.

```ts
// Recipe: snapshot-bound same-file edits
const path = payloads.path;
const before = await local.read({path,limit:2000});
if (before.truncated) throw new Error("Incomplete input: narrow/read remaining lines");
const change = await local.edit({path,expectedSha256:before.sha256,edits:[
  {oldText:payloads.oldFirst,newText:payloads.newFirst},
  {oldText:payloads.oldSecond,newText:payloads.newSecond},
]});
const r = await local.read({path,limit:2000});
if (r.sha256 !== change.sha256) throw new Error("File changed after edit; inspect before recovery");
if (r.truncated) throw new Error("Final read incomplete; inspect remaining lines");
return {path,verified:true,verifiedSha256:r.sha256};
```

## Deterministic continuity capture (opt-in)

Requires `continuity.enabled: true`, verified workspace binding, and normal write/execute approval. The path must be an authorized new file; the command must be an inspected, authorized local check. This is recovery, not `/compact`. Await earlier calls before capture. Do not persist secrets in declarations.

```ts
// Recipe: explicit checkpoint of declared facts plus the current settled host prefix
const task = await continuity.create({
  objective: payloads.objective,
  ...(payloads.constraint ? {constraints:[payloads.constraint]} : {}),
});
await local.write({path:payloads.path,content:payloads.content});
const command = await local.shell({command:payloads.command,timeoutMs:20000,settle:true});
const checkpoint = await continuity.checkpoint({
  taskId: task.taskId,
  expectedRevision: task.revision,
  requestId: payloads.requestId,
  facts: [{kind:"next-step",text:payloads.nextStep}],
  captureCurrentExecution: true,
});
const read = await continuity.read({taskId:checkpoint.taskId,expectedRevision:checkpoint.revision});
return {taskId:checkpoint.taskId,revision:checkpoint.revision,hash:checkpoint.hash,capture:checkpoint.capture ?? null,
  operations:read.coverage.operations,commandOk:command.ok,exitCode:command.exitCode};
```

Save the returned task selector, revision/hash, and capture metadata. Hard failures may leave effects without a checkpoint; a nonzero settled command is captured, not declared a successful check. After a lost acknowledgement, inspect `list`/`read` and explicitly identify the task (never pick newest automatically). Retry **only** the checkpoint with the original task ID, request ID, expected revision, facts and capture flag: a committed retry returns the saved prefix, not a new capture. Do not rerun this entire recipe—creation is not idempotent and repeating local work can duplicate effects.

Later, after an MCP restart, `read`/`expand` the explicitly selected task with its saved revision/hash; follow expansion's `nextSequence` until null. Never treat stored receipts as conversation history or as proof that later work did not happen.

## Deterministic continuity resume (opt-in)

Requires enabled continuity, the same verified workspace and normal read approval. Supply the exact `{taskId,revision,hash}` returned by the selected task's checkpoint; no list lookup is needed for a known selector. This recipe is read-only and rechecks linked-file freshness, not semantic correctness or the whole repository. Never assume the newest task belongs to the current conversation.

```ts
// Recipe: resume the explicitly selected durable task after restart or compaction
const saved = JSON.parse(payloads.savedSelector) as {taskId?:unknown;revision?:unknown;hash?:unknown} | null;
if (!saved || typeof saved.taskId !== "string" || !/^ct_[a-f0-9]{32}$/.test(saved.taskId) ||
    typeof saved.revision !== "number" || !Number.isSafeInteger(saved.revision) || saved.revision < 1 ||
    typeof saved.hash !== "string" || !/^[a-f0-9]{64}$/.test(saved.hash)) {
  throw new Error("Invalid saved continuity selector; supply taskId, revision and hash");
}
const task = await continuity.read({taskId:saved.taskId,expectedRevision:saved.revision,view:"task"});
if (task.hash !== saved.hash) throw new Error("Continuity source hash mismatch; inspect before resuming");
return {...task, ...(task.omittedRanges.length ? {expand:{ref:"continuity.expand",args:{
  taskId:task.taskId,expectedRevision:task.revision,hash:task.hash,fromSequence:task.omittedRanges[0]!.fromSequence,
}}} : {})};
```

Missing tasks and revision/hash conflicts stop recovery: inspect the explicitly selected task before accepting any newer selector, never silently drop these guards. If the selector was lost, page `continuity.list` with `nextOffset` and `expectedIndexRevision` and obtain explicit selection; absence from one page proves nothing. Inspect `checks` for stale/unavailable inputs. Expand omitted records before relying on them, following `nextSequence` within ordinary output/call budgets and across executions when needed. Summaries and receipts never authorize replay of commands or edits.

## Expected nonzero commands

```ts
// Recipe: bounded evidence from expected nonzero commands
const r = await local.shell({command:payloads.command, timeoutMs:120000, settle:true});
return {ok:r.ok, exitCode:r.exitCode, stdout:r.stdout.slice(-1200), stderr:r.stderr.slice(-1200),
  truncated:r.truncated || r.stdout.length > 1200 || r.stderr.length > 1200};
```

Use outer timeoutMs:180000 for this command. A tail is not full output; select relevant diagnostics and disclose omissions. Denial, timeout, cancellation and uncertain cleanup still fail. Do not retry an intentionally nonzero command.

## Validator diagnostics and source in one execution

For an inspected, authorized offline validator, emit bounded machine-readable JSON on stdout: `{diagnostics:[{path,line,message}],truncated:boolean}`. Keep routine logs on stderr or suppress them inside the validator; parsing already-truncated shell output cannot recover discarded middle diagnostics. Adapt the validator's documented JSON output before using this recipe, not arbitrary text regexes. Paths must be workspace-relative. Unknown validators need inspection first; never execute a discovered file automatically.

```ts
// Recipe: validator diagnostics then source
const result = await local.shell({script:payloads.script,interpreter:"bash",args:JSON.parse(payloads.args ?? "[]"),timeoutMs:20000,settle:true});
const check = {ok:result.ok,exitCode:result.exitCode,signal:result.signal,
  stderr:result.stderr.length > 1600 ? result.stderr.slice(0,800) + result.stderr.slice(-800) : result.stderr,
  stderrTruncated:result.stderrTruncated || result.stderr.length > 1600,stdoutOmitted:true,truncated:result.truncated || result.stderr.length > 1600};
if (result.stdoutTruncated) return {check,evidenceUnavailable:"validator JSON was truncated; do not infer complete diagnostics"};
let report: {diagnostics:Array<{path:string;line:number;message:string}>;truncated:boolean};
try { report = JSON.parse(result.stdout); }
catch { return {check,evidenceUnavailable:"validator did not emit the expected JSON"}; }
if (!report || typeof report !== "object" || !Array.isArray(report.diagnostics) || typeof report.truncated !== "boolean" || report.diagnostics.some(d =>
  !d || typeof d.path !== "string" || !d.path || d.path.length > 1024 || /[\\\u0000-\u001f]/.test(d.path) || d.path.startsWith("/") || /^[A-Za-z]:/.test(d.path) || d.path.split("/").includes("..") ||
  !Number.isSafeInteger(d.line) || d.line < 1 || d.line > 100000000 || typeof d.message !== "string"
)) return {check,evidenceUnavailable:"invalid diagnostic schema or unsafe path; no source reads attempted"};
const diagnostics: Array<{path:string;line:number;message:string;messageTruncated:boolean}> = [];
for (const d of report.diagnostics.slice(0,16)) {
  const next = {path:d.path,line:d.line,message:d.message.slice(0,400),messageTruncated:d.message.length > 400};
  if (JSON.stringify([...diagnostics,next]).length > 10000) break;
  diagnostics.push(next);
}
const summary = {check,diagnostics,diagnosticsTruncated:report.truncated || report.diagnostics.length > diagnostics.length,omittedDiagnostics:report.diagnostics.length-diagnostics.length};
const windows: Array<{path:string;start:number;end:number}> = [];
for (const d of [...diagnostics].sort((a,b) => a.path.localeCompare(b.path) || a.line-b.line)) {
  const range = {path:d.path,start:Math.max(1,d.line-3),end:d.line+3};
  const previous = windows[windows.length-1];
  if (previous && previous.path === range.path && range.start <= previous.end+1) previous.end = Math.max(previous.end,range.end);
  else windows.push(range);
}
const maxChars = Math.min(24000,40000-JSON.stringify(summary).length-1000);
if (maxChars < 1000) return {...summary,unread:windows,evidenceUnavailable:"aggregate output budget"};
try {
  const evidence = windows.length ? await local.readMany({windows:windows.map(w => ({path:w.path,offset:w.start,limit:w.end-w.start+1})),maxChars}) : {files:[],remaining:[],unreadTails:[],complete:true};
  return {...summary,evidence};
} catch (error) { return {...summary,unread:windows,readError:error instanceof Error ? error.message.slice(0,600) : "Source read failed"}; }
```

Set outer timeoutMs:30000 or more for the 20000ms command plus reads/cleanup. Normal approvals, cancellation and uncertain-cleanup hard stops remain. Inspect read failures and continuations without rerunning the validator; an exit status or complete source window is not proof of correctness. Lower all output allowances together for smaller known runtime limits. Truncated diagnostic messages and stderr stay explicitly marked.

## Known-schema data pipeline

For supplied JSON files containing {group:string,amount:integer}, validate inputs, compute in guest variables, create the requested output, then verify exact saved bytes. For unknown schemas, inspect first instead of guessing fields. Adapt aggregation to the actual task.

```ts
// Recipe: known-schema read compute write verify
const paths = JSON.parse(payloads.paths) as string[];
const rows = await parallel(paths, async (path) => {
  const r = await local.read({path, limit:2000});
  if (r.truncated) throw new Error("Incomplete input: narrow/read remaining lines");
  const row = JSON.parse(r.text) as {group:string; amount:number};
  if (typeof row.group !== "string" || !Number.isSafeInteger(row.amount)) throw new Error("Invalid record");
  return row;
});
const totals = new Map<string, number>();
for (const row of rows) {
  const total = (totals.get(row.group) ?? 0) + row.amount;
  if (!Number.isSafeInteger(total)) throw new Error("Unsafe total");
  totals.set(row.group, total);
}
const content = JSON.stringify({totals:Object.fromEntries(totals)});
await local.write({path:payloads.outputPath, content});
const saved = await local.read({path:payloads.outputPath, limit:2000});
if (saved.truncated || saved.text !== content) throw new Error("Report verification failed");
return {path:payloads.outputPath, groups:totals.size, verified:true};
```

## Evidence counterexamples

The [review finding-evidence gate](review.md#finding-evidence-gate) owns admission/severity; the [optional typed operations](api.md#optional-typed-operations) cover review ledgers, compact readEvidence and retained probes. None is a required bootstrap or permission to execute. Apply these counterexample checks before reporting:
- Shared change flag: distinguish unnecessary saves after the first removal from lost removals. If removal sets the flag before the save, that path does not establish missed saves.
- Collection mutation: inspect actual runtime enumeration/snapshot semantics; removal during iteration alone does not prove skipped nodes.
- Empty collection: trace whether division is reachable when the loop has no iterations.
- Field casing: inspect the declared values and consumer together; convention alone does not establish a mismatch or justify a breaking rename.
- Commented pipeline variable: inspect operator inputs, variable groups and environment overrides before claiming it is always undefined or cleanup is disabled.
- Template whitespace: inspect rendered output with actual required values; unusual source indentation that renders correctly is not a functional defect.

Validation gate: distinguish unavailable tooling, missing required inputs, failed checks and passed checks. Preserve the validator exit code before trimming diagnostics; never infer success from a trailing echo/head/tail or fallback chain. Use the status-preserving validator recipe in recipes help for direct executable/argv checks. Do not use whitespace-splitting `for f in $(find ...)`; pass observed filenames as literal arguments or use NUL-safe traversal. Parsing proves syntax only, and Helm lint does not prove a successful render. A failed render without required deployment values is not evidence that rendering succeeds with them. Read large data through bounded programmatic validation and offending examples rather than crowding small source files out of readMany; retain remaining/failures/tails explicitly.

## Status-preserving validator

After choosing a safe offline check, pass `payloads.check` as JSON `{name,tool,args,requiredFiles?}`. Use an observed executable (for example jq, xmllint or helm) and literal argv, not a shell pipeline. requiredFiles are known workspace-relative readable inputs; they do not validate required values inside a file. Missing values require a separate explicit configuration check, not a guessed success. Availability and execution share one outer call. Use outer timeoutMs:40000; this recipe budgets 5s preflight and 20s execution. Normal approvals apply; denial/cancellation/timeout still throw. Tools may have host effects: inspect before choosing them. Do not pass shell interpreters with arbitrary scripts and then mistake their last command's status for a validator's status.

```ts
// Recipe: status-preserving validator
type Check = {name:string;tool:string;args:string[];requiredFiles?:string[]};
const c:Check = JSON.parse(payloads.check);
const strings = (x:unknown):x is string[] => Array.isArray(x) && x.length <= 64 && x.every(v => typeof v === "string" && v.length <= 2000 && !v.includes("\0"));
if (!c || typeof c !== "object" || Object.keys(c).some(k => !["name","tool","args","requiredFiles"].includes(k)) ||
  typeof c.name !== "string" || !c.name.trim() || c.name.length > 120 ||
  typeof c.tool !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/.test(c.tool) || c.tool.length > 120 ||
  !strings(c.args) || (c.requiredFiles !== undefined && (!strings(c.requiredFiles) || c.requiredFiles.some(p => !p || p.startsWith("/") || p.includes("\\") || p.includes(":") || p.split("/").includes(".."))))) throw new Error("Invalid literal validator check");
const preflight = await local.shell({script:'command -v "$1" >/dev/null 2>&1 || exit 41; shift; for file in "$@"; do if [ ! -f "$file" ] || [ ! -r "$file" ]; then exit 42; fi; done',
  interpreter:"sh",args:[c.tool,...(c.requiredFiles ?? [])],timeoutMs:5000,settle:true});
if (!preflight.ok) return {check:c.name,status:"blocked",available:preflight.exitCode === 42 ? true : preflight.exitCode === 41 ? false : null,
  reason:preflight.exitCode === 41 ? "tool unavailable" : preflight.exitCode === 42 ? "required input unavailable" : "preflight failed",exitCode:null,preflightExitCode:preflight.exitCode,truncated:preflight.truncated};
const r = await local.shell({script:'exec "$@"',interpreter:"sh",args:[c.tool,...c.args],timeoutMs:20000,settle:true});
const clip = (s:string) => s.length <= 1200 ? s : s.slice(0,600) + "\n[omitted]\n" + s.slice(-600);
return {check:c.name,available:true,status:r.ok ? "passed" : "failed",exitCode:r.exitCode,signal:r.signal,
  stdout:clip(r.stdout),stderr:clip(r.stderr),truncated:r.truncated || r.stdout.length > 1200 || r.stderr.length > 1200};
```

passed means this invocation exited zero, not that the repository is correct. Read warnings even on success; truncated diagnostics are incomplete. Do not relabel a real validator failure as tool unavailability or silently try a different validator. For multiple checks, compose bounded invocations after prevalidating the whole plan; retain independent failed and blocked results without replaying completed effects.

## Quiet check results

Use this only for a known command whose stdout is routine logs, not required acceptance evidence or requested output. Inspect/parse stdout instead when it contains test counts, warnings or other decision-relevant data. Always retain stderr, even on exit zero. `ok` reports the command exit, not task correctness; disclose omitted stdout separately from truncation. A truncated result is not complete diagnostic evidence.

```ts
// Recipe: quiet command status with failure evidence
const r = await local.shell({command:payloads.command, timeoutMs:120000, settle:true});
return {ok:r.ok, exitCode:r.exitCode,
  ...(r.ok ? {} : {stdout:r.stdout.slice(-1200)}),
  ...(r.stderr ? {stderr:r.stderr.slice(-1200)} : {}),
  stdoutOmitted:r.ok && r.stdout.length > 0,
  truncated:r.truncated || (!r.ok && r.stdout.length > 1200) || r.stderr.length > 1200};
```

Use outer timeoutMs:180000; denial, timeout, cancellation and uncertain cleanup still fail. Do not use `print` to leak the omitted logs back into context.

Return requested output or compact evidence, not raw records to copy into another execution. Do not use persistent memory/state as scratch storage. parallel preserves input order and bounds concurrency; overlapping writes and commands are not independent fan-out.
