import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateAgentPackage } from "../scripts/validate-agent-package.mjs";

const digestTree = (root: string): string => {
  const digest = createHash("sha256");
  const visit = (directory: string) => { for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const target = path.join(directory, entry.name); digest.update(path.relative(root, target)); if (entry.isDirectory()) visit(target); else digest.update(fs.readFileSync(target)); } };
  visit(root); return digest.digest("hex");
};

describe("hermetic staging", () => {
  it("leaves a sentinel KIRO_HOME byte-for-byte unchanged", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-hermetic-"));
    const home = path.join(root, "home"); const kiroHome = path.join(root, "kiro"); fs.mkdirSync(home); fs.mkdirSync(kiroHome);
    fs.writeFileSync(path.join(kiroHome, "sentinel"), Buffer.from([0, 1, 255]));
    const before = digestTree(kiroHome);
    const result = spawnSync(process.execPath, ["scripts/build-agent-dev.mjs"], { cwd: path.resolve("."), encoding: "utf8", env: { ...process.env, HOME: home, KIRO_HOME: kiroHome }, timeout: 60_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(digestTree(kiroHome)).toBe(before);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("refuses to reuse a tampered digest-named generation", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-stage-generation-"));
    try {
      const checkout = path.join(root, "checkout");
      fs.mkdirSync(checkout, { mode: 0o700 });
      fs.mkdirSync(path.join(checkout, ".tmp"), { mode: 0o700 });
      for (const source of ["dist/kiro-agent-closure", "skills"]) {
        fs.cpSync(path.resolve(source), path.join(checkout, source), { recursive: true });
      }
      for (const source of ["agent-product.json", "package.json"]) {
        fs.copyFileSync(path.resolve(source), path.join(checkout, source));
      }
      fs.mkdirSync(path.join(checkout, "scripts"), { mode: 0o700 });
      for (const source of ["agent-profile.mjs", "install-agent-user.mjs", "validate-agent-package.mjs"]) {
        fs.copyFileSync(path.resolve("scripts", source), path.join(checkout, "scripts", source));
      }

      const stage = () => spawnSync(process.execPath, [path.resolve("scripts/build-agent-dev.mjs")], {
        cwd: checkout,
        encoding: "utf8",
        timeout: 60_000,
      });
      const first = stage();
      expect(first.status, first.stderr).toBe(0);
      const evidence = JSON.parse(first.stdout.split("\n")[0]!) as { generation: string };
      const stable = path.join(checkout, ".tmp", "kiro-fabric-agent");
      const stableTarget = fs.readlinkSync(stable);
      expect(validateAgentPackage(stable).root).toBe(evidence.generation);

      const aliasedGeneration = path.join(checkout, ".tmp", `.kiro-fabric-agent-generation-${"0".repeat(64)}`);
      fs.symlinkSync(path.basename(evidence.generation), aliasedGeneration, "dir");
      fs.unlinkSync(stable);
      fs.symlinkSync(path.basename(aliasedGeneration), stable, "dir");
      expect(() => validateAgentPackage(stable)).toThrow("staging generation is not a regular directory");
      fs.unlinkSync(stable);
      fs.unlinkSync(aliasedGeneration);
      fs.symlinkSync(stableTarget, stable, "dir");

      fs.appendFileSync(path.join(evidence.generation, "scripts", "agent-profile.mjs"), "\n");
      expect(() => validateAgentPackage(evidence.generation)).toThrow(
        "digest-named staging generation does not match its contents",
      );
      const second = stage();
      expect(second.status).not.toBe(0);
      expect(second.stderr).toContain("digest-named staging generation does not match its contents");
      expect(fs.readlinkSync(stable)).toBe(stableTarget);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
