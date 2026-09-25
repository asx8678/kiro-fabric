// W5 caller regression support: run the authentic reconstructed pre-W5
// installer as a real child process and pause it (holding the legacy gate) at a
// chosen commit step. Recursive cleanup is intercepted; no executable launches.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadHistoricalInstaller } from "./w5-callers-legacy.mjs";

const request = JSON.parse(process.argv[2]);
const { repoRoot, home, user, pkg, pauseStep, cacheDir } = request;
const manifest = path.join(home, "kiro-fabric", "install-owner.json");

const loaded = await loadHistoricalInstaller(repoRoot, cacheDir);
if (!loaded.available) { process.stderr.write("historical-unavailable:" + loaded.reason + "\n"); process.exit(3); }

const originalRm = fs.rmSync;
fs.rmSync = () => { throw new Error("probe: recursive cleanup denied"); };
try {
  loaded.module.installUserAgent(pkg, { KIRO_HOME: home }, user, {
    onCommitStep: (step) => {
      if (step === pauseStep) {
        const state = fs.existsSync(manifest) ? "sha:" + createHash("sha256").update(fs.readFileSync(manifest)).digest("hex") : "absent";
        process.stdout.write("PAUSED:" + step + ":" + state + "\n");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
      }
    },
    onCleanupStep: () => { throw new Error("probe: stop before cleanup"); },
  });
} catch (error) {
  process.stderr.write("child-error:" + (error?.message ?? String(error)) + "\n");
  process.exit(2);
} finally {
  fs.rmSync = originalRm;
}
process.stdout.write("COMPLETED\n");
