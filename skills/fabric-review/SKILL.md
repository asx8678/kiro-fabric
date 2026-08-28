---
name: fabric-review
description: Runs a bounded advisory review of a changed-file scope using managed Kiro ACP children. Use for correctness/security and maintainability review when subagents are enabled.
disable-model-invocation: true
---

# Managed Kiro review

Review a scoped change through two independent read-only lanes:

1. Correctness & security: regressions, unsafe boundaries, protocol mistakes,
   failure handling, and missing adversarial coverage.
2. Maintainability: unnecessary complexity, tangled ownership, inefficient hot
   paths, and misleading contracts.

Derive a bounded changed-file list before spawning. Give each lane the objective
and file paths, not an unbounded repository dump. Use `agents.run()` with
`tools: ["read","grep","find","ls","bash"]`; tell reviewers not to edit.
Run the two calls with `parallel(..., {concurrency:2})` and preserve either
result if the other fails.

Reconcile by concrete path/evidence, deduplicate equivalent findings, and keep
only material defects. A model finding is advisory; deterministic builds,
tests, protocol checks, and direct reproduction outrank it. Review does not
authorize code changes on its own.

Return coverage, failures, and findings with severity, title, path, optional
line, evidence, impact, and recommendation. Use `partial` when one lane fails,
and never automatically rerun a successful lane.
