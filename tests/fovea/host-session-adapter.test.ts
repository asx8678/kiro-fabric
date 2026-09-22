import { describe, expect, it, vi } from 'vitest';
import { KiroHostSessionAdapter, type KiroHostSession, type KiroHostTurn } from '../../src/kiro/host-session-adapter.js';
import { REPO_ACTION_DESCRIPTORS } from '../../src/providers/repo-contract.js';
import { FoveaOutbox } from '../../src/fovea/delivery.js';
import { FoveaResponseDelivery } from '../../src/kiro/fovea-context.js';
import type { WorkspaceContextProvider } from '../../src/kiro/power/workspace-context.js';

const workspaceContext: WorkspaceContextProvider = { current: async () => ({ status: 'explicitly-empty', roots: [], revision: 1, observedAt: 0 }), invalidate() {}, subscribe: () => ({ dispose() {} }) };
const open = (adapter: KiroHostSessionAdapter, id = 'a', epoch = 1) => adapter.openSession({ conversationId: id, conversationEpoch: epoch, workspaceContext });
const notice = (outbox: FoveaOutbox, root = 'root') => {
  const id = outbox.prepare(root, 1, 'advisory', 'own');
  return { id, claim: outbox.claim(root, 1, 1000)! };
};

describe('trusted embedding contract (not native Kiro qualification)', () => {
  it('keeps lifecycle and acknowledgment controls out of the guest action registry', () => {
    expect(REPO_ACTION_DESCRIPTORS.map(action => action.name)).not.toEqual(expect.arrayContaining(['retireConversation']));
    for (const action of REPO_ACTION_DESCRIPTORS) expect(action.name).not.toMatch(/retire|acknowledge|openSession|associateRequest/);
    expect(REPO_ACTION_DESCRIPTORS.find(action => action.name === 'reload')!.description).toContain('PROCESS-WIDE');
  });
  it('routes one-shot request IDs only through live opaque session and turn handles', async () => {
    const adapter = new KiroHostSessionAdapter(), a = open(adapter), b = open(adapter, 'b');
    const at = adapter.beginTurn(a), bt = adapter.beginTurn(b);
    expect(() => adapter.beginTurn({ ...a } as KiroHostSession)).toThrow(/Foreign/);
    expect(() => adapter.associateRequest(1, { ...at } as KiroHostTurn)).toThrow(/Foreign/);
    adapter.associateRequest(1, at); adapter.associateRequest('2', bt);
    expect(() => adapter.associateRequest(1, bt)).toThrow(/ambiguous/);
    expect(adapter.takeRequest(1)).toBe(at); expect(adapter.takeRequest('2')).toBe(bt);
    expect(() => adapter.takeRequest(1)).toThrow(/No trusted/);
    adapter.associateRequest(3, at);
    adapter.beginTurn(a);
    expect(at.signal.aborted).toBe(true);
    expect(() => adapter.takeRequest(3)).toThrow(/No trusted/);
    expect(() => adapter.associateRequest(4, at)).toThrow();
    await adapter.close();
  });
  it('revokes synchronously, retains retiring capacity until cleanup, and forbids copied owners', async () => {
    const adapter = new KiroHostSessionAdapter(), a = open(adapter);
    let release!: () => void;
    const pending = new Promise<void>(r => { release = r; });
    const retire = vi.fn(() => pending); adapter.attach(retire);
    const turn = adapter.beginTurn(a); adapter.associateRequest(1, turn);
    const done = adapter.retireSession(a);
    expect(a.signal.aborted).toBe(true); expect(turn.signal.aborted).toBe(true); expect(retire).toHaveBeenCalledWith(a);
    expect(adapter.retireSession(a)).toBe(done);
    expect(() => open(adapter)).toThrow(/retiring/);
    expect(() => adapter.takeRequest(1)).toThrow();
    expect(() => adapter.retireSession({ ...a })).toThrow(/Foreign/);
    release(); await done;
    const fresh = open(adapter); expect(fresh).not.toBe(a);
    expect(() => adapter.beginTurn(a)).toThrow();
    await adapter.close();
  });
  it('bounds all admission and reclaims repeated retired sessions', async () => {
    const adapter = new KiroHostSessionAdapter(); adapter.attach(async () => {});
    for (let i = 0; i < 160; i++) await adapter.retireSession(open(adapter, `c${i}`));
    const sessions = Array.from({ length: 32 }, (_, i) => open(adapter, `active${i}`));
    expect(() => open(adapter, 'overflow')).toThrow(/capacity/);
    const turn = adapter.beginTurn(sessions[0]!);
    for (let i = 0; i < 64; i++) adapter.associateRequest(i, turn);
    expect(() => adapter.associateRequest(64, turn)).toThrow(/full/);
    adapter.endTurn(turn);
    const next = adapter.beginTurn(sessions[0]!); adapter.associateRequest(64, next);
    expect(adapter.takeRequest(64)).toBe(next);
    expect(() => adapter.attach(async () => {})).toThrow(/attached/);
    await adapter.close();
    expect(() => open(adapter)).toThrow(/closed/);
  });
  it('never treats emission, another turn, or early/duplicate receipts as acknowledgment', async () => {
    const adapter = new KiroHostSessionAdapter(), at = adapter.beginTurn(open(adapter)), bt = adapter.beginTurn(open(adapter, 'b'));
    const outbox = new FoveaOutbox(), n = notice(outbox), acknowledge = vi.fn(async () => { outbox.remove(n.id); });
    const claim = adapter.bindDelivery(at, n.claim, acknowledge)!;
    expect(await adapter.acknowledgeModelInput(at, n.id)).toBe(false);
    claim.emitted();
    expect(outbox.status()).toMatchObject({ emitted: 1, acknowledged: 0 }); expect(acknowledge).not.toHaveBeenCalled();
    expect(await adapter.acknowledgeModelInput(bt, n.id)).toBe(false);
    await Promise.all([adapter.acknowledgeModelInput(at, n.id), adapter.acknowledgeModelInput(at, n.id)]);
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(await adapter.acknowledgeModelInput(at, n.id)).toBe(false);
    expect(outbox.status()).toMatchObject({ emitted: 0, pending: 0 });
    await adapter.close();
  });
  it('suppresses revoked suffixes while preserving original effects and recovery metadata', async () => {
    const adapter = new KiroHostSessionAdapter(), a = open(adapter), turn = adapter.beginTurn(a);
    const outbox = new FoveaOutbox(), n = notice(outbox), acknowledge = vi.fn(async () => {});
    const claim = adapter.bindDelivery(turn, n.claim, acknowledge)!;
    const delivery = new FoveaResponseDelivery();
    expect(delivery.track(1, claim, turn.signal, 'original write outcome')).toBe(true);
    await adapter.retireSession(a);
    const response = { id: 1, result: { content: [{ type: 'text', text: 'original write outcome\nadvisory' }], isError: true, structuredContent: { receiptId: 'effect', retryProgram: false } } };
    const sent: typeof response[] = [];
    await delivery.send(response, async message => { sent.push(message); });
    expect(sent[0]!.result).toEqual({ ...response.result, content: [{ type: 'text', text: 'original write outcome' }] });
    expect(acknowledge).not.toHaveBeenCalled();
    await expect(adapter.acknowledgeModelInput(turn, n.id)).rejects.toThrow();
    delivery.close(); await adapter.close();
  });
  it('accepts a trustworthy receipt after uncertain transport, but never retries failed acknowledgment', async () => {
    const adapter = new KiroHostSessionAdapter(), turn = adapter.beginTurn(open(adapter));
    const outbox = new FoveaOutbox(), n = notice(outbox), acknowledge = vi.fn(async () => { throw new Error('uncertain ack'); });
    adapter.bindDelivery(turn, n.claim, acknowledge)!.uncertain();
    expect(outbox.status().uncertain).toBe(1); expect(acknowledge).not.toHaveBeenCalled();
    await expect(adapter.acknowledgeModelInput(turn, n.id)).rejects.toThrow('uncertain ack');
    expect(await adapter.acknowledgeModelInput(turn, n.id)).toBe(false); expect(acknowledge).toHaveBeenCalledTimes(1);
    await adapter.close();
  });
  it('does not retry an acknowledgment callback that throws synchronously', async () => {
    const adapter = new KiroHostSessionAdapter(), turn = adapter.beginTurn(open(adapter));
    const n = notice(new FoveaOutbox());
    const acknowledge = vi.fn(() => { throw new Error('synchronous failure'); });
    adapter.bindDelivery(turn, n.claim, acknowledge)!.emitted();
    await expect(adapter.acknowledgeModelInput(turn, n.id)).rejects.toThrow('synchronous failure');
    expect(await adapter.acknowledgeModelInput(turn, n.id)).toBe(false);
    expect(acknowledge).toHaveBeenCalledTimes(1);
    await adapter.close();
  });
  it('shares the pending acknowledgment before calling reentrant host code', async () => {
    const adapter = new KiroHostSessionAdapter(), turn = adapter.beginTurn(open(adapter));
    const n = notice(new FoveaOutbox());
    let nested: Promise<boolean> | undefined;
    let entered = false;
    const acknowledge = vi.fn(() => {
      if (!entered) { entered = true; nested = adapter.acknowledgeModelInput(turn, n.id); }
      return Promise.resolve();
    });
    adapter.bindDelivery(turn, n.claim, acknowledge)!.emitted();
    expect(await adapter.acknowledgeModelInput(turn, n.id)).toBe(true);
    expect(await nested).toBe(true);
    expect(acknowledge).toHaveBeenCalledTimes(1);
    await adapter.close();
  });
  it('rechecks turn ownership before dispatching a queued acknowledgment', async () => {
    const adapter = new KiroHostSessionAdapter(), turn = adapter.beginTurn(open(adapter));
    const n = notice(new FoveaOutbox()), acknowledge = vi.fn(async () => {});
    adapter.bindDelivery(turn, n.claim, acknowledge)!.emitted();
    const pending = adapter.acknowledgeModelInput(turn, n.id);
    adapter.endTurn(turn);
    await expect(pending).rejects.toThrow(/turn/);
    expect(acknowledge).not.toHaveBeenCalled();
    await adapter.close();
  });
  it('rejects receipts after turn replacement and capacity failures cancel only new claims', async () => {
    const adapter = new KiroHostSessionAdapter(), session = open(adapter), turn = adapter.beginTurn(session);
    const receipts: string[] = [];
    for (let i = 0; i < 64; i++) {
      const n = notice(new FoveaOutbox()); receipts.push(n.id);
      adapter.bindDelivery(turn, n.claim, async () => {})!.emitted();
    }
    const overflow = notice(new FoveaOutbox());
    expect(adapter.bindDelivery(turn, overflow.claim, async () => {})).toBeUndefined();
    expect(overflow.claim.isCurrent()).toBe(false);
    const next = adapter.beginTurn(session);
    await expect(adapter.acknowledgeModelInput(turn, receipts[0]!)).rejects.toThrow();
    expect(await adapter.acknowledgeModelInput(next, receipts[0]!)).toBe(false);
    const fresh = notice(new FoveaOutbox());
    expect(adapter.bindDelivery(next, fresh.claim, async () => {})).toBeDefined();
    await adapter.close();
  });
});
