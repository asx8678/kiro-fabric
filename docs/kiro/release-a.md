# Release A certification

> Historical evidence: this record was executed for Kiro CLI 2.19.1 / engine
> v2. It is retained for provenance and is not evidence for the current v3
> tuple. See [capabilities-2.20.1-v3.md](capabilities-2.20.1-v3.md).

Release A is the opt-in Kiro CLI v2 lifecycle: packed `kiro-fabric` /
`kiro-fabric-mcp`, project-scoped install, non-billable doctor, and hash-owned
uninstall.

## Supported tuple

- Node `>=24`
- `kiro-cli 2.19.1`
- `--agent-engine v2`
- Exactly one model-visible tool: `@fabric/fabric_exec`
- Never `--trust-all-tools`

## Deterministic packed gate

Does not belong in `pnpm check` / `prepack` (those already build; packing
from `prepack` would recurse).

```bash
pnpm certify:release-a
```

The script:

1. `npm pack --ignore-scripts` into a temporary directory
2. Asserts required files, exports, bins, shebangs, and the absence of
   `src/`, `tests/`, `scripts/`, and `node_modules/`
3. Installs the tarball into a clean consumer outside the repository
4. Runs packed `kiro-fabric install kiro` against the fake Kiro fixture
5. Runs packed `kiro-fabric doctor kiro --json` with `nonBillable: true` and
   `modelTurnsRequested: 0`
6. Speaks MCP `initialize` / `tools/list` to the installed `kiro-fabric-mcp`
7. Runs packed `kiro-fabric uninstall kiro` and asserts a second uninstall is
   a no-op

## Real non-billable opt-in

Required before a Release-A tag. Hard-fails unless the exact variable is set
and refuses to run if a billable spike is also enabled.

```bash
KIRO_FABRIC_RELEASE_A_REAL=1 pnpm certify:release-a:real
```

Uses the packed consumer and real `kiro-cli 2.19.1`. Allowed ACP methods are
only `initialize` and `session/new`. `session/prompt` is never sent.

## Known fail-closed constraints

- No MCP elicitation: `ask` / `auto` approvals deny.
- No MCP cancellation propagation: residual execution is bounded by the
  15-minute adapter deadline used for trusted-shell verification.
- Uninstall restores only a verified displaced-user backup; drifted managed
  profiles are left in place.
