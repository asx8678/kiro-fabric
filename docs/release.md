# Release qualification

## Hermetic evidence

Ordinary qualification is checkout-local:

```sh
pnpm run check
pnpm pack --dry-run
pnpm run release:candidate
```

`check` runs TypeScript and release-script checks, a fresh build, all retained tests, dead-code analysis, hermetic MCP certification, and SBOM generation. `audit:deps` is a live registry advisory gate used by CI and candidate/tag release workflows; it remains separate so `check` stays checkout-local. `power:archive` creates the one deterministic release archive from the validated staged generation using the repository-owned Node USTAR/gzip writer rather than platform-specific tar creation flags. CI must compare every file in two complete archives and requires the checkout to remain clean.

The SBOM is derived from package names observed in the exact bundled closure graph, not the whole lockfile. The release report recomputes the current closure digest and rejects a stale SBOM. Staged-package and qualification evidence similarly bind sorted relative paths and bytes. Tag releases additionally require an annotated signature that GitHub verifies and whose target is the exact workflow commit.

## Real Kiro CLI gate

Real-client qualification is explicit because it invokes a supported, authenticated, user-owned Kiro installation and intentionally imports and enables the candidate Power:

```sh
pnpm run certify:power:real -- --archive .tmp/kiro-fabric-power.tar.gz
```

The repository-owned driver is digest-bound before execution and verifies the resolved private `kiro-cli` binary immediately before and after use. It receives the extracted exact archive, archive/package/commit digests, a private empty qualification workspace used as the `kiro-cli --v3` working directory, and a private evidence path. Qualification passes only when bounded transcript evidence records:

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

The supported source is the validated checkout-local `.tmp/kiro-fabric-power` generation, imported through Kiro's official flow. Ordinary build, test, hermetic certification, packaging, and release-report commands do not write to `$KIRO_HOME`; the explicit real-client gate necessarily uses the operator's Kiro installation and state. User-home export is intentionally absent until a smaller cross-platform design can be independently reviewed.

A future host-neutral Fovea provider remains out of scope until this Power-only baseline is qualified. It must reuse verified workspace binding, honor `.kiroignore`, keep caches private and workspace-scoped, propagate cancellation, use existing artifacts, and avoid any extension-host wrapper.
