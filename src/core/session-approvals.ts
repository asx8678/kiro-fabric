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

interface LeaseHandleRecord {
  session: FabricSessionApprovals;
  id: string;
  /** A composite approval can bind one lease to a stricter synthetic descriptor. */
  action?: FabricApprovalAction;
}

const leaseHandles = new WeakMap<FabricApprovalLease, LeaseHandleRecord>();

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

interface LeaseCoordinator {
  now(): number;
  validate(id: string, candidate: FabricApprovalBinding, now: number): LeaseRecord;
  consume(id: string, record: LeaseRecord, now: number): FabricApprovalLeaseAudit;
  burn(id: string, now: number): void;
}

const leaseCoordinators = new WeakMap<FabricSessionApprovals, LeaseCoordinator>();
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
    leaseCoordinators.set(this, {
      now: () => this.#clock(),
      validate: (id, candidate, now) => this.#validateLease(id, candidate, now),
      consume: (id, record, now) => this.#consumeValidatedLease(id, record, now),
      burn: (id, now) => this.#burnLease(id, now),
    });
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
    const lease: FabricApprovalLease = {
      id,
      expiresAt: record.expiresAt,
      consume: (candidateAction, candidateArgs, candidateScope = {}) =>
        consumeFabricApprovalLease(lease, candidateAction, candidateArgs, candidateScope),
    };
    leaseHandles.set(lease, { session: this, id });
    return lease;
  }

  #validateLease(id: string, candidate: FabricApprovalBinding, now: number): LeaseRecord {
    const record = this.#leases.get(id);
    if (!record) throw new FabricApprovalLeaseError("Fabric approval lease is unknown or retired");
    if (record.consumedAt !== undefined) {
      throw new FabricApprovalLeaseError("Fabric approval lease has already been consumed");
    }
    if (now >= record.expiresAt) {
      throw new FabricApprovalLeaseError("Fabric approval lease has expired");
    }
    if (!sameBinding(record.binding, candidate)) {
      throw new FabricApprovalLeaseError("Fabric approval lease binding does not match this call");
    }
    return record;
  }

  #consumeValidatedLease(id: string, record: LeaseRecord, now: number): FabricApprovalLeaseAudit {
    if (this.#leases.get(id) !== record || record.consumedAt !== undefined) {
      throw new FabricApprovalLeaseError("Fabric approval lease changed during consumption");
    }
    record.consumedAt = now;
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

  #burnLease(id: string, now: number): void {
    const record = this.#leases.get(id);
    if (record && record.consumedAt === undefined) record.consumedAt = now;
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

/** Bind one member of a composite approval to the descriptor actually approved. */
export const bindFabricApprovalLease = (
  lease: FabricApprovalLease,
  action: FabricApprovalAction,
): FabricApprovalLease => {
  const handle = leaseHandles.get(lease);
  if (!handle) throw new FabricApprovalLeaseError("Fabric approval lease cannot be delegated");
  const bound: FabricApprovalLease = {
    id: lease.id,
    expiresAt: lease.expiresAt,
    consume: (_action, args, scope = {}) =>
      consumeFabricApprovalLease(bound, action, args, scope),
  };
  leaseHandles.set(bound, { ...handle, action });
  return bound;
};

const consumeFabricApprovalLease = (
  lease: FabricApprovalLease,
  action: FabricApprovalAction,
  args: Record<string, unknown>,
  scope: FabricApprovalScope,
): FabricApprovalLeaseAudit => {
  try {
    return consumeFabricApprovalLeases([lease], action, args, scope)[0]!;
  } catch (error) {
    // A substituted or expired standalone token is burned. Composite grants
    // use the exported batch coordinator below and remain all-or-none.
    const handle = leaseHandles.get(lease);
    const coordinator = handle ? leaseCoordinators.get(handle.session) : undefined;
    if (handle && coordinator) coordinator.burn(handle.id, coordinator.now());
    throw error;
  }
};

/**
 * Validate a composite grant completely, then consume every member in one
 * synchronous critical section. A bad/expired/replayed member consumes none.
 */
export const consumeFabricApprovalLeases = (
  leases: readonly FabricApprovalLease[],
  action: FabricApprovalAction,
  args: Record<string, unknown>,
  scope: FabricApprovalScope = {},
): FabricApprovalLeaseAudit[] => {
  if (leases.length === 0) {
    throw new FabricApprovalLeaseError("Fabric approval grant contains no leases");
  }
  const seen = new Map<FabricSessionApprovals, Set<string>>();
  const pending = leases.map((lease) => {
    const handle = leaseHandles.get(lease);
    if (!handle) throw new FabricApprovalLeaseError("Fabric approval lease is not host-issued");
    const sessionIds = seen.get(handle.session) ?? new Set<string>();
    if (sessionIds.has(handle.id)) throw new FabricApprovalLeaseError("Fabric approval grant repeats a lease");
    sessionIds.add(handle.id);
    seen.set(handle.session, sessionIds);
    const coordinator = leaseCoordinators.get(handle.session);
    if (!coordinator) throw new FabricApprovalLeaseError("Fabric approval lease issuer is unavailable");
    const candidate = approvalBinding(handle.action ?? action, args, scope);
    const now = coordinator.now();
    return {
      ...handle,
      coordinator,
      now,
      record: coordinator.validate(handle.id, candidate, now),
    };
  });
  return pending.map(({ coordinator, id, record, now }) =>
    coordinator.consume(id, record, now));
};
