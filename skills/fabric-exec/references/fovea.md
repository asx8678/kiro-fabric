# Native repository intelligence (`repo.*`)

Fovea is advisory navigation, not source evidence, a correctness check, approval,
or proof of completeness. `repo.status()` is cheap and does not index. It reports
analysis availability separately from unqualified native lifecycle/delivery.
The component uses the generation's private ast-grep, never PATH/npm/downloads.

```ts
const map = await repo.focus({ query: "createKiroRuntime", maxTokens: 700 });
const windows = map.reads.slice(0, 4);
const sources = windows.length
  ? await local.readMany({ windows, maxChars: 14000, partial: true })
  : null;
return { navigation: map.text, sources, deferredReads: map.reads.slice(4) };
```

`repo.focusRead` performs that composition through the same registry, read
approvals, quotas, and cancellation. No empty read batch; partial failures,
remaining windows and unread tails stay in `sources`. A stale SHA-256 requires
refreshing/re-resolving the graph location, never dropping the expected hash.
Edits use the actual read's hash, not a graph generation or heat score.

- `sketch`: production-first silhouette and explicit extraction coverage.
- `focus`: symbols, approximate identifiers, paths, routes, literals/protocol IDs;
  path/language/kind filters; `fresh:true` reproduces a full focus view.
- `dwell`: wider semantic neighborhood of a focus, not a result page.
- `impact`: files/symbols/uncommitted/PR base. Co-change is a decaying suggestion,
  not a structural dependency or required edit list.
- `result` / `searchResult`: replay/page/literal-search a retained immutable JSON
  packet. Cursors replay without advancing navigation and expire with authority,
  lifetime, or engine incarnation. No cache paths are exposed.
- `anchors` / `rules`: inspect feature/rule evidence. Adoption requires its own
  approved trust mutation: first publish `.fovea/rules.json` with normal `local.write`, then pass its actual local-read SHA-256 to `repo.adoptRules({expectedSha256})`. Trust is conversation-epoch, exact-worktree and exact-content scoped; inspection does not trust project rules. New/cleared conversations do not inherit another conversation's adoption.
- `settings` / `configure`: separate strict `fovea.v1.json`; session/project/global
  settings and exact-worktree project overrides, optimistic revisions, ordinary write approval.
- `reset`: conversation/root navigation; `reload`: same-generation config/engine
  restart. Update + a new session is required to adopt new code.

Hybrid grep leaves `local.grep` unchanged:

```ts
return await repo.grep({pattern:"makeReport", path:"src", literal:true, limit:20});
```

Its `native` field preserves exact local matches, scope, truncation and existing
single-use local cursors. `advisory` is separate graph evidence. Off disables
hints; augment adds transient hints; replace only replaces eligible bare queries
and falls back on no-match/backend failure. Only `repo.result` cursors replay.

Project settings are explicitly approved private overrides, not automatically
loaded workspace files. Precedence is session > project > global > defaults.
Session overlays belong to one host-validated conversation epoch and follow its
workspace rebinding; they never cross into another conversation. Project/global
profiles remain explicitly shared persistent settings. Retained controls are
bounded to 128 conversation epochs and 32 adopted worktrees per epoch; capacity
errors require a new host, never silent eviction of live settings or approvals.

```ts
const settings = await repo.settings();
const config = settings.config;
config.tools.grepMode = "off";
return await repo.configure({scope:"project", expectedRevision:settings.revisions.project, config});
```

Use `settings.revision` for session updates and `settings.revisions.global` for
global updates. Existing disabled preferences are preserved during installation.
Scope-safe source capture currently requires Linux; downloaded macOS parser pins
do not imply working macOS analysis. Use `repo.status` for capability diagnostics.

Text-only: `return (await repo.focus({query:"symbol"})).text;`. This intentionally
discards structured source windows; it does not acknowledge model disclosure.
After compaction use retained results or deliberate `fresh:true`. Returning a
packet is not proof the model read it. Source-derived text remains untrusted.

Analysis is scoped to the verified workspace. Absolute paths/session IDs never
authorize extra roots. Independent launches have private navigation/results,
but their source files and existing Fabric durable storage remain shared.

A bounded host-owned post-execution collector is implemented, but managed
profiles do not activate it before native-client qualification. When a trusted
embedder explicitly qualifies visible delivery, it can append a separate
untrusted advisory without replacing your returned value, errors, or recovery
metadata. Emission is not model acknowledgment. Repeated sync retains stable
notice identities; failed or cancelled delivery remains replayable.

Native prompt/turn routing, hidden delivery, restoration and automatic
continuations require separately qualified client capabilities. Current status
must not be read as native-TUI parity; no private Kiro RPC or idle restart is
invented. Minimal mode does not gain automatic hooks or steering.
