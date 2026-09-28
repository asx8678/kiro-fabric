import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createKiroArtifactStore } from "../src/kiro/artifacts.js";
import * as pinnedDirectory from "../src/installation/pinned-directory-child.mjs";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
const fixture = (name = `ka_${"a".repeat(48)}`) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-startup-recovery-")); roots.push(root);
  const file = path.join(root, name);
  fs.writeFileSync(file, "residue", { mode: 0o600 });
  fs.utimesSync(file, new Date(0), new Date(0));
  return { root, file };
};

describe("artifact startup disappearance recovery", () => {
  it.each(["lstat", "remove"] as const)("tolerates another process removing a valid entry before %s", (phase) => {
    const { root, file } = fixture();
    const lstat = fs.lstatSync, remove = fs.rmSync, removePinned = pinnedDirectory.runPinnedDirectoryOperation;
    if (phase === "lstat") vi.spyOn(fs, "lstatSync").mockImplementation((target, options) => {
      if (String(target) === file) fs.unlinkSync(file);
      return lstat(target, options as never);
    });
    else {
      vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
        if (path.basename(String(target)) === path.basename(file)) remove(file);
        return remove(target, options);
      });
      vi.spyOn(pinnedDirectory, "runPinnedDirectoryOperation").mockImplementation(options => {
        if (options.operation === "unlink" && options.name === path.basename(file)) remove(file);
        return removePinned(options);
      });
    }
    const store = createKiroArtifactStore({ root });
    expect(fs.existsSync(file)).toBe(false);
    const id = store.write("new evidence");
    expect(store.read(id).text).toBe("new evidence");
    store.close();
  });

  describe.each(["lstat", "remove"] as const)("%s failure", (phase) => {
    it.each(["EACCES", "EIO", "ENOTDIR"])("does not suppress %s", (code) => {
      const { root, file } = fixture();
      const failure = Object.assign(new Error("startup failure"), { code });
      const lstat = fs.lstatSync, remove = fs.rmSync, removePinned = pinnedDirectory.runPinnedDirectoryOperation;
      if (phase === "lstat") vi.spyOn(fs, "lstatSync").mockImplementation((target, options) => {
        if (String(target) === file) throw failure;
        return lstat(target, options as never);
      });
      else {
        vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
          if (path.basename(String(target)) === path.basename(file)) throw failure;
          return remove(target, options);
        });
        vi.spyOn(pinnedDirectory, "runPinnedDirectoryOperation").mockImplementation(options => {
          if (options.operation === "unlink" && options.name === path.basename(file)) throw failure;
          return removePinned(options);
        });
      }
      expect(() => createKiroArtifactStore({ root })).toThrow(failure);
      expect(fs.readFileSync(file, "utf8")).toBe("residue");
    });
  });

  it("still rejects a foreign name even when it disappears after enumeration", () => {
    const { root, file } = fixture("foreign.txt");
    const readdir = fs.readdirSync;
    vi.spyOn(fs, "readdirSync").mockImplementation(((...args: Parameters<typeof fs.readdirSync>) => {
      const entries = readdir(...args);
      if (String(args[0]) === fs.realpathSync(root)) fs.unlinkSync(file);
      return entries;
    }) as typeof fs.readdirSync);
    expect(() => createKiroArtifactStore({ root })).toThrow("unsupported entry");
  });

  it.each(["directory", "symlink"] as const)("rejects an entry replaced with a %s after enumeration", (kind) => {
    if (kind === "symlink" && process.platform === "win32") return;
    const { root, file } = fixture();
    const lstat = fs.lstatSync;
    vi.spyOn(fs, "lstatSync").mockImplementation((target, options) => {
      if (String(target) === file) {
        fs.unlinkSync(file);
        if (kind === "directory") fs.mkdirSync(file);
        else fs.symlinkSync(root, file);
      }
      return lstat(target, options as never);
    });
    expect(() => createKiroArtifactStore({ root })).toThrow("unsupported entry");
    vi.restoreAllMocks();
    expect(fs.lstatSync(file)[kind === "directory" ? "isDirectory" : "isSymbolicLink"]()).toBe(true);
  });
});
