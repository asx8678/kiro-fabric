// W5 activation qualification support: run a real managed activation in a child
// process and pause it at a chosen onPhase boundary, holding the shared
// exclusion. The staged bundle is supplied by the caller. No recursive cleanup;
// the fixture home is retained on success or failure.

import fs from "node:fs";
import { installCompleteGeneration } from "../managed-installation.mjs";
import { smokeCandidate } from "../installer-smoke.mjs";
import { admitCurrentActivationBundle } from "./activation-bundle.mjs";

const request = JSON.parse(process.argv[2]);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function pause(phase) {
  fs.writeFileSync(request.markerFile, phase + "\n", { mode: 0o600, flag: "wx" });
  process.stdout.write("PAUSED:" + phase + "\n");
  const deadline = Date.now() + (request.pauseBudgetMs ?? 120000);
  while (!fs.existsSync(request.releaseFile)) {
    if (Date.now() > deadline) throw new Error("activation pause budget exceeded");
    sleep(100);
  }
}

try {
  const admitted = await admitCurrentActivationBundle({ repoRoot: request.repoRoot, bundleRoot: request.bundleRoot, taskRoot: request.bundleTaskRoot, publicSelection: request.publicSelection === true });
  if (admitted.digest !== request.expectedDigest) throw Error('Child activation bundle identity changed after parent admission');
  const phases = [];
  const result = await installCompleteGeneration(request.bundleRoot, {
    kiroHome: request.home,
    provenance: "source",
    validateCandidate: smokeCandidate,
    onPhase: (phase) => {
      phases.push(phase);
      if (request.pausePhase && phase === request.pausePhase) pause(phase);
    },
  });
  process.stdout.write("RESULT:" + JSON.stringify({ schemaVersion: 1, outcome: result.outcome, status: result.status, digest: result.digest, committed: result.committed, restartRequired: result.restartRequired }) + "\n");
  process.exit(0);
} catch (error) {
  process.stdout.write("ERROR:" + (error?.message ?? String(error)) + "\n");
  process.exit(2);
}
