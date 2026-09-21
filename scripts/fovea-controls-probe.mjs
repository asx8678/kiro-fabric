#!/usr/bin/env node
// Opt-in native client diagnostic. No installation, automatic hooks or auto-approval.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateAgentProfile } from './agent-profile.mjs';
import { validateBundle } from './bundle-contract.mjs';
import { verifyBuildClosure } from './build-inputs.mjs';
import { runBounded } from './fovea-capability-probe.mjs';
import { RULE_FIXTURES, extraControlProgram, summarizeExtraControl, controlDecisionEvidence, extraDecisionEvidence } from './fovea-control-cases.mjs';
import { runSessionProbe, promptBounds, sessionProbeExit } from './fovea-session-probe.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONTROL_PROFILE = 'fovea-native-controls';
export const CONTROL_SOURCE = 'export function ControlSentinel(value: number): number { return value + 1; }\n';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const clean = r => r?.exitCode === 0 && !r.error && !r.stopReason && r.cleanup === 'leader-closed';
const equal = (a, b) => a !== undefined && b !== undefined && isDeepStrictEqual(a, b);

export function controlsProgram(marker, phase, resultId = '') {
  if (!/^[a-z0-9-]{1,80}$/u.test(marker) || !['initial', 'resume'].includes(phase) || (phase === 'resume' && !/^fr_[a-f0-9]{48}$/u.test(resultId))) throw Error('Invalid control probe identity');
  const start = `async function attempt(run: () => Promise<JsonValue>): Promise<JsonObject> { try { return {ok:true,value:await run()}; } catch(error) { return {ok:false,error:String(error)}; } }
const before = await repo.status();
const settingsBefore = await repo.settings();
const focus = await repo.focus({query:"ControlSentinel",fresh:true,maxTokens:512});
const seed = {status:focus.status,resultId:focus.resultId,reads:focus.reads};`;
  if (phase === 'resume') return `${start}
const previousResult = await attempt(() => repo.result({resultId:${JSON.stringify(resultId)},maxChars:256}));
return {marker:${JSON.stringify(marker)},phase:"resume",before,settingsBefore,seed,previousResult,after:await repo.status()};`;
  return `${start}
const retainedBefore = await attempt(() => repo.result({resultId:focus.resultId,maxChars:256}));
const config = settingsBefore.config;
const configure = await attempt(() => repo.configure({scope:"session",expectedRevision:String(settingsBefore.revision),config:{...config,sync:{...config.sync,ackClean:true,mode:"hidden"},tools:{...config.tools,defaultBudget:1024}}}));
const settingsConfigured = await repo.settings();
const reset = await attempt(() => repo.reset());
const resetReplay = await attempt(() => repo.result({resultId:focus.resultId,maxChars:256}));
const next = await repo.focus({query:"ControlSentinel",fresh:true,maxTokens:512});
const reloadReplayBefore = await attempt(() => repo.result({resultId:next.resultId,maxChars:256}));
const beforeReload = await repo.status();
const reload = await attempt(() => repo.reload());
const settingsReloaded = await repo.settings();
const reloadReplay = await attempt(() => repo.result({resultId:next.resultId,maxChars:256}));
const finalFocus = await repo.focus({query:"ControlSentinel",fresh:true,maxTokens:512});
return {marker:${JSON.stringify(marker)},phase:"initial",before,settingsBefore,seed,retainedBefore,configure,settingsConfigured,reset,resetReplay,reloadReplayBefore,beforeReload,reload,settingsReloaded,reloadReplay,resumeResultId:finalFocus.resultId,after:await repo.status()};`;
}

export function controlsProfile(bundleRoot, dataRoot, workspace) {
  const profile = generateAgentProfile({ nodePath: path.join(bundleRoot, 'tools/node'), runtimeRoot: path.join(bundleRoot, 'app'), dataRoot,
    skillPath: path.join(bundleRoot, 'resources/skills/fabric-exec/SKILL.md'), steeringPath: path.join(bundleRoot, 'resources/steering/fabric.md'), bundleRoot, rgPath: path.join(bundleRoot, 'tools/rg'), guidanceMode: 'minimal' });
  profile.name = CONTROL_PROFILE;
  profile.description = 'Disposable real-Fabric controls/resume diagnostic; normal approvals required';
  profile.mcpServers.fabric.env.KIRO_FABRIC_LAUNCH_WORKSPACE = workspace;
  return profile;
}

// Shared exact call validator; each transport supplies only its witnessed interval.
function controlPacket({ updates, modes, sessionId, traces, marker, phase, code, expectedProfile = CONTROL_PROFILE }) {
  const calls = updates.filter(u => u?.sessionUpdate === 'tool_call');
  const call = calls.length === 1 && calls[0].title === '@fabric/fabric_exec' ? calls[0] : null;
  const related = call ? updates.filter(u => u?.toolCallId === call.toolCallId) : [];
  const completed = related.filter(u => u.sessionUpdate === 'tool_call_update' && u.status === 'completed');
  // Kiro adds recorder-only _meta to rawInput. All actual argument keys stay exact.
  const exactInput = input => input && equal(Object.fromEntries(Object.entries(input).filter(([k]) => k !== '_meta')), { code, resultFormat: 'json' });
  let packet = null, transition = null;
  try {
    if (completed.length === 1 && completed[0].rawOutput?.isError !== true) {
      const parts = completed[0].rawOutput.response.split('\n\nWorkspace transition: ');
      if (phase === 'detach' && parts.length === 2) { transition = JSON.parse(parts[1]); packet = JSON.parse(parts[0]); }
      else if (parts.length === 1) packet = JSON.parse(parts[0]);
    }
  } catch { /* absent or malformed evidence */ }
  const exactCall = Boolean(typeof sessionId === 'string' && sessionId.length && call && typeof call.toolCallId === 'string' && call.toolCallId.length && exactInput(call.rawInput) &&
    related[0] === call && completed.length === 1 && related.at(-1) === completed[0] &&
    related.every(u => (!u.rawInput || exactInput(u.rawInput)) && (!u.status || ['pending', 'in_progress', 'completed'].includes(u.status))) &&
    packet?.marker === marker && packet?.phase === phase && modes.at(-1) === expectedProfile && traces.filter(t => t.ev === 'tool.fabric_exec').length === 1);
  return { exactCall, packet: exactCall ? packet : null, transition: exactCall ? transition : null, toolCallId: call?.toolCallId ?? null };
}

// Use recorder direction, typed request IDs and a fresh prompt interval. Transcript
// replay, assistant prose and tool-shaped content outside that interval do not count.
export function summarizeControlRun({ frames, traces, result, marker, phase, code, expectedProfile = CONTROL_PROFILE }) {
  const incoming = f => f?.dir === 'in' && f.msg;
  const { prompt, start, end } = promptBounds(frames, marker);
  const sessionId = prompt?.msg.params?.sessionId;
  const interval = start >= 0 && end > start ? frames.slice(start + 1, end) : [];
  const updates = interval.filter(f => incoming(f) && f.msg.method === 'session/update' && f.msg.params?.sessionId === sessionId).map(f => f.msg.params.update);
  const modes = frames.filter(f => incoming(f) && f.msg.method === 'session/update' && f.msg.params?.sessionId === sessionId)
    .flatMap(f => f.msg.params.update?.configOptions ?? []).filter(o => o.id === 'mode').map(o => o.currentValue);
  const evidence = controlPacket({ updates, modes, sessionId, traces, marker, phase, code, expectedProfile });
  const callFrame = f => incoming(f) && f.msg.method === 'session/update' && f.msg.params?.sessionId === sessionId && f.msg.params?.update?.toolCallId === evidence.toolCallId;
  const callStart = interval.findIndex(f => callFrame(f) && f.msg.params.update.sessionUpdate === 'tool_call');
  const callEnd = interval.findIndex(f => callFrame(f) && f.msg.params.update.sessionUpdate === 'tool_call_update' && f.msg.params.update.status === 'completed');
  const forms = interval.filter((f, i) => i > callStart && i < callEnd && incoming(f) && f.msg.method === '_kiro/mcp/elicitation' && f.msg.id !== undefined);
  const formPairs = forms.flatMap(f => {
    if (f.msg.params?.sessionId !== sessionId || f.msg.params?.toolCallId !== evidence.toolCallId || forms.filter(other => other.msg.id === f.msg.id).length !== 1) return [];
    const responses = interval.filter(r => r?.dir === 'out' && !r.msg?.method && r.msg?.id === f.msg.id);
    if (responses.length !== 1 || interval.indexOf(responses[0]) <= interval.indexOf(f) || interval.indexOf(responses[0]) >= callEnd) return [];
    const response = responses[0];
    const message = f.msg.params?.elicitation?.message;
    const operation = typeof message === 'string' ? /^Risk: write\nAction: (repo\.(?:configure|reset|reload|adoptRules))\n/u.exec(message)?.[1] ?? null : null;
    let reviewedArguments = null;
    try {
      const parsed = operation ? JSON.parse(message.slice(message.indexOf('\n', message.indexOf('\n') + 1) + 1)) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) reviewedArguments = parsed;
    } catch { /* Truncated or redacted review is not exact argument evidence. */ }
    return [{ id: f.msg.id, operation, reviewedArguments, action: response.msg.error ? null : response.msg.result?.action ?? null,
      approved: !response.msg.error && typeof response.msg.result?.content?.approved === 'boolean' ? response.msg.result.content.approved : null,
      missingHandler: [response.msg.error?.message, response.msg.error?.data?.details].includes('No handler registered for method: _kiro/mcp/elicitation') }];
  });
  return { phase, marker, sessionId: sessionId ?? null, ...evidence, evidenceSource: 'native-acp-recorder',
    completed: clean(result) && evidence.exactCall, formPairs,
    hostBlocked: evidence.exactCall && formPairs.some(f => f.missingHandler),
    process: { exitCode: result.exitCode, error: result.error, stopReason: result.stopReason, cleanup: result.cleanup } };
}

// Headless Kiro emits native stream events but does not write the ACP recorder.
// Do not invent protocol requests/acks: retain this as a distinct evidence source.
export function summarizeControlStream({ result, traces, marker, phase, code }) {
  let events = [];
  try { events = result.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch { /* malformed stream is unqualified */ }
  const starts = events.filter(e => e?.type === 'runStarted'), ends = events.filter(e => e?.type === 'runFinished');
  const sessionIds = [...new Set(events.map(e => e?.data?.sessionId).filter(s => typeof s === 'string' && s.length))];
  const sessionId = sessionIds.length === 1 ? sessionIds[0] : null;
  const bounded = starts.length === 1 && ends.length === 1 && starts[0].data?.engine === 'v3' && starts[0].data?.payloadSchema === 'acp' &&
    events.indexOf(starts[0]) === 0 && events.indexOf(ends[0]) === events.length - 1 && ends[0].data?.sessionId === sessionId && ends[0].data?.status === 'success' && ends[0].data?.stopReason === 'end_turn';
  const updates = bounded ? events.filter(e => e?.type === 'sessionUpdate' && e.data?.sessionId === sessionId).map(e => e.data.update) : [];
  const modes = updates.flatMap(u => u?.configOptions ?? []).filter(o => o.id === 'mode').map(o => o.currentValue);
  const evidence = controlPacket({ updates, modes, sessionId, traces, marker, phase, code });
  return { phase, marker, sessionId, ...evidence, evidenceSource: 'native-headless-stream',
    completed: clean(result) && evidence.exactCall, formPairs: [], hostBlocked: false,
    fabricApprovalReasons: traces.filter(t => t.ev === 'approval.form.response').map(t => t.data?.reason ?? t.data?.action ?? 'unknown'),
    process: { exitCode: result.exitCode, error: result.error, stopReason: result.stopReason, cleanup: result.cleanup } };
}

export function summarizeControls({ runs, bundleUnchanged, fixtureUnchanged }) {
  const initial = runs.find(r => r.phase === 'initial'), resumed = runs.find(r => r.phase === 'resume');
  const p = initial?.completed ? initial.packet : null, q = resumed?.completed ? resumed.packet : null;
  const unavailable = value => value?.ok === false && typeof value.error === 'string' && value.error.includes('Fovea result unavailable:');
  const supported = value => value?.settingSupport?.['sync.ackClean'];
  const expectedConfig = p?.settingsBefore?.config ? { ...p.settingsBefore.config, sync: { ...p.settingsBefore.config.sync, ackClean: true, mode: 'hidden' }, tools: { ...p.settingsBefore.config.tools, defaultBudget: 1024 } } : null;
  const fixtureRead = seed => seed?.status === 'ok' && seed.reads?.some(r => r.path === 'controls.ts' && r.expectedSha256 === digest(CONTROL_SOURCE));
  const checks = {
    sourceMatched: Boolean(fixtureRead(p?.seed)),
    unsupportedSettingVisible: supported(p?.settingsBefore)?.supported === false && supported(p?.settingsBefore)?.effective === false && supported(p?.settingsBefore)?.requested === p?.settingsBefore?.config?.sync?.ackClean,
    configuredAndReread: p?.configure?.ok === true && p?.settingsConfigured?.scope === 'session' && equal(p?.settingsConfigured?.config, expectedConfig) && equal(p?.configure?.value, p?.settingsConfigured) && supported(p?.settingsConfigured)?.requested === true && supported(p?.settingsConfigured)?.effective === false,
    resetInvalidatedResult: p?.retainedBefore?.ok === true && p?.reset?.ok === true && p?.reset?.value?.reset === 'conversation-root' && unavailable(p?.resetReplay),
    reloadClearedSession: p?.configure?.ok === true && p?.reload?.ok === true && p?.reload?.value?.restarted === true && equal(p?.settingsBefore, p?.settingsReloaded),
    reloadInvalidatedResult: p?.reload?.ok === true && p?.reloadReplayBefore?.ok === true && unavailable(p?.reloadReplay),
    reloadRestartedEngine: Number.isSafeInteger(p?.beforeReload?.engineStarts) && p?.after?.engineStarts === p.beforeReload.engineStarts + 1 && p?.after?.engineGeneration === p.beforeReload.engineGeneration + 1 && p?.after?.hostInstanceId === p?.before?.hostInstanceId,
    automaticStillDisabled: p?.before?.capabilities?.automatic === false && p?.after?.capabilities?.automatic === false,
  };
  const resumedNewTurn = Boolean(p && q && initial.marker !== resumed.marker && initial.toolCallId !== resumed.toolCallId && initial.sessionId === resumed.sessionId && fixtureRead(q.seed));
  const intact = bundleUnchanged === true && fixtureUnchanged === true;
  return { schemaVersion: 1, kind: 'kiro-fabric.native-controls-probe', qualified: false, automatic: false,
    checks, bundleUnchanged, fixtureUnchanged, controlsObserved: intact && Object.values(checks).every(Boolean),
    diagnosticCompleted: intact && Boolean(initial?.completed && resumed?.completed && resumedNewTurn),
    approval: initial?.hostBlocked ? 'host-blocked' : 'unqualified',
    runEvidence: runs.map(r => ({ phase: r.phase, source: r.evidenceSource ?? 'unknown', exactCall: r.exactCall === true, completed: r.completed, process: r.process ?? null, fabricApprovalReasons: r.fabricApprovalReasons ?? [] })),
    resumedNewTurn, resumeObservation: resumedNewTurn ? { sameHostInstance: p.after.hostInstanceId === q.before.hostInstanceId,
      previousResultAvailable: q.previousResult?.ok === true, settings: q.settingsBefore,
      nativeSessionAssociation: 'unqualified; native chat identity is not MCP state ownership' } : null,
    remaining: ['human accept/decline and revocation qualification', 'clear/compact/profile-swap isolation', 'native presentation modes and rule adoption', 'retained generation across update', 'native session routing and intended-turn delivery'] };
}

function loadLines(file) {
  if (!fs.existsSync(file)) return [];
  if (fs.statSync(file).size > 8 * 1024 * 1024) throw Error('Private recorder size limit exceeded');
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

export function controlsArgs(argv) {
  if (argv[0] !== '--authenticated' || argv[1] !== '--bundle' || !argv[2] || argv[2].startsWith('--')) throw Error('Explicit --authenticated --bundle TRUSTED_CURRENT_BUNDLE required');
  let interactive = false, decision, scenario = 'controls';
  const seen = new Set();
  for (let i = 3; i < argv.length; i++) {
    const arg = argv[i];
    if (seen.has(arg)) throw Error('Duplicate diagnostic option'); seen.add(arg);
    if (arg === '--interactive') interactive = true;
    else if (arg === '--decision' && ['accept', 'decline'].includes(argv[i + 1])) decision = argv[++i];
    else if (arg === '--case' && ['controls', 'rules', 'modes', 'lifecycle'].includes(argv[i + 1])) scenario = argv[++i];
    else throw Error('Unsupported diagnostic option');
  }
  if (decision && (!interactive || scenario === 'lifecycle')) throw Error('--decision requires an interactive controls, rules or modes case');
  if (interactive && scenario === 'lifecycle') throw Error('Lifecycle uses a non-approving native TUI driver, not human approval');
  return { interactive, decision, scenario };
}

export async function main(argv = process.argv.slice(2), onReport = (_report, _root) => {}) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log('Usage: node scripts/fovea-controls-probe.mjs --authenticated --bundle TRUSTED_CURRENT_BUNDLE [--interactive] [--decision accept|decline] [--case controls|rules|modes|lifecycle]\nControls run configure/reset/reload then resume. Rules/modes are separate cases; lifecycle drives native compact/swap/clear/detach without approving anything. Normal ask policy; never approves. --interactive requires human terminal review and /quit after each turn. Uses live authentication, private evidence/data/workspace; no installation or live profile edits. Exit 0 means diagnostic complete (and requested decisions observed), not qualification; exit 3 reports observed cross-chat focus retention.'); return 0;
  }
  const { interactive, decision, scenario } = controlsArgs(argv);
  if (interactive && (!process.stdin.isTTY || !process.stdout.isTTY)) throw Error('--interactive requires a human terminal');
  const bundleRoot = fs.realpathSync(argv[2]), bundle = await validateBundle(bundleRoot);
  if (bundle.manifest.schema !== 2 || bundle.manifest.target !== `${process.platform}-${process.arch}`) throw Error('Matching native schema-2 bundle required');
  const closure = verifyBuildClosure(REPO, path.join(bundleRoot, 'app'));
  // Outside the checkout: ignored .tmp descendants can be absent from Git discovery.
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'fovea-native-controls-')); fs.chmodSync(root, 0o700);
  const workspace = path.join(root, 'workspace'), dataRoot = path.join(root, 'data');
  for (const dir of [workspace, dataRoot, path.join(dataRoot, 'fabric'), path.join(dataRoot, 'fabric/config')]) fs.mkdirSync(dir, { mode: 0o700 });
  const agents = path.join(workspace, '.kiro/agents'); fs.mkdirSync(agents, { recursive: true, mode: 0o700 });
  const write = (name, value) => fs.writeFileSync(path.join(root, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  const profile = controlsProfile(bundleRoot, dataRoot, workspace), registration = path.join(agents, CONTROL_PROFILE + '.json');
  write('profile.json', profile); write('workspace/.kiro/agents/' + CONTROL_PROFILE + '.json', profile);
  write('workspace/controls.ts', CONTROL_SOURCE);
  const fixtureBytes = { 'controls.ts': CONTROL_SOURCE, ...(scenario === 'rules' ? RULE_FIXTURES : {}) };
  for (const [name, content] of Object.entries(fixtureBytes)) {
    if (name === 'controls.ts') continue;
    fs.mkdirSync(path.dirname(path.join(workspace, name)), { recursive: true, mode: 0o700 });
    write('workspace/' + name, content);
  }
  const fixtureIntact = () => Object.entries(fixtureBytes).every(([name, content]) => fs.readFileSync(path.join(workspace, name), 'utf8') === content);
  write('data/fabric/config/config.json', { approvals: { read: 'allow', write: 'ask', execute: 'ask', network: 'ask' }, tracing: { enabled: true } });
  write('build-identity.json', { bundleDigest: bundle.digest, closureDigest: closure.contentDigest, buildInputs: closure.buildInputs });
  const traceDir = path.join(dataRoot, 'fabric/traces');
  const traces = () => fs.existsSync(traceDir) ? fs.readdirSync(traceDir).filter(f => f.endsWith('.jsonl')).sort().flatMap(f => loadLines(path.join(traceDir, f))) : [];
  const runs = [], processes = [];
  console.log(`Private evidence: ${root}`);
  try {
    if (scenario === 'lifecycle') {
      const outcome = await runSessionProbe({ root, workspace, profile, write, traces, loadLines, summarizeControlRun });
      processes.push(outcome.result);
      const bundleUnchanged = bundle.digest === (await validateBundle(bundleRoot)).digest, fixtureUnchanged = fixtureIntact();
      const report = { ...outcome.report, bundleUnchanged, fixtureUnchanged, diagnosticCompleted: outcome.report.diagnosticCompleted && bundleUnchanged && fixtureUnchanged };
      write('report.json', report); onReport(report, root); console.log(JSON.stringify({ evidence: root, ...report }, null, 2));
      return sessionProbeExit(report);
    }
    for (const phase of scenario === 'controls' ? ['initial', 'resume'] : [scenario]) {
      const prior = runs[0];
      if (phase === 'resume' && (!prior?.completed || !/^fr_[a-f0-9]{48}$/u.test(prior.packet?.resumeResultId))) break;
      const marker = phase + '-' + randomUUID(), code = scenario === 'controls' ? controlsProgram(marker, phase, prior?.packet?.resumeResultId) : extraControlProgram(marker, phase);
      const prompt = 'Call only @fabric/fabric_exec exactly once with code ' + JSON.stringify(code) + ' and resultFormat json. These are disposable Fovea controls, with normal approval required. Do not retry, change policy, use native tools, delegate or use shell fallback. After the exact result, stop.';
      write(phase + '-input.json', { code, resultFormat: 'json' }); write(phase + '-prompt.txt', prompt);
      const record = path.join(root, phase + '-acp.jsonl'), beforeTraces = new Set(traces().map(t => JSON.stringify(t)));
      const env = { ...process.env, KIRO_ACP_RECORD_PATH: record, KIRO_FABRIC_LAUNCH_WORKSPACE: workspace };
      const args = ['chat', '--v3', '--agent', CONTROL_PROFILE, '--require-mcp-startup', ...(phase === 'resume' ? ['--resume-id', prior.sessionId] : []), ...(!interactive ? ['--output-format', 'stream-json'] : []), prompt];
      let result;
      if (interactive) {
        console.log(`${phase}: ${decision ? `Please ${decision} each requested ${scenario} action for this case (including the deliberately stale rule hash).` : 'Review each requested control individually.'} /quit when the turn finishes. Nothing is auto-approved.`);
        result = await new Promise(resolve => {
          const child = spawn('kiro-cli', args, { cwd: workspace, env, stdio: 'inherit' });
          child.once('error', e => resolve({ exitCode: null, error: String(e), stopReason: null, cleanup: 'not-spawned' }));
          child.once('close', exitCode => resolve({ exitCode, error: null, stopReason: null, cleanup: 'leader-closed' }));
        });
      } else result = await runBounded('kiro-cli', args, { cwd: workspace, env, timeoutMs: 180000, maxBytes: 2097152 });
      processes.push(result); write(phase + '-output.json', result);
      const freshTraces = traces().filter(t => !beforeTraces.has(JSON.stringify(t)));
      const input = { traces: freshTraces, result, marker, phase, code };
      const run = interactive ? summarizeControlRun({ ...input, frames: loadLines(record) }) : summarizeControlStream(input);
      runs.push(run); write(phase + '-evidence.json', run);
    }
    const after = await validateBundle(bundleRoot);
    const bundleUnchanged = bundle.digest === after.digest, fixtureUnchanged = fixtureIntact();
    const report = scenario === 'controls' ? { ...summarizeControls({ runs, bundleUnchanged, fixtureUnchanged }),
      approvalObservations: controlDecisionEvidence(runs[0], interactive ? 'human-terminal' : 'headless', decision) }
      : { ...summarizeExtraControl(runs[0], bundleUnchanged && fixtureUnchanged), bundleUnchanged, fixtureUnchanged,
        approvalObservations: extraDecisionEvidence(runs[0], interactive ? 'human-terminal' : 'headless', decision) };
    const recorded = { ...report, bundleDigest: bundle.digest, nativeRun: { marker: runs[0]?.marker ?? null, sessionId: runs[0]?.sessionId ?? null, toolCallId: runs[0]?.toolCallId ?? null } };
    write('report.json', recorded); onReport(recorded, root); console.log(JSON.stringify({ evidence: root, ...recorded }, null, 2));
    return report.diagnosticCompleted && (!decision || report.approvalObservations.requestedDecisionObserved) ? 0 : 2;
  } finally {
    if (processes.length && processes.every(r => r.cleanup === 'leader-closed' && !r.error && !r.stopReason)) fs.unlinkSync(registration);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 2; });
