// Harmless protocol fixture. This is NOT the real Fabric executor.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const root = process.argv[2], instance = randomUUID();
const record = row => fs.appendFileSync(path.join(root, 'mcp.jsonl'), JSON.stringify({ at: Date.now(), instance, ...row }) + '\n', { mode: 0o600 });
record({ kind: 'start', environmentKeys: Object.keys(process.env).sort() });
const server = new Server({ name: 'fovea-lifecycle-fixture', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'fabric_exec', description: 'Harmless fixed-marker lifecycle fixture. Does not execute code.', inputSchema: { type: 'object', properties: { marker: { type: 'string', maxLength: 96 } }, required: ['marker'], additionalProperties: false } }] }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  const marker = request.params.arguments?.marker;
  if (typeof marker !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(marker)) throw new Error('invalid fixture marker');
  record({ kind: 'call', marker, parameterKeys: Object.keys(request.params), meta: request.params._meta ?? null });
  return { content: [{ type: 'text', text: 'LIFECYCLE_RESULT_' + marker }] };
});
const transport = new StdioServerTransport(), start = transport.start.bind(transport);
transport.start = async () => { const receive = transport.onmessage; transport.onmessage = (message, extra) => { if (message.method === 'initialize') record({ kind: 'initialize', params: message.params }); receive?.(message, extra); }; await start(); };
await server.connect(transport);
process.stdin.once('end', () => { void server.close().then(() => process.exit(0)); });
