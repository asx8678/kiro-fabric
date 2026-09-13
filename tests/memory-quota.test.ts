import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openKiroMemory } from "../src/kiro/memory.js";

const roots: string[] = [];
const temporary = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-memory-quota-"));
  roots.push(root);
  return root;
};
const namespaceDirectory = (root: string) => path.join(root, "memory", fs.readdirSync(path.join(root, "memory")).find((name) => !name.startsWith("."))!);
afterEach(() => {
  vi.restoreAllMocks();
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("bounded memory namespace scans", () => {
  it.each(["list", "index", "search", "set"] as const)("%s rejects tightened count before reading values and closes enumeration", async (operation) => {
    const root = temporary();
    const memory = openKiroMemory("quota", root);
    await memory.set("a", true);
    await memory.set("b", true);
    // Extra non-entry files do not count toward the quota.
    fs.writeFileSync(path.join(namespaceDirectory(root), "ignored.txt"), "ignored");
    const bounded = openKiroMemory("quota", root, { maxEntries: 1 });
    const open = fs.opendirSync.bind(fs);
    const closes: ReturnType<typeof vi.spyOn>[] = [];
    let enumeratedEntries = 0;
    vi.spyOn(fs, "opendirSync").mockImplementation((...args) => {
      const directory = open(...args);
      closes.push(vi.spyOn(directory, "closeSync"));
      const read = directory.readSync.bind(directory);
      vi.spyOn(directory, "readSync").mockImplementation(() => {
        if (enumeratedEntries === 2) throw new Error("enumerated beyond maxEntries + 1");
        const entry = read();
        if (entry?.isFile() && entry.name.endsWith(".json")) enumeratedEntries++;
        return entry;
      });
      return directory;
    });
    const reads = vi.spyOn(fs, "readSync");
    const readdir = vi.spyOn(fs, "readdirSync");
    const result = operation === "search" ? bounded.search("true", 1)
      : operation === "set" ? bounded.set("a", false) : bounded[operation]();
    await expect(result).rejects.toThrow("exceeds 1 entries");
    expect(reads).not.toHaveBeenCalled();
    expect(readdir).not.toHaveBeenCalled();
    expect(closes).toHaveLength(1);
    expect(closes[0]).toHaveBeenCalledTimes(1);
    expect(enumeratedEntries).toBe(2);
    vi.restoreAllMocks();
    // Deletion remains available to recover a namespace under tighter limits.
    await expect(bounded.delete("b")).resolves.toMatchObject({ deleted: true });
    await expect(bounded.set("a", false)).resolves.toMatchObject({ value: false });
  });

  it.each(["list", "index", "search"] as const)("%s enforces cumulative bytes even after finding its result", async (operation) => {
    const root = temporary();
    const memory = openKiroMemory("quota", root);
    await memory.set("00", "match");
    const directory = namespaceDirectory(root);
    const template = JSON.parse(fs.readFileSync(path.join(directory, "00.json"), "utf8"));
    // Each entry fits individually; their combined serialized bytes do not.
    for (let i = 1; i <= 20; i++) {
      const key = String(i).padStart(2, "0");
      fs.writeFileSync(path.join(directory, `${key}.json`), JSON.stringify({ ...template, key, value: "x".repeat(15_000) }), { mode: 0o600 });
    }
    const read = vi.spyOn(fs, "readSync");
    await expect(operation === "search" ? memory.search("match", 1) : memory[operation]()).rejects.toThrow("exceeds 262144 bytes");
    // Stop at the overflow, not after loading all twenty large values.
    expect(read.mock.calls.length).toBeLessThan(40);
    read.mockRestore();
    await expect(memory.delete("20")).resolves.toMatchObject({ deleted: true });
  });

  it("bounds reads when an entry grows after fstat, and closes its descriptor", async () => {
    const root = temporary();
    const memory = openKiroMemory("quota", root);
    await memory.set("a", true);
    const file = path.join(namespaceDirectory(root), "a.json");
    const fstat = fs.fstatSync.bind(fs);
    let entryDescriptor: number | undefined;
    vi.spyOn(fs, "fstatSync").mockImplementation((...args) => {
      const stat = fstat(...args);
      entryDescriptor = args[0];
      fs.appendFileSync(file, " ".repeat(100_000));
      return stat;
    });
    const reads = vi.spyOn(fs, "readSync");
    const closes = vi.spyOn(fs, "closeSync");
    const unbounded = vi.spyOn(fs, "readFileSync");
    await expect(memory.get("a")).rejects.toThrow("bounded regular file");
    expect(unbounded).not.toHaveBeenCalled();
    expect(reads).toHaveBeenCalledTimes(1);
    expect(reads.mock.calls[0]![1].byteLength).toBe(16 * 1024 + 1);
    expect(closes).toHaveBeenCalledWith(entryDescriptor);
  });

  it("uses the remaining namespace budget when a file grows after stat", async () => {
    const root = temporary();
    const memory = openKiroMemory("quota", root);
    for (let i = 0; i < 17; i++) await memory.set(String(i).padStart(2, "0"), "x".repeat(15_000));
    await memory.set("z", true);
    const directory = namespaceDirectory(root);
    const file = path.join(directory, "z.json");
    const inode = fs.statSync(file).ino;
    const used = (await memory.index()).filter(({ key }) => key !== "z").reduce((sum, { bytes }) => sum + bytes, 0);
    const fstat = fs.fstatSync.bind(fs);
    let descriptor: number | undefined;
    vi.spyOn(fs, "fstatSync").mockImplementation((...args) => {
      const stat = fstat(...args);
      if (stat.ino === inode) {
        descriptor = args[0];
        fs.appendFileSync(file, " ".repeat(10_000));
      }
      return stat;
    });
    const reads = vi.spyOn(fs, "readSync");
    const closes = vi.spyOn(fs, "closeSync");
    await expect(memory.index()).rejects.toThrow("exceeds 262144 bytes");
    expect(reads.mock.calls.at(-1)![1].byteLength).toBe(262144 - used + 1);
    expect(closes).toHaveBeenCalledWith(descriptor);
  });

  it("allows a shrinking replacement to recover total-byte overflow", async () => {
    const root = temporary();
    const memory = openKiroMemory("quota", root);
    await memory.set("00", "x".repeat(15_000));
    const directory = namespaceDirectory(root);
    const template = JSON.parse(fs.readFileSync(path.join(directory, "00.json"), "utf8"));
    for (let i = 1; i < 18; i++) {
      const key = String(i).padStart(2, "0");
      fs.writeFileSync(path.join(directory, `${key}.json`), JSON.stringify({ ...template, key }), { mode: 0o600 });
    }
    await expect(memory.index()).rejects.toThrow("exceeds 262144 bytes");
    await expect(memory.set("00", true)).resolves.toMatchObject({ value: true });
    await expect(memory.index()).resolves.toHaveLength(18);
  });

  it("closes the directory when enumeration itself fails", async () => {
    const memory = openKiroMemory("quota", temporary());
    const open = fs.opendirSync.bind(fs);
    let close: ReturnType<typeof vi.spyOn> | undefined;
    vi.spyOn(fs, "opendirSync").mockImplementation((...args) => {
      const directory = open(...args);
      vi.spyOn(directory, "readSync").mockImplementation(() => { throw new Error("enumeration failed"); });
      close = vi.spyOn(directory, "closeSync");
      return directory;
    });
    await expect(memory.index()).rejects.toThrow("enumeration failed");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("keeps deterministic ranking and scans malformed trailing files despite a full result limit", async () => {
    const root = temporary();
    const memory = openKiroMemory("quota", root);
    for (const key of ["c", "a", "b"]) await memory.set(key, "match");
    const directory = namespaceDirectory(root);
    for (const key of ["a", "b", "c"]) {
      const file = path.join(directory, `${key}.json`);
      const entry = JSON.parse(fs.readFileSync(file, "utf8"));
      fs.writeFileSync(file, JSON.stringify({ ...entry, updatedAt: "2026-01-01T00:00:00Z" }));
    }
    expect((await memory.search("match", 2)).map(({ key }) => key)).toEqual(["a", "b"]);
    fs.writeFileSync(path.join(directory, "z.json"), "foreign", { mode: 0o600 });
    await expect(memory.search("match", 1)).rejects.toThrow("foreign or malformed");
  });
});
