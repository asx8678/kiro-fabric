import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createKiroArtifactStore,
  KiroArtifactStoreError,
} from "../src/kiro/artifacts.js";

const roots: string[] = [];

const scratch = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), "kiro-fabric-artifacts-test-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Kiro opaque output artifacts", () => {
  it("never creates a filesystem path in the project", () => {
    const project = scratch();
    const before = readdirSync(project);
    const store = createKiroArtifactStore(project);
    const id = store.write("sensitive output");

    expect(id).toMatch(/^ka_[a-f0-9]{48}$/);
    expect(readdirSync(project)).toEqual(before);
    expect(store.read(id)).toMatchObject({
      id,
      text: "sensitive output",
      offset: 0,
      nextOffset: 16,
      totalChars: 16,
      done: true,
    });
    store.close();
    expect(readdirSync(project)).toEqual(before);
  });

  it("reads bounded chunks by opaque id", () => {
    const store = createKiroArtifactStore();
    const id = store.write("abcdefghij");
    expect(store.read(id, 2, 4)).toEqual({
      id,
      text: "cdef",
      offset: 2,
      nextOffset: 6,
      totalChars: 10,
      done: false,
    });
    expect(store.read(id, 6, 99_999)).toMatchObject({ text: "ghij", done: true });
  });

  it("isolates sessions and makes close/crash cleanup pathless", () => {
    const first = createKiroArtifactStore();
    const second = createKiroArtifactStore();
    const firstId = first.write("first");
    const secondId = second.write("second");

    expect(() => first.read(secondId)).toThrow(/unavailable|expired/);
    expect(() => second.read(firstId)).toThrow(/unavailable|expired/);
    first.close();
    expect(() => first.read(firstId)).toThrow(/closed/);
    expect(second.read(secondId).text).toBe("second");
  });

  it("expires old entries and bounds entry count", () => {
    let now = 1_000;
    const store = createKiroArtifactStore(undefined, { now: () => now });
    const expired = store.write("expired");
    now += 60_001;
    store.sweep(60_000, 32);
    expect(() => store.read(expired)).toThrow(/unavailable|expired/);

    const ids = Array.from({ length: 40 }, (_, index) => store.write(String(index)));
    store.sweep(Number.POSITIVE_INFINITY, 8);
    expect(ids.filter((id) => {
      try { store.read(id); return true; } catch { return false; }
    })).toHaveLength(8);
  });

  it("does not extend TTL for empty out-of-range reads", () => {
    let now = 1_000;
    const store = createKiroArtifactStore(undefined, { now: () => now });
    const id = store.write("payload");
    now += 50_000;
    expect(store.read(id, 999).text).toBe("");
    now += 11_000;
    store.sweep(60_000);
    expect(() => store.read(id)).toThrow(/unavailable|expired/);
  });

  it("rejects oversized payloads and malformed read ranges", () => {
    const store = createKiroArtifactStore();
    expect(() => store.write("x".repeat(2_000_001))).toThrow(KiroArtifactStoreError);
    const id = store.write("ok");
    expect(() => store.read("../../secret")).toThrow(/invalid artifact id/);
    expect(() => store.read(id, -1)).toThrow(/offset and limit/);
    expect(() => store.read(id, 0, 0)).toThrow(/offset and limit/);
  });
});
