import { describe, expect, it } from "vitest";
import { schemaValidationMessage, validateSchemaValue } from "../src/schema-validation.js";

describe("bounded schema keyword positions", () => {
  it.each(["pattern", "if", "then", "anyOf", "properties"])("accepts ordinary property named %s but validates its value", (name) => {
    const schema = { type: "object", properties: { [name]: { type: "string", maxLength: 20 } }, required: [name], additionalProperties: false };
    expect(schemaValidationMessage(schema, { [name]: "literal" })).toBeUndefined();
    expect(schemaValidationMessage(schema, { [name]: 5 })).toBeTruthy();
    expect(schemaValidationMessage(schema, { extra: "no" })).toBeTruthy();
  });
  it.each([
    { type: "string", pattern: "(a+)+$" },
    { type: "object", properties: { pattern: { type: "string", pattern: ".*" } } },
    { type: "object", properties: { anyOf: { anyOf: [{ type: "string" }, { type: "number" }] } } },
    { type: "object", additionalProperties: { type: "string", pattern: ".*" } },
    { type: "object", $defs: { pattern: { type: "string", pattern: ".*" } } },
  ])("still delegates actual restricted keywords instead of evaluating them", (schema) => {
    expect(validateSchemaValue(schema, {})).toEqual({ status: "unavailable" });
    expect(schemaValidationMessage(schema, {})).toBe("Schema validator failed");
  });
  it("keeps graph/depth bounds authoritative", () => {
    const shared = { type: "string" };
    expect(validateSchemaValue({ type: "object", properties: { a: shared, b: shared } }, {})).toEqual({ status: "unavailable" });
    const cycle: any = { type: "object" }; cycle.properties = { self: cycle };
    expect(validateSchemaValue(cycle, {})).toEqual({ status: "unavailable" });
  });
});
