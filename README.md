# Kiro Fabric

A Kiro CLI v3 Power for bounded, checked TypeScript composition. `fabric_exec` is the only execution interface — strictly type-checked and run in QuickJS with no fallback; Kiro native tools keep ownership of files, shell, web, and subagents.

## Prerequisites

- Node.js ≥ 24
- pnpm 11.20.0 (`corepack prepare pnpm@11.20.0 --activate`)
- Linux or macOS for checkout-local Power staging
- Kiro CLI v3

## Quickstart

```sh
pnpm install
pnpm run power:stage   # builds and stages .tmp/kiro-fabric-power
```

Import `.tmp/kiro-fabric-power` through Kiro's supported Power import flow and enable **Kiro Fabric**. Copying or exporting the folder does not register a Power. Then start sessions with the only supported command:

```sh
kiro-cli --v3
```

## Tools

| Tool | Purpose |
| --- | --- |
| `fabric_info` | Bounded health, limits, provider availability, workspace status |
| `fabric_workspace` | Discover, select, attach, or detach the canonical workspace |
| `fabric_exec` | Checked TypeScript composition over bounded providers |

`fabric_exec` requires a TypeScript function body in `code`, checks it in an isolated compiler worker, and runs it in QuickJS. The guest has no filesystem, shell, environment, import, timer, or unrestricted network access. Mounted providers: `artifacts`, `memory`, `state`, and explicitly configured `mcp` federation. Use `payloads?: Record<string, string>` for named string input. Write, execute, and network calls require approval and fail closed when elicitation is unavailable.

## Configuration

Optional file: `${PLUGIN_DATA}/fabric/config/config.json`. Absent means secure defaults; if present it must be a private, current-user, non-symlink regular file ≤ 256 KiB. Unknown sections or fields are rejected.

| Section | Keys |
| --- | --- |
| `executor` | `timeoutMs`, `maxTimeoutMs`, `memoryLimitBytes`, source/input/output/nested-result bounds, provider/approval/audit quotas, `resultFormat` |
| `approvals` | `read` / `write` / `execute` / `network`, each `allow` \| `ask` \| `deny` |
| `mcp` | `enabled`, `disableOAuth`, `callTimeoutMs` |
| `memory` | `enabled`, `maxEntries`, `maxValueChars` |
| `state` | `enabled`, `maxEntries`, `maxValueChars`, `maxTotalChars` |
| `artifacts` | `maxArtifacts`, `maxArtifactChars`, `maxTotalChars`, `ttlMs` |
| `tracing` | `enabled` |

Federated MCP servers are declared in `${PLUGIN_DATA}/fabric/config/mcp.json`. See [docs/configuration.md](docs/configuration.md).

## Tracing

Optional execution tracing writes bounded JSONL spans (`init` / `eval` / `bridge` / `teardown`, microsecond monotonic timestamps, QuickJS heap snapshots) to `${PLUGIN_DATA}/fabric/traces/`. Enable with `KIRO_FABRIC_DEBUG=1` (overrides config) or `"tracing": { "enabled": true }`. Disabled means one boolean branch per hook and no allocations. See [docs/tracing.md](docs/tracing.md).

## Execution flow

```text
MCP schema → TypeScript compiler worker → QuickJS → ActionRegistry → provider
```

One path, no textual, action-name, or manual fallback. The effective guest deadline is `min(maxTimeoutMs, max(executor default, action floor, invocation timeout))`; cancellation interrupts QuickJS, propagates to providers, and drains active leases before runtime replacement or shutdown.

## Development

```sh
pnpm run test        # build + full suite
pnpm run check       # typecheck, build, tests, dead-code lint, certify, SBOM
pnpm run audit:deps  # live moderate-or-higher dependency advisory gate
```

See [docs/architecture.md](docs/architecture.md), [docs/configuration.md](docs/configuration.md), [docs/tracing.md](docs/tracing.md), [docs/release.md](docs/release.md), and [docs/audit.md](docs/audit.md).
