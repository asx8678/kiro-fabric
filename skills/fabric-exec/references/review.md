# Evidence-led repository reviews

Use for reviews, audits and bug-finding requests. Honor scope and prior authorization; a review does not authorize edits, deployments, secret use or network requests. Reviews are exempt from the 120-word default. Follow nextOffset if help is truncated.

## Map once, then follow behavior

Identify the repo's role: application, configuration/deployment, generated code or external dependency. Combine unknown guidance and recursive discovery:

```ts
const [guidance, manifest] = await Promise.all([
  fabric.help({topic:"review"}),
  local.find({path:".", pattern:"**/*", hidden:true, limit:200}),
]);
return {guidance, manifest};
```

Omit known discovery/help. hidden:true includes CI/dot-directories; ignore rules still apply. truncated:false means completeness within returned scope. Partition truncated searches; retain scope/truncated. Zero matches alone do not prove absence.

Keep a compact coverage ledger in working context: area/path, received ranges, open leads, inspected / unreviewed / blocked with reason. Include entrypoints, maintenance scripts, overrides, template consumers, validators and security/data boundaries. A listing or requested range is not inspection. Inspect returned evidence, including overflow and unread suffixes.

Trace pipeline -> script -> argument mapping -> selected objects -> actions -> reported outcome. Trace default -> environment override -> rendered resource and configuration -> loader -> observable effect. Read referenced executable code, not only its launcher. If implementation or settings live elsewhere, identify that boundary rather than inventing behavior.

## Read source without losing coverage

Use local.readMany for numbered source, hashes and bounded batches. For observed files supply payloads.windows as JSON [{"path":"scripts/task.ts","limit":2000}].

```ts
// Recipe: numbered review evidence
return await local.readMany({
  windows: JSON.parse(payloads.windows) as LocalReadWindow[],
});
```

The result has files, remaining and complete. Each file has path, startLine/endLine, totalLines, source, sha256, truncated and optional nextOffset. Pass remaining verbatim to the next readMany call; it includes hashes for partially delivered ranges and fails if the source changed. Do not repeat the original batch prefix. complete means the requested ranges were delivered, not the whole file/repo or that they were understood. For a bounded requested range, stop at its end; for whole-file review, follow any further file nextOffset. Default 200/max 2000 lines per window; default aggregate budget 16000 characters.

Read related callers/consumers together, then reason. For long structured data use bounded parsing: return exceptions, totals and redacted locations. Inspect security/config field names, consumers and signature/allowlist presence without returning credentials. A signed URL in source proves storage, not validity, permissions or successful abuse. Do not skip an area because it may contain secrets or extrapolate one inspected file to every environment.

For generic dynamic JSON keys use const out: JsonObject = {}; not an untyped {} or Record<string, unknown>. Compiler hints explain repairs. Do not drop evidence metadata to bypass a type error.

## Verify and try to falsify

For each candidate retain location, first incorrect value/action, trigger, evidence, counterexample and unresolved dependency. Grade each claim now, not just in a final disclaimer: source mismatch; reproduced behavior under stated inputs; or conditional risk. A wrong key mapping is observable without asserting authentication failure. A commented setting can come from variable groups/UI/runtime settings. Missing application code cannot prove a response property absent, defaults or matching behavior. State the condition beside the claim; a caveat at the end cannot support an unconditional headline.

Inspect logic in both directions: inputs to effects, then each guard/log against the object acted upon. Compare simulation/force and success/failure paths. For configuration repos also compare exact producer/consumer keys, including casing, names/ports/selectors and API group/resource/verb tuples. Read defaults and overrides; exercise a supported non-default value when the default hides a mismatch. A successful render does not check these contracts or prove cluster behavior.

Before declaring a validator/config unused, search callers, including hidden CI:

```ts
// Recipe: review callers
return await local.grep({pattern:payloads.symbol,path:".",literal:true,hidden:true,limit:80});
```

Retain scope/truncated and follow references. hidden defaults to false even after hidden:true discovery. Read caller exit policy and imported owners; absence is only within searched scope.

Use small local probes to resolve uncertainty: render configs, run pure functions or compare contracts. Read modules before importing: imports may execute effects. Never run deploy/cleanup scripts against services. Client dry-runs can contact clusters for discovery/schema; use offline checks. Missing runtimes leave semantics unverified; installation needs authorization.

For multiline shell probes use the literal script API and the actual interpreter:

```ts
// Recipe: literal Bash probe
return await local.shell({
  script: payloads.script, interpreter:"bash", args:[payloads.input],
  timeoutMs:20000, settle:true,
});
```

Script/args arrive literally, with args as $1 onward. Stub external effects. JSON.stringify is not shell quoting. Preserve the tested status immediately (probe_status=$?), then exit "$probe_status" after diagnostics; trailing echo/grep/tail can replace it. Return exitCode/stdout/stderr/truncation. settle handles ordinary nonzero exits only. Host authority/approvals remain; this is not network isolation.

A probe must exercise the claimed causal chain. Feeding a constant into a downstream parser separately does not prove how the upstream response is handled. Test representative success and failure inputs through the same path. Record what the stub substitutes and what remains unknown; an observed dropped argument does not imply a fallback, data loss or production failure. Preserve the original failure policy when reproducing it, and validate proposed fixes too.

Actively seek counterexamples: upstream validation, externally supplied settings, caller failure policy and alternate ownership. Collection mutation is not proof of skipped elements: check whether the runtime returns a snapshot. A background operator is not proof of lost stdout. Missing runtimes leave these claims conditional, not verified.

## Completion and reporting

Before finalizing, make a separate skeptical pass over candidates and coverage. Reconcile every retained lead: report it with evidence/condition, reject it with a counterexample, or mark the missing check. Do not silently drop a supported defect from an already-read file. Recheck never/always/cannot/live and each "therefore". Keep branch conditions consistent across findings. Deduplicate symptoms; no findings is valid.

Close high-risk leads and cross-file contracts in accessible relevant areas before offering follow-up on a small repo. For bounded reviews or real blockers report uninspected scope and next checks. A fetched file is not inspected; a green probe proves only its inputs/path. Do not claim whole-repo coverage with omissions.

Report verified defects first, ordered by impact, with file:line, reachable cause and concrete correction. Separate conditional risks and optional improvements. State verification actually run, unresolved external dependencies and unrun checks. Keep narration concise while completing the necessary investigation; never fill a findings quota or claim superiority from synthetic checks alone.
