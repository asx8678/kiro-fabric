# Configuration

The Agent reads only `$KIRO_HOME/kiro-fabric/data/fabric/config/config.json`; configured MCP federation is in sibling `mcp.json`. Files must be current-user-owned, private, non-symlink, single-link regular files within size bounds. Unknown fields, ambient imports, unsafe stdio/OAuth options, changed identities, and malformed configuration fail closed.

`KIRO_FABRIC_RUNTIME_ROOT` and `KIRO_FABRIC_DATA_ROOT` are installer-owned launch values. `KIRO_FABRIC_DEBUG=1|0` controls tracing. Do not inject reserved `KIRO_FABRIC_*` variables from untrusted launch contexts.
