# Power configuration

The Power reads only `${PLUGIN_DATA}/fabric/config/config.json`. Repository files, process-mode flags, and workspace-selected configuration are not loaded. If the file is absent, secure in-memory defaults are used without writing it. If present, it must be a current-user, non-symlink, single-link regular file with no group/other permissions and at most 262,144 bytes.

Supported sections:

- `executor`: default and maximum timeout, QuickJS memory, source/input/output/nested-result bounds, and result format;
- `approvals`: `allow`, `ask`, or `deny` independently for `read`, `write`, `execute`, and `network` risk;
- `mcp`: enabled flag, one shared discovery/invocation timeout, OAuth-disable policy, and an internal private `configPath` selected by the Power;
- `memory`: enabled flag plus entry and per-value bounds;
- `state`: enabled flag plus entry, per-value, and complete-document bounds (`maxTotalChars`);
- `artifacts`: count, per-item, total, and lifetime bounds.

Numeric input is finite, integer-normalized, and clamped to enforced product limits. Unknown fields in the on-disk file are rejected; programmatic normalization cannot use unknown values to add providers or authority. There are no alternate product modes. Guest code cannot configure host tools, operating-system access, workspace identity, or federation endpoints.

Configured MCP servers are declared in `${PLUGIN_DATA}/fabric/config/mcp.json`. Discovery returns only `$servers` and `$call` metadata and does not establish a remote connection. Calls use an exact configured server and exact advertised tool name. Network approval is always separate from the additional execute approval required before stdio startup or an enabled OAuth launch.
