# Current Kiro readiness evidence

Use `pnpm run refresh:kiro-readiness` to emit a machine-readable snapshot of the
checked-out package, Git revision, built entrypoints, and billable-safety policy.
The command does not run a model, a real Kiro session, or Release B.

The report intentionally separates:

- **current evidence**: source checks, already-built artifacts, and any
  deterministic certification reports whose own Git binding matches this
  checkout;
- **external evidence**: historical real-Kiro observations (see
  `docs/kiro/baseline.md`, `docs/kiro/status.md`), which are not reclassified as
  current merely because the version changed;
- **unavailable**: real Kiro or billable prerequisites not supplied to the run.

Optional report inputs make readiness state whether a deterministic cert
actually ran for THIS checkout rather than implying a pass from source/build
presence alone:

```sh
pnpm run build
node scripts/certify-context.mjs --json /tmp/ctx.json
pnpm certify:kiro-claims -- --kiro-binary /path/to/kiro-cli --json /tmp/claims.json
pnpm certify:release-a -- --json /tmp/rel.json
node scripts/refresh-kiro-readiness.mjs \
  --context-report /tmp/ctx.json \
  --claims-report  /tmp/claims.json \
  --release-report /tmp/rel.json
```

Absent reports are reported `not_run` and leave readiness `inconclusive`, never
`pass`. Each producer emits a versioned Git binding containing HEAD, a workspace
tree hash, and dirty state. Readiness validates the report kind and schema, then
requires that complete binding to match the current checkout. Unbound,
wrong-kind, malformed, and fabricated summary-only payloads are rejected. A
well-formed certificate that explicitly failed is `not_verified`; a mismatched
binding is additionally marked `stale`.

Use `--output <file>` for a private artifact. Explicit report input/output paths
inside the checkout are rejected, because writing an evidence artifact there
would change the Git binding it is meant to attest. `--check` fails when Git identity
cannot be established or any explicitly supplied report is missing,
unparseable, invalid, stale, or failed. Omitted reports remain allowed. Run
`pnpm run build` before refreshing when built-entrypoint evidence is required;
a missing `dist/` entrypoint is `inconclusive`, never a pass. Keep report files
outside the checkout (for example under `/tmp`) so creating the report itself
does not change the checkout binding.

Real-Kiro claims require an explicit, separately authorized certification command.
No readiness refresh implicitly executes a billable gate or claims real-Kiro
success.
