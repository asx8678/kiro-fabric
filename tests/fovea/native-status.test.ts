import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const wire = vi.hoisted(() => ({ handlers: new Map<unknown, (...args: any[]) => Promise<any>>() }));
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({ Server: class {
  setRequestHandler(schema: unknown, handler: (...args: any[]) => Promise<any>) { wire.handlers.set(schema, handler); }
  setNotificationHandler() {} getClientCapabilities() { return { elicitation: { form: {} } }; }
  async connect() {} async close() {}
} }));
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({ StdioServerTransport: class { async send() {} } }));
import { createKiroMcpServer } from '../../src/kiro/mcp-server.js';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); wire.handlers.clear(); });

describe('public native Fovea diagnostics', () => {
  it.each([false, true])('reports native automatic off independently of embedder-only post-tool capability=%s', async enabled => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fovea-native-status-'))); roots.push(base);
    const runtimeRoot = path.join(base, 'runtime'), dataRoot = path.join(base, 'data');
    fs.mkdirSync(runtimeRoot, { mode: 0o700 }); fs.mkdirSync(dataRoot, { mode: 0o700 });
    const server = await createKiroMcpServer({ runtimeRoot, dataRoot, version: 'test',
      ...(enabled ? { foveaPostToolContext: { authorizedAnalysis: true, qualifiedVisibleDelivery: true } } : {}),
      workspaceContext: { current: async () => ({ status: 'temporarily-unavailable', roots: [], revision: 1, observedAt: 0 }), invalidate() {}, subscribe: () => ({ dispose() {} }) } });
    try {
      const response = await wire.handlers.get(CallToolRequestSchema)!({ params: { name: 'fabric_info', arguments: {} } }, { signal: new AbortController().signal });
      expect(response.isError).not.toBe(true);
      const info = JSON.parse(response.content[0].text);
      expect(info.fovea).toEqual({ nativeHooks: { schemaVersion: 1, status: 'host-blocked', reason: 'native-session-rendezvous-unavailable', dispatched: false, automatic: false, modelContextDelivered: false }, postToolContext: enabled ? 'trusted-embedder-visible' : 'disabled', nativeSessionAssociation: 'unavailable', modelInputAcknowledged: false });
      expect(info.lifecycle.runtimeActive).toBe(false);
      expect(info.nativeKiroTools.modelInventoryVerified).toBe(false);
    } finally { await server.close(); }
  });
});
