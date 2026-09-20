import { describe, expect, it, vi } from 'vitest';
import { FoveaOutbox } from '../../src/fovea/delivery.js';
import { collectFoveaContext, FoveaResponseDelivery } from '../../src/kiro/fovea-context.js';
import type { FoveaBoundClient } from '../../src/fovea/host.js';
import type { KiroProjectionResult } from '../../src/kiro/projection.js';

const projection = (text = 'original'): KiroProjectionResult => ({ text, isError: false, executionStatus: 'succeeded', deliveryStatus: 'inline', retryProgram: false, visibleChars: text.length, visibleBytes: Buffer.byteLength(text), overflowed: false, artifactRetained: false, retention: 'inline' });
function fixture(text = 'Navigation only; inspect sources') {
  const outbox = new FoveaOutbox();
  const id = outbox.prepare('root', 1, text, 'own', 'snapshot');
  const client: FoveaBoundClient = { rootId: 'root', invoke: vi.fn(), close: vi.fn(), acknowledgeDelivery: vi.fn(), observer: { observe: vi.fn(), gap: vi.fn() }, collectContext: vi.fn(async (_ctx, max) => outbox.claim('root', 1, max)) };
  return { client, outbox, id };
}

describe('execution-owned Fovea projection and transport', () => {
  it('preserves arbitrary guest projection and failure/recovery truth; emission requires transport success', async () => {
    const f = fixture(), original = { ...projection('null\nRecovery receipt receipt_1; retryProgram: false.'), executionStatus: 'failed' as const, isError: true, receiptId: 'receipt_1' };
    const result = await collectFoveaContext(f.client, original, { cwd: '/root' }, 4000);
    expect(result.projection.text.startsWith(original.text)).toBe(true);
    expect(result.projection.text).toContain('untrusted repository-derived data');
    expect(result.projection).toMatchObject({ isError: true, executionStatus: 'failed', retryProgram: false, receiptId: 'receipt_1' });
    expect(original.text).not.toContain('Fovea');
    expect(f.outbox.status()).toMatchObject({ pending: 1, emitted: 0, acknowledged: 0 });
    const ledger = new FoveaResponseDelivery();
    expect(ledger.track(1, result.delivery!, new AbortController().signal, original.text)).toBe(true);
    await ledger.send({ id: 1, result: { content: [{ type: 'text', text: result.projection.text }] } }, async () => { expect(f.outbox.status().emitted).toBe(0); });
    expect(f.outbox.status()).toMatchObject({ emitted: 1, acknowledged: 0 });
    expect(f.client.acknowledgeDelivery).not.toHaveBeenCalled();
    expect(f.outbox.prepare('root', 1, 'Navigation only; inspect sources', 'own', 'snapshot')).toBe(f.id);
    expect(await collectFoveaContext(f.client, original, { cwd: '/root' }, 4000)).toEqual({ projection: original });
  });
  it('does not evict required output for tiny budgets or compute after cancellation', async () => {
    const f = fixture(), original = projection('required'.repeat(100));
    expect(await collectFoveaContext(f.client, original, { cwd: '/root' }, original.text.length)).toEqual({ projection: original });
    expect(await collectFoveaContext(f.client, original, { cwd: '/root', signal: AbortSignal.abort() }, 4000)).toEqual({ projection: original });
    expect(f.client.collectContext).not.toHaveBeenCalled();
  });
  it('budgets full serialization including escaping and retains oversized notices', async () => {
    const f = fixture('"\\'.repeat(400)), original = projection();
    expect(await collectFoveaContext(f.client, original, { cwd: '/root' }, 1200)).toEqual({ projection: original });
    expect(f.outbox.claim('root', 1, 4000)).toBeDefined();
  });
  it('never replaces completed tool outcomes when analysis fails', async () => {
    const f = fixture(); vi.mocked(f.client.collectContext).mockRejectedValue(new Error('parser unavailable'));
    const original = projection('committed');
    expect(await collectFoveaContext(f.client, original, { cwd: '/root' }, 4000)).toEqual({ projection: original });
    expect(f.client.observer.gap).toHaveBeenCalledOnce();
  });
  it.each(['cancel', 'revoke'])('suppresses only advisory on %s between preparation and transport', async kind => {
    const f = fixture(), original = projection('committed result'), abort = new AbortController(), ledger = new FoveaResponseDelivery();
    const result = await collectFoveaContext(f.client, original, { cwd: '/root' }, 4000);
    ledger.track('r', result.delivery!, abort.signal, original.text);
    if (kind === 'cancel') abort.abort(); else f.outbox.revoke('root');
    const write = vi.fn(async (_m: unknown) => {});
    await ledger.send({ id: 'r', result: { content: [{ type: 'text', text: result.projection.text }], structuredContent: { retryProgram: false } } }, write);
    expect(write).toHaveBeenCalledWith({ id: 'r', result: { content: [{ type: 'text', text: original.text }], structuredContent: { retryProgram: false } } });
    expect(f.outbox.status().emitted).toBe(0);
  });
  it('retains uncertain emission for explicit replay and releases abandoned claims on close', async () => {
    const f = fixture(), original = projection(), ledger = new FoveaResponseDelivery();
    const result = await collectFoveaContext(f.client, original, { cwd: '/root' }, 4000);
    ledger.track(1, result.delivery!, new AbortController().signal, original.text);
    await expect(ledger.send({ id: 1, result: {} }, async () => { throw new Error('pipe closed'); })).rejects.toThrow('pipe closed');
    expect(f.outbox.status()).toMatchObject({ uncertain: 1, acknowledged: 0 });
    f.outbox.replay();
    const next = f.outbox.claim('root', 1, 4000)!;
    ledger.track(2, next, new AbortController().signal, original.text); ledger.close();
    expect(f.outbox.claim('root', 1, 4000)?.notices[0]?.noticeId).toBe(f.id);
  });
  it('does not disclose another root/conversation notice counts in scoped status', () => {
    const f = fixture();
    expect(f.outbox.status('another-root', 1)).toMatchObject({ pending: 0 });
    expect(f.outbox.status('root', 2)).toMatchObject({ pending: 0 });
    expect(f.outbox.status('root', 1)).toMatchObject({ pending: 1 });
  });
  it('shares claims across channels; foreign-only notices wait for a prompt', () => {
    const f = fixture(), claim = f.outbox.claim('root', 1, 4000)!;
    expect(f.outbox.claim('root', 1, 4000, true)).toBeUndefined();
    claim.cancel();
    f.outbox.remove(f.id);
    const foreign = f.outbox.prepare('root', 1, 'foreign change', 'foreign');
    expect(f.outbox.claim('root', 1, 4000)).toBeUndefined();
    expect(f.outbox.claim('root', 1, 4000, true)?.notices[0]?.noticeId).toBe(foreign);
  });
});
