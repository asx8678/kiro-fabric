import type { FabricPrewalkActivation } from "../config.js";

export const PREWALK_DECISION_ENTRY_TYPE = "kiro-fabric-prewalk-decision";

export type FabricPrewalkGateReason =
  | "activation-always"
  | "activation-disabled"
  | "task-unavailable"
  | "no-mutation-intent"
  | "explicitly-narrow"
  | "insufficient-complexity"
  | "broad-change"
  | "multiple-concerns"
  | "multiple-files";

export interface FabricPrewalkGateDecision {
  activation: FabricPrewalkActivation;
  eligible: boolean;
  reason: FabricPrewalkGateReason;
  /** Stable, sorted feature names only; task text is deliberately not retained. */
  signals: string[];
  taskChars: number;
}

const MUTATION = /\b(add|change|configure|create|debug|fix|implement|integrate|migrate|optimi[sz]e|refactor|remove|replace|update|wire)\b/iu;
const BROAD = /\b(across|architecture|cross[- ]cutting|end[- ]to[- ]end|integration|multiple|repo(?:sitory)?[- ]wide|throughout)\b/iu;
const NARROW = /\b(only a typo|single typo|one[- ]line|one line|single[- ]file|single file|just rename)\b/iu;
const CONCERNS: readonly [string, RegExp][] = [
  ["api", /\b(api|contract|interface|wiring)\b/iu],
  ["benchmark", /\b(benchmark|ablation|comparison)\b/iu],
  ["configuration", /\b(config|configuration|setting|option|mode)\b/iu],
  ["documentation", /\b(doc|docs|documentation|readme)\b/iu],
  ["security", /\b(auth|permission|security|trust)\b/iu],
  ["telemetry", /\b(metric|metrics|observability|telemetry|trace)\b/iu],
  ["tests", /\b(test|tests|verification|verify)\b/iu],
];
const FILE_REFERENCE = /(?:^|\s)(?:[\w.-]+\/)+[\w.-]+|\b[\w-]+\.(?:c|cc|cpp|go|java|js|json|md|mjs|py|rs|sh|ts|tsx|yaml|yml)\b/giu;

export const effectiveFabricPrewalkActivation = (prewalk: {
  activation: FabricPrewalkActivation;
  alwaysRearm: boolean;
}): FabricPrewalkActivation => prewalk.alwaysRearm ? "always" : prewalk.activation;

/**
 * Deterministic, deliberately conservative prewalk selector. Gated mode needs
 * explicit mutation intent plus strong evidence that the task spans a broad
 * change, at least three delivery concerns, or at least two named files.
 * No model call, repository state, clock, locale, or random input participates.
 */
export const evaluateFabricPrewalkGate = (
  activation: FabricPrewalkActivation,
  task?: string,
): FabricPrewalkGateDecision => {
  const normalized = task?.trim() ?? "";
  const base = { activation, taskChars: normalized.length };
  if (activation === "always") {
    return { ...base, eligible: true, reason: "activation-always", signals: [] };
  }
  if (activation === "disabled") {
    return { ...base, eligible: false, reason: "activation-disabled", signals: [] };
  }
  if (!normalized) {
    return { ...base, eligible: false, reason: "task-unavailable", signals: [] };
  }
  if (!MUTATION.test(normalized)) {
    return { ...base, eligible: false, reason: "no-mutation-intent", signals: [] };
  }
  if (NARROW.test(normalized)) {
    return { ...base, eligible: false, reason: "explicitly-narrow", signals: ["mutation"] };
  }

  const concerns = CONCERNS.filter(([, pattern]) => pattern.test(normalized)).map(([name]) => name);
  const fileCount = new Set((normalized.match(FILE_REFERENCE) ?? []).map((value) => value.trim())).size;
  const broad = BROAD.test(normalized);
  const signals = [
    "mutation",
    ...(broad ? ["broad"] : []),
    ...concerns.map((name) => `concern:${name}`),
    ...(fileCount >= 2 ? ["multiple-files"] : []),
  ].sort();
  if (broad) return { ...base, eligible: true, reason: "broad-change", signals };
  if (concerns.length >= 3) {
    return { ...base, eligible: true, reason: "multiple-concerns", signals };
  }
  if (fileCount >= 2) return { ...base, eligible: true, reason: "multiple-files", signals };
  return { ...base, eligible: false, reason: "insufficient-complexity", signals };
};
