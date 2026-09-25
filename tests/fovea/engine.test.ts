import { removeFixture as rm } from "../fixture-cleanup.mjs";
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, symlink, chmod, utimes, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FoveaEngine, type EngineRequest, type EngineResult } from '../../src/fovea/engine.js';
import { sha256, resolveParserDescriptor } from '../../src/fovea/parser-executable.js';
import { SourceAccess } from '../../src/fovea/source-access.js';
import { sourcePlatform } from '../../src/fovea/source-platform.js';

// NavigationResult is module-private in src/fovea/engine.ts; recover the exact
// structural type from the public EngineResult union without re-exporting it.
type NavigationResult = Extract<EngineResult, { status: 'ok' | 'no-match' }>;

// The standalone captureSourceSnapshot wrapper was removed; every call goes
// through the public SourceAccess method on a fresh platform.
const captureAccess = (): SourceAccess => new SourceAccess(sourcePlatform());

const parser = { path: resolve('.tmp/fovea-parser/ast-grep'), sha256: '7a5ab30160186184c0bf8bffc87da4af25123c183964cd98c11b0b354137db0a', version: '0.45.3' };
const dirs: string[] = [];
const engines: FoveaEngine[] = [];
afterEach(async () => { await Promise.all(engines.splice(0).map(e => e.close())); await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function setup(): Promise<{ root: string; storage: string }> {
  const base = await mkdtemp(join(tmpdir(), 'fabric-engine-test-')); dirs.push(base);
  const root = join(base, 'source'), storage = join(base, 'storage');
  await mkdir(root, { mode: 0o700 }); await mkdir(storage, { mode: 0o700 });
  await writeFile(join(root, 'math.ts'), 'export function calculateTotal(value: number) { return value + 1; }\n');
  await writeFile(join(root, 'consumer.ts'), 'import { calculateTotal } from "./math.js";\nexport function checkout() { return calculateTotal(3); }\n');
  return { root, storage };
}
function engine(storage: string): FoveaEngine { const e = new FoveaEngine({ parser, storageRoot: storage }); engines.push(e); return e; }
function request(root: string, operation: string, args: Record<string, unknown> = {}, conversationId = 'a'): EngineRequest {
  return { root, operation, args, conversationId, conversationEpoch: 1, rootId: 'root', authorizationEpoch: 1 };
}

describe.skipIf(process.platform !== 'linux')('scope-safe exact source snapshots', () => {
  it('hashes precisely the bytes copied, including invalid UTF-8; rejects symlink traversal', async () => {
    const { root, storage } = await setup();
    const bytes = Buffer.from([0xff, 0xfe, 0x61, 0x0a]);
    await writeFile(join(root, 'bytes.ts'), bytes);
    await symlink('/etc/passwd', join(root, 'escape.ts'));
    await symlink('/etc', join(root, 'escape-dir'));
    const shot = await captureAccess().captureSourceSnapshot(root, storage);
    expect(shot.hashes.get('bytes.ts')).toBe(sha256(bytes));
    expect(await readFile(join(storage, 'bytes.ts'))).toEqual(bytes);
    expect(shot.hashes.has('escape.ts')).toBe(false);
    expect([...shot.hashes.keys()].some(p => p.startsWith('escape-dir/'))).toBe(false);
    expect((shot.coverage.counts as Record<string, number>).unavailableOrSymlink).toBe(2);
  });
  it('retains old snapshot bytes across a same-size same-mtime source replacement', async () => {
    const { root, storage } = await setup();
    const file = join(root, 'math.ts'); const before = await readFile(file); const info = await stat(file);
    const shot = await captureAccess().captureSourceSnapshot(root, storage);
    const next = Buffer.from(before.toString().replace('+ 1', '+ 2'));
    await writeFile(file, next); await utimes(file, info.atime, info.mtime);
    expect(shot.hashes.get('math.ts')).toBe(sha256(before));
    expect(await readFile(join(storage, 'math.ts'))).toEqual(before);
    expect(sha256(await readFile(file))).not.toBe(shot.hashes.get('math.ts'));
  });
  it('reports exclusions and caps before parsing, and rejects cancelled capture', async () => {
    const { root, storage } = await setup();
    await mkdir(join(root, 'node_modules')); await writeFile(join(root, 'node_modules', 'secret.ts'), 'secret');
    await writeFile(join(root, 'huge.ts'), 'x'.repeat(1024));
    const shot = await captureAccess().captureSourceSnapshot(root, storage, undefined, { maxFileBytes: 128 });
    expect(shot.coverage.counts).toMatchObject({ excluded: 1, oversized: 1 });
    expect(shot.hashes.has('node_modules/secret.ts')).toBe(false);
    await expect(captureAccess().captureSourceSnapshot(root, storage, AbortSignal.abort())).rejects.toThrow();
  });
});

describe.skipIf(!existsSync(parser.path) || process.platform !== 'linux')('native engine with pinned private parser', () => {
  it('runs faithful sketch/focus/impact and binds reads to extraction bytes', async () => {
    const { root, storage } = await setup(); const e = engine(storage);
    const sketch = await e.query(request(root, 'sketch')) as NavigationResult;
    expect(sketch.status).toBe('ok'); expect(sketch.text).toContain('fovea sketch');
    const focused = await e.query(request(root, 'focus', { query: 'calculateTotal', fresh: true, maxTokens: 2000 })) as NavigationResult;
    expect(focused.status).toBe('ok'); expect(focused.focusId).toBeTypeOf('string');
    expect(focused.reads.some(r => r.path === 'math.ts')).toBe(true);
    for (const read of focused.reads) expect(read.expectedSha256).toBe(sha256(await readFile(join(root, read.path))));
    expect(focused.text).toContain('checkout');
    const impacted = await e.query(request(root, 'impact', { files: ['math.ts'], includeUncommitted: false })) as NavigationResult;
    expect(impacted.details.warmedFiles).toContain('consumer.ts');
    const mass = impacted.details.conservedMass as Record<string, number>;
    expect(mass['consumer.ts']).toBeGreaterThan(0);
    expect(JSON.stringify(impacted)).not.toContain('/tmp/');
    const miss = await e.query(request(root, 'focus', { query: 'totallyAbsentIdentifierZZZ' })); expect(miss.status).toBe('no-match');
  }, 30_000);
  it('isolates engines and conversation focus IDs; transient focus cannot alter dwell', async () => {
    const { root, storage } = await setup(); const e = engine(storage), other = engine(storage);
    const focused = await e.query(request(root, 'focus', { query: 'calculateTotal' })) as NavigationResult;
    await expect(other.query(request(root, 'dwell', { focusId: focused.focusId }))).rejects.toThrow('focusId');
    await expect(e.query(request(root, 'dwell', { focusId: focused.focusId }, 'b'))).rejects.toThrow('focusId');
    const transient = await e.query(request(root, 'focus', { query: 'checkout', transient: true, fresh: true })); expect(transient.focusId).toBeUndefined();
    const widened = await e.query(request(root, 'dwell', { focusId: focused.focusId })) as NavigationResult;
    expect(widened.details.from).toBe(2); expect(widened.details.to).toBe(4); expect(widened.focusRevision).toBe(2);
    await e.query(request(root, 'reset'));
    await expect(e.query(request(root, 'dwell', { focusId: focused.focusId }))).rejects.toThrow('focusId');
    await expect(e.query({ ...request(root, 'dwell', { focusId: focused.focusId }), conversationEpoch: 2 })).rejects.toThrow('focusId');
  }, 30_000);
  it('refreshes same-stat edits, establishes semantic sync, and does not publish after abort', async () => {
    const { root, storage } = await setup(); const e = engine(storage);
    const first = await e.query(request(root, 'focus', { query: 'calculateTotal' })) as NavigationResult;
    const baseline = await e.query(request(root, 'sync', { scope: 'repository' })); expect(baseline.details).toMatchObject({ baseline: 'established' });
    const file = join(root, 'math.ts'); const info = await stat(file);
    await writeFile(file, (await readFile(file, 'utf8')).replace('calculateTotal', 'calculateOther')); await utimes(file, info.atime, info.mtime);
    const changed = await e.query(request(root, 'focus', { query: 'calculateOther', transient: true })) as NavigationResult;
    expect(changed.sourceSnapshotId).not.toBe(first.sourceSnapshotId); expect(changed.graphGeneration).not.toBe(first.graphGeneration);
    const outcome = await e.query(request(root, 'sync', { scope: 'repository' })); expect(outcome.structural).toBe(true);
    const abort = new AbortController();
    const pending = e.query(request(root, 'focus', { query: 'checkout', fresh: true }), abort.signal); abort.abort(new Error('cancelled-test'));
    await expect(pending).rejects.toThrow('cancelled-test');
    const dwell = await e.query(request(root, 'dwell', { focusId: first.focusId })); expect(dwell.details).toMatchObject({ staleFocus: true });
    await e.close(); await expect(e.query(request(root, 'status'))).rejects.toThrow('closed');
  }, 30_000);
  it('refuses wrong parser SHA and version, and never consults PATH or parser env', async () => {
    const { storage } = await setup();
    await expect(resolveParserDescriptor({ ...parser, sha256: '0'.repeat(64) }, storage)).rejects.toThrow('SHA-256');
    await expect(resolveParserDescriptor({ ...parser, version: '0.45.2' }, storage)).rejects.toThrow('version mismatch');
    await chmod(join(storage, 'managed-parser'), 0o700);
  });
});
