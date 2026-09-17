# Upstream client issue drafts

Unpublished drafts based on the recorded Linux Kiro CLI 2.21.1/2.22.0 observations in [coding readiness](coding-readiness-2026-09-09.md), not a new live certification. No private logs are attached.

## Native v3 form elicitation has no handler

An MCP tool requests a form with one required boolean `approved`, default false. The native UI forwards `_kiro/mcp/elicitation` but responds `No handler registered for method: _kiro/mcp/elicitation`. No form renders; Fabric refuses to dispatch the edit and fixture bytes remain unchanged.

Expected: render the exact review and return accept/decline/cancel, or stop advertising unsupported capability. Please identify a supported native client version and add an end-to-end regression. Updating Fabric alone cannot install this client handler.

## Exact agent filtering permits an additional client tool

With `tools:["@fabric/fabric_exec"]`, inherited MCP configuration and Powers disabled, ACP records `disclose_context` alongside Fabric. The `/tools` picker shows only Fabric.

Expected: exact filtering including client-injected tools, and an authoritative complete machine-readable model inventory. No native filesystem bypass is claimed. A picker subset or absence of extra observed calls cannot prove complete filtering.

## Retest requirements

Use explicit write/execute/network `ask` policies in a disposable workspace. A human must approve and decline exact shell/edit effects in the native UI; independently verify bytes and execution counts. Obtain authoritative inventory evidence. No blanket allows, fallback native tools, binary patches or alternate-client results may close these gates.
