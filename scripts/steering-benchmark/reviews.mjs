import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha, canonical, object, putFiles } from './core.mjs';
import { collect } from './stream.mjs';

export const REVIEW_CASES = ['review-infra'];
export const REVIEW_KINDS = ['environment-key-mismatch', 'cron-frequency', 'unused-alerts', 'validation-exit', 'expired-exemption', 'rollout-outage', 'same-release', 'disabled-cleanup'];
/** @typedef {{path:string,line:number,text:string}} ReviewEvidence */
/** @typedef {{kind:string,evidence:ReviewEvidence[]}} Finding */
/** @typedef {{expected:number,reported:number,truePositives:number,falsePositives:number,duplicates:number,missed:string[],precision:number|null,recall:number}} ReviewScore */
/** @param {Record<string,string>} files @param {string} file @param {string} text @returns {ReviewEvidence} */
function evidence(files, file, text) {
  const lines = files[file].split('\n'), matches = lines.flatMap((line, i) => line === text ? [i + 1] : []);
  assert.equal(matches.length, 1, 'unique fixture evidence');
  return { path: file, line: matches[0], text };
}
/** Synthetic infrastructure, no service calls, credentials or package dependencies.
 * The controller keeps the oracle; only files and the neutral task prompt reach either agent.
 * @param {string} id @param {string} seed @returns {import('./cases.mjs').Case} */
export function makeReviewCase(id, seed) {
  assert.ok(REVIEW_CASES.includes(id), 'unknown review case');
  const token = sha(seed).slice(0, 8), hour = 9 + parseInt(token.slice(0, 2), 16) % 8;
  const envFile = `config/environments/production-${token}.json`;
  const pipeline = `.azure-pipelines/maintenance-${token}.json`;
  const script = `scripts/cleanup-${token}.mjs`;
  const validator = `scripts/validate-${token}.mjs`;
  const exemptions = `config/exemptions-${token}.json`;
  const prefix = '// fixture module\n'.repeat(1 + parseInt(token.slice(2, 4), 16) % 9);
  /** @type {Record<string,string>} */ const files = {
    'README.md': `# Notification service deployment\n\nReview date: 2030-06-15.\nThe active maintenance pipeline is ${pipeline}; it pairs environment names with key labels via ${script}. Labels are synthetic, not credentials.\nscripts/render.mjs consumes ${envFile} and must emit both CronJob and PrometheusRule resources when alerts are enabled.\nNotifications must run once at ${hour}:00 Monday through Friday.\nValidation runs node ${validator} with JSON text as its only argument; malformed JSON must exit nonzero.\nThe exemptions in ${exemptions} are invalid when expires is before the review date.\nStaging and production intentionally promote the same immutable release. The single replica uses maxUnavailable:0/maxSurge:1, has a working readiness probe and enough capacity for the surge; this alone does not prove rollout downtime.\nThe legacy cleanup job is intentionally disabled after migration; it is not the active maintenance pipeline.\nIgnored vendor examples are not deployed. No external dependencies or network access are needed.\n`,
    '.ignore': 'vendor/\n',
    [pipeline]: JSON.stringify({ script, environments: ['staging', 'production'], apiKeys: ['development-label', 'staging-label', 'production-label'] }, null, 2) + '\n',
    [script]: prefix + 'export function credentialsFor(config) {\n  return config.environments.map((env, index) => ({env, key: config.apiKeys[index]}));\n}\n',
    [envFile]: JSON.stringify({ schedule: `* ${hour} * * 0-4`, image: 'release-2030.06.1', replicas: 1, rollingUpdate: { maxUnavailable: 0, maxSurge: 1 }, alerts: { enabled: true, name: `NotificationsFailed_${token}` } }, null, 2) + '\n',
    'config/environments/staging.json': JSON.stringify({ image: 'release-2030.06.1' }, null, 2) + '\n',
    'scripts/render.mjs': prefix + 'export function render(config) {\n  return [{kind: "CronJob", schedule: config.schedule, image: config.image}];\n}\n',
    [validator]: prefix + 'try {\n  JSON.parse(process.argv[2]);\n  console.log(true);\n} catch {\n  console.log(false);\n}\n',
    'scripts/validate-strict.mjs': 'try { JSON.parse(process.argv[2]); } catch { process.exitCode = 1; }\n',
    '.azure-pipelines/legacy.json': '{"enabled":false,"reason":"intentionally replaced by active maintenance"}\n',
    'vendor/decoy.json': '{"schedule":"* * * * *","deployed":false}\n',
  };
  const entries = Array.from({ length: 80 }, (_, i) => ({ id: `EX-${token}-${i}`, owner: `team-${i % 4}`, expires: i === 73 ? '2029-01-01' : '2099-01-01' }));
  files[exemptions] = JSON.stringify(entries, null, 2) + '\n';
  const at = (file, line) => evidence(files, file, line);
  /** @type {Finding[]} */ const findings = [
    { kind: 'environment-key-mismatch', evidence: [at(pipeline, '    "development-label",'), at(script, '  return config.environments.map((env, index) => ({env, key: config.apiKeys[index]}));')] },
    { kind: 'cron-frequency', evidence: [at(envFile, `  "schedule": "* ${hour} * * 0-4",`)] },
    { kind: 'unused-alerts', evidence: [at(envFile, '    "enabled": true,'), at('scripts/render.mjs', '  return [{kind: "CronJob", schedule: config.schedule, image: config.image}];')] },
    { kind: 'validation-exit', evidence: [at(validator, '  console.log(false);')] },
    { kind: 'expired-exemption', evidence: [at(exemptions, '    "expires": "2029-01-01"')] },
  ];
  return { id, seed, files, sources: [], allowed: [], solution: {}, noTools: false, json: true, qualification: false,
    expected: { findings },
    prompt: 'Review this deployment/config project and report concrete defects, not speculative improvements. Work only inside this disposable workspace. Change no files; no network, dependency installation, persistent memory or delegation. Follow README.md contracts and its fixed review date. Return only raw JSON {"findings":[{"kind":string,"evidence":[{"path":relative_path,"line":one_based_integer,"text":exact_source_line}]}]}. Use the most specific kind from ' + JSON.stringify(REVIEW_KINDS) + '. Include relevant caller/consumer evidence for cross-file defects, preserve exact source-line whitespace, deduplicate findings, and do not assume every kind applies. No fixes or extra prose.' };
}
/** Grounded fixture findings, not a semantic judge for arbitrary real-world reviews.
 * Partial recall and false positives survive strict pass/fail reporting. Never count duplicates twice.
 * @param {import('./cases.mjs').Case} spec @param {unknown} answer @returns {ReviewScore} */
export function scoreReview(spec, answer) {
  const value = object(answer);
  assert.deepEqual(Object.keys(value), ['findings'], 'review answer schema');
  assert.ok(Array.isArray(value.findings) && value.findings.length <= 100, 'bounded findings array');
  const expected = /** @type {{findings:Finding[]}} */ (spec.expected).findings;
  const matched = new Set(); let falsePositives = 0, duplicates = 0;
  for (const raw of value.findings) {
    const finding = object(raw);
    assert.deepEqual(Object.keys(finding).sort(), ['evidence', 'kind'], 'finding schema');
    assert.ok(typeof finding.kind === 'string' && Array.isArray(finding.evidence) && finding.evidence.length > 0 && finding.evidence.length <= 32, 'finding evidence schema');
    const observed = finding.evidence.map(rawEvidence => {
      const row = object(rawEvidence);
      assert.deepEqual(Object.keys(row).sort(), ['line', 'path', 'text'], 'source evidence schema');
      assert.ok(typeof row.path === 'string' && typeof row.text === 'string' && Number.isSafeInteger(row.line) && Number(row.line) >= 1, 'source evidence types');
      return /** @type {ReviewEvidence} */ (row);
    });
    const grounded = observed.every(e => Object.hasOwn(spec.files, e.path) && spec.files[e.path].split('\n')[e.line - 1] === e.text);
    const expectedFinding = expected.find(e => e.kind === finding.kind);
    if (!grounded || !expectedFinding || !expectedFinding.evidence.every(required => observed.some(e => canonical(e) === canonical(required)))) { falsePositives++; continue; }
    if (matched.has(finding.kind)) { duplicates++; continue; }
    matched.add(finding.kind);
  }
  return { expected: expected.length, reported: value.findings.length, truePositives: matched.size, falsePositives, duplicates,
    missed: expected.filter(e => !matched.has(e.kind)).map(e => e.kind), precision: value.findings.length ? matched.size / value.findings.length : null, recall: matched.size / expected.length };
}
/** Independently qualify seeded defect semantics with actual Node execution, not agent claims.
 * @param {import('./cases.mjs').Case} spec */
export async function probeReviewFixture(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-fixture-probe-'));
  try {
    putFiles(root, spec.files);
    const pipelinePath = Object.keys(spec.files).find(p => p.startsWith('.azure-pipelines/maintenance-'));
    const configPath = Object.keys(spec.files).find(p => p.startsWith('config/environments/production-'));
    const validator = Object.keys(spec.files).find(p => p.startsWith('scripts/validate-') && p !== 'scripts/validate-strict.mjs');
    assert.ok(pipelinePath && configPath && validator, 'fixture entrypoints');
    const pipeline = JSON.parse(spec.files[pipelinePath]);
    const program = `import assert from "node:assert/strict"; import fs from "node:fs";
import {credentialsFor} from ${JSON.stringify('./' + pipeline.script)};
import {render} from "./scripts/render.mjs";
const pipeline = JSON.parse(fs.readFileSync(${JSON.stringify(pipelinePath)}, "utf8"));
const config = JSON.parse(fs.readFileSync(${JSON.stringify(configPath)}, "utf8"));
assert.deepEqual(credentialsFor(pipeline).map(x => x.key), ["development-label", "staging-label"]);
assert.equal(config.alerts.enabled, true); assert.equal(render(config).some(x => x.kind === "PrometheusRule"), false);
const [minute,, , , weekdays] = config.schedule.split(" "); assert.equal(minute, "*"); assert.equal(weekdays,"0-4");`;
    const consumer = await collect({ executable: process.execPath, args: ['--input-type=module', '-e', program], cwd: root, maxOutputBytes: 65536, timeoutMs: 10000 });
    assert.ok(consumer.code === 0 && !consumer.stopReason && !consumer.spawnError, consumer.stderr);
    for (const [file, expectedExit] of [[validator, 0], ['scripts/validate-strict.mjs', 1]]) {
      const result = await collect({ executable: process.execPath, args: [String(file), '{invalid'], cwd: root, maxOutputBytes: 65536, timeoutMs: 10000 });
      assert.equal(result.code, expectedExit, 'validator exit semantics'); assert.ok(!result.stopReason && !result.spawnError);
    }
    const exemptionPath = Object.keys(spec.files).find(p => p.startsWith('config/exemptions-'));
    assert.ok(exemptionPath);
    const rows = JSON.parse(spec.files[exemptionPath]);
    assert.equal(rows.filter(row => row.expires < '2030-06-15').length, 1);
    const expected = /** @type {{findings:Finding[]}} */ (spec.expected);
    assert.ok(expected.findings.find(f => f.kind === 'expired-exemption').evidence[0].line > 200, 'tail defect must require coverage beyond initial page');
    assert.equal(scoreReview(spec, spec.expected).truePositives, 5);
    return { ok: true, defects: 5, falsePositiveControls: 3 };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
