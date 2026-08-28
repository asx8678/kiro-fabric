# Release D certification

> Historical v2 parity evidence. Current v3 qualification is tracked in
> [capabilities-2.20.1-v3.md](capabilities-2.20.1-v3.md).

Release D is the opt-in, non-billable Kiro parity gate for the supported Kiro
slice only. It proves that advanced surfaces are either qualified with an
accurate scope or explicitly unavailable with a diagnostic. It never claims
native Kiro transcript fidelity and never uses a real model turn.

## Supported tuple

- Node `>=24`
- `kiro-cli 2.19.1`
- `--agent-engine v2`
- Non-billable only

## Gate command

```bash
KIRO_FABRIC_RELEASE_D_REAL=1 pnpm certify:release-d:real
```

The gate refuses to run unless `KIRO_FABRIC_RELEASE_D_REAL=1` is set, and it
also refuses when `KIRO_PHASE0_BILLABLE=1` is present.

## What the gate proves

Using the managed Kiro profile installed against the fake wrapper
`tests/fixtures/kiro/fake-kiro-worker.mjs`, the gate asserts:

1. Kiro diagnostics report every Release-D row as either supported qualified or
   explicit `unavailable`.
2. Semantic handoff fidelity is exactly `semantic`.
3. A stateful topology record is written without private-session reads.
4. The memory binding rejects a path outside its namespace.

## Clauses

- Opt-in only.
- Non-billable only.
- Uses the fake Kiro wrapper, not a real Kiro model turn.
- Fail-closed: unsupported or unproven parity must remain explicitly
  unavailable.
- Native transcript fidelity must never be claimed on the Kiro path.
