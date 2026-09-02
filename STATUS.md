# Kiro Fabric status

Updated: 2026-09-02

## Supported product modes

- **Kiro Power** is the default public integration. It is additive and keeps
  Kiro native tools available.
- **Strict** is an optional installer-managed custom agent with exactly one
  model-visible tool, `@fabric/fabric_exec`; every operation runs in code mode.
- **kiro-fabric-dev** is the repository-local code-mode development agent. It is
  distinct from the installer-owned `kiro-fabric` profile, disables ambient
  MCP/Powers and all native repository tools, and starts the built repository
  MCP entry through a checkout-confined launcher that enables `k.bash`.

## Pinned development tuple

- Node.js 24 or newer; package manager pnpm 11.20.0.
- Supported Kiro CLI: 2.20.1, agent engine v3, CLI-owned ACP authentication.
- Go is test-only, not a runtime dependency. Native security fixtures require
  Go 1.22 or newer; CI uses exact Go 1.25.1.

## Verification state

The current hardening checkout has deterministic local gates for canonical
path identity, process-tree and process-group draining, native-fixture
preflight, development-agent MCP smoke validation, namespace semantics, Power
package/skill validation, closure reproducibility, size ceilings, and repeated
lifecycle stress. Final local gate results for a change belong in its review
report; source text alone is not evidence that an operating-system CI job
passed.

Remote Linux, macOS, Windows, reproducibility, and real-Kiro qualification must
be verified for the exact release commit. A local checkout cannot claim those
remote contexts. Billable Kiro model-turn qualification is never run without
explicit authorization.

## Release blockers

- All required GitHub checks, including Linux/macOS lifecycle stress, must pass
  on the exact commit.
- Real, non-billable Power import/activation/deactivation qualification must
  pass on Linux, macOS, and Windows for that commit.
- Generated closures must reproduce without diff; package contents, SPDX SBOM,
  checksums, and the signed tag prerequisites must pass the release-candidate
  report.
- No immutable supported release exists yet; see `SECURITY.md`.
