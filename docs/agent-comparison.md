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

The output directory must not already exist. The exporter creates nine complete projects, their task prompts and a hash manifest. No reference solutions or held-out tests are exported into the agent workspaces. To inspect the all-bugs example:

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
  path: 'src/money.mjs', oldText,
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

`arms.fabric` names the snapshotted Fabric profile, complete bundle root and preinitialized private config paths; native is implicit. Legacy `old`, `pass1`, `pass2` arm names remain supported. `model` is passed identically to both agents and checked against returned session configuration. `auto` does **not** identify the actual routed model/revision; use an available explicit model ID for a tighter future experiment.

### Current native v3 shell policy

Tool trust is insufficient for shell execution. With the explicit `nativeWorkspacePermissions:true` option, the controller creates a new `HOME/.kiro/workspace-roots/<normalized-workspace-SHA256-prefix>/permissions.json` only for that unique disposable workspace. The policy permits Node, fixture Python (`-B`) and `cd` shell commands. Existing policy directories are refused rather than overwritten. File/directory identities and content hashes are recorded in the attempt row. After the trial the controller removes only its unchanged policy file, and removes its directory only if empty. Global permission rules and the default native agent are unchanged.

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

Do not clear a stopped row or edit its charge to zero. If the operator explicitly reauthorizes work after resolving an account limit, create a separate manifest/output directory and retain the old series and exact harness. Optional `runIndices` is a strictly increasing subset of the original full schedule, using the same `cases`, `seed` and `repetitions`; it preserves prompts/fixtures/oracles and records each `sourceIndex`. Include both members of each pair when using the paired report. Out-of-range, duplicate and unordered indices are rejected.

Carry known spend forward, keep unknown rejected charges explicitly unknown, reserve headroom and do not silently reset the original overall budget. A new authorization is not a billing receipt. Mark the authentication boundary and report the continuation as a separate stratum rather than pooling it into the unchanged pre-login headline matrix.

## Statistics and interpretation

Reports are `comparison.json`, `comparison.md` and `attempts.csv`. Raw attempts retain commands, prompts, outputs, before/after filesystem evidence, validation failures, session/request IDs and reported usage. Keep these private: real future tasks could contain confidential source.

- **Strict pass**: process/usage/model/routing, exact output format/answer, allowed filesystem changes and independent checks all pass.
- **Independent project repair**: for TinyShop only, both public and held-out tests pass and all non-answer validity checks pass. An extra-prose/JSON failure remains a strict failure; the repair count is a separate quality dimension, not a retroactive relabeling. It proves controller-observed behavior, not that every claimed model-side test was executed.
- **Credits per success**: all comparable attempt credits, including failures, divided by successes. Unknown charge coverage or no successes yields `null`.
- **Latency**: end-to-end CLI wall time, including startup/tool work, with median and p90. Report coverage; interrupted attempts are not dropped to make the agent look fast.
- **Outer calls and traffic**: observed non-system ACP tool calls and serialized argument/result UTF-16 characters. These are not inner effect counts, prompt tokens, model round trips or wire sizes. Automatic cloud-config startup is excluded from model tool calls.
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
