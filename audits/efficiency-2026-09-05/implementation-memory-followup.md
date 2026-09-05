# Memory F05/F07 follow-up

- Verified repository root `/home/adam/projects/kiro-fabric` and exact HEAD `d33cbdca33fac6ce301a6da884f06ee5141534da` before inspection; read `AGENTS.md`.
- Reviewed the current F05/F07 implementation and `tests/memory-recovery.test.ts` without modifying disjoint worker files.

## Fix and safety reasoning

Lock-owner identity is now obtained with `fstatSync` from the exclusively created, no-follow owner descriptor before owner metadata is written. Therefore a pathname `lstat` failure after a successful write can no longer erase the only owner inode identity. If initialization or its cleanup fails, the exact directory/owner identity is retained in the binding's pending cleanup state and retried by that same instance before another mutation.

Normal release still requires matching lock-directory device/inode, owner regular-file/non-symlink status, owner device/inode, and the persisted random token. During an incomplete owner write, a token may not yet be trustworthy; cleanup is then allowed only for the exact owner device/inode captured from the exclusive descriptor within the exact lock directory. Unknown, foreign, aliased-by-path, or replacement lock identities are not removed, and stale-lock behavior was not relaxed.

Operation and cleanup failures remain an `AggregateError` whose `cause` is the original operation failure. Publication tracking remains outside lock cleanup: rename/unlink publication and directory-sync or later cleanup failures produce explicit committed acknowledgement errors, while prepublication failures and no-op deletes do not.

## Deterministic evidence

Command:

```text
pnpm exec vitest run tests/memory-recovery.test.ts tests/memory-security.test.ts tests/storage-failure.test.ts --no-cache
```

Result: **3 files passed, 29 tests passed**.

Focused recovery coverage includes:

- owner unlink failure preserving live-process owner metadata, followed by successful exact-owned cleanup and mutation on the same binding;
- simultaneous precommit operation and cleanup failures preserving the original cause without a committed claim;
- interrupted no-op delete plus cleanup failure without a committed claim;
- directory-sync failure after set publication returning committed acknowledgement while the value is visible;
- replacement lock refusal and concurrent writer serialization.

Type check:

```text
pnpm exec tsc --noEmit
```

Result: exit 0.

## Limitations

This provides exact same-instance recovery for retained lock identity, not arbitrary process-crash cleanup or a power-loss durability guarantee. Transport loss can still hide an acknowledgement. No foreign/replacement lock reclamation rule was weakened. Per parent coordination, no full build was run in this bounded follow-up; the parent owns the final build.
