import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { fixture } from "./bundle-fixture.js";
import { canonical, createBundleManifest, validateBundle, sha256 } from "../scripts/bundle-contract.mjs";
import { writeBundleArchive } from "../scripts/bundle-archive.mjs";
import { generateBundleSbomOutputs } from "../scripts/generate-bundle-sbom.mjs";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
async function setup() {
  const bundle = await fixture(), root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bundle-sbom-assets-"))); roots.push(bundle, root); fs.chmodSync(root, 0o700);
  const directory = path.join(root, ".tmp"); fs.mkdirSync(directory, { mode: 0o700 });
  const before = await validateBundle(bundle); fs.writeFileSync(path.join(bundle, "app/closure-manifest.json"), JSON.stringify({ packageInputs: [] }));
  const manifest = await createBundleManifest(bundle, before.manifest); fs.writeFileSync(path.join(bundle, "bundle-manifest.json"), canonical(manifest) + "\n");
  const archive = path.join(directory, "kiro-fabric-linux-x64.tar.gz"); await writeBundleArchive(bundle, archive);
  const pointer = path.join(directory, "complete-bundle.json"); fs.writeFileSync(pointer, JSON.stringify({ root: bundle, target: "linux-x64", archive }), { mode: 0o600 });
  return { root, bundle, archive, pointer, directory };
}
it("writes matching legacy and archive-linked SBOM bytes with exact descriptors", async () => {
  const f = await setup(), result = await generateBundleSbomOutputs(f.root), bytes = fs.readFileSync(result.output);
  expect(result.archiveSidecar).toBe(f.archive + ".spdx.json"); expect(fs.readFileSync(result.archiveSidecar!)).toEqual(bytes);
  expect(result.sbom).toEqual({ size: bytes.length, sha256: sha256(bytes) });
  const archive = fs.readFileSync(f.archive); expect(result.archive).toEqual({ path: f.archive, size: archive.length, sha256: sha256(archive) });
});
it("does not invent an archive for source-only staging", async () => {
  const f = await setup(); fs.writeFileSync(f.pointer, JSON.stringify({ root: f.bundle, target: "linux-x64", archive: null }));
  const result = await generateBundleSbomOutputs(f.root); expect(result.archiveSidecar).toBeNull(); expect(result.archive).toBeNull(); expect(fs.existsSync(f.archive + ".spdx.json")).toBe(false);
});
it("refuses pointer-directed sidecar writes outside the fixed cache path", async () => {
  const f = await setup(); fs.writeFileSync(f.pointer, JSON.stringify({ root: f.bundle, target: "../../escape", archive: path.join(f.root, "foreign") }));
  await expect(generateBundleSbomOutputs(f.root)).rejects.toThrow("Unexpected complete-bundle archive path");
  expect(fs.existsSync(path.join(f.directory, "kiro-fabric-linux-x64.spdx.json"))).toBe(false); expect(fs.existsSync(path.join(f.root, "foreign.spdx.json"))).toBe(false);
});
