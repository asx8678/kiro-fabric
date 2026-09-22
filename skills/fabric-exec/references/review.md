# Evidence-led repository reviews

Explicit, optional task help for reviews, audits and bug finding, not an automatic bootstrap. A review alone does not authorize edits, deployments, secret use or network requests. User tool bans apply even to help, formatting and verification. No forced fixes, probes or steering when forbidden. Tool-only modes may use authorized tools without guidance injection.

## Short review core

Apply the standing review contract. For each requested core path and success/failure/non-default scenario, record **fetched** ranges/hashes separately from **traced** caller -> configuration/guards -> consumer -> consequence and unresolved/blocked coverage. Complete windows, syntax checks and green builds do not establish semantic correctness. An initial sample is not the requested coverage. No findings is valid; neither a finding quota nor a call cap ends investigation, but runtime budgets remain binding.

For real SDK/parser/runtime probes, inspect imports/effects and identify stubs: an imitation is not a real SDK execution. Missing executable, SDK/module or input is unavailable evidence, not a pass or finding. Use only available, authorized probes; network effects require explicit authorization.

Keep unrequested ledgers in context. Persisted memory/state is workspace-shared; use session/task keys and revision checks, not global scratch keys. The optional review provider owns instance/session-local ephemeral tasks; never adopt another session's state.

The gate below operationalizes finding admission. At acceptance, report supported findings, checks run/unrun, material blockers and uninspected scope; repeat unchanged passing checks only for a concrete reason. Recipes remain optional mechanisms, not permission.

## Finding-evidence gate

For every candidate keep: location/caller, concrete trigger, expected contract with its source, expected vs actual action, observable consequence, proof and counterexample checked. Evidence is a reproduction or complete static argument, not a suspicious line or a claimed probe ID.

- Supported defect: reachable consequence proved; headline and explanation agree.
- suspected/unverified: decisive runtime/configuration evidence is missing; state the unresolved dependency, not a confirmed headline.
- maintenance concern: no demonstrated behavioral failure.
- Rejected: disproved by a guard, contract or probe; remove the defect, do not relabel it conditional.

Assign severity only after admission. Confidence is not severity; record affected scope and recovery:

| Severity | Supported impact |
| --- | --- |
| Critical | Broad compromise or major irreversible loss. |
| High | Serious operational failure, exposure or data loss. |
| Medium | Bounded, recoverable correctness/configuration failure. |
| Low | Minor demonstrated degradation. |

Keep maintenance and unresolved leads outside confirmed severity rankings. Validate the proposed correction against the original trigger and preserved contracts; a fix can introduce a new bug. Never enable deletion or bypass validation merely to resolve an unknown setting.

Optional [typed review/probe/readEvidence recipes](api.md#optional-typed-operations) are separate from this core help; use only available, authorized operations.

## Map once, then follow behavior

Optional recipes, not required first calls. For standard/review code tasks, use Fovea first; inventory/search fills coverage gaps (docs/config/unsupported languages). Known targets use focusRead. The starter loads help unless payloads.reviewKnown="true"; skip for no-guidance work. Hypotheses require judgment.

```ts
// Recipe: initial review evidence
const [help,manifest] = await Promise.all([
  payloads.reviewKnown === "true" ? null : fabric.help({topic:"review"}),
  local.find({path:".",pattern:"**/*",hidden:true,limit:200}),
]);
if (help?.truncated) return {help,manifest,helpIncomplete:true};
const patterns = [
  {area:"guidance", match:/(^|\/)(AGENTS\.md|README(?:\.md)?)$/i},
  {area:"entrypoints", match:/(^|\/)(package\.json|pyproject\.toml|Cargo\.toml|go\.mod|Makefile|Dockerfile)$/},
  {area:"automation", match:/(^|\/)([^/]*pipeline[^/]*\.ya?ml|\.gitlab-ci\.yml)$|(^|\/)(\.github\/workflows|\.azure-pipelines)\/.*\.ya?ml$/i},
  {area:"overrides", match:/(^|\/)(envs?|environments|overlays)\/.*\.ya?ml$|(^|\/)values[.-][^/]+\.ya?ml$/i},
  {area:"configuration", match:/(^|\/)(Chart|values(?:[.-][^/]+)?|deployment|docker-compose|compose)\.ya?ml$/i},
  {area:"templates", match:/(^|\/)templates\/.*\.(ya?ml|tpl)$/i},
  {area:"checks", match:/(^|\/)(tests?|__tests__|spec|validations)\/.*\.(ts|tsx|js|py|go|rs|cs|sh|ps1)$|\.(test|spec)\.[cm]?[jt]sx?$/i},
  {area:"implementation", match:/\.(?:[cm]?[jt]sx?|py|go|rs|cs|java|sh|ps1|tf|sql)$/i},
];
const paths = [...manifest.paths].sort((a,b) => a.split("/").length-b.split("/").length || a.localeCompare(b));
const seen = new Set<string>();
const areas = patterns.map(({area,match}) => ({area, paths:paths.filter(path => {
  if (seen.has(path) || !match.test(path) || /(^|\/)(secrets?([./_-]|$)|credentials?([./_-]|$)|\.env(\.|$))|\.(pem|key)$/i.test(path)) return false;
  seen.add(path); return true;
})})).filter(group => group.paths.length);
const unclassified = paths.filter(path => !seen.has(path));
const maxChars = Math.floor(Math.min(24000,40000-JSON.stringify({help,manifest,areas,unclassified}).length-1000)/Math.max(1,areas.length));
if (maxChars < 1000) return {help,manifest,narrowDiscovery:true};
const packets = await parallel(areas, async ({area,paths}): Promise<JsonObject> => {
  const windows = paths.slice(0,3).map(path => ({path,limit:160}));
  try {
    return {area,evidence:await local.readMany({windows,maxChars}),deferred:paths.slice(3)};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {area,error:message.slice(0,500),errorTruncated:message.length > 500,unread:paths};
  }
},{concurrency:3});
return {help,manifest,packets,unclassified};
```

Follow deferred/unclassified paths, unread ranges and callers without exposing secrets. SQL is implementation evidence. Lower shared budgets together; retain failures.

hidden:true includes CI/dot-directories; ignore rules apply. truncated:false means completeness within returned scope. Partition on truncation or narrowDiscovery; zero matches do not prove absence. Omit known discovery/help.

The core coverage ledger covers entrypoints, overrides, consumers, checks and security/data boundaries; fetched ranges alone never mark a path/scenario traced.

Trace pipeline -> script -> arguments -> selected objects -> actions -> outcome; default -> environment override -> resource; configuration -> loader -> effect. Read callees, not only launchers. Mark unknown external behavior.

## Read source without losing coverage

Group observed local.readMany windows by causal chain: pipeline→script→schema/allowlist or chart defaults→overrides→templates, not file extension. Merge overlaps and reuse guest source/metadata. One unreadable window may reject its packet: retain failed paths and other packets. Never automatically run discovered scripts.

```ts
// Recipe: numbered review evidence
return await local.readMany({
  windows: JSON.parse(payloads.windows) as LocalReadWindow[],
});
```

Retain ranges, totalLines, source, sha256 and truncation. Follow remaining verbatim before relevant hash-bound unreadTails; do not concatenate overlaps. complete covers requested ranges, not prefixes/gaps/other files or understanding. readMany defaults to 200/max 2000 lines and 32000 JSON chars (maxChars <=40000, runtime-clamped). Reserve metadata/failure headroom; see API for full paging contracts.

For long data return exceptions/totals/redacted locations. Inspect security consumers and allowlists without credentials; a signed URL proves storage, not validity or abuse. Preserve metadata when fixing compiler errors.

## Verify and try to falsify

Check external settings, upstream validation and unknown schemas. Repository absence does not prove runtime absence. A dropped argument proves neither fallback nor production failure.

Compare simulation/force and success/failure paths. Check producer/consumer keys, casing, names/ports/selectors and API group/resource/verb tuples with non-default overrides. Rendering alone proves neither these contracts nor cluster behavior.

Before declaring validators/config unused, search hidden CI and read merged caller windows in the same execution:

```ts
// Recipe: review callers
const hits = await local.grep({pattern:payloads.symbol,path:".",literal:true,hidden:true,limit:10});
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
  path:range.path,offset:range.start,limit:range.end-range.start+1,
})),maxChars}) : {files:[],remaining:[],unreadTails:[],complete:true};
return {search:hits,evidence};
```

Retain search.scope/truncated. hidden defaults to false even after hidden:true discovery. Inspect owners and caller exit policy. Follow remaining before relevant unreadTails; complete windows are not complete caller coverage. Narrow truncated searches; widen for omitted guards/contracts. Share output headroom across searches.

Reuse known runtimes. Discover availability separately only when it requires a model decision; otherwise use the prerequisite-aware verification batch below. Normal shell approval applies:

```ts
// Recipe: review runtime availability
return await local.shell({
  script: 'for executable in "$@"; do if command -v "$executable" >/dev/null 2>&1; then printf "%s available\\n" "$executable"; else printf "%s unavailable\\n" "$executable"; fi; done',
  interpreter:"sh", args:JSON.parse(payloads.executables) as string[],
  timeoutMs:10000, settle:true,
});
```

Use actual Helm values, including non-default/false/zero cases. Bash parsing alone does not prove argument passing or exit handling; trace PowerShell validators through caller error policy. For authorized fixes reproduce the trigger; measure comparable performance baselines.

Validate payloads.checks before effects. This optional batch uses 70000ms/40000 output chars, per-probe timeoutMs default/max 20000, and outer timeoutMs:120000 for cleanup; lower budgets for smaller runtime limits. Unavailable remains unverified; ordinary nonzero exits permit the next diagnostic, not hard failures:

```ts
// Recipe: review verification batch
type Probe = { name:string; script:string; interpreter?:"bash"|"sh"; args?:string[]; requires?:string[]; timeoutMs?:number };
const checks: Probe[] = JSON.parse(payloads.checks);
if (!Array.isArray(checks) || checks.length > 32 || checks.some(c =>
  !c || typeof c !== "object" || Object.keys(c).some(k => !["name","script","interpreter","args","requires","timeoutMs"].includes(k)) ||
  typeof c.name !== "string" || !c.name.trim() || c.name.length > 120 ||
  typeof c.script !== "string" || !c.script.length || c.script.length > 8000 || c.script.includes("\0") ||
  (c.timeoutMs !== undefined && (!Number.isSafeInteger(c.timeoutMs) || c.timeoutMs < 1 || c.timeoutMs > 20000)) ||
  (c.interpreter !== undefined && c.interpreter !== "bash" && c.interpreter !== "sh") ||
  (c.args !== undefined && (!Array.isArray(c.args) || c.args.length > 64 || c.args.some(a => typeof a !== "string" || a.length > 8000 || a.includes("\0")))) ||
  (c.requires !== undefined && (!Array.isArray(c.requires) || c.requires.length > 8 || c.requires.some(r => typeof r !== "string" || r.length > 120 || !/^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/.test(r))))
)) throw new Error("Expected at most 32 valid named literal checks");
const clip = (text:string) => {
  let n = 800;
  const sample = () => text.length <= 2*n ? text : text.slice(0,n) + text.slice(-n);
  while (JSON.stringify(sample()).length > 1602) n = Math.floor(n/2);
  return sample();
};
const summary = (r:LocalShellResult) => {
  const stdout = clip(r.stdout), stderr = clip(r.stderr);
  return {...r,stdout,stderr,stdoutTruncated:r.stdoutTruncated || stdout.length < r.stdout.length,
    stderrTruncated:r.stderrTruncated || stderr.length < r.stderr.length,
    truncated:r.truncated || stdout.length < r.stdout.length || stderr.length < r.stderr.length};
};
let count = 0, deadline = 10000;
const metadata = JSON.stringify(checks.map((c,index) => ({index,name:c.name}))).length + 1000;
while (count < checks.length && deadline + (checks[count]!.timeoutMs ?? 20000) <= 70000 && metadata + (count+1)*4500 <= 40000) {
  deadline += checks[count]!.timeoutMs ?? 20000; count++;
}
const batch = checks.slice(0,count);
const required = [...new Set(batch.flatMap(c => c.requires ?? []))];
const available = new Set<string>();
if (required.length) {
  const result = await local.shell({
    script:'for executable in "$@"; do if command -v "$executable" >/dev/null 2>&1; then printf "%s\n" "$executable"; fi; done',
    interpreter:"sh",args:required,timeoutMs:10000,settle:true,
  });
  if (!result.ok || result.truncated) return {availability:summary(result),results:[],complete:false,remaining:checks.map((c,index) => ({index,name:c.name}))};
  for (const name of result.stdout.split(/\r?\n/)) if (name) available.add(name);
}
const results: JsonObject[] = [];
for (const {name,requires = [],...input} of batch) {
  const missing = requires.filter(r => !available.has(r));
  if (missing.length) { results.push({name,status:"unavailable",missing}); continue; }
  const result = await local.shell({...input,timeoutMs:input.timeoutMs ?? 20000,settle:true});
  results.push({name,status:"executed",...summary(result)});
}
return {results,complete:checks.length <= batch.length,remaining:checks.slice(batch.length).map((c,index) => ({index:index+batch.length,name:c.name}))};
```

complete means no pending checks, not all passed. Resume remaining only, preserving stderr and truncation; omitted diagnostics are incomplete evidence.

Apply the core's real-runtime/authorization rules: client dry-runs may contact clusters; never deploy/cleanup against services or install missing runtimes without permission.

For literal Bash, use the script API and actual interpreter:

```ts
// Recipe: literal Bash probe
return await local.shell({
  script: payloads.script, interpreter:"bash", args:[payloads.input],
  timeoutMs:20000, settle:true,
});
```

Args arrive literally as $1 onward; JSON.stringify is not shell quoting. Preserve probe_status=$? immediately and exit "$probe_status" after diagnostics. Return exitCode/stdout/stderr/truncation. settle catches only ordinary nonzero exits, never hard failures; shell retains host authority.

Seek counterexamples in upstream validation, settings, caller policy and alternate owners. Collection mutation does not prove skipped elements (check snapshots); backgrounding does not prove lost stdout.

## Completion and reporting

Reconcile coverage and each candidate with the core and finding-evidence gate above; a final caveat cannot justify an unconditional headline. Report supported defects by impact with file:line, trigger, expected contract, evidence and any proposed correction (not automatic edits). See [recipes](recipes.md#evidence-counterexamples) for counterexamples and status-preserving validation. Green probes prove only tested paths; synthetic checks do not establish live model superiority.
