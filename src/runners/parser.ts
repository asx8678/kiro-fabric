import { Ajv } from "ajv/dist/ajv.js";
import { FabricError } from "../errors.js";
import { loadPrompt } from "../prompts.js";
const begin = "FABRIC_RESULT_BEGIN", end = "FABRIC_RESULT_END";
export const stripAnsi = (s: string): string => s.replace(/[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "").replace(/\r/g, "");
export function parseFramed(stdout: string, schema?: Record<string, unknown>, maxChars = 16000): unknown {
 const clean = stripAnsi(stdout).replace(/FABRIC_?RESULT_?BEGIN/g, begin).replace(/FABRIC_?RESULT_?END/g, end); const finish = clean.lastIndexOf(end); if (finish < 0) throw new FabricError("INVALID_AI_OUTPUT", "Missing FABRIC_RESULT_END frame"); const start = clean.lastIndexOf(begin, finish); if (start < 0) throw new FabricError("INVALID_AI_OUTPUT", "Missing FABRIC_RESULT_BEGIN frame"); const raw = clean.slice(start + begin.length, finish).trim().replace(/^>\s?/gm, ""); if (raw.length > maxChars) throw new FabricError("INVALID_AI_OUTPUT", `AI output exceeds ${maxChars} characters`);
 let value: unknown; try { value = JSON.parse(raw); } catch (e) { throw new FabricError("INVALID_AI_OUTPUT", `Invalid framed JSON: ${(e as Error).message}`); }
 if (schema) { const ajv = new Ajv({ allErrors: true, strict: false }); const valid = ajv.validate(schema, value); if (!valid) throw new FabricError("INVALID_AI_OUTPUT", "AI output does not match schema", ajv.errors); }
 return value;
}
export const WORKER_ENVELOPE_VERSION = 1;
export function framePrompt(request: { instruction: string; context: string; schema?: Record<string, unknown> }): string {
 const envelope = { version: WORKER_ENVELOPE_VERSION, operationalInstruction: request.instruction, untrustedContext: request.context, outputSchema: request.schema ?? {} };
 return `${loadPrompt("worker-agent").trimEnd()}\n\nFABRIC_REQUEST_V1_BEGIN\n${JSON.stringify(envelope)}\nFABRIC_REQUEST_V1_END\nReturn exactly:\nFABRIC_RESULT_BEGIN\n<valid JSON only>\nFABRIC_RESULT_END`;
}