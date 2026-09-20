import { expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { coreContext, type CoreContext } from '../../src/fovea/core/context.js';
import { forEachOrderedBatch } from '../../src/fovea/core/asyncutil.js';
import { scanRules, AST_GREP_CHUNK } from '../../src/fovea/core/astgrep.js';
import { createHash } from 'node:crypto';
import { ensureState, evictState } from '../../src/fovea/core/state.js';
import { persistFacts, cachePathFor } from '../../src/fovea/core/build.js';

function context(root = '', controller = new AbortController()): CoreContext {
  return { store: new Map(), sessionStore: new Map(), parserPath: path.resolve('.tmp/fovea-parser/ast-grep'), storageRoot: root,
    sourceRoot: root, snapshotRoot: root, signal: controller.signal, gitFailures: [], focusKey: 'test', spills: new Map() };
}
const deferred = () => { let resolve!: (v: number) => void; const promise = new Promise<number>(r => { resolve = r; }); return { promise, resolve }; };
it('prepares in parallel but publishes in source order without retaining later windows', async () => {
  const gates = [deferred(), deferred(), deferred()]; const started: number[] = [], committed: number[] = [];
  await coreContext.run(context(), async () => {
    const result = forEachOrderedBatch([0, 1, 2], 2, async i => { started.push(i); return gates[i]!.promise; }, n => { committed.push(n); if (n === 1) gates[2]!.resolve(2); });
    expect(started).toEqual([0, 1]); gates[1]!.resolve(1); await Promise.resolve(); expect(committed).toEqual([]);
    gates[0]!.resolve(0); await result;
    expect(started).toEqual([0, 1, 2]); expect(committed).toEqual([0, 1, 2]);
  });
});
it('settles independent preparations before propagating failure and commits none of the failed window', async () => {
  const gate = deferred(), published: number[] = [];
  await coreContext.run(context(), async () => {
    let settled = false;
    const result = forEachOrderedBatch([0, 1, 2], 2, n => { if (n === 0) throw Error('read failed'); return gate.promise; }, n => published.push(n));
    const checked = expect(result).rejects.toThrow('read failed').then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false); gate.resolve(1); await checked; expect(published).toEqual([]);
  });
});
it('cancellation settles in-flight reads and prevents publication and further windows', async () => {
  const controller = new AbortController(), gate = deferred(), published: number[] = [], started: number[] = [];
  await coreContext.run(context('', controller), async () => {
    const result = forEachOrderedBatch([0, 1], 1, n => { started.push(n); return gate.promise; }, n => published.push(n));
    const checked = expect(result).rejects.toThrow('cancelled'); controller.abort(Error('cancelled')); gate.resolve(0); await checked;
    expect(started).toEqual([0]); expect(published).toEqual([]);
  });
});
it.each([0, -1, 1.5, Infinity])('rejects invalid window %s', async limit => {
  await expect(forEachOrderedBatch([], limit, async n => n, () => {})).rejects.toThrow('Invalid ordered batch');
});
it.skipIf(!fs.existsSync(path.resolve('.tmp/fovea-parser/ast-grep')))('real multi-rule/multi-chunk parser repeats are byte-identical and retain every overlapping match', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fovea-production-batch-'));
  const storage = path.join(root, 'storage'); fs.mkdirSync(storage, { mode: 0o700 });
  try {
    const files = Array.from({ length: AST_GREP_CHUNK + 1 }, (_, n) => `source${String(n).padStart(3, '0')}.kt`);
    for (const file of files) fs.writeFileSync(path.join(root, file), 'fun test() { call.respond(1); call.respond(2) }\n');
    const rules = [{ id: 'qualified', language: 'Kotlin', pattern: '$OBJ.$FN($$$)' }, { id: 'bare', language: 'Kotlin', pattern: '$FN($$$)' }, { id: 'duplicate', language: 'Kotlin', pattern: '$OBJ.$FN($$$)' }];
    let expected: string | undefined;
    for (let i = 0; i < 4; i++) {
      const ctx = context(storage);
      const pin = JSON.parse(fs.readFileSync('build-toolchain.json', 'utf8')).targets[`${process.platform}-${process.arch}`]['ast-grep'];
      expect(createHash('sha256').update(fs.readFileSync(ctx.parserPath)).digest('hex')).toBe(pin.members.find((m: any) => m.path === 'tools/ast-grep').sha256);
      const matches = await coreContext.run(ctx, () => scanRules(rules, files, root));
      expect(matches).toHaveLength(files.length * 6);
      for (const file of files) expect(matches!.filter(m => m.file === file)).toHaveLength(6);
      expect(matches!.filter(m => m.ruleId === 'qualified').map(({ ruleId: _, ...m }) => m)).toEqual(matches!.filter(m => m.ruleId === 'duplicate').map(({ ruleId: _, ...m }) => m));
      const actual = JSON.stringify(matches);
      if (expected !== undefined) expect(actual).toBe(expected); else expected = actual;
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}, 60000);
it.skipIf(!fs.existsSync(path.resolve('.tmp/fovea-parser/ast-grep')))('v17 refuses old cache ordering and re-extracts instead of reusing old facts', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fovea-cache-order-'));
  const root = path.join(base, 'workspace'), storage = path.join(base, 'storage');
  fs.mkdirSync(root, { mode: 0o700 }); fs.mkdirSync(storage, { mode: 0o700 });
  fs.writeFileSync(path.join(root, 'test.ts'), 'export function hello() { return 1; }\n');
  const ctx = { ...context(storage), sourceRoot: root, snapshotRoot: root };
  try {
    await coreContext.run(ctx, async () => {
      const initial = await ensureState(root); expect(initial.facts['test.ts']!.symbols.length).toBeGreaterThan(0);
      const expected = JSON.stringify(initial.facts);
      await persistFacts(initial.store); evictState(root);
      const cache = cachePathFor(root), lines = fs.readFileSync(cache, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      expect(lines[0].fovea).toBe(17); lines[0].fovea = 16;
      for (const line of lines.slice(1)) if (line.facts) line.facts.symbols = [];
      fs.writeFileSync(cache, lines.map(line => JSON.stringify(line)).join('\n') + '\n');
      const next = { ...ctx, store: new Map(), sessionStore: new Map() };
      await coreContext.run(next, async () => {
        const rebuilt = await ensureState(root);
        expect(JSON.stringify(rebuilt.facts)).toBe(expected); await persistFacts(rebuilt.store); evictState(root);
        expect(JSON.parse(fs.readFileSync(cache, 'utf8').split('\n')[0]!).fovea).toBe(17);
      });
    });
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
}, 60000);

