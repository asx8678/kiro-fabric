/** ACP v1 wire-contract subset used by the ACP capability probe.
 *
 * Every helper here is pure: values are inspected and builders return plain
 * frames, so tests and a future live transport adapter can validate the wire
 * contract independently of the probe's lifecycle. The normative examples
 * are transcribed in tests/fixtures/acp-v1-wire.json (see its `sources`
 * field); that fixture and this module must only change together, against a
 * fresh read of the published ACP v1 documentation.
 *
 * Verified against https://agentclientprotocol.com/protocol/v1
 * (initialization, session-setup, prompt-turn, tool-calls and cancellation
 * pages) on 2026-09-21.
 *
 * Remaining obligation for a future live adapter: the byte caps here bound
 * *accepted evidence* on already-parsed frames. A live transport must enforce
 * its raw byte cap on the wire *before* JSON parsing; this module cannot do
 * that for it. */

export const ACP_PROTOCOL_VERSION = 1;

/** Serialized byte cap for one accepted incoming frame (post-parse bound). */
export const ACP_PROBE_MAX_FRAME_BYTES = 256 * 1024;
/** Serialized byte cap for all accepted incoming frames in one probe run. */
export const ACP_PROBE_MAX_TOTAL_FRAME_BYTES = 4 * 1024 * 1024;
/** UTF-8 byte cap for the continuation packet submitted by the probe. */
export const ACP_PROBE_MAX_CONTINUATION_BYTES = 64 * 1024;
/** Byte cap for a session id returned by session/new. */
const ACP_PROBE_MAX_SESSION_ID_BYTES = 512;
/** Entry cap for the caller-supplied known session id list. */
export const ACP_PROBE_MAX_KNOWN_SESSION_IDS = 4096;

export const ACP_PROBE_MIN_OPERATION_TIMEOUT_MS = 1;
export const ACP_PROBE_MAX_OPERATION_TIMEOUT_MS = 120_000;
export const ACP_PROBE_DEFAULT_OPERATION_TIMEOUT_MS = 10_000;
export const ACP_PROBE_MIN_CLEANUP_TIMEOUT_MS = 1;
export const ACP_PROBE_MAX_CLEANUP_TIMEOUT_MS = 5_000;
export const ACP_PROBE_DEFAULT_CLEANUP_TIMEOUT_MS = 1_000;
export const ACP_PROBE_MIN_FRAMES = 1;
export const ACP_PROBE_MAX_FRAMES = 4_096;
export const ACP_PROBE_DEFAULT_FRAMES = 512;

export interface AcpProbeFrame {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

interface AcpContractFailure {
  ok: false;
  reason: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isRequestId = (value: unknown): boolean =>
  (typeof value === "string" && value !== "") || (typeof value === "number" && Number.isSafeInteger(value));

export type AcpIncomingFrameInspection =
  | { ok: true; kind: "response"; id: number | string; frame: AcpProbeFrame }
  | { ok: true; kind: "request"; frame: AcpProbeFrame }
  | { ok: true; kind: "notification"; frame: AcpProbeFrame }
  | AcpContractFailure;

/** Classify one already-parsed incoming JSON-RPC frame. A response must carry
 * exactly one of result or error; requests must not carry a response payload. */
export function inspectIncomingFrame(frame: unknown): AcpIncomingFrameInspection {
  if (!isRecord(frame)) return { ok: false, reason: "a frame that is not a JSON object" };
  if (frame.jsonrpc !== "2.0") return { ok: false, reason: "a frame without jsonrpc 2.0" };
  const hasMethod = frame.method !== undefined;
  const hasResult = frame.result !== undefined;
  const hasError = frame.error !== undefined;
  if (hasMethod) {
    if (typeof frame.method !== "string" || frame.method === "") return { ok: false, reason: "a frame with a non-string method" };
    if (hasResult || hasError) return { ok: false, reason: "a frame carrying both a request method and a response payload" };
    if (frame.id === undefined) return { ok: true, kind: "notification", frame: frame as unknown as AcpProbeFrame };
    if (!isRequestId(frame.id)) return { ok: false, reason: "a request with an invalid id" };
    return { ok: true, kind: "request", frame: frame as unknown as AcpProbeFrame };
  }
  if (!isRequestId(frame.id)) return { ok: false, reason: "a response without a valid request id" };
  if (hasResult === hasError) return { ok: false, reason: "a response without exactly one of result or error" };
  if (hasError) {
    if (!isRecord(frame.error)) return { ok: false, reason: "a response with a malformed error object" };
    if (typeof frame.error.code !== "number" || !Number.isSafeInteger(frame.error.code) || typeof frame.error.message !== "string") {
      return { ok: false, reason: "a response with a malformed error object" };
    }
  }
  return { ok: true, kind: "response", id: frame.id as number | string, frame: frame as unknown as AcpProbeFrame };
}

/** Serialized size of an accepted frame. Returns null when the value cannot
 * be serialized (for example a cyclic object handed over by a transport). */
export function measureFrameBytes(frame: AcpProbeFrame): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(frame), "utf8");
  } catch {
    return null;
  }
}

export type AcpInitializeInspection = { ok: true; agentInfo: { name: string; version: string } } | AcpContractFailure;

/** The initialize response must negotiate the protocol version this probe
 * speaks and carry an observed agent identity. A mismatched version means
 * the connection should be closed, not used. */
export function inspectInitializeResult(result: unknown): AcpInitializeInspection {
  if (!isRecord(result)) return { ok: false, reason: "initialize response did not carry a result object" };
  if (result.protocolVersion !== ACP_PROTOCOL_VERSION) {
    if (typeof result.protocolVersion === "number" && Number.isSafeInteger(result.protocolVersion)) {
      return { ok: false, reason: `initialize response negotiated protocol version ${result.protocolVersion}, but this probe only speaks ACP v${ACP_PROTOCOL_VERSION}` };
    }
    return { ok: false, reason: "initialize response did not negotiate a protocol version" };
  }
  const agentInfo = result.agentInfo;
  if (!isRecord(agentInfo) || typeof agentInfo.name !== "string" || agentInfo.name === "" || typeof agentInfo.version !== "string" || agentInfo.version === "") {
    return { ok: false, reason: "initialize response did not carry an observed agent identity (agentInfo name and version)" };
  }
  return { ok: true, agentInfo: { name: agentInfo.name, version: agentInfo.version } };
}

export type AcpSessionIdInspection = { ok: true; sessionId: string } | AcpContractFailure;

export function inspectSessionIdResult(result: unknown): AcpSessionIdInspection {
  if (!isRecord(result)) return { ok: false, reason: "session/new did not return a result object with a session id" };
  if (typeof result.sessionId !== "string" || result.sessionId === "") return { ok: false, reason: "session/new did not return a session id" };
  if (Buffer.byteLength(result.sessionId, "utf8") > ACP_PROBE_MAX_SESSION_ID_BYTES) {
    return { ok: false, reason: `session/new returned a session id longer than ${ACP_PROBE_MAX_SESSION_ID_BYTES} bytes` };
  }
  return { ok: true, sessionId: result.sessionId };
}

export type AcpPromptRequestInspection = { ok: true; sessionId: string; text: string } | AcpContractFailure;

/** ACP v1 sends user content in a `prompt` array of content blocks. There is
 * no `content` field; that historical shape is rejected here. The probe emits
 * exactly one text block, so the first block's text is returned. */
export function inspectPromptRequestParams(params: unknown): AcpPromptRequestInspection {
  if (!isRecord(params)) return { ok: false, reason: "session/prompt params must carry the target sessionId and a `prompt` array of content blocks" };
  if (typeof params.sessionId !== "string" || params.sessionId === "") return { ok: false, reason: "session/prompt params must carry the target sessionId" };
  if (!Array.isArray(params.prompt) || params.prompt.length === 0) {
    return { ok: false, reason: "session/prompt params must carry a `prompt` array of content blocks (ACP v1 has no `content` field)" };
  }
  for (const block of params.prompt) {
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string" || block.text === "") {
      return { ok: false, reason: "session/prompt prompt blocks must be { type: \"text\", text } content blocks" };
    }
  }
  const first = (params.prompt as Array<{ type: "text"; text: string }>)[0];
  if (first === undefined) return { ok: false, reason: "session/prompt prompt blocks must be { type: \"text\", text } content blocks" };
  return { ok: true, sessionId: params.sessionId, text: first.text };
}

export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

interface AcpPermissionRequestInfo {
  sessionId: string;
  toolCallId: string;
  options: AcpPermissionOption[];
}

export type AcpPermissionRequestInspection = { ok: true; request: AcpPermissionRequestInfo } | AcpContractFailure;

/** Validate a session/request_permission request against the active probe
 * session. Requests for any other session are rejected so the probe never
 * answers — and therefore never authorizes — work outside its own session. */
export function inspectPermissionRequest(params: unknown, activeSessionId: string | null): AcpPermissionRequestInspection {
  if (!isRecord(params)) return { ok: false, reason: "a permission request without a params object" };
  if (typeof params.sessionId !== "string" || params.sessionId === "") return { ok: false, reason: "a permission request without a target sessionId" };
  if (activeSessionId === null) return { ok: false, reason: "a permission request before the probe created a session" };
  if (params.sessionId !== activeSessionId) return { ok: false, reason: "a permission request for a different session" };
  const toolCall = params.toolCall;
  if (!isRecord(toolCall) || typeof toolCall.toolCallId !== "string" || toolCall.toolCallId === "") {
    return { ok: false, reason: "a permission request without a usable toolCall" };
  }
  if (!Array.isArray(params.options) || params.options.length === 0) {
    return { ok: false, reason: "a permission request without a usable options array" };
  }
  const options: AcpPermissionOption[] = [];
  for (const option of params.options) {
    if (!isRecord(option) || typeof option.optionId !== "string" || option.optionId === "" || typeof option.kind !== "string" || option.kind === "" || typeof option.name !== "string") {
      return { ok: false, reason: "a permission option without a usable optionId or kind" };
    }
    options.push({ optionId: option.optionId, name: option.name as string, kind: option.kind });
  }
  return { ok: true, request: { sessionId: params.sessionId, toolCallId: toolCall.toolCallId, options } };
}

/** Select the advertised `reject_once` option, or null when the peer offers
 * none. The probe never selects an allow option and never selects
 * `reject_always`, because that persists a remembered choice. */
export function selectRejectOptionId(options: readonly AcpPermissionOption[]): string | null {
  for (const option of options) {
    if (option.kind === "reject_once") return option.optionId;
  }
  return null;
}

type AcpPermissionOutcome = { outcome: "selected"; optionId: string } | { outcome: "cancelled" };
export type AcpPermissionReplyInspection = { ok: true; outcome: AcpPermissionOutcome } | AcpContractFailure;

/** ACP v1 permission replies use `selected` (with the optionId of an
 * advertised option) or `cancelled`. There is no `deny` outcome. */
export function inspectPermissionReply(result: unknown): AcpPermissionReplyInspection {
  if (!isRecord(result)) return { ok: false, reason: "a permission reply without a result object" };
  const outcome = result.outcome;
  if (!isRecord(outcome)) return { ok: false, reason: "a permission reply without an outcome object" };
  if (outcome.outcome === "cancelled") return { ok: true, outcome: { outcome: "cancelled" } };
  if (outcome.outcome === "selected") {
    if (typeof outcome.optionId !== "string" || outcome.optionId === "") {
      return { ok: false, reason: "a selected permission reply without an optionId" };
    }
    return { ok: true, outcome: { outcome: "selected", optionId: outcome.optionId } };
  }
  return { ok: false, reason: "a permission reply with an outcome other than selected or cancelled (ACP v1 has no \"deny\" outcome)" };
}

export type AcpStopReason = "end_turn" | "refusal" | "cancelled";
const ACP_STOP_REASONS: readonly AcpStopReason[] = ["end_turn", "refusal", "cancelled"];

export function inspectStopReason(value: unknown): AcpStopReason | null {
  return ACP_STOP_REASONS.includes(value as AcpStopReason) ? (value as AcpStopReason) : null;
}

/** The probe advertises no client capabilities: it must never enable fs or
 * terminal access on the agent side. */
export const buildInitializeParams = (): Record<string, unknown> => ({
  protocolVersion: ACP_PROTOCOL_VERSION,
  clientCapabilities: {},
  clientInfo: { name: "kiro-fabric-acp-capability-probe", version: "0" },
});

export const buildSessionNewParams = (cwd: string): Record<string, unknown> => ({ cwd, mcpServers: [] });

export const buildPromptRequestParams = (sessionId: string, continuation: string): Record<string, unknown> => ({
  sessionId,
  prompt: [{ type: "text", text: continuation }],
});

export const buildCancelNotificationParams = (sessionId: string): Record<string, unknown> => ({ sessionId });

export const buildPermissionSelectedReply = (id: number | string, optionId: string): AcpProbeFrame => ({
  jsonrpc: "2.0",
  id,
  result: { outcome: { outcome: "selected", optionId } },
});

export const buildPermissionCancelledReply = (id: number | string): AcpProbeFrame => ({
  jsonrpc: "2.0",
  id,
  result: { outcome: { outcome: "cancelled" } },
});
