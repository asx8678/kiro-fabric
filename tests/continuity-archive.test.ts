import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContinuityConversationArchive, type ContinuityArchiveEventInput, type ContinuityArchiveEventKind } from "../src/continuity/conversation-archive.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
const context = { cwd: "/workspace" };
const archiveRoot = (): string => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-continuity-archive-")));
  roots.push(root);
  return path.join(root, "archive");
};
const event = (eventId: string, payload: unknown, kind: ContinuityArchiveEventKind = "user"): ContinuityArchiveEventInput => ({ eventId, kind, payload });

describe("logically append-only continuity archive", () => {
  it("appends original events in order, pages them and verifies the hash chain", async () => {
    const archive = new ContinuityConversationArchive(archiveRoot());
    const first = await archive.append("conv-1", "workspace-key-1", [event("e1", { text: "original user turn" })], 0, context);
    expect(first).toMatchObject({ archiveId: "conv-1", revision: 1, appendedSequences: [1], alreadyAppended: [] });
    expect(first.headHash).toMatch(/^[a-f0-9]{64}$/);
    const second = await archive.append("conv-1", "workspace-key-1", [event("e2", { tool: "read" }, "tool-call"), event("e3", { marker: true }, "checkpoint-marker")], 1, context);
    expect(second).toMatchObject({ revision: 2, appendedSequences: [2, 3] });
    const head = await archive.head("conv-1", "workspace-key-1", context);
    expect(head).toMatchObject({ revision: 2, events: 3, headHash: second.headHash });
    let offset = 0;
    const seen: number[] = [];
    for (;;) {
      const page = await archive.events("conv-1", "workspace-key-1", context, offset, 2);
      seen.push(...page.events.map(item => item.sequence));
      if (page.nextOffset === null) break;
      offset = page.nextOffset;
    }
    expect(seen).toEqual([1, 2, 3]);
    const events = (await archive.events("conv-1", "workspace-key-1", context, 0, 64)).events;
    expect(events[1]).toMatchObject({ eventId: "e2", previousHash: events[0]!.eventHash });
    expect(events[2]).toMatchObject({ previousHash: events[1]!.eventHash });
    expect(JSON.stringify(events[0]!.payload)).toEqual(JSON.stringify({ text: "original user turn" }));
  });

  it("treats identical replays as already-committed and changed content as a conflict", async () => {
    const archive = new ContinuityConversationArchive(archiveRoot());
    const first = await archive.append("conv-1", "workspace-key-1", [event("e1", { a: 1 })], 0, context);
    // A lost-acknowledgement retry with the original observed revision is idempotent, not a conflict.
    const replay = await archive.append("conv-1", "workspace-key-1", [event("e1", { a: 1 })], 0, context);
    expect(replay).toMatchObject({ revision: first.revision, appendedSequences: [], alreadyAppended: ["e1"], headHash: first.headHash });
    await expect(archive.append("conv-1", "workspace-key-1", [event("e1", { a: 2 })], first.revision, context)).rejects.toThrow("event id conflict");
    // An observed revision that no longer matches rejects before any write.
    await expect(archive.append("conv-1", "workspace-key-1", [event("e2", {})], 0, context)).rejects.toThrow("revision conflict");
    expect((await archive.head("conv-1", "workspace-key-1", context)).events).toBe(1);
  });

  it("resolves concurrent writers to one winner and one explicit conflict", async () => {
    const root = archiveRoot();
    const left = new ContinuityConversationArchive(root), right = new ContinuityConversationArchive(root);
    const results = await Promise.allSettled([
      left.append("conv-1", "workspace-key-1", [event("left", { who: "left" })], 0, context),
      right.append("conv-1", "workspace-key-1", [event("right", { who: "right" })], 0, context),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const head = await left.head("conv-1", "workspace-key-1", context);
    expect(head.events).toBe(1);
  });

  it("isolates conversations and workspaces, and rejects tampering fail-closed", async () => {
    const root = archiveRoot();
    const archive = new ContinuityConversationArchive(root);
    await archive.append("conv-1", "workspace-key-1", [event("e1", { a: 1 })], 0, context);
    await archive.append("conv-2", "workspace-key-1", [event("e1", { a: 2 })], 0, context);
    // The same event id in another conversation is a distinct event.
    expect((await archive.head("conv-2", "workspace-key-1", context)).events).toBe(1);
    // The same conversation under a different workspace key is rejected.
    await expect(archive.head("conv-1", "workspace-key-2", context)).rejects.toThrow("another conversation/workspace");
    await expect(archive.append("conv-1", "workspace-key-2", [event("e2", {})], 1, context)).rejects.toThrow("another conversation/workspace");
    // Direct tampering with the stored document is detected on reopen.
    const state = JSON.parse(fs.readFileSync(path.join(root, "state.json"), "utf8")) as { entries: Record<string, { value: { events?: { payload: unknown }[] } }> };
    const key = Object.keys(state.entries).find(name => name.startsWith("ca:"))!;
    state.entries[key]!.value.events![0]!.payload = { tampered: true };
    fs.writeFileSync(path.join(root, "state.json"), JSON.stringify(state));
    const reopened = new ContinuityConversationArchive(root);
    await expect(reopened.head("conv-1", "workspace-key-1", context)).rejects.toThrow("hash chain does not match its contents");
  });

  it("enforces event, payload, document, depth and archive quotas without evicting", async () => {
    const archive = new ContinuityConversationArchive(archiveRoot(), { maxEvents: 4, maxEventBytes: 64, maxArchives: 2 });
    await archive.append("conv-1", "key", [event("e1", { a: 1 })], 0, context);
    await expect(archive.append("conv-1", "key", [event("big", { a: "x".repeat(100) })], 1, context)).rejects.toThrow("payload exceeds bounds");
    let deep: unknown = { value: 1 };
    for (let index = 0; index < 100; index++) deep = { nested: deep };
    await expect(archive.append("conv-1", "key", [event("deep", deep)], 1, context)).rejects.toThrow("depth");
    await expect(archive.append("conv-1", "key", [event("nan", { a: Number.NaN })], 1, context)).rejects.toThrow("bounded JSON");
    await expect(archive.append("conv-1", "key", [event("dup", { a: 1 }), event("dup", { a: 2 })], 1, context)).rejects.toThrow("duplicate event ids");
    for (let index = 2; index <= 4; index++) await archive.append("conv-1", "key", [event(`e${index}`, { a: index })], index - 1, context);
    await expect(archive.append("conv-1", "key", [event("e5", { a: 5 })], 4, context)).rejects.toThrow("event quota");
    // Every quota failure preserved the earlier original events.
    expect((await archive.head("conv-1", "key", context)).events).toBe(4);
    const tiny = new ContinuityConversationArchive(archiveRoot(), { maxDocumentBytes: 256 });
    await expect(tiny.append("conv-1", "key", [event("e1", { a: "x".repeat(200) })], 0, context)).rejects.toThrow("document exceeds bounds");
    // A second archive fits the archive quota; a third is rejected.
    await archive.append("conv-2", "key", [event("x", {})], 0, context);
    await expect(archive.append("conv-3", "key", [event("y", {})], 0, context)).rejects.toThrow();
  });
});

describe("bounded plain-JSON payload admission", () => {
  it("conflicts when a retry changes the kind but repeats the payload", async () => {
    const archive = new ContinuityConversationArchive(archiveRoot());
    await archive.append("conv-1", "workspace-key-1", [event("e1", { a: 1 }, "user")], 0, context);
    await expect(archive.append("conv-1", "workspace-key-1", [event("e1", { a: 1 }, "assistant")], 1, context)).rejects.toThrow("event id conflict");
    // An exact all-duplicate retry remains idempotent at the original revision.
    const replay = await archive.append("conv-1", "workspace-key-1", [event("e1", { a: 1 }, "user")], 0, context);
    expect(replay).toMatchObject({ appendedSequences: [], alreadyAppended: ["e1"] });
    expect((await archive.head("conv-1", "workspace-key-1", context)).events).toBe(1);
  });

  it.each([
    ["buffer", Buffer.from([1, 2])],
    ["typed array", new Uint8Array([1])],
    ["date", new Date(0)],
    ["map", new Map([["a", 1]])],
    ["set", new Set(["a"])],
    ["custom class", new (class Custom { value = 1 })()],
    ["accessor", { get poisoned() { throw new Error("getter must never run"); } }],
    ["toJSON method", { toJSON: () => "x" }],
    ["undefined property", { a: undefined }],
    ["bigint", { a: 1n }],
    ["symbol key", { [Symbol("a")]: 1 } as Record<string, unknown>],
    ["array hole", [undefined]],
  ])("rejects %s payloads before publication and retains earlier events", async (_label, payload) => {
    const archive = new ContinuityConversationArchive(archiveRoot());
    await archive.append("conv-1", "workspace-key-1", [event("e1", { a: 1 })], 0, context);
    await expect(archive.append("conv-1", "workspace-key-1", [event("e2", payload)], 1, context)).rejects.toThrow(/bounded JSON|cycle/);
    expect((await archive.head("conv-1", "workspace-key-1", context)).events).toBe(1);
  });

  it.each(["object toJSON", "array toJSON", "array index", "nested array index"])("rejects %s accessors without invoking them or changing prior events", async kind => {
    const root = archiveRoot(), archive = new ContinuityConversationArchive(root);
    await archive.append("conv-1", "key", [event("e1", { preserved: true })], 0, context);
    const before = await archive.head("conv-1", "key", context);
    let calls = 0;
    const input = kind === "object toJSON" ? {} : [];
    const property = kind.endsWith("toJSON") ? "toJSON" : "0";
    Object.defineProperty(input, property, { enumerable: true, get() { calls++; return "accessor value"; } });
    const payload = kind === "nested array index" ? { nested: input } : input;
    const failure = await archive.append("conv-1", "key", [event("e2", payload)], before.revision, context).catch(error => error);
    expect(calls).toBe(0);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain("bounded JSON");
    expect(await new ContinuityConversationArchive(root).head("conv-1", "key", context)).toEqual(before);
  });

  it.each(["sparse", "non-enumerable index", "extra data", "extra accessor", "setter index"])("rejects %s arrays without silently dropping properties", async kind => {
    const archive = new ContinuityConversationArchive(archiveRoot());
    await archive.append("conv-1", "key", [event("e1", "preserved")], 0, context);
    const before = await archive.head("conv-1", "key", context);
    const payload = [1];
    let calls = 0;
    if (kind === "sparse") payload.length = 2;
    if (kind === "non-enumerable index") Object.defineProperty(payload, "0", { enumerable: false });
    if (kind === "extra data") Object.defineProperty(payload, "extra", { value: 2, enumerable: true });
    if (kind === "extra accessor") Object.defineProperty(payload, "extra", { get() { calls++; return 2; }, enumerable: true });
    if (kind === "setter index") Object.defineProperty(payload, "0", { set(_value: unknown) { calls++; }, enumerable: true });
    await expect(archive.append("conv-1", "key", [event("e2", payload)], before.revision, context)).rejects.toThrow("bounded JSON");
    expect(calls).toBe(0);
    expect(await archive.head("conv-1", "key", context)).toEqual(before);
  });

  it.each([{}, [1]])("rejects proxies before reflection can invoke user callbacks: %j", async target => {
    const archive = new ContinuityConversationArchive(archiveRoot());
    let calls = 0;
    const payload = new Proxy(target, {
      getPrototypeOf(value) { calls++; return Reflect.getPrototypeOf(value); },
      ownKeys(value) { calls++; return Reflect.ownKeys(value); },
      get(value, key, receiver) { calls++; return Reflect.get(value, key, receiver); },
    });
    const failure = await archive.append("conv-1", "key", [event("e1", payload)], 0, context).catch(error => error);
    expect(calls).toBe(0);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain("bounded JSON");
    expect((await archive.head("conv-1", "key", context)).events).toBe(0);
  });

  it("round-trips dense frozen arrays and a non-callable toJSON data property", async () => {
    const root = archiveRoot(), archive = new ContinuityConversationArchive(root);
    const payload = Object.freeze([null, false, 1, "text", Object.freeze({ toJSON: "data", nested: Object.freeze([2]) })]);
    await archive.append("conv-1", "key", [event("e1", payload)], 0, context);
    const page = await new ContinuityConversationArchive(root).events("conv-1", "key", context);
    expect(page.events[0]!.payload).toEqual(payload);
  });

  it("rejects cycles but accepts acyclic shared references", async () => {
    const archive = new ContinuityConversationArchive(archiveRoot());
    const cyclic: Record<string, unknown> = { name: "cycle" };
    cyclic.self = cyclic;
    await expect(archive.append("conv-1", "key", [event("e1", cyclic)], 0, context)).rejects.toThrow("cycle");
    const shared = { x: 1 };
    const aliased = { a: shared, b: shared };
    const appended = await archive.append("conv-1", "key", [event("e1", aliased)], 0, context);
    expect(appended.appendedSequences).toEqual([1]);
    const page = await archive.events("conv-1", "key", context, 0, 8);
    expect(JSON.stringify(page.events[0]!.payload)).toEqual(JSON.stringify(aliased));
  });

  it("keeps a __proto__ own key as data without polluting prototypes", async () => {
    const archive = new ContinuityConversationArchive(archiveRoot());
    const payload = JSON.parse('{"__proto__":{"a":1},"own":true}') as Record<string, unknown>;
    await archive.append("conv-1", "key", [event("e1", payload)], 0, context);
    const page = await archive.events("conv-1", "key", context, 0, 8);
    const stored = page.events[0]!.payload as Record<string, unknown>;
    expect(Object.keys(stored)).toEqual(["__proto__", "own"]);
    expect((stored["__proto__"] as Record<string, unknown>).a).toBe(1);
    expect(({} as Record<string, unknown>).a).toBeUndefined();
    expect(Object.getOwnPropertyDescriptors(stored)["__proto__"]?.value).toMatchObject({ a: 1 });
  });

  it("round-trips numeric-string keys and lone surrogates through reopen", async () => {
    const root = archiveRoot();
    const archive = new ContinuityConversationArchive(root);
    const numericKeys = { b: 1, a: 2, "10": "x", "2": "y" };
    const appended = await archive.append("conv-1", "key", [event("e1", numericKeys), event("e2", "surrogate-\ud800-pair")], 0, context);
    expect(appended.appendedSequences).toEqual([1, 2]);
    const reopened = new ContinuityConversationArchive(root);
    const head = await reopened.head("conv-1", "key", context);
    expect(head).toMatchObject({ revision: appended.revision, events: 2, headHash: appended.headHash });
    const page = await reopened.events("conv-1", "key", context, 0, 8);
    expect(JSON.stringify(page.events[0]!.payload)).toEqual('{"2":"y","10":"x","b":1,"a":2}');
    expect(page.events[1]!.payload).toBe("surrogate-\ud800-pair");
  });

  it("accepts the exact byte boundary, rejects one byte over, and reopens cleanly", async () => {
    const root = archiveRoot();
    const archive = new ContinuityConversationArchive(root, { maxEventBytes: 32 });
    // A payload of twenty-four repeated x characters serializes to exactly 32 bytes.
    const exact = await archive.append("conv-1", "key", [event("e1", { a: "x".repeat(24) })], 0, context);
    expect(exact.appendedSequences).toEqual([1]);
    await expect(archive.append("conv-1", "key", [event("e2", { a: "x".repeat(25) })], 1, context)).rejects.toThrow("payload exceeds bounds");
    const reopened = new ContinuityConversationArchive(root, { maxEventBytes: 32 });
    const head = await reopened.head("conv-1", "key", context);
    expect(head).toMatchObject({ events: 1, headHash: exact.headHash });
    const page = await reopened.events("conv-1", "key", context, 0, 8);
    expect(JSON.stringify(page.events[0]!.payload)).toEqual(JSON.stringify({ a: "x".repeat(24) }));
  });

  it("bounds traversal before serializing oversized payloads", async () => {
    const archive = new ContinuityConversationArchive(archiveRoot(), { maxEventBytes: 8192 });
    const huge: number[] = [];
    for (let index = 0; index < 100_000; index++) huge.push(index);
    await expect(archive.append("conv-1", "key", [event("e1", huge)], 0, context)).rejects.toThrow("node bounds");
  });

  it("preserves v1 hash semantics and key order for plain JSON payloads", async () => {
    const root = archiveRoot();
    const archive = new ContinuityConversationArchive(root);
    const first = await archive.append("conv-1", "key", [event("e1", { b: 1, a: 2, "10": "x", "2": "y" })], 0, context);
    const reopened = new ContinuityConversationArchive(root);
    const head = await reopened.head("conv-1", "key", context);
    expect(head).toMatchObject({ revision: first.revision, events: 1, headHash: first.headHash });
    const page = await reopened.events("conv-1", "key", context, 0, 8);
    expect(JSON.stringify(page.events[0]!.payload)).toEqual('{"2":"y","10":"x","b":1,"a":2}');
  });
});
