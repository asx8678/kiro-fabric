import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openKiroMemory } from "../src/kiro/memory.js";

const roots: string[] = [];
const temporary = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-memory-")); roots.push(root); return root; };
afterEach(() => { while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });

describe("Power memory confinement", () => {
  it("uses private files and preserves bounded values", async () => {
    const root = temporary();
    const memory = openKiroMemory("workspace", root);
    await memory.set("release", { ready: true });
    const entries = await memory.list();
    expect(entries).toHaveLength(1);
    const visit = (directory: string) => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const target = path.join(directory, entry.name); if (entry.isDirectory()) visit(target); else expect(fs.statSync(target).mode & 0o077).toBe(0); } };
    visit(root);
  });

  it("reclaims capacity through an identity-checked delete", async () => {
    const memory = openKiroMemory("workspace", temporary(), { maxEntries: 1 });
    await memory.set("first", true);
    await expect(memory.set("second", true)).rejects.toThrow("exceeds 1 entries");
    await expect(memory.delete("first")).resolves.toEqual({ key: "first", deleted: true });
    await expect(memory.delete("first")).resolves.toEqual({ key: "first", deleted: false });
    await expect(memory.set("second", true)).resolves.toMatchObject({ key: "second", value: true });
  });

  it("enforces configured entry and value bounds inside the mutation lock", async () => {
    const root = temporary();
    const memory = openKiroMemory("workspace", root, { maxEntries: 1, maxValueChars: 8 });
    await memory.set("first", "value");
    await expect(memory.set("second", true)).rejects.toThrow("exceeds 1 entries");
    await expect(memory.set("first", "too-large")).rejects.toThrow("configured characters");
  });

  it("revalidates configured value bounds when reading persistence", async () => {
    const root = temporary();
    const memory = openKiroMemory("workspace", root, { maxValueChars: 8 });
    await memory.set("release", "value");
    let entryFile = "";
    const findEntry = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) findEntry(target);
        else if (entry.name === "release.json") entryFile = target;
      }
    };
    findEntry(root);
    const persisted = JSON.parse(fs.readFileSync(entryFile, "utf8")) as Record<string, unknown>;
    persisted.value = "too-large";
    fs.writeFileSync(entryFile, JSON.stringify(persisted), { mode: 0o600 });
    await expect(memory.get("release")).rejects.toThrow("configured scope");
  });

  it("fails closed on non-private entries and multiply-linked ownership markers", async () => {
    if (process.platform === "win32") return;
    const root = temporary();
    const memory = openKiroMemory("workspace", root);
    await memory.set("release", { ready: true });
    const files: string[] = [];
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(target);
        else files.push(target);
      }
    };
    walk(root);
    const entry = files.find((file) => file.endsWith("release.json"));
    expect(entry).toBeDefined();
    fs.chmodSync(entry!, 0o644);
    await expect(memory.get("release")).rejects.toThrow("must be private");
    fs.chmodSync(entry!, 0o600);

    const marker = files.find((file) => path.basename(file) === ".kiro-fabric-owner");
    expect(marker).toBeDefined();
    fs.linkSync(marker!, path.join(path.dirname(marker!), "marker-hardlink"));
    expect(() => openKiroMemory("workspace", root)).toThrow("ownership marker is invalid");
  });

  it("rejects a root that is a path alias", () => {
    const root = temporary(); const target = path.join(root, "target"); const alias = path.join(root, "alias"); fs.mkdirSync(target); fs.symlinkSync(target, alias);
    expect(() => openKiroMemory("workspace", alias)).toThrow();
  });
});
