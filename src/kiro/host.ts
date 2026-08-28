// Host-neutral seam for FabricExecutionService. A host supplies exactly the
// host-specific policy the engine needs — working directory, model listing,
// and the approval surface — instead of the engine importing Pi types. The
// Pi adapter provides the real ExtensionContext-backed host; the Kiro MCP
// adapter provides a fail-closed host because managed Kiro does not delegate
// nested Fabric approval decisions to the MCP client.

import type { FabricActionDescriptor, FabricRisk } from "../protocol.js";
import type { FabricAutoApprovalAudit } from "../core/session-approvals.js";

export interface FabricResolvedAction extends FabricActionDescriptor {
  ref: string;
  provider: string;
}

/** Host-neutral subset of token/cost accounting used by the engine. */
export interface FabricUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number;
  reasoning?: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export interface FabricHostAutoApprovalDecision {
  decision: "allow" | "escalate";
  reason: string;
  model: string;
  usage: FabricUsage;
}

interface FabricModelDescriptor {
  provider: string;
  id: string;
  name: string;
  key: string;
}

export interface FabricHostApprover {
  /**
   * Gate an action. Must throw to deny. Implementations must fail closed:
   * when approval is unavailable (no UI, no elicitation), `ask` and `auto`
   * policies must throw a stable diagnostic rather than auto-allow.
   */
  approve(action: FabricResolvedAction, args: Record<string, unknown>): Promise<void>;
}

export interface FabricExecutionHost {
  readonly cwd: string;
  /**
   * Opaque host payload carried through to providers as
   * `FabricInvocationContext.extensionContext`. Pi passes the live
   * ExtensionContext; Kiro passes a minimal structural context.
   */
  readonly payload: unknown;
  /**
   * Whether agent-backed helpers can account for child usage before applying
   * workflow budgets. Hosts that return mandatory `usage: unavailable` must
   * set this false: workflow.agent is then omitted from both the guest
   * declarations and runtime, while direct agents.* calls remain usable.
   * Omitted preserves the shared Pi behavior.
   */
  readonly agentBackedOrchestration?: boolean;
  /** Default runner used to preflight accounting-sensitive workflow helpers. */
  readonly defaultAgentRunner?: string;
  /** Runners whose usage cannot be known until after a child has executed. */
  readonly unaccountedAgentRunners?: readonly string[];
  /** Models surfaced by `fabric.$models`; absent → empty list. */
  listModels?(): FabricModelDescriptor[];
  createApprover(
    recordAutoDecision: (
      audit: FabricAutoApprovalAudit,
      decision?: FabricHostAutoApprovalDecision,
    ) => void,
    onAutoUsage?: (usage: FabricUsage) => void,
  ): FabricHostApprover;
}

export interface FabricApprovalModeConfig {
  read: string;
  write: string;
  execute: string;
  network: string;
  agent: string;
  model?: string;
}

const APPROVED_SESSION_RISKS = Symbol("fabric.approvedSessionRisks");

export type FabricSessionRiskSet = Set<FabricRisk> & { [APPROVED_SESSION_RISKS]?: true };

/**
 * Fail-closed approval policy shared by hosts without an interactive surface.
 * `allow` config and session-granted risks pass; everything else denies with a
 * stable diagnostic. This is the Kiro behavior: no MCP elicitation means any
 * approval-requiring action is rejected before its side effect.
 */
export class FabricDenyApprovalFallback implements FabricHostApprover {
  constructor(
    readonly config: FabricApprovalModeConfig,
    readonly sessionApprovals: FabricSessionRiskSet,
    readonly unavailableReason: string,
  ) {}

  async approve(action: FabricResolvedAction): Promise<void> {
    const mode = this.config[action.risk];
    if (mode === "allow" || this.sessionApprovals.has(action.risk)) return;
    throw new Error(
      `${action.ref} requires ${action.risk} approval, but ${this.unavailableReason}`,
    );
  }
}
