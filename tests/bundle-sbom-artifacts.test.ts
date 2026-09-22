import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { fixture } from "./bundle-fixture.js";
import { canonical, createBundleManifest, validateBundle, sha256 } from "../scripts/bundle-contract.mjs";
import { parseBundleArchive, writeBundleArchive } from "../scripts/bundle-archive.mjs";
import { generateBundleSbomOutputs, generateBundleSbomOutputsForTest } from "../scripts/generate-bundle-sbom.mjs";
import { withInstallerCacheGate, publishCacheJson } from "../scripts/installer-artifacts.mjs";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
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

const sidecars = (f: Awaited<ReturnType<typeof setup>>) => [path.join(f.directory, "kiro-fabric-linux-x64.spdx.json"), f.archive + ".spdx.json"];
async function replacement(f: Awaited<ReturnType<typeof setup>>) {
  const b = await setup();
  const before = await validateBundle(b.bundle);
  fs.writeFileSync(path.join(b.bundle, "app/main.js"), "another valid generation");
  const manifest = await createBundleManifest(b.bundle, before.manifest);
  fs.writeFileSync(path.join(b.bundle, "bundle-manifest.json"), canonical(manifest) + "\n");
  const archive = path.join(f.directory, "replacement.tar.gz"); await writeBundleArchive(b.bundle, archive);
  return { ...b, archive, digest: (await validateBundle(b.bundle)).digest };
}

it.each([false, true])("rejects pointer A + valid archive B before any sidecar writes (existing=%s)", async existing => {
  const f = await setup(), b = await replacement(f), a = await validateBundle(f.bundle);
  const captured = fs.readFileSync(b.archive);
  expect(parseBundleArchive(captured).digest).toBe(b.digest); expect(b.digest).not.toBe(a.digest);
  if (existing) for (const file of sidecars(f)) fs.writeFileSync(file, "preserved sidecar", { mode: 0o600 });
  fs.renameSync(b.archive, f.archive); // interrupted old fixed-name publication
  await expect(generateBundleSbomOutputs(f.root)).rejects.toThrow("archive does not match selected SBOM bundle");
  for (const file of sidecars(f)) {
    if (existing) expect(fs.readFileSync(file, "utf8")).toBe("preserved sidecar");
    else expect(fs.existsSync(file)).toBe(false);
  }
  expect(fs.readFileSync(f.archive)).toEqual(captured);
});

it("rejects malformed captured bytes rather than merely hashing them", async () => {
  const f = await setup(); fs.writeFileSync(f.archive, "not gzip");
  await expect(generateBundleSbomOutputs(f.root)).rejects.toThrow();
  for (const file of sidecars(f)) expect(fs.existsSync(file)).toBe(false);
});

it.each(["archive-replacement", "archive-in-place", "pointer-replacement"])("rejects %s after capture before either sidecar write", async mutation => {
  const f = await setup(), b = await replacement(f), original = fs.readFileSync(f.archive);
  await expect(generateBundleSbomOutputsForTest(f.root, { beforePublication: () => {
    if (mutation === "archive-replacement") { fs.renameSync(f.archive, f.archive + ".original"); fs.renameSync(b.archive, f.archive); }
    if (mutation === "archive-in-place") fs.writeFileSync(f.archive, fs.readFileSync(b.archive));
    if (mutation === "pointer-replacement") {
      fs.renameSync(f.pointer, f.pointer + ".original");
      fs.writeFileSync(f.pointer, JSON.stringify({ root: b.bundle, target: "linux-x64", archive: f.archive }), { mode: 0o600 });
    }
  } })).rejects.toThrow("publication changed before SBOM publication");
  for (const file of sidecars(f)) expect(fs.existsSync(file)).toBe(false);
  if (mutation === "archive-replacement") expect(fs.readFileSync(f.archive + ".original")).toEqual(original);
});

it("preserves an interrupted publication gate and refuses sidecar publication", async () => {
  const f = await setup(), gate = path.join(f.directory, ".installer-cache-gate");
  fs.mkdirSync(gate, { mode: 0o700 });
  fs.writeFileSync(path.join(gate, "owner.json"), "interrupted publication evidence", { mode: 0o600 });
  await expect(generateBundleSbomOutputs(f.root)).rejects.toThrow("cache gate busy or stale");
  expect(fs.readFileSync(path.join(gate, "owner.json"), "utf8")).toBe("interrupted publication evidence");
  for (const file of sidecars(f)) expect(fs.existsSync(file)).toBe(false);
});

it("keeps a cooperative publication outside the captured-byte/sidecar commit", async () => {
  const f = await setup(), b = await replacement(f), original = fs.readFileSync(f.archive);
  let publish: Promise<unknown> | undefined, started = false, committed = false;
  const result = await generateBundleSbomOutputsForTest(f.root, { beforePublication: async () => {
    publish = withInstallerCacheGate(f.root, async () => {
      started = true;
      // At the first instant the writer can publish, both sidecars still describe
      // the captured original archive, never the replacement waiting behind it.
      for (const file of sidecars(f)) expect(fs.existsSync(file)).toBe(true);
      fs.renameSync(b.archive, f.archive);
      await publishCacheJson(f.pointer, { root: b.bundle, target: "linux-x64", archive: f.archive });
      committed = true;
    });
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(started).toBe(false);
  } });
  await publish; expect(committed).toBe(true);
  expect(result.archive?.sha256).toBe(sha256(original));
  const current = await generateBundleSbomOutputs(f.root);
  expect(current.archive?.sha256).toBe(sha256(fs.readFileSync(f.archive)));
  const doc = JSON.parse(fs.readFileSync(current.output, "utf8"));
  expect(doc.packages[0].checksums[0].checksumValue).toBe(b.digest);
});
