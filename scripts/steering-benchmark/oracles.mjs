import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { AUDIT, HELP_CODE } from './cases.mjs';
import { object, sha, canonical, inventory, checkScope, regularText, putFiles, errorText } from './core.mjs';
import { collect } from './stream.mjs';
import { BUG_CASES, probeProject } from './projects.mjs';
import { REVIEW_CASES, scoreReview } from './reviews.mjs';
import { REVIEW_REGRESSION_CASES, scoreReviewRegressions } from './review-regressions.mjs';
import { TASK_BEHAVIOR_CASES, scoreTaskBehavior } from './task-behavior.mjs';

/** @typedef {import('./cases.mjs').Case} Case */
/** @typedef {import('./stream.mjs').Evidence} Evidence */
/** @param {Case} s @param {Record<string,string>} files */
function sourceHashes(s, files) { return Object.fromEntries(s.sources.map(p => [p, sha(files[p])])); }
/** @param {Case} s */
function immutableHashes(s) { return Object.fromEntries(Object.entries(s.files).filter(([p]) => !s.allowed.includes(p)).map(([p, text]) => [p, sha(text)])); }
/** @param {Case} s @param {string} text @param {Record<string,string>} finalSources */
export function validateAudit(s, text, finalSources) {
  assert.ok(text.endsWith('\n'), 'missing/incomplete execution audit');
  const rows = text.trimEnd().split('\n').map(line => object(JSON.parse(line)));
  const beforeAfter = s.id === 'parser' || BUG_CASES.includes(s.id);
  assert.equal(rows.length, beforeAfter ? 2 : 1, 'missing/duplicate execution records');
  const initial = sourceHashes(s, s.files), final = sourceHashes(s, finalSources), fixtures = immutableHashes(s);
  for (const [i, row] of rows.entries()) {
    assert.deepEqual(Object.keys(row).sort(), ['exit', 'fixtures', 'kind', 'post', 'pre', 'seq'], 'audit schema');
    assert.equal(row.seq, i, 'execution order'); assert.equal(row.kind, s.id, 'execution kind');
    assert.deepEqual(row.fixtures, fixtures, 'immutable controller fixture hashes');
    const expected = beforeAfter && i === 0 ? initial : final;
    assert.deepEqual(row.pre, expected, 'execution pre-source hashes'); assert.deepEqual(row.post, expected, 'execution post-source hashes');
    assert.equal(row.exit, s.id === 'exit7' ? 7 : beforeAfter && i === 0 ? 1 : 0, 'execution exit');
  }
  if (beforeAfter) assert.notEqual(canonical(initial), canonical(final), 'repair unchanged');
  return rows;
}
/** Find structured tool output, never strip fences or infer execution from a command substring.
 * @param {unknown} value @param {unknown} expected @param {number} [depth] @returns {boolean} */
function containsStructured(value, expected, depth = 0) {
  if (depth > 12 || value === undefined) return false;
  if (canonical(value) === canonical(expected)) return true;
  if (typeof value === 'string') { try { return containsStructured(JSON.parse(value), expected, depth + 1); } catch { return false; } }
  if (Array.isArray(value)) return value.some(v => containsStructured(v, expected, depth + 1));
  if (value && typeof value === 'object') return Object.values(object(value)).some(v => containsStructured(v, expected, depth + 1));
  return false;
}
/** @param {Case} s @param {string} text @param {Evidence} evidence */
export function validateAnswer(s, text, evidence) {
  if (!s.json) {
    assert.equal(text, s.expected, "exact requested sentence");
    return undefined;
  }
  const answer = JSON.parse(text); // Raw JSON only: no Markdown repair or fence stripping.
  if (TASK_BEHAVIOR_CASES.includes(s.id)) return scoreTaskBehavior(s, answer);
  if (REVIEW_REGRESSION_CASES.includes(s.id)) return scoreReviewRegressions(s, answer);
  if (REVIEW_CASES.includes(s.id)) return scoreReview(s, answer);
  if (s.id !== 'fabric-help') assert.deepEqual(answer, s.expected, 'exact answer/schema');
  else {
    const help = object(answer); assert.deepEqual(Object.keys(help).sort(), help.truncated === true ? ['nextOffset', 'text', 'topic', 'truncated'] : ['text', 'topic', 'truncated'], 'help schema');
    assert.equal(help.topic, 'overview'); assert.ok(typeof help.text === 'string' && help.text.length > 20, 'empty help'); assert.equal(typeof help.truncated, 'boolean');
    if (help.truncated) assert.equal(help.nextOffset, String(help.text).length, 'help page offset');
    const calls = evidence.calls.filter(c => !c.system); assert.equal(calls.length, 1, 'exactly one help execution');
    const call = calls[0]; assert.equal(call.status, 'completed', 'help failed');
    assert.equal(object(call.input).code, HELP_CODE, 'only immutable help program allowed');
    assert.ok(containsStructured(call.output, answer), 'help result not observed');
  }
  return undefined;
}
/** Independently re-run immutable tests in a disposable copy, never append controller runs to agent audit.
 * These tests execute candidate-controlled Python, not a security sandbox.
 * @param {Case} s @param {Record<string,string>} sources @param {string} python */
async function probePython(s, sources, python) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steering-probe-'));
  try {
    putFiles(root, { ...s.files, ...sources, [AUDIT]: '' });
    const result = await collect({ executable: python, args: ['-B', 'tools/test_fixture.py'], cwd: root, maxOutputBytes: 65536, timeoutMs: 10000 });
    assert.ok(!result.stopReason && !result.spawnError && result.code === 0, 'independent Python contract: ' + result.stderr);
    if (s.id === 'parser') {
      const heldOut = 'from durations import parse_duration\nfor text, expected in [("100s",100000),("999999h",3599996400000),("\\t7m\\n",420000),("0000MS",0)]:\n    assert parse_duration(text) == expected, text\nfor text in [b"1s",1.0,"1e2s","--1s","2\\ns","0x10ms"]:\n    try: parse_duration(text)\n    except ValueError: pass\n    else: raise AssertionError(repr(text))\n';
      const hidden = await collect({ executable: python, args: ['-B', '-c', heldOut], cwd: root, maxOutputBytes: 65536, timeoutMs: 10000 });
      assert.ok(!hidden.stopReason && !hidden.spawnError && hidden.code === 0, 'held-out Python contract: ' + hidden.stderr);
    }
    // Probe itself must not modify test scripts or unrelated files.
    const initial = fs.mkdtempSync(path.join(os.tmpdir(), 'steering-reference-'));
    try { putFiles(initial, { ...s.files, ...sources }); checkScope(inventory(initial), inventory(root), [AUDIT]); } finally { fs.rmSync(initial, { recursive: true, force: true }); }
    return { exit: result.code, stdout: result.stdout, stderr: result.stderr };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
/** @typedef {{ok:boolean,failures:{check:string,error:string}[],audit:Record<string,unknown>[]|null,probe:unknown,afterDigest:string|null,review?:import('./reviews.mjs').ReviewScore|null}} Validation */
/** @param {{spec:Case,workspace:string,before:Record<string,import('./core.mjs').Entry>,evidence:Evidence,arm:string,expectedMode:string,expectedModel?:string,expectedEffort?:string,python:string,processOk:boolean,probe?:typeof probePython}} options @returns {Promise<Validation>} */
export async function validate(options) {
  const { spec: s, workspace, before, evidence, arm } = options;
  /** @type {Validation} */ const result = { ok: false, failures: [], audit: null, probe: null, afterDigest: null };
  /** @param {string} name @param {()=>unknown} fn */
  function check(name, fn) { try { fn(); } catch (error) { result.failures.push({ check: name, error: errorText(error) }); } }
  check('events-and-usage', () => { assert.deepEqual(evidence.failures, []); assert.ok(evidence.credits !== null && Number.isFinite(evidence.credits), 'missing usage'); assert.ok(options.processOk, 'client process incomplete'); });
  check('identity', () => { assert.equal(evidence.model, options.expectedModel ?? 'auto', 'requested model mismatch'); assert.equal(evidence.mode, options.expectedMode, 'arm mode mismatch'); if (options.expectedEffort !== undefined) assert.equal(evidence.effort, options.expectedEffort, 'requested effort missing or mismatched'); });
  const calls = evidence.calls.filter(c => !c.system);
  check('calls', () => {
    if (s.noTools) assert.equal(calls.length, 0, 'tools forbidden');
    else assert.ok(calls.some(c => c.status === 'completed' || s.id === 'exit7' && c.status === 'failed'), 'required execution missing');
    if (arm !== 'native') assert.ok(calls.every(c => c.origin === 'fabric' && /fabric_exec/.test(c.title)), 'non-Fabric routing');
    assert.ok(!s.qualification || arm !== 'native', 'native help must be excluded from schedule');
  });
  check('answer', () => {
    const score = validateAnswer(s, evidence.finalText, evidence);
    if (score) {
      if (TASK_BEHAVIOR_CASES.includes(s.id)) {
        // Same finite score contract, different units. Never pool task obligations
        // (including task-review-nofix) into infrastructure-review metrics.
        assert.ok(score.truePositives === score.expected && score.falsePositives === 0 && score.duplicates === 0, 'controlled task outcomes');
        return;
      }
      result.review = score;
      if (REVIEW_REGRESSION_CASES.includes(s.id)) {
        const regression = /** @type {import('./review-regressions.mjs').RegressionDiagnostics} */ (score['regressions']);
        assert.ok(regression.violations === 0 && regression.scenarioCoverage === 1, 'controlled review regression scenarios');
      }
      assert.ok(score.truePositives === score.expected && score.falsePositives === 0 && score.duplicates === 0, 'review recall/precision');
      assert.ok(!score.quality || score.quality.violations === 0, 'controlled review claim adherence');
      assert.ok(!score.calibration || (score.calibration.violations === 0 && score.calibration.validatedRecall === 1), 'controlled review severity/calibration');
    }
  });
  check('scope', () => { const after = inventory(workspace); checkScope(before, after, s.allowed); result.afterDigest = sha(canonical(after)); });
  /** @type {Record<string,string>} */ const sources = {};
  check('filesystem-data', () => {
    for (const name of s.sources) sources[name] = regularText(path.join(workspace, name));
    for (const [name, expected] of Object.entries(s.solution)) {
      if (s.id === 'parser' || BUG_CASES.includes(s.id)) continue; // Behavior, not implementation text.
      const actual = regularText(path.join(workspace, name));
      if (s.id === 'invoice') assert.deepEqual(JSON.parse(actual), JSON.parse(expected), 'invoice data');
      else assert.equal(actual, expected, 'saved file bytes: ' + name);
    }
    if (s.id === 'rename-api') for (const text of Object.values(sources)) { assert.doesNotMatch(text, /\bload_config\b/); }
  });
  if (s.allowed.includes(AUDIT)) check('execution-audit', () => {
    const text = regularText(path.join(workspace, AUDIT));
    result.audit = text.trim() ? text.trimEnd().split('\n').map(line => object(JSON.parse(line))) : [];
    validateAudit(s, text, sources);
  });
  if (s.id === 'parser' || s.id === 'rename-api' || BUG_CASES.includes(s.id)) {
    if (!options.processOk || result.failures.some(f => f.check === 'scope' || f.check === 'filesystem-data')) result.failures.push({ check: 'independent-tests', error: 'probe skipped: incomplete process or unsafe/missing fixture files' });
    else {
      try { result.probe = BUG_CASES.includes(s.id) ? await probeProject(s, sources) : await (options.probe ?? probePython)(s, sources, options.python); }
      catch (error) { result.failures.push({ check: 'independent-tests', error: errorText(error) }); }
    }
  }
  result.ok = result.failures.length === 0; return result;
}
