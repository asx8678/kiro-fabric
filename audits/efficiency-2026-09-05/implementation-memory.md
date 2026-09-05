# Memory F05/F07 implementation

- Verified repository `/home/adam/projects/kiro-fabric` at required HEAD `d33cbdca33fac6ce301a6da884f06ee5141534da` before changes.
- Traced memory mutation publication/locking and used `StateCommitAcknowledgementError` plus pending exact-identity cleanup in `src/providers/state-provider.ts` as the recovery reference.
- Memory lock ownership now retains directory identity and owner inode plus a random persisted token. Cleanup failures propagate and remain pending for a later retry; retries refuse foreign/replacement identities.
- Set rename and delete unlink are explicit publication points. Failures after those points produce `KiroMemoryCommitAcknowledgementError` (`committed: true`, operation/key, preserved cause, read-before-retry message). Pre-publication errors and no-op deletes are not labeled committed.
- Added deterministic tests for pre/post-publication interruption, cleanup recovery, replacement refusal, and concurrent writes.

Validation:

```text
pnpm exec tsc --noEmit
pnpm exec vitest run tests/memory-security.test.ts tests/memory-recovery.test.ts tests/storage-failure.test.ts
# 3 files, 25 tests passed
```

Per task instruction, no full build was run; parent owns final integration/build.
