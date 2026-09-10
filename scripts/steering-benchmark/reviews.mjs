import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha, canonical, object, putFiles } from './core.mjs';
import { collect } from './stream.mjs';

export const REVIEW_CASES = ['review-infra', 'review-contracts', 'review-boundaries'];
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
  if (id === 'review-contracts') return makeContractReviewCase(seed);
  if (id === 'review-boundaries') return makeBoundaryReviewCase(seed);
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

/** Separate case/version so existing review-infra fixture and prompt hashes stay stable.
 * @param {string} seed @returns {import('./cases.mjs').Case} */
function makeContractReviewCase(seed) {
  const token = sha(seed).slice(0, 8);
  const script = `scripts/cleanup-${token}.mjs`, pipeline = `.ci/maintenance-${token}.json`;
  const prefix = '// fixture module\n'.repeat(1 + parseInt(token.slice(0, 2), 16) % 7);
  /** @type {Record<string,string>} */ const files = {
    'README.md': `# Maintenance contracts\n\n${pipeline} references the active cleanup implementation and a captured synthetic response.\nCleanup must preserve related artifacts whose version is master, even when older than 30 days. In dry runs it must report proposed removals, never claim completed deletion. deleted is a pure list of intended effects; no real service is contacted.\nscripts/rollout.mjs validates every release name before deriving labels. Only accepted inputs can trigger rollout defects.\nscripts/enabled.mjs receives settings from the operator at runtime; a local comment is not the only source. Both true and false are valid runtime values.\nscripts/check.mjs is the validator entrypoint; malformed input must exit nonzero.\nRun only local, inert probes. There are no dependencies, credentials or network calls.\n`,
    [pipeline]: JSON.stringify({ script, input: 'config/response.json', force: false }, null, 2) + '\n',
    'config/response.json': JSON.stringify({ artifact: { version: 'release-current' }, related: [
      { id: 'protected', name: 'service', version: 'master', ageDays: 90 },
      { id: 'obsolete', name: 'service', version: 'release-old', ageDays: 90 },
      { id: 'recent', name: 'service', version: 'release-new', ageDays: 1 },
    ] }, null, 2) + '\n',
    [script]: prefix + `export function cleanup(response, force) {
  const candidates = response.related.filter(item => response.version !== "master" && item.ageDays > 30);
  return {
    deleted: force ? candidates.map(item => item.id) : [],
    logs: candidates.map(item => item.name + ":" + item.version + " removed."),
  };
}
`,
    'scripts/rollout.mjs': `export function rollout(name) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error("invalid release name");
  return {selector: name, label: name.toLowerCase()};
}
`,
    'scripts/enabled.mjs': '// const should_remove = false;\nexport function enabled(settings) { return settings.should_remove === true; }\n',
    'scripts/validator.mjs': 'export function validate(text) { try { JSON.parse(text); return true; } catch { return false; } }\n',
    'scripts/check.mjs': 'import {validate} from "./validator.mjs";\nif (!validate(process.argv[2])) process.exitCode = 1;\n',
  };
  const at = (file, line) => evidence(files, file, line);
  const caller = at(pipeline, `  "script": "${script}",`);
  /** @type {Finding[]} */ const findings = [
    { kind: 'protected-version', evidence: [caller, at(script, '  const candidates = response.related.filter(item => response.version !== "master" && item.ageDays > 30);'), at('config/response.json', '      "version": "master",')] },
    { kind: 'dry-run-reporting', evidence: [at(pipeline, '  "force": false'), at(script, '    logs: candidates.map(item => item.name + ":" + item.version + " removed."),')] },
  ];
  const kinds = ['protected-version', 'dry-run-reporting', 'selector-case', 'disabled-cleanup', 'validation-exit'];
  return { id: 'review-contracts', seed, files, sources: [], allowed: [], solution: {}, noTools: false, json: true, qualification: false,
    expected: { findings },
    prompt: 'Review this maintenance project for concrete defects. Work only inside this disposable workspace. Change no files; no network, installation, persistent memory or delegation. Follow README.md contracts, trace callers and validate reachable inputs. Return only raw JSON {"findings":[{"kind":string,"evidence":[{"path":relative_path,"line":one_based_integer,"text":exact_source_line}]}]}. Choose the most specific kind from ' + JSON.stringify(kinds) + '. Include caller/consumer evidence for cross-file defects, preserve exact source-line whitespace and deduplicate. Not every kind necessarily applies. No fixes or extra prose.' };
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
  if (spec.id === 'review-contracts') return probeContractReviewFixture(spec);
  if (spec.id === 'review-boundaries') return probeBoundaryReviewFixture(spec);
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

/** @param {import('./cases.mjs').Case} spec */
async function probeContractReviewFixture(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-contract-probe-'));
  try {
    putFiles(root, spec.files);
    const pipelinePath = Object.keys(spec.files).find(p => p.startsWith('.ci/maintenance-'));
    assert.ok(pipelinePath);
    const pipeline = JSON.parse(spec.files[pipelinePath]);
    const program = `import assert from "node:assert/strict"; import fs from "node:fs";
import {cleanup} from ${JSON.stringify('./' + pipeline.script)};
import {rollout} from "./scripts/rollout.mjs";
import {enabled} from "./scripts/enabled.mjs";
const response = JSON.parse(fs.readFileSync(${JSON.stringify(pipeline.input)}, "utf8"));
assert.ok(cleanup(response, true).deleted.includes("protected"), "protected version is erroneously selected");
const dry = cleanup(response, ${JSON.stringify(pipeline.force)});
assert.deepEqual(dry.deleted, []); assert.ok(dry.logs.some(line => line.endsWith(" removed.")));
assert.throws(() => rollout("UpperCase"), /invalid release name/);
for (const name of ["service", "service-2"]) assert.deepEqual(rollout(name), {selector: name, label: name});
assert.equal(enabled({should_remove:true}), true); assert.equal(enabled({should_remove:false}), false);`;
    const result = await collect({ executable: process.execPath, args: ['--input-type=module', '-e', program], cwd: root, maxOutputBytes: 65536, timeoutMs: 10000 });
    assert.ok(result.code === 0 && !result.stopReason && !result.spawnError, result.stderr);
    for (const [input, expectedExit] of [['{invalid', 1], ['{}', 0]]) {
      const validation = await collect({ executable: process.execPath, args: ['scripts/check.mjs', String(input)], cwd: root, maxOutputBytes: 65536, timeoutMs: 10000 });
      assert.equal(validation.code, expectedExit, 'caller controls validator failure');
      assert.ok(!validation.stopReason && !validation.spawnError);
    }
    assert.equal(scoreReview(spec, spec.expected).truePositives, 2);
    return { ok: true, defects: 2, falsePositiveControls: 3 };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

/** Cross-file contracts and narrow probe evidence; keep older fixtures unchanged.
 * @param {string} seed @returns {import('./cases.mjs').Case} */
function makeBoundaryReviewCase(seed) {
  const token = sha(seed).slice(0, 8), delay = 2 + parseInt(token.slice(0, 2), 16) % 8;
  const config = `config/worker-${token}.json`, renderer = `scripts/render-${token}.mjs`;
  /** @type {Record<string,string>} */ const files = {
    'README.md': `# Snapshot worker deployment\n\n${config} configures the worker through ${renderer}. backoffSecs sets the retry delay; the default is 30 seconds.\nThe worker must be able to read the resource declared in config/target.json using config/permissions.json. scripts/access.mjs implements the authorization contract.\n.ci/verify.json runs configuration validation before deployment. scripts/enabled.mjs decides whether to run maintenance from settings supplied by the operator at runtime.\nRun scripts/latest.sh with Bash. Its fetch function is an inert transport stub: the first argument is the response body. Its default synthetic response has an id. The URL's format-version parameter selects the response contract.\nThis fixture has no package dependencies. Its .invalid URLs and signature marker are test data; no network or credentials are needed.\n`,
    [config]: JSON.stringify({ backoffSecs: delay }, null, 2) + '\n',
    [renderer]: 'export function render(config) {\n  return {retryDelay: config.BackoffSecs ?? 30};\n}\n',
    'config/target.json': JSON.stringify({ group: 'snapshots.example.io', resource: 'snapshots', verb: 'get' }, null, 2) + '\n',
    'config/permissions.json': JSON.stringify({ groups: ['legacy.example.io'], resources: ['snapshots'], verbs: ['get'] }, null, 2) + '\n',
    'scripts/access.mjs': 'export function allowed(rule, request) {\n  return rule.groups.includes(request.group) && rule.resources.includes(request.resource) && rule.verbs.includes(request.verb);\n}\n',
    '.ci/verify.json': '{"command":"node scripts/validate-config.mjs","input":"config/target.json"}\n',
    'scripts/validate-config.mjs': 'import fs from "node:fs";\ntry { JSON.parse(fs.readFileSync(process.argv[2], "utf8")); } catch { process.exitCode = 1; }\n',
    'scripts/enabled.mjs': '// const should_remove = false;\nexport function enabled(settings) { return settings.should_remove === true; }\n',
    'config/connector.json': '{"url":"https://workflow.invalid/trigger?sig=SYNTHETIC-NOT-A-CREDENTIAL"}\n',
    'scripts/latest.sh': `fetch() { printf '%s\\n' "$@" >&2; printf '%s' "$response_body"; }
response_body=\${1:-'{"id":123}'}
response=$(fetch --url https://build.invalid/latest?branch=main&format-version=1)
transport_status=$?
buildid=$(printf '%s' "$response" | node --input-type=module -e 'import fs from "node:fs"; try { fs.writeSync(1, String(JSON.parse(fs.readFileSync(0,"utf8")).id ?? "")); } catch { process.exitCode=1; }')
if [[ -z "$buildid" ]]; then buildid=latest; fi
printf 'transport=%s\\nbuildid=%s\\n' "$transport_status" "$buildid"
`,
  };
  const at = (file, line) => evidence(files, file, line);
  /** @type {Finding[]} */ const findings = [
    { kind: 'config-key-case', evidence: [at(config, `  "backoffSecs": ${delay}`), at(renderer, '  return {retryDelay: config.BackoffSecs ?? 30};')] },
    { kind: 'permission-target', evidence: [at('config/target.json', '  "group": "snapshots.example.io",'), at('config/permissions.json', '    "legacy.example.io"'), at('scripts/access.mjs', '  return rule.groups.includes(request.group) && rule.resources.includes(request.resource) && rule.verbs.includes(request.verb);')] },
    { kind: 'unquoted-query', evidence: [at('scripts/latest.sh', 'response=$(fetch --url https://build.invalid/latest?branch=main&format-version=1)')] },
  ];
  const kinds = ['config-key-case', 'permission-target', 'unquoted-query', 'lost-response', 'always-fallback', 'disabled-cleanup', 'unwired-validation', 'live-credential'];
  return { id: 'review-boundaries', seed, files, sources: [], allowed: [], solution: {}, noTools: false, json: true, qualification: false,
    expected: { findings },
    prompt: 'Review this deployment project for concrete defects. Work only inside this disposable workspace. Change no files; no network, installation, persistent memory or delegation. Follow README.md contracts and inspect reachable behavior. Return only raw JSON {"findings":[{"kind":string,"evidence":[{"path":relative_path,"line":one_based_integer,"text":exact_source_line}]}]}. Choose the most specific kind from ' + JSON.stringify(kinds) + '. Include caller/consumer evidence for cross-file defects, preserve exact source-line whitespace and deduplicate. Not every kind necessarily applies. No fixes or extra prose.' };
}

/** Exercise the actual consumers and both transport response paths.
 * @param {import('./cases.mjs').Case} spec */
async function probeBoundaryReviewFixture(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-boundary-probe-'));
  try {
    putFiles(root, spec.files);
    const config = Object.keys(spec.files).find(p => p.startsWith('config/worker-'));
    const renderer = Object.keys(spec.files).find(p => p.startsWith('scripts/render-'));
    assert.ok(config && renderer);
    const program = `import assert from "node:assert/strict"; import fs from "node:fs";
import {render} from ${JSON.stringify('./' + renderer)};
import {allowed} from "./scripts/access.mjs";
import {enabled} from "./scripts/enabled.mjs";
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const config = read(${JSON.stringify(config)});
assert.notEqual(config.backoffSecs, 30); assert.equal(render(config).retryDelay, 30);
const target = read("config/target.json"), permissions = read("config/permissions.json");
assert.equal(allowed(permissions, target), false);
assert.equal(allowed({...permissions, groups:[target.group]}, target), true);
assert.equal(enabled({should_remove:true}), true); assert.equal(enabled({should_remove:false}), false);
assert.equal(read(".ci/verify.json").command, "node scripts/validate-config.mjs");
assert.equal(new URL(read("config/connector.json").url).hostname, "workflow.invalid");`;
    const result = await collect({ executable: process.execPath, args: ['--input-type=module', '-e', program], cwd: root, maxOutputBytes: 65536, timeoutMs: 10000 });
    assert.ok(result.code === 0 && !result.stopReason && !result.spawnError, result.stderr);
    for (const [file, status] of [['config/target.json', 0], ['scripts/access.mjs', 1]]) {
      const result = await collect({ executable: process.execPath, args: ['scripts/validate-config.mjs', String(file)], cwd: root, maxOutputBytes: 65536, timeoutMs: 10000 });
      assert.equal(result.code, status); assert.ok(!result.stopReason && !result.spawnError);
    }
    for (const [body, id] of [['{"id":123}', '123'], ['{}', 'latest'], ['not-json', 'latest']]) {
      const result = await collect({ executable: 'bash', args: ['--noprofile', '--norc', 'scripts/latest.sh', body], cwd: root, maxOutputBytes: 65536, timeoutMs: 10000 });
      assert.equal(result.code, 0); assert.ok(!result.stopReason && !result.spawnError);
      assert.equal(result.stdout, `transport=127\nbuildid=${id}\n`);
      assert.ok(result.stderr.includes('format-version=1: command not found'));
      assert.ok(result.stderr.includes('https://build.invalid/latest?branch=main\n'));
    }
    assert.equal(scoreReview(spec, spec.expected).truePositives, 3);
    return { ok: true, defects: 3, falsePositiveControls: 5 };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
