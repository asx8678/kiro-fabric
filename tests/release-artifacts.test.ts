import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgentArchive } from "../scripts/create-agent-archive.mjs";
import { validateReleaseArtifacts, writeReleaseAssetSnapshots } from "../scripts/release-artifacts.mjs";
import { validateAgentPackage } from "../scripts/validate-agent-package.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-release-artifact-test-"));
const stage = path.resolve(".tmp/kiro-fabric-agent");
const closure = path.resolve("dist/kiro-agent-closure");
const archive = path.join(root, "qualified.tar.gz");
const rebuilt = path.join(root, "rebuilt.tar.gz");
const sbom = path.join(root, "qualified.spdx.json");
let qualifiedBytes: Buffer; let sbomBytes: Buffer;
beforeAll(() => {
  createAgentArchive(stage, archive);
  const content = gunzipSync(fs.readFileSync(archive));
  qualifiedBytes = gzipSync(content, { level: 1 });
  fs.writeFileSync(archive, qualifiedBytes);
  fs.writeFileSync(rebuilt, gzipSync(content, { level: 9 }));
  const result = spawnSync(process.execPath, ["scripts/generate-agent-sbom.mjs", "--package", stage, "--output", sbom], { encoding: "utf8", timeout: 30_000 });
  expect(result.status, result.stderr).toBe(0);
  sbomBytes = fs.readFileSync(sbom);
});
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe("release artifact content validation and snapshot promotion", () => {
  it("validates real archives with different compression against the same fresh package tree", () => {
    const first = validateReleaseArtifacts(stage, archive, sbom, closure);
    const second = validateReleaseArtifacts(stage, rebuilt, sbom, closure);
    expect(first.packageDigest).toBe(validateAgentPackage(stage).digest);
    expect(second.packageDigest).toBe(first.packageDigest);
    expect(first.archiveDigest).not.toBe(second.archiveDigest);
  });

  it("rejects an archive belonging to a different otherwise-valid stage", () => {
    const alternate = path.join(root, "alternate-stage");
    fs.cpSync(fs.realpathSync(stage), alternate, { recursive: true });
    const normalize = (directory: string) => {
      fs.chmodSync(directory, 0o700);
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) if (entry.isDirectory()) normalize(path.join(directory, entry.name));
    };
    normalize(alternate);
    fs.appendFileSync(path.join(alternate, "scripts/install-agent-user.mjs"), "\n// alternate package fixture\n");
    expect(validateAgentPackage(alternate).digest).not.toBe(validateAgentPackage(stage).digest);
    expect(() => validateReleaseArtifacts(alternate, archive, sbom, closure)).toThrow("exact staged package");
  });

  it("rejects mismatched SBOM package identity and dependency inventory", () => {
    const wrong = path.join(root, "wrong.spdx.json");
    const document = JSON.parse(sbomBytes.toString("utf8"));
    document.packages[0].checksums[0].checksumValue = "0".repeat(64);
    fs.writeFileSync(wrong, JSON.stringify(document));
    expect(() => validateReleaseArtifacts(stage, archive, wrong, closure)).toThrow("SBOM is not bound");
    const dependencies = JSON.parse(sbomBytes.toString("utf8"));
    dependencies.packages[1].versionInfo = "fixture-mismatch";
    fs.writeFileSync(wrong, JSON.stringify(dependencies));
    expect(() => validateReleaseArtifacts(stage, archive, wrong, closure)).toThrow("SBOM dependency inventory");
  });

  it("writes captured archive/SBOM bytes without rereading subsequently changed input files", () => {
    const artifacts = validateReleaseArtifacts(stage, archive, sbom, closure);
    // This tests the snapshot writer, not authenticated qualification. The CLI
    // must validate exact qualification before calling this helper.
    const evidence = Buffer.from('{"fixture":"snapshot-only"}\n');
    const assets = path.join(root, "assets");
    try {
      fs.writeFileSync(archive, "changed input fixture"); fs.writeFileSync(sbom, "changed input fixture");
      writeReleaseAssetSnapshots(assets, artifacts, evidence);
      expect(fs.readFileSync(path.join(assets, "kiro-fabric-agent.tar.gz"))).toEqual(qualifiedBytes);
      expect(fs.readFileSync(path.join(assets, "kiro-fabric-agent.spdx.json"))).toEqual(sbomBytes);
      expect(fs.readFileSync(path.join(assets, "real-client.json"))).toEqual(evidence);
    } finally { fs.writeFileSync(archive, qualifiedBytes); fs.writeFileSync(sbom, sbomBytes); }
  });
});
