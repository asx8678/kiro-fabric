import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StateProvider } from "../src/providers/state-provider.js";
import * as stateDirectory from "../src/providers/state-directory.js";
import { fabricCommitAcknowledgement } from "../src/protocol.js";
import { causes, failLockRemoval } from "./state-fault-helpers.js";

const roots: string[] = [];
const temporary = (): string => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "state-durability-")); roots.push(root); return root; };
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
const posix = process.platform !== "win32";

/** Structural narrowing for the internal acknowledgement class: the class is
 * deliberately unexported, so these tests assert the stable public Error
 * contract (name, committed marker, revision, durability, lock cleanup). */
const acknowledgementError = (value: unknown): Error => {
  if (!(value instanceof Error)) throw new Error("expected a state commit acknowledgement error");
  return value;
};

/** Record fsync and rename events with fd classification (file vs directory
 * and inode identity) instead of brittle ordinal counts. */
const trackPublication = (): { events: string[]; restore: () => void } => {
  const sync = fs.fsyncSync, stat = fs.fstatSync, publish = stateDirectory.publishPinnedStateFile;
  const events: string[] = [];
  const syncSpy = vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
    const observed = stat(fd);
    events.push(observed.isDirectory() ? `fsync:directory:${observed.ino}` : `fsync:file:${observed.ino}`);
    return sync(fd);
  });
  const renameSpy = vi.spyOn(stateDirectory, "publishPinnedStateFile").mockImplementation((directory, name, target, expected, targetExpected, published) => {
    return publish(directory, name, target, expected, targetExpected, () => { events.push(`rename:${target}`); published(); });
  });
  return { events, restore: () => { syncSpy.mockRestore(); renameSpy.mockRestore(); } };
};


describe("state publication durability barrier", () => {
  it.skipIf(!posix)("fsyncs the exclusive temporary before rename and the store directory after it", async () => {
    const root = temporary();
    const { events, restore } = trackPublication();
    const provider = new StateProvider(root);
    const construction = events.splice(0);
    const context = { cwd: root };
    const result = await provider.invoke("set", { key: "fixture", value: "v1" }, context);
    restore();
    expect(result).toEqual({ key: "fixture", revision: 1 });
    // Construction established the root's own and its parent's directory entries.
    const constructionDirectories = construction.filter(event => event.startsWith("fsync:directory"));
    expect(constructionDirectories.length).toBeGreaterThanOrEqual(2);
    expect(constructionDirectories).toContain(`fsync:directory:${fs.statSync(path.dirname(fs.realpathSync(root))).ino}`);
    // Every fsync before the rename is a file fsync; the temporary is the last one.
    const renameIndex = events.findIndex(event => event === "rename:state.json");
    expect(renameIndex).toBeGreaterThan(-1);
    const beforeRename = events.slice(0, renameIndex);
    const afterRename = events.slice(renameIndex + 1);
    expect(beforeRename.length).toBeGreaterThan(0);
    expect(beforeRename.every(event => event.startsWith("fsync:file"))).toBe(true);
    // Exactly one directory barrier on the store root, and nothing after it.
    expect(afterRename).toEqual([`fsync:directory:${fs.statSync(root).ino}`]);
  });

  it.skipIf(!posix)("reports publication with unconfirmed durability when the directory barrier fails", async () => {
    const root = temporary();
    const provider = new StateProvider(root);
    const context = { cwd: root };
    await provider.invoke("set", { key: "fixture", value: "old" }, context);
    const rootStat = fs.statSync(root);
    const sync = fs.fsyncSync, stat = fs.fstatSync;
    const failBarrier = (): ReturnType<typeof vi.spyOn> => vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      const observed = stat(fd);
      if (observed.isDirectory() && observed.ino === rootStat.ino && observed.dev === rootStat.dev) {
        throw Object.assign(new Error("injected directory barrier failure"), { code: "EIO" });
      }
      return sync(fd);
    });
    const spy = failBarrier();
    const error = acknowledgementError(await provider.invoke("set", { key: "fixture", value: "new" }, context).catch(error => error));
    spy.mockRestore();
    expect(error).toMatchObject({ name: "StateCommitAcknowledgementError", committed: true, revision: 2, durability: "unconfirmed" });
    expect(error.message).toContain("unconfirmed");
    expect(error.message).toContain("do not replay external effects");
    expect(fabricCommitAcknowledgement(error)).toEqual({ version: 1, operation: "set" });
    // The published bytes are preserved; there is no rollback or retry.
    expect(JSON.parse(fs.readFileSync(path.join(root, "state.json"), "utf8"))).toMatchObject({ revision: 2 });
    await expect(provider.invoke("get", { key: "fixture" }, context)).resolves.toMatchObject({ value: "new", revision: 2 });
    // The same semantics hold for delete, and the next mutation recovers.
    const deleteSpy = failBarrier();
    const deleteError = await provider.invoke("delete", { key: "fixture", expectedRevision: 2 }, context).catch(error => error);
    deleteSpy.mockRestore();
    expect(deleteError).toMatchObject({ committed: true, revision: 3, durability: "unconfirmed" });
    expect(fabricCommitAcknowledgement(deleteError)).toEqual({ version: 1, operation: "delete" });
    expect(JSON.parse(fs.readFileSync(path.join(root, "state.json"), "utf8"))).toMatchObject({ revision: 3 });
    // The entry was deleted, so a fresh set starts from entry revision 0.
    await expect(provider.invoke("set", { key: "fixture", value: "recovered", expectedRevision: 0 }, context)).resolves.toEqual({ key: "fixture", revision: 4 });
  });

  it.each(["rename", "temporary-sync"] as const)("keeps the prior revision authoritative after pre-publication %s failure", async (fault) => {
    const root = temporary();
    const provider = new StateProvider(root);
    const context = { cwd: root };
    await provider.invoke("set", { key: "fixture", value: "old" }, context);
    const open = fs.openSync, sync = fs.fsyncSync, stat = fs.fstatSync;
    let temporaryIno: number | undefined;
    const openSpy = vi.spyOn(fs, "openSync").mockImplementation((file, flags, mode) => {
      const fd = open(file, flags, mode);
      if (String(file).endsWith(".tmp")) temporaryIno = stat(fd).ino;
      return fd;
    });
    const syncSpy = vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      if (fault === "temporary-sync" && temporaryIno !== undefined && stat(fd).ino === temporaryIno) {
        throw new Error("injected temporary fsync failure");
      }
      return sync(fd);
    });
    const renameSpy = fault === "rename"
      ? vi.spyOn(stateDirectory, "publishPinnedStateFile").mockImplementation(() => { throw new Error("injected rename failure"); })
      : undefined;
    const error = await provider.invoke("set", { key: "fixture", value: "new" }, context).catch(error => error);
    openSpy.mockRestore(); syncSpy.mockRestore(); renameSpy?.mockRestore();
    expect(fabricCommitAcknowledgement(error)).toBeUndefined();
    expect(error).toBeInstanceOf(Error);
    expect(causes(error)).toContain(fault === "rename" ? "rename failure" : "temporary fsync failure");
    // The old state remains authoritative and no temporary is left behind.
    await expect(provider.invoke("get", { key: "fixture" }, context)).resolves.toMatchObject({ value: "old", revision: 1 });
    expect(fs.readdirSync(root).sort()).toEqual(["state.json"]);
    await expect(provider.invoke("set", { key: "fixture", value: "recovered", expectedRevision: 1 }, context)).resolves.toEqual({ key: "fixture", revision: 2 });
  });

  it("reports confirmed durability when only the acknowledgement fails after the barrier", async () => {
    const root = temporary();
    const provider = new StateProvider(root);
    const context = { cwd: root };
    failLockRemoval("injected lock removal failure");
    const error = acknowledgementError(await provider.invoke("set", { key: "fixture", value: "v1" }, context).catch(error => error));
    vi.restoreAllMocks();
    expect(error).toMatchObject({ name: "StateCommitAcknowledgementError", committed: true, revision: 1, durability: "confirmed" });
    expect(error.message).toContain("read state before retrying");
    // The mutation itself is durable; only the acknowledgement failed.
    await expect(provider.invoke("get", { key: "fixture" }, context)).resolves.toMatchObject({ value: "v1", revision: 1 });
  });

  it.skipIf(!posix)("establishes the root's directory entry at construction", async () => {
    const root = temporary();
    const { events, restore } = trackPublication();
    const provider = new StateProvider(root);
    const construction = events.splice(0);
    const context = { cwd: root };
    await provider.invoke("set", { key: "fixture", value: "v1" }, context);
    restore();
    expect(provider.directoryBarrier).toBe("fsync");
    expect(construction.filter(event => event.startsWith("fsync:directory"))).toEqual([
      `fsync:directory:${fs.statSync(fs.realpathSync(root)).ino}`,
      `fsync:directory:${fs.statSync(path.dirname(fs.realpathSync(root))).ino}`,
    ]);
    expect(events).toContain(`fsync:directory:${fs.statSync(root).ino}`);
  });

  it.skipIf(!posix)("marks the barrier unconfirmed when directory syncs are unsupported", async () => {
    const root = temporary();
    const sync = fs.fsyncSync, stat = fs.fstatSync;
    const spy = vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      if (stat(fd).isDirectory()) throw Object.assign(new Error("unsupported directory fsync"), { code: "EINVAL" });
      return sync(fd);
    });
    const provider = new StateProvider(root);
    expect(provider.directoryBarrier).toBe("unconfirmed");
    // Directory-sync failure is a failure, not an ignored optimization: the
    // mutation reports publication with unconfirmed durability.
    const error = await provider.invoke("set", { key: "fixture", value: "v1" }, { cwd: root }).catch(error => error);
    spy.mockRestore();
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: "StateCommitAcknowledgementError", committed: true, revision: 1, durability: "unconfirmed" });
    expect(JSON.parse(fs.readFileSync(path.join(root, "state.json"), "utf8"))).toMatchObject({ revision: 1 });
  });

  it("setSerialized serves trusted host writers with set-identical semantics", async () => {
    const root = temporary();
    const provider = new StateProvider(root);
    const context = { cwd: root };
    // The host fast path is not a guest action.
    await expect(provider.invoke("setSerialized", { key: "k", value: 1, text: "1" }, context)).rejects.toThrow("Unknown state action");
    // Barrier ordering matches set: file fsyncs before rename, the store
    // directory barrier after it, nothing later.
    const { events, restore } = trackPublication();
    const first = await provider.setSerialized({ key: "k", value: { a: 1 }, text: `{"a":1}`, expectedRevision: 0 }, context);
    restore();
    expect(first).toEqual({ key: "k", revision: 1 });
    const renameIndex = events.findIndex(event => event === "rename:state.json");
    expect(renameIndex).toBeGreaterThan(-1);
    expect(events.slice(0, renameIndex).every(event => event.startsWith("fsync:file"))).toBe(true);
    expect(events.slice(renameIndex + 1)).toEqual([`fsync:directory:${fs.statSync(root).ino}`]);
    // CAS, bounds, key and text validation behave exactly like set.
    await expect(provider.setSerialized({ key: "k", value: 1, text: "1", expectedRevision: 5 }, context)).rejects.toThrow("revision conflict");
    const bounded = new StateProvider(temporary(), { maxValueChars: 4 });
    await expect(bounded.setSerialized({ key: "k", value: 1, text: "12345" }, { cwd: root })).rejects.toThrow("state value exceeds configured bounds");
    await expect(provider.setSerialized({ key: "", value: 1, text: "1" }, context)).rejects.toThrow("state key exceeds configured bounds");
    await expect(provider.setSerialized({ key: "k2", value: 1, text: 5 as never }, context)).rejects.toThrow("serialized value is malformed");
    // The stored form is readable through the unchanged guest surface.
    await expect(provider.invoke("get", { key: "k" }, context)).resolves.toMatchObject({ value: { a: 1 }, revision: 1 });
  });

  it("wraps setSerialized post-publication failures with unconfirmed durability", async () => {
    const root = temporary();
    const provider = new StateProvider(root);
    const context = { cwd: root };
    const rootStat = fs.statSync(root);
    const sync = fs.fsyncSync, stat = fs.fstatSync;
    const spy = vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      const observed = stat(fd);
      if (observed.isDirectory() && observed.ino === rootStat.ino && observed.dev === rootStat.dev) {
        throw Object.assign(new Error("injected directory barrier failure"), { code: "EIO" });
      }
      return sync(fd);
    });
    const error = acknowledgementError(await provider.setSerialized({ key: "k", value: { a: 1 }, text: `{"a":1}` }, context).catch(error => error));
    spy.mockRestore();
    expect(error).toMatchObject({ name: "StateCommitAcknowledgementError", committed: true, revision: 1, durability: "unconfirmed" });
    expect(JSON.parse(fs.readFileSync(path.join(root, "state.json"), "utf8"))).toMatchObject({ revision: 1 });
  });

  it("preserves set precedence and validates list limits", async () => {
    const root = temporary();
    const provider = new StateProvider(root);
    const context = { cwd: root };
    await provider.invoke("set", { key: "k", value: 1 }, context);
    // A value that cannot serialize AND a stale revision still reports the
    // revision conflict first, exactly as before the pre-serialized fast path.
    await expect(provider.invoke("set", { key: "k", value: undefined, expectedRevision: 99 }, context)).rejects.toThrow("state revision conflict");
    await expect(provider.invoke("set", { key: "k", value: undefined }, context)).rejects.toThrow("state value exceeds configured bounds");
    // List limits follow the declared schema instead of silently mis-slicing.
    await expect(provider.invoke("list", { limit: 0 }, context)).rejects.toThrow("state list limit is invalid");
    await expect(provider.invoke("list", { limit: 5000 }, context)).rejects.toThrow("state list limit is invalid");
    await expect(provider.invoke("list", { limit: 1.5 }, context)).rejects.toThrow("state list limit is invalid");
    const listed = await provider.invoke("list", { limit: 2 }, context) as { entries: unknown[] };
    expect(listed.entries).toEqual([{ key: "k", revision: 1, updatedAt: expect.any(Number) }]);
  });

  it("never claims durability for pre-publication failures", async () => {
    const root = temporary();
    const provider = new StateProvider(root);
    const context = { cwd: root };
    const error = await provider.invoke("set", { key: "fixture", value: "v1" }, { ...context, signal: AbortSignal.abort(new Error("pre-commit cancellation")) }).catch(error => error);
    expect(fabricCommitAcknowledgement(error)).toBeUndefined();
    expect(fs.existsSync(path.join(root, "state.json"))).toBe(false);
  });
});
