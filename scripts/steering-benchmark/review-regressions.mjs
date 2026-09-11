import assert from 'node:assert/strict';
import { canonical, digest, object, sha } from './core.mjs';
import { scoreReview } from './reviews.mjs';
import { collect } from './stream.mjs';

export const REVIEW_REGRESSION_CASES = ['review-regressions-seeded', 'review-regressions-heldout'];
export const REVIEW_REGRESSIONS_SCHEMA = 'review-regressions/v1';
const limitations = [
  'Finite oracle and exact-source structural evidence only; not semantic correctness or an issue-count target.',
  'Controller fixture executions are not evidence that the agent inspected sources or executed tests.',
  'A causal chain can have multiple scenario assessments; matches are not a count of unique issues.',
  'Manual/live adjudication is required for prose, causal reasoning, actual test execution and generalization.',
  'Held-out denotes a separate fixture family, not secrecy from a model trained on this repository.',
  'HTTP uses real Request/Response middleware without sockets; cloud CLIs are inert contract doubles; C# SDK execution is explicitly skipped.',
];
/** @typedef {import('./reviews.mjs').ReviewEvidence} Evidence */
/** @typedef {{kind:string,disposition:string,severity:string|null,consequence:string,proof:string,counterexample:string,recommendation:string,evidence:Evidence[]}} Assessment */
/** @typedef {{schema:string,findings:Assessment[]}} Answer */
/** @typedef {{version:string,split:string,assessments:Assessment[],highImpact:string[],requiredScenarios:string[],fixtureDigest:string}} Controller */
/** @typedef {{version:string,basis:string,assessedClaims:number,invalidEvidence:number,callerConsumerOmissions:number,unsupportedConsequences:number,unsupportedProofs:number,unsupportedCounterexamples:number,invalidDispositions:number,invalidSeverities:number,unsupportedRecommendations:number,correctNonfindings:number,violations:number,expectedHighImpact:number,validatedHighImpact:number,missedHighImpact:string[],requestedScenarios:number,coveredScenarios:number,missingScenarios:string[],scenarioCoverage:number,reproducibleAssessments:number,manualAdjudicationRequired:true,agentTestExecution:'unobserved',limitations:string[]}} RegressionDiagnostics */

/** Neutral source contracts and candidate vocabularies go to the agent; answer tuples never do.
 * Seed varies concrete identifiers, input timing and source offsets. Held-out also changes guards,
 * hence copying the seeded answer is wrong even after updating exact-source evidence.
 * @param {string} id @param {string} seed @returns {import('./cases.mjs').Case} */
export function makeRegressionReviewCase(id, seed) {
  assert.ok(REVIEW_REGRESSION_CASES.includes(id), 'unknown regression case');
  assert.ok(typeof seed === 'string' && seed.length > 0, 'nonempty regression seed');
  const heldout = id.endsWith('-heldout'), token = sha(seed).slice(0, 8);
  const delay = 5 + parseInt(token.slice(0, 2), 16) % 10;
  const prefix = '// fixture ' + token + '\n' + '// review source\n'.repeat(parseInt(token.slice(2, 4), 16) % 4);
  const input = { saved: ['live-' + token, 'archive-' + token], pages: [{ items: ['live-' + token] }, { error: 'denied' }], dryRun: false };
  /** @type {Record<string,string>} */
  const files = {
    'README.md': `# Offline maintenance ${token}
Review all supplied scenarios, including controls and consumers. Do not change files or access services, network, credentials, installations, persistent memory or delegation. Deletion means a returned ID list, never filesystem/cloud deletion.
Severity is impact/scope/recovery, not confidence: high means a recoverable but serious data loss needing four hours of manual restore; medium means one failed request or blocked release, corrected and retried in minutes; low means harmless extra work; critical requires broad irreversible loss (not stipulated here).
Inventory is paginated. Failure of any page makes absence unknown; incomplete inventory must never authorize deletion. Complete inventory may remove absent archives; dry run must remove nothing. An absent archive is the only rollback copy for one service; deletion needs four hours of manual restore, not permanent loss or a global outage.
JS and C# submit operations must translate both synchronous throws and asynchronous rejections to DomainConflict. Callers await returned tasks/promises. The awaited control must retain this mapping.
HTTP POST /submit must map DomainConflict to 409; unexpected errors map to 500, successful requests to 202. The HTTP dispatcher awaits the endpoint; assess the actual outer middleware, not a local catch alone.
Poll requests use fixed start slots every 1000ms for a fixed 10000ms window, three workers, no retries or overlap. Shortening simulated response delay below the slot width reduces completion latency, not request count or total request rate. Do not infer rate from reciprocal delay.
Release admission consumes pipeline status. Invalid validation must stop admission; valid input must still pass. No downstream service is called.
Terraform plan -detailed-exitcode returns 0 for no changes, 2 for a valid diff and 1 for an error. Admission must accept 0 and 2, reject 1, and never apply infrastructure. The local function is a contract double, not an installed SDK.
Kubernetes and Helm inventories are independently paginated. Pruning requires complete inventories from both, plus a non-dry run; matching IDs are retained. A missing Helm page is not an empty inventory. Same rollback recovery contract as archive deletion. All output is an in-memory candidate list.
C# source is a review fixture with no installed SDK requirement; do not claim it was compiled or executed without separate evidence.
`,
    'config/inventory.json': JSON.stringify(input, null, 2) + '\n',
    'src/pages.ts': prefix + `type Page = {items?: string[]; error?: string};
export function inventory(pages: Page[]) {
  const items: string[] = [];
  let complete = true;
  for (const page of pages) {
    if (page.error) { complete = false; continue; }
    items.push(...(page.items ?? []));
  }
  return {items, complete};
}
`,
    'src/prune.ts': `import {inventory} from './pages.ts';
export function reconcile(saved: string[], pages: {items?: string[]; error?: string}[], dryRun: boolean) {
  const result = inventory(pages);
  if (dryRun${heldout ? ' || !result.complete' : ''}) return [];
  return saved.filter(id => !result.items.includes(id));
}
`,
    'src/job.ts': `import {reconcile} from './prune.ts';
export function job(config: {saved: string[]; pages: {items?: string[]; error?: string}[]; dryRun: boolean}) {
  return {deleteCandidates: reconcile(config.saved, config.pages, config.dryRun)};
}
`,
    'src/errors.mjs': 'export class DomainConflict extends Error {}\n',
    'src/submit.mjs': prefix + `import {DomainConflict} from './errors.mjs';
export async function submit(operation) {
  try { return operation(); }
  catch { throw new DomainConflict('submit conflict'); }
}
export async function submitAwaited(operation) {
  try { return await operation(); }
  catch { throw new DomainConflict('conflict'); }
}
`,
    'src/http.mjs': `import {DomainConflict} from './errors.mjs';
import {submit} from './submit.mjs';
export function errorMiddleware(error) {
  return new Response(null, {status: error instanceof DomainConflict ? 409 : 500});
}
export async function dispatch(request, operation, endpoint = submit) {
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/submit') return new Response(null, {status:404});
  try { await endpoint(operation); return new Response(null, {status:202}); }
  catch (error) { return errorMiddleware(error); }
}
`,
    'src/poll.mjs': `export function poll(delay, windowMs, workers) {
  if (delay < 0 || delay >= 1000) throw new Error('delay outside slot');
  const requests = [];
  for (let worker = 0; worker < workers; worker++) for (let start = 0; start < windowMs; start += 1000) requests.push({worker, start, finish: start + delay});
  return {requests: requests.length, ratePerSecond: requests.length / (windowMs / 1000), lastFinish: Math.max(...requests.map(r => r.finish))};
}
`,
    'src/poll-job.mjs': `import {poll} from './poll.mjs';
export function compare() { return {short: poll(${delay}, 10000, 3), long: poll(${delay + 200}, 10000, 3)}; }
`,
    'scripts/validator.sh': 'validate_input() {\n  if [[ "${1:-invalid}" != valid ]]; then printf "%s\\n" "invalid" >&2; return 7; fi\n  return 0\n}\n',
    'scripts/check.sh': 'check_input() { validate_input "$@" | cat; }\n',
    'scripts/release.sh': 'release() {\n  check_input "$@"\n  status=$?\n  if [[ "$status" != 0 ]]; then return "$status"; fi\n  printf "%s\\n" "admitted"\n}\n',
    'scripts/terraform.sh': '# Offline contract double: no terraform binary, state or provider.\nterraform() { [[ "$1" == plan && "$2" == -detailed-exitcode ]] || return 64; return "$PLAN_STATUS"; }\nplan_gate() {\n  terraform plan -detailed-exitcode\n  status=$?\n  if [[ "$status" != 0 ]]; then return "$status"; fi\n  printf "%s\\n" "plan admitted"\n}\n',
    'config/cluster.json': JSON.stringify({ dryRun: false, saved: ['release-' + token, 'backup-' + token], kube: { complete: true, items: ['release-' + token] }, helm: { complete: false, items: [] } }, null, 2) + '\n',
    'src/cluster.mjs': `export function pruneCluster(saved, kube, helm, dryRun) {
  if (dryRun || !kube.complete${heldout ? '' : ' || !helm.complete'}) return [];
  return saved.filter(id => !kube.items.includes(id) && !helm.items.includes(id));
}
`,
    'src/cluster-job.mjs': `import {pruneCluster} from './cluster.mjs';
export function clusterJob(config) {
  return {deleteCandidates: pruneCluster(config.saved, config.kube, config.helm, config.dryRun)};
}
`,
    'dotnet/Submit.cs': `using System;
using System.Threading.Tasks;
public sealed class DomainConflict : Exception {}
public static class Submit {
  public static Task<string> Run(Func<Task<string>> operation) {
    try { return operation(); }
    catch { throw new DomainConflict(); }
  }
  public static async Task<string> Awaited(Func<Task<string>> operation) {
    try { return await operation(); }
    catch { throw new DomainConflict(); }
  }
}
`,
    'dotnet/Consumer.cs': `using System;
using System.Threading.Tasks;
public static class Consumer {
  public static async Task<int> Status(Func<Task<string>> operation) {
    try { await Submit.Run(operation); return 202; }
    catch (DomainConflict) { return 409; }
    catch { return 500; }
  }
  public static Task<string> Rejected() => Task.FromException<string>(new InvalidOperationException());
}
`,
  };
  // Small complete execution slices (<32 exact evidence rows), including input and consumer.
  const lines = (file, texts) => texts.map(text => {
    const matches = files[file].split('\n').flatMap((line, i) => line === text ? [i + 1] : []);
    assert.equal(matches.length, 1, 'unique regression evidence: ' + file + ':' + text);
    return { path: file, line: matches[0], text };
  });
  const all = file => files[file].trimEnd().split('\n').filter(t => t && t !== '}' && !t.startsWith('//')).map(text => lines(file, [text])[0]);
  const contract = start => lines('README.md', [files['README.md'].split('\n').find(t => t.startsWith(start))]);
  const partialEvidence = [...all('src/job.ts'), ...all('src/prune.ts'), ...all('src/pages.ts'), ...lines('config/inventory.json', [`    "archive-${token}"`, `        "live-${token}"`, '      "error": "denied"', '  "dryRun": false']), ...contract('Inventory is')];
  const asyncEvidence = [...lines('src/submit.mjs', ["import {DomainConflict} from './errors.mjs';", 'export async function submit(operation) {', '  try { return operation(); }', "  catch { throw new DomainConflict('submit conflict'); }"]), ...all('src/errors.mjs'), ...all('src/http.mjs'), ...contract('JS and C#'), ...contract('HTTP POST')];
  const clusterEvidence = [...all('src/cluster-job.mjs'), ...all('src/cluster.mjs'), ...lines('config/cluster.json', ['  "dryRun": false,', `    "backup-${token}"`, `      "release-${token}"`, '    "complete": true,', '    "complete": false,', '    "items": []']), ...contract('Kubernetes and Helm')];
  /** @type {Assessment[]} */
  const assessments = [];
  const add = (kind, disposition, severity, consequence, proof, counterexample, recommendation, evidence) => assessments.push({kind, disposition, severity, consequence, proof, counterexample, recommendation, evidence:structuredClone(evidence)});
  add('partial-delete', heldout ? 'disproved' : 'finding', heldout ? null : 'high', heldout ? 'incomplete-blocked' : 'rollback-candidate-lost', 'partial-page-job', 'complete-and-dry-run', heldout ? 'preserve-guard' : 'require-complete', partialEvidence);
  add('async-catch', 'finding', 'medium', 'rejection-bypasses-catch', 'rejected-operation', 'synchronous-throw', 'await-inside-try', asyncEvidence);
  add('awaited-control', 'disproved', null, 'rejection-translated', 'awaited-rejection', 'successful-operation', 'preserve-guard', [...lines('src/submit.mjs', ['export async function submitAwaited(operation) {', '  try { return await operation(); }']), ...all('src/errors.mjs'), ...contract('JS and C#')]);
  add('http-status', 'finding', 'medium', 'conflict-becomes-500', 'post-rejected-operation', 'awaited-post-409', 'await-inside-try', asyncEvidence);
  add('shorter-delay-rate', 'disproved', null, 'latency-not-total-rate', 'matched-poll-window', 'delay-outside-slot', 'preserve-schedule', [...all('src/poll.mjs'), ...all('src/poll-job.mjs'), ...contract('Poll requests')]);
  add('pipeline-exit', 'finding', 'medium', 'validation-seven-admitted', 'invalid-release', 'valid-release', 'propagate-pipeline-status', [...all('scripts/validator.sh'), ...all('scripts/check.sh'), ...all('scripts/release.sh'), ...contract('Release admission')]);
  add('terraform-detailed-exit', 'finding', 'medium', 'valid-diff-blocked', 'plan-two', 'plan-zero-and-one', 'accept-zero-and-two', [...all('scripts/terraform.sh'), ...contract('Terraform plan')]);
  add('cluster-inventory', heldout ? 'finding' : 'disproved', heldout ? 'high' : null, heldout ? 'rollback-candidate-lost' : 'incomplete-blocked', 'missing-helm-page', 'kube-incomplete-and-dry-run', heldout ? 'require-both-inventories' : 'preserve-guard', clusterEvidence);
  add('csharp-task-catch', 'finding', 'medium', 'rejection-bypasses-catch', 'faulted-task-source', 'awaited-task-source', 'await-inside-try', [...lines('dotnet/Submit.cs', ['  public static Task<string> Run(Func<Task<string>> operation) {', '    try { return operation(); }', '  public static async Task<string> Awaited(Func<Task<string>> operation) {', '    try { return await operation(); }']), ...all('dotnet/Consumer.cs'), ...contract('JS and C#')]);
  // A vocabulary is not an answer: alternatives are offered without tuple mappings or dispositions.
  const vocabulary = Object.fromEntries(['kind', 'consequence', 'proof', 'counterexample', 'recommendation'].map(key => [key, [...new Set(assessments.map(a => a[key]))].sort()]));
  vocabulary.consequence = [...new Set([...vocabulary.consequence, 'rollback-candidate-lost', 'incomplete-blocked', 'global-permanent-loss', 'total-rate-increases'])].sort();
  vocabulary.recommendation = [...new Set([...vocabulary.recommendation, 'require-complete', 'require-both-inventories', 'preserve-guard', 'disable-validation'])].sort();
  return { id, seed, files, sources: [], allowed: [], solution: {}, noTools: false, json: true, qualification: false,
    expected: {schema: REVIEW_REGRESSIONS_SCHEMA, findings: structuredClone(assessments)},
    reviewOracle: {version: REVIEW_REGRESSIONS_SCHEMA, split: heldout ? 'heldout' : 'seeded', assessments, highImpact: assessments.filter(a => a.severity === 'high').map(a => a.kind), requiredScenarios: assessments.map(a => a.kind), fixtureDigest: digest(files)},
    prompt: 'Review README.md and its callers, consumers, inputs and guards, read-only and offline. Return raw JSON exactly {schema:"' + REVIEW_REGRESSIONS_SCHEMA + '",findings:[{kind,disposition,severity,consequence,proof,counterexample,recommendation,evidence:[{path,line,text}]}]}. Assess every candidate scenario, including nonfindings; no issue count target. disposition is finding, disproved or unresolved; severity is low, medium, high or critical for findings, null otherwise. Evidence is exact source text, relative paths and one-based integer lines. Cite complete causal slices, not only suspicious implementations. Vocabulary (unmapped alternatives): ' + JSON.stringify(vocabulary) + '. Scenario IDs name local inputs or source-only C# comparisons, not proof you ran them. Do not confuse shorter completion delay with total request rate, or a partial inventory with absence. No files may change. ' + limitations.join(' ') };
}

/** Extend the existing exact-source evaluator, not a separate ranking or weighted score.
 * Unsupported finite fields deliberately invalidate that assessment's evidence before the
 * existing grounder computes TP/FP/duplicates/recall. Controls use the same grounder but
 * are never counted as defects. No inference of agent execution or prose truth is made.
 * @param {import('./cases.mjs').Case} spec @param {unknown} answer
 * @returns {import('./reviews.mjs').ReviewScore & {regressions:RegressionDiagnostics}} */
export function scoreReviewRegressions(spec, answer) {
  const value = object(answer), controller = /** @type {Controller} */ (spec.reviewOracle);
  assert.equal(controller.version, REVIEW_REGRESSIONS_SCHEMA);
  assert.equal(controller.fixtureDigest, digest(spec.files), 'stale regression oracle');
  assert.deepEqual(Object.keys(value).sort(), ['findings', 'schema']);
  assert.equal(value.schema, REVIEW_REGRESSIONS_SCHEMA);
  assert.ok(Array.isArray(value.findings) && value.findings.length <= 100, 'bounded assessments');
  const ground = (expected, findings) => scoreReview({...spec, id: 'review-evidence', expected: {findings: expected}}, {findings});
  const expected = controller.assessments.filter(a => a.disposition === 'finding').map(a => ({kind:a.kind, evidence:a.evidence}));
  /** @type {RegressionDiagnostics} */
  const d = {version: REVIEW_REGRESSIONS_SCHEMA, basis:'finite-oracle/exact-source-structural-evidence', assessedClaims: value.findings.length, invalidEvidence:0, callerConsumerOmissions:0, unsupportedConsequences:0, unsupportedProofs:0, unsupportedCounterexamples:0, invalidDispositions:0, invalidSeverities:0, unsupportedRecommendations:0, correctNonfindings:0, violations:0, expectedHighImpact:controller.highImpact.length, validatedHighImpact:0, missedHighImpact:[], requestedScenarios:controller.requiredScenarios.length, coveredScenarios:0, missingScenarios:[], scenarioCoverage:0, reproducibleAssessments:0, manualAdjudicationRequired:true, agentTestExecution:'unobserved', limitations:[...limitations]};
  const seen = new Set(), covered = new Set();
  const findings = [];
  for (const raw of value.findings) {
    const a = object(raw);
    assert.deepEqual(Object.keys(a).sort(), ['consequence','counterexample','disposition','evidence','kind','proof','recommendation','severity']);
    for (const key of ['kind','consequence','proof','counterexample','recommendation']) assert.ok(typeof a[key] === 'string' && a[key].length > 0 && a[key].length <= 128, 'bounded assessment ID');
    assert.ok(['finding','disproved','unresolved'].includes(String(a.disposition)), 'disposition');
    assert.ok(a.severity === null || typeof a.severity === 'string' && ['low','medium','high','critical'].includes(a.severity), 'severity');
    const c = controller.assessments.find(c => c.kind === a.kind);
    const f = {kind: a.kind, evidence: a.evidence};
    const grounded = ground(c ? [c] : [], [f]).truePositives === 1; // Strict evidence schema, even for unknown IDs.
    d.invalidEvidence += Number(!grounded);
    if (c) {
      const supplied = /** @type {Evidence[]} */ (a.evidence);
      d.callerConsumerOmissions += Number(c.evidence.some(e => !supplied.some(s => canonical(e) === canonical(s))));
    }
    const fields = [['consequence','unsupportedConsequences'],['proof','unsupportedProofs'],['counterexample','unsupportedCounterexamples'],['disposition','invalidDispositions'],['severity','invalidSeverities'],['recommendation','unsupportedRecommendations']];
    let invalid = !grounded || !c;
    for (const [key, diagnostic] of fields) if (!c || a[key] !== c[key]) { d[diagnostic]++; invalid = true; }
    const rejectFinding = invalid;
    const duplicate = seen.has(a.kind); seen.add(a.kind);
    if (duplicate) invalid = true;
    d.violations += Number(invalid);
    if (!invalid) { covered.add(a.kind); d.correctNonfindings += Number(a.disposition !== 'finding'); d.reproducibleAssessments++; }
    if (a.disposition === 'finding') findings.push(rejectFinding ? {...f, evidence:[.../** @type {Evidence[]} */ (a.evidence), {path:'__private_oracle_rejection__',line:1,text:''}]} : f);
  }
  const scored = ground(expected, findings);
  d.missedHighImpact = controller.highImpact.filter(kind => scored.missed.includes(kind));
  d.validatedHighImpact = d.expectedHighImpact - d.missedHighImpact.length;
  d.missingScenarios = controller.requiredScenarios.filter(kind => !covered.has(kind));
  d.coveredScenarios = d.requestedScenarios - d.missingScenarios.length;
  d.scenarioCoverage = d.coveredScenarios / d.requestedScenarios;
  return {...scored, regressions:d};
}

/** Trusted controller qualification: no files, sockets, SDKs, installation or service mutations.
 * Executes actual supplied TS/JS module bytes after Node type stripping and data-URL linking;
 * shell functions are actual fixture pipelines with inert local CLI doubles.
 * This is NOT an agent execution audit. C# stays explicitly source-only.
 * @param {import('./cases.mjs').Case} spec */
export async function probeRegressionReviewFixture(spec) {
  assert.ok(REVIEW_REGRESSION_CASES.includes(spec.id));
  const heldout = spec.id.endsWith('-heldout');
  const program = `import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import path from 'node:path';
const files = ${JSON.stringify(spec.files)}, heldout = ${heldout};
const urls = new Map();
function link(file) {
  if (urls.has(file)) return urls.get(file);
  let source = file.endsWith('.ts') ? stripTypeScriptTypes(files[file]) : files[file];
  source = source.replace(/from '([^']+)'/g, (_, relative) => "from '" + link(path.posix.join(path.posix.dirname(file), relative)) + "'");
  const url = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64'); urls.set(file,url); return url;
}
const {job} = await import(link('src/job.ts')), config = JSON.parse(files['config/inventory.json']);
assert.deepEqual(job(config).deleteCandidates, heldout ? [] : [config.saved[1]]);
assert.deepEqual(job({...config,dryRun:true}).deleteCandidates, []);
assert.deepEqual(job({...config,pages:[{items:config.saved}]}).deleteCandidates, []);
assert.deepEqual(job({...config,pages:[{items:[config.saved[0]]}]}).deleteCandidates, [config.saved[1]]);
assert.deepEqual(job({...config,pages:config.pages.toReversed()}).deleteCandidates, heldout ? [] : [config.saved[1]]);
const {submit,submitAwaited} = await import(link('src/submit.mjs'));
const {DomainConflict} = await import(link('src/errors.mjs'));
const rejected = () => Promise.reject(new TypeError('fixture rejection'));
await assert.rejects(submit(rejected), TypeError);
await assert.rejects(submitAwaited(rejected), DomainConflict);
await assert.rejects(submit(() => {throw new TypeError('sync');}), DomainConflict);
assert.equal(await submit(() => Promise.resolve('ok')), 'ok');
const {dispatch,errorMiddleware} = await import(link('src/http.mjs'));
const request = () => new Request('http://fixture.invalid/submit',{method:'POST'});
assert.equal((await dispatch(request(),rejected)).status,500);
assert.equal((await dispatch(request(),rejected,submitAwaited)).status,409);
assert.equal((await dispatch(request(),() => {throw new Error('sync');})).status,409);
assert.equal((await dispatch(request(),() => Promise.resolve('ok'))).status,202);
assert.equal(errorMiddleware(new Error('unexpected')).status,500);
assert.equal((await dispatch(new Request('http://fixture.invalid/elsewhere'),rejected)).status,404);
const {compare} = await import(link('src/poll-job.mjs')), {poll} = await import(link('src/poll.mjs'));
const pair = compare(); assert.equal(pair.short.requests,30); assert.equal(pair.long.requests,30);
assert.equal(pair.short.ratePerSecond,3); assert.equal(pair.long.ratePerSecond,3);
assert.ok(pair.short.lastFinish < pair.long.lastFinish); assert.throws(() => poll(1000,10000,3));
const {clusterJob} = await import(link('src/cluster-job.mjs')), c = JSON.parse(files['config/cluster.json']);
assert.deepEqual(clusterJob(c).deleteCandidates,heldout ? [c.saved[1]] : []);
assert.deepEqual(clusterJob({...c,kube:{...c.kube,complete:false}}).deleteCandidates,[]);
assert.deepEqual(clusterJob({...c,dryRun:true}).deleteCandidates,[]);
assert.deepEqual(clusterJob({...c,helm:{complete:true,items:[]}}).deleteCandidates,[c.saved[1]]);
assert.deepEqual(clusterJob({...c,helm:{complete:true,items:[c.saved[1]]}}).deleteCandidates,[]);
console.log('fixture-contracts-ok');`;
  const env = {PATH:process.env.PATH, LANG:'C'};
  const run = (executable, args) => collect({executable, args, cwd:process.cwd(), env, timeoutMs:10000, maxOutputBytes:65536});
  const js = await run(process.execPath, ['--input-type=module','-e',program]);
  assert.ok(js.code === 0 && !js.stopReason && !js.spawnError, js.stderr || 'JS/TS regression probe failed');
  const shell = ['scripts/validator.sh','scripts/check.sh','scripts/release.sh','scripts/terraform.sh'].map(p => spec.files[p]).join('\n');
  let shellChecks = 0;
  for (const [command, code, admitted] of [
    ['validate_input invalid',7,false], ['release invalid',0,true], ['release valid',0,true],
    ['set -o pipefail; release invalid',7,false], ['set -o pipefail; release valid',0,true],
    ['PLAN_STATUS=0; plan_gate',0,true], ['PLAN_STATUS=1; plan_gate',1,false], ['PLAN_STATUS=2; plan_gate',2,false],
  ]) {
    const result = await run('bash',['--noprofile','--norc','-c',shell + '\n' + command]);
    assert.ok(!result.stopReason && !result.spawnError, 'shell probe incomplete');
    assert.equal(result.code,code,String(command));
    assert.equal(result.stdout.includes('admitted'),admitted,String(command) + ' consumer');
    shellChecks++;
  }
  const correctedTerraform = spec.files['scripts/terraform.sh'].replace('if [[ "$status" != 0 ]]', 'if [[ "$status" != 0 && "$status" != 2 ]]');
  for (const status of [0,1,2]) {
    const result = await run('bash',['--noprofile','--norc','-c',correctedTerraform + '\nPLAN_STATUS=' + status + '; plan_gate']);
    assert.ok(!result.stopReason && !result.spawnError, 'corrected Terraform probe incomplete');
    assert.equal(result.code,status === 1 ? 1 : 0,'corrected detailed-exitcode');
    assert.equal(result.stdout.includes('admitted'),status !== 1,'corrected status consumer');
    shellChecks++;
  }
  return {ok:true, version:REVIEW_REGRESSIONS_SCHEMA, fixtureDigest:digest(spec.files), split:heldout ? 'heldout' : 'seeded', nodeChecks:'passed', shellChecks,
    csharp:{status:'skipped',reason:'Source-only fixture; no SDK probe requested, no install or restore.'},
    http:'actual Request/Response middleware dispatch, no socket/network', agentTestExecution:'unobserved', manualAdjudicationRequired:true, limitations:[...limitations]};
}
