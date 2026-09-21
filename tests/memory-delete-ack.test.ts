import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeFabricConfig } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { KiroMemoryProvider } from "../src/kiro/memory-provider.js";
import { projectFabricExecutionText } from "../src/kiro/projection.js";
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });

describe("memory.delete end-to-end publication acknowledgement", () => {
  it.each(["cleanup", "aborted", "timed_out"] as const)("preserves delete proof after %s without payload or cause", async (fault) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-delete-ack-")); roots.push(root);
    const provider = new KiroMemoryProvider({ cwd: root, root: path.join(root, "memory"), maxEntries: 8, maxValueChars: 1000 });
    const context = { cwd: root };
    await provider.invoke("set", { key: "PRIVATE-key", value: "PRIVATE-value" }, context);
    const registry = new ActionRegistry(); registry.register(provider);
    const service = new FabricExecutionService(registry, normalizeFabricConfig({ executor: { timeoutMs: 5000 } }), root);
    const controller = new AbortController(); const unlink = fs.unlinkSync, rmdir = fs.rmdirSync;
    let publications = 0;
    vi.spyOn(fs, "unlinkSync").mockImplementation((target) => {
      unlink(target);
      if (path.basename(String(target)) === "owner.json") return;
      publications++;
      if (fault === "aborted") controller.abort(new Error("PRIVATE abort reason"));
      if (fault === "timed_out") vi.spyOn(performance, "now").mockReturnValue(Number.MAX_SAFE_INTEGER);
    });
    if (fault === "cleanup") vi.spyOn(fs, "rmdirSync").mockImplementation((target) => {
      if (String(target).endsWith(".kiro-fabric-mutation-lock")) throw new Error("PRIVATE cleanup cause");
      rmdir(target);
    });
    try {
      const result = await service.execute({ code: "return await memory.delete({key:'PRIVATE-key'})", signal: controller.signal, approver: { async approve() {} } });
      expect(result.status).toBe(fault === "cleanup" ? "failed" : fault);
      expect(result.audits[0]).toMatchObject({ ref: "memory.delete", success: false, commitAcknowledgement: { version: 1, operation: "delete" } });
      expect(publications).toBe(1);
      expect(JSON.stringify(result.audits[0]?.commitAcknowledgement)).not.toContain("PRIVATE");
      const text = projectFabricExecutionText({ result: { ...result, error: "Fabric execution failed" }, resultFormat: "json", maxOutputChars: 20000, writeArtifact: () => "unused" }).text;
      expect(text).toContain("known committed although acknowledgement failed");
      expect(text).toContain('"operation":"delete"');
      expect(text.slice(text.indexOf("Completed nested calls"))).not.toContain("PRIVATE");
      vi.restoreAllMocks();
      expect(await provider.invoke("get", { key: "PRIVATE-key" }, context)).toMatchObject({ found: false });
      expect(await provider.invoke("delete", { key: "PRIVATE-key" }, context)).toEqual({ key: "PRIVATE-key", deleted: false });
      await expect(provider.invoke("set", { key: "next", value: true }, context)).resolves.toMatchObject({ value: true });
    } finally { vi.restoreAllMocks(); await service.close(); }
  });
});
