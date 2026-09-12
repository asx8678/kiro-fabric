import { catalogWeight } from "./catalog-resources.js";
import { parseRemoteRef } from "./remote-identity.js";
import { catalogResultMethod, type CatalogMethod, type CatalogDependency } from "./catalog-contract.js";
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
  value.split(/[^\p{L}\p{N}_.$-]+/u, 65).filter(Boolean).slice(0, 64),
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
type Load<T> = { pending: boolean; failed: boolean; users: number; value?: T; error?: unknown; release: () => void; listeners: Set<() => void>; cancelQueued?: () => void };
type DiscoveryRecord = Load<DiscoveryIndex> & { revision: string | undefined };
type DescriptionRecord = Load<ResolvedFabricAction>;
type Admission = { resize(bytes: number, nodes: number): void; release(): void; transfer(): void; ownedRelease(): void };
const INDEX_BYTES = 16 * 1024 * 1024, INDEX_NODES = 300_000;
// Each producer owns capacity BEFORE invoking provider code. At most two raw
// returns can be outstanding, never an unbounded Promise.all of inventories.
const RAW_BYTES = 7 * 1024 * 1024, RAW_NODES = 100_000;
const discoveryQuota = () => new FabricRepairError("Fabric discovery index catalog_quota_exceeded", { code: "catalog_quota_exceeded", phase: "discovery", dispatchState: "not_dispatched", effectOutcome: "none" });
const rawWeight = (value: unknown) => {
  try { return catalogWeight(value, Math.floor(RAW_BYTES / 4)); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith("Fabric host JSON is outside the bounded JSON contract: more than")) throw discoveryQuota();
    throw error;
  }
};

export class ActionRegistry {
  readonly #discovery = new Map<FabricProvider, DiscoveryRecord>();
  readonly #descriptions = new Map<string, DescriptionRecord>();
  readonly #rawQueue: Array<{ start(admission: Admission): void; cancel(): void }> = [];
  #rawActive = 0;
  #peakRawActive = 0;
  #bytes = 0;
  #nodes = 0;
  #peakBytes = 0;
  #peakNodes = 0;
  #loads = 0;
  discoveryUsage() { return Object.freeze({ bytes: this.#bytes, nodes: this.#nodes, peakBytes: this.#peakBytes, peakNodes: this.#peakNodes, inflight: this.#loads, records: this.#discovery.size, descriptions: this.#descriptions.size, rawActive: this.#rawActive, rawQueued: this.#rawQueue.length, peakRawActive: this.#peakRawActive, subscribers: [...this.#discovery.values(), ...this.#descriptions.values()].reduce((n, record) => n + record.listeners.size, 0), rawReservationBytes: RAW_BYTES, maxBytes: INDEX_BYTES, maxNodes: INDEX_NODES }); }

  #trimDiscovery(): void {
    for (const [provider, record] of this.#discovery) {
      if (this.#discovery.size <= 32) break;
      if (!record.pending && !record.users) { this.#discovery.delete(provider); record.release(); }
    }
  }
  #reserve(bytes: number, nodes: number): () => void {
    for (const [provider, record] of this.#discovery) {
      if (this.#bytes + bytes <= INDEX_BYTES && this.#nodes + nodes <= INDEX_NODES) break;
      if (!record.pending && !record.users) { this.#discovery.delete(provider); record.release(); }
    }
    if (this.#bytes + bytes > INDEX_BYTES || this.#nodes + nodes > INDEX_NODES) throw discoveryQuota();
    this.#bytes += bytes; this.#nodes += nodes;
    this.#peakBytes = Math.max(this.#peakBytes, this.#bytes); this.#peakNodes = Math.max(this.#peakNodes, this.#nodes);
    let active = true;
    return () => { if (active) { active = false; this.#bytes -= bytes; this.#nodes -= nodes; } };
  }
  #pumpRaw(): void {
    while (this.#rawQueue.length && this.#rawActive < 2) {
      let release: () => void;
      try { release = this.#reserve(RAW_BYTES, RAW_NODES); }
      catch {
        // Only a live raw producer can free handoff capacity. Waiting behind
        // one is budget-driven; otherwise reject rather than deadlock a query
        // whose completed indexes are pinned until its other providers finish.
        if (this.#rawActive) return;
        this.#rawQueue.shift()!.cancel(); continue;
      }
      const job = this.#rawQueue.shift()!;
      this.#rawActive++; this.#peakRawActive = Math.max(this.#peakRawActive, this.#rawActive);
      let transferred = false, finished = false;
      const admission: Admission = {
        resize: (bytes, nodes) => {
          if (bytes > RAW_BYTES || nodes > RAW_NODES) throw discoveryQuota();
          release(); release = this.#reserve(bytes, nodes);
        },
        transfer: () => { transferred = true; },
        ownedRelease: () => release(),
        release: () => {
          if (finished) return;
          finished = true; this.#rawActive--;
          if (!transferred) release();
          this.#pumpRaw();
        },
      };
      // A transferred descriptor retains the resized reservation, independently
      // of the producer slot. Its owner receives a separate idempotent release.
      job.start(admission);
    }
  }
  #raw<T>(record: Load<T>, operation: (admission: Admission) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job = {
        start: (admission: Admission) => {
          delete record.cancelQueued;
          void operation(admission).then(resolve, reject).finally(() => admission.release());
        },
        cancel: () => { delete record.cancelQueued; reject(discoveryQuota()); },
      };
      record.cancelQueued = () => {
        const position = this.#rawQueue.indexOf(job);
        if (position >= 0) { this.#rawQueue.splice(position, 1); job.cancel(); }
      };
      this.#rawQueue.push(job); this.#pumpRaw();
    });
  }
  // Consumers subscribe to a removable Set, NEVER to the indefinitely pending
  // producer promise. Aborting/failing a query detaches every reaction and all
  // captured indexes/errors immediately, rather than only reducing counters.
  #wait(records: readonly Load<unknown>[], signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let done = false;
      const finish = (error?: unknown, failed = false) => {
        if (done) return; done = true;
        for (const record of records) record.listeners.delete(check);
        signal?.removeEventListener("abort", abort);
        if (failed) reject(error); else resolve();
      };
      const abort = () => finish(signal?.reason ?? new Error("Discovery aborted"), true);
      const check = () => {
        const failed = records.find(record => record.failed);
        if (failed) finish(failed.error, true);
        else if (records.every(record => !record.pending)) finish();
      };
      if (signal?.aborted) { abort(); return; }
      for (const record of records) record.listeners.add(check);
      signal?.addEventListener("abort", abort, { once: true }); check();
    });
  }
  #produce<T>(record: Load<T>, operation: Promise<T>, complete: () => void): void {
    void operation.then(value => { record.value = value; }, error => { record.failed = true; record.error = error; }).finally(() => {
      record.pending = false; complete();
      for (const listener of [...record.listeners]) listener();
    });
  }
  #releaseIndex(provider: FabricProvider, record: DiscoveryRecord): void {
    if (record.pending) { if (!record.users) record.cancelQueued?.(); return; }
    if (!record.users && (record.failed || record.revision === undefined || this.#discovery.get(provider) !== record)) {
      record.release(); delete record.value; delete record.error;
      if (this.#discovery.get(provider) === record) this.#discovery.delete(provider);
    }
  }
  async #buildIndex(provider: FabricProvider, record: DiscoveryRecord, admission: Admission): Promise<DiscoveryIndex> {
    const raw = await provider.list();
    const weight = rawWeight(raw);
    admission.resize(weight.bytes, weight.nodes);
    const releases: Array<() => void> = [];
    const entries: ReturnType<typeof indexedAction>[] = [], refs = new Map<string, ResolvedFabricAction>();
    let bytes = 1024, nodes = 16;
    try {
      releases.push(this.#reserve(bytes, nodes));
      const add = (descriptor: FabricActionDescriptor, observed = false) => {
        const weight = catalogWeight(descriptor);
        const scratch = this.#reserve(weight.bytes * 32 + 32768 + provider.description.length * 32, weight.nodes * 8 + 2048);
        try {
          const action = observed ? structuredClone(descriptor) as ResolvedFabricAction : resolved(provider, descriptor);
          if (refs.has(action.ref)) throw new Error(`Ambiguous Fabric action: ${action.ref}`);
          const entry = indexedAction(provider, action), actionWeight = catalogWeight(action);
          let b = actionWeight.bytes + 4096, n = actionWeight.nodes + 32;
          for (const field of Object.values(entry.fields)) b += 128 + field.length * 4;
          for (const tokens of Object.values(entry.tokens)) { b += 256; n++; for (const token of tokens) { b += 192 + token.length * 4; n++; } }
          releases.push(this.#reserve(b, n)); bytes += b; nodes += n;
          refs.set(action.ref, action); entries.push(entry);
        } finally { scratch(); }
      };
      for (const descriptor of raw) add(descriptor);
      for (const observed of provider.observedActions?.() ?? []) {
        if (provider.name !== "mcp" || !parseRemoteRef(observed.ref)) throw new Error("Invalid observed remote reference");
        const descriptor = observed.descriptor();
        if (descriptor.ref !== observed.ref || descriptor.provider !== provider.name) throw new Error("Invalid observed remote descriptor");
        add(descriptor, true);
      }
      record.release = () => {
        for (const release of releases) release(); releases.length = 0;
        // A suspended revision-retry producer can still hold the discarded
        // index object. Sever its graphs, not merely their accounting charges.
        entries.length = 0; refs.clear();
      };
      return { entries, refs, bytes, nodes };
    } catch (error) {
      for (const release of releases) release(); releases.length = 0;
      entries.length = 0; refs.clear(); throw error;
    }
  }
  #acquire(provider: FabricProvider): DiscoveryRecord {
    const revision = provider.discoveryRevision?.(), cached = this.#discovery.get(provider);
    if (cached && (cached.pending || cached.revision === revision)) {
      cached.users++; this.#discovery.delete(provider); this.#discovery.set(provider, cached); return cached;
    }
    if (cached) { this.#discovery.delete(provider); if (!cached.users) cached.release(); }
    const initial = this.#reserve(1024, 16);
    const record: DiscoveryRecord = { revision, pending: true, failed: false, users: 1, release: () => {}, listeners: new Set() };
    this.#discovery.set(provider, record); this.#loads++;
    const load = async () => {
      let before = revision;
      for (let attempt = 0; attempt < 2; attempt++) {
        const index = await this.#raw(record, admission => this.#buildIndex(provider, record, admission));
        const after = provider.discoveryRevision?.();
        if (before === after) { record.revision = after; return index; }
        record.release(); before = after;
      }
      throw new Error(`Fabric discovery revision churn: ${provider.name}`);
    };
    this.#produce(record, load(), () => {
      initial(); this.#loads--;
      if (record.failed && this.#discovery.get(provider) === record) this.#discovery.delete(provider);
      this.#releaseIndex(provider, record); this.#trimDiscovery();
    });
    return record;
  }
  async #withIndexes<T>(use: (indexes: DiscoveryIndex[]) => T, signal?: AbortSignal): Promise<T> {
    throwIfAbortedOrExpired(signal);
    const operationRelease = this.#reserve(2048 + this.#providers.size * 256, 32 + this.#providers.size * 4);
    const records: Array<[FabricProvider, DiscoveryRecord]> = [];
    try {
      for (const provider of this.#providers.values()) records.push([provider, this.#acquire(provider)]);
      await this.#wait(records.map(([, record]) => record), signal);
      const indexes = records.map(([, record]) => record.value!);
      let bytes = 1024, nodes = 16;
      for (const index of indexes) for (const entry of index.entries) {
        const weight = catalogWeight(entry.action);
        bytes += weight.bytes * 4 + 512; nodes += weight.nodes * 2 + 16;
      }
      const release = this.#reserve(bytes, nodes);
      try { return use(indexes); } finally { release(); }
    } finally {
      for (const [provider, record] of records) { record.users--; this.#releaseIndex(provider, record); }
      records.length = 0; operationRelease(); this.#trimDiscovery(); this.#pumpRaw();
    }
  }

  catalogDependencies(providerName?: string, args?: Record<string, unknown>): readonly CatalogDependency[] {
    return providerName === undefined
      ? [...this.#providers.values()].flatMap(provider => [...(provider.catalogDependencies?.(args) ?? [])])
      : this.#providers.get(providerName)?.catalogDependencies?.(args) ?? [];
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

  async list(signal?: AbortSignal): Promise<ResolvedFabricAction[]> {
    return this.#withIndexes(indexes => indexes.flatMap(index => index.entries.map(entry => structuredClone(entry.action)))
      .sort((left, right) => compareCodeUnits(left.ref, right.ref)), signal);
  }

  async search(query: string, limit = 30, signal?: AbortSignal): Promise<ResolvedFabricAction[]> {
    return (await this.searchAll(query, signal)).slice(0, Math.max(1, Math.min(100, Math.floor(limit))));
  }

  async searchAll(query: string, signal?: AbortSignal): Promise<ResolvedFabricAction[]> {
    throwIfAbortedOrExpired(signal);
    if (query.length > MAX_SEARCH_QUERY_CHARS) throw new Error("Fabric search query exceeds 2000 characters");
    const normalized = query.normalize("NFKC").trim().toLowerCase();
    if (!normalized) return [];
    if (normalized.length > MAX_SEARCH_QUERY_CHARS) throw new Error("Normalized Fabric search query exceeds 2000 characters");
    const terms = normalizedTerms(normalized);
    return this.#withIndexes(indexes => indexes.flatMap(index => index.entries)
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
      .map(({ action }) => structuredClone(action)), signal);
  }

  #releaseDescription(ref: string, record: DescriptionRecord): void {
    if (record.users) return;
    if (record.pending) { record.cancelQueued?.(); return; }
    record.release(); delete record.value; delete record.error;
    if (this.#descriptions.get(ref) === record) this.#descriptions.delete(ref);
  }
  async describe(ref: string, signal?: AbortSignal): Promise<ResolvedFabricAction> {
    throwIfAbortedOrExpired(signal);
    const release = this.#reserve(1024 + ref.length * 4, 16);
    let record = this.#descriptions.get(ref);
    try {
      if (!record) {
        const pendingRelease = this.#reserve(1024 + ref.length * 4, 16);
        record = { users: 1, pending: true, failed: false, release: () => {}, listeners: new Set() };
        this.#descriptions.set(ref, record);
        const current = record;
        this.#produce(record, this.#raw(record, admission => this.#describe(ref, current, admission)), () => {
          pendingRelease(); this.#releaseDescription(ref, current);
        });
      } else record.users++;
      await this.#wait([record], signal);
      const descriptor = record.value!, weight = catalogWeight(descriptor);
      const cloneRelease = this.#reserve(weight.bytes, weight.nodes);
      try { return structuredClone(descriptor); } finally { cloneRelease(); }
    } finally {
      if (record) { record.users--; this.#releaseDescription(ref, record); }
      release(); this.#pumpRaw();
    }
  }
  #retainDescriptor(provider: FabricProvider, descriptor: FabricActionDescriptor, record: DescriptionRecord, admission: Admission, observed = false): ResolvedFabricAction {
    const weight = rawWeight(descriptor);
    admission.resize(weight.bytes + 4096, weight.nodes + 16);
    // Transfer the raw handoff reservation into the retained exact descriptor;
    // scratch covers the simultaneous source, clone, and digest serialization.
    const scratch = this.#reserve(weight.bytes * 2 + 4096, weight.nodes * 2 + 32);
    try {
      const result = observed ? structuredClone(descriptor) as ResolvedFabricAction : resolved(provider, descriptor);
      admission.transfer(); record.release = admission.ownedRelease;
      return result;
    } finally { scratch(); }
  }
  async #describe(ref: string, record: DescriptionRecord, admission: Admission): Promise<ResolvedFabricAction> {
    if (parseRemoteRef(ref)) {
      const observed = this.#providers.get("mcp")?.observedActions?.().filter(entry => entry.ref === ref) ?? [];
      if (observed.length !== 1) throw new Error(`Unknown or ambiguous Fabric action: ${ref}`);
      const descriptor = observed[0]!.descriptor();
      fabricJsonText(descriptor, MAX_FABRIC_JSON_CHARS);
      if (descriptor.ref !== ref || descriptor.provider !== "mcp") throw new Error("Invalid observed remote descriptor");
      return this.#retainDescriptor(this.#providers.get("mcp")!, descriptor, record, admission, true);
    }
    if (ref.length > MAX_ACTION_REFERENCE_CHARS) throw new Error("Fabric action reference exceeds 512 characters");
    const separator = ref.indexOf(".");
    if (separator <= 0) throw new Error(`Fabric action reference must be provider.action: ${ref}`);
    const provider = this.#providers.get(ref.slice(0, separator));
    if (!provider) throw new Error(`Unknown Fabric provider: ${ref.slice(0, separator)}`);
    const descriptor = await provider.describe(ref.slice(separator + 1));
    if (!descriptor) throw new Error(`Unknown Fabric action: ${ref}`);
    return this.#retainDescriptor(provider, descriptor, record, admission);
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
    const action = await this.describe(remote ? "mcp.$call" : ref, context.signal);
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
    if (context.audits.length >= (context.maxAuditEntries ?? Number.POSITIVE_INFINITY)) throw new FabricRepairError("Fabric audit entry quota exceeded", { code: "quota_exceeded", phase: "dispatch", dispatchState: "not_dispatched", effectOutcome: "none" });
    const audit: FabricCallAudit = { ref, nestedToolCallId, startedAt: Date.now() };
    const auditBudget = context.auditBudget ??= { bytes: Buffer.byteLength(JSON.stringify(context.audits), "utf8") };
    const auditReservationBytes = Buffer.byteLength(JSON.stringify(audit), "utf8") + 2 + AUDIT_TERMINAL_BYTES;
    if (auditBudget.bytes + auditReservationBytes > (context.maxAuditBytes ?? Number.POSITIVE_INFINITY)) throw new FabricRepairError("Fabric audit byte quota exceeded", { code: "quota_exceeded", phase: "dispatch", dispatchState: "not_dispatched", effectOutcome: "none" });
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
      if (method && bounded.truncated) throw new FabricRepairError("Catalog result exceeds budget; use catalog pagination", { code: "catalog_page_budget", phase: "execution", dispatchState: "dispatched", effectOutcome: "none" });
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
    for (const record of this.#discovery.values()) if (!record.pending && !record.users) record.release();
    this.#discovery.clear();
    this.#activeWrites.clear();
  }
}
