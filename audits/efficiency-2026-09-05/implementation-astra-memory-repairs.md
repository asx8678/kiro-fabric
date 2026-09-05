# Astra memory repairs implementation report

## Scope and baseline

Implementation performed without delegation, model calls, installs, commits, or edits to MCP server/analyzer/audit documentation/other-worker tests. Existing concurrent edits were preserved.

Baseline evidence:

```text
$ pwd
/home/adam/projects/kiro-fabric
$ git rev-parse HEAD
d33cbdca33fac6ce301a6da884f06ee5141534da
```

`AGENTS.md` was read before source changes. Only Astra review sections R3, R4, and R6 and relevant source/tests/docs were read.

## Repairs

- **R3:** memory set/delete now attempt directory fsync but classify only explicit unsupported responses (`EINVAL`, `ENOTSUP`, `EOPNOTSUPP`, plus Windows directory-open `EISDIR`/`EPERM`/`EACCES`) as best effort. Real I/O failures still propagate after publication as committed acknowledgement errors. Documentation preserves atomic/process-restart durability scope and excludes power-loss guarantees.
- **R4:** lock initialization retains directory/owner descriptors and inode/device evidence when metadata inspection fails. Same-instance mutation retry re-verifies and removes only the exact owned lock. Unverifiable ownership reports unresolved cleanup and never deletes by pathname. Tests cover mkdir/lstat, owner open/fstat/write/partial-write/close, causes, exact cleanup retry, and foreign replacement refusal.
- **R6:** a non-serializable symbol marks trusted committed errors with bounded `{version, operation}` metadata. Registry audits retain that marker; execution results naturally carry audits through generic aborted/timed-out outcomes; projection emits only bounded ref/operation acknowledgement. Keys, values, causes, and arbitrary error strings are not copied into the marker/notice. Cancellation remains fail-closed.

New test file for parent inventory: `tests/memory-acknowledgement.test.ts`.

## Validation evidence

```text
$ pnpm exec vitest run tests/memory-recovery.test.ts tests/memory-acknowledgement.test.ts
Test Files  2 passed (2)
Tests  16 passed (16)

$ pnpm exec vitest run tests/memory-recovery.test.ts tests/memory-acknowledgement.test.ts && pnpm exec tsc --noEmit
Test Files  2 passed (2)
Tests  19 passed (19)
# tsc exited 0

$ pnpm exec vitest run tests/memory-acknowledgement.test.ts tests/memory-recovery.test.ts tests/memory-security.test.ts tests/storage-failure.test.ts tests/approval-projection.test.ts && pnpm exec tsc --noEmit && pnpm run build
Test Files  5 passed (5)
Tests  51 passed (51)
# tsc exited 0
# final fresh build exited 0; Agent closure built: 78 files, 14473186 bytes, 36 source modules
```

The acknowledgement tests invoke actual `KiroMemoryProvider -> ActionRegistry -> FabricExecutionService -> projectFabricExecutionText` source paths for cleanup failure and post-publication abort/deadline, and assert commit notice survival plus secret/cause non-disclosure. No independent Astra model validation was run because model calls were explicitly prohibited; parent should perform that review independently.
