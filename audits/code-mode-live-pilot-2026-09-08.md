# Budget-safe V3 Code Mode live pilot — 2026-09-08

## Follow-up: headless readiness fixed

The subsequent code investigation isolated and fixed the headless availability failure. The original pilot findings below remain historical evidence, not the current headless verdict.

- Metadata-only stdio capture showed successful MCP initialization and a `tools/list` response containing `fabric_exec`; the response took approximately 1 ms after the request. Kiro advertised no roots capability. Thus slow workspace synchronization was not the cause and the Fabric MCP server was not changed.
- Read-only inspection of installed KAS 0.58.7 showed asynchronous profile-server connection via `startMcpUpdate`, with prompt construction awaiting only servers whose configuration has `waitForReady`. The generated profile omitted that field.
- Explicit `--trust-tools=@fabric/fabric_exec` did not fix the failure. Setting only `mcpServers.fabric.waitForReady: true` in a disposable profile did: an actual first-prompt headless tool call returned `42`.
- Production fix: `scripts/agent-profile.mjs` now generates `waitForReady: true`. Exact model-visible selectors, outer permission rules, inner approval policy and request deadlines are unchanged. No sleeps or native-tool fallback were added.
- Regression checks initially failed in four assertions. After the fix, all 84 targeted profile/install tests passed; the rebuilt full suite passed **894 tests**, with **45 skipped** across 68 files. Typecheck and `git diff --check` passed.
- Upgrade regression verifies a hash-verified older profile without readiness can be upgraded, while an unrecorded profile modification is still rejected. Both legacy-style and complete-generation installs assert readiness.
- The installed agent was refreshed through `bash ./install.sh --source --yes --non-interactive --json`, activating generation `944750594b95db4e8b35d3a1fe080478bb502ff6eca81b95b7719539d3b1ddb1`. The installer reported data preserved and restart required; doctor subsequently reported healthy.
- **Post-install headless verification passed:** a fresh `kiro-cli chat --v3 --agent kiro-fabric --no-interactive --require-mcp-startup --output-format stream-json` session, with Haiku 4.5 and explicit fixture workspace handoff, made exactly one Fabric call and returned all eight exact first lines. No warm-up, sleep, retry or extra trust flag was used. A deterministic validator checked the actual completed tool output, final answer, absence of failed tool events and unchanged installed permissions.
- Four small diagnostic/verification turns for this fix reported **0.0657060041127695 credits** in aggregate. This is Kiro-reported turn usage, not settled account billing.

Evidence under `/tmp/kiro-fabric-live-pilot/evidence/`: `wire-headless.jsonl`, metadata-only `wire-<pid>.jsonl`, `headless-explicit-trust.jsonl`, `headless-ready.jsonl`, `readiness-red.log`, `readiness-green.log`, `readiness-full.log`, `readiness-types.log`, `readiness-install.json`, `readiness-installed-read.jsonl`, and `readiness-validation.json`. The final fresh build is recorded in `readiness-final-build.log`.

## Original pilot verdict

**Interactive Code Mode executes real coding work, but this pilot does not pass overall.** Headless tool availability failed, natural-language API usage was unreliable, and one apparently successful checked execution returned a semantically wrong answer. No speed/token/credit savings claim is supported.

No production source, installed profile, approval configuration, or global settings were changed by this pilot. Prompt variants are disposable workspace-local profiles. Existing user changes were preserved. The only repository addition from this phase is this report; builds regenerate dist.

## Identity and measurement boundaries

- CLI: 2.21.1; headless stderr reports KAS 0.58.7.
- Installed Fabric: 0.64.0, generation `2eb15d701aff35c335ceb7f46433aa4d5b359dc2dbd0c752a11415b373a6e650`.
- Installed profile: `kiro-fabric`; exact configured tool selector `@fabric/fabric_exec`.
- Models explicitly selected: Claude Haiku 4.5 for task/control probes, Claude Sonnet 4.5 for two discovery diagnostics.
- Disposable canonical workspace: `/private/tmp/kiro-fabric-live-pilot/fixture`.
- Launch supplied `KIRO_FABRIC_LAUNCH_WORKSPACE` and enabled private Fabric tracing. This does not qualify bare CLI behavior without a workspace handoff.
- Fixtures and validators are local/deterministic; no paid AI reviewer or native-versus-Fabric comparison was run.
- These are small single-sample diagnostics, not exact-release certification or statistical benchmarks.

## Budget evidence

User authorized up to 15 credits. Four headless sessions reported a combined **0.12141553998341625 credits** in `turn_completion.promptTurnSummaries`. Five model-bearing interactive sessions displayed 0.06, 0.01, 0.08, 0.05 and 0.08 credits respectively. Summing those observed values gives approximately **0.40 credits**, NOT an exact settled account debit.

TUI displays are rounded. The first interactive harness accidentally submitted `/usage` while the client was presenting a retry-loop question; this became additional input rather than a reliable usage command. That baseline is therefore not a clean cost comparison, and exact total billing remains unknown. The harness was subsequently changed to wait for completion, detect retry-loop questions, cancel instead of answering them, and never send `/usage`. No large unattended suite was launched. Timeouts and prompt call limits are not credit caps.

## Acceptance ledger

| Check | Evidence | Result |
| --- | --- | --- |
| Offline regression suite | Earlier phase: 68 files, 893 passed, 45 skipped | PASS for executed tests; skips unverified |
| Typecheck and build | Earlier phase passed; final fresh build required after report | See final build log |
| Installed health | `pnpm run agent:doctor` healthy | PASS offline; not proof of client operation |
| Interactive tool inventory | `/tools` rendered one row, `@fabric/fabric_exec` | PASS for observed UI inventory |
| Headless tool availability | Four sessions, including server-wide selector and qualified callable control | FAIL |
| Interactive controlled batch | Eight exact first lines, one exec, eight local reads | PASS |
| Interactive natural read baseline | Guessed fields, offset 0, retry-loop question | FAIL; later harness input confounded continuation |
| Read-only prompt guidance | Correct first lines after list-field compiler error/help recovery | Functional PASS; no-retry instruction FAIL |
| Read + list guidance | Three successful execs, but `.text[0]` returned eight `r` characters | Semantic FAIL |
| Interactive coding task | Minimal addition fix, independent four-test validation | Functional PASS; seven calls exceeded requested six |
| Installed direct MCP probes | Six cases validated independently | PASS at raw MCP boundary only |
| Compaction/resume/approval interaction | Not run in this live phase | UNVERIFIED |
| Credit savings/native comparison | No comparable baseline | UNMEASURED |

## Findings

### 1. Headless V3 tool availability is a blocker

Commands used `chat --v3 --agent kiro-fabric --no-interactive --require-mcp-startup --output-format stream-json`. The first Haiku run attempted `fabric_exec`, rejected by Kiro as unavailable. Sonnet reported no usable Fabric execution tool. A disposable profile changing only the selector to `@fabric` did not resolve the failure. A final Haiku control used the interactive callable name `mcp_fabric_fabric_exec`; Kiro explicitly rejected that name too.

All headless commands exited successfully at the process/run boundary despite the task failing or being blocked. Their Fabric traces contain startup events only, not `tool.fabric_exec` or `exec.end`. Therefore neither exit code zero nor `runFinished.status=success` is a task-success oracle, and `--require-mcp-startup` did not establish execution readiness in these observations.

The interactive UI showed the exact configured tool and successfully executed it after startup. The raw installed MCP server also executed the same API. This isolates a headless/client integration difference; the precise root cause (readiness, registration, filtering, or another lifecycle issue) was NOT established. Do not describe a startup race as proven or broaden production permissions as a workaround.

### 2. API discoverability creates avoidable model retries

Observed Haiku mistakes included treating read results as strings or using `.data`, passing offset 0, guessing list `.children`, and calling edit with `anchor`/`replacement` instead of `oldText`/`newText`.

The type checker correctly rejected invalid result fields and edit arguments. Runtime argument validation rejected offset 0. These are safety successes but task-efficiency failures. The coding task recovered from its wrong edit signature and made the correct minimal change.

A disposable read-result example eliminated the observed read-field mistake in one attempt, but the model guessed the list field and required help. Adding a list example avoided compiler errors in the next sample but did NOT ensure a correct answer: the model indexed the text string with `[0]`.

### 3. Checked TypeScript is not a semantic correctness oracle

The combined-guidance run returned `r.text[0]`. This is valid TypeScript and the backend correctly executed it. The final answer contained `r` for every record, not `record 0` through `record 7`. A success-only trace or compiler pass would miss this regression. Exact fixture answers are essential.

### 4. Prompt limits are not hard limits

The natural read baseline retried despite instructions, and the coding task used seven exec requests despite a six-call instruction. The baseline reached Kiro's three-failure loop question. A test runner must enforce stopping behavior independently and must not send slash commands into an active question/turn. Do not use prompt call limits as billing enforcement.

## Direct installed MCP checks (zero inference)

The SDK client launched the installed private runtime, not the source library. The server listed operator endpoints `fabric_info`, `fabric_workspace`, and `fabric_exec`; that raw list is not a model inventory.

1. Workspace status: bound and verified.
2. Eight parallel reads: exact ordered first lines, bounded/truncated result metadata.
3. Type error after a syntactically preceding write: rejected before any effect; marker file absent.
4. Literal search → read → unique edit → read: exact expected match and before/after content.
5. Missing file: explicit ENOENT error, not fabricated content.
6. Shell exit 7 with `settle:true`: exact nonzero code and `fixture-diagnostic` stdout retained.

Validator also confirmed all eight record files' exact final content, unchanged coding tests, the minimal `calc.py` correction, and the controlled interactive eight-line answer. Independent `/usr/bin/python3 -B test_calc.py` produced four passing tests after the agent edit; before editing there were three failures out of four tests.

## Recommended next changes, not applied

1. Investigate headless readiness/registration with a deterministic client-level regression before further headless benchmarking.
2. Add compact examples that explicitly describe `local.read().text` as a **string**, `offset:1`, `limit:1`, `.text.trimEnd()` for this fixture, `local.list().entries[].path`, and `local.edit({path,oldText,newText})`.
3. Include examples/error handling in real model regression tasks; do not accept a prompt change on one passing sample. The tested variants are not ready to promote.
4. Validate expected values/diffs/test outcomes independently; count compiler failures, recovery attempts and cancelled tasks.
5. Keep current runtime limits unchanged. No evidence justifies higher concurrency, larger budgets, or broader tool permissions.
6. Only after correctness is stable, run a small counterbalanced native/Fabric comparison with the same model and all attempts retained.

## Evidence locations

Private temporary evidence (not committed; retain locally if needed):

- `/tmp/kiro-fabric-live-pilot/evidence/validation.json`
- `smoke.jsonl`, `discovery.jsonl`, `selector.jsonl`, `headless-qualified.jsonl` and corresponding stderr files under that evidence directory.
- `tui.txt`, `interactive-read.txt`, `exact-read.txt`, `tuned-read.txt`, `tuned-api.txt`, `coding.txt` and raw terminal captures under that directory. Terminal repainting duplicates rendered text; do not count tool calls by textual occurrences.
- `raw-mcp.json`, `raw-mcp.mjs`, `validate.mjs` (scripts at the pilot root).
- Private traces: `$HOME/.kiro/kiro-fabric/data/fabric/traces`.
- Controlled eight-read trace: `fabric-24981-mtsuq27b.jsonl` — one exec, eight reads, succeeded.
- Baseline natural read: `fabric-24719-mtsunjkl.jsonl` — six execs including harness-affected help continuation; three failures.
- Read-guidance trace: `fabric-25129-mtsuqz2u.jsonl` — four execs, one compiler failure, eight completed reads.
- Read/list-guidance trace: `fabric-25415-mtsut5b8.jsonl` — three successful execs, semantically wrong final result.
- Coding trace: `fabric-25576-mtsuu9e7.jsonl` — seven execs, one compiler failure, one edit and two shell calls.
- Earlier offline logs: `/tmp/kiro-fabric-test-suite.log`, `/tmp/kiro-fabric-typecheck.log`, `/tmp/fabric-manifest.json`, `/tmp/fabric-probe.json`.
- Final build: `/tmp/kiro-fabric-live-pilot/evidence/final-build.log`.
