// Development-only dependency adapter. Never imported by the production engine.
// It controls source-read scheduling plus either exact parser-byte replay or
// independent parser execution under a rule-order schedule. Neither contract
// proves autonomous production timing/concurrency equivalence.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const MAX_FRAME = 16 * 1024 * 1024;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_CALLS = 256;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function bytes(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_FRAME) throw Error('invalid tape/input file');
  return fs.readFileSync(file);
}
function inside(root, file) {
  const rel = path.relative(root, file);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/** FIFO source read COMPLETION, not a different extraction algorithm. Restore
 * before leaving the disposable driver. Non-source reads use normal I/O. */
export function installSourceReadQueue(root) {
  const original = fsp.readFile;
  let tail = Promise.resolve();
  let count = 0;
  fsp.readFile = function (file, ...args) {
    const target = typeof file === 'string' ? path.resolve(file) : file instanceof URL ? fileURLToPath(file) : null;
    if (!target || !inside(root, target)) return original(file, ...args);
    count++;
    const pending = tail.then(() => original(file, ...args));
    tail = pending.then(() => undefined, () => undefined);
    return pending;
  };
  syncBuiltinESMExports();
  return { get count() { return count; }, async restore() { await tail; fsp.readFile = original; syncBuiltinESMExports(); } };
}

/** Preserve rule bytes, source bytes/order and parser options. The explicitly
 * tested safe option terminator and ephemeral rule filename are the ONLY input
 * adaptations. No rule IDs, match arrays or output hashes are remapped. */
export function parserRequest(config, args, cwd) {
  if (cwd !== config.workspace || args.length > 2048 || args.some(a => typeof a !== 'string' || a.length > 32768) || !['scan', 'run', 'outline'].includes(args[0])) throw Error('unexpected parser request');
  // The native port adds an option terminator that the reference omits.
  // Admit only these exact known forms and safe operand names, retain raw argv
  // in the tape, and compare the otherwise-identical invocation byte for byte.
  const firstSource = args[0] === 'scan' && args[1] === '--rule' && args[3] === '--json=stream' ? 4
    : args[0] === 'run' && args[1] === '--pattern' && args[3] === '--lang' && args[5] === '--json=compact' ? 6
    : args[0] === 'outline' && args[1] === '--json=compact' && args[2] === '--view=expanded' ? 3
    : args[0] === 'outline' && args[1] && (args[1] === '--' || !args[1].startsWith('-')) ? 1 : -1;
  if (firstSource < 0) throw Error('unrecognized parser argument contract');
  const sourceArgs = args.slice(firstSource + (args[firstSource] === '--' ? 1 : 0));
  if (!sourceArgs.length || sourceArgs.some(a => a.startsWith('-'))) throw Error('unsafe parser operand');
  const argv = [...args.slice(0, firstSource), '--', ...sourceArgs];
  const rule = args.indexOf('--rule');
  if (rule >= 0) {
    const file = path.resolve(cwd, args[rule + 1] ?? '');
    if (!inside(config.storage, file)) throw Error('rule outside controlled storage');
    const raw = bytes(file);
    argv[rule + 1] = { ruleSha256: digest(raw), size: raw.length };
  }
  const sources = sourceArgs.map(rel => {
    const file = path.resolve(cwd, rel);
    if (!inside(config.workspace, file) || fs.realpathSync(file) !== file) throw Error('source outside controlled fixture');
    const raw = bytes(file);
    return { path: rel, size: raw.length, sha256: digest(raw) };
  });
  return { schemaVersion: 1, parserSha256: config.parserSha256, argv, sources };
}

// One wrapper invocation per entry; O_EXCL makes duplicate-key concurrent calls
// distinct. Never overwrite a prior capture or consume a cursor in the engine.
function claim(directory, key) {
  for (let n = 0; n < MAX_CALLS; n++) {
    const name = `${key}-${n}.json`;
    try { fs.closeSync(fs.openSync(path.join(directory, name), 'wx', 0o600)); return name; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  throw Error('parser tape call limit');
}
// Coordinate tiny quota/publication critical sections across parser wrappers.
// This test-only lock has a finite harness budget; parser work stays outside it.
function locked(directory, action) {
  const file = path.join(directory, '.lock');
  let fd;
  for (let n = 0; n < 1000 && fd === undefined; n++) {
    try { fd = fs.openSync(file, 'wx', 0o600); }
    catch (error) { if (error.code !== 'EEXIST') throw error; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); }
  }
  if (fd === undefined) throw Error('parser tape lock budget');
  try { return action(); } finally { fs.closeSync(fd); fs.unlinkSync(file); }
}
function entries(directory) {
  const names = fs.readdirSync(directory);
  if (names.length > MAX_CALLS) throw Error('parser tape call limit');
  return names;
}

export function createParserTape({ directory, workspace, storage, parser, recordParser = parser }) {
  fs.mkdirSync(directory, { mode: 0o700 });
  const records = path.join(directory, 'records');
  fs.mkdirSync(records, { mode: 0o700 });
  const parserSha256 = digest(bytesWithParserLimit(parser));
  const helper = pathToFileURL(fileURLToPath(import.meta.url)).href;
  const wrappers = [];
  return {
    parserSha256,
    wrapper(label, mode) {
      if (!/^[a-z-]{1,40}$/.test(label) || !['record', 'replay'].includes(mode)) throw Error('invalid tape mode');
      const uses = path.join(directory, label); fs.mkdirSync(uses, { mode: 0o700 });
      const errorFile = path.join(directory, `${label}.error`);
      const config = { directory, records, uses, errorFile, workspace, storage, parser, recordParser, parserSha256, mode };
      const executable = path.join(directory, `${label}.mjs`);
      fs.writeFileSync(executable, `#!${process.execPath}\nimport { parserTapeMain } from ${JSON.stringify(helper)};\nparserTapeMain(${JSON.stringify(config)});\n`, { flag: 'wx', mode: 0o700 });
      wrappers.push({ label, mode, uses, errorFile });
      return executable;
    },
    inspect() {
      const names = entries(records).sort();
      let totalBytes = 0;
      for (const name of names) { totalBytes += bytes(path.join(records, name)).length; }
      if (totalBytes > MAX_BYTES) throw Error('parser tape byte limit');
      const runs = wrappers.map(({ label, mode, uses, errorFile }) => {
        if (fs.existsSync(errorFile)) throw Error('rejected parser tape request');
        const used = entries(uses).sort();
        if (used.some(name => !names.includes(name))) throw Error('unexpected parser request or rejected tape');
        for (const name of used) if (bytes(path.join(uses, name)).toString() !== 'ok') throw Error('unsettled/rejected parser tape request');
        if (used.length !== names.length) throw Error('unconsumed parser tape entries');
        return { label, mode, calls: used.length };
      });
      return { schemaVersion: 1, contract: recordParser === parser ? 'fifo-source-exact-parser-tape-v1' : 'fifo-source-rule-order-parser-tape-v2', parserSha256, calls: names.length, totalBytes, runs };
    },
  };
}
function bytesWithParserLimit(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024 * 1024) throw Error('invalid test parser');
  return fs.readFileSync(file);
}

// Independent real-parser executions with a declared deterministic input schedule.
// Unlike the tape, no output from an earlier run is ever read. Split only the
// generated JSON rule documents (not arbitrary YAML) and preserve document order.
// This is not the production parser invocation contract or autonomous parity.
export function createParserSchedule({ directory, workspace, storage, parser }) {
  fs.mkdirSync(directory, { mode: 0o700 });
  const parserSha256 = digest(bytesWithParserLimit(parser));
  const helper = pathToFileURL(fileURLToPath(import.meta.url)).href;
  const wrappers = [];
  return {
    wrapper(label) {
      if (!/^[a-z-]{1,40}$/.test(label)) throw Error('invalid schedule label');
      const uses = path.join(directory, label); fs.mkdirSync(uses, { mode: 0o700 });
      const errorFile = path.join(directory, `${label}.error`);
      const config = { directory, uses, errorFile, workspace, storage, parser, parserSha256 };
      const executable = path.join(directory, `${label}.mjs`);
      fs.writeFileSync(executable, `#!${process.execPath}\nimport { parserScheduleMain } from ${JSON.stringify(helper)};\nparserScheduleMain(${JSON.stringify(config)});\n`, { flag: 'wx', mode: 0o700 });
      wrappers.push({ label, uses, errorFile });
      return executable;
    },
    inspect() {
      const runs = wrappers.map(({ label, uses, errorFile }) => {
        if (fs.existsSync(errorFile)) throw Error('rejected parser schedule request');
        const calls = entries(uses).sort().map(name => {
          const call = JSON.parse(bytes(path.join(uses, name)).toString());
          if (call.complete !== true || !Number.isInteger(call.status) || call.status < 0 || call.status > 255 || !Number.isSafeInteger(call.launches) || call.launches < 1 || typeof call.requestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(call.requestSha256)) throw Error('unsettled parser schedule');
          return call;
        });
        return { label, calls: calls.length, launches: calls.reduce((n, c) => n + c.launches, 0), requests: calls.map(c => c.requestSha256) };
      });
      return { contract: 'fifo-source-rule-order-live-parser-v1', parserSha256, replayedCalls: 0, runs };
    },
  };
}

export function parserScheduleMain(config) {
  try {
    if (digest(bytesWithParserLimit(config.parser)) !== config.parserSha256) throw Error('parser identity changed');
    const args = process.argv.slice(2);
    if (JSON.stringify(args) === '["--version"]' || JSON.stringify(args) === '["scan","--help"]') {
      const r = spawnSync(config.parser, args, { env: process.env, timeout: 15000, maxBuffer: MAX_FRAME });
      if (r.error || r.signal || r.status !== 0) throw Error('parser capability probe failed');
      process.stdout.write(r.stdout); process.stderr.write(r.stderr); return;
    }
    const request = parserRequest(config, args, process.cwd()), requestSha256 = digest(JSON.stringify(request));
    const name = locked(config.directory, () => {
      if (entries(config.uses).length >= MAX_CALLS) throw Error('parser schedule call limit');
      return claim(config.uses, requestSha256);
    });
    const firstSource = args[0] === 'scan' ? 4 : args[0] === 'run' ? 6 : args[1] === '--json=compact' ? 3 : 1;
    const sources = args.slice(firstSource + (args[firstSource] === '--' ? 1 : 0));
    let requests;
    if (args[0] === 'scan') {
      const rawRules = bytes(args[2]), ruleText = rawRules.toString('utf8');
      if (!Buffer.from(ruleText).equals(rawRules)) throw Error('invalid rule UTF-8');
      const documents = ruleText.split('\n---\n');
      if (documents.length > MAX_CALLS || !documents.length) throw Error('parser schedule rule limit');
      const ids = new Set();
      for (const text of documents) {
        const doc = JSON.parse(text);
        if (!doc || Array.isArray(doc) || typeof doc.id !== 'string' || ids.has(doc.id) || typeof doc.language !== 'string' || !doc.rule || typeof doc.rule.pattern !== 'string' || Object.keys(doc.rule).length !== 1 || Object.keys(doc).some(k => !['id', 'language', 'rule', 'constraints'].includes(k))) throw Error('unsupported generated rule document');
        ids.add(doc.id);
      }
      requests = documents.map((text, i) => {
        const file = path.join(config.uses, `${name}-${i}.rule`);
        return { file, text, args: ['scan', '--rule', file, '--json=stream', '--threads', '1', '--', ...sources] };
      });
    } else {
      requests = [{ args: [...args.slice(0, firstSource), ...(args[0] === 'run' ? ['--threads', '1'] : []), '--', ...sources] }];
    }
    const stdout = [], stderr = []; let size = 0, status = 0, launches = 0;
    const deadline = Date.now() + 120000;
    for (const request of requests) {
      if (request.file) fs.writeFileSync(request.file, request.text, { flag: 'wx', mode: 0o600 });
      try {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw Error('parser schedule deadline');
        launches++;
        const r = spawnSync(config.parser, request.args, { env: process.env, timeout: Math.min(15000, remaining), killSignal: 'SIGKILL', maxBuffer: MAX_FRAME / 2 });
        if (r.error || r.signal || r.status === null) throw Error('scheduled parser execution failed');
        size += r.stdout.length + r.stderr.length;
        if (size > MAX_FRAME) throw Error('parser schedule output limit');
        stdout.push(r.stdout); stderr.push(r.stderr);
        if (r.status !== 0) { status = r.status; break; }
      } finally { if (request.file) fs.unlinkSync(request.file); }
    }
    fs.writeFileSync(path.join(config.uses, name), JSON.stringify({ requestSha256, status, launches, complete: true }));
    process.stdout.write(Buffer.concat(stdout)); process.stderr.write(Buffer.concat(stderr)); process.exitCode = status;
  } catch (error) {
    try { fs.writeFileSync(config.errorFile, String(error.message).slice(0, 200), { flag: 'wx', mode: 0o600 }); } catch { /* retain first rejection */ }
    process.stderr.write('scheduled parser input rejected\n'); process.exitCode = 70;
  }
}

export function parserTapeMain(config) {
  try {
    const args = process.argv.slice(2);
    if (digest(bytesWithParserLimit(config.parser)) !== config.parserSha256) throw Error('parser identity changed');
    // Capability probes are not extraction inputs. Run the actual pinned parser.
    if (JSON.stringify(args) === '["--version"]' || JSON.stringify(args) === '["scan","--help"]') {
      const r = spawnSync(config.parser, args, { env: process.env, timeout: 15000, maxBuffer: MAX_FRAME });
      if (r.error || r.signal) throw Error('parser capability probe failed');
      process.stdout.write(r.stdout); process.stderr.write(r.stderr); process.exitCode = r.status; return;
    }
    const request = parserRequest(config, args, process.cwd());
    const key = digest(JSON.stringify(request));
    const name = locked(config.directory, () => {
      if (entries(config.uses).length >= MAX_CALLS) throw Error('parser tape call limit');
      return claim(config.uses, key);
    });
    const entry = path.join(config.records, name);
    let packet;
    if (config.mode === 'record') {
      const r = spawnSync(config.recordParser, args, { env: process.env, timeout: 120000, maxBuffer: MAX_FRAME / 2 });
      if (r.error || r.signal) throw Error('parser execution failed');
      const stdout = r.stdout.toString('base64'), stderr = r.stderr.toString('base64');
      packet = { request, originalArgs: args, status: r.status, stdout, stderr, outputSha256: digest(JSON.stringify({ status: r.status, stdout, stderr })) };
      const text = JSON.stringify(packet);
      if (Buffer.byteLength(text) > MAX_FRAME) throw Error('parser tape frame limit');
      locked(config.directory, () => {
        const current = entries(config.records);
        const occupied = current.reduce((n, f) => n + fs.statSync(path.join(config.records, f)).size, 0);
        if (current.length >= MAX_CALLS || occupied + Buffer.byteLength(text) > MAX_BYTES) throw Error('parser tape storage limit');
        fs.writeFileSync(entry, text, { flag: 'wx', mode: 0o600 });
      });
    } else {
      packet = JSON.parse(bytes(entry).toString());
      if (JSON.stringify(packet.request) !== JSON.stringify(request)) throw Error('parser request mismatch');
    }
    if (!Number.isInteger(packet.status) || packet.status < 0 || packet.status > 255 || typeof packet.stdout !== 'string' || typeof packet.stderr !== 'string') throw Error('invalid tape result');
    const stdout = Buffer.from(packet.stdout, 'base64'), stderr = Buffer.from(packet.stderr, 'base64');
    if (stdout.toString('base64') !== packet.stdout || stderr.toString('base64') !== packet.stderr || digest(JSON.stringify({ status: packet.status, stdout: packet.stdout, stderr: packet.stderr })) !== packet.outputSha256) throw Error('parser tape output changed');
    fs.writeFileSync(path.join(config.uses, name), 'ok');
    process.stdout.write(stdout); process.stderr.write(stderr); process.exitCode = packet.status;
  } catch (error) {
    try { fs.writeFileSync(config.errorFile, String(error.message).slice(0, 200), { flag: 'wx', mode: 0o600 }); } catch { /* first error is retained; always exits nonzero */ }
    // Failure is also visible in the unconsumed/unfinished tape ledger, even if
    // upstream falls back to another parser path or reports partial extraction.
    process.stderr.write('controlled parser input replay rejected\n'); process.exitCode = 70;
  }
}
