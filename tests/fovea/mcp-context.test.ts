import { removeFixtureSync } from "../fixture-cleanup.mjs";
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';
import { pinnedParser } from "./installed-parser.js";

const parser = pinnedParser();
// Component MCP stdio proof, NOT native Kiro lifecycle qualification. The
// capability below is supplied only by this synthetic trusted test embedder.
describe.skipIf(process.platform !== 'linux')('built MCP context collection', () => {
  it.each([false, true])('collects independently of discarded guest data only with trusted capability=%s', async enabled => {
    expect(fs.existsSync(parser.path), 'Stage the complete bundle/private parser before built tests').toBe(true);
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fovea-context-mcp-')));
    fs.chmodSync(base, 0o700);
    const data = path.join(base, 'data'), root = path.join(base, 'workspace');
    fs.mkdirSync(data, { mode: 0o700 }); fs.mkdirSync(root, { mode: 0o700 });
    const source = path.join(root, 'math.ts'); fs.writeFileSync(source, 'export function calculateTotal() { return 1; }\n');
    const driver = path.join(base, 'driver.mjs');
    fs.writeFileSync(driver, `import { createKiroMcpServer } from ${JSON.stringify(pathToFileURL(path.resolve('dist/index.js')).href)};
const server = await createKiroMcpServer(${JSON.stringify({ runtimeRoot: path.resolve('dist'), dataRoot: data, version: 'test', launchWorkspaceRoot: root, managedParser: parser, ...(enabled ? { foveaPostToolContext: { authorizedAnalysis: true, qualifiedVisibleDelivery: true } } : {}) })});
process.stdin.once('end', () => { void server.close().then(() => process.exit(0)); });
`);
    const client = new Client({ name: 'component-context-test', version: '1' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [driver], cwd: root, env: { HOME: base, PATH: process.env.PATH ?? '/usr/bin:/bin' }, stderr: 'pipe' });
    let errors = '';
    try {
      await client.connect(transport);
      transport.stderr?.on('data', bytes => { errors = (errors + bytes.toString()).slice(-4000); });
      const call = async (code: string): Promise<string> => {
        const result = await client.callTool({ name: 'fabric_exec', arguments: { code } });
        expect(result.isError, JSON.stringify(result) + errors).not.toBe(true);
        const content = result.content as Array<{ type: string; text: string }>;
        expect(content[0]!.text.length).toBeLessThanOrEqual(50_000);
        return content[0]!.text;
      };
      // Successful local access, not cwd alone, enrolls attention. Discarding
      // the local result does not suppress host-owned observations/delivery.
      expect(await call('await local.read({path:"math.ts"}); return null;')).toBe('null');
      fs.unlinkSync(source);
      const output = await call('return {taskValue:"unchanged"};');
      expect(output.startsWith('{"taskValue":"unchanged"}')).toBe(true);
      if (enabled) {
        expect(output).toContain('Navigator advisory (untrusted');
        expect(output).toContain('math.ts');
      } else expect(output).toBe('{"taskValue":"unchanged"}');
      const status = JSON.parse(await call('return await repo.status();'));
      expect(status.engineStarts).toBe(enabled ? 1 : 0);
      expect(status.notices).toMatchObject({ emitted: enabled ? 1 : 0, acknowledged: 0 });
      // Same pending semantic delta must not be emitted on every tool call.
      expect(await call('return "next";')).toBe('"next"');
    } finally { await client.close(); removeFixtureSync(base, { recursive: true, force: true }); }
  }, 60_000);
});
