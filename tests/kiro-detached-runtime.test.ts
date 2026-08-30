// Real installed-runtime acceptance. The installer runs from a disposable
// package origin in a fresh process; that exact origin is then retired before
// two independent MCP processes execute the profile-recorded installed entry.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { spawnJsonRpcProcess } from "../src/kiro/supervisor.js";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const fakeKiroSource = join(repoRoot, "tests", "fixtures", "kiro", "fake-kiro.mjs");
const disposablePrefix = join(resolve(tmpdir()), "kiro-fabric-detached-");
let acceptanceRoot: string | undefined;

const removeAcceptanceRoot = (): void => {
  if (!acceptanceRoot) return;
  const target = resolve(acceptanceRoot);
  // Cleanup is deliberately limited to the one mkdtemp root created by this
  // suite. Never recursively delete the copied package origin directly.
  if (!target.startsWith(disposablePrefix) || dirname(target) !== resolve(tmpdir())) {
    throw new Error(`refusing unbounded detached-test cleanup: ${target}`);
  }
  const makeRemovable = (dir: string): void => {
    if (!existsSync(dir)) return;
    const stat = lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    chmodSync(dir, 0o700);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) makeRemovable(join(dir, entry.name));
    }
  };
  makeRemovable(target);
  rmSync(target, { recursive: true, force: true });
  acceptanceRoot = undefined;
};

afterEach(removeAcceptanceRoot);

interface InstalledProfile {
  mcpServers: {
    fabric: {
      command: string;
      args: string[];
      env: Record<string, string>;
    };
  };
}

const probeInstalledMcp = async (
  profile: InstalledProfile,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> => {
  const recorded = profile.mcpServers.fabric;
  const child = spawnJsonRpcProcess({
    argv: [recorded.command, ...recorded.args],
    cwd,
    env: { ...env, ...recorded.env },
    timeoutMs: 30_000,
  });
  try {
    const initialized = await child.call<{
      serverInfo?: { name?: string };
      capabilities?: { tools?: unknown };
    }>("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "kiro-fabric-detached-acceptance", version: "1" },
    });
    expect(initialized.serverInfo?.name).toBe("kiro-fabric");
    expect(initialized.capabilities).toHaveProperty("tools");
    child.notify("notifications/initialized", {});

    const listed = await child.call<{ tools?: Array<{ name?: string }> }>("tools/list", {});
    expect(listed.tools?.map((tool) => tool.name)).toEqual(["fabric_exec"]);

    const result = await child.call<{
      content?: Array<{ type?: unknown; text?: unknown }>;
      isError?: unknown;
    }>("tools/call", {
      name: "fabric_exec",
      arguments: { code: "return ['detached', 6 * 7].join(':');" },
    });
    expect(result.isError).not.toBe(true);
    expect(result.content?.find((entry) => entry.type === "text")?.text).toBe("detached:42");
  } finally {
    const shutdown = await child.terminate();
    expect(shutdown.escalated).toBe(false);
  }
};

describe("detached installed Kiro runtime", () => {
  it.skipIf(process.platform === "win32")(
    "runs the installed closure twice after its disposable package origin is gone",
    async () => {
      acceptanceRoot = mkdtempSync(disposablePrefix);
      const root = acceptanceRoot;
      const packageOrigin = join(root, "package-origin");
      const retiredOrigin = join(root, "package-origin.retired");
      const packDir = join(root, "pack");
      const externalFixtureDir = join(root, "external-kiro-fixture");
      const projectRoot = join(root, "project");
      const isolatedHome = join(root, "home");
      const kiroHome = join(root, "kiro-home");
      const processTmp = join(root, "tmp");
      const canaryBin = join(root, "canary-bin");
      const canaryLog = join(root, "unexpected-path-command.log");
      for (const dir of [packDir, externalFixtureDir, projectRoot, isolatedHome, kiroHome, processTmp, canaryBin]) {
        mkdirSync(dir, { recursive: true });
      }

      // Pack and install exactly the publishable package, then invoke its real
      // package.json setup bin in a fresh process. No test-only installer bundle
      // is allowed to stand in for the distributed bootstrap surface.
      const packed = await execFileAsync("npm", [
        "pack", "--ignore-scripts", "--pack-destination", packDir,
      ], { cwd: repoRoot, encoding: "utf8", timeout: 60_000 });
      const tarball = join(packDir, String(packed.stdout).trim().split(/\r?\n/).at(-1)!);
      await execFileAsync("npm", [
        "install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", packageOrigin, tarball,
      ], { cwd: root, encoding: "utf8", timeout: 60_000 });
      const setupBin = join(packageOrigin, "node_modules", ".bin", "kiro-fabric-setup");
      expect(existsSync(setupBin)).toBe(true);

      // Kiro is an explicitly external executable. Keep the fake outside the
      // package origin so retiring Fabric's origin cannot accidentally remove
      // the certified test tuple.
      const copiedFakeKiro = join(externalFixtureDir, "fake-kiro.mjs");
      copyFileSync(fakeKiroSource, copiedFakeKiro);
      const fakeKiro = join(externalFixtureDir, "kiro-cli-fixture");
      writeFileSync(
        fakeKiro,
        `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(copiedFakeKiro)} "$@"\n`,
        { mode: 0o755 },
      );
      chmodSync(fakeKiro, 0o755);

      // PATH contains only failing canaries: any lookup of node, kiro-cli, npm,
      // pnpm, or a shell utility proves the detached profile was not using its
      // absolute recorded command identities.
      for (const name of ["node", "kiro-cli", "npm", "pnpm"]) {
        const canary = join(canaryBin, name);
        writeFileSync(
          canary,
          `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(name)} >> ${JSON.stringify(canaryLog)}\nexit 97\n`,
          { mode: 0o755 },
        );
        chmodSync(canary, 0o755);
      }
      const hermeticEnv: NodeJS.ProcessEnv = {
        HOME: isolatedHome,
        KIRO_HOME: kiroHome,
        PATH: canaryBin,
        NODE_PATH: "",
        TMPDIR: processTmp,
        TMP: processTmp,
        TEMP: processTmp,
        LANG: "C",
        LC_ALL: "C",
      };

      const lifecycleBase = ["--user", "--kiro-home", kiroHome, "--project-root", projectRoot];
      const installed = await execFileAsync(process.execPath, [
        setupBin,
        "install",
        ...lifecycleBase,
        "--kiro-binary",
        fakeKiro,
        "--yes",
        "--json",
      ], {
        cwd: projectRoot,
        env: hermeticEnv,
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      const installResult = JSON.parse(String(installed.stdout)) as {
        ok: boolean;
        runtimeClosure?: { action?: string; mcpEntryPath?: string };
      };
      expect(installResult.ok).toBe(true);
      expect(installResult.runtimeClosure?.action).toBe("publish");

      const profilePath = join(kiroHome, "agents", "kiro-fabric.json");
      const manifestPath = join(kiroHome, ".kiro-fabric", "install.json");
      const profile = JSON.parse(readFileSync(profilePath, "utf8")) as InstalledProfile;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        format: number;
        runtime: {
          nodePath: string;
          nodeSha256: string;
          mcpEntryPath: string;
          managerEntryPath: string;
          closure: { root: string; files: Array<{ path: string; installedSha256: string; executableMode?: number }> };
        };
      };
      const recorded = profile.mcpServers.fabric;
      expect(manifest.format).toBe(3);
      expect(recorded.command).toBe(manifest.runtime.nodePath);
      expect(recorded.args).toEqual([manifest.runtime.mcpEntryPath]);
      expect(manifest.runtime.mcpEntryPath).toBe(installResult.runtimeClosure?.mcpEntryPath);
      expect(isAbsolute(manifest.runtime.mcpEntryPath)).toBe(true);
      for (const installedPath of [
        manifest.runtime.nodePath,
        manifest.runtime.mcpEntryPath,
        manifest.runtime.managerEntryPath,
      ]) {
        expect(isAbsolute(installedPath)).toBe(true);
        expect(relative(kiroHome, installedPath)).not.toMatch(/^\.\.(?:[\\/]|$)/);
        expect(installedPath).not.toContain(packageOrigin);
      }
      const nodeRelative = relative(kiroHome, manifest.runtime.nodePath).split(sep).join("/");
      expect(manifest.runtime.closure.files).toContainEqual({
        path: nodeRelative,
        installedSha256: manifest.runtime.nodeSha256,
        executableMode: 0o555,
      });
      const entryRelative = relative(kiroHome, manifest.runtime.mcpEntryPath).split(sep).join("/");
      expect(manifest.runtime.closure.files).toContainEqual(expect.objectContaining({ path: entryRelative }));
      expect(recorded.args[0]).not.toContain(packageOrigin);

      const runBootstrap = async (command: "status" | "repair") => {
        const result = await execFileAsync(process.execPath, [
          setupBin,
          command,
          ...lifecycleBase,
          "--kiro-binary",
          fakeKiro,
          ...(command === "repair" ? ["--yes"] : []),
          "--json",
        ], { cwd: projectRoot, env: hermeticEnv, encoding: "utf8", timeout: 90_000 });
        return JSON.parse(String(result.stdout)) as Record<string, any>;
      };
      const expectDamagedThenRepair = async (mutate: () => void): Promise<void> => {
        mutate();
        const damaged = await runBootstrap("status");
        expect(damaged.scopes.user.healthy).toBe(false);
        expect(damaged.scopes.user.issue).toEqual(expect.any(String));
        const repaired = await runBootstrap("repair");
        expect(repaired.ok).toBe(true);
        expect((await runBootstrap("status")).scopes.user.healthy).toBe(true);
      };

      await expectDamagedThenRepair(() => {
        chmodSync(manifest.runtime.nodePath, 0o755);
        appendFileSync(manifest.runtime.nodePath, "tamper");
      });
      expect(createHash("sha256").update(readFileSync(manifest.runtime.nodePath)).digest("hex"))
        .toBe(manifest.runtime.nodeSha256);

      const originalManager = readFileSync(manifest.runtime.managerEntryPath);
      await expectDamagedThenRepair(() => {
        chmodSync(manifest.runtime.managerEntryPath, 0o644);
        writeFileSync(manifest.runtime.managerEntryPath, "tampered manager\n");
      });
      expect(readFileSync(manifest.runtime.managerEntryPath)).toEqual(originalManager);

      await expectDamagedThenRepair(() => chmodSync(manifest.runtime.nodePath, 0o644));
      expect(statSync(manifest.runtime.nodePath).mode & 0o777).toBe(0o555);

      await expectDamagedThenRepair(() => {
        const changed = JSON.parse(readFileSync(manifestPath, "utf8")) as { packageVersion: string };
        changed.packageVersion = "0.0.0-tampered";
        writeFileSync(manifestPath, JSON.stringify(changed, null, 2) + "\n");
      });

      // Rename, rather than recursively deleting, exactly the direct temporary
      // origin. The old absolute import/closure source path is now absent while
      // cleanup remains bounded to acceptanceRoot.
      if (dirname(packageOrigin) !== root || dirname(retiredOrigin) !== root) {
        throw new Error("refusing to retire a package origin outside the acceptance root");
      }
      renameSync(packageOrigin, retiredOrigin);
      expect(existsSync(packageOrigin)).toBe(false);
      expect(existsSync(retiredOrigin)).toBe(true);

      // Every probe launches a new process from the command and args persisted
      // in the installed profile. The first process is fully reaped before the
      // second starts, ruling out module-cache or inherited-process success.
      await probeInstalledMcp(profile, projectRoot, hermeticEnv);
      await probeInstalledMcp(profile, projectRoot, hermeticEnv);

      // Fresh manager processes also use only attested release paths. Status
      // and repair execute after origin removal; repair resolves this installed
      // release itself as the current artifact and preserves the same digest.
      const managerArgs = [manifest.runtime.managerEntryPath];
      const status = await execFileAsync(manifest.runtime.nodePath, [
        ...managerArgs,
        "status",
        ...lifecycleBase,
        "--json",
      ], { cwd: projectRoot, env: hermeticEnv, encoding: "utf8", timeout: 30_000 });
      expect(JSON.parse(String(status.stdout)).scopes.user.healthy).toBe(true);
      const repair = await execFileAsync(manifest.runtime.nodePath, [
        ...managerArgs,
        "repair",
        ...lifecycleBase,
        "--yes",
        "--json",
      ], { cwd: projectRoot, env: hermeticEnv, encoding: "utf8", timeout: 90_000 });
      expect(JSON.parse(String(repair.stdout)).ok).toBe(true);

      expect(existsSync(packageOrigin)).toBe(false);
      expect(existsSync(canaryLog) ? readFileSync(canaryLog, "utf8") : "").toBe("");

      const removed = await execFileAsync(manifest.runtime.nodePath, [
        ...managerArgs,
        "uninstall",
        ...lifecycleBase,
        "--yes",
        "--json",
      ], { cwd: projectRoot, env: hermeticEnv, encoding: "utf8", timeout: 30_000 });
      expect(JSON.parse(String(removed.stdout)).ok).toBe(true);
      expect(existsSync(manifestPath)).toBe(false);
    },
    120_000,
  );
});
