# Security

Report vulnerabilities privately to the repository maintainers.

The checked guest has no operating-system authority, timer API, or direct network path. Source is strictly type-checked in a bounded compiler worker and executes only in QuickJS. Provider calls are schema-validated, quota-bounded, cancellation-aware, and approval-gated before invocation. Configured network calls require network approval; configured stdio servers require a separate execute approval before process start.

Workspace persistence is canonical-filesystem-identity-bound, private, atomically replaced, and cross-process mutation-serialized. Ambiguous roots, absent elicitation support, changed workspace identity, malformed or over-budget persistence, non-private configuration, package aliases, unknown export destinations, stale release evidence, and unsupported artifact-root entries fail closed.

The release package contains no session wrapper, custom-agent selector, extension-host adapter, or generic MCP discovery surface. Ordinary build, test, certification, packaging, and release commands are guarded against `$KIRO_HOME` mutation.
