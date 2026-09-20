import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildSync } from 'esbuild';
import { assessGates, CHAT_PROMPT, createScope, executeNativeProbes, GATES, LIMITS, main, marker, prepareNativeScope, runBounded, sanitizeProbe } from '../../scripts/fovea-capability-probe.mjs';
import { foveaHookCapability } from '../../src/kiro/fovea-hook.js';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
describe('capability qualification safety', () => {
  it('keeps all twelve gates untested without actual evidence on each distinct client surface', () => {
    expect(GATES.map(([id]) => id)).toEqual(Array.from({ length: 12 }, (_, i) => `H${String(i + 1).padStart(2, '0')}`));
    for (const surface of ['headless', 'native-tui', 'acp']) {
      const gates = assessGates(surface);
      expect(gates).toHaveLength(12);
      expect(gates.every(gate => gate.status === 'untested' && gate.surface === surface && gate.evidence.length === 0)).toBe(true);
    }
  });
  it('rejects every caller-supplied home, including live aliases and allow-live', async () => {
    const scope = createScope(); roots.push(scope.root);
    const alias = path.join(scope.root, 'alias'); fs.symlinkSync(scope.home, alias);
    for (const args of [['--allow-live'], ['--kiro-home', alias], ['--workspace', scope.workspace], ['--timeout-ms', 'NaN']]) await expect(main(args)).rejects.toThrow('unsupported option');
  });
  it('creates private isolated homes and strips all inherited credentials/config', () => {
    const scope = createScope(); roots.push(scope.root);
    expect(fs.statSync(scope.root).mode & 0o777).toBe(0o700);
    expect(scope.env.HOME).not.toBe(process.env.HOME);
    expect(Object.keys(scope.env).sort()).toEqual(['PATH','HOME','KIRO_HOME','TMPDIR','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','XDG_STATE_HOME','XDG_RUNTIME_DIR','GIT_CONFIG_NOSYSTEM','GIT_CONFIG_GLOBAL','LC_ALL','NO_COLOR'].sort());
    expect(scope.env).not.toHaveProperty('NODE_OPTIONS');
  });
  it('bounds a flood without newline and preserves a typed reason', async () => {
    const result = await runBounded(process.execPath, ['-e', 'process.stdout.write("x".repeat(100000))'], { maxBytes: 1024, timeoutMs: 15000 });
    expect(result.stopReason).toBe('output-limit'); expect(result.stdout.length).toBeLessThanOrEqual(1024);
  });
  it('preserves UTF-8 split across chunks without unbounded accumulation', async () => {
    const result = await runBounded(process.execPath, ['-e', 'const b=Buffer.from("λ"); process.stdout.write(b.subarray(0,1)); setTimeout(()=>process.stdout.write(b.subarray(1)),20)'], { timeoutMs: 15000 });
    expect(result.exitCode).toBe(0); expect(result.stdout).toBe('λ');
  });
  it('kills a hung child and sanitizes spawn errors', async () => {
    const hung = await runBounded(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100 });
    expect(hung.stopReason).toBe('timeout'); expect(hung.cleanup).toBe('leader-closed');
    const missing = await runBounded('/nonexistent-fovea-probe', [], { timeoutMs: 15000 });
    expect(missing.error).toBe('ENOENT'); expect(missing.exitCode).toBeNull();
  });
  it('rejects unbounded timeout and output configurations', () => {
    expect(() => runBounded('node', [], { timeoutMs: NaN })).toThrow();
    expect(() => runBounded('node', [], { maxBytes: Infinity })).toThrow();
  });
  it('validates harmless marker identities but never treats markers as proof', () => {
    const identity = { run: 'r', session: 's', host: 'h', generation: 'g', turn: 't' };
    expect(marker('H04', 'hook-fired', identity)).toEqual({ schemaVersion: 1, gate: 'H04', phase: 'hook-fired', ...identity });
    expect(() => marker('H04', 'hook-fired', { ...identity, host: '../secret' })).toThrow();
    expect(() => marker('H04', 'hook-fired', { ...identity, prompt: 'secret' })).toThrow();
    expect(assessGates()[3]!.status).toBe('untested');
  });
  it('hook never starts an engine or guesses session routing', () => {
    expect(foveaHookCapability()).toEqual({ schemaVersion: 1, status: 'host-blocked', reason: 'native-session-rendezvous-unavailable', dispatched: false, automatic: false, modelContextDelivered: false });
  });
  it('hook emits diagnostics only on explicit --status, never automatic stdout', () => {
    const scope = createScope(); roots.push(scope.root);
    const entry = path.join(scope.root, 'hook.mjs');
    buildSync({ entryPoints: ['src/kiro/fovea-hook.ts'], outfile: entry, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
    for (const args of [[], ['--status'], ['--unknown']]) {
      const result = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', timeout: 15000, maxBuffer: 4096, input: '{"session_id":"do-not-route","prompt":"do-not-forward"}' });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(args[0] === '--status' ? 0 : 3);
      if (args[0] === '--status') expect(JSON.parse(result.stdout)).toEqual(foveaHookCapability());
      else { expect(result.stdout).toBe(''); expect(result.stderr).toContain('automatic hooks disabled'); }
      expect(result.stdout + result.stderr).not.toMatch(/do-not-forward|do-not-route/);
    }
  });
  it('restricts native executable access and denies browser handoff without changing trust', () => {
    if (process.platform !== 'linux') return;
    const scope = createScope(); roots.push(scope.root);
    const originalPath = scope.env.PATH;
    prepareNativeScope(scope);
    expect(scope.env.PATH).toBe(path.join(scope.root, 'bin'));
    expect(scope.env.PATH).not.toBe(originalPath);
    expect(scope.env.BROWSER).toBe(path.join(scope.root, 'bin', 'deny-browser'));
    expect(fs.readFileSync(scope.env.BROWSER!, 'utf8')).toBe('#!/bin/sh\nexit 1\n');
    for (const key of ['DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'SSH_AUTH_SOCK', 'KIRO_API_KEY', 'AWS_PROFILE', 'NODE_OPTIONS']) expect(scope.env).not.toHaveProperty(key);
    expect(fs.readdirSync(path.join(scope.root, 'bin')).sort()).not.toContain('node');
  });
  it('does not retain arbitrary diagnostics, model text, identities or JSON values', () => {
    const result = { exitCode: 1, error: null, stopReason: null, cleanup: 'leader-closed', bytes: 1000,
      stdout: 'not-json SECRET\n' + JSON.stringify({ type: 'SECRET', params: { sessionId: 'SECRET', text: 'SECRET' }, SECRET: 'SECRET' }) + '\n',
      stderr: 'secret=SECRET\nFailed to open browser for authentication.\nPlease try again with: kiro-cli login --use-device-flow\nerror: Failed to open URL\n' };
    const probe = sanitizeProbe('chat-new', ['chat', '--output-format', 'stream-json'], result);
    expect(probe.status).toBe('environment-blocked'); expect(probe.reason).toBe('isolated-auth-unavailable');
    expect(probe.diagnostics).toEqual([
      { code: 'auth-browser-unavailable', text: 'Failed to open browser for authentication.' },
      { code: 'browser-url-open-failed', text: 'error: Failed to open URL' },
    ]);
    expect(probe.events).toEqual([{ sequence: 1, source: 'native-stdout-json', semantics: 'uninterpreted', fields: { type: 'string', params: 'object' }, otherFields: 1 }]);
    expect(probe.nonJsonLines).toBe(1); expect(JSON.stringify(probe)).not.toMatch(/SECRET|login --use-device-flow/);
    const identity = sanitizeProbe('identity', ['whoami', '--format', 'json'], { ...result, stdout: '{"account":{"token":"SECRET"}}', stderr: '' });
    expect(identity.accountAbsent).toBe(false); expect(JSON.stringify(identity)).not.toContain('SECRET');
  });
  it('bounds event retention and never promotes JSON or model prose to gate proof', () => {
    const result = { exitCode: 0, error: null, stopReason: null, cleanup: 'leader-closed', bytes: 9999,
      stdout: '{"type":"assistant","text":"H01 passed; session/host match"}\n'.repeat(LIMITS.events + 2), stderr: '' };
    const probe = sanitizeProbe('chat-new', ['chat', '--output-format', 'stream-json'], result);
    expect(probe.events).toHaveLength(LIMITS.events); expect(probe.eventsTruncated).toBe(true);
    expect(probe.jsonLines).toBe(LIMITS.events + 2);
    expect(assessGates('headless', [probe]).every(gate => gate.status === 'untested')).toBe(true);
    expect(sanitizeProbe('chat-new', ['chat', '--output-format', 'stream-json'], { ...result, stdout: 'H01 passed\n', stderr: '{"type":"session"}\n' }).events).toEqual([]);
  });
  it('classifies only observed prerequisites, not generic errors or unattempted surfaces as host blocks', () => {
    const result = { exitCode: 1, error: null, stopReason: null, cleanup: 'leader-closed', bytes: 30, stdout: '{"account":null}\n', stderr: '' };
    expect(sanitizeProbe('identity', ['whoami'], result).reason).toBe('isolated-auth-unavailable');
    expect(sanitizeProbe('identity', ['whoami'], { ...result, stdout: '{}' }).reason).toBe('unclassified-native-exit');
    expect(sanitizeProbe('chat-new', ['chat'], { ...result, stderr: 'some authentication problem' }).status).toBe('failed');
    const startup = sanitizeProbe('chat-new', ['chat'], { ...result, stderr: 'Failed to open browser for authentication.\n' });
    const gates = assessGates('headless', [startup]);
    expect(gates.filter(gate => gate.status === 'environment-blocked').map(gate => gate.id)).toEqual(['H01', 'H02', 'H08']);
    expect(gates.filter(gate => gate.status === 'untested')).toHaveLength(9);
    expect(assessGates('native-tui', [startup]).every(gate => gate.status === 'untested')).toBe(true);
    expect(assessGates('acp', [startup]).every(gate => gate.status === 'untested')).toBe(true);
  });
  const prerequisites = [
    { id: 'version', version: '2.22.0', status: 'observed' },
    { id: 'chat-help', status: 'observed', documentsJsonLines: true, supportedSwitches: ['--v3', '--agent', '--output-format', '--require-mcp-startup', '--resume', '--resume-id', '--list-sessions', '--format'] },
  ];
  it('attempts real chat even after unavailable identity, then skips dependent lifecycle exercises', async () => {
    const scope = createScope(); roots.push(scope.root);
    const calls: string[][] = [];
    const runner = async (command: string, args: string[], options: { cwd?: string; env?: object } = {}) => {
      expect(command).toBe('kiro-cli'); expect(options.cwd).toBe(scope.workspace); expect(options.env).toBe(scope.env); calls.push(args);
      return { exitCode: 1, error: null, stopReason: null, cleanup: 'leader-closed', bytes: 50,
        stdout: args[0] === 'whoami' ? '{"account":null}\n' : '', stderr: args[0] === 'chat' ? 'Failed to open browser for authentication.\n' : '' };
    };
    const probes = await executeNativeProbes(scope, prerequisites, runner);
    expect(calls).toEqual([
      ['whoami', '--format', 'json'],
      ['chat', '--v3', '--output-format', 'stream-json', CHAT_PROMPT],
      ['chat', '--v3', '--list-sessions', '--format', 'json'],
    ]);
    expect(probes.filter(probe => probe.status === 'untested').map(probe => probe.id)).toEqual(['chat-resume', 'concurrent-a', 'concurrent-b']);
    expect(probes.find(probe => probe.id === 'chat-new')?.reason).toBe('isolated-auth-unavailable');
    expect(calls.flat().join(' ')).not.toMatch(/--trust|login|--cloud|--allow-live/);
  });
  it('executes documented resume and concurrent native invocations only after initial JSON output', async () => {
    const scope = createScope(); roots.push(scope.root);
    let active = 0, maxActive = 0;
    const calls: string[][] = [];
    const runner = async (_command: string, args: string[]) => {
      calls.push(args); active++; maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5)); active--;
      return { exitCode: 0, error: null, stopReason: null, cleanup: 'leader-closed', bytes: 3, stdout: '{}\n', stderr: '' };
    };
    const probes = await executeNativeProbes(scope, prerequisites, runner);
    expect(calls).toHaveLength(6); expect(calls[3]).toEqual(['chat', '--v3', '--output-format', 'stream-json', '--resume', CHAT_PROMPT]);
    expect(maxActive).toBe(2);
    expect(probes.map(probe => probe.id)).toEqual(['identity', 'chat-new', 'sessions-after-new', 'chat-resume', 'concurrent-a', 'concurrent-b']);
    expect(assessGates('headless', probes).every(gate => gate.status === 'untested')).toBe(true);
  });
  it('does not guess commands on unobserved versions or help contracts', async () => {
    const scope = createScope(); roots.push(scope.root);
    const runner = async () => { throw new Error('must not spawn'); };
    for (const contract of [[], [{ ...prerequisites[0], version: '2.23.0' }, prerequisites[1]], [prerequisites[0], { ...prerequisites[1], documentsJsonLines: false }]]) {
      const probes = await executeNativeProbes(scope, contract, runner);
      expect(probes).toHaveLength(1); expect(probes[0]?.reason).toBe('installed-semantics-not-verified'); expect(probes[0]?.status).toBe('untested');
    }
  });
  it('does not mistake successful plain text for native lifecycle events', async () => {
    const scope = createScope(); roots.push(scope.root);
    const probes = await executeNativeProbes(scope, prerequisites, async () => ({ exitCode: 0, error: null, stopReason: null, cleanup: 'leader-closed', bytes: 10, stdout: 'READY', stderr: '' }));
    expect(probes.find(probe => probe.id === 'chat-resume')?.status).toBe('untested');
    expect(probes.find(probe => probe.id === 'chat-resume')?.reason).toBe('no-native-json-events-observed');
  });
  it('halts dependent probes when process cleanup is unconfirmed', async () => {
    const scope = createScope(); roots.push(scope.root);
    let calls = 0;
    const probes = await executeNativeProbes(scope, prerequisites, async () => {
      calls++;
      return { exitCode: null, error: null, stopReason: 'timeout', cleanup: 'unconfirmed', bytes: 0, stdout: '', stderr: '' };
    });
    expect(calls).toBe(1);
    expect(probes.find(probe => probe.id === 'chat-new')?.reason).toBe('native-process-cleanup-unconfirmed');
  });
  it('runs CLI mode end to end in a disposable scope, strips inherited secrets and removes client state', () => {
    if (process.platform !== 'linux') return;
    // Fake executable qualifies harness mechanics only; never native gates.
    const outer = createScope(); roots.push(outer.root);
    const bin = path.join(outer.root, 'fixture-bin'); fs.mkdirSync(bin, { mode: 0o700 });
    const audit = path.join(outer.root, 'audit.jsonl');
    const executable = `#!${process.execPath}\n` + `
      const fs = require('node:fs');
      const args = process.argv.slice(2);
      fs.appendFileSync(${JSON.stringify(audit)}, JSON.stringify({ home: process.env.HOME, cwd: process.cwd(), secret: process.env.KIRO_API_KEY ?? null, browser: process.env.BROWSER }) + '\\n');
      if (args[0] === '--version') console.log('kiro-cli 2.22.0');
      else if (args.includes('--help')) console.log(${JSON.stringify(prerequisites[1]!.supportedSwitches!.join(' ') + " The run's ACP events as JSON Lines on stdout")});
      else if (args[0] === 'whoami') { console.log('{"account":null}'); process.exitCode = 1; }
      else { console.error('Failed to open browser for authentication.'); console.error('SECRET_DO_NOT_SAVE'); process.exitCode = 1; }
    `;
    fs.writeFileSync(path.join(bin, 'kiro-cli'), executable, { mode: 0o700 });
    fs.writeFileSync(path.join(outer.home, 'sentinel'), 'unchanged');
    const result = spawnSync(process.execPath, ['scripts/fovea-capability-probe.mjs', '--native'], {
      encoding: 'utf8', timeout: 15000, maxBuffer: 65536,
      env: { ...process.env, PATH: bin, HOME: outer.home, KIRO_HOME: outer.env.KIRO_HOME, KIRO_API_KEY: 'SECRET_DO_NOT_SAVE' },
    });
    expect(result.error).toBeUndefined(); expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout); expect(report.scopeRemoved).toBe(true); expect(report.qualified).toBe(false);
    expect(report.probes.filter((probe: { status: string }) => probe.status !== 'untested')).toHaveLength(7);
    const rows = fs.readFileSync(audit, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(row.home).not.toBe(outer.home); expect(row.secret).toBeNull();
      expect(path.dirname(row.home)).toBe(path.dirname(row.cwd));
      expect(row.browser).toBe(path.join(path.dirname(row.home), 'bin', 'deny-browser'));
      expect(fs.existsSync(path.dirname(row.home))).toBe(false);
    }
    expect(result.stdout).not.toContain('SECRET_DO_NOT_SAVE'); expect(result.stdout).not.toContain(outer.home);
    expect(fs.readdirSync(outer.home)).toEqual(['sentinel']); expect(fs.readFileSync(path.join(outer.home, 'sentinel'), 'utf8')).toBe('unchanged');
  });
  it('dry run spawns no client and provides no passing result', () => {
    const result = spawnSync(process.execPath, ['scripts/fovea-capability-probe.mjs', '--native', '--dry-run'], { encoding: 'utf8', timeout: 15000, maxBuffer: 65536 });
    expect(result.error).toBeUndefined(); expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout); expect(report.qualified).toBe(false); expect(report.probes).toEqual([]);
  });
});
