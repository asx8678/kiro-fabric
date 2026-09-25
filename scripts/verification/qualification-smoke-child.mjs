// Bounded child seam: invoke the REAL production `smokeCandidate` against an
// inert task-owned fixture bundle and report the truthful outcome. No native or
// authenticated material is launched; this is not runnable/native evidence.
import { smokeCandidate } from "../installer-smoke.mjs";

if (process.argv.length !== 3) throw new Error("inert smoke child requires one fixed request");
const request = JSON.parse(process.argv[2]);
if (!request || typeof request.bundleRoot !== "string" || !request.bundleRoot) throw new Error("invalid inert smoke request");

let outcome;
try {
  const value = await smokeCandidate(request.bundleRoot);
  outcome = { schemaVersion: 1, rejected: false, result: value };
} catch (error) {
  outcome = { schemaVersion: 1, rejected: true, error: error instanceof Error ? error.message : String(error) };
}
process.stdout.write(JSON.stringify(outcome) + "\n");
