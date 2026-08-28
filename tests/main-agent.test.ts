import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  MainAgentController,
  resolveFabricIdentity,
} from "../src/main-agent.js";

describe("MainAgentController", () => {
  it("resolves root, recursive-agent, and actor identities without losing the root Main target", () => {
    expect(resolveFabricIdentity("root", {})).toEqual({
      identity: {
        id: "session:root",
        name: "main",
        kind: "main",
        sessionId: "root",
      },
      mainAgentId: "session:root",
    });

    expect(
      resolveFabricIdentity("child", {
        KIRO_FABRIC_PARENT_RUN: "run-child",
        KIRO_FABRIC_AGENT_NAME: "Implementor",
        KIRO_FABRIC_MAIN_AGENT_ID: "session:root",
      }),
    ).toEqual({
      identity: {
        id: "run-child",
        name: "Implementor",
        kind: "agent",
        sessionId: "child",
      },
      mainAgentId: "session:root",
    });

    expect(
      resolveFabricIdentity("actor-session", {
        KIRO_FABRIC_ACTOR_ID: "actor-supervisor",
        KIRO_FABRIC_ACTOR_NAME: "Supervisor",
        KIRO_FABRIC_PARENT_RUN: "actor-worker-run",
        KIRO_FABRIC_MAIN_AGENT_ID: "session:root",
      }),
    ).toEqual({
      identity: {
        id: "actor-supervisor",
        name: "Supervisor",
        kind: "actor",
        sessionId: "actor-session",
      },
      mainAgentId: "session:root",
    });
  });

  it("reports live Main state and preserves user versus agent message semantics", () => {
    const sendMessage = vi.fn();
    const sendUserMessage = vi.fn();
    const pi = {
      sendMessage,
      sendUserMessage,
      getThinkingLevel: vi.fn(() => "high"),
    } as unknown as ExtensionAPI;
    const controller = new MainAgentController(
      pi,
      "session:root",
      true,
      "/tmp/project",
      "root",
    );
    const context = {
      model: { provider: "anthropic", id: "claude-test" },
      isIdle: () => false,
      hasPendingMessages: () => true,
    } as unknown as ExtensionContext;

    expect(controller.info(context)).toMatchObject({
      id: "session:root",
      name: "Main",
      kind: "main",
      status: "running",
      model: "anthropic/claude-test",
      thinking: "high",
      pendingMessages: true,
      local: true,
    });

    expect(controller.deliverUser("  user correction  ", "steer")).toMatchObject({
      queued: true,
      routed: "main",
    });
    expect(sendUserMessage).toHaveBeenCalledWith("user correction", {
      deliverAs: "steer",
    });

    expect(
      controller.deliverAgent({
        from: { id: "actor-1", name: "Supervisor", kind: "actor" },
        message: "inspect <unsafe> & continue",
        delivery: "followUp",
        data: { priority: 2 },
      }),
    ).toMatchObject({ queued: true, routed: "main" });
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        customType: "kiro-fabric-agent-message",
        content: expect.stringContaining("inspect &lt;unsafe&gt; &amp; continue"),
        details: expect.objectContaining({
          from: { id: "actor-1", name: "Supervisor", kind: "actor" },
          delivery: "followUp",
          data: { priority: 2 },
        }),
      }),
      { deliverAs: "followUp", triggerTurn: true },
    );

    const longMessage = "x".repeat(20_000);
    const longData = { body: "y".repeat(20_000) };
    controller.deliverAgent({
      from: { id: "agent-1", name: "worker", kind: "agent" },
      message: longMessage,
      delivery: "steer",
      data: longData,
    });
    expect(sendMessage.mock.calls.at(-1)?.[0]).toMatchObject({
      content: expect.stringContaining(longMessage),
      details: { data: longData },
    });

    controller.deliverAgent({
      from: { id: "session:peer", name: "Peer", kind: "main" },
      message: "peer settled",
      delivery: "followUp",
      triggerTurn: false,
    });
    expect(sendMessage.mock.calls.at(-1)?.[1]).toEqual({
      deliverAs: "followUp",
      triggerTurn: false,
    });
  });

  it("deduplicates an in-flight durable delivery until it is acknowledged", () => {
    const sendMessage = vi.fn();
    const controller = new MainAgentController(
      {
        getThinkingLevel: vi.fn(),
        sendMessage,
        sendUserMessage: vi.fn(),
      } as unknown as ExtensionAPI,
      "session:root",
      true,
      "/tmp/project",
    );
    const request = {
      from: { id: "actor-1", name: "actor", kind: "actor" as const },
      message: "durable result",
      delivery: "followUp" as const,
      idempotencyKey: "delivery-1:digest",
    };

    const first = controller.deliverAgent(request);
    const duplicate = controller.deliverAgent(request);
    expect(duplicate).toEqual({ ...first, acknowledged: true });
    expect(sendMessage).toHaveBeenCalledTimes(1);

    controller.acknowledgeDelivery(request.idempotencyKey);
    expect(controller.deliverAgent(request).messageId).not.toBe(first.messageId);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("rejects direct delivery from a process that does not own Main", () => {
    const controller = new MainAgentController(
      {
        getThinkingLevel: vi.fn(),
        sendMessage: vi.fn(),
        sendUserMessage: vi.fn(),
      } as unknown as ExtensionAPI,
      "session:root",
      false,
      "/tmp/project",
    );

    expect(
      controller.info({
        model: { provider: "child", id: "private-model" },
        isIdle: () => false,
        hasPendingMessages: () => true,
      } as unknown as ExtensionContext),
    ).toEqual(
      expect.objectContaining({
        id: "session:root",
        status: "remote",
        local: false,
        pendingMessages: false,
      }),
    );
    expect(controller.info()).not.toHaveProperty("model");
    expect(controller.info()).not.toHaveProperty("cwd");
    expect(controller.info()).not.toHaveProperty("startedAt");

    expect(() => controller.deliverUser("message", "steer")).toThrow(/owned by another/);
    expect(() =>
      controller.deliverAgent({
        from: { id: "agent-1", name: "worker", kind: "agent" },
        message: "message",
        delivery: "steer",
      }),
    ).toThrow(/owned by another/);
  });
});
