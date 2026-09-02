import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  fabricExecInputSchema,
  fabricExecInputSchemaJson,
  prepareFabricExecArgumentsWithDiagnostics,
} from "../src/kernel/fabric-exec-contract.js";
import { powerGuestDeclarations } from "../src/runtime/guest-types.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";

describe("fabric_exec contract", () => {
  it("accepts only the canonical payload map", () => {
    const input = { code: "return payloads.value", payloads: { value: "ok" } };
    expect(Value.Check(fabricExecInputSchema, input)).toBe(true);
    const removedAlias = `str${"ings"}`;
    expect(Value.Check(fabricExecInputSchema, { code: "return 1", [removedAlias]: { value: "no" } })).toBe(false);
    expect(Object.keys(fabricExecInputSchemaJson().properties as object)).toEqual(["code", "payloads", "resultFormat", "timeoutMs"]);
  });

  it("conservatively repairs encoded string maps before validation", () => {
    const once = prepareFabricExecArgumentsWithDiagnostics({ code: "return payloads.a", payloads: JSON.stringify({ a: "b" }) });
    expect(once.value).toEqual({ code: "return payloads.a", payloads: { a: "b" } });
    expect(once.diagnostics[0]?.repair).toBe("json-string-map");
    const twice = prepareFabricExecArgumentsWithDiagnostics({ code: "return payloads.a", payloads: JSON.stringify(JSON.stringify({ a: "b" })) });
    expect(twice.value).toEqual({ code: "return payloads.a", payloads: { a: "b" } });
    expect(twice.diagnostics[0]?.repair).toBe("double-encoded-json-string-map");
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
      powerGuestDeclarations,
    );
    expect(invalidCall.errors.some((error) => error.message.includes("not assignable"))).toBe(true);
    const invalidEmptyArgs = typeCheckFabricCode(
      "return await memory.index(1);",
      powerGuestDeclarations,
    );
    expect(invalidEmptyArgs.errors.some((error) => error.message.includes("not assignable"))).toBe(true);
    const nonexistentTimer = typeCheckFabricCode(
      "setTimeout(() => undefined, 1); return true;",
      powerGuestDeclarations,
    );
    expect(nonexistentTimer.errors.some((error) => error.message.includes("Cannot find name 'setTimeout'"))).toBe(true);
  });
});
