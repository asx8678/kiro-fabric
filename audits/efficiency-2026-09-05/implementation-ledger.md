# Implementation acceptance ledger
Baseline d33cbdca33fac6ce301a6da884f06ee5141534da; pre-existing audit artifacts preserved. Sol-low route preflight f608a00d33b7453790adb18713cd4bfc verified terminal openai-codex/gpt-5.6-sol. Astra orchestrates and separately validates.

- F05/F07 memory: exact-owned lock cleanup retry and truthful committed/read-before-retry errors; pre/post-publication, failure/recovery/replacement and concurrent-write tests. No storage migration or relaxed isolation.
- F06 workspace: recheck cancellation/closing at serialized commit; preserve identity/elicitation/drain; cancelled request leaves binding unchanged.
- F01/F02 discovery: bounded total/returned/completeness/representation with targeted recovery and no unnecessary list/count example; byte boundaries/all degradation tests.
- F03 analyzer: clipped child interval union, invalid timing unknown/anomaly, correct chars labels; serial/overlap/malformed/legacy tests.
- F04 telemetry contract: metadata-only exec.projection data {visibleChars,visibleBytes,isError,overflowed,artifactRetained}. Legacy resultChars stays preprojection; explicit resultValueChars added. Absent fields unknown, never billed tokens. Test Unicode/errors/overflow/privacy.
- F08 no speculative prompt compression/change health cadence absent host evidence. Safe immutable schema reuse only if isolated from mutation with tests; never drop required instructions.
- B01 current Sol route must verify response metadata on all implementations. Historic GLM unresolved; no global harness edits. B02 live Kiro/billing/quality/threshold checks stay blocked, no paid sweep/install or invented savings.
- Independent Astra source+test validation, Sol followup fixes, fresh build/stage/full tests/typecheck, final pnpm run build. No commits/push/deploy.
