// Host-neutral session approval state. Extracted from approval-controller.ts
// so the execution engine and the Kiro adapter can share it without statically
// importing the Pi approval UI (which pulls in pi-tui).

import { randomUUID } from "node:crypto";
import type { FabricRisk } from "../protocol.js";
import { stableJsonHash } from "./stable-hash.js";

export interface FabricAutoApprovalAudit {
  action: string;
  risk: FabricRisk;
  decision: "allow" | "escalate";
  reason: string;
  model?: string;
  error?: string;
  at: number;
}

/** Hash-only execution context used to bind an approval without retaining code or paths. */
export interface FabricApprovalScope {
  planDigest?: string;
  projectDigest?: string;
}

export type FabricApprovalLeaseSource =
  | "policy"
  | "inherited"
  | "session"
  | "allow-once"
  | "auto"
  | "explicit-broad";

export interface FabricApprovalLeaseAudit {
  leaseId: string;
  source: FabricApprovalLeaseSource;
  action: string;
  risk: FabricRisk;
  descriptorDigest: string;
  argumentDigest: string;
  planDigest?: string;
  projectDigest?: string;
  issuedAt: number;
  expiresAt: number;
  consumedAt: number;
}

export interface FabricApprovalAction {
  ref: string;
  provider: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  risk: FabricRisk;
  namespace?: string;
  effect?: unknown;
}

export interface FabricApprovalLease {
  readonly id: string;
  readonly expiresAt: number;
  consume(
    action: FabricApprovalAction,
    args: Record<string, unknown>,
    scope?: FabricApprovalScope,
  ): FabricApprovalLeaseAudit;
}

interface FabricApprovalBinding {
  action: string;
  risk: FabricRisk;
  descriptorDigest: string;
  argumentDigest: string;
  planDigest?: string;
  projectDigest?: string;
}

interface LeaseRecord {
  binding: FabricApprovalBinding;
  source: FabricApprovalLeaseSource;
  issuedAt: number;
  expiresAt: number;
  consumedAt?: number;
}

const FABRIC_APPROVAL_LEASE_TTL_MS = 30_000;

const digest = (domain: string, value: unknown): string =>
  stableJsonHash([domain, value]);

export const fabricApprovalArgumentDigest = (args: Record<string, unknown>): string =>
  digest("fabric.approval.arguments.v1", args);

/** Build a safe scope once at the execution boundary; raw code and paths are not retained. */
export const fabricApprovalScope = (input: {
  plan?: string;
  project?: string;
}): FabricApprovalScope => ({
  ...(input.plan === undefined ? {} : { planDigest: digest("fabric.approval.plan.v1", input.plan) }),
  ...(input.project === undefined
    ? {}
    : { projectDigest: digest("fabric.approval.project.v1", input.project) }),
});

const approvalBinding = (
  action: FabricApprovalAction,
  args: Record<string, unknown>,
  scope: FabricApprovalScope = {},
): FabricApprovalBinding => ({
  action: action.ref,
  risk: action.risk,
  descriptorDigest: digest("fabric.approval.descriptor.v1", {
    ref: action.ref,
    provider: action.provider,
    name: action.name,
    description: action.description,
    inputSchema: action.inputSchema,
    outputSchema: action.outputSchema,
    risk: action.risk,
    namespace: action.namespace,
    effect: action.effect,
  }),
  argumentDigest: fabricApprovalArgumentDigest(args),
  ...(scope.planDigest === undefined ? {} : { planDigest: scope.planDigest }),
  ...(scope.projectDigest === undefined ? {} : { projectDigest: scope.projectDigest }),
});

const sameBinding = (left: FabricApprovalBinding, right: FabricApprovalBinding): boolean =>
  left.action === right.action &&
  left.risk === right.risk &&
  left.descriptorDigest === right.descriptorDigest &&
  left.argumentDigest === right.argumentDigest &&
  left.planDigest === right.planDigest &&
  left.projectDigest === right.projectDigest;

class FabricApprovalLeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FabricApprovalLeaseError";
  }
}

export class FabricSessionApprovals {
  readonly approvedRisks = new Set<FabricRisk>();
  readonly #leases = new Map<string, LeaseRecord>();
  readonly #clock: () => number;
  readonly #leaseTtlMs: number;
  #tail: Promise<void> = Promise.resolve();

  constructor(options: { clock?: () => number; leaseTtlMs?: number } = {}) {
    this.#clock = options.clock ?? Date.now;
    this.#leaseTtlMs = Math.max(1, Math.floor(options.leaseTtlMs ?? FABRIC_APPROVAL_LEASE_TTL_MS));
  }

  issueLease(
    action: FabricApprovalAction,
    args: Record<string, unknown>,
    scope: FabricApprovalScope,
    source: FabricApprovalLeaseSource,
  ): FabricApprovalLease {
    const id = randomUUID();
    const issuedAt = this.#clock();
    const record: LeaseRecord = {
      binding: approvalBinding(action, args, scope),
      source,
      issuedAt,
      expiresAt: issuedAt + this.#leaseTtlMs,
    };
    this.#leases.set(id, record);
    this.#prune(issuedAt);
    return {
      id,
      expiresAt: record.expiresAt,
      consume: (candidateAction, candidateArgs, candidateScope = {}) =>
        this.#consume(id, approvalBinding(candidateAction, candidateArgs, candidateScope)),
    };
  }

  #consume(id: string, candidate: FabricApprovalBinding): FabricApprovalLeaseAudit {
    // No await occurs between lookup, validation, and the consumed marker. In the
    // JS host this is one atomic critical section, so concurrent consumers cannot
    // both observe an unused lease.
    const record = this.#leases.get(id);
    if (!record) throw new FabricApprovalLeaseError("Fabric approval lease is unknown or retired");
    if (record.consumedAt !== undefined) {
      throw new FabricApprovalLeaseError("Fabric approval lease has already been consumed");
    }
    const now = this.#clock();
    if (now >= record.expiresAt) {
      record.consumedAt = now;
      throw new FabricApprovalLeaseError("Fabric approval lease has expired");
    }
    // Burn a mismatched lease as well. A failed substitution must not leave an
    // authorization token available for a corrected replay.
    record.consumedAt = now;
    if (!sameBinding(record.binding, candidate)) {
      throw new FabricApprovalLeaseError("Fabric approval lease binding does not match this call");
    }
    return {
      leaseId: id,
      source: record.source,
      action: record.binding.action,
      risk: record.binding.risk,
      descriptorDigest: record.binding.descriptorDigest,
      argumentDigest: record.binding.argumentDigest,
      ...(record.binding.planDigest === undefined ? {} : { planDigest: record.binding.planDigest }),
      ...(record.binding.projectDigest === undefined
        ? {}
        : { projectDigest: record.binding.projectDigest }),
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
      consumedAt: now,
    };
  }

  #prune(now: number): void {
    // Keep consumed IDs long enough to diagnose ordinary replay, but cap memory.
    if (this.#leases.size <= 2_048) return;
    for (const [id, record] of this.#leases) {
      if (record.consumedAt !== undefined && now - record.consumedAt > this.#leaseTtlMs) {
        this.#leases.delete(id);
      }
      if (this.#leases.size <= 1_024) break;
    }
  }

  async serialize<T>(request: () => Promise<T>): Promise<T> {
    const previous = this.#tail;
    let release: (() => void) | undefined;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await request();
    } finally {
      release?.();
    }
  }
}
