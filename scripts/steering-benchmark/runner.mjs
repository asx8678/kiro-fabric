import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { makeCase, caseHashes } from './cases.mjs';
import { createPlan, verifyPlan, budgetGate, ARMS } from './plan.mjs';
import { collect, eventCollector, analyzeEvents } from './stream.mjs';
import { validate } from './oracles.mjs';
import { createNativeFixturePolicy, removeNativeFixturePolicy } from './native-policy.mjs';
import { object, readJson, save, digest, putFiles, inventory, errorText } from './core.mjs';
import { detailedStats } from './metrics.mjs';
import { reviewHelpDelivery } from './review-delivery.mjs';

/** @typedef {import('./plan.mjs').Plan} Plan */
/** @typedef {ReturnType<typeof reviewHelpDelivery>} ReviewDelivery */
/** @typedef {{index:number,arm:string,caseId:string,qualification:boolean,state:string,credits:number|null,stopReason:string|null,ok:boolean,startedAt:string,finishedAt?:string,validation?:import('./oracles.mjs').Validation,evidence?:import('./stream.mjs').Evidence,reviewHelp?:ReviewDelivery,process?:Omit<import('./stream.mjs').Collected,'stdout'|'stderr'>,error?:string,command?:{executable:string,args:string[],cwd:string},budget?:{spent:number,projected:number|null},nativePermission?:ReturnType<typeof createNativeFixturePolicy>}} Row */
/** @param {string} output */
export function privateOutput(output) { const root = fs.realpathSync(output), st = fs.lstatSync(output); assert.ok(st.isDirectory() && !st.isSymbolicLink() && (st.mode & 0o077) === 0, 'output must be a private non-symlink directory'); return root; }
/** @param {string} output @returns {Plan} */
export function loadPlan(output) {
  const root = privateOutput(output), envelope = object(readJson(path.join(root, 'plan.json')));
  assert.equal(envelope.sha256, digest(envelope.plan), 'plan digest mismatch');
  const plan = /** @type {Plan} */ (envelope.plan); assert.equal(plan.schemaVersion, 1, 'plan schema'); return plan;
}
/** @param {string} manifest @param {string} output */
export async function init(manifest, output) {
  assert.notEqual(process.platform, 'win32', 'POSIX live collection required');
  const plan = createPlan(manifest);
  fs.mkdirSync(output, { mode: 0o700 }); const root = privateOutput(output);
  const versions = [];
  for (const executable of [plan.config.cli, plan.config.python]) {
    const result = await collect({ executable, args: ['--version'], cwd: root, env: { ...process.env, ...plan.config.env }, maxOutputBytes: 65536, timeoutMs: 5000 });
    versions.push({ executable, ...result });
  }
  save(path.join(root, 'init-evidence.json'), versions);
  assert.ok(versions.every(v => v.code === 0 && !v.stopReason && !v.spawnError), 'version preflight failed; retain directory, initialize elsewhere');
  fs.mkdirSync(path.join(root, 'results'), { mode: 0o700 }); fs.mkdirSync(path.join(root, 'runs'), { mode: 0o700 });
  const frozen = { ...plan, versions }; save(path.join(root, 'plan.json'), { plan: frozen, sha256: digest(frozen) });
  return { output: root, runs: plan.runs.length, model: plan.config.model ?? 'auto', effort: plan.config.effort ?? null, plannedCredits: plan.config.plannedCredits, reserveCredits: plan.config.reserveCredits, liveRequests: 0 };
}
/** @param {string} root @returns {Row[]} */
export function rows(root) {
  const directory = path.join(root, 'results');
  const names = fs.readdirSync(directory).sort(); assert.ok(names.every(n => /^\d{4}\.json$/.test(n)), 'unexpected results entry');
  return names.map((name, index) => { const row = /** @type {Row} */ (readJson(path.join(directory, name))); assert.equal(row.index, index, 'incomplete/out-of-order results'); return row; });
}
/** @param {string} root @param {Row} row */
function updateRow(root, row) {
  const file = path.join(root, 'results', String(row.index).padStart(4, '0') + '.json'), temporary = file + '.pending';
  save(temporary, row); fs.renameSync(temporary, file);
}
/** @param {Plan} plan @param {import('./plan.mjs').Run} item @param {string} workspace @param {string} prompt */
export function commandFor(plan, item, workspace, prompt) {
  const args = ['chat', '--v3', '--model', plan.config.model ?? 'auto', '--no-interactive', '--output-format', 'stream-json'];
  if (plan.config.effort) args.push('--effort', plan.config.effort);
  if (item.arm !== 'native') args.push('--agent', 'steering-' + item.arm, '--require-mcp-startup');
  else args.push('--trust-tools=' + (plan.config.nativeTrustTools ?? ['fs_read', 'fs_write', 'shell']).join(','));
  args.push(prompt); return { executable: plan.config.cli, args, cwd: workspace };
}
/** Exactly-once admission: a durable started row is written before spawn. An interrupted/unknown row blocks continuation.
 * @param {string} output @param {number} [index] @param {AbortSignal} [signal] */
export async function runOne(output, index, signal) {
  const root = privateOutput(output), lock = path.join(root, 'run.lock'); fs.mkdirSync(lock, { mode: 0o700 });
  try {
    const plan = loadPlan(root); verifyPlan(plan);
    const previous = rows(root), next = index ?? previous.length; assert.equal(next, previous.length, 'reruns/out-of-order execution refused');
    const item = plan.runs[next]; assert.ok(item, 'no planned run at index');
    const budget = budgetGate(plan.config, previous, plan.runs.length);
    assert.ok(!signal?.aborted, 'canceled before admission');
    const spec = makeCase(item.caseId, item.seed, plan.config.python); assert.deepEqual(caseHashes(spec), item.hashes, 'prompt/fixture drift');
    const base = path.join(root, 'runs', String(next).padStart(4, '0')), workspace = path.join(base, 'workspace');
    fs.mkdirSync(base, { mode: 0o700 }); fs.mkdirSync(workspace, { mode: 0o700 });
    /** @type {Row} */ const row = { index: next, arm: item.arm, caseId: item.caseId, qualification: item.qualification, state: 'started', credits: null, stopReason: null, ok: false, startedAt: new Date().toISOString(), budget };
    save(path.join(root, 'results', String(next).padStart(4, '0') + '.json'), row);
    try {
      putFiles(workspace, spec.files); fs.writeFileSync(path.join(base, 'prompt.txt'), spec.prompt, { mode: 0o600, flag: 'wx' });
      if (item.arm !== 'native') {
        const snapshot = plan.identity.profiles[item.arm];
        putFiles(workspace, { [`.kiro/agents/steering-${item.arm}.json`]: JSON.stringify({ ...snapshot.profile, name: 'steering-' + item.arm }) + '\n' });
      }
      if (item.arm === 'native' && plan.config.nativeWorkspacePermissions) {
        row.nativePermission = createNativeFixturePolicy(workspace, plan.config.python); updateRow(root, row);
      }
      const before = inventory(workspace); save(path.join(base, 'before.json'), before);
      row.command = commandFor(plan, item, workspace, spec.prompt); save(path.join(base, 'command.json'), row.command);
      const stream = eventCollector(plan.config.maxCalls);
      const result = await collect({ ...row.command, env: { ...process.env, ...plan.config.env, KIRO_FABRIC_LAUNCH_WORKSPACE: workspace }, maxOutputBytes: plan.config.maxOutputBytes, timeoutMs: plan.config.timeoutMs, stdoutPath: path.join(base, 'client.jsonl'), stderrPath: path.join(base, 'stderr.log'), signal, onLine: stream.onLine });
      const { stdout: _stdout, stderr: _stderr, ...metrics } = result; row.process = metrics;
      row.evidence = analyzeEvents(stream.events); row.credits = row.evidence.credits;
      if (item.arm !== 'native' && item.caseId.startsWith('review-')) row.reviewHelp = reviewHelpDelivery(row.evidence, plan.identity.profiles[item.arm]?.reviewHelp?.text);
      row.stopReason = result.stopReason ?? (result.spawnError || result.code !== 0 ? 'client-failure' : row.evidence.failures.length ? 'incomplete-events' : row.credits === null ? 'missing-usage' : row.credits > plan.config.singleRunCreditLimit ? 'single-run-credit-limit' : null);
      // Persist charge evidence before running any oracle or candidate-code probe.
      updateRow(root, row);
      row.validation = await validate({ spec, workspace, before, evidence: row.evidence, arm: item.arm, expectedMode: item.arm === 'native' ? plan.config.nativeMode : 'steering-' + item.arm, expectedModel: plan.config.model ?? 'auto', expectedEffort: plan.config.effort, python: plan.config.python, processOk: !row.stopReason && result.code === 0 && !stream.malformed });
      row.ok = row.validation.ok;
      if (row.validation.failures.some(f => f.check === 'scope' || f.check === 'identity')) row.stopReason ??= 'scope-or-identity-failure';
      try { verifyPlan(plan); } catch (error) { row.stopReason ??= 'post-run-drift'; row.ok = false; row.error = errorText(error); }
    } catch (error) { row.error = errorText(error); row.stopReason ??= 'execution-error'; row.ok = false; }
    finally {
      if (row.nativePermission) {
        try { removeNativeFixturePolicy(row.nativePermission); }
        catch (error) { row.stopReason ??= 'native-policy-cleanup-failure'; row.ok = false; row.error = errorText(error); }
      }
      row.state = 'finished'; row.finishedAt = new Date().toISOString(); updateRow(root, row);
    }
    if (next >= 7) {
      row.budget = { spent: previous.reduce((n, r) => n + Number(r.credits), 0) + (row.credits ?? 0), projected: row.credits === null || previous.some(r => r.credits === null) ? null : (previous.reduce((n, r) => n + Number(r.credits), 0) + row.credits) / (next + 1) * plan.runs.length };
      updateRow(root, row);
    }
    return row;
  } finally { fs.rmdirSync(lock); }
}
/** All executed rows contribute to charges/failures, even canceled attempts. Help qualification is outside comparisons for ALL arms.
 * @param {Row[]} all */
export function summarizeRows(all) {
  /** @param {Row[]} selected */
  const stats = selected => {
    const common = detailedStats(selected);
    const knownCredits = selected.reduce((n, r) => n + (typeof r.credits === 'number' && Number.isFinite(r.credits) && r.credits >= 0 ? r.credits : 0), 0);
    return { attempts: common.attempts, passes: common.passes,
      wallMs: common.wallMs, wallCoverage: common.wallCoverage,
      outerToolCalls: common.outerToolCalls, toolCallCoverage: common.toolCallCoverage,
      fixtureExecutionRecords: selected.reduce((n, r) => n + (r.validation?.audit?.length ?? 0), 0), innerEffects: common.innerEffects, peakConcurrency: null,
      failures: selected.filter(r => !r.ok || r.state !== 'finished').map(r => ({ index: r.index, caseId: r.caseId, state: r.state, stopReason: r.stopReason, error: r.error ?? null, checks: r.validation?.failures ?? [] })),
      knownReportedCredits: knownCredits, unreconciledCreditRows: selected.filter(r => r.credits === null).flatMap(r => (r.evidence?.usage ?? []).filter(u => u.unit === 'credit').map(usage => ({ index: r.index, usage }))),
      unknownChargeAttempts: selected.length - common.creditCoverage.observed, reportedCredits: common.reportedCredits, creditsPerPass: common.creditsPerSuccess };
  };
  return { allExecuted: stats(all), comparison: Object.fromEntries(ARMS.map(arm => [arm, stats(all.filter(r => r.arm === arm && !r.qualification))])), fabricHelpQualification: Object.fromEntries(ARMS.filter(a => a !== 'native').map(arm => [arm, stats(all.filter(r => r.arm === arm && r.qualification))])), rows: all };
}
/** @param {string} output */
export function summary(output) { const root = privateOutput(output), plan = loadPlan(root); return { plannedRuns: plan.runs.length, limitations: plan.limitations, ...summarizeRows(rows(root)) }; }
