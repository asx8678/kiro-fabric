import type { FabricExecResultFormat } from "../kernel/fabric-exec-contract.js";
import type { FabricExecutionResult } from "../execution-service.js";

export interface KiroProjectionResult { text: string; isError: boolean; artifactId?: string }
const stringify = (value: unknown, format: FabricExecResultFormat): string => {
  if (format === "text" && typeof value === "string") return value;
  return JSON.stringify(value, null, format === "json" ? 2 : undefined) ?? "null";
};

export const projectFabricExecutionText = (options: {
  result: FabricExecutionResult;
  resultFormat: FabricExecResultFormat;
  maxOutputChars: number;
  writeArtifact(content: string): string;
  normalizationDiagnostics?: readonly { field: string; repair: string }[];
}): KiroProjectionResult => {
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
  const complete = `${body}${diagnostics}${logs}`;
  if (complete.length <= options.maxOutputChars) return { text: complete, isError: !options.result.success };
  try {
    const artifactId = options.writeArtifact(complete);
    const hint = `\n\nOutput exceeded ${options.maxOutputChars} characters. Full result is artifact ${artifactId}; read it with await artifacts.read({ id: ${JSON.stringify(artifactId)} }).`;
    return {
      text: `${complete.slice(0, Math.max(1, options.maxOutputChars - hint.length))}${hint}`,
      isError: !options.result.success,
      artifactId,
    };
  } catch {
    const hint = `\n\nOutput exceeded ${options.maxOutputChars} characters and could not be retained within artifact bounds.`;
    return {
      text: `${complete.slice(0, Math.max(1, options.maxOutputChars - hint.length))}${hint}`,
      isError: true,
    };
  }
};
