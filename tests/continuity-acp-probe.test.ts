import { removeFixtureSync } from "./fixture-cleanup.mjs";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { runAcpCapabilityProbe, type AcpCapabilityProbeOptions, type AcpProbeFrame, type AcpProbeTransport } from "../src/kiro/acp-capability-probe.js";
import {
  buildCancelNotificationParams,
  buildInitializeParams,
  buildPermissionCancelledReply,
  buildPermissionSelectedReply,
  buildPromptRequestParams,
  buildSessionNewParams,
  inspectIncomingFrame,
  inspectInitializeResult,
  inspectPermissionRequest,
  inspectSessionIdResult,
  inspectStopReason,
  measureFrameBytes,
  selectRejectOptionId,
} from "../src/kiro/acp-probe-contract.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
const portable = process.platform === "darwin" || process.platform === "linux";

interface Fixture {
  initializeRequest: { params: { protocolVersion: number } };
  initializeResponse: AcpProbeFrame;
  sessionNewRequest: { params: { cwd: string; mcpServers: unknown[] } };
  sessionNewResponse: AcpProbeFrame;
  promptRequest: AcpProbeFrame & { params: { sessionId: string; prompt: Array<{ type: string; text: string }> } };
  promptResponseEndTurn: AcpProbeFrame;
  promptResponseCancelled: AcpProbeFrame;
  stopReasons: string[];
  cancelNotification: AcpProbeFrame;
  permissionRequest: AcpProbeFrame & { params: { sessionId: string; toolCall: unknown; options: Array<Record<string, unknown>> } };
  permissionOptionKinds: string[];
  permissionResponseSelected: AcpProbeFrame;
  permissionResponseCancelled: AcpProbeFrame;
  rejectedShapes: Array<{ id: string; frame: AcpProbeFrame; reason: string }>;
}
const fixture = JSON.parse(fs.readFileSync(path.resolve("tests/fixtures/acp-v1-wire.json"), "utf8")) as Fixture;

/** Test-local strict validators for the historical ACP v1 prompt/reply shapes.
 * Production no longer exports prompt/reply semantic validators (no live
 * consumer), so this oracle lives with the test that asserts it. It mirrors the
 * fixture's normative shapes and is deliberately separate from the JSON-RPC
 * envelope-only `inspectIncomingFrame`, which accepts the historical invalid
 * envelope and is not an equivalent semantic validator. */
type PromptParamInspection = { ok: true; sessionId: string; text: string } | { ok: false; reason: string };
const inspectPromptShape = (params: unknown): PromptParamInspection => {
  if (typeof params !== "object" || params === null) return { ok: false, reason: "session/prompt params must be an object" };
  const record = params as Record<string, unknown>;
  if (Object.hasOwn(record, "content")) return { ok: false, reason: "session/prompt params must not use a content field; a prompt array is required" };
  if (typeof record.sessionId !== "string" || !record.sessionId) return { ok: false, reason: "session/prompt params must bind a session id" };
  const prompt = record.prompt;
  if (!Array.isArray(prompt) || prompt.length !== 1 || typeof prompt[0] !== "object" || prompt[0] === null) {
    return { ok: false, reason: "session/prompt params must carry one prompt content block" };
  }
  const block = prompt[0] as Record<string, unknown>;
  if (block.type !== "text" || typeof block.text !== "string") return { ok: false, reason: "session/prompt prompt block must be text" };
  return { ok: true, sessionId: record.sessionId, text: block.text };
};

type PermissionReplyInspection =
  | { ok: true; outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" } }
  | { ok: false; reason: string };
const inspectReplyShape = (result: unknown): PermissionReplyInspection => {
  if (typeof result !== "object" || result === null) return { ok: false, reason: "permission reply must be an object" };
  const outcome = (result as Record<string, unknown>).outcome;
  if (typeof outcome !== "object" || outcome === null) return { ok: false, reason: "permission reply must carry an outcome" };
  const value = outcome as Record<string, unknown>;
  if (value.outcome === "cancelled") return { ok: true, outcome: { outcome: "cancelled" } };
  if (value.outcome === "selected") {
    if (typeof value.optionId !== "string" || !value.optionId) return { ok: false, reason: "selected permission reply must carry an optionId" };
    return { ok: true, outcome: { outcome: "selected", optionId: value.optionId } };
  }
  if (/deny/iu.test(String(value.outcome))) return { ok: false, reason: "permission replies must use selected or cancelled; ACP v1 has no deny outcome" };
  return { ok: false, reason: `unsupported permission outcome: ${String(value.outcome)}` };
};

const continuation = "Exact continuation packet bytes\nSecond line \u00e9";
const responseFrame = (frame: AcpProbeFrame, result: unknown): AcpProbeFrame =>
  ({ jsonrpc: "2.0", ...(frame.id !== undefined ? { id: frame.id } : {}), result });

class ScriptedTransport implements AcpProbeTransport {
  readonly sent: AcpProbeFrame[] = [];
  readonly #incoming: AcpProbeFrame[] = [];
  readonly #waiters: ((frame: AcpProbeFrame | null) => void)[] = [];
  #closed = false;
  #closeCalls = 0;
  constructor(
    private readonly script: (frame: AcpProbeFrame, transport: ScriptedTransport) => void,
    private readonly faults: {
      rejectSend?: (frame: AcpProbeFrame) => boolean;
      neverSettleSend?: (frame: AcpProbeFrame) => boolean;
      neverSettleNext?: boolean;
      neverSettleClose?: boolean;
    } = {},
  ) {}
  get closeCalls(): number { return this.#closeCalls; }
  async send(frame: AcpProbeFrame): Promise<void> {
    this.sent.push(frame);
    if (this.faults.rejectSend?.(frame)) throw new Error("scripted send failure");
    if (this.faults.neverSettleSend?.(frame)) return await new Promise<void>(() => {});
    this.script(frame, this);
  }
  queue(frame: AcpProbeFrame): void { const waiter = this.#waiters.shift(); if (waiter) waiter(frame); else this.#incoming.push(frame); }
  async next(): Promise<AcpProbeFrame | null> {
    if (this.faults.neverSettleNext) return await new Promise<AcpProbeFrame | null>(() => {});
    if (this.#incoming.length) return this.#incoming.shift()!;
    if (this.#closed) return null;
    return await new Promise(resolve => this.#waiters.push(resolve));
  }
  async close(): Promise<void> {
    this.#closeCalls++;
    if (this.faults.neverSettleClose) return await new Promise<void>(() => {});
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter(null);
  }
}

/** A conforming peer: initialize, fresh session, one permission request, an
 * assistant echo of the packet (never delivery evidence) and a terminal
 * cancellation of the exact prompt request. */
const conformingPeer = (sessionId: string): ((frame: AcpProbeFrame, transport: ScriptedTransport) => void) => {
  let promptId: number | string | undefined;
  return (frame, transport) => {
    if (frame.method === "initialize") {
      transport.queue(responseFrame(frame, fixture.initializeResponse.result));
    } else if (frame.method === "session/new") {
      transport.queue(responseFrame(frame, { sessionId }));
    } else if (frame.method === "session/prompt") {
      promptId = frame.id;
      transport.queue({ ...fixture.permissionRequest, params: { ...fixture.permissionRequest.params, sessionId } });
      transport.queue({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { text: continuation } } } });
    } else if (frame.method === "session/cancel") {
      transport.queue({ jsonrpc: "2.0", ...(promptId !== undefined ? { id: promptId } : {}), result: { stopReason: "cancelled" } });
    }
  };
};

describe("ACP v1 wire contract fixture", () => {
  it("encodes the normative shapes the probe and its builders must speak", () => {
    expect(inspectInitializeResult(fixture.initializeResponse.result)).toEqual({ ok: true, agentInfo: { name: "my-agent", version: "1.0.0" } });
    expect(inspectSessionIdResult(fixture.sessionNewResponse.result)).toEqual({ ok: true, sessionId: "sess_abc123def456" });
    const prompt = inspectPromptShape(fixture.promptRequest.params);
    expect(prompt).toEqual({ ok: true, sessionId: "sess_abc123def456", text: "Can you analyze this code for potential issues?" });
    const permission = inspectPermissionRequest(fixture.permissionRequest.params, "sess_abc123def456");
    expect(permission.ok).toBe(true);
    if (permission.ok) expect(selectRejectOptionId(permission.request.options)).toBe("reject-once");
    expect(selectRejectOptionId(fixture.permissionRequest.params.options.slice(0, 1).map(option => ({ optionId: String(option.optionId), name: String(option.name), kind: String(option.kind) })))).toBeNull();
    const otherSession = inspectPermissionRequest(fixture.permissionRequest.params, "sess-someone-else");
    expect(otherSession).toMatchObject({ ok: false });
    if (!otherSession.ok) expect(otherSession.reason).toContain("different session");
    const beforeSession = inspectPermissionRequest(fixture.permissionRequest.params, null);
    expect(beforeSession).toMatchObject({ ok: false });
    if (!beforeSession.ok) expect(beforeSession.reason).toContain("before the probe created a session");
    expect(inspectReplyShape(fixture.permissionResponseSelected.result)).toEqual({ ok: true, outcome: { outcome: "selected", optionId: "reject-once" } });
    expect(inspectReplyShape(fixture.permissionResponseCancelled.result)).toEqual({ ok: true, outcome: { outcome: "cancelled" } });
    for (const reason of fixture.stopReasons) expect(inspectStopReason(reason)).toBe(reason);
    expect(inspectStopReason("paused")).toBeNull();
    expect(inspectIncomingFrame(fixture.initializeResponse)).toMatchObject({ ok: true, kind: "response", id: 0 });
    expect(inspectIncomingFrame(fixture.permissionRequest)).toMatchObject({ ok: true, kind: "request" });
    expect(inspectIncomingFrame(fixture.cancelNotification)).toMatchObject({ ok: true, kind: "notification" });
    expect(measureFrameBytes(fixture.cancelNotification)).toBeGreaterThan(0);
    // The historical bug shapes recorded in the fixture are rejected.
    const contentShape = fixture.rejectedShapes.find(shape => shape.id === "prompt-with-content-params")!;
    const contentInspection = inspectPromptShape(contentShape.frame.params);
    expect(contentInspection).toMatchObject({ ok: false });
    if (!contentInspection.ok) expect(contentInspection.reason).toContain("prompt");
    const denyShape = fixture.rejectedShapes.find(shape => shape.id === "permission-deny-outcome")!;
    const denyInspection = inspectReplyShape(denyShape.frame.result);
    expect(denyInspection).toMatchObject({ ok: false });
    if (!denyInspection.ok) expect(denyInspection.reason).toContain("deny");
    // Builders reproduce the normative frames.
    const probeInitialize = buildInitializeParams();
    expect(probeInitialize.protocolVersion).toBe(fixture.initializeRequest.params.protocolVersion);
    expect(probeInitialize.clientCapabilities).toEqual({});
    expect(buildSessionNewParams("/home/user/project")).toEqual({ cwd: "/home/user/project", mcpServers: [] });
    expect(buildPromptRequestParams("sess_abc123def456", "Can you analyze this code for potential issues?")).toEqual(fixture.promptRequest.params);
    expect(buildCancelNotificationParams("sess_abc123def456")).toEqual(fixture.cancelNotification.params);
    expect(buildPermissionSelectedReply(5, "reject-once")).toEqual(fixture.permissionResponseSelected);
    expect(buildPermissionCancelledReply(5)).toEqual(fixture.permissionResponseCancelled);
  });
});

describe("ACP capability probe (synthetic transport)", () => {
  it("submits the normative ACP v1 shapes and witnesses every gate without qualifying", async () => {
    const transport = new ScriptedTransport(conformingPeer("sess-fresh-1"));
    const report = await runAcpCapabilityProbe(transport, { cwd: "/workspace/project", continuation, requestedEngine: "v3", source: "synthetic" });
    expect(report).toMatchObject({ source: "synthetic", qualified: false, managedRotationAvailable: false, sessionId: "sess-fresh-1" });
    expect(report.gates).toMatchObject({
      initializeObserved: true, requestedEngineExplicit: true, freshSessionCreated: true,
      exactContinuationSubmitted: true, permissionDeniedByDefault: true, cancellationTerminalWitnessed: true,
      nativeAutoCompactionSuppression: "unknown",
    });
    expect(report.errors).toEqual([]);
    const sha256 = createHash("sha256").update(continuation, "utf8").digest("hex");
    expect(report.submittedContinuation).toEqual({ bytes: Buffer.byteLength(continuation, "utf8"), sha256 });
    expect(report.submission).toEqual({ bytes: Buffer.byteLength(continuation, "utf8"), sha256, state: "written" });
    expect(report.cancellation).toEqual({ requested: true, writeSettled: true, terminalStopReason: "cancelled" });
    expect(report.cleanup).toEqual({ state: "complete", detail: null });
    // Exactly one prompt submission; the probe never retries a submitted continuation.
    expect(transport.sent.filter(frame => frame.method === "session/prompt")).toHaveLength(1);
    const initialize = transport.sent.find(frame => frame.method === "initialize")!;
    expect(initialize.params).toEqual(buildInitializeParams());
    const sessionNew = transport.sent.find(frame => frame.method === "session/new")!;
    expect(sessionNew.params).toEqual({ ...fixture.sessionNewRequest.params, cwd: "/workspace/project", mcpServers: [] });
    const prompt = transport.sent.find(frame => frame.method === "session/prompt")!;
    expect(prompt.params).toEqual({ sessionId: "sess-fresh-1", prompt: [{ ...fixture.promptRequest.params.prompt[0], text: continuation }] });
    expect(prompt.params).not.toHaveProperty("content");
    const cancel = transport.sent.find(frame => frame.method === "session/cancel")!;
    expect(cancel).toEqual({ ...fixture.cancelNotification, params: { sessionId: "sess-fresh-1" } });
    const permissionReply = transport.sent.find(frame => frame.id === fixture.permissionRequest.id);
    expect(permissionReply).toEqual(fixture.permissionResponseSelected);
    // No fs/terminal capabilities were advertised to the agent.
    expect(initialize.params).toMatchObject({ clientCapabilities: {} });
  });

  it("passes a strict contract-enforcing peer that rejects content params and deny outcomes", async () => {
    const violations: string[] = [];
    let promptId: number | string | undefined;
    const transport = new ScriptedTransport((frame, t) => {
      const params = frame.params as Record<string, unknown> | undefined;
      const reject = (reason: string): void => { violations.push(`${String(frame.method ?? "response")}: ${reason}`); };
      if (frame.method === "initialize") {
        if (params?.protocolVersion !== fixture.initializeRequest.params.protocolVersion) reject(`initialize must request ACP v${fixture.initializeRequest.params.protocolVersion}`);
        if (params?.clientCapabilities !== undefined && Object.keys(params.clientCapabilities as object).length !== 0) reject("initialize must not advertise client capabilities");
        t.queue(responseFrame(frame, fixture.initializeResponse.result));
      } else if (frame.method === "session/new") {
        if (params?.cwd !== "/workspace/project" || !Array.isArray(params?.mcpServers) || params.mcpServers.length !== 0) reject("session/new must bind the probe cwd and no MCP servers");
        t.queue(responseFrame(frame, { sessionId: "sess-strict-1" }));
      } else if (frame.method === "session/prompt") {
        const inspected = inspectPromptShape(frame.params);
        if (!inspected.ok) {
          reject(inspected.reason);
          t.queue({ jsonrpc: "2.0", id: frame.id as number, error: { code: -32602, message: "invalid session/prompt params" } });
          return;
        }
        if (inspected.text !== continuation) reject("session/prompt must carry the continuation byte-exactly");
        promptId = frame.id;
        t.queue({ ...fixture.permissionRequest, params: { ...fixture.permissionRequest.params, sessionId: "sess-strict-1" } });
      } else if (frame.method === "session/cancel") {
        if ((frame.params as { sessionId?: unknown } | undefined)?.sessionId !== "sess-strict-1") reject("session/cancel must target the fresh session");
        t.queue({ jsonrpc: "2.0", ...(promptId !== undefined ? { id: promptId } : {}), result: { stopReason: "cancelled" } });
      } else if (frame.method === undefined && frame.id !== undefined) {
        const reply = inspectReplyShape(frame.result);
        if (!reply.ok) { reject(reply.reason); return; }
        if (reply.outcome.outcome === "selected" && reply.outcome.optionId !== "reject-once") reject("the probe must select the advertised reject_once option");
      }
    });
    const report = await runAcpCapabilityProbe(transport, { cwd: "/workspace/project", continuation, source: "synthetic" });
    expect(violations).toEqual([]);
    expect(report.gates).toMatchObject({ freshSessionCreated: true, exactContinuationSubmitted: true, permissionDeniedByDefault: true, cancellationTerminalWitnessed: true });
    expect(report.errors).toEqual([]);
  });

  it("does not treat an arbitrary prompt error as a cancellation disposition", async () => {
    const transport = new ScriptedTransport((frame, t) => {
      if (frame.method === "initialize") t.queue(responseFrame(frame, fixture.initializeResponse.result));
      else if (frame.method === "session/new") t.queue(responseFrame(frame, { sessionId: "sess-fresh-3" }));
      else if (frame.method === "session/prompt") t.queue({ jsonrpc: "2.0", id: frame.id as number, error: { code: -32602, message: "params.prompt is required" } });
    });
    const report = await runAcpCapabilityProbe(transport, { cwd: "/workspace/project", continuation: "packet", source: "synthetic" });
    expect(report.gates.cancellationTerminalWitnessed).toBe(false);
    expect(report.gates.exactContinuationSubmitted).toBe(true);
    expect(report.cancellation.terminalStopReason).toBeNull();
    expect(report.errors.join("\n")).toContain("session/prompt failed: params.prompt is required");
  });

  it("stops after an initialize error and never creates a session", async () => {
    const transport = new ScriptedTransport((frame, t) => {
      if (frame.method === "initialize") t.queue({ jsonrpc: "2.0", id: frame.id as number, error: { code: -32000, message: "agent refused initialization" } });
    });
    const report = await runAcpCapabilityProbe(transport, { cwd: "/workspace/project", continuation: "packet", source: "synthetic", timeoutMs: 500 });
    expect(report.gates).toMatchObject({ initializeObserved: false, freshSessionCreated: false, exactContinuationSubmitted: false });
    expect(transport.sent.filter(frame => frame.method === "session/new")).toHaveLength(0);
    expect(transport.sent.filter(frame => frame.method === "session/prompt")).toHaveLength(0);
    expect(report.errors.join("\n")).toContain("initialize failed: agent refused initialization");
  });

  it("rejects initialize responses without a negotiated version or identity", async () => {
    const versionMismatch = new ScriptedTransport((frame, t) => {
      if (frame.method === "initialize") t.queue(responseFrame(frame, { protocolVersion: 2, agentInfo: { name: "kiro-cli", version: "1" } }));
    });
    const mismatch = await runAcpCapabilityProbe(versionMismatch, { cwd: "/workspace/project", continuation: "packet", source: "synthetic", timeoutMs: 500 });
    expect(mismatch.gates.initializeObserved).toBe(false);
    expect(mismatch.errors.join("\n")).toContain("negotiated protocol version 2");
    expect(versionMismatch.sent.filter(frame => frame.method === "session/new")).toHaveLength(0);

    const noIdentity = new ScriptedTransport((frame, t) => {
      if (frame.method === "initialize") t.queue(responseFrame(frame, { protocolVersion: 1 }));
    });
    const identityless = await runAcpCapabilityProbe(noIdentity, { cwd: "/workspace/project", continuation: "packet", source: "synthetic", timeoutMs: 500 });
    expect(identityless.gates.initializeObserved).toBe(false);
    expect(identityless.errors.join("\n")).toContain("agent identity");
    expect(noIdentity.sent.filter(frame => frame.method === "session/new")).toHaveLength(0);
  });

  it("rejects resumed session ids and unsolicited responses", async () => {
    const transport = new ScriptedTransport((frame, t) => {
      if (frame.method === "initialize") t.queue(responseFrame(frame, fixture.initializeResponse.result));
      else if (frame.method === "session/new") t.queue(responseFrame(frame, { sessionId: "sess-known-1" }));
    });
    const resumed = await runAcpCapabilityProbe(transport, { cwd: "/workspace", continuation: "packet", knownSessionIds: ["sess-known-1"], source: "synthetic", timeoutMs: 500 });
    expect(resumed.gates.freshSessionCreated).toBe(false);
    expect(resumed.errors.join("\n")).toContain("previously known session id");
    expect(resumed.submittedContinuation).toBeNull();
    expect(resumed.submission).toBeNull();
    expect(transport.sent.filter(frame => frame.method === "session/prompt")).toHaveLength(0);

    const unsolicited = new ScriptedTransport((frame, t) => {
      if (frame.method === "initialize") t.queue({ jsonrpc: "2.0", id: 777, result: {} });
    });
    const report = await runAcpCapabilityProbe(unsolicited, { cwd: "/workspace", continuation: "packet", source: "synthetic", timeoutMs: 500 });
    expect(report.gates.initializeObserved).toBe(false);
    expect(report.errors.join("\n")).toContain("unsolicited or mismatched response");
  });

  it("keeps submission honest when the prompt write fails and never retries", async () => {
    const transport = new ScriptedTransport((frame, t) => {
      if (frame.method === "initialize") t.queue(responseFrame(frame, fixture.initializeResponse.result));
      else if (frame.method === "session/new") t.queue(responseFrame(frame, { sessionId: "sess-fresh-7" }));
    }, { rejectSend: frame => frame.method === "session/prompt" });
    const report = await runAcpCapabilityProbe(transport, { cwd: "/workspace/project", continuation: "packet", source: "synthetic", timeoutMs: 400 });
    expect(report.gates.exactContinuationSubmitted).toBe(false);
    expect(report.submittedContinuation).toBeNull();
    expect(report.submission).toMatchObject({ state: "write_failed" });
    expect(report.errors.join("\n")).toContain("transport failed sending session/prompt");
    expect(report.errors.join("\n")).toContain("delivery uncertain");
    expect(transport.sent.filter(frame => frame.method === "session/prompt")).toHaveLength(1);
    // The probe still attempts to stop any possibly-started turn and never retries the write.
    expect(transport.sent.filter(frame => frame.method === "session/cancel")).toHaveLength(1);
  });

  it("marks an unsettled prompt write as uncertain instead of submitted", async () => {
    const transport = new ScriptedTransport((frame, t) => {
      if (frame.method === "initialize") t.queue(responseFrame(frame, fixture.initializeResponse.result));
      else if (frame.method === "session/new") t.queue(responseFrame(frame, { sessionId: "sess-fresh-8" }));
    }, { neverSettleSend: frame => frame.method === "session/prompt" });
    const startedAt = Date.now();
    const report = await runAcpCapabilityProbe(transport, { cwd: "/workspace/project", continuation: "packet", source: "synthetic", timeoutMs: 300, cleanupTimeoutMs: 300 });
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(report.gates.exactContinuationSubmitted).toBe(false);
    expect(report.submission).toMatchObject({ state: "write_unsettled" });
    expect(report.submittedContinuation).toBeNull();
    expect(report.errors.join("\n")).toContain("session/prompt write did not settle");
    expect(transport.sent.filter(frame => frame.method === "session/prompt")).toHaveLength(1);
  });

  it("requires a settled cancellation write before witnessing cancellation", async () => {
    const transport = new ScriptedTransport((frame, t) => {
      if (frame.method === "initialize") t.queue(responseFrame(frame, fixture.initializeResponse.result));
      else if (frame.method === "session/new") t.queue(responseFrame(frame, { sessionId: "sess-fresh-9" }));
      else if (frame.method === "session/prompt") t.queue(responseFrame(frame, { stopReason: "cancelled" }));
    }, { rejectSend: frame => frame.method === "session/cancel" });
    const report = await runAcpCapabilityProbe(transport, { cwd: "/workspace/project", continuation: "packet", source: "synthetic", timeoutMs: 400 });
    expect(report.gates.cancellationTerminalWitnessed).toBe(false);
    expect(report.cancellation).toEqual({ requested: true, writeSettled: false, terminalStopReason: "cancelled" });
    expect(report.errors.join("\n")).toContain("transport failed sending session/cancel");
    expect(report.errors.join("\n")).toContain("without a settled cancellation request");
  });

  it("reports the race when the turn ends before cancellation is witnessed", async () => {
    const transport = new ScriptedTransport((frame, t) => {
      if (frame.method === "initialize") t.queue(responseFrame(frame, fixture.initializeResponse.result));
      else if (frame.method === "session/new") t.queue(responseFrame(frame, { sessionId: "sess-fresh-10" }));
      else if (frame.method === "session/prompt") t.queue(responseFrame(frame, { stopReason: "end_turn" }));
    });
    const report = await runAcpCapabilityProbe(transport, { cwd: "/workspace/project", continuation: "packet", source: "synthetic" });
    expect(report.gates.cancellationTerminalWitnessed).toBe(false);
    expect(report.cancellation.terminalStopReason).toBe("end_turn");
    expect(report.errors.join("\n")).toContain('stop reason "end_turn"');
  });

  it("bounds a fully uncooperative transport without unhandled rejections", async () => {
    const transport = new ScriptedTransport(() => {}, { neverSettleNext: true, neverSettleClose: true, neverSettleSend: () => true });
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { rejections.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    let report: Awaited<ReturnType<typeof runAcpCapabilityProbe>>;
    const startedAt = Date.now();
    try {
      report = await runAcpCapabilityProbe(transport, { cwd: "/workspace/project", continuation: "packet", source: "synthetic", timeoutMs: 250, cleanupTimeoutMs: 250 });
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors.join("\n")).toContain("initialize write did not settle");
    expect(report.cleanup.state).toBe("unconfirmed");
    expect(report.submission).toBeNull();
    expect(transport.sent.filter(frame => frame.method === "session/prompt")).toHaveLength(0);
    expect(rejections).toEqual([]);
  });

  it("bounds a transport whose reads never settle", async () => {
    const transport = new ScriptedTransport(() => {}, { neverSettleNext: true });
    const startedAt = Date.now();
    const report = await runAcpCapabilityProbe(transport, { cwd: "/workspace/project", continuation: "packet", source: "synthetic", timeoutMs: 300, cleanupTimeoutMs: 300 });
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(report.gates.initializeObserved).toBe(false);
    expect(report.errors.join("\n")).toContain("probe timed out waiting for a response to initialize");
  });

  it("reports unconfirmed cleanup when close never settles", async () => {
    const transport = new ScriptedTransport(conformingPeer("sess-fresh-12"), { neverSettleClose: true });
    const startedAt = Date.now();
    const report = await runAcpCapabilityProbe(transport, { cwd: "/workspace/project", continuation: "packet", source: "synthetic", timeoutMs: 500, cleanupTimeoutMs: 200 });
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(report.gates.cancellationTerminalWitnessed).toBe(true);
    expect(report.cleanup.state).toBe("unconfirmed");
    expect(report.cleanup.detail).toContain("close did not settle");
  });

  it("seals when the transport closes before the probe completes", async () => {
    const transport = new ScriptedTransport((frame, t) => {
      if (frame.method === "initialize") { t.queue(responseFrame(frame, fixture.initializeResponse.result)); t.close(); }
    });
    const report = await runAcpCapabilityProbe(transport, { cwd: "/workspace/project", continuation: "packet", source: "synthetic", timeoutMs: 500 });
    expect(report.gates.initializeObserved).toBe(true);
    expect(report.gates.freshSessionCreated).toBe(false);
    expect(report.errors.join("\n")).toContain("transport closed before the probe completed");
    expect(report.cleanup.state).toBe("complete");
  });

  it("never grants permission: selects reject_once, answers cancelled otherwise", async () => {
    const permissionFlow = (options: unknown[]): ((frame: AcpProbeFrame, t: ScriptedTransport) => void) => {
      let promptId: number | string | undefined;
      return (frame, t) => {
        if (frame.method === "initialize") t.queue(responseFrame(frame, fixture.initializeResponse.result));
        else if (frame.method === "session/new") t.queue(responseFrame(frame, { sessionId: "sess-perm-1" }));
        else if (frame.method === "session/prompt") {
          promptId = frame.id;
          t.queue({ ...fixture.permissionRequest, params: { ...fixture.permissionRequest.params, sessionId: "sess-perm-1", options } });
        } else if (frame.method === "session/cancel") {
          t.queue({ jsonrpc: "2.0", ...(promptId !== undefined ? { id: promptId } : {}), result: { stopReason: "cancelled" } });
        }
      };
    };

    const both = new ScriptedTransport(permissionFlow(fixture.permissionRequest.params.options));
    const report = await runAcpCapabilityProbe(both, { cwd: "/workspace/project", continuation: "packet", source: "synthetic" });
    expect(report.gates.permissionDeniedByDefault).toBe(true);
    expect(both.sent.find(frame => frame.id === fixture.permissionRequest.id)).toEqual(fixture.permissionResponseSelected);

    const allowOnly = new ScriptedTransport(permissionFlow(fixture.permissionRequest.params.options.slice(0, 1)));
    const allowReport = await runAcpCapabilityProbe(allowOnly, { cwd: "/workspace/project", continuation: "packet", source: "synthetic" });
    expect(allowReport.gates.permissionDeniedByDefault).toBe(false);
    expect(allowOnly.sent.find(frame => frame.id === fixture.permissionRequest.id)).toEqual(fixture.permissionResponseCancelled);
    expect(allowReport.errors.join("\n")).toContain("no reject_once option");

    let wrongSessionPromptId: number | string | undefined;
    const wrongSession = new ScriptedTransport((frame, t) => {
      if (frame.method === "initialize") t.queue(responseFrame(frame, fixture.initializeResponse.result));
      else if (frame.method === "session/new") t.queue(responseFrame(frame, { sessionId: "sess-perm-3" }));
      else if (frame.method === "session/prompt") {
        wrongSessionPromptId = frame.id;
        t.queue({ ...fixture.permissionRequest, id: 901, params: { ...fixture.permissionRequest.params, sessionId: "sess-someone-else" } });
      } else if (frame.method === "session/cancel") {
        t.queue({ jsonrpc: "2.0", ...(wrongSessionPromptId !== undefined ? { id: wrongSessionPromptId } : {}), result: { stopReason: "cancelled" } });
      }
    });
    const wrongReport = await runAcpCapabilityProbe(wrongSession, { cwd: "/workspace/project", continuation: "packet", source: "synthetic" });
    expect(wrongReport.gates.permissionDeniedByDefault).toBe(false);
    expect(wrongSession.sent.find(frame => frame.id === 901)).toBeUndefined();
    expect(wrongReport.errors.join("\n")).toContain("different session");
  });

  it("answers permission requests arriving after cancellation with the cancelled outcome", async () => {
    let promptId: number | string | undefined;
    const transport = new ScriptedTransport((frame, t) => {
      if (frame.method === "initialize") t.queue(responseFrame(frame, fixture.initializeResponse.result));
      else if (frame.method === "session/new") t.queue(responseFrame(frame, { sessionId: "sess-perm-4" }));
      else if (frame.method === "session/prompt") promptId = frame.id;
      else if (frame.method === "session/cancel") {
        t.queue({ ...fixture.permissionRequest, params: { ...fixture.permissionRequest.params, sessionId: "sess-perm-4" } });
        t.queue({ jsonrpc: "2.0", ...(promptId !== undefined ? { id: promptId } : {}), result: { stopReason: "cancelled" } });
      }
    });
    const report = await runAcpCapabilityProbe(transport, { cwd: "/workspace/project", continuation: "packet", source: "synthetic" });
    expect(report.gates.permissionDeniedByDefault).toBe(false);
    expect(transport.sent.find(frame => frame.id === fixture.permissionRequest.id)).toEqual(fixture.permissionResponseCancelled);
    expect(report.gates.cancellationTerminalWitnessed).toBe(true);
  });

  it("validates probe options before touching the transport", async () => {
    const cases: Array<[{ [key: string]: unknown }, string]> = [
      [{ timeoutMs: 0 }, "timeoutMs"],
      [{ timeoutMs: -5 }, "timeoutMs"],
      [{ timeoutMs: 12.5 }, "timeoutMs"],
      [{ timeoutMs: 120_001 }, "timeoutMs"],
      [{ cleanupTimeoutMs: 0 }, "cleanupTimeoutMs"],
      [{ cleanupTimeoutMs: 5_001 }, "cleanupTimeoutMs"],
      [{ maxFrames: 0 }, "maxFrames"],
      [{ maxFrames: 4_097 }, "maxFrames"],
      [{ source: "guess" }, "source"],
      [{ knownSessionIds: [1] }, "knownSessionIds"],
    ];
    for (const [overrides, marker] of cases) {
      const transport = new ScriptedTransport(() => {});
      const report = await runAcpCapabilityProbe(transport, { cwd: "/workspace/project", continuation: "packet", source: "synthetic", ...overrides } as AcpCapabilityProbeOptions);
      expect(report.errors, marker).toHaveLength(1);
      expect(report.errors[0], marker).toContain(marker);
      expect(report.gates.initializeObserved).toBe(false);
      expect(transport.sent).toHaveLength(0);
      expect(transport.closeCalls).toBe(1);
      expect(report.cleanup.state).toBe("complete");
    }
    const emptyCwd = new ScriptedTransport(() => {});
    const cwdReport = await runAcpCapabilityProbe(emptyCwd, { cwd: "", continuation: "packet", source: "synthetic" });
    expect(cwdReport.errors[0]).toContain("cwd");
    const emptyContinuation = new ScriptedTransport(() => {});
    const continuationReport = await runAcpCapabilityProbe(emptyContinuation, { cwd: "/workspace/project", continuation: "", source: "synthetic" });
    expect(continuationReport.errors[0]).toContain("continuation text");
    const oversized = new ScriptedTransport(() => {});
    const oversizedReport = await runAcpCapabilityProbe(oversized, { cwd: "/workspace/project", continuation: "x".repeat(65_537), source: "synthetic" });
    expect(oversizedReport.errors[0]).toContain("65,536");
    expect(oversizedReport.errors[0]).toContain("exceeds");
  });

  it("seals on malformed frames, oversized frames and exhausted budgets", async () => {
    const malformed = new ScriptedTransport((frame, t) => {
      if (frame.method === "initialize") t.queue({ jsonrpc: "1.0", id: frame.id as number, result: {} } as unknown as AcpProbeFrame);
    });
    const versionReport = await runAcpCapabilityProbe(malformed, { cwd: "/workspace/project", continuation: "packet", source: "synthetic", timeoutMs: 500 });
    expect(versionReport.gates.initializeObserved).toBe(false);
    expect(versionReport.errors.join("\n")).toContain("jsonrpc 2.0");

    const bothPresent = new ScriptedTransport((frame, t) => {
      if (frame.method === "initialize") t.queue({ jsonrpc: "2.0", id: frame.id as number, result: {}, error: { code: 1, message: "both" } });
    });
    const bothReport = await runAcpCapabilityProbe(bothPresent, { cwd: "/workspace/project", continuation: "packet", source: "synthetic", timeoutMs: 500 });
    expect(bothReport.errors.join("\n")).toContain("exactly one of result or error");

    const badError = new ScriptedTransport((frame, t) => {
      if (frame.method === "initialize") t.queue({ jsonrpc: "2.0", id: frame.id as number, error: { code: 1 } as { code: number; message: string } });
    });
    const badErrorReport = await runAcpCapabilityProbe(badError, { cwd: "/workspace/project", continuation: "packet", source: "synthetic", timeoutMs: 500 });
    expect(badErrorReport.errors.join("\n")).toContain("malformed error object");

    const oversized = new ScriptedTransport((frame, t) => {
      if (frame.method === "initialize") t.queue(responseFrame(frame, { padding: "x".repeat(300_000) }));
    });
    const oversizedReport = await runAcpCapabilityProbe(oversized, { cwd: "/workspace/project", continuation: "packet", source: "synthetic", timeoutMs: 500 });
    expect(oversizedReport.gates.initializeObserved).toBe(false);
    expect(oversizedReport.errors.join("\n")).toContain("serialized bytes");

    const budgeted = new ScriptedTransport((frame, t) => {
      if (frame.method === "initialize") t.queue(responseFrame(frame, fixture.initializeResponse.result));
    });
    const budgetReport = await runAcpCapabilityProbe(budgeted, { cwd: "/workspace/project", continuation: "packet", source: "synthetic", timeoutMs: 500, maxFrames: 1 });
    expect(budgetReport.gates.initializeObserved).toBe(true);
    expect(budgetReport.gates.freshSessionCreated).toBe(false);
    expect(budgetReport.errors.join("\n")).toContain("probe frame budget exhausted");
    expect(budgeted.sent.filter(frame => frame.method === "session/new")).toHaveLength(0);
  });
});

describe("ACP probe process liveness", () => {
  it.skipIf(!portable)("returns bounded in a real process with no unhandled rejections", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-acp-liveness-"));
    roots.push(base);
    const entry = path.join(base, "entry.ts");
    const outfile = path.join(base, "bundle.mjs");
    const probeModule = path.resolve("src/kiro/acp-capability-probe.js");
    fs.writeFileSync(entry, `import { runAcpCapabilityProbe } from ${JSON.stringify(probeModule)};
import type { AcpProbeFrame, AcpProbeTransport } from ${JSON.stringify(probeModule)};
class NeverSettlingTransport implements AcpProbeTransport {
  async send(): Promise<void> { return await new Promise<void>(() => {}); }
  async next(): Promise<AcpProbeFrame | null> { return await new Promise<AcpProbeFrame | null>(() => {}); }
  async close(): Promise<void> {}
}
const rejections: unknown[] = [];
process.on("unhandledRejection", (reason: unknown) => { rejections.push(reason); });
const startedAt = Date.now();
const report = await runAcpCapabilityProbe(new NeverSettlingTransport(), { cwd: "/workspace/project", continuation: "packet", source: "synthetic", timeoutMs: 400, cleanupTimeoutMs: 200 });
process.stdout.write(JSON.stringify({ elapsedMs: Date.now() - startedAt, errors: report.errors, cleanup: report.cleanup, submission: report.submission, rejections: rejections.length }));
`);
    await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", target: "node20", outfile });
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [outfile], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("liveness child timed out")); }, 30_000);
      child.stdout.on("data", chunk => { stdout += chunk; });
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("error", error => { clearTimeout(timer); reject(error); });
      child.on("close", code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const data = JSON.parse(result.stdout) as { elapsedMs: number; errors: string[]; cleanup: { state: string }; submission: unknown; rejections: number };
    expect(data.rejections).toBe(0);
    expect(data.elapsedMs).toBeGreaterThanOrEqual(350);
    expect(data.elapsedMs).toBeLessThan(3_000);
    expect(data.errors.join("\n")).toContain("initialize write did not settle");
    expect(data.cleanup.state).toBe("complete");
    expect(data.submission).toBeNull();
  });
});

describe("continuity ACP preflight script", () => {
  const writeFakeCli = (settingsConfigured: boolean): string => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-acp-preflight-")));
    roots.push(base);
    const cli = path.join(base, "fake-kiro-cli");
    fs.writeFileSync(cli, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("kiro-cli 2.22.1"); process.exit(0); }
if (args[0] === "acp" && args.includes("--help")) {
  console.log("      --agent-engine <ENGINE>");
  console.log('          Agent engine to use: v1, v2 (default), or v3');
  console.log("          [possible values: v2, v1, v3]");
  process.exit(0);
}
if (args[0] === "settings" && args.includes("chat.disableAutoCompaction")) {
  ${settingsConfigured ? 'console.log("true"); process.exit(0);' : 'console.error("error: No value associated with chat.disableAutoCompaction"); process.exit(1);'}
}
console.error("unexpected invocation: " + JSON.stringify(args));
process.exit(3);
`);
    fs.chmodSync(cli, 0o755);
    return cli;
  };

  const runScript = (args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.resolve("scripts/continuity-acp-probe.mjs"), ...args], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("preflight script timed out")); }, 30_000);
      child.stdout.on("data", chunk => { stdout += chunk; });
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("error", error => { clearTimeout(timer); reject(error); });
      child.on("close", code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    });

  it.skipIf(!portable)("reports read-only preflight evidence and pending live gates", async () => {
    const result = await runScript(["--kiro-cli", writeFakeCli(false)]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout) as { qualified: boolean; managedRotationAvailable: boolean;
      preflight: { kiroVersion: string; acpEngineSelector: { discovered: boolean; v3Listed: boolean };
        autoCompactionSetting: { configured: boolean; value?: string } } };
    expect(report.qualified).toBe(false);
    expect(report.managedRotationAvailable).toBe(false);
    expect(report.preflight).toMatchObject({
      kiroVersion: "kiro-cli 2.22.1",
      acpEngineSelector: { discovered: true, v3Listed: true },
      autoCompactionSetting: { configured: false },
    });
    const configured = await runScript(["--kiro-cli", writeFakeCli(true)]);
    expect(JSON.parse(configured.stdout).preflight).toMatchObject({ autoCompactionSetting: { configured: true, value: "true" } });
  });

  it("prints usage for --help without launching kiro-cli", async () => {
    const result = await runScript(["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Read-only preflight");
  });

  it("rejects unknown flags before any subprocess runs", async () => {
    const result = await runScript(["--bogus"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("unknown argument");
    expect(result.stdout).toBe("");
  });
});
