import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonical, inventory, object, putFiles, sha } from './core.mjs';
import { collect } from './stream.mjs';

export const REVIEW_CALIBRATION_SCHEMA = 'review-calibration/v1';

// Finite propositions, not a semantic judge or evidence of agent probe execution.
// Only type references to reviews.mjs: Main supplies the non-dispatching grounder.
const rubric = {
  critical: 'Broad compromise or major irreversible loss across services.',
  high: 'Serious operational failure or data loss requiring hours of manual recovery.',
  medium: 'Bounded correctness failure in one job, contained by independent safeguards and recoverable by correction and rerun in minutes.',
  low: 'Minor extra work with no changed output, downstream effect, lost data or outage.',
};
const rules = {
  'unnecessary-save': { disposition: 'finding', severity: 'low', consequence: 'unchanged-file-saved', proof: 'changed-then-unchanged', counterexample: 'unchanged-before-change', recommendations: ['reset-per-file'] },
  'masked-validation-exit': { disposition: 'finding', severity: 'medium', consequence: 'validator-failure-reported-success', proof: 'validator-seven-wrapper-zero', counterexample: 'valid-input-success', recommendations: ['propagate-pipeline-status', 'invoke-validator-directly'] },
  'protected-artifact-deletion': { disposition: 'finding', severity: 'high', consequence: 'protected-artifact-deleted', proof: 'active-force-old-master', counterexample: 'dry-run-no-deletion', recommendations: ['predicate-on-item', 'pause-prune'] },
  'empty-division': { disposition: 'disproved', severity: null, consequence: 'division-by-zero', proof: 'empty-batch-no-iteration', counterexample: 'empty-batch-no-iteration', recommendations: ['keep-guard'] },
  'selector-case': { disposition: 'disproved', severity: null, consequence: 'selector-label-mismatch', proof: 'guarded-selector-inputs', counterexample: 'uppercase-rejected', recommendations: ['keep-guard'] },
  'disabled-cleanup': { disposition: 'unresolved', severity: null, consequence: 'cleanup-never-enabled', proof: 'runtime-true-and-false', counterexample: 'external-settings-absent', recommendations: ['request-runtime-settings'] },
};
const dangerous = ['disable-validation', 'force-enable-cleanup'];
const consequences = [...Object.values(rules).map(r => r.consequence), 'expired-nodes-retained', 'permanent-data-loss'];
const proofs = [...new Set(Object.values(rules).map(r => r.proof)), 'none'];
const counterexamples = [...Object.values(rules).map(r => r.counterexample), 'none'];
const recommendations = [...new Set(Object.values(rules).flatMap(r => r.recommendations)), ...dangerous, 'none'];

/** @typedef {{version:string,assessedClaims:number,groundedFindings:number,duplicateAssessments:number,validatedFindings:number,expectedFindings:number,validatedRecall:number,unsupportedConfirmed:number,severityInflations:number,severityUnderstatements:number,dangerousRecommendations:number,expectedSubstantial:number,validatedSubstantial:number,missedSubstantial:string[],substantialRecall:number,violations:number,manualAdjudicationRequired:true,limitations:string[],unsupportedConsequences:number,unsupportedProofs:number,unsupportedCounterexamples:number,invalidEvidence:number,invalidDispositions:number,invalidSeverities:number,unsupportedRecommendations:number,correctNonfindings:number}} ReviewCalibration */
/** @typedef {import('./reviews.mjs').Finding & {disposition:string,severity:string|null,consequence:string,proof:string,counterexample:string,recommendation:string}} Assessment */
/** @typedef {{version:string,rubric:typeof rubric,assessments:Assessment[],rules:typeof rules,dangerousRecommendations:string[]}} CalibrationController */

/** Separate opt-in fixture. Only files/prompt go to agents; controller is hash-bound but private.
 * @param {string} seed @returns {import('./cases.mjs').Case} */
export function makeCalibrationReviewCase(seed) {
  const token = sha(seed).slice(0, 8), age = 100 + parseInt(token.slice(0, 2), 16);
  const prefix = '// synthetic fixture\n'.repeat(1 + parseInt(token.slice(2, 4), 16) % 5);
  /** @type {Record<string,string>} */
  const files = {
    'README.md': `# Finite maintenance contracts ${token}
All effects are returned lists or stdout, never real saves, service calls or deletion. No dependencies, installation, credentials or network. Node and Bash only.
Active caller scripts/run.mjs reads config/job.json, config/batch.json and captured config/response.json. The mandatory artifact job is independent of optional operator cleanup.
Cleanup must remove every expired node and save only changed files. At most three small files per job, identical redundant writes, no downstream write triggers or lost data; next run recovers automatically.
Protected related artifacts with version master must never be deleted, even older than 30 days and with force=true. Other artifacts older than 30 days are eligible; dry runs delete nothing. One service depends on the protected rollback artifact; deletion requires manual archive restore taking four hours, not permanent loss or a cross-service outage.
scripts/release.sh consumes scripts/check.sh status: invalid input must stop plan admission. A mistaken admission is limited to one maintenance job; independent downstream preflight blocks effects; correction and rerun take ten minutes. Valid input must remain accepted.
Empty batches are valid; progress is computed only during iteration. scripts/rollout.mjs accepts only lowercase release names before deriving selector and label.
Optional scripts/operator.mjs receives settings from an external operator. Both should_remove=true and false are valid; no deployed setting is supplied. A comment is not configuration. Do not infer an actual deployment value from missing local settings.
Severity rubric (impact/scope/recovery, NOT confidence):
${Object.entries(rubric).map(([level, text]) => `${level}: ${text}`).join('\n')}
Recommendations must preserve valid operation and guards. Review read-only; describe a correction ID, do not apply it.
`,
    'config/job.json': JSON.stringify({ name: token, force: true }, null, 2) + '\n',
    'config/batch.json': '[\n  {"name":"before","nodes":[]},\n  {"name":"changed","nodes":[{"expired":true},{"expired":true},{"expired":false}]},\n  {"name":"after","nodes":[]}\n]\n',
    'config/response.json': JSON.stringify({ artifact: { version: 'release-current' }, related: [
      { id: 'protected', version: 'master', ageDays: age },
      { id: 'obsolete', version: 'release-old', ageDays: 90 },
      { id: 'recent', version: 'release-new', ageDays: 1 },
    ] }, null, 2) + '\n',
    'scripts/cleanup.mjs': prefix + `export function cleanup(files) {
  let changesMade = false;
  const saves = [], progress = [];
  for (const [index, file] of files.entries()) {
    progress.push(index / files.length * 100);
    const nodes = [...file.nodes];
    for (const node of nodes) {
      if (node.expired) {
        file.nodes.splice(file.nodes.indexOf(node), 1);
        changesMade = true;
      }
    }
    if (changesMade) saves.push(file.name);
  }
  return {saves, progress};
}
`,
    'scripts/prune.mjs': prefix + `export function prune(response, force) {
  const candidates = response.related.filter(item => response.version !== "master" && item.ageDays > 30);
  return {deleted: force ? candidates.map(item => item.id) : []};
}
`,
    'scripts/run.mjs': `import fs from "node:fs";
import {cleanup} from "./cleanup.mjs";
import {prune} from "./prune.mjs";
export function run() {
  const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
  const job = read("config/job.json");
  const batch = read("config/batch.json");
  const response = read("config/response.json");
  return {batch, cleanup: cleanup(batch), artifacts: prune(response, job.force)};
}
`,
    'scripts/validate input.sh': 'if [[ "${1:-invalid}" != valid ]]; then\n  printf "%s\\n" "invalid fixture input" >&2\n  exit 7\nfi\nprintf "%s\\n" "valid fixture input"\n',
    'scripts/check.sh': 'bash --noprofile --norc "scripts/validate input.sh" "$@" | tail -n 1\n',
    'scripts/release.sh': 'bash --noprofile --norc scripts/check.sh "$@"\nstatus=$?\nif [[ "$status" != 0 ]]; then exit "$status"; fi\nprintf "%s\\n" "plan admitted"\n',
    'scripts/rollout.mjs': 'export function rollout(name) {\n  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error("invalid release name");\n  return {selector: name, label: name.toLowerCase()};\n}\n',
    'scripts/enabled.mjs': '// const should_remove = false;\nexport function enabled(settings) { return settings.should_remove === true; }\n',
    'scripts/operator.mjs': 'import {enabled} from "./enabled.mjs";\nexport function optionalCleanup(settings) { return {deleted: enabled(settings) ? ["optional-cache"] : []}; }\n',
  };
  // Complete finite evidence obligations, including active inputs and consumers.
  const at = (file, text) => {
    const matches = files[file].split('\n').flatMap((line, i) => line === text ? [i + 1] : []);
    assert.equal(matches.length, 1, 'unique calibration evidence');
    return { path: file, line: matches[0], text };
  };
  const lines = (file, texts) => texts.map(text => at(file, text));
  const contract = text => at('README.md', files['README.md'].split('\n').find(line => line.startsWith(text)));
  const caller = lines('scripts/run.mjs', ['import {cleanup} from "./cleanup.mjs";', '  const batch = read("config/batch.json");', '  return {batch, cleanup: cleanup(batch), artifacts: prune(response, job.force)};']);
  const evidence = {
    'unnecessary-save': [...caller, ...lines('scripts/cleanup.mjs', ['  let changesMade = false;', '    const nodes = [...file.nodes];', '        file.nodes.splice(file.nodes.indexOf(node), 1);', '    if (changesMade) saves.push(file.name);']), ...lines('config/batch.json', ['  {"name":"changed","nodes":[{"expired":true},{"expired":true},{"expired":false}]},', '  {"name":"after","nodes":[]}']), contract('Cleanup must')],
    'masked-validation-exit': [...lines('scripts/release.sh', ['bash --noprofile --norc scripts/check.sh "$@"', 'status=$?', 'if [[ "$status" != 0 ]]; then exit "$status"; fi', 'printf "%s\\n" "plan admitted"']), at('scripts/check.sh', files['scripts/check.sh'].trimEnd()), ...lines('scripts/validate input.sh', ['if [[ "${1:-invalid}" != valid ]]; then', '  exit 7']), contract('scripts/release.sh consumes')],
    'protected-artifact-deletion': [...lines('scripts/run.mjs', ['import {prune} from "./prune.mjs";', '  const job = read("config/job.json");', '  const response = read("config/response.json");', '  return {batch, cleanup: cleanup(batch), artifacts: prune(response, job.force)};']), at('config/job.json', '  "force": true'), ...lines('config/response.json', ['  "artifact": {', '    "version": "release-current"', '  "related": [', '      "id": "protected",', '      "version": "master",', `      "ageDays": ${age}`]), ...lines('scripts/prune.mjs', ['  const candidates = response.related.filter(item => response.version !== "master" && item.ageDays > 30);', '  return {deleted: force ? candidates.map(item => item.id) : []};']), contract('Protected related')],
    'empty-division': [...caller, ...lines('scripts/cleanup.mjs', ['  for (const [index, file] of files.entries()) {', '    progress.push(index / files.length * 100);']), contract('Empty batches')],
    'selector-case': lines('scripts/rollout.mjs', ['  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error("invalid release name");', '  return {selector: name, label: name.toLowerCase()};']),
    'disabled-cleanup': [...lines('scripts/operator.mjs', ['import {enabled} from "./enabled.mjs";', 'export function optionalCleanup(settings) { return {deleted: enabled(settings) ? ["optional-cache"] : []}; }']), at('scripts/enabled.mjs', 'export function enabled(settings) { return settings.should_remove === true; }'), contract('Optional scripts/operator')],
  };
  const assessments = Object.entries(rules).map(([kind, r]) => ({ kind, evidence: evidence[kind], disposition: r.disposition, severity: r.severity, consequence: r.consequence, proof: r.proof, counterexample: r.counterexample, recommendation: r.recommendations[0] }));
  return { id: 'review-calibration', seed, files, sources: [], allowed: [], solution: {}, noTools: false, json: true, qualification: false,
    expected: { schema: REVIEW_CALIBRATION_SCHEMA, findings: assessments.filter(a => a.disposition === 'finding') },
    reviewOracle: { version: REVIEW_CALIBRATION_SCHEMA, rubric: structuredClone(rubric), rules: structuredClone(rules), assessments, dangerousRecommendations: [...dangerous] },
    prompt: 'Review this finite maintenance project under README.md impact/scope/recovery contracts. Work only inside this disposable workspace. Change no files; no network, installation, persistent memory or delegation. Return only raw JSON with exactly {schema:"' + REVIEW_CALIBRATION_SCHEMA + '",findings:[{kind,disposition,severity,consequence,evidence:[{path,line,text}],proof,counterexample,recommendation}]}. The findings array holds assessments, including nonfindings; deduplicate. disposition is finding, disproved or unresolved. severity is critical, high, medium or low for findings, null for nonfindings; it measures impact, not confidence. kind: ' + JSON.stringify(Object.keys(rules)) + '. consequence: ' + JSON.stringify(consequences) + '. proof: ' + JSON.stringify(proofs) + '. counterexample: ' + JSON.stringify(counterexamples) + '. recommendation: ' + JSON.stringify(recommendations) + '. IDs describe finite scenarios/corrections, not free prose or self-attestation of execution. Inspect actual callers, consumers, guards and inputs; cite all relevant exact source lines (relative path, one-based integer line, exact whitespace). Investigate whether candidate consequences are reachable; not all kinds are defects. Test limiting cases and preserve valid behavior in recommendations. Missing external settings are not proof of a deployed value. Manual adjudication remains required; passing this finite fixture does not establish model reasoning quality.' };
}

function keys(value, expected) { assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), 'calibration schema keys'); }
function member(value, values) { assert.ok(values.includes(value), 'calibration enum'); }
/** @param {import('./cases.mjs').Case} spec @param {unknown} answer
 * @param {(spec:import('./cases.mjs').Case,answer:unknown)=>import('./reviews.mjs').ReviewScore} scoreGrounding
 * @returns {import('./reviews.mjs').ReviewScore & {calibration:ReviewCalibration}} */
export function scoreReviewCalibration(spec, answer, scoreGrounding) {
  const value = object(answer);
  keys(value, ['schema', 'findings']);
  assert.equal(value.schema, REVIEW_CALIBRATION_SCHEMA);
  assert.ok(Array.isArray(value.findings) && value.findings.length <= 100, 'bounded assessments');
  const expected = /** @type {{schema:string,findings:Assessment[]}} */ (spec.expected);
  const controller = /** @type {CalibrationController} */ (spec.reviewOracle);
  assert.equal(controller.version, REVIEW_CALIBRATION_SCHEMA, 'controller version');
  const expectedKinds = expected.findings.map(f => f.kind);
  const substantial = expected.findings.filter(f => ['medium', 'high', 'critical'].includes(f.severity)).map(f => f.kind);
  /** @type {ReviewCalibration} */
  const calibration = { version: REVIEW_CALIBRATION_SCHEMA, assessedClaims: value.findings.length, groundedFindings: 0, duplicateAssessments: 0, validatedFindings: 0, expectedFindings: expectedKinds.length, validatedRecall: 0,
    unsupportedConfirmed: 0, severityInflations: 0, severityUnderstatements: 0, dangerousRecommendations: 0,
    expectedSubstantial: substantial.length, validatedSubstantial: 0, missedSubstantial: [], substantialRecall: 0, violations: 0,
    unsupportedConsequences: 0, unsupportedProofs: 0, unsupportedCounterexamples: 0, invalidEvidence: 0, invalidDispositions: 0, invalidSeverities: 0, unsupportedRecommendations: 0, correctNonfindings: 0,
    manualAdjudicationRequired: true, limitations: ['Finite fixture validation and severity only, not generic semantic judging or model reasoning quality.', 'IDs do not prove actual inspection, probe execution, prose correctness or transfer to live reviews; manual/live adjudication required.', 'Inert controller probes qualify only supplied Node/Bash contracts, not real deletion, outage or recovery.'] };
  const validated = new Set(), groundedKinds = new Set(), seen = new Set(), ranks = ['low', 'medium', 'high', 'critical'];
  let reported = 0, falsePositives = 0, duplicates = 0;
  for (const raw of value.findings) {
    const f = object(raw);
    keys(f, ['kind', 'disposition', 'severity', 'consequence', 'evidence', 'proof', 'counterexample', 'recommendation']);
    member(f.kind, Object.keys(rules)); member(f.disposition, ['finding', 'disproved', 'unresolved']);
    member(f.severity, [...ranks, null]); member(f.consequence, consequences); member(f.proof, proofs);
    member(f.counterexample, counterexamples); member(f.recommendation, recommendations);
    const c = controller.assessments.find(a => a.kind === f.kind);
    assert.ok(c, 'controller assessment');
    // Reuse strict evidence parsing, exact-source checks and full required evidence,
    // even for nonfindings, without awarding them generic defect credit.
    const grounded = scoreGrounding({ ...spec, expected: { findings: [c] } }, { findings: [{ kind: f.kind, evidence: f.evidence }] }).truePositives === 1;
    const finding = f.disposition === 'finding', actual = c.disposition === 'finding';
    const badConsequence = f.consequence !== c.consequence, badProof = f.proof !== c.proof, badCounter = f.counterexample !== c.counterexample;
    const badDisposition = f.disposition !== c.disposition, badSeverity = f.severity !== c.severity;
    const unsafe = dangerous.includes(String(f.recommendation));
    const badRecommendation = !rules[String(f.kind)].recommendations.includes(f.recommendation);
    const duplicate = seen.has(f.kind); seen.add(f.kind);
    duplicates += Number(duplicate);
    if (finding && actual && grounded) groundedKinds.add(f.kind);
    const invalid = duplicate || !grounded || badConsequence || badProof || badCounter || badDisposition || badSeverity || badRecommendation;
    calibration.invalidEvidence += Number(!grounded);
    calibration.unsupportedConsequences += Number(badConsequence);
    calibration.unsupportedProofs += Number(badProof);
    calibration.unsupportedCounterexamples += Number(badCounter);
    calibration.invalidDispositions += Number(badDisposition);
    calibration.invalidSeverities += Number(badSeverity);
    calibration.severityInflations += Number(finding && actual && ranks.indexOf(String(f.severity)) > ranks.indexOf(c.severity));
    calibration.severityUnderstatements += Number(finding && actual && ranks.indexOf(String(f.severity)) < ranks.indexOf(c.severity));
    calibration.dangerousRecommendations += Number(unsafe);
    calibration.unsupportedRecommendations += Number(badRecommendation);
    calibration.unsupportedConfirmed += Number(finding && invalid);
    calibration.violations += Number(invalid); // Exactly once per invalid assessment; diagnostics overlap.
    calibration.correctNonfindings += Number(!finding && !invalid);
    if (!finding) continue;
    reported++;
    if (duplicate) continue;
    if (invalid) { falsePositives++; continue; }
    validated.add(f.kind);
  }
  calibration.groundedFindings = groundedKinds.size;
  calibration.duplicateAssessments = duplicates;
  calibration.validatedFindings = validated.size;
  calibration.validatedRecall = validated.size / expectedKinds.length;
  calibration.missedSubstantial = substantial.filter(kind => !validated.has(kind));
  calibration.validatedSubstantial = substantial.length - calibration.missedSubstantial.length;
  calibration.substantialRecall = calibration.validatedSubstantial / substantial.length;
  // Unlike legacy location-only ReviewScore, TP/precision here require full validation.
  // duplicates covers ALL assessments; reported/FP/precision cover finding dispositions only.
  return { expected: expectedKinds.length, reported, truePositives: validated.size, falsePositives, duplicates,
    missed: expectedKinds.filter(kind => !validated.has(kind)), precision: reported ? validated.size / reported : null, recall: calibration.validatedRecall, calibration };
}

/** Execute trusted synthetic fixture code in disposable controller copies, never the agent workspace.
 * These assertions are behavioral and deliberately independent of spec.expected/answer IDs.
 * @param {import('./cases.mjs').Case} spec */
export async function probeCalibrationReviewFixture(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-calibration-probe-'));
  const program = `import assert from "node:assert/strict"; import fs from "node:fs";
import {run} from "./scripts/run.mjs"; import {cleanup} from "./scripts/cleanup.mjs";
import {prune} from "./scripts/prune.mjs"; import {rollout} from "./scripts/rollout.mjs";
import {optionalCleanup} from "./scripts/operator.mjs";
const read = p => JSON.parse(fs.readFileSync(p, "utf8"));
const job = read("config/job.json"), response = read("config/response.json");
assert.equal(job.force, true);
assert.ok(response.related.some(x => x.id === "protected" && x.version === "master" && x.ageDays > 30));
const active = run();
assert.deepEqual(active.cleanup.saves, EXPECT_SAVES);
assert.deepEqual(active.batch[1].nodes, [{expired:false}], "adjacent expired nodes removed, not lost");
assert.deepEqual(active.artifacts.deleted, EXPECT_DELETED);
assert.deepEqual(cleanup([]), {saves:[],progress:[]}, "empty division unreachable");
assert.deepEqual(cleanup([{name:"before",nodes:[]},{name:"changed",nodes:[{expired:true}]}]).saves, ["changed"]);
assert.deepEqual(cleanup([{name:"unchanged",nodes:[{expired:false}]}]).saves, []);
assert.deepEqual(prune(response, false).deleted, []);
assert.deepEqual(prune({related:[{id:"young-master",version:"master",ageDays:1},{id:"boundary",version:"old",ageDays:30}]}, true).deleted, []);
assert.throws(() => rollout("UpperCase"), /invalid release name/);
for (const name of ["service", "service-2"]) assert.deepEqual(rollout(name), {selector:name,label:name});
assert.deepEqual(optionalCleanup({should_remove:true}).deleted, ["optional-cache"]);
assert.deepEqual(optionalCleanup({should_remove:false}).deleted, EXPECT_OPTIONAL_FALSE);
assert.deepEqual(optionalCleanup({}).deleted, EXPECT_OPTIONAL_FALSE);
`;
  let copies = 0;
  try {
    /** @param {Record<string,string>} files @param {string[]} saves @param {string[]} deleted @param {number} validationExit @param {boolean} [forced] */
    async function probe(files, saves, deleted, validationExit, forced = false) {
      const cwd = path.join(root, String(copies++)); fs.mkdirSync(cwd, { mode: 0o700 }); putFiles(cwd, files);
      const before = inventory(cwd);
      const env = { PATH: process.env.PATH, HOME: cwd, LANG: 'C' }; // No BASH_ENV/NODE_OPTIONS injection.
      const run = (executable, args) => collect({ executable, args, cwd, env, maxOutputBytes: 65536, timeoutMs: 10000 });
      const source = program.replace('EXPECT_SAVES', JSON.stringify(saves)).replace('EXPECT_DELETED', JSON.stringify(deleted)).replaceAll('EXPECT_OPTIONAL_FALSE', JSON.stringify(forced ? ['optional-cache'] : []));
      const node = await run(process.execPath, ['--input-type=module', '-e', source]);
      assert.ok(node.code === 0 && !node.stopReason && !node.spawnError, node.stderr || 'calibration Node probe');
      for (const input of ['invalid', 'valid']) for (const file of ['scripts/validate input.sh', 'scripts/check.sh', 'scripts/release.sh']) {
        const result = await run('bash', ['--noprofile', '--norc', file, input]);
        const code = input === 'valid' ? 0 : file === 'scripts/validate input.sh' ? 7 : validationExit;
        assert.equal(result.code, code, `${file} ${input} exit`); assert.ok(!result.stopReason && !result.spawnError);
        if (file === 'scripts/validate input.sh' && input === 'invalid') assert.ok(result.stderr.includes('invalid fixture input'));
        if (file === 'scripts/release.sh') assert.equal(result.stdout.includes('plan admitted'), code === 0, 'actual status consumer');
      }
      assert.equal(canonical(inventory(cwd)), canonical(before), 'fixture probes must be read-only');
    }
    await probe(spec.files, ['changed', 'after'], ['protected', 'obsolete'], 0);
    const fixed = { ...spec.files,
      'scripts/cleanup.mjs': spec.files['scripts/cleanup.mjs'].replace('    const nodes = [...file.nodes];', '    changesMade = false;\n    const nodes = [...file.nodes];'),
      'scripts/prune.mjs': spec.files['scripts/prune.mjs'].replace('response.version !== "master"', 'item.version !== "master"'),
      'scripts/check.sh': 'set -o pipefail\n' + spec.files['scripts/check.sh'],
    };
    await probe(fixed, ['changed'], ['obsolete'], 7); // Safe fixes preserve controls and validator failures/successes.
    await probe({ ...fixed, 'scripts/check.sh': 'bash --noprofile --norc "scripts/validate input.sh" "$@"\n',
      'scripts/run.mjs': fixed['scripts/run.mjs'].replace('prune(response, job.force)', 'prune(response, false)') }, ['changed'], [], 7); // Direct validator and paused prune alternatives.
    await probe({ ...fixed, 'scripts/check.sh': 'exit 0\n' }, ['changed'], ['obsolete'], 0); // Disabling validation admits invalid plans.
    await probe({ ...fixed, 'scripts/enabled.mjs': 'export function enabled() { return true; }\n' }, ['changed'], ['obsolete'], 7, true); // Forced cleanup violates explicit false/unknown settings.
    return { ok: true, defects: 3, falsePositiveControls: 3, calibrationVersion: REVIEW_CALIBRATION_SCHEMA, controllerCopies: copies, manualAdjudicationRequired: true };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
