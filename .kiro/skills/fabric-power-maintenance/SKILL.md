---
name: fabric-power-maintenance
description: >-
  Use when changing Kiro Fabric Power skills, manifests, package validation,
  the Power closure, Power API guidance, or Power-specific tests. Do not use
  for managed Strict skills or unrelated runtime implementation.
---

# Fabric Power maintenance

Preserve the product boundary: the additive Kiro Power is the public default;
it never installs or selects the managed Strict custom agent. Keep
`fabric-orchestration` as the bounded workflow selector and `fabric-exec` as
the exact checked-TypeScript authoring/repair skill. Avoid broad triggers,
overlap, or a required preflight before every warm-session execution.

Read only the reference needed for the change:

- Packaging, approvals, state, and lifecycle: `references/power-contract.md`.
- Schemas, namespaces, examples, and validation: `references/api-contract.md`.

After a change, run the focused Power/skill tests and `pnpm run power:validate`.
Never edit generated closures directly; rebuild them from source.
