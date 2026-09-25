// Fixed W4 process cases. Main owns registration; these never execute an engine.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadFoveaFixture, barrier, rejected } from './lifecycle-fovea-fixture.mjs';

async function variants(context, id, entries) {
  const facts = [], failures = [];
  for (const [name, run] of entries) {
    const fixture = await loadFoveaFixture(context, `${id}-${name}`);
    let value, error;
    fixture.install();
    try { value = await run(fixture); }
    catch (caught) { error = caught; }
    finally {
      try { await fixture.settle(); }
      catch (caught) { error = error ? new AggregateError([error, caught], 'assertion and fixture settlement failed') : caught; }
      finally { fixture.restore(); }
    }
    const evidence = fixture.evidence();
    const item = { name, status: error ? 'failed' : 'passed', ...(value ?? {}), ...evidence, ...(error ? { error: describe(error) } : {}) };
    fs.writeFileSync(path.join(fixture.directory, 'result.json'), JSON.stringify(item, null, 2), { flag: 'wx', mode: 0o600 });
    facts.push(item);
    if (error) failures.push(new Error(`${id}/${name}: ${error.message}`, { cause: error }));
  }
  if (failures.length) throw Object.assign(new AggregateError(failures, `${id}: ${failures.length}/${entries.length} variants failed`), { variants: facts });
  return { variants: facts, sourceLevel: true, nativeParser: false, retained: true };
}
function describe(error) { return { message: String(error?.message ?? error), ...(error?.errors ? { errors: error.errors.map(describe) } : {}), ...(error?.cause ? { cause: describe(error.cause) } : {}) }; }
const pending = task => assert.equal(task.state.settled, false, 'must remain pending at controlled barrier');
const fulfilled = task => assert.equal(task.state.status, 'fulfilled', String(task.state.error));

async function stopGate(f, owner) {
  const child = await f.ready(owner), gate = f.gate();
  f.hooks.alive = () => gate.promise;
  child.emit('message', JSON.stringify({ version: 1, id: 'unsolicited', ok: true, value: {} }));
  await barrier();
  assert.ok(f.signals.length, 'force cleanup entered');
  assert.ok(f.api.events.some(event => event.type === 'census'), 'wait at process-group gate');
  return { child, gate };
}

/** @type {Array<[string, (f: Awaited<ReturnType<typeof loadFoveaFixture>>) => Promise<object>]>} */
const processVariants = [
  ['ensure-wait-close', async f => {
    const owner = f.process(), { gate } = await stopGate(f, owner);
    const waiting = f.request(owner); await barrier(); pending(waiting);
    const closing = f.track(() => owner.close()); await barrier(); pending(closing);
    gate.resolve(false); await barrier();
    assert.equal(f.children.length, 1, 'ensure awaiting stop must recheck terminal close before replacement fork');
    rejected(waiting); fulfilled(closing);
    return { replacementForks: 0, closeDuringStop: true };
  }],
  ['uncertain-stop-blocks-ensure', async f => {
    const owner = f.process(), { gate } = await stopGate(f, owner);
    const waiting = f.request(owner), failure = new Error('fixture group ownership uncertain');
    gate.reject(failure); await barrier(); rejected(waiting);
    const late = f.request(owner); await barrier(); rejected(late);
    assert.equal(f.children.length, 1); assert.ok(owner.unavailable);
    return { uncertainAdmissionBlocked: true };
  }],
  ['restart-close-no-success', async f => {
    const owner = f.process(), { gate } = await stopGate(f, owner);
    const restart = f.track(() => owner.restart()); await barrier(); pending(restart);
    const close = f.track(() => owner.close()); gate.resolve(false); await barrier();
    rejected(restart, 'restart cannot publish success after terminal close'); fulfilled(close);
    assert.equal(f.children.length, 1);
    return { restartPublicationRevoked: true };
  }],
  ['sticky-shared-close-failure', async f => {
    const owner = f.process(); await f.ready(owner);
    const gate = f.gate(), failure = new Error('fixture census failure'); f.hooks.alive = () => gate.promise;
    const first = f.track(() => owner.close()); await f.clock.advance(500);
    const second = f.track(() => owner.close()); await barrier(); pending(first); pending(second);
    gate.reject(failure); await barrier(); rejected(first); rejected(second);
    assert.equal(first.state.error, second.state.error, 'concurrent close retains original error');
    const later = f.track(() => owner.close()); await barrier(); rejected(later, 'failed close cannot become a successful retry');
    assert.equal(later.state.error, first.state.error); assert.equal(f.signals.length, 1);
    return { stickyCloseFailure: true, signalAttempts: 1 };
  }],
  ['reentrant-close-failure', async f => {
    const owner = f.process(); await f.ready(owner);
    /** @type {any} */ let reentrant;
    let entered = false; const failure = new Error('fixture signal failure');
    f.hooks.kill = () => { if (!entered) { entered = true; reentrant = f.track(() => owner.close()); } throw failure; };
    const first = f.track(() => owner.close()); await f.clock.advance(500);
    assert.ok(reentrant, 'cleanup boundary reentered close'); rejected(first); rejected(reentrant, 'reentrant close cannot escape failing ownership');
    assert.equal(reentrant.state.error, first.state.error); assert.equal(f.signals.length, 1);
    return { reentrantCloseJoins: true };
  }],
  ['graceful-ack-and-exit', async f => {
    const owner = f.process(), child = await f.ready(owner);
    const closing = f.track(() => owner.close()); await barrier();
    const shutdown = f.frame(child, 'shutdown');
    assert.equal(f.signals.length, 0, 'idle close must offer graceful shutdown before kill'); pending(closing);
    // This is a mocked parent protocol check, not evidence of disk reclamation.
    child.reply(shutdown, { shutdown: true, closed: true, cleanup: { scratch: 'removed' } }); await barrier();
    pending(closing); assert.equal(f.signals.length, 0, 'ack alone cannot prove process exit');
    child.exit('SIGTERM'); await barrier(); fulfilled(closing);
    assert.equal(f.signals.length, 0);
    return { shutdownFrame: true, ackAndExitRequired: true, realScratchReclamation: false };
  }],
  ['forced-fallback-total-bound', async f => {
    const owner = f.process(); await f.ready(owner);
    f.hooks.alive = () => true;
    const closing = f.track(() => owner.close()); await barrier();
    assert.equal(f.signals.length, 0, 'graceful interval must precede fallback');
    await f.clock.advance(499); pending(closing); assert.equal(f.signals.length, 0);
    await f.clock.advance(1); assert.equal(f.signals.length, 1, '500ms grace is inside cleanup total');
    await f.clock.advance(999); pending(closing);
    await f.clock.advance(1); rejected(closing, 'uncertain group must fail within original 1500ms total');
    assert.ok(owner.unavailable); assert.equal(f.clock.now, 1500);
    const late = f.request(owner); await barrier(); rejected(late); assert.equal(f.children.length, 1);
    return { graceMs: 500, totalCleanupMs: 1500, uncertaintyLatched: true };
  }],
  ['forced-fallback-retains-scratch-diagnostic', async f => {
    const owner = f.process(); await f.ready(owner);
    const closing = f.track(() => owner.close()); await f.clock.advance(500); fulfilled(closing);
    const diagnostic = owner.cleanup ?? owner.diagnostics?.cleanup;
    assert.ok(diagnostic && typeof diagnostic === 'object', 'forced shutdown must expose cleanup diagnostics');
    assert.ok(/forc/i.test(String(diagnostic.mode)), 'cleanup mode distinguishes forced termination');
    assert.ok(/confirm|gone|terminat/i.test(String(diagnostic.processGroup)), 'confirmed group termination is separate');
    assert.ok(/retain|unknown|unverif/i.test(String(diagnostic.scratch)), 'force cannot claim scratch reclamation');
    return { cleanup: diagnostic, totalCleanupMs: f.clock.now };
  }],
];

/** @type {Array<[string, (f: Awaited<ReturnType<typeof loadFoveaFixture>>) => Promise<object>]>} */
const schedulerVariants = [
  ['queued-cancellation-releases-capacity', async f => {
    const scheduler = new f.api.FoveaScheduler(), gate = f.gate(); let dispatched = 0;
    const active = f.track(() => scheduler.run(new AbortController().signal, () => gate.promise));
    const controllers = Array.from({ length: 16 }, () => new AbortController());
    const queued = controllers.map(controller => f.track(() => scheduler.run(controller.signal, async () => { dispatched++; })));
    const full = f.track(() => scheduler.run(new AbortController().signal, async () => { dispatched++; })); await barrier(); rejected(full);
    controllers[0].abort(new Error('cancel queued')); await barrier(); rejected(queued[0]);
    const admitted = f.track(() => scheduler.run(new AbortController().signal, async () => { dispatched++; })); await barrier(); pending(admitted);
    assert.equal(dispatched, 0);
    gate.resolve();
    // Sixteen serial jobs require more microtask turns than a single boundary.
    for (let i = 0; i < 16 && !admitted.state.settled; i++) await barrier();
    fulfilled(active); fulfilled(admitted);
    assert.equal(dispatched, 16, 'cancelled queued callback must never dispatch');
    queued.slice(1).forEach(fulfilled); assert.equal(scheduler.busy, false); scheduler.close();
    return { queueCapacity: 16, cancelledDispatches: 0, releasedAdmission: true };
  }],
  ['host-reload-serialized', async f => {
    const host = f.host(), first = host.invoke('reset'); await barrier(); const old = f.children[0];
    old.reply(f.frame(old, 'initialize')); await barrier(); const frame = f.frame(old, 'query');
    const reload = host.invoke('reload'), next = host.invoke('reset'); await barrier();
    pending(first); pending(reload); pending(next); assert.equal(f.children.length, 1); assert.equal(f.signals.length, 0);
    assert.equal(old.frames.filter(frame => frame.type === 'shutdown').length, 0, 'reload cannot stop active query');
    old.reply(frame, { reset: true }); await barrier(); fulfilled(first);
    await f.clock.advance(500); fulfilled(reload); assert.equal(reload.state.value.restarted, true);
    assert.equal(f.children.length, 2); const replacement = f.children[1];
    replacement.reply(f.frame(replacement, 'initialize')); await barrier();
    replacement.reply(f.frame(replacement, 'query'), { reset: true }); await barrier(); fulfilled(next);
    assert.equal(old.frames.filter(frame => frame.type === 'query').length, 1);
    return { realHost: true, realScheduler: true, nativeJournal: false, replacementAfterPriorSettlement: true };
  }],
  ['host-queued-reload-cancelled', async f => {
    const host = f.host(), first = host.invoke('reset'); await barrier(); const child = f.children[0];
    child.reply(f.frame(child, 'initialize')); await barrier();
    const cancellation = new AbortController(), reload = host.invoke('reload', cancellation.signal); await barrier(); pending(reload);
    cancellation.abort(); await barrier(); rejected(reload); assert.equal(f.signals.length, 0);
    child.reply(f.frame(child, 'query'), { reset: true }); await barrier(); fulfilled(first);
    assert.equal(f.children.length, 1); assert.equal(child.frames.some(frame => frame.type === 'shutdown'), false);
    return { cancelledReloadDispatched: false, realHost: true };
  }],
];

async function obsolete(f, event) {
  const owner = f.process(), old = await f.ready(owner), captured = old.listeners(event)[0];
  assert.equal(typeof captured, 'function', 'capture actual registered old-generation callback');
  const restart = f.track(() => owner.restart()); await f.clock.advance(500); fulfilled(restart);
  const next = f.request(owner); await barrier(); const child = f.children[1];
  child.reply(f.frame(child, 'initialize')); await barrier();
  const frame = f.frame(child, 'query'), beforeSignals = f.signals.length;
  if (event === 'message') captured(JSON.stringify({ version: 1, id: frame.id, ok: true, value: { obsolete: true } }));
  else captured(new Error('captured obsolete callback'));
  await barrier();
  pending(next); assert.equal(f.signals.length, beforeSignals, 'obsolete callback cannot terminate replacement');
  assert.equal(owner.active, true); child.reply(frame, { current: true }); await barrier(); fulfilled(next);
  assert.deepEqual(next.state.value, { current: true });
  return { capturedObsoleteEvent: event, currentGenerationUnaffected: true };
}

const generationVariants = [
  ...['message', 'error', 'exit'].map(event => [`obsolete-${event}-callback`, f => obsolete(f, event)]),
  ...['unsolicited', 'replayed'].map(kind => [`current-${kind}-fails-current-only`, async f => {
    const owner = f.process(), child = await f.ready(owner);
    const id = kind === 'replayed' ? f.frame(child, 'query').id : 'unrequested';
    const active = f.request(owner); await barrier();
    child.emit('message', JSON.stringify({ version: 1, id, ok: true, value: {} })); await barrier();
    rejected(active); assert.equal(f.signals.length, 1); assert.equal(f.signals[0].pid, -child.pid);
    const next = f.request(owner); await barrier(); const replacement = f.children[1];
    replacement.reply(f.frame(replacement, 'initialize')); await barrier(); replacement.reply(f.frame(replacement, 'query'), { current: true }); await barrier(); fulfilled(next);
    assert.equal(f.signals.length, 1);
    return { rejectedCurrentFrame: kind, failingGenerationOnly: true };
  }]),
  ['handshake-ceiling', async f => {
    const owner = f.process(), request = f.request(owner); await barrier();
    assert.ok(f.clock.scheduled.some(timer => timer.delay === 5000), 'handshake ceiling stays 5000ms');
    await f.clock.advance(4999); pending(request); assert.equal(f.signals.length, 0);
    await f.clock.advance(1); rejected(request); assert.equal(f.signals[0].at, 5000);
    assert.equal(f.children[0].frames.some(frame => frame.type === 'query'), false);
    return { handshakeCeilingMs: 5000, queryDispatched: false };
  }],
  ['ipc-initialization-cancellation', async f => {
    const owner = f.process(), controller = new AbortController(), request = f.request(owner, controller.signal); await barrier();
    const child = f.children[0]; f.frame(child, 'initialize'); controller.abort(new Error('cancel IPC initialize'));
    await f.clock.advance(250); rejected(request, 'IPC initialization cancellation must not wait for the 5000ms handshake deadline');
    assert.equal(child.frames.some(frame => frame.type === 'query'), false); assert.equal(owner.active, false);
    assert.equal(f.children.length, 1); assert.ok(f.signals.length > 0);
    return { cancellationPhase: 'IPC initialization', queryDispatched: false, cancellationCeilingMs: 250 };
  }],
  ['lazy-parser-query-cancellation', async f => {
    const owner = f.process(), controller = new AbortController(), request = f.request(owner, controller.signal); await barrier();
    const child = f.children[0]; child.reply(f.frame(child, 'initialize')); await barrier(); const query = f.frame(child, 'query');
    // No engine/parser runs here: hold the query at the child-facing lazy phase.
    controller.abort(); await barrier(); const cancel = f.frame(child, 'cancel'); assert.equal(cancel.id, query.id);
    await f.clock.advance(249); pending(request); assert.equal(f.signals.length, 0);
    await f.clock.advance(1); rejected(request); assert.equal(f.signals[0].at, 250);
    return { cancellationPhase: 'post-handshake query (lazy parser boundary inert)', cancellationCeilingMs: 250, cancelCorrelated: true };
  }],
];

processVariants.push(
  ['hung-census-still-bounded', async f => {
    const owner=f.process();await f.ready(owner);const gate=f.gate();f.hooks.alive=()=>gate.promise;
    const closing=f.track(()=>owner.close());await f.clock.advance(1499);pending(closing);await f.clock.advance(1);rejected(closing);
    assert.equal(f.clock.now,1500);gate.resolve(false);await barrier();assert.ok(owner.unavailable);assert.equal(owner.cleanup.mode,'uncertain');
    const late=f.track(()=>owner.restart());await barrier();rejected(late);assert.equal(f.children.length,1);return {hungCensusBounded:true,lateProofCannotClearFailure:true};
  }],
  ['late-shutdown-error-ignored', async f => {
    const owner=f.process(),child=await f.ready(owner),gate=f.gate();f.hooks.alive=()=>gate.promise;
    const closing=f.track(()=>owner.close());await barrier();const frame=f.frame(child,'shutdown'),callback=child.listeners('message')[0];
    await f.clock.advance(500);pending(closing);callback(JSON.stringify({version:1,id:frame.id,ok:false,error:'obsolete shutdown error'}));gate.resolve(false);await barrier();fulfilled(closing);
    assert.equal(owner.cleanup.mode,'forced');assert.equal(owner.cleanup.scratch,'retained');return {obsoleteShutdownIgnored:true};
  }],
  ['graceful-leader-left-descendants', async f => {
    const owner=f.process(),child=await f.ready(owner);let probes=0;f.hooks.alive=()=>probes++===0;
    const closing=f.track(()=>owner.close());await barrier();child.reply(f.frame(child,'shutdown'),{shutdown:true,closed:true,cleanup:{scratch:'removed'}});child.exit('SIGTERM');await f.clock.advance(10);fulfilled(closing);
    assert.equal(f.signals.length,1);assert.equal(owner.cleanup.mode,'forced');assert.equal(owner.cleanup.scratch,'retained');assert.equal(owner.retainedScratchGenerations,1);return {leaderExitNotGroupProof:true};
  }],
  ['failed-graceful-cleanup-latches', async f => {
    const owner=f.process(),child=await f.ready(owner);const closing=f.track(()=>owner.close());await barrier();
    child.emit('message',JSON.stringify({version:1,id:f.frame(child,'shutdown').id,ok:false,error:'scratch ownership changed; retained'}));await barrier();rejected(closing);assert.ok(owner.unavailable);
    assert.equal(owner.cleanup.processGroup,'confirmed');assert.equal(owner.cleanup.scratch,'retained');const later=f.request(owner);await barrier();rejected(later);assert.equal(f.children.length,1);return {failedDiskCleanupNotSuccess:true};
  }],
  ['close-reentry-during-fork-owns-late-child', async f => {
    const owner=f.process();let closing;f.hooks.fork=()=>{closing=f.track(()=>owner.close());};
    f.hooks.send=(child,frame)=>{if(frame.type==='shutdown')queueMicrotask(()=>{child.reply(frame,{shutdown:true,closed:true,cleanup:{scratch:'removed'}});child.exit('SIGTERM');});};
    const request=f.request(owner);await barrier();rejected(request);fulfilled(closing);assert.equal(f.children.length,1);
    assert.equal(f.children[0].frames.some(frame=>frame.type==='initialize'||frame.type==='query'),false);assert.equal(owner.active,false);return {lateForkOwned:true,publicationBlocked:true};
  }]
);
schedulerVariants.push(['host-close-reentry-shares-ownership', async f=>{
  const original=f.api.FoveaEngineProcess.prototype.query;let reentered;const host=f.host();
  f.api.FoveaEngineProcess.prototype.query=function(request,signal,budget){signal.addEventListener('abort',()=>{reentered=host.owner.close();},{once:true});return original.call(this,request,signal,budget);};
  try{const active=host.invoke('reset');await barrier();const child=f.children[0];child.reply(f.frame(child,'initialize'));await barrier();
    const promise=host.owner.close();assert.equal(reentered,promise);const closing=f.track(()=>promise);await barrier();fulfilled(closing);rejected(active);return {realHostReentryShared:true};
  }finally{f.api.FoveaEngineProcess.prototype.query=original;}
}]);

export function createFoveaProcessCases() {
  return [
    { id: 'LC26', title: 'Fovea process admission, shared close, graceful and bounded forced cleanup', entries: processVariants },
    { id: 'LC27', title: 'Fovea scheduler cancellation and real-host reload serialization', entries: schedulerVariants },
    { id: 'LC28', title: 'Fovea generation callbacks, handshake and query cancellation', entries: generationVariants },
  ].map(({ entries, ...metadata }) => ({ ...metadata, effects: 'source bundle; EventEmitter fake children; guarded signals; deterministic clocks; private retained files; no engine/native execution', deadlineMs: 60000, run: context => variants(context, metadata.id, entries) }));
}

// Standalone retained red/green report before independent Main registration.
// Invoke from the repository root; exit 1 means intended behavior is not met.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = fs.realpathSync(process.cwd()), parent = path.join(root, '.tmp');
  const fixturesRoot = fs.mkdtempSync(path.join(parent, 'fovea-process-regressions-'));
  const results = [];
  for (const entry of createFoveaProcessCases()) {
    try { results.push({ id: entry.id, status: 'passed', facts: await entry.run({ root, fixturesRoot }) }); }
    catch (error) { results.push({ id: entry.id, status: 'failed', error: describe(error), variants: error.variants ?? [] }); }
  }
  const report = path.join(fixturesRoot, 'report.json');
  fs.writeFileSync(report, JSON.stringify({ retained: true, results }, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ report, cases: results.map(result => ({ id: result.id, status: result.status, variants: (result.facts?.variants ?? result.variants).map(({ name, status, error }) => ({ name, status, ...(error ? { error } : {}) })) })) }, null, 2));
  process.exitCode = results.some(result => result.status !== 'passed') ? 1 : 0;
}
