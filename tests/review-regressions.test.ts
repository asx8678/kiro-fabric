import { describe, expect, it } from 'vitest';
import { caseHashes } from '../scripts/steering-benchmark/cases.mjs';
import { digest } from '../scripts/steering-benchmark/core.mjs';
import { makeRegressionReviewCase, scoreReviewRegressions, probeRegressionReviewFixture, REVIEW_REGRESSION_CASES, REVIEW_REGRESSIONS_SCHEMA } from '../scripts/steering-benchmark/review-regressions.mjs';
import type { Answer, Assessment, Controller } from '../scripts/steering-benchmark/review-regressions.mjs';

const make = (id = REVIEW_REGRESSION_CASES[0]!, seed = 'acceptance') => makeRegressionReviewCase(id, seed);
const answer = (s = make()) => structuredClone(s.expected) as Answer;
const claim = (a: Answer, kind: string) => a.findings.find(f => f.kind === kind)!;

// Acceptance ledger: two seeded/selectable families; cross-file failure/deletion and controls;
// async/await + real HTTP status mapping; request rate vs delay; shell/TF consumers;
// Kube/Helm completeness; varied TS/JS/shell/C#; private oracle; finite scoring only.
describe('review regressions: finite source evidence, not semantic judging', () => {
  it.each(REVIEW_REGRESSION_CASES)('executes actual offline TS/JS/shell fixture contracts: %s', async id => {
    for (const seed of ['acceptance', 'different-input']) {
      const s = make(id, seed), before = structuredClone(s);
      const result = await probeRegressionReviewFixture(s);
      expect(result).toMatchObject({ok:true, shellChecks:11, nodeChecks:'passed', csharp:{status:'skipped'}, agentTestExecution:'unobserved', manualAdjudicationRequired:true});
      expect(result.http).toContain('Request/Response');
      expect(result.fixtureDigest).toBe(digest(s.files));
      expect(s).toEqual(before);
      expect(scoreReviewRegressions(s, s.expected)).toMatchObject({recall:1, precision:1, falsePositives:0,
        regressions:{violations:0, scenarioCoverage:1, expectedHighImpact:1, validatedHighImpact:1, correctNonfindings:3, agentTestExecution:'unobserved'}});
    }
  }, 20000);

  it('binds deterministic seeds and private controller answers without serializing them into files or prompts', () => {
    for (const id of REVIEW_REGRESSION_CASES) for (let i = 0; i < 48; i++) {
      const s = make(id, 'seed-' + i);
      expect(caseHashes(s)).toEqual(caseHashes(make(id, 'seed-' + i)));
      expect(scoreReviewRegressions(s, s.expected).regressions.violations).toBe(0);
      expect(s.allowed).toEqual([]); expect(s.solution).toEqual({}); expect(s.sources).toEqual([]);
      const agentVisible = JSON.stringify({files:s.files,prompt:s.prompt});
      expect(agentVisible).not.toContain(JSON.stringify(s.expected));
      expect(agentVisible).not.toContain('reviewOracle');
      expect(agentVisible).not.toContain('requiredScenarios');
      expect(Object.keys(s.files).some(p => /oracle|answer|controller/i.test(p))).toBe(false);
      expect(Object.keys(s.files).some(p => p.endsWith('.ts'))).toBe(true);
      expect(Object.keys(s.files).some(p => p.endsWith('.mjs'))).toBe(true);
      expect(Object.keys(s.files).some(p => p.endsWith('.sh'))).toBe(true);
      expect(Object.keys(s.files).some(p => p.endsWith('.cs'))).toBe(true);
    }
    const s = make(), changed = structuredClone(s);
    (changed.reviewOracle as Controller).highImpact.push('new-policy');
    expect(caseHashes(changed).oracle).not.toBe(caseHashes(s).oracle);
    expect(caseHashes(changed).fixtures).toBe(caseHashes(s).fixtures);
    expect(caseHashes(changed).prompt).toBe(caseHashes(s).prompt);
    expect(caseHashes(make(undefined, 'other')).fixtures).not.toBe(caseHashes(s).fixtures);
  });

  it('held-out changes causal guards, not just identifiers; copied seeded decisions fail', () => {
    const seeded = make(), heldout = make(REVIEW_REGRESSION_CASES[1]);
    const copied = answer(heldout);
    for (const a of copied.findings) Object.assign(a, {...claim(answer(seeded), a.kind), evidence:a.evidence});
    const score = scoreReviewRegressions(heldout, copied);
    expect(score.regressions).toMatchObject({invalidEvidence:0, invalidDispositions:2, violations:2, missedHighImpact:['cluster-inventory']});
    expect(score.recall).toBeLessThan(1);
  });

  it.each(['partial-delete', 'async-catch', 'http-status', 'pipeline-exit', 'terraform-detailed-exit', 'csharp-task-catch'])('requires every finite causal evidence obligation for %s', kind => {
    const s = make();
    for (let i = 0; i < claim(answer(s),kind).evidence.length; i++) {
      const a = answer(s); claim(a,kind).evidence.splice(i,1);
      expect(scoreReviewRegressions(s,a)).toMatchObject({recall:5/6, regressions:{invalidEvidence:1, callerConsumerOmissions:1, violations:1}});
    }
  });

  it.each(['consequence', 'proof', 'counterexample', 'recommendation', 'severity'] as const)('rejects unsupported %s despite exact source evidence', field => {
    const a = answer(); claim(a,'partial-delete')[field] = field === 'severity' ? 'critical' : 'unsupported-claim';
    const score = scoreReviewRegressions(make(),a);
    expect(score).toMatchObject({truePositives:5, falsePositives:1, regressions:{invalidEvidence:0, violations:1, missedHighImpact:['partial-delete']}});
  });

  it.each(['awaited-control','shorter-delay-rate','cluster-inventory'])('does not count a guarded negative control as a finding: %s', kind => {
    const a = answer(); claim(a,kind).disposition = 'finding'; claim(a,kind).severity = 'high';
    expect(scoreReviewRegressions(make(),a)).toMatchObject({truePositives:6,falsePositives:1,regressions:{invalidDispositions:1,invalidSeverities:1,violations:1}});
  });

  it('keeps omission, unsupported consequences and requested scenario coverage distinct', () => {
    const a = answer(); a.findings = a.findings.filter(f => f.kind !== 'partial-delete');
    expect(scoreReviewRegressions(make(),a)).toMatchObject({truePositives:5,regressions:{violations:0,validatedHighImpact:0,missedHighImpact:['partial-delete'],missingScenarios:['partial-delete'],scenarioCoverage:8/9}});
    const controlsOmitted = answer(); controlsOmitted.findings = controlsOmitted.findings.filter(f => f.disposition === 'finding');
    expect(scoreReviewRegressions(make(),controlsOmitted)).toMatchObject({recall:1,regressions:{violations:0,coveredScenarios:6,scenarioCoverage:6/9}});
    const empty = scoreReviewRegressions(make(), {schema:REVIEW_REGRESSIONS_SCHEMA,findings:[]});
    expect(empty).toMatchObject({recall:0,precision:null,regressions:{scenarioCoverage:0,validatedHighImpact:0}});
    const rate = answer(); claim(rate,'shorter-delay-rate').consequence = 'total-rate-increases';
    expect(scoreReviewRegressions(make(),rate).regressions).toMatchObject({unsupportedConsequences:1,violations:1});
  });

  it('does not award duplicate assessments and rejects forged evidence/extra schema keys', () => {
    const a = answer(); a.findings.push(structuredClone(a.findings[0]!));
    expect(scoreReviewRegressions(make(),a)).toMatchObject({truePositives:6,regressions:{violations:1}});
    for (const mutate of [
      (f: Assessment) => { f.evidence[0]!.path = '../outside'; },
      (f: Assessment) => { f.evidence[0]!.line++; },
      (f: Assessment) => { f.evidence[0]!.text += ' forged'; },
    ]) { const forged = answer(); mutate(forged.findings[0]!); expect(scoreReviewRegressions(make(),forged).regressions.invalidEvidence).toBe(1); }
    expect(() => scoreReviewRegressions(make(),{...answer(),execution:'passed'})).toThrow();
    expect(() => scoreReviewRegressions(make(),{schema:REVIEW_REGRESSIONS_SCHEMA,findings:Array(101).fill(answer().findings[0])})).toThrow();
  });

  it('actual controller executions detect mutations independently of answer tuples', async () => {
    const changed = make(); changed.files['src/prune.ts'] = changed.files['src/prune.ts']!.replace('if (dryRun)', 'if (dryRun || !result.complete)');
    await expect(probeRegressionReviewFixture(changed)).rejects.toThrow();
    expect(() => scoreReviewRegressions(changed,changed.expected)).toThrow('stale regression oracle');
    const middleware = make(); middleware.files['src/http.mjs'] = middleware.files['src/http.mjs']!.replace('409 : 500','409 : 409');
    await expect(probeRegressionReviewFixture(middleware)).rejects.toThrow();
    const rate = make(); rate.files['src/poll.mjs'] = rate.files['src/poll.mjs']!.replace('start += 1000','start += delay');
    await expect(probeRegressionReviewFixture(rate)).rejects.toThrow();
    const shell = make(); shell.files['scripts/check.sh'] = 'check_input() { validate_input "$@"; }\n';
    await expect(probeRegressionReviewFixture(shell)).rejects.toThrow();
  }, 20000);
});
