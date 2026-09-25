// W4 only. Retain fixtures/evidence; only audited product scratch disposal removes files.
// No parser/native qualification: source core/parser/access hooks below are inert.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { verifyBuildClosure, validateBuildInputProvenance } from '../build-inputs.mjs';

const W4 = ['engine', 'engine-entry', 'engine-process', 'host', 'scratch-owner', 'protocol', 'scheduler'].map(name => `src/fovea/${name}.ts`).concat(['src/fovea/core/context.ts', 'src/fovea/core/temp-storage.ts']);
const HARNESS_MS = 15_000; // >= 5 * production CLEANUP_MS (1500); never changes production bounds.
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (file, bytes, mode = 0o600) => fs.writeFileSync(file, bytes, { flag: 'wx', mode });
const mkdir = (parent, name) => { const result = path.join(parent, name); fs.mkdirSync(result, { mode: 0o700 }); return result; };
const describe = error => ({ message: String(error?.message ?? error), ...(error?.stack ? { stack: error.stack } : {}), ...(error?.errors ? { errors: error.errors.map(describe) } : {}) });
function deferred() {
  /** @type {(value?: unknown) => void} */
  let resolve = (_value) => {};
  /** @type {(error: unknown) => void} */
  let reject = (_error) => {};
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => {}); return { promise, resolve, reject };
}
const barrier = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); };
async function within(promise, label, ms = HARNESS_MS) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: harness deadline ${ms}ms`)), ms); })]); }
  finally { clearTimeout(timer); }
}
function observe(promise) { const result = { settled: false }; result.done = promise.then(value => Object.assign(result, { settled: true, value }), error => Object.assign(result, { settled: true, error })); return result; }
function request(root, conversationId = 'alpha', conversationEpoch = 0, operation = 'focus') {
  return { root, rootId: 'root_fixture', conversationId, conversationEpoch, authorizationEpoch: 0, operation, args: operation === 'focus' ? { query: 'fixture' } : {} };
}
function fixture(context, label) {
  const parent = fs.realpathSync(context.fixturesRoot), tmp = fs.realpathSync(path.join(context.root, '.tmp'));
  const rel = path.relative(tmp, parent);
  assert.ok(rel && !rel.startsWith('..') && !path.isAbsolute(rel), 'evidence must be retained below project .tmp');
  const directory = fs.mkdtempSync(path.join(parent, `${label}-`));
  const snapshots = new Map(W4.map(file => [file, fs.readFileSync(path.join(context.root, file), 'utf8')]));
  const sourceHashes = Object.fromEntries([...snapshots].map(([file, text]) => [file, hash(text)]));
  for (const [file, text] of snapshots) write(path.join(directory, file.replaceAll('/', '_')), text);
  // Audit reached disposal: engine uses the bounded exact-owned helper, never a
  // recursive baseline remover. No Git fixtures or unknown scratch enter these cases.
  assert.doesNotMatch(snapshots.get('src/fovea/engine.ts'), /\b(?:rm|rmSync)\s*\(/u);
  assert.doesNotMatch(snapshots.get('src/fovea/scratch-owner.ts'), /\b(?:rm|rmSync)\s*\(/u);
  assert.match(snapshots.get('src/fovea/scratch-owner.ts'), /await rmdir\(node.path\)/u);
  assert.match(snapshots.get('src/fovea/scratch-owner.ts'), /Complete retain-first preflight before ANY deletion/u);
  assert.match(snapshots.get('src/fovea/engine-process.ts'), /CLEANUP_MS = 1_500, GRACE_MS = 500/u);
  write(path.join(directory, 'source-hashes.json'), JSON.stringify(sourceHashes, null, 2));
  return { directory, snapshots, sourceHashes };
}

// Only boundary dependencies are replaced. engine.ts, engine-entry.ts,
// scratch-owner.ts and protocol.ts are bundled verbatim. Core graph operations
// are deterministic maps in the real engine's root-local CoreContext store;
// SourceAccess creates real private files in owner-created stages, including on
// reuse. No source traversal, Git command, parser subprocess or native dlopen.
const inert = `
import { AsyncLocalStorage } from 'node:async_hooks';
import { writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export const coreContext = new AsyncLocalStorage();
export const hooks = { versions: new Map(), captures: [], builds: [], operations: [] };
export async function resolveParserDescriptor(descriptor, directory, signal) {
  signal.throwIfAborted(); const path = join(directory, 'managed-parser');
  await writeFile(path, 'inert, never executable parser bytes', { flag: 'wx', mode: 0o400 });
  return { ...descriptor, path };
}
export function readVerifiedExecutable() { throw new Error('Git executable forbidden in source fixture'); }
export const sourcePlatform = () => ({}), loadManagedSourcePlatform = async () => ({});
export const relativeStorageExclusion = () => undefined;
export class SourceAccess {
  async captureSourceSnapshot(root, stage, signal, options) {
    signal.throwIfAborted(); const text = 'export const value = ' + (hooks.versions.get(root) ?? 1) + ';\\n';
    const sha = createHash('sha256').update(text).digest('hex');
    await writeFile(join(stage, 'source.ts'), text, { flag: 'wx', mode: 0o600 });
    await writeFile(join(stage, 'readonly.ts'), text, { flag: 'wx', mode: 0o400 });
    await chmod(join(stage, 'readonly.ts'), 0o400);
    const id = createHash('sha256').update(root + text).digest('hex');
    const reused = options.previous?.id === id;
    hooks.captures.push({ root, stage, id, reused, previousRoot: options.previous?.root });
    return { root: reused ? options.previous.root : stage, id, hashes: new Map([['source.ts', sha], ['readonly.ts', sha]]), coverage: { inert: true } };
  }
  async readScopeSafeFile() { throw new Error('Git/source metadata read forbidden'); }
}
export function getState() { return coreContext.getStore().store.get('fixture:graph'); }
export async function ensureState(root) {
  const state = { generation: 'graph-' + (hooks.builds.length + 1), graph: { anchors: [] }, facts: {}, marker: {} };
  hooks.builds.push({ root, state }); coreContext.getStore().store.set('fixture:graph', state); return state;
}
async function op(root, state) {
  const ctx = coreContext.getStore(); hooks.operations.push({ root, state });
  await hooks.operation?.(ctx, state);
  ctx.sessionStore.set('fixture:memory', (ctx.sessionStore.get('fixture:memory') ?? 0) + 1);
  return { text: 'inert fixture graph', details: { seeds: 1, suggestedReads: [{ path: 'source.ts', offset: 1, limit: 1 }] } };
}
export const sketch = (root, budget, state) => op(root, state);
export const focus = (root, query, budget, options, state) => op(root, state);
export const dwell = (root, factor, budget, state) => op(root, state);
export const impact = (root, options, state) => op(root, state);
export async function sync() { await hooks.sync?.(); return { red: true, text: 'prepared', tokens: 2, details: {} }; }
export const syncBaselineStore = () => new Map();
export const gitHead = () => { throw new Error('Git forbidden'); };
export const provenancePathFor = () => { throw new Error('provenance file creation forbidden'); };
export const writeAtomicTemp = () => { throw new Error('atomic spill forbidden'); };
export const validateProvenanceJournal = () => { throw new Error('native journal forbidden'); };
export const observeSessionPaths = () => {};
export const loadRepoRules = async () => ({ pack: [], fileRoutes: [], sha: 'inert' });
export const DEFAULT_PACK = [], aggregateFiles = () => [], promote = () => [], posterior = () => 0;
export const boundResultDetails = value => value;
`;
async function sourceBundle(context, f, entry = false) {
  const contents = entry ? `import ${JSON.stringify(path.join(context.root, 'src/fovea/engine-entry.ts'))};`
    : `export { FoveaEngine } from ${JSON.stringify(path.join(context.root, 'src/fovea/engine.ts'))}; export * from 'lifecycle-inert';`;
  const result = await build({ stdin: { contents, resolveDir: context.root }, absWorkingDir: context.root,
    bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external', write: false, metafile: true, logLevel: 'silent',
    plugins: [{ name: 'inert-engine-boundaries', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (args.path === 'lifecycle-inert' || (args.importer.endsWith('/src/fovea/engine.ts') && /^(?:\.\/core\/|\.\/(?:source-access|source-platform|native-source-loader|parser-executable|provenance-journal)\.js$)/u.test(args.path))) return { path: 'inert', namespace: 'lifecycle' };
        if (args.path === 'node:child_process') throw new Error('Source engine bundle must not reach native spawning');
        return undefined;
      });
      builder.onLoad({ filter: /.*/, namespace: 'lifecycle' }, () => ({ contents: inert, loader: 'js' }));
      builder.onLoad({ filter: /\.ts$/ }, args => {
        const text = f.snapshots.get(path.relative(context.root, args.path));
        return text === undefined ? undefined : { contents: text, loader: 'ts', resolveDir: path.dirname(args.path) };
      });
    } }] });
  const bundle = path.join(f.directory, entry ? 'source-engine-entry.mjs' : 'source-engine-api.mjs');
  write(bundle, result.outputFiles[0].contents);
  const inputHashes = {};
  for (const name of Object.keys(result.metafile.inputs)) {
    const absolute = path.resolve(context.root, name);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) inputHashes[name] = hash(f.snapshots.get(name) ?? fs.readFileSync(absolute));
  }
  write(`${bundle}.identity.json`, JSON.stringify({ inputHashes, sha256: hash(result.outputFiles[0].contents), inertBoundaries: true }, null, 2));
  return bundle;
}
async function sourceCases(context) {
  const f = fixture(context, 'LC29'), bundle = await sourceBundle(context, f), { FoveaEngine, hooks } = await import(pathToFileURL(bundle).href);
  const facts = [], owners = [], gates = [];
  const gate = () => { const result = deferred(); gates.push(result); return result; };
  const make = label => {
    const storageRoot = mkdir(f.directory, label), parser = { path: bundle, sha256: '0'.repeat(64), version: '0.0.0' };
    const engine = new FoveaEngine({ storageRoot, parser }); owners.push(engine); return engine;
  };
  try {
    const roots = [mkdir(f.directory, 'workspace-a'), mkdir(f.directory, 'workspace-b')], engine = make('cache');
    const first = await engine.query(request(roots[0]));
    const rootA = [...engine.roots.values()][0], graphA = rootA.store.get('fixture:graph'), snapshotA = rootA.snapshotHashes;
    const again = await engine.query(request(roots[0]));
    assert.equal(again.sourceSnapshotId, first.sourceSnapshotId); assert.equal(again.graphGeneration, first.graphGeneration);
    assert.equal(again.details.snapshotReused, true); assert.equal(again.focusId, first.focusId); assert.equal(again.focusRevision, 2);
    assert.equal(rootA.store.get('fixture:graph'), graphA); assert.deepEqual(rootA.snapshotHashes, snapshotA); assert.equal(hooks.builds.length, 1);
    assert.equal(fs.statSync(path.join(rootA.path, 'source.ts')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(rootA.path, 'readonly.ts')).mode & 0o777, 0o400);
    assert.equal(fs.existsSync(hooks.captures.at(-1).stage), false, 'unused warm stage was exactly disposed');
    facts.push({ name: 'warm-query-preserves-snapshot-graph-focus', status: 'passed' });
    await engine.query(request(roots[1]));
    const rootB = [...engine.roots.values()].find(root => root !== rootA), graphB = rootB.store.get('fixture:graph'), storeB = rootB.store;
    assert.notEqual(rootA.store, storeB); assert.notEqual(graphA, graphB);
    hooks.versions.set(roots[0], 2);
    const dirty = await engine.query(request(roots[0]));
    assert.notEqual(dirty.sourceSnapshotId, first.sourceSnapshotId); assert.notEqual(dirty.graphGeneration, first.graphGeneration);
    assert.equal(rootB.store, storeB); assert.equal(storeB.get('fixture:graph'), graphB);
    assert.match(fs.readFileSync(path.join(rootA.path, 'source.ts'), 'utf8'), /value = 2/u);
    assert.match(fs.readFileSync(path.join(rootB.path, 'source.ts'), 'utf8'), /value = 1/u);
    assert.equal((await engine.query(request(roots[1]))).graphGeneration, graphB.generation);
    facts.push({ name: 'dirty-replacement-keeps-other-root', status: 'passed' });
    // Populate real conversation and sync-preparation paths, not fabricated maps.
    for (const root of roots) for (const { id, epoch } of [{ id: 'alpha', epoch: 0 }, { id: 'alpha', epoch: 1 }, { id: 'beta', epoch: 0 }]) {
      await engine.query(request(root, id, epoch)); await engine.query(request(root, id, epoch, 'sync'));
    }
    const beforeRoots = [...engine.roots.entries()], beforeConversations = new Map(engine.conversations), beforePrepared = new Map(engine.preparedSync);
    const preservedStores = beforeRoots.map(([key, root]) => [key, root.store, root.store.get('fixture:graph'), root.snapshotId]);
    assert.equal(beforeConversations.size, 6); assert.equal(beforePrepared.size, 6);
    await engine.retireConversation('alpha', 0);
    for (const [before, after] of [[beforeConversations, engine.conversations], [beforePrepared, engine.preparedSync]]) {
      assert.equal(after.size, 4);
      for (const [key, value] of before) { const [id, epoch] = JSON.parse(key); if (id === 'alpha' && epoch === 0) assert.equal(after.has(key), false); else assert.equal(after.get(key), value); }
    }
    assert.deepEqual([...engine.roots.entries()], beforeRoots);
    for (const [key, store, graph, id] of preservedStores) { assert.equal(engine.roots.get(key).store, store); assert.equal(store.get('fixture:graph'), graph); assert.equal(engine.roots.get(key).snapshotId, id); }
    await engine.retireConversation('absent', 0); await assert.rejects(engine.retireConversation('alpha', -1), /Invalid/u);
    facts.push({ name: 'selective-conversation-and-epoch-retirement-across-roots', status: 'passed', removedConversations: 2, retainedConversations: 4 });
    const ownedDirectory = engine.directory; await engine.close(); assert.equal(fs.existsSync(ownedDirectory), false);

    const draining = make('draining'), entered = gate(), work = gate(), maintenance = gate();
    hooks.operation = async ctx => { entered.resolve(); await work.promise; ctx.signal.throwIfAborted(); };
    const active = observe(draining.query(request(roots[0]))); await within(entered.promise, 'actual core operation entered');
    // Inject a persistence promise at the real clearRootStore maintenance boundary.
    const drainingRoot = [...draining.roots.values()][0];
    drainingRoot.store.set('maintenance', { value: { pending: maintenance.promise } });
    const queued = observe(draining.query(request(roots[1]))), retirement = observe(draining.retireConversation('alpha', 0));
    let reentry;
    draining.lifetime.signal.addEventListener('abort', () => { reentry = draining.close(); }, { once: true });
    const closing = draining.close(), closed = observe(closing);
    assert.equal(draining.close(), closing); assert.equal(reentry, closing); assert.equal(draining.lifetime.signal.aborted, true);
    await barrier(); assert.equal(closed.settled, false); assert.equal(active.settled, false); assert.equal(queued.settled, false);
    work.resolve(); await barrier(); assert.equal(closed.settled, false, 'genuine maintenance remains in the drained query tail');
    assert.ok(fs.existsSync(draining.directory)); maintenance.resolve();
    await within(Promise.all([active.done, queued.done, retirement.done, closed.done]), 'drain real query, queue and maintenance');
    assert.ok(active.error); assert.match(queued.error?.message ?? '', /closed/u); assert.match(retirement.error?.message ?? '', /closed/u); assert.equal(closed.error, undefined);
    assert.equal(fs.existsSync(draining.directory), false); await assert.rejects(draining.query(request(roots[0])), /closed/u);
    hooks.operation = undefined;
    facts.push({ name: 'close-revokes-drains-active-queued-and-maintenance-with-shared-reentry', status: 'passed' });

    // Fault-only setup: use actual close/retireRoot/clearRootStore but initialize
    // private fields directly. Fake scratch has no filesystem effects whatsoever.
    const faulty = make('faults'), attempts = [], maintenanceError = new Error('maintenance failure'), treeError = new Error('tree failure'), finalError = new Error('final cleanup failure');
    const badMaintenance = Promise.reject(maintenanceError); void badMaintenance.catch(() => {});
    for (const name of ['maintenance', 'tree', 'success']) faulty.roots.set(name, { path: name, store: new Map(name === 'maintenance' ? [['maintenance', { value: { pending: badMaintenance } }]] : []), hot: true, gap: false });
    faulty.scratch = { async removeTree(name) { attempts.push(name); if (name === 'tree') throw treeError; }, async close() { attempts.push('final'); throw finalError; } };
    let faultReentry; faulty.lifetime.signal.addEventListener('abort', () => { faultReentry = faulty.close(); });
    const failedClose = faulty.close(); assert.equal(faultReentry, failedClose); assert.equal(faulty.close(), failedClose);
    const failure = await failedClose.then(() => assert.fail('cleanup failure must reject'), error => error);
    assert.deepEqual(attempts, ['tree', 'success', 'final']); assert.deepEqual(failure.errors, [maintenanceError, treeError, finalError]);
    assert.equal(await faulty.close().catch(error => error), failure); assert.deepEqual(attempts, ['tree', 'success', 'final']);
    assert.equal(faulty.conversations.size, 0); assert.equal(faulty.preparedSync.size, 0);
    facts.push({ name: 'close-attempts-all-cleanup-preserves-shared-errors', status: 'passed', inertFaultBoundary: true });
    const syncFault = make('sync-errors'), primary = new Error('sync primary'), cleanup = new Error('sync cleanup');
    const originalBridge = syncFault.bridgeProvenance, originalCleanup = syncFault.removeScratchFiles;
    syncFault.bridgeProvenance = async () => ({ paths: ['inert-only'], origin: 'fixture', sequence: 0, gap: false });
    syncFault.removeScratchFiles = async () => { throw cleanup; }; hooks.sync = async () => { throw primary; };
    try {
      const error = await syncFault.query(request(roots[0], 'alpha', 0, 'sync')).catch(error => error);
      assert.equal(error.cause, primary); assert.deepEqual(error.errors, [primary, cleanup]);
    } finally { hooks.sync = undefined; syncFault.bridgeProvenance = originalBridge; syncFault.removeScratchFiles = originalCleanup; }
    await syncFault.close();
    facts.push({ name: 'sync-primary-and-cleanup-errors-both-preserved', status: 'passed', inertFaultBoundary: true });
    const latched = make('latched'), prior = new Error('previous cleanup uncertainty'); latched.cleanupFailure = prior;
    const sticky = await latched.close().catch(error => error); assert.equal(sticky.cause, prior); assert.deepEqual(sticky.errors, [prior]);
    assert.equal(await latched.close().catch(error => error), sticky);
    facts.push({ name: 'prior-engine-cleanup-error-stays-latched', status: 'passed', inertFaultBoundary: true });
    for (const [file, expected] of Object.entries(f.sourceHashes)) assert.equal(hash(fs.readFileSync(path.join(context.root, file))), expected, `Source drift during LC29: ${file}`);
    return { variants: facts, fixture: f.directory, sourceHashes: f.sourceHashes, sourceLevel: true, nativeParser: false, retained: true };
  } finally {
    hooks.operation = undefined; hooks.sync = undefined; for (const item of gates) item.resolve();
    // Audited product cleanup only: all real owners exclusively created their
    // stages; fake fault owner above cannot touch a path. Do not remove fixtures.
    const settlement = await Promise.allSettled(owners.map(owner => within(owner.close(), 'source owner settlement')));
    write(path.join(f.directory, 'settlement.json'), JSON.stringify(settlement.map((r, i) => ({ owner: i, status: r.status, ...(r.status === 'rejected' ? { error: describe(r.reason) } : {}) })), null, 2));
  }
}

function assertW4Current(root, inputs) {
  validateBuildInputProvenance(inputs);
  for (const file of W4) assert.equal(inputs.files.find(item => item.path === file)?.sha256, hash(fs.readFileSync(path.join(root, file))), `STALE_BUILD: ${file}; Main must rebuild before LC30`);
}
function groupGone(child) {
  assert.ok(Number.isSafeInteger(child.pid) && child.pid > 1, 'owned child PID required');
  try { process.kill(-child.pid, 0); } catch (error) { if (error.code === 'ESRCH') return true; throw error; }
  return false;
}
function captureChild(child) {
  const evidence = { pid: child.pid, spawnErrors: [], frames: [], spawned: false, exit: undefined };
  const spawned = deferred(), exited = deferred();
  // The real supervisor removes generation listeners during stop. Observe this
  // owned child's actual emissions, not removable application listeners; keep
  // the original emitter and all real process/IPC behavior unchanged.
  const emit = child.emit;
  child.emit = function(event, ...args) {
    if (event === 'spawn') { evidence.spawned = true; evidence.pid = child.pid; spawned.resolve(); }
    if (event === 'error') { evidence.spawnErrors.push(describe(args[0])); spawned.reject(args[0]); }
    if (event === 'message') { try { evidence.frames.push(JSON.parse(args[0])); } catch { evidence.frames.push({ malformed: true }); } }
    if (event === 'exit') { const [code, signal] = args; evidence.exit = { code, signal }; exited.resolve(evidence.exit); }
    return Reflect.apply(emit, this, [event, ...args]);
  };
  return { child, evidence, spawned, exited };
}
function spawnAssertions(owned) {
  assert.deepEqual(owned.evidence.spawnErrors, [], 'explicit owned-child spawn-error assertion');
  assert.equal(owned.evidence.spawned, true, 'owned child emitted spawn');
}
async function emergencyStop(owned) {
  const { child } = owned;
  if (!owned.evidence.spawned) { assert.deepEqual(owned.evidence.spawnErrors, [], 'owned-child spawn failed'); return; }
  // Positively captured detached child only. No unrelated PID, census cleanup or
  // directory sweeper. Graceful normal paths run before this failure fallback.
  if (child.exitCode === null && child.signalCode === null && !groupGone(child)) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  await within(owned.exited.promise, 'owned leader reaping');
  assert.equal(groupGone(child), true, 'whole owned group termination must be proved');
}
async function childProbe(entrypoint, storageRoot, parser, root, initialized) {
  const owned = captureChild(childProcess.fork(entrypoint, [], { execPath: process.execPath, execArgv: [], cwd: storageRoot,
    env: { LANG: 'C.UTF-8', LC_ALL: 'C', TMPDIR: storageRoot }, detached: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'json' }));
  let stderr = ''; owned.child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-8000); });
  let serial = 0;
  async function rpc(type, fields = {}) {
    const id = `fixture_${++serial}`, reply = deferred();
    const listener = raw => { try { const frame = JSON.parse(raw); if (frame.id === id) reply.resolve(frame); } catch (error) { reply.reject(error); } };
    owned.child.on('message', listener);
    try {
      owned.child.send(JSON.stringify({ version: 1, type, id, ...fields }), error => { if (error) reply.reject(error); });
      const response = await within(reply.promise, `owned IPC ${type}`); assert.equal(response.version, 1); assert.equal(response.id, id); return response;
    } finally { owned.child.removeListener('message', listener); }
  }
  const query = operation => rpc('query', { remainingMs: HARNESS_MS, request: request(root, 'alpha', 0, operation) });
  try {
    await within(owned.spawned.promise, 'owned Node spawn'); spawnAssertions(owned);
    assert.deepEqual((await rpc('initialize', { options: { parser, storageRoot } })).value, { initialized: true, ipcVersion: 1 });
    assert.equal((await query('status')).value.initialized, false);
    assert.equal((await query('reset')).ok, true);
    assert.deepEqual((await rpc('retireConversation', { conversationId: 'alpha', conversationEpoch: 0 })).value, { retired: true });
    assert.deepEqual(fs.readdirSync(storageRoot), [], 'lazy control operations do not allocate engine scratch');
    const focus = await query('focus');
    if (initialized) {
      assert.equal(focus.ok, true); assert.equal(focus.value.status, 'ok');
      const warm = await query('focus'); assert.equal(warm.value.graphGeneration, focus.value.graphGeneration); assert.equal(warm.value.details.snapshotReused, true);
      assert.equal((await query('status')).value.initialized, true);
      assert.equal(fs.readdirSync(storageRoot).filter(name => name.startsWith('engine-')).length, 1);
    } else {
      assert.equal(focus.ok, false); assert.match(focus.error, /Managed parser SHA-256 mismatch/u);
      assert.deepEqual(fs.readdirSync(storageRoot), [], 'partial initialization disposes its exact owned scratch');
      assert.equal((await query('status')).value.initialized, false);
      assert.equal((await query('reset')).ok, true, 'safe initialization failure leaves control plane usable');
    }
    const final = await rpc('shutdown');
    assert.equal(final.ok, true); assert.deepEqual(final.value, { shutdown: true, closed: true, cleanup: { scratch: 'removed' } });
    assert.deepEqual(await within(owned.exited.promise, 'shutdown ack then leader exit'), { code: 0, signal: null });
    assert.equal(groupGone(owned.child), true, 'leader exit alone is not whole-group proof');
    assert.deepEqual(fs.readdirSync(storageRoot), []); spawnAssertions(owned);
    return { ...owned.evidence, wholeGroupGone: true, scratchRemoved: true, nativeParser: false, initializedWithInertBoundaries: initialized, stderr };
  } finally {
    try { await emergencyStop(owned); }
    finally { write(path.join(path.dirname(storageRoot), `${path.basename(storageRoot)}-child.json`), JSON.stringify({ ...owned.evidence, stderr }, null, 2)); }
  }
}
async function publicHostProbe(context, f, entrypoint, parser, root) {
  const api = await import(pathToFileURL(path.join(context.root, 'dist/index.js')).href);
  assert.equal(typeof api.FoveaHost, 'function', 'built public FoveaHost export');
  for (const method of ['bind', 'retireConversation', 'close']) assert.equal(typeof api.FoveaHost.prototype[method], 'function');
  assert.match(fs.readFileSync(path.join(context.root, 'dist/index.d.ts'), 'utf8'), /export \{ FoveaHost \}/u);
  const dataRoot = mkdir(f.directory, 'host-data'), originalFork = childProcess.fork, owned = [];
  let host;
  // Observe only this test's real host forks; no fake child/clock/process-group
  // implementation. The exact entry/cwd/detached assertions constrain fallback.
  childProcess.fork = (...callArgs) => {
    const [file, args, options] = callArgs;
    assert.ok(Array.isArray(args)); assert.ok(options && typeof options.cwd === 'string');
    assert.equal(file, entrypoint); assert.equal(options.detached, true); assert.equal(options.execPath, process.execPath);
    const relative = path.relative(dataRoot, options.cwd); assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    const child = Reflect.apply(originalFork, childProcess, callArgs); owned.push(captureChild(child)); return child;
  };
  syncBuiltinESMExports();
  try {
    host = new api.FoveaHost({ dataRoot, configFile: path.join(dataRoot, 'config.json'), parser, entrypoint });
    const identity = fs.statSync(root, { bigint: true });
    const bind = id => host.bind({ canonicalPath: root, deviceId: String(identity.dev), fileId: String(identity.ino), conversationId: id, conversationEpoch: 0, authorizationEpoch: 0 });
    const alpha = bind('alpha'), beta = bind('beta');
    const invoke = (client, operation) => within(client.invoke(operation, {}, { cwd: root, signal: new AbortController().signal, deadline: { remainingMs: () => HARNESS_MS, throwIfExpired() {} } }), `public host ${operation}`);
    assert.equal((await invoke(alpha, 'status')).engineStarts, 0);
    assert.equal((await invoke(alpha, 'reset')).status, 'ok'); assert.equal(owned.length, 1); spawnAssertions(owned[0]);
    await host.retireConversation('alpha', 0); await assert.rejects(invoke(alpha, 'status'));
    assert.equal((await invoke(beta, 'reset')).status, 'ok');
    assert.equal((await invoke(beta, 'reload')).restarted, true);
    const status = await invoke(beta, 'status');
    assert.deepEqual(status.cleanup, { generation: 1, mode: 'graceful', processGroup: 'confirmed', scratch: 'removed' });
    assert.equal(status.engineActive, false); assert.equal(status.retainedScratchGenerations, 0); assert.equal(owned.length, 1);
    const closing = host.close(); assert.equal(host.close(), closing); await within(closing, 'public host close');
    await assert.rejects(invoke(beta, 'status'));
    assert.equal(groupGone(owned[0].child), true);
    assert.ok(owned[0].evidence.frames.some(frame => frame.ok && frame.value?.shutdown === true && frame.value?.closed === true && frame.value?.cleanup?.scratch === 'removed'));
    assert.deepEqual(owned[0].evidence.exit, { code: 0, signal: null }); spawnAssertions(owned[0]);
    return { publicExport: true, cleanup: status.cleanup, children: owned.map(item => item.evidence), nativeJournalQualification: false, distIndexSha256: hash(fs.readFileSync(path.join(context.root, 'dist/index.js'))) };
  } finally {
    try { if (host) await within(host.close(), 'host final settlement'); }
    finally {
      childProcess.fork = originalFork; syncBuiltinESMExports();
      try { for (const child of owned) await emergencyStop(child); }
      finally { write(path.join(f.directory, 'built-host-children.json'), JSON.stringify(owned.map(item => item.evidence), null, 2)); }
    }
  }
}
async function sourceEntryOnly(context) {
  const f = fixture(context, 'source-entry-only'), entrypoint = await sourceBundle(context, f, true);
  const parser = { path: entrypoint, sha256: '0'.repeat(64), version: '0.0.0' };
  const child = await childProbe(entrypoint, mkdir(f.directory, 'source-child-storage'), parser, mkdir(f.directory, 'workspace'), true);
  return { fixture: f.directory, sourceHashes: f.sourceHashes, ...child, builtQualification: false, retained: true };
}
async function builtCases(context) {
  const f = fixture(context, 'LC30');
  // Reject before import/spawn: stale built cleanup must never execute. The real
  // manifest verifies all closure bytes and all build inputs, not just a marker.
  let closure;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(context.root, 'dist/kiro-agent-closure/closure-manifest.json'), 'utf8'));
    assertW4Current(context.root, manifest.buildInputs);
    closure = verifyBuildClosure(context.root);
  } catch (cause) {
    const error = new Error(`STALE_OR_INVALID_BUILD: Main must rebuild dist before LC30; no children spawned: ${cause.message}`, { cause });
    write(path.join(f.directory, 'blocked-build.json'), JSON.stringify({ status: 'blocked', error: describe(error), sourceHashes: f.sourceHashes, childrenSpawned: 0 }, null, 2));
    throw error;
  }
  const mutated = structuredClone(closure.buildInputs), selected = mutated.files.find(item => item.path === W4[0]);
  selected.sha256 = selected.sha256 === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64); mutated.digest = hash(JSON.stringify(mutated.files));
  assert.throws(() => assertW4Current(context.root, mutated), /STALE_BUILD/u, 'source/build mismatch must fail, even with a valid manifest digest');
  const entrypoint = path.join(context.root, 'dist/kiro-agent-closure', closure.foveaEngine);
  assert.equal(closure.foveaEngine, 'fovea/engine-entry.js');
  const parserFile = path.join(f.directory, 'never-execute-parser');
  // Executable permissions pass readVerifiedExecutable; deliberately wrong SHA
  // fails BEFORE copying/executing a parser or loading SourceAccess/native code.
  write(parserFile, 'This is intentionally not an executable program.\n', 0o500);
  const parser = { path: parserFile, sha256: '0'.repeat(64), version: '0.0.0' };
  assert.notEqual(hash(fs.readFileSync(parserFile)), parser.sha256);
  const root = mkdir(f.directory, 'workspace');
  const realEntry = await childProbe(entrypoint, mkdir(f.directory, 'built-child-storage'), parser, root, false);
  const host = await publicHostProbe(context, f, entrypoint, parser, root);
  const sourceEntry = await sourceBundle(context, f, true);
  const initializedEntry = await childProbe(sourceEntry, mkdir(f.directory, 'source-child-storage'), parser, root, true);
  // Detect concurrent source drift instead of claiming a mixed-input pass.
  assertW4Current(context.root, closure.buildInputs);
  return { fixture: f.directory, sourceHashes: f.sourceHashes, buildInputDigest: closure.buildInputs.digest, closureDigest: closure.contentDigest,
    variants: [{ name: 'manifest-source-mismatch-rejected', status: 'passed' }, { name: 'built-entry-lazy-controls-safe-partial-init-shutdown', status: 'passed', ...realEntry },
      { name: 'built-public-host-controls-graceful-process-cleanup', status: 'passed', ...host }, { name: 'source-entry-inert-initialized-scratch-shutdown', status: 'passed', ...initializedEntry }],
    nativeParser: false, nativeClientQualification: false, retained: true };
}
export function createFoveaBuiltCases() {
  return [
    { id: 'LC29', title: 'Fovea engine preserves root graphs and selectively retires conversations while close drains owned work', effects: 'source-bundled real engine; inert parser/source/core; exact owned generated scratch disposal; fixtures retained; no child processes', deadlineMs: 60_000, run: sourceCases },
    { id: 'LC30', title: 'Current built public FoveaHost and owned engine-entry acknowledge scratch cleanup before whole-group termination', effects: 'verified current built API and positively owned Node IPC children; wrong parser SHA blocks execution; inert initialized source supplement; retained evidence; no native parser qualification', deadlineMs: 90_000, run: builtCases },
  ];
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const selected = process.argv.slice(2); assert.ok(selected.every(id => ['LC29', 'LC30', '--source-entry'].includes(id)), 'usage: node lifecycle-fovea-built.mjs [LC29|LC30|--source-entry]');
  const root = fs.realpathSync(process.cwd()), fixturesRoot = fs.mkdtempSync(path.join(root, '.tmp/fovea-built-proof-')), facts = [];
  const cases = [...createFoveaBuiltCases(), ...(selected.includes('--source-entry') ? [{ id: '--source-entry', run: sourceEntryOnly }] : [])];
  for (const item of cases.filter(item => !selected.length || selected.includes(item.id))) {
    try { facts.push({ id: item.id, status: 'passed', facts: await item.run({ root, fixturesRoot }) }); }
    catch (error) { facts.push({ id: item.id, status: 'failed', error: describe(error) }); process.exitCode = 1; }
  }
  const report = path.join(fixturesRoot, 'report.json'); write(report, JSON.stringify(facts, null, 2));
  console.log(JSON.stringify({ report, cases: facts.map(item => ({ id: item.id, status: item.status, variants: item.facts && 'variants' in item.facts ? item.facts.variants.length : undefined, error: item.error?.message })) }));
}
