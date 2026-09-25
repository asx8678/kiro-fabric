#!/usr/bin/env node
import { createHash } from "node:crypto";
import { captureLegacyArtifact, LEGACY_ARCHIVE_LIMITS, extractLegacyAgentArchiveBytes } from "./bundle-archive.mjs";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertTrackedGitWorktreeClean } from "./package-identity.mjs";
import { assertRealClientEvidence } from "./real-client-evidence.mjs";
import { resolveRealClientAuthFlags } from "./run-kiro-agent-real-driver.mjs";
import { validateAgentPackage } from "./validate-agent-package.mjs";
import { assertExternalDiagnosticPath, assertSafeQualificationPublication, runBoundedQualificationProcess, withQualificationFailureReport } from "./qualification-failure.mjs";

export async function certifyRealKiroAgent(argv = process.argv.slice(2)) {
  const valueAfter = flag => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined; };
  const archive = path.resolve(valueAfter("--archive") ?? ".tmp/kiro-fabric-agent.tar.gz");
  const output = path.resolve(valueAfter("--output") ?? ".tmp/kiro-agent-real-qualification.json");
  const failureOutput = path.resolve(valueAfter("--failure-output") ?? `${output}.failure.json`);
  const driverFailureOutput = `${failureOutput}.driver.json`;
  const requestedWorkRoot = valueAfter("--work-root");
  assertExternalDiagnosticPath(failureOutput, [requestedWorkRoot]);
  assertExternalDiagnosticPath(driverFailureOutput, [requestedWorkRoot]);
  if ([failureOutput, driverFailureOutput].includes(output)) throw new Error("Qualification and diagnostic outputs must differ");
  let temporary, temporaryIdentity;
  const controller = new AbortController();
  const interrupt = () => controller.abort(Object.assign(new Error("Qualification interrupted"), { code: "QUALIFICATION_INTERRUPTED" }));
  process.once("SIGTERM", interrupt); process.once("SIGINT", interrupt);
  try {
    return await withQualificationFailureReport({ output: failureOutput, component: "wrapper", cleanupKind: "authHome", cleanup: () => {
      if (!temporary) return "not-created";
      // Preserve private state and repositories without inspecting their contents.
      // Retention is NOT successful auth cleanup and cannot qualify publication.
      try {
        const current = fs.lstatSync(temporary);
        return current.isDirectory() && !current.isSymbolicLink() && temporaryIdentity &&
          ["dev", "ino", "mode", "uid", "gid"].every(key => current[key] === temporaryIdentity[key]) ? "retained" : "unverified";
      } catch { return "unverified"; }
    } }, async record => {
      const hash = bytes => createHash("sha256").update(bytes).digest("hex");
      const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
      if (head.status !== 0) throw new Error("Cannot bind real-client evidence to the current commit");
      const commit = head.stdout.trim(), expectedCommit = valueAfter("--commit") ?? process.env.GITHUB_SHA;
      if (expectedCommit && expectedCommit !== commit) throw new Error("Real-client qualification commit does not match HEAD");
      assertTrackedGitWorktreeClean();
      const driver = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "run-kiro-agent-real-driver.mjs");
      const driverDigest = hash(fs.readFileSync(driver));
      const { authMode, subscriptionLogin, subscriptionLicense, identityProvider, region } = resolveRealClientAuthFlags({
        authMode: valueAfter("--auth-mode"), subscriptionLogin: argv.includes("--subscription-login"),
        subscriptionLicense: valueAfter("--subscription-license"), identityProvider: valueAfter("--identity-provider"), region: valueAfter("--region"),
      });
      if (requestedWorkRoot) {
        if (!path.isAbsolute(requestedWorkRoot)) throw new Error("--work-root must be absolute");
        const parent = fs.realpathSync(path.dirname(requestedWorkRoot)), relative = path.relative(parent, requestedWorkRoot);
        if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("--work-root must be a direct child of an existing directory");
        fs.mkdirSync(requestedWorkRoot, { mode: 0o700 }); temporary = requestedWorkRoot;
        fs.chmodSync(temporary, 0o700); temporary = fs.realpathSync(temporary);
      } else temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kiro-agent-real-")));
      temporaryIdentity = fs.lstatSync(temporary);
      record.cleanup("authHome", "pending");
      assertExternalDiagnosticPath(output, [temporary]);
      const extracted = path.join(temporary, "package"), workspace = path.join(temporary, "workspace");
      const isolatedHome = path.join(temporary, "home"), kiroHome = path.join(isolatedHome, ".kiro");
      const installCwd = path.join(temporary, "installer-cwd"), evidence = path.join(temporary, "driver-evidence.json");
      record.phase("archive-validation");
      const archiveBytes = captureLegacyArtifact(archive, LEGACY_ARCHIVE_LIMITS.archive), archiveDigest = hash(archiveBytes);
      extractLegacyAgentArchiveBytes(archiveBytes, extracted);
      for (const directory of [workspace, isolatedHome, kiroHome, installCwd]) fs.mkdirSync(directory, { mode: 0o700 });
      const packageEvidence = validateAgentPackage(extracted), packageDigest = packageEvidence.digest;
      record.phase("driver-start"); record.cleanup("processes", "pending");
      try {
        await runBoundedQualificationProcess(process.execPath, [driver,
          "--package", extracted, "--package-digest", packageDigest, "--archive-digest", archiveDigest, "--commit", commit,
          "--workspace", workspace, "--kiro-home", kiroHome, "--home", isolatedHome, "--install-cwd", installCwd,
          "--output", evidence, "--failure-output", driverFailureOutput, "--auth-mode", authMode,
          ...(subscriptionLogin ? ["--subscription-login"] : []), ...(authMode === "subscription" ? ["--subscription-license", subscriptionLicense] : []),
          ...(identityProvider === undefined ? [] : ["--identity-provider", identityProvider, "--region", region]),
        ], { env: process.env, timeoutMs: 90 * 60_000, signal: controller.signal, interactive: subscriptionLogin, onFailure: error => record.failure(error) });
        record.cleanup("processes", "complete");
      } catch (error) { record.cleanup("processes", error.cleanupComplete === true ? "complete" : "unverified"); throw error; }
      record.phase("evidence-validation");
      const report = JSON.parse(fs.readFileSync(evidence, "utf8"));
      if (report.driver?.digest !== driverDigest) throw new Error("Repository real-client driver identity mismatch");
      const observed = assertRealClientEvidence(report, packageDigest, { archiveDigest, commit, runtimeDigest: packageEvidence.runtime.digest, skillDigest: packageEvidence.skill.digest });
      record.phase("publication");
      // Do not strip required proof and mislabel it as qualification. The legacy
      // transcript-bound schema must gain a privacy-safe successor before upload.
      assertSafeQualificationPublication(observed);
      // A valid evidence object is not authority to publish while private state
      // is retained. Never write success output before disposition is verified.
      throw Object.assign(new Error("Qualification publication blocked by private-state retention"), { code: "QUALIFICATION_STATE_RETAINED" });
    });
  } finally { process.removeListener("SIGTERM", interrupt); process.removeListener("SIGINT", interrupt); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(await certifyRealKiroAgent()); }
  catch { process.stderr.write("Real-client qualification failed; inspect the nonqualifying sanitized diagnostic. Raw output suppressed.\n"); process.exitCode = 1; }
}
