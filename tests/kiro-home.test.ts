import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { resolveKiroHome, resolveKiroInstallRoots } from "../src/kiro/home.js";

const temps: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "kiro-fabric-kiro-home-"));
  temps.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveKiroHome", () => {
  it("defaults to ~/.kiro", () => {
    const previous = process.env.KIRO_HOME;
    delete process.env.KIRO_HOME;
    try {
      expect(resolveKiroHome()).toBe(resolve(homedir(), ".kiro"));
    } finally {
      if (previous === undefined) delete process.env.KIRO_HOME;
      else process.env.KIRO_HOME = previous;
    }
  });

  it("honors KIRO_HOME and an explicit override", () => {
    const home = scratch();
    const previous = process.env.KIRO_HOME;
    process.env.KIRO_HOME = home;
    try {
      expect(resolveKiroHome()).toBe(realpathSync(home));
      const other = scratch();
      expect(resolveKiroHome(other)).toBe(realpathSync(other));
    } finally {
      if (previous === undefined) delete process.env.KIRO_HOME;
      else process.env.KIRO_HOME = previous;
    }
  });

  it("refuses a Kiro home that is a regular file", () => {
    const dir = scratch();
    const file = join(dir, "not-a-dir");
    writeFileSync(file, "nope\n");
    expect(() => resolveKiroHome(file)).toThrow(/not a directory/);
  });
});

describe("resolveKiroInstallRoots", () => {
  it("keeps project installs inside the project", () => {
    const project = scratch();
    const roots = resolveKiroInstallRoots({ projectRoot: project });
    expect(roots.layout).toBe("project");
    expect(roots.installRoot).toBe(realpathSync(project));
    expect(roots.projectRoot).toBe(realpathSync(project));
  });

  it("places user installs in the Kiro home while binding MCP to the project", () => {
    const project = scratch();
    const home = scratch();
    mkdirSync(home, { recursive: true });
    const roots = resolveKiroInstallRoots({
      scope: "user",
      projectRoot: project,
      kiroHome: home,
    });
    expect(roots.layout).toBe("user");
    expect(roots.installRoot).toBe(realpathSync(home));
    expect(roots.projectRoot).toBe(realpathSync(project));
  });
});
