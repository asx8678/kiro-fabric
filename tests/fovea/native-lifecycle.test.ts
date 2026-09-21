import { removeFixtureSync } from "../fixture-cleanup.mjs";
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { LEDGER, PROFILE, lifecycleDriver, lifecycleProfile, main, streamIdentity, summarizeLifecycle, summarizeCancellationAcknowledgment } from '../../scripts/fovea-lifecycle-probe.mjs';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
const result = { stdout: '', stderr: '', exitCode: 0, error: null, stopReason: null, cleanup: 'leader-closed' };
const stream = (sessionId = 'native-session', mode = PROFILE) => JSON.stringify({ data: { sessionId, update: { configOptions: [{ id: 'mode', currentValue: mode }] } } });
const runs = () => ['initial', 'resume'].map((phase, i) => ({ phase, marker: phase + '-nonce', mcpStart: i, mcpEnd: i + 1, result: { ...result, stdout: stream() } }));
const mcp = () => ['initial', 'resume'].map(phase => ({ kind: 'call', marker: phase + '-nonce', instance: phase + '-instance', parameterKeys: ['name', 'arguments'], meta: null }));
describe('bounded native lifecycle harness (not native qualification)', () => {
  it('rejects implicit authentication, caller paths, live controls and unrecognized flags', async () => {
    for (const args of [[], ['--tui-cancel'], ['--authenticated', '--home', '/tmp'], ['--authenticated', '--trust-all-tools'], ['--authenticated', '--authenticated'], ['--help', '--authenticated']]) await expect(main(args)).rejects.toThrow();
  });
  it('owns unique fixtures and exposes every acceptance obligation without enabling automatic hooks', () => {
    expect(Object.keys(LEDGER)).toHaveLength(6);
    const profile = lifecycleProfile('/tmp/$HOME/owned', '/opt/node');
    expect(profile.tools).toEqual(['@fabric/fabric_exec']);
    expect(profile.includeMcpJson).toBe(false); expect(profile.includePowers).toBe(false);
    expect(profile.mcpServers.fabric.args[0]).toMatch(/lifecycle-contract-mcp.mjs$/);
    expect(profile.hooks[0]!.action.command).toContain("$''HOME");
    expect(profile.hooks.every(h => h.timeout === 15)).toBe(true);
    expect(JSON.stringify(profile)).not.toMatch(/fovea-hook|SESSION_ID|_kiro\/|trust-all-tools/);
  });
  it('requires same authoritative stream identity, final mode, and fresh bounded recorder nonce calls', () => {
    const report = summarizeLifecycle({ runs: runs(), mcp: mcp() });
    expect(report.resumedNewTurn).toBe(true);
    expect(report).toMatchObject({ automatic: false, qualified: false, evidenceKind: 'native-protocol-fixture-not-Fabric' });
    expect(report.blockers).toContain('No supported native session-to-MCP association established');
    expect(report.mcpCalls[1]).not.toHaveProperty('sessionId');
  });
  it('rejects replay, prose-only claims, a previous marker, wrong session and final-mode fallback', () => {
    expect(summarizeLifecycle({ runs: runs(), mcp: mcp().slice(0, 1) }).resumedNewTurn).toBe(false);
    const replay = runs(); replay[1]!.result.stdout += '\nLIFECYCLE_RESULT_resume-nonce';
    expect(summarizeLifecycle({ runs: replay, mcp: [] }).resumedNewTurn).toBe(false);
    const same = runs(); same[1]!.marker = same[0]!.marker;
    expect(summarizeLifecycle({ runs: same, mcp: mcp() }).resumedNewTurn).toBe(false);
    for (const suffix of [stream('other-session'), stream('native-session', 'vibe')]) {
      const changed = runs(); changed[1]!.result.stdout += '\n' + suffix;
      expect(summarizeLifecycle({ runs: changed, mcp: mcp() }).resumedNewTurn).toBe(false);
    }
    expect(streamIdentity({ stdout: stream() + '\n' + stream('other-session') }).sessionId).toBeNull();
  });
  it('rejects overlapping/out-of-range recorder windows and ignores non-object JSON envelopes', () => {
    for (const change of [{ mcpStart: -1 }, { mcpStart: 0 }, { mcpEnd: 99 }, { mcpEnd: 1 }, { marker: '' }]) {
      const invalid = runs(); Object.assign(invalid[1]!, change);
      expect(summarizeLifecycle({ runs: invalid, mcp: mcp() }).resumedNewTurn).toBe(false);
    }
    expect(streamIdentity({ stdout: 'null\n42\n[]\n' + stream() }).sessionId).toBe('native-session');
  });
  it('does not promote failed, timed-out or unclosed processes into resume observations', () => {
    for (const change of [{ exitCode: 2 }, { error: 'ENOENT' }, { stopReason: 'timeout' }, { cleanup: 'unconfirmed' }]) {
      const failed = runs(); Object.assign(failed[1]!.result, change);
      expect(summarizeLifecycle({ runs: failed, mcp: mcp() }).resumedNewTurn).toBe(false);
    }
  });
  it('reports Escape writes and second prompt hooks without inferring cancellation ACK or queue ordering', () => {
    const report = summarizeLifecycle({ driver: [{ kind: 'escape-written', at: 200 }], hooks: [
      { kind: 'hook-start', trigger: 'UserPromptSubmit', prompt: 'LIFECYCLE_DELAY', sessionId: 's', at: 100 },
      { kind: 'hook-end', trigger: 'UserPromptSubmit', prompt: 'LIFECYCLE_DELAY', sessionId: 's', at: 900 },
      { kind: 'hook-start', trigger: 'UserPromptSubmit', prompt: 'LIFECYCLE_QUEUED', sessionId: 's', at: 1000 },
    ] });
    expect(report.cancellation).toMatchObject({ acknowledgement: 'not-observed', escapeWritten: true, hookEndAfterEscapeMs: 700 });
    expect(report.queuedInput).toMatchObject({ ordering: 'unverified', status: 'unqualified' });
    expect(report.queuedInput.acceptedPromptHooks).toHaveLength(1);
    expect(report.untested).toContain('retained generation across update');
  });
  it('hook fixture records fresh session start/end without writing model context or Stop continuation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-hook-test-')); roots.push(root);
    for (const trigger of ['SessionStart', 'UserPromptSubmit', 'Stop']) {
      const run = spawnSync(process.execPath, ['tests/fovea/fixtures/lifecycle-contract-hook.mjs', root], { input: JSON.stringify({ hook_event_name: trigger, session_id: 's', prompt: 'ordinary-new-turn' }), encoding: 'utf8', timeout: 15000 });
      expect(run.error).toBeUndefined(); expect(run.status).toBe(0); expect(run.stdout).toBe('');
    }
    const rows = fs.readFileSync(path.join(root, 'hooks.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(rows.map(r => r.kind)).toEqual(['hook-start', 'hook-end', 'hook-start', 'hook-end', 'hook-start', 'hook-end']);
    expect(rows.every(r => r.sessionId === 's' && Number.isSafeInteger(r.at))).toBe(true);
  });
  it('records real fixture stdio initialization and fresh calls without inventing session association', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-mcp-test-')); roots.push(root);
    const client = new Client({ name: 'component-test', version: '1' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('tests/fovea/fixtures/lifecycle-contract-mcp.mjs'), root], stderr: 'pipe' });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.map(t => t.name)).toEqual(['fabric_exec']);
      const value = await client.callTool({ name: 'fabric_exec', arguments: { marker: 'component-fresh' } });
      expect(value.content).toEqual([{ type: 'text', text: 'LIFECYCLE_RESULT_component-fresh' }]);
      await expect(client.callTool({ name: 'fabric_exec', arguments: { marker: '../not-a-marker' } })).rejects.toThrow('invalid fixture marker');
    } finally { await client.close(); }
    const rows = fs.readFileSync(path.join(root, 'mcp.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(rows.filter(r => r.kind === 'initialize')).toHaveLength(1);
    expect(rows.filter(r => r.kind === 'call')).toEqual([expect.objectContaining({ marker: 'component-fresh', parameterKeys: ['name', 'arguments'], meta: null })]);
    expect(new Set(rows.map(r => r.instance)).size).toBe(1);
  });
  it('bounds hook input and refuses oversized payloads before logging', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-hook-limit-')); roots.push(root);
    const run = spawnSync(process.execPath, ['tests/fovea/fixtures/lifecycle-contract-hook.mjs', root], { input: JSON.stringify({ prompt: 'x'.repeat(70000) }), encoding: 'utf8', timeout: 15000 });
    expect(run.error).toBeUndefined(); expect(run.status).toBe(4); expect(fs.readdirSync(root)).toEqual([]);
  });
  it.runIf(process.platform === 'darwin')('executes the generated Tcl recorder without launching Kiro', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-tcl-test-')); roots.push(root);
    const header = lifecycleDriver().split('spawn -noecho')[0]!;
    const script = path.join(root, 'recorder.tcl'); fs.writeFileSync(script, header + '\nnote component-only\n');
    const run = spawnSync('/usr/bin/tclsh', [script, root], { encoding: 'utf8', timeout: 15000 });
    expect(run.error).toBeUndefined(); expect(run.status).toBe(0);
    const row = JSON.parse(fs.readFileSync(path.join(root, 'driver.jsonl'), 'utf8'));
    expect(row.kind).toBe('component-only'); expect(Number.isSafeInteger(row.at)).toBe(true);
  });
  const ackFrames = (answerId: number | string = 3, queuedSession = 's') => [
    { ts: 100, dir: 'out', msg: { id: 3, method: 'session/prompt', params: { sessionId: 's', prompt: [{ type: 'text', text: 'LIFECYCLE_DELAY' }] } } },
    { ts: 200, dir: 'out', msg: { method: 'session/cancel', params: { sessionId: 's' } } },
    { ts: 205, dir: 'in', msg: { method: '_kiro/hooks/cancel', params: { sessionId: 's' } } },
    { ts: 210, dir: 'in', msg: { id: answerId, result: { stopReason: 'cancelled' } } },
    { ts: 220, dir: 'out', msg: { id: 4, method: 'session/prompt', params: { sessionId: queuedSession, prompt: [{ type: 'text', text: 'LIFECYCLE_QUEUED' }] } } },
    { ts: 300, dir: 'in', msg: { id: 4, result: { stopReason: 'end_turn' } } },
  ];
  const ackHooks = [
    { at: 110, kind: 'hook-start', trigger: 'UserPromptSubmit', sessionId: 's', prompt: 'LIFECYCLE_DELAY' },
    { at: 230, kind: 'hook-start', trigger: 'UserPromptSubmit', sessionId: 's', prompt: 'LIFECYCLE_QUEUED' },
    { at: 900, kind: 'hook-end', trigger: 'UserPromptSubmit', sessionId: 's', prompt: 'LIFECYCLE_DELAY' },
  ];
  it('correlates acknowledged cancellation and completed queued turn while exposing surviving hooks', () => {
    const acknowledgement = summarizeCancellationAcknowledgment(ackFrames(), ackHooks);
    expect(acknowledgement).toMatchObject({ turnCancellationAcknowledged: true, hookCancelNotificationObserved: true,
      hookCompletedAfterAcknowledgmentMs: 690, queuedPromptAfterCancelMs: 10,
      queuedPromptAccepted: true, queuedTurnCompleted: true, oldHookCompletedAfterQueuedTurn: true,
      qualified: false, automatic: false, fullAutomaticCancellationContractQualified: false });
    expect(summarizeLifecycle({ acp: ackFrames(), hooks: ackHooks }).cancellation.acknowledgement).toBe('native-turn-cancelled');
  });
  it('requires native cancellation and queue evidence in addition to clean TUI shutdown', () => {
    const tui = [{ phase: 'tui-cancel', result, mcpStart: 0, mcpEnd: 0 }];
    expect(summarizeLifecycle({ runs: tui }).diagnosticCompleted).toBe(false);
    expect(summarizeLifecycle({ runs: tui, acp: ackFrames(), hooks: ackHooks }).diagnosticCompleted).toBe(true);
    expect(summarizeLifecycle({ runs: [{ ...tui[0]!, result: { ...result, exitCode: 1 } }], acp: ackFrames(), hooks: ackHooks }).diagnosticCompleted).toBe(false);
  });
  it('rejects wrong or differently typed response identity and unrelated queued sessions', () => {
    for (const responseId of [99, '3']) expect(summarizeCancellationAcknowledgment(ackFrames(responseId), ackHooks).turnCancellationAcknowledged).toBe(false);
    const other = summarizeCancellationAcknowledgment(ackFrames(3, 'other'), ackHooks);
    expect(other.turnCancellationAcknowledged).toBe(true);
    expect(other.queuedPromptAccepted).toBe(false);
    expect(other.queuedTurnCompleted).toBe(false);
  });
  it('does not use replayed/out-of-order turns or prompt text as cancellation evidence', () => {
    const frames = ackFrames().map(row => row.ts === 220 ? { ...row, ts: 150 } : row);
    expect(summarizeCancellationAcknowledgment(frames, ackHooks).queuedPromptAccepted).toBe(false);
    expect(summarizeCancellationAcknowledgment([{ ts: 1, dir: 'in', msg: { method: 'session/update', params: { text: 'session/cancel stopReason cancelled' } } }], ackHooks).turnCancellationAcknowledged).toBe(false);
  });
  it('TUI driver only uses native UI inputs; no private RPC, config changes or invented acknowledgements', () => {
    const driver = lifecycleDriver();
    expect(driver).toContain('escape-written'); expect(driver).toContain('queued-written');
    expect(driver).toContain('12000'); expect(driver).toContain('queue-mode-written');
    expect(driver).toContain('global spawn_id nativeClosed'); expect(driver).not.toContain('/help');
    expect(driver).not.toMatch(/_kiro\/|session\/cancel|KIRO_SESSION|trust-all-tools|settings set/);
  });
});
