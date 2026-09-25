// W4 source fixtures: retain everything; never execute an engine or native child.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const boundaries = `
import { EventEmitter } from 'node:events';
export const hooks = {}, children = [], events = [];
export class FakeChild extends EventEmitter {
  pid = 800000000 + children.length; connected = true; exitCode = null; signalCode = null; frames = [];
  send(raw, callback) { const frame = JSON.parse(raw); this.frames.push(frame); events.push({type:'send',pid:this.pid,frame}); hooks.send?.(this,frame); callback?.(null); return true; }
  disconnect() { this.connected = false; }
  kill() { throw new Error('use guarded process-group signal only'); }
  exit(signal = 'SIGKILL') { if (this.exitCode !== null || this.signalCode !== null) return; this.signalCode = signal; this.connected = false; this.emit('exit',null,signal); }
  reply(frame, value = {}) { this.emit('message',JSON.stringify({version:1,id:frame.id,ok:true,value})); }
}
export function fork(...args) { const child = new FakeChild(); children.push(child); events.push({type:'fork',pid:child.pid}); hooks.fork?.(child,args); return child; }
export function localProcessGroupAlive(pid,end) { events.push({type:'census',pid,end}); return hooks.alive?.(pid,end) ?? false; }
const forbidden = () => { throw new Error('native process boundary forbidden'); };
export const spawn = forbidden, spawnSync = forbidden, exec = forbidden, execSync = forbidden, execFile = forbidden, execFileSync = forbidden;
export function resolveFoveaGit() { return undefined; }
export function loadManagedSourcePlatform() { return Promise.resolve(undefined); }
export class FoveaProvenanceJournal { async read() { return {}; } async append() {} }
export const PROVENANCE_MAX_RECORDS = 256;
export function validProvenanceTransition() { return false; }
`;

export async function barrier() { for (let i = 0; i < 48; i++) await Promise.resolve(); }
function deferred() {
  /** @type {(value?: unknown) => void} */
  let resolve = (_value) => {};
  /** @type {(error: unknown) => void} */
  let reject = (_error) => {};
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
function observe(operation) {
  const state = { settled: false, status: 'pending', value: undefined, error: undefined };
  let task;
  try { task = operation(); } catch (error) { task = Promise.reject(error); }
  const done = Promise.resolve(task).then(value => { Object.assign(state, { settled: true, status: 'fulfilled', value }); }, error => { Object.assign(state, { settled: true, status: 'rejected', error }); });
  return { state, done };
}
export function rejected(task, message = 'operation must reject') {
  assert.equal(task.state.status, 'rejected', message);
  return String(task.state.error?.message ?? task.state.error);
}

// Only wall/performance time and timeout scheduling are replaced. Microtasks stay
// real. No sleeps, retries, production deadline rewriting, or real PID signaling.
function clock() {
  const saved = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, dateNow: Date.now, now: Object.getOwnPropertyDescriptor(performance, 'now') };
  let now = 0, next = 0;
  const timers = new Map(), scheduled = [];
  globalThis.setTimeout = /** @type {any} */ ((fn, delay = 0, ...args) => {
    const handle = { id: ++next, unref() { return this; }, ref() { return this; } };
    const ms = Math.max(0, Number(delay));
    scheduled.push({ at: now, delay: ms }); timers.set(handle, { at: now + ms, fn: () => fn(...args) }); return handle;
  });
  globalThis.clearTimeout = handle => { timers.delete(handle); };
  Date.now = () => 1700000000000 + now;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  return { scheduled, timers, get now() { return now; }, async advance(ms) {
    const end = now + ms; let turns = 0;
    await barrier();
    for (;;) {
      const entry = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      assert.ok(++turns < 10000, 'mock timer loop bounded');
      now = entry[1].at; timers.delete(entry[0]); entry[1].fn(); await barrier();
    }
    now = end; await barrier();
  }, restore() {
    globalThis.setTimeout = saved.setTimeout; globalThis.clearTimeout = saved.clearTimeout; Date.now = saved.dateNow;
    if (saved.now) Object.defineProperty(performance, 'now', saved.now); else delete performance.now;
  } };
}

export async function loadFoveaFixture(context, label) {
  const parent = fs.realpathSync(context.fixturesRoot), temporary = fs.realpathSync(path.join(context.root, '.tmp'));
  const relative = path.relative(temporary, parent);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'retain fixtures below project .tmp');
  const directory = fs.mkdtempSync(path.join(parent, `${label}-`));
  const sources = ['src/fovea/engine-process.ts', 'src/fovea/scheduler.ts', 'src/fovea/host.ts', 'src/fovea/protocol.ts'];
  const snapshots = new Map(sources.map(file => [path.join(context.root, file), fs.readFileSync(path.join(context.root, file), 'utf8')]));
  const sourceHashes = Object.fromEntries(sources.map(file => [file, createHash('sha256').update(snapshots.get(path.join(context.root, file))).digest('hex')]));
  for (const [file, source] of snapshots) fs.writeFileSync(path.join(directory, path.basename(file)), source, { flag: 'wx', mode: 0o600 });
  const contents = ['FoveaEngineProcess', 'FoveaScheduler', 'FoveaHost'].map((name, i) => `export { ${name} } from ${JSON.stringify(path.join(context.root, sources[i]))};`).concat('export * from "fovea-fixture-boundaries";').join('\n');
  const result = await build({ stdin: { contents, resolveDir: context.root }, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24', write: false, metafile: true, logLevel: 'silent', plugins: [{ name: 'inert-fovea-process', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      if (args.path === 'fovea-fixture-boundaries' || args.path === 'node:child_process' || /(?:local-process-group|git-executable|native-source-loader|provenance-journal)\.js$/.test(args.path)) return { path: 'boundaries', namespace: 'fovea-fixture' };
      if (/\/engine\.js$/.test(args.path) || args.path === './engine.js') throw new Error('real engine/cleanup must not enter process fixture');
      return undefined;
    });
    builder.onLoad({ filter: /.*/, namespace: 'fovea-fixture' }, () => ({ contents: boundaries, loader: 'js' }));
    builder.onLoad({ filter: /\.ts$/ }, args => snapshots.has(args.path) ? { contents: snapshots.get(args.path), loader: 'ts', resolveDir: path.dirname(args.path) } : undefined);
  } }] });
  const bundle = path.join(directory, 'source-api.mjs');
  fs.writeFileSync(bundle, result.outputFiles[0].contents, { flag: 'wx', mode: 0o600 });
  const inputHashes = {};
  for (const input of Object.keys(result.metafile.inputs)) {
    const file = path.resolve(context.root, input);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) inputHashes[input] = createHash('sha256').update(snapshots.get(file) ?? fs.readFileSync(file)).digest('hex');
  }
  fs.writeFileSync(path.join(directory, 'source-hashes.json'), JSON.stringify({ sourceHashes, inputHashes, bundleSha256: createHash('sha256').update(result.outputFiles[0].contents).digest('hex') }, null, 2), { flag: 'wx', mode: 0o600 });
  const api = await import(pathToFileURL(bundle).href);
  const entrypoint = path.join(directory, 'never-executed-entry.mjs');
  fs.writeFileSync(entrypoint, 'throw new Error("fixture entrypoint must never execute");\n', { flag: 'wx', mode: 0o600 });
  const workspace = path.join(directory, 'workspace'); fs.mkdirSync(workspace, { mode: 0o700 });
  const parser = { path: entrypoint, sha256: '0'.repeat(64), version: 'fixture' };
  const options = { parser, entrypoint, storageRoot: directory };
  const query = { conversationId: 'fixture', conversationEpoch: 0, rootId: 'root_fixture', root: workspace, authorizationEpoch: 0, operation: 'reset', args: {} };
  const tasks = [], owners = [], gates = [], signals = [];
  let timer, restored = false;
  const fixture = { api, directory, sourceHashes, options, query, tasks, owners, gates, signals,
    hooks: api.hooks, children: api.children,
    track(operation) { const task = observe(operation); tasks.push(task); return task; },
    gate() { const gate = deferred(); gates.push(gate); return gate; },
    process() { const owner = new api.FoveaEngineProcess(options); owners.push(owner); return owner; },
    request(owner, signal = new AbortController().signal) { return fixture.track(() => owner.query(query, signal, 20000)); },
    frame(child, type) { const frame = child.frames.findLast(frame => frame.type === type); assert.ok(frame, `expected ${type} frame`); return frame; },
    async ready(owner) {
      const task = fixture.request(owner); await barrier(); const child = api.children.at(-1);
      child.reply(fixture.frame(child, 'initialize')); await barrier(); child.reply(fixture.frame(child, 'query'), { ready: true }); await barrier();
      assert.equal(task.state.status, 'fulfilled'); return child;
    },
    host() {
      const owner = new api.FoveaHost({ dataRoot: directory, configFile: path.join(directory, 'config.json'), parser, entrypoint }); owners.push(owner);
      const stat = fs.statSync(workspace, { bigint: true });
      const client = owner.bind({ canonicalPath: workspace, deviceId: String(stat.dev), fileId: String(stat.ino), conversationId: 'fixture', conversationEpoch: 0, authorizationEpoch: 0 });
      const invoke = (operation, signal = new AbortController().signal) => fixture.track(() => client.invoke(operation, {}, { cwd: workspace, signal, deadline: { remainingMs: () => 20000, throwIfExpired() {} } }));
      return { owner, client, invoke };
    },
    install() {
      const kill = process.kill; timer = clock(); fixture.clock = timer;
      process.kill = (pid, signal) => {
        const child = api.children.find(child => -child.pid === pid);
        assert.ok(child, `guard blocked non-fixture PID ${pid}`);
        assert.equal(signal, 'SIGKILL', 'unexpected process signal');
        signals.push({ pid, signal, at: timer.now });
        if (api.hooks.kill) api.hooks.kill(child); else queueMicrotask(() => child.exit());
        return true;
      };
      fixture.restore = () => { if (restored) return; restored = true; process.kill = kill; timer.restore(); };
    },
    async settle() {
      // In-memory only: no disk cleanup and no real engine.close invocation.
      api.hooks.kill = child => queueMicrotask(() => child.exit()); api.hooks.alive = () => false;
      api.hooks.send = (child, frame) => queueMicrotask(() => { child.reply(frame, { shutdown: true, closed: true, cleanup: { scratch: 'removed' } }); if (frame.type === 'shutdown') child.exit('SIGTERM'); });
      for (const gate of gates) gate.resolve(false);
      for (const child of api.children) child.exit();
      for (const owner of owners) fixture.track(() => owner.close());
      await timer.advance(25000);
      assert.equal(tasks.filter(task => !task.state.settled).length, 0, 'fixture must settle all observed work');
      assert.equal(timer.timers.size, 0, 'fixture must retire task timers');
    },
    evidence() { return { fixture: directory, sourceHashes, retained: true, fakeChildren: api.children.length, realEngineChildren: 0, signals, events: api.events, timers: timer?.scheduled ?? [] }; },
  };
  return fixture;
}
