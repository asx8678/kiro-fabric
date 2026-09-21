// Actual Fabric through supported native TUI inputs. No private RPC or approval response is sent.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runBounded } from './fovea-capability-probe.mjs';
export const SESSION_TIMEOUT_MS = 300000; // Development runner's existing hard ceiling; not a production deadline.
export const SESSION_PHASES = ['initial', 'post-compact', 'post-swap', 'post-clear', 'detach', 'post-detach'];
export function sessionProgram(marker, phase) {
  if (!/^[a-z0-9-]{1,80}$/u.test(marker) || !SESSION_PHASES.includes(phase)) throw Error('Invalid session probe phase');
  const start = `async function attempt(run: () => Promise<JsonValue>): Promise<JsonObject> { try { return {ok:true,value:await run()}; } catch(error) { return {ok:false,error:String(error)}; } }
const info = await fabric.info();
const workspace = await fabric.workspace({action:"status"});`;
  const prefix = `marker:${JSON.stringify(marker)},phase:${JSON.stringify(phase)},lifecycle:info.lifecycle ?? null,workspace`;
  if (phase === 'detach') return `${start}
return {${prefix},detached:await fabric.workspace({action:"detach"})};`;
  if (phase === 'post-detach') return `${start}
const navigation = await attempt(() => repo.focus({query:"ControlSentinel",maxTokens:512}));
return {${prefix},navigation};`;
  return `${start}
const before = await repo.status();
const settings = await repo.settings();
const previousFocus = await attempt(() => repo.dwell({maxTokens:512}));
const focus = await repo.focus({query:"ControlSentinel",fresh:true,maxTokens:512});
return {${prefix},before,settings,previousFocus,seed:{status:focus.status,resultId:focus.resultId,focusId:focus.focusId ?? null,reads:focus.reads},after:await repo.status()};`;
}

function promptBounds(frames, marker) {
  const starts = frames.filter(f => f?.dir === 'out' && f.msg?.method === 'session/prompt' && f.msg.id !== undefined &&
    f.msg.params?.prompt?.some(p => p.type === 'text' && p.text?.includes(marker)));
  const start = starts.length === 1 ? frames.indexOf(starts[0]) : -1;
  const end = start < 0 ? -1 : frames.findIndex((f, i) => i > start && f?.dir === 'in' && !f.msg?.method && f.msg?.id === frames[start].msg.id && f.msg.result?.stopReason === 'end_turn');
  return { start, end };
}
function acknowledged(frames, after, before, predicate) {
  const requests = frames.filter((f, i) => i > after && i < before && f?.dir === 'out' && f.msg?.id !== undefined && predicate(f.msg));
  if (requests.length !== 1) return null;
  const index = frames.indexOf(requests[0]);
  const responses = frames.filter((f, i) => i > index && i < before && f?.dir === 'in' && !f.msg?.method && f.msg?.id === requests[0].msg.id);
  return responses.length === 1 && !responses[0].msg.error && responses[0].msg.result !== undefined ? responses[0].msg.result : null;
}
export function summarizeSessionTransitions({ frames, runs, plans }) {
  const bounds = plans.map(p => promptBounds(frames, p.marker));
  const complete = runs.length === SESSION_PHASES.length && runs.every((r, i) => r.completed && r.phase === SESSION_PHASES[i]) &&
    new Set(runs.map(r => r.marker)).size === runs.length && new Set(runs.map(r => r.toolCallId)).size === runs.length &&
    bounds.every((b, i) => b.start >= 0 && b.end > b.start && (!i || b.start > bounds[i - 1].end));
  const [a, b, c, d, detach, revoked] = runs;
  const native = r => r?.sessionId;
  const mcp = r => r?.packet?.lifecycle?.mcpInstanceId;
  const bound = i => bounds[i] ?? { start: -1, end: -1 };
  const compact = acknowledged(frames, bound(0).end, bound(1).start, m => m.method === '_kiro/session/compact' && m.params?.sessionId === native(a));
  const swap = acknowledged(frames, bound(1).end, bound(2).start, m => m.method === 'session/set_config_option' && m.params?.sessionId === native(b) && m.params?.configId === 'mode' && m.params?.value === plans[2]?.profile);
  const clear = acknowledged(frames, bound(2).end, bound(3).start, m => m.method === 'session/new');
  const checks = {
    freshFabricTurns: complete,
    compactAcknowledged: Boolean(a && b && native(a) && compact && native(a) === native(b)),
    profileSwapAcknowledged: Boolean(b && c && native(b) === native(c) && swap?.configOptions?.some(o => o.id === 'mode' && o.currentValue === plans[2]?.profile)),
    clearCreatedNewSession: Boolean(c && d && native(c) !== native(d) && clear?.sessionId === native(d)),
    boundNavigation: runs.length >= 4 && runs.slice(0, 4).every(r => r.completed && r.packet?.workspace?.status === 'bound' && r.packet?.seed?.status === 'ok' && r.packet?.after?.capabilities?.automatic === false),
    detachCommitted: Boolean(detach?.completed && detach.packet?.workspace?.status === 'bound' && detach.packet?.detached?.status === 'pending' && detach.packet.detached.committed === false && detach.transition?.committed === true && detach.transition.status === 'unbound' && detach.transition.nextExecutionRequired === true),
    revokedInSameMcpInstance: Boolean(detach?.completed && revoked?.completed && native(detach) === native(revoked) && typeof mcp(detach) === 'string' && mcp(detach) === mcp(revoked) && revoked.packet?.workspace?.status === 'unbound' && revoked.packet?.workspace?.verification === 'unbound' && revoked.packet?.navigation?.ok === false && /not (?:found|available)|unavailable|unknown.*(?:action|repo)|no provider|unbound|workspace/i.test(revoked.packet?.navigation?.error ?? '')),
  };
  return { schemaVersion: 1, kind: 'kiro-fabric.native-session-controls', qualified: false, automatic: false, checks,
    diagnosticCompleted: Object.values(checks).every(Boolean),
    observations: runs.map(r => ({ phase: r.phase, nativeSessionId: r.sessionId, mcpInstanceId: mcp(r) ?? null, hostInstanceId: r.packet?.before?.hostInstanceId ?? null,
      previousFocus: r.packet?.previousFocus ?? null, workspace: r.packet?.workspace ?? null, exactCall: r.exactCall, completed: r.completed })),
    stateRestorationQualified: false, isolationQualified: false,
    remaining: ['supported native session-to-MCP association', 'restoration/isolation of settings, focus, results and rule trust', 'active in-flight workspace revocation', 'human approval and native delivery', 'old-generation retention across update'] };
}

export function sessionDriver(profile, alternate) {
  if (![profile, alternate].every(p => /^[a-z-]+$/u.test(p))) throw Error('Invalid diagnostic profile name');
  return `set timeout 45
set env(TERM) xterm-256color
set root [lindex $argv 0]
set nativeClosed 0
proc pump {} {
  global spawn_id nativeClosed
  if {[catch {expect -timeout 1 {
    -re {\\x1b\\[6n} {send "\\033\\[1;1R"}
    eof {set nativeClosed 1}
    timeout {}
  }} problem]} {
    if {[string match {*spawn id * not open*} $problem]} {set nativeClosed 1} else {error $problem}
  }
}
proc waitfile {name seconds} {
  global root nativeClosed
  set deadline [expr {[clock milliseconds] + $seconds * 1000}]
  while {![file exists [file join $root $name]] && !$nativeClosed && [clock milliseconds] < $deadline} {pump}
  if {![file exists [file join $root $name]]} {error "native evidence not observed: $name"}
}
proc turn {phase} {
  global root spawn_id
  set f [open [file join $root "$phase-prompt.txt"] r]; set prompt [read $f]; close $f
  send -- "$prompt\\r"
  waitfile "$phase-done" 90
  pump
}
spawn -noecho kiro-cli chat --v3 --agent ${profile} --require-mcp-startup
stty rows 45 columns 130 < $spawn_out(slave,name)
expect {
  -re {\\x1b\\[6n} {send "\\033\\[1;1R"; exp_continue}
  -re {ask a question or describe a task} {}
  timeout {exit 2}
  eof {exit 2}
}
turn initial
send "/compact\\r"
waitfile compact-ack 60
turn post-compact
send "/agent swap ${alternate}\\r"
waitfile swap-ack 30
turn post-swap
send "/clear\\r"
waitfile clear-ack 30
turn post-clear
turn detach
turn post-detach
send "/quit\\r"
set timeout 15
expect { eof {} timeout {exit 2} }
set status [wait]
exit [lindex $status 3]
`;
}

export async function runSessionProbe({ root, workspace, profile, write, traces, loadLines, summarizeControlRun }) {
  const alternate = { ...profile, name: profile.name + '-alt' };
  const alternateFile = path.join(workspace, '.kiro/agents', alternate.name + '.json');
  write('workspace/.kiro/agents/' + alternate.name + '.json', alternate);
  write('alternate-profile.json', alternate);
  const plans = SESSION_PHASES.map((phase, i) => { const marker = phase + '-' + randomUUID(); return { phase, marker, profile: i < 2 ? profile.name : alternate.name, code: sessionProgram(marker, phase) }; });
  for (const plan of plans) {
    const code = plan.code;
    write(plan.phase + '-input.json', { code, resultFormat: 'json' });
    write(plan.phase + '-prompt.txt', 'Call only @fabric/fabric_exec exactly once with code ' + JSON.stringify(code) + ' and resultFormat json. This is an authorized disposable workspace diagnostic. Do not retry, use native tools or change permissions. Stop after the result.');
  }
  write('session-plans.json', plans); write('driver.exp', sessionDriver(profile.name, alternate.name));
  const record = path.join(root, 'native-acp.jsonl');
  const provisional = { exitCode: 0, error: null, stopReason: null, cleanup: 'leader-closed' };
  const collect = result => {
    const frames = loadLines(record), allTraces = traces();
    const runs = plans.map(plan => {
      const { start, end } = promptBounds(frames, plan.marker);
      const windowTraces = start >= 0 && end > start ? allTraces.filter(t => Date.parse(t.ts) >= frames[start].ts && Date.parse(t.ts) <= frames[end].ts) : [];
      return summarizeControlRun({ frames: end >= 0 ? frames.slice(0, end + 1) : [], traces: windowTraces, result, ...plan, expectedProfile: plan.profile });
    });
    return { frames, runs };
  };
  // Provisional checks only unblock the driver. Final evidence always uses the
  // actual bounded process outcome, never this provisional cleanup value.
  const tick = () => {
    try {
      const { frames, runs } = collect(provisional);
      for (const run of runs) if (run.completed && !fs.existsSync(path.join(root, run.phase + '-done'))) write(run.phase + '-done', 'observed\n');
      const b = plans.map(p => promptBounds(frames, p.marker));
      for (const { name, index, predicate } of [
        { name: 'compact', index: 0, predicate: m => m.method === '_kiro/session/compact' && m.params?.sessionId === runs[0]?.sessionId },
        { name: 'swap', index: 1, predicate: m => m.method === 'session/set_config_option' && m.params?.sessionId === runs[1]?.sessionId && m.params?.configId === 'mode' && m.params?.value === alternate.name },
        { name: 'clear', index: 2, predicate: m => m.method === 'session/new' },
      ]) {
        if (b[index].end >= 0 && acknowledged(frames, b[index].end, frames.length, predicate) && !fs.existsSync(path.join(root, name + '-ack'))) write(name + '-ack', 'observed\n');
      }
    } catch { /* A recorder may be between writes; final complete-file parsing is strict. */ }
  };
  const timer = setInterval(tick, 200);
  let result;
  try {
    result = await runBounded('expect', [path.join(root, 'driver.exp'), root], { cwd: workspace,
      env: { ...process.env, KIRO_ACP_RECORD_PATH: record, KIRO_FABRIC_LAUNCH_WORKSPACE: workspace }, timeoutMs: SESSION_TIMEOUT_MS, maxBytes: 2097152 });
    write('native-output.json', result);
    const { frames, runs } = collect(result);
    write('session-runs.json', runs);
    return { result, report: summarizeSessionTransitions({ frames, runs, plans }) };
  } finally {
    clearInterval(timer);
    if (result?.cleanup === 'leader-closed' && !result.error && !result.stopReason) fs.unlinkSync(alternateFile);
  }
}
