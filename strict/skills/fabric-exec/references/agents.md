# Managed Kiro ACP agent reference

This surface exists only when the profile was installed with both
`--allow-shell` and `--subagents`. It launches at most four non-recursive,
session-local Kiro ACP workers. Children receive a scoped set of `k.*` tools and
cannot spawn more children.

Use `agents.run()` for bounded work that should settle inside the current call:

```ts
return agents.run({
  name: "auth-review",
  runner: "kiro",
  task: "Review the authentication changes. Cite paths and run focused checks.",
  tools: ["read", "grep", "find", "ls", "bash"],
  context: {
    objective: "Find regressions in the authentication change",
    relevantFiles: ["src/auth"],
    constraints: ["Do not edit files"],
  },
});
```

Supported operations are `run`, `spawn`, `wait`, `status`, `list`, `models`,
`stop`, `cleanup`, `steer`, `followUp`, `setSteeringMode`,
`setFollowUpMode`, and `log`. Run/spawn accept `task`, `name?`, `runner?:"kiro"`,
`transport?:"auto"|"process"`, `model?`, `thinking?`, `tools?`, `timeoutMs?`,
`cwd?`, `schema?`, and bounded `context?`.

`runner: "kiro"` is the only runner value and executes the configured
`kiro-cli` binary through ACP.

Model routing is inventory-aware. When available, use `claude-haiku-4.5` at
low effort for small work, `qwen3-coder-next` at low effort for coding and
testing, and `claude-opus-4.8` at medium effort for complex or ambiguous work.
If only `auto` is advertised, omit both model and effort so Kiro selects a
supported route. Passing `model: "auto"` likewise leaves effort to Kiro.

There are no Pi/Claude/Veda runners, actors, peers, mesh subscriptions,
worktrees, recursive mode, durable residency, extension loading, or global
`agent()` helper. Kiro ACP usage is reported as unavailable, so do not claim
token or cost accounting. Omit `timeoutMs` normally; values below the configured
default do not shorten a run.

For detached work, keep the returned ID, use `wait({id})` or `status({id})`, and
call `cleanup({id})` only after settlement. `cleanup` always removes that run's
retained files. Preserve successful results when one child fails; never rerun
successful children automatically.
