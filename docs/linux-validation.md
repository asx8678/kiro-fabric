# Linux compatibility and efficiency validation

Supported installer targets require kernel >=4.18 and glibc >=2.34 on Linux
x64, or glibc >=2.28 on ARM64. The x64 floor comes from the bundled Fovea
ast-grep parser; historical bundles without that parser required only 2.28.
Alpine/musl is not qualified. Source mode requires Node >=24,
the package's pinned pnpm, and Kiro CLI >=2.21.1. Kernel LOCALVERSION suffixes
such as `6.12.25+rpt-rpi-2712`, `6.12.0+`, and WSL's fourth numeric component
are accepted by both the source installer and generated Bash bootstrap without
relaxing the minimum version or Node/Kiro version checks.

## Checking Fovea on Ubuntu and WSL

Fovea is part of the Fabric generation, not a separate `fovea` command or Kiro
MCP server. Its engine, metadata and private `tools/ast-grep` parser are required
bundle entries. Before activation, the current installer checks the parser
version and runs `repo.focus` followed by `repo.dwell` over a temporary source
file, checking extraction and state retention through the actual Fabric backend.

The default installation is `~/.kiro/kiro-fabric/`. The profile at
`~/.kiro/agents/kiro-fabric.json` selects a `runtime/<generation>/` directory
containing `app/fovea/engine-entry.js` and `tools/ast-grep`. These paths are
relative to the selected Kiro home when `KIRO_HOME` or `--kiro-home` is used.
Looking only in `~/.kiro-fabric` or `~/.kiro/.kiro-fabric` does not inspect this
installation.

Run the installed launcher from the project you want to analyze:

```sh
"${KIRO_HOME:-$HOME/.kiro}/kiro-fabric/bin/kiro-fabric" start
```

In that session, ask Fabric to execute:

```ts
return { fabric: fabric.info(), fovea: await repo.status() };
```

Inspect the actual `@fabric/fabric_exec` result. `engineActive: false` before
the first analysis is normal: `repo.status()` does not start the engine. Run
`repo.sketch({maxTokens: 256})` to exercise analysis. A successful install does
not enable automatic native prompt/turn hooks; that capability is reported
separately from explicit analysis. Standard/review profiles can append Fovea
context to supported local file operations within a Fabric invocation.

An intact checkout build from macOS is a source-install cache miss on Linux,
so the installer rebuilds it for Linux. Modified or missing inventory bytes
still fail verification instead of being silently replaced.

## Fixed work and integrity contracts

- **Shell cleanup:** an existing live group leader is checked first. Zombie-only
  evidence uses streamed `/proc` enumeration, at most 32,768 entries and eight
  concurrent stat reads. Each observation is limited to 200ms or the remaining
  cleanup grace, whichever is smaller. Failed TERM observation does not bypass
  SIGKILL. Unreadable/malformed/excessive evidence still fails closed as
  `Local shell cleanup uncertain`; do not suppress this error on restricted
  `/proc` mounts. Kernel I/O that cannot be cancelled may finish later, but no
  further batches are scheduled after timeout. Shell execution is not an OS
  sandbox and deliberate process-group escape is not contained.
- **Search:** batches contain at most 256 files and 2MiB, with the existing
  32MiB aggregate input, output and deadline bounds. The aggregate pathname
  budget is measured in UTF-8 bytes. Every `rg` launch still verifies executable
  identity and managed SHA-256; there is no cross-call integrity cache. A
  128-file no-match search without a glob now uses two launches/hashes rather
  than five. Larger batches trade some early-match prework for less launch/hash
  overhead; file snapshots, revalidation, ignore intersection and alias checks
  remain in place.
- **Startup:** the complete inventory is cryptographically verified on every
  admission under the installation lock. Inventory hashes use <=64KiB buffers,
  not full Node-sized allocations. The captured Node hash is reused only within
  that admission when device/inode, size, ownership, mode/link count and
  nanosecond mtime/ctime match before and after validation. Nothing skips bundle
  verification or caches admission evidence across starts. Cold startup still
  reads the entire bundle, intentionally.

## Reproduce on a native Linux checkout

Install the prerequisites, then run as a regular user (not root):

```sh
uname -srm
getconf GNU_LIBC_VERSION
node --version
rg --version
pnpm run typecheck
pnpm exec vitest run tests/installer-platform.test.ts tests/installer-bootstrap.test.ts tests/source-bootstrap.test.ts tests/local-process-group.test.ts tests/local-shell.test.ts tests/local-search-work.test.ts tests/local-executable.test.ts tests/local-provider.test.ts tests/bundle-contract.test.ts tests/bundle-streaming.test.ts tests/managed-generation.test.ts tests/managed-generation-efficiency.test.ts
pnpm run build
```

`local-process-group.test.ts` explicitly simulates Linux process observations;
`local-shell.test.ts` creates and cleans real process groups on the host OS.
Streaming/tamper and search-count regressions use disposable real files.
The managed-generation efficiency test substitutes executable/version evidence
but performs real inventory captures and real mutation checks.

The `installer-native-contracts` CI matrix runs these contracts on native
Linux x64/ARM64 and macOS x64/ARM64, alongside its complete-bundle checks.
A configured or unavailable runner is not a passing run. Local macOS results
and simulated `/proc` tests are not native Linux performance measurements;
exact-artifact/client/signing qualification remains separate and pending.
