// Static detection lets Fabric start known orchestration programs with the
// longer agent deadline. The runtime also extends the deadline when a
// blocking agent ref is discovered dynamically through tools.call().
const BLOCKING_ORCHESTRATION_REFS = new Set([
  "agents.run",
  "agents.wait",
  "agents.ask",
]);

export const isBlockingOrchestrationRef = (ref: string): boolean =>
  BLOCKING_ORCHESTRATION_REFS.has(ref);

// Match blocking Kiro-native guest entry points as call sites. A trailing
// parenthesis distinguishes calls from strings and property references.
const ORCHESTRATION_RE =
  /\b(?:workflow\.agent|agents\.(?:run|wait|ask))\s*\(|(?<!\.)\bagent\s*(?:<[^<>]*>)?\s*\(/;

export const codeUsesOrchestration = (code: string): boolean =>
  ORCHESTRATION_RE.test(code);
