# Early product validation: retain composition or simplify?

Status: **not run**. `command -v kiro-cli` found no client on PATH in the implementation environment. No login, install, settings change, model request or production endpoint was attempted. Supply an explicit client path and authorize an isolated authenticated diagnostic run to proceed. Do not inspect or copy existing credential files.

## Separate decisions

1. Implementation correctness: local regression tests and built stdio checks.
2. Product value: whether checked composition, custom federation and process-local artifacts improve representative work over native MCP calls.
3. Release readiness: the existing exact-commit authenticated qualification, unchanged. Passing (1) or (2) cannot substitute for (3).

## Paired diagnostic workflow

Have the operator select three representative synthetic tasks before running either approach:

| Task | Current Fabric | Smaller comparison |
|---|---|---|
| Read/transform/write with human approval | One checked composition with recorded approvals and state effect | Native tools/MCP calls with equivalent explicit approval policy |
| Two-tool composition with an intermediate result | Checked composition and a bounded artifact if useful | Separate native calls; no hidden permission broadening |
| Restart/resume and retained task facts | Durable workspace state/memory, ephemeral artifacts treated separately | Native MCP tools plus explicit persisted task state |

Use a throwaway workspace/home, non-sensitive fixture values, the same supported client/model and equivalent approved capabilities. Never modify global settings or an existing installation. Capture observable outcomes, approval counts, model turns, elapsed time, operator corrections and lost/retained facts. Record failures and repeat enough paired trials to expose variability; do not extrapolate a single timing into a performance claim. Test real registration, execution and approval decline before investing in the longer lifecycle exercises.

Before starting, the owner should decide which properties are required: same MCP process across prompts/compaction, artifact continuity, conversation-only fact retention, typed composition, and supported third-party MCP discovery. The current release contract still requires its documented lifecycle properties; changing that contract needs an explicit product decision and new qualification criteria, not weaker assertions.

## Decision rules

- Keep current composition when it reliably eliminates meaningful model round trips or errors on owner-selected tasks while preserving approval clarity.
- Extract only narrow internal interfaces when the benefit remains but ownership/protocol contracts are hard to maintain.
- Prototype a native-MCP-only variant in a separate branch if those tasks show little benefit from the compiler/VM/federation machinery. Do not delete the current product first. Require equivalent output bounds, approvals and persistence before comparing maintenance cost.
- Consider SQLite separately only if measured write contention, required transactions or explicit durability requirements exceed the documented file-storage contract. Include migration, rollback and backup work; a database does not solve lost acknowledgements.

Final validation still requires `pnpm run check`, a fresh archive, and the repository-owned authenticated exact-release driver on the final clean commit. This document is an experiment plan, not a passed qualification record.
