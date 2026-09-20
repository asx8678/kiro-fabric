import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeLifecyclePlatform } from './fixtures/native-lifecycle-platform.js';
import * as nativeLoader from '../../src/fovea/native-source-loader.js';
import { lifecycleArgs, runLifecycle } from '../../scripts/fovea-lifecycle-harness.mjs';
import { archivePinnedReference, PINNED } from '../../scripts/fovea-reference-harness.mjs';
import { createScope } from '../../scripts/fovea-capability-probe.mjs';
import { FoveaHost } from '../../src/fovea/host.js';
import { FoveaProvider } from '../../src/providers/repo-provider.js';
import { LocalCodingProvider } from '../../src/providers/local-provider.js';
import { ActionRegistry } from '../../src/core/action-registry.js';
import { FabricExecutionService } from '../../src/execution-service.js';
import { normalizeFabricConfig } from '../../src/config.js';
import type { FoveaObservation } from '../../src/fovea/observations.js';
import { FoveaProvenanceJournal } from '../../src/fovea/provenance-journal.js';
import { collectFoveaContext, FoveaResponseDelivery } from '../../src/kiro/fovea-context.js';
import type { KiroProjectionResult } from '../../src/kiro/projection.js';

const options = lifecycleArgs([
  '--reference', process.env.FOVEA_REFERENCE_ROOT ?? '../pi-fovea',
  '--host-reference', process.env.FOVEA_HOST_REFERENCE_ROOT ?? '../pi-fabric',
  '--parser', process.env.FOVEA_REFERENCE_PARSER ?? '.tmp/fovea-parser/ast-grep',
]);
function pinnedObject(directory: string, commit: string): boolean {
  const r = spawnSync('git', ['-C', directory, 'cat-file', '-t', commit], { encoding: 'utf8', timeout: 15000 });
  return !r.error && r.status === 0 && r.stdout.trim() === 'commit';
}
const available = fs.existsSync(options.parser) && pinnedObject(options.reference, PINNED.upstreamCommit) && pinnedObject(options.hostReference, PINNED.referenceHostCommit);
const hash = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');

let nativeFixture: Awaited<ReturnType<typeof createNativeLifecyclePlatform>> | undefined;
const nativeEntrypoint = () => nativeFixture?.entrypoint ?? path.resolve('dist/fovea/engine-entry.js');

const route = (name: string) => `const app: any = {};\nexport function handler() { return 1; }\napp.get("/${name}", handler);\n`;
const projection = (): KiroProjectionResult => {
  const text = 'committed result; retryProgram: false';
  return { text, isError: false, executionStatus: 'succeeded', deliveryStatus: 'inline', retryProgram: false, visibleChars: text.length, visibleBytes: Buffer.byteLength(text), overflowed: false, artifactRetained: false, retention: 'inline' };
};
async function nativeMutationFixture(label: string, parser: { version: string; sha256: string }) {
  const scope = createScope(), root = scope.workspace, file = path.join(root, 'routes.ts');
  fs.writeFileSync(file, route(`${label}-before`), { mode: 0o600 });
  const stat = fs.statSync(root, { bigint: true });
  const worktree = hash(`${root}\0${stat.dev}\0${stat.ino}`);
  const hosts: FoveaHost[] = [], services: FabricExecutionService[] = [];
  const close = async () => {
    for (const service of services) await service.close();
    for (const host of hosts) await host.close();
    fs.rmSync(scope.root, { recursive: true, force: true });
  };
  const make = async (conversationId: string) => {
    const host = new FoveaHost({ dataRoot: scope.root, configFile: path.join(scope.root, 'config.json'), parser: { ...parser, path: options.parser }, entrypoint: nativeEntrypoint() });
    hosts.push(host);
    const client = host.bind({ canonicalPath: root, deviceId: String(stat.dev), fileId: String(stat.ino), conversationId, conversationEpoch: 1, authorizationEpoch: 1 });
    const registry = new ActionRegistry();
    registry.register(new FoveaProvider(client)); registry.register(new LocalCodingProvider({ root, lockRoot: path.join(scope.root, 'locks') }));
    const service = new FabricExecutionService(registry, normalizeFabricConfig({ continuity: { enabled: false }, tracing: { enabled: false } }), root);
    services.push(service);
    const events: FoveaObservation[] = [];
    const execute = (code: string, control: { signal?: AbortSignal; approve?: () => Promise<void> } = {}) => service.execute({ code, ...(control.signal ? { signal: control.signal } : {}), workspaceBound: true,
      operationObserver: { observe: event => { events.push(event); client.observer.observe(event); }, gap: () => client.observer.gap() },
      approver: { approve: control.approve ?? (async () => {}) } });
    const settings = await client.invoke('settings', {}, { cwd: root });
    const config = structuredClone(settings.config) as { sync: { scope: string; pushFocus: boolean } };
    config.sync.scope = 'repository'; config.sync.pushFocus = false;
    await client.invoke('configure', { scope: 'session', expectedRevision: settings.revision, config }, { cwd: root });
    const status = () => client.invoke('status', {}, { cwd: root });
    const sync = (signal?: AbortSignal) => client.invoke('sync', {}, { cwd: root, ...(signal ? { signal } : {}) });
    const baseline = async () => {
      expect((await execute('return await local.read({path:"routes.ts"});')).success).toBe(true);
      expect(await sync()).toMatchObject({ red: false, details: { baseline: 'established' } });
      events.length = 0;
    };
    const write = (before: string, after: string, outerFailure = false) => execute(`await local.write({path:"routes.ts",content:${JSON.stringify(after)},overwrite:true,expectedSha256:${JSON.stringify(hash(before))}}); ${outerFailure ? 'throw new Error("fixture-outer-failure");' : 'return null;'}`);
    const edit = (before: string, oldText: string, newText: string) => execute(`return await local.edit({path:"routes.ts",expectedSha256:${JSON.stringify(hash(before))},oldText:${JSON.stringify(oldText)},newText:${JSON.stringify(newText)}});`);
    return { client, execute, status, sync, baseline, write, edit, events };
  };
  try {
    return { root, file, a: await make('fixture-conversation'), b: await make('foreign-conversation'), close,
      journal: () => new FoveaProvenanceJournal(path.join(scope.root, 'fovea'), nativeFixture?.platform).read(worktree) };
  } catch (error) { await close(); throw error; }
}

describe('lifecycle harness admission', () => {
  it('rejects ambiguous arguments and has no implicit download or live client mode', () => {
    for (const args of [['--native'], ['--install-dev'], ['--allow-live'], ['--parser'], ['--reference', '--parser']]) expect(() => lifecycleArgs(args)).toThrow();
    const run = spawnSync(process.execPath, ['scripts/fovea-lifecycle-harness.mjs', '--help'], { encoding: 'utf8', timeout: 15000 });
    expect(run.error).toBeUndefined(); expect(run.status).toBe(0); expect(run.stdout).toContain('not Pi/Kiro UI');
  });
  it('rejects invalid archive identities without creating an archive', async () => {
    const scope = createScope();
    try {
      await expect(archivePinnedReference(scope, options.reference, 'HEAD', 'pi-fovea')).rejects.toThrow('invalid reference identity');
      await expect(archivePinnedReference(scope, options.reference, PINNED.upstreamCommit, '../escape')).rejects.toThrow('invalid reference identity');
      expect(fs.existsSync(path.join(scope.root, 'pi-fovea'))).toBe(false);
    } finally { fs.rmSync(scope.root, { recursive: true, force: true }); }
  });
  it('missing pinned objects or parser stay environment-blocked, never an executed trace', async () => {
    const scope = createScope();
    let reportFile: string | undefined;
    try {
      const result = await runLifecycle({ reference: scope.workspace, hostReference: scope.workspace, parser: path.join(scope.root, 'absent-parser') });
      reportFile = result.report;
      const report = JSON.parse(fs.readFileSync(result.report, 'utf8'));
      expect(result.status).toBe('environment-blocked'); expect(report.trace).toBeNull();
      expect(report.qualifiedNative).toBe(false); expect(report.blockers).toHaveLength(3);
      expect(fs.statSync(result.report).mode & 0o777).toBe(0o600);
    } finally {
      if (reportFile) fs.rmSync(path.dirname(reportFile), { recursive: true, force: true });
      fs.rmSync(scope.root, { recursive: true, force: true });
    }
  }, 30000);
});

// These are real upstream component executions through a fixture runner. A
// missing private oracle is a visible skip, never a fallback to rewritten goldens.
describe.skipIf(!available)('exact pinned lifecycle replay (fixture runner, not native UI)', () => {
  let report: any;
  let scope: string | undefined;
  beforeAll(async () => {
    const result = await runLifecycle(options); scope = path.dirname(result.report);
    report = JSON.parse(fs.readFileSync(result.report, 'utf8'));
    expect(result.status, `retained diagnostics: ${result.report}`).toBe('executed');
    if (process.platform === 'darwin') nativeFixture = await createNativeLifecyclePlatform();
  }, 150000);
  afterAll(() => {
    vi.restoreAllMocks(); nativeFixture?.close(); nativeFixture = undefined;
    if (scope && report?.status === 'executed') fs.rmSync(scope, { recursive: true, force: true });
  });
  beforeEach(() => {
    // Darwin exercises actual native journal/source I/O and a real child engine.
    // Admission alone is fixture-owned; installed-generation loading is separate.
    if (nativeFixture) vi.spyOn(nativeLoader, 'loadManagedSourcePlatform').mockResolvedValue(nativeFixture.platform);
  });
  const at = (label: string) => report.trace.checkpoints.find((row: any) => row.label === label);
  const asserted = (id: string) => expect(report.trace.assertions).toContain(id);
  it('executes both pinned references and binds the driver/parser/source closure', () => {
    expect(report.referenceCommit).toBe(PINNED.upstreamCommit);
    expect(report.hostReferenceCommit).toBe(PINNED.referenceHostCommit);
    expect(report.surface).toBe('pinned-components-fixture-runner'); expect(report.qualifiedNative).toBe(false);
    expect(report.parser).toEqual({ version: '0.45.3', sha256: hash(fs.readFileSync(options.parser)) });
    expect(report.driver.sha256).toBe(hash(fs.readFileSync('tests/fovea/fixtures/lifecycle-driver.mjs')));
    for (const file of ['pi-fovea/src/index.ts', 'pi-fovea/src/core/sync.ts', 'pi-fovea/src/core/provenance.ts', 'pi-fabric/src/capture/catalog.ts', 'pi-fabric/src/capture/wrapper.ts', 'pi-fabric/src/providers/captured-tools-provider.ts']) {
      expect(report.sources).toContainEqual({ path: file, sha256: hash(fs.readFileSync(path.join(scope!, file))) });
    }
    expect(report.trace.registered).toEqual(['fovea_dwell', 'fovea_focus', 'fovea_impact', 'fovea_sketch']);
    expect(report.trace.omissions).toContain('real Pi ExtensionRunner/TUI');
    expect(report.trace.omissions).toContain('PiToolsProvider builtin dispatch');
  });
  it('records actual nested start/preflight/update/result/end and failure semantics', () => {
    for (const id of ['denied', 'failed', 'access', 'focus', 'dwell']) {
      expect(report.trace.events.filter((e: any) => e.id === id).map((e: any) => e.type)).toEqual([
        'tool_execution_start', 'tool_call', ...(['access', 'focus', 'dwell'].includes(id) ? ['tool_execution_update'] : []), 'tool_result', 'tool_execution_end',
      ]);
    }
    expect(report.trace.events.some((e: any) => e.id === 'cancelled')).toBe(false);
    asserted('captured-result-middleware-applied'); asserted('read-result-preserved');
    asserted('denied-no-execute-or-enrollment'); asserted('failed-no-enrollment');
    asserted('successful-read-enrolls-and-baselines');
  });
  it('proves pinned compaction persists roots without resetting focus, unlike resume/tree', () => {
    expect(at('ordinary-turn').focus).toEqual(at('focus').focus);
    expect(at('dwell').focus.t).toBeGreaterThan(at('focus').focus.t);
    expect(at('compact').focus).toEqual(at('dwell').focus);
    expect(at('compact').baseline).toBe(true);
    expect(at('resume').focus.seeds).toEqual([]); expect(at('resume').baseline).toBe(false);
    expect(at('resume').graphGeneration).toBe(at('compact').graphGeneration);
    expect(at('empty-branch').baseline).toBe(false); expect(at('empty-branch').rootsRecorded).toBe(0);
    expect(at('restored-branch').baseline).toBe(true); expect(at('restored-branch').focus.seeds).toEqual([]);
    asserted('compact-persists-roots-without-resetting-focus'); asserted('tree-empty-branch-does-not-enroll-cwd');
    asserted('reset-clears-roots-focus-baseline-not-graph'); asserted('shutdown-clears-focus-baseline');
  });
  const mutation = (label: string) => report.trace.mutationCases.find((row: any) => row.label === label);
  it('executes real pinned mutation hooks, origin chains and continuation requests without claiming model continuation', () => {
    expect(report.trace.schemaVersion).toBe(2);
    for (const [label, kind] of [['own', 'current-session'], ['foreign', 'other-session'], ['mixed', 'mixed'], ['external', 'unattributed'], ['queued', 'current-session'], ['cancelled-sync-recovered', 'current-session'], ['lost-ack', 'unattributed']]) {
      expect(mutation(label!)).toMatchObject({ provenance: { kind, files: { 'routes.ts': kind } }, continuationExecuted: false });
      asserted(`${label}-origin-and-request`); asserted(`${label}-repeat-clean-turn-silent`);
    }
    for (const label of ['foreign', 'queued']) expect(mutation(label)).toMatchObject({ options: { deliverAs: 'nextTurn' }, continuationRequested: false });
    for (const label of ['own', 'mixed', 'external']) expect(mutation(label)).toMatchObject({ options: { deliverAs: 'steer', triggerTurn: true }, continuationRequested: true });
    for (const id of ['denied-failed-mutations-do-not-enroll', 'denied-failed-mutations-no-journal', 'own-commit-retained-after-outer-failure', 'cancel-before-publication-no-transition-or-notice', 'revoked-sync-does-not-advance-baseline', 'pinned-failed-result-loses-commit-attribution', 'fixture-send-is-not-model-continuation']) asserted(id);
    for (const id of ['own-write', 'mixed-edit', 'lost-ack-write', 'failed-write', 'denied-write']) expect(report.trace.events.filter((e: any) => e.id === id).map((e: any) => e.type)).toEqual(['tool_execution_start', 'tool_call', 'tool_result', 'tool_execution_end']);
    expect(report.trace.events.filter((e: any) => e.id === 'cancelled-write').map((e: any) => e.type)).toEqual(['tool_execution_start', 'tool_call']);
  });
  it.skipIf(!['linux', 'darwin'].includes(process.platform)).each(['own', 'foreign', 'mixed', 'external'])('compares %s origin using real local publications, two native hosts and pinned semantic deltas', async label => {
    const f = await nativeMutationFixture(label, report.parser);
    try {
      await f.a.baseline(); await f.b.baseline();
      const before = route(`${label}-before`), after = route(`${label}-after`);
      if (label === 'own') {
        const result = await f.a.write(before, after, true);
        expect(result.success).toBe(false); expect(result.error).toContain('fixture-outer-failure');
        expect(f.a.events.map(e => e.phase)).toEqual(['prepared', 'approved', 'committed', 'settled']);
        asserted('own-commit-retained-after-outer-failure');
      } else if (label === 'foreign') expect((await f.b.write(before, after)).success).toBe(true);
      else if (label === 'mixed') {
        expect((await f.a.edit(before, 'mixed-before', 'mixed-middle')).success).toBe(true);
        await f.a.status(); // flush journal admission, not a fabricated mutation event
        expect((await f.b.write(route('mixed-middle'), after)).success).toBe(true);
      } else fs.writeFileSync(f.file, after);
      await f.b.status();
      const actual = await f.a.sync(), expected = mutation(label);
      expect(actual).toMatchObject({ red: true, delivered: false, automaticContinuation: false, details: { provenance: expected.provenance, added: expected.added, removed: expected.removed } });
      expect((await f.a.sync()).noticeId).toBe(actual.noticeId);
      expect(await f.a.status()).toMatchObject({ capabilities: { automatic: false, continuation: false } });
      const records = (await f.journal()).records;
      expect(records).toHaveLength(label === 'external' ? 0 : label === 'mixed' ? 2 : 1);
      if (records.length) {
        expect(records[0]).toMatchObject({ path: 'routes.ts', beforeSha256: hash(before) });
        expect(records.at(-1)).toMatchObject({ afterSha256: hash(after) });
        expect(new Set(records.map(r => r.origin)).size).toBe(label === 'mixed' ? 2 : 1);
      }
      // Both channels share the actual host outbox. Foreign-only drift never
      // claims stop-time delivery; requesting a next-prompt claim is host-only.
      if (label === 'foreign') expect(await f.a.client.collectContext({ cwd: f.root }, 16000)).toBeUndefined();
      const claim = await f.a.client.collectContext({ cwd: f.root }, 16000, label === 'foreign');
      expect(claim?.notices[0]?.noticeId).toBe(actual.noticeId);
      expect(await f.a.client.collectContext({ cwd: f.root }, 16000, true)).toBeUndefined();
      claim!.emitted();
      expect(await f.a.status()).toMatchObject({ notices: { emitted: 1, acknowledged: 0 } });
      // Emission is neither a model acknowledgment nor a baseline commit.
      expect((await f.a.sync()).noticeId).toBe(actual.noticeId);
      await f.a.client.acknowledgeDelivery(actual.noticeId as string, { cwd: f.root });
      expect(await f.a.sync()).toMatchObject({ red: false });
      asserted(`${label}-repeat-clean-turn-silent`);
    } finally { await f.close(); }
  }, 60000);
  it.skipIf(!['linux', 'darwin'].includes(process.platform))('native denied/failed/pre-publication cancellation publish no access, transition or enrollment', async () => {
    const f = await nativeMutationFixture('denied', report.parser);
    try {
      const before = fs.readFileSync(f.file, 'utf8');
      const code = `return await local.write({path:"routes.ts",overwrite:true,expectedSha256:"${hash(before)}",content:${JSON.stringify(route('denied-after'))}});`;
      expect((await f.a.execute(code, { approve: async () => { throw Error('fixture-denied'); } })).success).toBe(false);
      expect((await f.a.edit(before, 'not-present', 'never-written')).success).toBe(false);
      const cancel = new AbortController();
      expect((await f.a.execute(code, { signal: cancel.signal, approve: async () => { cancel.abort(); } })).status).toBe('aborted');
      expect(f.a.events.filter(e => ['access', 'committed'].includes(e.phase))).toEqual([]);
      expect(fs.readFileSync(f.file, 'utf8')).toBe(before);
      expect(await f.a.status()).toMatchObject({ engineStarts: 0, observations: { attentionPaths: 0 }, notices: { pending: 0 } });
      expect((await f.journal()).records).toEqual([]);
      asserted('denied-failed-mutations-no-journal'); asserted('cancel-before-publication-no-transition-or-notice');
    } finally { await f.close(); }
  }, 60000);
  it.skipIf(!['linux', 'darwin'].includes(process.platform))('native cancellation retains sync notice identity and suppresses only advisory before transport', async () => {
    const f = await nativeMutationFixture('cancelled-sync', report.parser);
    const ledger = new FoveaResponseDelivery();
    try {
      await f.a.baseline();
      expect((await f.a.edit(route('cancelled-sync-before'), 'cancelled-sync-before', 'cancelled-sync-after')).success).toBe(true);
      await expect(f.a.sync(AbortSignal.abort())).rejects.toThrow();
      const red = await f.a.sync(), expected = mutation('cancelled-sync-recovered');
      expect(red).toMatchObject({ red: true, details: { provenance: expected.provenance, added: expected.added, removed: expected.removed } });
      const original = projection(), controller = new AbortController();
      const collected = await collectFoveaContext(f.a.client, original, { cwd: f.root }, 16000);
      expect(collected.delivery?.notices[0]?.noticeId).toBe(red.noticeId);
      expect(collected.projection.text).toContain('Fovea advisory');
      expect(ledger.track('cancelled', collected.delivery!, controller.signal, original.text)).toBe(true);
      controller.abort();
      const send = vi.fn(async (_message: unknown) => {});
      await ledger.send({ id: 'cancelled', result: { content: [{ type: 'text', text: collected.projection.text }], structuredContent: { retryProgram: false } } }, send);
      expect(send).toHaveBeenCalledWith({ id: 'cancelled', result: { content: [{ type: 'text', text: original.text }], structuredContent: { retryProgram: false } } });
      expect(await f.a.status()).toMatchObject({ notices: { emitted: 0, acknowledged: 0 } });
      const retry = await f.a.client.collectContext({ cwd: f.root }, 16000);
      expect(retry?.notices[0]?.noticeId).toBe(red.noticeId); retry!.cancel();
      expect((await f.a.sync()).noticeId).toBe(red.noticeId);
      asserted('revoked-sync-does-not-advance-baseline');
    } finally { ledger.close(); await f.close(); }
  }, 60000);
  it.skipIf(!['linux', 'darwin'].includes(process.platform))('documents intentional native lost-ack improvement using exact publication evidence', async () => {
    const f = await nativeMutationFixture('lost-ack', report.parser);
    const rename = fs.renameSync;
    try {
      await f.a.baseline();
      // Keep bytes identical but replace the published inode before verification.
      // This forces a real provider acknowledgment failure, not observer injection.
      vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
        rename(from, to);
        if (String(to) === f.file) {
          const replacement = path.join(f.root, 'ack-fault');
          fs.copyFileSync(f.file, replacement); rename(replacement, f.file);
        }
      });
      const result = await f.a.write(route('lost-ack-before'), route('lost-ack-after'));
      expect(result.success).toBe(false); expect(result.error).toContain('committed');
      expect(f.a.events).toContainEqual(expect.objectContaining({ phase: 'failed', uncertain: true }));
      const transition = { path: f.file, beforeSha256: hash(route('lost-ack-before')), afterSha256: hash(route('lost-ack-after')) };
      expect(f.a.events.find(e => e.phase === 'prepared')?.transitions).toEqual([transition]);
      expect(f.a.events.find(e => e.phase === 'committed')?.transitions).toEqual([transition]);
      vi.restoreAllMocks();
      const red = await f.a.sync(), expected = mutation('lost-ack');
      expect((await f.journal()).records).toMatchObject([{ ...transition, path: 'routes.ts' }]);
      expect(red).toMatchObject({ red: true, details: { provenance: { kind: 'current-session' }, added: expected.added, removed: expected.removed } });
      expect(expected.provenance.kind).toBe('unattributed');
      asserted('pinned-failed-result-loses-commit-attribution');
    } finally { vi.restoreAllMocks(); await f.close(); }
  }, 60000);
  it.skipIf(!['linux', 'darwin'].includes(process.platform))('compares shared native-host invariants through the real registry/guest, not invented Kiro lifecycle events', async () => {
    const native = createScope(), root = native.workspace;
    const source = 'export function calculateTotal(n: number) { return n + 1; }\nexport function checkout() { return calculateTotal(2); }\n';
    fs.writeFileSync(path.join(root, 'math.ts'), source, { mode: 0o600 });
    const stat = fs.statSync(root, { bigint: true });
    const host = new FoveaHost({ dataRoot: native.root, configFile: path.join(native.root, 'fovea.v1.json'), parser: report.parser && { ...report.parser, path: options.parser }, entrypoint: nativeEntrypoint() });
    const authority = { canonicalPath: root, deviceId: String(stat.dev), fileId: String(stat.ino), conversationId: 'fixture-conversation', conversationEpoch: 1, authorizationEpoch: 1 };
    const client = host.bind(authority), registry = new ActionRegistry();
    registry.register(new FoveaProvider(client)); registry.register(new LocalCodingProvider({ root, lockRoot: path.join(native.root, 'locks') }));
    const service = new FabricExecutionService(registry, normalizeFabricConfig({ continuity: { enabled: false }, tracing: { enabled: false } }), root);
    const execute = (code: string, denied = false) => service.execute({ code, operationObserver: client.observer, workspaceBound: true, approver: { approve: async () => { if (denied) throw Error('fixture-denied'); } } });
    const status = () => client.invoke('status', {}, { cwd: root });
    try {
      expect(await status()).toMatchObject({ engineStarts: 0, observations: { attentionPaths: 0 } });
      asserted('idle-no-index-or-baseline');
      expect((await execute('return await local.read({path:"math.ts"});', true)).success).toBe(false);
      expect((await execute('return await local.read({path:"missing.ts"});')).success).toBe(false);
      expect(await status()).toMatchObject({ engineStarts: 0, observations: { attentionPaths: 0 } });
      asserted('denied-no-execute-or-enrollment'); asserted('failed-no-enrollment');
      const read = await execute('return await local.read({path:"math.ts"});');
      expect(read.success).toBe(true); expect(read.value).toMatchObject({ sha256: hash(source) });
      // Intentional native adaptation: attention does NOT implicitly enable
      // automatic analysis. Unlike upstream enrollment, no parser starts yet.
      expect(await status()).toMatchObject({ engineStarts: 0, observations: { attentionPaths: 1 }, capabilities: { automatic: false } });
      const focus = await execute('return await repo.focus({query:"calculateTotal",maxTokens:512});');
      expect(focus.success).toBe(true);
      const focused = focus.value as { focusId: string; focusRevision: number; graphGeneration: string; resultId: string };
      expect(focused.focusId).toBeTypeOf('string');
      expect((await execute('return null;')).success).toBe(true); // new disposable guest, not a lifecycle reset
      const dwell = await execute('return await repo.dwell({maxTokens:512});');
      expect(dwell.success).toBe(true);
      expect(dwell.value).toMatchObject({ focusId: focused.focusId, graphGeneration: focused.graphGeneration });
      expect((dwell.value as { focusRevision: number }).focusRevision).toBeGreaterThan(focused.focusRevision);
      asserted('ordinary-turn-retains-focus-and-silent'); asserted('dwell-reuses-graph-and-widens');
      const replay = await client.invoke('result', { resultId: focused.resultId }, { cwd: root });
      expect(await client.invoke('result', { resultId: focused.resultId }, { cwd: root })).toEqual(replay);
      const freshEpoch = host.bind({ ...authority, conversationEpoch: 2, authorizationEpoch: 2 });
      await expect(freshEpoch.invoke('dwell', { focusId: focused.focusId }, { cwd: root })).rejects.toThrow(/focusId/);
      expect(await freshEpoch.invoke('status', {}, { cwd: root })).toMatchObject({ engineStarts: 1 });
      await freshEpoch.close();
      await client.invoke('reset', {}, { cwd: root });
      await expect(client.invoke('dwell', { focusId: focused.focusId }, { cwd: root })).rejects.toThrow(/focusId/);
      expect(await status()).toMatchObject({ engineStarts: 1 });
      asserted('reset-clears-roots-focus-baseline-not-graph');
      // These explicit authority operations do NOT qualify Kiro new/resume/
      // compaction. Those events have no verified native mapping yet.
    } finally { await service.close(); await host.close(); fs.rmSync(native.root, { recursive: true, force: true }); }
  }, 60000);
});
