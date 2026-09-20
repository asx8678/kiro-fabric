// Bundled only by scripts/fovea-lifecycle-harness.mjs. Aliases resolve to exact
// Git archives, never the working upstream checkout. This is a fixture runner,
// NOT Pi's ExtensionRunner/TUI and NOT native Kiro transport evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import extension from 'fovea-reference/extension';
import { getSession } from 'fovea-reference/session';
import { getState } from 'fovea-reference/state';
import { sync, syncBaselineStore } from 'fovea-reference/sync';
import { captureMutation, finishMutation, provenancePathFor } from 'fovea-reference/provenance';
import { CapturedToolCatalog } from 'pi-fabric-reference/catalog';
import { CapturedToolsProvider } from 'pi-fabric-reference/provider';

const root = fs.realpathSync(process.argv[2]);
let clock = 1700000000000;
Date.now = () => clock; // deterministic ordering, including cross-owner transition chains
const events = [], checkpoints = [], assertions = [], tools = new Map(), commands = new Map(), handlers = new Map();
let branch = [], blocked = false, readCalls = 0, mutationCalls = 0;
let cancelMutation; // fixture-only pre-publication cancellation barrier
const messages = [];
const clone = value => JSON.parse(JSON.stringify(value));
const check = (id, predicate) => { assert.ok(predicate, id); assertions.push(id); };
const ctx = {
  cwd: root, hasUI: false, isIdle: () => true, isProjectTrusted: () => false,
  sessionManager: { getSessionId: () => 'fixture-conversation', getBranch: () => branch },
  ui: { notify: () => {} }, reload: async () => { throw Error('code reload not exercised'); },
};
const record = event => {
  if (events.length >= 512) throw Error('trace bound exceeded');
  events.push({ type: event.type, ...(event.toolCallId ? { id: event.toolCallId } : {}),
    ...(event.toolName ? { tool: event.toolName } : {}), ...(typeof event.isError === 'boolean' ? { isError: event.isError } : {}) });
};
async function emit(event) {
  record(event);
  const results = [];
  for (const fn of handlers.get(event.type) ?? []) { const result = await fn(event, ctx); if (result !== undefined) results.push(result); }
  return results;
}
const runner = {
  createContext: () => ctx, getActiveTools: () => [...tools.keys()],
  emit,
  emitToolCall: async event => { await emit(event); return blocked ? { block: true, reason: 'fixture-denied' } : undefined; },
  emitToolResult: async event => {
    const patches = await emit(event);
    // The fixture patch proves the REAL provider uses middleware results.
    if (event.toolName === 'fixture_patch') return { content: [{ type: 'text', text: 'patched' }], details: { patched: true } };
    return patches.at(-1);
  },
};
extension({
  on: (name, fn) => handlers.set(name, [...handlers.get(name) ?? [], fn]),
  registerTool: definition => tools.set(definition.name, definition),
  registerCommand: (name, command) => commands.set(name, command),
  appendEntry: (customType, data) => branch.push({ type: 'custom', customType, data: clone(data) }),
  sendMessage: (message, options) => messages.push({ message, options }),
});
const registered = [...tools.keys()].sort();
// Harmless captured file-access fixture. It is not Pi's built-in read provider.
// All graph tools/listeners below ARE the original Fovea implementations.
tools.set('read', { name: 'read', description: 'fixture reader', parameters: {}, execute: async (_id, args, _signal, onUpdate) => {
  readCalls++;
  assert.ok(['math.ts', 'missing.ts', 'routes.ts'].includes(args.path));
  const text = fs.readFileSync(path.join(root, args.path), 'utf8');
  onUpdate({ content: [{ type: 'text', text: 'fixture-read-complete' }] });
  return { content: [{ type: 'text', text }], details: { sha256: createHash('sha256').update(text).digest('hex') } };
} });
tools.set('fixture_patch', { name: 'fixture_patch', description: 'fixture middleware check', parameters: {}, execute: async () => ({ content: [{ type: 'text', text: 'original' }] }) });
// File mutations are fixture tools, not Pi builtin implementations. Original
// capture wrapper/provider and Fovea listeners observe their actual publication.
for (const name of ['write', 'edit']) tools.set(name, {
  name, description: 'fixture mutation', parameters: {},
  execute: async (_id, args, signal) => {
    assert.equal(args.path, 'routes.ts');
    const file = path.join(root, args.path);
    const before = fs.readFileSync(file, 'utf8');
    if (args.failBefore) throw Error('fixture-before-publication');
    // Yield to let the caller install its abort listeners before simulating
    // external cancellation. Synchronous self-abort has a pinned unhandled-
    // rejection edge; it is not silently treated as successful cancellation.
    if (cancelMutation) { await Promise.resolve(); cancelMutation(); cancelMutation = undefined; }
    signal.throwIfAborted();
    const after = name === 'write' ? args.content : before.replace(args.oldText, args.newText);
    assert.equal(typeof after, 'string');
    assert.notEqual(before, after);
    fs.writeFileSync(file, after);
    mutationCalls++;
    if (args.failAfter) throw Error('fixture-after-publication');
    return { content: [{ type: 'text', text: 'fixture-committed' }], details: { changed: true } };
  },
});
const catalog = new CapturedToolCatalog();
catalog.replace([...tools.values()].map(definition => ({ definition, sourceInfo: { path: '/fixture/pi-fovea/src/index.ts', source: 'fixture' } })), runner, { enabled: true, defaultRisk: 'read', risks: {} }, '/fixture/pi-fabric/src/index.ts');
const provider = new CapturedToolsProvider(catalog);
const invoke = (id, tool, args = {}, signal = new AbortController().signal) => provider.invoke(tool, args, { cwd: root, signal, nestedToolCallId: id, update: () => {} });
const rootCount = () => branch.filter(e => e.customType === 'pi-fovea-workspace').at(-1)?.data.roots.length ?? 0;
function snapshot(label) {
  const state = getState(root);
  // Avoid creating a session during idle checkpoints (getSession is allocating).
  const session = state ? getSession(root) : undefined;
  const data = { label, cachedGraph: !!state, graphGeneration: state?.generation ?? null,
    baseline: syncBaselineStore().has(root), rootsRecorded: rootCount(),
    focus: session ? { t: session.t, seeds: [...session.seeds], key: session.focusKey, disclosed: [...session.disclosed].sort(), scopes: [...session.syncScopes].sort() } : null,
    sentMessages: messages.length };
  checkpoints.push(data); return data;
}

try {
  await emit({ type: 'session_start', reason: 'new' });
  await emit({ type: 'before_agent_start', prompt: 'fixture-idle' });
  await emit({ type: 'turn_end' });
  const idle = snapshot('idle');
  check('idle-no-index-or-baseline', !idle.cachedGraph && !idle.baseline && idle.rootsRecorded === 0 && messages.length === 0);
  blocked = true;
  await assert.rejects(invoke('denied', 'read', { path: 'math.ts' }), /fixture-denied/);
  blocked = false;
  const denied = snapshot('denied');
  check('denied-no-execute-or-enrollment', readCalls === 0 && !denied.cachedGraph && !denied.baseline && denied.rootsRecorded === 0);
  await assert.rejects(invoke('failed', 'read', { path: 'missing.ts' }));
  const failed = snapshot('failed');
  check('failed-no-enrollment', !failed.cachedGraph && !failed.baseline && failed.rootsRecorded === 0);
  const start = events.length;
  await assert.rejects(invoke('cancelled', 'read', { path: 'math.ts' }, AbortSignal.abort(new Error('fixture-cancelled'))), /fixture-cancelled/);
  check('cancel-before-dispatch-no-events', events.length === start);
  const access = await invoke('access', 'read', { path: 'math.ts' });
  const entered = snapshot('access');
  check('successful-read-enrolls-and-baselines', entered.cachedGraph && entered.baseline && entered.rootsRecorded === 1);
  check('read-result-preserved', access.text === fs.readFileSync(path.join(root, 'math.ts'), 'utf8') && access.isError === false);
  const patched = await invoke('patch', 'fixture_patch');
  check('captured-result-middleware-applied', patched.text === 'patched' && patched.details.patched === true && patched.content.length === 1);
  const focused = await invoke('focus', 'fovea_focus', { query: 'calculateTotal', fresh: true, maxTokens: 512 });
  const focus = snapshot('focus');
  check('captured-focus-details-and-text-preserved', focused.details.seeds > 0 && focused.text === focused.content.map(c => c.text).join('\n') && focus.focus.seeds.length > 0);
  await emit({ type: 'turn_end' });
  await emit({ type: 'before_agent_start', prompt: 'fixture-next-turn' });
  const ordinary = snapshot('ordinary-turn');
  assert.deepEqual(ordinary.focus, focus.focus);
  check('ordinary-turn-retains-focus-and-silent', messages.length === 0 && ordinary.graphGeneration === focus.graphGeneration);
  await invoke('dwell', 'fovea_dwell', { maxTokens: 512 });
  const dwell = snapshot('dwell');
  check('dwell-reuses-graph-and-widens', dwell.focus.t > focus.focus.t && dwell.graphGeneration === focus.graphGeneration);
  const beforeCompact = branch.length;
  await emit({ type: 'session_compact' });
  const compact = snapshot('compact');
  assert.deepEqual(compact.focus, dwell.focus);
  check('compact-persists-roots-without-resetting-focus', branch.length === beforeCompact + 1 && compact.baseline && compact.graphGeneration === dwell.graphGeneration);
  const saved = clone(branch);
  await emit({ type: 'session_start', reason: 'resume' });
  const resumed = snapshot('resume');
  check('resume-retains-graph-but-resets-focus-baseline', resumed.cachedGraph && resumed.focus.seeds.length === 0 && !resumed.baseline && resumed.rootsRecorded === 1);
  await emit({ type: 'before_agent_start', prompt: 'fixture-resumed' });
  check('resume-rebaselines-silently', snapshot('resume-baseline').baseline && messages.length === 0);
  await invoke('refocus', 'fovea_focus', { query: 'calculateTotal', maxTokens: 512 });
  branch = [];
  await emit({ type: 'session_tree' });
  await emit({ type: 'before_agent_start', prompt: 'fixture-empty-branch' });
  const emptyBranch = snapshot('empty-branch');
  check('tree-empty-branch-does-not-enroll-cwd', emptyBranch.cachedGraph && !emptyBranch.baseline && emptyBranch.focus.seeds.length === 0 && emptyBranch.rootsRecorded === 0);
  branch = saved;
  await emit({ type: 'session_tree' });
  await emit({ type: 'before_agent_start', prompt: 'fixture-restored-branch' });
  const restored = snapshot('restored-branch');
  check('tree-restored-root-starts-new-baseline', restored.baseline && restored.focus.seeds.length === 0 && restored.rootsRecorded === 1);
  await invoke('before-reset', 'fovea_focus', { query: 'calculateTotal', maxTokens: 512 });
  await commands.get('fovea').handler('reset', ctx);
  const reset = snapshot('reset');
  check('reset-clears-roots-focus-baseline-not-graph', reset.cachedGraph && !reset.baseline && reset.rootsRecorded === 0 && reset.focus.seeds.length === 0);
  await emit({ type: 'session_shutdown' });
  const shutdown = snapshot('shutdown');
  check('shutdown-clears-focus-baseline', !shutdown.baseline && shutdown.focus.seeds.length === 0);
  for (const id of ['denied', 'failed', 'access', 'focus', 'dwell']) {
    const types = events.filter(e => e.id === id).map(e => e.type);
    assert.deepEqual(types, ['tool_execution_start', 'tool_call', ...(['access', 'focus', 'dwell'].includes(id) ? ['tool_execution_update'] : []), 'tool_result', 'tool_execution_end']);
  }
  check('nested-lifecycle-order-success-and-failure', true);
  assert.ok(events.filter(e => e.id === 'denied' || e.id === 'failed').filter(e => e.type === 'tool_result' || e.type === 'tool_execution_end').every(e => e.isError === true));
  // A second sequence exercises real pinned sync and transition journals. Each
  // new baseline uses unique content and deterministic advancing clock values;
  // no fixture sleep, synthetic red verdict, or patched reference algorithm.
  const mutationCases = [];
  const route = name => `const app: any = {};\nexport function handler() { return 1; }\napp.get("/${name}", handler);\n`;
  const routeFile = path.join(root, 'routes.ts');
  const sha1 = value => createHash('sha1').update(value).digest('hex');
  const journal = owner => {
    const file = provenancePathFor(root, owner);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).records : [];
  };
  const prepare = async label => {
    await commands.get('fovea').handler('reset', ctx);
    clock += 21000; // pass the pinned non-Git content sweep interval without sleeping
    fs.writeFileSync(routeFile, route(`${label}-before`));
    await invoke(`${label}-access`, 'read', { path: 'routes.ts' });
    check(`${label}-baseline-established`, syncBaselineStore().get(root)?.shas.get('routes.ts') === sha1(route(`${label}-before`)));
    await emit({ type: 'turn_start' });
    return fs.readFileSync(routeFile, 'utf8');
  };
  const foreignWrite = async (id, content) => {
    const captured = await captureMutation(root, 'routes.ts');
    assert.ok(captured);
    clock++;
    fs.writeFileSync(routeFile, content);
    assert.equal(await finishMutation(captured, 'foreign-conversation', id), true);
  };
  const verdict = async (label, kind, options) => {
    clock += 21000; // external/unhinted changes become eligible for the bounded sweep
    const count = messages.length;
    await emit({ type: 'turn_end' });
    assert.equal(messages.length, count + 1, `${label}: one notice requested`);
    const notice = messages.at(-1);
    assert.equal(notice.message.details.provenance.kind, kind, label);
    assert.deepEqual(notice.options, options, label);
    check(`${label}-origin-and-request`, true);
    const row = { label, provenance: notice.message.details.provenance, options: notice.options,
      added: notice.message.details.added, removed: notice.message.details.removed,
      continuationRequested: notice.options.triggerTurn === true, continuationExecuted: false };
    await emit({ type: 'turn_end' });
    check(`${label}-repeat-clean-turn-silent`, messages.length === count + 1);
    mutationCases.push(row);
    return row;
  };

  fs.writeFileSync(routeFile, route('not-enrolled'));
  await emit({ type: 'session_start', reason: 'new' });
  const unownedBefore = fs.readFileSync(routeFile, 'utf8');
  const journalStart = journal('fixture-conversation').length;
  blocked = true;
  await assert.rejects(invoke('denied-write', 'write', { path: 'routes.ts', content: route('denied') }), /fixture-denied/);
  blocked = false;
  await assert.rejects(invoke('failed-write', 'write', { path: 'routes.ts', failBefore: true }), /fixture-before-publication/);
  check('denied-failed-mutations-do-not-enroll', rootCount() === 0 && !syncBaselineStore().has(root) && mutationCalls === 0 && fs.readFileSync(routeFile, 'utf8') === unownedBefore);
  check('denied-failed-mutations-no-journal', journal('fixture-conversation').length === journalStart);

  const before = await prepare('own');
  clock++;
  // The inner call succeeded. A later enclosing program failure is deliberately
  // outside the captured call, matching a failed fabric_exec after a commit.
  await assert.rejects((async () => {
    await invoke('own-write', 'write', { path: 'routes.ts', content: route('own-after') });
    throw Error('fixture-outer-failure');
  })(), /fixture-outer-failure/);
  const ownRecord = journal('fixture-conversation').at(-1);
  check('own-commit-retained-after-outer-failure', ownRecord.beforeSha === sha1(before) && ownRecord.afterSha === sha1(route('own-after')));
  await verdict('own', 'current-session', { deliverAs: 'steer', triggerTurn: true });

  await prepare('foreign');
  await foreignWrite('foreign-write', route('foreign-after'));
  await verdict('foreign', 'other-session', { deliverAs: 'nextTurn' });

  await prepare('mixed');
  clock++;
  await invoke('mixed-edit', 'edit', { path: 'routes.ts', oldText: 'mixed-before', newText: 'mixed-middle' });
  await foreignWrite('mixed-foreign', route('mixed-after'));
  await verdict('mixed', 'mixed', { deliverAs: 'steer', triggerTurn: true });

  await prepare('external');
  clock++;
  fs.writeFileSync(routeFile, route('external-after'));
  await verdict('external', 'unattributed', { deliverAs: 'steer', triggerTurn: true });

  await prepare('queued');
  clock++;
  await invoke('queued-edit', 'edit', { path: 'routes.ts', oldText: 'queued-before', newText: 'queued-after' });
  globalThis.__tmustierPiQueueSteerState = { pending: 2, paused: false, blocked: false };
  try { await verdict('queued', 'current-session', { deliverAs: 'nextTurn' }); }
  finally { delete globalThis.__tmustierPiQueueSteerState; }

  await prepare('cancelled-mutation');
  const prior = fs.readFileSync(routeFile, 'utf8'), journalCount = journal('fixture-conversation').length;
  const cancellation = new AbortController();
  cancelMutation = () => cancellation.abort(new Error('fixture-cancelled-before-publication'));
  await assert.rejects(invoke('cancelled-write', 'write', { path: 'routes.ts', content: route('cancelled-after') }, cancellation.signal), /fixture-cancelled-before-publication/);
  const noticeCount = messages.length;
  await emit({ type: 'turn_end' });
  check('cancel-before-publication-no-transition-or-notice', fs.readFileSync(routeFile, 'utf8') === prior && journal('fixture-conversation').length === journalCount && messages.length === noticeCount);

  await prepare('cancelled-sync');
  clock++;
  await invoke('cancelled-sync-edit', 'edit', { path: 'routes.ts', oldText: 'cancelled-sync-before', newText: 'cancelled-sync-after' });
  const retainedBaseline = syncBaselineStore().get(root);
  const cancelledSync = await sync(root, { files: ['routes.ts'], budget: 512, sessionId: 'fixture-conversation' }, undefined, { current: () => false });
  check('revoked-sync-does-not-advance-baseline', cancelledSync.details.cancelled === true && syncBaselineStore().get(root) === retainedBaseline);
  await verdict('cancelled-sync-recovered', 'current-session', { deliverAs: 'steer', triggerTurn: true });

  await prepare('lost-ack');
  clock++;
  const beforeLost = journal('fixture-conversation').length;
  await assert.rejects(invoke('lost-ack-write', 'write', { path: 'routes.ts', content: route('lost-ack-after'), failAfter: true }), /fixture-after-publication/);
  check('pinned-failed-result-loses-commit-attribution', fs.readFileSync(routeFile, 'utf8') === route('lost-ack-after') && journal('fixture-conversation').length === beforeLost);
  await verdict('lost-ack', 'unattributed', { deliverAs: 'steer', triggerTurn: true });
  // Intentional native improvement: real local publication acknowledgements
  // retain this transition despite a rejected call (verified separately).
  check('fixture-send-is-not-model-continuation', mutationCases.every(row => row.continuationExecuted === false));
  process.stdout.write(JSON.stringify({ schemaVersion: 2, surface: 'pinned-components-fixture-runner', registered, events, checkpoints, assertions, mutationCases,
    omissions: ['real Pi ExtensionRunner/TUI', 'PiToolsProvider builtin dispatch', 'native Kiro transport', 'actual model continuation and native user queue/cancel', 'code reload', 'fork event distinct from session_tree'] }));
} finally {
  // Repeated shutdown is also safe and clears any timers on assertion failure.
  await emit({ type: 'session_shutdown' });
}
