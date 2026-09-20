import { randomBytes } from "node:crypto";
export interface FoveaNotice { noticeId: string; rootId: string; authorizationEpoch: number; text: string; origin: "own" | "foreign" | "mixed" | "unattributed"; state: "prepared" | "emitted" | "uncertain"; createdAt: number }
export interface FoveaDeliveryClaim {
  readonly notices: readonly FoveaNotice[];
  /** A successful transport write proves emission only, never model processing. */
  isCurrent(): boolean;
  emitted(): void;
  uncertain(): void;
  cancel(): void;
}
/** Shared hook/projection outbox. Claims serialize competing delivery channels;
 * neither selection nor a nested tool return counts as emission/acknowledgment. */
export class FoveaOutbox {
  readonly #notices = new Map<string, FoveaNotice>();
  readonly #keys = new Map<string, string>();
  readonly #claims = new Map<string, symbol>();
  constructor(readonly now: () => number = Date.now) {}
  prepare(rootId: string, authorizationEpoch: number, text: string, origin: FoveaNotice["origin"], semanticKey?: string): string {
    if (!text || text.length > 65_536 || (semanticKey !== undefined && semanticKey.length > 256)) throw new Error("Fovea notice budget exceeded");
    for (const n of this.#notices.values()) if (n.rootId === rootId && n.authorizationEpoch === authorizationEpoch && n.text === text &&
      (semanticKey === undefined ? n.state === "prepared" : this.#keys.get(n.noticeId) === semanticKey)) return n.noticeId;
    if (this.#notices.size >= 32) throw new Error("Fovea outbox full; pending context not discarded");
    const noticeId = `notice_${randomBytes(16).toString("hex")}`;
    this.#notices.set(noticeId, { noticeId, rootId, authorizationEpoch, text, origin, state: "prepared", createdAt: this.now() });
    if (semanticKey !== undefined) this.#keys.set(noticeId, semanticKey);
    return noticeId;
  }
  get(rootId: string, authorizationEpoch: number, id: string): FoveaNotice | undefined {
    const n = this.#notices.get(id);
    return n?.rootId === rootId && n.authorizationEpoch === authorizationEpoch ? { ...n } : undefined;
  }
  select(rootId: string, authorizationEpoch: number, budget: number, nextPrompt = true): FoveaNotice[] {
    if (!Number.isSafeInteger(budget) || budget < 0 || budget > 131_072) throw new Error("Invalid Fovea delivery budget");
    const out = []; let used = 0;
    for (const n of this.#notices.values()) if (n.rootId === rootId && n.authorizationEpoch === authorizationEpoch && n.state === "prepared" && !this.#claims.has(n.noticeId) && (nextPrompt || n.origin !== "foreign")) {
      if (used + n.text.length + 160 > budget) break;
      used += n.text.length + 160; out.push({ ...n });
    }
    return out;
  }
  claim(rootId: string, authorizationEpoch: number, budget: number, nextPrompt = false): FoveaDeliveryClaim | undefined {
    const notices = this.select(rootId, authorizationEpoch, budget, nextPrompt);
    if (!notices.length) return undefined;
    const token = Symbol("Fovea delivery claim");
    for (const n of notices) this.#claims.set(n.noticeId, token);
    const settle = (state?: "emitted" | "uncertain"): void => {
      for (const selected of notices) {
        if (this.#claims.get(selected.noticeId) !== token) continue;
        this.#claims.delete(selected.noticeId);
        const n = this.#notices.get(selected.noticeId);
        if (n && state) n.state = state;
      }
    };
    return { notices: notices.map(n => Object.freeze(n)), isCurrent: () => notices.every(n => this.#claims.get(n.noticeId) === token), emitted: () => settle("emitted"), uncertain: () => settle("uncertain"), cancel: () => settle() };
  }
  emitted(ids: readonly string[]): void { for (const id of ids) { const n = this.#notices.get(id); if (n) n.state = "emitted"; } }
  uncertain(ids: readonly string[]): void { for (const id of ids) { const n = this.#notices.get(id); if (n) n.state = "uncertain"; } }
  replay(): void { this.#claims.clear(); for (const n of this.#notices.values()) n.state = "prepared"; }
  remove(id: string): void { this.#notices.delete(id); this.#claims.delete(id); this.#keys.delete(id); }
  revoke(rootId: string): void { for (const [id, n] of this.#notices) if (n.rootId === rootId) this.remove(id); }
  status(rootId?: string, authorizationEpoch?: number): { pending: number; emitted: number; uncertain: number; acknowledged: 0 } { const all = [...this.#notices.values()].filter(n => rootId === undefined || (n.rootId === rootId && n.authorizationEpoch === authorizationEpoch)); return { pending: all.filter(n => n.state === "prepared").length, emitted: all.filter(n => n.state === "emitted").length, uncertain: all.filter(n => n.state === "uncertain").length, acknowledged: 0 }; }
}
