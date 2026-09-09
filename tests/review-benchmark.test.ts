import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_CASES, CASES, caseHashes, makeCase } from '../scripts/steering-benchmark/cases.mjs';
import { makeReviewCase, probeReviewFixture, REVIEW_KINDS, scoreReview } from '../scripts/steering-benchmark/reviews.mjs';
import { validate } from '../scripts/steering-benchmark/oracles.mjs';
import { solvedTrial, syntheticEvents } from '../scripts/steering-benchmark/selftest.mjs';
import { detailedStats, comparisonMarkdown, comparisonMetrics } from '../scripts/steering-benchmark/metrics.mjs';
import { parseConfig, schedule } from '../scripts/steering-benchmark/plan.mjs';
import { commandFor } from '../scripts/steering-benchmark/runner.mjs';
import { analyzeEvents } from '../scripts/steering-benchmark/stream.mjs';
import type { Finding } from '../scripts/steering-benchmark/reviews.mjs';

type Row = Parameters<typeof detailedStats>[0][number];
const answer = (spec: ReturnType<typeof makeReviewCase>) => structuredClone(spec.expected) as { findings: Finding[] };

describe('read-only infrastructure review benchmark', () => {
  it.each(['review-v1', 'review-v2'])('qualifies real defect semantics and seeded evidence: %s', async seed => {
    const spec = makeReviewCase('review-infra', seed);
    expect(makeCase('review-infra', seed)).toEqual(spec);
    expect(CASES).not.toContain('review-infra'); // Preserve legacy default schedules.
    expect(ALL_CASES).toContain('review-infra');
    expect(caseHashes(spec)).toEqual(caseHashes(makeReviewCase('review-infra', seed)));
    expect(caseHashes(spec).fixtures).not.toBe(caseHashes(makeReviewCase('review-infra', seed + '-other')).fixtures);
    expect(spec.allowed).toEqual([]);
    expect(spec.solution).toEqual({});
    expect(Object.keys(spec.files)).not.toContain('oracle.json');
    expect(await probeReviewFixture(spec)).toEqual({ ok: true, defects: 5, falsePositiveControls: 3 });
    expect(answer(spec).findings.find(f => f.kind === 'expired-exemption')!.evidence[0]!.line).toBeGreaterThan(200);
  });

  it('scores unique grounded findings, not order, verbosity, guesses or repeated symptoms', () => {
    const spec = makeReviewCase('review-infra', 'precision');
    const good = answer(spec); good.findings.reverse(); good.findings.forEach(f => f.evidence.reverse());
    expect(scoreReview(spec, good)).toMatchObject({ truePositives: 5, falsePositives: 0, duplicates: 0, recall: 1, precision: 1, missed: [] });
    const partial = answer(spec); partial.findings = partial.findings.slice(0, 2);
    expect(scoreReview(spec, partial)).toMatchObject({ truePositives: 2, recall: 0.4, precision: 1 });
    const duplicate = answer(spec); duplicate.findings.push(duplicate.findings[0]!);
    expect(scoreReview(spec, duplicate)).toMatchObject({ truePositives: 5, duplicates: 1, precision: 5 / 6 });
    for (const kind of ['rollout-outage', 'same-release', 'disabled-cleanup']) {
      expect(REVIEW_KINDS).toContain(kind);
      const noisy = answer(spec); noisy.findings.push({ kind, evidence: [noisy.findings[0]!.evidence[0]!] });
      expect(scoreReview(spec, noisy)).toMatchObject({ truePositives: 5, falsePositives: 1, precision: 5 / 6 });
    }
    expect(scoreReview(spec, { findings: [] })).toMatchObject({ truePositives: 0, recall: 0, precision: null });
  });

  it('requires real caller/consumer evidence and rejects invented source lines and answer schemas', () => {
    const spec = makeReviewCase('review-infra', 'evidence');
    const missing = answer(spec); missing.findings[0]!.evidence.pop();
    expect(scoreReview(spec, missing)).toMatchObject({ truePositives: 4, falsePositives: 1, recall: 0.8 });
    for (const mutate of [
      (e: Finding['evidence'][number]) => { e.line++; },
      (e: Finding['evidence'][number]) => { e.text += ' invented'; },
      (e: Finding['evidence'][number]) => { e.path = '../outside'; },
    ]) {
      const forged = answer(spec); mutate(forged.findings[0]!.evidence[0]!);
      expect(scoreReview(spec, forged).falsePositives).toBe(1);
    }
    for (const bad of [{ findings: [], extra: true }, { findings: 'five' }, { findings: [{ kind: 'unused-alerts', evidence: [] }] }]) expect(() => scoreReview(spec, bad)).toThrow();
    expect(scoreReview(makeReviewCase('review-infra', 'other-seed'), answer(spec)).recall).toBeLessThan(1);
  });

  it('preserves partial scores while enforcing read-only scope, real calls and raw JSON', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-validation-'));
    try {
      const trial = await solvedTrial(root, 'review-infra', process.execPath);
      const good = await validate(trial);
      expect(good.ok).toBe(true); expect(good.review?.recall).toBe(1);
      const partial = answer(trial.spec); partial.findings.pop();
      const graded = await validate({ ...trial, evidence: { ...trial.evidence, finalText: JSON.stringify(partial) } });
      expect(graded.ok).toBe(false); expect(graded.review?.recall).toBe(0.8);
      expect(graded.failures.map(f => f.check)).toEqual(['answer']);
      for (const text of ['```json\n' + trial.evidence.finalText + '\n```', 'Review complete.\n' + trial.evidence.finalText]) {
        expect((await validate({ ...trial, evidence: { ...trial.evidence, finalText: text } })).ok).toBe(false);
      }
      expect((await validate({ ...trial, evidence: { ...trial.evidence, calls: [] } })).failures.some(f => f.check === 'calls')).toBe(true);
      fs.appendFileSync(path.join(trial.workspace, 'README.md'), '\nunauthorized change');
      expect((await validate(trial)).failures.some(f => f.check === 'scope')).toBe(true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('charges failed attempts and keeps unsafe/missing review scores unknown', () => {
    const spec = makeReviewCase('review-infra', 'metrics');
    const full = scoreReview(spec, spec.expected), partial = answer(spec); partial.findings = partial.findings.slice(0, 3);
    const makeRow = (index: number, score: typeof full, credits: number | null): Row => ({
      index, arm: 'fabric', caseId: 'review-infra', qualification: false, state: 'finished', startedAt: 'test', stopReason: null,
      credits, ok: score.recall === 1, validation: { ok: score.recall === 1, failures: score.recall === 1 ? [] : [{ check: 'answer', error: 'partial' }], review: score, audit: null, probe: null, afterDigest: 'hash' },
    });
    const rows = [makeRow(0, full, 0.4), makeRow(1, scoreReview(spec, partial), 0.8)];
    const stats = detailedStats(rows);
    expect(stats.reviewQuality).toMatchObject({ attempts: 2, scoredAttempts: 2, verifiedFindings: 8, expected: 10, precision: 1, recall: 0.8 });
    expect(stats.reviewQuality.creditsPerVerifiedFinding).toBeCloseTo(1.2 / 8);
    rows[1]!.validation!.failures.push({ check: 'scope', error: 'changed input' });
    expect(detailedStats(rows).reviewQuality).toMatchObject({ scoredAttempts: 1, verifiedFindings: null, recall: null, creditsPerVerifiedFinding: null });
    expect(detailedStats([makeRow(0, full, null)]).reviewQuality.creditsPerVerifiedFinding).toBeNull();
  });

  it('pins model/effort identically, verifies returned effort, and reports review scores', async () => {
    const config = parseConfig({ cli: process.execPath, python: process.execPath, runtimePaths: [process.execPath], cliConfigPaths: [process.execPath], arms: {}, cases: ['review-infra'], model: 'claude-opus-5', effort: 'low' }, process.cwd());
    config.arms.fabric = { profile: '/unused', runtimePaths: ['/unused'], configPaths: ['/unused'] };
    const plan = { config, runs: schedule(config), limitations: [] } as unknown as Parameters<typeof comparisonMetrics>[0];
    expect(plan.runs).toHaveLength(4);
    for (const run of plan.runs) {
      const command = commandFor(plan, run, '/tmp', 'review');
      expect(command.args[command.args.indexOf('--model') + 1]).toBe('claude-opus-5');
      expect(command.args[command.args.indexOf('--effort') + 1]).toBe('low');
    }
    expect(plan.runs[0]!.hashes).toEqual(plan.runs[1]!.hashes);
    expect(plan.runs.slice(0, 2).map(r => r.arm)).toEqual(plan.runs.slice(2).map(r => r.arm).reverse());
    expect(() => parseConfig({ ...config, effort: 'turbo' }, process.cwd())).toThrow('invalid effort');
    expect(comparisonMetrics(plan, []).requestedEffort).toBe('low');
    expect(comparisonMarkdown(comparisonMetrics(plan, []))).toContain('Precision | Recall');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-effort-'));
    try {
      const trial = await solvedTrial(root, 'review-infra', process.execPath);
      const events = [{ type: 'sessionUpdate', data: { update: { sessionUpdate: 'config_option_update', configOptions: [{ id: 'effort', currentValue: 'low' }] } } }, ...syntheticEvents(trial.evidence.finalText, { tools: true })];
      const evidence = analyzeEvents(events);
      expect(evidence.effort).toBe('low');
      expect((await validate({ ...trial, evidence, expectedEffort: 'low' })).ok).toBe(true);
      expect((await validate({ ...trial, evidence, expectedEffort: 'high' })).failures.some(f => f.check === 'identity')).toBe(true);
      expect((await validate({ ...trial, expectedEffort: 'low' })).failures.some(f => f.check === 'identity')).toBe(true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
