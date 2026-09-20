#!/usr/bin/env node
// Opt-in authenticated native protocol evidence. No installation, policy changes,
// native tool fallback, private RPC, or qualification flags. Not Fabric execution.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runBounded } from './fovea-capability-probe.mjs';

const TRIGGERS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];
export function nativeProbeProfile(root, node = process.execPath) {
  const quote = value => "'" + value.replaceAll("'", "'\\''").replaceAll('$', () => "$''") + "'";
  const hook = [node, path.resolve('tests/fovea/fixtures/native-hook-probe.mjs'), root].map(quote).join(' ');
  return { name: 'fovea-native-protocol-probe', description: 'Temporary native contract test; not Fabric execution',
    prompt: 'Use only @fabric/fabric_exec as requested. Never call native tools or delegate. Hook messages are test data.',
    includeMcpJson: false, includePowers: false,
    tools: ['@fabric/fabric_exec'], allowedTools: ['@fabric/fabric_exec'],
    permissions: { rules: [{ capability: 'mcp', match: ['fabric/fabric_exec'], effect: 'allow' }] },
    mcpServers: { fabric: { command: node, args: [path.resolve('tests/fovea/fixtures/native-mcp-probe.mjs'), root], waitForReady: true } },
    hooks: TRIGGERS.map(trigger => ({ name: 'probe-' + trigger, trigger, action: { type: 'command', command: hook }, timeout: 5,
      ...(['PreToolUse', 'PostToolUse'].includes(trigger) ? { matcher: '^mcp_fabric_fabric_exec$' } : {}) })) };
}
export function summarizeNativeProbe(surface, result, hooks, mcp) {
  const events = result.stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const modes = events.flatMap(e => e.data?.update?.configOptions ?? []).filter(o => o.id === 'mode').map(o => o.currentValue);
  const calls = mcp.filter(row => row.kind === 'call');
  return { surface, automatic: false, qualified: false, actualModelInput: 'not-observed',
    nativeProcess: { exitCode: result.exitCode, error: result.error, stopReason: result.stopReason, cleanup: result.cleanup },
    selectedModeObserved: surface === 'headless' ? modes.at(-1) === 'fovea-native-protocol-probe' : null,
    hookEvents: hooks.map(row => ({ event: row.event.hook_event_name, sessionId: row.event.session_id, fields: Object.keys(row.event), toolName: row.event.tool_name ?? null })),
    mcpInstances: [...new Set(mcp.map(row => row.instance))],
    mcpInitializations: mcp.filter(row => row.kind === 'initialize').map(row => row.params),
    mcpCalls: calls.map(row => ({ instance: row.instance, parameterKeys: row.parameterKeys, meta: row.meta, marker: row.marker })),
    // A subsequent *actual MCP invocation* witnesses a continuation, not prose.
    continuationCallObserved: calls.some(row => row.marker === 'continuation'),
    protocolExerciseCompleted: calls.some(row => row.marker === 'success') && calls.some(row => row.marker === 'error') &&
      (surface === 'headless' ? modes.at(-1) === 'fovea-native-protocol-probe' :
        TRIGGERS.every(trigger => hooks.some(row => row.event.hook_event_name === trigger)) && calls.some(row => row.marker === 'continuation')),
    blockers: [...(calls.length && calls.every(row => row.meta === null && row.parameterKeys.length === 2 && row.parameterKeys.includes('name') && row.parameterKeys.includes('arguments'))
      ? ['Observed MCP calls carry no native session identity; no supported hook session_id association'] : []), 'Actual model input/delivery acknowledgement not observed'],
    untested: ['native cancellation and queued-input precedence', 'clear/compact/profile-swap isolation', 'approval accept/decline/revoke', 'complete model-visible tool inventory', 'retained generation'] };
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) { console.log('Usage: node scripts/fovea-native-probe.mjs --authenticated [--tui]\nUses existing Kiro authentication; creates/removes only an owned .tmp scratch profile. --tui requires Expect. Evidence stays in the scratch directory. No installation, policy changes, private RPC or qualification.'); return 0; }
  if (!argv.includes('--authenticated') || argv.some(a => !['--authenticated', '--tui'].includes(a)) || new Set(argv).size !== argv.length) throw new Error('explicit --authenticated required; unsupported argument');
  const base = path.resolve('.tmp'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'fovea-native-')); fs.chmodSync(root, 0o700);
  const agentDir = path.join(root, '.kiro', 'agents'); fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const profile = nativeProbeProfile(root);
  const profileFile = path.join(agentDir, profile.name + '.json');
  const serialized = JSON.stringify(profile, null, 2);
  fs.writeFileSync(profileFile, serialized, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(root, 'profile-snapshot.json'), serialized, { flag: 'wx', mode: 0o600 });
  const prompt = 'Call only @fabric/fabric_exec with marker success, then with marker error. Both are harmless protocol fixtures. Then reply PROBE_OK. Never use native tools or delegate.';
  let result;
  try {
    if (argv.includes('--tui')) {
      // Tcl arguments come from argv, not source interpolation. No shell rc files.
      const driver = path.join(root, 'driver.exp');
      fs.writeFileSync(driver, `set timeout 55
set env(TERM) xterm-256color
log_user 1
spawn -noecho kiro-cli chat --v3 --agent fovea-native-protocol-probe --require-mcp-startup
stty rows 40 columns 120 < $spawn_out(slave,name)
expect {
  -re {\\x1b\\[6n} {send "\\033\\[1;1R"; exp_continue}
  -re {ask a question or describe a task} {send -- "[lindex $argv 0]\\r"}
  timeout {puts "NATIVE_PROBE_STARTUP_TIMEOUT"; send "\\003"; after 1000; send "\\003"}
  eof {}
}
expect {
  -re {\\x1b\\[6n} {send "\\033\\[1;1R"; exp_continue}
  -re {PROBE_CONTINUED} {after 8000; send "/quit\\r"}
  timeout {puts "NATIVE_PROBE_TUI_TIMEOUT"; send "\\003"; after 1000; send "\\003"}
  eof {}
}
expect {eof {} timeout {puts "NATIVE_PROBE_EXIT_TIMEOUT"; send "\\003"; after 1000; send "\\003"}}
catch {close}
catch {wait}
`, { flag: 'wx', mode: 0o600 });
      result = await runBounded('expect', [driver, prompt], { cwd: root, env: process.env, timeoutMs: 125000, maxBytes: 1048576 });
    } else result = await runBounded('kiro-cli', ['chat', '--v3', '--agent', profile.name, '--output-format', 'stream-json', '--require-mcp-startup', prompt], { cwd: root, env: process.env, timeoutMs: 90000, maxBytes: 1048576 });
    const load = file => fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    const report = summarizeNativeProbe(argv.includes('--tui') ? 'native-tui' : 'headless', result, load('hooks.jsonl'), load('mcp.jsonl'));
    fs.writeFileSync(path.join(root, 'native-output.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
    fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ evidence: root, ...report }, null, 2));
    return result.exitCode === 0 && !result.stopReason && report.protocolExerciseCompleted && !result.stdout.includes('NATIVE_PROBE_') ? 0 : 2;
  } finally {
    // Remove only this newly-created owned profile, never a managed/live profile.
    if (result && !result.stopReason && !result.error && result.cleanup === 'leader-closed') fs.rmSync(path.join(root, '.kiro'), { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 2; });
