import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { powerGuestDeclarations } from "../src/runtime/guest-types.js";
import { typeCheckFabricCode, typeCheckFabricCodeInWorker } from "../src/runtime/type-checker.js";

const roots: string[] = [];
afterEach(() => { while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });

const forbidden = [
  "import value from '/etc/passwd'; return value as any",
  "import value from '../secret'; return value as any",
  "import value from 'file:///etc/passwd'; return value as any",
  "import value from 'node:fs'; return value as any",
  "import value from '%2fetc%2fpasswd'; return value as any",
  "import value from './secret.js'; return value as any",
  "export { value } from './secret.js'; return null",
  "return await import('/etc/passwd') as any",
  "type Secret = import('/etc/passwd'); return null",
  "const value = require('/etc/passwd'); return value",
  "/// <reference path=\"/etc/passwd\" />\nreturn null",
  "declare module 'foreign' { export const x: string }\nreturn null",
];

describe("closed guest TypeScript compiler host", () => {
  it.each(forbidden)("rejects external syntax without path-dependent diagnostics: %s", (code) => {
    const result = typeCheckFabricCode(code, powerGuestDeclarations);
    expect(result.javascript).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toBe("Guest modules and external references are not allowed");
  });

  it("does not reveal whether an absolute host path exists", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-compiler-isolation-"));
    roots.push(root);
    const existing = path.join(root, "exists.ts");
    fs.writeFileSync(existing, "export default 'host secret'\n");
    const missing = path.join(root, "missing.ts");
    const messages = [existing, missing].map((target) => typeCheckFabricCode(
      `import value from ${JSON.stringify(target)}; return value as any`,
      powerGuestDeclarations,
    ).errors);
    expect(messages[0]).toEqual(messages[1]);
    expect(JSON.stringify(messages)).not.toContain("host secret");
  });

  it("terminates an aborted compiler worker before rejecting", async () => {
    const controller = new AbortController();
    const checking = typeCheckFabricCodeInWorker({ code: "return true", declarations: powerGuestDeclarations }, { signal: controller.signal });
    controller.abort(new Error("compiler cancelled"));
    await expect(checking).rejects.toThrow("compiler cancelled");
  });
});
