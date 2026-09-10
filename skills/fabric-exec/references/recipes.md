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
const evidence = windows.length ? await local.readMany({windows:windows.map(range => ({
  path:range.path, offset:range.start, limit:range.end-range.start+1,
}))}) : {files:[], remaining:[], complete:true};
return {search:hits, evidence};
```

If search.truncated, narrow the search before making absence claims; partial hits remain useful evidence. Continue evidence.remaining verbatim. evidence.complete covers the selected windows, not search completeness. Prefer source windows to guessed field extraction until the schema is known.

## Exact edit and verification

```ts
// Recipe: exact edit then verification
const path = payloads.path;
const change = await local.edit({path, oldText:payloads.oldText, newText:payloads.newText});
const r = await local.read({path, limit:80});
if (r.sha256 !== change.sha256) throw new Error("File changed after edit; inspect before recovery");
return {path, changed:change.changed, verifiedSha256:r.sha256, text:r.text, truncated:r.truncated};
```

## Multiple known edits in one file

There is no edits-array overload or multi-edit transaction. For a file that fits one bounded read, compute the exact expected bytes from the inspected snapshot, then sequence unique anchors. Each edit retains its own approval and snapshot checks. If a later edit fails, inspect earlier effects before recovery. Final bytes and the last edit hash detect conflicting final state, not all transient external writes.

```ts
// Recipe: sequential same-file edits
const path = payloads.path;
const before = await local.read({path, limit:2000});
if (before.truncated) throw new Error("Incomplete input: narrow/read remaining lines");
const replaceOnce = (text:string, oldText:string, newText:string):string => {
  const parts = text.split(oldText);
  if (!oldText || parts.length !== 2) throw new Error("Expected a unique nonempty anchor");
  return parts[0] + newText + parts[1];
};
const expected = replaceOnce(replaceOnce(before.text, payloads.oldFirst, payloads.newFirst), payloads.oldSecond, payloads.newSecond);
await local.edit({path, oldText:payloads.oldFirst, newText:payloads.newFirst});
const change = await local.edit({path, oldText:payloads.oldSecond, newText:payloads.newSecond});
const r = await local.read({path, limit:2000});
if (r.sha256 !== change.sha256) throw new Error("File changed after edit; inspect before recovery");
if (r.truncated || r.text !== expected) throw new Error("Final bytes differ from expected edits");
return {path, verified:true, verifiedSha256:r.sha256};
```

## Expected nonzero commands

```ts
// Recipe: bounded evidence from expected nonzero commands
const r = await local.shell({command:payloads.command, timeoutMs:120000, settle:true});
return {ok:r.ok, exitCode:r.exitCode, stdout:r.stdout.slice(-1200), stderr:r.stderr.slice(-1200),
  truncated:r.truncated || r.stdout.length > 1200 || r.stderr.length > 1200};
```

Use outer timeoutMs:180000 for this command. A tail is not full output; select relevant diagnostics and disclose omissions. Denial, timeout, cancellation and uncertain cleanup still fail. Do not retry an intentionally nonzero command.

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
