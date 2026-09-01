// Real installed-runtime acceptance. The installer runs from a disposable
// package origin in a fresh process; that exact origin is then retired before
// two independent MCP processes execute the profile-recorded installed entry.

import { execFile } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
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

const buildNativeFakeKiro = async (directory: string): Promise<string> => {
  const source = join(directory, "main.go");
  const binary = join(directory, "kiro-cli-fixture");
  writeFileSync(source, `package main
import (
  "bufio"
  "encoding/json"
  "fmt"
  "os"
  "strings"
)
func send(id any, result any) { json.NewEncoder(os.Stdout).Encode(map[string]any{"jsonrpc":"2.0", "id":id, "result":result}) }
func main() {
  args := os.Args[1:]
  if len(args)>0 && args[0]=="--version" { fmt.Println("kiro-cli 2.20.1"); return }
  if len(args)>1 && args[0]=="acp" && args[1]=="--help" { fmt.Println("--agent-engine v3 --auth-method cli"); return }
  if len(args)>1 && args[0]=="agent" && args[1]=="validate" {
    path:=""; for i,a:=range args { if a=="--path" && i+1<len(args) { path=args[i+1] } }
    bytes,err:=os.ReadFile(path); if err!=nil || !strings.Contains(string(bytes),"\\\"name\\\"") { fmt.Fprintln(os.Stderr,"error: agent config missing required field: name"); return }
    fmt.Println("agent config is valid"); return
  }
  if len(args)==0 || args[0]!="acp" {
    if log:=os.Getenv("KIRO_SETUP_LAUNCH_LOG"); log!="" { f,_:=os.OpenFile(log,os.O_CREATE|os.O_APPEND|os.O_WRONLY,0600); fmt.Fprintln(f,strings.Join(args," ")); f.Close() }
    return
  }
  scanner:=bufio.NewScanner(os.Stdin); scanner.Buffer(make([]byte,1024),1024*1024)
  for scanner.Scan() {
    var msg map[string]any; if json.Unmarshal(scanner.Bytes(),&msg)!=nil { continue }
    id,ok:=msg["id"]; if !ok { continue }; method,_:=msg["method"].(string)
    switch method {
    case "initialize": send(id,map[string]any{"protocolVersion":1,"agentCapabilities":map[string]any{"loadSession":true}})
    case "session/new", "session/load": send(id,map[string]any{"sessionId":"detached-fixture-session","modes":map[string]any{"currentModeId":"vibe","availableModes":[]any{map[string]any{"id":"vibe"},map[string]any{"id":"kiro-fabric"}}}})
    default: send(id,map[string]any{})
    }
  }
}
`);
  await execFileAsync("go", ["build", "-trimpath", "-ldflags=-s -w", "-o", binary, source], {
    cwd: directory,
    env: { ...process.env, CGO_ENABLED: "0" },
    encoding: "utf8",
    timeout: 60_000,
  });
  chmodSync(binary, 0o755);
  return binary;
};

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
        "pack", "--ignore-scripts", "--json", "--pack-destination", packDir,
      ], { cwd: repoRoot, encoding: "utf8", timeout: 60_000 });
      // npm <= 11 emits a JSON array of pack entries; npm >= 12 emits an
      // object keyed by package name. Accept both shapes.
      const packReport = JSON.parse(String(packed.stdout)) as
        Array<{ filename?: unknown }> | Record<string, { filename?: unknown }>;
      const packEntry = Array.isArray(packReport)
        ? packReport[0]
        : Object.values(packReport)[0];
      const filename = packEntry?.filename;
      if (typeof filename !== "string" || !filename.endsWith(".tgz")) {
        throw new Error(`nested npm pack returned no tarball filename: ${String(packed.stdout).slice(0, 500)}`);
      }
      const tarball = join(packDir, filename);
      await execFileAsync("npm", [
        "install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", packageOrigin, tarball,
      ], { cwd: root, encoding: "utf8", timeout: 60_000 });
      const setupBin = join(packageOrigin, "node_modules", ".bin", "kiro-fabric-setup");
      expect(existsSync(setupBin)).toBe(true);

      // Production accepts a native Kiro artifact, not an unattested shebang.
      // The fixture is a static Go executable with no launcher dependencies.
      const fakeKiro = await buildNativeFakeKiro(externalFixtureDir);

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
          kiroBinaryPath: string;
          kiroSha256: string;
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
      const kiroRelative = relative(kiroHome, manifest.runtime.kiroBinaryPath).split(sep).join("/");
      expect(manifest.runtime.closure.files).toContainEqual({
        path: kiroRelative,
        installedSha256: manifest.runtime.kiroSha256,
        executableMode: 0o555,
      });
      expect(recorded.args[0]).not.toContain(packageOrigin);

      // Remove both external origins before any installed Kiro execution. The
      // remaining native fake, Node, manager, MCP bundle, and skills are all
      // inside and attested by the immutable format-3 release.
      rmSync(externalFixtureDir, { recursive: true, force: true });
      expect(existsSync(fakeKiro)).toBe(false);
      if (dirname(packageOrigin) !== root || dirname(retiredOrigin) !== root) {
        throw new Error("refusing to retire a package origin outside the acceptance root");
      }
      renameSync(packageOrigin, retiredOrigin);
      expect(existsSync(packageOrigin)).toBe(false);
      expect(existsSync(retiredOrigin)).toBe(true);

      const managerArgs = [manifest.runtime.managerEntryPath];
      const runInstalled = async (command: "status" | "doctor" | "update" | "repair") => {
        const result = await execFileAsync(manifest.runtime.nodePath, [
          ...managerArgs,
          command,
          ...lifecycleBase,
          ...(command === "update" || command === "repair" ? ["--yes"] : []),
          "--json",
        ], { cwd: projectRoot, env: hermeticEnv, encoding: "utf8", timeout: 90_000 });
        return JSON.parse(String(result.stdout)) as Record<string, any>;
      };
      // Every probe launches a new process from the command and args persisted
      // in the installed profile. The first process is fully reaped before the
      // second starts, ruling out module-cache or inherited-process success.
      await probeInstalledMcp(profile, projectRoot, hermeticEnv);
      await probeInstalledMcp(profile, projectRoot, hermeticEnv);

      // Full packed, fresh-process lifecycle acceptance after both external
      // origins are gone: installed doctor, zero-prompt launch, update, repair,
      // status, then uninstall below.
      const doctor = await runInstalled("doctor");
      expect(doctor.ok).toBe(true);

      const launchLog = join(root, "managed-launch.log");
      await execFileAsync(manifest.runtime.nodePath, [
        ...managerArgs,
        "launch",
        "--project-root",
        projectRoot,
      ], {
        cwd: projectRoot,
        env: { ...hermeticEnv, KIRO_SETUP_LAUNCH_LOG: launchLog },
        encoding: "utf8",
        timeout: 30_000,
      });
      expect(readFileSync(launchLog, "utf8").trim()).toBe("--v3 --agent kiro-fabric");

      expect((await runInstalled("update")).ok).toBe(true);
      expect((await runInstalled("repair")).ok).toBe(true);
      expect((await runInstalled("status")).scopes.user.healthy).toBe(true);

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
