import type { FoveaDeliveryClaim } from "../fovea/delivery.js";
import type { WorkspaceContextProvider } from "./power/workspace-context.js";

/** In-process embedding contract, NOT a Kiro wire protocol or a qualification flag.
 * A trusted client bridge must establish native identity/lifecycle, bind request IDs
 * before dispatch, and report actual intended-model-input receipts. Never populate
 * this from tool arguments, cwd, hook files, environment flags or guessed _meta. */
export interface KiroHostSession {
  readonly conversationId: string;
  readonly conversationEpoch: number;
  readonly workspaceContext: WorkspaceContextProvider;
  readonly signal: AbortSignal;
}
export interface KiroHostTurn { readonly session: KiroHostSession; readonly signal: AbortSignal }
interface SessionState { controller: AbortController; turn?: KiroHostTurn; turnController?: AbortController; retirement?: Promise<void> }
interface Receipt { turn: KiroHostTurn; state: "prepared" | "emitted" | "uncertain"; acknowledge(): Promise<void>; pending?: Promise<void> }

/** Opaque handles and bounded, one-shot request routing. The native bridge owns
 * clear/new/end/compact/resume semantics; absent/ambiguous ownership fails closed.
 * Keeping a handle across compact/resume is an explicit trusted-host decision. */
export class KiroHostSessionAdapter {
  readonly #sessions = new Map<KiroHostSession, SessionState>();
  readonly #requests = new Map<string | number, KiroHostTurn>();
  readonly #receipts = new Map<string, Receipt>();
  #retire: ((session: KiroHostSession) => Promise<void>) | undefined;
  #attached = false;
  #closed = false;
  #closeTask: Promise<void> | undefined;

  openSession(owner: { conversationId: string; conversationEpoch: number; workspaceContext: WorkspaceContextProvider }): KiroHostSession {
    if (this.#closed) throw new Error("Host session adapter closed");
    if (!/^[a-zA-Z0-9_-]{1,100}$/u.test(owner.conversationId) || !Number.isSafeInteger(owner.conversationEpoch) || owner.conversationEpoch < 0) throw new Error("Invalid host session owner");
    if (!owner.workspaceContext || typeof owner.workspaceContext.current !== "function" || typeof owner.workspaceContext.invalidate !== "function") throw new Error("Session-bound workspace context required");
    if (this.#sessions.size >= 32) throw new Error("Host session capacity reached");
    for (const session of this.#sessions.keys()) if (session.conversationId === owner.conversationId && session.conversationEpoch === owner.conversationEpoch) throw new Error("Host session owner already active or retiring");
    const controller = new AbortController();
    const session = Object.freeze({ conversationId: owner.conversationId, conversationEpoch: owner.conversationEpoch, workspaceContext: owner.workspaceContext, signal: controller.signal });
    this.#sessions.set(session, { controller });
    return session;
  }
  beginTurn(session: KiroHostSession): KiroHostTurn {
    const state = this.#session(session);
    if (state.turn) this.endTurn(state.turn);
    const controller = new AbortController();
    const turn = Object.freeze({ session, signal: AbortSignal.any([controller.signal, session.signal]) });
    state.turn = turn; state.turnController = controller;
    return turn;
  }
  endTurn(turn: KiroHostTurn): void {
    this.assertTurn(turn);
    const state = this.#sessions.get(turn.session)!;
    state.turnController!.abort(new Error("Host turn ended"));
    delete state.turn; delete state.turnController;
    this.#forgetTurn(turn);
  }
  /** Host bridge calls this once for each actual transport request. */
  associateRequest(id: string | number, turn: KiroHostTurn): void {
    this.assertTurn(turn);
    if (!(typeof id === "string" && id.length > 0 && id.length <= 256 || typeof id === "number" && Number.isSafeInteger(id))) throw new Error("Invalid host request ID");
    if (this.#requests.size >= 64 || this.#requests.has(id)) throw new Error("Host request routing full or ambiguous");
    this.#requests.set(id, turn);
  }
  /** MCP adapter only. Resolve synchronously BEFORE workspace/runtime selection. */
  takeRequest(id: string | number): KiroHostTurn {
    const turn = this.#requests.get(id);
    this.#requests.delete(id);
    if (!turn) throw new Error("No trusted host session/turn association for this request");
    this.assertTurn(turn);
    return turn;
  }
  assertTurn(turn: KiroHostTurn): void {
    if (!turn || this.#session(turn.session).turn !== turn || turn.signal.aborted) throw new Error("Foreign, stale or ended host turn");
  }
  /** One owning MCP server; no implicit rebinding to a second transport. */
  attach(retire: (session: KiroHostSession) => Promise<void>): void {
    if (this.#attached || this.#closed) throw new Error("Host session adapter already attached or closed");
    this.#attached = true; this.#retire = retire;
  }
  retireSession(session: KiroHostSession): Promise<void> {
    const state = this.#sessions.get(session);
    if (!state) throw new Error("Foreign or retired host session");
    if (state.retirement) return state.retirement;
    state.controller.abort(new Error("Host session retired"));
    if (state.turn) this.#forgetTurn(state.turn);
    // Invoke synchronously: Fovea leases/catalogs must be revoked before returning
    // this promise, not after a lifecycle queue or active effect drain.
    let cleanup: Promise<void>;
    try { cleanup = this.#retire?.(session) ?? Promise.resolve(); }
    catch (error) { cleanup = Promise.reject(error); }
    state.retirement = cleanup.then(() => { this.#sessions.delete(session); });
    // Failed cleanup retains the capacity reservation and is surfaced to callers.
    return state.retirement;
  }
  #session(session: KiroHostSession): SessionState {
    const state = this.#sessions.get(session);
    if (this.#closed || !state || session.signal.aborted) throw new Error("Foreign, stale or retired host session");
    return state;
  }
  #forgetTurn(turn: KiroHostTurn): void {
    for (const [id, owner] of this.#requests) if (owner === turn) this.#requests.delete(id);
    for (const [id, receipt] of this.#receipts) if (receipt.turn === turn) this.#receipts.delete(id);
  }
  /** Wrap the SAME outbox claim, not a second delivery queue. Only the MCP
   * transport can settle emission; a receipt is stronger and remains separate.
   * Call-local context is transient and must not use this semantic-sync ledger. */
  bindDelivery(turn: KiroHostTurn, claim: FoveaDeliveryClaim, acknowledge: (noticeId: string) => Promise<void>): FoveaDeliveryClaim | undefined {
    try { this.assertTurn(turn); } catch { claim.cancel(); return undefined; }
    if (this.#receipts.size + claim.notices.length > 64 || claim.notices.some(n => this.#receipts.has(n.noticeId))) { claim.cancel(); return undefined; }
    const receipts = claim.notices.map(notice => ({ id: notice.noticeId, receipt: { turn, state: "prepared" as const, acknowledge: () => acknowledge(notice.noticeId) } as Receipt }));
    for (const { id, receipt } of receipts) this.#receipts.set(id, receipt);
    let settled = false;
    const current = (): boolean => {
      try { this.assertTurn(turn); return claim.isCurrent() && receipts.every(({ id, receipt }) => this.#receipts.get(id) === receipt); } catch { return false; }
    };
    const cancel = (): void => {
      turn.signal.removeEventListener("abort", cancel);
      if (!settled) claim.cancel();
      for (const { id, receipt } of receipts) if (this.#receipts.get(id) === receipt) this.#receipts.delete(id);
      settled = true;
    };
    turn.signal.addEventListener("abort", cancel, { once: true });
    const settle = (kind: "emitted" | "uncertain"): void => {
      if (settled) return;
      if (!current()) { cancel(); return; }
      claim[kind](); settled = true;
      for (const { receipt } of receipts) receipt.state = kind;
      // Keep the receipt until this turn ends; it does not outlive its owner.
      turn.signal.removeEventListener("abort", cancel);
    };
    return { notices: claim.notices, isCurrent: current, emitted: () => settle("emitted"), uncertain: () => settle("uncertain"), cancel };
  }
  /** Trusted bridge only, after observing this exact notice in this exact model
   * input. Never call on stdout/write success, an assistant echo, or a guest ack.
   * Duplicate, foreign, early and late receipts cannot advance a baseline. */
  async acknowledgeModelInput(turn: KiroHostTurn, noticeId: string): Promise<boolean> {
    this.assertTurn(turn);
    const receipt = this.#receipts.get(noticeId);
    if (!receipt || receipt.turn !== turn || receipt.state === "prepared") return false;
    try {
      // Install the shared promise before invoking host code. A synchronous
      // throw or reentrant receipt must not leave the callback retryable.
      receipt.pending ??= Promise.resolve().then(() => {
        this.assertTurn(turn);
        if (this.#receipts.get(noticeId) !== receipt) throw new Error("Host delivery receipt revoked");
        return receipt.acknowledge();
      });
      await receipt.pending;
      this.assertTurn(turn);
      if (this.#receipts.get(noticeId) === receipt) this.#receipts.delete(noticeId);
      return true;
    } catch (error) {
      // Do not retry a failed/uncertain acknowledgment automatically.
      if (this.#receipts.get(noticeId) === receipt) this.#receipts.delete(noticeId);
      throw error;
    }
  }
  close(): Promise<void> {
    if (this.#closeTask) return this.#closeTask;
    this.#closed = true;
    const tasks = [...this.#sessions.keys()].map(session => this.retireSession(session));
    this.#requests.clear(); this.#receipts.clear();
    this.#closeTask = Promise.allSettled(tasks).then(results => {
      const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failure) throw failure.reason;
    });
    return this.#closeTask;
  }
}
