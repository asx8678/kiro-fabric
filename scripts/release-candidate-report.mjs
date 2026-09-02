#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assertRealClientEvidence } from "./real-client-evidence.mjs";
import { digestPowerPackage, validatePowerPackage } from "./validate-power-package.mjs";

const valueAfter = (flag) => { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; };
const output = path.resolve(valueAfter("--output") ?? ".tmp/release-candidate.json");
const sbomPath = path.resolve(valueAfter("--sbom") ?? ".tmp/kiro-fabric-power.spdx.json");
const stage = path.resolve(".tmp/kiro-fabric-power");
const packageResult = validatePowerPackage(stage);
const packageDigest = digestPowerPackage(stage, { excludeOwner: true }).digest;
const sbom = JSON.parse(fs.readFileSync(sbomPath, "utf8"));
const sbomDigest = sbom.packages?.[0]?.checksums?.[0]?.checksumValue;
const closureRoot = path.resolve("dist/kiro-power-closure");
const closureFiles = [];
const walkClosure = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walkClosure(target);
    else if (entry.isFile()) closureFiles.push(target);
  }
};
walkClosure(closureRoot);
const currentClosureDigest = createHash("sha256");
for (const file of closureFiles) {
  currentClosureDigest
    .update(path.relative(closureRoot, file).replaceAll("\\", "/"))
    .update("\0")
    .update(fs.readFileSync(file));
}
if (sbomDigest !== currentClosureDigest.digest("hex")) {
  throw new Error("SBOM is not bound to the current packaged Power closure");
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
  throw new Error("SBOM dependency inventory does not match the exact Power closure");
}
const packed = spawnSync("pnpm", ["pack", "--dry-run", "--json", "--config.ignore-scripts=true"], { encoding: "utf8", timeout: 60_000 });
if (packed.error) throw packed.error;
if (packed.status !== 0) throw new Error(`package dry-run failed: ${packed.stderr ?? packed.stdout}`);
const packedDocument = JSON.parse(packed.stdout);
const packedFiles = (Array.isArray(packedDocument) ? packedDocument[0] : packedDocument).files.map((entry) => entry.path);
const allowedPackedFile = (file) =>
  [
    "package.json", "README.md", "LICENSE", "SECURITY.md", "STATUS.md",
    "THIRD_PARTY_NOTICES.md", "plugin.json", "mcp.json", "power-product.json",
    "docs/architecture.md", "docs/audit.md", "docs/configuration.md", "docs/release.md",
    "dist/index.js", "dist/runtime/compiler-worker-entry.js",
  ].includes(file) ||
  (file.startsWith("dist/") && file.endsWith(".d.ts")) ||
  /^dist\/chunks\/[^/]+\.js$/u.test(file) ||
  file.startsWith("dist/kiro-power-closure/") ||
  file.startsWith("skills/fabric-exec/");
if (packedFiles.some((file) => !allowedPackedFile(file))) {
  throw new Error("packed artifact contains a file outside the exact Power allowlist");
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
const qualificationPath = valueAfter("--qualification");
let realClient = { status: "not-run", evidence: "Explicit real-client qualification was not supplied; no pass is claimed." };
if (qualificationPath) {
  const qualificationFile = path.resolve(qualificationPath);
  const qualificationStats = fs.lstatSync(qualificationFile);
  if (!qualificationStats.isFile() || qualificationStats.isSymbolicLink() || qualificationStats.nlink !== 1 || qualificationStats.size > 2 * 1024 * 1024) {
    throw new Error("real-client qualification must be a bounded single-link regular file");
  }
  assertRealClientEvidence(
    JSON.parse(fs.readFileSync(qualificationFile, "utf8")),
    packageDigest,
    { qualification: true },
  );
  realClient = { status: "passed", evidence: qualificationFile };
}
const report = {
  kind: "kiro-fabric.release-candidate",
  schemaVersion: 1,
  ok: packageResult.ok && typeof sbomDigest === "string",
  packageDigest,
  sbomClosureDigest: sbomDigest,
  packedFiles,
  realClient,
  checksum: createHash("sha256").update(JSON.stringify({ packageDigest, sbomDigest, packedFiles, realClient })).digest("hex"),
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(output);
