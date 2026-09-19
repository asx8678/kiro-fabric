import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_CASES, CASES, caseHashes, makeCase } from '../scripts/steering-benchmark/cases.mjs';
import { makeReviewCase, probeReviewFixture, REVIEW_CASES, scoreReview } from '../scripts/steering-benchmark/reviews.mjs';
import { REVIEW_QUALITY_SCHEMA } from '../scripts/steering-benchmark/review-quality.mjs';
import { detailedStats } from '../scripts/steering-benchmark/metrics.mjs';
import { validate } from '../scripts/steering-benchmark/oracles.mjs';
import { solvedTrial } from '../scripts/steering-benchmark/selftest.mjs';
import type { Finding, ReviewEvidence } from '../scripts/steering-benchmark/reviews.mjs';

type QualityAnswer = { schema: string; findings: (Finding & { consequence: string; headline: string; explanation: string; confidence: string; proof: string; counterexample: { id: string; effect: string } })[]; coverage: { scope: string; evidence: ReviewEvidence[] } };
const spec = () => makeReviewCase('review-adherence', 'quality-seed');
const answer = (s = spec()) => structuredClone(s.expected) as QualityAnswer;

describe('opt-in controlled review adherence v1', () => {
  it.each(['quality-seed', 'another-seed'])('registers and independently qualifies two defects and five controls: %s', async seed => {
    const s = makeCase('review-adherence', seed);
    expect(REVIEW_CASES).toContain(s.id);
    expect(ALL_CASES).toContain(s.id);
    expect(CASES).not.toContain(s.id);
    expect(s.allowed).toEqual([]);
    expect(s.solution).toEqual({});
    expect(s.prompt).toContain(REVIEW_QUALITY_SCHEMA);
    expect(await probeReviewFixture(s)).toEqual({ ok: true, defects: 2, falsePositiveControls: 5, qualityVersion: REVIEW_QUALITY_SCHEMA, manualAdjudicationRequired: true });
    expect(scoreReview(s, s.expected)).toMatchObject({ truePositives: 2, falsePositives: 0, recall: 1, quality: { version: REVIEW_QUALITY_SCHEMA, assessedFindings: 2, violations: 0, omittedEvidenceFiles: 0, manualAdjudicationRequired: true } });
  });

  it('retains location recall but rejects the wrong consequence on a real bug', () => {
    const a = answer();
    Object.assign(a.findings[0]!, { consequence: 'expired-nodes-retained', headline: 'expired-nodes-retained', explanation: 'expired-nodes-retained' });
    expect(scoreReview(spec(), a)).toMatchObject({ truePositives: 2, falsePositives: 0, quality: { unsupportedConsequences: 1, headlineMismatches: 0, unsupportedProofs: 1, unsupportedConfirmed: 1, violations: 1 } });
  });

  it('detects inconsistent headlines and self-disproved confirmed findings', () => {
    const a = answer();
    a.findings[0]!.headline = 'expired-nodes-retained';
    a.findings[0]!.counterexample.effect = 'disproves';
    expect(scoreReview(spec(), a).quality).toMatchObject({ headlineMismatches: 1, selfDisprovedFindings: 1, unsupportedConfirmed: 1, violations: 1 });
    const b = answer();
    b.findings[0]!.explanation = 'expired-nodes-retained';
    expect(scoreReview(spec(), b).quality).toMatchObject({ unsupportedConsequences: 1, headlineMismatches: 1 });
  });

  it('distinguishes unsupported confirmation from unresolved conditional claims; proof IDs are not self-attestation', () => {
    const a = answer();
    a.findings[0]!.proof = 'none';
    expect(scoreReview(spec(), a).quality).toMatchObject({ unsupportedProofs: 1, unsupportedConfirmed: 1, conditionalClaims: 0 });
    a.findings[0]!.confidence = 'conditional';
    expect(scoreReview(spec(), a).quality).toMatchObject({ unsupportedProofs: 1, unsupportedConfirmed: 0, conditionalClaims: 1, unresolvedConditionalClaims: 1 });
    a.findings[0]!.proof = 'changed-then-unchanged';
    a.findings[0]!.evidence[0]!.line++;
    expect(scoreReview(spec(), a)).toMatchObject({ truePositives: 1, falsePositives: 1, quality: { unresolvedConditionalClaims: 1 } });
  });

  it.each([
    ['missed-removals', 'adjacent-expired-removed'], ['skipped-nodes', 'snapshot-iteration'],
    ['empty-division', 'empty-batch-no-iteration'], ['config-key-case', 'nondefault-restart-policy'],
    ['disabled-cleanup', 'runtime-true-and-false'],
  ])('rejects correction control %s even if the author calls its counterexample limiting', (kind, id) => {
    const a = answer();
    a.findings.push({ ...structuredClone(a.findings[0]!), kind: kind!, proof: id!, counterexample: { id: id!, effect: 'limits' } });
    expect(scoreReview(spec(), a)).toMatchObject({ truePositives: 2, falsePositives: 1, quality: { selfDisprovedFindings: 1, unsupportedConfirmed: 1 } });
  });

  it('measures evidence-backed coverage, never claiming to prove actual inspection', () => {
    const a = answer();
    a.coverage.evidence.pop();
    expect(scoreReview(spec(), a).quality).toMatchObject({ coverageOverclaims: 1, omittedEvidenceFiles: 1, violations: 1 });
    a.coverage.scope = 'partial';
    expect(scoreReview(spec(), a).quality).toMatchObject({ coverageOverclaims: 0, omittedEvidenceFiles: 1, violations: 0 });
    a.coverage.evidence.push({ path: '../outside', line: 1, text: 'invented' });
    expect(scoreReview(spec(), a).quality?.invalidCoverageEvidence).toBe(1);
    const b = answer(); b.coverage.evidence[0]!.text += 'forged';
    expect(scoreReview(spec(), b).quality).toMatchObject({ invalidCoverageEvidence: 1, coverageOverclaims: 1 });
    b.coverage.evidence = Array(8).fill(b.coverage.evidence[1]!);
    expect(scoreReview(spec(), b).quality?.coverageOverclaims).toBe(1);
  });

  it('does not reward empty reports with recall, or omitted counterexamples with adherence', () => {
    const a = answer(); a.findings = []; a.coverage = { scope: 'partial', evidence: [] };
    expect(scoreReview(spec(), a)).toMatchObject({ truePositives: 0, recall: 0, precision: null, quality: { assessedFindings: 0, violations: 0 } });
    const b = answer(); b.findings[0]!.counterexample = { id: 'none', effect: 'untested' };
    expect(scoreReview(spec(), b).quality).toMatchObject({ counterexampleOmissions: 1, unsupportedConfirmed: 1 });
  });

  it('enforces the versioned bounded structured schema', () => {
    for (const bad of [
      { findings: [] }, { ...answer(), schema: 'review-adherence/v2' },
      { ...answer(), extra: true }, { ...answer(), findings: Array(101).fill(answer().findings[0]) },
      { ...answer(), coverage: { scope: 'exhaustive', evidence: 'all files' } },
    ]) expect(() => scoreReview(spec(), bad)).toThrow();
    const a = answer(); a.findings[0]!.proof = 'I ran it and it passed';
    expect(() => scoreReview(spec(), a)).toThrow();
    const b = answer(); b.findings[0]!.confidence = 'certain';
    expect(() => scoreReview(spec(), b)).toThrow();
  });

  it('detects fixture corrections with independent execution, not expected answer equality', async () => {
    const shell = spec(); shell.files['scripts/check.sh'] = 'bash "scripts/validate input.sh"\n';
    await expect(probeReviewFixture(shell)).rejects.toThrow();
    const cleanup = spec();
    cleanup.files['scripts/cleanup.mjs'] = cleanup.files['scripts/cleanup.mjs']!.replace('    const nodes = [...file.nodes];', '    changesMade = false;\n    const nodes = [...file.nodes];');
    await expect(probeReviewFixture(cleanup)).rejects.toThrow();
    const control = spec();
    control.files['scripts/render.mjs'] = 'export function render() { return {restartPolicy:"Never"}; }\n';
    await expect(probeReviewFixture(control)).rejects.toThrow();
  });

  it('carries quality through immutable workspace validation without replacing the legacy recall gate', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-adherence-test-'));
    try {
      const trial = await solvedTrial(root, 'review-adherence', process.execPath);
      const good = await validate(trial);
      expect(good.ok, JSON.stringify(good.failures)).toBe(true);
      expect(good.review?.quality?.violations).toBe(0);
      const a = answer(trial.spec); a.findings[0]!.headline = 'expired-nodes-retained';
      const bad = await validate({ ...trial, evidence: { ...trial.evidence, finalText: JSON.stringify(a) } });
      expect(bad.review?.quality?.headlineMismatches).toBe(1);
      expect(bad.review?.recall).toBe(1); // Location recall alone cannot pass adherence.
      expect(bad.ok).toBe(false);
      expect(bad.failures).toEqual([{ check: "answer", error: expect.stringContaining("controlled review claim adherence") }]);
      fs.appendFileSync(path.join(trial.workspace, 'scripts/cleanup.mjs'), '\n// unauthorized');
      expect((await validate(trial)).failures.some(f => f.check === 'scope')).toBe(true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('aggregates optional adherence without rewarding empty, unsafe or historical reports', () => {
    const s = spec(), good = scoreReview(s, s.expected), badAnswer = answer(s); badAnswer.findings[0]!.headline = 'expired-nodes-retained';
    const bad = scoreReview(s, badAnswer);
    const row = (score: typeof good, caseId = s.id): Parameters<typeof detailedStats>[0][number] => ({ index: 0, arm: 'fabric', caseId, qualification: false, state: 'finished', startedAt: 'test', stopReason: null, credits: 0.4, ok: score.recall === 1 && !score.quality?.violations,
      validation: { ok: true, failures: score.quality?.violations ? [{ check: 'answer', error: 'contradiction' }] : [], review: score, audit: null, probe: null, afterDigest: 'hash' },
      reviewHelp: { status: 'complete', reason: 'observed-result-content-only', matchedPages: 1, coveredChars: 10, totalChars: 10 } });
    expect(detailedStats([row(good), row(bad)]).reviewQuality).toMatchObject({ verifiedFindings: 4, adherence: { eligibleAttempts: 2, scoredAttempts: 2, violations: 1, headlineMismatches: 1 }, helpDelivery: { complete: 2, unknown: 0 } });
    const unsafe = row(good); unsafe.validation!.failures.push({ check: 'scope', error: 'mutated fixture' });
    expect(detailedStats([row(good), unsafe]).reviewQuality.adherence).toMatchObject({ scoredAttempts: 1, violations: null });
    const legacy = makeReviewCase('review-evidence', 'metrics');
    const old = row(scoreReview(legacy, legacy.expected), legacy.id); delete old.reviewHelp;
    expect(detailedStats([old]).reviewQuality).toMatchObject({ adherence: { eligibleAttempts: 0, violations: null }, helpDelivery: { complete: 0, unknown: 1 } });
    const empty = answer(s); empty.findings = []; empty.coverage = { scope: 'partial', evidence: [] };
    expect(detailedStats([row(scoreReview(s, empty))]).reviewQuality).toMatchObject({ recall: 0, precision: null, creditsPerVerifiedFinding: null, adherence: { violations: 0 } });
  });

  it('pins every earlier prompt/fixture/oracle and leaves legacy quality unknown', () => {
    const pins = {
      'review-infra': ['6c24cc4496f2692b9e82d347642bc155478ce963d7041487c9627e0d18658fd2', 'df0aa26d435f9476796b32c06926ae19abf2e4e2cee6288920333a3dc7e58841', 'a667eff3ae8a3c09c894bc76d9a6290b8dbea3e345e30b54ae0f3930502e5d1d'],
      'review-contracts': ['cf36b33506c6b4f03e95d2f90a3f9f8e140ebc872f0e23434cd5e34e7d75ad26', '07b5e0ac00b12b1acaaba8605d9fcc57e271d8b11c80f30adc0983d30f61e6cd', 'bdcebe08554a22ae1dabb9c9e36184af83a1df803ccef9cc0b709e3ae74ab78e'],
      'review-boundaries': ['6f70685608908cea8fc5416e5d1e32481fcf53d3586f8ba1a8849b97bac9a4bb', '97fc9d4d3827a11b5d1327d064559550cd84c3729d191ec3c04514391493a54e', '22bce23717837b6fc835d2744a33db8969ac3bc3c64784d08d2ccf870e14a653'],
      'review-evidence': ['1a112982deea9351135b8842847a8b2dfb755c58009fa848f9bcd23d1d26a3f9', 'aa73bf062aec7ea694030c755a279a512ff77b841f68e95b7477ba8687d7d765', '4061513a28f3636f171ade46658b911161eee384920144b263e92a19e27c27d3'],
    };
    for (const [id, [prompt, fixtures, oracle]] of Object.entries(pins)) {
      const s = makeReviewCase(id, 'quality-legacy-pin');
      expect(caseHashes(s)).toEqual({ prompt, fixtures, oracle });
      const legacy = scoreReview(s, s.expected);
      expect(legacy).not.toHaveProperty('quality');
      expect(legacy).not.toHaveProperty('calibration');
      expect(() => scoreReview(s, answer())).toThrow();
    }
  });
});
