import assert from 'node:assert/strict';

/** @typedef {import('./runner.mjs').Row} Row */
/** @param {number[]} values */
function sum(values) { return values.reduce((a, b) => a + b, 0); }
/** Missing observations are never zero. @param {(number|null|undefined)[]} values */
function measured(values) {
  const known = values.filter(v => typeof v === 'number' && Number.isFinite(v) && v >= 0);
  return { value: known.length === values.length ? sum(known) : null, observed: known.length, attempts: values.length };
}
/** @param {number[]} values @param {number} fraction */
function quantile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), at = (sorted.length - 1) * fraction, lower = Math.floor(at);
  return sorted[lower] + (sorted[Math.ceil(at)] - sorted[lower]) * (at - lower);
}
/** @param {Row} row */
function calls(row) { return row.evidence?.failures.length === 0 ? row.evidence.calls.filter(c => !c.system) : null; }
/** @param {unknown} value */
function chars(value) { return value === undefined ? null : JSON.stringify(value).length; }
/** Evidence-based review scores are usable only with valid routing, identity and read-only scope.
 * Unscored/unsafe attempts remain unknown, never counted as successful findings.
 * @param {Row[]} selected */
function reviewStats(selected) {
  const reviews = selected.filter(r => r.caseId.startsWith('review-'));
  const scores = reviews.map(r => r.state === 'finished' && !r.stopReason && r.validation?.failures.every(f => f.check === 'answer') ? r.validation.review : undefined);
  const field = key => measured(scores.map(s => s?.[key])).value;
  const verifiedFindings = field('truePositives'), expected = field('expected'), reported = field('reported');
  const credits = measured(reviews.map(r => r.credits)).value;
  return { attempts: reviews.length, scoredAttempts: scores.filter(Boolean).length, expected, reported, verifiedFindings,
    falsePositives: field('falsePositives'), duplicates: field('duplicates'), reportedCredits: credits,
    precision: reported && verifiedFindings !== null ? verifiedFindings / reported : null,
    recall: expected && verifiedFindings !== null ? verifiedFindings / expected : null,
    creditsPerVerifiedFinding: verifiedFindings && credits !== null ? credits / verifiedFindings : null };
}
/** @param {Row[]} selected */
export function detailedStats(selected) {
  const passed = selected.filter(r => r.ok && r.state === 'finished').length;
  const projects = selected.filter(r => r.caseId.startsWith('bug-'));
  const repaired = projects.filter(r => r.state === 'finished' && !r.stopReason && r.validation?.probe && r.validation.probe['ok'] === true && r.validation.failures.every(f => f.check === 'answer'));
  const projectCredits = measured(projects.map(r => r.credits)).value;
  const credits = measured(selected.map(r => r.credits)), wall = measured(selected.map(r => r.process?.wallMs));
  const toolCount = measured(selected.map(r => calls(r)?.length));
  const input = measured(selected.map(r => { const c = calls(r); return c ? measured(c.map(t => chars(t.input))).value : null; }));
  const output = measured(selected.map(r => { const c = calls(r); return c ? measured(c.map(t => chars(t.output))).value : null; }));
  const latencies = selected.flatMap(r => r.process && Number.isFinite(r.process.wallMs) && r.process.wallMs >= 0 ? [r.process.wallMs] : []);
  return { attempts: selected.length, passes: passed, failures: selected.length - passed, successRate: selected.length ? passed / selected.length : null,
    reportedCredits: credits.value, creditCoverage: credits, creditsPerSuccess: passed && credits.value !== null ? credits.value / passed : null,
    wallMs: wall.value, wallCoverage: wall, medianWallMs: quantile(latencies, 0.5), p90WallMs: quantile(latencies, 0.9),
    outerToolCalls: toolCount.value, toolCallCoverage: toolCount, outerToolInputChars: input.value, outerToolOutputChars: output.value,
    clientStreamBytes: measured(selected.map(r => r.process?.outputBytes)).value,
    finalAnswerChars: measured(selected.map(r => r.evidence?.failures.length === 0 ? r.evidence.finalText.length : null)).value,
    reviewQuality: reviewStats(selected),
    projectBehavior: { attempts: projects.length, passes: repaired.length, reportedCredits: projectCredits, creditsPerRepair: repaired.length && projectCredits !== null ? projectCredits / repaired.length : null },
    inputTokens: null, outputTokens: null, cachedTokens: null, settledCurrencyCost: null, innerEffects: null,
  };
}
/** Matched tasks, never pooled unlike work. Failures stay in arm cost totals; both-pass speed ratios are explicitly conditional.
 * @param {import('./plan.mjs').Plan} plan @param {Row[]} all */
export function comparisonMetrics(plan, all) {
  assert.equal(new Set(all.map(r => r.index)).size, all.length, 'duplicate attempt');
  for (const row of all) { const run = plan.runs[row.index]; assert.ok(run && run.arm === row.arm && run.caseId === row.caseId && run.qualification === row.qualification, 'row/plan mismatch'); }
  const arms = [...new Set(plan.runs.map(r => r.arm))];
  const comparable = all.filter(r => !r.qualification);
  const cases = [...new Set(plan.runs.filter(r => !r.qualification).map(r => r.caseId))];
  const cells = cases.map(caseId => ({ caseId, arms: Object.fromEntries(arms.map(arm => [arm, detailedStats(comparable.filter(r => r.arm === arm && r.caseId === caseId))])) }));
  const pairs = [];
  for (const arm of arms.filter(a => a !== 'native')) {
    for (const run of plan.runs.filter(r => r.arm === arm && !r.qualification)) {
      const nativeRun = plan.runs.find(r => r.arm === 'native' && r.caseId === run.caseId && r.round === run.round);
      assert.ok(nativeRun && nativeRun.seed === run.seed && JSON.stringify(nativeRun.hashes) === JSON.stringify(run.hashes), 'unmatched fixture identities');
      const fabric = all.find(r => r.index === run.index), native = all.find(r => r.index === nativeRun.index);
      const completed = !!fabric && !!native && fabric.state === 'finished' && native.state === 'finished';
      const bothPass = completed && fabric.ok && native.ok;
      const ratio = (a, b) => bothPass && typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b > 0 ? a / b : null;
      pairs.push({ arm, caseId: run.caseId, round: run.round, completed, bothPass, fabricPass: fabric?.ok ?? null, nativePass: native?.ok ?? null,
        fabricCredits: fabric?.credits ?? null, nativeCredits: native?.credits ?? null,
        bothPassCreditRatio: ratio(fabric?.credits, native?.credits), bothPassWallRatio: ratio(fabric?.process?.wallMs, native?.process?.wallMs) });
    }
  }
  return { schemaVersion: 1, plannedAttempts: plan.runs.length, executedAttempts: all.length, unrunAttempts: plan.runs.length - all.length,
    requestedModel: plan.config.model ?? 'auto', requestedEffort: plan.config.effort ?? null, actualRoutedModel: null,
    allAttempts: detailedStats(all), comparison: Object.fromEntries(arms.map(arm => [arm, detailedStats(comparable.filter(r => r.arm === arm))])),
    qualification: detailedStats(all.filter(r => r.qualification)), cases, cells, pairs,
    limitations: ['Outer serialized argument/result UTF-16 character counts are not tokens, complete prompts, inner effects or wire-byte counts.', 'Unknown or incomplete telemetry remains null. Total credits include failed attempts; help qualification is excluded uniformly.', 'Auto does not pin the routed model. Repeated order-balanced observations are descriptive, not causal savings or settled billing.', ...plan.limitations] };
}
/** @param {ReturnType<typeof comparisonMetrics>} report */
export function comparisonMarkdown(report) {
  const format = value => value === null ? 'unknown' : typeof value === 'number' ? String(Math.round(value * 1000) / 1000) : String(value);
  const lines = ['# Kiro default vs Fabric Code Mode', '', `${report.executedAttempts}/${report.plannedAttempts} attempts executed; ${report.unrunAttempts} unrun. Requested model: ${report.requestedModel}.`, '',
    '| Agent | Passes / attempts | Reported credits | Credits / pass | Median seconds | Outer calls |', '| --- | ---: | ---: | ---: | ---: | ---: |'];
  for (const [arm, s] of Object.entries(report.comparison)) lines.push(`| ${arm} | ${s.passes}/${s.attempts} | ${format(s.reportedCredits)} | ${format(s.creditsPerSuccess)} | ${format(s.medianWallMs === null ? null : s.medianWallMs / 1000)} | ${format(s.outerToolCalls)} |`);
  lines.push('', '## Independent bug-repair quality', '', '| Agent | Repaired / bug attempts | Bug-task credits | Credits / repair |', '| --- | ---: | ---: | ---: |');
  for (const [arm, s] of Object.entries(report.comparison)) { const p=s.projectBehavior; lines.push(`| ${arm} | ${p.passes}/${p.attempts} | ${format(p.reportedCredits)} | ${format(p.creditsPerRepair)} |`); }
  lines.push('', '## Grounded infrastructure-review findings', '', '| Agent | Scored / review attempts | Verified findings | Precision | Recall | Credits / verified finding |', '| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const [arm, s] of Object.entries(report.comparison)) { const r = s.reviewQuality; lines.push(`| ${arm} | ${r.scoredAttempts}/${r.attempts} | ${format(r.verifiedFindings)} | ${format(r.precision)} | ${format(r.recall)} | ${format(r.creditsPerVerifiedFinding)} |`); }
  lines.push('', 'Review scores require seeded source-line evidence and valid routing/scope/process. Partial recall and false positives remain visible even when strict answer validation fails. This is a structured fixture oracle, not a universal semantic review judge.');
  lines.push('', 'A repair requires independent public/held-out checks plus routing/scope/process validity; JSON-only failures remain strict failures above.', '', 'Failed attempts are charged to their agent. Qualification requests are separate. No overall winner is inferred from missing cells or lower-quality work.', '', '## Per-case quality', '', '| Case | ' + Object.keys(report.comparison).join(' | ') + ' |', '| --- | ' + Object.keys(report.comparison).map(() => '---:').join(' | ') + ' |');
  for (const cell of report.cells) lines.push('| ' + cell.caseId + ' | ' + Object.values(cell.arms).map(s => `${s.passes}/${s.attempts}`).join(' | ') + ' |');
  lines.push('', '## Limits', '', ...report.limitations.map(s => '- ' + s));
  return lines.join('\n') + '\n';
}
/** @param {import('./plan.mjs').Plan} plan @param {Row[]} rows */
export function comparisonCsv(plan, rows) {
  const quote = value => '"' + (value === null || value === undefined ? '' : String(value)).replaceAll('"', '""') + '"';
  /** @type {(string|number|boolean|null)[][]} */
  const lines = [['index', 'arm', 'case', 'round', 'state', 'pass', 'credits', 'wall_ms', 'outer_calls', 'qualification', 'stop_reason']];
  for (const r of rows) lines.push([r.index, r.arm, r.caseId, plan.runs[r.index].round, r.state, r.ok, r.credits, r.process?.wallMs, calls(r)?.length, r.qualification, r.stopReason].map(v => v === undefined ? null : v));
  return lines.map(row => row.map(quote).join(',')).join('\n') + '\n';
}
