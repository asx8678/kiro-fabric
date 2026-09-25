# Complete-bundle release pipeline

The complete-bundle path is now separate from legacy Agent archive promotion.
**Implementation is not production provisioning or qualification.** The static
production Ed25519 root is still empty; no signing key, secret, runner, tag,
workflow run or release was provisioned by this change. Current native Kiro gates
also prevent honest client qualification. The legacy readiness stub remains blocked;
the new promotion entrypoint has actual signature/evidence checks instead of that
unconditional stub.

## Commands and immutable phases

1. On each real native host, at the same clean reviewed commit, run
   `node scripts/build-complete-candidate.mjs COMMIT`, then
   `pnpm run release:complete:prepare BUNDLE CHECKOUT NEW_OUTPUT COMMIT` (take BUNDLE
   from `.tmp/complete-bundle.json`). The candidate builder checks the exact clean
   commit before any writes and again after closure/bundle capture. It builds into
   a fresh `.tmp/candidate-build-*/closure`, including host-native Navigator bytes;
   tracked `dist/` and generated guidance are never rewritten. Stale guidance fails
   rather than being silently regenerated. Output and failure evidence are retained.
   The low-level compatible options are `build-kiro-closure.mjs --outdir NEW_DIRECTORY`
   (existing destinations are refused) and `build-complete-bundle.mjs --closure DIRECTORY`.
   Closure inventories, source input digests and exact manifest bytes remain checked
   at copy, reuse and publication boundaries. These options do not waive clean-source
   release gates. `pnpm run agent:bundle` remains a development build, not this path.
   The preparer rejects dirty/untracked checkouts, stale source digest/commit,
   legacy bundles and wrong native host. It accepts only a non-browser schema-2
   bundle and captures it with release provenance **before** any qualification. The
   original development
   bundle is not altered. Output contains the final versioned archive, exact
   binary-aware SPDX sidecar, canonical unsigned metadata, domain-separated
   signing input, candidate record and native smoke. No release is signed or installed.
2. Execute and independently review **native**, **installed**, **client**,
   and **minimum-system** qualification against those final bytes, for
   all four targets. Retain sanitized gate reports and private raw witnesses; do not
   write successful reports from mocks, runner labels or self-authored model claims.
   The report schema and required checks are enforced by
   `validateCompleteGateEvidence` in `scripts/complete-release-promotion.mjs`.
   Installed evidence must cover the exact archive, independence, upgrade/rollback
   and crash recovery. Client evidence includes authoritative tool inventory, human
   accepted/declined shell/edit, revocation, compaction/resume and shutdown.
   Minimum-system runs are separate from the ordinary hosted-runner version.
   Native smoke alone cannot satisfy the installed or client gates.
3. Collect final archives/sidecars plus `TARGET/native.json`, `TARGET/installed.json`,
   `TARGET/client.json`, `TARGET/minimum-system.json`, and
   hash-named JSON witnesses in an operator-controlled private input directory. Each
   gate binds the exact target, commit, archive and bundle. Every witness's bytes,
   size and SHA256 must match. Run
   `pnpm run release:complete:signing-inputs INPUT COMMIT vVERSION`. This emits
   canonical qualification records and domain-separated signing inputs,
   **not signatures**. Missing/pending/stale evidence fails; existing requests or
   signatures are never overwritten. Automated native/client/minimum-system
   receipt producers are still infrastructure/integration work; no successful receipts were
   manufactured here.
4. A separately authorized production signer reviews these evidence sets and signs
   both per-target metadata and qualification requests. Metadata uses the existing
   `kiro-fabric.release.v1` domain; qualification uses the distinct
   `kiro-fabric.complete-qualification.v1` domain (each followed by NUL and canonical
   JSON). Sign the emitted input bytes, not a reconstructed/recompressed archive.
   Each detached Ed25519 signature is canonical base64 of 64 bytes plus one newline
   (89 bytes total). Store metadata signatures next to the archive with `.release.sig`
   and qualification signatures with `.qualification.sig`. This is a publisher
   attestation following native evidence review, **not** a claim that JSON booleans
   or arbitrary raw bytes mechanically prove native behavior.
5. Run `pnpm run release:complete:promote INPUT NEW_OUTPUT COMMIT vVERSION`.
   Only the checked-in `PRODUCTION_TRUST_ROOT` is accepted—no environment/CLI/test
   key override. All four target signatures, qualification signatures, all four gate
   records, witnesses, release-provenance manifests, archive/SBOM identities
   and closure bytes are checked before output creation. The output copies captured
   archives
   without recompression and generates a bootstrap pinned to those verified bytes.
   Raw witnesses/gate records are **not** public release assets. No existing output
   directory is replaced. Fixture keys reach only the explicitly internal test API.

The publication report's `releaseReady:true` means the exact captures satisfy this
production-signature and maintainer-attestation contract. It is not emitted by
candidate preparation, smoke tests, encryption, unsigned signing requests or the
currently blocked production CLI. The trust root must be pinned **before** building
the candidate manager; changing it invalidates source provenance and requires new
candidates and qualification.

## Protected workflows and private evidence

`.github/workflows/complete-bundle-candidate.yml` is manual-only and requires the
protected default branch plus the `complete-release-qualification` environment.
It declares Linux x64/arm64 and macOS x64/arm64, rejects translated/mismatched
execution, and uploads exact **unsigned** candidates with partial smoke evidence.
It receives no signing credentials. Hosted runner labels are not provisioning or
execution evidence; unavailable runners stay pending.

`.github/workflows/complete-release.yml` checks an annotated GitHub-verified tag
against the exact protected workflow commit before checkout; requires the static
root, runs the full local check, and consumes a successful same-commit manual
qualification run. The input artifact must be named `complete-release-inputs-COMMIT`.
**Repository Actions artifacts are not private merely because an environment
requires approval.** Upload only `inputs.enc`, never plaintext gate/witness reports.

For a reviewed private input directory, use
`pnpm run release:complete:inputs pack INPUT NEW_ENCRYPTED_FILE VERSION`.
Supply `KIRO_RELEASE_INPUTS_PASSPHRASE` through the operator's protected environment
(at least 32 bytes, not on the command line). This confidential transport uses
scrypt plus fresh salt/nonce and AES-256-GCM. It is not the signing key and does not
replace production signatures. The approved qualification job receives the matching
`COMPLETE_RELEASE_INPUTS_PASSPHRASE` secret, decrypts to a new private directory with
bounded allowlisted paths, verifies all production evidence, then removes plaintext
before asset upload. The independently provisioned qualification/signing job must
upload the encrypted artifact; that job/account/custody setup is not fabricated by
this repository. Do not reuse raw Kiro home/log archives as transport inputs.

Publication has a separate `release` environment approval. Immediately before
publishing it rechecks the original annotated tag-object SHA and peeled commit.
It also requires an active tag ruleset with **update and deletion restrictions,
no bypass actors**, no exclusions, and either all-tags or an exact tag inclusion.
This prevents a moved-tag race rather than merely observing it once. Repository
administrators remain trusted not to weaken those rules during promotion. Actions
are pinned to full revisions; the publishing job has no signing key or raw witnesses.

## External provisioning checklist (still pending)

- [ ] GitHub access and permission to configure the protected qualification/release environments.
- [ ] Maintainer-owned Ed25519 custody, reviewed public-root pin and offline/protected signing ceremony.
- [ ] Available real runners for all four targets, plus declared minimum-system hosts.
- [ ] Working native Kiro approval and authoritative inventory, complete-bundle installed/client receipt production on all four targets.
- [ ] Protected confidential transport secret and reviewed encrypted-artifact producer.
- [ ] Immutable annotated release-tag rules and final publication approval.

No default policy, test assertion, time limit, production key or unsigned-download
exception is relaxed to make those prerequisites disappear.
