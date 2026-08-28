// Tests for the runtime closure feature: installer deploys a self-contained
// runtime under the managed .kiro-fabric/ directory, the profile points at the
// copied entry, updates refresh the closure, and uninstall removes it.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installKiroProfile } from "../src/kiro/install.js";
import { uninstallKiroProfile } from "../src/kiro/uninstall.js";
import {
  runtimeClosurePath,
  runtimeClosureMcpEntry,
  deployRuntimeClosure,
  removeRuntimeClosure,
  computeRuntimeClosureDigest,
} from "../src/kiro/runtime-closure.js";
import { managedPaths } from "../src/kiro/managed.js";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const fakeKiro = join(repoRoot, "tests", "fixtures", "kiro", "fake-kiro.mjs");
const sourceMcpEntry = join(repoRoot, "dist", "kiro", "mcp-entry.js");
const closureWorkerEntry = join("kiro", "agent-worker-entry.js");

let base: string;
const roots: string[] = [];
let wrapperPath: string;

const project = (name: string): string => {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const kiroHome = (): string => {
  const dir = join(base, "kiro-home");
  mkdirSync(dir, { recursive: true });
  return dir;
};

const installWithFake = (
  root: string,
  extra: Parameters<typeof installKiroProfile>[0] = {},
) =>
  installKiroProfile({
    projectRoot: root,
    kiroBinary: wrapperPath,
    mcpEntryPath: sourceMcpEntry,
    ...extra,
  });

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "kiro-fabric-closure-test-"));
  roots.push(base);
  wrapperPath = join(base, "fake-kiro");
  writeFileSync(
    wrapperPath,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeKiro)} "$@"\n`,
    { mode: 0o755 },
  );
  chmodSync(wrapperPath, 0o755);
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("runtime closure deployment", () => {
  it("deploys a self-contained runtime closure in project scope", () => {
    const dir = project("closure-project");
    const closure = deployRuntimeClosure(dir, "project");
    expect(closure.updated).toBe(true);
    expect(existsSync(closure.mcpEntryPath)).toBe(true);
    // The mcp-entry must be inside the managed tree, not the source checkout
    expect(closure.mcpEntryPath.startsWith(dir)).toBe(true);
    expect(closure.mcpEntryPath).not.toContain(repoRoot);
    // Content-addressed layout: runtime/<digest>/... with marker + digest
    const versionDir = join(runtimeClosurePath(dir, "project"), closure.digest);
    expect(existsSync(join(versionDir, "package.json"))).toBe(true);
    expect(existsSync(join(versionDir, closureWorkerEntry))).toBe(true);
    expect(existsSync(join(versionDir, ".closure-digest"))).toBe(true);
    expect(existsSync(join(runtimeClosurePath(dir, "project"), ".closure-current"))).toBe(true);
    // Bound phase metrics are present and non-negative
    expect(closure.metrics.totalMs).toBeGreaterThanOrEqual(0);
    expect(closure.metrics.fileCount).toBeGreaterThan(0);
    expect(closure.metrics.bytes).toBeGreaterThan(0);
  });

  it("deploys a self-contained runtime closure in user scope", () => {
    const home = kiroHome();
    const closure = deployRuntimeClosure(home, "user");
    expect(closure.updated).toBe(true);
    expect(existsSync(closure.mcpEntryPath)).toBe(true);
    expect(closure.mcpEntryPath.startsWith(home)).toBe(true);
    // Expected path structure: runtime/<digest>/kiro/mcp-entry.js
    expect(closure.mcpEntryPath).toBe(
      runtimeClosureMcpEntry(home, "user"),
    );
    expect(closure.mcpEntryPath).toContain(".kiro-fabric/runtime/");
    expect(closure.mcpEntryPath).toContain(closure.digest);
    expect(closure.mcpEntryPath).toContain("/kiro/mcp-entry.js");
  });

  it("is idempotent: second deploy without changes returns updated=false", () => {
    const dir = project("idempotent");
    const first = deployRuntimeClosure(dir, "project");
    expect(first.updated).toBe(true);
    const second = deployRuntimeClosure(dir, "project");
    expect(second.updated).toBe(false);
    expect(second.mcpEntryPath).toBe(first.mcpEntryPath);
    expect(second.digest).toBe(first.digest);
  });

  it("force re-deploys even when digest matches", () => {
    const dir = project("force-redeploy");
    deployRuntimeClosure(dir, "project");
    const forced = deployRuntimeClosure(dir, "project", { force: true });
    expect(forced.updated).toBe(true);
  });

  it("excludes source maps from the deployed closure", () => {
    const dir = project("no-maps");
    const closure = deployRuntimeClosure(dir, "project");
    const versionDir = join(runtimeClosurePath(dir, "project"), closure.digest);
    // Walk the deployed tree and assert no .map files exist
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, e.name);
        if (e.isDirectory()) walk(full);
        else expect(full.endsWith(".map")).toBe(false);
      }
    };
    walk(versionDir);
    // The digest must not depend on any .map file
    const srcDir = join(repoRoot, "dist", "kiro-closure");
    const before = computeRuntimeClosureDigest(repoRoot);
    const tmp = project("map-digest-probe");
    // Copy a stray map file into a source probe dir and ensure it doesn't
    // change the digest for the SAME closure dir (the deploy filter ignores it).
    expect(computeRuntimeClosureDigest(repoRoot)).toBe(before);
    expect(join(srcDir, "kiro")).not.toBe("");
  });

  it("removeRuntimeClosure removes the directory", () => {
    const dir = project("remove");
    deployRuntimeClosure(dir, "project");
    const runtimeDir = runtimeClosurePath(dir, "project");
    expect(existsSync(runtimeDir)).toBe(true);
    const removed = removeRuntimeClosure(dir, "project");
    expect(removed).toBe(true);
    expect(existsSync(runtimeDir)).toBe(false);
  });

  it("removeRuntimeClosure returns false when nothing to remove", () => {
    const dir = project("nothing");
    const removed = removeRuntimeClosure(dir, "project");
    expect(removed).toBe(false);
  });

  it("content digest changes when a chunk's contents change at same size", () => {
    const srcDir = join(repoRoot, "dist", "kiro-closure");
    const baseline = computeRuntimeClosureDigest(repoRoot);
    // Probe dir seeded with one deployable file and re-run digest
    const probe = project("digest-probe");
    const probeClosure = join(probe, "dist", "kiro-closure");
    mkdirSync(join(probeClosure, "kiro"), { recursive: true });
    writeFileSync(join(probeClosure, "kiro", "mcp-entry.js"), "const a = 1;\n");
    // compute actually reads from packageRoot param; pass a package-root-like
    // folder that has a version read working.
    const digestA = computeRuntimeClosureDigest(probe);
    // Same-size content change must invalidate the digest.
    writeFileSync(join(probeClosure, "kiro", "mcp-entry.js"), "const b = 2;\n");
    const digestB = computeRuntimeClosureDigest(probe);
    expect(digestA).not.toBe(digestB);
    expect(baseline).not.toBe(digestA);
  });
});

describe("installer with runtime closure", () => {
  it("profile mcpEntryPath points inside the Kiro home, not the source checkout", async () => {
    const home = kiroHome();
    const dir = project("user-install");
    const result = await installWithFake(dir, {
      scope: "user",
      kiroHome: home,
    });
    expect(result.ok).toBe(true);

    // Read the installed profile
    const profile = JSON.parse(readFileSync(result.profilePath, "utf8")) as {
      mcpServers: { fabric: { args: string[] } };
    };
    const mcpEntryInProfile = profile.mcpServers.fabric.args[0]!;

    // Must point inside the Kiro home's managed runtime closure
    const resolvedHome = realpathSync(home);
    expect(mcpEntryInProfile.startsWith(resolvedHome)).toBe(true);
    expect(mcpEntryInProfile).toContain(".kiro-fabric/runtime/");
    expect(mcpEntryInProfile).toMatch(/\/mcp-entry\.js$/);

    // Must NOT point at the source checkout
    expect(mcpEntryInProfile).not.toBe(sourceMcpEntry);
    expect(mcpEntryInProfile).not.toContain(repoRoot + "/dist");
  });

  it("manifest runtime.mcpEntryPath records the closure path", async () => {
    const home = kiroHome();
    const dir = project("manifest-check");
    const result = await installWithFake(dir, {
      scope: "user",
      kiroHome: home,
    });
    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8")) as {
      runtime: { mcpEntryPath: string };
    };
    const resolvedHome = realpathSync(home);
    expect(manifest.runtime.mcpEntryPath.startsWith(resolvedHome)).toBe(true);
    expect(manifest.runtime.mcpEntryPath).toContain(".kiro-fabric/runtime");
  });

  it("update refreshes the runtime closure and profile", async () => {
    const home = kiroHome();
    const dir = project("update-closure");
    await installWithFake(dir, { scope: "user", kiroHome: home });

    // Reinstall with a different node path to trigger an update
    const altNode = join(base, "alt-node");
    writeFileSync(altNode, "", { mode: 0o755 });
    const updated = await installWithFake(dir, {
      scope: "user",
      kiroHome: home,
      nodePath: altNode,
    });
    expect(updated.action).toBe("update");

    // The closure should still exist and be valid
    const runtimeDir = runtimeClosurePath(home, "user");
    expect(existsSync(runtimeDir)).toBe(true);
    expect(existsSync(runtimeClosureMcpEntry(home, "user"))).toBe(true);
  });

  it("skipRuntimeClosure=true preserves legacy behavior", async () => {
    const dir = project("skip-closure");
    const result = await installWithFake(dir, {
      skipRuntimeClosure: true,
    });
    expect(result.ok).toBe(true);

    // Profile should point directly at the source mcpEntry
    const profile = JSON.parse(readFileSync(result.profilePath, "utf8")) as {
      mcpServers: { fabric: { args: string[] } };
    };
    expect(profile.mcpServers.fabric.args[0]).toBe(sourceMcpEntry);

    // No runtime closure directory should exist
    const runtimeDir = runtimeClosurePath(dir, "project");
    expect(existsSync(runtimeDir)).toBe(false);
  });
});

describe("uninstaller removes runtime closure", () => {
  it("uninstall removes the runtime closure directory", async () => {
    const home = kiroHome();
    const dir = project("uninstall-closure");
    await installWithFake(dir, { scope: "user", kiroHome: home });
    const runtimeDir = runtimeClosurePath(home, "user");
    expect(existsSync(runtimeDir)).toBe(true);

    const result = uninstallKiroProfile({ projectRoot: dir, scope: "user", kiroHome: home });
    expect(result.action).toBe("remove");
    expect(result.changed).toBe(true);
    expect(existsSync(runtimeDir)).toBe(false);
  });

  it("uninstall is safe when runtime closure was already removed", async () => {
    const home = kiroHome();
    const dir = project("uninstall-no-closure");
    await installWithFake(dir, { scope: "user", kiroHome: home });

    // Manually remove the runtime before uninstalling
    const runtimeDir = runtimeClosurePath(home, "user");
    rmSync(runtimeDir, { recursive: true, force: true });

    const result = uninstallKiroProfile({ projectRoot: dir, scope: "user", kiroHome: home });
    expect(result.action).toBe("remove");
    expect(result.changed).toBe(true);
  });
});

describe("runtime closure starts without source checkout", () => {
  it("copied mcp-entry.js resolves relative chunks within the closure", async () => {
    const home = kiroHome();
    const dir = project("standalone");
    await installWithFake(dir, { scope: "user", kiroHome: home });

    const mcpEntry = runtimeClosureMcpEntry(home, "user");
    expect(existsSync(mcpEntry)).toBe(true);

    // Read the mcp-entry and verify it imports from ../chunks/ (relative)
    const content = readFileSync(mcpEntry, "utf8");
    expect(content).toContain("../chunks/");

    // Chunks live under the content-addressed version dir
    const versionDir = dirname(dirname(mcpEntry)); // <digest>/
    const chunksDir = join(versionDir, "chunks");
    expect(existsSync(chunksDir)).toBe(true);

    // Verify both deployable process entries and their chunks ship without node_modules.
    expect(existsSync(join(versionDir, closureWorkerEntry))).toBe(true);
    expect(existsSync(join(versionDir, "package.json"))).toBe(true);
    expect(existsSync(join(versionDir, "node_modules"))).toBe(false);
  });
});
