import { createHash } from "node:crypto";
import {
  ACP_PROBE_DEFAULT_CLEANUP_TIMEOUT_MS,
  ACP_PROBE_DEFAULT_FRAMES,
  ACP_PROBE_DEFAULT_OPERATION_TIMEOUT_MS,
  ACP_PROBE_MAX_CLEANUP_TIMEOUT_MS,
  ACP_PROBE_MAX_CONTINUATION_BYTES,
  ACP_PROBE_MAX_FRAME_BYTES,
  ACP_PROBE_MAX_FRAMES,
  ACP_PROBE_MAX_KNOWN_SESSION_IDS,
  ACP_PROBE_MAX_OPERATION_TIMEOUT_MS,
  ACP_PROBE_MAX_TOTAL_FRAME_BYTES,
  ACP_PROBE_MIN_CLEANUP_TIMEOUT_MS,
  ACP_PROBE_MIN_FRAMES,
  ACP_PROBE_MIN_OPERATION_TIMEOUT_MS,
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
  type AcpProbeFrame,
} from "./acp-probe-contract.js";

export type { AcpProbeFrame } from "./acp-probe-contract.js";

export interface AcpProbeTransport {
  /** Hand one JSON-RPC frame to the wire. The optional signal notifies a
   * cooperative transport that the probe's operation phase ended; a
   * non-cooperative transport may ignore it, in which case the pending call
   * is abandoned by the probe, never terminated from outside. A transport
   * that owns a real child process remains responsible for terminating only
   * that child when graceful close fails; this probe never kills anything. */
  send(frame: AcpProbeFrame, signal?: AbortSignal): Promise<void>;
  /** Next incoming frame, or null on orderly EOF. Rejects on transport failure. */
  next(signal?: AbortSignal): Promise<AcpProbeFrame | null>;
  /** Orderly shutdown. The probe always calls this during a separate bounded
   * cleanup phase with a fresh, non-aborted signal. */
  close(signal?: AbortSignal): Promise<void>;
}

export interface AcpCapabilityProbeOptions {
  cwd: string;
  /** Continuation text that must be submitted byte-exactly. */
  continuation: string;
  /** Engine the caller intends to select. Recorded as a request only; it is never observed evidence. */
  requestedEngine?: string;
  /** Physical session ids seen earlier; a fresh session must differ from all of them. */
  knownSessionIds?: readonly string[];
  source: "synthetic" | "live";
  /** Operation budget for initialize, session/new, prompt, permission replies,
   * cancellation and reads: a safe integer between 1 and 120000 ms (default 10000). */
  timeoutMs?: number;
  /** Separate cleanup budget for close and reader settlement: a safe integer
   * between 1 and 5000 ms (default 1000). */
  cleanupTimeoutMs?: number;
  /** Accepted incoming frame budget: a safe integer between 1 and 4096 (default 512). */
  maxFrames?: number;
}

export interface AcpCapabilityGates {
  initializeObserved: boolean;
  requestedEngineExplicit: boolean;
  freshSessionCreated: boolean;
  exactContinuationSubmitted: boolean;
  permissionDeniedByDefault: boolean;
  cancellationTerminalWitnessed: boolean;
  nativeAutoCompactionSuppression: "unknown";
}

/** What actually happened to the single session/prompt write the probe attempts. */
export type AcpSubmissionState = "write_failed" | "write_unsettled" | "written";

export interface AcpSubmissionEvidence {
  /** Intended continuation bytes; recorded even when the write failed or never settled. */
  bytes: number;
  sha256: string;
  state: AcpSubmissionState;
}

export type AcpCleanupState = "pending" | "complete" | "unconfirmed" | "failed";

export interface AcpCapabilityReport {
  source: "synthetic" | "live";
  qualified: false;
  managedRotationAvailable: false;
  gates: AcpCapabilityGates;
  sessionId: string | null;
  /** Successful-write evidence only: null unless the session/prompt write settled. */
  submittedContinuation: { bytes: number; sha256: string } | null;
  /** Structured submission state, including failed and never-settled attempts. */
  submission: AcpSubmissionEvidence | null;
  cancellation: { requested: boolean; writeSettled: boolean; terminalStopReason: string | null };
  cleanup: { state: AcpCleanupState; detail: string | null };
  errors: string[];
}

const boundedInteger = (value: number, min: number, max: number): boolean =>
  Number.isSafeInteger(value) && value >= min && value <= max;

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

const inspectProbeOptions = (options: AcpCapabilityProbeOptions): string | null => {
  if (typeof options?.cwd !== "string" || options.cwd === "") return "probe requires a workspace cwd";
  if (typeof options.continuation !== "string" || options.continuation === "") return "probe requires continuation text";
  if (Buffer.byteLength(options.continuation, "utf8") > ACP_PROBE_MAX_CONTINUATION_BYTES) {
    return `continuation exceeds ${ACP_PROBE_MAX_CONTINUATION_BYTES.toLocaleString("en-US")} UTF-8 bytes`;
  }
  if (options.source !== "synthetic" && options.source !== "live") return "probe source must be synthetic or live";
  if (!boundedInteger(options.timeoutMs ?? ACP_PROBE_DEFAULT_OPERATION_TIMEOUT_MS, ACP_PROBE_MIN_OPERATION_TIMEOUT_MS, ACP_PROBE_MAX_OPERATION_TIMEOUT_MS)) {
    return `timeoutMs must be a safe integer between ${ACP_PROBE_MIN_OPERATION_TIMEOUT_MS} and ${ACP_PROBE_MAX_OPERATION_TIMEOUT_MS}`;
  }
  if (!boundedInteger(options.cleanupTimeoutMs ?? ACP_PROBE_DEFAULT_CLEANUP_TIMEOUT_MS, ACP_PROBE_MIN_CLEANUP_TIMEOUT_MS, ACP_PROBE_MAX_CLEANUP_TIMEOUT_MS)) {
    return `cleanupTimeoutMs must be a safe integer between ${ACP_PROBE_MIN_CLEANUP_TIMEOUT_MS} and ${ACP_PROBE_MAX_CLEANUP_TIMEOUT_MS}`;
  }
  if (!boundedInteger(options.maxFrames ?? ACP_PROBE_DEFAULT_FRAMES, ACP_PROBE_MIN_FRAMES, ACP_PROBE_MAX_FRAMES)) {
    return `maxFrames must be a safe integer between ${ACP_PROBE_MIN_FRAMES} and ${ACP_PROBE_MAX_FRAMES}`;
  }
  if (options.requestedEngine !== undefined && typeof options.requestedEngine !== "string") return "requestedEngine must be a string when provided";
  if (options.knownSessionIds !== undefined) {
    if (!Array.isArray(options.knownSessionIds) || options.knownSessionIds.length > ACP_PROBE_MAX_KNOWN_SESSION_IDS) {
      return `knownSessionIds must be an array of at most ${ACP_PROBE_MAX_KNOWN_SESSION_IDS} strings`;
    }
    if (options.knownSessionIds.some(id => typeof id !== "string" || id === "")) return "knownSessionIds entries must be non-empty strings";
  }
  return null;
};

type Settled<T> = { status: "fulfilled"; value: T } | { status: "rejected"; error: unknown } | { status: "timeout" };

/** Bound one promise without terminating the underlying work: handlers are
 * attached immediately so a late settlement can never become an unhandled
 * rejection, and a timeout resolves the wrapper while the work continues. */
const settleBounded = <T,>(work: Promise<T>, timeoutMs: number): Promise<Settled<T>> =>
  new Promise(resolve => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve({ status: "timeout" }); } }, Math.max(1, timeoutMs));
    work.then(
      value => { if (!done) { done = true; clearTimeout(timer); resolve({ status: "fulfilled", value }); } },
      error => { if (!done) { done = true; clearTimeout(timer); resolve({ status: "rejected", error }); } },
    );
  });

interface PendingProbeRequest {
  resolve: (frame: AcpProbeFrame) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/** Bookkeeping for the probe's in-flight JSON-RPC requests: id allocation,
 * per-request deadline timers, response matching and a single rejection
 * path for every pending request. Keeping these invariants in one place
 * leaves the lifecycle function free of pending-map plumbing, and a
 * resolved or withdrawn request can never produce a stale rejection or a
 * leaked timer. */
class ProbeRequestBook {
  readonly #pending = new Map<number, PendingProbeRequest>();
  #nextId = 0;
  get size(): number { return this.#pending.size; }
  take(): number { return this.#nextId++; }
  /** Register one request and arm its deadline timer. The timer rejects only
   * while the request is still pending, and the rejection is consumed even if
   * nobody is awaiting the response yet (for example when the timer fires
   * while the write is still being awaited). */
  arm(id: number, method: string, timeoutMs: number): Promise<AcpProbeFrame> {
    let resolve!: (frame: AcpProbeFrame) => void;
    let reject!: (error: Error) => void;
    const response = new Promise<AcpProbeFrame>((res, rej) => { resolve = res; reject = rej; });
    response.catch(() => {});
    const timer = setTimeout(() => {
      if (this.#pending.delete(id)) reject(new Error(`probe timed out waiting for a response to ${method}`));
    }, Math.max(1, timeoutMs));
    this.#pending.set(id, { resolve, reject, timer });
    return response;
  }
  /** Deliver a response frame; false when no request with that id is pending. */
  resolve(id: number, frame: AcpProbeFrame): boolean {
    const entry = this.#pending.get(id);
    if (entry === undefined) return false;
    this.#pending.delete(id);
    clearTimeout(entry.timer);
    entry.resolve(frame);
    return true;
  }
  /** Withdraw a request without settling it and clear its timer. */
  withdraw(id: number): void {
    const entry = this.#pending.get(id);
    if (entry !== undefined) {
      this.#pending.delete(id);
      clearTimeout(entry.timer);
    }
  }
  /** Reject every pending request with one reason and clear their timers. */
  rejectAll(reason: string): void {
    for (const [, entry] of this.#pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this.#pending.clear();
  }
}

/** Bounded ACP capability probe over an injected transport. It initializes
 * without advertising any fs/terminal capability, creates one fresh session,
 * submits the continuation byte-exactly in a `prompt` content block, answers
 * permission requests by selecting only an advertised `reject_once` option
 * (never an allow option, and with the `cancelled` outcome once cancellation
 * starts or when no safe reject option exists), cancels the prompt after
 * yielding one macrotask for frames the transport already queued, and requires
 * the matching response to carry the `cancelled` stop reason.
 *
 * Evidence rules: an assistant echo of the packet is never delivery
 * evidence; a successful gate requires the corresponding write to have
 * settled; an arbitrary JSON-RPC error is never a cancellation disposition;
 * a failed or never-settled write stays uncertain (`write_failed` /
 * `write_unsettled`) and is never retried. Synthetic results never qualify
 * live Kiro: `qualified` and `managedRotationAvailable` are always false.
 *
 * Lifetime: one monotonic operation deadline bounds every phase; a separate
 * bounded cleanup scope then closes the transport and joins the reader. A
 * non-cooperative transport yields a report with cleanup `unconfirmed`
 * rather than a hang, and every promise this probe creates has rejection
 * handlers attached immediately, so an uncooperative transport cannot cause
 * an unhandled rejection or mutate the returned report after it is handed
 * back. */
export async function runAcpCapabilityProbe(transport: AcpProbeTransport, options: AcpCapabilityProbeOptions): Promise<AcpCapabilityReport> {
  const errors: string[] = [];
  const report: AcpCapabilityReport = {
    source: options?.source === "live" ? "live" : "synthetic",
    qualified: false,
    managedRotationAvailable: false,
    gates: {
      initializeObserved: false,
      requestedEngineExplicit: options?.requestedEngine === "v3",
      freshSessionCreated: false,
      exactContinuationSubmitted: false,
      permissionDeniedByDefault: false,
      cancellationTerminalWitnessed: false,
      nativeAutoCompactionSuppression: "unknown",
    },
    sessionId: null,
    submittedContinuation: null,
    submission: null,
    cancellation: { requested: false, writeSettled: false, terminalStopReason: null },
    cleanup: { state: "pending", detail: null },
    errors,
  };

  const cleanupAbort = new AbortController();

  let closeCalls = 0;
  const finishCleanup = async (reader: Promise<void> | null, cleanupMs: number): Promise<void> => {
    const details: string[] = [];
    let state: AcpCleanupState = "complete";
    let closePromise: Promise<void>;
    closeCalls++;
    try { closePromise = transport.close(cleanupAbort.signal); }
    catch (error) { closePromise = Promise.reject(error); }
    const closeResult = await settleBounded(closePromise, cleanupMs);
    if (closeResult.status === "rejected") { state = "failed"; details.push(`close failed: ${message(closeResult.error)}`); }
    else if (closeResult.status === "timeout") { state = "unconfirmed"; details.push("close did not settle within the cleanup budget"); }
    if (reader !== null) {
      const readerResult = await settleBounded(reader, cleanupMs);
      if (readerResult.status === "rejected") { state = "failed"; details.push(`probe reader failed: ${message(readerResult.error)}`); }
      else if (readerResult.status === "timeout") {
        if (state === "complete") state = "unconfirmed";
        details.push("probe reader did not settle within the cleanup budget");
      }
    }
    report.cleanup = { state, detail: details.length > 0 ? details.join("; ") : null };
  };

  const invalid = inspectProbeOptions(options);
  if (invalid !== null) {
    errors.push(invalid);
    await finishCleanup(null, ACP_PROBE_DEFAULT_CLEANUP_TIMEOUT_MS);
    return report;
  }

  const operationMs = options.timeoutMs ?? ACP_PROBE_DEFAULT_OPERATION_TIMEOUT_MS;
  const cleanupMs = options.cleanupTimeoutMs ?? ACP_PROBE_DEFAULT_CLEANUP_TIMEOUT_MS;
  const maxFrames = options.maxFrames ?? ACP_PROBE_DEFAULT_FRAMES;
  const knownSessions = new Set(options.knownSessionIds ?? []);

  const operationAbort = new AbortController();
  const startedAt = performance.now();
  const remaining = (): number => operationMs - (performance.now() - startedAt);
  const boundedMs = (): number => Math.max(1, Math.ceil(remaining()));

  const state = { terminal: false, frames: 0, totalFrameBytes: 0 };
  let sessionId: string | null = null;
  let cancelRequested = false;

  const requests = new ProbeRequestBook();

  const note = (reason: string): void => { if (!state.terminal) errors.push(reason); };

  /** The single terminal path: records the first reason, rejects every
   * pending request with it, clears timers and notifies cooperative
   * transports. Later reasons are dropped as consequences of the first. */
  const seal = (reason?: string): void => {
    if (state.terminal) return;
    state.terminal = true;
    if (reason !== undefined) errors.push(reason);
    requests.rejectAll(reason ?? "probe terminated");
    operationAbort.abort();
  };

  const sendSafely = (frame: AcpProbeFrame): Promise<void> => {
    try { return transport.send(frame, operationAbort.signal); }
    catch (error) { return Promise.reject(error); }
  };

  const nextSafely = (): Promise<AcpProbeFrame | null> => {
    try { return transport.next(operationAbort.signal); }
    catch (error) { return Promise.reject(error); }
  };

  const answerPermission = async (frame: AcpProbeFrame): Promise<void> => {
    const inspected = inspectPermissionRequest(frame.params, sessionId);
    if (!inspected.ok) { note(`ignoring a permission request: the agent sent ${inspected.reason}`); return; }
    const requestId = frame.id as number | string;
    let reply: AcpProbeFrame;
    let denialEvidence = false;
    if (cancelRequested) {
      reply = buildPermissionCancelledReply(requestId);
    } else {
      const optionId = selectRejectOptionId(inspected.request.options);
      if (optionId === null) {
        reply = buildPermissionCancelledReply(requestId);
        note("permission request advertised no reject_once option; the probe replied with the cancelled outcome instead of granting permission");
      } else {
        reply = buildPermissionSelectedReply(requestId, optionId);
        denialEvidence = true;
      }
    }
    const replyResult = await settleBounded(sendSafely(reply), boundedMs());
    if (replyResult.status === "fulfilled") {
      if (denialEvidence && !state.terminal) report.gates.permissionDeniedByDefault = true;
    } else if (replyResult.status === "rejected") {
      note(`transport failed answering a permission request: ${message(replyResult.error)}`);
    } else {
      note("permission reply write did not settle before the probe deadline; denial evidence withheld");
    }
  };

  const reader = (async (): Promise<void> => {
    try {
      while (!state.terminal) {
        // A pending request's own deadline timer produces the specific first
        // reason; the reader defers to it instead of sealing generically.
        if (remaining() <= 0) { if (requests.size === 0) seal("probe deadline elapsed while waiting for agent frames"); return; }
        if (state.frames >= maxFrames) { seal("probe frame budget exhausted"); return; }
        if (state.totalFrameBytes >= ACP_PROBE_MAX_TOTAL_FRAME_BYTES) { seal("probe aggregate incoming frame byte budget exhausted"); return; }
        const readResult = await settleBounded(nextSafely(), boundedMs());
        if (state.terminal) return;
        if (readResult.status === "timeout") { if (requests.size === 0) seal("probe deadline elapsed while waiting for agent frames"); return; }
        if (readResult.status === "rejected") { seal(`transport failed: ${message(readResult.error)}`); return; }
        const frame = readResult.value;
        if (frame === null) { seal("transport closed before the probe completed"); return; }
        const inspection = inspectIncomingFrame(frame);
        if (!inspection.ok) { seal(`agent sent ${inspection.reason}`); return; }
        const frameBytes = measureFrameBytes(frame);
        if (frameBytes === null) { seal("agent sent a frame that could not be measured as JSON"); return; }
        if (frameBytes > ACP_PROBE_MAX_FRAME_BYTES) {
          seal(`agent sent a frame of ${frameBytes.toLocaleString("en-US")} serialized bytes (limit ${ACP_PROBE_MAX_FRAME_BYTES.toLocaleString("en-US")})`);
          return;
        }
        state.totalFrameBytes += frameBytes;
        if (state.totalFrameBytes > ACP_PROBE_MAX_TOTAL_FRAME_BYTES) { seal("probe aggregate incoming frame byte budget exhausted"); return; }
        state.frames++;
        if (inspection.kind === "response") {
          // The probe only sends numeric request ids; a response carrying any
          // other id can never match a pending request.
          if (typeof inspection.id !== "number" || !requests.resolve(inspection.id, frame)) {
            seal(`agent sent an unsolicited or mismatched response (id ${String(inspection.id)})`);
            return;
          }
        } else if (frame.method === "session/request_permission") {
          if (inspection.kind === "request") await answerPermission(frame);
          else note("session/request_permission arrived as a notification without a request id; no reply was sent");
          if (state.terminal) return;
        }
        // All other requests and notifications are observed but never treated
        // as checkpoint-delivery evidence; an assistant echo proves nothing.
      }
    } catch (error) {
      seal(`probe reader failed: ${message(error)}`);
    }
  })();
  reader.catch(() => {});

  const sendRequest = async (method: string, params: unknown): Promise<AcpProbeFrame | null> => {
    const id = requests.take();
    // The write wrapper's timer is created before the response timer so a
    // never-settling write seals with the write-specific reason first, and the
    // book is armed in the same synchronous block as the send so a queued
    // response can never look unsolicited.
    const writePromise = settleBounded(sendSafely({ jsonrpc: "2.0", id, method, params }), boundedMs());
    const response = requests.arm(id, method, boundedMs());
    const writeResult = await writePromise;
    if (writeResult.status !== "fulfilled") {
      requests.withdraw(id);
      if (writeResult.status === "rejected") seal(`transport failed sending ${method}: ${message(writeResult.error)}`);
      else seal(`${method} write did not settle before the probe deadline (delivery uncertain)`);
      return null;
    }
    const responseResult = await settleBounded(response, boundedMs());
    requests.withdraw(id);
    if (responseResult.status === "fulfilled") return responseResult.value;
    if (responseResult.status === "rejected") { seal(message(responseResult.error)); return null; }
    seal(`probe timed out waiting for a response to ${method}`);
    return null;
  };

  let initialized = false;
  const initFrame = await sendRequest("initialize", buildInitializeParams());
  if (initFrame !== null) {
    if (initFrame.error !== undefined) seal(`initialize failed: ${initFrame.error.message}`);
    else {
      const init = inspectInitializeResult(initFrame.result);
      if (init.ok) { report.gates.initializeObserved = true; initialized = true; }
      else seal(init.reason);
    }
  }

  if (initialized && !state.terminal) {
    const newFrame = await sendRequest("session/new", buildSessionNewParams(options.cwd));
    if (newFrame !== null) {
      if (newFrame.error !== undefined) seal(`session/new failed: ${newFrame.error.message}`);
      else {
        const session = inspectSessionIdResult(newFrame.result);
        if (!session.ok) seal(session.reason);
        else if (knownSessions.has(session.sessionId)) seal("session/new returned a previously known session id (resume, not a fresh session)");
        else { sessionId = session.sessionId; report.sessionId = sessionId; report.gates.freshSessionCreated = true; }
      }
    }
  }

  if (sessionId !== null && !state.terminal) {
    const intended = {
      bytes: Buffer.byteLength(options.continuation, "utf8"),
      sha256: createHash("sha256").update(options.continuation, "utf8").digest("hex"),
    };
    report.submission = { ...intended, state: "write_unsettled" };
    const promptId = requests.take();
    // Same ordering contract as sendRequest: the write wrapper's timer is
    // armed before the response timer, and the book entry exists in the same
    // synchronous block as the send. The entry deliberately survives a failed
    // prompt write so its own deadline still produces the specific reason.
    const promptWritePromise = settleBounded(sendSafely({ jsonrpc: "2.0", id: promptId, method: "session/prompt", params: buildPromptRequestParams(sessionId, options.continuation) }), boundedMs());
    const promptResponse = requests.arm(promptId, "session/prompt", boundedMs());
    const promptWrite = await promptWritePromise;
    if (promptWrite.status === "fulfilled") {
      report.submission.state = "written";
      report.submittedContinuation = { bytes: intended.bytes, sha256: intended.sha256 };
      report.gates.exactContinuationSubmitted = true;
    } else if (promptWrite.status === "rejected") {
      report.submission.state = "write_failed";
      note(`transport failed sending session/prompt: ${message(promptWrite.error)} (delivery uncertain; the probe never retries a submitted continuation)`);
    } else {
      note("session/prompt write did not settle before the probe deadline (delivery uncertain; the probe never retries a submitted continuation)");
    }

    if (!state.terminal) {
      // Yield one macrotask so frames the transport already queued while the
      // write was in flight (for example a permission request) are read and
      // answered before cancellation starts. Requests arriving after this
      // point are answered with the cancelled outcome, as ACP requires for
      // requests pending at cancellation time.
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    if (!state.terminal) {
      report.cancellation.requested = true;
      cancelRequested = true;
      const cancelWrite = await settleBounded(sendSafely({ jsonrpc: "2.0", method: "session/cancel", params: buildCancelNotificationParams(sessionId) }), boundedMs());
      if (cancelWrite.status === "fulfilled") report.cancellation.writeSettled = true;
      else if (cancelWrite.status === "rejected") note(`transport failed sending session/cancel: ${message(cancelWrite.error)}`);
      else note("session/cancel write did not settle before the probe deadline");
    }

    const terminalResult = await settleBounded(promptResponse, boundedMs());
    requests.withdraw(promptId);
    if (terminalResult.status === "timeout") {
      seal("probe timed out waiting for a response to session/prompt (turn outcome uncertain)");
    } else if (terminalResult.status === "rejected") {
      seal(message(terminalResult.error));
    } else {
      const terminalFrame = terminalResult.value;
      if (terminalFrame.error !== undefined) {
        seal(`session/prompt failed: ${terminalFrame.error.message}`);
      } else {
        const stopReason = inspectStopReason((terminalFrame.result as { stopReason?: unknown } | undefined)?.stopReason);
        report.cancellation.terminalStopReason = stopReason;
        if (stopReason === "cancelled") {
          if (cancelRequested && report.cancellation.writeSettled) report.gates.cancellationTerminalWitnessed = true;
          else seal("session/prompt reported the cancelled stop reason without a settled cancellation request");
        } else if (stopReason !== null) {
          seal(`prompt turn ended with stop reason "${stopReason}" instead of a terminal cancellation disposition`);
        } else {
          seal("session/prompt response did not carry a valid stop reason");
        }
      }
    }
  }

  seal();
  await finishCleanup(reader, cleanupMs);
  return report;
}
