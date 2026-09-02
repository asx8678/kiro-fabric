# Power configuration

The Power reads only `${PLUGIN_DATA}/fabric/config/config.json`. Repository files, process-mode flags, and workspace-selected configuration are not loaded. If the file is absent, secure in-memory defaults are used without writing it. If present, it must be a current-user, non-symlink, single-link regular file with no group/other permissions and at most 262,144 bytes.

Supported sections:

- `executor`: default and maximum timeout, QuickJS memory, source/input/output/nested-result bounds, result format, and nested-call quotas. Defaults are 64 total provider calls, 8 active provider calls, 16 total approval requests, 2 pending approvals, 64 audit entries, and 64,000 reserved audit bytes;
- `approvals`: `allow`, `ask`, or `deny` independently for `read`, `write`, `execute`, and `network` risk;
- `mcp`: enabled flag, one shared discovery/invocation timeout, OAuth-disable policy, and an internal private `configPath` selected by the Power;
- `memory`: enabled flag plus entry and per-value bounds;
- `state`: enabled flag plus entry, per-value, and complete-document bounds (`maxTotalChars`);
- `artifacts`: count, per-item, total, and lifetime bounds. Artifacts are private process-local overflow transport, expire after the configured TTL (one hour by default), and are not a publication or durable workspace API.
- `tracing`: `enabled` flag for optional execution tracing (default off). `KIRO_FABRIC_DEBUG` overrides it (`1` forces on, `0` forces off). Traces are private JSONL files under `${PLUGIN_DATA}/fabric/traces/`; see [tracing.md](tracing.md).

Numeric input is finite, integer-normalized, and clamped to enforced product limits. Unknown fields in the on-disk file are rejected; programmatic normalization cannot use unknown values to add providers or authority. There are no alternate product modes. Guest code cannot configure host tools, operating-system access, workspace identity, or federation endpoints.

On first startup, a private legacy `${PLUGIN_DATA}/fabric/config/mcporter.json` is copied and digest-verified as `mcp.json`. A verified v2 workspace generation is renamed to its v3 canonical-identity generation, preserving compatible memory, state, and artifacts. Identity mismatches, malformed files, aliases, non-private permissions, or incompatible data fail closed; migration reports list preserved and ignored fields, and no deleted runtime or agent data is read.

Configured MCP servers are declared in `${PLUGIN_DATA}/fabric/config/mcp.json`, whose only root fields are `mcpServers` and the required `imports: []`; ambient editor imports and mcporter record/replay/stdio-trace options are rejected. Discovery returns only `$servers` and `$call` metadata and does not establish a remote connection. Calls use an exact configured server and exact advertised tool name. Network approval is always separate from the additional execute approval required before stdio startup or an enabled OAuth launch.
