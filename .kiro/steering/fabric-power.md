---
inclusion: fileMatch
fileMatchPattern:
  - "skills/**/*"
  - "plugin.json"
  - "mcp.json"
  - "scripts/*power*.mjs"
---

# Power architecture invariants

Load the `fabric-power-maintenance` skill when editing the shipped additive
Power, its API guidance, manifests, validation, closure, or Power-specific
tests. The skill owns the detailed invariants; this steering file only routes
ordinary workspace sessions to it.
