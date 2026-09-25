# Release

## 0.65.0 migration

`package.json` is the canonical version source for the prepared 0.65.0 release. This is release preparation, not publication or qualification. Preserve historical 0.64.0 reports, archives and observations; never relabel them as 0.65.0 evidence.

**Breaking change:** every `local.edit` needs `expectedSha256`. Replacing an existing file with `local.write` needs `overwrite: true` and `expectedSha256`, even for a no-op. Use the whole-file `sha256` returned by the read that supplied the anchors/source, never a digest computed from a bounded `text` excerpt. These are checked TypeScript snippets inside `fabric_exec` (named string payloads supply replacement content):

```ts
const before = await local.read({path: "src/example.ts", offset: 1, limit: 100});
return await local.edit({
  path: "src/example.ts", expectedSha256: before.sha256,
  oldText: "old-name", newText: "new-name"
});
```

For a complete replacement, inspect the entire source first (continue bounded reads when `truncated`, checking the same digest across windows):

```ts
const before = await local.read({path: "example.txt", offset: 1, limit: 2000});
if (before.truncated) throw new Error("Read the remaining source before replacing it");
return await local.write({
  path: "example.txt", overwrite: true, expectedSha256: before.sha256,
  content: payloads.replacement
});
```

Creation remains create-only by default and omits the digest; the parent must already exist:

```ts
return await local.write({path: "new-example.txt", content: payloads.content});
```

Missing/stale bindings fail before approval. On conflict, reread and reassess anchors/content; do not blindly retry with a refreshed hash. A successful mutation's returned `sha256` can bind an intentional follow-up on that resulting content. A digest cannot bind a missing file. Snapshot binding does not bypass per-effect approval or provide hostile-race isolation or a multi-operation transaction.

## Prepared-release checklist

- [ ] Confirm the canonical package version, newest versioned changelog heading and intended tag agree (`0.65.0` / `v0.65.0`). The former source-only Vitest regressions (`tests/release-workflow.test.ts`, `tests/local-provider.test.ts`) were removed with the test suite and are historical; no runnable replacement exists, so version consistency currently rests on `guidance:check`, typecheck and build inside `pnpm run check:local`.
- [ ] Regenerate rather than hand-edit closure manifests, guidance, staged packages, archives and SBOMs. Run `pnpm run check:local` (local-development static/build check; not release qualification; the release-grade `pnpm run check` exists but exits nonzero at the retired-suite dispatcher), `pnpm run audit:deps`, and finish with a fresh `pnpm run build`; run artifact-dependent checks against the rebuilt bytes. A coordinator may perform these after parallel source work; deferred checks are not passes.
- [ ] Preserve historical evidence unchanged. Obtain new exact-commit/exact-byte qualification for any future release; never reuse 0.64.0 evidence for 0.65.0.
- [ ] Keep native Kiro approval and complete authoritative model-tool inventory BLOCKED: observed missing `_kiro/mcp/elicitation` handlers and `disclose_context` are not resolved by local tests or the incomplete `/tools` picker. Approval probes must explicitly set `execute: ask` rather than assume the current default. Headless success is not interactive approve/decline evidence.
- [ ] Satisfy the production signing, schema-2 complete-bundle, four-native-target and authenticated-client gates below independently. Unknown benchmark charges remain unknown; local release hygiene proves no benchmark superiority.
- [ ] Only after separate maintainer authorization and all gates pass, follow the signed annotated-tag workflow and exact qualified-asset promotion. This preparation authorizes no commit, tag, publication or installation.


## Complete-bundle candidate and promotion path

The new [complete-bundle pipeline](complete-bundle-release.md) provides clean exact-commit
candidate preparation, four-target four-gate signed qualification, confidential witness
transport and captured-byte promotion. Production signer/runners/native-client receipts remain
unprovisioned; this is not a release-ready declaration. Legacy gates below remain
blocked and cannot qualify the new path.

## Complete installer distribution gate

Complete installer distribution is currently BLOCKED. Production readiness is checked before legacy artifact reads/promotion; legacy candidate reports cannot become installer release-ready even when their historical authenticated evidence is valid. Genuine production trust/signing, signed final-byte metadata, release-pinned bootstrap artifacts and complete-bundle exact-client qualification are required. The existing annotated-tag, commit, signature and captured-archive gates are retained; no newly compressed artifact inherits qualification.

CI declares all four native targets and asserts observed OS, kernel/Node architecture, Rosetta exclusion and glibc before running contracts. Each declared native job also builds the actual private-tool bundle, compares two generated archive byte streams and exercises installed independence, locking and transactions. Runner labels are configuration, not evidence of availability or successful execution; unavailable/unexecuted targets remain PENDING. This local task did not dispatch any workflow.

Use `pnpm run agent:bundle` for the complete development bundle and binary-aware SBOM. `pnpm run sbom:agent` and the legacy Agent archive remain compatibility/application-closure evidence, not complete installer supply-chain qualification. Production signing credentials are not stored or provisioned by source builds; test keys are never a production fallback. See [installer trust and operational limits](installer.md).

## Remaining readiness checklist

Do not convert a BLOCKED status to PASS by inserting a fixture key, accepting unsigned archives, weakening evidence validation, or relabeling component tests. Close the remaining items with independent evidence:

1. **Local safety:** update/restart to adopt confirmation defaults and review existing explicit `allow` settings. Run `pnpm run check:local` (local static/build only) and `pnpm run audit:deps`; the release-grade `pnpm run check` remains fail-closed at the retired-suite dispatcher. A build pass is component evidence only.
2. **Authenticated Kiro:** review and commit the intended changes first (qualification requires a clean tracked worktree). Build the exact schema-2 candidate, then obtain native Kiro and installed/client evidence on all four targets; missing targets remain blocked. Run the separate legacy `pnpm run agent:archive` application qualification where required, using the isolated subscription/API-key command below with the user's explicit authentication authorization. Never copy the ordinary Kiro home or credentials into fixtures. Keep the exact archive, report and transcripts private until reviewed for sensitive data. Qualification must cover tool filtering, accepted/denied effects, roots, coding, compaction, shutdown and resume; a successful headless smoke is not enough. This legacy application-archive gate does not qualify the complete installer bundle.
3. **Publisher trust:** a maintainer must provision an Ed25519 release-signing key under controlled secret storage, review/pin only its public key in `scripts/release-trust.mjs`, and sign final-byte release metadata using the existing domain/schema contract. Do not commit a private key or use test keys. Key provisioning alone does not unblock distribution: signed metadata/SBOM identities, pinned bootstrap members, and complete-bundle qualification must all match the exact archive being promoted.
4. **Native recovery/platforms:** execute the configured jobs on actual Linux x64/ARM64 and macOS x64/ARM64 hosts. Preserve observed architecture and exact-artifact results; runner labels are not evidence. macOS recovery now uses the embedded inode-pinned child and had local ARM64 abrupt-death/concurrency component coverage from the removed Vitest suite. The former recovery tests (including `tests/pinned-recovery.test.ts` and installed-bundle recovery) were removed with the test suite; run the maintained `pnpm run verify:offline baseline|installer` cases on all declared native targets before claiming release qualification. Keep unsupported/uncertain recovery and purge fail-closed.

These steps require maintainer-controlled credentials, infrastructure and release decisions. Source builds do not create those prerequisites, authenticate users or publish releases automatically.

## Existing application and authenticated-client gates

CI explicitly provisions pinned pnpm and ripgrep on supported runners. Each workflow invokes `pnpm run check`, which runs `check:local` and then exits nonzero at the retired-suite dispatcher; the former macOS Vitest jobs for local coding, shell, ownership/acknowledgement, bootstrap, workspace and approval/projection suites were removed with the test suite and are historical, not current coverage. Configured jobs are not evidence that a platform run passed. The release shell regression tests (actual tag/version comparison, including mismatch and inert hostile tag values) were removed with the suite.

Run `pnpm run check:local` (local-development only; the release-grade `pnpm run check` is fail-closed at the retired-suite dispatcher), `pnpm run agent:archive`, and `pnpm pack --dry-run --json --config.ignore-scripts=true`. Agent staging, closure, archive, and SBOM are deterministic and digest-bound. Real-client evidence contains session-specific PIDs, timestamps, and transcripts; it is not reproducible output, but it is bound to the exact commit, archive, installed profile/runtime, Kiro binary, and qualification driver. `pnpm run certify:agent:real` is a separate authenticated user-owned Kiro gate; ordinary CI cannot claim it.

A release requires objective profile validation/listing/selection, exactly one filtered model tool (`@fabric/fabric_exec`), roots and form elicitation, checked local fixture search/read/edit/test execution, durable memory/state across processes, denied side effects, compaction continuity, and verified shutdown. Raw backend compatibility endpoints are not the model inventory. Kiro binary path/version/digest are recorded before and after. Model-authored claims are not lifecycle evidence.

Archive digests bind at two layers: `archiveDigest` is the SHA-256 of the exact `.tar.gz` bytes under qualification (transport binding — gzip output is zlib-version-dependent, so byte-identical archives across environments are not guaranteed), while `packageDigest` is the SHA-256 of the uncompressed package tree and is the content identity for cross-environment comparison.

The release workflow promotes the archive and SBOM uploaded with successful exact-commit qualification; it does **not** recompress a new publish archive. The release job still runs the full local check and independently validates the qualified archive's extracted package-tree digest against its freshly staged checkout, checks the qualified SBOM inventory against the built closure, and verifies exact archive bytes against the qualification report. Different compressed bytes for equivalent contents do not inherit qualification. `scripts/release-candidate-report.mjs --assets <directory>` writes the captured archive, SBOM and qualification bytes only after release-ready validation; it does not reread those source paths after validation.

Performance comparisons, when performed, must use equivalent fixture work and inner permissions; count model calls, visible bytes, approvals and elapsed time. Native tools are not a product fallback or an alternative installed mode. That diagnostic comparison is not release evidence and cannot waive any of the exact-release authenticated lifecycle gates below.

The real-client driver seeks complete model-tool evidence from Kiro's `/tools` system view and requires exactly `@fabric/fabric_exec`, with no native, ambient, wildcard or additional backend tool. The 2026-09-16 native-TUI retest on 2.21.1 and 2.22.0 showed that the `1 tag` view omits the actually invoked `disclose_context` tool. That tag picker and model-authored tool lists are not complete inventories; keep qualification blocked rather than extracting its sole Fabric row or treating `NATIVE_UNAVAILABLE` as proof. See the [structural retest evidence](coding-readiness-2026-09-09.md#2026-09-16-linux-retest). Unknown rendering fails closed and remains a release blocker until an authoritative complete inventory format is verified. Before the main lifecycle session, a separate TUI process runs with Fabric writes set to `ask`, reaches one traced MCP form request, submits/dismisses the default-false form through the PTY, and must record one non-approved response and one fail-closed execution. Its ACP recording, terminal transcript, trace identity, graceful exit, and orphan check are mandatory. Only after that process exits does the isolated qualification config change to `write: allow` for nonce-bound lifecycle setup; this does not alter a user's installation or settings.

Resume evidence requires the same Kiro `/session-id` before exit and after `--resume-id`, plus a direct, successful ACP `session/load` request/response exchange for that session. Replayed nonce-bearing user-message frames are recorded as supplementary evidence but cannot replace the load exchange, and model prose cannot satisfy it. Qualification evidence binds whether authentication used an isolated subscription session verified by `kiro-cli whoami` or API-key automation. Missing `--auth-mode` fails closed unless `KIRO_API_KEY` is set (which selects `api-key`). `--subscription-login` requires a failing pre-login `whoami` in the throwaway home before device flow. Device-flow login stdout is not captured; TUI/ACP transcripts are embedded in evidence and may contain client-rendered identity. When API-key mode is used, ACP recordings and every terminal transcript are scanned for the protected `KIRO_API_KEY` before evidence is written.

The compaction gate completes three manual cycles. Each starts a bounded ACP byte interval immediately before `/compact` and closes only after a direct `_kiro.dev/commands/execute` request for `/compact`, its started and single completed `_kiro.dev/compaction/status` notifications, and the matching successful command response. Interval offsets and request/status/response digests are evidence-bound, so a later automatic compaction cannot satisfy a manual cycle. Before every cycle, a distinct random conversation-only fact is placed in exactly one recorded user prompt and prohibited from structural tool data. After every cycle, an exact ACP-bound `fabric_exec` call rechecks durable memory/state and the same process-local artifact, receives the fact without the post-compaction prompt restating it, persists a matching durable state effect, and retains the OS-observed MCP PID, instance ID, and runtime generation.

Qualification reads `chat.disableAutoCompaction` before and after the lifecycle with `kiro-cli settings chat.disableAutoCompaction --format json`, accepts only `null` or `false`, requires the two structural values to match, and does not mutate the setting. After the manual series it sends at most twelve bounded 24,000-character opaque conversation-pressure turns. The automatic gate requires a direct pressure `session/prompt`, a subsequent started-to-completed `_kiro.dev/compaction/status` sequence for that session, no `/compact` command, and no tool call in the interval. It then performs another exact Fabric sentinel check with the unchanged MCP/runtime identity. Kiro exposes no supported threshold override in the qualified client contract; failure to observe natural automatic compaction within this bound blocks qualification rather than enabling a private or simulated compactor.

The post-compaction and resumed `fabric_exec` calls are bound to completed ACP tool-call frames: the session and tool-call IDs, exact input digest, normalized result digest, contributing frame digests, and recording digest must match independently computed expectations. For each of the three manual cycles and the natural automatic cycle, the driver independently binds a fresh conversation-only fact's source frame, no-tool-input condition, context-seed call, post-compaction payload/result, and durable Fabric state effect. Model prose cannot satisfy these gates.

Separately, hermetic stdio subprocess tests run two Fabric MCP processes against one verified workspace and check concurrent memory visibility plus compare-and-set state integrity. They also kill one MCP process abruptly, start a distinct process, verify exact durable memory/state restoration, and extend that state successfully. These component tests establish storage concurrency and crash durability; they do not establish Kiro's same-PID behavior across prompts or compaction.

For subscription-backed qualification, run Kiro's device flow inside the throwaway private qualification home:

```sh
KIRO_CLI_PATH="/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli" \
  pnpm run certify:agent:real -- --auth-mode subscription --subscription-login
```

The default `--subscription-license free` means Builder ID/social authentication in Kiro CLI terminology and works with a paid subscription on that identity. Identity Center users can add `--subscription-license pro --identity-provider <URL> --region <REGION>`. Omitting `--subscription-login` is valid only when the isolated home already has an authenticated session; evidence then records `preLoginUnauthenticated: false`. API-key automation remains available through `--auth-mode api-key` and `KIRO_API_KEY`.

For the installed `kiro-cli 2.21.0` qualification client, the supported commands reported by its own help are:

```sh
kiro-cli agent validate --path "${KIRO_HOME:-$HOME/.kiro}/agents/kiro-fabric.json"
kiro-cli agent list
kiro-cli --v3 --agent kiro-fabric
kiro-cli chat --agent-engine v3 --agent kiro-fabric --no-interactive \
  --require-mcp-startup --output-format stream-json "<qualification prompt>"
```

The current [official command reference](https://kiro.dev/docs/reference/cli-commands/) instead shows a positional validation path, and the [official headless page](https://kiro.dev/docs/cli/headless/) uses `--engine v3`. Version 2.21.0 exposes neither installed form that way: `agent validate --help` requires `--path`, while `chat --help` exposes `--agent-engine <v1|v2|v3>`. Qualification follows the installed help and records it verbatim. The interactive and real-client lifecycle gates remain blocked until the exact final commit passes them with an authenticated client.

Version 2.21.0's `agent list` has no path or structured-output option. The real-client driver therefore runs `agent validate` and `agent list` from an empty workspace, an unrelated directory, and its nested directory; hashes the exact global profile and runtime; rejects a same-name local profile; and binds the observed MCP command to that runtime path. It does not infer a source path from name-only list prose.

Kiro defaults to inheriting steering, skills, and `AGENTS.md` for custom agents. Qualification must record the effective `chat.disableInheritingDefaultResources` setting and use an isolated workspace and Kiro home. Installation must never change that user setting.
