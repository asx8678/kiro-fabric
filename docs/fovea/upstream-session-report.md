### Kiro Product

CLI (`kiro-cli 2.22.1`, native TUI with `--v3`, macOS 27.2 arm64).

### Feature Description

Please document or provide a supported native chat/session + epoch + request/turn
association shared by hooks and MCP integrations, or an equivalent guaranteed
lifecycle/isolation contract. This is an integration API request, **not** a claim
that base MCP requires a native chat ID in `tools/call`.

An integration needs to distinguish same-workspace chats and lifecycle transitions
without treating model-supplied arguments, cwd, or process ancestry as authority.
Any association must come from the trusted host and remain unambiguous when MCP
processes are reused. If a supported existing mechanism already provides this,
please point us to it and its concurrency/clear/resume guarantees.

### Use Case

Fovea provides explicit repository navigation through a Fabric MCP server. It has
MCP-host-local focus/result/settings state and keeps automatic integration disabled
until native ownership and delivery are qualified.

Two separate observations on 2026-09-21:

1. A native hook/MCP protocol fixture records `session_id` in hooks. All three
   observed MCP calls contain only `name` and `arguments`, with no corresponding
   `_meta`. Initialize identifies a generic `kiro 0.0.0` client. This fixture is
   not actual Fabric execution or intended-model-input proof.
2. A real-Fabric lifecycle run observes fresh exact tool calls and matched native
   `/compact`, profile-swap and `/clear` acknowledgments. Clear creates a different
   native chat, but the same MCP instance is retained. Before a new focus is seeded,
   `repo.dwell()` returns the preceding chat's exact focus ID. This reproduces a
   sequential navigation-state boundary gap for our MCP-local state; it does not
   prove concurrent pooling, unauthorized cross-workspace access or a general
   client security vulnerability.

A vendor-independent way to inspect the requested boundary:

1. In an owned scratch workspace, configure a stdio MCP tool with a process-local
   opaque state marker. Support separate seed/read operations so a read does not
   accidentally reseed it. Log only the server boot identity and request parameter
   and metadata key names, not credentials, tool arguments or private file content.
2. Record `session_id` from supported SessionStart/UserPromptSubmit hooks in that
   scratch profile. Treat it as an observation, not authority supplied by the model.
3. Seed state in one native TUI chat. Use native `/clear`, then read existing state
   through a fresh actual MCP call in the new chat before seeding anything else.
4. Compare native chat identities, server boot identities and any host-provided
   correlation metadata. Do not assume unchanged cwd implies unchanged chat.

This recipe describes the boundary under discussion, not a claim that a separate
public standalone harness has been qualified. The observations above came from
the hook/MCP fixture and actual-Fabric probes separately. Our actual-Fabric probe
uses owned fixtures, normal approvals and supported TUI inputs; it does not install
a live profile or fabricate routing. A completed run retaining the exact pre-clear
focus is reported as **failed**, while missing evidence remains unqualified.
No access to our checkout or private transcripts is required to assess this API
request.

### Requested Contract / Acceptance

- A documented host-controlled identity/lifetime association usable by both hooks
  and MCP, distinct from workspace identity and tool arguments.
- New/clear/resume/compact/profile-switch semantics and epochs, including
  same-workspace concurrent chats and rejection of ambiguous or stale routing.
- Cancellation/revocation semantics for in-flight work and reset/restoration rules
  for conversation-local state. We can then exercise focus, retained results,
  settings and rule trust independently rather than guess at chat ownership.
- Separately, a supported intended-turn delivery acknowledgment for automatic
  advisory context. Hook stdout or an observed continuation call is not proof of
  what entered the intended model request.

### Additional Context

- Related but different: https://github.com/kirodotdev/Kiro/issues/9140 concerns the
  Streamable HTTP `Mcp-Session-Id` transport header. This request concerns native
  chat ownership shared with hooks, including stdio MCP; it is not that HTTP bug.
- Targeted open/closed issue searches found no exact duplicate; that is not a
  guarantee of absence. Please redirect or merge if an existing API/request covers it.
- All raw transcripts, paths, native session IDs and account details remain private.
- Automatic hooks remain off. Component tests and successful explicit navigation
  are not presented as native session-isolation or delivery qualification.
