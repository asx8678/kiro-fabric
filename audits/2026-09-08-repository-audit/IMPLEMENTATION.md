# Audit findings — implementation

The user authorized fixing all findings after the audit-only phase. Both confirmed findings are now fixed in the working tree. The [repository audit](REPOSITORY_AUDIT.md) preserves the pre-fix baseline and its evidence; its source line references refer to the retained disposable snapshot.

The subsequent commit/push request is validated separately in [COMMIT_VALIDATION.md](COMMIT_VALIDATION.md): the standalone fix passes 643 tests in 49 files, with a fresh matching build. Unfinished installer work from the wider shared workspace is excluded from that commit.

| Finding | Implemented change | Regression coverage |
|---|---|---|
| F-001 | Memory and MCP snapshot writers clear descriptor ownership before attempting close. Close failure cannot skip pathname cleanup or replace the primary error with a second close error. If the first identity read fails, each writer makes one bounded identity retry while the descriptor is still owned, before closing. Secondary cleanup failures retain the original cause. Cleanup preserves foreign replacement files; memory now records and checks the temporary file identity too. | Each writer: completed-close EIO; write plus close failure; close plus removal failure; foreign replacement after close; transient initial identity failure; replacement during failed identity acquisition; persistent identity uncertainty. Successful later operations and old committed memory/configuration are checked. |
| F-002 | Artifact disk deletion completes before the entry and its quota are released. Failed deletion remains retryable; close cannot silently succeed after forgetting a failed removal. | Expiry/read, count eviction, size eviction and close, with repeated failures followed by successful cleanup. Another store's artifacts remain intact. |

Changed application files: `src/kiro/memory.ts`, `src/kiro/mcp-provider.ts`, `src/kiro/artifacts.ts`. Added 18 regression cases in the existing `tests/storage-failure.test.ts`. Public inputs, persistence formats, namespace salts and state revisions remain unchanged. A primary error is preserved directly when cleanup succeeds; combined failures use `AggregateError` with the primary cause. Generated `dist/` is rebuilt for immediate Kiro use.

The user subsequently requested an Astra agent fan-out. Three independent reviewers checked memory, MCP snapshot staging and artifact deletion. Their [review synthesis](ASTRA_REVIEW.md) records scope, evidence and dispositions. Memory and MCP reviewers found the same additional initial-identity failure branch during F-001 validation; both writers now handle it. Persistent identity failure is reported and the unverified file is preserved instead of assuming deletion ownership.

Validation:

- [I-002](evidence/I-002.json): 79 focused tests in 4 files passed, including all new cases. I-001 stopped before testing because sandbox DNS prevented Corepack setup; the approved retry succeeded.
- [I-003](evidence/I-003.json): the initial `pnpm run check` passed in the working tree — **885 tests in 65 files**, typecheck, build/staging, dead-code lint, component certification and application SBOM. Wall time 173.487 seconds; Vitest 152.74 seconds. This precedes the Astra follow-up changes.
- [I-004](evidence/I-004.json): the initial subsequent fresh `pnpm run build` passed and refreshed live `dist/`; this also precedes the Astra follow-up changes.
- [I-005](evidence/I-005.json): the strict whole-tree comparison detected six new files under the separate `audits/2026-09-08-code-quality-fanout/` directory. They were absent from the baseline and were not written or changed by this task; the original failed comparison is retained.
- [I-007](evidence/I-007.json): application scope comparison confirms only the three source files, regression test file and generated build outputs changed outside audit artifacts. The six concurrent audit additions are recorded explicitly, so this is not a claim that the entire workspace stayed unchanged.
- [I-011](evidence/I-011.json): all six added metadata-failure cases reproduced the missing recovery before the correction (24 existing cases passed, 6 new cases failed).
- [I-012](evidence/I-012.json): after the correction, **85 focused tests in 4 files passed**, including all 30 storage-failure cases.
- [I-013](evidence/I-013.json): final `pnpm run check` passed after the Astra corrections — **891 tests in 65 files**, typecheck, build/staging, dead-code lint, component certification and application SBOM. Wall time 200.105 seconds; Vitest 172.89 seconds.
- [I-014](evidence/I-014.json): subsequent fresh `pnpm run build` passed in 5.422 seconds and refreshed live `dist/` for the final source.
- [I-015](evidence/I-015.json): final scope comparison passed with exactly the same four authored source/test files, generated build changes and six separately reported concurrent audit additions; no unexpected paths.

Verification used synthetic home/configuration paths and the existing stack. No commit, publication, deployment or authenticated Kiro qualification was performed. The audit's documented signing/client/native qualification gaps remain separate release work; they were not confirmed defects in the finding register.
