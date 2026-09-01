# Power runtime preflight

The Power requires Node.js 24 or newer on the executable search path
inherited by Kiro. If the MCP server does not start, use Kiro's native shell:

1. `node --version` and `command -v node` (`where.exe node` on Windows).
2. `kiro-fabric doctor power --json` — read-only, non-billable, and reports
   the exact running Node path.

Do not download or execute an unpinned runtime as a workaround; install a
supported Node 24 release and restart Kiro.
