import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKiroRuntime, DEFAULT_FABRIC_CONFIG, normalizeFabricConfig } from '../../../dist/index.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-built-followup-'));
const config = normalizeFabricConfig({ executor: { timeoutMs: 5000, maxConcurrentExecutions: 2 }, mcp: { enabled: false }, memory: { enabled: false } });
assert.equal(DEFAULT_FABRIC_CONFIG.executor.maxConcurrentExecutions, 4);
assert.equal(config.executor.maxConcurrentExecutions, 2);
const owners = [];
const runtime = (label) => {
  const owner = createKiroRuntime({ cwd: root, configFile: path.join(root, 'unused.json'), mcpConfigPath: path.join(root, 'unused-mcp.json'), artifactsRoot: path.join(root, label), stateRoot: path.join(root, 'state'), config });
  owners.push(owner); return owner;
};
const execute = (owner, code) => owner.service.execute({ code, approver: { async approve() {} } });
try {
  const a = runtime('a'); const b = runtime('b');
  assert.equal((await execute(b, 'return 42')).value, 42);
  const pending = execute(b, "await state.set({ key: 'fixture', value: 'persisted', expectedRevision: 0 }); return await state.get({ key: 'fixture' });");
  await Promise.resolve(); await a.close();
  const result = await pending;
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.value.value, 'persisted'); assert.equal(result.value.revision, 1);
  await b.close();
  const c = runtime('c');
  const restored = await execute(c, "return await state.get({ key: 'fixture' });");
  assert.equal(restored.success, true); assert.equal(restored.value.value, 'persisted');
  const next = await execute(c, "return await state.set({ key: 'fixture', value: 'extended', expectedRevision: 1 });");
  assert.equal(next.value.revision, 2);
  console.log(JSON.stringify({ status: 'passed', imports: 'dist/index.js', checks: ['public admission config', 'real warm compiler survives unrelated close', 'checked guest state write', 'runtime reopen persistence', 'revision-checked extension'] }));
} finally {
  await Promise.all(owners.map((owner) => owner.close()));
  fs.rmSync(root, { recursive: true, force: true });
}
