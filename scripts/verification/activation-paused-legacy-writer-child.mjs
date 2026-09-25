// W5 activation qualification support: run an authentic legacy Agent writer in a
// child process and optionally pause it at a commit step while it holds the
// legacy gate. Historical bytes come from the pinned immutable text fixture;
// maintained bytes come from the byte-current entry. No recursive cleanup.

import fs from "node:fs";
import { loadHistoricalInstaller, loadMaintainedInstaller } from "./w5-callers-legacy.mjs";
import { installLegacyCleanupGuard } from "./activation-legacy-cleanup.mjs";

const request = JSON.parse(process.argv[2]);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const cleanupGuard = installLegacyCleanupGuard(request.taskRoot);
const loaded = request.mode === "historical"
  ? await loadHistoricalInstaller(request.repoRoot, request.cacheDir)
  : await loadMaintainedInstaller(request.repoRoot, request.cacheDir, { inertTrust: true });
if (request.mode === "historical" && !loaded.available) {
  process.stderr.write("historical-unavailable:" + loaded.reason + "\n");
  process.exit(3);
}
if (request.mode === "maintained" && !loaded.module) {
  process.stderr.write("maintained-unavailable:" + (loaded.unavailable ?? "unknown") + "\n");
  process.exit(3);
}

function pause(step) {
  fs.writeFileSync(request.markerFile, step + "\n", { mode: 0o600, flag: "wx" });
  process.stdout.write("PAUSED:" + step + "\n");
  const deadline = Date.now() + (request.pauseBudgetMs ?? 120000);
  while (!fs.existsSync(request.releaseFile)) {
    if (Date.now() > deadline) throw new Error("writer pause budget exceeded");
    sleep(100);
  }
}

// Guard was installed before loading either transitive legacy closure.
try {
  loaded.module.installUserAgent(request.pkg, { KIRO_HOME: request.home }, request.user, {
    onCommitStep: (step) => { if (request.pauseStep && step === request.pauseStep) pause(step); },
    onCleanupStep: () => { throw new Error("probe: stop before cleanup"); },
  });
  process.stdout.write("COMPLETED\n");
  process.exit(0);
} catch (error) {
  process.stdout.write("ERROR:" + (error?.message ?? String(error)) + "\n");
  process.exit(2);
} finally {
  cleanupGuard.restore();
}
