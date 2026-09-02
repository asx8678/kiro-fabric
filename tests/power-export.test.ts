import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { exportPowerPackage } from "../scripts/power-user-install.mjs";

const roots: string[] = [];
const temporary = (prefix = "fabric-export-") => { const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); roots.push(root); return root; };
afterEach(() => { while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });
const stage = path.resolve(".tmp/kiro-fabric-power");
beforeAll(() => { if (!fs.existsSync(path.join(stage, "runtime", "closure-manifest.json"))) throw new Error("build and stage the Power before running tests"); });
const fixture = () => { const root = temporary(); const sourceRoot = path.resolve("."); return { root, sourceRoot, destination: path.join(root, "powers", "kiro-fabric") }; };
const treeDigest = (root: string): string => {
  const parts: string[] = [];
  const walk = (directory: string) => { for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const target = path.join(directory, entry.name); if (entry.isDirectory()) walk(target); else parts.push(`${path.relative(root, target)}:${fs.readFileSync(target).toString("base64")}`); } };
  walk(root); return parts.join("|");
};

describe("explicit user Power export", () => {
  it("rejects parent and destination aliases", async () => {
    const { root, sourceRoot } = fixture();
    const real = path.join(root, "real"); const alias = path.join(root, "alias"); fs.mkdirSync(real); fs.symlinkSync(real, alias);
    await expect(exportPowerPackage(stage, path.join(alias, "kiro-fabric"), { sourceRoot })).rejects.toThrow("path alias");
    const parent = path.join(root, "parent"); fs.mkdirSync(parent); const target = path.join(root, "target"); fs.mkdirSync(target); fs.symlinkSync(target, path.join(parent, "kiro-fabric"));
    await expect(exportPowerPackage(stage, path.join(parent, "kiro-fabric"), { sourceRoot })).rejects.toThrow("path alias");
  });

  it("refuses unknown collisions", async () => {
    const { destination, sourceRoot } = fixture();
    fs.mkdirSync(destination, { recursive: true }); fs.writeFileSync(path.join(destination, "unknown"), "owned elsewhere");
    await expect(exportPowerPackage(stage, destination, { sourceRoot })).rejects.toThrow("unknown or unowned");
  });

  it("preserves the prior generation after interrupted copy", async () => {
    const { destination, sourceRoot } = fixture();
    await exportPowerPackage(stage, destination, { sourceRoot });
    const before = treeDigest(destination);
    await expect(exportPowerPackage(stage, destination, { sourceRoot, afterCopy() { throw new Error("interrupted copy"); } })).rejects.toThrow("interrupted copy");
    expect(treeDigest(destination)).toBe(before);
  });

  it("preserves the prior generation after copied-package validation failure", async () => {
    const { destination, sourceRoot } = fixture();
    await exportPowerPackage(stage, destination, { sourceRoot });
    const before = treeDigest(destination); let calls = 0;
    const { validatePowerPackage } = await import("../scripts/validate-power-package.mjs");
    await expect(exportPowerPackage(stage, destination, { sourceRoot, validate(root: string) { calls++; if (calls > 1) throw new Error("validation failed"); return validatePowerPackage(root); } })).rejects.toThrow("validation failed");
    expect(treeDigest(destination)).toBe(before);
  });

  it("rolls back after replacement preparation fails", async () => {
    const { destination, sourceRoot } = fixture();
    await exportPowerPackage(stage, destination, { sourceRoot });
    const before = treeDigest(destination);
    await expect(exportPowerPackage(stage, destination, { sourceRoot, afterBackup() { throw new Error("activation failed"); } })).rejects.toThrow("activation failed");
    expect(treeDigest(destination)).toBe(before);
  });

  it("reclaims an identity-checked stale lock from a dead exporter", async () => {
    const { destination, sourceRoot } = fixture();
    const parent = path.dirname(destination);
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    const lock = path.join(parent, ".kiro-fabric.lock");
    fs.mkdirSync(lock, { mode: 0o700 });
    fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: 2_147_483_647 }), { mode: 0o600 });
    const old = new Date(Date.now() - 5 * 60_000 - 1);
    fs.utimesSync(lock, old, old);
    await expect(exportPowerPackage(stage, destination, { sourceRoot })).resolves.toMatchObject({ destination });
  });

  it("serializes concurrent exports", async () => {
    const { destination, sourceRoot } = fixture(); let first = true;
    const pause = async () => { if (first) { first = false; await new Promise((resolve) => setTimeout(resolve, 100)); } };
    const [left, right] = await Promise.all([
      exportPowerPackage(stage, destination, { sourceRoot, beforeActivate: pause }),
      exportPowerPackage(stage, destination, { sourceRoot }),
    ]);
    expect(left.digest).toBe(right.digest);
    expect(fs.statSync(destination).isDirectory()).toBe(true);
  });

  it("uses restrictive permissions and removes stale files", async () => {
    const { destination, sourceRoot } = fixture();
    await exportPowerPackage(stage, destination, { sourceRoot });
    expect(fs.statSync(destination).mode & 0o777).toBe(0o700);
    const visit = (directory: string) => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const target = path.join(directory, entry.name); if (entry.isDirectory()) { expect(fs.statSync(target).mode & 0o777).toBe(0o700); visit(target); } else expect(fs.statSync(target).mode & 0o777).toBe(0o600); } };
    visit(destination);
    fs.writeFileSync(path.join(destination, "stale"), "old", { mode: 0o600 });
    await exportPowerPackage(stage, destination, { sourceRoot });
    expect(fs.existsSync(path.join(destination, "stale"))).toBe(false);
  });

  it("refuses silent replacement from another checkout", async () => {
    const { destination, sourceRoot } = fixture();
    await exportPowerPackage(stage, destination, { sourceRoot });
    const other = temporary("fabric-other-checkout-");
    await expect(exportPowerPackage(stage, destination, { sourceRoot: other })).rejects.toThrow("different source checkout");
  });
});
