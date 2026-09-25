// Independent completeness contract. This is runner infrastructure, not case code.
const range = (prefix, count) => Object.freeze(Array.from({ length: count }, (_, i) => prefix + String(i + 1).padStart(2, "0")));
const CASE_CONTRACT = Object.freeze({
  baseline: range("BASE-", 8),
  installer: range("I", 9),
  runtime: range("NB", 6),
  quality: range("CQ", 3),
  lifecycle: range("LC", 30),
  locking: range("LK", 24),
  boundaries: range("SB", 8),
  contracts: range("CT", 8),
  activation: range("ACT-", 8),
  "semantic-baseline": range("FN", 7),
  "qualification-safety": range("QN", 5),
  "self-test-pass": Object.freeze(["SELFTEST-PASS"]),
  "self-test-fail": Object.freeze(["SELFTEST-FAIL"]),
  "self-test-empty": Object.freeze([]),
});

/** Validate independently of a suite's own requiredIds export.
 * @param {string} suite @param {unknown} cases @param {unknown} declaredIds
 * @returns {{problems:string[], requiredIds:readonly string[], missingRequired:string[]}}
 */
export function validateCaseRegistry(suite, cases, declaredIds) {
  const requiredIds = Object.hasOwn(CASE_CONTRACT, suite) ? CASE_CONTRACT[suite] : [];
  const problems = [];
  if (!Object.hasOwn(CASE_CONTRACT, suite)) problems.push("unknown suite contract: " + suite);
  if (!Array.isArray(declaredIds) || declaredIds.length === 0) problems.push("required case IDs must be a nonempty array");
  else if (declaredIds.length !== requiredIds.length || declaredIds.some((id, i) => id !== requiredIds[i])) problems.push("required case IDs differ from independent contract: " + suite);
  const entries = Array.isArray(cases) ? cases : [];
  if (entries.length === 0) problems.push("empty case registry: zero cases would report success");
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== "string" || !entry.id) { problems.push("case is missing a fixed string id"); continue; }
    if (seen.has(entry.id)) problems.push("duplicate case id: " + entry.id);
    seen.add(entry.id);
    if (!requiredIds.includes(entry.id)) problems.push("unknown case id: " + entry.id);
    if (typeof entry.run !== "function" && entry.implemented !== true && typeof entry.unavailable !== "string") problems.push("case has no implementation: " + entry.id);
    if (entry.deadlineMs !== undefined && (!Number.isSafeInteger(entry.deadlineMs) || entry.deadlineMs < 1 || entry.deadlineMs > 900000)) problems.push("invalid case deadline: " + entry.id);
  }
  const missingRequired = requiredIds.filter(id => !seen.has(id));
  if (missingRequired.length) problems.push("omitted required cases: " + missingRequired.join(", "));
  return { problems, requiredIds, missingRequired };
}

/** A fulfilled promise alone is not complete coverage.
 * @param {unknown} facts @returns {string|null}
 */
export function incompleteCaseResult(facts) {
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) return "case must return a facts object";
  const record = /** @type {Record<string,unknown>} */ (facts);
  if (Object.hasOwn(record, "coverageGaps") && (!Array.isArray(record.coverageGaps) || record.coverageGaps.length > 0)) return "case reports incomplete coverage";
  if (Object.hasOwn(record, "status") && record.status !== "passed") return "case reports non-passing coverage status";
  return null;
}
