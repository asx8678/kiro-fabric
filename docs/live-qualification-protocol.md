# Live-qualification protocol (evidence bar, not authorization)

Status: definition only. The live-qualification gates in the agent guidance
and review profile remain **false** until this protocol is executed under
operator-authorized live inference. This document defines what evidence a
future authorized run must capture; it does not authorize any run, and no
automated or fixture-based substitute qualifies.

Standing rule (already encoded in the generated guidance): a healthy
installation doctor, a valid profile, a green build or test suite, an
initial MCP token count, or an assistant's prose answer is **not** live
coding-readiness evidence. Only observed stream events qualify.

## Preconditions

1. Explicit operator authorization for live inference, recorded with the
   session identity and date.
2. The installed generation launcher
   (`${KIRO_HOME:-$HOME/.kiro}/kiro-fabric/bin/kiro-fabric`), a fresh
   session, and a pinned `KIRO_FABRIC_LAUNCH_WORKSPACE` pointing at a
   disposable fixture repository.
3. The exact `kiro-cli` version recorded, and chat options placed after the
   `chat` subcommand (`--v3 --agent kiro-fabric --output-format stream-json
   --require-mcp-startup`), because option placement selects the agent on
   the tested CLI.

## Gates and required artifacts

Each gate flips only on a verbatim event excerpt stored under a
docs/evidence directory (secrets redacted), together with the exact command line:

- **G1 -- v3 agent selection.** Stream events show the `kiro-fabric` agent
  actually selected (not the default agent observed when options precede
  `chat` on some CLI versions). Disqualifier: selection by prose claim.
- **G2 -- Fabric execution witness.** An actual `@fabric/fabric_exec`
  tool call and its result in stream events, with MCP startup required.
  Disqualifier: native fallback, or an answer with no tool-call event.
- **G3 -- Approval UX witness.** With `execute: ask` configured, one
  human-declined command (no effect observed) and one human-approved
  command (intended effect observed), each captured as event excerpts with
  the command verbatim. Automatic fixture approvals are not human
  interaction and do not count.
- **G4 -- Terminal cancellation witness.** A run cancelled mid-execution:
  abort/cleanup observed in events, no phantom effects afterward.
- **G5 -- Session integrity.** Session identity recorded; no native
  fallback, no default-agent path, and native compaction behavior observed
  (native `/compact` remains enabled; Fabric adds no override).

## Disqualifiers for the whole run

- Observed native fallback or default-agent selection at any point.
- Retry-until-green: repeated launches until the events look right.
- Missing excerpts, redacted-beyond-use evidence, or evidence captured
  from a non-pinned workspace.
- Treating fixture automation, doctor output, or token counts as a gate.

## Gate-flip procedure

1. Write docs/evidence/live-qualification-<date>.md with the artifact set.
2. Update only the statements the artifacts actually cover, in the agent
   guidance and review profile, quoting the evidence in the change
   description.
3. Ship as a normal commit. No gate flips without the full artifact set;
   partial evidence keeps the gate false with the gap recorded.
