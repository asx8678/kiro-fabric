import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeFabricConfig } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { fabricGuestDeclarations } from "../src/runtime/guest-types.js";
import { shutdownFabricCompilerWorker, typeCheckFabricCode, typeCheckFabricCodeInWorker } from "../src/runtime/type-checker.js";

const roots: string[] = [];
afterEach(async () => { await shutdownFabricCompilerWorker(); while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });

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
    const result = typeCheckFabricCode(code, fabricGuestDeclarations);
    expect(result.javascript).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toBe("Guest modules and external references are not allowed");
  });

  it("rejects syntactically valid attempts to escape the generated wrapper", () => {
    const result = typeCheckFabricCode(
      "return null;\n}\n(globalThis as any).__fabricRun = () => '\"forged\"';\nasync function padding(): Promise<JsonValue> { return null",
      fabricGuestDeclarations,
    );
    expect(result.javascript).toBeUndefined();
    expect(result.errors).toEqual([{ line: 1, column: 1, message: "Guest code must remain inside the generated Fabric wrapper" }]);
  });

  it("does not reveal whether an absolute host path exists", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-compiler-isolation-"));
    roots.push(root);
    const existing = path.join(root, "exists.ts");
    fs.writeFileSync(existing, "export default 'host secret'\n");
    const missing = path.join(root, "missing.ts");
    const messages = [existing, missing].map((target) => typeCheckFabricCode(
      `import value from ${JSON.stringify(target)}; return value as any`,
      fabricGuestDeclarations,
    ).errors);
    expect(messages[0]).toEqual(messages[1]);
    expect(JSON.stringify(messages)).not.toContain("host secret");
  });

  it("keeps a real reused compiler alive while an unrelated service closes", async () => {
    const config = normalizeFabricConfig({ executor: { timeoutMs: 5_000 } });
    const a = new FabricExecutionService(new ActionRegistry(), config, "/workspace");
    const b = new FabricExecutionService(new ActionRegistry(), config, "/workspace");
    const options = { code: "return 42", approver: { async approve() {} } };
    try {
      expect((await b.execute(options)).value).toBe(42);
      const compiling = b.execute(options);
      await Promise.resolve(); // submit to the real reused worker before A closes
      await a.close();
      expect((await compiling).value).toBe(42);
    } finally { await Promise.all([a.close(), b.close()]); }
  });

  it("terminates an aborted compiler worker before rejecting", async () => {
    const controller = new AbortController();
    const checking = typeCheckFabricCodeInWorker({ code: "return true", declarations: fabricGuestDeclarations }, { signal: controller.signal });
    controller.abort(new Error("compiler cancelled"));
    await expect(checking).rejects.toThrow("compiler cancelled");
  });
});
