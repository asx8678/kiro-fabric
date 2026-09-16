import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const script = path.resolve("scripts/normalize-artifact-modes.mjs");
const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-modes-"));
  roots.push(root);
  return root;
}
const run = (root: string) => spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8", timeout: 10000 });
const mode = (file: string) => fs.statSync(file).mode & 0o7777;
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("generated artifact permissions", () => {
  it("only removes group/other write, preserving private modes, execution, bytes and unrelated paths", () => {
    const root = fixture();
    const dist = path.join(root, "dist");
    fs.mkdirSync(dist);
    fs.chmodSync(dist, 0o775);
    const entries = new Map<string, number>([[dist, 0o775]]);
    for (const original of [0o644, 0o664, 0o666, 0o600, 0o620, 0o710, 0o730, 0o775]) {
      const file = path.join(dist, `file-${original.toString(8)}`);
      fs.writeFileSync(file, "unchanged bytes");
      fs.chmodSync(file, original);
      entries.set(file, original);
    }
    for (const original of [0o700, 0o730, 0o770]) {
      const directory = path.join(dist, `dir-${original.toString(8)}`);
      fs.mkdirSync(directory);
      fs.chmodSync(directory, original);
      entries.set(directory, original);
      const child = path.join(directory, "child");
      fs.writeFileSync(child, "unchanged bytes");
      fs.chmodSync(child, 0o664);
      entries.set(child, 0o664);
    }
    const unrelated = path.join(root, "outside-dist");
    fs.writeFileSync(unrelated, "untouched");
    fs.chmodSync(unrelated, 0o660);
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
    for (const [file, original] of entries) {
      expect(mode(file), file).toBe(original & ~0o022);
      if (fs.statSync(file).isFile()) expect(fs.readFileSync(file, "utf8")).toBe("unchanged bytes");
    }
    expect(mode(unrelated)).toBe(0o660);
    const repeated = run(root);
    expect(repeated.status, repeated.stderr).toBe(0);
    expect(repeated.stdout).toContain("0 files, 0 directories tightened");
  });

  it("fails when dist is missing", () => {
    const result = run(fixture());
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("dist is absent");
  });

  it.each(["root", "directory", "file"])("rejects a %s symlink without changing its target", kind => {
    const root = fixture(), outside = fixture();
    const file = path.join(outside, "artifact");
    fs.writeFileSync(file, "outside bytes");
    fs.chmodSync(file, 0o660);
    fs.chmodSync(outside, 0o770);
    const dist = path.join(root, "dist");
    if (kind === "root") fs.symlinkSync(outside, dist);
    else {
      fs.mkdirSync(dist);
      fs.symlinkSync(kind === "directory" ? outside : file, path.join(dist, "link"));
    }
    const result = run(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unsupported build artifact");
    expect(mode(file)).toBe(0o660);
    expect(mode(outside)).toBe(0o770);
    expect(fs.readFileSync(file, "utf8")).toBe("outside bytes");
  });

  it("rejects multiply-linked files without changing the outside inode", () => {
    const root = fixture(), dist = path.join(root, "dist"), outside = path.join(root, "original");
    fs.mkdirSync(dist);
    fs.writeFileSync(outside, "outside bytes");
    fs.chmodSync(outside, 0o660);
    fs.linkSync(outside, path.join(dist, "alias"));
    const result = run(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unsupported build artifact");
    expect(mode(outside)).toBe(0o660);
  });

  it("runs normalization after generation and before build assertions", () => {
    const { scripts } = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
    expect(scripts.build).toContain("node scripts/build-kiro-closure.mjs && node scripts/normalize-artifact-modes.mjs && node scripts/assert-build-artifacts.mjs");
  });
});
