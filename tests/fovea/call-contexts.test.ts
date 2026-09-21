import { describe, expect, it } from 'vitest';
import { FOVEA_CALL_COLD_MS, FOVEA_CALL_COLLECTION_MS, FOVEA_CALL_RESERVE_MS, FOVEA_CALL_WARM_MS, FoveaCallContexts } from '../../src/fovea/call-context.js';
import { FabricDeadline } from '../../src/runtime/deadline.js';

describe('disposable same-call Fovea notices', () => {
  it('isolates cancelled notices from the next invocation and does not fill the sync outbox', () => {
    const calls = new FoveaCallContexts();
    const first = new AbortController();
    const claim = calls.claim('root', 1, 'call:a', 'old unrelated.ts impact', 4000, first.signal, () => {});
    expect(claim?.notices).toHaveLength(1);
    claim?.cancel();
    const second = new AbortController();
    const next = calls.claim('root', 1, 'call:b', 'current.ts impact', 4000, second.signal, () => {});
    expect(next?.notices.map(n => n.text)).toEqual(['current.ts impact']);
    next?.emitted();
    expect(calls.claim('root', 1, 'call:b', 'current.ts impact', 4000, new AbortController().signal, () => {})).toBeUndefined();
  });
  it('accepts more than 32 distinct emitted advisories without throwing', () => {
    const calls = new FoveaCallContexts();
    for (let i = 0; i < 40; i++) {
      const claim = calls.claim('root', 1, `call:${i}`, `impact ${i}`, 4000, new AbortController().signal, () => {});
      expect(claim, `advisory ${i}`).toBeDefined();
      claim!.emitted();
    }
  });
  it('admits cold work after collection deadline setup without borrowing the cleanup reserve', () => {
    const calls = new FoveaCallContexts();
    let now = 0;
    const deadline = new FabricDeadline(FOVEA_CALL_COLLECTION_MS, FOVEA_CALL_COLLECTION_MS, () => now);
    now = 0.001;
    expect(calls.budget('root', 1, deadline.remainingMs())).toBe(FOVEA_CALL_COLD_MS);
    now = 500;
    expect(calls.budget('root', 1, deadline.remainingMs())).toBe(FOVEA_CALL_COLD_MS);
    now = FOVEA_CALL_COLLECTION_MS - FOVEA_CALL_COLD_MS - FOVEA_CALL_RESERVE_MS + 1;
    expect(calls.budget('root', 1, deadline.remainingMs())).toBe(0);
    const shortOuter = new FabricDeadline(7_999, 7_999, () => 0);
    expect(calls.budget('root', 1, shortOuter.remainingMs())).toBe(0);
    const real = new FabricDeadline(FOVEA_CALL_COLLECTION_MS, FOVEA_CALL_COLLECTION_MS);
    expect(calls.budget('root', 1, real.remainingMs())).toBe(FOVEA_CALL_COLD_MS);
  });
  it('uses a 6s cold floor, 750ms warm cap, and a retry hold after failure', () => {
    let now = 1_000;
    const calls = new FoveaCallContexts(() => now);
    expect(calls.budget('root', 1, FOVEA_CALL_COLD_MS + FOVEA_CALL_RESERVE_MS - 1)).toBe(0);
    expect(calls.budget('root', 1, FOVEA_CALL_COLD_MS + FOVEA_CALL_RESERVE_MS)).toBe(FOVEA_CALL_COLD_MS);
    calls.analyzed('root', 3);
    expect(calls.budget('root', 3, FOVEA_CALL_WARM_MS + FOVEA_CALL_RESERVE_MS)).toBe(FOVEA_CALL_WARM_MS);
    expect(calls.budget('root', 3, FOVEA_CALL_RESERVE_MS + 50)).toBe(0);
    calls.failed('root');
    expect(calls.budget('root', 3, 20_000)).toBe(0);
    now += 60_000;
    expect(calls.budget('root', 4, FOVEA_CALL_COLD_MS + FOVEA_CALL_RESERVE_MS)).toBe(FOVEA_CALL_COLD_MS);
  });
});
