# Feature map

A maintained, outcome-oriented map of Kiro Fabric's user-facing surfaces and
how to drive each one (V6). This complements `pnpm check` and the lean tests:
it is the *live user-path* contract, not a replacement for deterministic units.

Rules (maintained like the plugins verification map):

- README is the single index. It must link **exactly** the sibling feature
  files; `tests/feature-map.test.ts` enforces a bijective link ↔ file set.
- Each feature file uses exactly these H2 sections, in order:
  1. `Sub-features`
  2. `How to get to it (user POV)`
  3. `Driving it with pnpm, Vitest, and the packaged CLI`
  4. `Gotchas`
- Sub-feature ids are stable, unique, kebab-case; renaming/removing without a
  deprecation note is a breaking change to this map.
- Probes reference real `package.json` scripts / test files / docs paths only.
- Kiro capability wording uses only the runtime-qualified distinction
  `qualified` / `unavailable`, sourced from `src/kiro/diagnostics.ts`.
- Anything you would need a billable model turn to prove is marked
  `unreachable-live` here; the reference is the manual/blinded paired eval,
  never a claim this map asserts in CI.

## Features

- [`execution.md`](./execution.md) — submit work; it becomes a real `fabric_exec`.
- [`kiro-lifecycle.md`](./kiro-lifecycle.md) — doctor / install / uninstall the
  managed Kiro profile and its MCP confinement.

## Baseline (shared prerequisites)

1. `pnpm run build` (Pi loads `dist/`, not `src/`).
2. Launch Pi with the extension path: `pi -e <repo-root>`.
3. Use a disposable project/config location; never your active session.
4. Doctor via `/fabric status` (expected cwd, mode, providers, runner,
   capture, MCP, UI state) before driving and after any surprising failure.
5. Secrets-bearing or billable paths are captured as references, not pasted.

## Maintenance

Reconcile this map whenever the surface, its probes, or its docs change. A
feature that can no longer be driven is reported as a product regression —
never silently edited away from `qualified` so the map stays green.