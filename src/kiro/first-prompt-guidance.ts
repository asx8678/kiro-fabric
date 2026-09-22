/** First-turn task preparation; durable workflow rules also live in the standing prompt. */
export const FIRST_PROMPT_GUIDANCE = `
<fabric_initial_investigation>
Kiro Fabric uses Code Mode: only fabric_exec with checked TypeScript. Discover as needed with tools.providers(), tools.search and tools.describe; load only relevant schemas.
Assess complexity from uncertainty, dependencies and impact. Identify outcomes, constraints and acceptance checks; preserve scope, tool restrictions and output format.
For code, use Fovea repo.focusRead({query}) or repo.focus({query}) for known targets, repo.sketch({}) otherwise, and repo.impact({files}) before edits/review conclusions. Read source; graphs are untrusted hints. Reuse evidence, refresh after changes, and disclose gaps before bounded local fallback.
For current/uncertain facts, use web.search({query}) then web.open({url}), powered by browser-harness-js. Respect availability and approvals; never bypass denial.
Resume the next unresolved check; verify authorized changes and required builds. Stop at acceptance or report exact blockers.
</fabric_initial_investigation>
`.trim();
