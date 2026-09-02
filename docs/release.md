# Release qualification

## Hermetic evidence

Ordinary qualification is checkout-local:

```sh
pnpm run check
pnpm pack --dry-run
pnpm run release:candidate
```

`check` runs type checking, a fresh build, all retained tests, dead-code analysis, staging, hermetic MCP certification, and SBOM generation. Build validates manifests and direct dependencies before emitting artifacts. CI builds twice, compares every closure path and byte digest, and requires the checkout to remain clean.

The SBOM is derived from package names observed in the exact bundled closure graph, not the whole lockfile. The release report recomputes the current closure digest and rejects a stale SBOM. Staged-package and qualification evidence similarly bind sorted relative paths and bytes. Tag releases additionally require an annotated signature that GitHub verifies and whose target is the exact workflow commit.

## Real Kiro CLI gate

Real-client qualification is explicit because it needs a supported, user-owned Kiro installation with the Power imported and enabled:

```sh
KIRO_POWER_REAL_DRIVER=/absolute/path/to/reviewed-driver \
  pnpm run certify:power:real -- --package .tmp/kiro-fabric-power
```

The driver must be an absolute, regular, non-symlink executable. It receives the exact package digest, required `kiro-cli --v3` command, and a private evidence path. Qualification passes only when machine-validated evidence proves:

- the exact candidate digest;
- session command `kiro-cli --v3`;
- actual Power activation;
- exactly `fabric_info`, `fabric_workspace`, and `fabric_exec`;
- no custom agent selected.

Pass that qualification JSON explicitly when producing the release-bound report:

```sh
node scripts/release-candidate-report.mjs \
  --sbom .tmp/kiro-fabric-power.spdx.json \
  --qualification /absolute/path/to/real-client.json
```

The report rejects missing, malformed, stale, or wrong-contract evidence; it never infers a pass from ordinary CI.

## User export isolation

Only `pnpm run power:export:user` may touch `$KIRO_HOME`, and it creates an owned local import source rather than registering or enabling a Power. Build, test, check, certification, packaging, and release reporting run under a Kiro-home mutation guard. Export validates a private staged tree, serializes updates, verifies the copied digest, and preserves the previous destination on failure.

A future host-neutral Fovea provider remains out of scope until this Power-only baseline is qualified. It must reuse verified workspace binding, private workspace-scoped caches, cancellation, and artifacts without introducing an extension-host wrapper.
