/**
 * Task-shape router — decides WHEN to use multi-agent Fabric orchestration
 * and with which model/effort per role.
 *
 * Motivation (benchmark findings): Fabric saved ~30-40% credits on broad
 * audits but cost ~40% MORE on a narrow ten-claim verification task. The
 * router therefore scores a task's shape and, when the search space is
 * bounded, returns a deliberate `single`/`bypass` verdict ("run with one
 * agent") rather than always spawning a swarm. It also selects model/effort
 * per role so a repository mapper does not spend reasoner-level credits
 * counting files (rec #10 scale).
 */

/** Execution strategy for a task (consumed internally by {@link RouteResult}). */
type TaskKind = "fabric" | "single" | "writer_plus_review";

/** Roles map to a suggested effort level (rec #10). */
export type Role =
  | "mapper"        // repository / file enumeration            low effort
  | "investigator"  // file + grep investigation                low
  | "classifier"    // test-output parsing                      low/medium
  | "security"      // security / transaction review            medium
  | "verifier"      // falsification agent                      medium
  | "fixer"         // concurrency / architecture fix           medium/high
  | "formatter"     // final report synthesis                   low
  | "resolver";     // contradiction resolution                 medium

export type EffortLevel = "low" | "medium" | "high";

export interface RoutingFeatures {
  /** Estimated number of files likely touched (breadth of search space). */
  likelyFiles: number;
  /** Number of independent domains to investigate. */
  independentDomains: number;
  /** True when the answer set is already bounded (fixed claim list, one function). */
  answerBounded: boolean;
  /** True when the task requires modifying production code. */
  requiresModification: boolean;
  /** True when the work can be safely parallelized across read-only agents. */
  safelyParallelizable: boolean;
  /** Expected one-time cost of the required commands (0 = cheap ... 1 = very expensive). */
  expectedCommandCost: number;
  /** Expected context size (0 = small ... 1 = huge). */
  expectedContextSize: number;
}

/** Per-role execution profile (rec #10 model/effort selection). */
export interface RoleProfile {
  effort: EffortLevel;
  /** model selection hint; undefined = inherit parent default. */
  modelTier: "default" | "reasoner";
}

export const ROLE_PROFILES: Record<Role, RoleProfile> = {
  mapper:       { effort: "low",    modelTier: "default" },
  investigator: { effort: "low",    modelTier: "default" },
  classifier:   { effort: "low",    modelTier: "default" },
  security:     { effort: "medium", modelTier: "reasoner" },
  verifier:     { effort: "medium", modelTier: "reasoner" },
  fixer:        { effort: "high",   modelTier: "reasoner" },
  formatter:    { effort: "low",    modelTier: "default" },
  resolver:     { effort: "medium", modelTier: "reasoner" },
};

export interface RouteResult {
  kind: TaskKind;
  reasons: string[];
  /** 0..1 orchestration benefit; a low score drives the bypass verdict. */
  score: number;
}

/**
 * Score a task's shape and decide whether Fabric orchestration pays off.
 *
 * - Broad, uncertain, safely-parallel search spaces -> "fabric".
 * - Narrow / bounded answer sets -> "single" (bypass the swarm).
 * - Code modification -> "writer_plus_review": exactly one writer, optional
 *   parallel read-only reviewers.
 *
 * The router is explicitly allowed to answer "this task does not benefit from
 * multi-agent orchestration" — that is a feature, not a failure.
 */
export function routeTask(features: RoutingFeatures): RouteResult {
  const reasons: string[] = [];
  let score = 0;

  // Breadth / uncertainty of the search space.
  const breadthNormalized = Math.min(1, features.likelyFiles / 50);
  score += breadthNormalized * (features.independentDomains > 1 ? 0.3 : 0.15);
  if (features.likelyFiles > 20) {
    score += 0.15;
    reasons.push("large search space");
  }
  if (features.independentDomains > 1) {
    score += 0.1;
    reasons.push(`${features.independentDomains} independent domains`);
  }

  // Bounded answer sets lean away from orchestration.
  if (features.answerBounded) {
    score -= 0.35;
    reasons.push("answer set is already bounded");
  }

  // Parallelization only pays off when it is safe.
  if (features.safelyParallelizable) {
    score += 0.15;
    reasons.push("work is safely parallelizable");
  } else {
    score -= 0.15;
    reasons.push("work is not safely parallelizable (shared mutable state)");
  }

  // Expensive commands and large context justify a shared command broker.
  if (features.expectedCommandCost > 0.6) {
    score += 0.1;
    reasons.push("expensive commands benefit from a central command broker");
  }
  if (features.expectedContextSize > 0.6) {
    score += 0.1;
    reasons.push("large context benefits from read-only scouts");
  }

  // Determine the execution kind.
  let kind: TaskKind;
  if (features.requiresModification) {
    kind = "writer_plus_review";
    score = Math.max(score, 0.5); // modification always deserves the pipeline
    reasons.push("modifies production code -> single-writer workflow");
  } else if (score < 0.3) {
    kind = "single";
    reasons.push("search space is bounded; multi-agent orchestration would add overhead");
  } else {
    kind = "fabric";
  }

  return { kind, reasons, score: clamp(score, 0, 1) };
}

/**
 * Resolve what a single spawned child should be configured with, deriving
 * effort/model selection from its role (rec #10). "Reasoner"-tier roles return
 * a high-effort hint; the spawner translates these into concrete model +
 * thinking values at the provider boundary.
 */
export function roleHints(role: Role): { effort: EffortLevel; modelTier: "default" | "reasoner"; thinking: string } {
  const profile = ROLE_PROFILES[role];
  return {
    effort: profile.effort,
    modelTier: profile.modelTier,
    thinking: thinkingFor(profile.effort),
  };
}

const thinkingFor = (effort: EffortLevel): string => {
  switch (effort) {
    case "low": return "minimal";
    case "medium": return "medium";
    case "high": return "high";
  }
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
/**
 * Cheap-first validation plan (V5). A change maps to an ordered list of
 * disproof stages, from the cheapest sufficient oracle to the most expensive
 * real-model check. The planner never executes anything — it returns a plan
 * that a controller can truncate after any stage. Deterministic oracles
 * (protocol / filesystem / tests / certificates) always outrank model review.
 */
type ValidationStageKind =
  | "static_check"
  | "focused_test"
  | "broker_cached"
  | "integration_probe"
  | "packed_certification"
  | "endurance"
  | "model_review"
  | "real_model_eval";

interface ValidationStage {
  kind: ValidationStageKind;
  label: string;
  /** True when this stage can run in ordinary PR CI (non-billable, no network). */
  ciSafe: boolean;
  /** One-line predicate that decides whether the controller may advance past it. */
  advanceWhen?: string;
}

export interface CheapFirstPlan {
  version: 5;
  stages: ValidationStage[];
  rationale: string;
}

const baseStages = (surface: string): ValidationStage[] => [
  { kind: "static_check", label: `${surface} typecheck/lint`, ciSafe: true, advanceWhen: "clean" },
  { kind: "focused_test", label: `${surface} focused unit test`, ciSafe: true, advanceWhen: "green" },
  { kind: "integration_probe", label: `${surface} live protocol/CLI probe`, ciSafe: true, advanceWhen: "mechanical oracle passes" },
  { kind: "packed_certification", label: `${surface} packed non-billable certificate`, ciSafe: true },
  { kind: "endurance", label: `${surface} offline context certificate`, ciSafe: false },
  { kind: "model_review", label: `${surface} advisory model review`, ciSafe: false },
  { kind: "real_model_eval", label: `${surface} blinded billable eval`, ciSafe: false },
];

export function cheapFirstPlan(features: RoutingFeatures): CheapFirstPlan {
  const boundedLowCost =
    features.answerBounded &&
    features.likelyFiles <= 20 &&
    !features.requiresModification &&
    features.expectedCommandCost <= 0.3;
  const surface = features.requiresModification ? "modifying-change" : "bounded-verification";
  const full = baseStages(surface);
  const stages = boundedLowCost ? full.filter((s) => s.ciSafe || s.kind === "endurance") : full;
  return {
    version: 5,
    stages: stages.map((s, i) => {
      if (i === 0) {
        // entry stage carries no advance predicate
        return { kind: s.kind, label: s.label, ciSafe: s.ciSafe };
      }
      return s;
    }),
    rationale: boundedLowCost
      ? "bounded answer set: prefer cheap deterministic disproof over orchestration spend"
      : "broad/modifying surface: escalate cheap oracles to evidence; keep model review + billable eval last",
  };
}

export function routeAndPlan(features: RoutingFeatures): { result: RouteResult; plan: CheapFirstPlan } {
  return { result: routeTask(features), plan: cheapFirstPlan(features) };
}
