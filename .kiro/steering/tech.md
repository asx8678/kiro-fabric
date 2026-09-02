---
inclusion: always
---

# Technology constraints

- Use Node.js 24 or newer and pnpm 11.20.0.
- The codebase is TypeScript ESM; preserve explicit `.js` suffixes in runtime
  imports.
- `src/` is the source of truth. `dist/` is generated and must not be edited
  manually.
- Vitest owns executable tests, TypeScript owns static checking, and Knip owns
  dead-code checks.
- Finish every implementation change with `pnpm run build`; Kiro CLI v3
  (`kiro-cli --v3`) and the published package load `dist/`, not `src/`.
- Run `pnpm run check` before committing. Use conventional commit messages.
- Preserve pinned runtime dependencies and the lockfile unless dependency
  changes are part of the request.
