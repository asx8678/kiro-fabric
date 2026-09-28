# Changelog

## Unreleased

- **Breaking:** `memory.*` is merged into `state`, which gains `state.search`; existing memory entries are not migrated. `review.*`, `probe.*` and `continuity.*` are removed. Old `memory` and `continuity` configuration sections are ignored.
- **Breaking:** the managed installer (generations, private Node/ripgrep, journals, rollback) is replaced by `bash ./install.sh`, which installs to `~/.kiro/kiro-fabric/{app,tools,resources}` using the system Node and ripgrep and the pinned `@ast-grep/cli` npm binary. Reinstall; old `runtime/` generations are no longer used.
- **Breaking (library):** `KiroHostSessionAdapter`, the `hostSessions` and `foveaPostToolContext` server options, the ACP capability probe and the `fovea-hook` entry point are removed.
- **Breaking:** with the default `resultFormat:"auto"`, a returned string is shown as plain text instead of a JSON-quoted string. The same-call Navigator advisory now runs only after a committed `local.write`/`local.edit`, analyzes only changed files, and is plain text without a `noticeId` JSON envelope.
- **Breaking:** `repo.sync` no longer returns `noticeId`/`deliveryState`, and `repo.status` no longer reports `notices`; the unwired host notice outbox and its acknowledgement path are removed. Before this, repeated `repo.sync` results with changes filled a 32-entry outbox and then failed.
- Cut model-visible output: Navigator packets summarize coverage detail lists as `detailsOmitted` counts (the retained packet keeps them for `repo.result`), guest runtime errors show the message and guest frames only, and read-only failures omit recovery receipts.
- Rewrite the agent prompt, first-turn triage, skill and references in plain language; small tasks skip Navigator/impact ritual, and duplicated or stale guidance is removed. The prompts now also cover credit-efficient returns, repository conventions, root-cause fixes, clarifying questions and a short report format.
- Keep TypeScript out of the sandbox worker and trim redundant search checks; `pnpm test` and `pnpm run check` run the real Vitest suite.

## 0.65.0

Prepared source release; not published or release-qualified. Historical 0.64.0 evidence remains historical and does not qualify these bytes.

- **Breaking mutation contract:** `local.edit` requires `expectedSha256`; `local.write` replacing an existing file requires both `overwrite: true` and `expectedSha256`. Use the digest returned by the read that supplied the edit anchors or replacement source, not a hash of a bounded text excerpt. Create-only writes omit the digest. Stale or missing binding fails closed before approval; reread and reconsider the change rather than retrying blindly.

- Make repository reviews coverage-led rather than brevity-led: exempt audits from the routine 120-word default, follow high-risk scripts/overrides/consumers, falsify suspected defects, and report unreviewed scope. Ship task-loaded `fabric.help({topic:"review"})` guidance without adding model tools or raising execution budgets.
- Add `hidden:true` to local grep/find with explicit search `scope`, retaining ignore rules, VCS exclusions and path protections. Include `totalLines` in reads and optimize recursive all-files manifests to one ripgrep launch. These additive result fields change exact serialized result shapes; `truncated:false` is not whole-repository completeness.
- Add a seeded, read-only infrastructure-review comparison case with independent defect qualification, false-positive/duplicate controls, precision/recall and failure-inclusive credits per grounded finding. Add identical CLI effort selection with observed-setting checks. Offline tests do not establish live model-quality or cost superiority.

- Save the 2026-09-09 coding-readiness investigation and observed Kiro CLI 2.21.2 v3 missing `_kiro/mcp/elicitation` UI handler. Ship bounded-read/glob-search reminders and approval-readiness troubleshooting in compiled help, with regression coverage. Keep per-effect approval safeguards unchanged; healthy installation and passing component tests do not establish successful live shell/edit approval.

- Tighten JSON-only steering after live v3 evidence showed inter-tool commentary entering `finalText`; clarify complete whole-line ranges and CRLF handling without changing read semantics or permissions. Add a frozen Auto comparison harness with strict oracles, exact-once admission, live settings checks and fail-closed usage/budget gates. Retain its stopped 20/102-request pilot, oracle limitations and unresolved native charge; no completed broad-comparison or perfect-compliance claim.

- Port explicit tool/output precedence and safe coding/Git/GitHub working rules into standing Kiro guidance. Add fixed `fabric.help` topics for compiled skill, API prose, recipes and workflow. Generate immutable help from canonical Markdown and check parity; preserve single-tool, workspace, per-effect approval and non-replay boundaries. Clarify that steering, stream-json and tool result formatting do not enforce the final assistant answer.

- Advertise exact hot local APIs beside `fabric_exec` to avoid read-result/search/edit guesses. Skip ritual discovery for known paths, compose deterministic data pipelines in guest, and ship concise-answer Kiro steering with explicit completeness/verification exceptions. Add executable Unicode/whitespace, decoy, edit, truncation and nonzero-command recipes; retain strict tools, workspace and approval boundaries.

- Wait for Fabric MCP readiness before Kiro V3 builds the first prompt's tool inventory. Fix headless `fabric_exec` unavailability with `mcpServers.fabric.waitForReady: true`, retaining the exact one-tool surface, nested approval policy, and hash-verified upgrade checks.

- Start Fabric workspace inspection with bounded directory listing instead of assuming a root README. Document shallow `local.list` arguments and discovery-before-read sequencing; cover absent, root, and nested READMEs while retaining strict rejection of unsupported `depth`.

- Fix macOS shell cleanup for inert zombie groups without suppressing live-process or observation failures; make memory fault injection portable, canonicalize test temporary roots, and make efficiency CLI entry detection symlink-safe. Qualify crash-recovery success tests by native directory-FD capability and verify unsupported hosts preserve locks/journals.

- Serialize local shell/write/edit calls within each Code Mode execution before argument preparation, including concurrent `Promise.all` and generic `tools.call`. Keep reads parallel, stop queued effects after failure/cancellation, and retain cross-execution/process conflict protection.

- Require confirmation by default for write, execute and network effects; keep reads allowed. Missing/declined elicitation fails closed. Explicit existing policies are preserved, including operator-selected `allow`; omitted categories adopt safe defaults after update/restart. Document shell host authority and migration from permissive settings.
- Implement macOS stale-lock recovery through an embedded, bounded private-Node child with a kernel-pinned cwd, inode/hash checks and separate exclusive-create/publication phases. Preserve partial claims and uncertain process evidence; retain Linux FD anchoring. Exercise native SIGKILL/concurrent reclamation and installed-bundle recovery without acquisition files. Report recoverability only after an actual capability check; unsupported recovery preserves evidence and returns exit 7. Surface blocked signing in doctor and retain authenticated-client and four-target release qualification requirements.
- Forward the launcher workspace explicitly through Kiro's filtered MCP environment, preserving integrity-checked upgrades from older profiles.

- Report interpreter drift and a digest-bound action catalog in `fabric_info`, describe `fabric_workspace` action/field requirements in its schema, prune superseded runtime generations (keeping the current and previous) on install, share one esbuild option module between the library and closure builds, and document degraded-client operation plus archive-digest semantics.

- Require explicit `--auth-mode subscription` or `KIRO_API_KEY` for real-client qualification, bind isolated device-flow login to a failing pre-login `whoami`, and stop claiming TUI transcripts omit identity.
- Convert Kiro Fabric from a Power to one native Kiro CLI V3 custom agent with an agent-owned Fabric MCP backend.
- Remove the discoverable checkout-local profile so it cannot shadow the user-global `kiro-fabric` agent; generate the absolute profile only during installation.
- Advertise `fabric_workspace` without a top-level schema combinator while keeping the strict runtime union.
- Harden archive-only installation, ownership/tamper checks, rollback, uninstall, and relocatable package validation.
- Add process/runtime lifecycle identity plus objective multi-turn, compaction, shutdown, and resume qualification gates.
- Warn on install when a leftover Power may duplicate `@fabric`.
- Point CI at `tests/agent-user-install.test.ts` instead of the removed Power install test.

## 0.64.0

- Replaced all prior integration modes with one Kiro Power product.
- Reduced the MCP surface to `fabric_info`, `fabric_workspace`, and `fabric_exec`.
- Kept QuickJS as the sole checked guest runtime and reduced providers to artifacts, memory, state, and configured MCP federation.
- Made staging hermetic and user-folder export an explicit hardened operation.
- Added exact closure graph, digest, SBOM, and release qualification evidence.
- Enforced strict guest API checking, private bounded persistence, cancellation-safe MCP federation, deterministic package policy, and exact real-client evidence binding.
