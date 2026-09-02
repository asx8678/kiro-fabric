# Kiro Fabric

Kiro Fabric is a single Kiro Power for bounded, checked TypeScript composition. Kiro native tools remain responsible for ordinary file reading, editing, shell commands, web access, and subagents.

## Build and stage

```sh
pnpm install
pnpm run power:stage
```

The deterministic checkout-local import source is `.tmp/kiro-fabric-power`. Import that folder and enable **Kiro Fabric** through Kiro's supported Power import flow. Copying or exporting a folder does **not** register or enable a Power.

After the one-time import and enable step, start sessions with the only supported session command:

```sh
kiro-cli --v3
```

## Tools

The Power exposes exactly three top-level MCP tools:

- `fabric_info` — bounded health, limits, provider availability, and workspace status;
- `fabric_workspace` — canonical workspace discovery, selection, attachment, and detachment;
- `fabric_exec` — checked QuickJS composition over bounded providers.

`fabric_exec` is the only Fabric execution interface: every invocation requires a strictly checked TypeScript function body and runs in QuickJS, with no text/action/manual fallback. It has no host filesystem, shell, environment, dynamic import, built-in module, timer, or unrestricted network access. Its mounted providers are artifacts, Power-scoped memory, workspace-bound state, and explicitly configured MCP federation. Use `payloads?: Record<string, string>` for named string input.

## Optional local export source

```sh
pnpm run power:export:user
```

On Linux, this explicit command creates a private immutable, digest-named generation beneath `$KIRO_HOME/powers`; it refuses in-place replacement. The command prints the exact generated folder, which is a **local import source only**. You must still import and enable that folder through Kiro's supported Power flow. User export is intentionally unsupported on macOS and Windows until equivalent reparse-point and crash-safety guarantees are tested.

Ordinary build, test, check, certification, packaging, CI, and release-candidate commands never write to user home or Kiro settings.

## Development

```sh
pnpm run test
pnpm run check
```

See [docs/architecture.md](docs/architecture.md), [docs/configuration.md](docs/configuration.md), [docs/release.md](docs/release.md), and [docs/audit.md](docs/audit.md).
