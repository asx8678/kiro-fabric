#!/usr/bin/env node
// Native Kiro + real built Fabric. Opt-in, private fixtures, never an auto-approver.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateAgentProfile } from './agent-profile.mjs';
import { runBounded } from './fovea-capability-probe.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'fovea-native-approval-probe';
const BEFORE = 'before-native-approval\n';
const AFTER = 'after-native-approval\n';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const parseLines = text => text.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
const formId = id => `${typeof id}:${String(id)}`;

export function approvalProbeProfile({ runtimeRoot, nodePath, dataRoot, workspace }) {
  const profile = generateAgentProfile({ runtimeRoot, nodePath, dataRoot, skillPath: path.join(runtimeRoot, 'unused-skill.md'), guidanceMode: 'minimal' });
  profile.name = NAME;
  profile.description = 'Owned native approval diagnostic using actual built Fabric, not a protocol fixture';
  profile.mcpServers.fabric.env.KIRO_FABRIC_LAUNCH_WORKSPACE = workspace;
  return profile;
}

export function summarizeApprovalProbe({ frames, traces, result, before, after, interaction = 'diagnostic' }) {
  const pending = new Map();
  const forms = [];
  const calls = [];
  const modes = [];
  for (const frame of frames) {
    // 2.22.1's native recorder uses {ts,dir,msg}; older qualification adapters
    // used {direction,message}. Never infer direction from a tool's payload.
    const native = frame?.dir === 'in' || frame?.dir === 'out';
    const message = native ? frame.msg : frame?.message;
    const direction = native ? frame.dir === 'in' ? 'server-to-client' : 'client-to-server' : frame?.direction;
    if (!message || typeof message !== 'object') continue;
    for (const option of message.result?.configOptions ?? []) if (option.id === 'mode') modes.push(option.currentValue);
    if (direction === 'server-to-client' && message.method === '_kiro/mcp/elicitation' && message.id !== undefined) {
      pending.set(formId(message.id), message);
    }
    if (direction === 'client-to-server' && !message.method && pending.has(formId(message.id))) {
      const request = pending.get(formId(message.id));
      forms.push({ id: message.id, method: request.method,
        missingHandler: [message.error?.message, message.error?.data?.details].includes('No handler registered for method: _kiro/mcp/elicitation'),
        action: ['accept', 'decline', 'cancel'].includes(message.result?.action) ? message.result.action : null,
        approved: message.result?.content?.approved === true });
      pending.delete(formId(message.id));
    }
    if (direction === 'server-to-client' && message.method === 'session/update') {
      const update = message.params?.update;
      if (update?.sessionUpdate === 'tool_call' && typeof update.title === 'string') calls.push(update.title);
      for (const option of update?.configOptions ?? []) if (option.id === 'mode') modes.push(option.currentValue);
    }
  }
  const traceRequests = traces.filter(row => row.ev === 'approval.form.request');
  const traceResponses = traces.filter(row => row.ev === 'approval.form.response');
  const pairedTrace = traceResponses.filter(row => traceRequests.some(request => request.data?.elicitationId === row.data?.elicitationId && typeof row.data?.elicitationId === 'string'));
  // Native Kiro can wrap the exact handler failure in error.data.details while
  // mapping it to MCP action:cancel. The matched native response is the evidence;
  // an uncorrelated cancellation or Fabric-only diagnostic is not.
  const missingHandler = forms.length === 1 && forms[0].missingHandler && traceRequests.length === 1 && pairedTrace.length === 1;
  const nativeCalls = [...new Set(calls)];
  const fabricCalled = nativeCalls.includes('@fabric/fabric_exec') && traces.some(row => row.ev === 'tool.fabric_exec');
  const processClosed = result.exitCode === 0 && !result.error && !result.stopReason && result.cleanup === 'leader-closed';
  const unchanged = before === after;
  const selectedModeObserved = modes.at(-1) === NAME;
  return { schemaVersion: 1, kind: 'kiro-fabric.native-approval-probe', qualified: false, automatic: false,
    interaction, actualFabricExecution: fabricCalled, selectedModeObserved,
    nativeProcess: { exitCode: result.exitCode, error: result.error, stopReason: result.stopReason, cleanup: result.cleanup },
    approval: { status: missingHandler && fabricCalled ? 'host-blocked' : 'unqualified',
      reason: missingHandler && fabricCalled ? 'native-form-handler-missing' : 'native-approval-not-qualified',
      nativeFormPairs: forms, traceRequestCount: traceRequests.length, traceResponseCount: pairedTrace.length,
      acceptedObserved: forms.some(form => form.action === 'accept' && form.approved),
      declinedObserved: forms.some(form => form.action === 'decline'),
      revokedObserved: false, humanApprovalQualified: false },
    fixture: { beforeSha256: digest(before), afterSha256: digest(after), unchanged, expectedEditObserved: before === BEFORE && after === AFTER },
    inventory: { source: 'native-acp-observed-tool-calls', complete: false, tools: nativeCalls,
      extraClientToolObserved: nativeCalls.some(name => name !== '@fabric/fabric_exec'),
      reason: 'Observed calls and /tools picker are not an authoritative complete model-input inventory' },
    diagnosticCompleted: processClosed && selectedModeObserved && fabricCalled && traceRequests.length > 0 && pairedTrace.length > 0 && (missingHandler ? unchanged : true),
    remaining: ['human accepted and declined exact edit/shell effects', 'native workspace revocation', 'authoritative complete model-visible inventory'] };
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log('Usage: node scripts/fovea-approval-probe.mjs --authenticated [--interactive]\nRuns real built Fabric with private fixture/data and explicit write/execute/network ask. Default only diagnoses forms; never sends approval. --interactive requires your terminal and human review. Captures private native ACP evidence; no live profile/config edits or installation.');
    return 0;
  }
  if (!argv.includes('--authenticated') || argv.some(arg => !['--authenticated', '--interactive'].includes(arg)) || new Set(argv).size !== argv.length) throw new Error('explicit --authenticated required; unsupported argument');
  const interactive = argv.includes('--interactive');
  if (interactive && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('--interactive requires a human terminal');
  const runtimeRoot = path.join(REPO, 'dist/kiro-agent-closure');
  const entry = path.join(runtimeRoot, 'kiro/mcp-entry.js');
  if (!fs.existsSync(entry)) throw new Error('fresh pnpm run build required');
  const base = path.join(REPO, '.tmp'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'fovea-approval-')); fs.chmodSync(root, 0o700);
  const workspace = path.join(root, 'workspace'), dataRoot = path.join(root, 'data');
  for (const dir of [workspace, dataRoot, path.join(dataRoot, 'fabric'), path.join(dataRoot, 'fabric/config')]) fs.mkdirSync(dir, { mode: 0o700 });
  const agentDir = path.join(workspace, '.kiro/agents'); fs.mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const profile = approvalProbeProfile({ runtimeRoot, nodePath: process.execPath, dataRoot, workspace });
  const write = (file, value) => fs.writeFileSync(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  write('data/fabric/config/config.json', { approvals: { read: 'allow', write: 'ask', execute: 'ask', network: 'ask' }, tracing: { enabled: true } });
  write(`workspace/.kiro/agents/${NAME}.json`, profile); write('profile-snapshot.json', profile);
  write('workspace/fixture.txt', BEFORE);
  const manifest = fs.readFileSync(path.join(runtimeRoot, 'closure-manifest.json'));
  write('build-identity.json', { closureManifestSha256: digest(manifest), buildInputs: JSON.parse(manifest.toString('utf8')).buildInputs });
  const code = 'const before = await local.read({path:"fixture.txt"}); return await local.edit({path:"fixture.txt",expectedSha256:before.sha256,edits:[{oldText:"before-native-approval\\n",newText:"after-native-approval\\n"}]});';
  const prompt = 'Native approval qualification in this disposable workspace. Call only @fabric/fabric_exec exactly once with code ' + JSON.stringify(code) + ' and resultFormat json. Do not retry on error, do not use native tools or a shell fallback, do not change permissions. Then report the actual result and stop. This requests an approval form, not blanket permission.';
  write('prompt.txt', prompt);
  const record = path.join(root, 'native-acp.jsonl');
  const env = { ...process.env, KIRO_ACP_RECORD_PATH: record, KIRO_FABRIC_LAUNCH_WORKSPACE: workspace, TERM: 'xterm-256color' };
  let result;
  try {
    if (interactive) {
      console.log(`Evidence: ${root}\nReview the exact fixture edit if the native form appears. After the result, /tools may be inspected; /quit closes the probe. No response is automated.`);
      result = await new Promise(resolve => {
        const child = spawn('kiro-cli', ['chat', '--v3', '--agent', NAME, '--require-mcp-startup', prompt], { cwd: workspace, env, stdio: 'inherit' });
        child.once('error', error => resolve({ exitCode: null, error: 'code' in error && typeof error.code === 'string' ? error.code : 'spawn-error', stopReason: null, cleanup: 'not-spawned' }));
        child.once('close', code => resolve({ exitCode: code, error: null, stopReason: null, cleanup: 'leader-closed' }));
      });
    } else {
      write('driver.exp', `set timeout 45
set env(TERM) xterm-256color
spawn -noecho kiro-cli chat --v3 --agent ${NAME} --require-mcp-startup
stty rows 40 columns 120 < $spawn_out(slave,name)
expect {
  -re {\\x1b\\[6n} {send "\\033\\[1;1R"; exp_continue}
  -re {ask a question or describe a task} {send -- "[lindex $argv 0]\\r"}
  timeout {puts "APPROVAL_START_TIMEOUT"; exit 2}
  eof {exit 2}
}
set observed 0
for {set i 0} {$i < 90} {incr i} {
  expect -timeout 1 {
    -re {\\x1b\\[6n} {send "\\033\\[1;1R"}
    eof {break}
    timeout {}
  }
  foreach file [glob -nocomplain [lindex $argv 1]/*.jsonl] {
    set handle [open $file r]; set text [read $handle]; close $handle
    if {[string first {approval.form.response} $text] >= 0} {set observed 1}
  }
  if {$observed} {break}
}
if {!$observed} {puts "APPROVAL_RESPONSE_NOT_OBSERVED"; send "\\033"; after 1000}
# Do not enter a modal /tools picker while an async turn is still settling.
# It is only a subset anyway, never a complete model inventory.
set timeout 8
expect {
  -re {\\x1b\\[6n} {send "\\033\\[1;1R"; exp_continue}
  timeout {}
  eof {set status [wait]; exit [lindex $status 3]}
}
send "\\025/quit\\r"
set timeout 8
expect {
  eof {}
  timeout {puts "APPROVAL_EXIT_TIMEOUT"; send "\\003"; after 1000; send "\\003"; exit 2}
}
set status [wait]
exit [lindex $status 3]
`);
      result = await runBounded('expect', [path.join(root, 'driver.exp'), prompt, path.join(dataRoot, 'fabric/traces')], { cwd: workspace, env, timeoutMs: 180000, maxBytes: 2097152 });
      write('native-output.json', result);
    }
    const frames = fs.existsSync(record) ? parseLines(fs.readFileSync(record, 'utf8')) : [];
    const traceDir = path.join(dataRoot, 'fabric/traces');
    const traces = fs.existsSync(traceDir) ? fs.readdirSync(traceDir).filter(name => name.endsWith('.jsonl')).flatMap(name => parseLines(fs.readFileSync(path.join(traceDir, name), 'utf8'))) : [];
    const report = summarizeApprovalProbe({ frames, traces, result, before: BEFORE, after: fs.readFileSync(path.join(workspace, 'fixture.txt'), 'utf8'), interaction: interactive ? 'human-terminal' : 'diagnostic' });
    write('report.json', report);
    console.log(JSON.stringify({ evidence: root, ...report }, null, 2));
    return report.diagnosticCompleted ? 0 : 2;
  } finally {
    if (result?.cleanup === 'leader-closed' && !result.error && !result.stopReason) fs.rmSync(path.join(workspace, '.kiro'), { recursive: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 2; });
