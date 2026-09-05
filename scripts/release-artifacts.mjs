import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFileAtomic } from "./atomic-file.mjs";
import { validateAgentPackage } from "./validate-agent-package.mjs";

/** Capture once, then compare archive contents and SBOM with the independently
 * built stage/closure. Exact transport qualification is checked by the caller. */
export const validateReleaseArtifacts = (stage, archivePath, sbomPath, closureRoot) => {
  const packageResult = validateAgentPackage(stage);
  const packageDigest = packageResult.digest;
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
  return { packageResult, packageDigest, sbomDigest, sbomFileDigest, archiveDigest, archiveBytes, sbomBytes };
};

/** Caller must validate exact-client qualification before promotion. Never reread
 * mutable input paths after hashing/qualification; write the captured snapshots. */
export const writeReleaseAssetSnapshots = (directory, artifacts, qualificationBytes) => {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileAtomic(path.join(directory, "kiro-fabric-agent.tar.gz"), artifacts.archiveBytes);
  writeFileAtomic(path.join(directory, "kiro-fabric-agent.spdx.json"), artifacts.sbomBytes);
  writeFileAtomic(path.join(directory, "real-client.json"), qualificationBytes);
};
