import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as contract from "../src/installation/bundle-contract.mjs";
import * as search from "../src/providers/local-executable.js";
import { validateManagedGeneration } from "../src/kiro/managed-generation.js";
import { fixture } from "./bundle-fixture.js";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
async function setup(afterCapture?: (node: string) => void) {
  const root = fs.realpathSync(await fixture()); roots.push(root);
  const node = path.join(root, "tools/node"), rg = path.join(root, "tools/rg");
  const validate = contract.validateBundle;
  vi.spyOn(contract, "validateBundle").mockImplementation(async root => {
    const bundle = await validate(root);
    // Only process/version execution evidence is substituted. Inventory hashing,
    // owned no-follow reads, containment and pre/post Node stats remain real.
    bundle.manifest.tools.node.version = process.version.slice(1);
    afterCapture?.(node);
    return bundle;
  });
  const realpath = fs.realpathSync;
  vi.spyOn(fs, "realpathSync").mockImplementation(((file: fs.PathLike, ...args: unknown[]) => file === process.execPath ? node : (realpath as Function)(file, ...args)) as typeof fs.realpathSync);
  vi.spyOn(search, "resolveSearchExecutable").mockReturnValue({ path: rg, version: "ripgrep 14.1.1", dev: 0, ino: 0 });
  return { root, node, context: { bundleRoot: root, expectedNode: node, rg }, data: root + "-data" };
}
it("cryptographically captures Node once per admission without a second full-buffer hash", async () => {
  const f = await setup(), open = vi.spyOn(fsp, "open"), read = vi.spyOn(fs, "readFileSync");
  syncBuiltinESMExports();
  for (let admission = 1; admission <= 2; admission++) {
    expect(await validateManagedGeneration(f.context, f.data)).toMatchObject({ path: f.context.rg });
    expect(open.mock.calls.filter(([target]) => target === f.node)).toHaveLength(admission);
  }
  expect(read.mock.calls.filter(([target]) => target === f.node)).toHaveLength(0);
});
it.each(["rewrite-restored-mtime", "replace", "chmod", "hardlink", "symlink"])("does not reuse captured Node integrity after %s", async mutation => {
  const f = await setup(node => {
    const bytes = fs.readFileSync(node), before = fs.statSync(node);
    if (mutation === "rewrite-restored-mtime") { fs.writeFileSync(node, Buffer.alloc(bytes.length, 88)); fs.utimesSync(node, before.atime, before.mtime); }
    if (mutation === "replace") { fs.renameSync(node, node + "-old"); fs.writeFileSync(node, bytes, { mode: 0o700 }); }
    if (mutation === "chmod") fs.chmodSync(node, 0o600);
    if (mutation === "hardlink") fs.linkSync(node, node + "-alias");
    if (mutation === "symlink") { fs.renameSync(node, node + "-old"); fs.symlinkSync(node + "-old", node); }
  });
  await expect(validateManagedGeneration(f.context, f.data)).rejects.toThrow(/Node executable identity/);
  expect(search.resolveSearchExecutable).not.toHaveBeenCalled();
});
it("rejects corrupted Node bytes during the full inventory check", async () => {
  const f = await setup(); fs.appendFileSync(f.node, "corrupt");
  await expect(validateManagedGeneration(f.context, f.data)).rejects.toThrow(/inventory/);
  expect(search.resolveSearchExecutable).not.toHaveBeenCalled();
});
