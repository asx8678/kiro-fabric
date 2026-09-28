/** First-turn task preparation; durable workflow rules also live in the standing prompt. */
export const FIRST_PROMPT_GUIDANCE = `
<fabric_initial_investigation>
Size this task before calling tools:
- Conversation or general knowledge: answer directly, no tool call.
- Small, well-located change or lookup: one fabric_exec that reads what it needs, acts and returns the result.
- Unfamiliar code, multi-file change or review: locate with repo.focusRead({query}) for known symbols or repo.sketch({}) for an unknown codebase, run repo.impact({files}) before changing shared code, read the source, then act.
Keep the user's scope, tool limits and output format. Batch independent reads in one execution. Finish with the checks the change needs, then stop and report what was verified.
</fabric_initial_investigation>
`.trim();
