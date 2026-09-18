/** First-turn task reminder; durable workflow rules live in the standing prompt. */
export const FIRST_PROMPT_GUIDANCE = `
<fabric_initial_investigation>
Apply the standing task contract: answer, plan, review or authorized implementation. Resume the next unresolved acceptance check; do not widen scope by default. Stop at acceptance or report the exact blocker without claiming completion.
</fabric_initial_investigation>
`.trim();
