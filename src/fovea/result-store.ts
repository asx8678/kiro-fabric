import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { fabricJsonText } from "../runtime/json-budget.js";

export interface ResultOwner { conversationId: string; conversationEpoch: number; rootId: string; authorizationEpoch: number; engineGeneration: number }
interface Stored { owner: ResultOwner; text: string; expiresAt: number }
const same = (a: ResultOwner, b: ResultOwner): boolean => a.conversationId === b.conversationId && a.conversationEpoch === b.conversationEpoch && a.rootId === b.rootId && a.authorizationEpoch === b.authorizationEpoch && a.engineGeneration === b.engineGeneration;
/** Retained results are immutable snapshot packets, never paths or fresh queries. */
export class FoveaResultStore {
  readonly #entries = new Map<string, Stored>();
  readonly #secret = randomBytes(32);
  #chars = 0;
  constructor(readonly now: () => number = Date.now, readonly ttlMs = 3_600_000) {}
  put(owner: ResultOwner, value: Record<string, unknown>): string {
    const text = fabricJsonText(value, 512_000);
    this.#sweep();
    while (this.#entries.size >= 32 || this.#chars + text.length > 4_000_000) this.#delete(this.#entries.keys().next().value!);
    const id = `fr_${randomBytes(24).toString("hex")}`;
    this.#entries.set(id, { owner: { ...owner }, text, expiresAt: this.now() + this.ttlMs }); this.#chars += text.length;
    return id;
  }
  page(owner: ResultOwner, resultId: string, cursor?: string, maxChars = 8_000): Record<string, unknown> {
    if (!Number.isSafeInteger(maxChars) || maxChars < 256 || maxChars > 32_000) throw new Error("repo.result page budget must be 256..32000");
    const entry = this.#get(owner, resultId), offset = cursor === undefined ? 0 : this.#offset(resultId, cursor);
    if (offset > entry.text.length) throw new Error("Invalid Navigator cursor offset");
    let end = Math.min(entry.text.length, offset + maxChars);
    if (end < entry.text.length && /[\uD800-\uDBFF]/u.test(entry.text[end - 1]!)) end--;
    return { schemaVersion: 1, advisory: true, resultId, encoding: "json", text: entry.text.slice(offset, end), offset, totalChars: entry.text.length, done: end === entry.text.length, ...(end < entry.text.length ? { nextCursor: this.#cursor(resultId, end) } : {}) };
  }
  search(owner: ResultOwner, resultId: string, query: string, limit = 10): Record<string, unknown> {
    if (!query || query.length > 256 || !Number.isSafeInteger(limit) || limit < 1 || limit > 32) throw new Error("Invalid retained-result search");
    const { text } = this.#get(owner, resultId); const matches = []; let offset = 0;
    while (matches.length < limit) { const found = text.indexOf(query, offset); if (found < 0) break; matches.push({ offset: found, text: text.slice(Math.max(0, found - 80), found + query.length + 80) }); offset = found + query.length; }
    return { schemaVersion: 1, advisory: true, resultId, literal: true, scope: "retained serialized result only", matches, truncated: text.indexOf(query, offset) >= 0 };
  }
  revoke(rootId: string, authorizationEpoch: number): void { for (const [id, e] of this.#entries) if (e.owner.rootId === rootId && e.owner.authorizationEpoch === authorizationEpoch) this.#delete(id); }
  clear(): void { this.#entries.clear(); this.#chars = 0; }
  #sweep(): void { for (const [id, e] of this.#entries) if (e.expiresAt <= this.now()) this.#delete(id); }
  #delete(id: string): void { const e = this.#entries.get(id); if (e) { this.#chars -= e.text.length; this.#entries.delete(id); } }
  #get(owner: ResultOwner, id: string): Stored { this.#sweep(); const e = this.#entries.get(id); if (!e || !same(e.owner, owner)) throw new Error("Navigator result unavailable: foreign, revoked, expired, or engine generation changed"); return e; }
  #cursor(id: string, offset: number): string { const body = String(offset); return `${body}.${createHmac("sha256", this.#secret).update(`${id}:${body}`).digest("hex")}`; }
  #offset(id: string, cursor: string): number { if (!/^\d{1,8}\.[a-f0-9]{64}$/u.test(cursor)) throw new Error("Invalid Navigator cursor"); const body = cursor.split(".")[0]!; const expected = this.#cursor(id, Number(body)); if (cursor.length !== expected.length || !timingSafeEqual(Buffer.from(cursor), Buffer.from(expected))) throw new Error("Foreign Navigator cursor"); return Number(body); }
}
