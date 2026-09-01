---
inclusion: fileMatch
fileMatchPattern:
  - "src/kernel/**/*.ts"
  - "src/runtime/**/*.ts"
  - "src/providers/**/*.ts"
  - "src/kiro/**/*.ts"
  - "tests/**/*.test.ts"
  - "skills/**/SKILL.md"
  - "strict/skills/**/SKILL.md"
  - "plugin.json"
  - "mcp.json"
---

# Fabric contract patterns

- Change the canonical input schema before changing adapters, prompts, or
  documentation.
- Keep guest declarations, runtime validation, provider descriptors, and
  model-facing guidance synchronized.
- Treat capabilities as mode-sensitive: additive Power mode has no `k.*` or
  `agents.*`; managed mode may expose them only when configured.
- Never advertise a namespace that the effective runtime does not mount.
- Use direct provider calls when the contract is known. Discover and describe
  only when uncertainty remains.
- Parallelize only independent effects and preserve expected per-item failures
  as data.
- Denial, timeout, cancellation, deactivation, missing capability, and
  indeterminate effects fail closed.
- Keep model-facing results bounded; use opaque artifact identifiers for
  overflow.
- For Power packaging, keep manifest versions synchronized, use only
  schema-supported fields, and keep skills as immediate `skills/*/SKILL.md`
  children.
