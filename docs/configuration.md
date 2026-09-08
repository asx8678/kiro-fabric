# Configuration

The Agent reads only `$KIRO_HOME/kiro-fabric/data/fabric/config/config.json`; configured MCP federation is in sibling `mcp.json`. Files must be non-symlink, single-link regular files within size bounds and, where POSIX ownership/mode checks are available, current-user-owned and private. Unknown fields, ambient imports, unsafe stdio/OAuth options, changed identities, and malformed configuration fail closed. Persistent configuration uses `schemaVersion: 1`. A valid legacy unversioned file is validated and migrated in memory without rewriting the user's file; newly generated and explicitly migrated configuration is versioned. Unsupported future versions and invalid legacy values are rejected without mutation.

`KIRO_FABRIC_RUNTIME_ROOT` and `KIRO_FABRIC_DATA_ROOT` are installer-owned launch values. `KIRO_FABRIC_DEBUG=1|0` controls tracing. Do not inject reserved `KIRO_FABRIC_*` variables from untrusted launch contexts.

## Execution admission and discovery bounds

`executor.maxConcurrentExecutions` defaults to **4** (allowed range 1–64). Each execution service admits at most this many requests across compilation, approval waits and guest execution. Excess requests fail immediately with `Fabric execution concurrency limit reached`; there is no hidden waiting queue. Completion, failure and cancellation release the slot. Closing a service rejects new executions, cancels admitted executions, waits for their bounded settlement, then tears down the registry; it closes only its own compiler pool. This is not proof that arbitrary downstream effects stopped after cancellation. Each service retains at most one idle compiler for 30 seconds; the standalone compiler helper has a separate four-worker bound. These are **per-service**, not process-wide or cross-process limits: embedders must also bound service creation.

Configured MCP discovery follows opaque cursors, including empty strings, under one shared discovery/call deadline and the existing server lease. Enumeration is bounded to 100 pages, 1,000 cumulative tools **before** allow/block filtering, 4,096 characters per cursor, and the existing JSON budget. Cycles, malformed pages and exhausted limits fail the operation rather than returning a deceptively complete partial catalog. These are safety ceilings, not measured throughput targets.

### Provider calls versus interactive approvals

All limits below are **per execution**; configuration keys and defaults are unchanged:

- `executor.maxProviderCalls`: **64** total host calls; `executor.maxConcurrentProviderCalls`: **8** simultaneous host calls. The guest semaphore queues excess parallel work; the host independently rejects excess concurrency.
- `executor.maxApprovalRequests`: **16** admitted interactive approval attempts; `executor.maxPendingApprovals`: **2** simultaneous approval waits. Kiro evaluates explicit `allow`/`deny`/`ask` policy for every action. Silent allow and deny decisions consume neither approval counter, even when prompt budget is exhausted. Read risk alone does not grant permission.
- An `ask` reserves both approval counters before elicitation begins. Failed admission opens no prompt and consumes neither counter. Once admitted, decline, cancellation, unavailable elicitation, or an exception still consumes the total attempt; the pending slot is released when the attempt and its cleanup settle. Existing deadlines and effect reservations remain in force.
- Registry approvals and nested MCP stdio/OAuth approval stages share these same counters. Each interactive stage consumes one attempt; silent stages do not.

Library approvers may implement `prepareApproval(action, canonicalArgs, signal)` to return an explicit allow/deny decision or an ask plan with a deferred `prompt()`. Preparation must not interact with the user; it must bind the deferred prompt to the exact canonical request and evaluate policy only once. The service reserves quota before invoking that prompt, without calling `approve()` again. Malformed plans fail closed. Existing custom approvers implementing only `approve()` remain compatible and conservatively charge every callback against both approval limits. Direct Kiro `approve()` callers remain supported, but execution-wide quota enforcement belongs to the execution service.

Provider, audit, result, and deadline limits are independent of approval policy. In particular, `executor.maxAuditEntries` defaults to **64** and `executor.maxAuditBytes` to **64,000**; registry calls reserve **2,048 bytes** each, so the default audit byte budget permits only **31** audited calls even when all are silently allowed. A 64-call audited batch needs at least **131,072** audit bytes as well as sufficient provider and entry budgets; this change does not raise any defaults or bypass audits.

## State commit and retry semantics

State publication occurs at atomic rename after private permissions and file sync have succeeded. Ordinary failures before publication remove only the operation-owned temporary file and leave the previous document intact. Artifact write failures likewise remove the new file without adding it to quota accounting. Cleanup itself can fail on an unavailable filesystem; such failures are reported, not presented as successful cleanup.

A post-commit cancellation/deadline or lock-removal failure can reject an operation whose data is already visible. When the provider knows publication succeeded, the error reports `State mutation committed at revision N; acknowledgement failed; read state before retrying`. Do not interpret rejection as rollback. A transport interruption can also lose that acknowledgement: use `state.get` and `state.list` with a fresh request to reconcile entry/document revisions and the intended value or deletion before retrying. Use `expectedRevision` for subsequent writes; do not blindly replay uncertain operations. After a failed lock removal, the same provider retains the exact inode/device cleanup responsibility and retries it before another mutation; it will not remove a replacement lock. Persistent filesystem failure or loss of that provider instance can still require operator recovery after the owning process exits. Do not remove another live process's lock.

This is atomic publication and process-restart persistence, not a guarantee against machine power loss or arbitrary network-filesystem behavior. Directory fsync is attempted after memory rename/delete, but platform/filesystem responses that specifically mean directory open or sync is unsupported are best-effort; other directory I/O failures remain reported with truthful committed acknowledgement. No storage format migration or new transaction API is introduced.

## Clients without roots or elicitation

Fabric's fail-closed behavior assumes the Kiro client advertises MCP roots and answers form elicitations. Clients without those capabilities degrade, not crash:

- **Automatic launcher handoff**: launch from the project using `"$HOME/.kiro/kiro-fabric/bin/kiro-fabric" start`. The launcher explicitly supplies its canonical project directory through `KIRO_FABRIC_LAUNCH_WORKSPACE`; the backend never infers a project from its own cwd. With initially empty/missing client roots this project auto-binds after normal reserved-path checks. Client roots take precedence; their removal or transient failure never reactivates the fallback. Bare `kiro-cli` still requires client roots or approved attachment. The generated MCP profile explicitly forwards `${KIRO_FABRIC_LAUNCH_WORKSPACE}` using Kiro's environment expansion; inherited shell variables alone are filtered out by Kiro's MCP transport. An unexpanded placeholder leaves Fabric unbound rather than treating it as a path. Local authenticated Kiro CLI 2.21.1 v3 smoke verified this handoff on macOS ARM64; full release qualification remains separate.
- **No MCP roots capability**: checked `fabric.workspace({action:"list"})` reports an explicitly-empty root list (operator endpoint `fabric_workspace` remains compatible). Bind the workspace manually with the `attach` action and an absolute `path`; manual attachment itself requires form elicitation, so a client with neither capability cannot bind a workspace at all and workspace-scoped providers stay unavailable.
- **No form elicitation**: defaults are `read: "allow"`, `write: "allow"`, `execute: "allow"`, `network: "allow"`. All risk categories are allowed without confirmation, including file mutations, shell execution, configured MCP process startup, and network actions. **Shell commands retain host authority and can write files or access the network; separate write/network policies do not restrict shell effects.** To restore confirmation, merge `{"schemaVersion":1,"approvals":{"write":"ask","execute":"ask","network":"ask"}}` into `data/fabric/config/config.json`; use `"deny"` per risk to block actions. Explicit `ask` still fails closed when elicitation is unavailable. Existing explicit policies are preserved; missing approval settings adopt the new defaults after restart. This changes approval policy only, not workspace validation, configured-tool boundaries, or execution limits.
- **Transient failures** are never treated as removal: a failed roots refresh reports a temporarily-unavailable workspace using the last verified root set, and never unbinds silently.

The generated agent profile deliberately omits `model`; `--v3` selects Kiro's V3 harness and is not a model name. The inline `mcpServers.fabric.requestTimeout` is 917000 ms: Fabric's 900000 ms maximum guest deadline plus the 10000 ms compiler allowance, 2000 ms outer cancellation grace, and a positive 5000 ms client-response margin. This keeps Kiro's client deadline strictly later than Fabric's own maximum request envelope.

The generated `mcpServers.fabric.waitForReady` is **true**. Kiro V3 connects MCP servers asynchronously and snapshots the model's tools at turn start; without this flag a headless first prompt can run before `fabric_exec` is registered, even with `--require-mcp-startup`. The flag uses Kiro's readiness barrier, not an arbitrary sleep, and does not expand tool visibility or approve nested effects. A disconnected/failed server still cannot execute tools; readiness is not proof of task success. Refresh an existing installation with `pnpm run agent:update` from the source checkout (or the normal release update) and start a new conversation. Do not manually edit the integrity-tracked installed profile. Local CLI 2.21.1 V3 headless verification confirmed a real `fabric_exec` result after enabling this flag; release qualification remains separate.

By default, [Kiro custom agents inherit](https://kiro.dev/docs/custom-agents/configuration-reference/#disabling-default-resource-inheritance) default steering, skills, and `AGENTS.md`. Fabric preserves that Kiro default and its installer does not write Kiro settings. A user who wants only the resources named by custom-agent profiles can explicitly set:

```sh
kiro-cli settings chat.disableInheritingDefaultResources true
```

The setting is global and workspace-overridable. Re-enable inheritance by deleting the explicit setting:

```sh
kiro-cli settings --delete chat.disableInheritingDefaultResources
```

## Efficient output, working rules and immutable skills

The **always-on agent prompt** distinguishes tool routing from tool necessity: user tool bans include pure computation, formatting and verification, and override workflow advice. Default to solution, verification and blockers in **120 words or fewer** only if no other format/detail requirement is specified. Requested JSON keeps permitted evidence inside its schema, without fences or post-test prose. For JSON-only requests, suppress visible assistant commentary before/between tool calls: Kiro includes it in `finalText`. Recheck the entire final text without calling tools.

Standing guidance includes plain comments, Git history/edit/staging preservation, commitlint, PR templates, noninteractive commands, no disk/home/ancestor scans, reading supplied files, and explicit permission for GitHub comment mutations. Detailed review-reply/resolution and file-backed Markdown procedures are in workflow help. `gh api` uses `--input`, not `--body-file`. `local.read` reads UTF-8 text, not images/PDFs; unavailable capabilities are blockers, not permission to guess.

Exact local API/result shapes stay beside the tool. Known paths need no ritual listing/help; unknown layouts require discovery. For permitted tool work, keep known-schema data pipelines in one bounded execution. Parallelize independent reads, sequence dependencies, retain per-effect approvals and stop for missing evidence or model judgment. Never replay effects to repair presentation.

`fabric.help({topic,offset?,limit?})` exposes fixed immutable topics without workspace binding: `overview` for bootstrap; `api` for TypeScript declarations (unchanged meaning); `skill` for SKILL.md; `guide` for API prose; `recipes` for executable examples; `workflow` for coding/Git/GitHub procedures. Follow `nextOffset` on required truncated content. Offsets are zero-based UTF-16 characters, not bytes/lines. Help accepts no path/URI, reads no file at request time, executes no example and grants no approval.

`scripts/generate-agent-guidance.mjs` embeds canonical Markdown; `pnpm run guidance:check` detects stale generated source. Bundles include matching strings and Markdown in one verified generation. Skill access therefore does not depend on optional resource activation or external-workspace shell reads. Detailed help is task-loaded. The standing-character ceiling is 5,200 after adding the user's rules; characters are not tokens, and the input trade-off needs live measurement.

Update normally and start a **new Kiro conversation** to adopt prompt, descriptions and help together. `resources/steering/fabric.md` retains nonduplicated installation boundaries. Never edit integrity-tracked installed files or duplicate global steering. This is **model guidance**, not a hard output cap, no-tools switch, JSON decoder or perfect-success guarantee. Inventory, approvals, timeout/call/output limits and native exclusion are unchanged; normal resource inheritance remains. See [turn contracts](turn-contracts.md) for the client enforcement boundary.


## Strict local coding and bootstrap

The profile exposes only `@fabric/fabric_exec`; no configuration selects hybrid mode. A verified root is required for local coding. Unbound/unavailable sessions retain checked `fabric.info()`, `fabric.help()` and `fabric.workspace()` recovery; the backend data directory is never a project fallback. Select/attach/detach must run separately from workspace operations and commit only after successful guest settlement and lease release. Restart existing Kiro conversations after an upgrade to adopt the new profile inventory.

Complete installed generations select ripgrep through installer-owned `KIRO_FABRIC_BUNDLE_ROOT` and `KIRO_FABRIC_RG`; Node/runtime/data bindings remain explicit. Startup verifies the manifest, exact private tools, modes/hashes and generation ownership before durable initialization. Missing managed fields/tools never silently select PATH. Search rechecks managed hash and inode/device identity before argument-array invocation with `--no-config` and a credential-free locale environment. Library/development use retains a separate external resolver using only absolute PATH entries; relative/empty entries are ignored and later PATH changes do not redirect it. Missing/changed executables fail; there is no search-engine fallback.

The short installation/startup admission lock is distinct from workspace write-effect locks. New-format starts are fenced during activation/retirement, while admitted sessions keep their immutable generation and compatible durable data. The installed manager's doctor does not acquire either lock. See [installation, recovery and legacy limitations](installer.md).

Search keeps a shared 10-second deadline, 2 MiB process-output bounds, at most 10,000 selected files, 2 MiB per text file and 32 MiB aggregate consumed input. A glob narrows the normal ignore/hidden enumeration before the candidate cap; the raw enumeration still has its output bound. All selected aliases are checked. Grep reads/revalidates batches of at most 32 text files/2 MiB and stops after the requested prefix, reporting `truncated:true` when candidates remain unsearched. Narrow the path or glob when work bounds are exceeded; a small result limit is not a promise of constant enumeration work. Local read/search/write/result bounds are documented in the bundled API. Existing `executor.maxNestedResultChars` also bounds typed local results and canonical approval material. Oversized changes are rejected rather than approving an invisible diff suffix.

Known-owned initialization/release failures retain exact inode cleanup responsibility. Cleanup is retried before another mutation; an unavailable identity or replacement lock fails explicitly and is never guessed from a pathname. Descriptor close is attempted once: a throwing close can already have released/reused its numeric descriptor.

Within a Code Mode execution, local write/edit/shell calls are serialized FIFO in host-call arrival order before argument preparation, including generic `tools.call`. This prevents parallel shell calls from colliding with each other without guessing whether commands are read-only. Each operation retains separate approval, validation, audit and cleanup. A rejected predecessor stops remaining local effects for that execution; `settle:true` ordinary nonzero shell results may continue. Waiting uses the outer deadline and existing bounded host-call budgets; no queued action starts after cancellation/expiry. Reads/searches remain parallel and are not ordered against writes: await explicit dependencies. Cross-execution registry conflicts and cross-process locks remain fail-fast.

Local write/edit/shell share a private workspace-data mutation lock across cooperating Fabric processes. Locks are fail-fast, never automatically broken as stale: after a crash/cleanup failure an operator must establish that no owner or descendants remain and inspect affected files before removing an abandoned local lock. Preserve memory/state files; never remove another live process's lock. External editors do not participate; snapshots detect ordinary conflicts but Node pathname checks are not race-proof OS isolation.

Approved `/bin/sh` commands run with host OS authority; cwd does not confine filesystem/network access. The environment is allowlisted, not a sandbox. Process groups receive bounded TERM/KILL cleanup, including leftover children after leader exit. Deliberate process-group escape is unsupported; Linux zombie reaping belongs to host init. No background-job management is advertised. Ordinary nonzero exits retain bounded head-and-tail stdout/stderr: `settle:true` returns the result, otherwise the checked guest can inspect `error.result` after narrowing to `Error`. Failed executions project the last ordinary nonzero result as `lastShellFailure`, separately from error messages/audit telemetry; this may precede a later guest failure. Existing overflow artifacts retain the full bounded projection when capacity permits. Denial, timeout, cancellation and uncertain cleanup are never ordinary settled success. Outer tool allowance never grants inner permissions.

## Long-running chat context

Kiro, not Fabric, owns conversation persistence and compaction. Kiro's documented default is automatic compaction as a conversation approaches its compaction threshold; `/compact` requests it immediately. Fabric installation does not change `chat.disableAutoCompaction`. Inspect the effective explicit value with:

```sh
kiro-cli settings chat.disableAutoCompaction --format json
```

`null` means no explicit override. A user who previously disabled automatic compaction can explicitly re-enable it with:

```sh
kiro-cli settings chat.disableAutoCompaction false
```

This setting does not control the Fabric MCP lifecycle. Within one active Kiro CLI process, ordinary turns and compaction must keep the same Fabric MCP PID/instance and the same runtime generation for an unchanged workspace. That invariant remains an authenticated exact-release-SHA qualification gate, not a behavior claimed from component tests alone. Fabric memory/state is global-data-root-backed and workspace-scoped; do not use it as a duplicate conversation transcript. TTL artifacts and in-memory values are intentionally ephemeral.

Memory mutations can fail after their atomic rename/delete has already become visible, including during deadline checks or exact-identity lock cleanup. Such failures explicitly say the mutation **committed** and instruct callers to read the key before retrying. The common bounded acknowledgement (action reference and set/delete/write/edit operation only, shared by memory/state/local mutations) survives an outer cancellation/deadline result; it never includes the memory key, value, or underlying error cause. Errors without that acknowledgement, including pre-publication failures and no-op deletes, do not claim a commit. Cleanup retries retain descriptor/inode identity evidence where available and refuse to remove unidentified, foreign, or replacement locks; unverifiable initialization reports unresolved cleanup rather than deleting by pathname.
