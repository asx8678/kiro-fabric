# Security

Report vulnerabilities privately to the repository maintainers. The model sees only `@fabric/fabric_exec`; native tools, ambient MCP and Powers are disabled. Raw operator compatibility endpoints are not model permissions. Strict semantic TypeScript checking precedes QuickJS execution with no ambient host imports, process/environment/filesystem/shell/timers or unrestricted network.

Registry-backed local files and `/bin/sh` are explicit host capabilities, not sandbox APIs. Exact provider/action/arguments/risk/workspace policy remains authoritative; outer exec allowance grants no nested approval. Network and stdio execution approvals remain distinct. Independent bounds cover source, input/output, nested results, heap, deadlines, provider calls, approvals, audit and shutdown.

Local path/identity checks and cooperating write-effect locks are defense in depth, not race-proof OS isolation against a malicious same-user filesystem actor. Shell cwd is not confinement; deliberate process-group escape is not contained. Shell excludes backend-specific credentials conservatively, bounds output, and awaits process cleanup; timeout/cancellation/uncertain cleanup fail even with settle:true. No managed background jobs or native fallback exist.

Missing roots, ambiguous workspaces, changed identity, missing/malformed/declined/timed-out elicitation, unsafe files and indeterminate effects fail closed. Workspace selection must not mix with effects and commits only after successful guest settlement. Prior completed effects cannot be rolled back; inspect partial progress before retrying. Bundled help is immutable; inherited user/workspace resources remain part of Kiro's prompt envelope.
