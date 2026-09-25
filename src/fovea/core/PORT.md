# Native core port ledger

Source: read-only `pi-fovea@b594483868d27b7eb37a9b185c59ce812f8a9c01` (MIT).
License: `UPSTREAM-LICENSE.txt` and repository `THIRD_PARTY_NOTICES.md`.

## Preserved algorithms

The original extraction language table, pattern/outline readers, Bend reader,
protocol anchors, literal joins, import resolution, graph assembly, Chebyshev
heat, conserved forward mass, basin ranking, rendering, four navigation
operations, co-change statistics, discovery hypotheses, rules, and semantic sync
algorithms are ported, not replaced with reduced approximations.

Host adaptations: AsyncLocalStorage injects per-engine caches and
per-conversation state; no Pi imports, process-global session stores, PATH
parser resolution, environment configuration, or shared temporary caches.
`CoreContext.artifactLabel` is an explicit rendering dependency: the direct
core default retains original artifact labels for exact differential testing;
production engine injects retained-result labels and returns bounded full text.
`CoreContext.displayName` and `toolName` similarly inject Navigator and `repo.*`
labels before budget fitting. Direct-core defaults preserve upstream output for
exact differential testing. Internal-only helpers are private; obsolete wrappers
(`hasAstGrep`, `listFiles`, the build-module graph alias and ops-module state/token
re-exports) were removed after tracing native callers. Their active async/parser,
discovery, graph, state and rendering implementations remain unchanged. The
uncalled `coverageSummary` formatter was also removed; active coverage reporting
(`coverageDetails` / `extractionSuffix`) remains intact.

### Dead-code analysis boundary

Knip follows production engine imports rather than treating every core module as
an independent entrypoint. Six explicit reference seams remain: `heat.ts`
(numerical oracle), `provenance.ts` (mutation-journal reference writers),
`session.ts`, `state.ts`, `sync.ts` (direct-core lifecycle/warming controls), and
`temp-storage.ts` (preview maintenance). These preserve intentional upstream
reference interfaces, not a claim that every export has a native runtime caller.
Public package exports and dynamically registered offline cases are also retained.
Do not restore the blanket `core/*.ts` exemption to silence future findings.

## Engine contract

`FoveaEngineOptions = {parser:{path,sha256,version,generationRoot?},storageRoot,gitPath?}`.
`FoveaEngine.query(request, signal?)` and `close()` match the private host API.
Supported operations: sketch, focus, dwell, impact, status, anchors, rules,
reset, reload, sync. Anchors/rules accept offset/limit and return total counts;
rules exposes promoted hypotheses/signatures. Default focus is conversation /
physical-root owned; explicit focus IDs never resolve in another conversation.

Private host-only arguments (MUST NOT be forwarded from untrusted guest args):

- `trustedRulesSha256`: separately approved SHA-256 of `.fovea/rules.json`.
  Only that exact no-follow file enters the snapshot; absent/mismatched trust
  fails, and sibling `.fovea` content stays excluded. Engine never writes rules.
- `sync.commitPreparationId`: acknowledge a previously returned
  `syncPreparationId` after confirmed host delivery. Red sync computation returns
  `deliveryAccounting: prepared`; baseline/heat/push memory stays uncommitted.
  A newer preparation supersedes an older token. Silent non-red baselines commit
  immediately. Host authentication/delivery confirmation is not implemented here.

Source snapshots use bounded descriptor-relative enumeration/reads, reject
symlinks/hardlinks, exclude unsupported/dependency/secret paths before copying,
and hash the exact byte buffers copied for parsing. Generated/capped/unavailable
coverage remains explicit. Unchanged snapshots preserve mirror, graph, and
vectors. Same-stat edits are detected by bytes, not timestamps. Suggested reads
carry extracted SHA-256, omit approximate locations, split at 2000 lines, and
report deferred tails. Raw cached facts are never an authorization source.

## Historical acceptance evidence (2026-09-20)

These are the original port checkpoint results, not current full-product or
native-client qualification. See `docs/fovea/completion-ledger.md` for subsequent
verification and `docs/fovea/control-lifecycle-plan.md` for the scoped follow-up.

- `pnpm exec tsc --noEmit`: passed.
- Targeted seven-file run: **36 passed**, no skips (private parser 0.45.3).
- `tests/fovea/core-{heat,conserved-heat,basins}.test.ts`: original recurrence,
  Taylor reference, mass conservation, stationary/analytic star, basin tests.
- `tests/fovea/engine.test.ts`: hashes, invalid UTF-8, links, same-stat edits,
  cap reporting, engine/conversation isolation, navigation, sync, cancellation.
- `tests/fovea/engine-review.test.ts`: A-B-A physical reuse/default dwell,
  hardlinks/unsupported files, hypotheses/paging, parser-time source mutation,
  active parser kill/reap, sanitized Git, independent rule trust, explicit sync
  preparation/acknowledgment, transport bounds.
- `tests/fovea/engine-languages.test.ts`: embedded pinned ecosystem/protocol
  corpus through the production engine; Go/TS/Python/Rust/Java/Ruby/Elixir/Kotlin
  routes and exact member positions, GraphQL/protobuf anchors.
- `tests/fovea/reference-differential.test.ts`: strict pinned comparison at
  512 and 16000 tokens passed without changing reference assertions.

## Explicit boundaries / remaining qualification

- Descriptor-relative source access supports Linux and managed Darwin. The
  unbound `sourcePlatform()` factory is Linux-only; the engine admits Darwin
  through `native-source-loader.ts` with a generation-verified ABI-1 binding.
  Missing or mismatched bindings fail closed. See `docs/fovea/platform-source.md`.
- Shallow history whose metadata is outside the authorized root (e.g. some
  linked-worktree/subroot layouts) degrades explicitly with Git coverage; it is
  not treated as complete history. In-scope shallow ledgers use bounded no-follow
  metadata reads rather than reading the private source mirror's absent `.git`.
- Core provenance algorithms are connected to the host mutation-transition
  journal and scope-safe snapshot hashes. Fabric-observed transitions can carry
  host-session attribution; uninstrumented changes remain unattributed. This
  does not establish native Kiro chat identity or cross-resume association.
- The host has private delivery acknowledgment plumbing for qualified embedders,
  but native Kiro intended-turn delivery remains unqualified and automatic
  integration stays disabled. Computing, returning, or preparing context is not
  delivery acknowledgment.
- Build, full-suite, packaging and native-client claims have separate scopes.
  The historical core checkpoint above does not certify the current release.
