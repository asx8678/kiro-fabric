# External reference identity diagnosis

Follow-up to the eight strict external-oracle differences recorded in
[native acceptance](native-acceptance-2026-09-21.md). The comparison assertions and
numerical tolerances are **unchanged**. No production graph identity algorithm,
cache authority or pinned upstream source was modified.

## Reproduce

Set the exact `FOVEA_REFERENCE_ROOT`, `FOVEA_HOST_REFERENCE_ROOT` and
`FOVEA_REFERENCE_PARSER` prerequisites, then run `pnpm run qualify:fovea:external`.
It archives the pinned source, executes two unmodified cold upstream processes
and two independent native cold processes per budget (512 and 16000), captures
raw state/output, and reconstructs the exact graph/state identity preimages.
Cache storage is removed between runs; no warmed facts, parser tape or scheduled
oracle are substituted. Empty discovery and invalid identity preimages fail.
Outputs are not sorted or filtered for comparison. Diagnostic multiset comparison
is explicitly separate from the strict parity verdict.

Pins: Fovea `b594483868d27b7eb37a9b185c59ce812f8a9c01`; host
`2ee51683452dc359702880f408e0b8a4bfcb9646`; parser 0.45.3 with Darwin SHA256
`5651f0c6dcbbf2f7813297f9eb8f6ba00fb4ee2d81410a8138ac6151416f31ad`.

## Actual paired result

At **both** budgets, external comparison and pristine reference self-repeat each
have exactly eight differences: `details.generation` and `details.version` of
sketch/focus/dwell/impact. Native self-repeat has **zero** differences.
Every recorded identity is reproduced exactly from its raw preimage.

Node order/preimages are equal. The weighted edge multisets (including semantic
endpoints and evidence) are also equal, but their **order differs**: external
comparisons have 29/76 differing edge fields; reference self-repeat has 65/52.
Corresponding parser call-fact arrays are reordered. `graphGeneration` hashes the
ordered edge stream, and `stateVersion` includes that generation, so both identities
change even though the visible operation results otherwise match. Native repeats
retain generation `3d9ea1b5a64c` and version `09039c2d2009` in these runs.

This identifies upstream raw call/edge ordering nondeterminism as the cause of
these eight mini-corpus mismatches. It is **not** evidence that every larger-family
native discrepancy is harmless, and it does not turn independent cold parity into
a pass. Cache header 16/17 is not itself in the identity preimage; changing headers
or normalizing hashes would be an invalid fix. Deterministic native production
ordering is retained rather than regressed to emulate unstable upstream ordering.

Strict diagnostic command: **exit 1**, intentionally unqualified.
Summary `.tmp/fovea-reference-diagnosis-closeout.json` names both retained private
scope reports and all raw-output SHA256 values. Exact scope IDs:
`fovea-qualification-69dWmt` (512) and `fovea-qualification-xOQsMG` (16000).
Original `.tmp/fovea-remaining-zOddTE/` failures remain preserved.

## Disposition

- Eight hash-field discrepancies: causally diagnosed, not a proven native output defect.
- Independent cold/reference repeatability: still failed/unqualified under unchanged assertions.
- Production deterministic/controlled comparison: separate existing qualification; must continue passing.
- Regression module: `tests/fovea/reference-diagnostics.test.ts` checks preimages,
  order-only divergence, content differences, empty discovery and read-only behavior.
