// W5 activation qualification support: hold the REAL reviewed installation
// exclusion (legacy `.install.lock` gate plus modern `.install-lock`) on an
// otherwise-empty home using the maintained acquireInstallationExclusion path.
// No payload is written, so the home stays admissible apart from the held gates.
// Release uses the maintained release callback; there is no recursive cleanup.

import fs from "node:fs";
import path from "node:path";
import { acquireInstallationExclusion } from "../installer-lock.mjs";

const request = JSON.parse(process.argv[2]);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const base = path.join(request.home, "kiro-fabric");
fs.mkdirSync(request.home, { recursive: true, mode: 0o700 });
fs.chmodSync(request.home, 0o700);
fs.mkdirSync(base, { recursive: true, mode: 0o700 });
fs.chmodSync(base, 0o700);

let release;
try {
  release = acquireInstallationExclusion(base, { recover: false });
} catch (error) {
  process.stdout.write("ERROR:" + (error?.message ?? String(error)) + "\n");
  process.exit(2);
}
fs.writeFileSync(request.markerFile, "legacy-gate-held\n", { mode: 0o600, flag: "wx" });
process.stdout.write("PAUSED:legacy-gate\n");

try {
  const deadline = Date.now() + (request.pauseBudgetMs ?? 60000);
  while (!fs.existsSync(request.releaseFile)) {
    if (Date.now() > deadline) throw new Error("legacy gate pause budget exceeded");
    sleep(100);
  }
} catch (error) {
  process.stdout.write("ERROR:" + (error?.message ?? String(error)) + "\n");
  process.exit(2);
}

release();
if (release.releasedLegacyGate !== true) {
  process.stdout.write("ERROR:legacy gate release not confirmed\n");
  process.exit(2);
}
process.stdout.write("RESULT:" + JSON.stringify({ schemaVersion: 1, released: true, releasedLegacyGate: release.releasedLegacyGate, releasedModernLock: true }) + "\n");
process.exit(0);
