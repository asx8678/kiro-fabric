---
inclusion: fileMatch
fileMatchPattern:
  - "skills/**/*"
  - "plugin.json"
  - "mcp.json"
  - "scripts/*power*.mjs"
---

# Power architecture invariants

Apply when editing the shipped Power skills or their references.

- The Power is **additive**: it never installs or selects a custom Kiro agent
  and never sets `includePowers: false` (that is Strict mode).
- Power v1 mounts no `agents.*` and no `k.*`; the MCP process cannot call
  back into outer Kiro native tools. Skills must direct subagents and native
  operations outside Fabric — never probe, cast, or work around.
- Work is synchronous and session-bounded. Never claim detached actors,
  durability, or completion across Power deactivation; a cancelled or
  indeterminate effect is a failure, never a success.
- Approvals use standards-compliant MCP elicitation, approve-once,
  fail-closed: decline, dismiss, timeout, malformed, or unsupported client
  all deny. Skills must say "omit the operation", never "retry".
- Runtime requires Node.js 24+ on Kiro's inherited PATH; doctor command is
  `kiro-fabric doctor power --json` (read-only, non-billable).
- Mutable state lives only under `${PLUGIN_DATA}/fabric` (mode 0700,
  identity-manifest bound). Package assets are immutable.
- Never put credentials, paths, env values, or session IDs in skill examples,
  elicitation, logs, or results.
- Skill frontmatter requires `name` and `description`; use only
  specification-supported optional fields. The description is the router
  trigger — write activation conditions ("use when …"), not a table of
  contents. Advanced contracts belong in `references/*.md`, not the body.
