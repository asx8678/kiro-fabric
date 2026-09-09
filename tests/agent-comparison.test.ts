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

describe('TinyShop independent bug contracts', () => {
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
    const expected = /, (\d+)\);/.exec(spec.files['tests/public.mjs']!)![1];
    await expect(probeProject(spec, { 'src/money.mjs': `export function totalCents(){return ${expected};}\n` })).rejects.toThrow('held-out project contract');
  });
  it('accepts behaviorally equivalent repairs and rejects unchanged code via real validation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bug-validation-'));
    try {
      const trial = await solvedTrial(root, 'bug-money', process.execPath);
      fs.appendFileSync(path.join(trial.workspace, 'src/money.mjs'), '\n// Equivalent implementation.\n');
      expect((await validate(trial)).ok).toBe(true);
      fs.writeFileSync(path.join(trial.workspace, 'src/money.mjs'), trial.spec.files['src/money.mjs']!);
      expect((await validate(trial)).failures.some(f => f.check === 'independent-tests')).toBe(true);
      fs.writeFileSync(path.join(trial.workspace, 'tests/public.mjs'), 'process.exit(0);');
      expect((await validate(trial)).failures.some(f => f.check === 'scope')).toBe(true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('preserves legacy defaults; pairs selected cases and validates selection', () => {
    expect(CASES).toHaveLength(13); expect(ALL_CASES).toHaveLength(23);
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
      await expect(main(['fixtures', '--out', output])).rejects.toThrow();
      for (const argv of [['run'], ['selftest', '--count', '1'], ['fixtures', '--out'], ['--help', 'extra']]) await expect(main(argv)).rejects.toThrow();
    } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  });
});
