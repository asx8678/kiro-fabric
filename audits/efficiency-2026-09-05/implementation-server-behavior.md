# Server behavioral test implementation

Implemented actual-handler Vitest coverage in `tests/server-efficiency.test.ts` by importing production `createKiroMcpServer`, capturing its SDK `CallToolRequestSchema` callback, and invoking that callback with controlled runtime, binding, configuration, tracer, and workspace-context collaborators.

Coverage includes:

- exact Unicode success response and correlated, allowlisted `exec.projection` metadata;
- runtime execution failure;
- invalid arguments;
- workspace synchronization failure;
- post-startup configuration load failure with abort-listener add/remove cleanup;
- overflow with successful artifact retention and retention failure;
- trace-data checks excluding source, result, and private error content;
- queued cancellation of select, attach, and detach mutations behind blocked runtime initialization;
- a non-cancelled queued commit control;
- shutdown queued ahead of commit winning without mutation.

The tests execute the production handler closure and its production lifecycle queue; no production hooks or source-string assertions are used.

Also added the existing `tests/memory-acknowledgement.test.ts` to `docs/audit.md`'s complete inventory.
