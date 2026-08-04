import { readFile } from "node:fs/promises";
import { FabricError } from "../errors.js";

export const MAX_PROGRAM_CHARS = 100_000;

function assertWithinProgramLimit(value: string): string {
  if (value.length > MAX_PROGRAM_CHARS) {
    throw new FabricError(
      "TYPECHECK_FAILED",
      `Program exceeds ${MAX_PROGRAM_CHARS} characters while reading input`,
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
