# Architecture

`kiro-fabric` is a Kiro custom agent. Its profile owns native Kiro tools and one stdio `mcpServers.fabric` process. The server exposes exactly three tools: `fabric_info`, `fabric_workspace`, and `fabric_exec`. Checked TypeScript flows through the isolated compiler worker into QuickJS and the ActionRegistry-backed artifacts, memory, state, and configured MCP providers.

Kiro owns ordinary file, write, shell, web, todo, and subagent behavior. Fabric cannot call those native tools. Fabric approvals are an independent inner boundary and fail closed when roots, identity, form elicitation, cancellation, schemas, or effects are indeterminate. Runtime and writable data roots are explicit absolute `KIRO_FABRIC_RUNTIME_ROOT` and `KIRO_FABRIC_DATA_ROOT` values and must be distinct and non-containing.

The reachability baseline is `docs/architecture/agent-reachability-baseline.json`. Private source names and storage salts containing “power” remain compatibility details only; they do not define a second product.

## Session and process lifecycle

Kiro owns conversation history, resume, and context compaction. The repository-owned lifecycle contract is that one selected Kiro CLI OS process starts one private Fabric stdio MCP process and keeps that transport throughout ordinary turns and compaction, including a compaction-induced logical chat-session transition if the client implements one. Repeated `fabric_info` calls—including calls repeated because the prompt was compacted—are idempotent. They report the same random `mcpInstanceId`, PID, start timestamp, and runtime generation; they do not initialize another process or runtime. Whether a particular Kiro build honors that contract through `/compact` remains blocked until the authenticated real-client gate observes it on the exact release commit.

The Fabric MCP process caches one runtime for the currently verified workspace identity. A verified workspace-root change can close that inner runtime and increment its runtime generation without starting a second MCP process. These lower lifecycle events are also not MCP restarts:

- every `fabric_exec` intentionally receives a fresh QuickJS context for guest isolation;
- the pooled compiler worker is a Node worker thread inside the Fabric MCP PID; it may terminate and warm again without creating another MCP process;
- a configured downstream MCP provider may reconnect according to its own policy.

Workspace memory and state live under the global Fabric data root and survive the Fabric process. They are workspace-scoped, not Kiro-chat-session-scoped, so concurrent Kiro chats bound to the same verified workspace may share them. Overflow artifacts, TTL entries, and ordinary in-memory values are process-local or otherwise ephemeral and must not be treated as durable session memory.

The process lifecycle regressions exercise that storage contract through separate MCP PIDs: concurrent processes must see both memory writers and serialize a competing state revision update, while a fresh process after an abrupt MCP death must recover exact committed memory/state and continue writing without corruption.

Normal restart boundaries are Kiro CLI exit or crash, an explicit MCP reconnect, a change to the agent's MCP command/arguments/environment/profile, switching away from and back to `kiro-fabric`, an unrecoverable Fabric MCP crash, or a Kiro operation empirically shown to start a new agent session. Normal EOF and termination signals drain the runtime; abnormal stdin close/error and parent death also trigger bounded fail-closed shutdown. The lifecycle tests create the compiler worker before abrupt parent death, and the real-client gate snapshots any OS descendants of Fabric before shutdown; neither the MCP PID, its worker threads, nor an observed descendant may remain. The required later `--resume-id` behavior is a new Fabric PID/instance while Kiro restores its saved conversation state or compacted summary and Fabric restores only durable workspace memory/state; the authenticated gate must observe it before it is claimed.

Current Kiro documentation is internally inconsistent about logical session identity: the main compaction page says the session continues, while the CLI context page says compaction creates a new session. Both describe older history being replaced by a summary, and neither statement establishes the child-process behavior. The authenticated real-client gate is the authority for whether the installed Kiro version preserves the MCP process through `/compact`. If Kiro reconnects or restarts the server, evidence must report that limitation; durable state may still restore, but the strict same-PID compaction gate remains failed.
