#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assertTrackedGitWorktreeClean } from "./package-identity.mjs";
import { isPackedPackageFileAllowed } from "./package-policy.mjs";
import { assertRealClientEvidence } from "./real-client-evidence.mjs";
import { validateReleaseArtifacts, writeReleaseAssetSnapshots } from "./release-artifacts.mjs";

const valueAfter = (flag) => { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; };
const output = path.resolve(valueAfter("--output") ?? ".tmp/release-candidate.json");
const sbomPath = path.resolve(valueAfter("--sbom") ?? ".tmp/kiro-fabric-agent.spdx.json");
const archivePath = path.resolve(valueAfter("--archive") ?? ".tmp/kiro-fabric-agent.tar.gz");
const stage = path.resolve(".tmp/kiro-fabric-agent");
const closureRoot = path.resolve("dist/kiro-agent-closure");
const artifacts = validateReleaseArtifacts(stage, archivePath, sbomPath, closureRoot);
const { packageResult, packageDigest, sbomDigest, sbomFileDigest, archiveDigest } = artifacts;
const packed = spawnSync("pnpm", ["pack", "--dry-run", "--json", "--config.ignore-scripts=true"], { encoding: "utf8", timeout: 60_000 });
if (packed.error) throw packed.error;
if (packed.status !== 0) throw new Error(`package dry-run failed: ${packed.stderr ?? packed.stdout}`);
const packedDocument = JSON.parse(packed.stdout);
const packedFiles = (Array.isArray(packedDocument) ? packedDocument[0] : packedDocument).files.map((entry) => entry.path);
if (packedFiles.some((file) => !isPackedPackageFileAllowed(file))) {
  throw new Error("packed artifact contains a file outside the exact Agent allowlist");
}
for (const required of ["dist/index.js", "dist/runtime/compiler-worker-entry.js", "dist/index.d.ts"]) {
  if (!packedFiles.includes(required)) throw new Error(`packed artifact is missing ${required}`);
}
if (!packedFiles.some((file) => /^dist\/chunks\/[^/]+\.js$/u.test(file))) {
  throw new Error("packed artifact is missing the main runtime chunk");
}
const packedSet = new Set(packedFiles);
for (const file of packedFiles.filter((entry) => entry.endsWith(".js"))) {
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(/(?:from\s*|import\()\s*["'](\.[^"']+)["']/gu)) {
    const target = path.normalize(path.join(path.dirname(file), match[1])).replaceAll("\\", "/");
    if (!packedSet.has(target)) throw new Error(`packed runtime import is missing: ${file} -> ${target}`);
  }
}
const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
if (head.status !== 0) throw new Error("Cannot bind release candidate to HEAD");
const commit = head.stdout.trim();
const expectedCommit = valueAfter("--commit") ?? process.env.GITHUB_SHA;
if (expectedCommit && expectedCommit !== commit) throw new Error("Release candidate commit does not match HEAD");
assertTrackedGitWorktreeClean();
const tag = valueAfter("--tag") ?? null;
if (tag !== null && tag !== `v${packageResult.version}`) throw new Error("Release tag does not match package version");
const qualificationPath = valueAfter("--qualification");
/** @type {{ status: "not-run", evidence: string } | { status: "passed", evidenceDigest: string }} */
let realClient = { status: "not-run", evidence: "Explicit real-client qualification was not supplied; no pass is claimed." };
let qualificationBytes;
if (qualificationPath) {
  const qualificationFile = path.resolve(qualificationPath);
  const qualificationStats = fs.lstatSync(qualificationFile);
  if (!qualificationStats.isFile() || qualificationStats.isSymbolicLink() || qualificationStats.nlink !== 1 || qualificationStats.size > 2 * 1024 * 1024) {
    throw new Error("real-client qualification must be a bounded single-link regular file");
  }
  qualificationBytes = fs.readFileSync(qualificationFile);
  assertRealClientEvidence(
    JSON.parse(qualificationBytes.toString("utf8")),
    packageDigest,
    {
      qualification: true,
      archiveDigest,
      commit,
      runtimeDigest: packageResult.runtime.digest,
      skillDigest: packageResult.skill.digest,
    },
  );
  realClient = { status: "passed", evidenceDigest: createHash("sha256").update(qualificationBytes).digest("hex") };
}
const reportBody = {
  kind: "kiro-fabric.release-candidate",
  schemaVersion: 2,
  ok: packageResult.ok && typeof sbomDigest === "string",
  releaseReady: packageResult.ok && typeof sbomDigest === "string" && realClient.status === "passed",
  version: packageResult.version,
  tag,
  commit,
  packageDigest,
  archiveDigest,
  sbomPackageDigest: sbomDigest,
  sbomFileDigest,
  closureManifestDigest: createHash("sha256").update(fs.readFileSync(path.join(closureRoot, "closure-manifest.json"))).digest("hex"),
  packedFiles,
  realClient,
};
const report = { ...reportBody, checksum: createHash("sha256").update("kiro-fabric-release-candidate-v2\0").update(JSON.stringify(reportBody)).digest("hex") };
if (process.argv.includes("--require-release-ready") && !report.releaseReady) throw new Error("Release candidate is not release-ready");
const assets = valueAfter("--assets");
if (assets) {
  if (!report.releaseReady || !qualificationBytes) throw new Error("Cannot promote release assets without exact qualification");
  writeReleaseAssetSnapshots(path.resolve(assets), artifacts, qualificationBytes);
}
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(output);
