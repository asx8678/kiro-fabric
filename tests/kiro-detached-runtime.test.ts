// Real installed-runtime acceptance. The installer runs from a disposable
// package origin in a fresh process; that exact origin is then retired before
// two independent MCP processes execute the profile-recorded installed entry.

import { execFile } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
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
      const externalFixtureDir = join(root, "external-kiro-fixture");
      const projectRoot = join(root, "project");
      const isolatedHome = join(root, "home");
      const kiroHome = join(root, "kiro-home");
      const processTmp = join(root, "tmp");
      const canaryBin = join(root, "canary-bin");
      const canaryLog = join(root, "unexpected-path-command.log");
      for (const dir of [packageOrigin, externalFixtureDir, projectRoot, isolatedHome, kiroHome, processTmp, canaryBin]) {
        mkdirSync(dir, { recursive: true });
      }

      // This is the package origin the fresh installer child actually imports.
      // Bundle a test-only installer driver so setup itself has no node_modules
      // dependency, then seed it with the production closure bytes. It is
      // independent of the fixture and safe to rename as one direct child of
      // this suite's bounded temporary root.
      copyFileSync(join(repoRoot, "package.json"), join(packageOrigin, "package.json"));
      cpSync(join(repoRoot, "dist", "kiro-closure"), join(packageOrigin, "dist", "kiro-closure"), {
        recursive: true,
      });
      cpSync(join(repoRoot, "skills"), join(packageOrigin, "skills"), { recursive: true });
      const installDriver = join(packageOrigin, "dist", "kiro", "install-driver.js");
      await build({
        stdin: {
          contents: [
            'import { installKiroProfile } from "./src/kiro/install.ts";',
            "const [kiroHome, projectRoot, kiroBinary] = process.argv.slice(2);",
            "const result = await installKiroProfile({ scope: 'user', kiroHome, projectRoot, kiroBinary });",
            "process.stdout.write(JSON.stringify(result));",
          ].join("\n"),
          resolveDir: repoRoot,
          sourcefile: "detached-install-driver.ts",
          loader: "ts",
        },
        outfile: installDriver,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node24",
        sourcemap: false,
        banner: {
          js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
        },
        logLevel: "silent",
      });

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

      const installed = await execFileAsync(process.execPath, [
        installDriver,
        kiroHome,
        projectRoot,
        fakeKiro,
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
          mcpEntryPath: string;
          closure: { root: string; files: Array<{ path: string; installedSha256: string }> };
        };
      };
      const recorded = profile.mcpServers.fabric;
      expect(manifest.format).toBe(2);
      expect(recorded.command).toBe(manifest.runtime.nodePath);
      expect(recorded.args).toEqual([manifest.runtime.mcpEntryPath]);
      expect(manifest.runtime.mcpEntryPath).toBe(installResult.runtimeClosure?.mcpEntryPath);
      expect(isAbsolute(manifest.runtime.mcpEntryPath)).toBe(true);
      expect(relative(kiroHome, manifest.runtime.mcpEntryPath)).not.toMatch(/^\.\.(?:[\\/]|$)/);
      const entryRelative = relative(kiroHome, manifest.runtime.mcpEntryPath).split(sep).join("/");
      expect(manifest.runtime.closure.files).toContainEqual(expect.objectContaining({ path: entryRelative }));
      expect(recorded.args[0]).not.toContain(packageOrigin);

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

      expect(existsSync(packageOrigin)).toBe(false);
      expect(existsSync(canaryLog) ? readFileSync(canaryLog, "utf8") : "").toBe("");
    },
    120_000,
  );
});
