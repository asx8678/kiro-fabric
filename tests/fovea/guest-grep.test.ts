import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { normalizeFabricConfig } from '../../src/config.js';
import { ActionRegistry } from '../../src/core/action-registry.js';
import { FabricExecutionService } from '../../src/execution-service.js';
import { LocalCodingProvider } from '../../src/providers/local-provider.js';
import { FoveaProvider } from '../../src/providers/repo-provider.js';
import { DEFAULT_FOVEA_CONFIG } from '../../src/fovea/config.js';
import type { RepoNavigationPacket } from '../../src/providers/repo-contract.js';
import type { LocalGrepResult } from '../../src/providers/local-contract.js';
import { typeCheckFabricCode } from '../../src/runtime/type-checker.js';
import { fabricGuestDeclarations } from '../../src/runtime/guest-types.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
type Hybrid = { native: LocalGrepResult | null; advisory: RepoNavigationPacket | null; replacement: boolean; diagnostic?: string };
function fixture(mode: 'off' | 'augment' | 'replace', hint: 'ok' | 'no-match' | 'error' = 'ok') {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fovea-grep-'))), root = path.join(base, 'source'); fs.mkdirSync(root);
  fs.mkdirSync(path.join(root, 'src')); fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'needle\nneedle\n'); fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'needle\n'); fs.writeFileSync(path.join(root, 'outside.ts'), 'needle\n');
  const calls: { operation: string; args: Record<string, unknown> }[] = [];
  const config = structuredClone(DEFAULT_FOVEA_CONFIG); config.tools.grepMode = mode;
  const packet = { schemaVersion: 1, status: hint === 'no-match' ? 'no-match' : 'ok', advisory: true, rootId: 'root_test', resultId: 'fr_test', sourceSnapshotId: 'snapshot', graphGeneration: 'generation', text: 'graph hint', estimatedTokens: 10, coverage: {}, reads: [], truncated: false };
  const repo = new FoveaProvider({ rootId: 'root_test', observer: { observe() {}, gap() {} }, async close() {}, async invoke(operation, args) {
    calls.push({ operation, args: structuredClone(args) });
    if (operation === 'settings') return { config, revision: 'revision', scope: 'session' };
    expect(operation).toBe('augment'); if (hint === 'error') throw new Error('controlled graph unavailable'); return packet;
  } });
  const local = new LocalCodingProvider({ root, lockRoot: path.join(base, 'locks'), maxResultChars: 40000 });
  const registry = new ActionRegistry(); registry.register(repo); registry.register(local);
  const service = new FabricExecutionService(registry, normalizeFabricConfig({ executor: { timeoutMs: 10000 } }), root);
  cleanups.push(async () => { await service.close(); fs.rmSync(base, { recursive: true, force: true }); });
  return { calls, packet, local, run: (code: string) => service.execute({ code, approver: { prepareApproval: () => ({ decision: 'allow' as const }), async approve() { throw new Error('unexpected prompt'); } } }) };
}

it('off uses only settings and exact native search, with no graph hint', async () => {
  const f = fixture('off'); const result = await f.run('return await repo.grep({pattern:"needle",path:"src",glob:"*.ts",literal:true,limit:1});');
  expect(result.success, result.error).toBe(true);
  expect(result.value).toMatchObject({ replacement: false, advisory: null, native: { matches: [expect.objectContaining({ path: 'src/a.ts', line: 1 })], scope: { path: 'src', glob: '*.ts' }, truncated: true, scopeExhausted: false } });
  expect(f.calls.map(c => c.operation)).toEqual(['settings']); expect(result.audits.map(a => a.ref)).toEqual(['repo.settings', 'local.grep']);
});

it.each(['augment', 'replace'] as const)('%s preserves native scope and single-use local cursors when options are explicit', async mode => {
  const f = fixture(mode);
  const result = await f.run(`const args = {pattern:"needle",path:"src",glob:"*.ts",literal:true,hidden:false,ignoreCase:false,paginate:true,limit:1};
const first = await repo.grep(args);
const cursor = first.native!.nextCursor!;
const second = await repo.grep({...args,cursor});
let replayRejected = false;
try { await local.grep({...args,cursor}); } catch { replayRejected = true; }
return {first,second,replayRejected};`);
  expect(result.success, result.error).toBe(true);
  const value = result.value as { first: Hybrid; second: Hybrid; replayRejected: boolean };
  // local cursors are intentionally single-use; only repo.result cursors replay.
  expect(value.first.native!.nextCursor).toBeTypeOf('string'); expect(value.replayRejected).toBe(true);
  expect(value.second.native!.matches[0]!.line).toBe(2);
  expect(value.first.replacement).toBe(false); expect(value.second.replacement).toBe(false);
  expect(value.second.native!.scope).toMatchObject({ path: 'src', glob: '*.ts', hidden: false, ignoreFiles: true });
  expect(value.first.native!.matches[0]!.path).toBe('src/a.ts'); expect(value.second.native!.matches[0]!.path).toBe('src/a.ts');
  if (mode === 'replace') expect(f.calls.map(c => c.operation)).toEqual(['settings', 'settings']);
  else expect(f.calls.filter(c => c.operation === 'augment').map(c => c.args)).toEqual(Array(2).fill({ query: 'needle', path: 'src', maxTokens: DEFAULT_FOVEA_CONFIG.tools.grepAugmentBudget }));
});

it.each([['augment', 'no-match'], ['augment', 'error'], ['replace', 'no-match'], ['replace', 'error']] as const)('%s graph %s retains nonempty exact matches', async (mode, hint) => {
  const f = fixture(mode, hint), result = await f.run('return await repo.grep({pattern:"needle"});');
  expect(result.success, result.error).toBe(true); const value = result.value as Hybrid;
  expect(value.native!.matches.length).toBeGreaterThan(0); expect(value.native!.scopeExhausted).toBe(true);
  expect(value.advisory).toBeNull(); expect(value.replacement).toBe(false);
  expect(f.calls.map(c => c.operation)).toEqual(['settings', 'augment']);
  if (hint === 'error') expect(value.diagnostic).toMatch(/unavailable/);
});

it('replace can return a successful bare symbol hint, but regex remains native', async () => {
  const f = fixture('replace'); const replaced = await f.run('return await repo.grep({pattern:"needle"});');
  expect(replaced.success, replaced.error).toBe(true); expect(replaced.value).toEqual({ native: null, advisory: f.packet, replacement: true });
  expect(replaced.audits.map(a => a.ref)).toEqual(['repo.settings', 'repo.augment']);
  const regex = await f.run('return await repo.grep({pattern:"need.*"});');
  expect(regex.success, regex.error).toBe(true); expect((regex.value as Hybrid).native!.matches.length).toBeGreaterThan(0);
  expect(regex.audits.map(a => a.ref)).toEqual(['repo.settings', 'local.grep']);
  expect((await f.local.list()).some(a => a.name === 'augment')).toBe(false);
  expect(typeCheckFabricCode('return await repo.grep({pattern:"needle",path:"src",literal:true});', fabricGuestDeclarations).errors).toEqual([]);
});
