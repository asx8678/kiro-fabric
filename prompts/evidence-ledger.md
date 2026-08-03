# Evidence ledger

Every claim has evidence status `unverified`, `verified`, or `failed`; machine-facing result status is `success`, `partial`, or `failed`. Verified requires mechanical evidence: repository path plus line and exact quote, or an explicitly allowed deterministic probe with command/check and observed result. Schema validity, confidence, worker count, model identity, or agreement is not evidence. Missing, stale, contradictory, or unrun evidence remains unverified or failed. Preserve honest coverage gaps.

Search before reading: bounded `glob`/`grep` first, then bounded `read`/`readMany`; widen only as needed. Keep every evidence projection bounded and state the exact omitted count and reason.