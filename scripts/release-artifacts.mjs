import { createHash } from "node:crypto";
import { canonical } from "./bundle-contract.mjs";
import { vendoredSbomPackages } from "./generate-vendored-sbom.mjs";
import { captureLegacyArtifact, LEGACY_ARCHIVE_LIMITS, extractLegacyAgentArchiveBytes } from "./bundle-archive.mjs";
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
  const sbomBytes = captureLegacyArtifact(sbomPath, LEGACY_ARCHIVE_LIMITS.sbom);
  const sbom = JSON.parse(sbomBytes.toString("utf8"));
  const sbomDigest = sbom.packages?.[0]?.checksums?.[0]?.checksumValue;
  const sbomFileDigest = createHash("sha256").update(sbomBytes).digest("hex");
  const archiveBytes = captureLegacyArtifact(archivePath, LEGACY_ARCHIVE_LIMITS.archive);
  const archiveDigest = createHash("sha256").update(archiveBytes).digest("hex");
  const archiveTemporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-release-archive-"));
  try {
    const extracted = path.join(archiveTemporary, "package");
    extractLegacyAgentArchiveBytes(archiveBytes, extracted);
    if (validateAgentPackage(extracted).digest !== packageDigest) throw new Error("Release archive is not bound to the exact staged package");
  } finally { fs.rmSync(archiveTemporary, { recursive: true, force: true }); }
  if (sbomDigest !== packageDigest) {
    throw new Error("SBOM is not bound to the exact complete staged Agent package");
  }
  const closureManifest = JSON.parse(fs.readFileSync(path.join(closureRoot, "closure-manifest.json"), "utf8"));
  const expectedVendored = vendoredSbomPackages(closureManifest);
  const vendoredIds = new Set(expectedVendored.map(entry => entry.SPDXID));
  const dependencies = (sbom.packages ?? []).slice(1);
  const actualVendored = dependencies.filter(entry => vendoredIds.has(entry.SPDXID));
  const byId = (left, right) => left.SPDXID.localeCompare(right.SPDXID);
  // Compare full vendored provenance, not just npm-style name/version/license.
  // Unknown IDs remain in the dependency inventory and fail the exact comparison.
  const sbomDependencies = dependencies.filter(entry => !vendoredIds.has(entry.SPDXID))
    .map((entry) => ({ name: entry.name, version: entry.versionInfo, license: entry.licenseDeclared }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const closureDependencies = [...closureManifest.packageInputs]
    .map((entry) => ({ name: entry.name, version: entry.version, license: entry.license }))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (sbom.spdxVersion !== "SPDX-2.3" ||
      sbom.packages?.[0]?.name !== "kiro-fabric" ||
      sbom.packages?.[0]?.versionInfo !== packageResult.version ||
      JSON.stringify(sbomDependencies) !== JSON.stringify(closureDependencies) ||
      canonical(actualVendored.sort(byId)) !== canonical(expectedVendored.sort(byId))) {
    throw new Error("SBOM dependency inventory does not match the exact Agent closure");
  }
  return { packageResult, packageDigest, sbomDigest, sbomFileDigest, archiveDigest, archiveBytes, sbomBytes, sbom: { size: sbomBytes.length, sha256: sbomFileDigest } };
};

/** Caller must validate exact-client qualification before promotion. Never reread
 * mutable input paths after hashing/qualification; write the captured snapshots. */
export const writeReleaseAssetSnapshots = (directory, artifacts, qualificationBytes) => {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileAtomic(path.join(directory, "kiro-fabric-agent.tar.gz"), artifacts.archiveBytes);
  writeFileAtomic(path.join(directory, "kiro-fabric-agent.spdx.json"), artifacts.sbomBytes);
  writeFileAtomic(path.join(directory, "kiro-fabric-agent.tar.gz.spdx.json"), artifacts.sbomBytes);
  writeFileAtomic(path.join(directory, "real-client.json"), qualificationBytes);
};
