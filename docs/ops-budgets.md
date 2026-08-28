# Operational budgets

## Current knobs and fixed limits

| Budget | Constant / setting | Where | Default | Notes |
| --- | --- | --- | ---: | --- |
| Executor wall clock | `executor.timeoutMs` | `src/config.ts` | `120_000` ms | Configurable; bounded to 1s–15m. |
| Executor memory | `executor.memoryLimitBytes` | `src/config.ts` | `64 * 1024 * 1024` | Configurable; runtime-dependent upper bound. |
| Executor source ingress | `executor.maxSourceBytes` | `src/config.ts` | `256 * 1024` bytes | UTF-8 cap enforced before type checking; configurable from 1–512 KiB. |
| Executor visible log/output | `executor.maxOutputChars` | `src/config.ts` | `50_000` chars | Also passed to runtime as `maxLogChars`. |
| Nested/tool result payload | `executor.maxNestedResultChars` | `src/config.ts` | `2_000_000` chars | Bound for nested provider/tool values. |
| Failure output clamp | `MAX_FAILURE_MODEL_OUTPUT_CHARS` | `src/output-budget.ts` | `20_000` chars | Failures are clamped below the normal output budget. |
| MCP call timeout | `mcp.callTimeoutMs` | `src/config.ts` | `120_000` ms | Configurable per MCP call. |
| MCP cache revalidation budget | `mcp.cache.revalidateBudgetMs` | `src/config.ts` | `60_000` ms | Configurable refresh budget. |
| Agent concurrency | `agents.maxConcurrent` | `src/config.ts` | `4` | Configurable; bounded to 1–32. |
| Agents per `fabric_exec` | `agents.maxPerExecution` | `src/config.ts` | `100` | Configurable; bounded to 1–1000. |
| Agent recursion depth | `agents.maxDepth` | `src/config.ts` | `2` | Configurable; `0` disables child spawning. |
| Agent wall clock | `agents.timeoutMs` | `src/config.ts` | `3_600_000` ms | Configurable; bounded to 1s–24h. |
| Agent USD budget | `agents.budgetUsd` | `src/config.ts` | `0` | Configurable; `0` disables the cap. |
| Agent token cap per child | `agents.maxTokensPerChild` | `src/config.ts` | `0` | Configurable; `0` disables the cap. |
| Worker kill grace | `KILL_GRACE_MS` | `src/worker.ts` | `5_000` ms | Fixed SIGTERM→SIGKILL grace for child workers. |
| ACP stdout frame size | `DEFAULT_MAX_FRAME_BYTES` | `src/kiro/acp-process.ts` | `4 * 1024 * 1024` bytes | Fixed per-frame NDJSON limit. |
| ACP terminate grace | `terminate(graceMs = 3_000, killMs = 2_000)` | `src/kiro/acp-process.ts` | `3_000` / `2_000` ms | Fixed shutdown budget. |
| Kiro supervisor terminate grace | `terminate(graceMs = 3_000, killMs = 2_000)` | `src/kiro/supervisor.ts` | `3_000` / `2_000` ms | Fixed shutdown budget. |
| Resident host startup | `STARTUP_TIMEOUT_MS` | `src/residency/client.ts` | `10_000` ms | Fixed wait for resident host/participant startup. |
| Kiro MCP request timeout | `KIRO_MCP_REQUEST_TIMEOUT_MS` | `src/kiro/profile.ts` | `925_000` ms | Trusted-shell verification envelope (15-minute execution plus adapter overhead); call budget, not startup. |
| Kiro resident idle cutoff | `DEFAULT_KIRO_IDLE_MS` | `src/kiro/acp-worker.ts` | `5_000` ms | Env-overridable via `KIRO_FABRIC_KIRO_IDLE_MS`. |
| Resident host idle exit | `IDLE_EXIT_MS` | `src/residency/host.ts` | `30_000` ms | Fixed idle-process lifetime cap. |
| Runtime host-call settle grace | `HOST_TASK_SETTLE_GRACE_MS` | `src/runtime/quickjs-runtime.ts`, `src/runtime/node-process-runtime.ts` | `250` ms | Fixed post-exit host-call drain grace. |
| Agent transport exit grace | `TRANSPORT_EXIT_GRACE_MS` | `src/agents/manager.ts` | `1_000` ms | Fixed transport death/settle grace. |

## Missing operator knobs

These Release-D budget classes are still **not first-class configurable knobs in `src/config.ts`**:

| Missing knob | Current state | Recommendation |
| --- | --- | --- |
| MCP startup timeout | Only fixed resident startup wait: `STARTUP_TIMEOUT_MS = 10_000` in `src/residency/client.ts`; no config surface. | Add `mcp.startupTimeoutMs`, default `60_000`. |
| Runtime close grace | Fixed internal terminate windows (`5_000` ms worker kill grace; `3_000/2_000` ms ACP/supervisor grace/kill). | Add one operator-facing close-grace knob, default `5_000`, plus optional kill escalation split. |
| Max artifact size | `src/output-budget.ts` writes full overflow output artifacts with no explicit byte cap. | Add `executor.maxArtifactBytes`, default `1 * 1024 * 1024` (or `4 * 1024 * 1024` if preserving parity with ACP frames matters more). |
| Max concurrent executions | `agents.maxConcurrent` only gates child agents; no top-level execution-session semaphore is exposed. | Add a host/runtime execution semaphore, default `4`. |
| Idle memory / process caps | Idle exits exist (`DEFAULT_KIRO_IDLE_MS`, `IDLE_EXIT_MS`), but no operator-set memory ceiling or unified idle policy knob exists. | Add explicit idle process TTL and optional RSS cap; start with `30_000` ms idle TTL and a conservative resident RSS ceiling. |
| ACP frame budget config | Frame size is fixed at `4 MiB`; not exposed in config. | Add `kiro.maxFrameBytes`, default `4 * 1024 * 1024`. |

## Pack conformance snapshot

Current package-shape constraints imply `dist/` should contain only build outputs and generated chunk files. The new pack-conformance test treats these as forbidden foreign artifact prefixes inside packed `dist/` paths:

- `src/`
- `tests/`
- `scripts/`
- `node_modules/`

This matches the current package contract:

- root `package.json` packs `dist/`, `skills/`, `docs/`, and selected top-level docs/licenses only;
- `exports`, `main`, `types`, and `bin` all resolve into `./dist/...`; and
- `scripts/assert-build-artifacts.mjs` allowlists stable `dist` entry files plus their maps/declarations and `dist/chunks/*.js(.map)`.
