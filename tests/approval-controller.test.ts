import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  ApprovalController,
  FabricSessionApprovals,
} from "../src/core/approval-controller.js";
import type { FabricAutoApprovalClassifier } from "../src/core/auto-approval-classifier.js";
import type { ResolvedFabricAction } from "../src/core/action-registry.js";
import {
  bindFabricApprovalLease,
  consumeFabricApprovalLeases,
  fabricApprovalScope,
} from "../src/core/session-approvals.js";

const action: ResolvedFabricAction = {
  ref: "demo.write",
  provider: "demo",
  name: "write",
  description: "Write data",
  inputSchema: {},
  risk: "write",
};

const policies = {
  read: "allow" as const,
  write: "ask" as const,
  execute: "deny" as const,
  network: "ask" as const,
  agent: "ask" as const,
};

const tuiContext = (
  custom: (...args: unknown[]) => Promise<unknown>,
  notify = vi.fn(),
): ExtensionContext => ({
  hasUI: true,
  mode: "tui",
  ui: { custom, notify },
} as unknown as ExtensionContext);

describe("ApprovalController", () => {
  it("fails closed when approval is required without a UI", async () => {
    const controller = new ApprovalController(policies, { hasUI: false } as ExtensionContext);
    await expect(controller.approve(action)).rejects.toThrow("no interactive UI");
  });

  it("allows only the selected call when Allow once is chosen", async () => {
    const custom = vi.fn(async () => "allow-once");
    const notify = vi.fn();
    const controller = new ApprovalController(policies, tuiContext(custom, notify));

    await controller.approve(action);
    await controller.approve({ ...action, ref: "demo.writeAgain" });

    expect(custom).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith("Allowed once: demo.write", "info");
    expect(notify).toHaveBeenCalledWith("Allowed once: demo.writeAgain", "info");
  });

  it("shares an Always allow grant across the Pi session", async () => {
    const custom = vi.fn(async () => "allow-session");
    const notify = vi.fn();
    const session = new FabricSessionApprovals();
    const firstExecution = new ApprovalController(
      policies,
      tuiContext(custom, notify),
      session,
    );
    const laterExecution = new ApprovalController(
      policies,
      tuiContext(custom, notify),
      session,
    );

    await firstExecution.approve(action);
    await laterExecution.approve({ ...action, ref: "demo.writeLater" });

    expect(custom).toHaveBeenCalledOnce();
    expect(session.approvedRisks).toContain("write");
    expect(notify).toHaveBeenLastCalledWith(
      "Allowed write access for this Pi session",
      "info",
    );
  });

  it("uses an RPC-compatible three-choice dialog", async () => {
    const select = vi.fn(async () => "Allow write access for this session");
    const notify = vi.fn();
    const controller = new ApprovalController(policies, {
      hasUI: true,
      mode: "rpc",
      ui: { select, notify },
    } as unknown as ExtensionContext);

    await controller.approve(action);

    expect(select).toHaveBeenCalledWith(
      "Pi Fabric permission · demo.write requests write access. Write data",
      ["Allow once", "Allow write access for this session", "Deny"],
    );
  });

  it("auto-allows only the exact classified action", async () => {
    const classify = vi.fn(async () => ({
      decision: "allow" as const,
      reason: "Routine task-aligned local write",
      model: "anthropic/classifier",
      usage: {
        input: 10,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 12,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    }));
    const classifier = { classify } as unknown as FabricAutoApprovalClassifier;
    const controller = new ApprovalController(
      { ...policies, write: "auto", model: "anthropic/classifier" },
      { hasUI: false } as ExtensionContext,
      new FabricSessionApprovals(),
      classifier,
    );
    const args = { path: "src/index.ts", content: "safe" };

    await controller.approve(action, args);

    expect(classify).toHaveBeenCalledWith(
      action,
      args,
      expect.anything(),
      "anthropic/classifier",
    );
  });

  it("escalates an unsafe auto decision to the approval wizard", async () => {
    const classifier = {
      classify: vi.fn(async () => ({
        decision: "escalate" as const,
        reason: "Command modifies shared production state",
        model: "anthropic/classifier",
        usage: {
          input: 10,
          output: 2,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 12,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      })),
    } as unknown as FabricAutoApprovalClassifier;
    const custom = vi.fn(async () => "allow-once");
    const notify = vi.fn();
    const controller = new ApprovalController(
      { ...policies, write: "auto" },
      tuiContext(custom, notify),
      new FabricSessionApprovals(),
      classifier,
    );

    await controller.approve(action, { path: "production" });

    expect(custom).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Auto mode escalated"),
      "warning",
    );
  });

  it("fails closed to explicit approval when the classifier is unavailable", async () => {
    const classifier = {
      classify: vi.fn(async () => { throw new Error("model unavailable"); }),
    } as unknown as FabricAutoApprovalClassifier;
    const custom = vi.fn(async () => "deny");
    const controller = new ApprovalController(
      { ...policies, write: "auto" },
      tuiContext(custom),
      new FabricSessionApprovals(),
      classifier,
    );

    await expect(controller.approve(action)).rejects.toThrow("User denied");
    expect(custom).toHaveBeenCalledOnce();
  });

  it("fails closed and notifies when the user denies or dismisses", async () => {
    const custom = vi.fn(async () => "deny");
    const notify = vi.fn();
    const controller = new ApprovalController(policies, tuiContext(custom, notify));

    await expect(controller.approve(action)).rejects.toThrow(
      "User denied write access for demo.write",
    );
    expect(notify).toHaveBeenLastCalledWith(
      "Denied write access for demo.write",
      "warning",
    );
  });

  it("serializes concurrent one-time requests instead of widening the grant", async () => {
    const custom = vi.fn(async () => "allow-once");
    const controller = new ApprovalController(policies, tuiContext(custom));

    await Promise.all([
      controller.approve(action),
      controller.approve({ ...action, ref: "demo.parallelWrite" }),
    ]);

    expect(custom).toHaveBeenCalledTimes(2);
  });

  it("lets a queued request inherit a session grant without a second prompt", async () => {
    const custom = vi.fn(async () => "allow-session");
    const controller = new ApprovalController(policies, tuiContext(custom));

    await Promise.all([
      controller.approve(action),
      controller.approve({ ...action, ref: "demo.parallelWrite" }),
    ]);

    expect(custom).toHaveBeenCalledOnce();
  });

  it("binds a one-time lease to descriptor, arguments, plan, and project", async () => {
    const controller = new ApprovalController(
      policies,
      tuiContext(vi.fn(async () => "allow-once")),
    );
    const args = { path: "private.txt", token: "do-not-audit" };
    const scope = fabricApprovalScope({
      plan: "await pi.write({ path: 'private.txt' })",
      project: "/secret/project",
    });
    const lease = await controller.approve(action, args, scope);
    const audit = lease.consume(action, args, scope);

    expect(audit.source).toBe("allow-once");
    expect(audit.action).toBe(action.ref);
    expect(audit.descriptorDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(audit.argumentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(audit.planDigest).toBe(scope.planDigest);
    expect(audit.projectDigest).toBe(scope.projectDigest);
    expect(JSON.stringify(audit)).not.toContain("do-not-audit");
    expect(JSON.stringify(audit)).not.toContain("/secret/project");
    expect(JSON.stringify(audit)).not.toContain("pi.write");
  });

  it.each([
    ["arguments", action, { path: "changed" }, fabricApprovalScope({ plan: "p", project: "/a" })],
    ["descriptor", { ...action, description: "Changed after approval" }, { path: "original" }, fabricApprovalScope({ plan: "p", project: "/a" })],
    ["plan", action, { path: "original" }, fabricApprovalScope({ plan: "other", project: "/a" })],
    ["project", action, { path: "original" }, fabricApprovalScope({ plan: "p", project: "/b" })],
  ])("rejects and burns a lease with mismatched %s binding", async (_kind, candidateAction, candidateArgs, candidateScope) => {
    const controller = new ApprovalController(
      policies,
      tuiContext(vi.fn(async () => "allow-once")),
    );
    const expectedScope = fabricApprovalScope({ plan: "p", project: "/a" });
    const lease = await controller.approve(action, { path: "original" }, expectedScope);

    expect(() => lease.consume(candidateAction, candidateArgs, candidateScope)).toThrow(
      "binding does not match",
    );
    expect(() => lease.consume(action, { path: "original" }, expectedScope)).toThrow(
      "already been consumed",
    );
  });

  it("expires leases before side effects can use them", async () => {
    let now = 1_000;
    const session = new FabricSessionApprovals({ clock: () => now, leaseTtlMs: 50 });
    const controller = new ApprovalController(
      policies,
      tuiContext(vi.fn(async () => "allow-once")),
      session,
    );
    const lease = await controller.approve(action, {});
    now = 1_051;

    expect(() => lease.consume(action, {})).toThrow("has expired");
    expect(() => lease.consume(action, {})).toThrow("already been consumed");
  });

  it("atomically permits only one concurrent consumer", async () => {
    const controller = new ApprovalController(
      policies,
      tuiContext(vi.fn(async () => "allow-once")),
    );
    const lease = await controller.approve(action, {});
    const settled = await Promise.allSettled([
      Promise.resolve().then(() => lease.consume(action, {})),
      Promise.resolve().then(() => lease.consume(action, {})),
    ]);

    expect(settled.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((entry) => entry.status === "rejected")).toHaveLength(1);
  });

  it("validates and consumes a composite grant all-or-none", () => {
    const session = new FabricSessionApprovals();
    const args = { path: "original" };
    const writeAction = { ...action, risk: "write" as const };
    const executeAction = { ...action, risk: "execute" as const };
    const write = bindFabricApprovalLease(
      session.issueLease(writeAction, args, {}, "allow-once"),
      writeAction,
    );
    const execute = bindFabricApprovalLease(
      session.issueLease(executeAction, { path: "different" }, {}, "allow-once"),
      executeAction,
    );

    expect(() => consumeFabricApprovalLeases([write, execute], action, args)).toThrow(
      "binding does not match",
    );
    // Validation did not partially consume the valid first member.
    expect(write.consume(action, args)).toMatchObject({ risk: "write" });
    expect(execute.consume(action, { path: "different" })).toMatchObject({ risk: "execute" });
  });

  it("atomically permits only one concurrent composite consumer", async () => {
    const session = new FabricSessionApprovals();
    const writeAction = { ...action, risk: "write" as const };
    const executeAction = { ...action, risk: "execute" as const };
    const leases = [writeAction, executeAction].map((approvedAction) =>
      bindFabricApprovalLease(
        session.issueLease(approvedAction, {}, {}, "allow-once"),
        approvedAction,
      ));
    const settled = await Promise.allSettled([
      Promise.resolve().then(() => consumeFabricApprovalLeases(leases, action, {})),
      Promise.resolve().then(() => consumeFabricApprovalLeases(leases, action, {})),
    ]);
    expect(settled.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((entry) => entry.status === "rejected")).toHaveLength(1);
  });

  it("keeps explicit broad session grants while issuing distinct bound leases", async () => {
    const custom = vi.fn(async () => "allow-session");
    const session = new FabricSessionApprovals();
    const controller = new ApprovalController(policies, tuiContext(custom), session);
    const firstArgs = { path: "first" };
    const secondArgs = { path: "second" };

    const first = await controller.approve(action, firstArgs);
    const second = await controller.approve(action, secondArgs);

    expect(custom).toHaveBeenCalledOnce();
    expect(first.id).not.toBe(second.id);
    expect(first.consume(action, firstArgs).source).toBe("session");
    expect(second.consume(action, secondArgs).source).toBe("session");
  });

  it("denies actions blocked by policy without prompting", async () => {
    const custom = vi.fn(async () => "allow-once");
    const controller = new ApprovalController(policies, tuiContext(custom));
    await expect(controller.approve({ ...action, risk: "execute" })).rejects.toThrow(
      "denied by the Fabric execute policy",
    );
    expect(custom).not.toHaveBeenCalled();
  });
});
