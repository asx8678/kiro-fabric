import type { FabricConfig } from "../config.js";
import type { AiRunResult, Metrics } from "../../types/fabric-lite.js";
import { FabricError } from "../errors.js";

export type AiResult<T = unknown> = AiRunResult<T>;

export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export class BudgetState {
  readonly metrics: Metrics = {
    aiCalls: 0,
    workerCalls: 0,
    retries: 0,
    inputChars: 0,
    outputChars: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheHits: 0,
  };
  private roles = { planner: 0, worker: 0, verifier: 0, general: 0 };

  constructor(private readonly config: FabricConfig) {}

  reserve(role: keyof BudgetState["roles"], input: number, retry = false): void {
    const budgets = this.config.budgets;
    if (this.metrics.aiCalls + 1 > budgets.maxAiCalls) {
      throw new FabricError("BUDGET_EXCEEDED", `AI call limit ${budgets.maxAiCalls} exceeded`);
    }
    if (input > budgets.maxPromptCharsPerCall) {
      throw new FabricError(
        "BUDGET_EXCEEDED",
        `AI prompt character budget exceeded (${input} > ${budgets.maxPromptCharsPerCall})`,
      );
    }
    // pi-fabric semantics: the token budget is a spent-based guard checked
    // before each call; usage settles after the call completes, so the check
    // is best-effort and the race-free ceiling is the call-count cap above.
    if (budgets.maxTotalTokens > 0 && this.metrics.totalTokens >= budgets.maxTotalTokens) {
      throw new FabricError(
        "BUDGET_EXCEEDED",
        `AI token budget exhausted (spent ${this.metrics.totalTokens} of ${budgets.maxTotalTokens})`,
      );
    }
    const limits = {
      planner: budgets.maxPlannerCalls,
      worker: budgets.maxWorkerCalls,
      verifier: budgets.maxVerifierCalls,
      general: budgets.maxWorkerCalls,
    };
    if (!retry && limits[role] > 0 && this.roles[role] + 1 > limits[role]) {
      throw new FabricError("BUDGET_EXCEEDED", `${role} call limit ${limits[role]} exceeded`);
    }
    this.metrics.aiCalls++;
    if (!retry) {
      this.roles[role]++;
      if (role === "worker" || role === "general") this.metrics.workerCalls++;
    } else {
      this.metrics.retries++;
    }
  }

  cacheHit(): void {
    this.metrics.cacheHits++;
  }

  /**
   * Record usage after a call settles, matching pi-fabric's
   * append-after-completion accounting. Real runner usage is preferred;
   * otherwise tokens are estimated as ceil(chars / 4). Never throws: like
   * pi-fabric, a single call may overshoot and the next reserve() guards.
   */
  settle(inputChars: number, outputChars: number, usage?: { input: number; output: number }): void {
    this.metrics.inputChars += inputChars;
    this.metrics.outputChars += outputChars;
    const inputTokens = usage ? usage.input : estimateTokens(inputChars);
    const outputTokens = usage ? usage.output : estimateTokens(outputChars);
    this.metrics.inputTokens += inputTokens;
    this.metrics.outputTokens += outputTokens;
    this.metrics.totalTokens += inputTokens + outputTokens;
  }
}
