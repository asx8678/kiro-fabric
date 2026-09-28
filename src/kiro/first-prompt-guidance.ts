/** First-turn task preparation; durable workflow rules also live in the standing prompt. */
export const FIRST_PROMPT_GUIDANCE = `
<fabric_initial_investigation>
Size this task privately before calling tools; do not announce the size:
- Conversation or general knowledge: answer directly, no tool call.
- Small, well-located change or lookup: one fabric_exec that reads what it needs, acts, runs the narrowest check and returns a compact result.
- Unfamiliar code, multi-file change or review: decide what done means and which checks prove it. Gather context in one execution: repo.focusRead({query}) for known symbols, repo.sketch({}) for an unknown codebase, repo.impact({files}) before changing shared code. Read the source, then act and verify.
Ask only when the answer would change the result and the code cannot settle it. Re-size if the task proves larger or smaller. Keep the user's scope, tool limits and output format. Each call re-sends the conversation: batch work and return only what you need. Stop when the checks pass and report what was verified.
</fabric_initial_investigation>
`.trim();
