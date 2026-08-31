# Power agent boundary

The current Kiro Fabric Power release does not mount `agents.*` and does not
advertise ACP orchestration. Use Kiro's native subagent interface outside
`fabric_exec`. Do not probe for, cast to, or dynamically invoke `agents.run`.
Power v1 also exposes no spawn, actors, durable residency, recursion, or
detached work.
