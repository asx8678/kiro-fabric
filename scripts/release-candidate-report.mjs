#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isPackedPackageFileAllowed } from "./package-policy.mjs";
import { assertRealClientEvidence } from "./real-client-evidence.mjs";
import { digestAgentPackage, validateAgentPackage } from "./validate-agent-package.mjs";

const valueAfter = (flag) => { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; };
const output = path.resolve(valueAfter("--output") ?? ".tmp/release-candidate.json");
const sbomPath = path.resolve(valueAfter("--sbom") ?? ".tmp/kiro-fabric-agent.spdx.json");
const archivePath = path.resolve(valueAfter("--archive") ?? ".tmp/kiro-fabric-agent.tar.gz");
const stage = path.resolve(".tmp/kiro-fabric-agent");
const packageResult = validateAgentPackage(stage);
const packageDigest = digestAgentPackage(stage, { excludeOwner: true }).digest;
const sbomBytes = fs.readFileSync(sbomPath);
const sbom = JSON.parse(sbomBytes.toString("utf8"));
const sbomDigest = sbom.packages?.[0]?.checksums?.[0]?.checksumValue;
const sbomFileDigest = createHash("sha256").update(sbomBytes).digest("hex");
const archiveBytes = fs.readFileSync(archivePath);
const archiveDigest = createHash("sha256").update(archiveBytes).digest("hex");
const archiveTemporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-release-archive-"));
try {
  const snapshot = path.join(archiveTemporary, "package.tar.gz");
  const extracted = path.join(archiveTemporary, "package");
  fs.writeFileSync(snapshot, archiveBytes, { mode: 0o600 });
  fs.mkdirSync(extracted, { mode: 0o700 });
  const unpack = spawnSync("tar", ["-xzf", snapshot, "-C", extracted], { encoding: "utf8" });
  if (unpack.error || unpack.status !== 0) throw unpack.error ?? new Error(`Release archive extraction failed: ${unpack.stderr}`);
  if (validateAgentPackage(extracted).digest !== packageDigest) throw new Error("Release archive is not bound to the exact staged package");
} finally { fs.rmSync(archiveTemporary, { recursive: true, force: true }); }
const closureRoot = path.resolve("dist/kiro-agent-closure");
if (sbomDigest !== packageDigest) {
  throw new Error("SBOM is not bound to the exact complete staged Agent package");
}
const closureManifest = JSON.parse(fs.readFileSync(path.join(closureRoot, "closure-manifest.json"), "utf8"));
const sbomDependencies = (sbom.packages ?? []).slice(1)
  .map((entry) => ({ name: entry.name, version: entry.versionInfo, license: entry.licenseDeclared }))
  .sort((left, right) => left.name.localeCompare(right.name));
const closureDependencies = [...closureManifest.packageInputs]
  .map((entry) => ({ name: entry.name, version: entry.version, license: entry.license }))
  .sort((left, right) => left.name.localeCompare(right.name));
if (sbom.spdxVersion !== "SPDX-2.3" ||
    sbom.packages?.[0]?.name !== "kiro-fabric" ||
    sbom.packages?.[0]?.versionInfo !== packageResult.version ||
    JSON.stringify(sbomDependencies) !== JSON.stringify(closureDependencies)) {
  throw new Error("SBOM dependency inventory does not match the exact Agent closure");
}
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
const tag = valueAfter("--tag") ?? null;
if (tag !== null && tag !== `v${packageResult.version}`) throw new Error("Release tag does not match package version");
const qualificationPath = valueAfter("--qualification");
/** @type {{ status: "not-run", evidence: string } | { status: "passed", evidenceDigest: string }} */
let realClient = { status: "not-run", evidence: "Explicit real-client qualification was not supplied; no pass is claimed." };
if (qualificationPath) {
  const qualificationFile = path.resolve(qualificationPath);
  const qualificationStats = fs.lstatSync(qualificationFile);
  if (!qualificationStats.isFile() || qualificationStats.isSymbolicLink() || qualificationStats.nlink !== 1 || qualificationStats.size > 2 * 1024 * 1024) {
    throw new Error("real-client qualification must be a bounded single-link regular file");
  }
  const qualificationBytes = fs.readFileSync(qualificationFile);
  assertRealClientEvidence(
    JSON.parse(qualificationBytes.toString("utf8")),
    packageDigest,
    { qualification: true, archiveDigest, commit },
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
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(output);
