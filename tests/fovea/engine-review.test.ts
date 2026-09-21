import { removeFixture as rm } from "../fixture-cleanup.mjs";
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as operations from '../../src/fovea/core/ops.js';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, link, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { FoveaEngine, type EngineRequest, type NavigationResult } from '../../src/fovea/engine.js';
import { sha256 } from '../../src/fovea/parser-executable.js';
import { captureSourceSnapshot } from '../../src/fovea/source-access.js';
import { boundResultDetails } from '../../src/fovea/core/result-budget.js';
const parser = { path: resolve('.tmp/fovea-parser/ast-grep'), sha256: '7a5ab30160186184c0bf8bffc87da4af25123c183964cd98c11b0b354137db0a', version: '0.45.3' };
const dirs: string[] = [], engines: FoveaEngine[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(engines.splice(0).map(e => e.close())); await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function setup(): Promise<{ root: string; storage: string; base: string }> {
  const base = await mkdtemp(join(tmpdir(), 'fovea-review-')); dirs.push(base);
  const root = join(base, 'root'), storage = join(base, 'storage');
  await mkdir(root, { mode: 0o700 }); await mkdir(storage, { mode: 0o700 });
  await writeFile(join(root, 'math.ts'), 'export function calculateTotal() { return 1; }\n');
  return { root, storage, base };
}
function request(root: string, operation: string, args: Record<string, unknown> = {}): EngineRequest { return { root, operation, args, conversationId: 'conversation', conversationEpoch: 1, rootId: 'bindingA', authorizationEpoch: 1 }; }
function own(e: FoveaEngine): FoveaEngine { engines.push(e); return e; }

describe.skipIf(process.platform !== 'linux' || !existsSync(parser.path))('engine review regressions', () => {
  it('reuses physical A after A-B-A rebinding and retains default dwell', async () => {
    const a = await setup(), b = await setup(); const e = own(new FoveaEngine({ parser, storageRoot: a.storage }));
    const first = await e.query(request(a.root, 'focus', { query: 'calculateTotal' })) as NavigationResult;
    await e.query({ ...request(b.root, 'sketch'), rootId: 'bindingB' });
    const again = await e.query({ ...request(a.root, 'dwell', { factor: 1 }), rootId: 'bindingA2', authorizationEpoch: 3 }) as NavigationResult;
    expect(again.focusId).toBe(first.focusId); expect(again.graphGeneration).toBe(first.graphGeneration);
    expect(again.details).toMatchObject({ snapshotReused: true, from: 2, to: 2.4 });
    for (const r of again.reads) expect(r.limit).toBeLessThanOrEqual(2000);
  });
  it('skips hardlinks, unsupported bytes and untrusted project rules before extraction', async () => {
    const { root, storage } = await setup();
    await link(join(root, 'math.ts'), join(root, 'alias.ts'));
    await writeFile(join(root, 'opaque.bin'), Buffer.alloc(1024));
    await mkdir(join(root, '.fovea')); await writeFile(join(root, '.fovea', 'rules.json'), '{"rules":[]}');
    const snapshot = await captureSourceSnapshot(root, storage);
    expect(snapshot.hashes.size).toBe(0);
    expect(snapshot.coverage.counts).toMatchObject({ hardlinks: 2, unsupported: 1, untrustedProjectRules: 1 });
  });
  it('paginates discovered hypotheses and anchors, and rejects adoption', async () => {
    const { root, storage } = await setup();
    for (const [file, prefix] of [['a.py', 'one'], ['b.py', 'two']]) await writeFile(join(root, file!), Array.from({ length: 4 }, (_, i) => `jobm.schedule("/ops/${prefix}/${i}", handler)`).join('\n'));
    await mkdir(join(root, '.fovea')); await writeFile(join(root, '.fovea', 'rules.json'), JSON.stringify({ rules: [{ id: 'untrusted', pattern: '$F($P)', methods: '.*', langs: ['TypeScript'] }] }));
    const e = own(new FoveaEngine({ parser, storageRoot: storage }));
    const first = await e.query(request(root, 'anchors', { offset: 0, limit: 1 }));
    const next = await e.query(request(root, 'anchors', { offset: 1, limit: 1 }));
    expect(first.anchors).toHaveLength(1); expect(next.anchors).toHaveLength(1); expect(next.anchors).not.toEqual(first.anchors); expect(first.total).toBeGreaterThan(1);
    const rules = await e.query(request(root, 'rules', { limit: 1 }));
    expect(rules.total).toBeGreaterThan(0); expect(rules.rules).toHaveLength(1); expect(JSON.stringify(rules.rules)).toContain('schedule');
    expect(rules.trust).toBe('built-in-only');
    expect(rules.inventory).toMatchObject({ rules: [expect.objectContaining({ id: expect.any(String) })], totalRules: expect.any(Number), fileRoutes: expect.any(Array), truncated: true });
    const nextRules = await e.query(request(root, 'rules', { offset: 1, limit: 1 }));
    expect((nextRules.inventory as { rules: unknown[] }).rules).not.toEqual((rules.inventory as { rules: unknown[] }).rules);
    await expect(e.query(request(root, 'rules', { adopt: true }))).rejects.toThrow('adoption');
  });
  it('binds parser output to snapshot bytes while the same-size original changes during parsing', async () => {
    const { root, storage, base } = await setup(); const source = join(root, 'math.ts'); const old = await readFile(source);
    const changed = old.toString().replace('calculateTotal', 'calculateOther');
    const wrapper = join(base, 'parser');
    const script = `#!/bin/sh\nif [ "$1" != "--version" ]; then printf '%s' '${changed.trim()}' > '${source}'; fi\nexec '${parser.path}' "$@"\n`;
    await writeFile(wrapper, script, { mode: 0o700 });
    const e = own(new FoveaEngine({ parser: { ...parser, path: wrapper, sha256: sha256(script) }, storageRoot: storage }));
    const result = await e.query(request(root, 'focus', { query: 'calculateTotal', fresh: true })) as NavigationResult;
    expect(result.status).toBe('ok'); expect(result.reads.find(r => r.path === 'math.ts')?.expectedSha256).toBe(sha256(old));
    expect(await readFile(source, 'utf8')).toContain('calculateOther');
    expect(result.text).toContain('calculateTotal');
    const next = await e.query(request(root, 'focus', { query: 'calculateOther', fresh: true })); expect(next.status).toBe('ok');
    expect(next.sourceSnapshotId).not.toBe(result.sourceSnapshotId);
  });
  it('kills an active parser before rejecting cancellation, without baseline publication', async () => {
    const { root, storage, base } = await setup(); const wrapper = join(base, 'parser'), marker = join(base, 'pid');
    const script = `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 'ast-grep 0.45.3'; exit 0; fi\nprintf '%s' "$$" > '${marker}'\nwhile :; do :; done\n`;
    await writeFile(wrapper, script, { mode: 0o700 }); await chmod(wrapper, 0o700);
    const e = own(new FoveaEngine({ parser: { ...parser, path: wrapper, sha256: sha256(script) }, storageRoot: storage }));
    const controller = new AbortController();
    const pending = e.query(request(root, 'sync'), controller.signal);
    // Attach rejection handling before aborting; the readiness wait is harness-only.
    const settled = pending.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
    const deadline = Date.now() + 5000;
    while (!existsSync(marker) && Date.now() < deadline) await new Promise(r => setTimeout(r, 5));
    expect(existsSync(marker)).toBe(true); const pid = Number(await readFile(marker, 'utf8'));
    controller.abort(new Error('active-parser-cancel'));
    expect((await settled).error).toBeTruthy();
    expect(() => process.kill(pid, 0)).toThrow();
    const status = await e.query(request(root, 'status')); expect(status.conversationLoaded).toBe(false);
  }, 15_000);
  it('uses explicit Git for diff seeding without external diff hooks', async () => {
    const { root, storage, base } = await setup();
    const git = (args: string[]): string => execFileSync('/usr/bin/git', ['-C', root, ...args], { encoding: 'utf8', env: { HOME: base, LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
    git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base']);
    const marker = join(base, 'must-not-run'); git(['config', 'diff.external', `/bin/sh -c 'touch ${marker}'`]);
    await writeFile(join(root, 'consumer.ts'), 'import { calculateTotal } from "./math.js";\nexport function run() { return calculateTotal(); }\n');
    await writeFile(join(root, 'math.ts'), 'export function calculateTotal() { return 2; }\n');
    const e = own(new FoveaEngine({ parser, storageRoot: storage, gitPath: '/usr/bin/git' }));
    const result = await e.query(request(root, 'impact')) as NavigationResult;
    expect(result.status).toBe('ok'); expect(result.details.seeds).toBeGreaterThan(0); expect(existsSync(marker)).toBe(false);
    expect(result.coverage.gitFailures).toEqual([]);
  });
  it('accepts only the independently approved rules bytes and rejects stale trust', async () => {
    const { root, storage } = await setup(); await mkdir(join(root, '.fovea'));
    const rules = JSON.stringify({ fileRoutes: [{ id: 'approved-pages', re: '^custom/(.*)\\.page$', verbs: 'exports', pathPrefix: '/approved' }] });
    await writeFile(join(root, '.fovea', 'rules.json'), rules);
    await writeFile(join(root, '.fovea', 'unrelated.ts'), 'export function forbiddenSibling() {}');
    await mkdir(join(root, 'custom')); await writeFile(join(root, 'custom', 'hello.page'), 'export function GET() {}');
    const e = own(new FoveaEngine({ parser, storageRoot: storage }));
    const before = await e.query(request(root, 'anchors')); expect(JSON.stringify(before)).not.toContain('/approved/hello');
    const approved = await e.query(request(root, 'anchors', { trustedRulesSha256: sha256(rules) }));
    expect(JSON.stringify(approved)).toContain('/approved/hello'); expect(JSON.stringify(approved.anchors)).not.toContain('forbiddenSibling');
    await writeFile(join(root, '.fovea', 'rules.json'), rules + ' ');
    await expect(e.query(request(root, 'sketch', { trustedRulesSha256: sha256(rules) }))).rejects.toThrow('SHA-256 mismatch');
  });
  it('retains exact deferred source windows rather than dropping the tail after 64', async () => {
    const { root, storage } = await setup(); await mkdir(join(root, 'lib'));
    for (let i = 0; i < 72; i++) await writeFile(join(root, 'lib', `part${i}.ts`), `export function part${i}() { return ${i}; }\n`);
    const e = own(new FoveaEngine({ parser, storageRoot: storage }));
    // The pinned selector normally emits only five hints. Stress the native
    // adapter with a bounded synthetic overflow while keeping real source
    // capture/parser/hashes; do not alter the reference selection algorithm.
    const originalFocus = operations.focus;
    vi.spyOn(operations, 'focus').mockImplementationOnce(async (...args) => {
      const result = await originalFocus(...args);
      return { ...result, details: { ...result.details, suggestedReads: Array.from({ length: 72 }, (_, i) => ({ path: `lib/part${i}.ts`, offset: 1, limit: 25, reason: 'fixture' })) } };
    });
    const result = await e.query(request(root, 'focus', { query: 'calculateTotal', maxTokens: 16000, fresh: true })) as NavigationResult;
    expect(result.reads).toHaveLength(64);
    expect(result.details.readsDeferred).toBe(true);
    const deferred = result.details.deferredReads as NavigationResult['reads'];
    expect(deferred.length).toBeGreaterThan(0);
    for (const window of [...result.reads, ...deferred]) {
      expect(window.expectedSha256).toBe(sha256(await readFile(join(root, window.path))));
      expect(window.limit).toBeLessThanOrEqual(2000);
      expect(Object.keys(window).sort()).toEqual(['expectedSha256', 'limit', 'offset', 'path']);
    }
  });
  it('accepts the reference 128-token sync setting without changing navigation minimums', async () => {
    const { root, storage } = await setup(); const e = own(new FoveaEngine({ parser, storageRoot: storage }));
    await e.query(request(root, 'sync', { files: ['math.ts'], maxTokens: 128 }));
    await rm(join(root, 'math.ts'));
    const update = await e.query(request(root, 'sync', { maxTokens: 128 }));
    expect(update.red).toBe(true);
    expect(String(update.text).length).toBeLessThanOrEqual(128 * 4);
    await expect(e.query(request(root, 'focus', { query: 'math', maxTokens: 128 }))).rejects.toThrow('range');
  });
  it('does not charge red sync delivery memory until explicit host acknowledgment', async () => {
    const { root, storage } = await setup(); const e = own(new FoveaEngine({ parser, storageRoot: storage }));
    await e.query(request(root, 'sync', { files: ['math.ts'], scope: 'repository' }));
    await rm(join(root, 'math.ts'));
    const first = await e.query(request(root, 'sync', { scope: 'repository' }));
    expect(first.red).toBe(true); expect(first.deliveryAccounting).toBe('prepared'); expect(first.syncPreparationId).toBeTypeOf('string');
    const repeat = await e.query(request(root, 'sync', { scope: 'repository' }));
    expect(repeat.red).toBe(true); expect(repeat.syncPreparationId).not.toBe(first.syncPreparationId);
    await expect(e.query(request(root, 'sync', { commitPreparationId: first.syncPreparationId }))).rejects.toThrow('superseded');
    const ack = await e.query(request(root, 'sync', { commitPreparationId: repeat.syncPreparationId })); expect(ack.deliveryAccounting).toBe('acknowledged');
    const clean = await e.query(request(root, 'sync', { scope: 'repository' })); expect(clean.red).toBe(false);
  });
});

it('bounds transport detail tails without changing retained numerical values', () => {
  const mass = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`file${i}`, i / 1000]));
  const result = boundResultDetails({ mass, huge: 'x'.repeat(900000) }, 10000, 1000);
  expect(result.detailsTruncated).toBe(true); expect(JSON.stringify(result).length).toBeLessThan(11000);
  expect((result.mass as Record<string, number>).file0).toBe(0);
});
