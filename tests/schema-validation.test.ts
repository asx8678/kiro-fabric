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

describe("bounded schema validation properties", () => {
  const seeded = (seed: number) => {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  };
  const SECRET = "s3cret-token-value";
  const makeInstance = (next: () => number): Record<string, unknown> => {
    const instance: Record<string, unknown> = {};
    if (next() < 0.7) instance.name = `plain-${Math.floor(next() * 1e6)}`;
    if (next() < 0.5) instance.nested = { secret: SECRET, count: Math.floor(next() * 100) };
    if (next() < 0.3) instance.extra = SECRET;
    return instance;
  };
  const makeSchema = (next: () => number): Record<string, unknown> => {
    const schema: Record<string, unknown> = { type: "object" };
    const properties: Record<string, unknown> = { name: { type: "string", maxLength: 20 } };
    if (next() < 0.5) properties.count = { type: "number", minimum: 0, maximum: 99 };
    if (next() < 0.4) schema.properties = properties;
    if (next() < 0.4) schema.additionalProperties = false;
    if (next() < 0.2) schema.required = ["name"];
    return schema;
  };

  it("never throws on random bounded schemas and never echoes instance secrets", () => {
    const next = seeded(0xabc);
    for (let index = 0; index < 200; index++) {
      const schema = makeSchema(next);
      const instance = makeInstance(next);
      const result = validateSchemaValue(schema, instance);
      expect(["valid", "invalid", "unavailable"]).toContain(result.status);
      if (result.status === "invalid") {
        expect(result.message).not.toContain(SECRET);
        expect(result.message.length).toBeLessThanOrEqual(2_001);
      }
    }
  });

  it("keeps verdicts deterministic across repeated evaluation", () => {
    const next = seeded(0xabc);
    for (let index = 0; index < 50; index++) {
      const schema = makeSchema(next);
      const instance = makeInstance(next);
      const first = validateSchemaValue(schema, instance);
      for (let repeat = 0; repeat < 3; repeat++) expect(validateSchemaValue(schema, instance)).toEqual(first);
    }
  });
});
