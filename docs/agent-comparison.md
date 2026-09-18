# Kiro default vs Fabric Code Mode: reproducible bug lab

This is a **benign coding benchmark**, not an adversarial sandbox, release certification or proof of universal savings. Compare correctness before cost. Code Mode programs below are checked **TypeScript**, not the Python used by an unrelated outer coding harness.

## Acceptance ledger

- Identical task prompts, seeded source files and independent oracles for both agents.
- Disposable workspaces per attempt; two reverse-order repetitions by default.
- The real installed Fabric profile and complete bundle are snapshotted; no default-agent or global-rule changes.
- Both agents can read, edit and run the fixture tests. Native CLI v3 has **separate tool-trust and shell-policy gates**.
- Every paid attempt, including setup/routing failures and canceled runs, stays in the charge ledger.
- Missing usage stops further admission; unknown tokens/caches/billing are never imputed as zero.
- Separate strict instruction compliance from independent source repair quality.
- Keep diagnostic pilots separate from the corrected comparison; charge both against the authorized budget.

## Runnable projects, without inference

From this repository with Node >=24 and installed dependencies:

```sh
node scripts/agent-comparison.mjs fixtures --out /tmp/my-new-tinyshop-lab
node scripts/agent-comparison.mjs selftest
pnpm run comparison:selftest
```

The output directory must not already exist. The exporter creates bug-repair and read-only review projects, including seeded/held-out regression families, their task prompts and a version-6 hash manifest. No reference solutions or held-out tests are exported into the agent workspaces. To inspect the all-bugs example:

```sh
cd /tmp/my-new-tinyshop-lab/bug-checkout
node tests/public.mjs
```

**Failure is expected before repair.** No package installation, HTTP services, databases or test dependencies are needed. `package.json` also provides `npm test`, but the benchmark prompt uses `node tests/public.mjs` directly. Do not run grading from an already fixed example: the runner regenerates fresh fixtures independently for every attempt.

### TinyShop task matrix

Each project contains the same eight source modules, README contracts, package manifest and public tests. Individual tasks inject bugs only in the named module; `bug-checkout` injects all eight.

| ID | Bug | Independent edge cases |
| --- | --- | --- |
| `bug-money` | Quantity omitted from price accumulation | Basis-point discount, one final rounding, zero quantity, invalid numbers, frozen inputs |
| `bug-page` | 1-based page treated as 0-based | Empty input, beyond-end pages, several page sizes, invalid indices, nonmutation |
| `bug-config` | False/zero replaced by truthy defaults | Port 0/65535, missing vs empty, booleans as strings, Unicode digits, invalid types |
| `bug-cache` | Expiry equality off by one | Injected clock, zero TTL, overwritten TTL, false/zero/null payloads, invalid TTL |
| `bug-inventory` | Duplicate SKU quantities overwritten | Aggregation, insufficient stock, atomic failure, invalid quantities, frozen input |
| `bug-retry` | Last allowed attempt never executed | Exact attempt count, first-success stop, false/zero results, original error identity |
| `bug-csv` | Escaped quotes silently discarded | Quoted commas, empty fields, Unicode, spaces, round trips, malformed quote/newline rejection |
| `bug-batch` | Results returned in completion order | Reverse completion, eager launch, empty input, synchronous throws and async rejection |
| `bug-checkout` | All eight bugs in one project | All module contracts; broader repair stress, scheduled after both rounds of smaller tasks |

This is a small synthetic application, not a large production repository. The all-bugs task exercises multiple modules, not an HTTP checkout transaction. Python is required only for selected legacy cases and the existing runner preflight.

The original 13 steering cases remain the default schedule. The new cases are selectable alongside `read24`, `parser`, `multi-edit`, `invoice`, etc. Omitting `cases` does **not** silently expand an old paid plan. `range` output stress runs last; Fabric-only immutable-help qualification is excluded from comparisons for **both** agents.

## Code Mode examples

These are teaching examples for a **separate fresh lab copy**. Do not include them, reference patches or held-out oracles in either agent's live task input. The same natural-language prompt goes to both agents; their tool interfaces are the experimental difference.

Pass each program as the `code` string in `@fabric/fabric_exec`. A verified workspace must already be bound. No external provider discovery or filesystem listing is needed for these explicitly named fixture paths.

### 1. Read relevant files together

```ts
const [source, tests, contract] = await Promise.all([
  local.read({path: 'src/money.mjs', limit: 30}),
  local.read({path: 'tests/public.mjs', limit: 30}),
  local.read({path: 'README.md', offset: 1, limit: 12}),
]);
return {source: source.text, tests: tests.text, contract: contract.text};
```

### 2. Reproduce, repair and verify a known bug in one execution

Use only on an untouched `bug-money` example. An ordinary failing test is expected, so use `settle:true`; cancellation, permission denial and uncertain cleanup are **not** successful reproductions.

```ts
const source = await local.read({path: 'src/money.mjs', limit: 30});
const oldText = 'sum + item.priceCents, 0';
if (!source.text.includes(oldText)) throw new Error('Unexpected fixture state');
const before = await local.shell({
  command: 'node tests/public.mjs', timeoutMs: 10000, settle: true,
});
if (before.ok || before.exitCode !== 1) throw new Error('Expected failing fixture');
await local.edit({
  path: 'src/money.mjs', expectedSha256: source.sha256, oldText,
  newText: 'sum + item.priceCents * item.quantity, 0',
});
const after = await local.shell({
  command: 'node tests/public.mjs', timeoutMs: 10000, settle: true,
});
if (!after.ok) throw new Error(after.stderr);
return {reproducedExit: before.exitCode, verifiedExit: after.exitCode};
```

This public check is not equivalent to the controller's held-out checks. Do not claim that it proves every edge case. For larger generated source bodies, use Fabric's named string payloads rather than duplicating data through the model.

### 3. Read 24 first lines with bounded parallelism

For the legacy `read24` fixture, keep no more than eight reads in flight. Preserve spaces, tabs and Unicode; strip only line terminators.

```ts
const lines: string[] = [];
for (let offset = 0; offset < 24; offset += 8) {
  const batch = await Promise.all(Array.from({length: 8}, async (_, j) => {
    const name = String(offset + j).padStart(2, '0');
    const file = await local.read({path: `records/record-${name}.txt`, limit: 1});
    return file.text.split(/\r?\n/u)[0] ?? '';
  }));
  lines.push(...batch);
}
return lines;
```

One outer tool call can contain multiple inner effects. **One call is not one read, one model request or one unit of cost.** Preserve ordinary failure evidence rather than rerunning a failed effectful program blindly.

## Read-only infrastructure review

The exported `review-infra` task is a structured review, not a repair task. It contains hidden CI configuration, a referenced maintenance script, per-environment overrides, an alert renderer, validator scripts, and a long exemptions file with relevant evidence beyond line 200. Five seeded defects have a controller-held oracle; three harmless configurations are false-positive controls. Paths, line offsets and schedule values vary by seed. No credentials, services, dependency installation or network calls are needed.

The output schema uses finding categories plus exact file/line/source evidence, including caller/consumer evidence for cross-file defects. Categories include decoys; the prompt does not disclose which apply or how many defects exist. The grader counts unique grounded findings and reports partial recall, false positives and duplicates. It enforces read-only scope and raw JSON separately. This constrained fixture is not a semantic judge for arbitrary natural-language reviews, nor proof that source citations establish a model's private investigation process.

`node scripts/agent-comparison.mjs selftest` independently executes the fixture's credential mapping, renderer and invalid-input validators, checks expiration against a fixed review date, and qualifies the hidden/tail evidence. Synthetic/reference runs never enter live agent statistics.

The separate `review-contracts` case tests whether reviewers inspect referenced cleanup code and disprove attractive false positives. It contains two defects (protected-version selection and misleading dry-run logs), with controls for upstream name validation, runtime-supplied settings and a validator whose caller correctly fails. Independent Node probes exercise both valid/invalid inputs and both flag states. It uses distinct fixtures and categories, preserving existing `review-infra` prompt/fixture hashes.

`review-boundaries` tests exact configuration keys, permission-target tuples and an unquoted shell query. Five controls challenge unsupported claims about lost responses, unconditional fallback, disabled cleanup, absent validation callers and live credentials. Node and Bash probes exercise the actual consumers, a non-default setting, hidden CI entrypoint and success/failure response bodies through the same path. Earlier fixture/prompt hashes are unchanged. These review cases remain opt-in for paid plans; offline selftest qualifies each with two seeds. The oracle grades the enumerated claims and exact evidence; it is not a semantic judge of arbitrary prose or production behavior.

For a future operator-approved comparison, select `"cases":["review-infra"]`, pin the same available model and `"effort":"low"`, and use repeated order-balanced runs in fresh workspaces. Existing manifest identity, spend-reserve and permission requirements still apply. Compare precision and recall before credits per grounded finding; a cheap partial review must not win by omitting defects. Include timeouts, failures and unknown telemetry rather than silently dropping them. Do not treat a single pair as evidence of a magnitude improvement.

`review-evidence` is a separate opt-in fixture for finding discipline: two independently reproduced defects (unnecessary saves and a masked validator exit), plus five false-positive controls (lost removals, snapshot iteration, unreachable empty-batch division, declared field casing and runtime-supplied settings). Qualification executes the actual inert Node/Bash fixture consumers; it does not establish PowerShell or Helm semantics. Existing case prompts and default schedules are unchanged. Use the same seeds and immutable installed runtime/profile/guidance provenance for old/candidate comparisons. Gate adoption on supported findings, false positives and coverage before comparing outer calls, credits or latency; missing telemetry remains unknown. Offline fixture qualification is not a live model-quality result and runs no paid inference.

For coverage and precision, select `"cases":["review-infra","review-contracts","review-boundaries","review-evidence"]`. Record compiler failures, verification commands and uninspected scope alongside graded outcomes. Check the installed profile and bundled guidance against the candidate before admission: building this checkout does not refresh a separately installed generation or a running Kiro session.

## Review-adherence evaluation protocol

`review-adherence` is a new opt-in `review-adherence/v1` schema, leaving earlier fixture/prompt/oracle bytes and default schedules unchanged. It extends `review-evidence` with controlled proposition IDs for headline, explanation, consequence, proof scenario, confidence and counterexample, plus source-line-supported partial/exhaustive report scope. Strict success requires grounded recall/precision **and zero quality violations**. JSON/Markdown reports expose optional adherence counters; missing historical dimensions remain unknown. Counters overlap: do not sum them into violations. Zero findings has zero recall, not a quality win. These finite assertions are not semantic judging of arbitrary prose, proof that a probe ran, or proof that a file was fully inspected.

For a real-prose evaluation, blind the arm/model labels and manually adjudicate supported consequences, headline/explanation consistency, confidence, actual inspection/probe evidence and coverage claims. Keep defect recall and false positives beside those judgments. A correctly named defect with an invented consequence is not a successful review. Only compare cost/time/outer exchanges after quality holds or improves. An independent critic pass is an optional later experiment if contradictions persist, not an always-on extra round trip.

### Finding validation and severity calibration

`review-calibration` is a separate opt-in `review-calibration/v1` case. Its finite Node/Bash contracts distinguish three supported defects: unnecessary saves (low), a masked validator exit (medium), and protected-artifact deletion (high). Guarded division/selector inputs are disproved controls; externally supplied cleanup settings remain unresolved. Confidence is not impact. The active review help now places candidate admission before discovery mechanics and supplies an impact/scope/recovery rubric; these are instructions, not a runtime semantic enforcement mechanism over Kiro's final prose.

The controller independently runs actual inert fixture entrypoints, limiting cases and safe/unsafe corrections. Exact caller/consumer citations, consequence, disposition, severity, proof/counterexample scenario and recommendation must agree with the private finite oracle. `Case.reviewOracle` is included in the oracle hash but not the task prompt, exported workspace or valid reference answer. Earlier fixture/prompt/oracle hashes and default case selection remain unchanged.

Strict success requires complete validated recall, zero false positives/duplicates and zero calibration violations. Wrong consequences, inflated or understated severity and harmful recommendations cannot earn validated credit. Disproved/unresolved assessments earn no defect credit. Empty reviews fail recall, and missed substantial defects remain visible (medium/high/critical under this fixture's declared rubric). Counters overlap; violations counts invalid assessments, not their summed diagnostics.

JSON `reviewQuality.calibration` and the first Markdown table expose grounded versus validated findings, severity errors, unsafe fixes, substantial recall, misses and credits per validated finding. Historical `verifiedFindings` remains a case-oracle-match field for compatibility: earlier cases only establish grounding and must not be relabeled calibrated success. Missing historical calibration and unsafe/unscored attempts remain unknown. Failed attempts retain their costs; failed quality blocks both-pass efficiency ratios.

For the next separately authorized matched pilot, include `review-calibration` alongside `review-infra` (caller/key mapping) and `review-boundaries` (configuration contracts). Keep identical cases, seeds, model policy and immutable old/candidate profile/help provenance. Blind and manually adjudicate real prose for consequence validity, severity, unsafe fixes and missed defects before comparing cost. A named proof is not evidence the model executed it, and passing offline fixtures does not demonstrate a live Kiro reasoning improvement.

`tests/review-execution.test.ts` runs actual Bash counterexamples through checked Fabric execution. `tests/review-runtime-controls.test.ts` adds offline Helm rendering/casing and PowerShell controls when those binaries are installed; absent runtimes are explicit skips, never claimed as verified. These language probes qualify only their supplied inputs, not arbitrary charts, PowerShell versions or production deployments.

### Verify delivery, not a loaded claim

The standing profile now requires a cold opening to return review help alongside inventory and bounded observed source; the shipped recipe skips help only when already known and returns partial-help cursors explicitly. No preliminary workspace status is needed for an already verified root.

New plans freeze each arm's own `resources/skills/fabric-exec/references/review.md` text/hash under `identity.profiles[arm].reviewHelp`, independently of this checkout. Missing historical references remain null. Runtime/profile/bundle drift still rejects admission. Completed Fabric outputs are scanned boundedly for exact structured review pages matching that frozen reference; contiguous UTF-16 pages through EOF produce `row.reviewHelp.status: complete`. `partial`, `unobserved` and `unknown` remain distinct. A code-string mention, final-answer claim or `loaded:true` does not prove delivery. Missing/corrupt event evidence is unknown. Unobserved means no matching inline page in observed output, not proof the client never loaded another resource. Delivery is content evidence, not comprehension or even proof of a particular provider invocation. Artifact-only or omitted output cannot establish complete delivery.

### Seeded and held-out behavioral regressions

Select `review-regressions-seeded` and `review-regressions-heldout` in the existing plan's `cases` array, with repeated matched profile/model/effort settings. Both are exported by `comparison:fixtures` and independently qualified by `comparison:selftest`. They cover incomplete-inventory deletion, async exception translation, the actual surrounding HTTP middleware, delay-versus-request-rate reasoning, shell pipeline status, Terraform detailed-exitcode, and Kubernetes/Helm inventory guards. Changing the held-out family's guards changes the correct assessment; seed changes identifiers, inputs and source offsets.

Quality diagnostics report missed demonstrated high-impact cases, missing caller/consumer evidence, unsupported consequences, counterexamples and scenario coverage. These remain finite structural oracles, not a semantic judge, a finding-count target or evidence that an agent executed a probe. The controller executes actual TS/JS fixture modules and offline Bash contract doubles. HTTP uses Request/Response middleware without sockets; no real cluster or Terraform operation runs. C# is explicitly source-only and skipped by the runtime qualification. Agent workspaces do not receive expected answer tuples or private controller metadata. Held-out denotes a separate fixture family, not guaranteed training-data secrecy. Use blind manual adjudication and repeated real-agent runs before claiming improved audit quality.

### Effective-config provenance (explicit, offline capture)

`src/kiro/run-provenance.ts` exports the pure `buildRunProvenance(input?)`,
`parseRunProvenanceDeclaration(explicitJson)`, `RUN_PROVENANCE_LIMITS`, and
`RunProvenanceInput` / `RunProvenanceConfiguredInput` / `RunProvenanceObservedInput` /
`RunProvenanceManifest` types. The compact manifest is suitable for `fabric.info`:

- `configured` is always an **unverified declaration**. It records guidance mode,
  requested model/effort, profile, runtime-bundle identity, prompt, ordered resource
  and hook digests, and repository commit/dirty declarations plus a dirty-evidence
  digest. A known hash means bytes were supplied, not that Kiro used them.
- `observed` is a **separate server-observation channel**. Populate it only with
  independently available runtime identity/content and actual returned guidance
  bytes. Prompt/resource/hook availability alone never establishes delivery.
  `guidanceOutputs: [{reference, output}]` requires a nonempty exact byte match;
  its `observed-content-match` status covers only those supplied outputs, not all
  configured guidance. Inputs, loaded flags and copied reference text are not
  output evidence. Neither channel authenticates the caller's assertions.
- `observed.routing.actualModel` and `actualEffort` remain `null` with status
  `unknown`, even for pinned requests or observed session configuration. Never
  infer Kiro's hidden routing from a profile, requested model or CLI option.
- Opaque labels (including requested model/effort and runtime identity/version)
  are SHA-256 digests, **not echoed strings**. Only the guidance-mode enum and
  validated Git commit IDs are shown verbatim. Prompt, resource, hook, dirty
  evidence, paths and secret-bearing metadata are never printed. Hashes still
  reveal equality and are not encryption; retain reports appropriately.
- Missing collections have unknown count/digest; explicit empty lists have count
  zero and a digest. Collection digests bind ordered label/content digests;
  manifest digests bind the fixed-shape summary. Oversized content is unknown,
  never a prefix presented as a whole-content hash. Limits: 1 MiB per content,
  4 MiB total hashed content per builder, 32 entries per collection, and 65,536
  characters for explicit launch declaration JSON.

Parent integration: add optional `KiroMcpServerOptions.runProvenance?:
RunProvenanceInput`, pass the bounded builder result into the shared health value
used by `fabric_info` / `fabric.info`, and export the public symbols through
`src/index.ts`. Launch JSON must go only through
`parseRunProvenanceDeclaration` into `configured`; never spread it into `observed`.
The builder performs no filesystem reads, Git commands, ambient environment
reads, runtime loading or automatic inspection of `~/.kiro`. The parent supplies
only fields it actually has. A supplied bundle identity is hashed as bytes; this
helper does not verify a bundle tree or replace build/installation verification.
Guidance-mode profile generation (`standard|review|minimal`, unchanged default)
remains the launch/profile module's responsibility, not this helper's.

The Node >=24 CLI runs the same TypeScript builder without requiring or mutating
`dist/`, then reuses `review-delivery.mjs` on captured ACP **output** evidence:

```sh
node scripts/steering-benchmark/run-provenance.mjs manifest --input /private/old/run.json
node scripts/steering-benchmark/run-provenance.mjs compare --left /private/old/run.json --right /private/candidate/run.json
```

Each input is an explicitly selected descriptor; all fields are optional. Paths
are relative to that descriptor (absolute paths also work). Example:

```json
{
  "guidanceMode": "review",
  "requestedModel": "auto",
  "requestedEffort": "low",
  "profileFile": "profile.json",
  "bundleFile": "closure-manifest.json",
  "promptFile": "prompt.txt",
  "resourceFiles": ["skill.md", "review.md"],
  "hookFiles": ["first-prompt-hook.js"],
  "repository": {
    "commitFile": "commit.txt",
    "dirty": true,
    "dirtyEvidenceFile": "dirty-evidence.txt"
  },
  "eventsFile": "attempt.stdout.jsonl",
  "reviewReferenceFile": "review.md"
}
```

Select a small immutable bundle identity/manifest file for `bundleFile`, not a
large executable archive. No paths, resources, hooks, environment variables or
commands embedded in the selected profile are followed/executed. No Git command
is run: the caller must supply captured commit and dirty evidence. A status-only
snapshot does not hash modified file contents; select a pre-captured patch or
content-hash inventory if the comparison needs that distinction, including
untracked evidence explicitly. Dirty state remains a declaration, not an
inference from an empty file. No global steering/configuration is discovered.

The CLI caps each selected regular file at 1 MiB, total reads at 16 MiB per arm,
resource/hook lists at 32 each, and raw ACP JSONL at 4,096 events. Final symlinks
and non-regular files are rejected. Malformed/oversized selected files fail with
redacted errors rather than silently producing a partial hash. Missing optional
files remain unknown; explicitly named missing files fail.

CLI `manifest` is still unverified runtime configuration:
`caller-selected-files-not-runtime-attestation`. The adjacent
`reviewHelpDelivery` field separately reports `complete`, `partial`, `unobserved`
or `unknown` from actual completed Fabric outputs matched to the selected frozen
reference, with reference/event content digests but no raw text. Corrupt/missing
stream evidence cannot establish delivery. Tool input strings and `loaded:true`
never upgrade it. `compare` reports known fields as `same`/`different`, but equal
unknowns stay `unknown`; inspect each arm's separate delivery result too. Neither
content matches nor fixture CLI output prove provider invocation, comprehension,
agent execution, semantic quality, speedup or actual routing. No live run or
paid inference is performed by these commands.

### Prepare matched Auto and pinned-model strata (no live run implied)

1. Freeze separate old/candidate standalone bundles, profiles and private data roots using the existing `arms.old`/`arms.fabric` identity fields. Native is an implicit additional arm; include it in spend estimates. Restart sessions from disposable fixtures, never share mutable arm data.
2. Prepare two manifests with the **same** cases, seed, repetitions, arm identities and compatible effort policy. A compact pilot can select `["fabric-help","review-boundaries","review-adherence"]` and `repetitions:2`; the schedule rotates/reverses order. Keep all current call/time/output/approval stops; this runner is not uncapped.
3. In the pinned manifest set `model` to an explicit currently supported CLI model ID. In the Auto manifest set `model:"auto"`. Set `effort` only where supported and hold it matched; otherwise report an unmatched policy comparison, not a model-only effect. Requested/session-configured model is not hidden routing: `actualRoutedModel` remains null without independent telemetry.
4. Obtain a numeric authorization covering **both strata**, qualification, failures, prior spend and reserve before filling credit fields or invoking `run`. Carry actual prior charges into subsequent admission; do not allocate the same reserve twice. Existing budgetGate and durable exactly-once admission remain authoritative. No spending authorization or live results are supplied by this document.
5. `node scripts/steering-benchmark.mjs plan --manifest <manifest>` and `init --manifest <manifest> --out <new-private-directory>` prepare bounded, non-inference evidence. Verify both plans and the frozen installed guidance before a separately authorized run. Analyze old/candidate pairs **within** each stratum first; compare Auto/pinned outcomes separately, never pool them into one claimed prompt speedup. Preserve failures and unknown usage.

Offline preparation: `node scripts/agent-comparison.mjs selftest` qualifies fixtures with no model inference. `fixtures --out <new-private-directory>` exports neutral workspaces without solutions. No offline result establishes live adherence or the best model choice.

## Live plan and consent

Use `node scripts/steering-benchmark.mjs --help` for all options. Live runs require an authenticated native Kiro CLI, a private standalone Fabric bundle/profile/data root and explicit operator spend approval. Do not copy credentials into a fixture or disable approval globally.

Relevant manifest fields (identity paths omitted here; the real manifest requires them):

```json
{
  "nativeMode": "vibe",
  "model": "auto",
  "cases": ["fabric-help", "bug-money", "bug-page", "bug-config", "bug-cache", "bug-inventory", "bug-retry", "bug-csv", "bug-batch", "read24", "parser", "multi-edit", "invoice", "bug-checkout"],
  "nativeTrustTools": ["fs_read", "fs_write", "str_replace", "execute_bash", "shell"],
  "singleRunCreditLimit": 0.8,
  "nativeWorkspacePermissions": true,
  "repetitions": 2,
  "seed": "my-comparison-v1",
  "plannedCredits": 24,
  "creditCeiling": 29,
  "priorCredits": 0,
  "reserveCredits": 5,
  "maxCalls": 40,
  "timeoutMs": 150000,
  "maxOutputBytes": 8388608,
  "snapshotCliSettings": true
}
```

`arms.fabric` names the snapshotted Fabric profile, complete bundle root and preinitialized private config paths; native is implicit. Legacy `old`, `pass1`, `pass2` arm names remain supported. `model` is passed identically to both agents and checked against returned session configuration. `auto` does **not** identify the actual routed model/revision; use an available explicit model ID for a tighter future experiment. Optional `effort` (low/medium/high/xhigh/max) is passed identically with `--effort` and checked against the returned ACP `effort` configuration option. If the client omits that evidence or reports a mismatch, the trial fails identity qualification; do not infer equal effort from model identity alone.

### Comparing standard, review and minimal guidance

This is a comparison protocol, **not a measured winner or authorization to spend credits**. The preparation and offline tests need no inference. Use the existing arm slots with explicit mode declarations; these names do not imply different runtime versions:

```json
{
  "arms": {
    "old": {"guidanceMode":"standard", "profile":"/private/profiles/standard.json", "runtimePaths":["/private/shared-bundle"], "configPaths":["/private/standard-data/config.json"]},
    "pass1": {"guidanceMode":"review", "profile":"/private/profiles/review.json", "runtimePaths":["/private/shared-bundle"], "configPaths":["/private/review-data/config.json"]},
    "pass2": {"guidanceMode":"minimal", "profile":"/private/profiles/minimal.json", "runtimePaths":["/private/shared-bundle"], "configPaths":["/private/minimal-data/config.json"]}
  },
  "cases": ["fabric-help", "bug-money", "review-boundaries", "review-adherence"],
  "repetitions": 2
}
```

Merge these fields into the complete manifest above, with real identity paths and an operator-approved budget. Native remains an implicit fourth arm and consumes credits too.

1. Run `pnpm run build`. Prepare one immutable complete standalone bundle containing that build. Generate each profile with `generateAgentProfile` from `scripts/agent-profile.mjs`, passing the same `nodePath`, `runtimeRoot`, `bundleRoot`, `rgPath`, `skillPath`, `steeringPath`, the selected `guidanceMode`, and a **different private `dataRoot` per arm**. Preinitialize each private config with identical policies and trace settings. Do not modify normal installed profiles or reuse their mutable data.
2. Keep runtime, fixtures, requested model/effort, approvals, environment and observation machinery identical; only the mode's prompt/resources/hooks differ. Pin an available model ID for this series; run Auto as a separate stratum if needed. Mode resources/hooks are checked against the generated profile: minimal has neither. Historical/custom prompts without a mode declaration remain `unknown`; declaring a mode requires matching current prompt bytes. Mode identity is configured evidence, not proof of delivery or hidden model routing.
3. Run `node scripts/steering-benchmark.mjs plan --manifest /private/modes.json` then `node scripts/steering-benchmark.mjs init --manifest /private/modes.json --out /private/new-mode-results`. These commands do no inference. The frozen plan preserves paired seeds/fixture hashes and rotated/reversed order. Inspect it and the spend estimate **before** authorizing a run; do not alter a frozen plan.
4. Only after explicit spend approval, use `node scripts/steering-benchmark.mjs run --out /private/new-mode-results --count 2`. Continue in small approved batches under existing time/call/output/credit stops. Keep failed attempts and unknown usage in the ledger. Export with `node scripts/agent-comparison.mjs report --out /private/new-mode-results --dest /private/new-mode-report`; JSON and Markdown record `guidanceModes` per Fabric arm. Compare per-case quality before aggregate cost. Existing ratios are against native, not a claim of pairwise mode speedups.
5. Enable private tracing consistently for all Fabric arms as described in [tracing.md](tracing.md). Analyze each captured file with `node scripts/analyze-trace.mjs /private/trace.jsonl --json`. `compile.result` records cache `hit`/`miss`/`bypass`, worker `cold`/`warm`/`custom`, and diagnostic counts. Hits use no worker; oversized inputs and custom workers bypass cache lookup. Compile spans provide count/mean/p95 timing strata, including failed and unknown observations. Cold means a newly allocated compiler worker, not a cold OS or model cache. Each new server has its own pool; do not assume warmth survives CLI attempts. Older traces retain unknown classification. Existing span/bridge tables separately expose runtime and provider/approval latency.

Use strict pass rate, held-out checks, scope violations, review precision/recall and reported credits (including failures) as the primary measures. Inspect call evidence for unnecessary reads, repeated continuations and verification quality. Compiler diagnostic checks are **not automatically repair-turn counts**; correlate execution IDs with the captured conversation for that assessment. These qualitative judgments are not new automatic scores. Report tracing overhead and missing observations; do not infer tokens, settled billing or guidance delivery from prompt length. Keep the smallest guidance that preserves measured quality. No live comparison was performed as part of this implementation.

### Current native v3 shell policy

Tool trust is insufficient for shell execution. With the explicit `nativeWorkspacePermissions:true` option, the controller creates a new `HOME/.kiro/workspace-roots/<normalized-workspace-SHA256-prefix>/permissions.json` only for that unique disposable workspace. The policy uses the client's effective `HOME` (manifest `env.HOME` overrides the inherited value; relative values resolve from the disposable workspace). An invalid override fails closed, without writing consent in the controller's home. The policy permits Node, fixture Python (`-B`) and `cd` shell commands. Existing policy directories are refused rather than overwritten. File/directory identities and content hashes are recorded in the attempt row. After the trial the controller removes only its unchanged policy file, and removes its directory only if empty. Global permission rules and the default native agent are unchanged.

This is **not** a network/process/filesystem sandbox: Node and Python can execute candidate code, and prompts are not security enforcement. Use a separate OS account/container for adversarial work. If the controller is killed, inspect the exact `nativePermission.path` in the durable row before manual cleanup; never delete unrelated user policy. Cleanup drift stops the run.

Fabric's separate **private experiment** config explicitly allows read/write/execute for the benign fixture, denies network and disables MCP/memory/state. Trace collection may be enabled and must be reported as part of the configuration. Do not apply this permissive fixture configuration to the user's normal installed data root.

### Execute in small batches

```sh
node scripts/steering-benchmark.mjs plan --manifest /private/manifest.json
node scripts/steering-benchmark.mjs init --manifest /private/manifest.json --out /private/new-results
node scripts/steering-benchmark.mjs run --out /private/new-results --count 2
node scripts/steering-benchmark.mjs summary --out /private/new-results
node scripts/agent-comparison.mjs report --out /private/new-results --dest /private/new-report
```

`plan` does no inference; `init` probes versions and freezes identities. `run` is paid, sequential and exactly-once: an unfinished durable row, unknown usage, safety stop, identity drift or budget failure blocks continuation. Never edit a frozen manifest/harness and continue it. Freeze old sources/results, declare a new protocol, carry all prior charges into `priorCredits`, and reduce the remaining budget. Do not silently regrade or replace failures.

Admission uses a conservative per-attempt reserve and stops on a completed run above 0.8 credits, projected over-budget usage, timeout or output/tool-call bounds. **These are not provider-enforced billing ceilings.** An in-flight attempt or delayed billing can exceed a local estimate; retain reserve, stop on uncertainty, and use an account-side cap if an absolute monetary guarantee is required. Other simultaneously active Kiro sessions are outside this experiment's ledger and consume the same account independently.

### Operator-authorized continuation after re-login

Do not clear a stopped row or edit its charge to zero. If the operator explicitly reauthorizes work after resolving an account limit, create a separate manifest/output directory and retain the old series and exact harness. Optional `runIndices` is a strictly increasing subset of the original full schedule, using the same `cases`, `seed` and `repetitions`; it preserves prompts/fixtures/oracles and records each `sourceIndex`. Include both members of each pair to obtain paired ratios. Reports also accept partial continuations: an omitted counterpart leaves its pair incomplete and ratios `null`, without dropping observed attempt costs. Present counterparts must still match seed, prompt, fixture and oracle identities. Out-of-range, duplicate and unordered indices are rejected.

Carry known spend forward, keep unknown rejected charges explicitly unknown, reserve headroom and do not silently reset the original overall budget. A new authorization is not a billing receipt. Mark the authentication boundary and report the continuation as a separate stratum rather than pooling it into the unchanged pre-login headline matrix.

## Compare the efficiency candidate in Auto

For the before/after product comparison, use three arms in the same frozen schedule: implicit `native` (Default), `arms.old` (the saved pre-change Fabric profile and bundle), and `arms.fabric` (the rebuilt candidate). All use `model:"auto"`; omit an explicit effort override when measuring the user's normal Auto behavior. The existing scheduler rotates order by case and reverses it on the next repetition. Auto's actual routed model stays unknown; these are product observations, not a controlled comparison of underlying models.

Before updating the installation, preserve the old profile and its complete immutable bundle. Generate candidate resources from a fresh build. Give both Fabric arms separate private mutable data/config roots; preserve each arm's own prompt, help and hook. Freeze the CLI version, global steering/settings and fixture identities for the whole series. Do not change Default or the user's installed policies to accommodate the benchmark. Record any user-steering/resource differences between products instead of attributing them to model quality.

Use `bug-config`, `bug-retry`, `bug-checkout`, `review-infra`, `review-contracts` and `review-boundaries` for repair, boundary and review coverage, with the same cases/seeds for every arm. Smaller approved pilots should contain at least a repair and a review and be reported as pilots. Set the numeric planned spend, reserve and ceiling from the user's authorization before `plan`/`init`; `run` consumes credits and includes failures in the ledger. Budget exhaustion or unavailable usage leaves the comparison incomplete, never evidence of equivalent quality.

Compare the candidate against **both** Default and old Fabric. Accept lower credits as an improvement only alongside no observed loss in held-out repair success, review precision and recall, high-impact findings, required verification and scope coverage on matched cases. Inspect unsupported findings and omitted scope; finding count alone is insufficient. Retain all charges and failed attempts. Even a passing repeated fixture comparison does not guarantee equal quality on arbitrary repositories or universal savings.

Offline regression coverage verifies complete source delivery, hash-bound unread-tail recovery, no gaps or duplicates across output-budget pages, default full help with smaller-limit controls, and executable availability/verification recipes. These are deterministic functionality checks; they do not substitute for the paid Auto comparison or measure reasoning quality.

## Measuring model-round-trip optimization (future authorized A/B)

Use **A = immutable old Fabric**, **B = candidate Fabric**, with Default as a separate reference, not a proxy for A. Predeclare tasks, seeds, repetitions, quality gates and the analysis before collecting anything. Keep the identical task prompt and required verification for A/B; do not prompt either arm with a hard call cap or a target number of calls. Fewer calls obtained by skipping investigation are not an improvement.

1. Archive content hashes of the exact harness, manifest, prompts, fixtures and held-out oracles, CLI executable/version, installed profile, complete runtime bundle, generated resources, help/hook/steering and configuration for each arm. A source revision alone does not identify the installed runtime. Record the intended A/B differences; freeze everything else, including model/effort policy, permissions, environment and trace settings. Verify identities before and after attempts. Never update an installed generation mid-series.
2. Use fresh CLI sessions and disposable untouched workspaces for every attempt, with separate private mutable roots initialized equivalently. Do not resume conversations or carry workspace discoveries between arms. Run repeated matched case/seed blocks with A/B then B/A order (the existing three-arm scheduler rotates/reverses order). Keep cold/warm-cache and authentication boundaries explicit; backend load and Auto routing remain uncontrolled. Do not pool unmatched work or choose the best retry.
3. Maintain a source-coverage ledger alongside raw evidence: required paths and consumers, actual delivered ranges, hidden files, long-file tails, truncation recovery and unread scope. Source delivery is not proof of comprehension. Require the same held-out repair checks and verification scope; compare review precision, recall, false positives, duplicates and high-impact omissions using the existing quality metrics. Both strict passes alone do not establish equal review coverage or quality.
4. Report all planned, unrun, partial, failed, canceled and successful attempts, retaining raw streams, session/request IDs, charges, stop reasons and coverage. Use `outerToolCalls`/`toolCallCoverage` for observed non-system ACP exchanges, including failed tool calls. One outer Fabric execution may contain many nested provider operations; it need not correspond to one hidden model request. Request IDs are provenance, not a count of internal model requests. Unknown model-request counts, tokens and nested operations stay unknown; use independently exposed telemetry or existing trace analysis with its own coverage, never extrapolate from static recipes.
5. Inspect `comparison.json`'s additive `oldFabricOuterCallPairs`: one row per scheduled candidate case/round, joined to old Fabric by seed and fixture/prompt/oracle hashes, with raw counts and attempt indices. `bothPassOuterCallDelta` is candidate minus old; `bothPassOuterCallReduction` is `(old - candidate) / old` (a fraction, negative for more calls). Deltas require both successful, unstopped completed attempts and complete call evidence; reduction additionally requires a nonzero old count. Missing/unrun evidence remains `null`, while observed zero stays zero. A partial continuation schedule without a same-round old counterpart retains the candidate observation with `oldIndex:null` and no conditional reduction; scheduled counterparts must still match fixture identities. Failed attempts retain counts and stop evidence but get no conditional reduction. Existing Default-relative pairs and failure-aware totals are unchanged. Interpret these descriptive reductions only alongside matched quality and source coverage, not as hidden-request savings or measured speedup. Measure wall time separately; static call consolidation alone establishes neither latency nor cost improvement.

**Current runner limitation:** `maxCalls` is an enforced safety bound (default and maximum 40); there is no supported unlimited setting. Thus the current live runner cannot execute an uncapped protocol. Do not bypass it with an invented manifest value or claim bounded runs are uncapped. A future separately reviewed runner change is needed for no-hard-call-cap collection; retain timeout, output, spend and operator safety controls. Existing bound-hit attempts are censored failures, never efficient completions. This measurement change does not authorize live runs or alter those controls.

## Statistics and interpretation

Reports are `comparison.json`, `comparison.md` and `attempts.csv`. Raw attempts retain commands, prompts, outputs, before/after filesystem evidence, validation failures, session/request IDs and reported usage. Keep these private: real future tasks could contain confidential source.

A stream archive write error or short write triggers bounded process-group termination and descriptor cleanup. `process.outputError` records the archive failure; the attempt remains stopped, not a successful run. Capped in-memory collection continues during shutdown so observed charge evidence is retained. `retainedBytes` measures in-memory retention, not proof that all bytes reached disk; archives may be incomplete after an output error.

- **Strict pass**: process/usage/model/routing, exact output format/answer, allowed filesystem changes and independent checks all pass.
- **Independent project repair**: for TinyShop only, both public and held-out tests pass and all non-answer validity checks pass. An extra-prose/JSON failure remains a strict failure; the repair count is a separate quality dimension, not a retroactive relabeling. It proves controller-observed behavior, not that every claimed model-side test was executed.
- **Grounded review quality**: the `review-infra` oracle counts unique source-backed findings, false positives, duplicates, precision and recall. Scores remain visible for partial reviews even when strict answer validation fails. Routing/identity/process/scope failures or unparseable answers remain unscored, not zero-cost successes. Credits per verified finding include all review-attempt charges; incomplete scores or charges yield `null`.
- **Credits per success**: all comparable attempt credits, including failures, divided by successes. Unknown charge coverage or no successes yields `null`.
- **Latency**: end-to-end CLI wall time, including startup/tool work, with median and p90. Report coverage; interrupted attempts are not dropped to make the agent look fast.
- **Outer calls and traffic**: observed non-system ACP tool calls and serialized argument/result UTF-16 characters. Steering `summary` and comparison reports share `wallMs`/`wallCoverage` and `outerToolCalls`/`toolCallCoverage`: missing or invalid observations produce nullable totals, never fabricated zeros. Consumers must handle `null`; genuine observed zeros remain zero. These are not inner effect counts, prompt tokens, model round trips or wire sizes. Automatic cloud-config startup is excluded from model tool calls.
- **Paired ratios**: match case, round, seed, prompt, fixture and oracle identities; both-pass ratios are explicitly conditional, never a substitute for failure-aware totals.
- **Unknowns**: input/output/cache tokens, settled money charges and actual Auto routing remain `null` unless independently exposed. Do not estimate tokens from characters or convert credits to dollars without settled evidence.

Use `node scripts/analyze-trace.mjs <trace.jsonl> --json` for the existing Fabric inner-trace analysis. Do not conflate nested value bytes, bridge projection bytes and client-visible ACP output; retain trace coverage and errors. The trace analyzer is deliberately not reimplemented in the comparison report.

Two repetitions provide descriptive evidence only. Order is rotated/reversed; each request has a fresh client/workspace, but OS/prompt caches and backend load are not controlled. Never claim an overall efficiency winner from one passing pair, different task sets, denied tools, missing charges or cheaper incorrect repairs.

## Offline regression commands

```sh
node scripts/agent-comparison.mjs selftest
./node_modules/.bin/vitest run tests/agent-comparison.test.ts tests/native-fixture-policy.test.ts tests/steering-benchmark.test.ts
pnpm run typecheck
pnpm run lint:dead
pnpm run build
```

The selftest's reference repairs are **oracle qualification only**, never live agent wins or economic measurements. The targeted tests cover original/reference discrimination, held-out rejection of example-only fixes, equivalent repairs, immutable fixtures, pairing, tool registration, selective trust, missing telemetry, failure-aware cost and scoped permission cleanup.
