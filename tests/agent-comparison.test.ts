import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUG_CASES, makeBugCase, probeProject, projectChecks } from '../scripts/steering-benchmark/projects.mjs';
import { ALL_CASES, CASES, makeCase, caseHashes } from '../scripts/steering-benchmark/cases.mjs';
import { detailedStats, comparisonMetrics, comparisonMarkdown, comparisonCsv } from '../scripts/steering-benchmark/metrics.mjs';
import { budgetGate, schedule, parseConfig } from '../scripts/steering-benchmark/plan.mjs';
import { commandFor } from '../scripts/steering-benchmark/runner.mjs';
import { validate } from '../scripts/steering-benchmark/oracles.mjs';
import { solvedTrial } from '../scripts/steering-benchmark/selftest.mjs';
import { main } from '../scripts/agent-comparison.mjs';

type Row = Parameters<typeof detailedStats>[0][number];
const row = (index: number, arm: string, ok: boolean, credits: number | null): Row => ({ index, arm, ok, credits, caseId: 'bug-money', qualification: false, state: 'finished', stopReason: null, startedAt: 'test' });

import { TASK_BEHAVIOR_CASES } from '../scripts/steering-benchmark/task-behavior.mjs';

describe('opt-in task scheduling', () => {
  it('selects balanced old/fabric pairs using existing runIndices', () => {
    const arm = { profile: '/unused', runtimePaths: ['/unused'], configPaths: ['/unused'] };
    const base = { cli: process.execPath, python: process.execPath, runtimePaths: [process.execPath], cliConfigPaths: [process.execPath], arms: { old: arm, fabric: arm }, repetitions: 2 };
    expect(schedule(parseConfig(base, process.cwd())).some(r => TASK_BEHAVIOR_CASES.includes(r.caseId))).toBe(false);
    const config = parseConfig({ ...base, cases: TASK_BEHAVIOR_CASES }, process.cwd());
    const full = schedule(config);
    const runIndices = full.filter(r => r.arm !== 'native').map(r => r.index);
    const selected = schedule(parseConfig({ ...base, cases: TASK_BEHAVIOR_CASES, runIndices }, process.cwd()));
    expect(selected).toHaveLength(20);
    expect(selected.map(r => r.sourceIndex)).toEqual(runIndices);
    for (const id of TASK_BEHAVIOR_CASES) {
      expect(ALL_CASES).toContain(id); expect(CASES).not.toContain(id);
      const first = selected.filter(r => r.caseId === id && r.round === 0);
      const second = selected.filter(r => r.caseId === id && r.round === 1);
      expect(first.map(r => r.arm)).toEqual(second.map(r => r.arm).reverse());
      for (const pair of [first, second]) {
        expect(new Set(pair.map(r => r.arm))).toEqual(new Set(['old', 'fabric']));
        expect(pair[0]!.hashes).toEqual(pair[1]!.hashes);
        expect(pair[0]!.seed).toBe(pair[1]!.seed);
      }
    }
  });
});

describe('TinyShop independent bug contracts', () => {
  it('counterbalances Default, old Fabric and the candidate on identical Auto repair/review cases', () => {
    const arm = { profile: '/unused', runtimePaths: ['/unused'], configPaths: ['/unused'] };
    const config = parseConfig({
      cli: process.execPath, python: process.execPath, runtimePaths: [process.execPath], cliConfigPaths: [process.execPath],
      arms: { old: arm, fabric: arm }, cases: ['bug-config', 'review-boundaries'], model: 'auto', repetitions: 2,
    }, process.cwd());
    const plan = { config } as Parameters<typeof commandFor>[0];
    const runs = schedule(config);
    expect(runs).toHaveLength(12);
    for (const caseId of config.cases!) {
      const first = runs.filter(r => r.caseId === caseId && r.round === 0);
      const second = runs.filter(r => r.caseId === caseId && r.round === 1);
      expect(first.map(r => r.arm)).toEqual(second.map(r => r.arm).reverse());
      for (const group of [first, second]) {
        expect(new Set(group.map(r => r.arm))).toEqual(new Set(['native', 'old', 'fabric']));
        for (const run of group) {
          expect(run.hashes).toEqual(group[0]!.hashes);
          expect(run.seed).toBe(group[0]!.seed);
          const args = commandFor(plan, run, '/tmp', 'same prompt').args;
          expect(args[args.indexOf('--model') + 1]).toBe('auto');
          expect(args).not.toContain('--effort');
        }
      }
    }
  });

  it.each(BUG_CASES)('%s: rejects original and accepts reference for two seeds', async id => {
    for (const seed of ['alpha', 'beta']) {
      const spec = makeBugCase(id, seed);
      expect(makeCase(id, seed)).toEqual(spec);
      await expect(probeProject(spec, {})).rejects.toThrow('public project contract');
      expect((await probeProject(spec, spec.solution)).ok).toBe(true);
      expect(spec.files).not.toHaveProperty('tests/held-out.mjs');
      expect(projectChecks(id, seed, true)).not.toBe(spec.files['tests/public.mjs']);
    }
  });
  it('rejects a public-example-only patch with held-out checks', async () => {
    const spec = makeBugCase('bug-money', 'alpha');
    const expected = /, (\d+)\);/.exec(spec.files['tests/checks.mjs']!)![1];
    await expect(probeProject(spec, { 'src/money.mjs': `export function totalCents(){return ${expected};}\n` })).rejects.toThrow('held-out project contract');
  });
  it('accepts behaviorally equivalent repairs and rejects unchanged code via real validation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bug-validation-'));
    try {
      const trial = await solvedTrial(root, 'bug-money', process.execPath);
      fs.appendFileSync(path.join(trial.workspace, 'src/money.mjs'), '\n// Equivalent implementation.\n');
      const equivalent = await validate(trial);
      expect(equivalent.probe).toMatchObject({ ok: true });
      expect(equivalent.failures.map(f => f.check)).toEqual(['execution-audit']); // Changed bytes require a fresh agent test run.
      fs.writeFileSync(path.join(trial.workspace, 'src/money.mjs'), trial.spec.files['src/money.mjs']!);
      expect((await validate(trial)).failures.some(f => f.check === 'independent-tests')).toBe(true);
      fs.writeFileSync(path.join(trial.workspace, 'tests/public.mjs'), 'process.exit(0);');
      expect((await validate(trial)).failures.some(f => f.check === 'scope')).toBe(true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('preserves legacy defaults; pairs selected cases and validates selection', () => {
    expect(CASES).toHaveLength(13); expect(ALL_CASES).toHaveLength(35);
    const base = { cli: process.execPath, python: process.execPath, arms: {}, runtimePaths: [process.execPath], cliConfigPaths: [process.execPath], cases: BUG_CASES, model: 'test-model' };
    const config = parseConfig({ ...base, nativeTrustTools: ['fs_read', 'fs_write', 'str_replace', 'execute_bash'] }, process.cwd());
    const fakePlan = { config } as Parameters<typeof commandFor>[0];
    expect(commandFor(fakePlan, { arm: 'native' } as Parameters<typeof commandFor>[1], '/tmp', 'test').args).toContain('--trust-tools=fs_read,fs_write,str_replace,execute_bash');
    expect(commandFor(fakePlan, { arm: 'native' } as Parameters<typeof commandFor>[1], '/tmp', 'test').args).toContain('test-model');
    for (const nativeTrustTools of [[], ['*'], ['network'], ['fs_read', 'fs_read']]) expect(() => parseConfig({ ...base, nativeTrustTools }, process.cwd())).toThrow();
    config.arms.fabric = { profile: '/unused', runtimePaths: ['/unused'], configPaths: ['/unused'] };
    const runs = schedule(config);
    expect(runs).toHaveLength(36);
    const selected = schedule({ ...config, runIndices: [2, 3, 30, 31] });
    expect(selected.map(r => r.sourceIndex)).toEqual([2, 3, 30, 31]);
    selected.forEach((r, i) => expect({ ...r, index: r.sourceIndex, sourceIndex: undefined }).toMatchObject({ ...runs[[2,3,30,31][i]!]!, sourceIndex: undefined }));
    expect(() => schedule({ ...config, runIndices: [36] })).toThrow('outside schedule');
    for (const runIndices of [[], [1,1], [2,1], [-1], [1.5]]) expect(() => parseConfig({ ...base, runIndices }, process.cwd())).toThrow();
    const raised = parseConfig({ ...base, singleRunCreditLimit: 2 }, process.cwd());
    expect(raised.singleRunCreditLimit).toBe(2);
    expect(() => budgetGate(raised, [row(0, 'fabric', true, 1.5)], 54)).not.toThrow();
    expect(() => budgetGate(raised, [row(0, 'fabric', true, 2.1)], 54)).toThrow('single-run credits above limit');
    expect(() => parseConfig({ ...base, singleRunCreditLimit: 6 }, process.cwd())).toThrow();
    for (const id of BUG_CASES) {
      const a = runs.filter(r => r.caseId === id && r.round === 0), b = runs.filter(r => r.caseId === id && r.round === 1);
      expect(a.map(r => r.arm)).toEqual(b.map(r => r.arm).reverse());
      expect(a[0]!.hashes).toEqual(a[1]!.hashes);
      expect(a[0]!.hashes).toEqual(caseHashes(makeCase(id, a[0]!.seed)));
    }
    for (const cases of [[], ['missing'], ['bug-money', 'bug-money']]) expect(() => parseConfig({ ...base, cases }, process.cwd())).toThrow();
  });
});

describe('quality-first, coverage-aware statistics', () => {
  it('reports guidance modes without requiring historical identity metadata and validates Fabric-only pairs', () => {
    const arm = { profile: '/unused', runtimePaths: ['/unused'], configPaths: ['/unused'] };
    const config = parseConfig({ cli: process.execPath, python: process.execPath, runtimePaths: [process.execPath], cliConfigPaths: [process.execPath], arms: { old: arm, pass1: arm, pass2: arm }, cases: ['bug-money'] }, process.cwd());
    const runs = schedule(config).filter(r => r.arm !== 'native').map((r, index) => ({ ...r, index }));
    const plan = { config, runs, limitations: [] } as unknown as Parameters<typeof comparisonMetrics>[0];
    expect(comparisonMetrics(plan, []).guidanceModes).toEqual({ old: 'unknown', pass1: 'unknown', pass2: 'unknown' });
    const identity = { profiles: { old: { guidanceMode: 'standard' }, pass1: { guidanceMode: 'review' }, pass2: { guidanceMode: 'minimal' } } } as unknown as typeof plan.identity;
    const report = comparisonMetrics({ ...plan, identity }, []);
    expect(report.guidanceModes).toEqual({ old: 'standard', pass1: 'review', pass2: 'minimal' });
    expect(comparisonMarkdown(report)).toContain('old=standard, pass1=review, pass2=minimal');
    expect(report.executedAttempts).toBe(0);
    expect(() => comparisonMetrics({ ...plan, runs: runs.map(r => r.arm === 'pass1' ? { ...r, seed: 'drift' } : r) }, [])).toThrow('unmatched fixture identities');
  });
  it('pairs old/candidate outer exchanges without inventing hidden telemetry or rewarding failures', () => {
    const arm = { profile: '/unused', runtimePaths: ['/unused'], configPaths: ['/unused'] };
    const config = parseConfig({ cli: process.execPath, python: process.execPath, runtimePaths: [process.execPath], cliConfigPaths: [process.execPath], arms: { old: arm, fabric: arm }, cases: ['bug-money'] }, process.cwd());
    const plan = { config, runs: schedule(config), limitations: [] } as unknown as Parameters<typeof comparisonMetrics>[0];
    const rows = plan.runs.filter(r => r.round === 0).map(r => ({ ...row(r.index, r.arm, true, 0.2), evidence: {
      failures: [], events: [], usage: [], credits: 0.2, finalText: '', mode: null, model: null, requestIds: [], sessionId: null,
      calls: Array.from({ length: r.arm === 'old' ? 5 : 3 }, (_, i) => ({ id: String(i), input: {}, output: {}, title: '', origin: '', status: i === 1 ? 'failed' : 'completed', system: i === 0 })),
    } }));
    const pair = (values: Row[]) => comparisonMetrics(plan, values).oldFabricOuterCallPairs[0]!;
    expect(pair(rows)).toMatchObject({ bothPass: true, oldOuterToolCalls: 4, candidateOuterToolCalls: 2, bothPassOuterCallDelta: -2, bothPassOuterCallReduction: 0.5 });
    expect(comparisonMetrics(plan, rows).oldFabricOuterCallPairs[1]).toMatchObject({ completed: false, oldOuterToolCalls: null, candidateOuterToolCalls: null, bothPassOuterCallDelta: null });
    const change = (patch: Partial<Row>) => rows.map(r => r.arm === 'fabric' ? { ...r, ...patch } : r);
    const missingEvidence = rows.map(r => { const copy: Row = { ...r }; if (r.arm === 'fabric') delete copy.evidence; return copy; });
    expect(pair(missingEvidence)).toMatchObject({ candidateOuterToolCalls: null, bothPassOuterCallReduction: null });
    expect(comparisonMarkdown(comparisonMetrics(plan, rows))).toContain('| bug-money | 0 | 4 | 2 | -2 | 0.5 |');
    expect(comparisonMarkdown(comparisonMetrics(plan, missingEvidence))).toContain('| bug-money | 0 | 4 | unknown | unknown | unknown |');
    const evidence = rows.find(r => r.arm === 'fabric')!.evidence;
    expect(pair(change({ evidence: { ...evidence, failures: ['incomplete call'] } }))).toMatchObject({ candidateOuterToolCalls: null, bothPassOuterCallDelta: null });
    expect(pair(change({ ok: false, stopReason: 'timeout' }))).toMatchObject({ candidateOuterToolCalls: 2, candidatePass: false, candidateStopReason: 'timeout', bothPassOuterCallDelta: null });
    expect(pair(change({ state: 'started' }))).toMatchObject({ completed: false, bothPassOuterCallReduction: null });
    expect(pair(change({ evidence: { ...evidence, calls: [] } }))).toMatchObject({ bothPassOuterCallDelta: -4, bothPassOuterCallReduction: 1 });
    expect(pair(rows.map(r => ({ ...r, evidence: { ...r.evidence, calls: [] } })))).toMatchObject({ bothPassOuterCallDelta: 0, bothPassOuterCallReduction: null });
    expect(pair(rows.map(r => ({ ...r, evidence: { ...r.evidence, calls: r.arm === 'fabric' ? rows.find(x => x.arm === 'old')!.evidence.calls : evidence.calls } })))).toMatchObject({ bothPassOuterCallDelta: 2, bothPassOuterCallReduction: -1 });
    expect(detailedStats(rows)).toMatchObject({ innerEffects: null, inputTokens: null, outputTokens: null, cachedTokens: null });
    const runIndices = plan.runs.filter(r => r.arm === 'native' || (r.round === 0 && r.arm === 'fabric') || (r.round === 1 && r.arm === 'old')).map(r => r.index);
    const partial = { ...plan, runs: schedule({ ...config, runIndices }) };
    const partialRows = partial.runs.map(r => ({ ...row(r.index, r.arm, true, 0.2), evidence }));
    expect(comparisonMetrics(partial, partialRows).oldFabricOuterCallPairs).toMatchObject([{
      oldIndex: null, candidateIndex: expect.any(Number), completed: false, oldOuterToolCalls: null,
      candidateOuterToolCalls: 2, bothPassOuterCallDelta: null, bothPassOuterCallReduction: null,
    }]);
    const drift = { ...plan, runs: plan.runs.map(r => r.arm === 'old' ? { ...r, seed: 'drift' } : r) };
    expect(() => comparisonMetrics(drift, rows)).toThrow('unmatched');
  });
  it.each(['fabric-only', 'mixed', 'native-only'])('reports unavailable native ratios for a %s continuation without dropping costs', mode => {
    const arm = { profile: '/unused', runtimePaths: ['/unused'], configPaths: ['/unused'] };
    const base = { cli: process.execPath, python: process.execPath, runtimePaths: [process.execPath], cliConfigPaths: [process.execPath], arms: { old: arm, fabric: arm }, cases: ['bug-money'] };
    const full = schedule(parseConfig(base, process.cwd()));
    const runIndices = full.filter(r => mode === 'native-only' ? r.arm === 'native' : mode === 'fabric-only' ? r.arm !== 'native' : r.arm !== 'native' || r.round === 0).map(r => r.index);
    const config = parseConfig({ ...base, runIndices }, process.cwd());
    const plan = { config, runs: schedule(config), limitations: [] } as unknown as Parameters<typeof comparisonMetrics>[0];
    const rows = plan.runs.map(r => row(r.index, r.arm, r.round === 0, 0.2));
    const report = comparisonMetrics(plan, rows);
    expect(report.allAttempts).toMatchObject({ attempts: rows.length, reportedCredits: expect.closeTo(rows.length * 0.2) });
    expect(report.unrunAttempts).toBe(0);
    for (const pair of report.pairs) {
      if (mode === 'mixed' && pair.round === 0) expect(pair).toMatchObject({ completed: true, bothPassCreditRatio: 1 });
      else expect(pair).toMatchObject({ completed: false, bothPass: false, nativePass: null, nativeCredits: null, fabricCredits: 0.2, bothPassCreditRatio: null, bothPassWallRatio: null });
    }
    expect(report.pairs).toHaveLength(mode === 'native-only' ? 0 : 4);
    expect(comparisonMarkdown(report)).toContain(`${rows.length}/${rows.length} attempts`);
    expect(comparisonCsv(plan, rows).trim().split('\n')).toHaveLength(rows.length + 1);
  });
  it.each(['seed', 'prompt', 'fixtures', 'oracle'])('rejects a present native counterpart with mismatched %s identity', field => {
    const arm = { profile: '/unused', runtimePaths: ['/unused'], configPaths: ['/unused'] };
    const config = parseConfig({ cli: process.execPath, python: process.execPath, runtimePaths: [process.execPath], cliConfigPaths: [process.execPath], arms: { fabric: arm }, cases: ['bug-money'] }, process.cwd());
    const runs = schedule(config).map(r => r.arm !== 'native' ? r : field === 'seed' ? { ...r, seed: 'drift' } : { ...r, hashes: { ...r.hashes, [field]: 'drift' } });
    const plan = { config, runs, limitations: [] } as unknown as Parameters<typeof comparisonMetrics>[0];
    // Identity validation must not depend on whether either attempt has run yet.
    expect(() => comparisonMetrics(plan, [])).toThrow('unmatched fixture identities');
  });
  it('includes failures in cost per success and never imputes missing telemetry', () => {
    const stats = detailedStats([row(0, 'fabric', true, 0.2), row(1, 'fabric', false, 0.4)]);
    expect(stats.reportedCredits).toBeCloseTo(0.6); expect(stats.creditsPerSuccess).toBeCloseTo(0.6);
    expect(stats.successRate).toBe(0.5); expect(stats.wallMs).toBeNull(); expect(stats.outerToolCalls).toBeNull();
    expect(stats.inputTokens).toBeNull(); expect(stats.settledCurrencyCost).toBeNull();
    expect(detailedStats([row(0, 'fabric', true, null)]).creditsPerSuccess).toBeNull();
    expect(detailedStats([]).medianWallMs).toBeNull();
    const repaired = { ...row(0, 'fabric', false, 0.2), validation: { ok: false, failures: [{ check: 'answer', error: 'prose' }], probe: { ok: true }, audit: null, afterDigest: 'hash' } };
    expect(detailedStats([repaired]).projectBehavior).toMatchObject({ passes: 1, creditsPerRepair: 0.2 });
    expect(detailedStats([repaired]).passes).toBe(0);
    expect(detailedStats([{ ...repaired, stopReason: 'scope-failure' }]).projectBehavior.passes).toBe(0);
  });
  it('compares matching cells, separates help, and refuses mismatched observations', () => {
    const config = parseConfig({ cli: process.execPath, python: process.execPath, runtimePaths: [process.execPath], cliConfigPaths: [process.execPath], arms: {}, cases: ['bug-money'] }, process.cwd());
    config.arms.fabric = { profile: '/unused', runtimePaths: ['/unused'], configPaths: ['/unused'] };
    const plan = { config, runs: schedule(config), limitations: [] } as unknown as Parameters<typeof comparisonMetrics>[0];
    const rows = plan.runs.slice(0, 2).map(r => row(r.index, r.arm, true, r.arm === 'native' ? 0.4 : 0.2));
    const report = comparisonMetrics(plan, rows);
    expect(report.pairs[0]!.bothPassCreditRatio).toBe(0.5);
    expect(report.pairs[1]!.completed).toBe(false); expect(report.unrunAttempts).toBe(2);
    expect(comparisonMarkdown(report)).toContain('2/4 attempts'); expect(comparisonCsv(plan, rows)).toContain('bug-money');
    expect(() => comparisonMetrics(plan, [...rows, rows[0]!])).toThrow('duplicate');
    expect(() => comparisonMetrics(plan, [{ ...rows[0]!, caseId: 'different' }])).toThrow('mismatch');
  });
});

describe('offline example export', () => {
  it('exports only buggy projects; refuses overwrite and paid/unrecognized commands', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'bug-export-')), output = path.join(parent, 'lab');
    try {
      const result = await main(['fixtures', '--out', output]);
      expect(result).toMatchObject({ inferenceRequests: 0 });
      expect(fs.existsSync(path.join(output, 'bug-checkout/src/money.mjs'))).toBe(true);
      expect(fs.existsSync(path.join(output, 'bug-checkout/tests/held-out.mjs'))).toBe(false);
      expect(fs.existsSync(path.join(output, 'review-infra/README.md'))).toBe(true);
      expect(fs.readdirSync(path.join(output, 'review-infra/.azure-pipelines')).some(p => p.startsWith('maintenance-'))).toBe(true);
      expect(fs.existsSync(path.join(output, 'review-infra/oracle.json'))).toBe(false);
      expect(fs.existsSync(path.join(output, 'review-contracts/scripts/check.mjs'))).toBe(true);
      expect(fs.readdirSync(path.join(output, 'review-contracts/.ci')).some(p => p.startsWith('maintenance-'))).toBe(true);
      expect(fs.existsSync(path.join(output, 'review-contracts/oracle.json'))).toBe(false);
      expect(fs.existsSync(path.join(output, 'review-boundaries/.ci/verify.json'))).toBe(true);
      expect(fs.existsSync(path.join(output, 'review-boundaries/oracle.json'))).toBe(false);
      for (const family of ['review-regressions-seeded', 'review-regressions-heldout']) {
        expect(fs.existsSync(path.join(output, family, 'src/job.ts'))).toBe(true);
        expect(fs.existsSync(path.join(output, family, 'oracle.json'))).toBe(false);
        expect(fs.existsSync(path.join(output, family, 'reviewOracle'))).toBe(false);
      }
      expect(result).toMatchObject({ fixtureVersion: 'tinyshop-and-review-v6' });
      await expect(main(['fixtures', '--out', output])).rejects.toThrow();
      for (const argv of [['run'], ['selftest', '--count', '1'], ['fixtures', '--out'], ['--help', 'extra']]) await expect(main(argv)).rejects.toThrow();
    } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  });
});
