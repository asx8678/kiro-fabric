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

Before spawning, give both lanes the same concise, risk-first evidence packet:
the objective; at most 12 changed paths; the highest-risk boundary first; bounded
relevant diff/source windows; and named deterministic checks. Label every packet
fact **Observed** when supported directly by a path, line, diff, command, or
result, and **Inferred** when it is a hypothesis to test. Do not turn child prose
or an inferred claim into observed evidence.

State exactly one shared, falsifiable safety invariant for the change. Each lane
must return one proof grade for that invariant: **proven** (direct deterministic
evidence covers it), **supported** (bounded evidence supports but does not close
it), **disproven** (a concrete counterexample), or **unknown**. Include the test
or observation that could falsify the invariant; confidence alone is not proof.

Give each lane only the packet and scoped paths, not an unbounded repository
dump. Use `agents.run()` with `tools: ["read","grep","find","ls","bash"]`;
tell reviewers not to edit. Run the two calls with
`parallel(..., {concurrency:2})` and preserve either result if the other fails.

Request an old/new trace only when a finding depends on changed control flow,
data flow, authorization, persistence, or failure behavior. In that case bound
it to at most eight numbered steps per side, mark each step Observed or Inferred,
and stop at the first material divergence. Otherwise omit the trace.

Reconcile risk-first by concrete path/evidence, deduplicate equivalent findings,
and keep only material defects. A model finding is advisory; deterministic
builds, tests, protocol checks, and direct reproduction outrank it. Review does
not authorize code changes on its own.

Return the evidence packet, invariant and proof grade, lane coverage/failures,
and findings with severity, title, path, optional line, Observed evidence,
Inferred impact, and recommendation. Include the bounded conditional old/new
trace only when required above. Use `partial` when one lane fails, and never
automatically rerun a successful lane.
