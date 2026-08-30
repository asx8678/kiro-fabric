---
name: fabric-orchestration
description: Use Fabric for checked multi-agent fan-out, programmatic aggregation, workflow logic, Fabric memory/state, or configured MCP federation in Kiro.
---

# Kiro Fabric orchestration

Use Kiro native tools for ordinary file reads, edits, shell commands, code
intelligence, web operations, and simple native subagents. Do not invoke Fabric
for one simple read, grep, edit, or shell command.

Use `fabric_exec` when several independent tasks need controlled fan-out,
programmatic aggregation, workflow branches or loops, Fabric memory/state,
configured Fabric MCP federation, or qualified Kiro ACP child orchestration.
Fabric cannot call backward into the outer Kiro session's native tools.

Call `fabric_info` and check workspace status before using agents or any
workspace-dependent capability. Missing workspace, ACP, or approval capability
means omit that operation; never work around a denial.

```ts
const reviews = await Promise.all([
  agents.run({ task: "Review authentication security" }),
  agents.run({ task: "Review test coverage" }),
  agents.run({ task: "Review architecture changes" }),
]);
return reviews;
```

```ts
// Bad: use Kiro's native read tool instead.
return await k.read("src/index.ts");
```

Power v1 work is session-bounded. Do not create detached or durable work and do
not claim execution survives Power deactivation. See `references/patterns.md`
and `references/safety.md` for advanced guidance.
