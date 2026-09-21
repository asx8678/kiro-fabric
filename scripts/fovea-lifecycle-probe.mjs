#!/usr/bin/env node
// Opt-in native lifecycle evidence only. No qualification, installation or runtime adaptation.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { runBounded } from './fovea-capability-probe.mjs';
export const PROFILE = 'fovea-lifecycle-contract';
export const LEDGER = Object.freeze({
  cancellation: 'Native cancellation acknowledgement, not an Escape write or process kill',
  queuedInput: 'Accepted queued input and its order relative to cancellation/automatic work',
  resume: 'Same native session plus a fresh nonce MCP call recorded after resume begins',
  clearCompactProfile: 'Supported clear, compact and profile swap with new-turn isolation',
  controls: 'Actual Fovea settings/reset/reload effects, not CLI help or protocol fixtures',
  retainedGeneration: 'Active old session retains matching engine/hooks across an authorized update',
});
export function lifecycleProfile(root, node = process.execPath) {
  const quote = value => "'" + value.replaceAll("'", "'\\''").replaceAll('$', () => "$''") + "'";
  return { name: PROFILE, description: 'Owned lifecycle protocol fixture; NOT Fabric execution',
    prompt: 'Use only @fabric/fabric_exec as requested, a harmless protocol fixture. Never use native tools, delegate, or modify files.',
    includeMcpJson: false, includePowers: false, tools: ['@fabric/fabric_exec'], allowedTools: ['@fabric/fabric_exec'],
    permissions: { rules: [{ capability: 'mcp', match: ['fabric/fabric_exec'], effect: 'allow' }] },
    mcpServers: { fabric: { command: node, args: [path.resolve('tests/fovea/fixtures/lifecycle-contract-mcp.mjs'), root], waitForReady: true } },
    hooks: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'].map(trigger => ({
      name: 'lifecycle-' + trigger, trigger, timeout: 15,
      action: { type: 'command', command: [node, path.resolve('tests/fovea/fixtures/lifecycle-contract-hook.mjs'), root].map(quote).join(' ') },
      ...(['PreToolUse', 'PostToolUse'].includes(trigger) ? { matcher: '^mcp_fabric_fabric_exec$' } : {}),
    })) };
}
function parseStream(stdout) {
  return stdout.split('\n').flatMap(line => { try { const value = JSON.parse(line); return value && typeof value === 'object' && !Array.isArray(value) ? [value] : []; } catch { return []; } });
}
// Only actual recorder envelopes and correlated native request/response IDs count.
// Hook input writes alone cannot establish acknowledged cancellation or queue order.
export function summarizeCancellationAcknowledgment(frames = [], hooks = []) {
  const id = value => `${typeof value}:${String(value)}`;
  const messages = frames.filter(row => row && ['in', 'out'].includes(row.dir) && row.msg && Number.isSafeInteger(row.ts));
  const promptText = row => (row.msg.params?.prompt ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');
  const requests = messages.filter(row => row.dir === 'out' && row.msg.method === 'session/prompt' && row.msg.id !== undefined);
  const cancellation = messages.find(row => row.dir === 'out' && row.msg.method === 'session/cancel' && typeof row.msg.params?.sessionId === 'string');
  const initial = cancellation && requests.find(row => row.msg.params?.sessionId === cancellation.msg.params.sessionId && row.ts < cancellation.ts && promptText(row).includes('LIFECYCLE_DELAY'));
  const reply = initial && messages.find(row => row.dir === 'in' && !row.msg.method && id(row.msg.id) === id(initial.msg.id) && row.ts >= cancellation.ts && row.msg.result?.stopReason === 'cancelled');
  const hookCancel = cancellation && messages.find(row => row.dir === 'in' && row.msg.method === '_kiro/hooks/cancel' && row.msg.params?.sessionId === cancellation.msg.params.sessionId && row.ts >= cancellation.ts);
  const queued = reply && requests.find(row => row.msg.params?.sessionId === initial.msg.params.sessionId && row.ts >= reply.ts && promptText(row).includes('LIFECYCLE_QUEUED'));
  const queuedReply = queued && messages.find(row => row.dir === 'in' && !row.msg.method && id(row.msg.id) === id(queued.msg.id) && row.ts >= queued.ts && row.msg.result?.stopReason === 'end_turn');
  const delayedStart = initial && hooks.find(row => row.kind === 'hook-start' && row.trigger === 'UserPromptSubmit' && row.sessionId === initial.msg.params.sessionId && row.prompt === promptText(initial) && row.at <= cancellation.ts);
  const delayedEnd = delayedStart && hooks.find(row => row.kind === 'hook-end' && row.trigger === 'UserPromptSubmit' && row.sessionId === delayedStart.sessionId && row.prompt === delayedStart.prompt && row.at >= delayedStart.at);
  const queuedHook = queued && hooks.find(row => row.kind === 'hook-start' && row.trigger === 'UserPromptSubmit' && row.sessionId === queued.msg.params.sessionId && row.prompt === promptText(queued) && row.at >= queued.ts);
  return { qualified: false, automatic: false,
    turnCancellationAcknowledged: Boolean(reply), hookCancelNotificationObserved: Boolean(hookCancel),
    sessionId: initial?.msg.params.sessionId ?? null, cancelledPromptId: initial?.msg.id ?? null,
    cancelAtMs: cancellation?.ts ?? null, acknowledgedAtMs: reply?.ts ?? null,
    hookCompletedAfterAcknowledgmentMs: reply && delayedEnd ? delayedEnd.at - reply.ts : null,
    queuedPromptAccepted: Boolean(queuedHook), queuedTurnCompleted: Boolean(queuedReply),
    queuedPromptAfterCancelMs: reply && queued ? queued.ts - reply.ts : null,
    oldHookCompletedAfterQueuedTurn: Boolean(delayedEnd && queuedReply && delayedEnd.at > queuedReply.ts),
    hookSignals: hooks.filter(row => row.kind === 'hook-signal').map(row => row.signal),
    fullAutomaticCancellationContractQualified: false };
}
const clean = r => r?.exitCode === 0 && !r.error && !r.stopReason && r.cleanup === 'leader-closed';
export function streamIdentity(result) {
  const events = parseStream(result.stdout), sessions = [...new Set(events.map(e => e.data?.sessionId).filter(s => typeof s === 'string' && s.length > 0))];
  const modes = events.flatMap(e => e.data?.update?.configOptions ?? []).filter(o => o.id === 'mode').map(o => o.currentValue);
  return { sessionId: sessions.length === 1 ? sessions[0] : null, selectedMode: modes.at(-1) ?? null };
}
/**
 * @typedef {{kind: string, at?: number, instance?: string, marker?: string, trigger?: string, sessionId?: string, prompt?: string, signal?: string, parameterKeys?: string[], meta?: unknown, params?: unknown}} LifecycleRow
 * @typedef {{phase: string, marker?: string, mcpStart: number, mcpEnd: number, result: {stdout: string, exitCode: number|null, error: string|null, stopReason: string|null, cleanup: string}}} LifecycleRun
 * @param {{runs?: LifecycleRun[], hooks?: LifecycleRow[], mcp?: LifecycleRow[], driver?: LifecycleRow[], acp?: any[]}} [input]
 */
export function summarizeLifecycle({ runs = [], hooks = [], mcp = [], driver = [], acp = [] } = {}) {
  const initial = runs.find(r => r.phase === 'initial'), resumed = runs.find(r => r.phase === 'resume');
  const first = initial ? streamIdentity(initial.result) : null, second = resumed ? streamIdentity(resumed.result) : null;
  // A transcript echo can never satisfy this: only newly appended recorder calls count.
  const freshCall = run => Boolean(run && typeof run.marker === 'string' && run.marker.length > 0 && Number.isSafeInteger(run.mcpStart) && Number.isSafeInteger(run.mcpEnd) && run.mcpStart >= 0 && run.mcpEnd > run.mcpStart && run.mcpEnd <= mcp.length && mcp.slice(run.mcpStart, run.mcpEnd).some(row => row.kind === 'call' && row.marker === run.marker));
  const resumedNewTurn = Boolean(initial && resumed && clean(initial.result) && clean(resumed.result) &&
    resumed.mcpStart >= initial.mcpEnd && first.sessionId && first.sessionId === second.sessionId && first.selectedMode === PROFILE && second.selectedMode === PROFILE && freshCall(initial) && freshCall(resumed) && initial.marker !== resumed.marker);
  const escape = driver.find(row => row.kind === 'escape-written');
  const delayed = hooks.find(row => row.kind === 'hook-start' && row.trigger === 'UserPromptSubmit' && row.prompt?.includes('LIFECYCLE_DELAY'));
  const delayedEnd = hooks.find(row => row.kind === 'hook-end' && row.trigger === 'UserPromptSubmit' && row.sessionId === delayed?.sessionId && row.prompt === delayed?.prompt);
  const queued = hooks.filter(row => row.kind === 'hook-start' && row.trigger === 'UserPromptSubmit' && row.prompt?.includes('LIFECYCLE_QUEUED'));
  const acknowledgement = summarizeCancellationAcknowledgment(acp, hooks);
  return { schemaVersion: 1, automatic: false, qualified: false, evidenceKind: 'native-protocol-fixture-not-Fabric',
    ledger: LEDGER, resumedNewTurn, initial: first, resumed: second,
    diagnosticCompleted: runs.some(run => run.phase === 'tui-cancel')
      ? runs.every(run => clean(run.result)) && acknowledgement.turnCancellationAcknowledged && acknowledgement.queuedPromptAccepted && acknowledgement.queuedTurnCompleted
      : resumedNewTurn,
    nativeAcknowledgment: acknowledgement,
    cancellation: { status: acknowledgement.turnCancellationAcknowledged ? 'partial' : escape ? 'unqualified' : 'untested', acknowledgement: acknowledgement.turnCancellationAcknowledged ? 'native-turn-cancelled' : 'not-observed', escapeWritten: Boolean(escape),
      hookEndAfterEscapeMs: escape && delayedEnd ? delayedEnd.at - escape.at : null,
      signals: hooks.filter(row => row.kind === 'hook-signal').map(row => ({ at: row.at, signal: row.signal })) },
    queuedInput: { status: acknowledgement.queuedPromptAccepted && acknowledgement.queuedTurnCompleted ? 'partial' : queued.length || driver.some(row => row.kind === 'queued-written') ? 'unqualified' : 'untested', acceptedPromptHooks: queued.map(row => ({ at: row.at, sessionId: row.sessionId })), ordering: acknowledgement.queuedPromptAccepted && acknowledgement.queuedTurnCompleted ? 'native-queued-turn-after-cancel-observed' : 'unverified' },
    runs: runs.map(({ phase, result, mcpStart, mcpEnd }) => ({ phase, cleanExit: clean(result), exitCode: result.exitCode, error: result.error, stopReason: result.stopReason, cleanup: result.cleanup, mcpStart, mcpEnd })),
    mcpCalls: mcp.filter(row => row.kind === 'call'), hookEvents: hooks,
    blockers: ['No supported native session-to-MCP association established', 'Intended-turn model-input acknowledgement unobserved'],
    untested: ['clear/compact/profile-swap isolation', 'Fovea settings/reset/reload effects', 'retained generation across update', ...(acknowledgement.turnCancellationAcknowledged && acknowledgement.queuedTurnCompleted ? ['full automatic-work cancellation and queue precedence'] : ['native cancellation acknowledgement and queued-input precedence'])],
    productionChanges: false };
}
export function lifecycleDriver() {
  // Native UI inputs only. Correlated ACP/hook evidence is analyzed separately.
  return `set timeout 40
set env(TERM) xterm-256color
set root [lindex $argv 0]
set nativeClosed 0
proc pump {seconds} {
  global spawn_id nativeClosed
  set deadline [expr {[clock milliseconds]+$seconds*1000}]
  while {[clock milliseconds] < $deadline && !$nativeClosed} {
    if {[catch {expect -timeout 1 {
      -re {\\x1b\\[6n} {send "\\033\\[1;1R"}
      eof {set nativeClosed 1}
      timeout {}
    }}]} {set nativeClosed 1}
  }
}
proc note {kind} {
  global root
  set f [open [file join $root driver.jsonl] a]
  puts $f "\\{\\\"at\\\":[clock milliseconds],\\\"kind\\\":\\\"$kind\\\"\\}"
  close $f
}
spawn -noecho kiro-cli chat --v3 --agent fovea-lifecycle-contract --require-mcp-startup
stty rows 40 columns 125 < $spawn_out(slave,name)
expect {
  -re {\\x1b\\[6n} {send "\\033\\[1;1R"; exp_continue}
  -re {ask a question or describe a task} {}
  timeout {note startup-timeout; exit 2}
  eof {note startup-eof; exit 2}
}
send -- "LIFECYCLE_DELAY Reply only DELAY_DONE. No tools.\\r"
note initial-written
set deadline [expr {[clock milliseconds] + 12000}]
set found 0
while {[clock milliseconds] < $deadline && !$nativeClosed} {
  pump 1
  if {[file exists [file join $root hooks.jsonl]]} {
    set f [open [file join $root hooks.jsonl] r]; set text [read $f]; close $f
    if {[string first LIFECYCLE_DELAY $text] >= 0} {set found 1; break}
  }
}
if {!$found} {note hook-start-timeout; exit 2}
send -- "LIFECYCLE_QUEUED Reply only QUEUED_DONE. No tools."
send "\\023"
note queue-mode-written
pump 1
send "\\r"
note queued-written
pump 1
send "\\033"
note escape-written
pump 20
if {!$nativeClosed} {send "\\025/quit\\r"; note quit-written; pump 4}
if {!$nativeClosed} {send "\\003"; pump 1; send "\\003"; pump 1}
set status [wait]
exit [lindex $status 3]
`;
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log('Usage: node scripts/fovea-lifecycle-probe.mjs --authenticated [--tui-cancel]\nExisting authorized authentication; coordinate live window first. Owned .tmp profile only. Default: fresh + --resume-id new nonce calls. TUI: Ctrl+S queue mode, Enter submit, Escape cancel; correlates actual native ACP acknowledgments, never input writes alone. No installation or automatic integration.'); return 0;
  }
  if (!argv.includes('--authenticated') || argv.some(a => !['--authenticated', '--tui-cancel'].includes(a)) || new Set(argv).size !== argv.length) throw new Error('explicit --authenticated required; unsupported argument');
  fs.mkdirSync(path.resolve('.tmp'), { recursive: true });
  const root = fs.mkdtempSync(path.resolve('.tmp/fovea-lifecycle-')); fs.chmodSync(root, 0o700);
  const dir = path.join(root, '.kiro', 'agents'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const write = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  const profile = lifecycleProfile(root); write('profile-snapshot.json', profile);
  const registration = path.join(dir, PROFILE + '.json'); fs.writeFileSync(registration, JSON.stringify(profile), { flag: 'wx', mode: 0o600 });
  const load = name => { const file = path.join(root, name); if (!fs.existsSync(file)) return []; if (fs.statSync(file).size > 1048576) throw new Error('recorder byte limit exceeded'); return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); };
  const runs = [];
  try {
    if (argv.includes('--tui-cancel')) {
      const driver = path.join(root, 'driver.exp'); fs.writeFileSync(driver, lifecycleDriver(), { flag: 'wx', mode: 0o600 });
      const result = await runBounded('expect', [driver, root], { cwd: root, env: { ...process.env, KIRO_ACP_RECORD_PATH: path.join(root, 'native-acp.jsonl') }, timeoutMs: 110000, maxBytes: 1048576 });
      runs.push({ phase: 'tui-cancel', result, mcpStart: 0, mcpEnd: load('mcp.jsonl').length }); write('tui-output.json', result);
    } else {
      for (const phase of ['initial', 'resume']) {
        const marker = phase + '-' + randomUUID(), mcpStart = load('mcp.jsonl').length;
        const previous = runs[0];
        if (phase === 'resume' && (!clean(previous.result) || !streamIdentity(previous.result).sessionId || streamIdentity(previous.result).selectedMode !== PROFILE)) break;
        const args = ['chat', '--v3', '--agent', PROFILE, '--output-format', 'stream-json', '--require-mcp-startup', ...(phase === 'resume' ? ['--resume-id', streamIdentity(previous.result).sessionId] : []), `Call only @fabric/fabric_exec once with marker ${marker}. This is a harmless protocol fixture. No native tools or delegation. Then reply DONE.`];
        const result = await runBounded('kiro-cli', args, { cwd: root, env: process.env, timeoutMs: 90000, maxBytes: 1048576 });
        runs.push({ phase, marker, mcpStart, mcpEnd: load('mcp.jsonl').length, result }); write(phase + '-output.json', result);
      }
    }
    const report = summarizeLifecycle({ runs, hooks: load('hooks.jsonl'), mcp: load('mcp.jsonl'), driver: load('driver.jsonl'), acp: load('native-acp.jsonl') });
    write('runs.json', runs); write('report.json', report);
    console.log(JSON.stringify({ evidence: root, ...report }, null, 2));
    return report.diagnosticCompleted ? 0 : 2;
  } finally {
    // Cleanup only owned registration, and only after bounded runner closed every leader.
    if (runs.length && runs.every(r => r.result.cleanup === 'leader-closed' && !r.result.error && !r.result.stopReason)) fs.unlinkSync(registration);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 2; });
