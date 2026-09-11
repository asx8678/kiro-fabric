/** Benchmark-only content evidence. Not proof of provider invocation, model comprehension,
 * or source inspection. The reference must come from the frozen arm, never this checkout.
 * @param {import('./stream.mjs').Evidence|undefined} evidence
 * @param {string|null|undefined} reference */
export function reviewHelpDelivery(evidence, reference) {
  const unknown = reason => ({ status: 'unknown', reason, matchedPages: 0, coveredChars: null, totalChars: reference?.length ?? null });
  if (typeof reference !== 'string' || !reference.length || reference.length > 100000) return unknown('frozen-reference-unavailable');
  if (!evidence || evidence.failures.length) return unknown('incomplete-event-evidence');
  const ranges = [];
  let nodes = 0, incomplete = false, mismatch = false, terminal = false;
  function visit(value, depth = 0) {
    if (++nodes > 20000 || depth > 16) { incomplete = true; return; }
    if (typeof value === 'string') {
      if (value.length > 2000000) { incomplete = true; return; }
      try { visit(JSON.parse(value), depth + 1); } catch { /* Non-JSON text is not a structured help page. */ }
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value) && value.topic === 'review' && typeof value.text === 'string' && typeof value.truncated === 'boolean') {
      const keys = Object.keys(value).sort().join(',');
      const end = value.truncated ? value.nextOffset : reference.length;
      const start = end - value.text.length;
      if (keys !== (value.truncated ? 'nextOffset,text,topic,truncated' : 'text,topic,truncated') ||
          !Number.isSafeInteger(end) || start < 0 || end > reference.length ||
          (value.truncated && (!value.text.length || end >= reference.length)) ||
          reference.slice(start, end) !== value.text) { mismatch = true; return; }
      ranges.push([start, end]);
      if (!value.truncated) terminal = true;
      return;
    }
    for (const child of Object.values(value)) { if (nodes > 20000) { incomplete = true; break; } visit(child, depth + 1); }
  }
  for (const call of evidence.calls) {
    if (call.system || call.origin !== 'fabric' || !/fabric_exec/.test(call.title) || call.status !== 'completed') continue;
    if (call.output === undefined) incomplete = true;
    else visit(call.output);
  }
  if (incomplete || mismatch) return unknown(mismatch ? 'mismatched-help-page' : 'bounded-output-scan-incomplete');
  let covered = 0;
  for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
    if (start > covered) break;
    covered = Math.max(covered, end);
  }
  return { status: covered === reference.length && terminal ? 'complete' : ranges.length ? 'partial' : 'unobserved',
    reason: 'observed-result-content-only', matchedPages: ranges.length, coveredChars: covered, totalChars: reference.length };
}
