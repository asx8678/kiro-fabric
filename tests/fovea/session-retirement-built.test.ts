import { removeFixtureSync } from '../fixture-cleanup.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createInstalledParser, type InstalledParser } from './installed-parser.js';
import type { FoveaBoundClient } from '../../dist/index.js';
import type { WorkspaceContextProvider } from '../../src/kiro/power/workspace-context.js';

let parser: InstalledParser | undefined;
let dispose: (() => void) | undefined;
const nodePath = process.execPath;
let api: typeof import('../../dist/index.js');
beforeAll(async () => {
  const installed = createInstalledParser();
  parser = installed?.parser;
  dispose = installed?.dispose;
  api = await import('../../dist/index.js');
});
afterAll(() => dispose?.());
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
function fixture() {
  if (!parser) throw new Error('Build output and the pinned ast-grep platform package are required');
  expect(api.KiroHostSessionAdapter).toBeTypeOf('function');
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fovea-built-retirement-'))); fs.chmodSync(base, 0o700);
  cleanup.push(() => removeFixtureSync(base, { recursive: true, force: true }));
  const roots = ['one', 'two'].map(name => {
    const root = path.join(base, name); fs.mkdirSync(root, { mode: 0o700 });
    fs.writeFileSync(path.join(root, 'math.ts'), 'export function calculateTotal() { return 1; }\n', { mode: 0o600 });
    fs.writeFileSync(path.join(root, 'consumer.ts'), 'import { calculateTotal } from "./math.js";\nexport const total = calculateTotal();\n', { mode: 0o600 });
    return root;
  });
  const host = new api.FoveaHost({ dataRoot: base, configFile: path.join(base, 'fovea.json'), parser, entrypoint: path.resolve('dist/fovea/engine-entry.js') });
  const sessions = new api.KiroHostSessionAdapter();
  sessions.attach(owner => host.retireConversation(owner.conversationId, owner.conversationEpoch));
  cleanup.push(async () => { try { await sessions.close(); } finally { await host.close(); } });
  const workspaceContext: WorkspaceContextProvider = { current: async () => ({ status: 'explicitly-empty', roots: [], revision: 1, observedAt: 0 }), invalidate() {}, subscribe: () => ({ dispose() {} }) };
  const open = (id: string, epoch = 1) => sessions.openSession({ conversationId: id, conversationEpoch: epoch, workspaceContext });
  const bind = (id: string, epoch = 1, root = roots[0]!) => {
    const s = fs.statSync(root, { bigint: true });
    return host.bind({ canonicalPath: root, deviceId: String(s.dev), fileId: String(s.ino), conversationId: id, conversationEpoch: epoch, authorizationEpoch: 1 });
  };
  const call = (client: FoveaBoundClient, op: string, args: Record<string, unknown> = {}) => client.invoke(op, args, { cwd: roots[0]! });
  return { host, roots, sessions, open, bind, call };
}

// Real built engine, process supervisor, private IPC and admitted native parser.
// This is local component evidence, not native Kiro session or UI qualification.
describe.skipIf(!['darwin', 'linux'].includes(process.platform))('built selective conversation retirement', () => {
  it('forgets focus/results/settings/rule trust across roots while preserving another conversation', async () => {
    const f = fixture(), aOwner = f.open('a'); f.open('b');
    const a = f.bind('a'), b = f.bind('b'), roaming = f.bind('a', 1, f.roots[1]!);
    const rules = '{"rules":[]}';
    fs.mkdirSync(path.join(f.roots[0]!, '.fovea'), { mode: 0o700 });
    fs.writeFileSync(path.join(f.roots[0]!, '.fovea/rules.json'), rules, { mode: 0o600 });
    await f.call(a, 'adoptRules', { expectedSha256: createHash('sha256').update(rules).digest('hex') });
    const settings = await f.call(a, 'settings');
    const config = structuredClone(settings.config) as { tools: { defaultBudget: number } }; config.tools.defaultBudget = 2048;
    await f.call(a, 'configure', { config, scope: 'session', expectedRevision: settings.revision });
    const first = await f.call(a, 'focus', { query: 'calculateTotal' });
    expect(first.coverage).toMatchObject({ source: { projectRules: 'host-approved-hash' } });
    const foreign = await f.call(b, 'focus', { query: 'calculateTotal' });
    expect(foreign.coverage).toMatchObject({ source: { projectRules: 'untrusted-skipped' } });
    await expect(f.call(b, 'dwell', { focusId: first.focusId })).rejects.toThrow(/focusId/);
    await expect(f.call(b, 'result', { resultId: first.resultId })).rejects.toThrow(/foreign/);
    const secondRoot = await f.call(roaming, 'focus', { query: 'calculateTotal' });
    const before = await f.call(b, 'status');
    await a.close(); // Provider replacement is not retirement; cleanup must find closed roots too.
    const retiring = f.sessions.retireSession(aOwner);
    await expect(f.call(roaming, 'status')).rejects.toThrow(/revoked/);
    await retiring;
    f.open('a', 2);
    const fresh = f.bind('a', 2), freshRoot = f.bind('a', 2, f.roots[1]!);
    expect(await f.call(fresh, 'settings')).toMatchObject({ scope: 'defaults' });
    await expect(f.call(fresh, 'dwell', { focusId: first.focusId })).rejects.toThrow(/focusId/);
    await expect(f.call(freshRoot, 'dwell', { focusId: secondRoot.focusId })).rejects.toThrow(/focusId/);
    await expect(f.call(fresh, 'result', { resultId: first.resultId })).rejects.toThrow(/foreign|revoked/);
    expect(await f.call(b, 'dwell', { focusId: foreign.focusId })).toMatchObject({ focusId: foreign.focusId });
    const after = await f.call(b, 'status');
    expect(after.engineGeneration).toBe(before.engineGeneration); expect(after.engineStarts).toBe(before.engineStarts);
    expect((await f.call(fresh, 'focus', { query: 'calculateTotal' })).coverage).toMatchObject({ source: { projectRules: 'untrusted-skipped' } });
  }, 90_000);
  it('reclaims real engine conversation capacity for more than 128 retired owners without restarting', async () => {
    const f = fixture();
    for (let i = 0; i < 132; i++) {
      const id = `owner_${i}`, owner = f.open(id), client = f.bind(id);
      expect(await f.call(client, 'focus', { query: 'calculateTotal', maxTokens: 256 })).toMatchObject({ status: 'ok' });
      await client.close(); await f.sessions.retireSession(owner);
    }
    f.open('last');
    expect(await f.call(f.bind('last'), 'status')).toMatchObject({ engineStarts: 1 });
  }, 120_000);
  it('routes actual built stdio MCP calls and retires a session through a synthetic trusted bridge', async () => {
    expect(parser).toBeDefined();
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fovea-built-session-mcp-'))); fs.chmodSync(base, 0o700);
    cleanup.push(() => removeFixtureSync(base, { recursive: true, force: true }));
    const root = path.join(base, 'workspace'), dataRoot = path.join(base, 'data');
    fs.mkdirSync(root, { mode: 0o700 }); fs.mkdirSync(dataRoot, { mode: 0o700 });
    fs.writeFileSync(path.join(root, 'math.ts'), 'export function calculateTotal() { return 1; }\n', { mode: 0o600 });
    const configDir = path.join(dataRoot, 'fabric/config'); fs.mkdirSync(configDir, { recursive: true, mode: 0o700 }); fs.chmodSync(path.dirname(configDir), 0o700);
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ schemaVersion: 1, mcp: { enabled: false }, approvals: { read: 'allow', write: 'allow' } }), { mode: 0o600 });
    const driver = path.join(base, 'driver.mjs');
    // Fixed test-owned request IDs, not guest arguments or inferred native metadata.
    // SIGUSR1 is ONLY this disposable fixture's parent-controlled lifecycle input.
    fs.writeFileSync(driver, `import { createKiroMcpServer, KiroHostSessionAdapter } from ${JSON.stringify(pathToFileURL(path.resolve('dist/index.js')).href)};
const adapter = new KiroHostSessionAdapter();
const workspaceContext = { current: async () => ({status:'verified', roots:[{uri:${JSON.stringify(pathToFileURL(root).href)}}],revision:1,observedAt:0}),invalidate(){},subscribe(){return {dispose(){}};} };
const a = adapter.openSession({conversationId:'a',conversationEpoch:1,workspaceContext});
const b = adapter.openSession({conversationId:'b',conversationEpoch:1,workspaceContext});
const at = adapter.beginTurn(a), bt = adapter.beginTurn(b);
for (const [id, turn] of [[1,at],[2,bt],[3,at],[4,bt]]) adapter.associateRequest(id,turn);
const server = await createKiroMcpServer({...${JSON.stringify({ dataRoot, runtimeRoot: path.resolve('dist'), version: 'test', managedParser: parser })},hostSessions:adapter});
process.once('SIGUSR1', () => { void (async () => {
  await adapter.retireSession(a);
  const fresh = adapter.openSession({conversationId:'a',conversationEpoch:2,workspaceContext});
  const turn = adapter.beginTurn(fresh);
  for (const id of [5,6,8,9]) adapter.associateRequest(id,turn);
  adapter.associateRequest(7,bt);
  process.stderr.write('FIXTURE_RETIRED\\n');
})().catch(() => { process.stderr.write('FIXTURE_RETIRE_FAILED\\n'); }); });
process.stdin.once('end', () => { void server.close().then(() => process.exit(0)); });
`, { mode: 0o600 });
    const client = new Client({ name: 'synthetic-session-bridge', version: '1' });
    const transport = new StdioClientTransport({ command: nodePath, args: [driver], cwd: root, env: { HOME: base, PATH: process.env.PATH ?? '/usr/bin:/bin' }, stderr: 'pipe' });
    let stderr = '';
    try {
      await client.connect(transport);
      transport.stderr?.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-8000); });
      const call = async (code: string, success = true) => {
        const response = await client.callTool({ name: 'fabric_exec', arguments: { code, resultFormat: 'json' } }, undefined, { timeout: 60_000 });
        expect(response.isError === true, JSON.stringify(response) + stderr).toBe(!success);
        const text = (response.content as Array<{ text: string }>)[0]!.text;
        return success ? JSON.parse(text) : text;
      };
      expect(await call('const s=await repo.settings(); s.config.tools.defaultBudget=2048; return await repo.configure({config:s.config,scope:"session",expectedRevision:s.revision});')).toMatchObject({ scope: 'session' });
      expect(await call('return await repo.settings();')).toMatchObject({ scope: 'defaults' });
      const previous = await call('return await repo.focus({query:"calculateTotal"});');
      expect(await call(`return await repo.result({resultId:${JSON.stringify(previous.resultId)}});`, false)).toContain('foreign');
      expect(transport.pid).not.toBeNull();
      process.kill(transport.pid!, 'SIGUSR1');
      await expect.poll(() => stderr, { timeout: 10_000 }).toContain('FIXTURE_RETIRED');
      expect(await call(`return await repo.dwell({focusId:${JSON.stringify(previous.focusId)}});`, false)).toContain('focusId');
      expect(await call(`return await repo.result({resultId:${JSON.stringify(previous.resultId)}});`, false)).toContain('foreign');
      expect(await call('return await repo.focus({query:"calculateTotal"});')).toMatchObject({ status: 'ok' });
      expect(await call('return await repo.settings();')).toMatchObject({ scope: 'defaults' });
      const info = await call('return await fabric.info();');
      expect(info.fovea.sessionIsolation).toMatchObject({ supported: true, stateOwner: 'host-session-epoch', nativeClearResetGuaranteed: false });
      expect(info.fovea.automaticQualification.ready).toBe(false);
    } finally { await client.close(); }
  }, 90_000);
});
