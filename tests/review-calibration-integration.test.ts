import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_CASES, CASES, caseHashes, makeCase } from '../scripts/steering-benchmark/cases.mjs';
import { REVIEW_CASES, probeReviewFixture, scoreReview } from '../scripts/steering-benchmark/reviews.mjs';
import { REVIEW_CALIBRATION_SCHEMA } from '../scripts/steering-benchmark/review-calibration.mjs';
import { validate } from '../scripts/steering-benchmark/oracles.mjs';
import { solvedTrial } from '../scripts/steering-benchmark/selftest.mjs';
import { comparisonMarkdown, comparisonMetrics, detailedStats } from '../scripts/steering-benchmark/metrics.mjs';
import { parseConfig, schedule } from '../scripts/steering-benchmark/plan.mjs';

type Assessment = { kind: string; disposition: string; severity: string | null; consequence: string; evidence: { path: string; line: number; text: string }[]; proof: string; counterexample: string; recommendation: string };
type Answer = { schema: string; findings: Assessment[] };
type Controller = { rubric: Record<string, string>; assessments: Assessment[] };
type Row = Parameters<typeof detailedStats>[0][number];
const spec = () => makeCase('review-calibration', 'integration');
const answer = (s = spec()) => structuredClone(s.expected) as Answer;
const row = (review: ReturnType<typeof scoreReview>, caseId = 'review-calibration'): Row => ({ index: 0, arm: 'fabric', caseId, qualification: false, state: 'finished', startedAt: 'test', stopReason: null, credits: 0.4,
  ok: review.recall === 1 && review.falsePositives === 0 && !review.calibration?.violations,
  validation: { ok: true, failures: review.calibration?.violations ? [{ check: 'answer', error: 'calibration' }] : [], review, audit: null, probe: null, afterDigest: 'hash' } });

describe('calibration admission and comparison integration (synthetic evidence)', () => {
  it('registers opt-in calibration and independently qualifies the actual fixture', async () => {
    const s = spec();
    expect(REVIEW_CASES).toContain(s.id);
    expect(ALL_CASES).toContain(s.id);
    expect(CASES).not.toContain(s.id);
    expect(Object.keys(s.expected as object).sort()).toEqual(['findings', 'schema']);
    expect(s.allowed).toEqual([]);
    expect(s.solution).toEqual({});
    expect((await probeReviewFixture(s)).ok).toBe(true);
    expect(scoreReview(s, s.expected)).toMatchObject({ expected: 3, truePositives: 3, falsePositives: 0,
      calibration: { version: REVIEW_CALIBRATION_SCHEMA, validatedFindings: 3, validatedRecall: 1, violations: 0, manualAdjudicationRequired: true } });
  });

  it('hash-binds private severity policy without changing the neutral prompt or fixture bytes', () => {
    const s = spec(), changed = structuredClone(s);
    (changed.reviewOracle as Controller).rubric.low += ' changed policy';
    expect(caseHashes(changed)).toMatchObject({ prompt: caseHashes(s).prompt, fixtures: caseHashes(s).fixtures });
    expect(caseHashes(changed).oracle).not.toBe(caseHashes(s).oracle);
    expect(answer(s)).not.toHaveProperty('controller');
  });

  it('fails calibration even with complete recall, and still enforces review-only scope', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'calibration-admission-'));
    try {
      const trial = await solvedTrial(root, 'review-calibration', process.execPath);
      expect((await validate(trial)).ok).toBe(true);
      const a = answer(trial.spec);
      const control = structuredClone((trial.spec.reviewOracle as Controller).assessments.find(f => f.kind === 'disabled-cleanup')!);
      control.counterexample = 'none';
      a.findings.push(control);
      const rejected = await validate({ ...trial, evidence: { ...trial.evidence, finalText: JSON.stringify(a) } });
      expect(rejected).toMatchObject({ ok: false, review: { recall: 1, falsePositives: 0, calibration: { violations: 1 } } });
      expect(rejected.failures).toEqual([{ check: 'answer', error: expect.stringContaining('severity/calibration') }]);
      fs.writeFileSync(path.join(trial.workspace, 'unrequested.txt'), 'review must not edit');
      expect((await validate(trial)).failures.some(f => f.check === 'scope')).toBe(true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('does not reward inflated severity, unsafe fixes, or an omitted substantial defect', () => {
    const s = spec();
    for (const mutate of [
      (a: Answer) => { a.findings.find(f => f.kind === 'unnecessary-save')!.severity = 'critical'; },
      (a: Answer) => { a.findings.find(f => f.kind === 'masked-validation-exit')!.recommendation = 'disable-validation'; },
      (a: Answer) => { a.findings = a.findings.filter(f => f.kind !== 'protected-artifact-deletion'); },
    ]) {
      const a = answer(s); mutate(a);
      const score = scoreReview(s, a);
      expect(score.calibration!.validatedFindings).toBe(2);
      expect(score.calibration!.validatedRecall).toBeCloseTo(2 / 3);
      expect(row(score).ok).toBe(false);
    }
    const empty = scoreReview(s, { schema: REVIEW_CALIBRATION_SCHEMA, findings: [] });
    expect(detailedStats([row(empty)]).reviewQuality.calibration).toMatchObject({ validatedFindings: 0, validatedRecall: 0, substantialRecall: 0, creditsPerValidatedFinding: null });
  });

  it('preserves failed-attempt costs, unknown historical/unsafe scores, and quality-first reporting', () => {
    const s = spec(), good = scoreReview(s, s.expected), a = answer(s);
    a.findings.find(f => f.kind === 'unnecessary-save')!.severity = 'critical';
    const bad = scoreReview(s, a);
    expect(detailedStats([row(good), row(bad)]).reviewQuality.calibration).toMatchObject({ eligibleAttempts: 2, scoredAttempts: 2, validatedFindings: 5, expectedFindings: 6, severityInflations: 1, violations: 1, reportedCredits: 0.8, creditsPerValidatedFinding: 0.16 });
    const unsafe = row(good); unsafe.validation!.failures.push({ check: 'scope', error: 'modified' });
    expect(detailedStats([row(good), unsafe]).reviewQuality.calibration).toMatchObject({ scoredAttempts: 1, validatedFindings: null, violations: null, missedSubstantial: null });
    const legacy = makeCase('review-evidence', 'legacy');
    expect(detailedStats([row(scoreReview(legacy, legacy.expected), legacy.id)]).reviewQuality.calibration).toMatchObject({ eligibleAttempts: 0, validatedFindings: null, severityInflations: null });
    const arm = { profile: '/unused', runtimePaths: ['/unused'], configPaths: ['/unused'] };
    const config = parseConfig({ cli: process.execPath, python: process.execPath, runtimePaths: [process.execPath], cliConfigPaths: [process.execPath], arms: { old: arm, fabric: arm }, cases: [s.id] }, process.cwd());
    const plan = { config, runs: schedule(config), limitations: [] } as unknown as Parameters<typeof comparisonMetrics>[0];
    const rows = plan.runs.filter(r => r.round === 0).map(r => ({ ...row(r.arm === 'fabric' ? bad : good), index: r.index, arm: r.arm }));
    const report = comparisonMetrics(plan, rows);
    expect(report.comparison.fabric!.reportedCredits).toBe(0.4);
    expect(report.pairs.find(p => p.arm === 'fabric' && p.completed)).toMatchObject({ bothPass: false, bothPassCreditRatio: null });
    // The two valid reference arms may still compare; only the bad candidate is excluded.
    expect(report.pairs.find(p => p.arm === 'old' && p.completed)).toMatchObject({ bothPass: true, bothPassCreditRatio: 1 });
    expect(report.oldFabricOuterCallPairs.filter(p => p.completed).every(p => !p.bothPass && p.bothPassOuterCallDelta === null)).toBe(true);
    const markdown = comparisonMarkdown(report);
    expect(markdown.indexOf('Finding validation and severity')).toBeLessThan(markdown.indexOf('Cost and execution'));
    expect(markdown).toContain('Case-oracle matches');
    expect(markdown).toContain('Unsafe fixes');
    expect(markdown).toContain('unknown');
  });
});
