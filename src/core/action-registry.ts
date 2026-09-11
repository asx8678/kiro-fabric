import { catalogWeight } from "./catalog-resources.js";
import { parseRemoteRef } from "./remote-identity.js";
import { catalogResultMethod, type CatalogMethod } from "./catalog-contract.js";
import { argumentRepairError, FabricRepairError } from "./repair-error.js";
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
import { fabricJsonText, jsonStringPrefix, MAX_FABRIC_JSON_CHARS } from "../runtime/json-budget.js";
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
  /** An invoked host command failed; its external effects cannot be rolled back. */
  effectOutcome?: "uncertain";
}

export interface FabricRegistryInvocationContext extends FabricInvocationContext {
  formatCatalogResult?(value: unknown, method: CatalogMethod): unknown;
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
  fabricJsonText(descriptor, MAX_FABRIC_JSON_CHARS);
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
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error("Invalid Fabric result budget");
  const text = fabricJsonText(value, MAX_FABRIC_JSON_CHARS);
  if (text.length <= maximum) return { value, chars: text.length, truncated: false };
  const envelope = { fabricTruncated: true, originalChars: text.length, preview: "" };
  const available = maximum - JSON.stringify(envelope).length;
  if (available < 0) throw new Error("Fabric result budget cannot fit truncation metadata");
  envelope.preview = jsonStringPrefix(text, available);
  return { value: envelope, chars: text.length, truncated: true };
};

const overlaps = (left: readonly string[], right: readonly string[]): boolean =>
  left.includes("*") || right.includes("*") || left.some((entry) => right.includes(entry));
const deepFreeze = <T>(value: T): T => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
};
const AUDIT_TERMINAL_BYTES = 8_192;
const MAX_SEARCHABLE_DESCRIPTOR_CHARS = 32_000;

const normalizedTerms = (value: string): string[] => [...new Set(
  value.split(/[^\p{L}\p{N}_.$-]+/u).filter(Boolean).slice(0, 64),
)];

const boundedSearchField = (value: unknown): string => {
  const text = typeof value === "string" ? value : fabricJsonText(value, MAX_FABRIC_JSON_CHARS);
  return text.slice(0, MAX_SEARCHABLE_DESCRIPTOR_CHARS).normalize("NFKC").toLowerCase();
};

const indexedAction = (provider: FabricProvider, action: ResolvedFabricAction) => {
        const providerDescription = provider.description;
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
  return { action: deepFreeze(action), fields, tokens };
};
type DiscoveryIndex = { entries: ReturnType<typeof indexedAction>[]; refs: Map<string, ResolvedFabricAction>; bytes: number; nodes: number };

export class ActionRegistry {
  readonly #discovery = new Map<FabricProvider, { revision: string; pending: boolean; promise: Promise<DiscoveryIndex>; index?: DiscoveryIndex; touched?: number }>();

  async #buildIndex(provider: FabricProvider): Promise<DiscoveryIndex> {
    const raw = await provider.list();
    // Validate original container/accessors/shared graphs before map or cloning.
    catalogWeight(raw);
    const actions = raw.map(descriptor => resolved(provider, descriptor));
    for (const observed of provider.observedActions?.() ?? []) {
      if (provider.name !== "mcp" || !parseRemoteRef(observed.ref)) throw new Error("Invalid observed remote reference");
      const descriptor = observed.descriptor();
      fabricJsonText(descriptor, MAX_FABRIC_JSON_CHARS);
      if (descriptor.ref !== observed.ref || descriptor.provider !== provider.name) throw new Error("Invalid observed remote descriptor");
      actions.push(structuredClone(descriptor));
    }
    const refs = new Map<string, ResolvedFabricAction>();
    const entries = actions.map(action => {
      if (refs.has(action.ref)) throw new Error(`Ambiguous Fabric action: ${action.ref}`);
      refs.set(action.ref, action);
      return indexedAction(provider, action);
    });
    let bytes = 0, nodes = 0;
    for (const entry of entries) {
      const weight = catalogWeight(entry.action);
      const fields = Object.values(entry.fields);
      // Tokens allocate independent strings plus Set slots; charge every token
      // and field/container even when an engine happens to share backing strings.
      const tokenBytes = Object.values(entry.tokens).reduce((sum, tokens) => sum + 256 + [...tokens].reduce((n, token) => n + 192 + token.length * 4, 0), 0);
      bytes += weight.bytes + fields.reduce((n, field) => n + 128 + field.length * 4, 0) + tokenBytes + 2048;
      nodes += weight.nodes + fields.length + Object.values(entry.tokens).reduce((n, tokens) => n + tokens.size, 0) + 4;
    }
    if (bytes > 16 * 1024 * 1024 || nodes > 300_000) throw new Error("Fabric discovery index catalog_quota_exceeded");
    return { entries, refs, bytes, nodes };
  }

  #index(provider: FabricProvider): Promise<DiscoveryIndex> {
    const revision = provider.discoveryRevision?.();
    if (revision === undefined) {
      this.#discovery.delete(provider);
      return this.#buildIndex(provider);
    }
    const cached = this.#discovery.get(provider);
    if (cached && (cached.pending || cached.revision === revision)) { cached.touched = performance.now(); return cached.promise; }
    const record: { revision: string; pending: boolean; promise: Promise<DiscoveryIndex>; index?: DiscoveryIndex; touched?: number } = { revision, pending: true, promise: undefined as unknown as Promise<DiscoveryIndex> };
    record.promise = (async () => {
      let before: string | undefined = revision;
      for (let attempt = 0; attempt < 2; attempt++) {
        const index = await this.#buildIndex(provider);
        const after = provider.discoveryRevision?.();
        if (before === after) {
          const others = () => [...this.#discovery.entries()].filter(([key, value]) => key !== provider && value.index);
          while (others().reduce((n, [, value]) => n + value.index!.bytes, index.bytes) > 16 * 1024 * 1024 ||
            others().reduce((n, [, value]) => n + value.index!.nodes, index.nodes) > 300_000 || others().length >= 32) {
            const oldest = others().sort((a, b) => (a[1].touched ?? 0) - (b[1].touched ?? 0))[0];
            if (!oldest) throw new Error("Fabric discovery index catalog_quota_exceeded");
            this.#discovery.delete(oldest[0]);
          }
          record.index = index; record.touched = performance.now();
          record.pending = false;
          record.revision = after!;
          if (after === undefined && this.#discovery.get(provider) === record) this.#discovery.delete(provider);
          return index;
        }
        before = after;
      }
      throw new Error(`Fabric discovery revision churn: ${provider.name}`);
    })().catch(error => {
      if (this.#discovery.get(provider) === record) this.#discovery.delete(provider);
      throw error;
    });
    this.#discovery.set(provider, record);
    return record.promise;
  }

  #indexes(): Promise<DiscoveryIndex[]> {
    return Promise.all([...this.#providers.values()].map(provider => this.#index(provider)));
  }

  readonly #providers = new Map<string, FabricProvider>();
  readonly #unavailable = new Map<string, string>();
  readonly #activeWrites = new Map<string, { ref: string; resources: readonly string[] }>();

  register(provider: FabricProvider): void {
    if (!providerName.test(provider.name)) throw new Error(`Invalid Fabric provider name: ${provider.name}`);
    if (this.#providers.has(provider.name)) throw new Error(`Fabric provider already registered: ${provider.name}`);
    if (this.#providers.size >= 128) throw new Error("Fabric provider retention limit exceeded");
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
    return (await this.#indexes()).flatMap(index => index.entries.map(entry => structuredClone(entry.action)))
      .sort((left, right) => compareCodeUnits(left.ref, right.ref));
  }

  async search(query: string, limit = 30): Promise<ResolvedFabricAction[]> {
    return (await this.searchAll(query)).slice(0, Math.max(1, Math.min(100, Math.floor(limit))));
  }

  async searchAll(query: string): Promise<ResolvedFabricAction[]> {
    if (query.length > MAX_SEARCH_QUERY_CHARS) throw new Error("Fabric search query exceeds 2000 characters");
    const normalized = query.normalize("NFKC").trim().toLowerCase();
    if (!normalized) return [];
    if (normalized.length > MAX_SEARCH_QUERY_CHARS) throw new Error("Normalized Fabric search query exceeds 2000 characters");
    const terms = normalizedTerms(normalized);
    return (await this.#indexes()).flatMap(index => index.entries)
      .map((entry) => {
        const { action, fields, tokens } = entry;
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
      .map(({ action }) => structuredClone(action));
  }

  async describe(ref: string): Promise<ResolvedFabricAction> {
    if (parseRemoteRef(ref)) {
      const observed = this.#providers.get("mcp")?.observedActions?.().filter(entry => entry.ref === ref) ?? [];
      if (observed.length !== 1) throw new Error(`Unknown or ambiguous Fabric action: ${ref}`);
      const descriptor = observed[0]!.descriptor();
      fabricJsonText(descriptor, MAX_FABRIC_JSON_CHARS);
      if (descriptor.ref !== ref || descriptor.provider !== "mcp") throw new Error("Invalid observed remote descriptor");
      return structuredClone(descriptor);
    }
    if (ref.length > MAX_ACTION_REFERENCE_CHARS) throw new Error("Fabric action reference exceeds 512 characters");
    const separator = ref.indexOf(".");
    if (separator <= 0) throw new Error(`Fabric action reference must be provider.action: ${ref}`);
    const provider = this.#providers.get(ref.slice(0, separator));
    if (!provider) throw new Error(`Unknown Fabric provider: ${ref.slice(0, separator)}`);
    const descriptor = await provider.describe(ref.slice(separator + 1));
    if (!descriptor) throw new Error(`Unknown Fabric action: ${ref}`);
    return resolved(provider, descriptor);
  }

  async invoke(ref: string, args: Record<string, unknown>, context: FabricRegistryInvocationContext, options?: { expectedDescriptorDigest?: string; projection?: "full" | "text" | "structured" }): Promise<unknown> {
    throwIfAbortedOrExpired(context.signal, context.deadline);
    if (!isRecord(args)) throw new Error(`Arguments for ${ref} must be an object`);
    const remote = parseRemoteRef(ref);
    if (!remote && options !== undefined) throw new Error("Invocation options require a canonical remote reference");
    if (remote) args = { server: remote.server, tool: remote.tool, args,
      ...(options?.expectedDescriptorDigest === undefined ? {} : { expectedDescriptorDigest: options.expectedDescriptorDigest }),
      ...(options?.projection === undefined ? {} : { projection: options.projection }),
    };
    const action = await this.describe(remote ? "mcp.$call" : ref);
    const provider = this.#providers.get(action.provider)!;
    let prepared: Record<string, unknown>;
    try {
      prepared = provider.prepareArguments
        ? await runAbortable(context.signal, () => provider.prepareArguments!(action.name, structuredClone(args), context))
        : structuredClone(args);
    } catch (error) {
      if (provider.name === "mcp") provider.invalidateDiscovery?.(typeof args.server === "string" ? args.server : undefined);
      throw error;
    }
    throwIfAbortedOrExpired(context.signal, context.deadline);
    if (!isRecord(prepared)) throw new Error(`Argument preparation for ${ref} must return an object`);
    const invalid = schemaValidationMessage(action.inputSchema, prepared);
    if (invalid) throw argumentRepairError(ref, action.descriptorDigest, action.inputSchema, invalid);

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
    const auditBudget = context.auditBudget ??= { bytes: Buffer.byteLength(JSON.stringify(context.audits), "utf8") };
    const auditReservationBytes = Buffer.byteLength(JSON.stringify(audit), "utf8") + 2 + AUDIT_TERMINAL_BYTES;
    if (auditBudget.bytes + auditReservationBytes > (context.maxAuditBytes ?? Number.POSITIVE_INFINITY)) throw new Error("Fabric audit byte quota exceeded");
    if (writeLike) {
      for (const active of this.#activeWrites.values()) {
        if (overlaps(resources, active.resources)) throw new Error(`Overlapping write rejected: ${ref} conflicts with ${active.ref}`);
      }
      // Reserve write intent before prompting so an approval flood cannot queue
      // conflicting side effects or dialogs.
      this.#activeWrites.set(nestedToolCallId, { ref, resources });
    }
    context.audits.push(audit);
    auditBudget.bytes += auditReservationBytes;
    let releaseReservation: (() => void | Promise<void>) | undefined;
    let invocationStarted = false;
    let published: FabricCommitAcknowledgement | undefined;
    try {
      // Provider-owned cross-process intent is acquired before human approval.
      // Do not abort-race acquisition: a late lock must never be leaked.
      releaseReservation = await provider.reserveInvocation?.(action.name, structuredClone(canonicalArgs), context);
      throwIfAbortedOrExpired(context.signal, context.deadline);
      // Approval cleanup remains part of the reservation lifetime. Racing the
      // promise would release write intent while an elicitation was still live.
      await context.approve(structuredClone(action), structuredClone(canonicalArgs));
      throwIfAbortedOrExpired(context.signal, context.deadline);
      const invocationArgs = structuredClone(canonicalArgs);
      // Providers receive the request signal and own cancellation cleanup.
      // Await their settlement so a cooperative provider (notably configured
      // MCP, which closes its contacted server) finishes cleanup before the
      // registry reports cancellation to the guest.
      invocationStarted = true;
      const value = await provider.invoke(action.name, invocationArgs, context);
      if (provider.name === "local" && (action.name === "write" || action.name === "edit") && isRecord(value) && value.changed === true) {
        published = { version: 1, operation: action.name };
      }
      throwIfAbortedOrExpired(context.signal, context.deadline);
      const method = catalogResultMethod(value);
      const formatted = method && context.formatCatalogResult ? context.formatCatalogResult(value, method) : value;
      const bounded = boundedResult(formatted, context.maxResultChars);
      if (method && bounded.truncated) throw new Error("Catalog result exceeds budget; use catalog pagination");
      throwIfAbortedOrExpired(context.signal, context.deadline);
      const release = releaseReservation;
      releaseReservation = undefined;
      await release?.();
      audit.endedAt = Date.now();
      audit.success = true;
      audit.resultChars = bounded.chars;
      audit.resultTruncated = bounded.truncated;
      return bounded.value;
    } catch (error) {
      if (provider.name === "mcp" && !(error instanceof FabricRepairError && error.failure.code === "catalog_requires_paging")) provider.invalidateDiscovery?.(typeof canonicalArgs.server === "string" ? canonicalArgs.server : undefined);
      audit.endedAt = Date.now();
      audit.success = false;
      audit.error = error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000);
      const acknowledgement = fabricCommitAcknowledgement(error) ?? published;
      if (invocationStarted && provider.name === "local" && action.name === "shell") audit.effectOutcome = "uncertain";
      if (acknowledgement) audit.commitAcknowledgement = acknowledgement;
      throw error;
    } finally {
      try { await releaseReservation?.(); }
      catch (error) {
        audit.endedAt = Date.now(); audit.success = false;
        audit.error = "Effect reservation cleanup failed; inspect state before retrying";
        if (published) audit.commitAcknowledgement = published;
        if (invocationStarted && provider.name === "local" && action.name === "shell") audit.effectOutcome = "uncertain";
        throw error;
      } finally {
        this.#activeWrites.delete(nestedToolCallId);
        // Reserve worst-case terminal capacity before prompting, then retain only
        // actual escaped UTF-8 bytes after every terminal/cleanup path settles.
        auditBudget.bytes += Buffer.byteLength(JSON.stringify(audit), "utf8") + 2 - auditReservationBytes;
      }
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.#providers.values()].map((provider) => provider.close?.()));
    this.#providers.clear();
    this.#discovery.clear();
    this.#activeWrites.clear();
  }
}
