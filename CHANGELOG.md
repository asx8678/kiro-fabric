# Unreleased

- Tighten JSON-only steering after live v3 evidence showed inter-tool commentary entering `finalText`; clarify complete whole-line ranges and CRLF handling without changing read semantics or permissions. Add a frozen Auto comparison harness with strict oracles, exact-once admission, live settings checks and fail-closed usage/budget gates. Retain its stopped 20/102-request pilot, oracle limitations and unresolved native charge; no completed broad-comparison or perfect-compliance claim.

- Port explicit tool/output precedence and safe coding/Git/GitHub working rules into standing Kiro guidance. Add fixed `fabric.help` topics for compiled skill, API prose, recipes and workflow. Generate immutable help from canonical Markdown and check parity; preserve single-tool, workspace, per-effect approval and non-replay boundaries. Clarify that steering, stream-json and tool result formatting do not enforce the final assistant answer.

- Advertise exact hot local APIs beside `fabric_exec` to avoid read-result/search/edit guesses. Skip ritual discovery for known paths, compose deterministic data pipelines in guest, and ship concise-answer Kiro steering with explicit completeness/verification exceptions. Add executable Unicode/whitespace, decoy, edit, truncation and nonzero-command recipes; retain strict tools, workspace and approval boundaries.

- Wait for Fabric MCP readiness before Kiro V3 builds the first prompt's tool inventory. Fix headless `fabric_exec` unavailability with `mcpServers.fabric.waitForReady: true`, retaining the exact one-tool surface, nested approval policy, and hash-verified upgrade checks.

- Start Fabric workspace inspection with bounded directory listing instead of assuming a root README. Document shallow `local.list` arguments and discovery-before-read sequencing; cover absent, root, and nested READMEs while retaining strict rejection of unsupported `depth`.

- Fix macOS shell cleanup for inert zombie groups without suppressing live-process or observation failures; make memory fault injection portable, canonicalize test temporary roots, and make efficiency CLI entry detection symlink-safe. Qualify crash-recovery success tests by native directory-FD capability and verify unsupported hosts preserve locks/journals.

- Serialize local shell/write/edit calls within each Code Mode execution before argument preparation, including concurrent `Promise.all` and generic `tools.call`. Keep reads parallel, stop queued effects after failure/cancellation, and retain cross-execution/process conflict protection.

- Change default read/write/execute/network approval policy to `allow` without confirmation. Explicit `ask`/`deny` settings remain authoritative; missing approval fields adopt these defaults on restart. Document host-authority implications and opt-out configuration.
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

# Changelog

## 0.64.0

- Replaced all prior integration modes with one Kiro Power product.
- Reduced the MCP surface to `fabric_info`, `fabric_workspace`, and `fabric_exec`.
- Kept QuickJS as the sole checked guest runtime and reduced providers to artifacts, memory, state, and configured MCP federation.
- Made staging hermetic and user-folder export an explicit hardened operation.
- Added exact closure graph, digest, SBOM, and release qualification evidence.
- Enforced strict guest API checking, private bounded persistence, cancellation-safe MCP federation, deterministic package policy, and exact real-client evidence binding.
