import { Ajv } from "ajv/dist/ajv.js";
import { FabricError } from "../errors.js";
import { redactSensitive } from "../redaction.js";
import { loadPrompt } from "../prompts.js";

const begin = "FABRIC_RESULT_BEGIN";
const end = "FABRIC_RESULT_END";
const MAX_DIAGNOSTIC_CHARS = 512;

export const stripAnsi = (s: string): string =>
  s
    .replace(
      /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/\#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
      "",
    )
    .replace(/\r/g, "");

function diagnosticHint(stdout: string): string {
  const safe = redactSensitive(stripAnsi(stdout)).replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
    "?",
  );
  if (safe.length <= MAX_DIAGNOSTIC_CHARS) return safe;
  const side = Math.floor((MAX_DIAGNOSTIC_CHARS - 32) / 2);
  return `${safe.slice(0, side)}… [${safe.length} chars total] …${safe.slice(-side)}`;
}

function framedError(message: string, stdout: string): FabricError {
  const hint = diagnosticHint(stdout);
  return new FabricError("INVALID_AI_OUTPUT", `${message}; output hint: ${JSON.stringify(hint)}`);
}

/** Format Ajv errors into actionable diagnostics with instancePath, message, and params. */
function formatSchemaErrors(
  errors: Array<Record<string, unknown>>,
): Array<{ instancePath: string; message: string; params: unknown; schemaPath?: string }> {
  return errors.map((err) => ({
    instancePath: String(err.instancePath ?? ""),
    message: String(err.message ?? "unknown error"),
    params: err.params ?? {},
    ...(err.schemaPath ? { schemaPath: String(err.schemaPath) } : {}),
  }));
}

/** Extract the last complete framed payload without throwing; undefined when frames are missing. */
export function extractFramed(stdout: string): string | undefined {
  const clean = stripAnsi(stdout)
    .replace(/FABRIC_?RESULT_?BEGIN/g, begin)
    .replace(/FABRIC_?RESULT_?END/g, end);
  const finish = clean.lastIndexOf(end);
  if (finish < 0) return undefined;
  const start = clean.lastIndexOf(begin, finish);
  if (start < 0) return undefined;
  return clean
    .slice(start + begin.length, finish)
    .trim()
    .replace(/^>\s?/gm, "");
}

export function parseFramed(
  stdout: string,
  schema?: Record<string, unknown>,
  maxChars = 16000,
): unknown {
  const raw = extractFramed(stdout);
  if (raw === undefined) {
    const clean = stripAnsi(stdout)
      .replace(/FABRIC_?RESULT_?BEGIN/g, begin)
      .replace(/FABRIC_?RESULT_?END/g, end);
    if (clean.lastIndexOf(end) < 0) throw framedError("Missing FABRIC_RESULT_END frame", stdout);
    throw framedError("Missing FABRIC_RESULT_BEGIN frame", stdout);
  }
  if (raw.length > maxChars)
    throw new FabricError("INVALID_AI_OUTPUT", `AI output exceeds ${maxChars} characters`);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw framedError(`Invalid framed JSON: ${detail.slice(0, 160)}`, raw);
  }
  if (schema) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const valid = ajv.validate(schema, value);
    if (!valid) {
      const details = formatSchemaErrors(
        (ajv.errors ?? []) as unknown as Array<Record<string, unknown>>,
      );
      throw new FabricError(
        "INVALID_AI_OUTPUT",
        `AI output does not match schema: ${details
          .slice(0, 5)
          .map((d) => `${d.instancePath || "/"}: ${d.message}`)
          .join("; ")}`,
        details.slice(0, 12),
      );
    }
  }
  return value;
}

export const WORKER_ENVELOPE_VERSION = 1;
export function framePrompt(request: {
  instruction: string;
  context: string;
  schema?: Record<string, unknown>;
}): string {
  const envelope = {
    version: WORKER_ENVELOPE_VERSION,
    operationalInstruction: request.instruction,
    untrustedContext: request.context,
    outputSchema: request.schema ?? {},
  };
  return `${loadPrompt("worker-agent").trimEnd()}\n\nFABRIC_REQUEST_V1_BEGIN\n${JSON.stringify(envelope)}\nFABRIC_REQUEST_V1_END\nReturn exactly:\nFABRIC_RESULT_BEGIN\n<valid JSON only>\nFABRIC_RESULT_END`;
}
