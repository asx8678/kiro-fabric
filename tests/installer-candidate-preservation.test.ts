import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixture } from "./bundle-fixture.js";
import { canonical, createBundleManifest, validateBundle } from "../scripts/bundle-contract.mjs";
import { recoverCompleteInstallation } from "../scripts/managed-installation.mjs";
import { captureDirectoryIdentity } from "../scripts/installer-directory-identity.mjs";
import { snapshotStagingScope, assertStagingScopeUnchanged } from "../scripts/verification/staging-preservation-snapshot.mjs";
import { installerSuiteFiles } from "../scripts/test-installer.mjs";

const roots: string[] = []; let protectedRoot = "", attempts: string[] = [];
const write = (root: string, rel: string, text: string) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 }); fs.writeFileSync(p, text, { flag: "wx", mode: 0o600 }); };
beforeEach(() => {
  attempts = []; protectedRoot = "";
  for (const name of ["rmSync", "unlinkSync", "rmdirSync"] as const) {
    const original = fs[name];
    vi.spyOn(fs, name).mockImplementation((p: fs.PathLike) => {
      if (protectedRoot && (String(p) === protectedRoot || String(p).startsWith(protectedRoot + path.sep))) { attempts.push(`${name}:${String(p)}`); throw new Error("blocked repository candidate deletion"); }
      original(p);
    });
  }
});
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) console.warn(`[candidate preservation fixture] retained ${root}`); expect(attempts, "no swallowed repository deletion attempts").toEqual([]); });
async function setup(kind: string, location = "stage") {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "candidate-preserve-"))); fs.chmodSync(root, 0o700); roots.push(root);
  // Synthetic schema-1 Linux payload is never executed. This tests public
  // offline recovery, not host compatibility or native release qualification.
  const bundle = await fixture(); roots.push(bundle);
  const original = (await validateBundle(bundle)).manifest;
  if (kind === "directory" || kind === "case") write(bundle, `app/project/${kind === "case" ? ".GiT" : ".git"}/HEAD`, "ref: refs/heads/main\n");
  if (kind === "worktree") write(bundle, "app/project/.git", "gitdir: ../retained-metadata\n");
  if (kind === "bare" || kind === "packed-bare") { write(bundle, "app/project/HEAD", "ref: refs/heads/main\n"); write(bundle, "app/project/objects/fixture", "object evidence\n"); write(bundle, kind === "bare" ? "app/project/refs/heads/main" : "app/project/packed-refs", "ref evidence\n"); }
  const manifest = await createBundleManifest(bundle, original); fs.writeFileSync(path.join(bundle, "bundle-manifest.json"), canonical(manifest) + "\n");
  await validateBundle(bundle); // Repository metadata can be genuinely inventory-listed.
  const home = path.join(root, "home"), kiroHome = path.join(home, ".kiro"), base = path.join(kiroHome, "kiro-fabric"), id = "1".repeat(32);
  const candidate = path.join(base, "runtime", location === "stage" ? ".candidate-" + id : manifest.digest);
  fs.mkdirSync(candidate, { recursive: true, mode: 0o700 }); fs.mkdirSync(path.join(base, ".transactions"), { mode: 0o700 });
  for (const entry of manifest.inventory) {
    if (kind === "partial" && entry.path !== "app/main.js") continue;
    const target = path.join(candidate, entry.path); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 }); fs.writeFileSync(target, fs.readFileSync(path.join(bundle, entry.path)), { flag: "wx", mode: entry.mode });
  }
  if (kind !== "partial") fs.writeFileSync(path.join(candidate, "bundle-manifest.json"), canonical(manifest) + "\n", { flag: "wx", mode: 0o600 });
  const outside = path.join(root, "outside"); write(outside, ".git/HEAD", "outside evidence\n");
  if (kind === "link") fs.symlinkSync(path.join(outside, ".git"), path.join(candidate, "app/.git"));
  if (kind === "empty") fs.mkdirSync(path.join(candidate, "app/.git"), { mode: 0o700 });
  if (kind === "overflow") for (let i = 0; i < manifest.inventory.length + 3; i++) write(candidate, `foreign-${i}`, "foreign\n");
  const marker = path.join(base, ".transactions/candidate.json");
  fs.writeFileSync(marker, JSON.stringify({ schemaVersion: 2, transactionId: id, kiroHome, baseIdentity: captureDirectoryIdentity(base), stageIdentity: captureDirectoryIdentity(candidate), purpose: "activate", manifest }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return { root, bundle, kiroHome, base, candidate, marker, outside, options: { env: {}, userHome: home } };
}
describe("managed candidate repository refusal", () => {
  it.each(["stage", "published"].flatMap(location => ["directory", "case", "worktree", "bare", "packed-bare"].map(kind => ({ kind, location }))))("retains manifest-listed $kind repository in $location", async ({ kind, location }) => {
    const f = await setup(kind, location), before = snapshotStagingScope(f.candidate), source = snapshotStagingScope(f.bundle), marker = fs.readFileSync(f.marker); protectedRoot = f.candidate;
    await expect(recoverCompleteInstallation(f.kiroHome, f.options)).rejects.toMatchObject({ message: expect.stringContaining("repository-bearing candidate preserved"), committed: false, recoveryRequired: true });
    assertStagingScopeUnchanged(before, snapshotStagingScope(f.candidate), "repository candidate"); assertStagingScopeUnchanged(source, snapshotStagingScope(f.bundle), "source bundle");
    expect(fs.readFileSync(f.marker)).toEqual(marker); expect(fs.existsSync(path.join(f.base, ".install-lock"))).toBe(true);
  }, 90_000);
  it.each(["link", "empty", "overflow"])("retains %s foreign candidate evidence before any removal", async kind => {
    const f = await setup(kind), before = snapshotStagingScope(f.candidate), outside = snapshotStagingScope(f.outside); protectedRoot = f.candidate;
    await expect(recoverCompleteInstallation(f.kiroHome, f.options)).rejects.toThrow(kind === "overflow" ? /Directory entry bound/ : /repository-bearing candidate preserved/);
    assertStagingScopeUnchanged(before, snapshotStagingScope(f.candidate), "foreign candidate"); assertStagingScopeUnchanged(outside, snapshotStagingScope(f.outside), "external repository"); expect(fs.existsSync(f.marker)).toBe(true);
  }, 90_000);
  it.each(["complete", "partial"])("still recovers exact task-owned non-repository %s candidates", async kind => {
    const f = await setup(kind), source = snapshotStagingScope(f.bundle), outside = snapshotStagingScope(f.outside);
    const result = await recoverCompleteInstallation(f.kiroHome, f.options);
    expect(result.recovered).toBe(true); expect(result.committed).toBe(false); expect(fs.existsSync(f.candidate)).toBe(false); expect(fs.existsSync(f.marker)).toBe(false);
    assertStagingScopeUnchanged(source, snapshotStagingScope(f.bundle), "source retained"); assertStagingScopeUnchanged(outside, snapshotStagingScope(f.outside), "external repository retained");
  }, 90_000);
  it("is registered in the maintained installer contracts", () => { expect(installerSuiteFiles("contracts")).toContain("tests/installer-candidate-preservation.test.ts"); });
});
