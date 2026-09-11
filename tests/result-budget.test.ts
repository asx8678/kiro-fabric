import { describe, expect, it } from "vitest";
import { ActionRegistry, type FabricCallAudit } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { normalizeFabricConfig } from "../src/config.js";
import { fabricJsonText, jsonStringPrefix } from "../src/runtime/json-budget.js";

function fixture(value: unknown) {
  const registry = new ActionRegistry(); let calls = 0;
  const descriptor = { name: "read", description: "inert result", risk: "read" as const, inputSchema: { type: "object", additionalProperties: false } };
  registry.register({ name: "fixture", description: "inert", async list() { return [descriptor]; }, async describe() { return descriptor; }, async invoke() { calls++; return value; } });
  const audits: FabricCallAudit[] = [];
  return { registry, audits, calls: () => calls, call: (maximum: number) => registry.invoke("fixture.read", {}, { cwd: "/workspace", audits, maxResultChars: maximum, approve: async () => {} }) };
}

describe("escaped nested-result envelopes", () => {
  it.each(["plain", '"\\\n\t', "🐈😀", String.fromCharCode(0xd800, 65, 0xdc00), Array.from({length:32},(_,i)=>String.fromCharCode(i)).join("")])("matches JSON.stringify at every prefix budget: %j", text => {
    const prefixes = [""]; for (const point of text) prefixes.push(prefixes.at(-1)! + point);
    for (let budget = 0; budget <= JSON.stringify(text).length; budget++) {
      const expected = prefixes.filter(p => JSON.stringify(p).length - 2 <= budget).at(-1)!;
      expect(jsonStringPrefix(text, budget)).toBe(expected);
    }
    expect(() => jsonStringPrefix(text, -1)).toThrow();
  });

  it.each(['"'.repeat(1500), '\\'.repeat(1500), '\n\t'.repeat(1500), '🐈'.repeat(1500)])("bounds complete envelopes and preserves audit sizes", async text => {
    const value = { text }, f = fixture(value);
    try {
      const result = await f.call(1000) as {fabricTruncated:boolean;originalChars:number;preview:string};
      expect(result.fabricTruncated).toBe(true);
      expect(fabricJsonText(result, 1000).length).toBeLessThanOrEqual(1000);
      expect(JSON.stringify(value).startsWith(result.preview)).toBe(true);
      expect(f.audits[0]).toMatchObject({success:true,resultChars:JSON.stringify(value).length,resultTruncated:true});
      expect(f.calls()).toBe(1);
    } finally { await f.registry.close(); }
  });

  it("preserves fitting results and rejects an impossible metadata budget", async () => {
    const value = { ok: true }, f = fixture(value);
    try {
      expect(await f.call(JSON.stringify(value).length)).toBe(value);
      await expect(f.call(1)).rejects.toThrow("truncation metadata");
    } finally { await f.registry.close(); }
  });

  it.each([1000, 2000000])("delivers oversized quote-rich results through actual checked execution at budget %i without replay", async maximum => {
    const value = { text: '"'.repeat(maximum), content: [{ type: "text", text: "small" }] }, f = fixture(value);
    const service = new FabricExecutionService(f.registry, normalizeFabricConfig({executor:{maxNestedResultChars:maximum}}), "/workspace");
    try {
      const result = await service.execute({code:'return await tools.call({ref:"fixture.read",args:{}});',approver:{async approve(){}}});
      expect(result.typeErrors).toBeUndefined();
      expect(result.success, result.error).toBe(true);
      expect(result.value).toMatchObject({fabricTruncated:true,originalChars:JSON.stringify(value).length});
      expect(fabricJsonText(result.value, maximum).length).toBeLessThanOrEqual(maximum);
      expect(result.audits).toHaveLength(1); expect(f.calls()).toBe(1);
    } finally { await service.close(); }
  });
});
