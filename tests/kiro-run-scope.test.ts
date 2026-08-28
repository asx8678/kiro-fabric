import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateKiroProfile } from "../src/kiro/profile.js";
import { materializeKiroRunProfile } from "../src/kiro/run-profile.js";
import {
  isValidRunnerSessionId,
  parseKiroChildTools,
  parseKiroChildToolsEnv,
  serializeKiroChildTools,
} from "../src/kiro/run-scope.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("parseKiroChildTools", () => {
  it("accepts the closed bare portable set and rejects everything else", () => {
    expect(parseKiroChildTools(["read", "write"])).toEqual(["read", "write"]);
    expect(parseKiroChildTools([])).toEqual([]);
    expect(() => parseKiroChildTools(["__proto__"])).toThrow(/invalid Kiro child tool/);
    expect(() => parseKiroChildTools(["prototype"])).toThrow(/invalid Kiro child tool/);
    expect(() => parseKiroChildTools(["constructor"])).toThrow(/invalid Kiro child tool/);
    expect(() => parseKiroChildTools(["k.read"])).toThrow(/invalid Kiro child tool/);
    expect(() => parseKiroChildTools(["read\n"])).toThrow(/invalid Kiro child tool/);
    expect(() => parseKiroChildTools(["read\u0000"])).toThrow(/invalid Kiro child tool/);
    expect(() => parseKiroChildTools([" fabric_exec "])).toThrow(/invalid Kiro child tool/);
    expect(() => parseKiroChildTools(["mesh.run"])).toThrow(/invalid Kiro child tool/);
    expect(() => parseKiroChildTools("read")).toThrow(/must be an array/);
  });

  it("round-trips through the MCP environment encoding", () => {
    const encoded = serializeKiroChildTools(["read", "ls"]);
    expect(parseKiroChildToolsEnv(encoded)).toEqual(["read", "ls"]);
    expect(parseKiroChildToolsEnv("[]")).toEqual([]);
    expect(() => parseKiroChildToolsEnv("not-json")).toThrow(/JSON array/);
  });

  it("bounds runner session identifiers", () => {
    expect(isValidRunnerSessionId("saved-session")).toBe(true);
    expect(isValidRunnerSessionId("")).toBe(false);
    expect(isValidRunnerSessionId("has space")).toBe(false);
    expect(isValidRunnerSessionId("x".repeat(257))).toBe(false);
    expect(isValidRunnerSessionId("bad\nid")).toBe(false);
  });
});

describe("materializeKiroRunProfile", () => {
  it("retains an explicitly persistent actor runtime home across cleanup", () => {
    const project = mkdtempSync(join(tmpdir(), "kiro-fabric-kiro-persistent-"));
    roots.push(project);
    const home = join(project, "actor", "kiro-runtime");
    const lease = materializeKiroRunProfile({
      projectRoot: project,
      cwd: project,
      tools: ["read"],
      home,
      mcpEntryPath: "/tmp/dummy-mcp.js",
      nodePath: process.execPath,
    });
    expect(lease.home).toBe(home);
    expect(existsSync(lease.profilePath)).toBe(true);
    lease.cleanup();
    expect(existsSync(lease.profilePath)).toBe(true);
  });

  it("writes an isolated profile without mutating the project tree", () => {
    const project = mkdtempSync(join(tmpdir(), "kiro-fabric-kiro-lease-"));
    roots.push(project);
    const poison = join(project, ".kiro", "agents");
    mkdirSync(poison, { recursive: true });
    const sentinel = join(poison, "user.json");
    writeFileSync(sentinel, "{\"name\":\"user\"}\n", { mode: 0o600 });
    const before = readFileSync(sentinel);
    const lease = materializeKiroRunProfile({
      projectRoot: project,
      cwd: project,
      tools: ["read", "bash"],
      mcpEntryPath: "/tmp/dummy-mcp.js",
      nodePath: process.execPath,
      allowShell: true,
    });
    roots.push(lease.home);
    const profile = JSON.parse(readFileSync(lease.profilePath, "utf8")) as {
      tools: string[];
      includeMcpJson: boolean;
      includePowers: boolean;
      permissions: { rules: unknown[] };
      mcpServers: { fabric: { env: Record<string, string> } };
    };
    expect(profile.tools).toEqual(["@fabric/fabric_exec"]);
    expect(profile.includeMcpJson).toBe(false);
    expect(profile.includePowers).toBe(false);
    expect(profile.permissions).toEqual({ rules: [] });
    expect(profile).not.toHaveProperty("allowedTools");
    expect(profile.mcpServers.fabric.env.KIRO_FABRIC_KIRO_TOOLS)
      .toBe(serializeKiroChildTools(["read", "bash"]));
    expect(profile.mcpServers.fabric.env.KIRO_FABRIC_PROJECT_ROOT).toBe(project);
    expect(profile.mcpServers.fabric.env.KIRO_FABRIC_ALLOW_SHELL).toBe("1");
    expect(profile.mcpServers.fabric.env).not.toHaveProperty(
      "KIRO_FABRIC_ENABLE_SUBAGENTS",
    );
    expect(readFileSync(sentinel).equals(before)).toBe(true);
    lease.cleanup();
    expect(generateKiroProfile({
      projectRoot: project,
      mcpEntryPath: "/tmp/dummy-mcp.js",
    }).mcpServers.fabric).toMatchObject({
      env: {
        KIRO_FABRIC_HOST: "kiro-v3",
        KIRO_FABRIC_PROJECT_ROOT: project,
      },
    });
  });
});
