# Upstream native Kiro issue drafts

**Unpublished; no issue or PR numbers.** These issue/API drafts use the
2026-09-21 Darwin arm64 / Kiro CLI **2.22.1** observations, not the earlier Linux
2.21.1/2.22.0 results. Existing authorized authentication was used; no credentials,
private conversation logs or ordinary user configuration are attached. Every
probe creates an owned scratch profile and uses native CLI/TUI commands only.
See [native acceptance](fovea/native-acceptance-2026-09-21.md) for scope and retained
local evidence. Automatic Fovea remains disabled.

## 1. Native form elicitation has no UI handler

**Title:** CLI 2.22.1 advertises MCP form elicitation but native TUI cannot handle it.

Reproduce from this checkout after `pnpm run build`, with an already authenticated
client: `node scripts/fovea-approval-probe.mjs --authenticated`.
The probe uses actual built Fabric, a harmless `fixture.txt`, and explicit
write/execute/network `ask` policies. It does not automatically approve anything.

Expected: render the exact edit review and return the human's accept/decline/cancel
response; stop advertising unsupported forms if no handler exists.
Actual: native form request ID **1** receives matching error details
`No handler registered for method: _kiro/mcp/elicitation`. Fabric receives cancellation
and withholds the edit. Native TUI exits 0; fixture unchanged. This is **not** human
decline, accepted edit/shell evidence, or a completed workspace revocation test.
Fixture SHA256 before/after:
`73cc836b87afeb7110eedea254489a0559cfa4a98c06fabb6aa4a46848d27cf9`.

Local report `.tmp/fovea-approval-wYMWdU/report.json`, SHA256
`8953920a613a57a58bd8099a6c14e58285a67f58e48062b45159f300b8bd7bfa`.
Native recording SHA256
`5ff18024b96da917710586d6ca87906c7d9591d650fd372711e004341d74e156`;
raw recording remains private. Regression: `tests/fovea/native-approval.test.ts`.
After a client fix, use `--interactive` from a human terminal and verify exact
accepted/declined effects independently. Do not use blanket allow or native tools
as an approval bypass.

### Fresh follow-up

A new real-Fabric native TUI run again observed a matched missing-handler reply:
`.tmp/fovea-followup-approval.log` and `.tmp/fovea-approval-Lbb82d/report.json`.
One native form request/response, actual Fabric invocation, unchanged exact fixture;
no human accept/decline was observed. Diagnostic exit 0 is not an approval pass.
The six-case human runner is now available as `pnpm run qualify:fovea:human` after
a client fix. It never supplies form responses and refuses non-human terminals.

## 2. Acknowledged cancellation leaves the previous prompt hook running

**Title:** UserPromptSubmit hook survives native cancellation and the queued turn.

Reproduce: `node scripts/fovea-lifecycle-probe.mjs --authenticated --tui-cancel`.
This is a harmless delayed hook/MCP fixture, **not** Fabric engine cancellation.
Native UI input switches to Queue mode, submits a queued prompt, then requests
cancellation using Escape. The recorder correlates request IDs and actual replies.

Expected: cancel the old turn's hook work and preserve queued-user precedence.
Actual: prompt ID **3** returned `stopReason: cancelled` at **1789972066056**;
`_kiro/hooks/cancel` was observed. The queued prompt was accepted **6 ms** later
and completed. The original hook nevertheless finished **5,517 ms** after the
acknowledgment, after that queued turn, without an instrumented termination signal.
The harness exits 0. Sending Escape alone is not the evidence: the matched native
cancellation reply and fresh queued hook are required.

Local report `.tmp/fovea-lifecycle-FddnQz/report.json`, SHA256
`8bba004516ca0a4e1e9f436fd7ef1e9f56f7def75c710407fadc6fa11d6354f7`.
Native recording SHA256
`91391e62b05e578cf22380e09da5b5ec85af3f1a9c6647f8c91dd4a5a8d2fe77`.
Regression: `tests/fovea/native-lifecycle.test.ts`. Request supported lifecycle
wiring and an end-to-end cancellation test; no private cancellation RPC is invoked
by the harness. This does not claim that every native cancellation path fails.

## 3. Supported native session/request association is unavailable to MCP

**Title:** Document/provide a session+epoch+request association shared by hooks and MCP.

Reproduce: `node scripts/fovea-native-probe.mjs --authenticated --tui`, followed by
`node scripts/fovea-lifecycle-probe.mjs --authenticated` for fresh resumed calls.
The fixture logs only structural initialize/call metadata and harmless nonces.
Hooks contain `session_id`; observed MCP calls contain only `name` and `arguments`,
with no corresponding `_meta`. Initialize identifies a generic `kiro 0.0.0` client.
A resumed chat ID does not establish MCP association or restoration.

Expected: a documented native session identity, epoch and request/turn association
that the host can authenticate, including concurrent chats, resume/clear/profile
swaps, ambiguity rejection and cancellation. Also document intended-turn model
input acknowledgment; writing hook stdout is not proof of delivery.
Actual: no such supported association was observed. Cwd, process ancestry, model
arguments and process counts are not substitutes. This is a protocol/API request,
not a claim that concurrent-session pooling was proved.
Evidence: `.tmp/fovea-native-VEArYZ/report.json` and the source/evidence discussion in
[host capability probes](fovea/host-capability-probes.md). Production remains
`native-session-rendezvous-unavailable`; no guessed routing is enabled.

### Fresh routing and state follow-up

`.tmp/fovea-followup-routing.log` / `.tmp/fovea-native-4upKSf/report.json`
reobserved real native hooks carrying `session_id`, while all three MCP fixture
calls carried only `name` and `arguments` with `meta:null`. All hook kinds and a
continuation call were observed; intended model-input delivery was **not**.
This is protocol-fixture evidence, not Fabric automatic integration.

Actual Fabric also demonstrated prior-focus retention after native `/clear` in
[the previous closeout](fovea/native-controls-closeout.md). The current lifecycle
probe now emits an explicit isolation failure and exit 3 for a completed run that
retains the prior chat's exact focus ID. Missing evidence never counts as a pass.
This proves a sequential cross-chat state boundary gap in the tested path, not
concurrent pooling or cross-workspace access. Required native routing/isolation
semantics remain the expected contract above; no filesystem rendezvous, cwd
heuristic or guest-supplied session ID is an acceptable repair.

## 4. An authoritative complete model-visible tool inventory is needed

**Title:** Expose and enforce the final model tool inventory, including client-injected tools.

Reproduce the real-Fabric approval diagnostic above and inspect `/tools` through
the native UI. Compare the configured single-tool profile, picker rows and recorded
calls; none of those individually enumerates the final model request's entire
schema inventory. Request a supported machine-readable final inventory API or
privacy-safe model-request evidence, including client-injected tools.

Expected: exact `@fabric/fabric_exec` filtering with authoritative complete evidence.
Current 2.22.1 observations: only `@fabric/fabric_exec` was invoked in these probes;
completeness remains unproven. Do **not** infer hidden tools exist or are absent from
this subset. Historical Linux 2.21.1/2.22.0 evidence did observe `disclose_context`
while `/tools` showed one Fabric row; retain that dated finding rather than relabel
it as a fresh 2.22.1 failure. See [historical coding readiness](coding-readiness-2026-09-09.md).

## Filing and closure

### Reporting preflight (2026-09-21)

The plan is valid with a distinction: the missing form handler is an observed
client failure; native session association is a request for a supported API or
lifecycle guarantee, not a base-MCP protocol violation. Neither requires rewriting
Fovea navigation or weakening approvals.

- Official destination: [kirodotdev/Kiro](https://github.com/kirodotdev/Kiro/issues).
- The official stable manifest currently reports **2.22.1**, matching the tested
  client: <https://prod.download.cli.kiro.dev/stable/latest/manifest.json>.
  The installer and manifest were read only; no client update was performed.
- Targeted open/closed issue searches found related scopes, not an exact duplicate:
  [#4580](https://github.com/kirodotdev/Kiro/issues/4580) (general elicitation, later
  closed with an invitation to report current versions),
  [#11385](https://github.com/kirodotdev/Kiro/issues/11385) (IDE Power-bundled MCP),
  and [#9140](https://github.com/kirodotdev/Kiro/issues/9140) (HTTP transport session
  headers, not shared native chat ownership). Recheck immediately before filing.
- **Publication blocked:** `gh api user --jq .login` exits **4** and requests
  `gh auth login`. No issue was submitted and no issue number is invented.
- The checkout repository returns 404 to the unauthenticated public API. That does
  not prove its visibility; public report bodies therefore do not depend on its
  source links. Repository visibility was not changed.

Reviewed, sanitized issue bodies (not raw evidence attachments):

1. [CLI form-handler bug report](fovea/upstream-approval-report.md)
2. [Native session-binding API request](fovea/upstream-session-report.md)

The reduced reproduction recipes are explicitly distinguished from the actually
executed integration probes. They contain no private recording, absolute local
path, native conversation ID, credential, or assumed-public checkout link.

After the owner authenticates `gh`, recheck duplicates and review these bodies:

```sh
gh issue create --repo kirodotdev/Kiro \
  --title 'CLI 2.22.1 (--v3): advertised MCP form elicitation has no native handler' \
  --body-file docs/fovea/upstream-approval-report.md
gh issue create --repo kirodotdev/Kiro \
  --title 'CLI v3: document or expose native chat ownership to hooks and MCP' \
  --body-file docs/fovea/upstream-session-report.md
```

Record the real returned issue URLs here after successful publication. Do not
upload this local evidence index or raw transcripts as a substitute for those
sanitized bodies. No policy override or installation is part of reporting.

After a supported client fix, rerun the human matrix and actual `/clear` lifecycle
probe described in [native follow-up](fovea/native-followup.md), then qualify
remaining automatic-integration gates. Close gates only with the exact native
client version's positive and negative behavioral evidence—not unit mocks,
model prose, ACP substitute clients, or help.
