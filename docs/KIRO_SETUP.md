# Kiro setup

## Interactive installer (recommended)

```bash
pnpm run setup
```

Launches a keyboard-navigable, box-drawn setup tool that detects the current state and adapts its options:

- **Nothing installed** → **Install** (choose *Workspace* or *Read-only* write mode)
- **Partially installed** → **Repair** (completes missing components)
- **Fully installed** → **Update** (rebuild + reinstall agents) and **Delete**
- **Delete** requires a two-step confirmation: first `Are you absolutely sure? [y/N]`, then typing the exact word **`yes`**
- **Pull latest** checks `origin` for newer commits, shows a banner, and pulls + rebuilds

Flags:

```bash
# Install read-only without prompting
pnpm run setup -- --allow-write read

# Target a different directory
pnpm run setup -- --cwd /path/to/project

# Skip install/update confirmations (delete still asks)
pnpm run setup -- --yes
```

After a successful **install** (or repair), the app shows a **"✓ App installed successfully"** screen with a single **Quit** option. After an **update**, the installer auto-closes once the update finishes (**"Update finished — closing installer..."**), so you are dropped back to the shell ready to run `kiro-cli --agent fabric-lite`.

## Legacy headless setup

```bash
pnpm run setup:kiro
```

This installs locked dependencies, builds Fabric Lite, installs and validates both Kiro agents, creates project configuration, and runs `doctor`. Preview with `pnpm run setup:kiro --dry-run`; use `--force` only when replacing existing generated files (backups are created first).

## Manual setup

Build and inspect the installation before applying it:

```bash
pnpm build
node dist/cli/main.js install-kiro --dry-run --format json
node dist/cli/main.js install-kiro --format json
node dist/cli/main.js doctor --format json
```

A fresh install is editable by default and creates `.fabric-lite/config.json` with `mutation.enabled=true` and `filesystem.allowWrite=["**"]`. Parent traversal, sensitive denied paths, and symlink escapes remain blocked. For a read-only fresh install, pass `--allow-write read` (place it after `--` with pnpm: `pnpm run setup:kiro -- --allow-write read`); this creates `mutation.enabled=false` and `filesystem.allowWrite=[]`.

The installer stages and validates v2 JSON profiles, installs global profiles in `~/.kiro/agents/` plus rendered snapshot copies in `.kiro/agents/`, copies canonical bytes to workspace `.kiro/prompts/`, writes a deterministic prompt manifest, and creates `.fabric-lite/config.json`. `doctor` reports prompt drift. The source-only pnpm workspace policy is installed only for Fabric Lite itself, not unrelated targets. No system/rule file is installed because auto-loading has not been established. Existing agents/prompts are refused; `--force` first renames every such conflict to a timestamped backup. `.fabric-lite/config.json` is user-owned policy and is treated differently: it is created only when missing (honoring the current `--allow-write` choice) and is never overwritten or backed up, even with `--force`, so your write-access decision survives reinstalls. To change the policy of an existing project, use `update-policy` with an explicit `--allow-write read|workspace` (see below). The parent profile uses the absolute built CLI path and shell remains interactive (`allowedTools: []`); it never enables `--trust-all-tools`. Local commits require project config `git.allowCommit: true` plus commit approval through `fabric.git.commit({ message, paths })`; no push API is exposed. Generic shell stays disabled by default and is exposed only with real human approval or an explicit allowlist; destructive commands are denied. A single-agent permission model (read allow; commit/execute/network ask; destructive deny) fails closed headlessly. An interactive Allow session grant covers every later request in that permission category until the process exits, rather than only the displayed action. PostgreSQL, Redis, SQLite, Kubernetes, and Terraform inspection uses dedicated `fabric.inspect.*` methods with fixed read-only constraints; mutation commands remain unavailable without a separate explicit policy and user approval. The worker has no tools, resources, delegation, or MCP inheritance.

Launch with the exact command printed by the installer, normally `kiro-cli --agent fabric-lite`. The selected agent is always-on: every request goes through one checked Fabric Lite program using one quoted `fabric-lite run` heredoc. `run` reads and typechecks the body once, then executes those exact bytes. Each run is persisted under `.fabric-lite/runs/<run-id>/` (including `program.ts`, metadata, diagnostics, and the final envelope); the directory is Git-ignored, not ephemeral, and may contain source-sensitive material. Workspace prompts are progressive discoverability only. Approved workflow IDs are `fabric-guide`, `fabric-workflow`, `fabric-council`, `fabric-fusion`, `fabric-context-decompose`, `evidence-ledger`, `evidence-change`, and `spec-audit`; invoke exact fallback content with `fabric-lite docs prompt:<id>` and never make Kiro `@` expansion a runtime dependency. The optional `planner`, `worker`, and `verifier` templates are used only when a role-specific program explicitly includes their text; AI role selection does not load them automatically. Restart Kiro after reinstalling so a running session does not retain the previous agent prompt. Kiro CLI 2.16.0 reports the chat prompt as the positional `[INPUT]` argument (`kiro-cli chat --help`); it exposes no stdin prompt option. Fabric Lite therefore keeps the framed prompt in argv and does not claim stdin prompt support. Paid semantic diagnosis is opt-in: `fabric-lite doctor --smoke`.

## update-policy

`update-policy` explicitly migrates an existing `.fabric-lite/config.json` between workspace-editable and read-only mutation policy. It differs from `install-kiro`, which only applies its `--allow-write` choice when creating a config. It validates the existing config (rejecting an invalid or missing file before touching anything), rewrites only `filesystem.allowWrite` and the mutation fields needed for the requested mode (preserving budgets, runner, permissions, shell, cache, and all unrelated settings), and writes the result atomically (temp file + rename).

An explicit `--allow-write` destination is required:

```bash
# Make an existing read-only project editable across the workspace
node dist/cli/main.js update-policy --cwd /path/to/project --allow-write workspace
# Make an existing editable project read-only
node dist/cli/main.js update-policy --cwd /path/to/project --allow-write read
# Preview without writing
node dist/cli/main.js update-policy --cwd /path/to/project --allow-write workspace --dry-run
```

Workspace mode sets `filesystem.allowWrite=["**"]`, `mutation.enabled=true`, and `mutation.require="checkpoint"` for checkpoint safety. Read mode sets `filesystem.allowWrite=[]` and `mutation.enabled=false`, retaining your `mutation.require` and `mutation.maxDiffChars` settings. `--dry-run` validates and previews the change without writing. Normal reinstall and `--force` continues to preserve an existing config byte-for-byte; only an explicit `update-policy` rewrites it.
