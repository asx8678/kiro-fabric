import { randomUUID } from "node:crypto";
import { runAbortable, throwIfAbortedOrExpired } from "../async-settlement.js";
import type {
  FabricActionDescriptor,
  FabricInvocationContext,
  FabricProvider,
  FabricProviderStatus,
  ResolvedFabricAction,
} from "../protocol.js";
import { schemaValidationMessage } from "../schema-validation.js";
import { fabricJsonText, MAX_FABRIC_JSON_CHARS } from "../runtime/json-budget.js";

export interface FabricCallAudit {
  ref: string;
  nestedToolCallId: string;
  startedAt: number;
  endedAt?: number;
  success?: boolean;
  error?: string;
  resultChars?: number;
  resultTruncated?: boolean;
}

export interface FabricRegistryInvocationContext extends FabricInvocationContext {
  audits: FabricCallAudit[];
  maxResultChars: number;
  maxAuditEntries?: number;
  maxAuditBytes?: number;
  auditBudget?: { bytes: number };
  approve(action: ResolvedFabricAction, args: Record<string, unknown>): Promise<void>;
}

const providerName = /^[a-z][a-z0-9_-]{0,63}$/u;
const MAX_ACTION_REFERENCE_CHARS = 512;
const MAX_SEARCH_QUERY_CHARS = 2_000;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const resolved = (provider: FabricProvider, descriptor: FabricActionDescriptor): ResolvedFabricAction => ({
  ...structuredClone(descriptor),
  provider: provider.name,
  ref: `${provider.name}.${descriptor.name}`,
});

const boundedResult = (value: unknown, maximum: number): { value: unknown; chars: number; truncated: boolean } => {
  const text = fabricJsonText(value, MAX_FABRIC_JSON_CHARS);
  if (text.length <= maximum) return { value, chars: text.length, truncated: false };
  return {
    value: { fabricTruncated: true, originalChars: text.length, preview: text.slice(0, Math.max(1, maximum - 100)) },
    chars: text.length,
    truncated: true,
  };
};

const overlaps = (left: readonly string[], right: readonly string[]): boolean =>
  left.includes("*") || right.includes("*") || left.some((entry) => right.includes(entry));
const deepFreeze = <T>(value: T): T => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
};
const AUDIT_RESERVATION_BYTES = 2_048;

export class ActionRegistry {
  readonly #providers = new Map<string, FabricProvider>();
  readonly #unavailable = new Map<string, string>();
  readonly #activeWrites = new Map<string, { ref: string; resources: readonly string[] }>();

  register(provider: FabricProvider): void {
    if (!providerName.test(provider.name)) throw new Error(`Invalid Fabric provider name: ${provider.name}`);
    if (this.#providers.has(provider.name)) throw new Error(`Fabric provider already registered: ${provider.name}`);
    this.#providers.set(provider.name, provider);
    this.#unavailable.delete(provider.name);
  }

  markUnavailable(name: string, reason: string): void {
    if (!providerName.test(name) || this.#providers.has(name)) return;
    this.#unavailable.set(name, reason);
  }

  has(name: string): boolean { return this.#providers.has(name); }

  providers(): FabricProviderStatus[] {
    return [
      ...[...this.#providers.values()].map((provider) => ({ name: provider.name, description: provider.description, available: true as const })),
      ...[...this.#unavailable].map(([name, reason]) => ({ name, description: reason, available: false as const, reason })),
    ].sort((left, right) => left.name.localeCompare(right.name));
  }

  async list(): Promise<ResolvedFabricAction[]> {
    const lists = await Promise.all([...this.#providers.values()].map(async (provider) =>
      (await provider.list()).map((descriptor) => resolved(provider, descriptor))));
    return lists.flat().sort((left, right) => left.ref.localeCompare(right.ref));
  }

  async search(query: string, limit = 30): Promise<ResolvedFabricAction[]> {
    if (query.length > MAX_SEARCH_QUERY_CHARS) throw new Error("Fabric search query exceeds 2000 characters");
    const normalized = query.normalize("NFKC").trim().toLowerCase();
    if (!normalized) return [];
    if (normalized.length > MAX_SEARCH_QUERY_CHARS) throw new Error("Normalized Fabric search query exceeds 2000 characters");
    return (await this.list())
      .filter((action) => `${action.ref} ${action.description}`.toLowerCase().includes(normalized))
      .slice(0, Math.max(1, Math.min(100, Math.floor(limit))));
  }

  async describe(ref: string): Promise<ResolvedFabricAction> {
    if (ref.length > MAX_ACTION_REFERENCE_CHARS) throw new Error("Fabric action reference exceeds 512 characters");
    const separator = ref.indexOf(".");
    if (separator <= 0) throw new Error(`Fabric action reference must be provider.action: ${ref}`);
    const provider = this.#providers.get(ref.slice(0, separator));
    if (!provider) throw new Error(`Unknown Fabric provider: ${ref.slice(0, separator)}`);
    const descriptor = await provider.describe(ref.slice(separator + 1));
    if (!descriptor) throw new Error(`Unknown Fabric action: ${ref}`);
    return resolved(provider, descriptor);
  }

  async invoke(ref: string, args: Record<string, unknown>, context: FabricRegistryInvocationContext): Promise<unknown> {
    throwIfAbortedOrExpired(context.signal, context.deadline);
    if (!isRecord(args)) throw new Error(`Arguments for ${ref} must be an object`);
    const action = await this.describe(ref);
    const provider = this.#providers.get(action.provider)!;
    const prepared = provider.prepareArguments
      ? await runAbortable(context.signal, () => provider.prepareArguments!(action.name, structuredClone(args), context))
      : structuredClone(args);
    throwIfAbortedOrExpired(context.signal, context.deadline);
    if (!isRecord(prepared)) throw new Error(`Argument preparation for ${ref} must return an object`);
    const invalid = schemaValidationMessage(action.inputSchema, prepared);
    if (invalid) throw new Error(`Invalid arguments for ${ref}: ${invalid}`);

    // Preparation, schema validation, and resource calculation all precede approval.
    // The frozen canonical snapshot is never normalized or mutated afterwards.
    const canonicalArgs = deepFreeze(structuredClone(prepared));
    const resources = Object.freeze([...(provider.effectResources?.(action.name, structuredClone(canonicalArgs), context)
      ?? action.effect?.resources
      ?? (action.risk === "write" ? ["*"] : []))]);
    const writeLike = action.risk === "write" || action.effect?.kind === "write";
    const nestedToolCallId = `fabric_${randomUUID()}`;
    if (context.audits.length >= (context.maxAuditEntries ?? Number.POSITIVE_INFINITY)) throw new Error("Fabric audit entry quota exceeded");
    const audit: FabricCallAudit = { ref, nestedToolCallId, startedAt: Date.now() };
    const auditBudget = context.auditBudget ?? { bytes: 0 };
    if (auditBudget.bytes + AUDIT_RESERVATION_BYTES > (context.maxAuditBytes ?? Number.POSITIVE_INFINITY)) throw new Error("Fabric audit byte quota exceeded");
    if (writeLike) {
      for (const active of this.#activeWrites.values()) {
        if (overlaps(resources, active.resources)) throw new Error(`Overlapping write rejected: ${ref} conflicts with ${active.ref}`);
      }
      // Reserve write intent before prompting so an approval flood cannot queue
      // conflicting side effects or dialogs.
      this.#activeWrites.set(nestedToolCallId, { ref, resources });
    }
    context.audits.push(audit);
    auditBudget.bytes += AUDIT_RESERVATION_BYTES;
    try {
      // Approval cleanup remains part of the reservation lifetime. Racing the
      // promise would release write intent while an elicitation was still live.
      await context.approve(structuredClone(action), structuredClone(canonicalArgs));
      throwIfAbortedOrExpired(context.signal, context.deadline);
      const invocationArgs = structuredClone(canonicalArgs);
      // Providers receive the request signal and own cancellation cleanup.
      // Await their settlement so a cooperative provider (notably configured
      // MCP, which closes its contacted server) finishes cleanup before the
      // registry reports cancellation to the guest.
      const value = await provider.invoke(action.name, invocationArgs, context);
      throwIfAbortedOrExpired(context.signal, context.deadline);
      const bounded = boundedResult(value, context.maxResultChars);
      throwIfAbortedOrExpired(context.signal, context.deadline);
      audit.endedAt = Date.now();
      audit.success = true;
      audit.resultChars = bounded.chars;
      audit.resultTruncated = bounded.truncated;
      return bounded.value;
    } catch (error) {
      audit.endedAt = Date.now();
      audit.success = false;
      audit.error = error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000);
      throw error;
    } finally {
      this.#activeWrites.delete(nestedToolCallId);
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.#providers.values()].map((provider) => provider.close?.()));
    this.#providers.clear();
    this.#activeWrites.clear();
  }
}
