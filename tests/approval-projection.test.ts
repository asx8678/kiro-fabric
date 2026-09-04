import { describe, expect, it } from "vitest";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import type { FabricCallAudit } from "../src/core/action-registry.js";
import { KiroPowerApprover, KiroPowerFabricApprover } from "../src/kiro/power/approver.js";
import { projectFabricExecutionText } from "../src/kiro/projection.js";
import type { ResolvedFabricAction } from "../src/protocol.js";

const action: ResolvedFabricAction = {
  name: "set",
  ref: "memory.set",
  provider: "memory",
  description: "set",
  inputSchema: {},
  risk: "write",
  descriptorDigest: "a".repeat(64),
};

describe("Fabric approval and projection", () => {
  it("enforces explicit policy denial without elicitation", async () => {
    let requested = false;
    const bridge = new KiroPowerApprover({ supported: () => true, async request() { requested = true; return { action: "accept", approved: true }; } });
    const approver = new KiroPowerFabricApprover({ ...DEFAULT_FABRIC_CONFIG.approvals, write: "deny" }, bridge, "/workspace");
    await expect(approver.approve(action, { key: "a" })).rejects.toThrow("denied by Fabric policy");
    expect(requested).toBe(false);
  });

  it("fails closed when approval support is absent or declined", async () => {
    const absent = new KiroPowerApprover({ supported: () => false, async request() { throw new Error("must not run"); } });
    const absentApprover = new KiroPowerFabricApprover({ ...DEFAULT_FABRIC_CONFIG.approvals, write: "ask" }, absent, "/workspace");
    await expect(absentApprover.approve(action, { key: "a" })).rejects.toThrow("denied or unavailable");
    const declined = new KiroPowerApprover({ supported: () => true, async request() { return { action: "decline" }; } });
    await expect(new KiroPowerFabricApprover({ ...DEFAULT_FABRIC_CONFIG.approvals, write: "ask" }, declined, "/workspace").approve(action, { key: "a" })).rejects.toThrow("denied or unavailable");
  });

  it("redacts secret-like keys, bearer values, URLs, and outside paths", async () => {
    let message = "";
    const bridge = new KiroPowerApprover({
      supported: () => true,
      async request(options) { message = options.message; return { action: "accept", approved: true }; },
    });
    const approver = new KiroPowerFabricApprover(
      { ...DEFAULT_FABRIC_CONFIG.approvals, write: "ask" },
      bridge,
      "/workspace",
    );
    await approver.approve(action, {
      githubTokenValue: "never-visible",
      headerValue: "Bearer also-never-visible",
      endpointUrl: "https://user:password@example.test/path?token=secret#fragment",
      inputValue: "https://user:password@example.test/private-path?token=secret#fragment",
      opaqueValue: "github_pat_never-visible-either",
      filePath: "/outside/private.txt",
    });
    expect(message).not.toContain("never-visible");
    expect(message).not.toContain("password");
    expect(message).not.toContain("token=secret");
    expect(message).not.toContain("private-path");
    expect(message).not.toContain("never-visible-either");
    expect(message).toContain("<redacted>");
    expect(message).toContain("<outside-workspace>");
  });

  it("surfaces bounded guest logs", () => {
    const result = projectFabricExecutionText({
      result: { status: "succeeded", success: true, value: "done", logs: ["step 1"], audits: [], elapsedMs: 1, effectiveTimeoutMs: 100 },
      resultFormat: "text",
      maxOutputChars: 500,
      writeArtifact() { throw new Error("unexpected artifact"); },
    });
    expect(result.text).toContain("done");
    expect(result.text).toContain('Fabric logs: ["step 1"]');
  });

  it("reports bounded result-free nested-call progress when the outer execution fails", () => {
    const audits: FabricCallAudit[] = Array.from({ length: 12 }, (_, index) => ({
      ref: index === 10 ? `state.late_success_${"x".repeat(2_000)}` : `state.set_${index}`,
      nestedToolCallId: `secret-id-${index}`,
      startedAt: index,
      endedAt: index + 1,
      success: index % 2 === 0,
      error: `secret-error-${index}`,
      resultChars: 10_000 + index,
      resultTruncated: true,
      args: { token: `secret-arg-${index}` },
      result: `secret-result-${index}`,
    }));
    audits.push({
      ref: "memory.incomplete",
      nestedToolCallId: "secret-incomplete-id",
      startedAt: 100,
      error: "secret-incomplete-error",
      resultChars: 99_999,
      resultTruncated: true,
    });
    const result = projectFabricExecutionText({
      result: { status: "failed", success: false, error: "outer failure", logs: [], audits, elapsedMs: 1, effectiveTimeoutMs: 100 },
      resultFormat: "json",
      maxOutputChars: 10_000,
      writeArtifact() { throw new Error("unexpected artifact"); },
    });
    expect(result.text).toContain('"total":12,"succeeded":6,"failed":6');
    expect(result.text).toContain('"ref":"state.set_0","outcome":"succeeded"');
    expect(result.text).toContain('"ref":"state.set_1","outcome":"failed"');
    expect(result.text).toContain('"ref":"state.late_success_');
    expect(result.text).toContain('"outcome":"succeeded"');
    expect(result.text).toContain('"omitted":4');
    expect(result.text).toContain("Inspect current state before retrying fabric_exec");
    expect(result.text).not.toContain("state.set_5");
    expect(result.text).not.toContain("memory.incomplete");
    expect(result.text).not.toContain("secret-id");
    expect(result.text).not.toContain("secret-error");
    expect(result.text).not.toContain("secret-arg");
    expect(result.text).not.toContain("secret-result");
    expect(result.text).not.toContain("resultChars");
    expect(result.text).not.toContain("x".repeat(513));
    expect(result.text.length).toBeLessThan(5_000);
    expect(result.isError).toBe(true);
  });

  it("bounds visible output and stores the complete result", () => {
    let artifact = "";
    const result = projectFabricExecutionText({
      result: { status: "succeeded", success: true, value: `head-${"x".repeat(2_000)}-tail`, logs: [], audits: [], elapsedMs: 1, effectiveTimeoutMs: 100 },
      resultFormat: "text",
      maxOutputChars: 500,
      writeArtifact(content) { artifact = content; return "ka_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; },
    });
    expect(result.text.length).toBeLessThanOrEqual(500);
    expect(result.text).toContain("head-");
    expect(result.text).toContain("-tail");
    expect(result.text).toContain("… middle omitted …");
    expect(result.text).toContain("artifact ka_");
    expect(artifact).toBe(`head-${"x".repeat(2_000)}-tail`);
  });

  it("fails visibly but remains bounded when a full artifact cannot be retained", () => {
    const result = projectFabricExecutionText({
      result: { status: "succeeded", success: true, value: `head-${"x".repeat(2_000)}-tail`, logs: [], audits: [], elapsedMs: 1, effectiveTimeoutMs: 100 },
      resultFormat: "text",
      maxOutputChars: 200,
      writeArtifact() { throw new Error("quota"); },
    });
    expect(result.text.length).toBeLessThanOrEqual(200);
    expect(result.text).toContain("head-");
    expect(result.text).toContain("-tail");
    expect(result.text).toContain("could not be retained");
    expect(result.isError).toBe(true);
  });

  it("caps failed visible output below a larger configured success budget", () => {
    let artifact = "";
    const result = projectFabricExecutionText({
      result: {
        status: "failed",
        success: false,
        error: "failed",
        logs: [`head-${"x".repeat(30_000)}-tail`],
        audits: [],
        elapsedMs: 1,
        effectiveTimeoutMs: 100,
      },
      resultFormat: "json",
      maxOutputChars: 50_000,
      writeArtifact(content) { artifact = content; return "ka_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; },
    });
    expect(result.text.length).toBeLessThanOrEqual(20_000);
    expect(result.text).toContain("Output exceeded 20000 characters");
    expect(result.artifactId).toMatch(/^ka_/u);
    expect(artifact).toContain("-tail");
    expect(result.isError).toBe(true);
  });

  it("does not split UTF-16 surrogate pairs while projecting bounded output", () => {
    const result = projectFabricExecutionText({
      result: { status: "succeeded", success: true, value: `head-${"😀".repeat(500)}-tail`, logs: [], audits: [], elapsedMs: 1, effectiveTimeoutMs: 100 },
      resultFormat: "text",
      maxOutputChars: 201,
      writeArtifact() { return "ka_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; },
    });
    for (let index = 0; index < result.text.length; index++) {
      const code = result.text.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = result.text.charCodeAt(index + 1);
        expect(next).toBeGreaterThanOrEqual(0xdc00);
        expect(next).toBeLessThanOrEqual(0xdfff);
        index += 1;
      } else {
        expect(code < 0xdc00 || code > 0xdfff).toBe(true);
      }
    }
  });
});
