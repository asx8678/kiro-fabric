import { removeFixtureSync } from '../fixture-cleanup.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const wire = vi.hoisted(() => ({ handlers: new Map<unknown, (...args: any[]) => Promise<any>>(), sent: new Map<number, any>(), transport: undefined as any, elicited: 0 }));
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({ Server: class {
  setRequestHandler(schema: unknown, handler: (...args: any[]) => Promise<any>) { wire.handlers.set(schema, handler); }
  setNotificationHandler() {} getClientCapabilities() { return { elicitation: { form: {} } }; }
  async elicitInput() { wire.elicited++; return { action: 'accept', content: { approved: true } }; }
  async connect(transport: any) { wire.transport = transport; } async close() {}
} }));
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({ StdioServerTransport: class { async send(message: any) { wire.sent.set(message.id, message); } } }));
import { createKiroMcpServer } from '../../src/kiro/mcp-server.js';
import { KiroPowerWorkspaceBinding } from '../../src/kiro/power/workspace-binding.js';
import { createKiroRuntime, type KiroRuntime, type KiroRuntimeOptions } from '../../src/kiro/runtime.js';
import { KiroHostSessionAdapter, type KiroHostTurn } from '../../src/kiro/host-session-adapter.js';
import { FoveaEngineProcess } from '../../src/fovea/engine-process.js';
import type { FoveaQuery } from '../../src/fovea/protocol.js';
import type { WorkspaceContextProvider } from '../../src/kiro/power/workspace-context.js';

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); wire.handlers.clear(); wire.sent.clear(); wire.elicited = 0; });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
const parse = (response: any) => { expect(response.isError, response.content[0].text).not.toBe(true); return JSON.parse(response.content[0].text); };

async function fixture(post = false, onPrepared?: (runtime: KiroRuntime) => void) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fovea-mcp-sessions-'))); fs.chmodSync(base, 0o700);
  cleanup.push(() => removeFixtureSync(base, { recursive: true, force: true }));
  const dataRoot = path.join(base, 'data'), runtimeRoot = path.join(base, 'runtime'), root = path.join(base, 'source');
  for (const dir of [dataRoot, runtimeRoot, root]) fs.mkdirSync(dir, { mode: 0o700 });
  fs.writeFileSync(path.join(root, 'math.ts'), 'export const total = 1;\n', { mode: 0o600 });
  const configDir = path.join(dataRoot, 'fabric', 'config'); fs.mkdirSync(configDir, { recursive: true, mode: 0o700 }); fs.chmodSync(path.dirname(configDir), 0o700);
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ schemaVersion: 1, mcp: { enabled: false }, approvals: { read: 'allow', write: 'allow' } }), { mode: 0o600 });
  const context = (location?: string): WorkspaceContextProvider => ({ current: async () => ({ status: location ? 'verified' : 'explicitly-empty', roots: location ? [{ uri: pathToFileURL(location).href }] : [], revision: 1, observedAt: 0 }), invalidate() {}, subscribe: () => ({ dispose() {} }) });
  const hostSessions = new KiroHostSessionAdapter();
  const a = hostSessions.openSession({ conversationId: 'a', conversationEpoch: 1, workspaceContext: context(root) });
  const b = hostSessions.openSession({ conversationId: 'b', conversationEpoch: 1, workspaceContext: context(root) });
  const at = hostSessions.beginTurn(a), bt = hostSessions.beginTurn(b);
  const queries: FoveaQuery[] = [];
  // Only the graph worker is substituted. Routing, runtime, QuickJS, result
  // ownership, observations and outbox are real; built tests cover the worker.
  vi.spyOn(FoveaEngineProcess.prototype, 'query').mockImplementation(async request => {
    queries.push(request);
    if (request.operation === 'sync') return request.args.commitPreparationId ? { acknowledged: true } : { red: true, text: 'semantic change', sourceSnapshotId: 'snapshot1', syncPreparationId: 'preparation1', details: { provenance: { kind: 'current-session' } } };
    return { status: 'ok', text: 'graph', sourceSnapshotId: 'snapshot1', graphGeneration: 'graph1', estimatedTokens: 5, coverage: {}, reads: [], truncated: false, focusId: 'focus1' };
  });
  const prepared: KiroRuntimeOptions[] = [], entered = deferred(), aborted = deferred(), release = deferred();
  cleanup.push(() => { release.resolve(); });
  const server = await createKiroMcpServer({ dataRoot, runtimeRoot, version: 'test', hostSessions, launchWorkspaceRoot: root,
    managedParser: { path: '/not-admitted-test-peer', sha256: '0'.repeat(64), version: '0.45.3' },
    ...(post ? { foveaPostToolContext: { authorizedAnalysis: true, qualifiedVisibleDelivery: true } } : {}),
    prepareRuntime: async options => {
      prepared.push(options);
      const runtime = await createKiroRuntime(options);
      runtime.registry.register({ name: 'fixture', description: 'Owned lifecycle fixture',
        list: async () => [{ name: 'hold', description: 'Wait for test release', inputSchema: { type: 'object' }, risk: 'read' }],
        describe: async () => ({ name: 'hold', description: 'Wait for test release', inputSchema: { type: 'object' }, risk: 'read' }),
        invoke: async (_name, _args, ctx) => { ctx.signal!.addEventListener('abort', aborted.resolve, { once: true }); entered.resolve(); await release.promise; return 'settled'; },
      });
      onPrepared?.(runtime);
      return runtime;
    },
  });
  cleanup.push(async () => { release.resolve(); await server.close(); });
  let next = 0;
  const request = async (turn: KiroHostTurn | undefined, name: string, args: Record<string, unknown> = {}, send = true) => {
    const id = ++next;
    if (turn) hostSessions.associateRequest(id, turn);
    const result = await wire.handlers.get(CallToolRequestSchema)!({ method: 'tools/call', params: { name, arguments: args, _meta: { session_id: 'a', epoch: 1 } } }, { requestId: id, signal: new AbortController().signal });
    const message = { jsonrpc: '2.0', id, result };
    if (send) { await wire.transport.send(message); return wire.sent.get(id).result; }
    return message;
  };
  const call = (turn: KiroHostTurn, code: string) => request(turn, 'fabric_exec', { code, resultFormat: 'json' });
  return { server, root, context, hostSessions, a, b, at, bt, request, call, prepared, queries, entered, aborted, release, configFile: path.join(configDir, 'config.json') };
}

describe('MCP trusted host session routing (not native Kiro qualification)', () => {
  it('rejects missing ownership before runtime selection, ignoring guest metadata', async () => {
    const f = await fixture();
    const rejected = await f.request(undefined, 'fabric_info');
    expect(rejected.isError).toBe(true); expect(rejected.content[0].text).toContain('host_session_unavailable');
    expect(f.prepared).toHaveLength(0);
    const info = parse(await f.request(f.at, 'fabric_info'));
    expect(info.fovea.sessionIsolation).toMatchObject({ supported: true, stateOwner: 'host-session-epoch', nativeClearResetGuaranteed: false });
    expect(info.fovea.nativeHooks.automatic).toBe(false);
    expect(info.fovea.automaticQualification.ready).toBe(false);
  });
  it('does not admit a lease when retirement wins the pre-creation await boundary', async () => {
    const f = await fixture();
    const observe = KiroPowerWorkspaceBinding.prototype.workspaceObservation;
    let observations = 0, retirement: Promise<void> | undefined;
    vi.spyOn(KiroPowerWorkspaceBinding.prototype, 'workspaceObservation').mockImplementation(function (this: KiroPowerWorkspaceBinding) {
      const value = observe.call(this);
      // fabric_info observes at workspace sync, its blocked check, then runtime
      // admission. Queue retirement at the third observation: it runs while
      // runtimeForIdentity awaits closeRuntime, before the first lease exists.
      if (++observations === 3) queueMicrotask(() => {
        retirement = f.hostSessions.retireSession(f.a);
        void retirement.catch(() => {});
      });
      return value;
    });
    const result = await f.request(f.at, 'fabric_info');
    expect(retirement).toBeDefined();
    await retirement;
    expect(result.isError).toBe(true);
    expect(f.prepared).toHaveLength(0);
    expect(parse(await f.call(f.bt, 'return await repo.settings();')).scope).toBe('defaults');
  });
  it('closes a newly created runtime without publishing its catalog after retirement', async () => {
    let f!: Awaited<ReturnType<typeof fixture>>;
    let retirement: Promise<void> | undefined;
    let catalogs = 0, closed = 0;
    f = await fixture(false, runtime => {
      const bind = runtime.service.bindCatalog.bind(runtime.service), close = runtime.close.bind(runtime);
      vi.spyOn(runtime.service, 'bindCatalog').mockImplementation(binding => { catalogs++; return bind(binding); });
      vi.spyOn(runtime, 'close').mockImplementation(async () => { closed++; await close(); });
      // The first microtask precedes createRuntimeFor's continuation; the next
      // falls between its final liveness check and runtimeForIdentity's publish.
      queueMicrotask(() => queueMicrotask(() => {
        retirement = f.hostSessions.retireSession(f.a);
        void retirement.catch(() => {});
      }));
    });
    const result = await f.request(f.at, 'fabric_info');
    expect(retirement).toBeDefined();
    await retirement;
    expect(result.isError).toBe(true);
    expect(catalogs).toBe(0);
    expect(closed).toBe(1);
  });
  it('isolates simultaneous same-workspace runtime settings, root leases and retained results', async () => {
    const f = await fixture();
    const [a, b] = await Promise.all([f.call(f.at, 'return await repo.status();'), f.call(f.bt, 'return await repo.status();')]);
    expect(parse(a).rootId).not.toBe(parse(b).rootId);
    expect(f.prepared).toHaveLength(2); expect(f.prepared.every(p => p.cwd === f.root)).toBe(true);
    await f.call(f.at, 'const s = await repo.settings(); s.config.tools.defaultBudget = 2048; return await repo.configure({config:s.config,scope:"session",expectedRevision:s.revision});');
    expect(parse(await f.call(f.at, 'return await repo.settings();')).scope).toBe('session');
    expect(parse(await f.call(f.bt, 'return await repo.settings();')).scope).toBe('defaults');
    const result = parse(await f.call(f.at, 'return await repo.focus({query:"total"});'));
    const foreign = await f.call(f.bt, `return await repo.result({resultId:${JSON.stringify(result.resultId)}});`);
    expect(foreign.isError).toBe(true); expect(foreign.content[0].text).toContain('foreign');
    expect(parse(await f.call(f.at, `return await repo.result({resultId:${JSON.stringify(result.resultId)}});`)).resultId).toBe(result.resultId);
    const empty = f.hostSessions.openSession({ conversationId: 'empty', conversationEpoch: 1, workspaceContext: f.context() });
    const info = parse(await f.request(f.hostSessions.beginTurn(empty), 'fabric_info'));
    expect(info.workspace.verification).toBe('unbound'); // No global launch fallback.
  });
  it('clear revokes before active work drains and does not block another session', async () => {
    const f = await fixture();
    await f.call(f.at, 'return await repo.status();');
    const previous = f.prepared[0]!.foveaClient!;
    const pending = f.call(f.at, 'return await tools.call({ref:"fixture.hold",args:{}});');
    await f.entered.promise;
    let retired = false;
    const cleanup = f.hostSessions.retireSession(f.a).then(() => { retired = true; });
    await f.aborted.promise;
    await expect(previous.invoke('status', {}, { cwd: f.root })).rejects.toThrow(/revoked/);
    expect(retired).toBe(false);
    expect(parse(await f.call(f.bt, 'return await repo.settings();')).scope).toBe('defaults');
    const fresh = f.hostSessions.openSession({ conversationId: 'a', conversationEpoch: 2, workspaceContext: f.context(f.root) });
    expect(parse(await f.call(f.hostSessions.beginTurn(fresh), 'return await repo.settings();')).scope).toBe('defaults');
    f.release.resolve(); expect((await pending).isError).toBe(true); await cleanup;
    expect(() => f.hostSessions.associateRequest(999, f.at)).toThrow();
  });
  it('binds observations and semantic visible delivery to the exact captured turn', async () => {
    const f = await fixture(true);
    const output = await f.call(f.at, 'await local.read({path:"math.ts"}); return {outcome:"unchanged"};');
    expect(JSON.parse(output.content[0].text.split('\n\nNavigator advisory')[0])).toEqual({ outcome: 'unchanged' });
    const marker = '):\n';
    const notices = JSON.parse(output.content[0].text.slice(output.content[0].text.indexOf(marker) + marker.length));
    const noticeId = notices[0].noticeId;
    const client = f.prepared[0]!.foveaClient!;
    expect(await client.invoke('status', {}, { cwd: f.root })).toMatchObject({ observations: { attentionPaths: 1 }, notices: { emitted: 1, acknowledged: 0 } });
    expect(f.queries.some(q => q.args.commitPreparationId)).toBe(false);
    expect(await f.hostSessions.acknowledgeModelInput(f.bt, noticeId)).toBe(false);
    expect(await f.hostSessions.acknowledgeModelInput(f.at, noticeId)).toBe(true);
    expect(f.queries.filter(q => q.args.commitPreparationId)).toHaveLength(1);
    expect(f.queries.every(q => q.conversationId === 'a')).toBe(true);
    expect(await client.invoke('status', {}, { cwd: f.root })).toMatchObject({ notices: { pending: 0, emitted: 0 } });
  });
  it('strips only the stale advisory after retirement between handler and transport', async () => {
    const f = await fixture(true);
    const message = await f.request(f.at, 'fabric_exec', { code: 'await local.read({path:"math.ts"}); return {committed:true};', resultFormat: 'json' }, false);
    expect(message.result.content[0].text).toContain('Navigator advisory');
    await f.hostSessions.retireSession(f.a);
    await wire.transport.send(message);
    const sent = wire.sent.get(message.id).result;
    expect(sent.content[0].text).toBe(message.result.content[0].text.split('\n\nNavigator advisory')[0]);
    expect(JSON.parse(sent.content[0].text)).toEqual({ committed: true });
    expect(sent.structuredContent).toEqual(message.result.structuredContent);
    expect(f.queries.some(q => q.args.commitPreparationId)).toBe(false);
  });
  it('does not use an unassociated form even if a multi-session client advertises elicitation', async () => {
    const f = await fixture();
    fs.writeFileSync(f.configFile, JSON.stringify({ schemaVersion: 1, mcp: { enabled: false }, approvals: { read: 'allow', write: 'ask' } }), { mode: 0o600 });
    const result = await f.call(f.at, 'const s = await repo.settings(); return await repo.configure({config:s.config,scope:"session",expectedRevision:s.revision});');
    expect(result.isError).toBe(true); expect(result.content[0].text).toContain('unassociated_session');
    expect(result.content[0].text).not.toContain('has not advertised');
    expect(wire.elicited).toBe(0);
  });
});
