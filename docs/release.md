# Release qualification

## Hermetic evidence

Ordinary qualification is checkout-local:

```sh
pnpm run check
pnpm pack --dry-run
pnpm run release:candidate
```

`check` runs type checking, a fresh build, all retained tests, dead-code analysis, hermetic MCP certification, and SBOM generation. `power:archive` creates the one deterministic release archive from the validated staged generation. CI must compare every file in two complete archives and requires the checkout to remain clean.

The SBOM is derived from package names observed in the exact bundled closure graph, not the whole lockfile. The release report recomputes the current closure digest and rejects a stale SBOM. Staged-package and qualification evidence similarly bind sorted relative paths and bytes. Tag releases additionally require an annotated signature that GitHub verifies and whose target is the exact workflow commit.

## Real Kiro CLI gate

Real-client qualification is explicit because it needs a supported, user-owned Kiro installation with the Power imported and enabled:

```sh
KIRO_POWER_REAL_DRIVER=/absolute/path/to/reviewed-driver \
KIRO_POWER_REAL_DRIVER_SHA256=<reviewed-sha256> \
  pnpm run certify:power:real -- --archive .tmp/kiro-fabric-power.tar.gz
```

The driver must be an absolute, regular, non-symlink executable matching the configured reviewed digest; its identity is checked immediately before and after execution. It receives the extracted exact archive, archive/package/commit digests, required `kiro-cli --v3` command, and a private evidence path. Qualification passes only when bounded transcript evidence records:

- the exact candidate digest;
- session command `kiro-cli --v3`;
- actual Power activation;
- exactly `fabric_info`, `fabric_workspace`, and `fabric_exec`;
- no custom agent selected;
- observed native Kiro file-read, file-edit, shell, web, and subagent capabilities;
- driver and Kiro binary paths, versions, and digests.

Pass that qualification JSON explicitly when producing the release-bound report:

```sh
node scripts/release-candidate-report.mjs \
  --sbom .tmp/kiro-fabric-power.spdx.json \
  --qualification /absolute/path/to/real-client.json
```

The report rejects missing, malformed, stale, or wrong-contract evidence; it never infers a pass from ordinary CI.

## Checkout-local staging

The supported source is the validated checkout-local `.tmp/kiro-fabric-power` generation, imported through Kiro's official flow. No retained build, test, certification, packaging, or release command writes to `$KIRO_HOME`. User-home export is intentionally absent until a smaller cross-platform design can be independently reviewed.

A future host-neutral Fovea provider remains out of scope until this Power-only baseline is qualified. It must reuse verified workspace binding, honor `.kiroignore`, keep caches private and workspace-scoped, propagate cancellation, use existing artifacts, and avoid any extension-host wrapper.
