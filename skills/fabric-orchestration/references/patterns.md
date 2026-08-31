# Orchestration patterns

Prefer one bounded `fabric_exec` call with explicit inputs. Use `Promise.all`
only for independent configured-provider calls, preserve partial failures as
data, and aggregate compactly. Check `fabric_info` first. The current Power
release never mounts `agents.*`; use Kiro native subagents outside Fabric.
