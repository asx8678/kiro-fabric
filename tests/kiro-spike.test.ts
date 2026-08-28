import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Regression tests for the Phase 1 harness. Two layers:
//
// 1. Guard tests (real binary, no prompt): unknown probes, billing gates, and
//    version pinning must fail loudly. These never send session/prompt.
// 2. State-machine tests (fake binary): billable probes run against
//    tests/fixtures/kiro/fake-kiro.mjs via KIRO_BINARY=node +
//    KIRO_BINARY_ARGS=<fake>. Safe in CI: the fake never talks to a model.
//
// All spawnSync-based tests need generous vitest timeouts (default 5s is too
// short for process trees), so every test passes an explicit timeout.
const script = "scripts/spike-kiro.mjs";
// Absolute path: the harness spawns the fake with cwd=<tmp probe dir>.
const fakeKiro = resolve("tests/fixtures/kiro/fake-kiro.mjs");
const TEST_TIMEOUT = 60_000;

const tmps: string[] = [];
afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

function runSpike(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 30_000,
  });
}

function runFake(scenario: string, probe: string, extraEnv: Record<string, string> = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "kiro-spike-test-"));
  tmps.push(tmp);
  return spawnSync(process.execPath, [script, probe], {
    encoding: "utf8",
    env: {
      ...process.env,
      KIRO_PHASE0_BILLABLE: "1",
      KIRO_BINARY: process.execPath,
      KIRO_BINARY_ARGS: fakeKiro,
      FAKE_KIRO_SCENARIO: scenario,
      FAKE_KIRO_MCP_LOG: join(tmp, "fixture.jsonl"),
      FAKE_KIRO_SENTINEL_PATH: join(tmp, "sentinel.txt"),
      ...extraEnv,
    },
    timeout: 30_000,
  });
}

describe("spike-kiro harness guards", () => {
  it("rejects unknown probe names instead of silently passing", () => {
    const result = runSpike(["definitely-not-a-probe"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unknown probe");
  }, TEST_TIMEOUT);

  it("rejects billable probes without KIRO_PHASE0_BILLABLE=1", () => {
    const result = runSpike(["mcp-cancel"], { KIRO_PHASE0_BILLABLE: "" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("KIRO_PHASE0_BILLABLE=1");
  }, TEST_TIMEOUT);

  it("keeps the billable aggregate behind the explicit billing guard", () => {
    const result = runSpike(["billable-all"], { KIRO_PHASE0_BILLABLE: "" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("KIRO_PHASE0_BILLABLE=1");
  }, TEST_TIMEOUT);

  it("rejects a Kiro version mismatch before running any probe", () => {
    const result = runSpike(["handshake"], { KIRO_EXPECT_VERSION: "0.0.0-does-not-exist" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/version mismatch/);
  }, TEST_TIMEOUT);

  it("excludes every billable probe from `all`", () => {
    const result = runSpike(["plan"]);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect([...parsed.all].sort()).toEqual(["handshake", "mcp", "profile"]);
    expect(parsed.all.filter((probe: string) => parsed.billableAll.includes(probe))).toEqual([]);
  }, TEST_TIMEOUT);
});

describe("spike-kiro probe state machines (fake Kiro, non-billable)", () => {
  it("mcp-cancel passes on a correct cancel chain", () => {
    const result = runFake("mcp-cancel-ok", "mcp-cancel");
    expect(result.stderr).not.toContain("timed out");
    expect(result.status).toBe(0);
  }, TEST_TIMEOUT);

  it("mcp-cancel fails when MCP cancellation never arrives", () => {
    const result = runFake("mcp-cancel-no-mcp", "mcp-cancel");
    expect(result.status).not.toBe(0);
  }, TEST_TIMEOUT);

  it("acp-cancel passes on the permission-then-cancel flow", () => {
    const result = runFake("acp-cancel-ok", "acp-cancel");
    expect(result.status).toBe(0);
  }, TEST_TIMEOUT);

  it("acp-cancel fails when no permission request proves an active turn", () => {
    const result = runFake("acp-cancel-no-perm", "acp-cancel");
    expect(result.status).not.toBe(0);
  }, TEST_TIMEOUT);

  it("one-tool passes when only the visible tool is invoked", () => {
    const result = runFake("one-tool-ok", "one-tool");
    expect(result.status).toBe(0);
  }, TEST_TIMEOUT);

  it("one-tool fails when the hidden tool leaks through", () => {
    const result = runFake("one-tool-hidden", "one-tool");
    expect(result.status).not.toBe(0);
  }, TEST_TIMEOUT);

  it("child-deny passes when rejection prevents execution", () => {
    const result = runFake("child-deny-ok", "child-deny");
    expect(result.status).toBe(0);
  }, TEST_TIMEOUT);

  it("child-deny fails when the tool executes despite denial", () => {
    const result = runFake("child-deny-executes", "child-deny");
    expect(result.status).not.toBe(0);
  }, TEST_TIMEOUT);

  it("mcp-elicit fails before any prompt when the capability is missing", () => {
    const result = runFake("elicit-unsupported", "mcp-elicit");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("promptSent=false");
  }, TEST_TIMEOUT);

  it("malformed Kiro stdout fails the probe", () => {
    const result = runFake("malformed-stdout", "handshake");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("malformed stdout");
  }, TEST_TIMEOUT);
});
