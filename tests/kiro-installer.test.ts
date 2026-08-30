// PR 5 installer tests. All Kiro subprocess calls go through the fake
// non-billable binary (tests/fixtures/kiro/fake-kiro.mjs) via --kiro-binary.

import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installKiroProfile as installKiroProfileProduction,
  KiroInstallError,
  planKiroProfileInstall,
  resolveKiroProjectRoot,
} from "../src/kiro/install.js";
import { installKiroProfile } from "../src/kiro/install-test-helper.js";
import { uninstallKiroProfile } from "../src/kiro/uninstall.js";
import { runKiroCli } from "../src/kiro/cli.js";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { assertSupportedKiro } from "../src/kiro/compatibility.js";
import { kiroProfilePath } from "../src/kiro/profile.js";
import {
  deployRuntimeClosure,
  planRuntimeClosureDeployment,
} from "../src/kiro/runtime-closure.js";
import {
  managedFileTransition,
  managedPaths,
  sha256Bytes,
  writeAtomic,
  writeManagedTransactionJournal,
  type KiroManagedTransaction,
} from "../src/kiro/managed.js";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const fakeKiro = join(repoRoot, "tests", "fixtures", "kiro", "fake-kiro.mjs");
const mcpEntry = join(repoRoot, "dist", "kiro", "mcp-entry.js");

let base: string;
const roots: string[] = [];
let wrapperPath: string;

const project = (name: string): string => {
  const dir = join(base, name);
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

const installWithFake = (root: string, extra: Parameters<typeof installKiroProfile>[0] = {}) =>
  installKiroProfile({
    projectRoot: root,
    kiroBinary: wrapperPath,
    mcpEntryPath: mcpEntry,
    runtimeNodeSourcePath: wrapperPath,
    skipRuntimeClosure: true,
    fabricConfig: structuredClone(DEFAULT_FABRIC_CONFIG),
    ...extra,
  });

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "kiro-fabric-install-test-"));
  roots.push(base);
  // Executable wrapper so execFile can run the fake directly.
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
    makeRemovable(root);
    rmSync(root, { recursive: true, force: true });
  }
});

describe("resolveKiroProjectRoot", () => {
  it("canonicalizes an explicit relative root against cwd", () => {
    const dir = project("a");
    expect(resolveKiroProjectRoot(dir)).toBe(realpathSync(dir));
  });

  it("resolves a symlinked root to its canonical target", () => {
    const target = project("target");
    const link = join(base, "link");
    symlinkSync(target, link);
    expect(resolveKiroProjectRoot(link)).toBe(realpathSync(target));
  });

  it("rejects a nonexistent root without walking up", () => {
    expect(() => resolveKiroProjectRoot(join(base, "missing"))).toThrow(KiroInstallError);
  });

  it("rejects a root that is a regular file", () => {
    const file = join(base, "file.txt");
    writeFileSync(file, "x");
    expect(() => resolveKiroProjectRoot(file)).toThrow(/not a directory/);
  });

  it("does not ascend to a git root", () => {
    const nested = join(base, "repo", "src", "deep");
    mkdirSync(nested, { recursive: true });
    mkdirSync(join(base, "repo", ".git"));
    expect(resolveKiroProjectRoot(nested)).toBe(realpathSync(nested));
  });
});

describe("planKiroProfileInstall", () => {
  it("plans create for a fresh project with canonical paths and hash", () => {
    const dir = project("fresh");
    const plan = planKiroProfileInstall({ projectRoot: dir, mcpEntryPath: mcpEntry });
    expect(plan.action).toBe("create");
    expect(plan.projectRoot).toBe(realpathSync(dir));
    expect(plan.profilePath).toBe(kiroProfilePath(realpathSync(dir)));
    expect(plan.profileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.profileJson.endsWith("\n")).toBe(true);
    expect(JSON.parse(plan.profileJson).mcpServers.fabric.env.KIRO_FABRIC_PROJECT_ROOT)
      .toBe(realpathSync(dir));
  });

  it("embeds the trusted-local shell opt-in only when requested", () => {
    const dir = project("trusted-shell");
    const defaultPlan = planKiroProfileInstall({ projectRoot: dir, mcpEntryPath: mcpEntry });
    const defaultProfile = JSON.parse(defaultPlan.profileJson) as {
      mcpServers: { fabric: { env: Record<string, string> } };
    };
    expect(defaultProfile.mcpServers.fabric.env).not.toHaveProperty(
      "KIRO_FABRIC_ALLOW_SHELL",
    );

    const trustedPlan = planKiroProfileInstall({
      projectRoot: dir,
      mcpEntryPath: mcpEntry,
      allowShell: true,
    });
    const trustedProfile = JSON.parse(trustedPlan.profileJson) as {
      mcpServers: { fabric: { env: Record<string, string> } };
    };
    expect(trustedProfile.mcpServers.fabric.env.KIRO_FABRIC_ALLOW_SHELL).toBe("1");

    expect(() => planKiroProfileInstall({
      projectRoot: dir,
      mcpEntryPath: mcpEntry,
      enableSubagents: true,
    })).toThrow(/require.*allowShell/i);
    const fanoutPlan = planKiroProfileInstall({
      projectRoot: dir,
      mcpEntryPath: mcpEntry,
      allowShell: true,
      enableSubagents: true,
    });
    const fanoutProfile = JSON.parse(fanoutPlan.profileJson) as {
      mcpServers: { fabric: { env: Record<string, string> } };
    };
    expect(fanoutProfile.mcpServers.fabric.env).toMatchObject({
      KIRO_FABRIC_ALLOW_SHELL: "1",
      KIRO_FABRIC_ENABLE_SUBAGENTS: "1",
    });
  });

  it("blocks unknown differing content and requires --force", () => {
    const dir = project("collision");
    mkdirSync(dirname(kiroProfilePath(dir)), { recursive: true });
    writeFileSync(kiroProfilePath(dir), JSON.stringify({ name: "other" }));
    const plan = planKiroProfileInstall({ projectRoot: dir, mcpEntryPath: mcpEntry });
    expect(plan.action).toBe("blocked");
    expect(plan.requiresForce).toBe(true);
    const forced = planKiroProfileInstall({ projectRoot: dir, mcpEntryPath: mcpEntry, force: true });
    expect(forced.action).toBe("create");
  });

  it("adopts unknown content that is already byte-identical", () => {
    const dir = project("identical");
    const reference = planKiroProfileInstall({ projectRoot: dir, mcpEntryPath: mcpEntry });
    mkdirSync(dirname(kiroProfilePath(dir)), { recursive: true });
    writeFileSync(kiroProfilePath(dir), reference.profileJson);
    const plan = planKiroProfileInstall({ projectRoot: dir, mcpEntryPath: mcpEntry });
    expect(plan.action).toBe("adopt");
  });

  it("refuses a profile symlink even with --force", () => {
    const dir = project("symlinked");
    const outside = join(base, "outside.json");
    writeFileSync(outside, "{}");
    mkdirSync(join(dir, ".kiro", "agents"), { recursive: true });
    symlinkSync(outside, kiroProfilePath(dir));
    expect(() =>
      planKiroProfileInstall({ projectRoot: dir, mcpEntryPath: mcpEntry, force: true }),
    ).toThrow(/symlink/);
    expect(readFileSync(outside, "utf8")).toBe("{}");
  });

  it("refuses a symlink at the .kiro component", () => {
    const dir = project("kiro-link");
    const outside = project("elsewhere");
    symlinkSync(outside, join(dir, ".kiro"));
    expect(() =>
      planKiroProfileInstall({ projectRoot: dir, mcpEntryPath: mcpEntry }),
    ).toThrow(/symlink/);
  });

  it.each([
    ["declared-json", "other.json", JSON.stringify({ name: "kiro-fabric" })],
    ["frontmatter-md", "other.md", "---\nname: kiro-fabric\n---\nPrompt\n"],
    ["malformed-md", "kiro-fabric.md", "---\nname: [\n---\nPrompt\n"],
  ])("refuses a v3 agent name collision: %s", (_case, filename, content) => {
    const dir = project(`dup-${_case}`);
    mkdirSync(join(dir, ".kiro", "agents"), { recursive: true });
    writeFileSync(join(dir, ".kiro", "agents", filename), content);
    expect(() =>
      planKiroProfileInstall({ projectRoot: dir, mcpEntryPath: mcpEntry }),
    ).toThrow(/already declares or can resolve as name/);
  });

  it("skips the nested workspace probe when user home is also the project root", () => {
    const home = project("same-user-project-root");
    mkdirSync(join(home, ".kiro", "agents"), { recursive: true });
    writeFileSync(
      join(home, ".kiro", "agents", "other.json"),
      JSON.stringify({ name: "kiro-fabric" }),
    );
    expect(planKiroProfileInstall({
      scope: "user",
      projectRoot: home,
      kiroHome: home,
      mcpEntryPath: mcpEntry,
    }).action).toBe("create");
  });

  it("still detects a workspace collision for a distinct user profile home", () => {
    const home = project("distinct-user-home");
    const dir = project("distinct-user-project");
    mkdirSync(join(dir, ".kiro", "agents"), { recursive: true });
    writeFileSync(
      join(dir, ".kiro", "agents", "other.json"),
      JSON.stringify({ name: "kiro-fabric" }),
    );
    expect(() => planKiroProfileInstall({
      scope: "user",
      projectRoot: dir,
      kiroHome: home,
      mcpEntryPath: mcpEntry,
    })).toThrow(/already declares or can resolve as name/);
  });
  it("blocks an unmanaged filename-derived kiro-fabric.json target", () => {
    const dir = project("dup-filename-json");
    mkdirSync(join(dir, ".kiro", "agents"), { recursive: true });
    writeFileSync(
      join(dir, ".kiro", "agents", "kiro-fabric.json"),
      JSON.stringify({ description: "filename-derived" }),
    );
    expect(planKiroProfileInstall({ projectRoot: dir, mcpEntryPath: mcpEntry }).action)
      .toBe("blocked");
  });

  it("refuses a directory at the profile target", () => {
    const dir = project("dirtarget");
    mkdirSync(kiroProfilePath(dir), { recursive: true });
    expect(() =>
      planKiroProfileInstall({ projectRoot: dir, mcpEntryPath: mcpEntry }),
    ).toThrow(/not a regular file/);
  });

  it("refuses a symlink at .kiro/.kiro-fabric", () => {
    const dir = project("meta-link");
    const outside = project("outside-meta");
    writeFileSync(join(outside, "sentinel"), "safe");
    mkdirSync(join(dir, ".kiro"), { recursive: true });
    symlinkSync(outside, join(dir, ".kiro", ".kiro-fabric"));
    expect(() =>
      planKiroProfileInstall({ projectRoot: dir, mcpEntryPath: mcpEntry }),
    ).toThrow(/symlink/);
    expect(readFileSync(join(outside, "sentinel"), "utf8")).toBe("safe");
  });
});

describe("installKiroProfile", () => {
  it("rejects incompatible managed subagent accounting before any write", async () => {
    const dir = project("accounting-preflight");
    const fabricConfig = structuredClone(DEFAULT_FABRIC_CONFIG);
    fabricConfig.agents.maxTokensPerChild = 10;
    await expect(installWithFake(dir, {
      allowShell: true,
      enableSubagents: true,
      fabricConfig,
    })).rejects.toThrow(/agents.maxTokensPerChild/);
    expect(existsSync(join(dir, ".kiro"))).toBe(false);
  });

  it("creates profile, manifest, and hashes with restrictive modes", async () => {
    const dir = project("install");
    const result = await installWithFake(dir);
    expect(result.ok).toBe(true);
    expect(result.action).toBe("create");
    expect(result.backupPath).toBeNull();
    const stat = lstatSync(result.profilePath);
    expect(stat.mode & 0o777).toBe(0o600);
    expect(readFileSync(result.profilePath, "utf8").endsWith("\n")).toBe(true);
    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
    expect(manifest.owner).toBe("kiro-fabric");
    expect(manifest.profile.installedSha256).toBe(result.profileSha256);
    expect(manifest.projectRoot).toBe(realpathSync(dir));
    expect(manifest.runtime.mcpEntryPath).toBe(mcpEntry);
    expect(manifest.runtime.kiroBinaryPath).toBe(realpathSync(wrapperPath));
    expect(manifest.runtime.kiroCliVersion).toBe("2.20.1");
    expect(manifest.runtime.kiroSha256).toBe(sha256Bytes(readFileSync(wrapperPath)));
    expect(manifest.runtime.agentEngine).toBe("v3");
    const profile = JSON.parse(readFileSync(result.profilePath, "utf8"));
    expect(profile.mcpServers.fabric.env).toMatchObject({
      KIRO_FABRIC_KIRO_BINARY: realpathSync(wrapperPath),
      KIRO_FABRIC_KIRO_VERSION: "2.20.1",
      KIRO_FABRIC_KIRO_SHA256: manifest.runtime.kiroSha256,
    });
  });



  it("reads format 1 and upgrades to attested format 3 only on successful install", async () => {
    const dir = project("manifest-upgrade");
    const legacy = await installWithFake(dir);
    expect(JSON.parse(readFileSync(legacy.manifestPath, "utf8")).format).toBe(1);
    const dry = await installWithFake(dir, { skipRuntimeClosure: false, dryRun: true });
    expect(dry.action).toBe("update");
    expect(dry.operations[0]).toMatchObject({ kind: "runtime", action: "publish" });
    expect(dry.operations.filter((operation) => operation.kind === "skill")).toHaveLength(6);
    expect(dry.operations.at(-1)?.kind).toBe("manifest");
    expect(JSON.parse(readFileSync(legacy.manifestPath, "utf8")).format).toBe(1);
    await installWithFake(dir, { skipRuntimeClosure: false });
    expect(JSON.parse(readFileSync(legacy.manifestPath, "utf8")).format).toBe(3);
  });

  it("installs and attests the complete managed skill bundle with the closure", async () => {
    const dir = project("managed-skills");
    const result = await installWithFake(dir, { skipRuntimeClosure: false });
    const profile = JSON.parse(readFileSync(result.profilePath, "utf8")) as {
      resources: string[];
      mcpServers: { fabric: { env: Record<string, string> } };
    };
    expect(profile.resources).toEqual([
      "skill://.kiro/skills/fabric-exec/SKILL.md",
      "skill://.kiro/skills/fabric-guide/SKILL.md",
      "skill://.kiro/skills/fabric-review/SKILL.md",
      "skill://.kiro/skills/fabric-workflow/SKILL.md",
    ]);
    expect(profile.mcpServers.fabric.env.KIRO_FABRIC_SKILL_BUNDLE_SHA256).toMatch(/^[a-f0-9]{64}$/);

    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8")) as {
      format: number;
      skills: { bundleSha256: string; files: Array<{ path: string; installedSha256: string }> };
      runtime: { closure: { files: Array<{ path: string; installedSha256: string }> } };
    };
    expect(manifest.format).toBe(3);
    expect(manifest.skills.files).toHaveLength(6);
    expect(manifest.runtime.closure.files.length).toBeGreaterThan(1);
    for (const file of manifest.skills.files) {
      const bytes = readFileSync(join(dir, ...file.path.split("/")));
      expect(sha256Bytes(bytes)).toBe(file.installedSha256);
    }
    expect(manifest.skills.bundleSha256).toBe(
      profile.mcpServers.fabric.env.KIRO_FABRIC_SKILL_BUNDLE_SHA256,
    );
  });

  it("blocks a foreign same-name skill before publishing the runtime closure", async () => {
    const dir = project("skill-collision");
    const target = join(dir, ".kiro", "skills", "fabric-review", "SKILL.md");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "foreign review skill\n");
    await expect(
      installWithFake(dir, { skipRuntimeClosure: false }),
    ).rejects.toThrow(/unmanaged skill exists/);
    expect(readFileSync(target, "utf8")).toBe("foreign review skill\n");
    expect(existsSync(join(dir, ".kiro", ".kiro-fabric", "runtime"))).toBe(false);
  });

  it("is an idempotent no-op on the second run", async () => {
    const dir = project("twice");
    const first = await installWithFake(dir);
    const before = readFileSync(first.profilePath, "utf8");
    const second = await installWithFake(dir);
    expect(second.action).toBe("noop");
    expect(readFileSync(first.profilePath, "utf8")).toBe(before);
  });

  it("backs up and replaces unknown content with --force", async () => {
    const dir = project("forced");
    mkdirSync(dirname(kiroProfilePath(dir)), { recursive: true });
    const original = JSON.stringify({ name: "custom", old: true }, null, 2);
    writeFileSync(kiroProfilePath(dir), original);
    const result = await installWithFake(dir, { force: true });
    expect(result.backupPath).not.toBeNull();
    expect(readFileSync(result.backupPath!, "utf8")).toBe(original);
    const installed = JSON.parse(readFileSync(result.profilePath, "utf8"));
    expect(installed.name).toBe("kiro-fabric");
    expect(installed).not.toHaveProperty("old");
  });

  it("dry-run leaves the project tree byte-for-byte unchanged", async () => {
    const dir = project("dry");
    writeFileSync(join(dir, "existing.txt"), "keep");
    const snapshot = (root: string): string[] => {
      const entries: string[] = [];
      const walk = (current: string): void => {
        for (const entry of existsSync(current) ? readdirSync(current) : []) {
          const path = join(current, entry);
          const stat = lstatSync(path);
          entries.push(
            `${path.slice(root.length)}:${stat.isDirectory() ? "d" : "f"}:${
              stat.isFile() ? readFileSync(path, "utf8") : ""
            }`,
          );
          if (stat.isDirectory()) walk(path);
        }
      };
      walk(root);
      return entries.sort();
    };
    const beforeTree = snapshot(dir);
    const result = await installWithFake(dir, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.action).toBe("create");
    expect(existsSync(join(dir, ".kiro"))).toBe(false);
    expect(snapshot(dir)).toEqual(beforeTree);
  });

  it("cannot enable a runtime bypass through public options or spoofed environment", async () => {
    const dir = project("production-bypass");
    const previousVitest = process.env.VITEST;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.VITEST = "true";
    process.env.NODE_ENV = "test";
    try {
      const result = await installKiroProfileProduction({
        projectRoot: dir,
        kiroBinary: wrapperPath,
        runtimeNodeSourcePath: wrapperPath,
        skipRuntimeClosure: true,
      } as Parameters<typeof installKiroProfileProduction>[0] & Record<string, unknown>);
      expect(result.runtimeClosure).toBeDefined();
      expect(JSON.parse(readFileSync(result.manifestPath, "utf8")).format).toBe(3);
    } finally {
      if (previousVitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = previousVitest;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("rejects a Kiro inode that replaces itself during attestation", async () => {
    const dir = project("kiro-self-replace");
    const changing = join(base, "changing-kiro");
    writeFileSync(changing, [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then",
      "  printf 'kiro-cli 2.20.1\\n'",
      "  rm \"$0\"",
      "  printf '#!/bin/sh\\nexit 99\\n' > \"$0\"",
      "  chmod 755 \"$0\"",
      "  exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n"), { mode: 0o755 });
    await expect(installWithFake(dir, { kiroBinary: changing }))
      .rejects.toThrow(/changed|probe failed|attestation|wrong product|permission denied/i);
    expect(existsSync(join(dir, ".kiro"))).toBe(false);
  });

  it("rejects an unsupported Kiro version before writing anything", async () => {
    await expect(installWithFake(project("okversion"))).resolves.toBeDefined();
    const badWrapper = join(base, "fake-kiro-old");
    writeFileSync(
      badWrapper,
      `#!/bin/sh\necho "kiro-cli 2.18.0"\nexit 0\n`,
      { mode: 0o755 },
    );
    await expect(
      installWithFake(project("badversion2"), {
        kiroBinary: badWrapper,
        skipRuntimeClosure: false,
      }),
    ).rejects.toThrow(/unsupported kiro-cli version/);
    expect(existsSync(join(base, "badversion2", ".kiro"))).toBe(false);
  });

  it.each([
    ["wrong product", "other-cli 2.20.1", /wrong product/i],
    ["ambiguous", "kiro-cli 2.20.1 node 24.0.0", /ambiguous/i],
    ["prerelease", "kiro-cli 2.20.1-beta.1", /prerelease/i],
    ["uncertified newer", "kiro-cli 2.21.0", /uncertified newer/i],
  ])("rejects %s version identity before mutation", async (name, output, error) => {
    const dir = project(`strict-${name.replace(/\s+/g, "-")}`);
    const binary = join(base, `fake-kiro-${name.replace(/\s+/g, "-")}`);
    writeFileSync(binary, `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(output)}\n`, {
      mode: 0o755,
    });
    await expect(installWithFake(dir, {
      kiroBinary: binary,
      skipRuntimeClosure: false,
    })).rejects.toThrow(error);
    expect(existsSync(join(dir, ".kiro"))).toBe(false);
  });

  it("fails on validator error diagnostics even when exit code is 0", async () => {
    const dir = project("invalid");
    // The fake validator exits 0 with an error diagnostic for a name-less
    // profile; our generated profile always has a name, so simulate by a
    // wrapper that always emits an error diagnostic.
    const badValidator = join(base, "fake-kiro-invalid");
    writeFileSync(
      badValidator,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "kiro-cli 2.20.1"; exit 0; fi\nif [ "$1" = "acp" ] && [ "$2" = "--help" ]; then echo "--agent-engine v3 --auth-method cli"; exit 0; fi\necho "error: agent config invalid" >&2\nexit 0\n`,
      { mode: 0o755 },
    );
    await expect(
      installWithFake(dir, {
        kiroBinary: badValidator,
        skipRuntimeClosure: false,
      }),
    ).rejects.toThrow(/validate reported an error/);
    expect(existsSync(join(dir, ".kiro"))).toBe(false);
  });

  it("performs a safe managed update without --force", async () => {
    const dir = project("update");
    const first = await installWithFake(dir);
    // Simulate a managed update by installing with a different node path.
    const otherNode = join(base, "node-alt");
    writeFileSync(otherNode, `#!/bin/sh\necho v${process.versions.node}\n`, { mode: 0o755 });
    const updated = await installWithFake(dir, { nodePath: otherNode });
    expect(["update", "noop"]).toContain(updated.action);
    const profile = JSON.parse(readFileSync(first.profilePath, "utf8"));
    expect(profile.mcpServers.fabric.command).toBe(otherNode);
  });

  it("refuses a user-modified managed profile without --force", async () => {
    const dir = project("drift");
    const first = await installWithFake(dir);
    const drifted = JSON.parse(readFileSync(first.profilePath, "utf8"));
    drifted.prompt = "user edit";
    writeFileSync(first.profilePath, JSON.stringify(drifted, null, 2));
    await expect(installWithFake(dir)).rejects.toThrow(/--force/);
  });

  it("inherits the displaced-user backup across a managed update", async () => {
    const dir = project("lineage");
    mkdirSync(dirname(kiroProfilePath(dir)), { recursive: true });
    const original = JSON.stringify({ name: "custom", keep: true });
    writeFileSync(kiroProfilePath(dir), original);
    const first = await installWithFake(dir, { force: true });
    expect(first.backupPath).not.toBeNull();
    expect(readFileSync(first.backupPath!, "utf8")).toBe(original);
    const otherNode = join(base, "node-lineage");
    writeFileSync(otherNode, `#!/bin/sh\necho v${process.versions.node}\n`, { mode: 0o755 });
    const updated = await installWithFake(dir, { nodePath: otherNode });
    expect(updated.action).toBe("update");
    expect(updated.backupPath).toBe(first.backupPath);
    const manifest = JSON.parse(readFileSync(updated.manifestPath, "utf8"));
    expect(manifest.profile.backup.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(first.backupPath!, "utf8")).toBe(original);
  });

  it("recovers an interrupted activation marker before accepting its generation", async () => {
    const dir = project("activation-transaction-recovery");
    const installed = await installWithFake(dir, { skipRuntimeClosure: false });
    const paths = managedPaths(realpathSync(dir));
    const manifestBytes = readFileSync(installed.manifestPath);
    const profileBytes = readFileSync(installed.profilePath);
    const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
      runtime: { closure: { digest: string } };
    };
    const marker = join(paths.runtimeDir, ".closure-current");
    const stale = "0".repeat(64) + "\n";
    writeAtomic(marker, stale, 0o600);
    const rel = (path: string): string => relative(realpathSync(dir), path).split(sep).join("/");
    writeManagedTransactionJournal(realpathSync(dir), "project", {
      format: 2,
      owner: "kiro-fabric",
      operation: "install",
      layout: "project",
      root: realpathSync(dir),
      createdAt: Date.now(),
      files: [
        {
          path: rel(marker),
          transition: managedFileTransition(sha256Bytes(stale), manifest.runtime.closure.digest + "\n"),
        },
        {
          path: rel(installed.profilePath),
          transition: managedFileTransition(sha256Bytes(profileBytes), profileBytes),
        },
        {
          path: rel(installed.manifestPath),
          transition: managedFileTransition(sha256Bytes(manifestBytes), manifestBytes),
        },
      ],
    });

    await expect(installWithFake(dir, { skipRuntimeClosure: false })).resolves.toMatchObject({ ok: true });
    expect(readFileSync(marker, "utf8")).toBe(manifest.runtime.closure.digest + "\n");
    expect(existsSync(paths.transaction)).toBe(false);
  });

  it("recovers an interrupted profile-before-manifest transaction", async () => {
    const dir = project("transaction-recovery");
    const installed = await installWithFake(dir);
    const previousManifest = readFileSync(installed.manifestPath);
    const otherNode = join(base, "node-transaction");
    writeFileSync(otherNode, `#!/bin/sh\necho v${process.versions.node}\n`, { mode: 0o755 });
    const next = planKiroProfileInstall({
      projectRoot: dir,
      mcpEntryPath: mcpEntry,
      nodePath: otherNode,
    }, { kiroIdentity: await assertSupportedKiro(wrapperPath) });
    const paths = managedPaths(next.installRoot, next.layout);
    const transaction: KiroManagedTransaction = {
      format: 1,
      owner: "kiro-fabric",
      operation: "install",
      layout: next.layout,
      root: next.installRoot,
      createdAt: Date.now(),
      profile: managedFileTransition(next.existingSha256, next.profileJson),
      manifest: managedFileTransition(sha256Bytes(previousManifest), next.manifestJson),
    };
    writeManagedTransactionJournal(next.installRoot, next.layout, transaction);
    // Emulate SIGKILL after the first leaf replacement: the operation lock is
    // left behind with a dead owner, exactly as a killed process would leave it.
    writeFileSync(paths.lock, JSON.stringify({
      token: "crashed-operation",
      pid: 999_999_999,
      hostname: hostname(),
    }), { mode: 0o600 });
    writeAtomic(next.profilePath, next.profileJson, 0o600);
    expect(existsSync(paths.transaction)).toBe(true);
    expect(JSON.parse(readFileSync(installed.manifestPath, "utf8")).runtime.nodePath)
      .not.toBe(otherNode);

    const recovered = await installWithFake(dir, { nodePath: otherNode });
    expect(["noop", "update"]).toContain(recovered.action);
    expect(existsSync(paths.transaction)).toBe(false);
    expect(JSON.parse(readFileSync(installed.manifestPath, "utf8")).runtime.nodePath)
      .toBe(otherNode);
    expect(JSON.parse(readFileSync(installed.profilePath, "utf8")).mcpServers.fabric.command)
      .toBe(otherNode);
  });

  it("deterministically recovers SIGKILL after format-3 marker activation", async () => {
    const dir = project("format3-activation-recovery");
    const first = await installWithFake(dir, {
      skipRuntimeClosure: false,
      runtimeNodeSourcePath: process.execPath,
    });
    const altRuntime = join(base, "activation-alt-node");
    copyFileSync(process.execPath, altRuntime);
    appendFileSync(altRuntime, "\n");
    chmodSync(altRuntime, 0o755);
    // The extra byte distinguishes the trusted runtime artifact. Certification
    // still uses the bootstrap process Node in this test process.
    const identity = await assertSupportedKiro(wrapperPath);
    const closure = planRuntimeClosureDeployment(dir, "project", {
      nodeSourcePath: altRuntime,
      kiroAttestation: identity,
    });
    deployRuntimeClosure(dir, "project", {
      nodeSourcePath: altRuntime,
      kiroAttestation: identity,
      expectedDigest: closure.digest,
      activate: false,
    });
    const next = planKiroProfileInstall({
      projectRoot: dir,
      nodePath: closure.runtimeNodePath,
      mcpEntryPath: closure.mcpEntryPath,
      kiroBinary: identity.executablePath,
    }, { closure, kiroIdentity: identity });
    const paths = managedPaths(dir, "project");
    const marker = join(paths.runtimeDir, ".closure-current");
    const markerBefore = readFileSync(marker);
    const manifestBefore = readFileSync(first.manifestPath);
    const transaction: KiroManagedTransaction = {
      format: 2,
      owner: "kiro-fabric",
      operation: "install",
      layout: "project",
      root: dir,
      createdAt: Date.now(),
      files: [
        {
          path: ".kiro/.kiro-fabric/runtime/.closure-current",
          transition: managedFileTransition(sha256Bytes(markerBefore), closure.digest + "\n"),
        },
        {
          path: ".kiro/agents/kiro-fabric.json",
          transition: managedFileTransition(first.profileSha256, next.profileJson),
        },
        ...next.skills.map((skill) => ({
          path: skill.installedRelative,
          transition: managedFileTransition(skill.existingSha256, skill.bytes),
        })),
        {
          path: ".kiro/.kiro-fabric/install.json",
          transition: managedFileTransition(sha256Bytes(manifestBefore), next.manifestJson),
        },
      ],
    };
    writeManagedTransactionJournal(dir, "project", transaction);
    writeAtomic(marker, closure.digest + "\n", 0o600);
    writeFileSync(paths.lock, JSON.stringify({
      token: "sigkill-after-activation",
      pid: 999_999_999,
      hostname: hostname(),
    }), { mode: 0o600 });

    const recovered = await installWithFake(dir, {
      skipRuntimeClosure: false,
      runtimeNodeSourcePath: altRuntime,
    });
    expect(recovered.runtimeClosure?.digest).toBe(closure.digest);
    expect(readFileSync(marker, "utf8").trim()).toBe(closure.digest);
    expect(JSON.parse(readFileSync(first.manifestPath, "utf8")).runtime.closure.digest).toBe(closure.digest);
    expect(JSON.parse(readFileSync(first.profilePath, "utf8")).mcpServers.fabric.command).toBe(closure.runtimeNodePath);
    expect(existsSync(paths.transaction)).toBe(false);
    identity.dispose();
  }, 120_000);

  it("refuses when an operation lock already exists", async () => {
    const dir = project("locked");
    await installWithFake(dir);
    const lock = join(dir, ".kiro", ".kiro-fabric", "operation.lock");
    writeFileSync(lock, "held\n", { mode: 0o600 });
    await expect(installWithFake(dir, { force: true })).rejects.toThrow(/in progress/);
  });

  it("never reclaims an operation lock when liveness fails with EPERM", async () => {
    const dir = project("locked-eperm");
    await installWithFake(dir);
    const lock = join(dir, ".kiro", ".kiro-fabric", "operation.lock");
    const body = JSON.stringify({ token: "foreign", pid: 424_242, hostname: hostname() });
    writeFileSync(lock, body, { mode: 0o600 });
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("not permitted"), { code: "EPERM" });
    });
    try {
      await expect(installWithFake(dir, { force: true })).rejects.toThrow(/in progress/);
      expect(readFileSync(lock, "utf8")).toBe(body);
    } finally {
      kill.mockRestore();
    }
  });

  it("reclaims a stale lock whose pid was reused by a newer process", async () => {
    const dir = project("locked-pid-reuse");
    await installWithFake(dir);
    const lock = join(dir, ".kiro", ".kiro-fabric", "operation.lock");
    writeFileSync(lock, JSON.stringify({
      token: "crashed-owner",
      pid: process.pid,
      hostname: hostname(),
      processStart: "older-process-instance",
    }), { mode: 0o600 });

    await expect(installWithFake(dir)).resolves.toMatchObject({ action: "noop" });
    expect(existsSync(lock)).toBe(false);
  });
});

describe("management CLI", () => {
  const cliEntry = join(repoRoot, "dist", "kiro", "cli-entry.js");

  it("rejects unknown commands with usage exit 2", async () => {
    await expect(
      execFileAsync(process.execPath, [cliEntry, "frobnicate", "kiro"]),
    ).rejects.toMatchObject({ code: 2 });
  });

  it("prints JSON dry-run output on stdout and writes nothing", async () => {
    const dir = project("cli-dry");
    const { stdout } = await execFileAsync(process.execPath, [
      cliEntry,
      "install",
      "kiro",
      "--project-root",
      dir,
      "--kiro-binary",
      wrapperPath,
      "--dry-run",
      "--json",
    ]);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.action).toBe("create");
    expect(existsSync(join(dir, ".kiro"))).toBe(false);
  });

  it("installs then reports noop", async () => {
    const dir = project("cli-install");
    const first = await execFileAsync(process.execPath, [
      cliEntry, "install", "kiro", "--project-root", dir,
      "--kiro-binary", wrapperPath, "--json",
    ]);
    expect(JSON.parse(first.stdout).action).toBe("create");
    const second = await execFileAsync(process.execPath, [
      cliEntry, "install", "kiro", "--project-root", dir,
      "--kiro-binary", wrapperPath, "--json",
    ]);
    expect(JSON.parse(second.stdout).action).toBe("noop");
  });

  it("installs --allow-shell and --subagents as explicit managed settings", async () => {
    const dir = project("cli-allow-shell");
    const installed = await execFileAsync(process.execPath, [
      cliEntry,
      "install",
      "kiro",
      "--project-root",
      dir,
      "--kiro-binary",
      wrapperPath,
      "--allow-shell",
      "--subagents",
      "--json",
    ]);
    expect(JSON.parse(installed.stdout).action).toBe("create");
    const profile = JSON.parse(readFileSync(kiroProfilePath(dir), "utf8")) as {
      mcpServers: { fabric: { env: Record<string, string> } };
    };
    expect(profile.mcpServers.fabric.env.KIRO_FABRIC_ALLOW_SHELL).toBe("1");
    expect(profile.mcpServers.fabric.env.KIRO_FABRIC_ENABLE_SUBAGENTS).toBe("1");
  });

  it("rejects --subagents without trusted shell access", async () => {
    const dir = project("cli-subagents-without-shell");
    await expect(execFileAsync(process.execPath, [
      cliEntry,
      "install",
      "kiro",
      "--project-root",
      dir,
      "--subagents",
      "--json",
    ])).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining("--subagents requires --allow-shell"),
    });
  });

  it("emits a structured collision error without --force", async () => {
    const dir = project("cli-collision");
    mkdirSync(dirname(kiroProfilePath(dir)), { recursive: true });
    writeFileSync(kiroProfilePath(dir), JSON.stringify({ name: "mine" }));
    await expect(
      execFileAsync(process.execPath, [
        cliEntry, "install", "kiro", "--project-root", dir,
        "--kiro-binary", wrapperPath, "--json",
      ]),
    ).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('"code": "collision"'),
    });
  });
});

describe("user-home Kiro install", () => {
  it("writes the agent profile into Kiro home, not the project", async () => {
    const dir = project("user-scope-project");
    const home = project("user-scope-home");
    const result = await installWithFake(dir, {
      scope: "user",
      kiroHome: home,
      skipRuntimeClosure: false,
    });
    expect(result.ok).toBe(true);
    expect(result.projectRoot).toBe(realpathSync(dir));
    expect(result.profilePath).toBe(join(realpathSync(home), "agents", "kiro-fabric.json"));
    expect(existsSync(join(dir, ".kiro"))).toBe(false);
    const profile = JSON.parse(readFileSync(result.profilePath, "utf8")) as {
      resources: string[];
      mcpServers: { fabric: { env: { KIRO_FABRIC_PROJECT_ROOT: string } } };
    };
    expect(profile.mcpServers.fabric.env.KIRO_FABRIC_PROJECT_ROOT).toBe(realpathSync(dir));
    expect(profile.resources).toEqual([
      "skill:///skills/fabric-exec/SKILL.md",
      "skill:///skills/fabric-guide/SKILL.md",
      "skill:///skills/fabric-review/SKILL.md",
      "skill:///skills/fabric-workflow/SKILL.md",
    ]);
    expect(existsSync(join(home, "skills", "fabric-workflow", "SKILL.md"))).toBe(true);
    const manifest = JSON.parse(
      readFileSync(join(home, ".kiro-fabric", "install.json"), "utf8"),
    ) as { scope?: string; projectRoot: string; profile: { path: string } };
    expect(manifest.scope).toBe("user");
    expect(manifest.projectRoot).toBe(realpathSync(dir));
    expect(manifest.profile.path).toBe("agents/kiro-fabric.json");
  });

  it("uninstalls the user-home profile without creating a project .kiro tree", async () => {
    const dir = project("user-scope-uninstall-project");
    const home = project("user-scope-uninstall-home");
    await installWithFake(dir, { scope: "user", kiroHome: home });
    const result = uninstallKiroProfile({
      scope: "user",
      projectRoot: dir,
      kiroHome: home,
    });
    expect(result.action).toBe("remove");
    expect(existsSync(join(home, "agents", "kiro-fabric.json"))).toBe(false);
    expect(existsSync(join(home, ".kiro-fabric", "install.json"))).toBe(false);
    expect(existsSync(join(dir, ".kiro"))).toBe(false);
  });

  it("rejects --kiro-home without --user", async () => {
    const code = await runKiroCli([
      "install",
      "kiro",
      "--kiro-home",
      project("orphan-home"),
      "--json",
    ]);
    expect(code).toBe(2);
  });
});
