# Security

Report vulnerabilities privately to the repository maintainers. Kiro Fabric executes guest code only after strict semantic TypeScript checking and only in QuickJS, without host imports, process/environment/filesystem/shell/timers, native Kiro tools, or unrestricted network. Independent bounds cover source, input/output, nested results, heap, deadlines, provider calls, approvals, audit, and shutdown.

Native Kiro operations use Kiro permissions. Fabric nested effects separately require exact provider/action/arguments/risk/workspace approval; network and stdio process execution approvals are distinct. Missing roots, ambiguous workspaces, changed identity, missing/malformed/declined/timed-out elicitation, cancellation, unsafe files, or indeterminate effects fail closed.
