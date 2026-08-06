import { readFile } from "node:fs/promises";
import { FabricError } from "../errors.js";

export const MAX_PROGRAM_CHARS = 100_000;
export const MAX_PAYLOADS_CHARS = 200_000;
const PAYLOAD_KEY = /^[A-Za-z0-9._-]{1,64}$/;

function assertWithinProgramLimit(value: string): string {
  if (value.length > MAX_PROGRAM_CHARS) {
    throw new FabricError(
      "TYPECHECK_FAILED",
      `Program exceeds ${MAX_PROGRAM_CHARS} characters while reading input`,
    );
  }
  return value;
}

/**
 * Load named payloads (--payloads file): a JSON object of string values,
 * exposed to programs as fabric.payloads. Payloads stay outside the checked
 * program body so large text does not inflate type-check input or diagnostics.
 */
export async function payloadsInput(file: string): Promise<Record<string, string>> {
  const raw = assertWithinPayloadLimit(await readFile(file, "utf8"));
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new FabricError(
      "TYPECHECK_FAILED",
      `Payloads file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new FabricError(
      "TYPECHECK_FAILED",
      "Payloads file must be a JSON object of string values",
    );
  const payloads: Record<string, string> = {};
  let total = 0;
  for (const [key, value] of Object.entries(parsed)) {
    if (!PAYLOAD_KEY.test(key))
      throw new FabricError(
        "TYPECHECK_FAILED",
        `Invalid payload key ${JSON.stringify(key)}: use 1-64 chars of [A-Za-z0-9._-]`,
      );
    if (typeof value !== "string")
      throw new FabricError("TYPECHECK_FAILED", `Payload ${JSON.stringify(key)} must be a string`);
    total += key.length + value.length;
    if (total > MAX_PAYLOADS_CHARS)
      throw new FabricError(
        "TYPECHECK_FAILED",
        `Payloads exceed ${MAX_PAYLOADS_CHARS} characters in total`,
      );
    payloads[key] = value;
  }
  return payloads;
}

function assertWithinPayloadLimit(value: string): string {
  if (value.length > MAX_PAYLOADS_CHARS) {
    throw new FabricError(
      "TYPECHECK_FAILED",
      `Payloads exceed ${MAX_PAYLOADS_CHARS} characters while reading input`,
    );
  }
  return value;
}

export async function programInput(file?: string): Promise<string> {
  if (file) return assertWithinProgramLimit(await readFile(file, "utf8"));
  if (process.stdin.isTTY) throw new Error("Provide --file or pipe a program on stdin");

  let value = "";
  for await (const chunk of process.stdin) {
    value += String(chunk);
    assertWithinProgramLimit(value);
  }
  return value;
}
