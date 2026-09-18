import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContinuityStore, type ContinuityStoreOptions } from "../src/continuity/store.js";
import { renderContinuity } from "../src/continuity/render.js";
import { fabricCommitAcknowledgement } from "../src/protocol.js";

const roots: string[] = [];
const defaults: ContinuityStoreOptions = { maxTasks: 32, maxTaskBytes: 131072, maxTotalBytes: 4194304 };
function fixture(options: Partial<ContinuityStoreOptions> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-continuity-store-")); roots.push(root);
  return { root, file: path.join(root, "state.json"), context: { cwd: root }, store: new ContinuityStore(root, { ...defaults, ...options }) };
}
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const facts = [{ kind: "decision", text: "A caller-declared decision" }];
describe("durable continuity storage", () => {
  it("retains exact original records across 100 publications and independent store instances", async () => {
    const f = fixture(); let saved = await f.store.create("Original goal", ["Never discard this constraint"], f.context);
    for (let index = 0; index < 100; index++) {
      saved = await f.store.checkpoint(saved.taskId, saved.revision, `request-${index}`, [{ kind: "next-step", text: `Step ${index}` }], f.context);
      renderContinuity(await f.store.read(saved.taskId, saved.revision, f.context), 1024, 1800);
    }
    const second = new ContinuityStore(f.root, defaults);
    const source = await second.expandSource(saved.taskId, saved.revision, saved.hash, f.context);
    expect(source.task.records).toHaveLength(102);
    expect(source.task.records[0]!.text).toBe("Original goal");
    expect(source.task.records[1]!.text).toBe("Never discard this constraint");
    expect(source.task.records[101]!.text).toBe("Step 99");
    expect(JSON.stringify(source)).not.toContain("DETERMINISTIC CONTINUITY");
    expect(fs.statSync(f.file).mode & 0o777).toBe(0o600);
  });
  it("deduplicates exactly the same publication request, including after subsequent checkpoints", async () => {
    const f = fixture(), initial = await f.store.create("Goal", undefined, f.context);
    const first = await f.store.checkpoint(initial.taskId, initial.revision, "same-request", facts, f.context);
    const later = await f.store.checkpoint(first.taskId, first.revision, "later-request", facts, f.context);
    const before = fs.readFileSync(f.file, "utf8");
    const replay = await f.store.checkpoint(initial.taskId, initial.revision, "same-request", facts, f.context);
    expect(replay).toMatchObject({ revision: later.revision, hash: later.hash, alreadyPublished: true, publishedThroughSequence: 2, admittedRecords: 3 });
    expect(fs.readFileSync(f.file, "utf8")).toBe(before);
    await expect(f.store.checkpoint(initial.taskId, initial.revision, "same-request", [{ kind: "decision", text: "different" }], f.context)).rejects.toThrow("request ID conflict");
    await expect(f.store.checkpoint(initial.taskId, later.revision, "same-request", facts, f.context)).rejects.toThrow("request ID conflict");
  });
  it("uses actual global state revisions and gives concurrent writers one CAS winner", async () => {
    const f = fixture(), initial = await f.store.create("First", undefined, f.context);
    await f.store.create("Other task", undefined, f.context);
    const second = new ContinuityStore(f.root, defaults);
    const outcomes = await Promise.allSettled([
      f.store.checkpoint(initial.taskId, initial.revision, "writer-a", facts, f.context),
      second.checkpoint(initial.taskId, initial.revision, "writer-b", facts, f.context),
    ]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(1);
    const current = await f.store.read(initial.taskId, undefined, f.context);
    expect(current.revision).toBe(3); expect(current.task.records).toHaveLength(2);
    await expect(second.expandSource(initial.taskId, initial.revision, initial.hash, f.context)).rejects.toThrow("revision conflict");
    await expect(second.expandSource(initial.taskId, 3, initial.hash, f.context)).rejects.toThrow("hash mismatch");
  });
  it("enforces task/UTF-8/store-envelope quotas without evicting or overwriting records", async () => {
    const f = fixture({ maxTasks: 1, maxTaskBytes: 4096 });
    const initial = await f.store.create("Goal", undefined, f.context), before = fs.readFileSync(f.file, "utf8");
    await expect(f.store.create("Other", undefined, f.context)).rejects.toThrow("entry limit");
    await expect(f.store.checkpoint(initial.taskId, initial.revision, "too-large", [
      { kind: "constraint", text: "😀".repeat(512) }, { kind: "constraint", text: "😀".repeat(512) },
    ], f.context)).rejects.toThrow("bounds");
    expect(fs.readFileSync(f.file, "utf8")).toBe(before);
    const total = fixture({ maxTotalBytes: 4096 });
    await total.store.create("x".repeat(1800), undefined, total.context);
    const persisted = fs.readFileSync(total.file, "utf8");
    await expect(total.store.create("x".repeat(1800), undefined, total.context)).rejects.toThrow("document exceeds");
    expect(fs.readFileSync(total.file, "utf8")).toBe(persisted);
    expect(Buffer.byteLength(persisted)).toBeLessThanOrEqual(4096);
  });
  it("preserves committed acknowledgement errors and recovers without repeating publication", async () => {
    const f = fixture(), initial = await f.store.create("Goal", undefined, f.context);
    const controller = new AbortController(), rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { rename(from, to); if (String(to) === f.file) controller.abort(); });
    const error = await f.store.checkpoint(initial.taskId, initial.revision, "ack-lost", facts, { ...f.context, signal: controller.signal }).catch((error: unknown) => error);
    expect(fabricCommitAcknowledgement(error)).toEqual({ version: 1, operation: "set" });
    vi.restoreAllMocks();
    const before = fs.readFileSync(f.file, "utf8");
    const retry = await new ContinuityStore(f.root, defaults).checkpoint(initial.taskId, initial.revision, "ack-lost", facts, f.context);
    expect(retry).toMatchObject({ alreadyPublished: true, admittedRecords: 2 });
    expect(fs.readFileSync(f.file, "utf8")).toBe(before);
  });
  it("leaves the old snapshot intact on a pre-commit write failure or pre-abort", async () => {
    const f = fixture(), initial = await f.store.create("Goal", undefined, f.context), before = fs.readFileSync(f.file, "utf8");
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw new Error("injected publication failure"); });
    await expect(f.store.checkpoint(initial.taskId, initial.revision, "failed", facts, f.context)).rejects.toThrow("publication failure");
    expect(fs.readFileSync(f.file, "utf8")).toBe(before);
    const controller = new AbortController(); controller.abort();
    await expect(f.store.delete(initial.taskId, initial.revision, { ...f.context, signal: controller.signal })).rejects.toThrow();
    expect(fs.readFileSync(f.file, "utf8")).toBe(before);
  });
  it("rejects corruption, unknown task versions, stale deletion and wrong workspace IDs", async () => {
    const f = fixture(), initial = await f.store.create("Goal", undefined, f.context);
    const other = fixture(); await expect(other.store.read(initial.taskId, undefined, other.context)).rejects.toThrow("not found");
    await expect(f.store.delete(initial.taskId, initial.revision + 1, f.context)).rejects.toThrow("revision conflict");
    const document = JSON.parse(fs.readFileSync(f.file, "utf8")); document.entries[initial.taskId].value.schemaVersion = 2;
    fs.writeFileSync(f.file, JSON.stringify(document));
    await expect(f.store.read(initial.taskId, undefined, f.context)).rejects.toThrow("malformed");
    fs.writeFileSync(f.file, "not json");
    await expect(f.store.read(initial.taskId, undefined, f.context)).rejects.toThrow();
    expect(fs.readFileSync(f.file, "utf8")).toBe("not json");
  });
  it("rejects aliased storage and deletes only the selected task", async () => {
    const f = fixture(), first = await f.store.create("First", undefined, f.context), second = await f.store.create("Second", undefined, f.context);
    const alias = path.join(f.root, "alias.json"); fs.linkSync(f.file, alias);
    await expect(f.store.read(first.taskId, undefined, f.context)).rejects.toThrow("private regular file");
    fs.unlinkSync(alias);
    await f.store.delete(first.taskId, first.revision, f.context);
    await expect(f.store.read(first.taskId, undefined, f.context)).rejects.toThrow("not found");
    expect((await f.store.read(second.taskId, second.revision, f.context)).hash).toBe(second.hash);
  });
});
