import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openKiroMemory } from "../src/kiro/memory.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-lock-safety-"));
  roots.push(root);
  const memory = openKiroMemory("workspace", root);
  const namespace = fs.readdirSync(path.join(root, "memory")).find(name => name.startsWith("workspace-"))!;
  const lock = path.join(root, "memory", namespace, ".kiro-fabric-mutation-lock");
  return { memory, lock, owner: path.join(lock, "owner.json") };
};
const valid = { pid: 12345, acquiredAt: 1, token: "original-token" };
const stale = (lock: string, owner: string, raw = JSON.stringify(valid)) => {
  fs.mkdirSync(lock);
  fs.writeFileSync(owner, raw);
  fs.utimesSync(lock, new Date(0), new Date(0));
};
const failure = (code: string) => Object.assign(new Error(code), { code });

describe("memory lock ownership safety", () => {
  it("preserves a replacement installed during the initial lstat failure, including on retry", async () => {
    const { memory, lock, owner } = fixture();
    const original = fs.lstatSync;
    let replace = true;
    vi.spyOn(fs, "lstatSync").mockImplementation((target, options) => {
      if (String(target) === lock && replace) {
        replace = false;
        fs.renameSync(lock, `${lock}-original`);
        fs.mkdirSync(lock);
        fs.writeFileSync(owner, "replacement");
        throw failure("EIO");
      }
      return original(target, options as never);
    });
    await expect(memory.set("first", 1)).rejects.toThrow(/unresolved/);
    const identity = fs.lstatSync(lock);
    await expect(memory.set("second", 2)).rejects.toThrow(/ownership identity is unavailable/);
    expect(fs.lstatSync(lock).ino).toBe(identity.ino);
    expect(fs.readFileSync(owner, "utf8")).toBe("replacement");
    await expect(memory.list()).resolves.toEqual([]);
  });

  it.each(["{", "null", "{}", ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "12345"].map(pid => JSON.stringify({ ...valid, pid })), JSON.stringify({ pid: 12345 })])(
    "preserves malformed stale owner %s", async raw => {
      const { memory, lock, owner } = fixture();
      stale(lock, owner, raw);
      const kill = vi.spyOn(process, "kill").mockImplementation(() => { throw failure("ESRCH"); });
      await expect(memory.set("key", 1)).rejects.toThrow(/uncertain/);
      expect(kill).not.toHaveBeenCalled();
      expect(fs.readFileSync(owner, "utf8")).toBe(raw);
      expect(fs.existsSync(lock)).toBe(true);
    },
  );

  it("preserves unreadable stale owner", async () => {
    const { memory, lock, owner } = fixture();
    stale(lock, owner);
    const read = fs.readFileSync;
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation((target, options) => {
      if (String(target) === owner) throw failure("EACCES");
      return read(target, options);
    });
    await expect(memory.set("key", 1)).rejects.toThrow(/unreadable/);
    spy.mockRestore();
    expect(JSON.parse(fs.readFileSync(owner, "utf8"))).toEqual(valid);
  });

  it.each(["live", "EPERM"])("preserves %s stale owner", async mode => {
    const { memory, lock, owner } = fixture();
    stale(lock, owner);
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(6000);
    vi.spyOn(process, "kill").mockImplementation(() => {
      if (mode === "EPERM") throw failure(mode);
      return true;
    });
    await expect(memory.set("key", 1)).rejects.toThrow(/live/);
    expect(JSON.parse(fs.readFileSync(owner, "utf8"))).toEqual(valid);
  });

  it.each(["EIO", "EINVAL", "EACCES"])("rejects unknown liveness %s without reclaiming", async code => {
    const { memory, lock, owner } = fixture();
    stale(lock, owner);
    vi.spyOn(process, "kill").mockImplementation(() => { throw failure(code); });
    await expect(memory.set("key", 1)).rejects.toThrow(/liveness is unknown/);
    expect(JSON.parse(fs.readFileSync(owner, "utf8"))).toEqual(valid);
  });

  it("preserves the directory if stale owner disappears before revalidation", async () => {
    const { memory, lock, owner } = fixture();
    stale(lock, owner);
    vi.spyOn(process, "kill").mockImplementation(() => {
      fs.unlinkSync(owner);
      throw failure("ESRCH");
    });
    await expect(memory.set("key", 1)).rejects.toMatchObject({ code: "ENOENT" });
    expect(fs.existsSync(lock)).toBe(true);
  });

  it("recovers a valid owner only after confirmed ESRCH", async () => {
    const { memory, lock, owner } = fixture();
    stale(lock, owner);
    const kill = vi.spyOn(process, "kill").mockImplementation(() => { throw failure("ESRCH"); });
    await expect(memory.set("key", 1)).resolves.toMatchObject({ value: 1 });
    expect(kill).toHaveBeenCalledWith(valid.pid, 0);
    expect(fs.existsSync(lock)).toBe(false);
  });

  it.each(["inode", "token", "directory"])("revalidates stale %s identity before reclaiming", async kind => {
    const { memory, lock, owner } = fixture();
    stale(lock, owner);
    vi.spyOn(process, "kill").mockImplementation(() => {
      if (kind === "directory") { fs.renameSync(lock, `${lock}-old`); fs.mkdirSync(lock); }
      if (kind === "inode") fs.renameSync(owner, `${owner}.old`);
      fs.writeFileSync(owner, JSON.stringify({ ...valid, token: kind === "inode" ? valid.token : "replacement" }));
      throw failure("ESRCH");
    });
    await expect(memory.set("key", 1)).rejects.toThrow(/foreign|replacement/);
    expect(fs.existsSync(owner)).toBe(true);
    expect(fs.existsSync(lock)).toBe(true);
    await expect(memory.get("key")).resolves.toBeNull();
  });
});
