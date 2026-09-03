import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installPowerPackage, installUserPower, resolveUserPowerRoot } from "../scripts/install-power-user.mjs";
import { digestPowerPackage, validatePowerPackage } from "../scripts/validate-power-package.mjs";

const roots: string[] = [];
const temporary = (): string => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-power-install-")); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("user-global Power installation", () => {
  it("installs and updates the staged package under KIRO_HOME", () => {
    const root = temporary(); const kiroHome = path.join(root, ".kiro"); fs.mkdirSync(kiroHome, { mode: 0o755 });
    const destination = resolveUserPowerRoot({ KIRO_HOME: kiroHome }, root);
    const first = installPowerPackage(".tmp/kiro-fabric-power", destination);
    const staged = digestPowerPackage(".tmp/kiro-fabric-power", { excludeOwner: true });
    expect(first.root).toBe(path.join(fs.realpathSync(path.dirname(destination)), "kiro-fabric"));
    expect(validatePowerPackage(destination).digest).toBe(staged.digest);
    expect(JSON.parse(fs.readFileSync(path.join(destination, ".kiro-fabric-power-owner.json"), "utf8")).product).toBe("kiro-fabric-power-user-install");
    expect(installPowerPackage(".tmp/kiro-fabric-power", destination).digest).toBe(staged.digest);
  });

  it("registers and refreshes the active Kiro-managed copy in one command", () => {
    const root = temporary();
    const kiroHome = path.join(root, ".kiro");
    fs.mkdirSync(kiroHome, { mode: 0o755 });
    const env = { KIRO_HOME: kiroHome };

    const first = installUserPower(".tmp/kiro-fabric-power", env, root);
    const sourceRoot = path.join(kiroHome, "powers", "kiro-fabric");
    const activeRoot = path.join(kiroHome, "powers", "installed", "kiro-fabric");
    expect(first.root).toBe(fs.realpathSync(sourceRoot));
    expect(first.activeRoot).toBe(fs.realpathSync(activeRoot));
    expect(validatePowerPackage(sourceRoot).digest).toBe(validatePowerPackage(activeRoot).digest);
    expect(JSON.parse(fs.readFileSync(path.join(kiroHome, "powers", "installed.json"), "utf8")).installedPowers)
      .toContainEqual({ name: "kiro-fabric", registryId: "user-added" });
    expect(JSON.parse(fs.readFileSync(path.join(kiroHome, "powers", "registries", "user-added.json"), "utf8")).powers)
      .toContainEqual({
        name: "kiro-fabric",
        description: `Custom power from ${fs.realpathSync(sourceRoot)}`,
        source: { type: "local", path: fs.realpathSync(sourceRoot) },
      });

    if (process.platform !== "win32") {
      for (const entry of fs.readdirSync(activeRoot, { recursive: true, withFileTypes: true })) {
        fs.chmodSync(path.join(entry.parentPath, entry.name), entry.isDirectory() ? 0o755 : 0o644);
      }
      fs.chmodSync(activeRoot, 0o755);
    }
    expect(installUserPower(".tmp/kiro-fabric-power", env, root).digest).toBe(first.digest);
    expect(validatePowerPackage(activeRoot).digest).toBe(first.digest);
  });

  it("refuses to replace an unowned global directory", () => {
    const root = temporary(); const destination = path.join(root, "powers", "kiro-fabric");
    fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
    expect(() => installPowerPackage(".tmp/kiro-fabric-power", destination)).toThrow("unowned");
  });
});
