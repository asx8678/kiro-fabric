---
inclusion: always
---

# Always use Kiro Fabric

For every task, activate the installed **Kiro Fabric** Power before planning.

Use `fabric_exec` whenever the task involves checked TypeScript composition, Power memory, workspace state, artifacts, or configured MCP federation. Call `fabric_info` once near the beginning of each session to verify that the Power is healthy, and bind the current workspace with `fabric_workspace` before using memory or state.

Kiro native tools remain responsible for ordinary file reads, edits, shell commands, web access, and subagents. Do not use `fabric_exec` as a no-op or claim that it can invoke those native tools.
