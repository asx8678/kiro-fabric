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

```ts
// Recipe: discover then read without a model round trip
const hits = await local.grep({pattern:'"id": "example"', path:".", literal:true, limit:10});
if (hits.truncated) throw new Error("Incomplete search: narrow path/pattern");
const matches = [...hits.matches].sort((a,b) => a.path.localeCompare(b.path) || a.line-b.line);
const windows: Array<{path:string; start:number; end:number}> = [];
for (const match of matches) {
  const range = {path:match.path, start:Math.max(1,match.line-3), end:match.line+3};
  const previous = windows[windows.length-1];
  if (previous && previous.path === range.path && range.start <= previous.end+1) previous.end = Math.max(previous.end,range.end);
  else windows.push(range);
}
return await parallel(windows, async (range) => {
  const r = await local.read({path:range.path, offset:range.start, limit:range.end-range.start+1});
  return {path:range.path, offset:range.start, text:r.text, truncated:r.truncated};
});
```

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

There is no edits-array overload or multi-edit transaction. Sequence known anchors in one execution; each edit retains its own approval and snapshot checks. If a later edit fails, inspect earlier effects before recovery.

```ts
// Recipe: sequential same-file edits
const path = payloads.path;
await local.edit({path, oldText:payloads.oldFirst, newText:payloads.newFirst});
await local.edit({path, oldText:payloads.oldSecond, newText:payloads.newSecond});
const r = await local.read({path, limit:2000});
if (r.truncated) throw new Error("Incomplete verification: read remaining lines");
return {path, firstPresent:r.text.includes(payloads.newFirst), secondPresent:r.text.includes(payloads.newSecond)};
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

Return requested output or compact evidence, not raw records to copy into another execution. Do not use persistent memory/state as scratch storage. parallel preserves input order and bounds concurrency; overlapping writes and commands are not independent fan-out.
