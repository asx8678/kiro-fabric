import type { FabricExecResultFormat } from "../kernel/fabric-exec-contract.js";
import type { FabricExecutionResult } from "../execution-service.js";

export interface KiroProjectionResult {
  text: string;
  isError: boolean;
  /** Execution outcome, independent of whether its output could be delivered. */
  executionStatus: "succeeded" | "failed" | "aborted" | "timed_out";
  /** Output delivery outcome, independent of the execution outcome. */
  deliveryStatus: "inline" | "artifact" | "unavailable";
  /** Fabric never replays a program automatically; this recovery instruction is not a capability. */
  retryProgram: false;
  /** Bounded issued-operation receipt artifact for partial failures, when retained. */
  receiptId?: string;
  artifactId?: string;
  visibleChars: number;
  visibleBytes: number;
  overflowed: boolean;
  artifactRetained: boolean;
  retention: "inline" | "complete" | "canonical" | "unavailable";
  checkpointIds?: readonly string[];
}
const MAX_FAILURE_PROGRESS_ENTRIES = 8;
const MAX_FAILURE_PROGRESS_REF_CHARS = 512;
const MAX_FAILURE_OUTPUT_CHARS = 20_000;
const TRUNCATION_MARKER = "\n\n… middle omitted …\n\n";

const safePrefix = (value: string, maximum: number): string => {
  const bounded = value.slice(0, Math.max(0, maximum));
  const last = bounded.charCodeAt(bounded.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? bounded.slice(0, -1) : bounded;
};

const safeSuffix = (value: string, maximum: number): string => {
  let start = Math.max(0, value.length - Math.max(0, maximum));
  const first = value.charCodeAt(start);
  if (first >= 0xdc00 && first <= 0xdfff && start > 0) start += 1;
  return value.slice(start);
};

const stringify = (value: unknown, format: FabricExecResultFormat): string => {
  if (format === "text" && typeof value === "string") return value;
  return JSON.stringify(value, null, format === "json" ? 2 : undefined) ?? "null";
};

// Keep every compiler diagnostic, but show identical repair advice once per
// response. Repeated hints can otherwise displace the errors into an artifact.
const compactTypeErrors = (errors: NonNullable<FabricExecutionResult["typeErrors"]>) => {
  const hints = new Set<string>();
  return errors.map((error) => {
    if (error.hint === undefined) return error;
    if (!hints.has(error.hint)) { hints.add(error.hint); return error; }
    const diagnostic = { ...error };
    delete diagnostic.hint;
    return diagnostic;
  });
};

const failureProgress = (result: FabricExecutionResult): string => {
  if (result.success) return "";
  const completed = result.audits.filter(
    (audit) => audit.endedAt !== undefined && typeof audit.success === "boolean",
  );
  if (completed.length === 0) return "";
  const edge = Math.floor(MAX_FAILURE_PROGRESS_ENTRIES / 2);
  const sampled = completed.length <= MAX_FAILURE_PROGRESS_ENTRIES
    ? completed
    : [...completed.slice(0, edge), ...completed.slice(-edge)];
  const summaries = sampled.map((audit) => ({
    ref: audit.ref.length <= MAX_FAILURE_PROGRESS_REF_CHARS
      ? audit.ref
      : `${safePrefix(audit.ref, MAX_FAILURE_PROGRESS_REF_CHARS - 1)}…`,
    outcome: audit.success ? "succeeded" : "failed",
    ...(audit.effectOutcome ? { effectOutcome: audit.effectOutcome } : {}),
    ...(audit.commitAcknowledgement ? {
      commitAcknowledgement: { committed: true, operation: audit.commitAcknowledgement.operation },
    } : {}),
  }));
  const omitted = completed.length - summaries.length;
  const succeeded = completed.filter((audit) => audit.success === true).length;
  const committed = completed.filter((audit) => audit.commitAcknowledgement).length;
  const uncertain = completed.filter((audit) => audit.effectOutcome === "uncertain").length;
  const sampledCommitted = summaries.some((summary) => summary.commitAcknowledgement !== undefined);
  return [
    `\n\nCompleted nested calls before the outer failure (arguments and results omitted): ${JSON.stringify({ total: completed.length, succeeded, failed: completed.length - succeeded, committed, sample: summaries, omitted })}.`,
    ...(uncertain > 0 ? ["Host command effects are uncertain; cancellation or failure is not rollback. Inspect the workspace and external state; never automatically retry the program."] : []),
    committed > 0
      ? sampledCommitted
        ? "A listed mutation is known committed although acknowledgement failed; inspect the affected file or durable key before retrying."
        : "A mutation is known committed although acknowledgement failed (not shown in the sample); inspect the affected file or durable key before retrying."
      : "Inspect current state before retrying fabric_exec; completed calls may already have taken effect, and a blind retry can duplicate effects.",
  ].join("\n");
};

type FabricAudit = FabricExecutionResult["audits"][number];
const MAX_RECEIPT_ENTRIES = 64;
/** Bounded recovery receipt: operation identity, outcome class and timing only.
 * Arguments, source, result contents and operation error text are never recorded,
 * so an echoed value cannot leak through recovery metadata. */
const recoveryReceipt = (result: FabricExecutionResult) => {
  if (result.success || result.audits.length === 0) return undefined;
  const outcome = (audit: FabricAudit) => audit.commitAcknowledgement ? "committed"
    : audit.effectOutcome === "uncertain" ? "uncertain"
      : audit.endedAt === undefined ? "issued"
        : audit.success === true ? "succeeded" : "failed";
  const edge = MAX_RECEIPT_ENTRIES / 2;
  const sampled = result.audits.length <= MAX_RECEIPT_ENTRIES ? result.audits
    : [...result.audits.slice(0, edge), ...result.audits.slice(-edge)];
  const entries = sampled.map((audit) => ({
    ref: audit.ref.length <= MAX_FAILURE_PROGRESS_REF_CHARS ? audit.ref : `${safePrefix(audit.ref, MAX_FAILURE_PROGRESS_REF_CHARS - 1)}…`,
    ...(audit.ref.length > MAX_FAILURE_PROGRESS_REF_CHARS ? { refTruncated: true } : {}),
    nestedToolCallId: safePrefix(audit.nestedToolCallId, 64),
    outcome: outcome(audit),
    startedAt: audit.startedAt,
    ...(audit.endedAt === undefined ? {} : { endedAt: audit.endedAt, elapsedMs: audit.endedAt - audit.startedAt }),
    ...(audit.resultChars === undefined ? {} : { resultChars: audit.resultChars }),
    ...(audit.resultTruncated === undefined ? {} : { resultTruncated: audit.resultTruncated }),
  }));
  // Counts cover every recorded call, including entries omitted from the sample.
  const totals = { committed: 0, uncertain: 0, issued: 0, succeeded: 0, failed: 0 };
  for (const audit of result.audits) totals[outcome(audit)]++;
  return {
    schemaVersion: 1,
    executionStatus: result.status,
    retryProgram: false,
    counts: {
      recorded: result.audits.length, shown: entries.length, omitted: result.audits.length - entries.length,
      ...totals,
    },
    note: "Bounded audit receipt, not an exactly-once guarantee. Counts cover all recorded calls; entries sample the first/last calls when omitted > 0. Truncated refs are not callable identities. Audits begin before approval; issued does not prove provider dispatch, and failed does not prove no effects. Absence is not proof of non-dispatch. Arguments, source, result contents and error text are excluded. Inspect state; never replay blindly. This artifact is ephemeral and subject to eviction/expiry.",
    entries,
  };
};

const truncateMiddle = (content: string, maximum: number): string => {
  if (content.length <= maximum) return content;
  if (maximum <= 0) return "";
  if (maximum <= TRUNCATION_MARKER.length + 1) {
    if (maximum === 1) return safePrefix(content, 1);
    const headChars = Math.ceil(maximum / 2);
    return `${safePrefix(content, headChars)}${safeSuffix(content, maximum - headChars)}`;
  }
  const retainedChars = maximum - TRUNCATION_MARKER.length;
  const headChars = Math.ceil(retainedChars / 2);
  return `${safePrefix(content, headChars)}${TRUNCATION_MARKER}${safeSuffix(content, retainedChars - headChars)}`;
};

const truncateWithHint = (content: string, maximum: number, hint: string): string => {
  if (hint.length >= maximum) return safePrefix(hint, maximum);
  return `${truncateMiddle(content, maximum - hint.length)}${hint}`;
};

export const projectFabricExecutionText = (options: {
  result: FabricExecutionResult & { checkpoints?: readonly { id: string; label?: string }[] };
  resultFormat: FabricExecResultFormat;
  maxOutputChars: number;
  writeArtifact(content: string): string;
}): KiroProjectionResult => {
  const visibleMaximum = options.result.success
    ? options.maxOutputChars
    : Math.min(options.maxOutputChars, MAX_FAILURE_OUTPUT_CHARS);
  const checkpointIds = [...new Set((options.result.checkpoints ?? options.result.failure?.checkpoints ?? []).slice(0, 8)
    .map(handle => handle.id).filter(id => /^ka_[a-f0-9]{48}$/u.test(id)))];
  const failure = options.result.failure ? { ...options.result.failure,
    ...(options.result.failure.checkpoints ? { checkpoints: checkpointIds.map(id => ({ id })) } : {}),
  } : undefined;
  const value = options.result.success
    ? options.result.value
    : {
        status: options.result.status,
        error: options.result.error ?? "Fabric execution failed",
        ...(options.result.typeErrors ? { typeErrors: compactTypeErrors(options.result.typeErrors) } : {}),
        ...(failure ? { failure } : {}),
        ...(options.result.lastShellFailure ? { lastShellFailure: options.result.lastShellFailure } : {}),
        effectiveTimeoutMs: options.result.effectiveTimeoutMs,
      };
  const receipt = recoveryReceipt(options.result);
  let receiptId: string | undefined;
  if (receipt) {
    try { receiptId = options.writeArtifact(JSON.stringify(receipt)); }
    catch { receiptId = undefined; }
  }
  const body = stringify(value, options.resultFormat);
  const logs = options.result.logs.length
    ? `\n\nFabric logs: ${JSON.stringify(options.result.logs)}`
    : "";
  const progress = failureProgress(options.result);
  // Never surface labels or nested evidence in recovery metadata, including failure.checkpoints.
  const checkpoints = checkpointIds.length ? `\n\nEphemeral checkpoint handles (read with artifacts.read): ${JSON.stringify(checkpointIds)}` : "";
  const counts = receipt ? JSON.stringify(receipt.counts) : "";
  const recoveryNotice = receipt
    ? `\n\nRecovery receipt${receiptId === undefined ? " (unavailable)" : ` ${receiptId}`}: ${counts}. ${receiptId === undefined ? "" : `Read it with await artifacts.read({ id: ${JSON.stringify(receiptId)} }). `}retryProgram: false; inspect the listed operations before rerunning.`
    : "";
  // Keep the recovery handle in the reserved suffix even if logs/progress are elided.
  const recoveryHint = receipt
    ? `\nRecovery receipt${receiptId === undefined ? " unavailable" : ` ${receiptId} (artifacts.read)`}; retryProgram: false.`
    : "";
  const complete = `${body}${logs}${progress}${recoveryNotice}${checkpoints}`;
  if (complete.length <= visibleMaximum) return {
    text: complete,
    isError: !options.result.success,
    executionStatus: options.result.status,
    deliveryStatus: "inline",
    retryProgram: false,
    ...(receiptId === undefined ? {} : { receiptId }),
    visibleChars: complete.length,
    visibleBytes: Buffer.byteLength(complete, "utf8"),
    overflowed: false,
    artifactRetained: false,
    retention: "inline",
    checkpointIds,
  };
  try {
    let artifactId: string;
    let retention: "complete" | "canonical" = "complete";
    try { artifactId = options.writeArtifact(complete); }
    catch {
      // Retry serialization/retention only: NEVER execute the program or a provider again.
      // Compact JSON removes formatting expansion and auxiliary sections at the store cap.
      const canonical = JSON.stringify(value) ?? "null";
      artifactId = options.writeArtifact(canonical);
      retention = "canonical";
    }
    const hint = `\n\nOutput exceeded ${visibleMaximum} characters. ${retention === "complete" ? "Full result" : "Canonical JSON result (formatting/logs/progress omitted)"} is artifact ${artifactId}; read it with await artifacts.read({ id: ${JSON.stringify(artifactId)} }).`;
    const text = truncateWithHint(complete, visibleMaximum, `${hint}${recoveryHint}`);
    return {
      text,
      isError: !options.result.success,
      executionStatus: options.result.status,
      deliveryStatus: "artifact",
      retryProgram: false,
      ...(receiptId === undefined ? {} : { receiptId }),
      artifactId,
      visibleChars: text.length,
      visibleBytes: Buffer.byteLength(text, "utf8"),
      overflowed: true,
      artifactRetained: true,
      retention,
      checkpointIds,
    };
  } catch {
    const hint = `\n\nOutput could not be retained; execution: ${options.result.status}; delivery: unavailable; retryProgram: false. Effects may already be applied; inspect state.`;
    const text = truncateWithHint(complete, visibleMaximum, `${hint}${recoveryHint}`);
    return {
      text,
      isError: true,
      executionStatus: options.result.status,
      deliveryStatus: "unavailable",
      retryProgram: false,
      ...(receiptId === undefined ? {} : { receiptId }),
      visibleChars: text.length,
      visibleBytes: Buffer.byteLength(text, "utf8"),
      overflowed: true,
      artifactRetained: false,
      retention: "unavailable",
      checkpointIds,
    };
  }
};
