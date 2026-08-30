---
name: fabric-guide
description: Recommends the smallest managed Kiro Fabric path without running it.
disable-model-invocation: true
---

# Managed Kiro Fabric guide

Recommend the smallest sufficient path; do not invoke it.

| Need | Recommendation |
|---|---|
| Ordinary repository work or exact API help | Core `fabric_exec`, optionally `/skill:fabric-exec` |
| Explicit independent partitions with Kiro subagents enabled | `/skill:fabric-workflow` |
| Two-lane advisory defect review with Kiro subagents enabled | `/skill:fabric-review` |

If the profile lacks `--allow-shell --subagents`, recommend the core path and
state that agent workflows are unavailable. Do not recommend Pi actors, mesh,
schema transactions, worktrees, councils, fusion panels, or the global
`agent()` helper; managed Kiro does not expose them.

Complete with either `No advanced skill` plus one sentence, or one exact
`/skill:...` command that preserves the user's task as arguments. Never load or
execute a recommended skill yourself.
