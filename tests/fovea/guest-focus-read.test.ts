import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { normalizeFabricConfig } from '../../src/config.js';
import { ActionRegistry } from '../../src/core/action-registry.js';
import { FabricExecutionService } from '../../src/execution-service.js';
import { LocalCodingProvider } from '../../src/providers/local-provider.js';
import { FoveaProvider } from '../../src/providers/repo-provider.js';
import { REPO_ACTION_DESCRIPTORS, REPO_NAVIGATION_SCHEMA, type RepoNavigationPacket, type RepoReadWindow } from '../../src/providers/repo-contract.js';
import type { LocalReadManyResult } from '../../src/providers/local-contract.js';
import { typeCheckFabricCode } from '../../src/runtime/type-checker.js';
import { fabricGuestDeclarations } from '../../src/runtime/guest-types.js';
import { schemaValidationMessage } from '../../src/schema-validation.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
type FocusRead = { navigation: RepoNavigationPacket; sources: LocalReadManyResult | null; deferredReads: RepoReadWindow[] };
function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fovea-guest-'))), root = path.join(base, 'workspace'); fs.mkdirSync(root);
  const navigation: RepoNavigationPacket = { schemaVersion: 1, status: 'ok', advisory: true, rootId: 'root_test', resultId: 'fr_test', sourceSnapshotId: 'snapshot_test', graphGeneration: 'graph_test', text: 'advisory navigation', estimatedTokens: 10, coverage: {}, reads: [], truncated: false };
  const focusCalls: Record<string, unknown>[] = [], readCalls: Record<string, unknown>[] = [];
  const local = new LocalCodingProvider({ root, lockRoot: path.join(base, 'locks'), maxResultChars: 40000 });
  const localInvoke = local.invoke.bind(local);
  local.invoke = async (name, args, context) => { if (name === 'readMany') readCalls.push(structuredClone(args)); return localInvoke(name, args, context); };
  const repo = new FoveaProvider({ rootId: navigation.rootId, observer: { observe() {}, gap() {} }, async close() {}, async invoke(operation, args) {
    expect(operation).toBe('focus'); focusCalls.push(structuredClone(args)); return structuredClone(navigation) as unknown as Record<string, unknown>;
  } });
  const registry = new ActionRegistry(); registry.register(repo); registry.register(local);
  const service = new FabricExecutionService(registry, normalizeFabricConfig({ executor: { timeoutMs: 10000 } }), root);
  cleanup.push(async () => { await service.close(); fs.rmSync(base, { recursive: true, force: true }); });
  const approvals: string[] = [];
  const approver = { prepareApproval(action: { ref: string; risk: string }) { approvals.push(action.ref); expect(action.risk).toBe('read'); return { decision: 'allow' as const }; }, async approve() { throw new Error('Unexpected interactive approval'); } };
  return { root, navigation, repo, local, service, approvals, focusCalls, readCalls,
    put(file: string, text: string) { fs.writeFileSync(path.join(root, file), text); return hash(text); },
    run(code: string) { return service.execute({ code, approver }); },
  };
}

it('real QuickJS composes one approved focus and one real readMany, preserving hashes/backlog and query scope', async () => {
  const f = fixture();
  const a = f.put('a.ts', 'export const a = 1;\nsecond line\n'), b = f.put('b.ts', 'export const b = 2;\n');
  f.navigation.reads = [{ path: 'a.ts', offset: 1, limit: 1, expectedSha256: a }, { path: 'b.ts', offset: 1, limit: 1, expectedSha256: b }];
  const result = await f.run('return await repo.focusRead({query:"a",path:"a.ts",language:"typescript",kind:"decl",fresh:true,maxTokens:1024,maxWindows:1,maxChars:2000,partial:false});');
  expect(result.success, result.error).toBe(true);
  const value = result.value as FocusRead;
  expect(value.navigation).toEqual(f.navigation); expect(value.deferredReads).toEqual([f.navigation.reads[1]]);
  expect(value.sources).toMatchObject({ complete: true, files: [{ path: 'a.ts', sha256: a, source: '1: export const a = 1;', startLine: 1, endLine: 1, truncated: true, nextOffset: 2 }] });
  expect(f.focusCalls).toEqual([{ query: 'a', path: 'a.ts', language: 'typescript', kind: 'decl', fresh: true, maxTokens: 1024 }]);
  expect(f.readCalls).toEqual([{ windows: [{ ...f.navigation.reads[0], path: path.join(f.root, 'a.ts') }], maxChars: 2000, partial: false }]);
  expect(result.audits.map(a => a.ref)).toEqual(['repo.focus', 'local.readMany']);
  expect(f.approvals).toEqual(['repo.focus', 'local.readMany']);
});

it('partial stale-hash reads retain failures and valid sources without retrying unpinned line numbers', async () => {
  const f = fixture(), old = f.put('stale.ts', 'old\n'), good = f.put('good.ts', 'good\n'); f.put('stale.ts', 'new\n');
  f.navigation.reads = [{ path: 'stale.ts', offset: 1, limit: 1, expectedSha256: old }, { path: 'good.ts', offset: 1, limit: 1, expectedSha256: good }];
  const result = await f.run('return await repo.focusRead({query:"source"});');
  expect(result.success, result.error).toBe(true);
  const value = result.value as FocusRead;
  expect(value.sources).toMatchObject({ complete: false, files: [{ path: 'good.ts', sha256: good }], failures: [{ index: 0, path: 'stale.ts', code: 'stale-hash', message: expect.stringContaining('source changed') }] });
  expect(value.sources!.files).toHaveLength(1); expect(f.readCalls).toHaveLength(1);
  expect(f.readCalls[0]).toMatchObject({ partial: true, windows: f.navigation.reads.map(w => ({ ...w, path: path.join(f.root, w.path) })) });
  const strict = await f.run('return await repo.focusRead({query:"source",partial:false});');
  expect(strict.success).toBe(false); expect(strict.error).toMatch(/source changed/);
  expect(f.readCalls).toHaveLength(2); expect(f.readCalls[1]).toMatchObject({ partial: false, windows: f.navigation.reads.map(w => ({ ...w, path: path.join(f.root, w.path) })) });
});

it('skips an empty read batch on no-match and never infers source evidence from navigation', async () => {
  const f = fixture(); f.navigation.status = 'no-match';
  const result = await f.run('return await repo.focusRead({query:"absent"});');
  expect(result.success, result.error).toBe(true);
  expect(result.value).toEqual({ navigation: f.navigation, sources: null, deferredReads: [] });
  expect(f.readCalls).toEqual([]); expect(result.audits.map(a => a.ref)).toEqual(['repo.focus']);
});

it('does not bypass denied local approval after successful navigation', async () => {
  const f = fixture(); f.navigation.reads = [{ path: 'a.ts', offset: 1, limit: 1, expectedSha256: f.put('a.ts', 'private source\n') }];
  const result = await f.service.execute({ code: 'return await repo.focusRead({query:"a"});', approver: {
    prepareApproval(action: { ref: string }) { return action.ref === 'repo.focus' ? { decision: 'allow' as const } : { decision: 'deny' as const, reason: 'denied read' }; },
    async approve() { throw new Error('denied read'); },
  } });
  expect(result.success).toBe(false); expect(result.error).toMatch(/denied read/);
  expect(f.focusCalls).toHaveLength(1); expect(f.readCalls).toEqual([]);
});

it('validates controls before dispatch and clones arguments before dependent awaits', async () => {
  const f = fixture();
  for (const args of ['null', '[]', '{query:"x",maxWindows:0}', '{query:"x",maxWindows:33}', '{query:"x",maxWindows:1.5}', '{query:"x",maxChars:999}', '{query:"x",maxChars:40001}', '{query:"x",partial:"yes"}']) {
    const result = await f.run(`return await (repo.focusRead as any)(${args});`);
    expect(result.success, args).toBe(false); expect(result.audits, args).toEqual([]);
  }
  expect(f.focusCalls).toEqual([]);
  const result = await f.run('const args = {query:"original",maxWindows:1}; const work = repo.focusRead(args); args.query = "mutated"; return await work;');
  expect(result.success, result.error).toBe(true); expect(f.focusCalls).toEqual([{ query: 'original' }]);
});

it('registers only primitive actions and closes the read-window schema/types', async () => {
  const f = fixture();
  expect((await f.repo.list()).map(a => a.name)).toEqual(['status', 'sketch', 'focus', 'augment', 'dwell', 'impact', 'result', 'searchResult', 'anchors', 'rules', 'adoptRules', 'settings', 'configure', 'reset', 'reload', 'sync']);
  expect(REPO_ACTION_DESCRIPTORS.some(d => d.name === 'focusRead')).toBe(false);
  expect(schemaValidationMessage(REPO_NAVIGATION_SCHEMA, { ...f.navigation })).toBeUndefined();
  for (const read of [{ path: 'a', offset: 1, limit: 1, root: '/' }, { path: 'a', offset: 0, limit: 1 }, { path: 'a', offset: 1, limit: 2001 }, { path: 'a', offset: 1, limit: 1, expectedSha256: 'bad' }]) expect(schemaValidationMessage(REPO_NAVIGATION_SCHEMA, { ...f.navigation, reads: [read] })).toBeDefined();
  for (const code of ['const r = await repo.focusRead({query:"x",partial:true}); const reads: RepoReadWindow[] = r.deferredReads; return r.sources?.failures ?? [];', 'return await repo.result({resultId:"fr",cursor:"cursor",maxChars:256});']) expect(typeCheckFabricCode(code, fabricGuestDeclarations).errors).toEqual([]);
  for (const code of ['return await repo.focusRead({query:1});', 'return await repo.focusRead({query:"x",partial:"yes"});', 'const r: RepoReadWindow = {path:"x",offset:1,limit:1,root:"/"}; return r;', 'return await repo.focus({query:"x",root:"/"});']) expect(typeCheckFabricCode(code, fabricGuestDeclarations).errors.length).toBeGreaterThan(0);
});
