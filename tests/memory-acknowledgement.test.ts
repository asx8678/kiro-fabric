import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeFabricConfig } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService, type FabricExecutionResult } from "../src/execution-service.js";
import { KiroMemoryProvider } from "../src/kiro/memory-provider.js";
import { projectFabricExecutionText } from "../src/kiro/projection.js";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });

const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-memory-ack-"));
  roots.push(root);
  const registry = new ActionRegistry();
  registry.register(new KiroMemoryProvider({ cwd: process.cwd(), root, maxEntries: 8, maxValueChars: 1_000 }));
  const service = new FabricExecutionService(registry, normalizeFabricConfig({ executor: { timeoutMs: 5_000 } }), process.cwd());
  return { service };
};

const projected = (result: Awaited<ReturnType<FabricExecutionService["execute"]>>) => projectFabricExecutionText({
  result, resultFormat: "json", maxOutputChars: 20_000, writeArtifact: () => "unused",
});

describe("memory committed acknowledgement propagation", () => {
  it.each(["aborted", "timed_out"] as const)("survives a generic %s execution result without leaking payload or cause", async (kind) => {
    const { service } = fixture();
    const controller = new AbortController();
    const original = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      original(from, to);
      if (kind === "aborted") controller.abort(new Error("PRIVATE abort reason"));
      else vi.spyOn(performance, "now").mockReturnValue(Number.MAX_SAFE_INTEGER);
    });
    try {
      const result = await service.execute({
        code: "return await memory.set({ key: 'PRIVATE-key', value: 'PRIVATE-value' })",
        approver: { async approve() {} }, signal: controller.signal,
      });
      expect(result.status).toBe(kind);
      expect(result.audits[0]).toMatchObject({
        ref: "memory.set", success: false,
        commitAcknowledgement: { version: 1, operation: "set" },
      });
      const projection = projected(result).text;
      expect(projection).toContain("known committed although acknowledgement failed");
      expect(projection).toContain('"operation":"set"');
      expect(projection).not.toContain("PRIVATE-key");
      expect(projection).not.toContain("PRIVATE-value");
      expect(projection).not.toContain("PRIVATE abort reason");
    } finally { await service.close(); }
  });

  it("propagates cleanup-failure commit proof through provider, registry, execution, and projection", async () => {
    const { service } = fixture();
    const original = fs.rmdirSync;
    vi.spyOn(fs, "rmdirSync").mockImplementation((target) => {
      if (String(target).endsWith(".kiro-fabric-mutation-lock")) throw new Error("PRIVATE cleanup cause");
      return original(target);
    });
    try {
      const result = await service.execute({
        code: "return await memory.set({ key: 'PRIVATE-key', value: 'PRIVATE-value' })",
        approver: { async approve() {} },
      });
      expect(result.audits[0]?.commitAcknowledgement).toEqual({ version: 1, operation: "set" });
      const projection = projected({ ...result, error: "Fabric execution failed" }).text;
      expect(projection).toContain("known committed although acknowledgement failed");
      const notice = projection.slice(projection.indexOf("Completed nested calls"));
      expect(notice).not.toMatch(/PRIVATE|cleanup cause/);
    } finally { vi.restoreAllMocks(); await service.close(); }
  });

  it("uses the unsampled committed notice when the acknowledgement sits in the omitted middle", () => {
    const base = Date.now();
    const audits = Array.from({ length: 12 }, (_, index) => ({
      ref: `memory.set#${index}`,
      nestedToolCallId: `call-${index}`,
      startedAt: base + index,
      endedAt: base + index + 1,
      success: index !== 11,
      // Index 5 is omitted from the first-4/last-4 failure sample (0-3, 8-11).
      ...(index === 5 ? { commitAcknowledgement: { version: 1 as const, operation: "set" as const } } : {}),
    }));
    const result = {
      status: "failed",
      success: false,
      error: "outer failure",
      value: undefined,
      logs: [],
      audits,
      elapsedMs: 12,
      effectiveTimeoutMs: 100,
    } satisfies FabricExecutionResult;
    const text = projected(result).text;
    expect(text).toContain("A memory mutation is known committed although acknowledgement failed (not shown in the sample); read the affected memory key before retrying.");
    expect(text).not.toContain("A listed memory mutation");
  });
});
