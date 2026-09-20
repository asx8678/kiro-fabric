#!/usr/bin/env node
// Development-only qualification. No login, credential transfer, trust or effect authorization.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { pathToFileURL } from 'node:url';

export const LIMITS = Object.freeze({ bytes: 262144, timeoutMs: 15000, cleanupMs: 1000, events: 256, markerBytes: 2048 });
export const GATES = Object.freeze([
  ['H01', 'same session and MCP instance across multiple turns'],
  ['H02', 'concurrent session-to-host mapping and ambiguity rejection'],
  ['H03', 'readiness, authorized binding and first-hook ordering'],
  ['H04', 'prompt marker delivered to intended model turn'],
  ['H05', 'post-tool marker delivered without changing result or error'],
  ['H06', 'stop marker causes bounded continuation, not merely hook firing'],
  ['H07', 'cancel stops automatic work and queued user input wins'],
  ['H08', 'new/resume/clear/compact/profile-swap signals or safe recovery'],
  ['H09', 'visible/model-only/disabled and status/settings/reset/reload'],
  ['H10', 'accepted/declined exact effects and workspace revocation'],
  ['H11', 'authoritative complete model-visible tool inventory'],
  ['H12', 'old session retains generation-matched engine and hooks'],
]);

// Only newly created private trees. No caller-supplied scope or credential access.
/** @returns {{root: string, home: string, workspace: string, env: Record<string, string>, cleanupUnconfirmed?: boolean}} */
export function createScope() {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'fovea-qualification-'));
  fs.chmodSync(root, 0o700);
  for (const dir of ['home', 'kiro', 'workspace', 'tmp', 'config', 'cache', 'data', 'state', 'run']) fs.mkdirSync(path.join(root, dir), { mode: 0o700 });
  return { root, home: path.join(root, 'home'), workspace: path.join(root, 'workspace'), env: {
    PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: path.join(root, 'home'),
    KIRO_HOME: path.join(root, 'kiro'), TMPDIR: path.join(root, 'tmp'),
    XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'),
    XDG_DATA_HOME: path.join(root, 'data'), XDG_STATE_HOME: path.join(root, 'state'),
    XDG_RUNTIME_DIR: path.join(root, 'run'), GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null', LC_ALL: 'C', NO_COLOR: '1',
  } };
}

// Linux-only native mode: no inherited browser, display, DBus, SSH, auth, proxy,
// shell initialization or tool executables. These are isolation controls, not
// client trust/approval settings. This is NOT an OS filesystem/network sandbox.
export function prepareNativeScope(scope) {
  if (process.platform !== 'linux') return { status: 'untested', reason: 'native-isolation-only-tested-on-linux' };
  const bin = path.join(scope.root, 'bin');
  fs.mkdirSync(bin, { mode: 0o700 });
  let found = false;
  for (const name of ['kiro-cli', 'kiro-cli-chat']) {
    for (const dir of scope.env.PATH.split(path.delimiter).filter(dir => path.isAbsolute(dir))) {
      const candidate = path.join(dir, name);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        fs.accessSync(candidate, fs.constants.X_OK);
        fs.symlinkSync(fs.realpathSync(candidate), path.join(bin, name));
        if (name === 'kiro-cli') found = true;
        break;
      } catch { /* try next executable, never inspect its configuration */ }
    }
  }
  for (const name of ['deny-browser', 'xdg-open', 'gio', 'sensible-browser', 'x-www-browser', 'www-browser']) {
    fs.writeFileSync(path.join(bin, name), '#!/bin/sh\nexit 1\n', { flag: 'wx', mode: 0o700 });
  }
  scope.env.PATH = bin;
  scope.env.BROWSER = path.join(bin, 'deny-browser');
  return found ? { status: 'ready' } : { status: 'environment-blocked', reason: 'native-executable-not-found' };
}

/** Combined byte/deadline bounds. Kill owned group, then await leader close. */
export function runBounded(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? LIMITS.timeoutMs;
  const maxBytes = options.maxBytes ?? LIMITS.bytes;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16777216) throw new Error('invalid process bounds');
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let bytes = 0, stdout = '', stderr = '', stopReason = null, settled = false, cleanupTimer, spawnError = null;
    const outDecoder = new StringDecoder('utf8'), errDecoder = new StringDecoder('utf8');
    const kill = () => {
      try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* already exited, or cleanup cannot be confirmed */ }
    };
    const finish = (exitCode, cleanup) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(cleanupTimer); kill();
      child.stdout.destroy(); child.stderr.destroy();
      stdout += outDecoder.end(); stderr += errDecoder.end();
      resolve({ exitCode, error: spawnError, stopReason, cleanup, bytes, stdout, stderr });
    };
    const stop = reason => {
      if (stopReason || settled) return;
      stopReason = reason; kill();
      cleanupTimer = setTimeout(() => finish(null, 'unconfirmed'), LIMITS.cleanupMs);
    };
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    const collect = (chunk, isError) => {
      if (settled || stopReason) return;
      bytes += chunk.length;
      if (bytes > maxBytes) { stop('output-limit'); return; }
      if (isError) stderr += errDecoder.write(chunk); else stdout += outDecoder.write(chunk);
    };
    child.stdout.on('data', chunk => collect(chunk, false));
    child.stderr.on('data', chunk => collect(chunk, true));
    child.on('error', error => { spawnError = 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : 'spawn-error'; });
    child.on('close', code => finish(spawnError ? null : code, child.pid ? 'leader-closed' : 'not-spawned'));
  });
}

// Markers are test data, never client/model delivery evidence.
export function marker(gate, phase, identity) {
  const phases = ['hook-fired', 'model-context', 'tool-result', 'continuation', 'cancel', 'user-input', 'lifecycle'];
  if (!GATES.some(([id]) => id === gate) || !phases.includes(phase)) throw new Error('invalid marker kind');
  const keys = ['run', 'session', 'host', 'generation', 'turn'];
  if (!identity || Object.keys(identity).length !== keys.length || keys.some(key => !Object.hasOwn(identity, key) || typeof identity[key] !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(identity[key]))) throw new Error('invalid marker identity');
  return { schemaVersion: 1, gate, phase, ...identity };
}

const SWITCHES = ['--v3', '--agent', '--output-format', '--require-mcp-startup', '--resume', '--resume-id', '--list-sessions', '--format'];
// Exact diagnostics observed from installed 2.22.0, not heuristic secret-bearing
// error excerpts. Neither auth URLs nor suggested login commands are retained.
const DIAGNOSTICS = Object.freeze([
  ['auth-browser-unavailable', 'Failed to open browser for authentication.'],
  ['browser-url-open-failed', 'error: Failed to open URL'],
  ['browser-opener-not-found', 'error: No such file or directory (os error 2)'],
]);

export function sanitizeProbe(id, args, result) {
  const diagnosticLines = result.stderr.split(/\r?\n/);
  const diagnostics = DIAGNOSTICS.filter(([, text]) => diagnosticLines.includes(text)).map(([code, text]) => ({ code, text }));
  let accountAbsent = false;
  if (id === 'identity') {
    try { const value = JSON.parse(result.stdout); accountAbsent = value !== null && Object.hasOwn(value, 'account') && value.account === null; } catch { /* no identity detail persisted */ }
  }
  // stream-json is documented as self-describing ACP JSON Lines, but no payload
  // schema was observable before authentication. Retain structural envelopes
  // only. Do not invent session/update, session IDs or MCP instance semantics.
  const events = [];
  let jsonLines = 0, nonJsonLines = 0;
  if (args.includes('stream-json')) {
    for (const line of result.stdout.split('\n')) {
      if (!line.trim()) continue;
      try {
        const value = JSON.parse(line);
        if (!value || typeof value !== 'object' || Array.isArray(value)) { nonJsonLines++; continue; }
        jsonLines++;
        if (events.length < LIMITS.events) {
          const fields = {};
          for (const key of ['jsonrpc', 'id', 'type', 'method', 'params', 'result', 'error']) {
            if (Object.hasOwn(value, key)) fields[key] = value[key] === null ? 'null' : Array.isArray(value[key]) ? 'array' : typeof value[key];
          }
          events.push({ sequence: jsonLines, source: 'native-stdout-json', semantics: 'uninterpreted', fields, otherFields: Object.keys(value).length - Object.keys(fields).length });
        }
      } catch { nonJsonLines++; }
    }
  }
  const failed = result.exitCode !== 0 || result.error !== null || result.stopReason !== null || result.cleanup === 'unconfirmed';
  const authFailure = failed && (accountAbsent || diagnostics.some(item => item.code === 'auth-browser-unavailable'));
  const reason = authFailure ? 'isolated-auth-unavailable'
    : result.error ? 'native-process-spawn-failed'
    : result.stopReason ? `native-process-${result.stopReason}`
    : result.cleanup === 'unconfirmed' ? 'native-process-cleanup-unconfirmed'
    : failed ? 'unclassified-native-exit' : null;
  return { id, args, status: authFailure || result.error || result.stopReason || result.cleanup === 'unconfirmed' ? 'environment-blocked' : failed ? 'failed' : 'observed', reason,
    exitCode: result.exitCode, error: result.error, stopReason: result.stopReason, cleanup: result.cleanup, bytes: result.bytes,
    diagnostics, accountAbsent, events, jsonLines, nonJsonLines, eventsTruncated: jsonLines > events.length,
    version: id === 'version' ? result.stdout.match(/^kiro-cli (\d+\.\d+\.\d+)\s*$/)?.[1] ?? null : null,
    supportedSwitches: id === 'chat-help' ? SWITCHES.filter(flag => new RegExp(`(?:^|\\s)${flag}(?:\\s|[=,<])`, 'm').test(result.stdout)) : [],
    documentsJsonLines: id === 'chat-help' && result.stdout.includes("The run's ACP events as JSON Lines on stdout") };
}

const REMAINING = {
  H01: 'Correlate resumed turns with authoritative session and MCP instance identities.',
  H02: 'Correlate concurrent same-workspace sessions with hosts and exercise ambiguous routing rejection.',
  H03: 'Instrument real engine-ready, authorized binding and first-hook ordering.',
  H04: 'Observe hook marker in actual intended model input, not model prose or hook stdout.',
  H05: 'Exercise successful and failed tool results plus next-step marker delivery.',
  H06: 'Exercise stop-hook bounded continuation through documented native semantics.',
  H07: 'Exercise native cancellation and queued-input precedence; process timeout is not cancellation evidence.',
  H08: 'Verify new/resume identity plus clear, compact and profile-swap signals or safe recovery.',
  H09: 'Exercise each presentation mode and status/settings/reset/reload on its claimed surface.',
  H10: 'Native-TUI accept/decline/revoke exact effects not exercised; no effects authorized by this harness.',
  H11: 'Capture authoritative complete model-visible inventory; stream envelopes and picker counts do not suffice.',
  H12: 'Generation update with a retained native session not exercised; no installer/activation in this harness.',
};
export function assessGates(surface = 'headless', probes = []) {
  if (!['headless', 'native-tui', 'acp'].includes(surface)) throw new Error('invalid client surface');
  const startup = probes.find(probe => probe.id === 'chat-new');
  return GATES.map(([id, requirement]) => {
    // Only implemented lifecycle exercises inherit an observed prerequisite
    // block. Unimplemented hook/UI/inventory adapters are OUR untested work,
    // not an external host limitation. Other surfaces inherit no chat evidence.
    const blocked = surface === 'headless' && ['H01', 'H02', 'H08'].includes(id) && startup?.status === 'environment-blocked';
    return { id, surface, status: blocked ? 'environment-blocked' : 'untested', requirement,
      blocker: blocked ? startup.reason : null, remaining: REMAINING[id], evidence: blocked ? ['chat-new'] : [] };
  });
}

export const CHAT_PROMPT = 'Reply only FOVEA_PROBE_READY. Do not use tools, read files, run commands, or change anything.';
const chatArgs = suffix => ['chat', '--v3', '--output-format', 'stream-json', ...suffix, CHAT_PROMPT];

// Injection is for unit tests only, not a CLI evidence import/qualification path.
export async function executeNativeProbes(scope, prerequisites, runner = runBounded) {
  const probes = [];
  const run = async (id, args) => {
    const result = await runner('kiro-cli', args, { cwd: scope.workspace, env: scope.env });
    const probe = sanitizeProbe(id, args, result); probes.push(probe); return probe;
  };
  const skip = (id, args, dependency, reason) => probes.push({ id, args, status: 'untested', dependency, reason, events: [] });
  const version = prerequisites.find(probe => probe.id === 'version');
  const help = prerequisites.find(probe => probe.id === 'chat-help');
  if (version?.version !== '2.22.0' || version.status !== 'observed' || help?.status !== 'observed' || !help.documentsJsonLines || SWITCHES.some(flag => !help.supportedSwitches.includes(flag))) {
    skip('chat-new', chatArgs([]), 'version/chat-help', 'installed-semantics-not-verified');
    return probes;
  }
  const identity = await run('identity', ['whoami', '--format', 'json']);
  if (identity.cleanup === 'unconfirmed') {
    skip('chat-new', chatArgs([]), 'identity', 'native-process-cleanup-unconfirmed');
    return probes;
  }
  // whoami failure never substitutes for a real chat attempt. The installed
  // launcher auto-enters auth even for stream-json; browser handoff is denied.
  const first = await run('chat-new', chatArgs([]));
  const listing = first.cleanup === 'unconfirmed' ? null : await run('sessions-after-new', ['chat', '--v3', '--list-sessions', '--format', 'json']);
  if (first.cleanup === 'unconfirmed' || listing?.cleanup === 'unconfirmed') {
    for (const id of ['chat-resume', 'concurrent-a', 'concurrent-b']) skip(id, chatArgs(id === 'chat-resume' ? ['--resume'] : []), 'chat-new/sessions-after-new', 'native-process-cleanup-unconfirmed');
    return probes;
  }
  if (first.status !== 'observed' || first.jsonLines === 0) {
    const reason = first.reason ?? 'no-native-json-events-observed';
    skip('chat-resume', chatArgs(['--resume']), 'chat-new', reason);
    for (const id of ['concurrent-a', 'concurrent-b']) skip(id, chatArgs([]), 'chat-new', reason);
    return probes;
  }
  // --resume is documented to select the most recent conversation in this cwd.
  // Success is an exercise result, NOT proof of session/MCP continuity.
  const resumed = await run('chat-resume', chatArgs(['--resume']));
  if (resumed.cleanup === 'unconfirmed') {
    for (const id of ['concurrent-a', 'concurrent-b']) skip(id, chatArgs([]), 'chat-resume', 'native-process-cleanup-unconfirmed');
    return probes;
  }
  await Promise.all(['concurrent-a', 'concurrent-b'].map(id => run(id, chatArgs([]))));
  return probes.sort((a, b) => ['identity', 'chat-new', 'sessions-after-new', 'chat-resume', 'concurrent-a', 'concurrent-b'].indexOf(a.id) - ['identity', 'chat-new', 'sessions-after-new', 'chat-resume', 'concurrent-a', 'concurrent-b'].indexOf(b.id));
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) {
    console.log('Usage: fovea-capability-probe.mjs [--dry-run] [--native]\nDefault: version/help only. --native: isolated, browser-disabled chat/new/resume/concurrent lifecycle attempts. No login, live home, trust flags or effect probes. Sanitized JSON report on stdout; disposable scope removed.'); return 0;
  }
  if (argv.some(arg => !['--dry-run', '--native'].includes(arg)) || new Set(argv).size !== argv.length) throw new Error('unsupported option; caller-supplied homes, workspaces and --allow-live are forbidden');
  const report = { schemaVersion: 3, harness: 'fovea-capability-probe', run: randomUUID(), generatedAt: new Date().toISOString(), surface: 'headless', mode: argv.includes('--native') ? 'native' : 'prerequisites', qualified: false, automatic: false, gates: assessGates(), probes: [], scopeRemoved: null };
  if (argv.includes('--dry-run')) { console.log(JSON.stringify(report)); return 0; }
  const scope = createScope();
  const runner = async (command, args, options) => {
    const result = await runBounded(command, args, options);
    if (result.cleanup === 'unconfirmed') scope.cleanupUnconfirmed = true;
    return result;
  };
  try {
    if (argv.includes('--native')) report.isolation = prepareNativeScope(scope);
    if (!report.isolation || report.isolation.status === 'ready') {
      for (const [id, args] of [['version', ['--version']], ['help', ['--help']], ['chat-help', ['chat', '--help']], ['agent-help', ['agent', '--help']]]) {
        report.probes.push(sanitizeProbe(id, args, await runner('kiro-cli', args, { cwd: scope.workspace, env: scope.env })));
        if (scope.cleanupUnconfirmed) break;
      }
      if (argv.includes('--native') && !scope.cleanupUnconfirmed) report.probes.push(...await executeNativeProbes(scope, report.probes, runner));
    }
    report.gates = assessGates(report.surface, report.probes);
  } finally {
    // Do not race a possibly surviving process by removing its scope.
    if (!scope.cleanupUnconfirmed) fs.rmSync(scope.root, { recursive: true, force: true });
    else report.cleanupBlocker = 'native-process-cleanup-unconfirmed';
    report.scopeRemoved = !fs.existsSync(scope.root);
  }
  console.log(JSON.stringify(report, null, 2)); return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }).catch(() => { console.error('capability probe failed; no qualification granted'); process.exitCode = 2; });
}
