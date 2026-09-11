import assert from 'node:assert/strict';
import { object } from './core.mjs';

export const REVIEW_QUALITY_SCHEMA = 'review-adherence/v1';

// This is a finite, fixture-specific oracle, NOT a semantic judge. IDs below name
// controlled propositions and deterministic local probe inputs, not prose labels
// whose equality demonstrates truth. probeReviewFixture independently executes
// those inputs. An answer naming a proof is not evidence that the agent ran it.
// Free-text headline/explanation meaning, actual inspection/coverage, proof execution,
// and transfer to live reviews require manual/live adjudication (never inferred here).
const claims = {
  'unnecessary-save': { consequence: 'unchanged-file-saved', proof: 'changed-then-unchanged', counterexample: 'unchanged-before-change', file: 'scripts/cleanup.mjs' },
  'masked-validation-exit': { consequence: 'validator-failure-reported-success', proof: 'validator-seven-wrapper-zero', counterexample: 'direct-validator-seven', file: 'scripts/check.sh' },
};
const controls = {
  'missed-removals': 'adjacent-expired-removed',
  'skipped-nodes': 'snapshot-iteration',
  'empty-division': 'empty-batch-no-iteration',
  'config-key-case': 'nondefault-restart-policy',
  'disabled-cleanup': 'runtime-true-and-false',
};
const consequences = ['unchanged-file-saved', 'validator-failure-reported-success', 'expired-nodes-retained', 'division-by-zero', 'restart-policy-ignored', 'cleanup-never-enabled'];
const proofs = [...Object.values(claims).map(c => c.proof), ...Object.values(controls), 'none'];
const counterexamples = [...Object.values(claims).map(c => c.counterexample), ...Object.values(controls), 'none'];

/** @typedef {{version:string,assessedFindings:number,unsupportedConsequences:number,headlineMismatches:number,unsupportedProofs:number,selfDisprovedFindings:number,unsupportedConfirmed:number,conditionalClaims:number,unresolvedConditionalClaims:number,counterexampleOmissions:number,coverageClaims:number,coverageOverclaims:number,invalidCoverageEvidence:number,omittedEvidenceFiles:number,violations:number,manualAdjudicationRequired:boolean,limitations:string[]}} ReviewQuality */
/** @param {import('./cases.mjs').Case} base @returns {import('./cases.mjs').Case} */
export function makeAdherenceReviewCase(base) {
  const expected = /** @type {{findings:import('./reviews.mjs').Finding[]}} */ (base.expected);
  const findings = expected.findings.map(f => {
    const c = claims[f.kind];
    return { ...f, consequence: c.consequence, headline: c.consequence, explanation: c.consequence,
      confidence: 'confirmed', proof: c.proof, counterexample: { id: c.counterexample, effect: 'limits' } };
  });
  const files = { ...base.files };
  // Coverage is evidence-backed report scope, not a self-attested claim to have read files.
  const coverage = { scope: 'exhaustive', evidence: Object.entries(files).map(([path, text]) => ({ path, line: 1, text: text.split('\n')[0] })) };
  return { ...base, id: 'review-adherence', files, expected: { schema: REVIEW_QUALITY_SCHEMA, findings, coverage },
    prompt: 'Review this maintenance project under README.md contracts. Work only inside this disposable workspace. Change no files; no network, installation, persistent memory or delegation. Return only raw JSON with exactly {schema:"' + REVIEW_QUALITY_SCHEMA + '",findings:[{kind,evidence:[{path,line,text}],consequence,headline,explanation,confidence,proof,counterexample:{id,effect}}],coverage:{scope,evidence:[{path,line,text}]}}. Evidence uses relative paths, one-based integer lines and exact source text. kind is one of ' + JSON.stringify([...Object.keys(claims), ...Object.keys(controls)]) + '. consequence, headline and explanation are structured proposition IDs, each one of ' + JSON.stringify(consequences) + '; not free prose. confidence is confirmed or conditional. proof names a controlled local scenario, one of ' + JSON.stringify(proofs) + '. Counterexample id is one of ' + JSON.stringify(counterexamples) + '; effect is limits, disproves or untested. Scenarios: changed-then-unchanged uses a changed file followed by an unchanged file; unchanged-before-change reverses that order. validator-seven-wrapper-zero compares the validator and wrapper statuses; direct-validator-seven runs the validator directly. Other scenario IDs describe adjacent expired nodes, snapshot iteration, an empty batch, non-default OnFailure and both runtime booleans. Identify supported consequences, not merely suspicious source lines. Do not claim a scenario proves something it does not. coverage.scope is partial or exhaustive; cite at least one real line from each file you claim covered. Exhaustive means every supplied file, not every possible behavior. Conditional claims remain unresolved, not verified bugs. Deduplicate; not every kind applies. These controlled claims do not replace manual adjudication of real review prose or prove you executed probes.' };
}

function keys(value, expected, label) { assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), label); }
function member(value, values, label) { assert.ok(values.includes(value), label); }
/** @param {import('./cases.mjs').Case} spec @param {unknown} answer
 * @param {(spec:import('./cases.mjs').Case, answer:unknown)=>import('./reviews.mjs').ReviewScore} scoreGrounding
 * @returns {import('./reviews.mjs').ReviewScore & {quality:ReviewQuality}} */
export function scoreReviewQuality(spec, answer, scoreGrounding) {
  const value = object(answer);
  keys(value, ['schema', 'findings', 'coverage'], 'adherence answer schema');
  assert.equal(value.schema, REVIEW_QUALITY_SCHEMA);
  assert.ok(Array.isArray(value.findings) && value.findings.length <= 100, 'bounded findings');
  /** @type {ReviewQuality} */
  const quality = { version: REVIEW_QUALITY_SCHEMA, assessedFindings: value.findings.length,
    unsupportedConsequences: 0, headlineMismatches: 0, unsupportedProofs: 0, selfDisprovedFindings: 0,
    unsupportedConfirmed: 0, conditionalClaims: 0, unresolvedConditionalClaims: 0, counterexampleOmissions: 0,
    coverageClaims: 1, coverageOverclaims: 0, invalidCoverageEvidence: 0, omittedEvidenceFiles: 0, violations: 0,
    manualAdjudicationRequired: true,
    limitations: ['Finite fixture propositions only; not general semantic judging.', 'Manual/live adjudication required for prose meaning, actual read coverage and proof execution.'] };
  const findings = value.findings.map(raw => {
    const f = object(raw);
    keys(f, ['kind', 'evidence', 'consequence', 'headline', 'explanation', 'confidence', 'proof', 'counterexample'], 'adherence finding schema');
    member(f.kind, [...Object.keys(claims), ...Object.keys(controls)], 'kind');
    for (const key of ['consequence', 'headline', 'explanation']) member(f[key], consequences, key);
    member(f.confidence, ['confirmed', 'conditional'], 'confidence');
    member(f.proof, proofs, 'proof');
    const counter = object(f.counterexample);
    keys(counter, ['id', 'effect'], 'counterexample schema');
    member(counter.id, counterexamples, 'counterexample id');
    member(counter.effect, ['limits', 'disproves', 'untested'], 'counterexample effect');
    const c = claims[String(f.kind)];
    const supported = !!c && f.consequence === c.consequence && f.explanation === c.consequence;
    const consistent = f.headline === f.explanation && f.headline === f.consequence;
    const proofSupported = supported && f.proof === c.proof;
    // A limiting case does not negate an existential defect. A control does.
    const disproved = counter.effect === 'disproves' || !!controls[String(f.kind)] && counter.id === controls[String(f.kind)];
    const counterSupported = !!c && counter.id === c.counterexample && counter.effect === 'limits';
    const grounded = scoreGrounding(spec, { findings: [{ kind: f.kind, evidence: f.evidence }] }).truePositives === 1;
    quality.unsupportedConsequences += Number(!supported);
    quality.headlineMismatches += Number(!consistent);
    quality.unsupportedProofs += Number(!proofSupported);
    quality.selfDisprovedFindings += Number(disproved);
    quality.counterexampleOmissions += Number(!counterSupported);
    const justified = supported && proofSupported && grounded && consistent && !disproved && counterSupported;
    quality.unsupportedConfirmed += Number(f.confidence === 'confirmed' && !justified);
    quality.conditionalClaims += Number(f.confidence === 'conditional');
    quality.unresolvedConditionalClaims += Number(f.confidence === 'conditional' && !justified);
    quality.violations += Number(!justified);
    return { kind: f.kind, evidence: f.evidence };
  });
  const coverage = object(value.coverage);
  keys(coverage, ['scope', 'evidence'], 'coverage schema');
  member(coverage.scope, ['partial', 'exhaustive'], 'coverage scope');
  assert.ok(Array.isArray(coverage.evidence) && coverage.evidence.length <= 256, 'bounded coverage evidence');
  const covered = new Set();
  for (const raw of coverage.evidence) {
    const row = object(raw);
    keys(row, ['path', 'line', 'text'], 'coverage evidence schema');
    assert.ok(typeof row.path === 'string' && typeof row.text === 'string' && Number.isSafeInteger(row.line) && Number(row.line) >= 1, 'coverage evidence types');
    if (Object.hasOwn(spec.files, row.path) && spec.files[row.path].split('\n')[Number(row.line) - 1] === row.text) covered.add(row.path);
    else quality.invalidCoverageEvidence++;
  }
  quality.omittedEvidenceFiles = Object.keys(spec.files).filter(p => !covered.has(p)).length;
  quality.coverageOverclaims = Number(coverage.scope === 'exhaustive' && quality.omittedEvidenceFiles > 0);
  quality.violations += quality.coverageOverclaims + quality.invalidCoverageEvidence;
  // Keep historical defect recall/FP separate from quality (a true location can
  // have a false consequence). Consumers must gate on quality.violations too if
  // they require adherence; validate() gates both recall/FP and quality violations.
  return { ...scoreGrounding(spec, { findings }), quality };
}
