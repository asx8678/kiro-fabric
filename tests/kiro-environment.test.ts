import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveKiroMcpLaunchEnvironment } from "../src/kiro/mcp-environment.js";
import { generateKiroProfile } from "../src/kiro/profile.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const dirs = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-env-"));
  roots.push(root);
  const project = path.join(root, "project");
  const child = path.join(root, "worktree");
  const ambient = path.join(root, "ambient");
  const nested = path.join(project, "packages", "app");
  fs.mkdirSync(project);
  fs.mkdirSync(child);
  fs.mkdirSync(ambient);
  fs.mkdirSync(nested, { recursive: true });
  return {
    project: fs.realpathSync(project),
    child: fs.realpathSync(child),
    ambient,
    nested: fs.realpathSync(nested),
  };
};

describe("Kiro managed environment precedence", () => {
  it("rejects every reserved KIRO_FABRIC_* extraEnv key", () => {
    const { project } = dirs();
    expect(() => generateKiroProfile({
      projectRoot: project,
      mcpEntryPath: "/tmp/mcp.js",
      extraEnv: { KIRO_FABRIC_PROJECT_ROOT: "/attacker" },
    })).toThrow(/reserved Fabric variable KIRO_FABRIC_PROJECT_ROOT/);
    expect(() => generateKiroProfile({
      projectRoot: project,
      mcpEntryPath: "/tmp/mcp.js",
      extraEnv: { kiro_fabric_allow_shell: "1" },
    })).toThrow(/reserved Fabric variable/i);
  });

  it("sets canonical values last and marks managed-main vs internal-child", () => {
    const { project, child } = dirs();
    const main = generateKiroProfile({
      projectRoot: project,
      mcpEntryPath: "/tmp/mcp.js",
      extraEnv: { SAFE_EXTRA: "ok" },
    }).mcpServers.fabric as { env: Record<string, string> };
    expect(main.env).toMatchObject({
      SAFE_EXTRA: "ok",
      KIRO_FABRIC_PROFILE_KIND: "managed-main",
      KIRO_FABRIC_PROJECT_ROOT: project,
    });
    expect(main.env).not.toHaveProperty("KIRO_FABRIC_CWD");

    const internal = generateKiroProfile({
      projectRoot: project,
      mcpEntryPath: "/tmp/mcp.js",
      internalChild: { cwd: child, serializedTools: '["read"]' },
    }).mcpServers.fabric as { env: Record<string, string> };
    expect(internal.env).toMatchObject({
      KIRO_FABRIC_PROFILE_KIND: "internal-child",
      KIRO_FABRIC_PROJECT_ROOT: project,
      KIRO_FABRIC_CWD: child,
      KIRO_FABRIC_KIRO_TOOLS: '["read"]',
    });
  });

  it("uses the kiro-cli launch cwd for managed-main and ignores child-only overrides", () => {
    const { project, child, ambient } = dirs();
    expect(resolveKiroMcpLaunchEnvironment({
      KIRO_FABRIC_PROFILE_KIND: "managed-main",
      KIRO_FABRIC_PROJECT_ROOT: project,
      KIRO_FABRIC_CWD: child,
      KIRO_FABRIC_KIRO_TOOLS: '["bash"]',
    }, ambient)).toEqual({ cwd: fs.realpathSync(ambient), kind: "managed-main" });

    expect(resolveKiroMcpLaunchEnvironment({
      KIRO_FABRIC_PROFILE_KIND: "internal-child",
      KIRO_FABRIC_PROJECT_ROOT: project,
      KIRO_FABRIC_CWD: child,
      KIRO_FABRIC_KIRO_TOOLS: '["read"]',
    }, ambient)).toEqual({
      cwd: child,
      kind: "internal-child",
      toolsEnv: '["read"]',
    });
  });

  it("confines dangerous managed-main grants to the recorded project", () => {
    const { project, ambient, nested } = dirs();
    const identity = fs.statSync(project, { bigint: true });
    const identityEnv = {
      KIRO_FABRIC_PROJECT_ROOT_DEV: String(identity.dev),
      KIRO_FABRIC_PROJECT_ROOT_INO: String(identity.ino),
    };
    for (const grant of [
      { KIRO_FABRIC_ALLOW_SHELL: "1" },
      { KIRO_FABRIC_ENABLE_SUBAGENTS: "1" },
      { KIRO_FABRIC_ALLOW_TOOLS: "1" },
      { KIRO_FABRIC_ENFORCE_PROJECT_ROOT: "1" },
    ]) {
      expect(() => resolveKiroMcpLaunchEnvironment({
        KIRO_FABRIC_PROFILE_KIND: "managed-main",
        KIRO_FABRIC_PROJECT_ROOT: project,
        ...identityEnv,
        ...grant,
      }, ambient)).toThrow(/confined.*outside that project/i);
    }

    expect(resolveKiroMcpLaunchEnvironment({
      KIRO_FABRIC_PROFILE_KIND: "managed-main",
      KIRO_FABRIC_PROJECT_ROOT: project,
      KIRO_FABRIC_ALLOW_SHELL: "1",
      ...identityEnv,
    }, nested)).toEqual({ cwd: nested, kind: "managed-main" });
  });

  it.skipIf(process.platform === "win32")(
    "rejects a trusted root that was replaced or retargeted through a symlink",
    () => {
      const { project, ambient } = dirs();
      const profile = generateKiroProfile({
        projectRoot: project,
        mcpEntryPath: "/tmp/mcp.js",
        allowShell: true,
      }).mcpServers.fabric as { env: NodeJS.ProcessEnv };
      fs.renameSync(project, `${project}.moved`);
      fs.symlinkSync(ambient, project, "dir");

      expect(() => resolveKiroMcpLaunchEnvironment(profile.env, ambient))
        .toThrow(/identity changed|symlink|reinstall/i);
    },
  );

  it("rejects a trusted root recreated at the same canonical pathname", () => {
    const { project } = dirs();
    const profile = generateKiroProfile({
      projectRoot: project,
      mcpEntryPath: "/tmp/mcp.js",
      allowTools: true,
    }).mcpServers.fabric as { env: NodeJS.ProcessEnv };
    fs.renameSync(project, `${project}.old`);
    fs.mkdirSync(project);

    expect(() => resolveKiroMcpLaunchEnvironment(profile.env, project))
      .toThrow(/identity changed.*reinstall/i);
  });

  it("fails closed when a trusted managed profile has no recorded root", () => {
    const { ambient } = dirs();
    expect(() => resolveKiroMcpLaunchEnvironment({
      KIRO_FABRIC_PROFILE_KIND: "managed-main",
      KIRO_FABRIC_ALLOW_SHELL: "1",
    }, ambient)).toThrow(/missing.*project root/i);
  });

  it("falls back to the installed project root when the launch cwd disappeared", () => {
    const { project, ambient } = dirs();
    fs.rmSync(ambient, { recursive: true });
    expect(resolveKiroMcpLaunchEnvironment({
      KIRO_FABRIC_PROFILE_KIND: "managed-main",
      KIRO_FABRIC_PROJECT_ROOT: project,
    }, ambient)).toEqual({ cwd: project, kind: "managed-main" });
  });
});
