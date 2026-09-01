// PR 5 doctor tests. Fake Kiro drives the ACP/validator probes; the MCP
// probes always run against the actual built dist/kiro/mcp-entry.js. Every
// test here is non-billable: the fake records outbound methods and the
// doctor asserts session/prompt was never sent.

import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { runKiroDoctor } from "../src/kiro/doctor-test-helper.js";
import { installKiroProfile } from "../src/kiro/install-test-helper.js";
import { KIRO_CLI_VERSION } from "../src/kiro/profile.js";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const fakeKiro = join(repoRoot, "tests", "fixtures", "kiro", "fake-kiro.mjs");
const mcpEntry = join(repoRoot, "dist", "kiro", "mcp-entry.js");

let base: string;
let wrapperPath: string;

const makeWrapper = (name: string, body: string): string => {
  const path = join(base, name);
  writeFileSync(path, body, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
};

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "kiro-fabric-doctor-test-"));
  wrapperPath = makeWrapper(
    "fake-kiro",
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeKiro)} "$@"\n`,
  );
});

const makeRemovable = (dir: string): void => {
  if (!existsSync(dir)) return;
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return;
  chmodSync(dir, 0o700);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) makeRemovable(join(dir, entry.name));
  }
};

afterEach(() => {
  makeRemovable(base);
  rmSync(base, { recursive: true, force: true });
});

const check = (report: Awaited<ReturnType<typeof runKiroDoctor>>, id: string) =>
  report.checks.find((entry) => entry.id === id);

const runDoctor = (options: Parameters<typeof runKiroDoctor>[0] = {}) =>
  runKiroDoctor({
    fabricConfig: structuredClone(DEFAULT_FABRIC_CONFIG),
    ...options,
  });

describe("runKiroDoctor", () => {

  it("attests an installed profile, skill bundle, and exact runtime closure", async () => {
    const projectRoot = join(base, "installed-project");
    mkdirSync(projectRoot, { recursive: true });
    await installKiroProfile({
      projectRoot,
      kiroBinary: wrapperPath,
      mcpEntryPath: mcpEntry,
    });
    const pristine = await runDoctor({
      kiroBinary: wrapperPath,
      mcpEntryPath: mcpEntry,
      checkInstalled: true,
      projectRoot,
      fabricConfig: structuredClone(DEFAULT_FABRIC_CONFIG),
    });
    expect(check(pristine, "install.manifest")?.status).toBe("pass");
    expect(check(pristine, "install.skills")?.status).toBe("pass");
    expect(check(pristine, "install.runtime-closure")?.status).toBe("pass");
    const installedProfile = JSON.parse(
      readFileSync(join(projectRoot, ".kiro", "agents", "kiro-fabric.json"), "utf8"),
    ) as { mcpServers: { fabric: { args: string[] } } };
    const installedMcpEntry = installedProfile.mcpServers.fabric.args[0]!;
    expect(installedMcpEntry).not.toBe(mcpEntry);
    expect(check(pristine, "mcp.initialize")?.message).toContain(installedMcpEntry);
    expect(check(pristine, "mcp.initialize")?.message).not.toContain(mcpEntry);

    writeFileSync(
      join(
        projectRoot,
        ".kiro",
        "skills",
        "fabric-exec",
        "references",
        "review.md",
      ),
      "tampered skill\n",
    );
    const tampered = await runDoctor({
      kiroBinary: wrapperPath,
      mcpEntryPath: mcpEntry,
      checkInstalled: true,
      projectRoot,
      fabricConfig: structuredClone(DEFAULT_FABRIC_CONFIG),
    });
    expect(check(tampered, "install.skills")?.status).toBe("fail");
    expect(check(tampered, "install.skills")?.message).toMatch(/hash mismatch/);
    expect(check(tampered, "install.runtime-closure")?.status).toBe("pass");

    const manifest = JSON.parse(
      readFileSync(join(projectRoot, ".kiro", ".kiro-fabric", "install.json"), "utf8"),
    ) as { runtime: { closure: { root: string } } };
    const runtimeEntry = join(
      projectRoot,
      ...manifest.runtime.closure.root.split("/"),
      "kiro",
      "mcp-entry.js",
    );
    chmodSync(runtimeEntry, 0o644);
    writeFileSync(runtimeEntry, "tampered runtime\n");
    const damagedRuntime = await runDoctor({
      kiroBinary: wrapperPath,
      mcpEntryPath: mcpEntry,
      checkInstalled: true,
      projectRoot,
      fabricConfig: structuredClone(DEFAULT_FABRIC_CONFIG),
    });
    expect(check(damagedRuntime, "install.runtime-closure")?.status).toBe("fail");
    expect(check(damagedRuntime, "mcp.initialize")).toMatchObject({
      status: "skipped",
      message: "installed_runtime_unattested",
    });
    expect(check(damagedRuntime, "acp.initialize")?.status).toBe("skipped");
  }, 30_000);

  it("passes all checks against the supported fake tuple", async () => {
    const report = await runDoctor({ kiroBinary: wrapperPath, mcpEntryPath: mcpEntry });
    expect(report.ok).toBe(true);
    expect(report.nonBillable).toBe(true);
    expect(report.modelTurnsRequested).toBe(0);
    expect(report.observed.kiro.version).toBe(KIRO_CLI_VERSION);
    expect(report.observed.agentEngine).toBe("v3");
    expect(report.observed.authMethod).toBe("cli");
    for (const entry of report.checks) {
      expect(entry.status, `${entry.id}: ${entry.message}`).toBe("pass");
    }
    expect(report.summary.failed).toBe(0);
  }, 30_000);

  it("proves the MCP adapter serves and executes exactly one tool with the golden schema", async () => {
    const report = await runDoctor({ kiroBinary: wrapperPath, mcpEntryPath: mcpEntry });
    expect(check(report, "mcp.initialize")!.status).toBe("pass");
    expect(check(report, "mcp.tools-list")!.status).toBe("pass");
    expect(check(report, "mcp.fabric-exec")!.status).toBe("pass");
    expect(check(report, "mcp.shutdown")!.status).toBe("pass");
  }, 30_000);

  it("fails closed on an unsupported Kiro version and skips dependents", async () => {
    const old = makeWrapper(
      "fake-kiro-old",
      `#!/bin/sh\necho "kiro-cli 2.18.0"\nexit 0\n`,
    );
    const report = await runDoctor({ kiroBinary: old, mcpEntryPath: mcpEntry });
    expect(report.ok).toBe(false);
    expect(check(report, "tuple")!.status).toBe("fail");
    expect(check(report, "profile.validate")!.status).toBe("skipped");
    expect(check(report, "acp.initialize")!.status).toBe("skipped");
    expect(report.observed.kiro.version).toBeNull();
  });

  it("rejects a matching version that lacks CLI-owned v3 ACP authentication", async () => {
    const incomplete = makeWrapper(
      "fake-kiro-incomplete-v3",
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "kiro-cli ${KIRO_CLI_VERSION}"; exit 0; fi\nif [ "$1" = "acp" ] && [ "$2" = "--help" ]; then echo "--agent-engine v3"; exit 0; fi\necho "agent config is valid"\nexit 0\n`,
    );
    const report = await runDoctor({ kiroBinary: incomplete, mcpEntryPath: mcpEntry });
    expect(check(report, "tuple")!.status).toBe("fail");
    expect(check(report, "tuple")!.message).toMatch(/CLI-owned authentication/i);
    expect(check(report, "profile.validate")!.status).toBe("skipped");
    expect(check(report, "acp.initialize")!.status).toBe("skipped");
  });

  it("fails when the validator's negative control reports nothing", async () => {
    // Validator that accepts everything, including the name-less control.
    const lax = makeWrapper(
      "fake-kiro-lax",
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "kiro-cli ${KIRO_CLI_VERSION}"; exit 0; fi\nif [ "$1" = "acp" ] && [ "$2" = "--help" ]; then echo "--agent-engine v3 --auth-method cli"; exit 0; fi\necho "agent config is valid"\nexit 0\n`,
    );
    const report = await runDoctor({ kiroBinary: lax, mcpEntryPath: mcpEntry });
    expect(report.ok).toBe(false);
    const control = check(report, "profile.negative-control")!;
    expect(control.status).toBe("fail");
    expect(control.message).toMatch(/not proving anything/);
  });

  it("fails when the validator reports an error diagnostic despite exit 0", async () => {
    const strict = makeWrapper(
      "fake-kiro-error",
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "kiro-cli ${KIRO_CLI_VERSION}"; exit 0; fi\nif [ "$1" = "acp" ] && [ "$2" = "--help" ]; then echo "--agent-engine v3 --auth-method cli"; exit 0; fi\necho "error: agent config invalid" >&2\nexit 0\n`,
    );
    const report = await runDoctor({ kiroBinary: strict, mcpEntryPath: mcpEntry });
    expect(check(report, "profile.validate")!.status).toBe("fail");
    expect(check(report, "acp.initialize")!.status).toBe("skipped");
    expect(report.ok).toBe(false);
  }, 30_000);

  it("fails on malformed ACP stdout", async () => {
    const malformed = makeWrapper(
      "fake-kiro-malformed",
      `#!/bin/sh\nFAKE_KIRO_SCENARIO=malformed-stdout exec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeKiro)} "$@"\n`,
    );
    const report = await runDoctor({ kiroBinary: malformed, mcpEntryPath: mcpEntry });
    expect(check(report, "acp.initialize")!.status).toBe("fail");
    expect(report.ok).toBe(false);
  }, 180_000);

  it("fails the shutdown check when SIGKILL escalation is required", async () => {
    const slow = makeWrapper(
      "fake-kiro-slow",
      `#!/bin/sh\nFAKE_KIRO_SCENARIO=slow-close exec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeKiro)} "$@"\n`,
    );
    const report = await runDoctor({ kiroBinary: slow, mcpEntryPath: mcpEntry });
    expect(check(report, "acp.shutdown")!.status).toBe("fail");
    expect(report.ok).toBe(false);
  }, 180_000);

  it("never sends session/prompt in any scenario", async () => {
    const report = await runDoctor({ kiroBinary: wrapperPath, mcpEntryPath: mcpEntry });
    expect(check(report, "acp.no-prompt")!.status).toBe("pass");
    expect(check(report, "acp.no-prompt")!.message).not.toContain("session/prompt");
    expect(check(report, "acp.resume-no-prompt")!.status).toBe("pass");
    expect(check(report, "acp.resume-no-prompt")!.message).not.toContain("session/prompt");
  }, 30_000);

  it("reloads the empty v3 session in a second process and deletes the probe", async () => {
    const report = await runDoctor({ kiroBinary: wrapperPath, mcpEntryPath: mcpEntry });
    expect(check(report, "acp.resume-initialize")!.status).toBe("pass");
    expect(check(report, "acp.session-load")!.status).toBe("pass");
    expect(check(report, "acp.session-delete")!.status).toBe("pass");
    expect(check(report, "acp.resume-shutdown")!.status).toBe("pass");
  }, 30_000);

  it("reports incompatible configured Kiro accounting ceilings", async () => {
    const fabricConfig = structuredClone(DEFAULT_FABRIC_CONFIG);
    fabricConfig.agents.runner = "kiro";
    fabricConfig.agents.maxTokensPerChild = 10;
    const report = await runDoctor({
      kiroBinary: wrapperPath,
      mcpEntryPath: mcpEntry,
      fabricConfig,
    });
    expect(report.ok).toBe(false);
    expect(check(report, "config.accounting")).toMatchObject({
      status: "fail",
      message: expect.stringContaining("agents.maxTokensPerChild"),
    });
  }, 30_000);
});
