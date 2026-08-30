# Orchestration patterns

Prefer one bounded `fabric_exec` call with explicit inputs. Use `Promise.all`
only for independent tasks, preserve partial failures as data, and aggregate
compactly. Check `fabric_info` first: `agents.*` is absent unless the workspace
and certified Kiro ACP lane are both available.
