# Kiro setup

## One-command setup

```bash
pnpm run setup:kiro
# or: pnpm setup:kiro
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

The installer stages and validates v2 JSON profiles, installs global profiles in `~/.kiro/agents/` plus rendered snapshot copies in `.kiro/agents/`, copies canonical bytes to workspace `.kiro/prompts/`, writes a deterministic prompt manifest, and creates `.fabric-lite/config.json`. `doctor` reports prompt drift. The source-only pnpm workspace policy is installed only for Fabric Lite itself, not unrelated targets. No system/rule file is installed because auto-loading has not been established. Existing files are refused. `--force` first renames every conflict to a timestamped backup. The parent profile uses the absolute built CLI path and shell remains interactive (`allowedTools: []`); it never enables `--trust-all-tools`. Local commits require project config `git.allowCommit: true` plus commit approval through `fabric.git.commit({ message, paths })`; no push API is exposed. Generic shell stays disabled by default and is exposed only with real human approval or an explicit allowlist; destructive commands are denied. A single-agent permission model (read allow; commit/execute/network ask; destructive deny) fails closed headlessly. An interactive Allow session grant covers every later request in that permission category until the process exits, rather than only the displayed action. PostgreSQL, Redis, SQLite, Kubernetes, and Terraform inspection uses dedicated `fabric.inspect.*` methods with fixed read-only constraints; mutation commands remain unavailable without a separate explicit policy and user approval. The worker has no tools, resources, delegation, or MCP inheritance.

Launch with the exact command printed by the installer, normally `kiro-cli --agent fabric-lite`. The selected agent is always-on: every request goes through one checked Fabric Lite program using one quoted `fabric-lite run` heredoc. `run` reads and typechecks the body once, then executes those exact bytes. Each run is persisted under `.fabric-lite/runs/<run-id>/` (including `program.ts`, metadata, diagnostics, and the final envelope); the directory is Git-ignored, not ephemeral, and may contain source-sensitive material. Workspace prompts are progressive discoverability only. Approved workflow IDs are `fabric-guide`, `fabric-workflow`, `fabric-council`, `fabric-fusion`, `fabric-context-decompose`, `evidence-ledger`, `evidence-change`, and `spec-audit`; invoke exact fallback content with `fabric-lite docs prompt:<id>` and never make Kiro `@` expansion a runtime dependency. The optional `planner`, `worker`, and `verifier` templates are used only when a role-specific program explicitly includes their text; AI role selection does not load them automatically. Restart Kiro after reinstalling so a running session does not retain the previous agent prompt. Kiro CLI 2.16.0 reports the chat prompt as the positional `[INPUT]` argument (`kiro-cli chat --help`); it exposes no stdin prompt option. Fabric Lite therefore keeps the framed prompt in argv and does not claim stdin prompt support. Paid semantic diagnosis is opt-in: `fabric-lite doctor --smoke`.
