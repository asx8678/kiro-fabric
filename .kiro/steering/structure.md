---
inclusion: auto
name: fabric-repository-structure
description: Repository ownership map for Kiro Fabric runtime, provider, Power packaging, managed-profile, or release changes. Include when locating code, assigning ownership, or tracing a change across layers.
---

# Repository structure

- `src/kernel/` owns the public `fabric_exec` input contract.
- `src/runtime/` owns compilation, guest declarations, execution, limits, and
  cancellation.
- `src/providers/` owns mounted provider behavior and action descriptors.
- `src/kiro/` owns Kiro profiles, installation, MCP projection, Power
  integration, and workspace binding.
- `skills/` is the portable additive Power surface.
- `strict/skills/` is the managed custom-agent surface; never copy its `k.*` or
  `agents.*` assumptions into the additive Power.
- `tests/` should verify the narrowest owning boundary and any affected
  cross-boundary projection.
- `dist/` and `.tmp/kiro-fabric-power/` are generated artifacts.
- `pnpm run power:dev` also installs `$KIRO_HOME/powers/kiro-fabric`
  (default `~/.kiro/powers/kiro-fabric`).
