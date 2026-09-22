import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createKiroArtifactStore } from "../src/kiro/artifacts.js";
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
const temporary = () => { const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "artifact-storage-identity-"))); roots.push(root); return root; };
const operations = ["sweep", "read", "close", "count eviction", "size eviction"] as const;

describe("artifact ownership after publication", () => {
  it.each(operations)("preserves a foreign artifact replacement during %s and retains accounting", operation => {
    const root = temporary(); let now = 1;
    const store = createKiroArtifactStore({ root, now: () => now, ttlMs: 100, maxArtifacts: operation === "size eviction" ? 2 : 1, maxTotalChars: 8 });
    const id = store.write("original"), file = path.join(root, id);
    fs.renameSync(file, file + ".original"); fs.writeFileSync(file, "foreign sentinel", { mode: 0o600 });
    if (operation === "sweep" || operation === "read") now = 102;
    const attempt = () => operation === "sweep" ? store.sweep() : operation === "read" ? store.read(id) : operation === "close" ? store.close() : store.write("next");
    expect(attempt).toThrow(/replacement|changed|identity/u); expect(attempt).toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe("foreign sentinel");
    expect(fs.readFileSync(file + ".original", "utf8")).toBe("original");
    // A missing old name is recoverable, but the conflict must not silently free quota.
    fs.renameSync(file, file + ".foreign");
    store.close(); expect(fs.readFileSync(file + ".foreign", "utf8")).toBe("foreign sentinel");
  });

  it.each(["symlink", "directory", "permissions"] as const)("refuses %s root substitution before reads, writes and close", kind => {
    if (process.platform === "win32" && kind !== "directory") return;
    const parent = temporary(), root = path.join(parent, "store"), foreign = path.join(parent, "foreign"); fs.mkdirSync(foreign, { mode: 0o700 });
    const store = createKiroArtifactStore({ root }); const id = store.write("original");
    fs.writeFileSync(path.join(foreign, id), "foreign sentinel", { mode: 0o600 });
    if (kind === "permissions") fs.chmodSync(root, 0o770);
    else { fs.renameSync(root, root + ".original"); if (kind === "symlink") fs.symlinkSync(foreign, root); else fs.cpSync(foreign, root, { recursive: true }); }
    const names = fs.readdirSync(foreign);
    expect(() => store.read(id)).toThrow(); expect(() => store.write("next")).toThrow();
    expect(() => store.sweep(1, 0)).toThrow(); expect(() => store.close()).toThrow();
    expect(fs.readFileSync(path.join(foreign, id), "utf8")).toBe("foreign sentinel"); expect(fs.readdirSync(foreign)).toEqual(names);
  });

  it("preserves in-place modifications of an artifact", () => {
    const root = temporary(), store = createKiroArtifactStore({ root }); const id = store.write("original");
    fs.writeFileSync(path.join(root, id), "changed by recovery", { mode: 0o600 });
    expect(() => store.close()).toThrow(/replacement|changed|identity/u);
    expect(fs.readFileSync(path.join(root, id), "utf8")).toBe("changed by recovery");
  });

  it.each(["file", "root"] as const)("never cleans a replacement %s when artifact initialization fails", kind => {
    const parent = temporary(), root = path.join(parent, "store"), store = createKiroArtifactStore({ root });
    const open = fs.openSync, close = fs.closeSync;
    const opened = new Map<number, string>(); let target: string | undefined; let replaced = false;
    vi.spyOn(fs, "openSync").mockImplementation((file, flags, mode) => { const fd = open(file, flags, mode); opened.set(fd, String(file)); return fd; });
    vi.spyOn(fs, "closeSync").mockImplementation(fd => {
      close(fd);
      const file = opened.get(fd); if (replaced || !file || !path.basename(file).startsWith("ka_")) return;
      replaced = true; target = file;
      if (kind === "root") { fs.renameSync(root, root + ".original"); fs.mkdirSync(root, { mode: 0o700 }); }
      else fs.renameSync(file, file + ".original");
      fs.writeFileSync(file, "foreign sentinel", { mode: 0o600 });
      throw new Error("injected close failure");
    });
    expect(() => store.write("original")).toThrow(); vi.restoreAllMocks();
    expect(target).toBeDefined(); expect(fs.readFileSync(target!, "utf8")).toBe("foreign sentinel");
  });
});
