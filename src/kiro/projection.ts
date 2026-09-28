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
  retentionLoss?: { checkpoints: number; receipt: boolean; output: boolean };
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
  if (format !== "json" && typeof value === "string") return value;
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

const READ_ONLY_REF = /^(?:local\.(?:read|readMany|readEvidence|grep|find|list)|repo\.(?:status|sketch|focus|augment|grep|dwell|impact|result|searchResult|anchors|rules|settings)|state\.(?:get|list|search)|fabric\.(?:info|help)|tools\.[A-Za-z]+|artifacts\.read|mcp\.\$(?:servers|tools|describe))$/u;
const mayHaveEffects = (result: FabricExecutionResult): boolean => result.audits.some((audit) =>
  !READ_ONLY_REF.test(audit.ref) || audit.effectOutcome !== undefined || audit.commitAcknowledgement !== undefined);

const compactShellFailure = (failure: NonNullable<FabricExecutionResult["lastShellFailure"]>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(failure).filter(([key, value]) => key !== "ok" && value !== null && value !== false && value !== ""));

const failureProgress = (result: FabricExecutionResult): string => {
  if (result.success || !mayHaveEffects(result)) return "";
  const completed = result.audits.filter(
    (audit) => audit.endedAt !== undefined && typeof audit.success === "boolean",
  );
  if (completed.length === 0) return "";
  const encode = (audits: FabricExecutionResult["audits"]): string[] => {
    const labels: string[] = [];
    let previous = "", repeats = 0;
    const flush = (): void => { if (previous) labels.push(repeats > 1 ? `${previous} ×${repeats}` : previous); };
    for (const audit of audits) {
      const ref = audit.ref.length <= MAX_FAILURE_PROGRESS_REF_CHARS ? audit.ref : `${safePrefix(audit.ref, MAX_FAILURE_PROGRESS_REF_CHARS - 1)}…`;
      const label = `${ref} ${audit.success ? "succeeded" : "failed"}${audit.commitAcknowledgement ? " (committed)" : audit.effectOutcome === "uncertain" ? " (effect uncertain)" : ""}`;
      if (label === previous) { repeats++; continue; }
      flush(); previous = label; repeats = 1;
    }
    flush();
    return labels;
  };
  const edge = Math.floor(MAX_FAILURE_PROGRESS_ENTRIES / 2);
  const summaries = completed.length <= MAX_FAILURE_PROGRESS_ENTRIES ? encode(completed)
    : [...encode(completed.slice(0, edge)), `… ${completed.length - 2 * edge} more …`, ...encode(completed.slice(-edge))];
  const committed = completed.some((audit) => audit.commitAcknowledgement);
  const uncertain = completed.some((audit) => audit.effectOutcome === "uncertain");
  return [
    `\n\nNested calls: ${summaries.join(", ")}.`,
    committed
      ? "A mutation is known committed although acknowledgement failed; inspect the affected file or durable key before retrying."
      : `Inspect current state before retrying fabric_exec; completed calls may already have taken effect${uncertain ? " and shell effects are uncertain" : ""}.`,
  ].join("\n");
};

type FabricAudit = FabricExecutionResult["audits"][number];
const MAX_RECEIPT_ENTRIES = 64;
/** Bounded recovery receipt: operation identity, outcome class and timing only.
 * Arguments, source, result contents and operation error text are never recorded,
 * so an echoed value cannot leak through recovery metadata. */
const recoveryReceipt = (result: FabricExecutionResult) => {
  if (result.success || result.audits.length === 0 || !mayHaveEffects(result)) return undefined;
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
  retained?: KiroProjectionResult;
  hasArtifact?(id: string): boolean;
}): KiroProjectionResult => {
  const visibleMaximum = options.result.success
    ? options.maxOutputChars
    : Math.min(options.maxOutputChars, MAX_FAILURE_OUTPUT_CHARS);
  const issuedCheckpoints = [...new Set((options.result.checkpoints ?? options.result.failure?.checkpoints ?? []).slice(0, 8)
    .map(handle => handle.id).filter(id => /^ka_[a-f0-9]{48}$/u.test(id)))];
  const available = (id: string): boolean => options.hasArtifact?.(id) ?? true;
  const checkpointIds = issuedCheckpoints.filter(available);
  const retained = options.retained;
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
        ...(options.result.lastShellFailure ? { lastShellFailure: compactShellFailure(options.result.lastShellFailure) } : {}),
        ...(options.result.status === "timed_out" ? { effectiveTimeoutMs: options.result.effectiveTimeoutMs } : {}),
      };
  const receipt = recoveryReceipt(options.result);
  let receiptId = retained?.receiptId;
  if (receipt && !retained) {
    try { receiptId = options.writeArtifact(JSON.stringify(receipt)); }
    catch { receiptId = undefined; }
  }
  const retentionLoss = {
    checkpoints: issuedCheckpoints.length - checkpointIds.length,
    receipt: receiptId !== undefined && !available(receiptId),
    output: retained?.artifactId !== undefined && !available(retained.artifactId),
  };
  if (retentionLoss.receipt) receiptId = undefined;
  const lost = retentionLoss.checkpoints > 0 || retentionLoss.receipt || retentionLoss.output;
  const retentionNotice = lost
    ? `\n\nEphemeral evidence unavailable: ${[retentionLoss.checkpoints ? `${retentionLoss.checkpoints} checkpoint(s)` : "", retentionLoss.receipt ? "recovery receipt" : "", retentionLoss.output ? "full output" : ""].filter(Boolean).join(", ")}.`
    : "";
  const body = stringify(value, options.resultFormat);
  const logs = options.result.logs.length
    ? `\n\nFabric logs: ${JSON.stringify(options.result.logs)}`
    : "";
  const progress = failureProgress(options.result);
  // Never surface labels or nested evidence in recovery metadata, including failure.checkpoints.
  const checkpoints = checkpointIds.length ? `\n\nEphemeral checkpoint handles (read with artifacts.read): ${JSON.stringify(checkpointIds)}` : "";
  const recoveryNotice = !receipt ? ""
    : `${progress ? "" : "\n\nInspect current state before retrying fabric_exec; started calls may already have taken effect."}${receiptId === undefined ? "\n\nRecovery receipt (unavailable)." : `\n\nRecovery receipt: artifacts.read({id:${JSON.stringify(receiptId)}}).`}`;
  // Keep the recovery handle in the reserved suffix even if logs/progress are elided.
  const recoveryHint = receipt
    ? `\nRecovery receipt${receiptId === undefined ? " unavailable" : ` ${receiptId} (artifacts.read)`}; retryProgram: false.`
    : "";
  const complete = `${body}${logs}${progress}${recoveryNotice}${checkpoints}`;
  const inline = complete + retentionNotice;
  if (inline.length <= visibleMaximum && (retained?.artifactId === undefined || retentionLoss.output)) return {
    text: inline,
    isError: !options.result.success,
    executionStatus: options.result.status,
    deliveryStatus: "inline",
    retryProgram: false,
    ...(receiptId === undefined ? {} : { receiptId }),
    visibleChars: inline.length,
    visibleBytes: Buffer.byteLength(inline, "utf8"),
    overflowed: false,
    artifactRetained: false,
    retention: "inline",
    checkpointIds,
    ...(lost ? { retentionLoss } : {}),
  };
  try {
    let artifactId: string;
    let retention: "complete" | "canonical" = "complete";
    if (retained) {
      if (retained.artifactId === undefined || retentionLoss.output) throw new Error("output artifact unavailable");
      artifactId = retained.artifactId;
      retention = retained.retention === "canonical" ? "canonical" : "complete";
    } else {
      try { artifactId = options.writeArtifact(complete); }
      catch {
        // Retry serialization/retention only: NEVER execute the program or a provider again.
        // Compact JSON removes formatting expansion and auxiliary sections at the store cap.
        const canonical = JSON.stringify(value) ?? "null";
        artifactId = options.writeArtifact(canonical);
        retention = "canonical";
      }
    }
    const hint = `\n\nOutput exceeded ${visibleMaximum} characters. ${retention === "complete" ? "Full result" : "Canonical JSON result (formatting/logs/progress omitted)"} is artifact ${artifactId}; read it with await artifacts.read({ id: ${JSON.stringify(artifactId)} }).`;
    const text = truncateWithHint(complete, visibleMaximum, `${hint}${recoveryHint}${retentionNotice}`);
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
      ...(lost ? { retentionLoss } : {}),
    };
  } catch {
    const hint = `\n\nOutput could not be retained; execution: ${options.result.status}; delivery: unavailable; retryProgram: false. Effects may already be applied; inspect state.`;
    const text = truncateWithHint(complete, visibleMaximum, `${hint}${recoveryHint}${retentionNotice}`);
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
      ...(lost ? { retentionLoss } : {}),
    };
  }
};
