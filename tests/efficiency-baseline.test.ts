import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { parseArgs, validateExecutionResult, validateHelpPages } from "../scripts/efficiency-baseline.mjs";
import { fabricGuestDeclarations } from "../src/runtime/guest-types.js";
import { FabricBootstrapProvider } from "../src/kiro/bootstrap-provider.js";
import type { FabricInvocationContext } from "../src/protocol.js";

const script = path.resolve("scripts/efficiency-baseline.mjs");
const root = fs.mkdtempSync("/tmp/efficiency-baseline-test-");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], {
  encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024,
  env: { ...process.env, HOME: path.join(root, "never-home"), KIRO_HOME: path.join(root, "never-kiro"), TMPDIR: path.join(root, "never-tmp"), PATH: root, KIRO_FABRIC_DEBUG: "1" },
});

const sourceHelp = async () => {
  const provider = new FabricBootstrapProvider(20000);
  const context = { cwd: root, signal: new AbortController().signal } as FabricInvocationContext;
  const defaultPage = await provider.invoke("help", { topic: "api" }, context) as any;
  const pages: any[] = [];
  let offset = 0;
  do {
    const page = await provider.invoke("help", { topic: "api", offset, limit: 16000 }, context) as any;
    pages.push(page);
    if (!page.truncated) break;
    offset = page.nextOffset;
  } while (pages.length < 16);
  return { defaultPage, pages };
};

describe("offline efficiency preparation", () => {
  it.each([[], ["--network"], ["probe", "--command", "touch /tmp/not-allowed"], ["manifest", "--output", "/tmp/output"], ["probe", "--config", "https://example.com"], ["probe", "--home", "/home/user"], ["probe", "--runtime", "/tmp/code.mjs"], ["manifest", "probe"]].map((args) => [args]))("rejects unsupported input %j before work", (args) => {
    expect(() => parseArgs(args)).toThrow(/usage/);
    const result = run(...args);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/usage/);
  });

  it("documents only closed offline commands", () => {
    expect(parseArgs(["manifest"])).toBe("manifest");
    expect(parseArgs(["probe"])).toBe("probe");
    const result = run("--help");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No paths, commands, network, Kiro or profile options");
  });

  it("prepares reproducible tasks without pretending to run them", () => {
    const result = run("manifest");
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.tasks.map((task: any) => task.id)).toEqual(["sequential-17", "sequential-64", "parallel-8", "search-edit-verify", "bounded-help"]);
    expect(report.tasks.map((task: any) => task.reads)).toEqual([17, 64, 8, null, null]);
    for (const task of report.tasks) for (const field of ["fixtureProbe", "runtimeProbe", "clientMeasurement"]) {
      expect(task[field].status).toBe("unrun");
      for (const [key, value] of Object.entries(task[field])) if (key !== "status") expect(value).toBeNull();
    }
    expect(report.effectiveConfig).toBeNull();
    expect(report.identity.sourceMatchesBuild).toBeNull();
    expect(report.identity.installedProfile).toBeNull();
    for (const section of ["source", "runtime", "configuration", "harness", "dependencies"]) expect(report.identity[section].sha256).toMatch(/^[a-f0-9]{64}$/);
    const source = report.identity.source.files.find((file: any) => file.path === "src/runtime/guest-types.ts");
    expect(source.sha256).toBe(createHash("sha256").update(fs.readFileSync(source.path)).digest("hex"));
    expect(report.economic.comparableTasksAttempted).toBe(0);
    expect(report.economic.costPerSuccessfulTask).toBeNull();
    expect(report.fixture.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("probes deterministic fixtures and built expanded help, not client efficiency; ignores ambient homes/settings/commands", () => {
    // If anything starts Kiro, shell, rg or a PATH-selected git, leave evidence.
    const marker = path.join(root, "executed");
    for (const command of ["kiro-cli", "kiro", "sh", "rg", "git", "curl"]) {
      fs.writeFileSync(path.join(root, command), `#!/bin/sh\n/usr/bin/touch '${marker}'\nexit 99\n`, { mode: 0o700 });
    }
    const result = run("probe");
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const report = JSON.parse(result.stdout);
    const expectedChars = [187, 704, 88, 143];
    for (const [i, task] of report.tasks.slice(0, 4).entries()) {
      expect(task.fixtureProbe).toMatchObject({ status: "succeeded", attempts: 1, retries: 0, artifactRereads: 0, returnedChars: expectedChars[i], result: { verified: true } });
      expect(task.fixtureProbe.latencyMs).toBeGreaterThanOrEqual(0);
      expect(task.runtimeProbe.success).toBeNull();
    }
    const help = report.tasks[4].runtimeProbe;
    expect(help.success).toBe(true);
    expect(help.result.expandedChars).toBeGreaterThan(help.result.defaultPageTextChars);
    expect(help.result.defaultPageTextChars).toBe(3290);
    expect(help.result.defaultPageTruncated).toBe(true);
    expect(help.result.expandedSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(help.returnedChars).toBeGreaterThan(help.result.expandedChars);
    expect(report.effectiveConfig).toMatchObject({ mcp: { enabled: false }, memory: { enabled: false }, state: { enabled: false }, approvals: { execute: "deny", network: "deny", write: "deny" } });
    // Shared-tree builds can drift; such runs must not be accepted as stable.
    expect(report.identityStableDuringProbe).toBe(true);
    for (const task of report.tasks) expect(task.clientMeasurement.latencyMs).toBeNull();
    for (const [key, value] of Object.entries(report.economic)) if (!key.startsWith("comparableTasks")) expect(value).toBeNull();
    expect(fs.existsSync(marker)).toBe(false);
    for (const name of ["never-home", "never-kiro", "never-tmp"]) expect(fs.existsSync(path.join(root, name))).toBe(false);
    expect(fs.existsSync(path.dirname(report.effectiveConfig.mcp.configPath))).toBe(false);
  });

  it("retains a missing-runtime failure and completed fixture evidence without rebuilding or retrying", () => {
    const checkout = path.join(root, "missing-build");
    fs.mkdirSync(path.join(checkout, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(checkout, "src"));
    fs.writeFileSync(path.join(checkout, "package.json"), JSON.stringify({ type: "module", dependencies: {} }));
    const copy = path.join(checkout, "scripts", "efficiency-baseline.mjs");
    fs.copyFileSync(script, copy);
    const result = spawnSync(process.execPath, [copy, "probe"], { encoding: "utf8", timeout: 30000 });
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.tasks.slice(0, 4).every((task: any) => task.fixtureProbe.success)).toBe(true);
    expect(report.tasks[4].runtimeProbe).toMatchObject({ status: "failed", success: false, attempts: 1, retries: 0, returnedChars: null, artifactRereads: null });
    expect(report.tasks[4].runtimeProbe.error).toMatch(/Cannot find module/);
    expect(report.economic.billedCost).toBeNull();
    expect(fs.existsSync(path.join(checkout, "dist"))).toBe(false);
  });

  it("accounts for interpolated runtime declarations and actual JSON page size, not template length", async () => {
    const value = await sourceHelp();
    const summary = validateHelpPages(value);
    expect(summary.expandedChars).toBe(fabricGuestDeclarations.length);
    expect(summary.expandedSha256).toBe(createHash("sha256").update(fabricGuestDeclarations).digest("hex"));
    expect(value.pages.map((page) => page.text).join("")).toBe(fabricGuestDeclarations);
    expect(summary.defaultPageTextChars).toBe(3290);
    expect(summary.defaultPageJsonChars).toBe(JSON.stringify(value.defaultPage).length);
    expect(summary.defaultPageJsonChars).toBeLessThanOrEqual(20000);
    expect(summary.expandedChars).toBeGreaterThan(fs.readFileSync("src/runtime/guest-types.ts", "utf8").length);
  });

  it("rejects malformed/non-progressing/truncated/template help results", async () => {
    const valid = await sourceHelp();
    const badOffset = structuredClone(valid); badOffset.pages[0].nextOffset = 0;
    const oversized = structuredClone(valid); oversized.defaultPage.text = "x".repeat(20001);
    const missingExpansion = { defaultPage: { topic: "api", text: "${LOCAL_GUEST_DECLARATIONS}", truncated: false }, pages: [{ topic: "api", text: "${LOCAL_GUEST_DECLARATIONS}", truncated: false }] };
    for (const value of [null, [], {}, { pages: [] }, { ...valid, pages: valid.pages.slice(0, 1) }, badOffset, oversized, missingExpansion]) {
      expect(() => validateHelpPages(value)).toThrow();
    }
  });

  it("rejects invalid execution outcomes rather than manufacturing successful measurements", () => {
    validateExecutionResult({ status: "succeeded", success: true, value: null, audits: [] });
    validateExecutionResult({ status: "failed", success: false, audits: [] });
    for (const value of [null, {}, { status: "succeeded", success: false, audits: [] }, { status: "succeeded", success: true, audits: [] }, { status: "failed", success: false, audits: null }, { status: "unknown", success: false, audits: [] }]) expect(() => validateExecutionResult(value)).toThrow();
  });
});
