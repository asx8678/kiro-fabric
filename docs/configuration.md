# Configuration

The Agent reads only `$KIRO_HOME/kiro-fabric/data/fabric/config/config.json`; configured MCP federation is in sibling `mcp.json`. Files must be current-user-owned, private, non-symlink, single-link regular files within size bounds. Unknown fields, ambient imports, unsafe stdio/OAuth options, changed identities, and malformed configuration fail closed.

`KIRO_FABRIC_RUNTIME_ROOT` and `KIRO_FABRIC_DATA_ROOT` are installer-owned launch values. `KIRO_FABRIC_DEBUG=1|0` controls tracing. Do not inject reserved `KIRO_FABRIC_*` variables from untrusted launch contexts.

The generated agent profile deliberately omits `model`; `--v3` selects Kiro's V3 harness and is not a model name. The inline `mcpServers.fabric.requestTimeout` is 917000 ms: Fabric's 900000 ms maximum guest deadline plus the 10000 ms compiler allowance, 2000 ms outer cancellation grace, and a positive 5000 ms client-response margin. This keeps Kiro's client deadline strictly later than Fabric's own maximum request envelope.

By default, [Kiro custom agents inherit](https://kiro.dev/docs/custom-agents/configuration-reference/#disabling-default-resource-inheritance) default steering, skills, and `AGENTS.md`. Fabric preserves that Kiro default and its installer does not write Kiro settings. A user who wants only the resources named by custom-agent profiles can explicitly set:

```sh
kiro-cli settings chat.disableInheritingDefaultResources true
```

The setting is global and workspace-overridable. Re-enable inheritance by deleting the explicit setting:

```sh
kiro-cli settings --delete chat.disableInheritingDefaultResources
```
