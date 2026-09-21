import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { extraDecisionEvidence, RULE_FIXTURES } from '../../scripts/fovea-control-cases.mjs';
import { HUMAN_CASES, main, runHumanMatrix, summarizeHumanMatrix } from '../../scripts/fovea-human-qualification.mjs';

function extraRun(scenario: string, decision: string): any {
  const accept = decision === 'accept';
  const status = { capabilities: { automatic: false, hiddenDelivery: false, continuation: false } };
  if (scenario === 'rules') {
    const sha256 = createHash('sha256').update(RULE_FIXTURES['.fovea/rules.json']).digest('hex');
    const stale = (sha256[0] === '0' ? '1' : '0') + sha256.slice(1);
    const before = { anchors: [] }, after = { anchors: accept ? ['/probe-approved/hello'] : [] };
    return { phase: 'rules', exactCall: true, completed: true,
      formPairs: [sha256, stale].map(hash => ({ operation: 'repo.adoptRules', reviewedArguments: { expectedSha256: hash }, action: decision, approved: accept })),
      packet: { before, after, afterStale: after, sha256, rereadSha256: sha256, status,
        adoption: { ok: accept, value: { adopted: true, sha256, sourceMutation: false } },
        stale: { ok: false, error: accept ? 'Rule source changed; reread before adoption' : 'approval declined' } } };
  }
  let previous = { scope: 'defaults', revision: 'absent', config: { sync: { mode: 'enabled', ackClean: false } } };
  const formPairs: any[] = [];
  const rows = ['enabled', 'hidden', 'disabled'].map((mode, i) => {
    const before = previous, config = { ...before.config, sync: { ...before.config.sync, mode } };
    const settings = accept ? { scope: 'session', revision: 'r' + i, config } : before;
    formPairs.push({ operation: 'repo.configure', reviewedArguments: { scope: 'session', expectedRevision: before.revision, config }, action: decision, approved: accept });
    previous = settings;
    return { mode, before, settings, configured: { ok: accept, value: settings }, navigation: 'ok', status };
  });
  return { phase: 'modes', exactCall: true, completed: true, formPairs, packet: { rows } };
}

describe('exact human rule and setting decisions', () => {
  it.each(['rules', 'modes'])('checks both decisions for %s without claiming qualification', scenario => {
    for (const decision of ['accept', 'decline']) {
      const run = extraRun(scenario, decision);
      expect(extraDecisionEvidence(run, 'human-terminal', decision)).toMatchObject({ requestedDecisionObserved: true, humanApprovalQualified: false });
      expect(extraDecisionEvidence(run, 'headless', decision).requestedDecisionObserved).toBe(false);
      expect(extraDecisionEvidence(run, 'human-terminal', decision === 'accept' ? 'decline' : 'accept').requestedDecisionObserved).toBe(false);
    }
  });
  it.each(['hash', 'mode', 'revision', 'reorder', 'duplicate', 'missing-review', 'cancel', 'not-approved', 'handler', 'unknown-argument', 'wrong-root', 'incomplete', 'not-exact', 'false-effect', 'automatic'])('rejects %s', defect => {
    const scenario = defect === 'hash' ? 'rules' : 'modes';
    const run = extraRun(scenario, 'accept');
    const form = run.formPairs[0];
    if (defect === 'hash') form.reviewedArguments.expectedSha256 = '0'.repeat(64);
    if (defect === 'mode') form.reviewedArguments.config = { sync: { mode: 'hidden' } };
    if (defect === 'revision') form.reviewedArguments.expectedRevision = 'wrong';
    if (defect === 'reorder') run.formPairs.reverse();
    if (defect === 'duplicate') run.formPairs.push(form);
    if (defect === 'missing-review') delete form.reviewedArguments;
    if (defect === 'cancel') form.action = 'cancel';
    if (defect === 'not-approved') form.approved = false;
    if (defect === 'handler') form.missingHandler = true;
    if (defect === 'unknown-argument') form.reviewedArguments.trust = true;
    if (defect === 'wrong-root') form.reviewedArguments.rootId = 'another-root';
    if (defect === 'incomplete') run.completed = false;
    if (defect === 'not-exact') run.exactCall = false;
    if (defect === 'false-effect') run.packet.rows[0].configured.ok = false;
    if (defect === 'automatic') run.packet.rows[0].status.capabilities.automatic = true;
    expect(extraDecisionEvidence(run, 'human-terminal', 'accept').requestedDecisionObserved).toBe(false);
  });
  it.each(['rules', 'modes'])('accepts only the normalized verified root for %s', scenario => {
    const run = extraRun(scenario, 'accept');
    if (scenario === 'rules') run.packet.status.rootId = 'verified-root';
    else run.packet.rows.forEach((row: any) => { row.status.rootId = 'verified-root'; });
    run.formPairs.forEach((form: any) => { form.reviewedArguments.rootId = 'verified-root'; });
    expect(extraDecisionEvidence(run, 'human-terminal', 'accept').requestedDecisionObserved).toBe(true);
    run.formPairs[0].reviewedArguments.rootId = 'foreign-root';
    expect(extraDecisionEvidence(run, 'human-terminal', 'accept').requestedDecisionObserved).toBe(false);
  });
  it('requires unchanged state after decline and real stale-hash validation after acceptance', () => {
    const rules = extraRun('rules', 'decline'); rules.packet.after = { anchors: ['/probe-approved/hello'] };
    expect(extraDecisionEvidence(rules, 'human-terminal', 'decline').requestedDecisionObserved).toBe(false);
    const modes = extraRun('modes', 'decline'); modes.packet.rows[0].settings = { config: { sync: { mode: 'hidden' } } };
    expect(extraDecisionEvidence(modes, 'human-terminal', 'decline').requestedDecisionObserved).toBe(false);
    const accepted = extraRun('rules', 'accept'); accepted.packet.stale.error = 'approval cancelled';
    expect(extraDecisionEvidence(accepted, 'human-terminal', 'accept').requestedDecisionObserved).toBe(false);
  });
});

function matrixRows(): any[] {
  return HUMAN_CASES.map((c, i) => {
    const operations = c.scenario === 'controls' ? ['configure', 'reset', 'reload'] : c.scenario === 'rules' ? ['adoptRules:exact', 'adoptRules:stale'] : ['configure:enabled', 'configure:hidden', 'configure:disabled'];
    return { ...c, exitCode: 0, evidence: '/private/fixture-' + i, report: {
      kind: c.scenario === 'controls' ? 'kiro-fabric.native-controls-probe' : 'kiro-fabric.native-extra-control-probe', case: c.scenario,
      qualified: false, automatic: false, diagnosticCompleted: true, bundleUnchanged: true, fixtureUnchanged: true, bundleDigest: 'a'.repeat(64),
      controlsObserved: c.decision === 'accept', effectsObserved: c.decision === 'accept', checks: { sourceMatched: true, automaticStillDisabled: true, automaticOff: true },
      nativeRun: { marker: 'nonce-' + i, sessionId: 'chat-' + i, toolCallId: 'call-' + i },
      approvalObservations: { interaction: 'human-terminal', requestedDecision: c.decision, requestedDecisionObserved: true,
        actions: operations.map(operation => ({ operation, decision: c.decision, effectVerified: true })) } } };
  });
}

describe('human-owned qualification matrix', () => {
  it('requires six distinct exact cases but never promotes automatic integration', () => {
    expect(summarizeHumanMatrix(matrixRows())).toMatchObject({ matrixObserved: true, qualified: false, automatic: false });
    expect(summarizeHumanMatrix([])).toMatchObject({ matrixObserved: false });
  });
  it.each(['missing', 'extra', 'reordered', 'replay-root', 'replay-marker', 'replay-call', 'changed-bundle', 'bad-digest', 'failed-exit', 'incomplete', 'fixture-drift', 'bundle-drift', 'automatic', 'qualified', 'headless', 'decision', 'missing-action', 'wrong-action', 'false-effect'])('rejects matrix %s', defect => {
    const rows = matrixRows(), first = rows[0], r = first.report, a = r.approvalObservations;
    if (defect === 'missing') rows.pop();
    if (defect === 'extra') rows.push(rows[0]);
    if (defect === 'reordered') rows.reverse();
    if (defect === 'replay-root') rows[1].evidence = rows[0].evidence;
    if (defect === 'replay-marker') rows[1].report.nativeRun.marker = r.nativeRun.marker;
    if (defect === 'replay-call') rows[1].report.nativeRun = { ...r.nativeRun, marker: 'fresh-nonce' };
    if (defect === 'changed-bundle') rows[1].report.bundleDigest = 'b'.repeat(64);
    if (defect === 'bad-digest') r.bundleDigest = 'unverified';
    if (defect === 'failed-exit') first.exitCode = 2;
    if (defect === 'incomplete') r.diagnosticCompleted = false;
    if (defect === 'fixture-drift') r.fixtureUnchanged = false;
    if (defect === 'bundle-drift') r.bundleUnchanged = false;
    if (defect === 'automatic') r.automatic = true;
    if (defect === 'qualified') r.qualified = true;
    if (defect === 'headless') a.interaction = 'headless';
    if (defect === 'decision') a.requestedDecision = 'decline';
    if (defect === 'missing-action') a.actions.pop();
    if (defect === 'wrong-action') a.actions[0].operation = 'other';
    if (defect === 'false-effect') a.actions[0].effectVerified = false;
    expect(summarizeHumanMatrix(rows).matrixObserved).toBe(false);
  });
  it.each(['complete', 'blocked', 'throw', 'duplicate-report'])('checkpoints %s and stops without generating approvals', async mode => {
    const fixtures = matrixRows(), checkpoints: any[] = [], calls: string[][] = [];
    const code = await runHumanMatrix('/trusted/bundle', report => { checkpoints.push(report); }, async (argv, record) => {
      const i = calls.length; calls.push(argv);
      if (mode === 'throw') throw Error('client prerequisite failed');
      const fixture = fixtures[i];
      if (mode === 'blocked') fixture.report.approvalObservations.requestedDecisionObserved = false;
      record(fixture.report, fixture.evidence);
      if (mode === 'duplicate-report') record(fixture.report, fixture.evidence);
      return 0;
    });
    expect(code).toBe(mode === 'complete' ? 0 : 2);
    expect(calls).toHaveLength(mode === 'complete' ? 6 : 1);
    expect(checkpoints).toHaveLength(calls.length);
    calls.forEach((args, i) => expect(args).toEqual(['--authenticated', '--bundle', '/trusted/bundle', '--interactive', '--case', HUMAN_CASES[i]!.scenario, '--decision', HUMAN_CASES[i]!.decision]));
  });
  it('requires explicit bounded arguments and a real terminal before touching a bundle', async () => {
    for (const args of [[], ['--authenticated'], ['--authenticated', '--bundle', '/missing', '--auto-approve']]) await expect(main(args)).rejects.toThrow();
    const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
    try { await expect(main(['--authenticated', '--bundle', '/does-not-exist'])).rejects.toThrow('requires your terminal'); }
    finally { if (descriptor) Object.defineProperty(process.stdin, 'isTTY', descriptor); else Reflect.deleteProperty(process.stdin, 'isTTY'); }
  });
});
