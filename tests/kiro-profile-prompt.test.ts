import { describe, expect, it } from "vitest";

import { generateKiroProfile } from "../src/kiro/profile.js";

describe("Kiro profile prompt contract", () => {
  it("keeps the minimum prompt guidance and fail-closed one-tool profile shape", () => {
    const profile = generateKiroProfile({
      projectRoot: process.cwd(),
      mcpEntryPath: "/dist/kiro/mcp-entry.js",
      nodePath: "/usr/bin/node",
    });

    expect(profile.description).toBe("Managed Kiro Fabric profile for Kiro CLI v3");
    expect(profile.prompt.trim().length).toBeGreaterThan(0);
    expect(profile.prompt).toContain("k.read");
    expect(profile.prompt).toContain("k.ls");
    expect(profile.prompt).toContain("{ ok, output, details }");
    expect(profile.prompt).toMatch(/prefer k\.\*/i);
    expect(profile.prompt).toMatch(/do not probe/i);
    expect(profile.prompt).toMatch(/all k\.\* API calls return promises/i);
    expect(profile.prompt).toMatch(/always write "await"/i);
    expect(profile.prompt).toMatch(/un-awaited \(thenable\)/i);
    expect(profile.prompt).toMatch(/k\.bash is disabled in this profile/i);
    expect(profile.prompt).not.toMatch(/before .*k\.bash/i);
    expect(profile.prompt).toMatch(/batch only independent/i);
    expect(profile.prompt).toMatch(/narrow ranges|offset\/limit/i);
    expect(profile.prompt).toMatch(/stop gathering/i);
    expect(profile.prompt).toMatch(/fail closed/i);
    expect(profile.prompt).toMatch(/subagents are disabled in managed Kiro/i);
    expect(profile.prompt).toContain("memory.get");
    expect(profile.prompt).toContain("mcp.call");
    expect(profile.prompt).toMatch(/network approval gate/i);
    expect(profile.prompt).not.toContain("agents.run");
    expect(profile.prompt).not.toContain("agents.spawn");

    expect(profile.tools).toEqual(["@fabric/fabric_exec"]);
    expect(profile.includeMcpJson).toBe(false);
    expect(profile.includePowers).toBe(false);
    expect(profile.permissions).toEqual({ rules: [] });
    expect(profile).not.toHaveProperty("allowedTools");
  });

  it("does not advertise recursive agent spawning to isolated ACP children", () => {
    const profile = generateKiroProfile({
      projectRoot: process.cwd(),
      mcpEntryPath: "/dist/kiro/mcp-entry.js",
      nodePath: "/usr/bin/node",
      internalChild: { cwd: "/proj", serializedTools: '["read"]' },
    });

    expect(profile.prompt).not.toContain("agents.run");
    expect(profile.prompt).not.toContain("agents.spawn");
    expect(profile.prompt).toMatch(/all k\.\* API calls return promises/i);
    expect(profile.prompt).not.toMatch(/all agents\.\* API calls/i);
    expect(profile.prompt).toMatch(/persistent memory is unavailable inside ACP children/i);
    expect(profile.prompt).toMatch(/MCP federation is unavailable inside ACP children/i);
    expect(profile.prompt).not.toContain("memory.set");
    expect(profile.prompt).not.toContain("mcp.call");
  });

  it("embeds the trusted-local shell flag only when explicitly enabled", () => {
    const defaultProfile = generateKiroProfile({
      projectRoot: process.cwd(),
      mcpEntryPath: "/dist/kiro/mcp-entry.js",
      nodePath: "/usr/bin/node",
    });
    const defaultEnv = (defaultProfile.mcpServers.fabric as {
      env: Record<string, string>;
    }).env;
    expect(defaultEnv).not.toHaveProperty("KIRO_FABRIC_ALLOW_SHELL");

    const trustedProfile = generateKiroProfile({
      projectRoot: process.cwd(),
      mcpEntryPath: "/dist/kiro/mcp-entry.js",
      nodePath: "/usr/bin/node",
      allowShell: true,
    });
    const trustedEnv = (trustedProfile.mcpServers.fabric as {
      env: Record<string, string>;
    }).env;
    expect(trustedEnv.KIRO_FABRIC_ALLOW_SHELL).toBe("1");
    expect(trustedEnv.KIRO_FABRIC_ENFORCE_PROJECT_ROOT).toBe("1");
    expect(trustedProfile.prompt).not.toMatch(/k\.bash is disabled/i);
    expect(trustedProfile.prompt).toMatch(/before .*k\.bash/i);
    expect(trustedProfile.tools).toEqual(["@fabric/fabric_exec"]);
  });

  it("enables bounded subagents only together with trusted shell access", () => {
    expect(() => generateKiroProfile({
      projectRoot: process.cwd(),
      mcpEntryPath: "/dist/kiro/mcp-entry.js",
      enableSubagents: true,
    })).toThrow(/require.*allowShell/i);

    const profile = generateKiroProfile({
      projectRoot: process.cwd(),
      mcpEntryPath: "/dist/kiro/mcp-entry.js",
      allowShell: true,
      enableSubagents: true,
    });
    const env = (profile.mcpServers.fabric as {
      env: Record<string, string>;
    }).env;
    expect(env).toMatchObject({
      KIRO_FABRIC_ALLOW_SHELL: "1",
      KIRO_FABRIC_ENABLE_SUBAGENTS: "1",
      KIRO_FABRIC_ENFORCE_PROJECT_ROOT: "1",
    });
    expect(profile.prompt).toContain("agents.run");
    expect(profile.prompt).toContain("agents.spawn");
    expect(profile.prompt).toMatch(/at most four/i);
    expect(profile.prompt).toContain("qwen3-coder-next");
    expect(profile.prompt).toContain("claude-opus-4.5");
    expect(profile.prompt).toMatch(
      /complex analysis or ambiguous tasks use claude-opus-4\.5 at medium effort/i,
    );
    expect(profile.prompt).toMatch(/inventory-aware.*falls back to Kiro auto/i);
    expect(profile.prompt).toMatch(/focused tests\/builds/i);
  });

  it("adds one exact v3 MCP permission only when tool auto-approval is enabled", () => {
    const defaultProfile = generateKiroProfile({
      projectRoot: process.cwd(),
      mcpEntryPath: "/dist/kiro/mcp-entry.js",
      nodePath: "/usr/bin/node",
    });
    expect(defaultProfile).not.toHaveProperty("allowedTools");
    expect(defaultProfile.permissions).toEqual({ rules: [] });

    const trustedProfile = generateKiroProfile({
      projectRoot: process.cwd(),
      mcpEntryPath: "/dist/kiro/mcp-entry.js",
      nodePath: "/usr/bin/node",
      allowTools: true,
    });
    expect(trustedProfile).not.toHaveProperty("allowedTools");
    expect(trustedProfile.permissions).toEqual({
      rules: [{ capability: "mcp", match: ["fabric/fabric_exec"], effect: "allow" }],
    });
    expect(trustedProfile.tools).toEqual(["@fabric/fabric_exec"]);
    expect((trustedProfile.mcpServers.fabric as { env: Record<string, string> }).env)
      .toMatchObject({
        KIRO_FABRIC_ALLOW_TOOLS: "1",
        KIRO_FABRIC_ENFORCE_PROJECT_ROOT: "1",
      });
  });
});
