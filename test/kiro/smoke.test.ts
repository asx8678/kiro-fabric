import { describe, it, expect } from "vitest";
import { KiroHeadlessRunner } from "../../src/runners/kiro.js";
const enabled = process.env.FABRIC_LITE_KIRO_SMOKE === "1";
describe.skipIf(!enabled)("real Kiro opt-in", () => {
  it("returns framed JSON", async () => {
    const runner = new KiroHeadlessRunner();
    const raw = await runner.run({
      instruction: 'Return {"ok":true}',
      context: "",
      role: "general",
      schema: { type: "object", required: ["ok"] },
      maxOutputChars: 1000,
      timeoutMs: 90000,
    });
    expect(raw.exitCode).toBe(0);
  }, 100000);
});
