import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { createScope } from '../../scripts/fovea-capability-probe.mjs';
import { createParserSchedule, createParserTape, installSourceReadQueue, parserRequest } from './fixtures/cold-inputs.mjs';

const scopes: string[] = [];
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const root of scopes.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const scope = createScope(); scopes.push(scope.root);
  const storage = path.join(scope.root, 'tmp'), directory = path.join(scope.root, 'tape');
  fs.writeFileSync(path.join(scope.workspace, 'a.ts'), 'let a = 1;');
  fs.writeFileSync(path.join(scope.workspace, 'b.ts'), 'let b = 2;');
  const rule = path.join(storage, 'rules.json'); fs.writeFileSync(rule, '{"id":"test"}');
  const parser = path.join(scope.root, 'parser.mjs'), launches = path.join(scope.root, 'launches');
  // Unit fixture only: verifies arbitrary raw bytes and numeric failure status.
  fs.writeFileSync(parser, `#!${process.execPath}\nimport fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(launches)},'x'); process.stdout.write(Buffer.from([0,255,65,10])); process.stderr.write('diagnostic'); process.exitCode=7;\n`, { mode: 0o700 });
  const tape = createParserTape({ directory, storage, workspace: scope.workspace, parser });
  const config = { storage, workspace: scope.workspace, parserSha256: tape.parserSha256 };
  const args = ['scan', '--rule', rule, '--json=stream', 'a.ts', 'b.ts'];
  const run = (executable: string, argv = args) => {
    const r = spawnSync(executable, argv, { cwd: scope.workspace, env: scope.env, timeout: 15000 });
    expect(r.error).toBeUndefined(); expect(r.signal).toBeNull(); return r;
  };
  const entry = () => path.join(directory, 'records', fs.readdirSync(path.join(directory, 'records'))[0]!);
  return { scope, storage, directory, parser, launches, tape, config, rule, args, run, entry };
}

it('compares exact rule/source bytes and order; only safe delimiter and temporary rule path may differ', () => {
  const f = fixture(); const first = parserRequest(f.config, f.args, f.scope.workspace);
  const otherRule = path.join(f.storage, 'another-rules.json'); fs.copyFileSync(f.rule, otherRule);
  expect(parserRequest(f.config, ['scan','--rule',otherRule,'--json=stream','--','a.ts','b.ts'], f.scope.workspace)).toEqual(first);
  expect(parserRequest(f.config, ['scan','--rule',otherRule,'--json=stream','b.ts','a.ts'], f.scope.workspace)).not.toEqual(first);
  fs.writeFileSync(otherRule, '{"id":"diff"}');
  expect(parserRequest(f.config, ['scan','--rule',otherRule,'--json=stream','a.ts','b.ts'], f.scope.workspace)).not.toEqual(first);
  fs.writeFileSync(path.join(f.scope.workspace, 'a.ts'), 'let a = 9;');
  expect(parserRequest(f.config, f.args, f.scope.workspace)).not.toEqual(first);
});

it('rejects unrecognized flags, unsafe operands, symlinks, foreign cwd and oversized source inputs', () => {
  const f = fixture();
  for (const args of [['outline', '--bogus', 'a.ts'], ['outline', '--', '-a.ts'], ['outline', '../parser.mjs']]) {
    expect(() => parserRequest(f.config, args, f.scope.workspace)).toThrow();
  }
  expect(() => parserRequest(f.config, f.args, f.scope.root)).toThrow('unexpected parser request');
  fs.symlinkSync(path.join(f.scope.workspace, 'a.ts'), path.join(f.scope.workspace, 'linked.ts'));
  expect(() => parserRequest(f.config, ['outline', 'linked.ts'], f.scope.workspace)).toThrow();
  const large = path.join(f.scope.workspace, 'large.ts'); fs.closeSync(fs.openSync(large, 'wx')); fs.truncateSync(large, 16 * 1024 * 1024 + 1);
  expect(() => parserRequest(f.config, ['outline', large], f.scope.workspace)).toThrow('invalid tape/input file');
});

it('captures and replays stdout/stderr and nonzero status byte-for-byte without reexecuting the parser', () => {
  const f = fixture(), record = f.tape.wrapper('record', 'record');
  const first = f.run(record); expect(first.status).toBe(7);
  const replay = f.tape.wrapper('replay', 'replay');
  const second = f.run(replay, [...f.args.slice(0,4), '--', ...f.args.slice(4)]);
  expect(second.status).toBe(first.status); expect(second.stdout).toEqual(first.stdout); expect(second.stderr).toEqual(first.stderr);
  expect(first.stdout).toEqual(Buffer.from([0,255,65,10]));
  expect(fs.readFileSync(f.launches, 'utf8')).toBe('x');
  expect(f.tape.inspect()).toMatchObject({ calls: 1, runs: [{ label:'record', mode:'record', calls:1 }, { label:'replay', mode:'replay', calls:1 }] });
  expect(JSON.parse(fs.readFileSync(f.entry(), 'utf8')).originalArgs).toEqual(f.args);
});

it.each(['source', 'rule', 'parser', 'operand-order'])('rejects %s drift instead of rewriting a parser request', change => {
  const f = fixture(); expect(f.run(f.tape.wrapper('record', 'record')).status).toBe(7);
  if (change === 'source') fs.writeFileSync(path.join(f.scope.workspace, 'a.ts'), 'let a = 3;');
  if (change === 'rule') fs.writeFileSync(f.rule, '{"id":"evil"}');
  if (change === 'parser') fs.appendFileSync(f.parser, '\n// replaced\n');
  const args = change === 'operand-order' ? [...f.args.slice(0,4), 'b.ts', 'a.ts'] : f.args;
  expect(f.run(f.tape.wrapper('replay','replay'), args).status).toBe(70);
  expect(() => f.tape.inspect()).toThrow(/rejected|unexpected/);
  expect(fs.readFileSync(f.launches,'utf8')).toBe('x');
});

it.each(['stdout','stderr','status'])('rejects tampered parser %s even if extraction could otherwise fall back', field => {
  const f = fixture(); expect(f.run(f.tape.wrapper('record','record')).status).toBe(7);
  const entry = f.entry(), packet = JSON.parse(fs.readFileSync(entry,'utf8'));
  packet[field] = field === 'status' ? 0 : Buffer.from('tampered').toString('base64');
  fs.writeFileSync(entry, JSON.stringify(packet));
  expect(f.run(f.tape.wrapper('replay','replay')).status).toBe(70);
  expect(() => f.tape.inspect()).toThrow('rejected');
});

it('fails on unconsumed entries, unexpected repeated calls and blank claims', () => {
  const f = fixture(); expect(f.run(f.tape.wrapper('record','record')).status).toBe(7);
  const replay = f.tape.wrapper('replay','replay');
  expect(() => f.tape.inspect()).toThrow('unconsumed');
  expect(f.run(replay).status).toBe(7);
  expect(f.tape.inspect().calls).toBe(1);
  fs.writeFileSync(path.join(f.directory,'replay',path.basename(f.entry())), '');
  expect(() => f.tape.inspect()).toThrow('unsettled');
  expect(f.run(replay).status).toBe(70);
  expect(() => f.tape.inspect()).toThrow('rejected');
});

it('rejects retained tape counts and frames before unbounded loading', () => {
  const f = fixture(); const records = path.join(f.directory,'records');
  for (let n = 0; n < 257; n++) fs.writeFileSync(path.join(records, `${n}.json`), '');
  expect(() => f.tape.inspect()).toThrow('call limit');
  for (const name of fs.readdirSync(records)) fs.unlinkSync(path.join(records,name));
  const large = path.join(records,'large.json'); fs.closeSync(fs.openSync(large,'wx')); fs.truncateSync(large,16*1024*1024+1);
  expect(() => f.tape.inspect()).toThrow('invalid tape/input file');
});

function scheduleFixture(status = 0) {
  const f = fixture();
  const documents = [
    '{"id":"z-last","language":"TypeScript","rule":{"pattern":"$F($$$)"}}',
    '{ "id": "a-first", "language":"TypeScript", "rule":{"pattern":"$O.$M($$$)"} }',
  ];
  fs.writeFileSync(f.rule, documents.join('\n---\n'));
  fs.writeFileSync(f.parser, [
    `#!${process.execPath}`,
    `import fs from 'node:fs';`,
    `const args = process.argv.slice(2);`,
    `const raw = fs.readFileSync(args[args.indexOf('--rule') + 1], 'utf8');`,
    `fs.appendFileSync(${JSON.stringify(f.launches)}, JSON.stringify({raw,args})+'\\n');`,
    `process.stdout.write(raw + '\\n'); process.stderr.write('diagnostic\\n'); process.exitCode=${status};`,
  ].join('\n'));
  const directory = path.join(f.scope.root, 'schedule');
  const schedule = createParserSchedule({ directory, workspace: f.scope.workspace, storage: f.storage, parser: f.parser });
  const recordedLaunches = () => fs.readFileSync(f.launches, 'utf8').trim().split('\n').map(row => JSON.parse(row));
  return { ...f, schedule, directory, recordedLaunches, documents };
}

it('schedules exact rule documents in their original order and reexecutes every parser request', () => {
  const f = scheduleFixture();
  for (const label of ['reference', 'repeat', 'native']) {
    const result = f.run(f.schedule.wrapper(label));
    expect(result.status).toBe(0);
    // No sorting by rule ID, or JSON parse/stringify rewriting rule/output bytes.
    expect(result.stdout.toString()).toBe(f.documents.join('\n') + '\n');
    expect(result.stderr.toString()).toBe('diagnostic\ndiagnostic\n');
  }
  const calls = f.recordedLaunches();
  expect(calls.map(c => c.raw)).toEqual([...f.documents, ...f.documents, ...f.documents]);
  for (const call of calls) {
    expect(call.args.slice(3)).toEqual(['--json=stream','--threads','1','--','a.ts','b.ts']);
    expect(fs.existsSync(call.args[2])).toBe(false); // temporary rules always reaped
  }
  expect(f.schedule.inspect()).toMatchObject({ replayedCalls:0, runs:[
    { label:'reference', calls:1, launches:2 }, { label:'repeat', calls:1, launches:2 }, { label:'native', calls:1, launches:2 },
  ] });
});

it('preserves parser failure bytes/status, stops further rules and counts only actual launches', () => {
  const f = scheduleFixture(7), result = f.run(f.schedule.wrapper('failure'));
  expect(result.status).toBe(7);
  expect(result.stdout.toString()).toBe(f.documents[0] + '\n');
  expect(result.stderr.toString()).toBe('diagnostic\n');
  expect(f.recordedLaunches()).toHaveLength(1);
  expect(f.schedule.inspect().runs[0]).toMatchObject({ calls:1, launches:1 });
});

it.each(['duplicate-id', 'yaml', 'severity', 'invalid-utf8', 'rule-cap', 'foreign-source', 'parser-drift'])(
  'rejects scheduled %s before executing or silently falling back', change => {
    const f = scheduleFixture();
    if (change === 'duplicate-id') fs.writeFileSync(f.rule, [f.documents[0], f.documents[0]].join('\n---\n'));
    if (change === 'yaml') fs.writeFileSync(f.rule, 'id: yaml\nlanguage: TypeScript\nrule: {pattern: a}\n');
    if (change === 'severity') fs.writeFileSync(f.rule, f.documents[0]!.replace('"id":', '"severity":"error","id":'));
    if (change === 'invalid-utf8') fs.writeFileSync(f.rule, Buffer.from([0xff]));
    if (change === 'rule-cap') fs.writeFileSync(f.rule, Array(257).fill(f.documents[0]).join('\n---\n'));
    if (change === 'parser-drift') fs.appendFileSync(f.parser, '\n//changed\n');
    const result = f.run(f.schedule.wrapper('reject'), change === 'foreign-source' ? [...f.args.slice(0,4), '../parser.mjs'] : f.args);
    expect(result.status).toBe(70);
    expect(fs.existsSync(f.launches)).toBe(false);
    expect(() => f.schedule.inspect()).toThrow('rejected');
  },
);

it('does not accept incomplete schedule claims or unbounded receipt counts', () => {
  const f = scheduleFixture(); expect(f.run(f.schedule.wrapper('reference')).status).toBe(0);
  const uses = path.join(f.directory, 'reference'), receipt = path.join(uses, fs.readdirSync(uses)[0]!);
  fs.writeFileSync(receipt, '{"complete":false}');
  expect(() => f.schedule.inspect()).toThrow('unsettled');
  for (let n = 0; n < 256; n++) fs.writeFileSync(path.join(uses, String(n)), '{}');
  expect(() => f.schedule.inspect()).toThrow('call limit');
});

it('serializes only source reads, preserves bytes/errors and drains/restores after a failed read', async () => {
  const scope = createScope(); scopes.push(scope.root);
  const original = fsp.readFile;
  const release: (() => void)[] = [];
  const stub = vi.spyOn(fsp, 'readFile').mockImplementation((file) => new Promise((resolve, reject) => {
    release.push(() => String(file).endsWith('bad.ts') ? reject(Error('fixture read failure')) : resolve(Buffer.from(String(file))));
  }));
  const queue = installSourceReadQueue(scope.workspace);
  try {
    const a = path.join(scope.workspace,'bad.ts'), b = path.join(scope.workspace,'b.ts');
    const first = fsp.readFile(a).catch(e => e.message); const second = fsp.readFile(b);
    await Promise.resolve(); expect(stub).toHaveBeenCalledTimes(1);
    release[0]!(); expect(await first).toBe('fixture read failure');
    await Promise.resolve(); expect(stub).toHaveBeenCalledTimes(2);
    release[1]!(); expect(await second).toEqual(Buffer.from(b)); expect(queue.count).toBe(2);
    const other = fsp.readFile(path.join(scope.home,'file'));
    expect(stub).toHaveBeenCalledTimes(3); release[2]!(); await other; expect(queue.count).toBe(2);
  } finally { await queue.restore(); stub.mockRestore(); syncBuiltinESMExports(); }
  expect(fsp.readFile).toBe(original);
});
