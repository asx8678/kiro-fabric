import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { fabricJsonText } from "../src/runtime/json-budget.js";
import { DEFAULT_FABRIC_CONFIG, normalizeFabricConfig } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
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
  it("allows default execution without weakening explicit policies or other risk categories", async () => {
    const request = vi.fn(async () => ({ action: "accept" as const, approved: true }));
    const bridge = new KiroPowerApprover({ supported: () => false, request });
    const shell = { ...action, name: "shell", ref: "local.shell", provider: "local", risk: "execute" as const };
    const args = { command: "elixir --version", review: 'Command: "elixir --version"\nCanonical cwd: "/workspace"' };
    const approver = new KiroPowerFabricApprover(DEFAULT_FABRIC_CONFIG.approvals, bridge, "/workspace");
    await expect(approver.approve(shell, args)).resolves.toBeUndefined();
    await expect(new KiroPowerFabricApprover({ ...DEFAULT_FABRIC_CONFIG.approvals, execute: "allow" }, bridge, "/workspace").approve(shell, args)).resolves.toBeUndefined();
    for (const execute of ["ask", "deny"] as const) {
      const restricted = new KiroPowerFabricApprover({ ...DEFAULT_FABRIC_CONFIG.approvals, execute }, bridge, "/workspace");
      await expect(restricted.approve(shell, args)).rejects.toThrow(/denied/);
    }
    for (const risk of ["read", "write", "network"] as const) {
      const other = { ...action, risk };
      if (risk === "read") await expect(approver.approve(other, {})).resolves.toBeUndefined();
      else await expect(approver.approve(other, {})).rejects.toThrow("denied or unavailable");
      await expect(new KiroPowerFabricApprover({ ...DEFAULT_FABRIC_CONFIG.approvals, [risk]: "allow" }, bridge, "/workspace").approve(other, {})).resolves.toBeUndefined();
      for (const mode of ["ask", "deny"] as const) {
        const restricted = new KiroPowerFabricApprover({ ...DEFAULT_FABRIC_CONFIG.approvals, [risk]: mode }, bridge, "/workspace");
        await expect(restricted.approve(other, {})).rejects.toThrow(/denied/);
      }
    }
    expect(request).not.toHaveBeenCalled();
  });
  it.each(["write", "execute", "network"] as const)("prompts only for default ask policy (%s risk)", async (risk) => {
    const request = vi.fn(async () => ({ action: "accept" as const, approved: true }));
    const approver = new KiroPowerFabricApprover(DEFAULT_FABRIC_CONFIG.approvals, new KiroPowerApprover({ supported: () => true, request }), "/workspace");
    await expect(approver.approve({ ...action, risk }, {})).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(risk === "execute" ? 0 : 1);
  });
  it("prepares a deferred prompt with one policy evaluation and an immutable exact request identity", async () => {
    let evaluations = 0;
    const config = { ...DEFAULT_FABRIC_CONFIG.approvals, get write() { evaluations += 1; return "ask" as const; } };
    const request = vi.fn(async (_options: { message: string }) => ({ action: "accept" as const, approved: true }));
    const approver = new KiroPowerFabricApprover(config, new KiroPowerApprover({ supported: () => true, request }), "/workspace");
    const args = { key: "exact", nested: { value: "before" } };
    const canonical = fabricJsonText({ schemaVersion: 1, ref: action.ref, risk: action.risk, args });
    const digest = createHash("sha256").update("kiro-fabric-approval-v1\0").update(canonical).digest("hex");
    const plan = approver.prepareApproval(action, args);
    expect(evaluations).toBe(1);
    expect(request).not.toHaveBeenCalled();
    args.nested.value = "after";
    expect(plan.decision).toBe("ask");
    if (plan.decision !== "ask") throw new Error("expected ask");
    await plan.prompt();
    expect(evaluations).toBe(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0].message).toContain(`sha256:${digest} (${canonical.length} chars)`);
    expect(request.mock.calls[0]?.[0].message).toContain("before");
    expect(request.mock.calls[0]?.[0].message).not.toContain("after");
  });

  it("fails closed on malformed policy and malformed elicitation decisions", async () => {
    const request = vi.fn(async () => ({ action: "accept" as const, approved: true }));
    const config = { ...DEFAULT_FABRIC_CONFIG.approvals, write: "invalid" } as unknown as typeof DEFAULT_FABRIC_CONFIG.approvals;
    await expect(new KiroPowerFabricApprover(config, new KiroPowerApprover({ supported: () => true, request }), "/workspace").approve(action, {})).rejects.toThrow("invalid Fabric approval policy");
    expect(request).not.toHaveBeenCalled();
    for (const result of [null, {}, { action: "accept" }, { action: "accept", approved: "true" }, { action: "unknown", approved: true }]) {
      const bridge = new KiroPowerApprover({ supported: () => true, request: async () => result as unknown as { action: "accept"; approved: boolean } });
      await expect(new KiroPowerFabricApprover({ ...DEFAULT_FABRIC_CONFIG.approvals, write: "ask" }, bridge, "/workspace").approve(action, {})).rejects.toThrow("denied or unavailable");
    }
  });

  it("presents exact bounded local review material without silently authorizing a suffix", async () => {
    let message = "";
    const bridge = new KiroPowerApprover({ supported: () => true, async request(options) { message = options.message; return { action: "accept", approved: true }; } });
    const approver = new KiroPowerFabricApprover({ ...DEFAULT_FABRIC_CONFIG.approvals, execute: "ask" }, bridge, "/workspace");
    const shell = { ...action, name: "shell", ref: "local.shell", provider: "local", risk: "execute" as const };
    const review = 'Command: "printf x"\nCanonical cwd: "/workspace"';
    await approver.approve(shell, { command: "printf x", cwd: "/workspace", review });
    expect(message).toContain(review);
    expect(message).toContain("sha256:");
    await expect(approver.approve(shell, { command: "printf x", cwd: "/workspace" })).rejects.toThrow("lacks canonical review");
    message = "";
    await expect(approver.approve(shell, { review: "x".repeat(12000) })).rejects.toThrow("denied or unavailable");
    expect(message).toBe("");
  });

  it("rejects retired web and browser programs before any approval or provider contact", async () => {
    let approvals = 0;
    const registry = new ActionRegistry();
    const service = new FabricExecutionService(registry, normalizeFabricConfig({}), "/workspace");
    try {
      const retired = [
        'return await web.search({query:"public documentation"});',
        'return await web.open({url:"https://example.com/source?query=" + "x".repeat(1600) + "&suffix=visible"});',
        'return await browser.open({url:"https://example.com"});',
      ];
      for (const code of retired) {
        const result = await service.execute({ code, approver: { async approve() { approvals += 1; } } });
        expect(result.success, code).toBe(false);
        expect(result.typeErrors?.length, code).toBeGreaterThan(0);
        expect(result.audits, code).toEqual([]);
      }
      // A generic call cannot dynamically regain a removed provider, even with a long suffix.
      const generic = await service.execute({
        code: 'return await tools.call({ref:"web.open",args:{url:"https://example.com/source?query=" + "x".repeat(1600)}});',
        approver: { async approve() { approvals += 1; } },
      });
      expect(generic.success).toBe(false);
      expect(generic.audits.every(audit => !audit.success)).toBe(true);
      expect(approvals).toBe(0);
      // Discovery never advertises a browser/web provider.
      expect(registry.providers().some(provider => /web|browser/iu.test(provider.name))).toBe(false);
    } finally { await service.close(); }
  });

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

  it.each(["unsupported", "missing_handler", "request_failed"] as const)("projects safe %s diagnostics without replaying a previous effect", async reason => {
    const registry = new ActionRegistry(), invoke = vi.fn(async () => "committed");
    const descriptor = { name: "write", description: "fixture mutation", risk: "write" as const, inputSchema: { type: "object" }, effect: { kind: "write" as const, resources: ["fixture"] } };
    registry.register({ name: "fixture", description: "approval boundary", list: async () => [descriptor], describe: async () => descriptor, invoke });
    let supportChecks = 0, requests = 0;
    const bridge = new KiroPowerApprover({
      supported: () => ++supportChecks === 1 || reason !== "unsupported",
      request: async () => {
        if (++requests === 1) return { action: "accept", approved: true };
        throw new Error(reason === "missing_handler"
          ? "SECRET-client-detail: No handler registered for method: _kiro/mcp/elicitation"
          : "SECRET-client-detail: No handler registered for method: another/method");
      },
    });
    const config = normalizeFabricConfig({ approvals: { write: "ask" } });
    const service = new FabricExecutionService(registry, config, "/workspace");
    try {
      const result = await service.execute({
        code: 'await tools.call({ref:"fixture.write"}); return await tools.call({ref:"fixture.write"});',
        approver: new KiroPowerFabricApprover(config.approvals, bridge, "/workspace"),
      });
      expect(result.success, result.error).toBe(false);
      expect(result.failure).toMatchObject({ code: "approval_denied", ref: "fixture.write", dispatchState: "not_dispatched", effectOutcome: "none" });
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(requests).toBe(reason === "unsupported" ? 1 : 2);
      expect(result.audits.map(audit => audit.success)).toEqual([true, false]);
      const projected = projectFabricExecutionText({ result, resultFormat: "text", maxOutputChars: 10_000, writeArtifact: () => { throw new Error("unexpected artifact"); } });
      expect(projected.isError).toBe(true);
      expect(projected.text).toContain(`(${reason})`);
      expect(projected.text).toContain("This action was not dispatched");
      expect(projected.text).toMatch(/Nested calls: \S+ succeeded/u);
      expect(projected.text).not.toContain("SECRET-client-detail");
      if (reason === "missing_handler") expect(projected.text).toContain("Use a client with working approval forms");
      else expect(projected.text).not.toContain("no handler for _kiro/mcp/elicitation");
    } finally { await service.close(); }
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
    expect(result.text).toContain("Nested calls: state.set_0 succeeded, state.set_1 failed");
            expect(result.text).toContain("state.late_success_");
        expect(result.text).toContain("… 4 more …");
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

  it("reports exact Unicode character and byte visibility", () => {
    const result = projectFabricExecutionText({
      result: { status: "succeeded", success: true, value: "A😀漢", logs: [], audits: [], elapsedMs: 1, effectiveTimeoutMs: 100 },
      resultFormat: "text",
      maxOutputChars: 100,
      writeArtifact() { throw new Error("unexpected artifact"); },
    });
    expect(result).toMatchObject({ visibleChars: 4, visibleBytes: 8, overflowed: false, artifactRetained: false, isError: false });
  });

  it("includes errors and logs in the retained failure projection", () => {
    let retained = "";
    const result = projectFabricExecutionText({
      result: { status: "failed", success: false, error: "outer", logs: [`guest log ${"x".repeat(300)}`], audits: [], elapsedMs: 1, effectiveTimeoutMs: 100 },
      resultFormat: "json", maxOutputChars: 180,
      writeArtifact(content) { retained = content; return "ka_test"; },
    });
    expect(JSON.parse(retained.split("\n\nFabric logs:")[0]!)).toMatchObject({ error: "outer" });
    expect(retained).toContain("guest log");
    expect(result).toMatchObject({ isError: true, overflowed: true, artifactRetained: true, artifactId: "ka_test" });
    expect(result.visibleChars).toBe(result.text.length);
    expect(result.visibleBytes).toBe(Buffer.byteLength(result.text));
  });

  it("reports exact overflow flags when retention fails", () => {
    const result = projectFabricExecutionText({
      result: { status: "failed", success: false, error: "😀".repeat(500), logs: [], audits: [], elapsedMs: 1, effectiveTimeoutMs: 100 },
      resultFormat: "json", maxOutputChars: 160,
      writeArtifact() { throw new Error("full"); },
    });
    expect(result).toMatchObject({ isError: true, overflowed: true, artifactRetained: false });
    expect(result.artifactId).toBeUndefined();
    expect(result.visibleChars).toBe(result.text.length);
    expect(result.visibleBytes).toBe(Buffer.byteLength(result.text));
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
