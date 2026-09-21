#!/usr/bin/env node
// Human-operated sequence, not an auto-approver or a production gate promotion.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { main as controlsMain } from './fovea-controls-probe.mjs';

export const HUMAN_CASES = Object.freeze(['controls', 'rules', 'modes'].flatMap(scenario =>
  ['accept', 'decline'].map(decision => Object.freeze({ scenario, decision }))));

export function summarizeHumanMatrix(rows) {
  const seenRoots = new Set(), seenMarkers = new Set(), seenCalls = new Set();
  let bundleDigest;
  const cases = HUMAN_CASES.map((expected, i) => {
    const row = rows[i], report = row?.report, approval = report?.approvalObservations;
    const native = report?.nativeRun;
    const digest = report?.bundleDigest;
    const call = JSON.stringify([native?.sessionId, native?.toolCallId]);
    const fresh = typeof row?.evidence === 'string' && path.isAbsolute(row.evidence) && !seenRoots.has(row.evidence) &&
      typeof native?.marker === 'string' && native.marker.length > 0 && !seenMarkers.has(native.marker) &&
      typeof native?.sessionId === 'string' && native.sessionId.length > 0 && typeof native?.toolCallId === 'string' && native.toolCallId.length > 0 && !seenCalls.has(call);
    if (row) { seenRoots.add(row.evidence); seenMarkers.add(native?.marker); seenCalls.add(call); }
    if (i === 0) bundleDigest = digest;
    const operations = expected.scenario === 'controls' ? ['configure', 'reset', 'reload'] : expected.scenario === 'rules' ? ['adoptRules:exact', 'adoptRules:stale'] : ['configure:enabled', 'configure:hidden', 'configure:disabled'];
    const actions = approval?.actions;
    const observed = Boolean(row?.scenario === expected.scenario && row?.decision === expected.decision && row?.exitCode === 0 && fresh &&
      /^[a-f0-9]{64}$/u.test(digest ?? '') && digest === bundleDigest && report?.qualified === false && report?.automatic === false &&
      report?.kind === (expected.scenario === 'controls' ? 'kiro-fabric.native-controls-probe' : 'kiro-fabric.native-extra-control-probe') &&
      (expected.scenario === 'controls' || report.case === expected.scenario) &&
      report.diagnosticCompleted === true && report.bundleUnchanged === true && report.fixtureUnchanged === true &&
      (expected.scenario === 'controls' ? report.checks?.sourceMatched === true && report.checks?.automaticStillDisabled === true : report.checks?.automaticOff === true) &&
      (expected.decision !== 'accept' || (expected.scenario === 'controls' ? report.controlsObserved === true : report.effectsObserved === true)) &&
      approval?.interaction === 'human-terminal' && approval.requestedDecision === expected.decision && approval.requestedDecisionObserved === true &&
      Array.isArray(actions) && actions.length === operations.length && operations.every((operation, j) => actions[j]?.operation === operation && actions[j]?.decision === expected.decision && actions[j]?.effectVerified === true));
    return { ...expected, status: observed ? 'observed' : row ? 'blocked' : 'pending', evidence: row?.evidence ?? null };
  });
  return { schemaVersion: 1, kind: 'kiro-fabric.human-control-matrix', qualified: false, automatic: false,
    cases, matrixObserved: rows.length === HUMAN_CASES.length && cases.every(c => c.status === 'observed'),
    remaining: ['supported native session isolation', 'intended-turn delivery and all automatic H01-H12 gates', 'approval revocation and authoritative tool inventory'] };
}

// Runner injection is a unit-test seam, never an evidence-import CLI option.
/**
 * @param {string} bundleRoot
 * @param {(report: any) => void | Promise<void>} checkpoint
 * @param {(argv: string[], capture: (report: any, root: string) => void) => Promise<number>} [runner]
 */
export async function runHumanMatrix(bundleRoot, checkpoint, runner = controlsMain) {
  const rows = [];
  for (const item of HUMAN_CASES) {
    const captures = [];
    let exitCode, error;
    try {
      exitCode = await runner(['--authenticated', '--bundle', bundleRoot, '--interactive', '--case', item.scenario, '--decision', item.decision],
        (report, evidence) => { captures.push({ report, evidence }); });
    } catch (cause) { exitCode = 2; error = String(cause); }
    rows.push({ ...item, exitCode, ...(captures.length === 1 ? captures[0] : {}), ...(error ? { error } : {}) });
    const report = summarizeHumanMatrix(rows);
    await checkpoint({ ...report, rows });
    if (report.cases[rows.length - 1].status !== 'observed') return 2;
  }
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log('Usage: node scripts/fovea-human-qualification.mjs --authenticated --bundle TRUSTED_CURRENT_BUNDLE\nRequires your terminal. Runs controls/rules/modes accept and decline in six fresh private workspaces. Review each request yourself; /quit after each turn. No choice is automated. Stops at the first blocked case and preserves checkpoints. Exit 0 means six observed cases, NOT automatic/native release qualification. No installation or live profile edits.');
    return 0;
  }
  if (argv.length !== 3 || argv[0] !== '--authenticated' || argv[1] !== '--bundle' || !argv[2] || argv[2].startsWith('--')) throw Error('Explicit --authenticated --bundle TRUSTED_CURRENT_BUNDLE required');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error('Human qualification requires your terminal; no responses can be automated');
  const bundleRoot = fs.realpathSync(argv[2]);
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'fovea-human-matrix-')); fs.chmodSync(root, 0o700);
  let count = 0;
  console.log(`Private matrix evidence: ${root}\nSix separate cases. Explicitly decline with the native decline action, not cancellation. In the rules accept case, approve the deliberately stale request so Fabric can reject its hash. /quit after each completed turn.`);
  return runHumanMatrix(bundleRoot, report => {
    const file = path.join(root, `checkpoint-${++count}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ evidence: file, matrixObserved: report.matrixObserved, cases: report.cases }, null, 2));
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 2; });
