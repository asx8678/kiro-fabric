import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
    const result = spawnSync(process.execPath, ["scripts/build-power-dev.mjs"], { cwd: path.resolve("."), encoding: "utf8", env: { ...process.env, HOME: home, KIRO_HOME: kiroHome }, timeout: 60_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(digestTree(kiroHome)).toBe(before);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
