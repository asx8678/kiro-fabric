import fs from 'node:fs';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { object, digest, errorText } from './core.mjs';

/** @typedef {{id:string, input:unknown, output:unknown, title:string, origin:string, status:string, system:boolean}} Call */
/** @typedef {{failures:string[],events:unknown[],calls:Call[],usage:Record<string,unknown>[],credits:number|null,finalText:string,mode:string|null,model:string|null,effort?:string|null,requestIds:string[],sessionId:string|null}} Evidence */
/** Validate the observed ACP stream, without inferring missing events or usage.
 * @param {unknown[]} events @returns {Evidence} */
export function analyzeEvents(events) {
  /** @type {Evidence} */ const out = { failures: [], events, calls: [], usage: [], credits: null, finalText: '', mode: null, model: null, effort: null, requestIds: [], sessionId: null };
  /** @type {Map<string,Record<string,unknown>>} */ const calls = new Map();
  const completions = new Set(), requests = new Set();
  let finished = 0, turns = 0, invalidUsage = false;
  for (const raw of events) {
    try {
      const e = object(raw); assert.equal(typeof e.type, 'string', 'event type missing');
      const data = object(e.data);
      if (e.type === 'runFinished') {
        finished++; assert.equal(data.status, 'success', 'runFinished not success');
        assert.equal(typeof data.finalText, 'string', 'final text missing'); out.finalText = String(data.finalText);
        assert.ok(typeof data.sessionId === 'string' && data.sessionId.length > 0, 'session identity missing'); out.sessionId = String(data.sessionId);
      }
      if (!data.update) continue;
      const u = object(data.update);
      if (u.sessionUpdate === 'config_option_update') {
        assert.ok(Array.isArray(u.configOptions), 'config options missing');
        for (const rawOption of u.configOptions) { const c = object(rawOption); if (c.id === 'mode') out.mode = String(c.currentValue); if (c.id === 'model') out.model = String(c.currentValue); if (c.id === 'effort') out.effort = String(c.currentValue); }
      }
      if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
        assert.ok(typeof u.toolCallId === 'string' && u.toolCallId, 'call id missing'); const id = String(u.toolCallId);
        if (u.sessionUpdate === 'tool_call') { assert.ok(!calls.has(id), 'duplicate call start'); calls.set(id, { ...u }); }
        else { const prior = calls.get(id); assert.ok(prior, 'orphan call update'); assert.ok(prior.status !== 'completed' && prior.status !== 'failed', 'update after terminal call'); Object.assign(prior, u); }
      }
      const meta = u._meta ? object(u._meta) : {}, kiro = meta.kiro ? object(meta.kiro) : {};
      if (kiro.kind === 'turn_completion') {
        turns++;
        if (Array.isArray(kiro.promptTurnSummaries)) for (const row of kiro.promptTurnSummaries) {
          try { out.usage.push(object(row)); } catch (error) { invalidUsage = true; out.failures.push(errorText(error)); }
        }
        try {
          const key = digest(kiro); assert.ok(!completions.has(key), 'duplicate completion'); completions.add(key);
          assert.ok(Array.isArray(kiro.requestIds) && kiro.requestIds.length > 0, 'request IDs missing');
          for (const id of kiro.requestIds) { assert.ok(typeof id === 'string' && id && !requests.has(id), 'duplicate/invalid request ID'); requests.add(id); out.requestIds.push(id); }
          assert.ok(Array.isArray(kiro.promptTurnSummaries) && kiro.promptTurnSummaries.length > 0, 'turn usage missing');
          let creditRows = 0;
          for (const rawUsage of kiro.promptTurnSummaries) {
            const usage = object(rawUsage);
            assert.ok(typeof usage.unit === 'string' && usage.unit.length > 0 && typeof usage.usage === 'number' && Number.isFinite(usage.usage) && usage.usage >= 0, 'invalid usage row');
            if (usage.unit === 'credit') creditRows++;
          }
          assert.equal(creditRows, 1, 'missing/ambiguous credit usage for turn');
        } catch (error) { invalidUsage = true; out.failures.push(errorText(error)); }
      }
    } catch (error) { out.failures.push(errorText(error)); }
  }
  for (const [id, c] of calls) {
    /** @type {Record<string,unknown>} */ let kiro = {};
    try { const meta = c._meta ? object(c._meta) : {}; kiro = meta.kiro ? object(meta.kiro) : {}; }
    catch (error) { out.failures.push('invalid call metadata: ' + errorText(error)); }
    const call = { id, input: c.rawInput, output: c.rawOutput, title: String(c.title ?? ''), origin: String(kiro.serverName ?? kiro.toolId ?? ''), status: String(c.status ?? ''), system: kiro.toolId === 'fetch_cloud_config' };
    out.calls.push(call);
    if (!['completed', 'failed'].includes(call.status) || (!call.system && call.input === undefined) || call.output === undefined) out.failures.push('incomplete call evidence: ' + id);
  }
  if (finished !== 1) out.failures.push('expected exactly one runFinished');
  if (!turns) out.failures.push('missing turn completion/usage');
  if (!out.model || !out.mode) out.failures.push('missing model/mode evidence');
  if (turns && !invalidUsage) out.credits = out.usage.filter(r => r.unit === 'credit').reduce((sum, r) => sum + Number(r.usage), 0);
  return out;
}
/** @typedef {{code:number|null,signal:NodeJS.Signals|null,stopReason:string|null,spawnError:string|null,outputError:string|null,wallMs:number,outputBytes:number,retainedBytes:number,stdout:string,stderr:string}} Collected */
/** Combined retention cap applies BEFORE writing either stream. On stop, TERM then KILL the group and drain pipes.
 * @param {{executable:string,args:string[],cwd:string,env?:NodeJS.ProcessEnv,maxOutputBytes:number,timeoutMs:number,graceMs?:number,stdoutPath?:string,stderrPath?:string,signal?:AbortSignal,onLine?:(line:string)=>string|null}} options
 * @returns {Promise<Collected>} */
export async function collect(options) {
  assert.notEqual(process.platform, 'win32', 'live collection requires POSIX process groups');
  assert.ok(Number.isInteger(options.maxOutputBytes) && options.maxOutputBytes > 0 && options.timeoutMs > 0, 'invalid collector bounds');
  const start = performance.now(), grace = options.graceMs ?? 300;
  /** @type {(number|null)[]} */ const descriptors = [null, null];
  /** Release every descriptor acquired so far exactly once. */
  function releaseDescriptors() {
    let failure;
    for (let index = 0; index < descriptors.length; index += 1) {
      const fd = descriptors[index]; if (fd === null) continue;
      descriptors[index] = null;
      try { fs.closeSync(fd); } catch (error) { failure ??= error; }
    }
    if (failure) throw failure;
  }
  try {
    const targets = [options.stdoutPath, options.stderrPath];
    // Acquire incrementally: a failure on the second stream must still release
    // the first descriptor instead of leaking it for the process lifetime.
    for (let index = 0; index < targets.length; index += 1) if (targets[index]) descriptors[index] = fs.openSync(targets[index], 'wx', 0o600);
  } catch (error) { releaseDescriptors(); throw error; }
  const child = (() => {
    // A synchronous spawn rejection (invalid argument) must release the stream
    // descriptors opened above; only the asynchronous 'error' event is handled later.
    try { return spawn(options.executable, options.args, { cwd: options.cwd, env: options.env ?? process.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { releaseDescriptors(); throw error; }
  })();
  /** @type {Collected} */ const result = { code: null, signal: null, stopReason: null, spawnError: null, outputError: null, wallMs: 0, outputBytes: 0, retainedBytes: 0, stdout: '', stderr: '' };
  /** @type {Buffer[][]} */ const chunks = [[], []];
  const failedWrites = new Set();
  let buffer = '', closed = false;
  /** @type {NodeJS.Timeout | undefined} */ let killTimer, drainTimer;
  /** @type {()=>void} */ let finish = () => {};
  /** @param {NodeJS.Signals} signal */
  function kill(signal) { if (child.pid) { try { process.kill(-child.pid, signal); } catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ESRCH') result.spawnError = errorText(error); } } }
  /** @param {string} reason */
  function stop(reason) {
    if (result.stopReason) return;
    result.stopReason = reason; kill('SIGTERM');
    killTimer = setTimeout(() => { kill('SIGKILL'); if (closed) finish(); }, grace);
    drainTimer = setTimeout(() => { kill('SIGKILL'); child.stdout.destroy(); child.stderr.destroy(); finish(); }, grace + 1000);
  }
  /** @param {Buffer} chunk @param {number} stream */
  function receive(chunk, stream) {
    result.outputBytes += chunk.length;
    const kept = chunk.subarray(0, Math.max(0, options.maxOutputBytes - result.retainedBytes));
    if (kept.length) {
      result.retainedBytes += kept.length; chunks[stream].push(kept);
      if (descriptors[stream] !== null && !failedWrites.has(stream)) {
        try {
          const written = fs.writeSync(descriptors[stream], kept);
          assert.equal(written, kept.length, `short write: ${written}/${kept.length} bytes`);
        } catch (error) {
          // Archive failure must not escape the emitter or discard charge evidence.
          // Stop boundedly, but keep draining/parsing the capped in-memory stream.
          failedWrites.add(stream);
          result.outputError ??= `${stream === 0 ? 'stdout' : 'stderr'}: ${errorText(error)}`;
          stop('output-write: ' + result.outputError);
        }
      }
    }
    if (result.outputBytes > options.maxOutputBytes) stop('combined-output-limit');
    if (stream === 0 && options.onLine) {
      // Decode only complete byte lines, so split UTF-8 chunks cannot corrupt evidence.
      buffer += kept.toString('latin1');
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = Buffer.from(buffer.slice(0, end), 'latin1').toString('utf8'); buffer = buffer.slice(end + 1);
        try { const reason = options.onLine(line); if (reason) stop(reason); } catch (error) { stop('event-handler: ' + errorText(error)); }
      }
    }
  }
  child.stdout.on('data', chunk => receive(chunk, 0)); child.stderr.on('data', chunk => receive(chunk, 1));
  child.on('error', error => { result.spawnError = errorText(error); });
  const abort = () => stop('canceled');
  const timeout = setTimeout(() => stop('wall-time-limit'), options.timeoutMs);
  try {
    await new Promise(resolve => {
      finish = () => { clearTimeout(timeout); clearTimeout(killTimer); clearTimeout(drainTimer); options.signal?.removeEventListener('abort', abort); resolve(undefined); };
      child.on('close', (code, signal) => { result.code = code; result.signal = signal; closed = true; if (!result.stopReason) { kill('SIGKILL'); finish(); } });
      options.signal?.addEventListener('abort', abort, { once: true }); if (options.signal?.aborted) abort();
    });
    if (options.onLine && buffer.trim() && result.outputBytes <= options.maxOutputBytes) {
      try { const reason = options.onLine(Buffer.from(buffer, 'latin1').toString('utf8')); if (reason) result.stopReason ??= reason; } catch (error) { result.stopReason ??= 'event-handler: ' + errorText(error); }
    }
  } finally {
    try { releaseDescriptors(); }
    catch (error) { result.outputError ??= errorText(error); result.stopReason ??= 'output-close: ' + result.outputError; }
  }
  result.stdout = Buffer.concat(chunks[0]).toString('utf8'); result.stderr = Buffer.concat(chunks[1]).toString('utf8'); result.wallMs = performance.now() - start;
  return result;
}
/** @param {number} maxCalls */
export function eventCollector(maxCalls) {
  /** @type {unknown[]} */ const events = [];
  let malformed = 0, calls = 0;
  return {
    events,
    get malformed() { return malformed; },
    /** @param {string} line */
    onLine(line) {
      if (!line.trim()) return null;
      try {
        const e = object(JSON.parse(line)); events.push(e);
        const d = e.data ? object(e.data) : {}, u = d.update ? object(d.update) : {};
        if (u.sessionUpdate === 'tool_call' && ++calls > maxCalls) return 'tool-call-limit';
      } catch { malformed++; return 'malformed-stream-json'; }
      return null;
    }
  };
}
