import { removeFixtureSync } from "../fixture-cleanup.mjs";
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { main, nativeProbeProfile, summarizeNativeProbe } from '../../scripts/fovea-native-probe.mjs';
import { generateAgentProfile } from '../../scripts/agent-profile.mjs';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
const result = { stdout: '', stderr: '', exitCode: 0, error: null, stopReason: null, cleanup: 'leader-closed', bytes: 0 };

describe('native contract probe (component tests, not native qualification)', () => {
  it('requires explicit authenticated opt-in and rejects caller homes/trust flags', async () => {
    for (const args of [[], ['--tui'], ['--authenticated', '--trust-all-tools'], ['--authenticated', '--home', '/tmp'], ['--authenticated', '--authenticated']]) await expect(main(args)).rejects.toThrow();
  });
  it('uses observed TUI hook shape, exact MCP matcher and only the harmless fixture', () => {
    const p = nativeProbeProfile('/tmp/owned-probe', '/opt/node');
    expect(p.tools).toEqual(['@fabric/fabric_exec']);
    expect(p.allowedTools).toEqual(p.tools);
    expect(p.includeMcpJson).toBe(false); expect(p.includePowers).toBe(false);
    expect(p.hooks.map(h => h.trigger)).toEqual(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']);
    expect(p.hooks.filter(h => h.matcher).map(h => h.matcher)).toEqual(['^mcp_fabric_fabric_exec$', '^mcp_fabric_fabric_exec$']);
    expect(p.hooks.every(h => h.action.type === 'command' && h.timeout === 5)).toBe(true);
    expect(JSON.stringify(p)).not.toMatch(/trust-all-tools|foveaPostToolContext|KIRO_SESSION|_kiro\//);
    const literal = nativeProbeProfile('/tmp/$HOME/${WORKSPACE_ROOT}/literal', '/opt/node');
    expect(literal.hooks[0]?.action.command).toContain("$''HOME/$''{WORKSPACE_ROOT}");
  });
  it('never installs automatic Fovea hooks in production profiles, including minimal', () => {
    for (const guidanceMode of ['standard', 'review', 'minimal'] as const) {
      const p = generateAgentProfile({ nodePath: '/node', runtimeRoot: '/runtime', dataRoot: '/data', skillPath: '/skill', guidanceMode });
      expect(JSON.stringify(p)).not.toMatch(/fovea-hook|foveaPostToolContext|SESSION_ID/);
      if (guidanceMode === 'minimal') expect(p.hooks).toEqual([]);
    }
  });
  it('does not promote selected mode, hook firing, model prose or call markers to model-input proof', () => {
    const stdout = JSON.stringify({ type: 'sessionUpdate', data: { update: { configOptions: [{ id: 'mode', currentValue: 'fovea-native-protocol-probe' }] } } }) + '\nPROBE_CONTINUED';
    const report = summarizeNativeProbe('headless', { ...result, stdout }, [{ event: { hook_event_name: 'Stop', session_id: 'native-s', cwd: '/same-cwd' } }], [{ kind: 'call', instance: 'mcp-owner', parameterKeys: ['name', 'arguments'], meta: null, marker: 'continuation' }]);
    expect(report).toMatchObject({ selectedModeObserved: true, continuationCallObserved: true, automatic: false, qualified: false, actualModelInput: 'not-observed' });
    expect(report.hookEvents[0]?.sessionId).toBe('native-s');
    expect(report.mcpCalls[0]).not.toHaveProperty('sessionId');
    expect(summarizeNativeProbe('native-tui', { ...result, stdout: 'PROBE_CONTINUED' }, [], []).continuationCallObserved).toBe(false);
  });
  it('does not accept an earlier probe selection when final native mode fell back', () => {
    const stdout = ['fovea-native-protocol-probe', 'vibe'].map(currentValue => JSON.stringify({ data: { update: { configOptions: [{ id: 'mode', currentValue }] } } })).join('\n');
    expect(summarizeNativeProbe('headless', { ...result, stdout }, [], []).selectedModeObserved).toBe(false);
  });
  it('exercises actual recorder stdin and Stop JSON once per native session, without engine routing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-hook-component-')); roots.push(root);
    const run = (session: string) => spawnSync(process.execPath, ['tests/fovea/fixtures/native-hook-probe.mjs', root], { input: JSON.stringify({ hook_event_name: 'Stop', session_id: session, cwd: '/not-a-host-binding' }), encoding: 'utf8', timeout: 15000 });
    const first = run('s1'); expect(first.error).toBeUndefined(); expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({ decision: 'block', reason: expect.stringContaining('continuation') });
    const repeat = run('s1'); expect(repeat.error).toBeUndefined(); expect(repeat.status).toBe(0); expect(repeat.stdout).toBe('');
    const independent = run('s2'); expect(independent.error).toBeUndefined(); expect(independent.status).toBe(0); expect(JSON.parse(independent.stdout).decision).toBe('block');
    expect(fs.readdirSync(root)).toEqual(['hooks.jsonl']);
  });
});
