# Trace analyzer follow-up

Scope: `scripts/analyze-trace.mjs`, `tests/trace-analyze.test.ts`, and `docs/tracing.md`.

- Restored the backward-compatible per-execution `resultChars` field while retaining explicit legacy, returned-value, and projection measurements.
- Made span validity consistent across global and per-execution views, including finite endpoint validation and safe Chrome Trace omission.
- Preserved unknown bridge size measurements as null with known/unknown coverage counts; genuine zero remains known.
- Counted unique observed requests from start or projection events, with separate guest-start counts and projection-only outcome fallback.
- Added focused regression coverage for overflow, invalid span visibility, Chrome output, request deduplication, projection-only failures, and unknown bridge sizes.
