import { describe, expect, it, vi } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
import { createKiroArtifactStore, type KiroArtifactReadResult } from "../src/kiro/artifacts.js";
import { KiroPowerArtifactsProvider, type KiroArtifactCheckpointResult } from "../src/kiro/power/artifacts-provider.js";
import { projectFabricExecutionText } from "../src/kiro/projection.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { normalizeFabricConfig } from "../src/config.js";

const setup = (options = {}) => {
  const store = createKiroArtifactStore();
  const provider = new KiroPowerArtifactsProvider(store, options);
  const registry = new ActionRegistry(); registry.register(provider);
  const context = { cwd: process.cwd(), audits: [], maxResultChars: 400, approve: vi.fn(async (_action: unknown, _args: unknown) => {}) };
  return { store, provider, registry, context };
};
describe("artifact recovery", () => {
  it("pages escaped envelopes and Unicode with forward progress and compatible fields", async () => {
    const { store, registry, context } = setup();
    const original = ('\\\"\n\u0000😀漢').repeat(1000);
    const id = store.write(original);
    let offset = 0, recovered = "";
    for (;;) {
      const page = await registry.invoke("artifacts.read", { id, offset }, context) as KiroArtifactReadResult;
      expect(JSON.stringify(page).length).toBeLessThanOrEqual(context.maxResultChars);
      expect(page.nextOffset).toBeGreaterThan(offset);
      expect(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u.test(page.text)).toBe(false);
      recovered += page.text; offset = page.nextOffset;
      if (page.done) break;
    }
    expect(recovered).toBe(original);
    context.maxResultChars = 10;
    await expect(registry.invoke("artifacts.read", { id }, context)).rejects.toThrow("metadata");
    await registry.close(); store.close();
  });
  it("rejects impossible Unicode pages rather than looping or splitting", () => {
    const store = createKiroArtifactStore(); const id = store.write("😀x");
    expect(() => store.read(id, 0, 1)).toThrow("Unicode");
    expect(() => store.read(id, 1, 2)).toThrow("Unicode");
    expect(store.read(id, 0, 2).nextOffset).toBe(2); store.close();
  });
  it("requires approval before reservation, records handles only, and reads without replay", async () => {
    const { store, registry, context } = setup();
    const record = vi.fn(); const reserve = vi.fn(() => record);
    const scoped = { ...context, checkpoints: { reserve } };
    scoped.approve.mockRejectedValueOnce(new Error("denied"));
    await expect(registry.invoke("artifacts.checkpoint", { value: { secret: "evidence" } }, scoped)).rejects.toThrow("denied");
    expect(reserve).not.toHaveBeenCalled();
    const result = await registry.invoke("artifacts.checkpoint", { value: { secret: "evidence" }, label: "chosen" }, scoped) as KiroArtifactCheckpointResult;
    expect(record).toHaveBeenCalledExactlyOnceWith({ id: result.id, label: "chosen" });
    expect(result.retrieval).toEqual({ ref: "artifacts.read", args: { id: result.id }, encoding: "json", ephemeral: true });
    expect(() => store.read(result.id)).toThrow("unavailable");
    const page = await registry.invoke("artifacts.read", { id: result.id }, scoped) as KiroArtifactReadResult;
    expect(JSON.parse(page.text)).toEqual({ label: "chosen", value: { secret: "evidence" } });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(scoped.approve.mock.calls[1]?.[0]).toMatchObject({ risk: "write", effect: { kind: "emission" } });
    await expect(registry.invoke("artifacts.checkpoint", { value: 1, label: "x".repeat(81) }, scoped)).rejects.toThrow();
    await registry.close(); store.close();
  });
  it("enforces checkpoint expiration, quotas and pre-emission acknowledgement budget", async () => {
    let now = 0;
    const { store, registry, context } = setup({ now: () => now, ttlMs: 10, maxArtifacts: 1, maxArtifactChars: 100 });
    const checkpoint = async (value: unknown) => await registry.invoke("artifacts.checkpoint", { value }, context) as KiroArtifactCheckpointResult;
    const first = await checkpoint("first"); now++;
    const second = await checkpoint("second");
    await expect(registry.invoke("artifacts.read", { id: first.id }, context)).rejects.toThrow("expired");
    await expect(checkpoint("x".repeat(101))).rejects.toThrow("bounds");
    now += 11;
    await expect(registry.invoke("artifacts.read", { id: second.id }, context)).rejects.toThrow("expired");
    const reserve = vi.fn(() => vi.fn());
    await expect(registry.invoke("artifacts.checkpoint", { value: 1 }, { ...context, maxResultChars: 10, checkpoints: { reserve } })).rejects.toThrow();
    expect(reserve).not.toHaveBeenCalled();
    await registry.close(); store.close();
  });
  it("mounts typed checkpoints and paging, retaining only IDs after an outer failure", async () => {
    const { store, registry } = setup();
    const service = new FabricExecutionService(registry, normalizeFabricConfig({ executor: { timeoutMs: 10000, maxNestedResultChars: 1000 } }), process.cwd());
    const approver = { async approve() {} };
    try {
      const result = await service.execute({ code: 'await artifacts.checkpoint({value:{private:"chosen-evidence"},label:"private-label"}); throw new Error("later failure");', approver });
      expect(result).toMatchObject({ status: "failed", checkpoints: [{ id: expect.stringMatching(/^ka_[a-f0-9]{48}$/u) }] });
      const id = result.checkpoints![0]!.id;
      expect(() => store.read(id)).toThrow("unavailable");
      const projected = projectFabricExecutionText({ result, resultFormat: "json", maxOutputChars: 2000, writeArtifact: text => store.write(text) });
      expect(projected.text).toContain(id);
      expect(projected.text).not.toContain("private-label");
      expect(projected.text).not.toContain("chosen-evidence");
      const read = await service.execute({ code: 'const page = await artifacts.read({id:payloads.id,limit:400}); return {text:page.text,done:page.done,next:page.nextOffset,total:page.totalChars};', payloads: { id }, approver });
      expect(read.success, read.error).toBe(true);
      expect(read.value).toMatchObject({ done: true, text: JSON.stringify({ label: "private-label", value: { private: "chosen-evidence" } }) });
      const quota = await service.execute({ code: 'for (let i=0;i<9;i++) await artifacts.checkpoint({value:i}); return null;', approver });
      expect(quota.success).toBe(false);
      expect(quota.error).toContain("checkpoint quota");
      expect(quota.checkpoints).toHaveLength(8);
      const fresh = await service.execute({ code: 'return await artifacts.checkpoint({value:"new execution"});', approver });
      expect(fresh.success, fresh.error).toBe(true);
    } finally { await service.close(); store.close(); }
  });

  it("retains canonical accepted JSON when formatting and logs exceed the cap", () => {
    const store = createKiroArtifactStore({ maxArtifactChars: 2000 });
    const value = { rows: Array.from({ length: 60 }, (_, i) => ({ i, text: "data" })) };
    const write = vi.fn((text: string) => store.write(text));
    const projection = projectFabricExecutionText({ result: { success: true, status: "succeeded", value, logs: ["x".repeat(3000)], audits: [], elapsedMs: 1, effectiveTimeoutMs: 100 }, resultFormat: "json", maxOutputChars: 500, writeArtifact: write });
    expect(projection).toMatchObject({ retention: "canonical", artifactRetained: true, isError: false });
    expect(JSON.parse(store.read(projection.artifactId!).text)).toEqual(value);
    expect(write).toHaveBeenCalledTimes(2); store.close();
  });
  it.each([true, false])("surfaces only opaque checkpoint IDs (success=%s)", (success) => {
    const id = `ka_${"a".repeat(48)}`;
    const projection = projectFabricExecutionText({ result: { success, status: success ? "succeeded" : "failed", value: "done", error: "outer failure", logs: [], audits: [], elapsedMs: 1, effectiveTimeoutMs: 100, checkpoints: [{ id, label: "secret-label" }, { id: "secret-invalid-id" }] }, resultFormat: "json", maxOutputChars: 1000, writeArtifact: vi.fn() });
    expect(projection.text).toContain(id);
    expect(projection.text).not.toContain("secret");
    expect(projection.checkpointIds).toEqual([id]);
  });
});
