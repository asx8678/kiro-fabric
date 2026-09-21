import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { fixture } from "./bundle-fixture.js";
import { stageSourceBundle } from "../scripts/source-bundle-stage.mjs";
import { canonical, createBundleManifest, validateBundle } from "../scripts/bundle-contract.mjs";
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
async function setup() {
  const source = await fixture(), root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "source-stage-")));
  fs.chmodSync(root, 0o700); roots.push(source, root); return { source, root, output: path.join(root, "bundle") };
}
it.each([0o022, 0o077])("stages bounded private bytes with original digest under umask %i", async mask => {
  const f = await setup(), original = await validateBundle(f.source), prior = process.umask(mask);
  try {
    fs.writeFileSync(path.join(f.source, "app/main.js"), Buffer.alloc(2 * 1024 * 1024, 73));
    const manifest = await createBundleManifest(f.source, original.manifest);
    fs.writeFileSync(path.join(f.source, "bundle-manifest.json"), canonical(manifest) + "\n");
    vi.spyOn(fs, "cpSync").mockImplementation(() => { throw Error("unbounded cp must not run"); });
    const staged = await stageSourceBundle(f.source, f.output);
    expect(staged.digest).toBe(manifest.digest);
    expect(fs.statSync(f.output).mode & 0o777).toBe(0o700);
    for (const entry of staged.inventory) {
      expect(fs.statSync(path.join(f.output, entry.path)).mode & 0o777).toBe(entry.mode);
      expect(fs.statSync(path.dirname(path.join(f.output, entry.path))).mode & 0o777).toBe(0o700);
    }
  } finally { process.umask(prior); }
});
it("refuses an occupied destination without changing its sentinel", async () => {
  const f = await setup(); fs.mkdirSync(f.output, { mode: 0o700 }); fs.writeFileSync(path.join(f.output, "sentinel"), "untouched");
  await expect(stageSourceBundle(f.source, f.output)).rejects.toThrow();
  expect(fs.readdirSync(f.output)).toEqual(["sentinel"]); expect(fs.readFileSync(path.join(f.output, "sentinel"), "utf8")).toBe("untouched");
});
it("rejects corrupted source before creating the destination", async () => {
  const f = await setup(); fs.writeFileSync(path.join(f.source, "tools/node"), "corrupted");
  await expect(stageSourceBundle(f.source, f.output)).rejects.toThrow(); expect(fs.existsSync(f.output)).toBe(false);
});
