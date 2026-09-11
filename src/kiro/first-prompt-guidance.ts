/** First-turn task reminder; durable workflow rules live in the standing prompt. */
export const FIRST_PROMPT_GUIDANCE = `
<fabric_initial_investigation>
Apply the standing task contract to this request: answer, review or authorized implementation. Start with the next unresolved acceptance check, not a broad audit by default. Preserve required scope and verification; report the exact blocker if unable to proceed.
</fabric_initial_investigation>
`.trim();
