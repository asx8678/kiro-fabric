# Fabric Lite

## Quick install

From this repository, install and configure Fabric Lite for Kiro in one command:

```bash
./scripts/setup-kiro.sh
# or: pnpm setup:kiro
```

Then launch it with `kiro-cli --agent fabric-lite`. When this agent is selected, every request is routed through a checked, ephemeral Fabric Lite TypeScript program. Programs are passed inline by heredoc and are not saved as files unless requested. Use `./scripts/setup-kiro.sh --dry-run` to preview or `--force` to back up and replace conflicting generated files.

Fabric Lite is a focused TypeScript orchestration runtime for Kiro CLI. A program selects repository context deterministically, performs a bounded number of one-shot Kiro reasoning calls, validates framed JSON with Ajv, and returns one compact envelope. It has no mesh, actors, recursive agents, daemon, ACP, MCP bridge, or direct provider SDK.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
node dist/cli/main.js check --format json <<'TS'
const files = await fabric.fs.glob({ pattern: "src/**/*.ts" });
return { count: files.length };
TS
node dist/cli/main.js exec --format json <<'TS'
return { chunks: fabric.util.chunk([1, 2, 3], 2) };
TS
```

Commands: `check`, `exec`, `docs`, `models`, `doctor`, and `install-kiro`. Programs are TypeScript function bodies with top-level `await` and `return`; arbitrary imports are forbidden. See `types/fabric-lite.d.ts`, `examples/`, [Kiro setup](docs/KIRO_SETUP.md), and [security](docs/SECURITY.md).

Seeded deterministic audit, comparison, diagnosis, patch-policy, and verification cases are described in [E2E scenarios](docs/E2E_SCENARIOS.md). Real authenticated Kiro smoke calls are never part of the deterministic suite. Opt in with `pnpm test:smoke` after installing the generated agents.