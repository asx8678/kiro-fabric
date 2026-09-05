import type { FabricExecResultFormat } from "../kernel/fabric-exec-contract.js";
import type { FabricExecutionResult } from "../execution-service.js";

export interface KiroProjectionResult {
  text: string;
  isError: boolean;
  artifactId?: string;
  visibleChars: number;
  visibleBytes: number;
  overflowed: boolean;
  artifactRetained: boolean;
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
    ...(audit.commitAcknowledgement ? {
      commitAcknowledgement: { committed: true, operation: audit.commitAcknowledgement.operation },
    } : {}),
  }));
  const omitted = completed.length - summaries.length;
  const succeeded = completed.filter((audit) => audit.success === true).length;
  const committed = completed.filter((audit) => audit.commitAcknowledgement).length;
  const sampledCommitted = summaries.some((summary) => summary.commitAcknowledgement !== undefined);
  return [
    `\n\nCompleted nested calls before the outer failure (arguments and results omitted): ${JSON.stringify({ total: completed.length, succeeded, failed: completed.length - succeeded, committed, sample: summaries, omitted })}.`,
    committed > 0
      ? sampledCommitted
        ? "A listed memory mutation is known committed although acknowledgement failed; read that memory key before retrying."
        : "A memory mutation is known committed although acknowledgement failed (not shown in the sample); read the affected memory key before retrying."
      : "Inspect current state before retrying fabric_exec; completed calls may already have taken effect, and a blind retry can duplicate effects.",
  ].join("\n");
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
  result: FabricExecutionResult;
  resultFormat: FabricExecResultFormat;
  maxOutputChars: number;
  writeArtifact(content: string): string;
  normalizationDiagnostics?: readonly { field: string; repair: string }[];
}): KiroProjectionResult => {
  const visibleMaximum = options.result.success
    ? options.maxOutputChars
    : Math.min(options.maxOutputChars, MAX_FAILURE_OUTPUT_CHARS);
  const value = options.result.success
    ? options.result.value
    : {
        status: options.result.status,
        error: options.result.error ?? "Fabric execution failed",
        ...(options.result.typeErrors ? { typeErrors: options.result.typeErrors } : {}),
        effectiveTimeoutMs: options.result.effectiveTimeoutMs,
      };
  const body = stringify(value, options.resultFormat);
  const diagnostics = options.normalizationDiagnostics?.length
    ? `\n\nNormalization diagnostics: ${JSON.stringify(options.normalizationDiagnostics)}`
    : "";
  const logs = options.result.logs.length
    ? `\n\nFabric logs: ${JSON.stringify(options.result.logs)}`
    : "";
  const progress = failureProgress(options.result);
  const complete = `${body}${diagnostics}${logs}${progress}`;
  if (complete.length <= visibleMaximum) return {
    text: complete,
    isError: !options.result.success,
    visibleChars: complete.length,
    visibleBytes: Buffer.byteLength(complete, "utf8"),
    overflowed: false,
    artifactRetained: false,
  };
  try {
    const artifactId = options.writeArtifact(complete);
    const hint = `\n\nOutput exceeded ${visibleMaximum} characters. Full result is artifact ${artifactId}; read it with await artifacts.read({ id: ${JSON.stringify(artifactId)} }).`;
    const text = truncateWithHint(complete, visibleMaximum, hint);
    return {
      text,
      isError: !options.result.success,
      artifactId,
      visibleChars: text.length,
      visibleBytes: Buffer.byteLength(text, "utf8"),
      overflowed: true,
      artifactRetained: true,
    };
  } catch {
    const hint = `\n\nOutput exceeded ${visibleMaximum} characters and could not be retained within artifact bounds.`;
    const text = truncateWithHint(complete, visibleMaximum, hint);
    return {
      text,
      isError: true,
      visibleChars: text.length,
      visibleBytes: Buffer.byteLength(text, "utf8"),
      overflowed: true,
      artifactRetained: false,
    };
  }
};
