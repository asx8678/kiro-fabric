import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  fabricExecInputSchema,
  fabricExecInputSchemaJson,
  prepareFabricExecArgumentsWithDiagnostics,
} from "../src/kernel/fabric-exec-contract.js";
import { fabricGuestDeclarations } from "../src/runtime/guest-types.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";

describe("fabric_exec contract", () => {
  it("accepts only the canonical payload map", () => {
    const input = { code: "return payloads.value", payloads: { value: "ok" } };
    expect(Value.Check(fabricExecInputSchema, input)).toBe(true);
    const removedAlias = `str${"ings"}`;
    expect(Value.Check(fabricExecInputSchema, { code: "return 1", [removedAlias]: { value: "no" } })).toBe(false);
    expect(Object.keys(fabricExecInputSchemaJson().properties as object)).toEqual(["code", "payloads", "resultFormat", "timeoutMs"]);
  });

  it("rejects encoded payload maps without repair", () => {
    for (const payloads of [JSON.stringify({ a: "b" }), JSON.stringify(JSON.stringify({ a: "b" }))]) {
      const prepared = prepareFabricExecArgumentsWithDiagnostics({ code: "return payloads.a", payloads });
      expect(prepared.value).toEqual({ code: "return payloads.a", payloads });
      expect(prepared.diagnostics).toEqual([]);
      expect(Value.Check(fabricExecInputSchema, prepared.value)).toBe(false);
    }
  });

  it("does not rewrite malformed payload input or guest code", () => {
    const original = { code: "return 'unchanged'", payloads: "not-json" };
    const prepared = prepareFabricExecArgumentsWithDiagnostics(original);
    expect(prepared.value).toEqual(original);
    expect(prepared.diagnostics).toEqual([]);
    expect(Value.Check(fabricExecInputSchema, prepared.value)).toBe(false);
  });

  it("strictly checks the documented guest API and declares no timer fallback", () => {
    const invalidCall = typeCheckFabricCode(
      "return await memory.set({ key: 1, value: true });",
      fabricGuestDeclarations,
    );
    expect(invalidCall.errors.some((error) => error.message.includes("not assignable"))).toBe(true);
    const invalidEmptyArgs = typeCheckFabricCode(
      "return await memory.index(1);",
      fabricGuestDeclarations,
    );
    expect(invalidEmptyArgs.errors.some((error) => error.message.includes("not assignable"))).toBe(true);
    const nonexistentTimer = typeCheckFabricCode(
      "setTimeout(() => undefined, 1); return true;",
      fabricGuestDeclarations,
    );
    expect(nonexistentTimer.errors.some((error) => error.message.includes("Cannot find name 'setTimeout'"))).toBe(true);
  });

  it("rejects every guest module and external-reference form without resolving it", () => {
    const probes = [
      `import value from "/definitely/secret.ts"; return value;`,
      `import value from "./secret.js"; return value;`,
      `export { payloads }; return null;`,
      `return await import("file:///definitely/secret.ts");`,
      `type Secret = import("package-name").Secret; return null;`,
      `const value = require("%2fdefinitely%2fsecret.ts"); return value;`,
      `/// <reference path="/definitely/secret.ts" />\nreturn null;`,
      `declare module "package-name" { export const secret: string }\nreturn null;`,
    ];
    for (const probe of probes) {
      const result = typeCheckFabricCode(probe, fabricGuestDeclarations);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.message).toBe("Guest modules and external references are not allowed");
      expect(result.errors[0]?.message).not.toContain("secret.ts");
    }
  });
});
