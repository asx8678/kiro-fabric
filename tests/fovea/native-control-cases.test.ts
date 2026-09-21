import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { controlsArgs, summarizeControlRun } from '../../scripts/fovea-controls-probe.mjs';
import { controlDecisionEvidence, extraControlProgram, RULE_FIXTURES, summarizeExtraControl } from '../../scripts/fovea-control-cases.mjs';
import { SESSION_TIMEOUT_MS, SESSION_PHASES, sessionDriver, sessionProgram, sessionProbeExit, summarizeSessionTransitions } from '../../scripts/fovea-session-probe.mjs';
import { typeCheckFabricCode } from '../../src/runtime/type-checker.js';
import { fabricGuestDeclarations } from '../../src/runtime/guest-types.js';
const result = { exitCode: 0, error: null, stopReason: null, cleanup: 'leader-closed' };
const row = (dir: string, msg: any) => ({ dir, msg });
const update = (u: any) => row('in', { method: 'session/update', params: { sessionId: 's', update: u } });

describe('bounded native control case programs', () => {
  it('typechecks every case against the actual guest API without native-tool or shell fallback', () => {
    for (const phase of ['rules', 'modes', ...SESSION_PHASES]) {
      const code = ['rules', 'modes'].includes(phase) ? extraControlProgram('case-nonce', phase) : sessionProgram('case-nonce', phase);
      expect(typeCheckFabricCode(code, fabricGuestDeclarations).errors, phase).toEqual([]);
      expect(code).not.toMatch(/local\.(shell|write|edit)|process\.|fetch\(/);
    }
  });
  it.each(['detach', 'initial', 'malformed'])('parses only the exact deferred detach receipt for %s', phase => {
    const packet = JSON.stringify({ marker: 'nonce', phase });
    const response = packet + '\n\nWorkspace transition: ' + (phase === 'malformed' ? '{' : JSON.stringify({ committed: true, status: 'unbound', nextExecutionRequired: true }));
    const frames = [update({ configOptions: [{ id: 'mode', currentValue: 'fovea-native-controls' }] }),
      row('out', { id: 1, method: 'session/prompt', params: { sessionId: 's', prompt: [{ type: 'text', text: 'nonce' }] } }),
      update({ sessionUpdate: 'tool_call', toolCallId: 'call', title: '@fabric/fabric_exec', rawInput: { code: 'return true;', resultFormat: 'json' } }),
      update({ sessionUpdate: 'tool_call_update', toolCallId: 'call', status: 'completed', rawOutput: { response } }), row('in', { id: 1, result: { stopReason: 'end_turn' } })];
    const report = summarizeControlRun({ frames, traces: [{ ev: 'tool.fabric_exec' }], result, marker: 'nonce', phase, code: 'return true;' });
    expect(report.completed).toBe(phase === 'detach');
    if (phase === 'detach') expect(report.transition).toMatchObject({ committed: true, status: 'unbound' });
  });
  it('validates opt-in arguments and incompatible options before filesystem setup', () => {
    expect(controlsArgs(['--authenticated', '--bundle', '/trusted', '--interactive', '--decision', 'decline'])).toEqual({ interactive: true, decision: 'decline', scenario: 'controls' });
    expect(controlsArgs(['--authenticated', '--bundle', '/trusted', '--interactive', '--decision', 'accept', '--case', 'rules'])).toMatchObject({ scenario: 'rules', decision: 'accept' });
    expect(controlsArgs(['--authenticated', '--bundle', '/trusted', '--case', 'lifecycle'])).toMatchObject({ interactive: false, scenario: 'lifecycle' });
    for (const tail of [['--decision', 'accept'], ['--case', 'lifecycle', '--interactive'], ['--interactive', '--interactive'], ['--case', 'unknown'], ['--decision', 'cancel']]) expect(() => controlsArgs(['--authenticated', '--bundle', '/trusted', ...tail])).toThrow();
    expect(() => sessionProgram('bad"', 'detach')).toThrow();
    expect(() => extraControlProgram('nonce', 'shell')).toThrow();
  });
  it('requires exact adoption/hash/anchor effects and an actual stale-source validation failure', () => {
    const sha256 = createHash('sha256').update(RULE_FIXTURES['.fovea/rules.json']).digest('hex');
    const packet: any = { before: { anchors: [] }, after: { anchors: ['/probe-approved/hello'] }, afterStale: { anchors: ['/probe-approved/hello'] }, sha256, rereadSha256: sha256,
      adoption: { ok: true, value: { adopted: true, sha256, sourceMutation: false } }, stale: { ok: false, error: 'Rule source changed; reread before adoption' },
      status: { capabilities: { automatic: false, hiddenDelivery: false, continuation: false } } };
    const report = () => summarizeExtraControl({ phase: 'rules', completed: true, packet }, true);
    expect(report()).toMatchObject({ effectsObserved: true, qualified: false, nativeUiPresentationQualified: false });
    packet.stale.error = 'approval cancelled'; expect(report().effectsObserved).toBe(false);
    packet.stale.error = 'Rule source changed; reread before adoption'; packet.adoption.value.sha256 = 'stale'; expect(report().effectsObserved).toBe(false);
    expect(summarizeExtraControl({ phase: 'rules', completed: false, packet }, true).effectsObserved).toBe(false);
    expect(summarizeExtraControl({ phase: 'rules', completed: true, packet }, false).diagnosticCompleted).toBe(false);
  });
  it('separates successful mode settings and explicit navigation from unsupported UI delivery', () => {
    const packet = { rows: ['enabled', 'hidden', 'disabled'].map(mode => {
      const settings = { config: { sync: { mode } } };
      return { mode, settings, configured: { ok: true, value: settings }, navigation: 'ok', status: { capabilities: { automatic: false, hiddenDelivery: false, continuation: false } } };
    }) };
    const report = () => summarizeExtraControl({ phase: 'modes', completed: true, packet }, true);
    expect(report()).toMatchObject({ effectsObserved: true, nativeUiPresentationQualified: false, automatic: false });
    packet.rows[1]!.configured.ok = false; expect(report().checks.allModesConfigured).toBe(false);
    packet.rows[2]!.status.capabilities.hiddenDelivery = true; expect(report().checks.automaticOff).toBe(false);
  });
});

function decisionRun(decision: 'accept' | 'decline') {
  const before = { revision: 'absent', config: { sync: { ackClean: false } } }, configured = { scope: 'session', config: { sync: { ackClean: true, mode: 'hidden' }, tools: { defaultBudget: 1024 } } };
  const replay = { ok: true, value: { resultId: 'retained', text: 'exact page' } };
  const rejected = { ok: false, error: 'Fovea result unavailable: revoked' };
  return { completed: true, formPairs: ['configure', 'reset', 'reload'].map(operation => ({ operation: 'repo.' + operation, reviewedArguments: operation === 'configure' ? { scope: 'session', expectedRevision: 'absent', config: configured.config } : {}, action: decision, approved: decision === 'accept', missingHandler: false })),
    packet: { settingsBefore: before, settingsConfigured: decision === 'accept' ? configured : before, configure: { ok: decision === 'accept', value: configured },
      reset: { ok: decision === 'accept' }, retainedBefore: replay, resetReplay: decision === 'accept' ? rejected : replay,
      reload: { ok: decision === 'accept', value: { restarted: true } }, settingsReloaded: before, reloadReplayBefore: replay, reloadReplay: decision === 'accept' ? rejected : replay,
      beforeReload: { engineStarts: 1 }, after: { engineStarts: decision === 'accept' ? 2 : 1 } } };
}
describe('native approval decisions and actual effects', () => {
  it.each(['accept', 'decline'] as const)('requires matched %s decisions and corresponding state effects', decision => {
    const run = decisionRun(decision);
    expect(controlDecisionEvidence(run, 'human-terminal', decision)).toMatchObject({ requestedDecisionObserved: true, humanApprovalQualified: false });
    expect(controlDecisionEvidence(run, 'headless', decision).requestedDecisionObserved).toBe(false);
    run.formPairs[1]!.missingHandler = true;
    expect(controlDecisionEvidence(run, 'human-terminal', decision).requestedDecisionObserved).toBe(false);
  });
  it('does not equate false effects, duplicate forms or cancellation with a genuine decision', () => {
    const run = decisionRun('accept'); run.packet.configure.ok = false;
    expect(controlDecisionEvidence(run, 'human-terminal', 'accept').requestedDecisionObserved).toBe(false);
    const declined = decisionRun('decline'); declined.formPairs.push(declined.formPairs[0]!);
    expect(controlDecisionEvidence(declined, 'human-terminal', 'decline').actions[0]!.effectVerified).toBe(false);
  });
  it.each(['valid', 'session', 'tool', 'typed-id', 'duplicate', 'error-and-accept', 'request-before-call', 'response-after-complete', 'request-after-complete'])('correlates %s form envelopes to the exact tool call', kind => {
    const form = row('in', { id: 9, method: '_kiro/mcp/elicitation', params: { sessionId: kind === 'session' ? 'other' : 's', toolCallId: kind === 'tool' ? 'other' : 'call', elicitation: { message: 'Risk: write\nAction: repo.reset\n{}' } } });
    const response = row('out', { id: kind === 'typed-id' ? '9' : 9, result: { action: 'accept', content: { approved: true } }, ...(kind === 'error-and-accept' ? { error: { message: 'failure' } } : {}) });
    const frames = [update({ configOptions: [{ id: 'mode', currentValue: 'fovea-native-controls' }] }), row('out', { id: 1, method: 'session/prompt', params: { sessionId: 's', prompt: [{ type: 'text', text: 'nonce' }] } }),
      update({ sessionUpdate: 'tool_call', toolCallId: 'call', title: '@fabric/fabric_exec', rawInput: { code: 'return true;', resultFormat: 'json' } }), form, response,
      ...(kind === 'duplicate' ? [response] : []),
      update({ sessionUpdate: 'tool_call_update', toolCallId: 'call', status: 'completed', rawOutput: { response: '{"marker":"nonce","phase":"initial"}' } }), row('in', { id: 1, result: { stopReason: 'end_turn' } })];
    if (kind === 'request-before-call') [frames[2], frames[3]] = [frames[3]!, frames[2]!];
    if (kind === 'response-after-complete') [frames[4], frames[5]] = [frames[5]!, frames[4]!];
    if (kind === 'request-after-complete') { const pair = frames.splice(3, 2); frames.splice(4, 0, ...pair); }
    const summary = summarizeControlRun({ frames, traces: [{ ev: 'tool.fabric_exec' }], result, code: 'return true;', marker: 'nonce', phase: 'initial' });
    expect(summary.formPairs.some((f: { operation: string | null; action: unknown; approved: boolean }) => f.operation === 'repo.reset' && f.action === 'accept' && f.approved)).toBe(kind === 'valid');
  });
});

function lifecycleFixture() {
  const plans = SESSION_PHASES.map((phase, i) => ({ phase, marker: phase + '-' + i + '-nonce', profile: i < 2 ? 'probe' : 'probe-alt' }));
  const frames: any[] = [];
  const runs = plans.map((p, i) => {
    const sessionId = i < 3 ? 'chat-a' : 'chat-b';
    if (i === 1) frames.push(row('out', { id: 21, method: '_kiro/session/compact', params: { sessionId: 'chat-a' } }), row('in', { id: 21, result: {} }));
    if (i === 2) frames.push(row('out', { id: 22, method: 'session/set_config_option', params: { sessionId: 'chat-a', configId: 'mode', value: 'probe-alt' } }), row('in', { id: 22, result: { configOptions: [{ id: 'mode', currentValue: 'probe-alt' }] } }));
    if (i === 3) frames.push(row('out', { id: 23, method: 'session/new', params: {} }), row('in', { id: 23, result: { sessionId } }));
    frames.push(row('out', { id: i + 1, method: 'session/prompt', params: { sessionId, prompt: [{ type: 'text', text: p.marker }] } }), row('in', { id: i + 1, result: { stopReason: 'end_turn' } }));
    return { ...p, sessionId, completed: true, exactCall: true, toolCallId: 'call-' + i,
      transition: i === 4 ? { committed: true, status: 'unbound', nextExecutionRequired: true } : null,
      packet: { fovea: { nativeHooks: { automatic: false }, automaticQualification: { ready: false }, modelInputAcknowledged: false }, lifecycle: { mcpInstanceId: 'mcp-instance' }, workspace: { status: i === 5 ? 'unbound' : 'bound', verification: i === 5 ? 'unbound' : 'verified' },
        before: { hostInstanceId: 'host' }, after: { capabilities: { automatic: false } }, seed: { status: 'ok' },
        detached: { status: 'pending', committed: false }, navigation: { ok: false, error: 'repo.focus action unavailable' } } };
  });
  return { frames, runs, plans };
}
describe('actual Fabric native lifecycle evidence', () => {
  it('requires acknowledged transitions, fresh calls and post-commit same-MCP revocation, without claiming isolation', () => {
    expect(summarizeSessionTransitions(lifecycleFixture())).toMatchObject({ diagnosticCompleted: true, qualified: false, stateRestorationQualified: false, isolationQualified: false });
  });
  it.each(['wrong-ack-id', 'wrong-swap', 'same-clear-session', 'replayed-call', 'new-mcp', 'pending-only', 'navigation-allowed', 'generic-error', 'unsettled'])('rejects %s', kind => {
    const f = lifecycleFixture();
    if (kind === 'wrong-ack-id') f.frames.find(x => x.dir === 'in' && x.msg.id === 21).msg.id = '21';
    if (kind === 'wrong-swap') f.frames.find(x => x.msg.method === 'session/set_config_option').msg.params.value = 'other';
    if (kind === 'same-clear-session') f.runs[3]!.sessionId = 'chat-a';
    if (kind === 'replayed-call') f.runs[1]!.toolCallId = f.runs[0]!.toolCallId;
    if (kind === 'new-mcp') f.runs[5]!.packet.lifecycle.mcpInstanceId = 'new-mcp';
    if (kind === 'pending-only') f.runs[4]!.transition!.committed = false;
    if (kind === 'navigation-allowed') f.runs[5]!.packet.navigation.ok = true;
    if (kind === 'generic-error') f.runs[5]!.packet.navigation.error = 'timeout';
    if (kind === 'unsettled') f.runs[2]!.completed = false;
    expect(summarizeSessionTransitions(f).diagnosticCompleted).toBe(false);
  });
  it.each(['retained', 'unavailable', 'missing', 'unmatched', 'same-chat'])('classifies %s prior focus without a fabricated native isolation pass', kind => {
    const f = lifecycleFixture();
    const before = f.runs[2]!.packet as any, after = f.runs[3]!.packet as any;
    before.seed.focusId = 'focus-before-clear';
    after.previousFocus = kind === 'unavailable' ? { ok: false, error: 'Unknown or expired focusId after root retirement; focus again' } : { ok: true, value: { focusId: 'focus-before-clear' } };
    if (kind === 'missing') delete before.seed.focusId;
    if (kind === 'unmatched') f.runs[3]!.exactCall = false;
    if (kind === 'same-chat') f.runs[3]!.sessionId = f.runs[2]!.sessionId;
    const report = summarizeSessionTransitions(f);
    expect(report.nativeSessionIsolation.previousFocusRetained).toBe(kind === 'retained' ? true : kind === 'unavailable' ? false : null);
    expect(report.nativeSessionIsolation.status).toBe(kind === 'retained' ? 'failed' : 'unqualified');
    expect(report.isolationQualified).toBe(false);
    expect(sessionProbeExit(report)).toBe(['same-chat', 'unmatched'].includes(kind) ? 2 : kind === 'retained' ? 3 : 0);
    expect(sessionProbeExit({ ...report, diagnosticCompleted: false })).toBe(2);
  });
  it('driver uses native slash commands, never approvals or private protocol requests', () => {
    expect(SESSION_TIMEOUT_MS).toBeGreaterThan(0); expect(SESSION_TIMEOUT_MS).toBeLessThanOrEqual(300000);
    const driver = sessionDriver('probe', 'probe-alt');
    for (const command of ['/compact', '/agent swap probe-alt', '/clear']) expect(driver).toContain(command);
    expect(driver).toContain('waitfile');
    expect(driver).not.toMatch(/elicitation|approved|trust-all|session\/|settings set/);
    expect(() => sessionDriver('bad;exec', 'probe-alt')).toThrow();
  });
});
