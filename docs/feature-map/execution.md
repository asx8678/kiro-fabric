# Feature: execution

## Sub-features

- `execution.checked-program` — a submitted program type-checks and can run.
- `execution.single-fabric-tool` — the model surface exposes exactly one
  model-invocable tool: `fabric_exec` (see `src/kernel/fabric-exec-contract.ts`).
- `execution.bounded-result` — outputs are projected within the configured
  nested-result budget (see `src/output-budget.ts`).

## How to get to it (user POV)

The user submits a task to the assistant. It becomes a type-checked TypeScript
program body offered to the `fabric_exec` tool, executed against repository
tools, with a bounded result for the conversation.

## Driving it with pnpm, Vitest, and the packaged CLI

- Build: `pnpm build` (mandatory; Kiro CLI v3 and the Power/Strict closures
  run `dist/`).
- Probes:
  - `pnpm vitest run tests/kernel-schema.test.ts` (contract + single-tool).
  - `pnpm vitest run tests/output-budget.test.ts` (bounded projection).
  - Headless: after Power or Strict install, `kiro-cli --v3` (or
    `kiro-cli --v3 --agent kiro-fabric`) and submit a `fabric_exec` task.
- Evidence: capture JSONL session + the returned program's `typeErrorGuidance`
  when present.

## Gotchas

- `dist/` is the runnable surface; green `src/` tests alone do not update the
  Kiro Power/Strict closures or published bundle.
- Ascribing "fabric_exec generated?" is a deterministic wire assertion via the
  kernel contract, not a model self-report.