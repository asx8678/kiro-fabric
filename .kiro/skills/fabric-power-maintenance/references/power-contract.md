# Additive Power contract

- Power never installs or selects a custom Kiro agent and never sets
  `includePowers: false`; that belongs to optional Strict mode.
- Power mounts neither `k.*` nor `agents.*` and cannot call back into Kiro
  native tools. Native operations and subagents stay outside Fabric.
- Work is synchronous and session-bounded. Deactivation, timeout,
  cancellation, or an indeterminate effect is failure, not completion.
- MCP elicitation is approve-once and fail-closed. Decline, dismiss, timeout,
  malformed input, and unsupported clients deny the operation; do not retry a
  denied effect through another path.
- Node.js 24+ comes from Kiro's inherited PATH. The read-only, non-billable
  diagnostic is `kiro-fabric doctor power --json`.
- Mutable data is confined to `${PLUGIN_DATA}/fabric`; package assets are
  immutable. Never expose secrets or machine-specific paths in examples or
  model-facing diagnostics.
