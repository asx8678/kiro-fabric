import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { CASES, makeCase, HELP_CODE } from './cases.mjs';
import { putFiles, inventory, save } from './core.mjs';
import { analyzeEvents, collect } from './stream.mjs';
import { validate } from './oracles.mjs';

/** Synthetic ACP only qualifies local oracles; NEVER include it in measured run rows.
 * @param {string} answer @param {{tools?:boolean,help?:boolean,credits?:number,mode?:string}} [options] @returns {unknown[]} */
export function syntheticEvents(answer, options = {}) {
  /** @param {Record<string,unknown>} update */ const event = update => ({ type: 'sessionUpdate', data: { update } });
  const events = [event({ sessionUpdate: 'config_option_update', configOptions: [{ id: 'mode', currentValue: options.mode ?? 'steering-pass2' }, { id: 'model', currentValue: 'auto' }] })];
  if (options.tools) {
    events.push(event({ sessionUpdate: 'tool_call', toolCallId: 'call-1', title: 'fabric_exec', status: 'in_progress', rawInput: { code: options.help ? HELP_CODE : 'return "synthetic local oracle qualification";' }, _meta: { kiro: { serverName: 'fabric' } } }));
    events.push(event({ sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'completed', rawOutput: options.help ? JSON.parse(answer) : { fixture: 'synthetic' } }));
  }
  events.push(event({ sessionUpdate: 'usage_update', _meta: { kiro: { kind: 'turn_completion', requestIds: ['request-1'], promptTurnSummaries: [{ unit: 'credit', usage: options.credits ?? 0.1 }], elapsedTime: 1 } } }));
  return [...events, { type: 'runFinished', data: { status: 'success', sessionId: 'synthetic-session', finalText: answer } }];
}
/** @param {string} root @param {string} id @param {string} python @param {string} [seed] */
export async function solvedTrial(root, id, python, seed = 'oracle-seed') {
  const spec = makeCase(id, seed, python), workspace = path.join(root, id); fs.mkdirSync(workspace, { mode: 0o700 }); putFiles(workspace, spec.files);
  const before = inventory(workspace);
  /** @param {number} expected */
  async function execute(expected) { const r = await collect({ executable: python, args: ['-B', 'tools/test_fixture.py'], cwd: workspace, maxOutputBytes: 65536, timeoutMs: 10000 }); assert.equal(r.code, expected, r.stderr); assert.equal(r.stopReason, null); }
  if (id === 'parser') await execute(1);
  for (const [name, text] of Object.entries(spec.solution)) fs.writeFileSync(path.join(workspace, name), text, { mode: 0o600 });
  if (id === 'parser' || id === 'rename-api') await execute(0);
  if (id === 'exit7') await execute(7);
  const answer = id === 'explain' ? String(spec.expected) : id === 'fabric-help' ? JSON.stringify({ topic: 'overview', text: 'Immutable synthetic bundled overview for local oracle qualification.', truncated: false }) : JSON.stringify(spec.expected);
  const evidence = analyzeEvents(syntheticEvents(answer, { tools: !spec.noTools, help: id === 'fabric-help' }));
  return { spec, workspace, before, evidence, arm: 'pass2', expectedMode: 'steering-pass2', python, processOk: true };
}
/** @param {{output?:string,python:string}} options */
export async function selftest(options) {
  const root = options.output ? (fs.mkdirSync(options.output, { mode: 0o700 }), fs.realpathSync(options.output)) : fs.mkdtempSync(path.join(os.tmpdir(), 'steering-selftest-'));
  let positives = 0, negatives = 0;
  try {
    for (const id of CASES) {
      const trial = await solvedTrial(root, id, options.python);
      const good = await validate(trial); assert.ok(good.ok, JSON.stringify({ id, ...good })); positives++;
      const bad = await validate({ ...trial, evidence: { ...trial.evidence, finalText: '```json\n' + trial.evidence.finalText + '\n```' } }); assert.ok(!bad.ok, 'fence accepted: ' + id); negatives++;
      fs.writeFileSync(path.join(trial.workspace, '.unexpected'), 'scope violation'); assert.ok(!(await validate(trial)).ok, 'scope accepted'); negatives++;
    }
    const report = { oracleSelftest: 'PASS', positives, negatives, inferenceRequests: 0, syntheticEvidenceOnly: true };
    if (options.output) save(path.join(root, 'selftest.json'), report);
    return report;
  } finally { if (!options.output) fs.rmSync(root, { recursive: true, force: true }); }
}
