# Managed Strict skill contract

- Reference sibling material as `<skill-dir>/references/<file>.md`; never use
  absolute paths. Keep `src/kiro/skills.ts` and its digest ownership complete.
- Managed repository I/O uses only `k.*`. Generic `tools.*` is limited to
  mounted-provider discovery/invocation. `pi.*`, `tools.fs.*`,
  `tools.shell.*`, and unavailable global namespaces must not appear in
  executable examples.
- Type-check every TypeScript block against the effective managed capability
  view. Every `π.key` in an example must be documented as `strings.key`, and
  all promise-returning APIs must be awaited.
- Preserve semantic tests for fail-closed effects, bounded fan-out, no
  successful-partition retry, optional children, and progressive loading.
  Exact prose assertions are reserved for deliberately public compatibility
  text and must explain that status in the test.
