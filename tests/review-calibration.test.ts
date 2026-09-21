import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { caseHashes } from '../scripts/steering-benchmark/cases.mjs';
import { checkScope, inventory, putFiles } from '../scripts/steering-benchmark/core.mjs';
import { scoreReview } from '../scripts/steering-benchmark/reviews.mjs';
import { collect } from '../scripts/steering-benchmark/stream.mjs';
import { makeCalibrationReviewCase, probeCalibrationReviewFixture, REVIEW_CALIBRATION_SCHEMA, scoreReviewCalibration } from '../scripts/steering-benchmark/review-calibration.mjs';
import type { ReviewCalibration, Assessment } from '../scripts/steering-benchmark/review-calibration.mjs';

type Spec = ReturnType<typeof makeCalibrationReviewCase>;
type Answer = { schema: string; findings: Assessment[] };
const spec = () => makeCalibrationReviewCase('calibration-seed');
const expected = (s: Spec) => s.expected as Answer;
const oracle = (s: Spec) => s.reviewOracle as { version: string; rubric: Record<string, string>; assessments: Assessment[]; rules: Record<string, { severity: string | null }> };
const answer = (s = spec()): Answer => ({ schema: REVIEW_CALIBRATION_SCHEMA, findings: structuredClone(expected(s).findings) });
// Explicit legacy surrogate avoids future reviews dispatch recursion.
const grounding = (s: Spec, a: unknown) => scoreReview({ ...s, id: 'review-evidence' }, a);
const score = (a: unknown, s = spec()) => scoreReviewCalibration(s, a, grounding);
const control = (kind: string, s = spec()) => structuredClone(oracle(s).assessments.find(f => f.kind === kind)!);

// Acceptance ledger: finite contracts; all severity directions; caller/consumer grounding;
// rejected/unresolved controls; dangerous corrections; unique credit; strict schema;
// behavioral qualification/mutations; hash-bound private oracle; immutable review boundary.
describe('finite opt-in review calibration v1', () => {
  it.each(['calibration-seed', 'another-seed', 'third-seed'])('qualifies actual fixture modules and safe/unsafe controller copies: %s', async seed => {
    const s = makeCalibrationReviewCase(seed), before = structuredClone(s);
    expect(s).toMatchObject({ id: 'review-calibration', allowed: [], solution: {}, sources: [], qualification: false, json: true });
    expect(await probeCalibrationReviewFixture(s)).toEqual({ ok: true, defects: 3, falsePositiveControls: 3, calibrationVersion: REVIEW_CALIBRATION_SCHEMA, controllerCopies: 5, manualAdjudicationRequired: true });
    expect(s).toEqual(before);
    expect(Object.keys(s.expected as object)).toEqual(['schema', 'findings']);
    const result = score(s.expected, s);
    const calibration: ReviewCalibration = result.calibration;
    expect(result).toMatchObject({ expected: 3, reported: 3, truePositives: 3, falsePositives: 0, duplicates: 0, precision: 1, recall: 1 });
    expect(calibration).toMatchObject({ version: REVIEW_CALIBRATION_SCHEMA, assessedClaims: 3, groundedFindings: 3, duplicateAssessments: 0, validatedFindings: 3, expectedFindings: 3, validatedRecall: 1, unsupportedConfirmed: 0, severityInflations: 0, severityUnderstatements: 0, dangerousRecommendations: 0, expectedSubstantial: 2, validatedSubstantial: 2, missedSubstantial: [], substantialRecall: 1, violations: 0, manualAdjudicationRequired: true });
    expect(calibration.limitations.join(' ')).toContain('not generic semantic judging');
    expect(expected(s).findings.map(f => f.severity)).toEqual(['low', 'medium', 'high']);
  }, 20000);

  it('keeps evidence anchors unique across a broad deterministic seed sample', () => {
    for (let i = 0; i < 256; i++) {
      const s = makeCalibrationReviewCase(`seed-boundary-${i}`);
      expect(score(s.expected, s).calibration).toMatchObject({ validatedFindings: 3, violations: 0 });
    }
  });

  it('accepts fully supported nonfindings without counting them as defects or false positives', () => {
    const a = answer();
    a.findings.push(control('empty-division'), control('selector-case'), control('disabled-cleanup'));
    expect(score(a)).toMatchObject({ reported: 3, truePositives: 3, falsePositives: 0, recall: 1, calibration: { assessedClaims: 6, correctNonfindings: 3, violations: 0 } });
    a.findings = a.findings.slice(3);
    expect(score(a)).toMatchObject({ reported: 0, truePositives: 0, falsePositives: 0, precision: null, recall: 0, calibration: { correctNonfindings: 3, validatedRecall: 0, substantialRecall: 0, violations: 0 } });
  });

  const ranks = ['low', 'medium', 'high', 'critical'];
  const severityCases = ['low', 'medium', 'high'].flatMap((actual, index) => ranks.filter(severity => severity !== actual).map(severity => ({ actual, index, severity })));
  it.each(severityCases)('withholds credit for $actual -> $severity', ({ actual, index, severity }) => {
    const a = answer(); a.findings[index]!.severity = severity;
    const inflated = ranks.indexOf(severity) > ranks.indexOf(actual);
    expect(score(a)).toMatchObject({ truePositives: 2, falsePositives: 1, recall: 2 / 3, calibration: { validatedFindings: 2, validatedRecall: 2 / 3, severityInflations: Number(inflated), severityUnderstatements: Number(!inflated), unsupportedConfirmed: 1, violations: 1, validatedSubstantial: index === 0 ? 2 : 1, substantialRecall: index === 0 ? 1 : 0.5 } });
    expect(score(a).calibration.missedSubstantial).toEqual(index === 0 ? [] : [a.findings[index]!.kind]);
  });

  it.each(['empty-division', 'selector-case'])('rejects guarded false positive %s even with exact evidence', kind => {
    const a = answer(), c = control(kind); c.disposition = 'finding'; c.severity = 'high'; a.findings.push(c);
    expect(score(a)).toMatchObject({ truePositives: 3, falsePositives: 1, calibration: { unsupportedConfirmed: 1, invalidEvidence: 0, invalidDispositions: 1, invalidSeverities: 1, violations: 1 } });
    c.disposition = 'unresolved'; c.severity = null;
    expect(score(a)).toMatchObject({ falsePositives: 0, calibration: { violations: 1, correctNonfindings: 0 } });
  });

  it('distinguishes external uncertainty from confirmation or unsupported rejection', () => {
    const a = answer(), c = control('disabled-cleanup'); a.findings.push(c);
    expect(score(a).calibration).toMatchObject({ correctNonfindings: 1, unsupportedConfirmed: 0, violations: 0 });
    c.disposition = 'finding'; c.severity = 'medium';
    expect(score(a)).toMatchObject({ falsePositives: 1, calibration: { unsupportedConfirmed: 1, violations: 1 } });
    c.disposition = 'disproved'; c.severity = null;
    expect(score(a)).toMatchObject({ falsePositives: 0, calibration: { correctNonfindings: 0, invalidDispositions: 1, violations: 1 } });
  });

  it.each(['disable-validation', 'force-enable-cleanup'])('rejects dangerous recommendation %s on any otherwise valid finding', recommendation => {
    for (let i = 0; i < 3; i++) {
      const a = answer(); a.findings[i]!.recommendation = recommendation;
      expect(score(a)).toMatchObject({ truePositives: 2, falsePositives: 1, calibration: { dangerousRecommendations: 1, unsupportedRecommendations: 1, unsupportedConfirmed: 1, violations: 1, validatedFindings: 2 } });
    }
    const a = answer(), c = control('disabled-cleanup'); c.recommendation = recommendation; a.findings.push(c);
    expect(score(a)).toMatchObject({ falsePositives: 0, calibration: { dangerousRecommendations: 1, violations: 1, correctNonfindings: 0 } });
  });

  it.each([[1, 'invoke-validator-directly'], [2, 'pause-prune']] as const)('accepts independently probed safe alternative %s %s', (index, recommendation) => {
    const a = answer(); a.findings[index]!.recommendation = recommendation;
    expect(score(a)).toMatchObject({ truePositives: 3, calibration: { violations: 0 } });
  });

  it('requires every finite caller, consumer, configuration and source obligation', () => {
    const s = spec();
    for (let i = 0; i < 3; i++) for (let j = 0; j < expected(s).findings[i]!.evidence.length; j++) {
      const a = answer(s); a.findings[i]!.evidence.splice(j, 1);
      expect(score(a, s), `finding ${i} evidence ${j}`).toMatchObject({ truePositives: 2, calibration: { invalidEvidence: 1, unsupportedConfirmed: 1, violations: 1 } });
    }
    const high = expected(s).findings[2]!;
    expect(high.evidence.some(e => e.path === 'config/job.json' && e.text.includes('"force": true'))).toBe(true);
    expect(high.evidence.some(e => e.path === 'config/response.json' && e.text.includes('"version": "master"'))).toBe(true);
    expect(high.evidence.some(e => e.path === 'scripts/prune.mjs' && e.text.includes('response.version'))).toBe(true);
    const medium = expected(s).findings[1]!;
    expect(new Set(medium.evidence.map(e => e.path))).toEqual(new Set(['scripts/release.sh', 'scripts/check.sh', 'scripts/validate input.sh', 'README.md']));
  });

  it.each(['text', 'line', 'path', 'extra'])('rejects forged evidence: %s', field => {
    const a = answer(), e = a.findings[0]!.evidence[0]!;
    if (field === 'text') e.text += ' forged';
    if (field === 'line') e.line++;
    if (field === 'path') e.path = '../outside';
    if (field === 'extra') a.findings[0]!.evidence.push({ path: 'invented.mjs', line: 1, text: 'not supplied' });
    expect(score(a)).toMatchObject({ truePositives: 2, calibration: { invalidEvidence: 1, violations: 1 } });
  });

  it.each(['expired-nodes-retained', 'permanent-data-loss', 'protected-artifact-deleted'])('does not credit unnecessary save as %s', consequence => {
    const a = answer(); a.findings[0]!.consequence = consequence;
    expect(score(a)).toMatchObject({ truePositives: 2, falsePositives: 1, calibration: { unsupportedConsequences: 1, groundedFindings: 3, validatedRecall: 2 / 3, violations: 1 } });
  });

  it('counts overlapping diagnostics only once per invalid assessment', () => {
    const a = answer(); Object.assign(a.findings[1]!, { severity: 'critical', consequence: 'permanent-data-loss', proof: 'none', counterexample: 'none', recommendation: 'disable-validation' });
    a.findings[1]!.evidence.pop();
    expect(score(a).calibration).toMatchObject({ invalidEvidence: 1, unsupportedConsequences: 1, unsupportedProofs: 1, unsupportedCounterexamples: 1, severityInflations: 1, dangerousRecommendations: 1, unsupportedConfirmed: 1, violations: 1, validatedSubstantial: 1, missedSubstantial: ['masked-validation-exit'] });
  });

  it('does not treat severity as confidence or unresolved actual defects as validated', () => {
    const a = answer(); a.findings[2]!.disposition = 'unresolved'; a.findings[2]!.severity = null;
    expect(score(a)).toMatchObject({ reported: 2, truePositives: 2, falsePositives: 0, calibration: { invalidDispositions: 1, unsupportedConfirmed: 0, validatedSubstantial: 1, violations: 1 } });
    a.findings[2]!.disposition = 'finding';
    expect(score(a).calibration).toMatchObject({ invalidSeverities: 1, validatedFindings: 2, violations: 1 });
  });

  it('fails empty recall and prevents duplicate supported claims from inflating it', () => {
    expect(score({ schema: REVIEW_CALIBRATION_SCHEMA, findings: [] })).toMatchObject({ expected: 3, reported: 0, truePositives: 0, precision: null, recall: 0, calibration: { assessedClaims: 0, expectedFindings: 3, validatedFindings: 0, validatedRecall: 0, expectedSubstantial: 2, validatedSubstantial: 0, substantialRecall: 0, missedSubstantial: ['masked-validation-exit', 'protected-artifact-deletion'], violations: 0 } });
    const a = answer(); a.findings = Array.from({ length: 10 }, () => structuredClone(a.findings[1]!));
    expect(score(a)).toMatchObject({ expected: 3, reported: 10, truePositives: 1, duplicates: 9, falsePositives: 0, recall: 1 / 3, calibration: { assessedClaims: 10, expectedFindings: 3, validatedFindings: 1, expectedSubstantial: 2, validatedSubstantial: 1, substantialRecall: 0.5, groundedFindings: 1, duplicateAssessments: 9, violations: 9 } });
    a.findings[0]!.severity = 'critical';
    expect(score(a)).toMatchObject({ truePositives: 0, duplicates: 9, falsePositives: 1, calibration: { groundedFindings: 1, duplicateAssessments: 9, violations: 10 } });
  });

  it.each(['empty-division', 'selector-case', 'disabled-cleanup'])('rejects repeated correct nonfinding %s exactly once per duplicate', kind => {
    const a = answer(); a.findings.push(control(kind), control(kind), control(kind));
    expect(score(a)).toMatchObject({ reported: 3, truePositives: 3, falsePositives: 0, duplicates: 2, calibration: { assessedClaims: 6, correctNonfindings: 1, duplicateAssessments: 2, groundedFindings: 3, violations: 2 } });
    a.findings[4]!.recommendation = 'force-enable-cleanup';
    expect(score(a).calibration).toMatchObject({ duplicateAssessments: 2, dangerousRecommendations: 1, violations: 2 });
  });

  it('rejects contradictory repeats even when one copy is otherwise correct', () => {
    const a = answer(); a.findings.push({ ...control('disabled-cleanup'), disposition: 'finding', severity: 'medium' }, control('disabled-cleanup'));
    expect(score(a)).toMatchObject({ truePositives: 3, falsePositives: 1, duplicates: 1, calibration: { violations: 2, correctNonfindings: 0, duplicateAssessments: 1 } });
    a.findings = [a.findings[4]!, a.findings[3]!];
    expect(score(a)).toMatchObject({ truePositives: 0, duplicates: 1, calibration: { violations: 1, correctNonfindings: 1, duplicateAssessments: 1, groundedFindings: 0 } });
  });

  it('rejects malformed versions, fields, enum IDs and evidence schemas', () => {
    const a = answer();
    for (const invalid of [null, [], {}, { ...a, schema: 'review-calibration/v2' }, { ...a, extra: true }, { ...a, findings: {} }, { ...a, findings: Array(101).fill(a.findings[0]) }, { ...a, reviewOracle: oracle(spec()) }]) expect(() => score(invalid)).toThrow();
    for (const [field, value] of Object.entries({ kind: 'arbitrary-defect', disposition: 'confirmed', severity: 'certain', consequence: 'free prose', proof: 'I ran it', counterexample: {}, recommendation: 'arbitrary patch', evidence: [] })) {
      const b = answer(); Object.assign(b.findings[0]!, { [field]: value }); expect(() => score(b), field).toThrow();
    }
    for (const evidence of [[{ path: 'README.md', line: 0, text: '' }], [{ path: 'README.md', line: 1.5, text: '' }], [{ path: 'README.md', line: '1', text: '' }], [{ path: 'README.md', line: 1, text: '', extra: true }], Array(33).fill(a.findings[0]!.evidence[0])]) {
      const b = answer(); Object.assign(b.findings[0]!, { evidence }); expect(() => score(b)).toThrow();
    }
    const b = answer(); Object.assign(b.findings[0]!, { confidence: 'certain' }); expect(() => score(b)).toThrow();
  });

  it('hashes oracle rubric/version without leaking controller solutions; seeds perturb fixture evidence', () => {
    const s = spec(), hashes = caseHashes(s);
    expect(caseHashes(spec())).toEqual(hashes);
    expect(caseHashes(makeCalibrationReviewCase('different'))).not.toEqual(hashes);
    for (const change of ['version', 'rubric', 'rule']) {
      const other = structuredClone(s), controller = oracle(other);
      if (change === 'version') controller.version = 'review-calibration/v2';
      if (change === 'rubric') controller.rubric.low += ' changed severity contract';
      if (change === 'rule') controller.rules['unnecessary-save']!.severity = 'medium';
      expect(caseHashes(other)).toMatchObject({ prompt: hashes.prompt, fixtures: hashes.fixtures });
      expect(caseHashes(other).oracle).not.toBe(hashes.oracle);
    }
    expect(s.prompt).toContain(REVIEW_CALIBRATION_SCHEMA);
    expect(s.prompt).not.toContain('controller');
    expect(Object.values(s.files).join('\n')).not.toContain('validatedFindings');
    expect(Object.values(s.files).join('\n')).not.toContain('"disposition":"finding"');
    expect(s.files['README.md']).toContain('critical:');
    expect(s.files['README.md']).toContain('NOT confidence');
  });

  it.each([
    ['scripts/check.sh', '| tail -n 1', ''],
    ['scripts/validate input.sh', 'exit 7', 'exit 0'],
    ['scripts/release.sh', 'plan admitted', 'not admitted'],
    ['scripts/cleanup.mjs', '    const nodes = [...file.nodes];', '    changesMade = false;\n    const nodes = [...file.nodes];'],
    ['scripts/cleanup.mjs', '  const saves = [], progress = [];', '  const saves = [], progress = [0 / files.length];'],
    ['scripts/prune.mjs', 'response.version !== "master"', 'item.version !== "master"'],
    ['config/job.json', '"force": true', '"force": false'],
    ['config/response.json', '"version": "master"', '"version": "release-old"'],
    ['scripts/run.mjs', 'prune(response, job.force)', 'prune(response, false)'],
    ['scripts/rollout.mjs', 'throw new Error("invalid release name")', 'return {selector:name,label:name.toLowerCase()}'],
    ['scripts/enabled.mjs', 'settings.should_remove === true', 'false'],
    ['scripts/operator.mjs', 'enabled(settings)', 'true'],
  ])('rejects independently executed fixture mutation %s / %s', async (file, old, replacement) => {
    const s = spec(); expect(s.files[file]).toContain(old); s.files[file] = s.files[file]!.replace(old, replacement);
    await expect(probeCalibrationReviewFixture(s)).rejects.toThrow();
  }, 20000);

  it('qualifies behavior without reading the expected answer', async () => {
    const s = spec(); s.expected = { completely: 'wrong' }; s.reviewOracle = { also: 'wrong' };
    expect(await probeCalibrationReviewFixture(s)).toMatchObject({ ok: true, defects: 3 });
  }, 20000);

  it('keeps the agent review workspace unedited and scope gates unauthorized inventory changes', async () => {
    const s = spec(), root = fs.mkdtempSync(path.join(os.tmpdir(), 'calibration-boundary-'));
    try {
      putFiles(root, s.files); const before = inventory(root);
      const result = await collect({ executable: process.execPath, args: ['--input-type=module', '-e', 'import {run} from "./scripts/run.mjs"; console.log(JSON.stringify(run()));'], cwd: root, env: { PATH: process.env.PATH }, maxOutputBytes: 65536, timeoutMs: 10000 });
      expect(result).toMatchObject({ code: 0, stopReason: null, spawnError: null });
      expect(JSON.parse(result.stdout).artifacts.deleted).toEqual(['protected', 'obsolete']);
      expect(() => checkScope(before, inventory(root), s.allowed)).not.toThrow();
      score(answer(s), s);
      await probeCalibrationReviewFixture(s); // Independent controller copies, not this workspace.
      expect(inventory(root)).toEqual(before);
      const tampered = structuredClone(before); tampered['scripts/check.sh']!.hash = 'unauthorized-edit';
      expect(() => checkScope(before, tampered, s.allowed)).toThrow('scope');
      const added = { ...before, 'answer.json': { kind: 'file' as const, mode: 0o600, hash: 'unapproved' } };
      expect(() => checkScope(before, added, s.allowed)).toThrow('scope');
      expect(inventory(root)).toEqual(before); // Boundary assertions never edit the agent fixture.
    } finally { removeFixtureSync(root, { recursive: true, force: true }); }
  }, 20000);

});
