import { describe, expect, it } from "vitest";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { KiroPowerApprover, KiroPowerFabricApprover } from "../src/kiro/power/approver.js";
import { projectFabricExecutionText } from "../src/kiro/projection.js";
import type { ResolvedFabricAction } from "../src/protocol.js";

const action: ResolvedFabricAction = { name: "set", ref: "memory.set", provider: "memory", description: "set", inputSchema: {}, risk: "write" };

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

  it("bounds visible output and stores the complete result", () => {
    let artifact = "";
    const result = projectFabricExecutionText({
      result: { status: "succeeded", success: true, value: { body: "x".repeat(2_000) }, logs: [], audits: [], elapsedMs: 1, effectiveTimeoutMs: 100 },
      resultFormat: "json",
      maxOutputChars: 500,
      writeArtifact(content) { artifact = content; return "ka_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; },
    });
    expect(result.text.length).toBeLessThanOrEqual(500);
    expect(result.text).toContain("artifact ka_");
    expect(artifact).toContain("x".repeat(2_000));
  });

  it("fails visibly but remains bounded when a full artifact cannot be retained", () => {
    const result = projectFabricExecutionText({
      result: { status: "succeeded", success: true, value: "x".repeat(2_000), logs: [], audits: [], elapsedMs: 1, effectiveTimeoutMs: 100 },
      resultFormat: "text",
      maxOutputChars: 200,
      writeArtifact() { throw new Error("quota"); },
    });
    expect(result.text.length).toBeLessThanOrEqual(200);
    expect(result.text).toContain("could not be retained");
    expect(result.isError).toBe(true);
  });
});
