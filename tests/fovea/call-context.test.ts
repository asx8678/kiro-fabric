import { describe, expect, it, vi } from 'vitest';
import { FoveaOutbox } from '../../src/fovea/delivery.js';
import { FoveaCallObservation, collectFoveaCallContext } from '../../src/kiro/fovea-call-context.js';
import type { FoveaBoundClient } from '../../src/fovea/host.js';
import type { KiroProjectionResult } from '../../src/kiro/projection.js';

const projection = (text = '{"ok":true}'): KiroProjectionResult => ({ text, isError: false, executionStatus: 'succeeded', deliveryStatus: 'inline', retryProgram: false, visibleChars: text.length, visibleBytes: Buffer.byteLength(text), overflowed: false, artifactRetained: false, retention: 'inline' });
const event = (ref: string, phase: 'prepared' | 'access' | 'committed' | 'failed' | 'settled', paths?: string[], operationId = 'op') => ({ sequence: 1, operationId, ref, phase, ...(paths ? { paths } : {}) });

describe('invocation-local Fovea call context', () => {
  it('advises only on changed files and keeps diagnostics from suppressing them', () => {
    const host = { observe: vi.fn(), gap: vi.fn() };
    const observed = new FoveaCallObservation('/repo', host);
    observed.observe(event('repo.status', 'settled'));
    observed.observe(event('local.read', 'access', ['/repo/src/a.ts']));
    observed.observe(event('local.grep', 'access', ['/repo/src/b.ts']));
    expect(observed.files()).toEqual([]);
    observed.observe(event('local.edit', 'committed', ['/repo/src/a.ts']));
    expect(observed.files()).toEqual(['src/a.ts']);
    expect(host.observe).toHaveBeenCalledTimes(4);
    const failed = new FoveaCallObservation('/repo');
    failed.observe(event('local.read', 'failed', ['/repo/src/a.ts']));
    failed.observe(event('local.edit', 'committed', ['/repo/src/a.ts']));
    expect(failed.files()).toEqual([]);
    const escape = new FoveaCallObservation('/repo');
    escape.observe(event('local.edit', 'committed', ['/repo/../secret.ts']));
    expect(escape.files()).toEqual([]);
    const gapped = new FoveaCallObservation('/repo', host);
    gapped.observe(event('local.edit', 'committed', ['/repo/src/a.ts']));
    gapped.gap();
    expect(gapped.files()).toEqual([]);
    expect(host.gap).toHaveBeenCalledOnce();
  });
  it('suppresses redundant hints after current navigation, then re-enables after a later edit', () => {
    const nav = new FoveaCallObservation('/repo');
    nav.observe(event('local.read', 'access', ['/repo/src/a.ts']));
    nav.observe(event('repo.focus', 'prepared', undefined, 'focus-1'));
    nav.observe(event('repo.focus', 'settled', undefined, 'focus-1'));
    expect(nav.files()).toEqual([]);
    nav.observe(event('local.edit', 'committed', ['/repo/src/a.ts']));
    expect(nav.files()).toEqual(['src/a.ts']);
    const stale = new FoveaCallObservation('/repo');
    stale.observe(event('repo.focus', 'prepared', undefined, 'old'));
    stale.observe(event('local.edit', 'committed', ['/repo/src/b.ts']));
    stale.observe(event('repo.focus', 'settled', undefined, 'old'));
    expect(stale.files()).toEqual(['src/b.ts']);
  });
  it('keeps a bounded sample of large read batches and prefers later mutations', () => {
    const many = new FoveaCallObservation('/repo');
    many.observe(event('local.readMany', 'access', Array.from({ length: 17 }, (_, i) => `/repo/file${i}.ts`)));
    expect(many.sampled()).toBe(true);
    expect(many.files()).toEqual([]);
    many.observe(event('local.edit', 'committed', ['/repo/file16.ts']));
    expect(many.files()).toEqual(['file16.ts']);
  });
  it('preserves guest results when analysis is skipped or fails and does not gap the host observer', async () => {
    const outbox = new FoveaOutbox();
    const hostGap = vi.fn();
    const client: FoveaBoundClient = {
      rootId: 'root', invoke: vi.fn(), close: vi.fn(), acknowledgeDelivery: vi.fn(),
      observer: { observe: vi.fn(), gap: hostGap },
      collectContext: vi.fn(),
      collectCallContext: vi.fn(async (_files, _ctx, max) => outbox.claim('root', 1, max)),
    };
    const observations = new FoveaCallObservation('/repo');
    expect(await collectFoveaCallContext(client, observations, projection(), { cwd: '/repo' }, 4000)).toEqual({ projection: projection() });
    expect(client.collectCallContext).not.toHaveBeenCalled();
    observations.observe(event('local.edit', 'committed', ['/repo/math.ts']));
    expect(await collectFoveaCallContext(client, observations, { ...projection(), isError: true, executionStatus: 'failed' }, { cwd: '/repo' }, 4000))
      .toEqual({ projection: { ...projection(), isError: true, executionStatus: 'failed' } });
    vi.mocked(client.collectCallContext!).mockRejectedValue(new Error('parser unavailable'));
    expect(await collectFoveaCallContext(client, observations, projection(), { cwd: '/repo' }, 4000)).toEqual({ projection: projection() });
    expect(hostGap).not.toHaveBeenCalled();
  });
  it('appends a same-call advisory from collectCallContext without rewriting status metadata', async () => {
    const outbox = new FoveaOutbox();
    outbox.prepare('root', 1, 'impact math.ts', 'own', 'call:snap');
    const client: FoveaBoundClient = {
      rootId: 'root', invoke: vi.fn(), close: vi.fn(), acknowledgeDelivery: vi.fn(),
      observer: { observe: vi.fn(), gap: vi.fn() },
      collectContext: vi.fn(),
      collectCallContext: vi.fn(async (files, _ctx, max, sampled) => { expect(files).toEqual(['math.ts']); expect(sampled).toBe(false); return outbox.claim('root', 1, max); }),
    };
    const observations = new FoveaCallObservation('/repo');
    observations.observe(event('local.read', 'access', ['/repo/math.ts']));
    observations.observe(event('local.edit', 'committed', ['/repo/math.ts']));
    const original = projection('{"taskValue":"unchanged"}');
    const result = await collectFoveaCallContext(client, observations, original, { cwd: '/repo' }, 4000);
    expect(result.projection.text.startsWith(original.text)).toBe(true);
    expect(result.projection.text).toContain('Navigator advisory (untrusted');
    expect(result.projection.text).toContain('impact math.ts');
    expect(result.projection).toMatchObject({ isError: false, executionStatus: 'succeeded', retryProgram: false });
    expect(client.collectContext).not.toHaveBeenCalled();
  });
});
