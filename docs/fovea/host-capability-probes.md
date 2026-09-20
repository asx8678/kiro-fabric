# Native-client capability qualification

Status: **not qualified**. The harness now attempts actual native lifecycle
commands, not only help. **No H01–H12 pass is claimed.** Missing harness
instrumentation is `untested`, not an external host limitation.

## Current native evidence (2026-09-20)

The installed **kiro-cli 2.22.0**, in a new Linux private HOME, KIRO_HOME, XDG
directories and workspace, produced:

| Actual command | Observed result |
| --- | --- |
| `kiro-cli --version`, `--help`, `chat --help`, `agent --help` | Exit 0; version 2.22.0. |
| `kiro-cli whoami --format json` | Exit 1; `{"account":null}`. No identity details retained. |
| `kiro-cli chat --v3 --output-format stream-json '<harmless prompt>'` | Exit 1; `Failed to open browser for authentication.` and `error: Failed to open URL`. **Zero native JSON events.** |
| `kiro-cli chat --v3 --list-sessions --format json` | Exit 1; the same authentication-bootstrap failure, not an empty session list. |
| Resume and two concurrent same-workspace chats | Executable branches exist; **not attempted** because initial chat failed before JSON events. |

The harmless prompt is exactly:

> Reply only FOVEA_PROBE_READY. Do not use tools, read files, run commands, or change anything.

The machine-readable evidence is [native-probe-report.json](native-probe-report.json).
The report's command exit codes, diagnostics, byte counts, event counts and scope
cleanup are observations; the harness's own exit 0 means it emitted a report,
**not qualification**. [qualification.json](qualification.json) consolidates this report with
component/build evidence; headless and native-TUI qualification remain separate.

An exploratory isolated chat first exposed the launcher's automatic browser-auth
bootstrap. No login command was run and browser opening failed. Native mode now
uses a curated executable PATH and failing browser openers, plus no display/DBus
session environment, to prevent handing this bootstrap to an existing browser.
The final guarded run still reaches that precise prerequisite failure. This
proves **authentication is unavailable in this isolated scope**, not that the
user's live installation is unauthenticated or that Kiro cannot implement Fovea.

No credentials were read, copied, symlinked or forwarded. No live-home command,
login, activation, installer, trust/approval flag or policy override was used.
Observed `chat --help` exposes no credential-free read-only live-session handoff;
`acp --help` describes `--auth-method cli` as resolving tokens from the CLI
credential store. No safe authenticated handoff was established under the
no-credential-access/no-live-home-change constraints. We did not test hypothetical
RPCs, undocumented environment switches, or new authentication to get past this.

## Executable harness and safety boundaries

```sh
node scripts/fovea-capability-probe.mjs --dry-run --native
node scripts/fovea-capability-probe.mjs                 # help prerequisites only
node scripts/fovea-capability-probe.mjs --native        # actual isolated attempts
# Capture the sanitized report explicitly; stdout is JSON only:
node scripts/fovea-capability-probe.mjs --native > /private/native-probe-report.json
pnpm exec vitest run tests/fovea/capability.test.ts
```

Only `--native`, `--dry-run`, and standalone help are accepted. No existing home,
workspace, executable override, auth input or report import is accepted. Symlink
aliases and `--allow-live` are rejected. Native mode is currently Linux-only;
other platforms are `untested`, not declared host-incompatible.

Every invocation creates its own mode-0700 tree. Native mode resolves only
`kiro-cli` and `kiro-cli-chat` executable paths from absolute PATH entries into
that tree; it does not inspect their configuration. All home/XDG/temp paths and
cwd point into the tree. No inherited credential, proxy, NODE_OPTIONS,
BUN_OPTIONS, shell initialization, display, DBus, SSH agent, or Fabric
authorization environment is forwarded. Browser commands are failing private
stubs, and PATH contains no general shell tools. **This is environment/cwd
isolation, not an OS filesystem or network sandbox**; prompts request no tools,
stdin is closed, and no effect exercise or approval is supplied. Additional
runtime helpers absent from this curated PATH must be reported as prerequisites,
not silently restored from the live environment.

Per process: **15 seconds**, **256 KiB combined stdout/stderr**, and at most
**256 retained JSON envelope summaries**. Unterminated lines share the byte cap.
The owned process group is killed on timeout/output limit/completion; the harness
awaits leader close, with a separate **1-second cleanup bound**. Unconfirmed
cleanup stops dependent work and retains the private tree rather than deleting
under a possibly surviving process. Normal completion removes the scope and
reports `scopeRemoved: true`. There is no claim of OS-level containment of a
process that escapes its group. At most ten commands run (the final pair is
concurrent); no retries or unbounded model loops.

### Installed semantics and event capture

Only the semantics observed in installed 2.22.0 help are used:

- Options follow `chat`; `--v3` selects the next-generation engine.
- `--output-format stream-json` implies noninteractive mode and emits the run's
  ACP events as self-describing JSON Lines on stdout.
- `--resume` selects the most recent conversation **from the same directory**.
  `--resume-id` is advertised but not used: no authoritative ID was observed.
- `--list-sessions --format json` requests local session listing. Its real
  authentication failure is retained, not replaced with a guessed schema.

After successful initial chat with JSON output, the harness attempts documented
resume, then two simultaneous fresh chats in the same disposable workspace. This
exercises native commands but does **not** prove same-session MCP persistence,
concurrent routing, or restoration. Success/JSON presence only enables the next
harmless exercise. No synthetic identity or independent-prompt shortcut passes a
gate.

Only stdout JSON envelope **field types** for a fixed key allowlist, sequence and
unknown-field counts are retained. Values, nested payloads, session/account IDs,
model text, arbitrary keys, URLs and unknown error text are discarded. Only exact
allowlisted observed stderr diagnostics survive. Stderr JSON is not an event.
Envelopes are explicitly `semantics: uninterpreted`; a generic JSON object is not
an authoritative lifecycle assertion. **There were no actual native event
payloads to adapt in this run.** Typed session/MCP/hook/model-input adapters still
require observed, documented post-authentication events. No RPC is invented.

### Status interpretation and remaining acceptance ledger

- `untested`: not attempted, unsupported by this harness version, or lacking
  sufficient semantic evidence. Missing adapters are harness work, not host blocks.
- `environment-blocked`: an executed prerequisite failed (auth, spawn, bounds or
  cleanup). Only implemented dependent lifecycle gates inherit the initial chat
  blocker; skipped commands remain untested and name their dependency.
- `host-blocked`: would require a real native rejection of the capability in a
  valid environment. **No new native host-blocked result was established.**
- `observed` on a probe means command exit 0 without limit/cleanup failure, not
  an H-gate pass. An unknown nonzero exit is `failed`, not guessed to be auth.

| Gate | Current headless status | Exact remaining evidence/work |
| --- | --- | --- |
| H01 | Environment-blocked: `chat-new` / isolated auth unavailable | Resumed turns with independently observed session and MCP instance identities. |
| H02 | Environment-blocked: same prerequisite | Concurrent distinct session/host mapping and actual ambiguous-routing rejection. |
| H03 | Untested | Instrument engine readiness, authorized-root binding and first-hook ordering. |
| H04 | Untested | Observe prompt marker in actual intended model input, not hook stdout/model prose. |
| H05 | Untested | Real success/error tool result preservation and next-step marker delivery. |
| H06 | Untested | Stop marker actually causing documented bounded continuation. |
| H07 | Untested | Native cancellation plus queued-user-input precedence; process timeout is not this test. |
| H08 | Environment-blocked: new/resume prerequisite | Verify new/resume identity; implement clear/compact/profile-swap signal/recovery exercises. |
| H09 | Untested | Visible/model-only/disabled and status/settings/reset/reload per surface. |
| H10 | Untested | Authorized native-TUI accept/decline/revoke exercises with exact effects. |
| H11 | Untested | Authoritative complete model-visible tool inventory, including client-injected tools. |
| H12 | Untested | Generation update while a session remains active; generation-matched old hooks/engine. |

Native-TUI and direct ACP remain separately **untested**; headless authentication
failure is not transplanted into their results. Historical elicitation/picker
findings in the [dated readiness report](../coding-readiness-2026-09-09.md) are not
new results. No Fovea profile/MCP fixture is installed by these baseline probes,
so even a successful baseline chat would leave host/hook correlation untested.

The status-only `src/kiro/fovea-hook.ts` remains outside this task. Its own
`host-blocked` / `native-session-rendezvous-unavailable` status is **not native
client capability evidence**. The exported harmless marker constructor remains
unit-test data; markers, fake executable tests and injected runners cannot grant
qualification. Hook/session dispatch must not be guessed from cwd.

Full build, suite and installer qualification are coordinated by main serially;
this harness task runs only its targeted capability tests and direct probes.

## Pinned reference oracle

```sh
node scripts/fovea-reference-harness.mjs \
  --reference ../pi-fovea --host-reference ../pi-fabric \
  --parser /absolute/path/to/ast-grep-0.45.3 \
  --fixture tests/fixtures/mini --query main --budget 512
```

`git archive` materializes exact pinned commit objects into a fresh private tree,
regardless of checkout HEAD. Source checkouts are never modified/reset. The
pi-fabric object is independently checked; its absence does not prevent the
pi-fovea oracle from running. Optional `--install-dev` runs only
`bun install --frozen-lockfile --ignore-scripts` in the isolated reference tree.
No Pi runtime package enters production dependencies. Fixture selection is
restricted to the pinned reference's fixture directory; symlink fixtures fail.
All reference test/fixture paths and SHA-256 digests are inventoried (including
inline-language/protocol fixture test sources); inventory is NOT execution.

The oracle executes sketch/focus/dwell/impact on the same isolated fixture, and
retains the exact supported language map. Only the scratch-root prefix is
normalized. The comparator preserves keys, warnings, file/edge ordering and
selected files. Absolute tolerance **1e-12** and relative tolerance **1e-10** are
predeclared; expectations must never be updated to match the port. Temporal or
history-dependent differences remain failures, not silently normalized values.
The initial run was blocked by PATH parser 0.45.2. A subsequent run explicitly
selected packaging's `.tmp/fovea-parser/ast-grep`, verified actual **0.45.3**, and
successfully executed the pinned oracle (mini fixture, query `GetUser`, budget
512). `Date.now()` is frozen at **1700000000000** before importing the engine;
plain copied fixtures have no Git history. The initially absent required
pi-fabric object was subsequently fetched from the public repository into a new
private development-only bare Git store using an empty HOME, disabled global Git
configuration and credential helpers, no terminal prompts, and a 60-second
bound. No sibling checkout was modified. The fresh harness invocation selected
that store with `--host-reference` and reported **no prerequisite blockers**:
Fovea `executed`, Pi Fabric `archived-not-executed`. Evidence summary:
`.tmp/fovea-owner-reference.json`. Missing-object status is historical; full Pi
Fabric lifecycle execution/trace comparison remains unrun verification work.

The initial same-input comparison exposed eight rendering/spill-label differences.
The engine owner fixed dependency injection rather than normalizing away output:
the direct core receives the reference artifact-label policy; production uses
private retained-result handles. Strict original/native-core comparison now
**passes at budgets 512 and 16000**, without changing expectations, deleting
fields or widening tolerances. This proves that fixture's complete operation
outputs, not every language/history/lifecycle behavior or native UI parity.

Targeted tests:

```sh
pnpm exec vitest run tests/fovea/reference.test.ts tests/fovea/capability.test.ts
# Actual native-core comparison when the pinned checkout/private parser exist:
pnpm exec vitest run tests/fovea/reference-differential.test.ts
# Enable actual pinned output validation only after a successful oracle run:
FOVEA_REFERENCE_REPORT=/private/reference-report.json pnpm exec vitest run tests/fovea/reference.test.ts
```

Full build, suite and installer qualification are coordinated by main serially.
