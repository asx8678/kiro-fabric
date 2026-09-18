# Readiness remediation scope

This work improves local readiness; it does not certify native Kiro approval, exact model-tool filtering, production signing, or benchmark superiority.

## Acceptance ledger

- Client diagnostics: preserve sanitized typed elicitation failure reasons, including positively identified missing handlers, while retaining fail-closed approval and no fallback effects. Cover secret-bearing errors, accepted/declined/cancelled requests and unchanged effect metadata. Preserve existing boolean approval callers where needed. Clarify Fabric-local tool inventory versus authoritative Kiro model inventory; never certify the incomplete `/tools` picker. Prepare sanitized upstream issue drafts without publishing them.
- Release hygiene: prepare canonical package version 0.65.0, changelog and expectedSha256 migration examples, release checklist and version-consistency tests. Generate artifacts rather than hand-editing them. Preserve historical 0.64.0 evidence. No commit, tag, publication or installation in this scope.
- Benchmark accounting: in scripts/steering-benchmark/plan.mjs reject explicit null numeric budget inputs instead of treating unknown spend as zero. In runner.mjs keep total spent and projection unknown when charge evidence is absent; any known subtotal must be explicitly labelled. Preserve admission stops and failure evidence.
- Benchmark correctness: extend TinyShop execution-audit evidence to distinguish controller-tested repair correctness from required agent before/after test execution. Require ordered exits and matching source hashes; reject missing, malformed, reversed or stale records. Controller probes must not satisfy agent verification. Preserve historical results and document changed protocol identity and the benign-fixture audit boundary.
- Verification: inspect relevant execution paths before editing; implement only demonstrated gaps, add focused regressions, run targeted checks and pnpm run check where feasible, inspect actual exit codes (no masking pipelines), and finish with a fresh pnpm run build. Report any environmental failures separately from code regressions.

## Ownership and constraints

Parallel scope reviews completed for client integration, release hygiene and benchmark readiness. Implementation may be split into disjoint source/test ownership; coordinate shared documentation and generated artifacts centrally. Follow AGENTS.md and preserve unrelated changes.

Native Kiro 2.21.1/2.22.0 missing `_kiro/mcp/elicitation` handler and observed `disclose_context` remain documented client blockers. No confirmed upstream fix was found by scope review. Do not patch installed binaries, weaken policies, broaden the one-tool requirement, or mistake headless success for interactive approval. Current source execute defaults must be checked: approval probes need explicit `execute: ask` rather than assuming it.

Historical benchmark row 19 has unknown charge and its referenced raw archive is unavailable here. A new run cannot reconcile it. Do not launch paid comparisons without an explicit numeric budget and accounting scope; retain unknown charges as unknown. No public issue or release is authorized by this implementation scope.

## External completion requirements

A supported native Kiro client and human approve/decline checks; authoritative complete model-tool inventory; historical billing/raw evidence; an approved paid comparison budget; and separate production signing/platform qualification. These gates stay blocked until independently evidenced.
