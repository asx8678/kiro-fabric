// Development-only protocol recorder. This is NOT Fabric execution or a delivery adapter.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const root = process.argv[2];
const instance = randomUUID();
const record = row => fs.appendFileSync(path.join(root, 'mcp.jsonl'), JSON.stringify({ instance, ...row }) + '\n', { mode: 0o600 });
record({ kind: 'start', environmentKeys: Object.keys(process.env).sort() });
const server = new Server({ name: 'fovea-native-protocol-probe', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'fabric_exec', description: 'Harmless native protocol probe. Returns a fixed marker. Does not execute code or access workspace files.', inputSchema: { type: 'object', properties: { marker: { type: 'string', enum: ['success', 'error', 'continuation'] } }, required: ['marker'], additionalProperties: false } }] }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  const value = request.params.arguments?.marker;
  const marker = ['success', 'error', 'continuation'].includes(value) ? value : 'invalid';
  record({ kind: 'call', parameterKeys: Object.keys(request.params), meta: request.params._meta ?? null, marker });
  return { content: [{ type: 'text', text: marker === 'error' ? 'FOVEA_PROBE_EXPECTED_ERROR' : 'FOVEA_PROBE_RESULT_' + marker }], ...(marker === 'error' ? { isError: true } : {}) };
});
const transport = new StdioServerTransport();
const start = transport.start.bind(transport);
transport.start = async () => { const receive = transport.onmessage; transport.onmessage = (message, extra) => { if (message.method === 'initialize') record({ kind: 'initialize', params: message.params }); receive?.(message, extra); }; await start(); };
await server.connect(transport);
process.stdin.once('end', () => { void server.close().then(() => process.exit(0)); });
