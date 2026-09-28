import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isProxy } from "node:util/types";
import { largestFittingInteger } from "../bounded-search.js";
import type { CatalogDependency, CatalogBinding, CatalogMethod, CatalogReservation, CatalogPageOptions, CatalogPage, DescriptorJsonPage } from "./catalog-contract.js";
import { FabricRepairError } from "./repair-error.js";
import { semanticDigest } from "./semantic-digest.js";
import { fabricJsonText } from "../runtime/json-budget.js";

interface CatalogStorePolicy {
  maxSnapshots: number; maxBytes: number; maxNodes: number;
  reservationBytes: number; reservationNodes: number;
  softExpiryMs: number; idleMs: number; absoluteMs: number; now: () => number;
}
const defaults: CatalogStorePolicy = {
  // Conservative runtime-wide partition: 32MiB snapshots + 16MiB MCP + 16MiB index.
  maxSnapshots: 32, maxBytes: 32 * 1024 * 1024, maxNodes: 600_000,
  reservationBytes: 8 * 1024 * 1024, reservationNodes: 100_000,
  softExpiryMs: 600_000, idleMs: 1_800_000, absoluteMs: 7_200_000, now: Date.now,
};
const methods: CatalogMethod[] = ["tools.listPage", "tools.searchPage", "tools.describePage", "mcp.toolsPage", "mcp.describePage"];
/** ECMAScript array indices stop at 2^32-2; larger all-digit own properties are
 * ordinary keys that JSON serialization omits from the element list. */
const MAX_ARRAY_INDEX = 4_294_967_294;
const isArrayIndex = (key: string): boolean => {
  if (!/^(0|[1-9][0-9]*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index <= MAX_ARRAY_INDEX;
};
type Position = [number, string, number, number, number, number];
interface Entry { text: string; digest: string }
interface Snapshot { dependencies: Set<CatalogDependency>; id: string; method?: CatalogMethod; entries?: Entry[]; bytes: number; nodes: number; created: number; touched: number; expires: number }
const fail = (code: "catalog_quota_exceeded" | "catalog_page_budget" | "catalog_cursor_unavailable", message: string): never => {
  throw new FabricRepairError(message, { code, phase: "discovery", dispatchState: "not_dispatched", effectOutcome: "none" });
};
const unavailable: () => never = () => fail("catalog_cursor_unavailable", "Catalog cursor unavailable; explicitly reopen the catalog to continue.");
const quota: () => never = () => fail("catalog_quota_exceeded", "Catalog snapshot quota exceeded; release reservations or reopen a smaller catalog.");

/** Host-owned authority. Dependency checks are synchronous and local, never upstream reads.
 * Revoked memory is reclaimed on store access; scanning is bounded by maxSnapshots.
 */
export class CatalogSnapshotStore {
  private key = randomBytes(32);
  private closed = false;
  private readonly context: string;
  private readonly policy: CatalogStorePolicy;
  private readonly snapshots = new Map<string, Snapshot>();
  constructor(binding: CatalogBinding, policy: Partial<CatalogStorePolicy> = {}) {
    this.context = semanticDigest("catalog-binding-v1", binding);
    this.policy = { ...defaults, ...policy };
    for (const [key, value] of Object.entries(this.policy)) {
      if (key !== "now" && (!Number.isSafeInteger(value) || value <= 0)) throw new Error("Invalid catalog store policy");
    }
  }
  private prune(): void {
    const now = this.policy.now();
    for (const [id, snapshot] of this.snapshots) {
      if (![...snapshot.dependencies].every(dependency => dependency.isCurrent()) || now - snapshot.created >= this.policy.absoluteMs || now - snapshot.touched >= this.policy.idleMs) this.snapshots.delete(id);
    }
  }
  reserve(dependencies: readonly CatalogDependency[] = []): CatalogReservation {
    if (dependencies.length > 256) quota();
    if (!dependencies.every(dependency => dependency.isCurrent())) unavailable();
    if (this.closed) unavailable();
    this.prune();
    const p = this.policy;
    if (dependencies.length * 64 > p.reservationBytes || dependencies.length > p.reservationNodes) quota();
    if (p.reservationBytes > p.maxBytes || p.reservationNodes > p.maxNodes) quota();
    const fits = (): boolean => {
      let bytes = p.reservationBytes, nodes = p.reservationNodes;
      for (const snapshot of this.snapshots.values()) { bytes += snapshot.bytes; nodes += snapshot.nodes; }
      return this.snapshots.size < p.maxSnapshots && bytes <= p.maxBytes && nodes <= p.maxNodes;
    };
    while (!fits()) {
      const oldest = [...this.snapshots.values()].filter(s => s.entries !== undefined).sort((a, b) => a.touched - b.touched)[0];
      if (!oldest) quota();
      this.snapshots.delete(oldest.id);
    }
    const now = p.now();
    const snapshot: Snapshot = { dependencies: new Set(dependencies), id: randomBytes(12).toString("base64url"), bytes: p.reservationBytes, nodes: p.reservationNodes, created: now, touched: now, expires: now + p.softExpiryMs };
    this.snapshots.set(snapshot.id, snapshot);
    let active = true;
    return {
      depend: (dependencies) => {
        this.prune();
        if (!active || this.snapshots.get(snapshot.id) !== snapshot) unavailable();
        if (dependencies.length > 256) { this.snapshots.delete(snapshot.id); active = false; quota(); }
        const combined = new Set([...snapshot.dependencies, ...dependencies]);
        if (combined.size > 256 || combined.size * 64 > p.reservationBytes || combined.size > p.reservationNodes) {
          this.snapshots.delete(snapshot.id); active = false; quota();
        }
        snapshot.dependencies = combined;
        this.prune();
        if (this.snapshots.get(snapshot.id) !== snapshot) unavailable();
      },
      release: () => { if (active) { this.snapshots.delete(snapshot.id); active = false; } },
      publish: (method, descriptors, query) => {
        this.prune();
        if (!active || this.snapshots.get(snapshot.id) !== snapshot) unavailable();
        try {
          if (!methods.includes(method) || (query !== undefined && typeof query !== "string")) quota();
          // Validate the ORIGINAL graph, including array accessors, before any serialization.
          let nodes = snapshot.dependencies.size, raw = snapshot.dependencies.size * 64;
          const seen = new WeakSet<object>();
          const walk = (value: unknown, depth: number): void => {
            if (++nodes > p.reservationNodes) quota();
            if (typeof value === "string") { raw += value.length * 2; if (raw > p.reservationBytes) quota(); return; }
            if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return;
            if (typeof value !== "object" || isProxy(value) || depth >= 64 || seen.has(value)) quota();
            seen.add(value);
            const array = Array.isArray(value);
            if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) quota();
            if (Object.getOwnPropertySymbols(value).length) quota();
            const keys = Reflect.ownKeys(value);
            if (keys.length + nodes > p.reservationNodes + 1) quota();
            if (array && (value as unknown[]).length !== keys.length - 1) quota();
            for (const key of keys) {
              if (array && key === "length") continue;
              const d = Object.getOwnPropertyDescriptor(value, key)!;
              if (!("value" in d) || !d.enumerable || (array && !isArrayIndex(String(key)))) quota();
              raw += String(key).length * 2;
              if (raw > p.reservationBytes) quota();
              walk(d.value, depth + 1);
            }
          };
          if (isProxy(descriptors) || !Array.isArray(descriptors)) quota();
          // Inventory root does not consume a descriptor's allowed depth.
          walk(descriptors, -1);
          if (method.endsWith("describePage") && descriptors.length !== 1) quota();
          let bytes = 512 + snapshot.dependencies.size * 64 + nodes * 32 + (query?.length ?? 0) * 4;
          if (bytes > p.reservationBytes) quota();
          const entries: Entry[] = [];
          for (const descriptor of descriptors) {
            const text = fabricJsonText(descriptor, Math.min(8_000_000, p.reservationBytes));
            bytes += text.length * 2 + Buffer.byteLength(text) + 256;
            if (bytes > p.reservationBytes) quota();
            const supplied = descriptor !== null && typeof descriptor === "object" ? (descriptor as Record<string, unknown>).descriptorDigest : undefined;
            const digest = typeof supplied === "string" && /^[a-fA-F0-9]{64}$/.test(supplied) ? supplied : semanticDigest("catalog-descriptor-v1", descriptor);
            entries.push({ text, digest });
          }
          if (bytes > p.reservationBytes) quota();
          Object.assign(snapshot, { method, entries, bytes, nodes, touched: p.now() });
          active = false;
          return this.token(snapshot, method, method.endsWith("describePage") ? 0 : -1, 0);
        } catch (error) {
          this.snapshots.delete(snapshot.id); active = false;
          if (error instanceof FabricRepairError) throw error;
          return quota();
        }
      },
    };
  }
  private token(s: Snapshot, method: CatalogMethod, descriptor: number, position: number): string {
    const body = Buffer.from(JSON.stringify([1, s.id, methods.indexOf(method), descriptor, position, s.expires])).toString("base64url");
    return `${body}.${createHmac("sha256", this.key).update(this.context).update(body).digest("base64url")}`;
  }
  private authenticate(cursor: string): { snapshot: Snapshot; method: CatalogMethod; descriptor: number; position: number } {
    this.prune();
    if (typeof cursor !== "string" || cursor.length >= 400 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(cursor)) unavailable();
    const [body, signature] = cursor.split(".") as [string, string];
    const expected = createHmac("sha256", this.key).update(this.context).update(body).digest("base64url");
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) unavailable();
    let data: Position;
    try { data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Position; } catch { return unavailable(); }
    if (!Array.isArray(data) || data.length !== 6 || data[0] !== 1 || !data.slice(2).every(Number.isSafeInteger)) unavailable();
    const [, id, family, descriptor, position] = data;
    const snapshot = this.snapshots.get(id), method = methods[family];
    if (!snapshot?.entries || !method || position < 0) unavailable();
    const describe = snapshot.method!.startsWith("mcp.") ? "mcp.describePage" : "tools.describePage";
    if (descriptor === -1 ? method !== snapshot.method || method.endsWith("describePage") || position > snapshot.entries.length
      : method !== describe || descriptor < 0 || descriptor >= snapshot.entries.length || position > snapshot.entries[descriptor]!.text.length) unavailable();
    // Soft expiry is renewable ONLY after authentication and retained-snapshot lookup.
    snapshot.touched = this.policy.now();
    if (snapshot.expires <= snapshot.touched) snapshot.expires = snapshot.touched + this.policy.softExpiryMs;
    return { snapshot, method, descriptor, position };
  }
  method(cursor: string): CatalogMethod { return this.authenticate(cursor).method; }
  private budgets(maxBytes: number | undefined, maxChars: number): { bytes: number; chars: number } {
    const bytes = maxBytes ?? 64 * 1024;
    if (!Number.isSafeInteger(bytes) || bytes < 1000 || bytes > 2_000_000 || !Number.isSafeInteger(maxChars) || maxChars < 1000) fail("catalog_page_budget", "Catalog page requires safe integer byte and character budgets of at least 1000.");
    return { bytes: Math.min(bytes, 2_000_000), chars: Math.min(maxChars, 2_000_000) };
  }
  private fits(value: unknown, budget: { bytes: number; chars: number }): boolean {
    try { const text = fabricJsonText(value, budget.chars); return Buffer.byteLength(text) <= budget.bytes; } catch { return false; }
  }
  catalogPage(cursor: string, options: CatalogPageOptions = {}, maxChars = 2_000_000): CatalogPage<unknown> {
    const { snapshot: s, method, descriptor, position } = this.authenticate(cursor);
    if (descriptor !== -1) unavailable();
    const budget = this.budgets(options.maxBytes, maxChars), limit = options.limit ?? 30;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail("catalog_page_budget", "Catalog limit must be a safe integer from 1 to 100.");
    const entries = s.entries!;
    const items: CatalogPage<unknown>["items"] = [];
    const page = (next: number): CatalogPage<unknown> => ({ items, total: entries.length, returned: items.length, complete: next === entries.length, ...(next < entries.length ? { nextCursor: this.token(s, method, -1, next) } : {}) });
    const deferred = (entry: Entry, at: number) => ({ descriptorDigest: entry.digest, descriptorCursor: this.token(s, method.startsWith("mcp.") ? "mcp.describePage" : "tools.describePage", at, 0) });
    let next = position;
    while (next < entries.length && items.length < limit) {
      const entry = entries[next]!;
      // A descriptor whose own serialized form already exceeds the envelope can
      // never be returned inline. Emit the deferred cursor without a JSON.parse
      // of the full text, which cursor replay would otherwise repeat every time.
      if (entry.text.length > budget.chars || Buffer.byteLength(entry.text) > budget.bytes) {
        items.push(deferred(entry, next));
        if (!this.fits(page(next + 1), budget)) { items.pop(); break; }
        next++;
        continue;
      }
      items.push({ descriptor: JSON.parse(entry.text) as unknown });
      if (!this.fits(page(next + 1), budget)) {
        items.pop();
        items.push(deferred(entry, next));
        if (!this.fits(page(next + 1), budget)) { items.pop(); break; }
      }
      next++;
    }
    const result = page(next);
    if ((!items.length && next < entries.length) || !this.fits(result, budget)) fail("catalog_page_budget", "Catalog page cannot advance within the requested envelope budget.");
    return result;
  }
  describePage(cursor: string, options: { maxBytes?: number } = {}, maxChars = 2_000_000): DescriptorJsonPage {
    const { snapshot: s, method, descriptor, position } = this.authenticate(cursor);
    if (descriptor < 0) unavailable();
    const budget = this.budgets(options.maxBytes, maxChars), entry = s.entries![descriptor]!;
    const page = (end: number): DescriptorJsonPage => ({ text: entry.text.slice(position, end), encoding: "json", totalChars: entry.text.length, descriptorDigest: entry.digest, complete: end === entry.text.length, ...(end < entry.text.length ? { nextCursor: this.token(s, method, descriptor, end) } : {}) });
    if (entry.text.length - position <= Math.min(budget.bytes, budget.chars)) {
      const complete = page(entry.text.length);
      if (this.fits(complete, budget)) return complete;
    }
    let low = largestFittingInteger(position, Math.min(entry.text.length - 1, position + Math.min(budget.bytes, budget.chars)), end => this.fits(page(end), budget));
    // Do not split UTF-16 surrogate pairs across chunks.
    if (low < entry.text.length && low > position && /[\uD800-\uDBFF]/.test(entry.text[low - 1]!) && /[\uDC00-\uDFFF]/.test(entry.text[low]!)) low--;
    const result = page(low);
    if ((low === position && position < entry.text.length) || !this.fits(result, budget)) fail("catalog_page_budget", "Descriptor page cannot advance within the requested envelope budget.");
    return result;
  }
  invalidate(): void { this.closed = true; this.snapshots.clear(); this.key = randomBytes(32); }
}
