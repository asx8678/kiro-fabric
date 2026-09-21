# Continuity / ACP / Fovea remediation handoff

Status: **implemented (2026-09-21)** — all nine findings carry source fixes, regressions that fail on the prior behavior, and the verification recorded in section 7. The boundaries in section 1 remain in force, and the live/platform gates listed in section 7 are still open. Sections 1–6 and 8 stay as the original contract for review.

Baseline inspected: local HEAD `74e4c6b93f9b` **plus the current uncommitted working tree**. Several reviewed modules are untracked additions; a clean checkout of that commit does not contain them. Preserve and transfer the working-tree additions with this plan. Recheck current contents before editing; symbols below are more durable anchors than line numbers.

Related scope: [original continuity handoff plan](continuity-handoff-plan.md).

## 1. Assignment and non-negotiable boundaries

Implement the nine findings in section 3 using the work packages below. Prefer small, independently verified changes over a replacement storage engine, a new daemon, or a complete ACP SDK integration.

- Read `AGENTS.md` first. Preserve all existing edits/staging. No commits unless separately requested; never push or delete repositories, including test repositories. No Kubernetes access.
- Keep native compaction unchanged. Keep `qualified: false`, `managedRotationAvailable: false`, and native suppression evidence `unknown`. Requested v3 selection is not observed v3 evidence.
- Do not add a managed-rotation launcher, installer flag, settings mutation, automatic conversation capture, implicit recovery/replay, or authenticated inference to this task.
- Archive and journal remain trusted-host library APIs, not guest actions. Keep workspace isolation, private file modes, quotas, CAS, source-hash verification and permission denial intact.
- Do not repair corrupt history by recomputing its hashes, truncate it, evict it, or fabricate a successful acknowledgement. Preserve evidence and fail closed.
- A stale or ambiguous write/submission must never trigger an automatic retry of an external effect.
- Tests must use `tests/fixture-cleanup.mjs`. Audit subprocess and production cleanup too; importing that helper alone does not make a test safe.
- Finish implementation with a fresh `pnpm run build` and post-build behavioral checks. Tests against source alone are insufficient because some workers load from `dist/`.

### Recommended scope choices

1. Fix ACP protocol shape, evidence and lifetime together; they share one request/pump lifecycle.
2. Fix publication durability in `StateProvider`, not with an extra journal-only fsync after `set` has already acknowledged.
3. Keep the bounded CAS snapshot archive for now. WAL/segmented storage is a separate scalability project, not needed to close these findings.
4. Fix Fovea retention with bounded per-file staging/reuse, not a new global cache or a weaker source trust boundary.
5. Avoid a new runtime dependency solely for ACP validation. A small versioned protocol subset plus independent fixtures fits the current package/closure policy.

## 2. Evidence and qualifications

The prior review created `.tmp/review-continuity-20260921.mjs`, which exercised the built library without real Kiro inference. It may be absent in another checkout because `.tmp/` is ignored; the counterexamples are restated below.

**Important: that script succeeds when the bugs are present.** It is a historical reproducer, not a passing post-fix acceptance test. Port its scenarios into maintained tests with the correct assertions; do not preserve its buggy expected values or use its exit 0 as proof of a fix.

Observed counterexamples:

- A peer returning `-32602` for the missing `params.prompt` produced `cancellationTerminalWitnessed: true` and no recorded error.
- A permission request received `{ outcome: { outcome: "deny" } }`; the report claimed successful default denial even though this is not an ACP outcome.
- A rejected prompt write still set `exactContinuationSubmitted: true`; initialization error still led to `session/new` and `session/prompt`.
- With a 50 ms operation deadline, a never-settling send caused an unhandled rejection/Node exit 1; never-settling read or close exceeded the independent 1,500 ms process harness budget.
- Appending the same event ID and payload with kind changed from `user` to `tool-result` returned `alreadyAppended` and retained the old kind.
- A `Buffer` payload was accepted at revision 2, then archive reads failed hash-chain verification because `structuredClone(Buffer)` serializes differently.
- A reopened `preparing` rotation rejected new `begin`, `markBlocked` and `reconcile`. This is a **missing abandonment transition**, not proof that the original preparation cannot be continued.
- Submission-intent publication performed file fsyncs and rename but no directory fsync. This establishes a missing durability barrier, **not an experimentally reproduced power-loss event**; ordinary process restart and host/power failure are different guarantees.
- An objective plus two versions of one check yielded `admittedRecords: 3`, `shownRecords: 3`, but only the objective and latest check were represented.
- Fovea's `Map<string, Buffer>` retains the admitted source tree before checking reuse, up to the default 128 MiB source cap. This is a structural allocation finding; the review did not measure peak RSS or prove an actual OOM.

ACP v1 references independently checked in the review:

- <https://agentclientprotocol.com/protocol/v1/prompt-turn>
- <https://agentclientprotocol.com/protocol/v1/tool-calls>

Record the protocol version/source provenance in maintained fixtures. If consulting public documentation, use the project's permitted browser path; never send private code, tokens or transcripts in queries. These references do not certify the installed Kiro implementation.

## 3. Finding-to-delivery acceptance ledger

Mark a row complete only with the source change, a regression that fails on the old behavior, and the relevant verification evidence.

| ID | Priority | Finding / principal location | Work package | Required result |
| --- | --- | --- | --- | --- |
| R1 | High | ACP wire shapes; `src/kiro/acp-capability-probe.ts` | P1 | Valid `params.prompt` and protocol-valid negative permission replies; independent contract validation. |
| R2 | High | False capability evidence; same module | P1 | No initialization fallthrough, no rejected-write success, no arbitrary-error cancellation witness. |
| R3 | High | Unbounded transport awaits / unhandled rejection; same module | P1 | All asynchronous phases settle within operation plus cleanup budgets; late work cannot send or mutate a returned report. |
| R4 | High | Directory durability / acknowledgement; `src/providers/state-provider.ts` | P2 | Directory barrier precedes successful durable acknowledgement; post-publication failure is explicitly uncertain and never replayed. |
| R5 | Medium | Inconsistent payload serialization; `src/continuity/conversation-archive.ts` | P3 | One bounded plain-JSON representation is hashed and stored; unsupported input cannot poison prior history. |
| R6 | Medium | Replay ignores event kind; same module | P3 | Same ID with changed kind or payload conflicts; exact retries remain idempotent. |
| R7 | Medium | No pre-submission abandonment; `src/continuity/rotation-journal.ts` | P4 | CAS-protected abort before submission; no abort/replay of ambiguous submitted work; current-session identity preserved. |
| R8 | Medium | Whole-tree buffer retention; `src/fovea/source-access.ts` | P6 | Buffer retention scales with bounded per-file work, not aggregate source bytes; warm reuse and source security remain intact. |
| R9 | Low | Incorrect handoff coverage; `src/continuity/handoff.ts` | P5 | Exact represented sequence count, including only the latest check per ID; budgets/hash determinism preserved. |

## 4. Work order and ownership

Suggested order: **P0 -> P1 -> P2 -> P3 -> P4 -> P5 -> P6 -> P7**.

- P1, P3, P5 and P6 can be developed independently after P0 if separate agents are explicitly used. Do not run conflicting suites/builds concurrently.
- P4 depends on P2's durability/error semantics; P3 needs integration verification against the repaired shared store.
- One integrator owns `src/index.ts`, guest declarations, generated guidance and final `dist/` rebuilds. Other agents should propose changes to those shared files rather than overwriting them concurrently.
- Units below are patch boundaries, not permission to create commits.

### P0 — Establish the baseline and regression scaffold

1. Record `git status --short`, inspect the affected diff and read this plan plus `AGENTS.md`. Do not revert unrelated edits to obtain a clean baseline.
2. Trace the affected public/library callers with bounded searches. In particular:
   - `runAcpCapabilityProbe` / `AcpProbeTransport` -> synthetic tests and `src/index.ts`.
   - `StateProvider` -> task store, archive, journal, ordinary `state.*`, registry audit and execution projection.
   - `buildContinuityHandoff` -> provider, contract/guest types, bootstrap facade and docs.
   - `SourceAccess.captureSourceSnapshot` -> `FoveaEngine.execute` and snapshot reuse/invalidation.
3. Port reproductions from section 2 into maintained tests. Assert desired behavior and confirm the relevant tests fail before each fix.
4. Keep any optional scratch artifact local. Maintained tests and this document must be sufficient for a different machine; do not depend on absolute paths, existing private runtime state or the review's `.tmp` files.

### P1 — ACP contract, truthful evidence and bounded lifetime (R1–R3)

**Primary files:** `src/kiro/acp-capability-probe.ts`, `tests/continuity-acp-probe.test.ts`, `src/index.ts`.

**Suggested new internal module:** `src/kiro/acp-probe-contract.ts` for the small ACP v1 method/result validators. Keep it pure; do not introduce a second session manager. A checked fixture under `tests/fixtures/` should encode normative wire examples independently of the producer code.

#### Protocol and evidence

- Send `session/prompt` with `{ sessionId, prompt: [{ type: "text", text: continuation }] }`. Preserve exact continuation bytes; reject malformed/unbounded input instead of silently rewriting it.
- Validate JSON-RPC shape, response ID, exactly one result/error, negotiated protocol version and the identity evidence this probe requires. Stop on initialization error or missing required probe evidence; do not create a session afterward.
- Require a new, bounded session ID distinct from the supplied known IDs. Session ID uniqueness alone does not prove engine/agent selection.
- Validate permission request ID, active session, tool-call shape and advertised options. Before cancellation, select only a validated advertised `reject_once` option (or documented negative option); never invent an option ID or select allow. If no safe reject option exists, cancel the turn and respond `cancelled` rather than granting permission.
- Once cancellation starts, answer pending/new valid permission requests with `{ outcome: { outcome: "cancelled" } }`. Unknown/mismatched requests must not count as denial evidence or authorize work.
- Set the denial gate only after a valid negative response write succeeds; zero permission requests is `not observed`, not success. Describe this as response-write evidence, not proof that the agent honored it.
- Track local submission attempt separately from successful transport write. A rejected/timeout write is **possibly partially sent** unless the transport explicitly proves otherwise; keep `exactContinuationSubmitted` false and record uncertainty, never retry.
- Preserve the existing gate names for consumers, but add structured submission/cleanup state if needed to express uncertainty. `submittedContinuation` remains successful-write evidence; intended bytes/hash must not be confused with that field.
- Accept cancellation evidence only from the matching prompt response containing `stopReason: "cancelled"`, with cancellation locally requested and its write successfully settled. An arbitrary RPC error, `end_turn`, mismatched ID or unrelated session update never establishes cancellation. A prompt that finishes before cancellation is a race to report, not a successful cancel test.
- Always keep the three release gates from section 1 unchanged, even for `source: "live"`.

#### Lifetime and limits

- Use a monotonic clock/deadline. Existing `runAbortable` and `settleWithin` in `src/async-settlement.ts` are useful patterns; they bound awaiting, **not termination of an underlying non-cooperative operation**.
- Give transport methods an explicit cancellation contract, e.g. a signal argument for `send`, `next` and bounded shutdown. Maintain source compatibility where possible and update all typed call sites if signatures evolve.
- Use one operation AbortController/deadline for initialize/new/prompt/permission/cancel/read. Use a **fresh, separate bounded cleanup scope** after abort; passing an already-aborted signal to shutdown must not accidentally skip cleanup.
- Attach response rejection handling immediately when a request is registered. Do not rely on later `await response` after `await sent`. Observe synchronous throws as well as asynchronous rejections from injected transports.
- Store reject/resolve/cleanup handles for every pending request. One terminal path must reject pending requests, clear timers, abort reads, stop new sends and clean up listeners on EOF, budget exhaustion, malformed frames, cancellation or failure.
- Never unconditionally await `close()` or the pump. Bound both; an uncooperative transport must yield a report with cleanup unconfirmed rather than hang. Consume late rejections and prevent late callbacks from changing the finalized report or making new requests.
- A real process-owning transport must terminate only its owned child/resources if graceful close fails. Do not add a live stdio transport merely to satisfy this task; a generic injected JavaScript transport cannot promise OS containment or be forcibly killed by the runner.
- Validate options as finite positive safe integers before effects. Suggested bounded policy: operation timeout 1..120,000 ms (default 10,000), cleanup timeout 1..5,000 ms (default 1,000), frame count 1..4,096 (default 512), continuation at most 65,536 UTF-8 bytes, one serialized frame at most 256 KiB and aggregate incoming frame bytes at most 4 MiB. Keep limits named and independently tested; do not raise production limits to make fixtures pass.
- The host-side frame cap bounds accepted evidence, not pre-parse transport allocation. A future live adapter must enforce its raw byte cap before JSON parsing; state this remaining obligation explicitly.

**Acceptance:** Contract peer rejects `content` and `deny`; corrected messages pass. Negative cases cover `-32602`, init rejection, missing/version-mismatched init, known session ID, prompt write rejection/partial uncertainty, wrong-session permission, invalid/duplicate response, EOF, malformed/oversized frames and no permission request. Each never-settling phase (send/read/permission reply/cancel/close) returns bounded failure with no unhandled rejection or late-send/report mutation. Test cancellation vs terminal-response ordering explicitly.

Keep production timeouts exact. Measure elapsed operation time inside the fixture process; give process startup plus operation plus cleanup a separate generous harness budget (at least 3–5x the production bound, with a practical cold-start floor). Assert spawn errors. Fake clocks can prove lifecycle transitions; retain at least one isolated real-process liveness test.

### P2 — Durable state publication without losing committed truth (R4)

**Primary files:** `src/providers/state-provider.ts`; inspect `src/protocol.ts`, `src/core/action-registry.ts`, `src/kiro/projection.ts`, `src/continuity/execution.ts` as consumers.

**Existing reference:** `scripts/atomic-file.mjs` has file-sync -> rename -> directory-sync ordering. Use it as a reference only: importing/copying it wholesale would lose `StateProvider`'s stronger ownership, no-follow and cleanup guarantees.

1. Reuse the verified root descriptor already owned by the mutation-lock path, passing it into publication as needed. Revalidate identity/ownership before publication and verify the barrier applies to the directory actually receiving the rename.
2. Preserve the order: exclusive owned temporary -> write/chmod -> fsync temporary -> precommit checks -> rename -> **mark publication observed** -> fsync containing directory -> return successful durable result -> normal lock cleanup.
3. Move publication bookkeeping to the rename boundary. Currently `committedRevision` is set only after `#write` returns; merely adding fsync inside `#write` would misclassify a post-rename sync failure as a pre-commit failure.
4. Separate `published` from `durability confirmed`. Reuse/extend `StateCommitAcknowledgementError` with explicit durability metadata and an accurate message for post-rename failures. The existing `FABRIC_COMMIT_ACKNOWLEDGEMENT` symbol means observed publication, **not power-loss durability**; do not silently redefine that protocol or lose the symbol when wrapping cleanup failures.
5. Preserve the published file if directory sync, postcommit validation, deadline checking or lock release fails. Do not attempt rollback or blindly repeat the mutation. Journal callers must proceed to external effects only after successful durable completion, never merely because an exception has the publication marker or a later read sees the new value.
6. Handle first-time storage creation too: establish directory-entry durability for newly created path components before claiming the first successful durable journal write. Sync only the relevant verified directories; no broad permission changes or filesystem operations outside the intended storage path.
7. On supported macOS/Linux filesystems, directory-sync failure is a failure, not an ignored optimization. Unsupported platforms/filesystems must have an explicit unsupported/uncertain result; do not add a silent atomic-only fallback for the journal. Do not claim universal power-loss protection beyond the OS/filesystem contract.
8. Keep the existing state document schema, CAS revisions, lock recovery and private modes unchanged. Update the documentation to distinguish process restart, observed publication and OS-level durability.

**Acceptance:** Add fault-injection tests for temporary sync, rename, directory sync and lock release, including delete and first creation. Assert actual call ordering by fd type/identity, not brittle ordinal fsync counts. Before rename: old state remains authoritative. After rename with failed directory barrier: new bytes are preserved, publication is reported, durability is unknown, no external continuation is sent. Successful mutation requires the barrier before acknowledgement. Confirm no fd/listener leaks, CAS behavior across independent writers and unchanged symlink/hardlink/root-replacement protections.

An injected I/O trace validates barrier placement; process-kill recovery tests validate process recovery. Neither is a real power-loss certification. Do not reboot a machine, manipulate a disk or teardown infrastructure to test this plan.

### P3 — One archive representation and complete retry identity (R5–R6)

**Primary files:** `src/continuity/conversation-archive.ts`, `tests/continuity-archive.test.ts`.

- Replace the current validate/stringify/stringify/structuredClone split with one bounded plain-JSON admission routine that returns the normalized value and its exact serialized text.
- Accept JSON primitives, dense arrays and plain objects with own data properties. Reject Buffer/typed arrays, Date/Map/Set/custom prototypes, accessors, custom `toJSON`, functions, symbols, undefined, bigint, non-finite numbers and cycles before publication. Do not invoke getters to validate them.
- Bound depth plus traversal/output work, not only the size after an unbounded stringify. Avoid prototype pollution when copying keys such as `__proto__`; use null-prototype objects or explicit data-property creation. Specify JSON numeric/string representation, and test aliases without mistaking an acyclic repeated reference for a cycle.
- Preserve current v1 key-order/hash semantics for already valid JSON inputs. **Do not sort keys or change the hash domain** during this bug fix. Hash the admitted serialized text and persist its parsed/normalized JSON value so read-back yields exactly the same serialization.
- Compare immutable event identity on retries: `prior.kind === kind && prior.payloadHash === payloadHash`. Changed kind or bytes conflicts, even with a stale revision; an exact all-duplicate retry remains idempotent with the original revision. New events still require the observed revision and a CAS winner.
- Validate persisted payload/chain bounds before returning data. Never migrate/repair an already corrupt archive by recomputing historical hashes. Preserve valid archives and existing hashes without rewriting them on read.

**Acceptance:** Same-ID/same-kind/same-payload replay is unchanged and does not write. Changed kind or payload conflicts. For Buffer, custom `toJSON`, accessor and other rejected payloads, previous revision/head/file bytes remain unchanged and readable. Valid nested JSON, numeric-looking object keys, Unicode, `__proto__`, exact byte/depth limits, circular values and concurrent append are covered. Reopening an existing valid v1 archive preserves hashes. Bounded admission rejects oversized inputs without retaining huge intermediate serializations.

### P4 — Safe pre-submission abandonment and phase invariants (R7)

**Primary files:** `src/continuity/rotation-journal.ts`, `tests/continuity-rotation.test.ts`, `src/index.ts` if new public types are added.

Add a host-only `abort` operation with conversation/workspace/rotation identity, expected journal revision, expected epoch and a bounded operator reason. The implementation must use the existing CAS publication path, not delete the record.

| From | To | Required invariant |
| --- | --- | --- |
| preparing | aborted | No submission ID/intent; retain old session and original bindings. |
| created | aborted | No submission ID/intent; retain fresh session ID as a never-reuse tombstone. |
| submitting / blocked | aborted | Forbidden; use the existing explicit reconciliation path. |
| active / reconciled / aborted | other phase | No new transition through `abort`; terminal records cannot be resurrected. |

- Derive current session from the latest terminal outcome; an aborted attempt leaves its old session current. Handle the **first-ever rotation being aborted**, not only abort after an earlier active rotation. Reject the wrong old session on the next `begin`.
- Keep original checkpoint hash, archive watermark/head hash, record and epoch; allow the next epoch but never reuse an observed session ID. Refuse late `recordSessionCreated` or `beginSubmission` for an aborted record.
- A lost acknowledgement of `session/new` can leave an orphaned remote session. Aborting local preparation is not proof that session creation had no effects, does not delete any remote session, and never authorizes resuming or sending to that unknown session.
- Use a discriminated phase representation or a small pure transition validator so required fields and `uncertainEffects` match the phase. As part of this change, require submission IDs for `active`, enforce decision/note bounds, and return parsed normalized records from `parseDocument` rather than discarding normalization and returning the raw array.
- Use journal document schema v2 for the new terminal phase; retain an explicit v1 reader for valid existing journals and upgrade only in a successful CAS mutation. Reads must not rewrite history. Reject unknown versions and malformed old/new records. Do not change the shared StateProvider schema or the archive format.
- An abort acknowledgement lost after publication must not authorize a fresh external action by exception handling alone; read/reconcile durable state before proceeding. No automatic replay loop is added.

**Acceptance:** Abort from each pre-submission phase, restart then abort, first-rotation abort, stale revision/epoch, wrong workspace, malformed phase fields, late completions, reuse of the abandoned session ID and abort-vs-submission races. Exactly one CAS transition wins. Submitted/blocked work cannot bypass reconciliation. Old v1 valid fixtures remain readable and preserve bindings when upgraded. Two logical conversations stay isolated.

### P5 — Accurate handoff coverage without weakening pinning (R9)

**Primary files:** `src/continuity/handoff.ts`, `tests/continuity-handoff.test.ts`; integration in `tests/continuity-provider.test.ts`.

- Build represented sequence sets from the same selected records that produce the packet: latest objective, all constraints/open items, latest check per ID, unresolved operations, and only optional records actually included.
- Remove the blanket inclusion of every `check` sequence from `essentialSequences`; add the sequences from `checksById.values()` instead.
- Count a sequence once even if represented both in `prompt` and `pinned`. Evidence references alone, wrapper warnings and caller-supplied `nextPrompt` do not constitute additional shown source records.
- Keep existing output fields and pinning behavior. Correct `shownRecords`; document that `admittedRecords - shownRecords` includes both superseded and otherwise omitted records. A new coverage field is not required to close this bug.
- Keep UTF-8/serialized-envelope budgets, exact revision/hash/workspace binding and refusal when essential facts cannot fit. Corrected coverage intentionally changes newly generated packet hashes for affected histories; do not rewrite old stored packets or checkpoint hashes bound into existing rotations.

**Acceptance:** Objective + two revisions of one check reports 3 admitted / 2 shown; several IDs retain the latest of each; replaced objectives/next steps, required-only budget fallback and optional omission produce accurate counts. Packet generation remains deterministic for the same implementation/inputs, constraints are never dropped, and direct/dynamic guest calls still match.

### P6 — Bound Fovea retained bytes while preserving warm reuse (R8)

**Primary files:** `src/fovea/source-access.ts`, `src/fovea/engine.ts` only as needed for prior-snapshot identity/lifetime, tests under `tests/fovea/`.

Use the existing trusted source descriptor pipeline. Do not optimize by trusting live mtimes, skipping live hashes, weakening exclusions, or reopening live files after hashing to copy potentially different bytes.

Recommended algorithm:

1. Verify/pin the previous **host-owned private** snapshot capability before relying on it. If no usable previous snapshot exists at entry, stream each newly admitted live file immediately to the task-owned staging directory.
2. Read/stat/hash one admitted live file at a time, keeping existing exact-byte/no-follow/race checks. Stage new/changed bytes immediately. For an unchanged path with a usable prior snapshot, retain only path/hash metadata and release the live buffer before the next read.
3. After enumeration, if the complete ordered digest/membership is unchanged and the held prior snapshot is still valid, return that snapshot without writing another full copy (preserve the current warm-reuse contract).
4. If the tree changed, assemble unchanged files from the held private snapshot using bounded descriptor reads and expected-hash verification. Never copy from a live source pathname, follow links, or share mutable hardlinks. Preserve destination `wx`/0400 files and 0700 directories.
5. If the prior snapshot disappears, changes identity or has inconsistent bytes after some buffers were discarded, fail closed and invalidate reuse. A later explicit capture can start fresh; do not silently reopen live files or serve stale bytes inside the same successful result.
6. Retire the old snapshot only after the new staging tree is complete and the engine can publish it. Preserve cancellation invalidation, lease ownership and cleanup of task-owned non-repository staging only.

Retained source bytes should be O(one bounded file/read-copy operation), plus O(file count) metadata, rather than O(total admitted bytes). `readSourceBounded` may allocate a bounded extra copy; measure that constant rather than promising an exact one-buffer RSS figure.

**Acceptance:** Cold capture; unchanged warm reuse with no second full copy; one-file change in a large tree; add/delete/rename; changed approved rules; cancellation during copy; missing/replaced prior tree; same-size changed live bytes; symlink/hardlink/nested-repository exclusions; correct ordered digest and unchanged live source modes. Engine invalidates partial results on error.

Add a deterministic streaming/retention test using a bounded fake `SourcePlatform`/private staging seam, plus a task-owned large-fixture memory/latency probe. Gate the structural retained-byte bound and correctness; record `external`, `arrayBuffers` and RSS as diagnostic measurements with a documented generous threshold, not a flaky exact RSS/GC assertion.

**Platform caution:** Much of `tests/fovea/source-platform.test.ts` is Linux-only and skips on macOS. An all-skipped file is not verification. Exercise a portable fake-platform test locally and the real Linux/native Darwin paths on their supported hosts; report any remaining platform gate explicitly.

### P7 — Integrate, document and verify the built path

1. Mechanically confirm public exports and all touched declarations/call sites: `runAcpCapabilityProbe`, `AcpProbeTransport`, archive/journal types, any new `abort` method, `buildContinuityHandoff`, `continuity.handoff` contract/provider/guest bootstrap, and `probe:continuity` in `package.json`.
2. Do not register the archive, journal or ACP probe as guest tools. No new live-mode/installer configuration is authorized by these fixes.
3. Update `docs/continuity-handoff-plan.md`, relevant API/configuration/workflow references and this ledger with accurate changed contracts, limits and remaining gates. Keep historical-data warnings and native-compaction boundaries.
4. Keep generated guidance derived from its markdown inputs; do not hand-edit `src/kiro/generated-guidance.ts` or built bundles.
5. Inspect final diffs for accidental unrelated changes. Run a coherent structural review at the integration checkpoint, not after every edit.

## 5. Verification matrix and commands

Use targeted checks while iterating; rerun only changed/affected checks until the final integration gate. Inspect nonzero results rather than treating command launch as success. Set one shell timeout per long run and report actual pass/fail/skip counts.

| Package | Smallest relevant maintained suites (existing files unless marked new) |
| --- | --- |
| P1 | `tests/continuity-acp-probe.test.ts`; new schema/deadline cases may be split into adjacent files. |
| P2 | `tests/state-reliability.test.ts`, `tests/state-boundary-regressions.test.ts`, `tests/artifacts-state.test.ts`, `tests/storage-failure.test.ts`; escalate to `tests/mcp-process-lifecycle.test.ts` for cross-process publication. |
| P3 | `tests/continuity-archive.test.ts`, then relevant shared-state suites. |
| P4 | `tests/continuity-rotation.test.ts` including v1/v2/restart/CAS cases. |
| P5 | `tests/continuity-handoff.test.ts`, `tests/continuity-provider.test.ts`; declaration and direct/dynamic invocation checks. |
| P6 | `tests/fovea/source-platform.test.ts`, `tests/fovea/source-platform-bounds.test.ts`, `tests/fovea/source-platform-native.test.ts`, `tests/fovea/engine.test.ts`, `tests/fovea/cold-inputs.test.ts`, plus the new portable memory/streaming regression. |
| Integration | Continuity store/capture/execution/observation/task/recall/core suites affected by StateProvider or output changes; Fovea call-context/MCP delivery suites if the engine path changed; `tests/guidance.test.ts`. |

Typical sequence after source changes:

```sh
pnpm run typecheck
# Inspect build cleanup scope first (see below), then refresh worker code:
pnpm run build
# Example core integration group; append any newly created regression files:
timeout 300s pnpm exec vitest run \
  tests/continuity-acp-probe.test.ts \
  tests/continuity-archive.test.ts \
  tests/continuity-rotation.test.ts \
  tests/continuity-handoff.test.ts \
  tests/continuity-provider.test.ts \
  tests/state-reliability.test.ts \
  tests/state-boundary-regressions.test.ts \
  tests/artifacts-state.test.ts \
  tests/storage-failure.test.ts
pnpm run guidance:check
pnpm run lint:dead
```

Keep `fileParallelism: false`; do not run independent Vitest commands concurrently against shared fixtures. A source test that spawns a sandbox worker requires a current `dist/runtime/sandbox-worker-entry.js`.

### Build / suite safety

`pnpm run build` removes generated `dist/` (including `dist/kiro-agent-closure`). Immediately before running it, verify the exact existing output tree is generated, task-authorized and repository-free. The helper is one check, not permission to delete arbitrary directories:

```sh
node --input-type=module -e 'import { fixtureCleanupDecision } from "./tests/fixture-cleanup.mjs"; const d=fixtureCleanupDecision("dist"); console.log(d); if(!d.remove) process.exit(1);'
```

If inspection refuses, preserve the tree and report the blocker; do not bypass the check. Audit the cleanup paths of any added test/build helper as well.

Because P2 changes shared persistence, complete the serial integration suite after focused tests pass and cleanup safety is established. `pnpm run check` is the repository's full gate and is mandatory before any separately requested commit; it is not permission to commit. Use the trusted Node preflight in `AGENTS.md` for installer-dependent suites, do not weaken permissions, and do not interpret retained repository fixtures or prerequisite failures as defects in the patch. If the full gate cannot safely run, report the exact skipped gate; do not certify the whole project.

After the last source/guidance change, finish with a fresh `pnpm run build` and direct built-library probes against `dist/index.js` using private, task-owned fixtures:

- Strict ACP synthetic peer accepts corrected frames, rejects malformed ones and reports bounded failures truthfully.
- Invalid archive payload/kind-conflict preserves earlier head/revision; valid append/reopen works.
- Journal abort/next-epoch and interrupted-submission reconciliation work, with no automatic replay.
- Handoff coverage and packet budgets match the maintained tests; guest direct/dynamic facade still works.
- `node scripts/continuity-acp-probe.mjs --help` remains no-session/no-inference. Its fake-CLI tests verify read-only invocations. A real preflight query is optional, not live qualification.

Do not rerun the historical bug-demonstration script as the final success gate. Do not run authenticated Kiro inference, change native compaction settings, or claim a synthetic test proves actual v3 behavior.

## 6. Definition of done / final implementer report

- [ ] R1–R9 each have a source fix and a negative/edge regression with an observed old-behavior failure and corrected result.
- [ ] ACP errors, deadline exits and cleanup uncertainty cannot manufacture positive capability evidence or cause replay.
- [ ] State publication/durability/acknowledgement phases are distinct; consumers retain accurate committed-effect reporting.
- [ ] Existing valid state/archive data remains readable; journal v1 compatibility and v2 abort behavior are tested without rewriting history on read.
- [ ] Source/workspace/permission protections and archive/journal quotas are unchanged or deliberately tightened, never weakened to pass tests.
- [ ] Fovea's source retention is bounded independently of aggregate tree size, with real platform coverage distinguished from skipped/contract tests.
- [ ] Public declarations/exports/registrations and documentation agree; no automatic managed-rotation mode was introduced.
- [ ] Targeted tests, required wider persistence integration, typecheck, generated guidance check, dead-code check, fresh build and built behavioral probes have current recorded results or explicit blockers.
- [ ] No native settings changed, no live inference ran, no repository was deleted, no unrelated edits were discarded, and no commit/push occurred without the applicable authorization.

Report: changed paths; finding IDs closed; exact commands and results including skips; built-probe evidence; compatibility decisions; platform/durability limitations; remaining live qualification gates. Do not reuse the previous review's test counts or mark deferred gates complete. Verify each finding against the running tree before reporting it; record corrections and retractions, never drop them silently.

## 7. Implementation record

Implemented against this plan in one session. Fail-before evidence: the rewritten probe suite recorded **19 failed / 4 passed** against the pre-fix probe, including the reproduced unhandled rejection (`probe timed out waiting for a response to session/prompt`) and a real-process liveness child that hung to Node exit 13. P2–P6 regressions encode behavior the pre-fix modules demonstrably lacked: no directory barrier at all, Buffer admission that poisoned the hash chain on read-back, no abort transition, blanket check-sequence counting, and whole-tree buffer retention.

| Finding | Source change | Regression evidence |
| --- | --- | --- |
| R1 | `src/kiro/acp-probe-contract.ts` (new), `src/kiro/acp-capability-probe.ts`, `tests/fixtures/acp-v1-wire.json` | 23 probe tests: fixture conformance, a strict contract-enforcing peer that rejects `content` params and `deny` outcomes, normative prompt/permission/cancel shapes verified against the agentclientprotocol.com v1 pages fetched during implementation. |
| R2 | same modules | initialize error stops before `session/new`; failed or unsettled prompt writes keep `exactContinuationSubmitted` false with structured `submission` state (`write_failed`/`write_unsettled`); arbitrary RPC errors are never cancellation evidence. |
| R3 | same modules | every phase settles inside one monotonic operation deadline plus a separate bounded cleanup scope; an `unhandledRejection` listener stays empty; a real-process liveness child (esbuild bundle) exits 0 in bounded time with zero rejections. |
| R4 | `src/providers/state-provider.ts`, `tests/state-durability.test.ts` | fd-classified barrier ordering (temporary fsync before rename, root-directory fsync after it, nothing after); directory-sync failure preserves published bytes and reports `durability: "unconfirmed"`; pre-rename failures keep the prior revision authoritative; post-barrier acknowledgement failures report `"confirmed"`; construction establishes the root's directory entry; `directoryBarrier` capability exposed. |
| R5 | `src/continuity/conversation-archive.ts` | one bounded plain-JSON admission routine (rejection matrix for Buffer/Date/Map/Set/custom prototypes/accessors/`toJSON`/cycles, node-budget traversal bound, `__proto__` own-key preservation, numeric-key and lone-surrogate round trips); the v1 hash domain and key order are preserved for plain JSON payloads. |
| R6 | same module | a retry that changes the kind or the payload bytes conflicts even at a stale revision; exact all-duplicate retries stay idempotent with the original revision. |
| R7 | `src/continuity/rotation-journal.ts`, `tests/continuity-rotation.test.ts` | host-only `abort` with observed-revision/epoch guards; `preparing`/`created` → `aborted` with old-session currency and never-reuse tombstones; `submitting`/`blocked`/terminal records refuse; journal schema v2 with an explicit v1 reader, upgraded only through a successful CAS mutation; per-phase invariant table; normalized record parsing. |
| R8 | `src/fovea/source-access.ts`, `tests/fovea/source-retention.test.ts` | streaming capture stages each admitted file before the next is read (asserted by a platform hook mid-walk); warm reuse writes no second copy; unchanged files reassemble from the pinned previous snapshot with expected-hash verification; mid-capture loss or tampering fails closed with a fresh retry path; a 40 MiB admitted tree grows RSS by well under half (generous diagnostic threshold, no exact GC assertions). |
| R9 | `src/continuity/handoff.ts`, `tests/continuity-handoff.test.ts` | `shownRecords` counts exactly the represented sequences (latest check per id; superseded and budget-omitted records stay admitted but unshown); determinism, budgets, pinning and the refusal behavior are unchanged. |

### Verification recorded (R1–R9 baseline)

- `pnpm run typecheck` — clean over src, tests and scripts.
- Focused suites: ACP probe 23, state durability 8, archive 24, rotation 14, handoff 17, retention 9 — all green; 21-file integration sweep **275 passed / 7 platform-gated skips**, including `tests/mcp-process-lifecycle.test.ts` cross-process publication.
- `guidance:check`, `lint:dead` (knip), `git diff --check` — clean; ten quota constants made module-private; fresh `pnpm run build` and direct `dist/index.js` probes: **BUILT PROBE OK** — strict ACP contract peer, arbitrary-error non-evidence with unconfirmed cleanup, archive replay/kind-conflict/Buffer rejection with head preservation, journal abort → next epoch from the old session, interrupted submission refusing abort until reconciliation, handoff coverage 4 admitted / 3 shown, deterministic packet hashes. `node scripts/continuity-acp-probe.mjs --help` stays read-only.
- Docs updated: `docs/continuity-handoff-plan.md` status, `docs/configuration.md` durability and coverage semantics, this record.

### Post-implementation rounds (eleven audit/fix cycles)

Every round ended with the same gate baseline — typecheck, the affected suites, knip, `git diff --check`, fresh `pnpm run build`, `BUILT PROBE OK` — so only the changes and decisions are recorded here.

| # | Round | Changes | Decisions / evidence |
| --- | --- | --- | --- |
| 1 | First audit fixes | `assertDurablePublication()` gates `begin`/`beginSubmission`/`abort`; `RECORD_FIELD_CHECKS` field-attributed validation; Linux parity suite for the real adapter; state docs fail-closed wording; `ProbeRequestBook` extraction, `settleBounded` to module scope | one audit claim retracted (coverage limits already existed); 278/12 sweep; contour clone findings gone |
| 2 | Second audit validation | CI-contract recording for the parity tests; gate-principle journal docstring; `tests/state-fault-helpers.ts` + shared rotation tamper helpers | two sub-claims corrected (vitest glob includes the file; gate-asymmetry nuance refined) |
| 3 | M3 short-term | shared `#commitSetValue` + host-only `setSerialized`; archive/journal/store on the fast path; journal `status()` clone dropped | 15-file sweep 207/0; WAL stays the sanctioned project |
| 4 | Performance | code-unit comparators for every identity feed — proven empirically (identical trees, different `LC_ALL` → different snapshot ids); `isGeneratedSourceBytes`; precomputed anchor keys | measured 6.7× decode / 3.4× sort; rule-pack-digest sub-claim corrected |
| 5 | State-provider line audit | set precedence restored (CAS before bounds); list limits validated 1..1000; the store's last `localeCompare` removed | HEAD-verified precedence, regression-locked |
| 6 | Closure | `#reclaimStaleLock` aggregates body + cleanup errors; compact document write | dual-failure regression; 32% measured disk inflation |
| 7 | Extract layer | dead `SIG_RULES` initializers; no-op assignment; walk-regex hoist; plain-loop dedupe | 1.3× (honest Low); two suspicions disproven (pre-seeded source reads; dual-path ward filter) |
| 8 | Integration audit | `envInt` contract honesty (deliberately inert) | `repo.augment` verified reachable before claiming |
| 9 | Kernel + locale | `continuity/validation.ts` kernel; last four fovea-core sorts → code-unit, including eviction selection | all exports multi-consumer; probe hoist and facade deferred with rationale |
| 10 | Installer UX | `--verbose` streaming; pnpm pin from `packageManager`; wrapper `--help`; captured-output order | 108/108; failure-path logging reverted — the evidence tree must stay untouched |
| 11 | TUI front-end | `scripts/install-tui.mjs`, presentation-only delegation to `install.sh --source` | three self-caught defects fixed (spawnSync misuse, signal-exit-0, TS cast); read-only probe end-to-end |
| 12 | Weak-spot scope-out | `src/fovea/core/astgrep.ts` demotion probe + `tests/fovea/outline-structured.test.ts`; `docs/state-wal-design.md`; `docs/live-qualification-protocol.md` | review finding premise refuted by real-binary probe (`items: []` is never empty stdout); conservative demotion kept with regression pins; WAL and live-qualification specs delivered for their sanctioned projects |

**Precision incidents, all corrected in place:** one retracted finding (round 1), one overstated claim (round 5) and one wrong sub-claim (round 4), each caught under user-prompted verification; a garbled banner shipped in the round-11 deliverable, caught by the user's question, rebuilt from the canonical ANSI-Shadow forms and verified letter-by-letter; one false tool reference in a code comment was fixed. **Review discipline going forward: verify each finding against the running tree before reporting it; record corrections and retractions, never drop them silently.**

### Remaining gates

- Live qualification of v3 engine/agent selection, permission denial and terminal cancellation against an installed Kiro build remains pending and unchanged: `qualified: false`, `managedRotationAvailable: false`, and native suppression evidence stays `unknown`.
- The platform-specific source adapter suites (`tests/fovea/source-platform.test.ts`, `tests/fovea/source-platform-bounds.test.ts`, `tests/fovea/source-platform-native.test.ts`) run only on their supported hosts; the portable fake-platform suite covers the retention logic cross-platform, and CI Linux runs the real adapter suites.
- A future live ACP transport must enforce its raw byte cap on the wire before JSON parsing (documented in `src/kiro/acp-probe-contract.ts`).
- Directory durability follows the macOS/Linux fsync contract; Windows reports `directoryBarrier: "unconfirmed"` and crash-safe publishers must refuse to claim durability there. Power-loss durability was not physically tested; the barrier ordering is verified by fd-classified fault injection, not by a crash experiment.

## 8. Copy/paste assignment (historical, completed)

> Implement `docs/continuity-remediation-plan.md` against this working tree. Read `AGENTS.md` and preserve all existing edits/untracked source additions. Start with P0, then follow the dependencies and acceptance ledger for P1–P7; add regressions for the desired fixed behavior before production fixes. The old `.tmp/review-continuity-20260921.mjs` asserts buggy behavior and is not a post-fix success test. Keep native compaction unchanged and managed rotation unavailable. No live inference, installation/settings changes, repository deletion, unauthorized commit, or push. Finish with the required safe fresh build, targeted and shared-state integration checks, and direct built-artifact probes; report evidence and any remaining gates rather than claiming blanket certification.
