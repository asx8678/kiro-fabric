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
node dist/cli/main.js run --format json <<'TS'
const files = await fabric.fs.glob({ pattern: "src/**/*.ts" });
return { count: files.length };
TS
```

Commands: `run`, `check`, `exec`, `docs`, `models`, `doctor`, and `install-kiro`. `run` reads one body once, typechecks it, and executes those exact bytes; `check` and `exec` remain compatible. Programs are TypeScript function bodies with top-level `await` and `return`; arbitrary imports are forbidden.

Canonical workflows use the approved IDs `fabric-guide`, `fabric-workflow`, `fabric-council`, `fabric-fusion`, `fabric-context-decompose`, `evidence-ledger`, `evidence-change`, and `spec-audit` in packaged `prompts/*.md`. List them with compact docs and print exact fallback bytes with `fabric-lite docs prompt:<id>` (for example `prompt:fabric-workflow`). Installation copies them to workspace `.kiro/prompts/`; use is progressive and the runtime never depends on Kiro `@` expansion. The `planner`, `worker`, and `verifier` prompts are optional progressive templates: role-specific programs opt into their text explicitly; setting an AI call's role does not load them. Generated `.kiro/agents` are rendered snapshots. The installer manifest supports deterministic drift reporting through `doctor`. No `.kiro/system.md` or auto-loaded rule behavior is assumed. Kiro 2.16 does not expose tested machine-readable resolved-model metadata for chat, so production attribution is honestly `unknown` and conditional fusion remains unverified. See `types/fabric-lite.d.ts`, `examples/`, [Kiro setup](docs/KIRO_SETUP.md), and [security](docs/SECURITY.md).

Seeded deterministic audit, comparison, diagnosis, patch-policy, and verification cases are described in [E2E scenarios](docs/E2E_SCENARIOS.md). Real authenticated Kiro smoke calls are never part of the deterministic suite. Opt in with `pnpm test:smoke` after installing the generated agents.