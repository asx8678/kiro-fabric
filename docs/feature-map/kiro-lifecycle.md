# Feature: Kiro lifecycle

## Sub-features

- `kiro-lifecycle.doctor-readonly` — `doctor kiro --json` is non-billable, zero
  model turns, zero profile mutation.
- `kiro-lifecycle.install-round-trip` — install/uninstall is hash-owned and
  idempotent in a disposable Kiro home.
- `kiro-lifecycle.mcp-single-tool` — the MCP server advertises exactly
  `fabric_exec` with the golden schema.

## How to get to it (user POV)

The user provisions the managed Kiro profile, checks its health, and relies on
the MCP runtime exposing a single confined tool.

## Driving it with pnpm, Vitest, and the packaged CLI

- Build: `pnpm build`.
- Probes:
  - `pnpm vitest run tests/kiro-installer.test.ts tests/kiro-uninstaller.test.ts`
  - `pnpm vitest run tests/kiro-doctor.test.ts`
  - `pnpm certify:kiro-claims -- --kiro-binary /path/to/kiro-cli`
    (complete executable non-billable gate; requires the built CLI and real
    supported Kiro binary; missing prerequisites are `skipped`, never passed).
  - Packed Release A: `pnpm certify:release-a` (out of CI, non-recursive).
- Evidence: `KiroClaimsReport` JSON; machine-readable doctor report.

## Gotchas

- These drivers exercise built binaries/protocols, never the source handlers.
- A `skipped` claim is NOT a pass; the gate fails closed without a kiro binary.
- Kiro capability wording is `qualified` or `unavailable` per
  `src/kiro/diagnostics.ts`; do not claim partial support.
