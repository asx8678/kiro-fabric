import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertTrackedGitWorktreeClean, uniquePackageRecords } from "../scripts/package-identity.mjs";

describe("closure dependency identity", () => {
  it("keeps two versions of the same package as separate SBOM inputs", () => {
    const records = uniquePackageRecords([
      { name: "fixture", version: "1.0.0", license: "MIT", root: "/one" },
      { name: "fixture", version: "2.0.0", license: "MIT", root: "/two" },
      { name: "fixture", version: "1.0.0", license: "MIT", root: "/one" },
    ]);
    expect(records.map(({ name, version }) => [name, version])).toEqual([
      ["fixture", "1.0.0"],
      ["fixture", "2.0.0"],
    ]);
  });

  it("binds exact-commit evidence to tracked content while ignoring untracked staging", () => {
    const repository = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-git-identity-"));
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
    };
    try {
      git("init", "--quiet");
      fs.writeFileSync(path.join(repository, "tracked"), "committed\n");
      git("add", "tracked");
      git("-c", "user.name=Kiro Fabric", "-c", "user.email=tests@example.invalid", "commit", "--quiet", "-m", "fixture");
      expect(() => assertTrackedGitWorktreeClean(repository)).not.toThrow();

      fs.writeFileSync(path.join(repository, "untracked"), "ignored by the tracked-content gate\n");
      expect(() => assertTrackedGitWorktreeClean(repository)).not.toThrow();

      fs.writeFileSync(path.join(repository, "tracked"), "unstaged\n");
      expect(() => assertTrackedGitWorktreeClean(repository)).toThrow("unstaged changes");
      fs.writeFileSync(path.join(repository, "tracked"), "committed\n");
      expect(() => assertTrackedGitWorktreeClean(repository)).not.toThrow();

      fs.writeFileSync(path.join(repository, "tracked"), "staged\n");
      git("add", "tracked");
      expect(() => assertTrackedGitWorktreeClean(repository)).toThrow("staged changes");
    } finally {
      fs.rmSync(repository, { recursive: true, force: true });
    }
  });
});
