import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  installUserAgent,
  resolveKiroHome,
  uninstallUserAgent,
} from "../scripts/install-agent-user.mjs";
import {
  validateAgentPackage,
  validateInstalledAgentProfile,
} from "../scripts/validate-agent-package.mjs";

const roots: string[] = [];
const temporary = (): string => {
  const lexical = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-agent-install-"));
  const root = fs.realpathSync(lexical);
  fs.chmodSync(root, 0o700);
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const stage = (): string => path.resolve(".tmp/kiro-fabric-agent");
const packageVariant = (root: string, version: string): string => {
  const target = path.join(root, `package-${version}`);
  fs.cpSync(fs.realpathSync(stage()), target, { recursive: true, preserveTimestamps: true });
  const normalizeModes = (directory: string): void => {
    fs.chmodSync(directory, 0o700);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) normalizeModes(child);
      else fs.chmodSync(child, 0o600);
    }
  };
  normalizeModes(target);
  const manifestPath = path.join(target, "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.version = version;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return target;
};
const treeDigest = (root: string): string => {
  const digest = createHash("sha256");
  if (!fs.existsSync(root)) return digest.digest("hex");
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(directory, entry.name);
      const stats = fs.lstatSync(target);
      digest.update(path.relative(root, target)).update("\0").update(String(stats.mode & 0o777)).update("\0");
      if (entry.isDirectory()) visit(target);
      else if (entry.isSymbolicLink()) digest.update(fs.readlinkSync(target));
      else digest.update(fs.readFileSync(target));
    }
  };
  visit(root);
  return digest.digest("hex");
};

const convertToLegacyManifest = (installed: { root: string; profile: string; runtime: string; packageDigest: string }): void => {
  const skill = path.join(installed.root, "skills", "fabric-exec", "SKILL.md");
  const legacy = {
    schemaVersion: 1,
    owner: "kiro-fabric-agent-user-install",
    packageDigest: installed.packageDigest,
    profileSha256: createHash("sha256").update(fs.readFileSync(installed.profile)).digest("hex"),
    skillSha256: createHash("sha256").update(fs.readFileSync(skill)).digest("hex"),
    runtime: installed.runtime,
  };
  fs.writeFileSync(
    path.join(installed.root, "install-owner.json"),
    `${JSON.stringify(legacy, null, 2)}\n`,
    { mode: 0o600 },
  );
};

const fixture = (): { root: string; home: string; workspace: string; kiroHome: string } => {
  const root = temporary();
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(home, { mode: 0o700 });
  fs.mkdirSync(workspace, { mode: 0o700 });
  return { root, home, workspace, kiroHome: path.join(home, ".kiro") };
};

describe("user-global Agent installation", () => {
  it("defaults to HOME/.kiro and installs a fully bound absolute global profile", () => {
    const { home, workspace, kiroHome } = fixture();
    const result = installUserAgent(stage(), {}, home, { workspaceRoot: workspace });
    expect(result.profile).toBe(path.join(kiroHome, "agents", "kiro-fabric.json"));
    expect(result.root).toBe(path.join(kiroHome, "kiro-fabric"));
    expect(validateAgentPackage(stage()).digest).toBe(result.packageDigest);
    const profile = JSON.parse(fs.readFileSync(result.profile, "utf8"));
    expect(profile.name).toBe("kiro-fabric");
    expect(profile.model).toBeUndefined();
    expect(profile.includePowers).toBe(false);
    expect(profile.includeMcpJson).toBe(false);
    expect(profile.tools).toEqual(["read", "write", "shell", "web", "subagent", "todo_list", "@fabric"]);
    expect(Object.keys(profile.mcpServers)).toEqual(["fabric"]);
    expect(profile.mcpServers.fabric.requestTimeout).toBe(917_000);
    expect(profile.mcpServers.fabric.env.PLUGIN_ROOT).toBeUndefined();
    expect(profile.mcpServers.fabric.env.PLUGIN_DATA).toBeUndefined();
    expect(profile.mcpServers.fabric.env.KIRO_FABRIC_DATA_ROOT).toBe(result.data);
    expect(profile.resources).toEqual([`skill://${path.join(result.root, "skills/fabric-exec/SKILL.md")}`]);
    expect(path.isAbsolute(profile.mcpServers.fabric.command)).toBe(true);
    expect(profile.mcpServers.fabric.command).toBe(fs.realpathSync(process.execPath));
    expect(path.isAbsolute(profile.mcpServers.fabric.args[0])).toBe(true);
    expect(fs.existsSync(profile.mcpServers.fabric.command)).toBe(true);
    expect(fs.existsSync(profile.mcpServers.fabric.args[0])).toBe(true);
    expect(fs.existsSync(path.join(result.data, "fabric"))).toBe(true);
    for (const value of [
      profile.mcpServers.fabric.args[0],
      profile.mcpServers.fabric.env.KIRO_FABRIC_RUNTIME_ROOT,
      profile.mcpServers.fabric.env.KIRO_FABRIC_DATA_ROOT,
      profile.resources[0].slice("skill://".length),
    ]) {
      expect(value.startsWith(result.root), value).toBe(true);
      expect(value.includes(path.resolve(".")), value).toBe(false);
    }
    expect(validateInstalledAgentProfile(result.profile, {
      nodePath: profile.mcpServers.fabric.command,
      runtimeRoot: result.runtime,
      dataRoot: result.data,
      skillPath: path.join(result.root, "skills/fabric-exec/SKILL.md"),
      installRoot: result.root,
    }).ok).toBe(true);
  });

  it("accepts an explicit safe absolute KIRO_HOME and updates idempotently", () => {
    const { root, home, workspace } = fixture();
    const kiroHome = path.join(root, "Kiro Home");
    const env = { KIRO_HOME: kiroHome };
    const first = installUserAgent(stage(), env, home, { workspaceRoot: workspace });
    const firstManifest = fs.readFileSync(path.join(first.root, "install-owner.json"));
    const second = installUserAgent(stage(), env, home, { workspaceRoot: workspace });
    expect(second).toEqual(first);
    expect(fs.readFileSync(path.join(first.root, "install-owner.json"))).toEqual(firstManifest);
    expect(fs.readdirSync(path.join(first.root, "runtime"))).toEqual([first.packageDigest]);
  });

  it("rolls back a new digest generation and then completes an owned update", () => {
    const { root, home, workspace, kiroHome } = fixture();
    const env = { KIRO_HOME: kiroHome };
    const first = installUserAgent(stage(), env, home, { workspaceRoot: workspace });
    const variant = packageVariant(root, "0.64.1-test");
    const nextDigest = validateAgentPackage(variant).digest;
    expect(nextDigest).not.toBe(first.packageDigest);
    const before = treeDigest(kiroHome);
    expect(() => installUserAgent(variant, env, home, {
      workspaceRoot: workspace,
      onCommitStep: (step: string) => {
        if (step === "runtime") throw new Error("injected generation failure");
      },
    })).toThrow("injected generation failure");
    expect(treeDigest(kiroHome)).toBe(before);
    expect(fs.existsSync(path.join(first.root, "runtime", nextDigest))).toBe(false);

    const updated = installUserAgent(variant, env, home, { workspaceRoot: workspace });
    expect(updated.packageDigest).toBe(nextDigest);
    expect(updated.runtime).not.toBe(first.runtime);
    expect(fs.existsSync(first.runtime)).toBe(true);
    const owner = JSON.parse(fs.readFileSync(path.join(first.root, "install-owner.json"), "utf8"));
    expect(owner.runtimeGenerations.map((entry: { name: string }) => entry.name).sort()).toEqual([first.packageDigest, nextDigest].sort());
    uninstallUserAgent(env, home, { workspaceRoot: workspace });
    expect(fs.existsSync(first.runtime)).toBe(false);
    expect(fs.existsSync(updated.runtime)).toBe(false);
  });

  it("rejects empty, relative, broad, workspace-contained, symlinked, and unsafe homes before mutation", () => {
    const { root, home, workspace } = fixture();
    const sentinel = path.join(root, "sentinel");
    fs.writeFileSync(sentinel, "unchanged", { mode: 0o600 });
    const before = treeDigest(root);
    for (const value of ["", ".kiro", "/", home, workspace, path.join(workspace, ".kiro")]) {
      expect(() => installUserAgent(stage(), { KIRO_HOME: value }, home, { workspaceRoot: workspace }), value).toThrow(/KIRO_HOME|overlap|broad|absolute/u);
      expect(treeDigest(root), value).toBe(before);
    }

    const actual = path.join(root, "actual-kiro");
    const link = path.join(root, "linked-kiro");
    fs.mkdirSync(actual, { mode: 0o700 });
    fs.symlinkSync(actual, link);
    const linkedBefore = treeDigest(root);
    expect(() => installUserAgent(stage(), { KIRO_HOME: link }, home, { workspaceRoot: workspace })).toThrow("symlinked KIRO_HOME");
    expect(treeDigest(root)).toBe(linkedBefore);

    const intermediateTarget = path.join(root, "intermediate-target");
    const intermediateLink = path.join(root, "intermediate-link");
    fs.mkdirSync(intermediateTarget, { mode: 0o700 });
    fs.symlinkSync(intermediateTarget, intermediateLink);
    const intermediateBefore = treeDigest(root);
    expect(() => installUserAgent(stage(), { KIRO_HOME: path.join(intermediateLink, ".kiro") }, home, { workspaceRoot: workspace })).toThrow("symlinked KIRO_HOME component");
    expect(treeDigest(root)).toBe(intermediateBefore);

    const unsafe = path.join(root, "unsafe-kiro");
    fs.mkdirSync(unsafe, { mode: 0o777 });
    fs.chmodSync(unsafe, 0o777);
    const unsafeBefore = treeDigest(root);
    expect(() => installUserAgent(stage(), { KIRO_HOME: unsafe }, home, { workspaceRoot: workspace })).toThrow("unsafe directory permissions");
    expect(treeDigest(root)).toBe(unsafeBefore);
  });

  it("rejects an unsafe existing data/fabric directory before making any installation mutation", () => {
    const { root, home, workspace, kiroHome } = fixture();
    const data = path.join(kiroHome, "kiro-fabric", "data");
    const external = path.join(root, "external-data");
    fs.mkdirSync(data, { recursive: true, mode: 0o700 });
    fs.chmodSync(kiroHome, 0o700);
    fs.chmodSync(path.join(kiroHome, "kiro-fabric"), 0o700);
    fs.chmodSync(data, 0o700);
    fs.mkdirSync(external, { mode: 0o700 });
    fs.symlinkSync(external, path.join(data, "fabric"));
    const linkedBefore = treeDigest(root);
    expect(() => installUserAgent(stage(), { KIRO_HOME: kiroHome }, home, { workspaceRoot: workspace })).toThrow("unsafe directory");
    expect(treeDigest(root)).toBe(linkedBefore);

    fs.unlinkSync(path.join(data, "fabric"));
    fs.mkdirSync(path.join(data, "fabric"), { mode: 0o777 });
    fs.chmodSync(path.join(data, "fabric"), 0o777);
    const permissiveBefore = treeDigest(root);
    expect(() => installUserAgent(stage(), { KIRO_HOME: kiroHome }, home, { workspaceRoot: workspace })).toThrow("unsafe directory permissions");
    expect(treeDigest(root)).toBe(permissiveBefore);
  });

  it("canonicalizes benign system path aliases without accepting a symlink as KIRO_HOME", () => {
    const { root, home, workspace } = fixture();
    const aliasedRoot = root.startsWith("/private/var/") || root.startsWith("/private/tmp/")
      ? root.slice("/private".length)
      : root;
    const lexical = path.join(aliasedRoot, "alias-home", ".kiro");
    const canonical = resolveKiroHome({ KIRO_HOME: lexical }, home, { workspaceRoot: workspace });
    expect(path.isAbsolute(canonical)).toBe(true);
    expect(canonical).toBe(path.join(root, "alias-home", ".kiro"));
  });

  it("preserves settings/default-agent state and creates no workspace-local state", () => {
    const { home, workspace, kiroHome } = fixture();
    fs.mkdirSync(kiroHome, { mode: 0o700 });
    const settings = path.join(kiroHome, "settings.json");
    const settingsBytes = Buffer.from('{"chat":{"disableInheritingDefaultResources":false},"agent":"other"}\n');
    fs.writeFileSync(settings, settingsBytes, { mode: 0o600 });
    const workspaceBefore = treeDigest(workspace);
    installUserAgent(stage(), { KIRO_HOME: kiroHome }, home, { workspaceRoot: workspace });
    expect(fs.readFileSync(settings)).toEqual(settingsBytes);
    expect(treeDigest(workspace)).toBe(workspaceBefore);
    for (const relative of [".kiro", ".fabric", "runtime", "data", "memory", "state", "logs"]) {
      expect(fs.existsSync(path.join(workspace, relative)), relative).toBe(false);
    }
  });

  it("refuses unowned targets, modified secondary skill files, runtime additions, and foreign locks", () => {
    const { home, workspace, kiroHome } = fixture();
    fs.mkdirSync(path.join(kiroHome, "agents"), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(kiroHome, "agents", "kiro-fabric.json"), "{}", { mode: 0o600 });
    expect(() => installUserAgent(stage(), { KIRO_HOME: kiroHome }, home, { workspaceRoot: workspace })).toThrow("unowned profile");
    fs.rmSync(kiroHome, { recursive: true });

    const installed = installUserAgent(stage(), { KIRO_HOME: kiroHome }, home, { workspaceRoot: workspace });
    const api = path.join(installed.root, "skills/fabric-exec/references/api.md");
    fs.appendFileSync(api, "\ntampered");
    expect(() => installUserAgent(stage(), { KIRO_HOME: kiroHome }, home, { workspaceRoot: workspace })).toThrow("modified or unowned owned skill tree");
    fs.writeFileSync(api, fs.readFileSync(path.join(stage(), "skills/fabric-exec/references/api.md")));
    fs.chmodSync(api, 0o600);

    const injected = path.join(installed.runtime, "unowned");
    fs.writeFileSync(injected, "do not delete", { mode: 0o600 });
    expect(() => installUserAgent(stage(), { KIRO_HOME: kiroHome }, home, { workspaceRoot: workspace })).toThrow("modified or unowned owned runtime generation");
    expect(fs.readFileSync(injected, "utf8")).toBe("do not delete");
    fs.unlinkSync(injected);

    const lock = path.join(installed.root, ".install.lock");
    fs.mkdirSync(lock, { mode: 0o700 });
    fs.writeFileSync(path.join(lock, "foreign"), "keep", { mode: 0o600 });
    expect(() => installUserAgent(stage(), { KIRO_HOME: kiroHome }, home, { workspaceRoot: workspace })).toThrow("another Kiro Fabric install");
    expect(fs.readFileSync(path.join(lock, "foreign"), "utf8")).toBe("keep");
  });

  it("rejects every unmanifested digest-named runtime generation before update or uninstall", () => {
    const { home, workspace, kiroHome } = fixture();
    const env = { KIRO_HOME: kiroHome };
    const installed = installUserAgent(stage(), env, home, { workspaceRoot: workspace });
    const unownedName = installed.packageDigest === "b".repeat(64) ? "c".repeat(64) : "b".repeat(64);
    const unownedGeneration = path.join(installed.root, "runtime", unownedName);
    fs.mkdirSync(unownedGeneration, { mode: 0o700 });
    fs.writeFileSync(path.join(unownedGeneration, "preserve"), "unowned", { mode: 0o600 });
    const before = treeDigest(kiroHome);

    expect(() => installUserAgent(stage(), env, home, { workspaceRoot: workspace })).toThrow("unowned runtime generation");
    expect(treeDigest(kiroHome)).toBe(before);
    expect(fs.readFileSync(path.join(unownedGeneration, "preserve"), "utf8")).toBe("unowned");

    expect(() => uninstallUserAgent(env, home, { workspaceRoot: workspace })).toThrow("unowned runtime generation");
    expect(treeDigest(kiroHome)).toBe(before);
    expect(fs.existsSync(installed.profile)).toBe(true);
    expect(fs.readFileSync(path.join(unownedGeneration, "preserve"), "utf8")).toBe("unowned");
  });

  it("bounds tampered install manifests before parsing or mutating the installation", () => {
    const first = fixture();
    const firstEnv = { KIRO_HOME: first.kiroHome };
    const installed = installUserAgent(stage(), firstEnv, first.home, { workspaceRoot: first.workspace });
    const manifestPath = path.join(installed.root, "install-owner.json");
    const oversized = Buffer.alloc(16 * 1024 * 1024 + 1, 0x20);
    fs.writeFileSync(manifestPath, oversized, { mode: 0o600 });
    const profileBefore = fs.readFileSync(installed.profile);
    expect(() => installUserAgent(stage(), firstEnv, first.home, { workspaceRoot: first.workspace })).toThrow("manifest exceeds its byte bound");
    expect(fs.statSync(manifestPath).size).toBe(oversized.length);
    expect(createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex"))
      .toBe(createHash("sha256").update(oversized).digest("hex"));
    expect(fs.readFileSync(installed.profile)).toEqual(profileBefore);

    const second = fixture();
    const secondEnv = { KIRO_HOME: second.kiroHome };
    const bounded = installUserAgent(stage(), secondEnv, second.home, { workspaceRoot: second.workspace });
    const boundedManifestPath = path.join(bounded.root, "install-owner.json");
    const boundedManifest = JSON.parse(fs.readFileSync(boundedManifestPath, "utf8"));
    boundedManifest.runtimeGenerations = Array.from({ length: 257 }, () => boundedManifest.runtimeGenerations[0]);
    const tamperedBytes = Buffer.from(`${JSON.stringify(boundedManifest)}\n`);
    fs.writeFileSync(boundedManifestPath, tamperedBytes, { mode: 0o600 });
    const boundedProfileBefore = fs.readFileSync(bounded.profile);
    expect(() => uninstallUserAgent(secondEnv, second.home, { workspaceRoot: second.workspace })).toThrow("invalid Kiro Fabric install manifest");
    expect(fs.readFileSync(boundedManifestPath)).toEqual(tamperedBytes);
    expect(fs.readFileSync(bounded.profile)).toEqual(boundedProfileBefore);

    const third = fixture();
    const thirdEnv = { KIRO_HOME: third.kiroHome };
    const crowded = installUserAgent(stage(), thirdEnv, third.home, { workspaceRoot: third.workspace });
    const runtimeRoot = path.join(crowded.root, "runtime");
    for (let index = 0; index < 2_048; index += 1) {
      fs.writeFileSync(path.join(runtimeRoot, `.unowned-${String(index).padStart(4, "0")}`), "preserve", { mode: 0o600 });
    }
    const crowdedManifestBefore = fs.readFileSync(path.join(crowded.root, "install-owner.json"));
    const crowdedProfileBefore = fs.readFileSync(crowded.profile);
    expect(() => installUserAgent(stage(), thirdEnv, third.home, { workspaceRoot: third.workspace })).toThrow("runtime directory exceeds its entry bound");
    expect(fs.readFileSync(path.join(crowded.root, "install-owner.json"))).toEqual(crowdedManifestBefore);
    expect(fs.readFileSync(crowded.profile)).toEqual(crowdedProfileBefore);
    expect(fs.readFileSync(path.join(runtimeRoot, ".unowned-2047"), "utf8")).toBe("preserve");
  });

  it("rolls an interrupted update back byte-for-byte before its irreversible boundary", () => {
    const { home, workspace, kiroHome } = fixture();
    installUserAgent(stage(), { KIRO_HOME: kiroHome }, home, { workspaceRoot: workspace });
    const before = treeDigest(kiroHome);
    expect(() => installUserAgent(stage(), { KIRO_HOME: kiroHome }, home, {
      workspaceRoot: workspace,
      onCommitStep: (step: string) => {
        if (step === "skill") throw new Error("injected update failure");
      },
    })).toThrow("injected update failure");
    expect(treeDigest(kiroHome)).toBe(before);

    const profile = path.join(kiroHome, "agents", "kiro-fabric.json");
    const manifest = path.join(kiroHome, "kiro-fabric", "install-owner.json");
    const profileBytes = fs.readFileSync(profile);
    const manifestBytes = fs.readFileSync(manifest);
    expect(() => installUserAgent(stage(), { KIRO_HOME: kiroHome }, home, {
      workspaceRoot: workspace,
      onCleanupStep: () => { throw new Error("injected post-commit cleanup failure"); },
    })).toThrow("installation committed");
    expect(fs.readFileSync(profile)).toEqual(profileBytes);
    expect(fs.readFileSync(manifest)).toEqual(manifestBytes);
    expect(fs.readdirSync(path.join(kiroHome, "kiro-fabric")).some((name) => name.startsWith(".installing-"))).toBe(true);
  });

  it("keeps recovery backups and invalidates the manifest if payload rollback itself fails", () => {
    const { home, workspace, kiroHome } = fixture();
    const installed = installUserAgent(stage(), { KIRO_HOME: kiroHome }, home, { workspaceRoot: workspace });
    const manifestPath = path.join(installed.root, "install-owner.json");
    const manifestBytes = fs.readFileSync(manifestPath);
    const skillsRoot = path.join(installed.root, "skills");
    try {
      expect(() => installUserAgent(stage(), { KIRO_HOME: kiroHome }, home, {
        workspaceRoot: workspace,
        onCommitStep: (step: string) => {
          if (step === "manifest") {
            fs.chmodSync(skillsRoot, 0o500);
            throw new Error("injected failure before rollback");
          }
        },
      })).toThrow("rollback both failed");
    } finally {
      fs.chmodSync(skillsRoot, 0o700);
    }
    expect(fs.existsSync(manifestPath)).toBe(false);
    const transactionName = fs.readdirSync(installed.root).find((name) => name.startsWith(".installing-"));
    expect(transactionName).toBeDefined();
    const transaction = path.join(installed.root, transactionName!);
    expect(fs.readFileSync(path.join(transaction, "previous-manifest.json"))).toEqual(manifestBytes);
    expect(fs.existsSync(path.join(transaction, "previous-skill", "SKILL.md"))).toBe(true);
  });

  it("fails closed when a recorded install or uninstall backup disappears during rollback", () => {
    const first = fixture();
    const firstEnv = { KIRO_HOME: first.kiroHome };
    const installed = installUserAgent(stage(), firstEnv, first.home, { workspaceRoot: first.workspace });
    const installManifest = fs.readFileSync(path.join(installed.root, "install-owner.json"));
    expect(() => installUserAgent(stage(), firstEnv, first.home, {
      workspaceRoot: first.workspace,
      onCommitStep: (step: string) => {
        if (step !== "manifest") return;
        const transaction = fs.readdirSync(installed.root).find((name) => name.startsWith(".installing-"));
        if (!transaction) throw new Error("missing test transaction");
        fs.rmSync(path.join(installed.root, transaction, "previous-skill"), { recursive: true });
        throw new Error("injected missing install backup");
      },
    })).toThrow("rollback both failed");
    expect(fs.existsSync(path.join(installed.root, "install-owner.json"))).toBe(false);
    const installRecovery = fs.readdirSync(installed.root).find((name) => name.startsWith(".installing-"));
    expect(installRecovery).toBeDefined();
    expect(fs.readFileSync(path.join(installed.root, installRecovery!, "previous-manifest.json"))).toEqual(installManifest);

    const second = fixture();
    const secondEnv = { KIRO_HOME: second.kiroHome };
    const removable = installUserAgent(stage(), secondEnv, second.home, { workspaceRoot: second.workspace });
    const uninstallManifest = fs.readFileSync(path.join(removable.root, "install-owner.json"));
    expect(() => uninstallUserAgent(secondEnv, second.home, {
      workspaceRoot: second.workspace,
      onCommitStep: (step: string) => {
        if (step !== "quarantined") return;
        const transaction = fs.readdirSync(removable.root).find((name) => name.startsWith(".uninstalling-"));
        if (!transaction) throw new Error("missing test transaction");
        fs.rmSync(path.join(removable.root, transaction, "skill"), { recursive: true });
        throw new Error("injected missing uninstall backup");
      },
    })).toThrow("rollback both failed");
    expect(fs.existsSync(path.join(removable.root, "install-owner.json"))).toBe(false);
    const uninstallRecovery = fs.readdirSync(removable.root).find((name) => name.startsWith(".uninstalling-"));
    expect(uninstallRecovery).toBeDefined();
    const recoveryRoot = path.join(removable.root, uninstallRecovery!);
    expect(fs.readFileSync(path.join(recoveryRoot, "recovery-manifest.json"))).toEqual(uninstallManifest);
    expect(fs.existsSync(path.join(recoveryRoot, "profile"))).toBe(true);
    expect(fs.existsSync(path.join(recoveryRoot, "manifest"))).toBe(true);
  });

  it("preserves every unauthenticated schema-1 tree byte instead of adopting it during update", () => {
    const { home, workspace, kiroHome } = fixture();
    const env = { KIRO_HOME: kiroHome };
    const installed = installUserAgent(stage(), env, home, { workspaceRoot: workspace });
    convertToLegacyManifest(installed);
    const legacyApi = path.join(installed.root, "skills/fabric-exec/references/api.md");
    fs.appendFileSync(legacyApi, "\nlegacy-user-change\n");
    fs.mkdirSync(path.join(installed.root, "skills/fabric-exec/empty-user-directory"), { mode: 0o700 });
    fs.writeFileSync(path.join(installed.runtime, "user-runtime-file"), "preserve me", { mode: 0o600 });
    fs.mkdirSync(path.join(installed.runtime, "empty-user-directory"), { mode: 0o700 });

    const updated = installUserAgent(stage(), env, home, { workspaceRoot: workspace });
    expect(updated.preservedLegacy).toBeDefined();
    expect(fs.readFileSync(path.join(updated.preservedLegacy!.skill, "references/api.md"), "utf8")).toContain("legacy-user-change");
    expect(fs.existsSync(path.join(updated.preservedLegacy!.skill, "empty-user-directory"))).toBe(true);
    expect(fs.readFileSync(path.join(updated.preservedLegacy!.runtime, "user-runtime-file"), "utf8")).toBe("preserve me");
    expect(fs.existsSync(path.join(updated.preservedLegacy!.runtime, "empty-user-directory"))).toBe(true);
    expect(fs.existsSync(path.join(updated.runtime, "user-runtime-file"))).toBe(false);
    const owner = JSON.parse(fs.readFileSync(path.join(updated.root, "install-owner.json"), "utf8"));
    expect(owner.schemaVersion).toBe(2);
    expect(owner.runtimeGenerations).toHaveLength(1);
    expect(JSON.stringify(owner)).not.toContain(path.basename(updated.preservedLegacy!.root!));
  });

  it("preserves unauthenticated schema-1 runtime and skill trees on direct uninstall", () => {
    const { home, workspace, kiroHome } = fixture();
    const env = { KIRO_HOME: kiroHome };
    const installed = installUserAgent(stage(), env, home, { workspaceRoot: workspace });
    convertToLegacyManifest(installed);
    fs.appendFileSync(path.join(installed.root, "skills/fabric-exec/references/api.md"), "\nuninstall-user-change\n");
    fs.writeFileSync(path.join(installed.runtime, "unowned-runtime-file"), "keep", { mode: 0o600 });
    const removed = uninstallUserAgent(env, home, { workspaceRoot: workspace });
    expect(removed.preservedLegacy).toBeDefined();
    expect(fs.existsSync(installed.profile)).toBe(false);
    expect(fs.existsSync(path.join(installed.root, "install-owner.json"))).toBe(false);
    expect(fs.readFileSync(path.join(removed.preservedLegacy!.skill, "references/api.md"), "utf8")).toContain("uninstall-user-change");
    expect(fs.readFileSync(path.join(removed.preservedLegacy!.runtime, "unowned-runtime-file"), "utf8")).toBe("keep");
  });

  it("uninstalls transactionally, preserves durable data by default, and purges only explicitly", () => {
    const { home, workspace, kiroHome } = fixture();
    const env = { KIRO_HOME: kiroHome };
    const installed = installUserAgent(stage(), env, home, { workspaceRoot: workspace });
    const durable = path.join(installed.data, "fabric", "durable.json");
    fs.writeFileSync(durable, '{"kept":true}\n', { mode: 0o600 });
    const unrelated = path.join(kiroHome, "agents", "other.json");
    fs.writeFileSync(unrelated, "{}\n", { mode: 0o600 });

    const beforeFailedUninstall = treeDigest(kiroHome);
    expect(() => uninstallUserAgent(env, home, {
      workspaceRoot: workspace,
      onCommitStep: (step: string) => {
        if (step === "quarantined") throw new Error("injected uninstall failure");
      },
    })).toThrow("injected uninstall failure");
    expect(treeDigest(kiroHome)).toBe(beforeFailedUninstall);

    const removed = uninstallUserAgent(env, home, { workspaceRoot: workspace });
    expect(removed.dataPreserved).toBe(true);
    expect(fs.readFileSync(durable, "utf8")).toContain('"kept":true');
    expect(fs.readFileSync(unrelated, "utf8")).toBe("{}\n");
    expect(fs.existsSync(installed.profile)).toBe(false);
    expect(fs.existsSync(installed.runtime)).toBe(false);
    expect(fs.existsSync(path.join(installed.root, "install-owner.json"))).toBe(false);

    const reinstalled = installUserAgent(stage(), env, home, { workspaceRoot: workspace });
    expect(fs.readFileSync(durable, "utf8")).toContain('"kept":true');
    const purged = uninstallUserAgent(env, home, { workspaceRoot: workspace, purgeData: true });
    expect(purged.dataPreserved).toBe(false);
    expect(fs.existsSync(reinstalled.data)).toBe(false);
    expect(fs.existsSync(reinstalled.root)).toBe(false);
    expect(fs.readFileSync(unrelated, "utf8")).toBe("{}\n");

    const installerSource = fs.readFileSync(path.resolve("scripts/install-agent-user.mjs"), "utf8");
    const uninstallStart = installerSource.indexOf("export const uninstallUserAgent");
    const ownedContainerCleanup = installerSource.indexOf("for (const directory of [installPaths.skills, installPaths.runtime])", uninstallStart);
    const lockRelease = installerSource.indexOf("releaseLock(lock)", uninstallStart);
    expect(ownedContainerCleanup).toBeGreaterThan(uninstallStart);
    expect(ownedContainerCleanup).toBeLessThan(lockRelease);
  });

  it("migrates only from an explicit absolute private legacy data root", () => {
    const { root, home, workspace, kiroHome } = fixture();
    const legacy = path.join(root, "legacy", "fabric");
    fs.mkdirSync(path.join(legacy, "projects"), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(legacy, "projects", "sentinel"), "legacy", { mode: 0o600 });
    expect(() => installUserAgent(stage(), { KIRO_HOME: kiroHome }, home, {
      workspaceRoot: workspace,
      migratePowerData: "relative",
    })).toThrow("absolute path");
    expect(fs.existsSync(kiroHome)).toBe(false);

    const workspaceLegacy = path.join(workspace, "fabric");
    fs.mkdirSync(path.join(workspaceLegacy, "projects"), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(workspaceLegacy, "projects", "do-not-copy"), "workspace", { mode: 0o600 });
    const linkedLegacy = path.join(root, "linked-legacy-root");
    fs.symlinkSync(workspace, linkedLegacy);
    const beforeLinkedAttempt = treeDigest(root);
    expect(() => installUserAgent(stage(), { KIRO_HOME: kiroHome }, home, {
      workspaceRoot: workspace,
      migratePowerData: linkedLegacy,
    })).toThrow("symlink component");
    expect(treeDigest(root)).toBe(beforeLinkedAttempt);
    expect(fs.existsSync(kiroHome)).toBe(false);

    const installed = installUserAgent(stage(), { KIRO_HOME: kiroHome }, home, {
      workspaceRoot: workspace,
      migratePowerData: path.dirname(legacy),
    });
    expect(fs.readFileSync(path.join(installed.data, "fabric", "projects", "sentinel"), "utf8")).toBe("legacy");
    expect(fs.readFileSync(path.join(legacy, "projects", "sentinel"), "utf8")).toBe("legacy");
  });
});
