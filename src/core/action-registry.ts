import { randomUUID } from "node:crypto";
import { runAbortable, throwIfAbortedOrExpired } from "../async-settlement.js";
import type {
  FabricActionDescriptor,
  FabricInvocationContext,
  FabricProvider,
  FabricProviderStatus,
  ResolvedFabricAction,
} from "../protocol.js";
import { fabricCommitAcknowledgement, type FabricCommitAcknowledgement } from "../protocol.js";
import { schemaValidationMessage } from "../schema-validation.js";
import { fabricJsonText, MAX_FABRIC_JSON_CHARS } from "../runtime/json-budget.js";
import { semanticDigest } from "./semantic-digest.js";

export interface FabricCallAudit {
  ref: string;
  nestedToolCallId: string;
  startedAt: number;
  endedAt?: number;
  success?: boolean;
  error?: string;
  resultChars?: number;
  resultTruncated?: boolean;
  /** Trusted, bounded publication fact only; never includes arguments, keys, values, or causes. */
  commitAcknowledgement?: FabricCommitAcknowledgement;
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
const compareCodeUnits = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const resolved = (provider: FabricProvider, descriptor: FabricActionDescriptor): ResolvedFabricAction => {
  const copied = structuredClone(descriptor);
  const ref = `${provider.name}.${descriptor.name}`;
  return {
    ...copied,
    provider: provider.name,
    ref,
    descriptorDigest: semanticDigest("kiro-fabric-action-descriptor-v1", {
      provider: provider.name,
      ref,
      name: copied.name,
      description: copied.description,
      risk: copied.risk,
      inputSchema: copied.inputSchema,
      ...(copied.outputSchema === undefined ? {} : { outputSchema: copied.outputSchema }),
      ...(copied.namespace === undefined ? {} : { namespace: copied.namespace }),
      ...(copied.effect === undefined ? {} : { effect: copied.effect }),
      ...(copied.annotations === undefined ? {} : { annotations: copied.annotations }),
    }),
  };
};

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
const MAX_SEARCHABLE_DESCRIPTOR_CHARS = 32_000;

const normalizedTerms = (value: string): string[] => [...new Set(
  value.split(/[^\p{L}\p{N}_.$-]+/u).filter(Boolean).slice(0, 64),
)];

const boundedSearchField = (value: unknown): string => {
  const text = typeof value === "string" ? value : fabricJsonText(value, MAX_FABRIC_JSON_CHARS);
  return text.slice(0, MAX_SEARCHABLE_DESCRIPTOR_CHARS).normalize("NFKC").toLowerCase();
};

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
    ].sort((left, right) => compareCodeUnits(left.name, right.name));
  }

  async list(): Promise<ResolvedFabricAction[]> {
    const lists = await Promise.all([...this.#providers.values()].map(async (provider) =>
      (await provider.list()).map((descriptor) => resolved(provider, descriptor))));
    return lists.flat().sort((left, right) => compareCodeUnits(left.ref, right.ref));
  }

  async search(query: string, limit = 30): Promise<ResolvedFabricAction[]> {
    if (query.length > MAX_SEARCH_QUERY_CHARS) throw new Error("Fabric search query exceeds 2000 characters");
    const normalized = query.normalize("NFKC").trim().toLowerCase();
    if (!normalized) return [];
    if (normalized.length > MAX_SEARCH_QUERY_CHARS) throw new Error("Normalized Fabric search query exceeds 2000 characters");
    const terms = normalizedTerms(normalized);
    return (await this.list())
      .map((action) => {
        const providerDescription = this.#providers.get(action.provider)?.description ?? "";
        const fields = {
          ref: boundedSearchField(action.ref),
          name: boundedSearchField(action.name),
          description: boundedSearchField(action.description),
          provider: boundedSearchField(action.provider),
          providerDescription: boundedSearchField(providerDescription),
          namespace: boundedSearchField(action.namespace ?? ""),
          annotations: boundedSearchField(action.annotations ?? {}),
          schema: boundedSearchField({ input: action.inputSchema, output: action.outputSchema ?? null }),
        };
        const tokens = Object.fromEntries(
          Object.entries(fields).map(([name, field]) => [name, new Set(normalizedTerms(field))]),
        ) as Record<keyof typeof fields, Set<string>>;
        let score = 0;
        if (fields.ref === normalized) score += 1_000;
        if (fields.name === normalized) score += 800;
        if (fields.ref.startsWith(normalized)) score += 300;
        else if (fields.ref.includes(normalized)) score += 120;
        if (fields.description.includes(normalized)) score += 40;
        if (fields.providerDescription.includes(normalized)) score += 20;
        if (fields.schema.includes(normalized)) score += 10;
        let matched = 0;
        for (const term of terms) {
          if (!Object.values(tokens).some((field) => field.has(term))) continue;
          matched += 1;
          if (tokens.ref.has(term) || tokens.name.has(term)) score += 30;
          if (tokens.provider.has(term)) score += 20;
          if (tokens.description.has(term)) score += 8;
          if (tokens.providerDescription.has(term)) score += 4;
          if (tokens.namespace.has(term)) score += 6;
          if (tokens.annotations.has(term)) score += 2;
          if (tokens.schema.has(term)) score += 2;
        }
        if (terms.length > 0 && matched === terms.length) score += 15;
        return { action, score };
      })
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || compareCodeUnits(left.action.ref, right.action.ref))
      .slice(0, Math.max(1, Math.min(100, Math.floor(limit))))
      .map(({ action }) => action);
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
      const acknowledgement = fabricCommitAcknowledgement(error);
      if (acknowledgement) audit.commitAcknowledgement = acknowledgement;
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
