# Strict, always-on Code Mode migration

## Scope and audit (recorded before implementation)

Authorized product: global `${KIRO_HOME:-$HOME/.kiro}/agents/kiro-fabric.json`, launched by `kiro-cli --v3 --agent kiro-fabric`. Exactly `@fabric/fabric_exec` is model-visible. Raw stdio MCP may retain `fabric_info` and `fabric_workspace` for operators. No hybrid selector, native relay/fallback, Pi runtime, alternative LLM backend, daemon, or new browser/LSP/multi-agent framework. No live-home installation, authentication, commits, pushes or publication are authorized.

Starting checkout: clean `main`, `badee5abfd1e69c83a0ce4738ab57883dd8a6a95`; `git ls-remote origin-equivalent HTTPS HEAD` matched that SHA. Package 0.64.0, Node 24.20.0, pnpm 11.20.0; `/home/adam/.local/bin/kiro-cli` reports 2.21.1. Installation supports Linux/macOS and Node >=24. This implementation host is Linux; macOS process behavior must be tested separately before claiming it qualified.

Read `AGENTS.md`: fresh `pnpm run build` is mandatory at handoff. `pnpm run check` includes typecheck, build, tests, dead-code lint, component certification and SBOM; it does not include authenticated real-client certification.

### Observed current call graph

`install-agent-user.mjs` validates a staged archive, prepares digest-owned runtime/skills, then generates the global profile via `agent-profile.mjs`. The current profile exposes native read/write/shell/web/subagent/todo plus `@fabric`, and approves three outer Fabric wrappers. Kiro starts one private stdio `mcp-entry.ts`; launch-context/data-path checks select installed roots. `mcp-server.ts` serializes workspace lifecycle, caches verified root context, and obtains an active runtime lease. `runtime.ts` registers artifacts, configured MCP, memory and state. `FabricExecutionService` checks source/payload limits, checks TypeScript through compiler workers, and starts a fresh QuickJS context. Guest facades cross the bounded JSON host bridge; `ActionRegistry` prepares/validates/freezes arguments, reserves write resources, approves exact calls and records bounded audits. Projection returns only explicit results, bounded logs/progress, and overflow artifacts. Close cancels/drains active leases and closes providers.

Important observed gaps: no local provider or local/bootstrap declarations; unbound runtime cwd falls back to data.root; temporarily unverifiable roots reject exec before guest recovery; current switch commits and closes a runtime and must not be called recursively by its own guest. Registry reservations are per instance and only write-like effects participate. Current approval summaries are redacted/truncated generic arguments. Risk-wide configured `allow` exists; outer allowance must not weaken inner policy. Current partial commit acknowledgement names memory set/delete only.

### Client documentation and reference evidence

Official documentation retrieved during this audit:
- https://kiro.dev/docs/custom-agents/configuration-reference/ documents exact `@server_name/tool_name`, wildcard/category expansion, permissions, resources, includeMcpJson and includePowers.
- https://kiro.dev/docs/mcp/ documents stdio, configured federation and elicitation; includeMcpJson controls workspace/user configuration inclusion.
- https://kiro.dev/docs/cli/headless/ documents stream-json and uses `--engine`; installed help instead exposes `--agent-engine <v1|v2|v3>`, `--v3`, `--require-mcp-startup`, `--output-format stream-json` and `--no-interactive`.

Installed help is observed; actual filtered model inventory, form interaction, root inheritance and authenticated V3 continuity are NOT yet observed. Do not infer them from documentation or from raw MCP tools/list. No authentication was attempted.

Pi reference cloned separately at `/tmp/kiro-pi-reference-c4rgKu`, upstream commit `601e64212d19674e9910926fcd0e72389d34ab91`, MIT, Copyright (c) 2026 monotykamary. Inspected `runtime-state-builtins.ts`, `providers/pi-tools-provider.ts` and `runtime/guest-types.ts`: full-code registers a Pi adapter; native core bindings and captured overrides are Pi-specific; read/search return strings whereas mutation/shell normalize envelopes; exact edits and settle behavior are useful semantics, not runtime code to import. New local implementation is independent; no copied Pi adapter/capture code. Existing notices remain. Any later copied code must record provenance and preserve notices.

### Baseline

Disposable source snapshot `/tmp/kiro-strict-audit-c4rgKu`, isolated HOME/KIRO_HOME, locked dependencies. First attempt failed before checks because node_modules was a dangling symlink; corrected by independent frozen install. Fresh `pnpm run check`: typecheck/build passed, 31 test modules passed, 318 tests passed; one failure in `tests/package-boundary.test.ts` line 210, offline tarball dependency install (`ERR_PNPM_NO_OFFLINE_META`, es-toolkit metadata in isolated pnpm mirror). Log: `/tmp/kiro-strict-audit-c4rgKu/baseline-check.log`. Subsequent dead-code/certification/SBOM stages were not reached by that chained baseline command. This is baseline environment evidence, not a migration regression. Local locked dependency install completed without tracked changes.

## Capability inventory

| Capability | Current owner | Target owner/work | Verification |
|---|---|---|---|
| read/grep/find/list | native Kiro | local provider through registry | bounded fixture reads/search, type/runtime rejection, paths/aliases, parallel calls |
| write/edit | native Kiro | exact approved local effects | create-only write, anchor errors, changed-file conflicts, approval replacement, partial progress |
| shell | native Kiro | approved host process helper | command/cwd review, nonzero settle, spawn error, timeout/cancel, noisy streams, descendant cleanup/shutdown |
| health/workspace | top-level Fabric endpoints | checked fabric facade plus internal compatibility endpoints | unbound recovery, verified auto-root, explicit selection, deferred switch, no mixed effects |
| bundled instructions | Kiro skill resource | compact profile plus bounded immutable fabric.help | first call correct, no native read, packaged resources |
| memory/state/artifacts | Fabric | preserve formats and APIs | existing storage/recovery/approval tests |
| downstream MCP | Fabric + potential ambient profile exposure | explicit configured Fabric federation only | existing transport/schema/cancellation tests, no outer downstream visibility |
| web/LSP/delegation | native or unavailable | configured MCP only where present; otherwise unavailable | honest capability disclosure; no fallback or added framework |
| todo | native | intentional state keys | state workflow, no conversation mirroring |
| conversation/compaction/resume | Kiro | unchanged | three manual plus one natural automatic compaction and new-process durable restore |

## Fixed target architecture

Kiro V3 model/UI/history -> sole fabric_exec -> existing stdio MCP -> isolated checker/compiler -> fresh QuickJS -> bounded JSON-only host bridge -> existing registry/exact policy -> local, MCP, memory/state, artifacts. Local and bootstrap facades use that same admission/validation/approval path, not a second dispatcher. Preserve flat `{code,payloads?,resultFormat?,timeoutMs?}`.

### Final API contracts to implement

- `local.read({path,offset?,limit?})`: one-based line offset (default 1); UTF-8 text, path, truncated and optional nextOffset. Bounded lines and characters; reject binary/invalid UTF-8/special files. Oversized single lines need explicit rejection rather than misleading continuation.
- `local.grep({pattern,path?,glob?,literal?,ignoreCase?,limit?})`: bounded `{matches:[{path,line,text}],truncated}`; one-based lines; returned count is not total. Use ripgrep with argument arrays, deterministic ordering, no config or shell interpolation. Ignore/hidden/symlink behavior documented; explicit requirement for `rg` and failure when unavailable.
- `local.find({pattern,path?,limit?})`: glob paths, bounded `{paths,truncated}` through ripgrep file enumeration. `local.list({path?,limit?})`: bounded sorted `{entries:[{path,type}],truncated}`. Defaults rooted at verified workspace, not process cwd.
- `local.write({path,content,overwrite?})`: overwrite defaults false; existing file requires explicit true. `local.edit({path,oldText,newText,all?})`: nonempty exact unique anchor unless all=true. Return `{path,changed,sha256,...bounded verification metadata}`. Capture file/parent identities and content digest before approval, bind canonical prepared arguments to actual proposed content, revalidate before publication. New file publication must be create-only. No implicit multi-operation transaction.
- `local.shell({command,cwd?,timeoutMs?,settle?})`: `{ok,exitCode,signal,stdout,stderr,truncated,stdoutTruncated,stderrTruncated}`. Ordinary nonzero is data only with settle=true. Denial/spawn/cancel/timeout/uncertain cleanup always fail. /bin/sh host execution on supported POSIX systems; cwd is verified/canonical but is not confinement. Guest has no ambient Node/fs/network. Bound streams and deadline, terminate process group with TERM then KILL and close streams; disclose deliberate process-group escape limits. Do not support managed background jobs. Conservative environment excludes backend-specific credentials; do not log values.
- `fabric.info()`, `fabric.help({topic:"overview"|"api"})`, `fabric.workspace({action:"status"|"list"})`, `fabric.workspace({action:"select",rootId})`; preserve validated attach/detach compatibility. Return JSON objects. Workspace mutation helper reports pending until execution settles; host transition is committed before responding, with bounded committed-transition evidence. Fail/cancel must not commit a pending transition.

Every API needs closed schemas and typed results bounded below the configured generic bridge budget (including small valid budgets), not arbitrary generic preview substitution. Search/file-size/work limits, defaults and error semantics belong in API docs and tests. No new npm dependency is planned; ripgrep is an explicit external executable requirement for search. `knip.json` declares `rg` and the POSIX test-only `mkfifo` utility as reviewed external binaries; this does not disable package-boundary checks.

### Security, concurrency and lifecycle decisions

Reuse canonical-path identity checks. Reject traversal and symlink components under canonical workspace, final symlinks, multiply linked files and special files. Verify root dev/inode during operations. Preserve ordinary file modes. Node pathname checks/revalidation are defense in depth and do not supply race-proof OS isolation against a malicious same-user filesystem actor. Test supported claims; do not state otherwise.

Write/edit/shell all use a workspace-wide write-effect resource. Registry rejects conflicting calls before approval rather than silently queuing. Add a narrow optional provider reservation hook for a private workspace-data lock across cooperating Fabric runtimes/processes, held through approval, operation and cleanup; no scheduler framework. No lock in arbitrary source directories; no stale-lock breaking that could duplicate an uncertain running shell. External edits are detected by snapshots/revalidation, not claimed to obey locks.

Approval stays authoritative per action. Default local reads follow existing read policy; default mutations/execute ask. Existing configured inner policy remains explicit; outer tool permission grants no nested permission. Present actual bounded diffs and exact command/canonical cwd; reject over-budget approval material instead of authorizing invisible suffixes. Narrow fixture-only approvers are test infrastructure, never live profile auto-trust.

Each execution pins a verified workspace identity. Register local only with a verified workspace argument, not merely a cwd string. While roots are temporarily unverifiable, permit bootstrap/discovery/artifact recovery and block workspace providers. When merely unbound, preserve explicitly configured MCP discovery/calls (which have their own exact configured transport/cwd approvals); local/memory/state still require a verified workspace. This preserves the existing unbound downstream process-lifecycle workflow without granting local access to data.root. Track workspace effects before dispatch, including generic tools.call. A switch request after workspace effects is rejected, and effects after a switch request are rejected. Prior completed effects cannot be undone; report partial progress. Prepare switch using existing binding validation/approval; after successful guest settlement release that guest lease, then commit through serialized lifecycle. Revalidate binding generation before commit and report failures. No same-server MCP recursion or self-drain.

Host cleanup must survive guest cancellation; active reservations and provider close await actual process settlement. Indeterminate outcomes must not appear safely retryable. Extend bounded commit/uncertain evidence without exposing arguments/results in trace. Preserve same-server MCP cancellation safety and guest/log/artifact budgets.

Shell timeout must fit within remaining guest deadline. Example requesting 120s shell uses a larger explicit outer timeout to allow reads/edit/cleanup; no automatic full-program retry.

## Ordered keep/change/add/remove map

1. ADD `src/providers/local-provider.ts`, focused contract/path/lock helpers only as needed, local tests; CHANGE `src/kiro/runtime.ts`, `src/runtime/guest-types.ts`, QuickJS facade setup. Implement and test read/search increment first.
2. ADD `src/providers/local-shell.ts` and process tests; extend local mutations; CHANGE `src/protocol.ts`, `src/core/action-registry.ts`, approval and projection narrowly for reservations/previews/effect evidence. Keep registry and compiler architecture.
3. ADD focused bootstrap provider/help resources if useful; CHANGE `src/kiro/mcp-server.ts`, runtime option plumbing, execution-service context to support per-execution bootstrap and effect pinning. KEEP operator info/workspace handlers with extracted common internals. Add unbound/switch integration tests.
4. CHANGE `scripts/agent-profile.mjs`, `skills/fabric-exec/SKILL.md`, `skills/fabric-exec/references/api.md`, README/SECURITY/STATUS and active docs. Exact `tools:["@fabric/fabric_exec"]`; no native allowances, includeMcpJson/includePowers false; only outer fabric/fabric_exec permission. Preserve inherited resources. REMOVE active native fallback language, never historical audits.
5. CHANGE `agent-product.json`, build/staging/install checks as required; keep one closure and no-Pi boundary. Separate backend tools from model tool inventory. CHANGE profile/installer/release-evidence tests and real-client driver prompts to bootstrap through exec; version evidence contract if necessary. Never delete lifecycle/security gates. Coordinated upgrade runtime then profile; active old sessions require restart to adopt new tool inventory.
6. Run focused modules, direct checked fixture example, full applicable checks, isolated staged install/update/unrelated cwd, client profile validation and real-client qualification where authorized/available. Fresh final build. Keep safe data-preserving rollback/uninstall; no live installation.

## Acceptance / Astra Low verification ledger

Astra (`openai-codex/gpt-6-astra`, thinking `low`) owns integration and independently verifies EVERY delegated research/code/test/docs/config/package deliverable. Sol Low implements focused local capabilities; GLM-5.3 [zro] handles shell/security; Luna handles strict profile/qualification propagation. Nonoverlapping file ownership is mandatory. No model self-report is a pass. Astra inspects diff/source and independently runs applicable checks; subsequent modifications invalidate affected verdicts.

| Deliverable | Producer | Reviewed revision/evidence | Astra verdict |
|---|---|---|---|
| Initial scope reviews | Sol Low / GLM / Luna | Independently read profile/runtime/registry/workspace/approver/projection/qualification gates at badee5ab | PASS for source-grounded gaps; client claims remain unverified |
| Phase A/B record | Astra Low | This pre-implementation document and disposable baseline log | PASS local scope; real-client/platform qualification BLOCKED |
| Local reads and mutations | Sol Low; Astra corrections | Reviewed local-contract/path/provider; local-provider and actual fixture coding tests pass after result-contract/schema corrections | PASS for tested Linux scope |
| Shell/process cleanup | GLM-5.3 [zro] | Reviewed local-shell; real exit/output/cancellation/descendant tests and full lifecycle module pass | PASS for tested Linux scope; other platforms BLOCKED |
| Bootstrap/lifecycle | Astra Low | strict-bootstrap, workspace-binding, MCP lifecycle and partial-effect tests; unbound explicitly configured MCP compatibility restored without local root fallback | PASS for tested scope |
| Strict profile/docs/package | Luna; Astra integration | Reviewed profile/skills/evidence driver and validator; 44 profile/release-evidence tests pass; staged install tests, authority digest and component certification pass | PASS for implementation; actual client qualification BLOCKED |
| Integrated tests and final build | Astra Low | `pnpm run check`: 36 modules, 412 tests; typecheck/build/dead-code/staging/component certification/SBOM pass. Log: `/tmp/kiro-strict-final-check.log` | PASS |
| Actual one-tool inventory/coding/continuity | Kiro + Astra Low | pending | BLOCKED pending authenticated client evidence |

Mechanically verify all seven local symbols/registrations/schemas; checked invalid types and dynamic invalid arguments; root/traversal/alias/replace conflicts; denied/missing approval; shell exit/spawn/timeout/cancel/noisy output/descendants/shutdown; bounded reads and write conflicts; contextual overflow and partial effects; memory/state/MCP compatibility; isolated installation/update; first-turn single-read and conversational no-dummy behavior; exact inventory and three manual + natural auto compaction + new-process resume. A build alone never completes these checks.

## Release blockers and handoff policy

`certify:agent:real` requires a clean commit-bound checkout; the user forbids commits, so exact-release qualification after edits is BLOCKED until a separately authorized commit exists. Credentials must not be captured/copied or authentication initiated. Official docs/help do not constitute observed filtered tool inventory or elicitation success. Unsupported/unavailable platform tests remain BLOCKED. No release readiness claim or fallback may replace missing evidence. Final handoff lists actual commands/results, file identities, installed fixture evidence and data-preserving rollback instructions.
