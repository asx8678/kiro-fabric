import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { KiroMemoryScopeError, openKiroMemory } from "../src/kiro/memory.js";

const roots: string[] = [];

const scratch = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), "kiro-memory-security-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Kiro persistent memory ownership", () => {
  it("refuses a foreign same-named directory without modifying its contents", () => {
    const root = scratch();
    const memoryRoot = path.join(root, "memory");
    mkdirSync(memoryRoot, { mode: 0o700 });
    const important = path.join(memoryRoot, "important.txt");
    writeFileSync(important, "preserve", { mode: 0o600 });

    expect(() => openKiroMemory("project:test", root)).toThrow(KiroMemoryScopeError);
    expect(readFileSync(important, "utf8")).toBe("preserve");
  });

  it.skipIf(process.platform === "win32")(
    "refuses a memory-root symlink without writing through it",
    () => {
      const root = scratch();
      const outside = scratch();
      const important = path.join(outside, "important.txt");
      writeFileSync(important, "outside", { mode: 0o600 });
      symlinkSync(outside, path.join(root, "memory"), "dir");

      expect(() => openKiroMemory("project:test", root)).toThrow(KiroMemoryScopeError);
      expect(readdirSync(outside)).toEqual(["important.txt"]);
      expect(readFileSync(important, "utf8")).toBe("outside");
    },
  );

  it("refuses to overwrite an unowned entry injected into an owned namespace", async () => {
    const root = scratch();
    const memory = openKiroMemory("project:test", root);
    const namespaceRoot = readdirSync(path.join(root, "memory"), { withFileTypes: true })
      .find((entry) => entry.isDirectory())?.name;
    expect(namespaceRoot).toBeDefined();
    const collision = path.join(root, "memory", namespaceRoot!, "collision.json");
    writeFileSync(collision, "user data", { mode: 0o600 });

    await expect(memory.set("collision", { replacement: true })).rejects
      .toThrow(/malformed|foreign|collision/i);
    expect(readFileSync(collision, "utf8")).toBe("user data");
  });

  it("serializes concurrent session quota checks and commits", async () => {
    const root = scratch();
    const first = openKiroMemory("project:concurrent", root);
    const second = openKiroMemory("project:concurrent", root);
    const results = await Promise.allSettled(
      Array.from({ length: 140 }, (_, index) =>
        (index % 2 === 0 ? first : second).set(`key-${index}`, { index })),
    );
    const entries = await first.list();
    expect(entries).toHaveLength(128);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(128);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(12);
  });
});
