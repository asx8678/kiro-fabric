import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_CASES, CASES, caseHashes, makeCase } from '../scripts/steering-benchmark/cases.mjs';
import * as core from '../scripts/steering-benchmark/core.mjs';
import { validate, validateAnswer } from '../scripts/steering-benchmark/oracles.mjs';
import { analyzeEvents } from '../scripts/steering-benchmark/stream.mjs';
import { syntheticEvents } from '../scripts/steering-benchmark/selftest.mjs';
import { parseConfig, schedule } from '../scripts/steering-benchmark/plan.mjs';
import { comparisonMarkdown, comparisonMetrics, detailedStats } from '../scripts/steering-benchmark/metrics.mjs';
import { REVIEW_REGRESSION_CASES, REVIEW_REGRESSIONS_SCHEMA, scoreReviewRegressions } from '../scripts/steering-benchmark/review-regressions.mjs';
import type { Answer } from '../scripts/steering-benchmark/review-regressions.mjs';

type Row = Parameters<typeof detailedStats>[0][number];
const make = () => makeCase(REVIEW_REGRESSION_CASES[0]!, 'integration');
const evidence = (answer: unknown) => analyzeEvents(syntheticEvents(JSON.stringify(answer), {tools:true}));
const row = (review: ReturnType<typeof scoreReviewRegressions>, caseId = REVIEW_REGRESSION_CASES[0]!): Row => ({index:0,arm:'fabric',caseId,qualification:false,state:'finished',startedAt:'synthetic-test-only',stopReason:null,credits:0.4,
  ok:review.recall === 1 && review.regressions.violations === 0 && review.regressions.scenarioCoverage === 1,
  validation:{ok:true,failures:review.regressions.violations || review.regressions.scenarioCoverage !== 1 ? [{check:'answer',error:'regression'}] : [],review,audit:null,probe:null,afterDigest:'synthetic'}});
afterEach(() => vi.restoreAllMocks());

describe('regression cases use existing benchmark plan, evaluator and reports', () => {
  it.each(REVIEW_REGRESSION_CASES)('is opt-in and dispatches through makeCase / validateAnswer: %s', id => {
    expect(ALL_CASES).toContain(id); expect(CASES).not.toContain(id);
    const s = makeCase(id,'dispatch');
    expect(validateAnswer(s,JSON.stringify(s.expected),evidence(s.expected))).toEqual(scoreReviewRegressions(s,s.expected));
    expect(() => validateAnswer(s,'```json\n' + JSON.stringify(s.expected),evidence(s.expected))).toThrow();
    expect(s.allowed).toEqual([]);
    // Runner only materializes spec.files; controller metadata must never be included.
    expect(Object.keys(s.files)).not.toContain('reviewOracle');
    expect(JSON.stringify(s.files)).not.toContain(JSON.stringify(s.expected));
  });

  it('matches identical seeds, fixtures and private oracle hashes across existing repeated profile arms', () => {
    const arm = {profile:'/unused',runtimePaths:['/unused'],configPaths:['/unused']};
    const config = parseConfig({cli:process.execPath,python:process.execPath,runtimePaths:[process.execPath],cliConfigPaths:[process.execPath],arms:{old:arm,fabric:arm},cases:REVIEW_REGRESSION_CASES,repetitions:4,seed:'matched-regressions',model:'auto'},process.cwd());
    const runs = schedule(config);
    expect(runs).toHaveLength(24);
    for (let round = 0; round < 4; round++) for (const id of REVIEW_REGRESSION_CASES) {
      const matched = runs.filter(r => r.round === round && r.caseId === id);
      expect(matched.map(r => r.arm).sort()).toEqual(['fabric','native','old']);
      expect(new Set(matched.map(r => r.seed)).size).toBe(1);
      expect(new Set(matched.map(r => JSON.stringify(r.hashes))).size).toBe(1);
      expect(matched[0]!.hashes).toEqual(caseHashes(makeCase(id,matched[0]!.seed)));
    }
    expect(new Set(runs.filter(r => r.caseId === REVIEW_REGRESSION_CASES[0]).map(r => r.seed)).size).toBe(4);
    expect(() => parseConfig({...config,cases:['review-regressions-typo']},process.cwd())).toThrow();
  });

  it('admission gates requested controls, process, routing and immutable scope (synthetic inventory/events, not an agent run)', async () => {
    const s = make();
    // No test filesystem writes, cleanup/deletion, service or agent invocation. This test
    // checks admission policy over synthetic snapshots, not a filesystem security boundary.
    const before = Object.fromEntries(Object.entries(s.files).map(([name,text]) => [name,{kind:'file' as const,mode:0o600,hash:core.sha(text),bytes:Buffer.byteLength(text)}]));
    const inventory = vi.spyOn(core,'inventory').mockReturnValue(before);
    const options = {spec:s,workspace:'/synthetic-not-accessed',before,evidence:evidence(s.expected),arm:'pass2',expectedMode:'steering-pass2',python:process.execPath,processOk:true};
    expect(await validate(options)).toMatchObject({ok:true,probe:null,audit:null});
    const partial = structuredClone(s.expected) as Answer;
    partial.findings = partial.findings.filter(f => f.disposition === 'finding');
    const rejected = await validate({...options,evidence:evidence(partial)});
    expect(rejected).toMatchObject({ok:false,review:{recall:1,regressions:{scenarioCoverage:6/9}}});
    expect(rejected.failures).toEqual([{check:'answer',error:expect.stringContaining('regression scenarios')}]);
    expect((await validate({...options,processOk:false})).ok).toBe(false);
    expect((await validate({...options,evidence:{...options.evidence,calls:[]}})).ok).toBe(false);
    inventory.mockReturnValue({...before,unexpected:{kind:'file',mode:0o600,hash:'mutation',bytes:1}});
    expect((await validate(options)).failures.some(f => f.check === 'scope')).toBe(true);
  });

  it('reports missed demonstrated high impact, unsupported claims, coverage, and unknown historical/unsafe scores', () => {
    const s = make(), good = scoreReviewRegressions(s,s.expected), a = structuredClone(s.expected) as Answer;
    a.findings.find(f => f.kind === 'partial-delete')!.consequence = 'global-permanent-loss';
    const bad = scoreReviewRegressions(s,a);
    expect(detailedStats([row(good),row(bad)]).reviewQuality.regressions).toMatchObject({eligibleAttempts:2,scoredAttempts:2,expectedHighImpact:2,validatedHighImpact:1,missedHighImpact:['partial-delete'],unsupportedConsequences:1,violations:1,coveredScenarios:17,requestedScenarios:18,agentTestExecution:'unobserved',manualAdjudicationRequired:true});
    const unsafe = row(good); unsafe.validation!.failures.push({check:'scope',error:'modified'});
    expect(detailedStats([row(good),unsafe]).reviewQuality.regressions).toMatchObject({scoredAttempts:1,violations:null,validatedHighImpact:null,missedHighImpact:null});
    const historical = row(good); delete historical.validation;
    expect(detailedStats([historical]).reviewQuality.regressions).toMatchObject({eligibleAttempts:1,scoredAttempts:0,violations:null});
    const empty = scoreReviewRegressions(s,{schema:REVIEW_REGRESSIONS_SCHEMA,findings:[]});
    expect(detailedStats([row(empty)]).reviewQuality.regressions).toMatchObject({scenarioCoverage:0,validatedHighImpact:0,violations:0});
  });

  it('keeps quality before cost, preserves failed credits and does not infer semantic correctness', () => {
    const s = make(), good = scoreReviewRegressions(s,s.expected), bad = scoreReviewRegressions(s,{schema:REVIEW_REGRESSIONS_SCHEMA,findings:[]});
    const arm = {profile:'/unused',runtimePaths:['/unused'],configPaths:['/unused']};
    const config = parseConfig({cli:process.execPath,python:process.execPath,runtimePaths:[process.execPath],cliConfigPaths:[process.execPath],arms:{old:arm,fabric:arm},cases:[s.id]},process.cwd());
    const plan = {config,runs:schedule(config),limitations:[]} as unknown as Parameters<typeof comparisonMetrics>[0];
    const rows = plan.runs.filter(r => r.round === 0).map(r => ({...row(r.arm === 'fabric' ? bad : good),index:r.index,arm:r.arm}));
    const report = comparisonMetrics(plan,rows);
    expect(report.comparison.fabric!.reportedCredits).toBe(0.4);
    expect(report.pairs.find(p => p.arm === 'fabric' && p.completed)).toMatchObject({bothPass:false,bothPassCreditRatio:null});
    const markdown = comparisonMarkdown(report);
    expect(markdown.indexOf('Regression scenario quality')).toBeLessThan(markdown.indexOf('Cost and execution'));
    expect(markdown).toContain('structural evidence only');
    expect(markdown).toContain('Manual/live adjudication');
    expect(markdown).toContain('not proof of source inspection or agent test execution');
  });
});
