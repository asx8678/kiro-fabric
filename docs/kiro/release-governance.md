# Kiro Power release governance

Public Kiro Power releases are fail-closed. A successful local build is not a
release authorization.

## Automated source gates

`.github/workflows/ci.yml` runs Node 24 on Linux, macOS, and Windows. The Linux
reproducibility job rebuilds both runtime closures, synchronizes manifests,
runs protocol certification, and requires `git diff --exit-code` for every
checked-in generated artifact.

Run the same gate locally before committing:

```bash
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
git diff --exit-code -- dist/kiro-closure dist/kiro-power-closure plugin.json mcp.json package.json
```

## Repository protection

Repository settings cannot be enforced by source code alone. An administrator
must run the following once with a token carrying repository administration
permission:

```bash
GH_TOKEN=... GITHUB_REPOSITORY=asx8678/kiro-fabric pnpm run github:protect-main
```

The script protects `main`, requires the three Node 24 OS checks plus the
reproducibility check, enforces signed commits, blocks force pushes/deletion,
and requires review for future changes. Verify the resulting GitHub ruleset in
the repository settings; absence of that server-side policy is a release
blocker.

## Real Kiro qualification

Protocol simulation is necessary but not sufficient. The
`Real Kiro Power qualification` workflow runs only on clean self-hosted runners
labelled `kiro-power` plus `linux`, `macos`, or `windows`. Each runner must set
`KIRO_POWER_REAL_DRIVER` to an absolute reviewed driver executable. The driver
must import and exercise the Power in the real Kiro client and write Git-bound
evidence for every check declared by `POWER_REAL_CHECKS` in
`scripts/certification/readiness-reports.mjs`.

The workflow aggregates all three platforms into
`kiro-fabric.power-real-qualification` evidence and publishes the
`kiro-power-real/all` commit status. Missing, stale, partial, dismissed, or
failed evidence cannot be promoted to a pass.

## Tagged releases

`.github/workflows/release.yml` requires:

- a cryptographically signed `v<package-version>` tag;
- successful real Kiro qualification on the exact commit;
- the complete local check and Power protocol certificate;
- zero generated-artifact drift;
- a Power-only runtime archive;
- an SPDX 2.3 SBOM and SHA-256 checksums; and
- GitHub artifact attestations.

The workflow publishes the archive, protocol certificate, real-client
qualification, SBOM, checksums, and attestations together. Install production
Powers from an immutable tagged release, never from a mutable branch.
