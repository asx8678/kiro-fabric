import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeCase, CASES, AUDIT, HELP_CODE, caseHashes } from '../scripts/steering-benchmark/cases.mjs';
import { canonical, checkScope, inventory, object, putFiles, readJson, save } from '../scripts/steering-benchmark/core.mjs';
import { analyzeEvents, collect, eventCollector } from '../scripts/steering-benchmark/stream.mjs';
import { validate, validateAnswer, validateAudit } from '../scripts/steering-benchmark/oracles.mjs';
import { syntheticEvents, solvedTrial, selftest } from '../scripts/steering-benchmark/selftest.mjs';
import { ARMS, artifact, budgetGate, createPlan, executable, parseConfig, profileSnapshot, schedule, verifyPlan } from '../scripts/steering-benchmark/plan.mjs';
import { commandFor, init, loadPlan, rows, runOne, summarizeRows } from '../scripts/steering-benchmark/runner.mjs';
import { main } from '../scripts/steering-benchmark.mjs';

type Trial = Awaited<ReturnType<typeof solvedTrial>>;
type Row = Parameters<typeof summarizeRows>[0][number];
let root: string;
let python: string;
const trials = new Map<string, Trial>();
const localProbe = async () => ({ exit: 0, stdout: '', stderr: '' });
const fresh = (name: string) => fs.mkdtempSync(path.join(root, name + '-'));
const update = (events: unknown[], i: number) => object(object(object(events[i]).data).update);
const completion = (events: unknown[]) => object(object(update(events, events.length - 2)._meta).kiro);
const charge = (index: number, credits: number | null = 0.1): Row => ({ index, credits, state: 'finished', stopReason: null, arm: 'native', caseId: 'explain', qualification: false, ok: true, startedAt: 'local' });

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'steering-vitest-'));
  python = executable('python3');
  for (const id of CASES) trials.set(id, await solvedTrial(root, id, python));
});
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

function present<T>(value: T | undefined): T { if (value === undefined) throw Error('Missing fixture value'); return value; }
function trial(id: string): Trial { const value = trials.get(id); if (!value) throw Error(id); return value; }
function cloneWorkspace(id: string): Trial {
  const base = trial(id), workspace = path.join(fresh('clone'), 'workspace');
  fs.cpSync(base.workspace, workspace, { recursive: true, preserveTimestamps: true });
  return { ...base, workspace };
}

describe('complete benign contract oracles', () => {
  it.each(CASES)('accepts solved %s including independent Python probes', async id => {
    expect(await validate(trial(id))).toMatchObject({ ok: true, failures: [] });
  });
  it.each(CASES)('rejects fenced output and missing usage in overall %s pass', async id => {
    const t = trial(id);
    expect((await validate({ ...t, probe: localProbe, evidence: { ...t.evidence, finalText: '```json\n' + t.evidence.finalText + '\n```' } })).ok).toBe(false);
    expect((await validate({ ...t, probe: localProbe, evidence: { ...t.evidence, credits: null } })).ok).toBe(false);
  });
  it.each(CASES)('rejects unrelated hidden filesystem effects for %s', async id => {
    const t = cloneWorkspace(id); fs.mkdirSync(path.join(t.workspace, '.kiro'), { mode: 0o700 });
    fs.writeFileSync(path.join(t.workspace, '.kiro', 'bypass'), 'bad');
    expect((await validate({ ...t, probe: localProbe })).failures.some(f => f.check === 'scope')).toBe(true);
  });
  it.each(['explain', 'json160', 'microcalc', 'github-advisory'])('requires zero calls for %s', async id => {
    const t = trial(id), evidence = analyzeEvents(syntheticEvents(t.evidence.finalText, { tools: true }));
    expect((await validate({ ...t, evidence })).failures.some(f => f.check === 'calls')).toBe(true);
  });
  it.each(['read24', 'range', 'target-edit', 'multi-edit', 'parser', 'rename-api', 'invoice', 'exit7', 'fabric-help'])('requires observed execution for %s', async id => {
    const t = trial(id);
    expect((await validate({ ...t, probe: localProbe, evidence: { ...t.evidence, calls: [] } })).ok).toBe(false);
  });
  it('retains contradictory tools-directly preamble only on exact JSON, and has clean no-tool calculation', () => {
    expect(trial('json160').spec.prompt).toContain('Use existing tools directly. Without using tools');
    expect(trial('microcalc').spec.prompt).not.toContain('Use existing tools directly');
    expect(trial('github-advisory').spec.prompt).toContain('No tools, no real Git or GitHub actions, no mocks');
  });
  it('makes future prose and rename byte contracts explicit instead of guessing semantics', () => {
    const explain = makeCase('explain', 'literal-contract');
    expect(explain.prompt).toContain('Return exactly this one-sentence explanation');
    expect(explain.prompt.endsWith(String(explain.expected))).toBe(true);
    expect(() => validateAnswer(explain, String(explain.expected), trial('explain').evidence)).not.toThrow();
    expect(() => validateAnswer(explain, ' ' + String(explain.expected), trial('explain').evidence)).toThrow('exact requested sentence');
    expect(makeCase('rename-api', 'literal-contract').prompt).toContain('preserve every other source byte');
    expect(makeCase('range', 'literal-contract').prompt).toContain('continuation only if requested content is missing');
  });
  it.each(['Tests do not verify behavior and catch regressions, but do not prove correctness.', 'Tests verify behavior and catch regressions and prove correctness.', 'Tests catch regressions.', 'Skip tests; behavior and regressions do not matter.'])('rejects bad explanation %s', answer => {
    expect(() => validateAnswer(trial('explain').spec, answer, trial('explain').evidence)).toThrow();
  });
  it.each(['json160', 'microcalc', 'read24', 'range', 'target-edit', 'multi-edit', 'parser', 'rename-api', 'invoice', 'exit7', 'github-advisory'])('rejects missing/wrong fields, prose, null, and incorrect data for %s', id => {
    const t = trial(id);
    for (const bad of ['', 'null', '{}', '[]', '{"extra":true}', 'Here is ' + t.evidence.finalText]) expect(() => validateAnswer(t.spec, bad, t.evidence)).toThrow();
    const value: unknown = JSON.parse(t.evidence.finalText);
    if (Array.isArray(value)) { value.pop(); expect(() => validateAnswer(t.spec, JSON.stringify(value), t.evidence)).toThrow(); }
    else { const wrong = { ...object(value), extra: 1 }; expect(() => validateAnswer(t.spec, JSON.stringify(wrong), t.evidence)).toThrow(); }
  });
  it('detects every first-line quirk and ranged-read boundary/long-line truncation', () => {
    const t = trial('read24'), expected = t.spec.expected as string[];
    expect(expected).toHaveLength(24); expect(expected[0]).toBe(''); expect(expected[1]).toBe('');
    expect(expected.some(v => v.startsWith('\t'))).toBe(true); expect(expected.some(v => v.includes('雪'))).toBe(true);
    expect(t.spec.files['records/record-03.txt']).toContain('\r\n'); expect(t.spec.files['records/record-23.txt']).not.toContain('\n');
    for (const answer of [[...expected].reverse(), expected.map(v => v.trim()), expected.map(v => v + '\r')]) expect(() => validateAnswer(t.spec, JSON.stringify(answer), t.evidence)).toThrow();
    const range = trial('range'), lines = range.spec.expected as string[];
    expect(present(lines[1]).length).toBeGreaterThan(9000);
    for (const answer of [lines.slice(1), lines.map(v => v.slice(0, 100)), ['BEFORE-NOT-REQUESTED', ...lines.slice(1)]]) expect(() => validateAnswer(range.spec, JSON.stringify(answer), range.evidence)).toThrow();
  });
  it.each(['target-edit', 'multi-edit', 'rename-api', 'invoice'])('rejects incorrect saved data for %s despite correct final JSON', async id => {
    const t = cloneWorkspace(id), name = present(Object.keys(t.spec.solution)[0]);
    fs.writeFileSync(path.join(t.workspace, name), id === 'invoice' ? '{"outstanding_by_customer":{"customer-0":1.2}}' : present(t.spec.files[name]));
    expect((await validate({ ...t, probe: localProbe })).failures.some(f => f.check === 'filesystem-data')).toBe(true);
  });
  it('rejects target decoy mutation and stale-snapshot multi-edit overwrite', async () => {
    const target = cloneWorkspace('target-edit'); const decoy = Object.keys(target.spec.files).find(n => !target.spec.allowed.includes(n))!;
    fs.writeFileSync(path.join(target.workspace, decoy), present(target.spec.files[decoy]).replace('"retryLimit": 3', '"retryLimit": 7'));
    expect((await validate(target)).ok).toBe(false);
    const multi = cloneWorkspace('multi-edit'); fs.writeFileSync(path.join(multi.workspace, 'service.conf'), present(multi.spec.files['service.conf']).replace('gamma=old', 'gamma=three'));
    expect((await validate(multi)).ok).toBe(false);
  });
  it('checks public symbol/callers and rejects alias retention', async () => {
    const t = cloneWorkspace('rename-api'); fs.appendFileSync(path.join(t.workspace, 'settings.py'), '\nload_config = read_config\n');
    expect((await validate({ ...t, probe: localProbe })).ok).toBe(false);
  });
  it('independent Python probes reject a behaviorally broken candidate even with asserted passing audit', async () => {
    const t = cloneWorkspace('parser'); fs.writeFileSync(path.join(t.workspace, 'durations.py'), 'def parse_duration(text): return 17\n');
    const result = await validate(t); expect(result.failures.some(f => f.check === 'independent-tests')).toBe(true);
  });
  it('fails process, Auto, and strict routing independently', async () => {
    const t = trial('read24');
    for (const evidence of [{ ...t.evidence, model: 'other' }, { ...t.evidence, mode: 'other' }, { ...t.evidence, calls: t.evidence.calls.map(c => ({ ...c, origin: 'native' })) }]) expect((await validate({ ...t, evidence })).ok).toBe(false);
    expect((await validate({ ...t, processOk: false })).ok).toBe(false);
  });
});

describe('actual fixture execution evidence, not command substrings', () => {
  it.each(['parser', 'rename-api', 'exit7'])('accepts actual hashed audit and rejects missing/duplicates/out-of-order/tampering for %s', id => {
    const t = trial(id), text = fs.readFileSync(path.join(t.workspace, AUDIT), 'utf8');
    const sources = Object.fromEntries(t.spec.sources.map(n => [n, fs.readFileSync(path.join(t.workspace, n), 'utf8')]));
    expect(validateAudit(t.spec, text, sources)).toHaveLength(id === 'parser' ? 2 : 1);
    const records: Record<string, unknown>[] = text.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
    const mutations = ['', text.trimEnd(), text + text, JSON.stringify({ ...records[0], seq: 5 }) + '\n', [...records].reverse().map(v => JSON.stringify({ ...v, kind: 'wrong' })).join('\n') + '\n'];
    for (const key of ['pre', 'post', 'fixtures', 'exit', 'seq', 'kind']) {
      const copy = structuredClone(records); delete present(copy[0])[key]; mutations.push(copy.map(v => JSON.stringify(v)).join('\n') + '\n');
      const changed = structuredClone(records); present(changed[0])[key] = key === 'exit' ? 42 : key === 'seq' ? 2 : key === 'kind' ? 'bad' : { tampered: 'hash' }; mutations.push(changed.map(v => JSON.stringify(v)).join('\n') + '\n');
    }
    if (id === 'parser') { mutations.push(records.slice(1).map(v => JSON.stringify(v)).join('\n') + '\n'); mutations.push([...records].reverse().map(v => JSON.stringify(v)).join('\n') + '\n'); }
    for (const bad of mutations) expect(() => validateAudit(t.spec, bad, sources)).toThrow();
  });
  it('accepts intentional failed native exit7 only with the exact execution audit', async () => {
    const t = trial('exit7'); const evidence = { ...t.evidence, mode: 'default', calls: t.evidence.calls.map(c => ({ ...c, status: 'failed', origin: 'native', title: 'shell' })) };
    expect((await validate({ ...t, evidence, arm: 'native', expectedMode: 'default' })).ok).toBe(true);
  });
  it('rejects malformed metadata without throwing away collected evidence', () => {
    const e = syntheticEvents('[]', { tools: true }); update(e, 1)._meta = 'malformed';
    expect(analyzeEvents(e).failures.length).toBeGreaterThan(0); expect(analyzeEvents(e).credits).toBe(0.1);
  });
  it('rejects mentioning, reading, or requesting exit7 without execution, and a second real execution', async () => {
    const t = cloneWorkspace('exit7'); fs.writeFileSync(path.join(t.workspace, AUDIT), '');
    const c = { ...present(t.evidence.calls[0]), input: { code: 'read tools/test_fixture.py; python3 -B tools/test_fixture.py' } };
    expect((await validate({ ...t, evidence: { ...t.evidence, calls: [c] } })).ok).toBe(false);
    for (let i = 0; i < 2; i++) await collect({ executable: python, args: ['-B', 'tools/test_fixture.py'], cwd: t.workspace, maxOutputBytes: 65536, timeoutMs: 10000 });
    expect((await validate(t)).failures.some(f => f.check === 'execution-audit')).toBe(true);
  });
  it('detects tampered immutable tests even when their audit claims new hashes', async () => {
    const t = cloneWorkspace('parser'); fs.appendFileSync(path.join(t.workspace, 'tools/test_fixture.py'), '\n# changed\n');
    expect((await validate({ ...t, probe: localProbe })).failures.some(f => f.check === 'scope')).toBe(true);
  });
});

describe('scope includes permissions, empty directories, symlinks and hidden artifacts', () => {
  it.each(['__pycache__', '.kiro', '.hidden'])('does not ignore %s', name => {
    const directory = fresh('scope'), before = inventory(directory); fs.mkdirSync(path.join(directory, name));
    expect(() => checkScope(before, inventory(directory), [])).toThrow();
  });
  it('rejects deletion, permission changes, symlink replacements, and unsafe allowed outputs', () => {
    for (const action of ['delete', 'mode', 'link']) {
      const directory = fresh('scope'); putFiles(directory, { file: 'unchanged' }); const before = inventory(directory);
      if (action === 'mode') fs.chmodSync(path.join(directory, 'file'), 0o644);
      else { fs.unlinkSync(path.join(directory, 'file')); if (action === 'link') fs.symlinkSync('absent', path.join(directory, 'file')); }
      expect(() => checkScope(before, inventory(directory), ['file'])).toThrow();
    }
    const directory = fresh('scope'), before = inventory(directory); fs.symlinkSync('absent', path.join(directory, 'output'));
    expect(() => checkScope(before, inventory(directory), ['output'])).toThrow();
  });
  it('bounds inventory and rejects relative path escapes', () => {
    const directory = fresh('scope'); putFiles(directory, { file: '12345' });
    expect(() => inventory(directory, { maxBytes: 1 })).toThrow(); expect(() => inventory(directory, { maxFiles: 1 })).toThrow();
    expect(() => putFiles(directory, { '../escape': 'bad' })).toThrow();
  });
});

describe('Fabric-only immutable help qualification', () => {
  it('requires exact code, one completed call and matching structured observed response', () => {
    const t = trial('fabric-help'); expect(() => validateAnswer(t.spec, t.evidence.finalText, t.evidence)).not.toThrow();
    for (const call of [ { ...present(t.evidence.calls[0]), input: { code: HELP_CODE + ' return 1;' } }, { ...present(t.evidence.calls[0]), status: 'failed' }, { ...present(t.evidence.calls[0]), output: 'not observed' } ]) expect(() => validateAnswer(t.spec, t.evidence.finalText, { ...t.evidence, calls: [call] })).toThrow();
    expect(() => validateAnswer(t.spec, t.evidence.finalText, { ...t.evidence, calls: [...t.evidence.calls, ...t.evidence.calls] })).toThrow();
    for (const answer of [{ topic: 'api', text: 'x', truncated: false }, { topic: 'overview', text: '', truncated: false }, { topic: 'overview', text: 'Some long immutable text here', truncated: true, nextOffset: 1 }]) expect(() => validateAnswer(t.spec, JSON.stringify(answer), t.evidence)).toThrow();
  });
  it('excludes help from all comparison totals and never penalizes native for absent help', () => {
    const all = [charge(0), { ...charge(1, 0.2), arm: 'pass2', caseId: 'fabric-help', qualification: true, ok: false }, { ...charge(2, 0.3), arm: 'pass2' }];
    const s = summarizeRows(all);
    expect(s.allExecuted.attempts).toBe(3); expect(s.allExecuted.reportedCredits).toBeCloseTo(0.6);
    expect(present(s.comparison.native).passes).toBe(1); expect(present(s.comparison.pass2).attempts).toBe(1);
    expect(present(s.fabricHelpQualification.pass2).failures).toHaveLength(1); expect(s.fabricHelpQualification).not.toHaveProperty('native');
  });
});

describe('ACP events and complete usage', () => {
  it('allows missing arguments only for Kiro automatic cloud bootstrap, not model calls', () => {
    const events = syntheticEvents('[]', { tools: true });
    const start = update(events, 1);
    start._meta = { kiro: { toolId: 'fetch_cloud_config' } };
    delete start.rawInput;
    const observed = analyzeEvents(events);
    expect(observed.failures).toEqual([]);
    expect(observed.calls[0]?.system).toBe(true);
    expect(observed.calls.filter(c => !c.system)).toHaveLength(0);
    start._meta = { kiro: { serverName: 'fabric' } };
    expect(analyzeEvents(events).failures).toContain('incomplete call evidence: call-1');
  });
  it('accepts fragmented-update evidence and retains all usage metadata', () => {
    const events = syntheticEvents('[]', { tools: true }); completion(events).otherUsage = { cache: 'unknown' };
    const evidence = analyzeEvents(events); expect(evidence.failures).toEqual([]); expect(evidence.credits).toBe(0.1); expect(evidence.events).toEqual(events); expect(evidence.calls).toHaveLength(1);
  });
  it.each(['missing-turn', 'missing-usage', 'empty-usage', 'bad-unit', 'negative', 'nan', 'string', 'duplicate-credit', 'duplicate-turn', 'missing-request', 'duplicate-request', 'missing-finish', 'duplicate-finish', 'failed-finish', 'missing-session', 'missing-config', 'orphan-update', 'duplicate-start', 'pending-call', 'missing-input', 'missing-output', 'late-update'])('rejects %s evidence', kind => {
    const e = syntheticEvents('[]', { tools: true }), turn = completion(e);
    if (kind === 'missing-turn') e.splice(e.length - 2, 1);
    if (kind === 'missing-usage') delete turn.promptTurnSummaries;
    if (kind === 'empty-usage') turn.promptTurnSummaries = [];
    if (kind === 'bad-unit') turn.promptTurnSummaries = [{ unit: 'tokens', usage: 2 }];
    if (kind === 'negative') turn.promptTurnSummaries = [{ unit: 'credit', usage: -1 }];
    if (kind === 'nan') turn.promptTurnSummaries = [{ unit: 'credit', usage: NaN }];
    if (kind === 'string') turn.promptTurnSummaries = [{ unit: 'credit', usage: '0.1' }];
    if (kind === 'duplicate-credit') turn.promptTurnSummaries = [{ unit: 'credit', usage: 0.1 }, { unit: 'credit', usage: 0.1 }];
    if (kind === 'duplicate-turn') e.splice(e.length - 1, 0, structuredClone(e[e.length - 2]));
    if (kind === 'missing-request') delete turn.requestIds;
    if (kind === 'duplicate-request') turn.requestIds = ['a', 'a'];
    if (kind === 'missing-finish') e.pop();
    if (kind === 'duplicate-finish') e.push(structuredClone(e[e.length - 1]));
    if (kind === 'failed-finish') object(object(e[e.length - 1]).data).status = 'failed';
    if (kind === 'missing-session') delete object(object(e[e.length - 1]).data).sessionId;
    if (kind === 'missing-config') e.shift();
    if (kind === 'orphan-update') e.splice(1, 1);
    if (kind === 'duplicate-start') e.splice(2, 0, structuredClone(e[1]));
    if (kind === 'pending-call') update(e, 2).status = 'in_progress';
    if (kind === 'missing-input') delete update(e, 1).rawInput;
    if (kind === 'missing-output') delete update(e, 2).rawOutput;
    if (kind === 'late-update') e.splice(3, 0, structuredClone(e[2]));
    expect(analyzeEvents(e).failures.length).toBeGreaterThan(0);
  });
  it('retains reported credit rows when other usage evidence is incomplete', () => {
    const events = syntheticEvents('[]'); delete completion(events).requestIds;
    const evidence = analyzeEvents(events); expect(evidence.credits).toBeNull(); expect(evidence.usage).toEqual([{ unit: 'credit', usage: 0.1 }]);
    const report = summarizeRows([{ ...charge(0, null), evidence, ok: false }]);
    expect(report.allExecuted.unreconciledCreditRows).toEqual([{ index: 0, usage: { unit: 'credit', usage: 0.1 } }]);
  });
  it('allows zero credits but never replaces missing usage with zero', () => {
    expect(analyzeEvents(syntheticEvents('[]', { credits: 0 })).credits).toBe(0);
    expect(analyzeEvents([]).credits).toBeNull();
    const s = summarizeRows([{ ...charge(0, null), state: 'started', ok: false }, charge(1, 0.3)]);
    expect(s.allExecuted).toMatchObject({ attempts: 2, unknownChargeAttempts: 1, reportedCredits: null, knownReportedCredits: 0.3 });
  });
  it('rejects malformed JSON and caps actual start events, not text mentions', () => {
    const stream = eventCollector(1); expect(stream.onLine('not-json')).toBe('malformed-stream-json');
    const capped = eventCollector(1), start = syntheticEvents('[]', { tools: true })[1];
    expect(capped.onLine(JSON.stringify(start))).toBeNull(); expect(capped.onLine(JSON.stringify(start))).toBe('tool-call-limit');
  });
});

describe('bounded process collection', () => {
  it.each(['stdout', 'stderr', 'both'])('caps retained and on-disk %s bytes combined', async mode => {
    const directory = fresh('collector'), stdoutPath = path.join(directory, 'out'), stderrPath = path.join(directory, 'err');
    const code = mode === 'both' ? 'process.stdout.write("a".repeat(700));process.stderr.write("b".repeat(700));setInterval(()=>{},1000)' : `process.${mode}.write("x".repeat(3000));setInterval(()=>{},1000)`;
    const r = await collect({ executable: process.execPath, args: ['-e', code], cwd: directory, stdoutPath, stderrPath, maxOutputBytes: 1024, timeoutMs: 3000, graceMs: 30 });
    expect(r.stopReason).toBe('combined-output-limit'); expect(r.retainedBytes).toBe(1024); expect(fs.statSync(stdoutPath).size + fs.statSync(stderrPath).size).toBe(1024);
  });
  it('kills a TERM-ignoring process group, drains, and honors wall time', async () => {
    const directory = fresh('collector');
    const childCode = 'process.on("SIGTERM",()=>{});console.log("CHILD:"+process.pid);setInterval(()=>{},1000)';
    const code = `const {spawn}=require("node:child_process");spawn(process.execPath,["-e",${JSON.stringify(childCode)}],{stdio:"inherit"});process.on("SIGTERM",()=>{});setInterval(()=>{},1000)`;
    const r = await collect({ executable: process.execPath, args: ['-e', code], cwd: directory, maxOutputBytes: 1024, timeoutMs: 250, graceMs: 30 });
    expect(r.stopReason).toBe('wall-time-limit'); expect(r.wallMs).toBeLessThan(2500);
    const pid = Number(r.stdout.match(/CHILD:(\d+)/)?.[1]); expect(pid).toBeGreaterThan(0);
    await new Promise(resolve => setTimeout(resolve, 50)); expect(() => process.kill(pid, 0)).toThrow();
  });
  it('preserves usage arriving on TERM and reports cancellation without retries', async () => {
    const directory = fresh('collector'), stream = eventCollector(40), abort = new AbortController();
    const events = syntheticEvents('[]');
    const code = `process.on('SIGTERM',()=>{console.log(${JSON.stringify(events.map(v => JSON.stringify(v)).join('\n'))});process.exit(0)});console.log('');setInterval(()=>{},1000)`;
    const timer = setTimeout(() => abort.abort(), 250);
    const result = await collect({ executable: process.execPath, args: ['-e', code], cwd: directory, maxOutputBytes: 65536, timeoutMs: 3000, graceMs: 50, signal: abort.signal, onLine: stream.onLine }); clearTimeout(timer);
    expect(result.stopReason).toBe('canceled'); expect(analyzeEvents(stream.events).credits).toBe(0.1);
  });
  it('preserves Unicode split across chunks and trailing unterminated JSON', async () => {
    const directory = fresh('collector'), stream = eventCollector(40), events = syntheticEvents('café 雪');
    const text = events.map(v => JSON.stringify(v)).join('\n');
    const code = `const b=Buffer.from(${JSON.stringify(text)});let i=0;const t=setInterval(()=>{if(i===b.length){clearInterval(t);return;}process.stdout.write(b.subarray(i,i+1));i++},1)`;
    const result = await collect({ executable: process.execPath, args: ['-e', code], cwd: directory, maxOutputBytes: 65536, timeoutMs: 5000, onLine: stream.onLine });
    expect(result.code).toBe(0); expect(analyzeEvents(stream.events).finalText).toBe('café 雪');
  });
  it('enforces live call caps and retains the overflowing event', async () => {
    const directory = fresh('collector'), stream = eventCollector(1), e = syntheticEvents('[]', { tools: true });
    const start = e[1]; const text = [start, start].map(v => JSON.stringify(v)).join('\n');
    const r = await collect({ executable: process.execPath, args: ['-e', `console.log(${JSON.stringify(text)});setInterval(()=>{},1000)`], cwd: directory, maxOutputBytes: 65536, timeoutMs: 3000, graceMs: 30, onLine: stream.onLine });
    expect(r.stopReason).toBe('tool-call-limit'); expect(stream.events).toHaveLength(2);
  });
  it('records spawn errors', async () => {
    const r = await collect({ executable: path.join(root, 'absent'), args: [], cwd: root, maxOutputBytes: 1000, timeoutMs: 1000 });
    expect(r.spawnError).toContain('ENOENT'); expect(r.code).not.toBe(0);
  });
});

function manifestFixture() {
  const directory = fresh('manifest'), configFile = path.join(directory, 'cli-config.json'); save(configFile, {});
  function makeArm(name: string): { profile: string; runtimePaths: [string]; configPaths: [string] } {
    const bundle = path.join(directory, name + '-bundle'), data = path.join(directory, name + '-data'); fs.mkdirSync(bundle); fs.mkdirSync(data);
    putFiles(bundle, { 'app/kiro/mcp-entry.js': 'export {};', 'tools/node': 'fixture-node', 'tools/rg': 'fixture-rg', 'resources/skills/fabric-exec/SKILL.md': 'fixture skill', 'resources/steering/fabric.md': 'fixture steering' });
    const profile = path.join(directory, name + '.json'), config = path.join(data, 'config.json'); save(config, {});
    save(profile, { name: 'kiro-fabric', includeMcpJson: false, includePowers: false, tools: ['@fabric/fabric_exec'], resources: [`skill://${bundle}/resources/skills/fabric-exec/SKILL.md`, `file://${bundle}/resources/steering/fabric.md`], mcpServers: { fabric: { command: bundle + '/tools/node', args: [bundle + '/app/kiro/mcp-entry.js'], waitForReady: true, env: { KIRO_FABRIC_BUNDLE_ROOT: bundle, KIRO_FABRIC_RUNTIME_ROOT: bundle + '/app', KIRO_FABRIC_EXPECTED_NODE: bundle + '/tools/node', KIRO_FABRIC_RG: bundle + '/tools/rg', KIRO_FABRIC_DATA_ROOT: data } } } });
    return { profile, runtimePaths: [bundle], configPaths: [config] };
  }
  const arms = { old: makeArm('old'), pass1: makeArm('pass1'), pass2: makeArm('pass2') };
  // Node --version is local. The fake CLI fixture is exclusively a disposable Node test, never Kiro.
  const value = { cli: process.execPath, python, runtimePaths: [configFile], cliConfigPaths: [configFile], arms, nativeMode: 'default' };
  const manifest = path.join(directory, 'manifest.json'); save(manifest, value);
  return { directory, manifest, value };
}

describe('portable plans, drift refusal and spend gates', () => {
  it('freezes all four arms, paired seeds, reverse/rotated order and excludes native help', () => {
    const f = manifestFixture(), plan = createPlan(f.manifest);
    expect(plan.runs.slice(-8).every(r => r.caseId === 'range')).toBe(true);
    expect(plan.runs.slice(0, -8).every(r => r.caseId !== 'range')).toBe(true);
    expect(plan.runs.map(r => r.index)).toEqual(Array.from({ length: 102 }, (_, i) => i));
    expect(plan.runs).toHaveLength(102); expect(plan.config.repetitions).toBe(2); expect(schedule(plan.config)).toEqual(plan.runs);
    for (const id of CASES) {
      const zero = plan.runs.filter(r => r.caseId === id && r.round === 0), one = plan.runs.filter(r => r.caseId === id && r.round === 1);
      expect(one.map(r => r.arm)).toEqual(zero.map(r => r.arm).reverse()); expect(new Set(zero.map(r => r.seed)).size).toBe(1); expect(present(zero[0]).seed).not.toBe(present(one[0]).seed);
      expect(new Set(zero.map(r => canonical(r.hashes))).size).toBe(1);
    }
    expect(plan.runs.some(r => r.arm === 'native' && r.qualification)).toBe(false);
    expect(() => verifyPlan(plan)).not.toThrow();
    const native = plan.runs.find(r => r.arm === 'native')!, fabric = plan.runs.find(r => r.arm === 'pass2')!;
    expect(commandFor(plan, native, root, 'benign').args).not.toContain('--agent');
    expect(commandFor(plan, native, root, 'benign').args).toContain('--trust-tools=fs_read,fs_write,shell');
    expect(commandFor(plan, fabric, root, 'benign').args.some(arg => arg.startsWith('--trust-tools'))).toBe(false);
    for (const item of [native, fabric]) { const args = commandFor(plan, item, root, 'benign').args; expect(args).toContain('auto'); expect(args).toContain('stream-json'); expect(args).not.toContain('--trust-all-tools'); }
    expect(ARMS).toEqual(['old', 'pass1', 'pass2', 'fabric', 'native']);
  });
  it('revalidates live CLI settings and fails closed on malformed or oversized projections', () => {
    const f = manifestFixture(), cli = path.join(f.directory, 'fake-cli.mjs'), settings = path.join(f.directory, 'live-settings.json');
    save(settings, {});
    fs.writeFileSync(cli, `#!${process.execPath}\nimport fs from 'node:fs'; process.stdout.write(fs.readFileSync(${JSON.stringify(settings)}, 'utf8'));\n`, { mode: 0o700 });
    save(f.manifest, { ...f.value, cli, snapshotCliSettings: true }, false);
    const plan = createPlan(f.manifest);
    expect(plan.identity.cliSettings).toEqual({}); expect(() => verifyPlan(plan)).not.toThrow();
    save(settings, { 'chat.changed': true }, false);
    expect(() => verifyPlan(plan)).toThrow(/drift/);
    fs.writeFileSync(settings, 'not JSON'); expect(() => createPlan(f.manifest)).toThrow();
    fs.writeFileSync(settings, 'x'.repeat(200000)); expect(() => createPlan(f.manifest)).toThrow('CLI settings snapshot failed');
  });
  it.each(['manifest', 'runtime', 'config', 'profile', 'plan'])('refuses %s drift', kind => {
    const f = manifestFixture(), plan = createPlan(f.manifest);
    if (kind === 'manifest') fs.appendFileSync(f.manifest, ' ');
    if (kind === 'runtime') fs.appendFileSync(path.join(f.value.arms.old.runtimePaths[0], 'tools/node'), 'change');
    if (kind === 'config') fs.appendFileSync(f.value.arms.pass1.configPaths[0], ' ');
    if (kind === 'profile') fs.appendFileSync(f.value.arms.pass2.profile, ' ');
    if (kind === 'plan') present(plan.runs[0]).hashes.prompt = 'changed';
    expect(() => verifyPlan(plan)).toThrow();
  });
  it('freezes alias target path, rejects mixed bundles and unisolated data roots', () => {
    const f = manifestFixture(), link = path.join(f.directory, 'alias'); fs.symlinkSync(f.value.arms.old.runtimePaths[0], link);
    const before = artifact(link); fs.unlinkSync(link); fs.symlinkSync(f.value.arms.pass1.runtimePaths[0], link); expect(artifact(link)).not.toEqual(before);
    const arm = f.value.arms.old, p = object(readJson(arm.profile)); object(object(p.mcpServers).fabric).command = '/wrong/node'; save(arm.profile, p, false);
    expect(() => profileSnapshot(arm)).toThrow();
  });
  it.each([{ repetitions: 1 }, { plannedCredits: 36 }, { creditCeiling: 41 }, { reserveCredits: 4 }, { maxCalls: 41 }, { timeoutMs: 150001 }, { maxOutputBytes: 9000000 }, { snapshotCliSettings: 'true' }])('rejects unsafe configuration %j', change => {
    const f = manifestFixture(); expect(() => parseConfig({ ...f.value, ...change }, f.directory)).toThrow();
  });
  it('hashes prompts, fixtures and oracle expectations separately', () => {
    const s = makeCase('read24', 'seed'), hashes = caseHashes(s);
    expect(caseHashes({ ...s, prompt: s.prompt + ' ' }).prompt).not.toBe(hashes.prompt);
    expect(caseHashes({ ...s, files: { ...s.files, extra: '' } }).fixtures).not.toBe(hashes.fixtures);
    expect(caseHashes({ ...s, expected: [] }).oracle).not.toBe(hashes.oracle);
  });
  it('stops on missing usage, incomplete attempts, >0.8, reserve, and first-eight projection', () => {
    const f = manifestFixture(), c = createPlan(f.manifest).config;
    expect(budgetGate(c, [], 102)).toEqual({ spent: 0, projected: null });
    for (const bad of [[charge(0, null)], [{ ...charge(0), state: 'started' }], [{ ...charge(0), stopReason: 'canceled' }], [charge(0, 0.80001)], [charge(0, -1)], [charge(0, NaN)]]) expect(() => budgetGate(c, bad, 102)).toThrow();
    expect(budgetGate(c, Array.from({ length: 7 }, (_, i) => charge(i, 0.4)), 102).projected).toBeNull();
    expect(() => budgetGate(c, Array.from({ length: 8 }, (_, i) => charge(i, 0.4)), 102)).toThrow(/projected/);
    expect(budgetGate(c, Array.from({ length: 8 }, (_, i) => charge(i, 0.18)), 102).projected).toBeCloseTo(18.36);
    expect(() => budgetGate({ ...c, plannedCredits: 1 }, [charge(0, 0.3)], 2)).toThrow(/credit/);
  });
  it('init is local/version-only, refuses overwrite and protects frozen plan', async () => {
    const f = manifestFixture(), output = path.join(f.directory, 'output');
    expect(await init(f.manifest, output)).toMatchObject({ runs: 102, liveRequests: 0 }); expect(rows(output)).toEqual([]);
    expect(loadPlan(output).config.cli).toBe(fs.realpathSync(process.execPath));
    await expect(init(f.manifest, output)).rejects.toThrow();
    const envelope = object(readJson(path.join(output, 'plan.json'))); object(envelope.plan).schemaVersion = 99; save(path.join(output, 'plan.json'), envelope, false);
    expect(() => loadPlan(output)).toThrow(/digest/);
  });
  it('supports a smaller frozen cohort and conversation-total prior credits', () => {
    const f = manifestFixture();
    const config = parseConfig({ ...f.value, arms: { pass2: f.value.arms.pass2 }, priorCredits: 13.512289, plannedCredits: 20, reserveCredits: 5 }, f.directory);
    expect(schedule(config)).toHaveLength(50); expect(new Set(schedule(config).map(r => r.arm))).toEqual(new Set(['pass2', 'native']));
    expect(budgetGate(config, [], 50).spent).toBe(0);
    expect(() => parseConfig({ ...f.value, priorCredits: 16, plannedCredits: 20, reserveCredits: 5 }, f.directory)).toThrow();
    expect(() => budgetGate({ ...config, priorCredits: 34.5 }, [], 50)).toThrow(/reserve/);
    const nativeOnly = parseConfig({ ...f.value, arms: {} }, f.directory); expect(schedule(nativeOnly)).toHaveLength(24);
  });
  it('refuses started/rerun/out-of-order and concurrent admissions before any spawn', async () => {
    const f = manifestFixture(), output = path.join(f.directory, 'output'); await init(f.manifest, output);
    await expect(runOne(output, 1)).rejects.toThrow(/reruns/);
    save(path.join(output, 'results/0000.json'), { ...charge(0, null), state: 'started', ok: false });
    await expect(runOne(output, 0)).rejects.toThrow(/reruns/); await expect(runOne(output, 1)).rejects.toThrow(/incomplete/);
    fs.mkdirSync(path.join(output, 'run.lock')); await expect(runOne(output)).rejects.toThrow(); expect(rows(output)).toHaveLength(1);
  });
  it('records a failed local CLI attempt and never retries or drops the row', async () => {
    const f = manifestFixture(), output = path.join(f.directory, 'output'); await init(f.manifest, output);
    // Node receives Kiro CLI args and fails locally; there is no inference/network executable.
    const result = await runOne(output, 0); expect(result).toMatchObject({ state: 'finished', ok: false, credits: null, stopReason: 'client-failure' });
    expect(rows(output)).toHaveLength(1); await expect(runOne(output, 0)).rejects.toThrow(/reruns/);
    expect(summarizeRows(rows(output)).allExecuted.unknownChargeAttempts).toBe(1);
  });
  it('exposes CLI help and rejects unknown/duplicate options without inference', async () => {
    expect(await main(['--help'])).toHaveProperty('usage'); await expect(main(['run', '--trust-all-tools', 'true'])).rejects.toThrow(); await expect(main(['plan', '--manifest', 'a', '--manifest', 'b'])).rejects.toThrow();
  });
  it('selftest qualifies all cases offline', async () => {
    expect(await selftest({ python })).toEqual({ oracleSelftest: 'PASS', positives: 13, negatives: 26, inferenceRequests: 0, syntheticEvidenceOnly: true });
  });
});
