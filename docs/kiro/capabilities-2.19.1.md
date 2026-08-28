# Kiro CLI 2.19.1 Capability Matrix

> Historical v2 evidence. `scripts/spike-kiro.mjs` now targets 2.20.1/v3, so
> reproducing this matrix requires the corresponding historical revision.

All rows are reproducible via `scripts/spike-kiro.mjs` unless marked otherwise.
The harness pins `KIRO_EXPECT_VERSION=2.19.1` and fails on any other version.

## Verified — non-billable harness probes

| Capability | Evidence | Status |
|---|---|---|
| Version pinning | Harness fails unless `kiro-cli --version` reports exactly 2.19.1 (override: `KIRO_EXPECT_VERSION`) | Verified |
| `kiro-cli acp` handshake | `node scripts/spike-kiro.mjs handshake` — `initialize` returns `agentCapabilities` with `promptCapabilities.image: true`, `mcpCapabilities.http: true`, `loadSession: true`, empty `sessionCapabilities` | Verified |
| `session/new` | Returns `sessionId`, current model, current mode (`kiro_default`) | Verified |
| Profile validation | `node scripts/spike-kiro.mjs profile` — valid profile accepted; negative control confirms invalid profiles produce diagnostics (validator exit code alone is unreliable) | Verified |
| MCP server in profile | `node scripts/spike-kiro.mjs mcp` — workspace agent with embedded stdio server receives `initialize` → `notifications/initialized` → `tools/list`; server log asserted, not exit code | Verified |

## Billable gate results — executed against real Kiro 2.19.1

Each probe ran with `KIRO_PHASE0_BILLABLE=1`, model `claude-haiku-4.5`,
engine v2. Evidence strings are emitted verbatim by the harness.

| Capability | Probe | Result | Evidence / session |
|---|---|---|---|
| Active ACP cancellation (pending permission → `session/cancel` → cancelled outcome) | `acp-cancel` | **Pass** | "permission-gated turn cancelled; MCP fixture never received tools/call; prompt ended cancelled" — session `28371eed-ab48-4a52-b315-2fec0ca2e4a5` |
| Exactly one model-visible tool (behavioral; ACP cannot introspect the provider payload) | `one-tool` | **Pass (behavioral-only)** | "fixture advertised 2 tools, exactly 1 (visible_probe) invoked under adversarial prompt" — session `437be5ee-2191-4301-9c18-97ea963fc488` |
| Technical child-tool denial (`reject_once` → no `tools/call`, no sentinel) | `child-deny` | **Pass** | "reject_once honored: zero tools/call, no sentinel, no leak; prompt settled cleanly" — session `c5922468-9a31-4944-9d24-67287866b984` |
| Long-running MCP request lifetime (beyond 120s default) | `long-request` | **Pass** | "single tools/call survived 125002ms (>120s default) with requestTimeout=155000" — session `0c030579-8ac0-478d-b700-16edaec296ff`; profile `requestTimeout` is honored |
| MCP cancellation propagation (`notifications/cancelled` with matching request ID) | `mcp-cancel` | **Fail (deterministic, 2 runs)** | Fixture received `tools/call`; ACP `session/cancel` was sent; no `notifications/cancelled` reached the server within 10s. Kiro 2.19.1 does not propagate turn cancellation to in-flight MCP requests. |
| MCP elicitation accept/decline via ACP `elicitation/create` | `mcp-elicit` | **Fail (non-billable preflight)** | "Kiro did not advertise MCP form elicitation to the server (protocolVersion=2025-11-25); promptSent=false". The fixture's MCP `initialize` observed empty client capabilities; no prompt was sent. |

### Fail-closed decisions forced by these results

- **MCP cancellation propagation: absent.** `fabric_exec` on Kiro must treat
  cancellation as host-side only: kill the whole ACP process group, discard
  late frames, and report the run stopped/indeterminate. Mutating, shell,
  nested, and long-running executions that require mid-flight MCP abort must
  be rejected or bounded by hard timeout.
- **MCP elicitation: absent.** Any action requiring approval must be denied
  with an explicit diagnostic. Never auto-allow, never use `--trust-all-tools`
  for managed runs; approvals are impossible over this tuple.

Both failures are harness-reproducible: re-run the probe commands above.

## Known limitations (observed on 2.19.1)

- `session/set_model` is not advertised in `sessionCapabilities`; a request
  timed out in ad-hoc probing. Use `--model` at process start.
- `includePowers` is silently accepted by the validator like any unknown field;
  do not rely on it until its effect is proven.
- No documented shutdown hook for 2.19.1; use session leases/heartbeats.
- `tools` controls model-visible selection; `allowedTools` controls permission
  prompts; `permissions.rules` is v3-only and unused on this tuple.

## Defaults

- Always pass `--agent-engine v2` (recorded in diagnostics).
- Initial model selection via `--model`; runtime switching unsupported.
