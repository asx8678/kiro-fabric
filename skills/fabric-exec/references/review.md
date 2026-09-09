# Evidence-led repository reviews

Use for code reviews, audits and open-ended requests to improve a project. This is guidance, not permission: honor user scope, read-only constraints, tool bans, output formats and explicit time/cost limits. A review does not authorize edits, deployments, secret use or network requests. The routine 120-word reporting default does not limit review coverage or findings.

## Map once, inspect by risk

1. Identify the actual repository role and requested scope. Distinguish application code from deployment/configuration, generated/vendor code and external dependencies. For a small repo, obtain a recursive file manifest rather than repeatedly listing one directory at a time. For a targeted review, stay in the named area and its dependencies.
2. Keep a compact coverage ledger in working context: area/path, evidence read, open leads, status (inspected / inapplicable with reason / blocked or unreviewed). Include applicable entrypoints and runtime logic, CI and maintenance scripts, environment overrides, config/template consumers, tests/validators, and security/data boundaries. Prioritize by plausible impact, likelihood and cost to verify. Do not create persistent scratch files or a memory mirror.
3. A directory listing or filename is not inspected behavior. Follow references: pipeline -> script -> arguments/exit status; default -> environment override -> rendered resource; configuration key -> loader -> observable effect; input -> validation -> state change. Compare environments and caller/callee contracts. Read referenced executable scripts, not just their launchers. If an implementation lives elsewhere, identify that boundary instead of guessing.

For a verified unknown workspace (do not repeat an existing manifest):

```ts
const manifest = await local.find({path:".", pattern:"**/*", hidden:true, limit:200});
return manifest;
```

`hidden:true` includes dot-directories such as CI configuration. Ignore files still apply and VCS internals are excluded. `scope` records the path/glob/options actually searched. `truncated:false` means complete within those rules, not all files on disk. A zero-match search is not proof of absence: check spelling, scope, ignore files and likely consumers; use an explicitly observed path when necessary. On truncation, partition by relevant subdirectory rather than repeat the same prefix or dump the entire repository.

## Read once, preserve missing evidence

Batch independent reads with bounded `parallel`; merge overlapping windows per file. Keep known-schema parsing, counts, comparisons and joins inside Code Mode. Return decision-relevant source windows with path/line and coverage metadata, not every raw record. Unknown code still needs model inspection: do not replace source with guesses from filename or substring counts. Never expose credential values; report redacted locations.

Track `totalLines`, `nextOffset`, `truncated` and hashes. Continue a relevant partially read file, or explicitly mark its unread suffix unreviewed. For an explicitly requested line range, stop at its end even if the file continues. Whole-file counts/claims require whole-file evidence; check hashes across pages. Inspect long structured data by a complete bounded parse/scan, returning exceptions and totals rather than pages of repetitive records. Do not silently treat the first 200 lines as the entire dataset.

## Verify and try to falsify

For each candidate record location, triggering conditions, causal path, observable impact and verification. Inspect the consumer before declaring a setting unused. Check alternative owners, defaults, platform behavior and environment checks before claiming something is missing. Distinguish an intentionally disabled feature from a broken active one.

Use the smallest safe probe that resolves uncertainty: render/lint configs when tooling is available, exercise a pure function with boundary cases, compare contract inputs/outputs, or inspect relevant tests. Batch independent checks; do not rerun unchanged passing checks. Do not run deployment/cleanup scripts against real services. Missing dependencies or approvals are blockers, not permission to install, weaken policy or pretend a probe ran.

Actively seek counterexamples. One replica does not by itself prove rollout downtime; identical staging/prod versions can be correct promotion; absent checksum annotations do not establish application reload behavior. Confirm collection-mutation and exit-code semantics with the actual API/runtime. Deduplicate one underlying defect reported through several symptoms. A longer list of speculative issues is not better quality.

## Completion and reporting

Before finalizing, compare the coverage ledger with the original request. Resolve high-risk open leads, including referenced scripts and overrides; don't stop merely because several findings exist. Every applicable area needs inspected evidence or a stated boundary/blocker. For a large/time-bounded review, report partial coverage and the highest-value next checks rather than imply exhaustiveness. Do not fill a numeric findings quota or perform low-value scans merely to spend a budget.

Report verified defects first, ordered by impact, with file:line, causal evidence and a concrete next step. Keep unverified risks and optional recommendations separate. State verification actually run, important uninspected scope and blockers. Concision applies to narration and duplication, not the necessary investigation. No findings is valid when supported; no issues found is not proof that none exist.
