import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KiroMemoryCommitAcknowledgementError, openKiroMemory } from "../src/kiro/memory.js";

const roots: string[] = [];
const temporary = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-memory-recovery-")); roots.push(root); return root; };
const lockDirectory = (root: string): string => {
  let found = "";
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) { if (entry.name === ".kiro-fabric-mutation-lock") found = target; else visit(target); }
    }
  };
  visit(root);
  return found;
};
afterEach(() => { vi.restoreAllMocks(); while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });

describe("Fabric memory commit recovery", () => {
  it("does not acknowledge a pre-publication interruption as committed", async () => {
    const memory = openKiroMemory("workspace", temporary());
    let calls = 0;
    const interruption = new Error("deadline");
    await expect(memory.set("key", true, undefined, () => { if (++calls === 4) throw interruption; })).rejects.toBe(interruption);
    await expect(memory.get("key")).resolves.toBeNull();
  });

  it("acknowledges post-publication set and delete interruptions", async () => {
    const memory = openKiroMemory("workspace", temporary());
    let calls = 0;
    await expect(memory.set("key", true, undefined, () => { if (++calls === 5) throw new Error("deadline"); }))
      .rejects.toMatchObject({ committed: true, operation: "set", key: "key", cause: expect.any(Error) });
    await expect(memory.get("key")).resolves.toMatchObject({ value: true });
    calls = 0;
    await expect(memory.delete("key", undefined, () => { if (++calls === 4) throw new Error("deadline"); }))
      .rejects.toBeInstanceOf(KiroMemoryCommitAcknowledgementError);
    await expect(memory.get("key")).resolves.toBeNull();
  });

  it("preserves live-owner metadata after unlink failure and recovers on the same instance", async () => {
    const root = temporary();
    const memory = openKiroMemory("workspace", root);
    const original = fs.unlinkSync;
    let failOwnerUnlink = true;
    vi.spyOn(fs, "unlinkSync").mockImplementation((target) => {
      if (failOwnerUnlink && String(target).endsWith(`${path.sep}owner.json`)) {
        failOwnerUnlink = false;
        throw new Error("owner unlink failed");
      }
      return original(target);
    });

    await expect(memory.set("first", 1)).rejects.toMatchObject({ committed: true });
    const ownerPath = path.join(lockDirectory(root), "owner.json");
    expect(JSON.parse(fs.readFileSync(ownerPath, "utf8"))).toMatchObject({ pid: process.pid, token: expect.any(String) });
    await expect(memory.set("second", 2)).resolves.toMatchObject({ value: 2 });
    expect(lockDirectory(root)).toBe("");
  });

  it("preserves the precommit operation cause when cleanup also fails", async () => {
    const root = temporary();
    const memory = openKiroMemory("workspace", root);
    const operationFailure = new TypeError("operation failed before publication");
    const original = fs.unlinkSync;
    vi.spyOn(fs, "unlinkSync").mockImplementation((target) => {
      if (String(target).endsWith(`${path.sep}owner.json`)) throw new Error("cleanup failed");
      return original(target);
    });

    let calls = 0;
    const rejection = memory.set("key", true, undefined, () => { if (++calls === 3) throw operationFailure; });
    await expect(rejection).rejects.toMatchObject({ cause: operationFailure, errors: [operationFailure, expect.any(Error)] });
    await expect(rejection).rejects.not.toHaveProperty("committed", true);
    await expect(memory.get("key")).resolves.toBeNull();
  });

  it("does not claim a no-op delete committed when interruption and cleanup both fail", async () => {
    const root = temporary();
    const memory = openKiroMemory("workspace", root);
    const interruption = new Error("deadline");
    const original = fs.unlinkSync;
    vi.spyOn(fs, "unlinkSync").mockImplementation((target) => {
      if (String(target).endsWith(`${path.sep}owner.json`)) throw new Error("cleanup failed");
      return original(target);
    });
    let calls = 0;

    const rejection = memory.delete("missing", undefined, () => { if (++calls === 3) throw interruption; });
    await expect(rejection).rejects.toMatchObject({ cause: interruption });
    await expect(rejection).rejects.not.toHaveProperty("committed", true);
    await expect(memory.get("missing")).resolves.toBeNull();
  });

  it.each(["set", "delete"] as const)("treats unsupported directory sync as best effort for %s", async (operation) => {
    const memory = openKiroMemory("workspace", temporary());
    await memory.set("key", true);
    const original = fs.fsyncSync;
    vi.spyOn(fs, "fsyncSync").mockImplementation((descriptor) => {
      if (fs.fstatSync(descriptor).isDirectory()) {
        const error = Object.assign(new Error("unsupported"), { code: "EINVAL" });
        throw error;
      }
      return original(descriptor);
    });
    if (operation === "set") await expect(memory.set("key", false)).resolves.toMatchObject({ value: false });
    else await expect(memory.delete("key")).resolves.toEqual({ key: "key", deleted: true });
    await expect(memory.get("key")).resolves.toEqual(operation === "set" ? expect.objectContaining({ value: false }) : null);
    expect(lockDirectory(roots.at(-1)!)).toBe("");
  });

  it("acknowledges a committed set when directory sync fails after publication", async () => {
    const memory = openKiroMemory("workspace", temporary());
    const original = fs.fsyncSync;
    vi.spyOn(fs, "fsyncSync").mockImplementation((descriptor) => {
      if (fs.fstatSync(descriptor).isDirectory()) throw new Error("directory sync failed");
      return original(descriptor);
    });

    await expect(memory.set("key", true)).rejects.toMatchObject({
      committed: true,
      operation: "set",
      cause: expect.objectContaining({ message: "directory sync failed" }),
    });
    await expect(memory.get("key")).resolves.toMatchObject({ value: true });
  });

  it("acknowledges real directory-sync failure for a published delete and recovers", async () => {
    const root = temporary();
    const memory = openKiroMemory("workspace", root);
    await memory.set("key", true);
    const original = fs.fsyncSync;
    let fail = true;
    vi.spyOn(fs, "fsyncSync").mockImplementation((descriptor) => {
      if (fail && fs.fstatSync(descriptor).isDirectory()) { fail = false; throw Object.assign(new Error("real sync failure"), { code: "EIO" }); }
      return original(descriptor);
    });
    await expect(memory.delete("key")).rejects.toMatchObject({ committed: true, operation: "delete", cause: expect.objectContaining({ code: "EIO" }) });
    await expect(memory.get("key")).resolves.toBeNull();
    await expect(memory.set("next", 2)).resolves.toMatchObject({ value: 2 });
  });

  it("reports cleanup failure after commit and retries exact owned cleanup", async () => {
    const root = temporary();
    const memory = openKiroMemory("workspace", root);
    const original = fs.rmdirSync;
    let fail = true;
    vi.spyOn(fs, "rmdirSync").mockImplementation((target) => {
      if (fail && String(target).endsWith(".kiro-fabric-mutation-lock")) { fail = false; throw new Error("cleanup failed"); }
      return original(target);
    });
    await expect(memory.set("first", 1)).rejects.toMatchObject({ committed: true, cause: expect.any(Error) });
    await expect(memory.set("second", 2)).resolves.toMatchObject({ value: 2 });
    expect(lockDirectory(root)).toBe("");
  });

  it("refuses to remove a replacement lock identity during cleanup retry", async () => {
    const root = temporary();
    const memory = openKiroMemory("workspace", root);
    vi.spyOn(fs, "rmdirSync").mockImplementationOnce(() => { throw new Error("cleanup failed"); });
    await expect(memory.set("first", 1)).rejects.toMatchObject({ committed: true });
    vi.restoreAllMocks();
    const lock = lockDirectory(root);
    fs.rmSync(lock, { recursive: true });
    fs.mkdirSync(lock, { mode: 0o700 });
    fs.writeFileSync(path.join(lock, "owner.json"), "foreign", { mode: 0o600 });
    await expect(memory.set("second", 2)).rejects.toThrow(/foreign|replacement/);
    expect(fs.readFileSync(path.join(lock, "owner.json"), "utf8")).toBe("foreign");
  });

  it("retains directory identity after mkdir metadata failure and recovers on the same instance", async () => {
    const root = temporary();
    const memory = openKiroMemory("workspace", root);
    const original = fs.lstatSync;
    let fault = true;
    vi.spyOn(fs, "lstatSync").mockImplementation((target, options) => {
      if (fault && String(target).endsWith(".kiro-fabric-mutation-lock")) {
        throw Object.assign(new Error("metadata fault"), { code: "EIO" });
      }
      return original(target, options as never);
    });
    await expect(memory.set("first", 1)).rejects.toMatchObject({ cause: expect.objectContaining({ message: "metadata fault" }) });
    expect(lockDirectory(root)).not.toBe("");
    fault = false;
    await expect(memory.set("second", 2)).resolves.toMatchObject({ value: 2 });
    expect(lockDirectory(root)).toBe("");
  });

  it.each(["write", "close"] as const)("cleans partial owner initialization after %s failure and preserves cause", async (phase) => {
    const root = temporary();
    const memory = openKiroMemory("workspace", root);
    const failure = new Error(`${phase} initialization fault`);
    if (phase === "write") {
      const original = fs.writeFileSync;
      let fail = true;
      vi.spyOn(fs, "writeFileSync").mockImplementation(((target: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) => {
        if (fail && typeof target === "number" && String(data).includes("acquiredAt")) { fail = false; original(target, "{\"partial\":", "utf8"); throw failure; }
        return original(target, data, options as never);
      }) as typeof fs.writeFileSync);
    } else {
      const original = fs.closeSync;
      let fail = true;
      vi.spyOn(fs, "closeSync").mockImplementation((descriptor) => {
        if (fail) {
          const target = process.platform === "linux" ? fs.readlinkSync(`/proc/self/fd/${descriptor}`) : "";
          if (target.endsWith(`${path.sep}owner.json`)) { fail = false; throw failure; }
        }
        return original(descriptor);
      });
    }
    await expect(memory.set("first", 1)).rejects.toBe(failure);
    await expect(memory.get("first")).resolves.toBeNull();
    await expect(memory.set("second", 2)).resolves.toMatchObject({ value: 2 });
    expect(lockDirectory(root)).toBe("");
  });

  it("retains an opened owner descriptor after fstat failure and safely recovers", async () => {
    const root = temporary();
    const memory = openKiroMemory("workspace", root);
    const original = fs.fstatSync;
    let fault = true;
    vi.spyOn(fs, "fstatSync").mockImplementation((descriptor, options) => {
      const target = process.platform === "linux" ? fs.readlinkSync(`/proc/self/fd/${descriptor}`) : "";
      if (fault && target.endsWith(`${path.sep}owner.json`)) throw Object.assign(new Error("owner metadata fault"), { code: "EIO" });
      return original(descriptor, options as never);
    });
    await expect(memory.set("first", 1)).rejects.toMatchObject({ cause: expect.objectContaining({ message: "owner metadata fault" }) });
    fault = false;
    await expect(memory.set("second", 2)).resolves.toMatchObject({ value: 2 });
    expect(lockDirectory(root)).toBe("");
  });

  it("never closes an owner descriptor twice when its close fails during lock initialization", async () => {
    const root = temporary();
    const memory = openKiroMemory("workspace", root);
    const failure = Object.assign(new Error("owner close fault"), { code: "EIO" });
    // Capture the original through the module object before vi.spyOn replaces the property;
    // the fd is really released because POSIX leaves its state after a failed close unspecified.
    const original = (fs as { closeSync(descriptor: number): void }).closeSync;
    const calls: number[] = [];
    let fail = true;
    vi.spyOn(fs, "closeSync").mockImplementation((descriptor) => {
      calls.push(descriptor);
      const target = process.platform === "linux" ? fs.readlinkSync(`/proc/self/fd/${descriptor}`) : "";
      original(descriptor);
      if (fail && target.endsWith(`${path.sep}owner.json`)) { fail = false; throw failure; }
    });
    // Post-fix: the inner finally really closes the fd and throws EIO; cleanup succeeds and the
    // cleared owner descriptor is never closed again, so the original EIO error itself propagates.
    await expect(memory.set("first", 1)).rejects.toBe(failure);
    expect(calls.length).toBeGreaterThan(0);
    expect(new Set(calls).size).toBe(calls.length);
    vi.restoreAllMocks();
    await expect(memory.set("second", 2)).resolves.toMatchObject({ value: 2 });
    await expect(memory.get("second")).resolves.toMatchObject({ value: 2 });
    expect(lockDirectory(root)).toBe("");
  });

  it("serializes concurrent writes without losing entries", async () => {
    const memory = openKiroMemory("workspace", temporary());
    await Promise.all(Array.from({ length: 24 }, (_, index) => memory.set(`key-${index}`, index)));
    await expect(memory.list()).resolves.toHaveLength(24);
  });
});
