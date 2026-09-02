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

The schema is the contract owner. Keep runtime validation, guest declarations,
provider descriptors, prompts, examples, and tests synchronized. Capability
views are mode-sensitive and failures remain fail-closed.

For public Power/API or package work, load `fabric-power-maintenance`. For the
installer-owned managed skill, load `strict-skill-maintenance`. Do not load
either skill for unrelated runtime implementation.
