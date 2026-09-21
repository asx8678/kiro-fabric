### Before opening, please confirm

- [x] I searched open and closed issues. Related scopes are listed below.

### Operating System

macOS 27.2, arm64. Observed on 2026-09-21.

### Kiro Version

`kiro-cli 2.22.1`, native TUI with `--v3` (the opt-in v3 engine inside the 2.x CLI).
The official stable manifest also reports `2.22.1` when checked on 2026-09-21:
https://prod.download.cli.kiro.dev/stable/latest/manifest.json
No client update was performed. This is not a claim about every client version or the IDE.

### Bug Description

In the tested native CLI v3 TUI path, standard MCP form elicitation reaches the
native client, but its matched response reports:

```text
No handler registered for method: _kiro/mcp/elicitation
```

Fabric receives cancellation and correctly withholds the requested fixture edit.
This was observed with a directly configured stdio MCP server, not a Power-bundled
server. A companion native protocol probe records MCP protocol `2025-11-25` with
client capabilities `{"elicitation":{"form":{},"url":{}}}`.

The server calls the standard MCP SDK `server.elicitInput` API with `mode:"form"`
and a schema requiring one boolean property `approved` (default false). It does
not manually invoke `_kiro/mcp/elicitation`; that name is observed on Kiro's own
native recording.

### Steps to Reproduce

The observed run used an actual Fabric stdio MCP server and an owned temporary
workspace/profile/data store. It started native
`kiro-cli chat --v3 --agent fovea-native-approval-probe --require-mcp-startup`
and submitted one real Fabric invocation requesting a harmless exact fixture edit.
Write/execute/network policies stayed `ask`; there was no blanket approval,
response automation or native-tool fallback. The diagnostic drove the real TUI,
not a substitute ACP client, and never simulated a human choice.

To reproduce the relevant protocol path in another MCP server:

1. Configure a directly connected stdio MCP server in an isolated v3 agent profile
   (not through a Power). Expose a harmless tool that requests a form before doing
   anything. Permit invoking that specific outer tool, not the requested effect.
2. In the tool handler, issue the standard SDK request shown below.
3. Start the native TUI with `kiro-cli chat --v3 --agent YOUR_PROFILE --require-mcp-startup`,
   invoke that tool once, and inspect the form outcome.
4. If the form fails or is cancelled, perform no mutation and do not retry with
   relaxed permissions.

Relevant SDK request shape from the observed server (review text shortened; this
is not a claim that a separate standalone harness was executed):

```js
const result = await server.elicitInput({
  mode: "form",
  message: "Approve one harmless fixture edit?",
  requestedSchema: {
    type: "object",
    properties: { approved: { type: "boolean", title: "Approve once", default: false } },
    required: ["approved"]
  }
});
// Only result.action === "accept" && result.content?.approved === true authorizes it.
```

The report deliberately does not rely on access to our checkout or private traces.

### Actual Behavior

- The selected diagnostic profile and actual `@fabric/fabric_exec` invocation are observed.
- One native `_kiro/mcp/elicitation` request receives a response with the same typed ID.
- The response is error `-32603`, `message:"Internal error"`, with the exact missing-handler details above.
- The fixture remains byte-identical: `before-native-approval\n`.
- No human accept or decline occurred. Native/diagnostic exit 0 means the diagnostic completed, not that approval succeeded.

### Expected Behavior

Render the requested form and return a genuine human accept/decline/cancel outcome.
If this native client path does not implement form elicitation, please do not
advertise it as supported, and document that limitation. A permissions bypass
would not fix the form-delivery contract.

### Additional Context

- Related: https://github.com/kirodotdev/Kiro/issues/4580. Its contributor follow-up
  distinguished IDE support from CLI support; the later backlog closure invited a
  fresh current-version report. This report supplies a specific CLI v3 failure.
- Related but not identical: https://github.com/kirodotdev/Kiro/issues/11385 concerns
  IDE Power-bundled MCP. This reproduction uses direct CLI MCP configuration.
- Two independent local native runs observed the same handler error. Raw recordings,
  local paths, native conversation IDs, account details and credentials are not attached.
- After a fix, the local human terminal matrix tests both choices and exact effects;
  this diagnostic itself does not qualify interactive approval or revocation.
