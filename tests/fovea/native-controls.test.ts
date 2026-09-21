import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CONTROL_PROFILE, CONTROL_SOURCE, controlsProfile, controlsProgram, main, summarizeControlRun, summarizeControlStream, summarizeControls } from '../../scripts/fovea-controls-probe.mjs';
import { typeCheckFabricCode } from '../../src/runtime/type-checker.js';
import { fabricGuestDeclarations } from '../../src/runtime/guest-types.js';
import { DEFAULT_FOVEA_CONFIG } from '../../src/fovea/config.js';

const result = { exitCode: 0, error: null, stopReason: null, cleanup: 'leader-closed' };
const id = 'fr_' + 'a'.repeat(48);
const marker = 'initial-nonce';
const code = controlsProgram(marker, 'initial');
const row = (dir: string, msg: any) => ({ ts: 100, dir, msg });
const update = (u: any, sessionId = 's') => row('in', { method: 'session/update', params: { sessionId, update: u } });
function fixture() {
  const packet = { marker, phase: 'initial', resumeResultId: id };
  return { marker, phase: 'initial', code, result, traces: [{ ev: 'tool.fabric_exec' }], frames: [
    update({ configOptions: [{ id: 'mode', currentValue: CONTROL_PROFILE }] }),
    row('out', { id: 1, method: 'session/prompt', params: { sessionId: 's', prompt: [{ type: 'text', text: marker }] } }),
    update({ sessionUpdate: 'tool_call', toolCallId: 'call-1', title: '@fabric/fabric_exec', rawInput: { code, resultFormat: 'json', _meta: { _isValid: true } } }),
    update({ sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'completed', rawOutput: { response: JSON.stringify(packet) } }),
    row('in', { id: 1, result: { stopReason: 'end_turn' } }),
  ] };
}
const defaultConfig = () => JSON.parse(JSON.stringify(DEFAULT_FOVEA_CONFIG)) as typeof DEFAULT_FOVEA_CONFIG;
const setting = (config = defaultConfig(), scope = 'defaults') => ({ config, scope, revision: scope === 'defaults' ? 'absent' : 'revision', settingSupport: { 'sync.ackClean': { supported: false, effective: false, requested: config.sync.ackClean } } });
function completedRuns() {
  const changed = defaultConfig(); changed.sync.ackClean = true; changed.sync.mode = 'hidden'; changed.tools.defaultBudget = 1024;
  const before = { hostInstanceId: 'host-a', engineStarts: 0, engineGeneration: 0, capabilities: { automatic: false } };
  const seed = { status: 'ok', resultId: id, reads: [{ path: 'controls.ts', expectedSha256: createHash('sha256').update(CONTROL_SOURCE).digest('hex') }] };
  const unavailable = { ok: false, error: 'Error: Fovea result unavailable: foreign, revoked, expired, or engine generation changed' };
  const packet = { before, settingsBefore: setting(), seed, retainedBefore: { ok: true }, configure: { ok: true, value: setting(changed, 'session') }, settingsConfigured: setting(changed, 'session'),
    reset: { ok: true, value: { reset: 'conversation-root' } }, resetReplay: unavailable, beforeReload: { engineStarts: 1, engineGeneration: 1 },
    reloadReplayBefore: { ok: true }, reload: { ok: true, value: { restarted: true } }, settingsReloaded: setting(), reloadReplay: unavailable,
    after: { ...before, engineStarts: 2, engineGeneration: 2 } };
  return [{ phase: 'initial', completed: true, marker, sessionId: 's', toolCallId: 'call-1', packet },
    { phase: 'resume', completed: true, marker: 'resume-nonce', sessionId: 's', toolCallId: 'call-2', packet: { before: { ...before, hostInstanceId: 'host-b' }, settingsBefore: setting(), seed, previousResult: unavailable } }];
}

describe('native controls evidence, never a full lifecycle qualification', () => {
  it('requires explicit authentication and trusted bundle selection before any setup', async () => {
    for (const argv of [[], ['--authenticated'], ['--bundle', '/tmp'], ['--authenticated', '--bundle', '--interactive'], ['--authenticated', '--bundle', '/tmp', '--trust-all-tools'], ['--help', '--authenticated']]) await expect(main(argv)).rejects.toThrow();
  });
  it('uses actual managed Fabric, no hooks, no broad permissions or environment shortcuts', () => {
    const profile = controlsProfile('/trusted/bundle', '/private/data', '/private/workspace');
    expect(profile.mcpServers.fabric.command).toBe('/trusted/bundle/tools/node');
    expect(profile.mcpServers.fabric.args).toEqual(['/trusted/bundle/app/kiro/mcp-entry.js']);
    expect(profile.mcpServers.fabric.env.KIRO_FABRIC_BUNDLE_ROOT).toBe('/trusted/bundle');
    expect(profile.hooks).toEqual([]); expect(profile.includePowers).toBe(false); expect(profile.includeMcpJson).toBe(false);
    expect(profile.tools).toEqual(['@fabric/fabric_exec']);
  });
  it('generates valid checked guest programs for real mutations and a read-only resumed turn', () => {
    const resumed = controlsProgram('resume-nonce', 'resume', id);
    for (const input of [code, resumed, 'const s = await repo.settings(); const projectRevision: string = s.revisions.project; const r = await repo.configure({scope:"session",expectedRevision:s.revision,config:s.config}); const supported: false = r.settingSupport["sync.ackClean"].supported; return {projectRevision, supported, requested:s.settingSupport["sync.ackClean"].requested};']) expect(typeCheckFabricCode(input, fabricGuestDeclarations).errors).toEqual([]);
    for (const action of ['repo.configure', 'repo.reset', 'repo.reload']) { expect(code).toContain(action); expect(resumed).not.toContain(action); }
    expect(code).not.toMatch(/local\.(write|shell)|adoptRules/);
    expect(() => controlsProgram('injected"', 'initial')).toThrow();
    expect(() => controlsProgram('resume', 'resume', 'foreign')).toThrow();
  });
  it('requires exact native tool input/completion and a fresh Fabric execution trace', () => {
    expect(summarizeControlRun(fixture())).toMatchObject({ completed: true, exactCall: true, sessionId: 's', hostBlocked: false });
    for (const traces of [[], [{ ev: 'tool.fabric_exec' }, { ev: 'tool.fabric_exec' }]]) expect(summarizeControlRun({ ...fixture(), traces }).completed).toBe(false);
    for (const patch of [{ exitCode: 1 }, { error: 'spawn-error' }, { stopReason: 'timeout' }, { cleanup: 'uncertain' }]) expect(summarizeControlRun({ ...fixture(), result: { ...result, ...patch } }).completed).toBe(false);
  });
  it.each(['prose', 'replay', 'wrong-session', 'wrong-id', 'typed-id', 'wrong-input', 'extra-argument', 'fallback', 'mode', 'nonce', 'failed', 'duplicate', 'missing-end', 'result-before-call', 'status-regression', 'duplicate-end', 'error-and-end'])('rejects %s evidence', kind => {
    const f = fixture();
    if (kind === 'prose') f.frames[2]!.msg.params.update.sessionUpdate = 'agent_message_chunk';
    if (kind === 'replay') { const replay = f.frames.splice(2, 2); f.frames.unshift(...replay); }
    if (kind === 'wrong-session') f.frames[3]!.msg.params.sessionId = 'other';
    if (kind === 'wrong-id') f.frames[3]!.msg.params.update.toolCallId = 'other';
    if (kind === 'typed-id') f.frames[4]!.msg.id = '1';
    if (kind === 'wrong-input') f.frames[2]!.msg.params.update.rawInput.code = 'return true;';
    if (kind === 'extra-argument') f.frames[2]!.msg.params.update.rawInput.trust = true;
    if (kind === 'fallback') f.frames[2]!.msg.params.update.title = 'fs_read';
    if (kind === 'mode') f.frames.push(update({ configOptions: [{ id: 'mode', currentValue: 'vibe' }] }));
    if (kind === 'nonce') f.frames[3]!.msg.params.update.rawOutput.response = JSON.stringify({ marker: 'old', phase: 'initial' });
    if (kind === 'failed') f.frames[3]!.msg.params.update.status = 'failed';
    if (kind === 'duplicate') f.frames.splice(3, 0, structuredClone(f.frames[2]!));
    if (kind === 'missing-end') f.frames.pop();
    if (kind === 'result-before-call') [f.frames[2], f.frames[3]] = [f.frames[3]!, f.frames[2]!];
    if (kind === 'status-regression') f.frames.splice(4, 0, update({ sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'pending' }));
    if (kind === 'duplicate-end') f.frames.push(structuredClone(f.frames[4]!));
    if (kind === 'error-and-end') f.frames[4]!.msg.error = { message: 'failed turn' };
    expect(summarizeControlRun(f).completed).toBe(false);
  });
  it('distinguishes a matched missing handler from decline and mismatched form responses', () => {
    const f = fixture();
    f.frames.splice(3, 0, row('in', { id: 7, method: '_kiro/mcp/elicitation', params: { sessionId: 's', toolCallId: 'call-1', elicitation: { message: 'Risk: write\nAction: repo.configure\n{}' } } }), row('out', { id: 7, error: { message: 'No handler registered for method: _kiro/mcp/elicitation' } }));
    expect(summarizeControlRun(f).hostBlocked).toBe(true);
    f.frames[4]!.msg.id = '7'; expect(summarizeControlRun(f).hostBlocked).toBe(false);
    f.frames[4]!.msg = { id: 7, result: { action: 'decline' } };
    expect(summarizeControlRun(f)).toMatchObject({ hostBlocked: false, formPairs: [{ action: 'decline' }] });
  });
  it.each(['valid', 'missing-end', 'wrong-session', 'malformed', 'failed', 'replayed', 'wrong-tool', 'changed-input', 'wrong-mode'])('handles headless %s stream without inventing ACP acknowledgment', kind => {
    const f = fixture();
    const events: any[] = [{ type: 'runStarted', data: { engine: 'v3', payloadSchema: 'acp' } },
      ...f.frames.filter(r => r.msg.method === 'session/update').map(r => ({ type: 'sessionUpdate', data: r.msg.params })),
      { type: 'runFinished', data: { sessionId: 's', status: 'success', stopReason: 'end_turn' } }];
    if (kind === 'missing-end') events.pop();
    if (kind === 'wrong-session') events[3].data.sessionId = 'other';
    if (kind === 'failed') events.at(-1).data.status = 'failed';
    if (kind === 'replayed') events.splice(3, 0, events[2]);
    if (kind === 'wrong-tool') events[2].data.update.title = 'fs_read';
    if (kind === 'changed-input') events[2].data.update.rawInput.code = 'return true;';
    if (kind === 'wrong-mode') events[1].data.update.configOptions[0].currentValue = 'vibe';
    const stdout = kind === 'malformed' ? '{' : events.map(e => JSON.stringify(e)).join('\n');
    const report = summarizeControlStream({ ...f, result: { ...result, stdout } });
    expect(report.completed).toBe(kind === 'valid');
    expect(report).toMatchObject({ evidenceSource: 'native-headless-stream', formPairs: [], hostBlocked: false });
  });
  it('checks actual effects, but separates fresh native resume from host state ownership', () => {
    const report = summarizeControls({ runs: completedRuns(), bundleUnchanged: true, fixtureUnchanged: true });
    expect(Object.values(report.checks).every(Boolean)).toBe(true);
    expect(report).toMatchObject({ diagnosticCompleted: true, controlsObserved: true, qualified: false, automatic: false, resumedNewTurn: true, resumeObservation: { sameHostInstance: false, previousResultAvailable: false } });
  });
  it('does not substitute status, a generic error, or denied mutation for the required effects', () => {
    const runs = completedRuns(); const initial = runs[0]!.packet as any;
    initial.configure = { ok: false, error: 'denied' }; initial.resetReplay = { ok: false, error: 'timeout' }; initial.reloadReplayBefore = { ok: false };
    initial.after.engineStarts = 1; initial.seed.reads[0].expectedSha256 = 'wrong';
    const report = summarizeControls({ runs, bundleUnchanged: true, fixtureUnchanged: true });
    expect(report.controlsObserved).toBe(false);
    expect(report.checks).toMatchObject({ sourceMatched: false, configuredAndReread: false, resetInvalidatedResult: false, reloadClearedSession: false, reloadInvalidatedResult: false, reloadRestartedEngine: false });
  });
  it('rejects resumed replay, wrong native identity and any bundle/fixture drift', () => {
    for (const key of ['sessionId', 'marker', 'toolCallId'] as const) {
      const runs = completedRuns(); runs[1]![key] = key === 'sessionId' ? 'other' : runs[0]![key];
      expect(summarizeControls({ runs, bundleUnchanged: true, fixtureUnchanged: true }).resumedNewTurn).toBe(false);
    }
    for (const intact of [{ bundleUnchanged: false, fixtureUnchanged: true }, { bundleUnchanged: true, fixtureUnchanged: false }]) {
      expect(summarizeControls({ runs: completedRuns(), ...intact })).toMatchObject({ controlsObserved: false, diagnosticCompleted: false });
    }
    expect(summarizeControls({ runs: [], bundleUnchanged: true, fixtureUnchanged: true })).toMatchObject({ controlsObserved: false, diagnosticCompleted: false });
  });
});
