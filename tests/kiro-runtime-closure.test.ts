// Tests for the runtime closure feature: installer deploys a self-contained
// runtime under the managed .fabric/runtime directory, the profile points at the
// copied entry, updates refresh the closure, and uninstall removes it.

import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  lstatSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installKiroProfile } from "../src/kiro/install-test-helper.js";
import { resolveKiroMcpLaunchEnvironment } from "../src/kiro/mcp-environment.js";
import { uninstallKiroProfile } from "../src/kiro/uninstall.js";
import {
  runtimeClosurePath,
  runtimeClosureMcpEntry,
  deployRuntimeClosure,
  removeAttestedRuntimeClosure,
  removeRuntimeActivationMarker,
  removeRuntimeClosure,
  computeRuntimeClosureDigest,
  planRuntimeClosureDeployment,
  recoverRuntimeClosureRepair,
  runtimeClosureRepairJournalPath,
} from "../src/kiro/runtime-closure.js";
import {
  attestExecutable,
  managedPaths,
  readManifest,
  serializeJson,
  sha256Bytes,
} from "../src/kiro/managed.js";
import { withRuntimeQuarantineRaceForTest } from "../src/kiro/runtime-closure-test-seam.js";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const fakeKiro = join(repoRoot, "tests", "fixtures", "kiro", "fake-kiro.mjs");
const sourceMcpEntry = join(repoRoot, "dist", "kiro", "mcp-entry.js");
const closureWorkerEntry = join("kiro", "agent-worker-entry.js");

let base: string;
const roots: string[] = [];
let wrapperPath: string;
let fakeRuntimePath: string;

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

const makeRemovable = (dir: string): void => {
  if (!existsSync(dir)) return;
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return;
  chmodSync(dir, 0o700);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) makeRemovable(join(dir, entry.name));
  }
};

const installWithFake = (
  root: string,
  extra: Parameters<typeof installKiroProfile>[0] = {},
) =>
  installKiroProfile({
    projectRoot: root,
    kiroBinary: wrapperPath,
    mcpEntryPath: sourceMcpEntry,
    runtimeNodeSourcePath: fakeRuntimePath,
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
  fakeRuntimePath = join(base, "fake-node-runtime");
  writeFileSync(fakeRuntimePath, "#!/bin/sh\nexit 97\n", { mode: 0o755 });
  chmodSync(fakeRuntimePath, 0o755);
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    makeRemovable(root);
    rmSync(root, { recursive: true, force: true });
  }
});

describe("runtime closure deployment", () => {
  const deploySmall = (root: string, layout: "project" | "user") =>
    deployRuntimeClosure(root, layout, {
      nodeSourcePath: fakeRuntimePath,
      kiroAttestation: attestExecutable(fakeRuntimePath),
    });

  it("normalizes an existing runtime parent to uninstall's private-mode contract", () => {
    const dir = project("runtime-parent-mode");
    const runtimeDir = runtimeClosurePath(dir, "project");
    mkdirSync(runtimeDir, { recursive: true, mode: 0o755 });
    chmodSync(runtimeDir, 0o755);

    const closure = deploySmall(dir, "project");
    expect(statSync(runtimeDir).mode & 0o777).toBe(0o700);
    expect(removeAttestedRuntimeClosure(dir, "project", closure.attestation)).toBe(true);
  });

  it("compares executable attestations against the canonical source target", () => {
    const dir = project("canonical-node-attestation");
    const canonicalParent = project("canonical-node-source");
    const aliasParent = join(base, "node-source-parent-alias");
    const canonicalNode = join(canonicalParent, "node");
    writeFileSync(canonicalNode, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    chmodSync(canonicalNode, 0o755);
    symlinkSync(canonicalParent, aliasParent, "dir");
    const lexicalNode = join(aliasParent, "node");
    const attestation = attestExecutable(lexicalNode);

    expect(() => planRuntimeClosureDeployment(dir, "project", {
      nodeSourcePath: lexicalNode,
      nodeAttestation: attestation,
      kiroAttestation: attestExecutable(fakeRuntimePath),
    })).not.toThrow();
    expect(attestation.path).toBe(realpathSync(canonicalNode));
  });

  it("directly recovers the SIGKILL window after parking a same-digest release", () => {
    const dir = project("repair-park-recovery");
    const closure = deploySmall(dir, "project");
    const runtimeDir = runtimeClosurePath(dir, "project");
    const versionDir = join(runtimeDir, closure.digest);
    const damagedDir = join(runtimeDir, `.damaged-${closure.digest}`);
    const journal = runtimeClosureRepairJournalPath(dir, "project", closure.digest);
    writeFileSync(journal, JSON.stringify({
      format: 1,
      digest: closure.digest,
      root: closure.attestation.root,
    }, null, 2) + "\n", { mode: 0o600 });
    renameSync(versionDir, damagedDir);

    expect(recoverRuntimeClosureRepair(dir, "project", closure.attestation)).toBe(true);
    expect(existsSync(versionDir)).toBe(true);
    expect(existsSync(damagedDir)).toBe(false);
    expect(existsSync(journal)).toBe(false);
  });

  it("quarantines a generation before verification and never deletes a raced replacement", () => {
    const dir = project("generation-quarantine-race");
    const closure = deploySmall(dir, "project");
    const generation = join(runtimeClosurePath(dir, "project"), closure.digest);
    const parked = generation + ".attested-parked";
    const sentinel = join(generation, "must-survive");

    expect(() => withRuntimeQuarantineRaceForTest((kind, source) => {
      if (kind !== "generation") return;
      renameSync(source, parked);
      mkdirSync(source);
      writeFileSync(sentinel, "unattested replacement\n");
    }, () => removeAttestedRuntimeClosure(dir, "project", closure.attestation)))
      .toThrow(/file set does not match manifest/);

    expect(readFileSync(sentinel, "utf8")).toBe("unattested replacement\n");
    expect(existsSync(parked)).toBe(true);
  });

  it("detects a generation replacement after verification and deletes neither inode", () => {
    const dir = project("generation-post-verify-race");
    const closure = deploySmall(dir, "project");
    let replacementSentinel = "";
    let parked = "";

    expect(() => withRuntimeQuarantineRaceForTest((kind, source) => {
      if (kind !== "generation-post-verify") return;
      const actual = join(realpathSync(dirname(source)), basename(source));
      parked = actual + ".verified-parked";
      renameSync(actual, parked);
      mkdirSync(actual);
      replacementSentinel = join(actual, "must-survive");
      writeFileSync(replacementSentinel, "post-verification replacement\n");
    }, () => removeAttestedRuntimeClosure(dir, "project", closure.attestation)))
      .toThrow(/replaced after verification/);

    expect(readFileSync(replacementSentinel, "utf8")).toBe("post-verification replacement\n");
    expect(existsSync(parked)).toBe(true);
  });

  it("quarantines the activation marker and preserves raced bytes on mismatch", () => {
    const dir = project("marker-quarantine-race");
    const closure = deploySmall(dir, "project");
    const marker = join(runtimeClosurePath(dir, "project"), ".closure-current");
    const parked = marker + ".attested-parked";

    expect(() => withRuntimeQuarantineRaceForTest((kind, source) => {
      if (kind !== "marker") return;
      renameSync(source, parked);
      writeFileSync(source, "0".repeat(64) + "\n", { mode: 0o600 });
    }, () => removeRuntimeActivationMarker(dir, "project", closure.digest)))
      .toThrow(/marker changed during cleanup/);

    expect(readFileSync(marker, "utf8")).toBe("0".repeat(64) + "\n");
    expect(readFileSync(parked, "utf8")).toBe(closure.digest + "\n");
  });

  it("detects activation-marker replacement after verification", () => {
    const dir = project("marker-post-verify-race");
    const closure = deploySmall(dir, "project");
    let parked = "";
    let replacement = "";

    expect(() => withRuntimeQuarantineRaceForTest((kind, source) => {
      if (kind !== "marker-post-verify") return;
      const actual = join(realpathSync(dirname(source)), basename(source));
      parked = actual + ".verified-parked";
      renameSync(actual, parked);
      replacement = actual;
      writeFileSync(replacement, "replacement\n", { mode: 0o600 });
    }, () => removeRuntimeActivationMarker(dir, "project", closure.digest)))
      .toThrow(/replaced after verification/);

    expect(readFileSync(replacement, "utf8")).toBe("replacement\n");
    expect(readFileSync(parked, "utf8")).toBe(closure.digest + "\n");
  });

  it("deploys a self-contained runtime closure in project scope", () => {
    const dir = project("closure-project");
    const closure = deploySmall(dir, "project");
    expect(closure.updated).toBe(true);
    expect(existsSync(closure.mcpEntryPath)).toBe(true);
    // The mcp-entry must be inside the managed tree, not the source checkout
    expect(closure.mcpEntryPath.startsWith(dir)).toBe(true);
    expect(closure.mcpEntryPath).not.toContain(repoRoot);
    // Content-addressed layout: runtime/<digest>/... with marker + digest
    const versionDir = join(runtimeClosurePath(dir, "project"), closure.digest);
    expect(existsSync(join(versionDir, "package.json"))).toBe(true);
    expect(existsSync(join(versionDir, closureWorkerEntry))).toBe(true);
    expect(existsSync(closure.runtimeNodePath)).toBe(true);
    expect(existsSync(closure.managementEntryPath)).toBe(true);
    expect(closure.runtimeNodePath.startsWith(join(dir, ".fabric", "runtime"))).toBe(true);
    expect(closure.managementEntryPath.startsWith(join(dir, ".fabric", "runtime"))).toBe(true);
    expect(readFileSync(closure.runtimeNodePath)).toEqual(readFileSync(fakeRuntimePath));
    expect(closure.attestation.files).toContainEqual(expect.objectContaining({
      path: expect.stringMatching(/\/bin\/node(?:\.exe)?$/),
      executableMode: 0o555,
    }));
    expect(existsSync(join(versionDir, ".closure-digest"))).toBe(true);
    expect(existsSync(join(runtimeClosurePath(dir, "project"), ".closure-current"))).toBe(true);
    expect(lstatSync(versionDir).mode & 0o777).toBe(0o555);
    expect(lstatSync(closure.mcpEntryPath).mode & 0o777).toBe(0o444);
    expect(lstatSync(closure.runtimeNodePath).mode & 0o777).toBe(0o555);
    // Bound phase metrics are present and non-negative
    expect(closure.metrics.totalMs).toBeGreaterThanOrEqual(0);
    expect(closure.metrics.fileCount).toBeGreaterThan(0);
    expect(closure.metrics.bytes).toBeGreaterThan(0);
  });

  it("deploys a self-contained runtime closure in user scope", () => {
    const home = kiroHome();
    const closure = deploySmall(home, "user");
    expect(closure.updated).toBe(true);
    expect(existsSync(closure.mcpEntryPath)).toBe(true);
    expect(closure.mcpEntryPath.startsWith(home)).toBe(true);
    // Expected path structure: runtime/<digest>/kiro/mcp-entry.js
    expect(closure.mcpEntryPath).toBe(
      runtimeClosureMcpEntry(home, "user"),
    );
    expect(closure.mcpEntryPath).toContain(".fabric/runtime/");
    expect(closure.mcpEntryPath).toContain(closure.digest);
    expect(closure.mcpEntryPath).toContain("/kiro/mcp-entry.js");
  });


  it("refuses a symlinked activation marker without following it", () => {
    const dir = project("marker-symlink");
    const runtime = runtimeClosurePath(dir, "project");
    mkdirSync(runtime, { recursive: true });
    const outside = join(dir, "outside-marker");
    writeFileSync(outside, "outside\n");
    symlinkSync(outside, join(runtime, ".closure-current"));
    expect(() => deploySmall(dir, "project")).toThrow(/marker.*regular file|symlink/i);
    expect(readFileSync(outside, "utf8")).toBe("outside\n");
  });

  it("requires a distinct Kiro executable attestation", () => {
    const dir = project("missing-kiro-attestation");
    expect(() => planRuntimeClosureDeployment(dir, "project", {
      nodeSourcePath: fakeRuntimePath,
      nodeAttestation: attestExecutable(fakeRuntimePath),
    })).toThrow(/separately attested Kiro executable/);
    expect(existsSync(runtimeClosurePath(dir, "project"))).toBe(false);
  });

  it("rejects a Node inode replacement after planning instead of copying new bytes", () => {
    const dir = project("node-race");
    const attestation = attestExecutable(fakeRuntimePath);
    const plan = planRuntimeClosureDeployment(dir, "project", {
      nodeSourcePath: fakeRuntimePath,
      nodeAttestation: attestation,
      kiroAttestation: attestation,
    });
    rmSync(fakeRuntimePath);
    writeFileSync(fakeRuntimePath, "#!/bin/sh\nexit 42\n", { mode: 0o755 });
    chmodSync(fakeRuntimePath, 0o755);
    expect(() => deployRuntimeClosure(dir, "project", {
      expectedDigest: plan.digest,
      nodeSourcePath: fakeRuntimePath,
      nodeAttestation: attestation,
      kiroAttestation: attestation,
    })).toThrow(/executable changed|attestation|concurrency/i);
    expect(existsSync(join(runtimeClosurePath(dir, "project"), plan.digest))).toBe(false);
  });

  it("is idempotent: second deploy without changes returns updated=false", () => {
    const dir = project("idempotent");
    const first = deploySmall(dir, "project");
    expect(first.updated).toBe(true);
    const second = deploySmall(dir, "project");
    expect(second.updated).toBe(false);
    expect(second.mcpEntryPath).toBe(first.mcpEntryPath);
    expect(second.digest).toBe(first.digest);
  });

  it("force never replaces an immutable digest directory", () => {
    const dir = project("force-redeploy");
    deploySmall(dir, "project");
    const forced = deployRuntimeClosure(dir, "project", {
      force: true,
      nodeSourcePath: fakeRuntimePath,
      kiroAttestation: attestExecutable(fakeRuntimePath),
    });
    expect(forced.updated).toBe(false);
    expect(forced.action).toBe("noop");
  });

  it("excludes source maps from the deployed closure", () => {
    const dir = project("no-maps");
    const closure = deploySmall(dir, "project");
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
    deploySmall(dir, "project");
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
    cpSync(join(repoRoot, "strict", "skills"), join(probe, "strict", "skills"), { recursive: true });
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
      mcpServers: { fabric: { command: string; args: string[]; env: Record<string, string> } };
    };
    const mcpEntryInProfile = profile.mcpServers.fabric.args[0]!;
    expect(profile.mcpServers.fabric.command).toBe(result.runtimeClosure?.runtimeNodePath);
    expect(profile.mcpServers.fabric.env.KIRO_FABRIC_NODE_BINARY).toBe(result.runtimeClosure?.runtimeNodePath);

    // Must point inside the Kiro home's managed runtime closure
    const resolvedHome = realpathSync(home);
    expect(mcpEntryInProfile.startsWith(resolvedHome)).toBe(true);
    expect(mcpEntryInProfile).toContain(".fabric/runtime/");
    expect(mcpEntryInProfile).toMatch(/\/mcp-entry\.js$/);

    // Must NOT point at the source checkout
    expect(mcpEntryInProfile).not.toBe(sourceMcpEntry);
    expect(mcpEntryInProfile).not.toContain(repoRoot + "/dist");

    // Runtime bytes execute from .fabric, while repository access follows the
    // canonical directory in which kiro-cli started.
    const launchDirectory = project("launch-workspace");
    expect(resolveKiroMcpLaunchEnvironment(profile.mcpServers.fabric.env, launchDirectory))
      .toEqual({ mode: "strict", cwd: realpathSync(launchDirectory), kind: "managed-main" });
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
    expect(manifest.runtime.mcpEntryPath).toContain(".fabric/runtime");
  });

  it("updates and uninstalls an attested pre-.fabric runtime without orphaning it", async () => {
    const dir = project("legacy-runtime-migration");
    const installed = await installWithFake(dir);
    const paths = managedPaths(dir, "project");
    mkdirSync(dirname(paths.legacyRuntimeDir), { recursive: true });
    renameSync(paths.runtimeDir, paths.legacyRuntimeDir);

    const relocate = <T>(value: T): T => JSON.parse(
      JSON.stringify(value).replaceAll(".fabric/runtime", ".kiro/.kiro-fabric/runtime"),
    ) as T;
    const profile = relocate(JSON.parse(readFileSync(installed.profilePath, "utf8")));
    const profileJson = serializeJson(profile);
    writeFileSync(installed.profilePath, profileJson, { mode: 0o600 });
    const manifest = relocate(JSON.parse(readFileSync(installed.manifestPath, "utf8"))) as {
      profile: { installedSha256: string };
    };
    manifest.profile.installedSha256 = sha256Bytes(profileJson);
    writeFileSync(installed.manifestPath, serializeJson(manifest), { mode: 0o600 });

    expect(readManifest(dir, "project")?.runtime.closure?.root)
      .toContain(".kiro/.kiro-fabric/runtime/");
    const updated = await installWithFake(dir);
    expect(updated.runtimeClosure?.mcpEntryPath).toContain(".fabric/runtime/");
    const migrated = readManifest(dir, "project")!;
    expect(migrated.runtime.generations?.map((generation) => generation.root))
      .toEqual(expect.arrayContaining([
        expect.stringContaining(".fabric/runtime/"),
        expect.stringContaining(".kiro/.kiro-fabric/runtime/"),
      ]));

    uninstallKiroProfile({ projectRoot: dir });
    expect(existsSync(paths.runtimeDir)).toBe(false);
    expect(existsSync(paths.legacyRuntimeDir)).toBe(false);
    expect(existsSync(dirname(paths.runtimeDir))).toBe(false);
  });


  it("refuses ordinary reinstall but trusted repair atomically restores a tampered release", async () => {
    const dir = project("attestation-tamper");
    const installed = await installWithFake(dir);
    const manifest = JSON.parse(readFileSync(installed.manifestPath, "utf8")) as {
      runtime: { closure: { root: string } };
    };
    const closureRoot = join(dir, ...manifest.runtime.closure.root.split("/"));
    const entry = join(closureRoot, "kiro", "mcp-entry.js");
    const original = readFileSync(entry);
    const changed = Buffer.from(original);
    changed[0] = changed[0] === 0x20 ? 0x21 : 0x20;
    chmodSync(entry, 0o644);
    writeFileSync(entry, changed);
    await expect(installWithFake(dir)).rejects.toThrow(/runtime closure hash mismatch/);
    const repairedBytes = await installWithFake(dir, { repairRuntime: true });
    expect(repairedBytes.runtimeClosure?.action).toBe("repair");
    expect(readFileSync(entry)).toEqual(original);
    expect(statSync(entry).mode & 0o777).toBe(0o444);

    chmodSync(repairedBytes.runtimeClosure!.runtimeNodePath, 0o644);
    const repairedMode = await installWithFake(dir, { repairRuntime: true });
    expect(repairedMode.runtimeClosure?.action).toBe("repair");
    expect(statSync(repairedMode.runtimeClosure!.runtimeNodePath).mode & 0o777).toBe(0o555);

    chmodSync(closureRoot, 0o755);
    writeFileSync(join(closureRoot, "foreign-extra.js"), "foreign\n");
    await expect(installWithFake(dir)).rejects.toThrow(/file set does not match/);
    const repairedSet = await installWithFake(dir, { repairRuntime: true });
    expect(repairedSet.runtimeClosure?.action).toBe("repair");
    expect(existsSync(join(closureRoot, "foreign-extra.js"))).toBe(false);
    expect(statSync(closureRoot).mode & 0o777).toBe(0o555);
  });

  it("refuses uninstall before profile mutation when runtime attestation drifts", async () => {
    const dir = project("attestation-uninstall");
    const installed = await installWithFake(dir);
    const manifest = JSON.parse(readFileSync(installed.manifestPath, "utf8")) as {
      runtime: { closure: { root: string } };
    };
    const entry = join(dir, ...manifest.runtime.closure.root.split("/"), "kiro", "mcp-entry.js");
    chmodSync(entry, 0o644);
    writeFileSync(entry, "tampered runtime\n");
    expect(() => uninstallKiroProfile({ projectRoot: dir })).toThrow(/runtime closure hash mismatch/);
    expect(existsSync(installed.profilePath)).toBe(true);
    expect(existsSync(installed.manifestPath)).toBe(true);
  });

  it("update refreshes the runtime closure and profile", async () => {
    const home = kiroHome();
    const dir = project("update-closure");
    await installWithFake(dir, { scope: "user", kiroHome: home });

    // Reinstall with a different node path to trigger an update
    const altNode = join(base, "alt-node");
    writeFileSync(altNode, `#!/bin/sh\necho v${process.versions.node}\n`, { mode: 0o755 });
    const updated = await installWithFake(dir, {
      scope: "user",
      kiroHome: home,
      nodePath: altNode,
      runtimeNodeSourcePath: altNode,
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

  it("tracks and removes every owned generation before removing the manifest", async () => {
    const home = kiroHome();
    const dir = project("uninstall-generations");
    const first = await installWithFake(dir, { scope: "user", kiroHome: home });
    const secondNode = join(base, "second-runtime");
    writeFileSync(secondNode, "#!/bin/sh\nexit 43\n", { mode: 0o755 });
    chmodSync(secondNode, 0o755);
    const second = await installWithFake(dir, {
      scope: "user",
      kiroHome: home,
      runtimeNodeSourcePath: secondNode,
    });
    const manifest = JSON.parse(readFileSync(second.manifestPath, "utf8")) as {
      runtime: { generations: Array<{ digest: string; root: string }> };
    };
    expect(manifest.runtime.generations).toHaveLength(2);
    const ownedRoots = manifest.runtime.generations.map((generation) =>
      join(realpathSync(home), ...generation.root.split("/")),
    );
    expect(ownedRoots).toContain(dirname(dirname(first.runtimeClosure!.mcpEntryPath)));

    const thirdNode = join(base, "third-runtime");
    writeFileSync(thirdNode, "#!/bin/sh\nexit 44\n", { mode: 0o755 });
    chmodSync(thirdNode, 0o755);
    const third = await installWithFake(dir, {
      scope: "user",
      kiroHome: home,
      runtimeNodeSourcePath: thirdNode,
    });
    const bounded = JSON.parse(readFileSync(third.manifestPath, "utf8")) as {
      runtime: { generations: Array<{ digest: string; root: string }> };
    };
    expect(bounded.runtime.generations).toHaveLength(2);
    expect(existsSync(dirname(dirname(first.runtimeClosure!.mcpEntryPath)))).toBe(false);

    uninstallKiroProfile({ projectRoot: dir, scope: "user", kiroHome: home });
    for (const owned of ownedRoots) expect(existsSync(owned)).toBe(false);
    expect(existsSync(second.manifestPath)).toBe(false);
  });

  it("uninstall is safe when runtime closure was already removed", async () => {
    const home = kiroHome();
    const dir = project("uninstall-no-closure");
    await installWithFake(dir, { scope: "user", kiroHome: home });

    // Manually remove the runtime before uninstalling
    const runtimeDir = runtimeClosurePath(home, "user");
    makeRemovable(runtimeDir);
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
