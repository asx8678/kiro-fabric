#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { BUG_CASES, makeBugCase, probeProject } from './steering-benchmark/projects.mjs';
import { caseHashes, makeCase } from './steering-benchmark/cases.mjs';
import { REVIEW_CASES, makeReviewCase, probeReviewFixture, scoreReview } from './steering-benchmark/reviews.mjs';
import { putFiles, save } from './steering-benchmark/core.mjs';
import { REVIEW_QUALITY_SCHEMA } from './steering-benchmark/review-quality.mjs';
import { REVIEW_CALIBRATION_SCHEMA } from './steering-benchmark/review-calibration.mjs';
import { REVIEW_REGRESSION_CASES, REVIEW_REGRESSIONS_SCHEMA, makeRegressionReviewCase, probeRegressionReviewFixture, scoreReviewRegressions } from './steering-benchmark/review-regressions.mjs';
import { loadPlan, rows, privateOutput } from './steering-benchmark/runner.mjs';
import { comparisonMetrics, comparisonMarkdown, comparisonCsv } from './steering-benchmark/metrics.mjs';

export const usage = `node scripts/agent-comparison.mjs fixtures --out /private/new-lab [--seed tinyshop-v1]
node scripts/agent-comparison.mjs selftest
node scripts/agent-comparison.mjs report --out /private/live-results --dest /private/new-report
No inference in these commands. Live plans use scripts/steering-benchmark.mjs.
fixtures never exports held-out tests or reference solutions into agent workspaces.
selftest proves buggy fixtures fail, reference repairs pass, and review defects are reproducible; these are NOT agent statistics.`;
/** @param {string[]} argv */
export async function main(argv) {
  const [action, ...rest] = argv;
  if (action === '--help' && !rest.length) return { usage };
  const allowed = { fixtures: ['out', 'seed'], selftest: [], report: ['out', 'dest'] };
  assert.ok(Object.hasOwn(allowed, action), usage);
  const args = {};
  for (let i = 0; i < rest.length; i += 2) { const name = rest[i].replace(/^--/, ''); assert.ok(rest[i].startsWith('--') && allowed[action].includes(name) && rest[i + 1] && !Object.hasOwn(args, name), 'invalid/duplicate option'); args[name] = rest[i + 1]; }
  if (action === 'fixtures') {
    assert.ok(args.out, '--out required'); fs.mkdirSync(args.out, { mode: 0o700 }); const root = privateOutput(args.out), seed = args.seed ?? 'tinyshop-v1';
    const tasks = [];
    for (const id of [...BUG_CASES, ...REVIEW_CASES, ...REVIEW_REGRESSION_CASES]) { const spec = makeCase(id, seed), workspace = path.join(root, id); fs.mkdirSync(workspace, { mode: 0o700 }); putFiles(workspace, spec.files); fs.writeFileSync(path.join(root, id + '-prompt.txt'), spec.prompt + '\n', { mode: 0o600, flag: 'wx' }); tasks.push({ id, workspace, hashes: caseHashes(spec) }); }
    const manifest = { fixtureVersion: 'tinyshop-and-review-v6', seed, inferenceRequests: 0, tasks }; save(path.join(root, 'fixtures.json'), manifest); return manifest;
  }
  if (action === 'selftest') {
    let rejectedBuggy = 0, acceptedReference = 0;
    for (const seed of ['tinyshop-v1', 'tinyshop-v2']) for (const id of BUG_CASES) {
      const spec = makeBugCase(id, seed);
      await assert.rejects(probeProject(spec, {}), /public project contract/); rejectedBuggy++;
      assert.equal((await probeProject(spec, spec.solution)).ok, true); acceptedReference++;
    }
    let qualifiedReviews = 0;
    for (const seed of ['review-v1', 'review-v2']) for (const id of REVIEW_CASES) {
      const spec = makeReviewCase(id, seed);
      assert.equal((await probeReviewFixture(spec)).ok, true);
      const empty = id === 'review-adherence' ? { schema: REVIEW_QUALITY_SCHEMA, findings: [], coverage: { scope: 'partial', evidence: [] } }
        : id === 'review-calibration' ? { schema: REVIEW_CALIBRATION_SCHEMA, findings: [] } : { findings: [] };
      assert.equal(scoreReview(spec, empty).recall, 0);
      qualifiedReviews++;
    }
    let qualifiedRegressions = 0;
    for (const seed of ['regression-v1', 'regression-v2']) for (const id of REVIEW_REGRESSION_CASES) {
      const spec = makeRegressionReviewCase(id, seed);
      assert.equal((await probeRegressionReviewFixture(spec)).ok, true);
      assert.equal(scoreReviewRegressions(spec, { schema: REVIEW_REGRESSIONS_SCHEMA, findings: [] }).recall, 0);
      const reference = scoreReviewRegressions(spec, spec.expected);
      assert.equal(reference.recall, 1);
      assert.equal(reference.regressions.violations, 0);
      assert.equal(reference.regressions.scenarioCoverage, 1);
      qualifiedRegressions++;
    }
    return { rejectedBuggy, acceptedReference, qualifiedReviews, qualifiedRegressions, inferenceRequests: 0, syntheticEvidenceOnly: true };
  }
  assert.ok(args.out && args.dest, '--out and --dest required');
  const plan = loadPlan(args.out), observations = rows(privateOutput(args.out)), report = comparisonMetrics(plan, observations);
  fs.mkdirSync(args.dest, { mode: 0o700 }); const dest = privateOutput(args.dest);
  save(path.join(dest, 'comparison.json'), report);
  fs.writeFileSync(path.join(dest, 'comparison.md'), comparisonMarkdown(report), { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(path.join(dest, 'attempts.csv'), comparisonCsv(plan, observations), { mode: 0o600, flag: 'wx' });
  return { dest, attempts: observations.length, planned: plan.runs.length, reportedCredits: report.allAttempts.reportedCredits };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(String(error)); process.exitCode = 1; }
}
