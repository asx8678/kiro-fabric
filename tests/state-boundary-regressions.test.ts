import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { buildSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StateProvider } from "../src/providers/state-provider.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { validateSchemaValue } from "../src/schema-validation.js";
import { FabricDeadline } from "../src/runtime/deadline.js";

const roots: string[] = [];
const children: ChildProcess[] = [];
const exited = (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("state fixture did not exit")); }, 3000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
  });
};
const startWriter = (base: string, root: string, mode: string) => {
  const code = `
    import fs from 'node:fs';
    import path from 'node:path';
    import childProcess from 'node:child_process';
    import { pathToFileURL } from 'node:url';
    const [base, root, mode] = process.argv.slice(1);
    const { StateProvider } = await import(pathToFileURL(path.join(base, 'state-provider.mjs')).href);
    const provider = new StateProvider(root);
    const open = fs.openSync, sync = fs.fsyncSync;
    let lockFd, announced = false;
    const pause = () => {
      const end = Date.now() + 10000, word = new Int32Array(new SharedArrayBuffer(4));
      while (!fs.existsSync(path.join(base, 'release-claim'))) {
        if (Date.now() > end) throw Error('barrier timeout');
        Atomics.wait(word, 0, 0, 10);
      }
    };
    const spawn = childProcess.spawnSync;
    childProcess.spawnSync = (command, args, options) => {
      const result = spawn(command, args, options);
      if (Buffer.isBuffer(options?.input)) {
        const request = JSON.parse(options.input.subarray(4, 4 + options.input.readUInt32BE()).toString('utf8'));
        if (mode === 'contender' && request.operation === 'writeExclusive' && request.name.endsWith('.claim') && !announced && JSON.parse(result.stdout).code === 'EEXIST') {
          announced = true; process.send({type:'contending'});
        }
      }
      return result;
    };
    fs.openSync = (file, flags, perms) => {
      let fd;
      try { fd = open(file, flags, perms); }
      catch (error) {
        if (mode === 'contender' && String(file).endsWith('.claim') && error.code === 'EEXIST' && !announced) {
          announced = true; process.send({type:'contending'});
        }
        throw error;
      }
      if (String(file).endsWith('.state-mutation.lock') && (flags & fs.constants.O_WRONLY)) lockFd = fd;
      if (mode === 'hold' && String(file).endsWith('.claim') && !announced) {
        announced = true; process.send({type:'claimed'}); pause();
      }
      return fd;
    };
    fs.fsyncSync = fd => {
      sync(fd);
      if (mode === 'crash' && fd === lockFd) { process.send({type:'held'}); pause(); }
    };
    try {
      const result = await provider.invoke('set', {key:'shared',value:mode,expectedRevision:0}, {cwd:root});
      process.send({type:'result',ok:true,result}, () => process.exit(0));
    } catch (error) {
      const flat = e => e instanceof AggregateError ? e.message + ' | causes: ' + e.errors.map(flat).join(' | ') : (e && e.message) + ' | ' + (e && e.cause ? flat(e.cause) : '');
      process.send({type:'result',ok:false,error:flat(error)}, () => process.exit(0));
    }
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code, base, root, mode], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  children.push(child);
  const messages: Array<Record<string, unknown>> = [];
  let stderr = "";
  child.stderr?.on("data", chunk => { stderr += String(chunk); });
  child.on("message", message => messages.push(message as Record<string, unknown>));
  const message = (type: string): Promise<Record<string, unknown>> => {
    const existing = messages.find(value => value.type === type);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); child.off("message", onMessage); child.off("exit", onExit); child.off("error", onError); };
      const onMessage = (value: unknown) => {
        const record = value as Record<string, unknown>;
        if (record.type === type) { cleanup(); resolve(record); }
      };
      const onExit = () => { cleanup(); reject(new Error(`writer exited before ${type}: ${stderr}`)); };
      const onError = (error: Error) => { cleanup(); reject(error); };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`missing ${type}: ${stderr}`)); }, 5000);
      child.on("message", onMessage); child.once("exit", onExit); child.once("error", onError);
    });
  };
  return { child, message };
};
const fixture = () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "state-boundary-"));
  roots.push(base);
  const root = path.join(base, "state");
  return { base, root, provider: new StateProvider(root), context: { cwd: base } };
};
const lockRecord = (pid: number, token = "a".repeat(32)) => ({
  schemaVersion: 2, kind: "kiro-fabric-state-lock", process: { pid }, token, acquiredAt: 1,
});
const staleLock = (root: string, record: unknown) => {
  const lock = path.join(root, ".state-mutation.lock");
  fs.writeFileSync(lock, JSON.stringify(record), { mode: 0o600 });
  fs.utimesSync(lock, new Date(0), new Date(0));
  return lock;
};
const deadOwner = () => {
  const kill = process.kill;
  vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    if (pid === 2_147_483_647) throw Object.assign(new Error("dead fixture owner"), { code: "ESRCH" });
    return kill(pid, signal);
  });
};
afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited(child);
  }
  for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true });
});

describe("state root identity", () => {
  it.each(["missing", "replacement", "symlink"])("rejects a %s root rather than reporting empty state", async (change) => {
    const { base, root, provider, context } = fixture();
    await provider.invoke("set", { key: "saved", value: "retained" }, context);
    fs.renameSync(root, path.join(base, "original"));
    if (change === "replacement") fs.mkdirSync(root, { mode: 0o700 });
    if (change === "symlink") {
      fs.mkdirSync(path.join(base, "foreign"), { mode: 0o700 });
      fs.symlinkSync(path.join(base, "foreign"), root, "dir");
    }
    for (const action of ["get", "list", "set", "delete"]) {
      await expect(provider.invoke(action, { key: "saved", value: "wrong" }, context)).rejects.toThrow(/state root/);
    }
    expect(JSON.parse(fs.readFileSync(path.join(base, "original", "state.json"), "utf8")).entries.saved.value).toBe("retained");
    if (change !== "missing") expect(fs.readdirSync(root)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("rejects a root whose permissions become public", async () => {
    const { root, provider, context } = fixture();
    fs.chmodSync(root, 0o755);
    await expect(provider.invoke("get", { key: "absent" }, context)).rejects.toThrow(/state root/);
    await expect(provider.invoke("set", { key: "absent", value: true }, context)).rejects.toThrow(/state root/);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("revalidates the root while queued behind a live writer", async () => {
    const { base, root, provider, context } = fixture();
    staleLock(root, { pid: process.pid, acquiredAt: Date.now() });
    const pending = provider.invoke("set", { key: "new", value: true }, context);
    const rejected = expect(pending).rejects.toThrow(/state root/);
    fs.renameSync(root, path.join(base, "original"));
    fs.mkdirSync(root, { mode: 0o700 });
    await rejected;
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("distinguishes a missing state file from a root lost during the read", async () => {
    const { base, root, provider, context } = fixture();
    await expect(provider.invoke("get", { key: "absent" }, context)).resolves.toMatchObject({ found: false });
    const stat = fs.lstatSync;
    vi.spyOn(fs, "lstatSync").mockImplementation(((file: fs.PathLike) => {
      if (String(file) === path.join(root, "state.json")) {
        fs.renameSync(root, path.join(base, "original"));
        fs.mkdirSync(root, { mode: 0o700 });
        throw Object.assign(new Error("file vanished with its root"), { code: "ENOENT" });
      }
      return stat(file);
    }) as typeof fs.lstatSync);
    await expect(provider.invoke("get", { key: "absent" }, context)).rejects.toThrow(/state root/);
  });
});

describe("state recovery arbitration", () => {
  it.each(["EIO", "EACCES"])("propagates %s from final owner inspection instead of retrying it as contention", async (code) => {
    const { root, provider, context } = fixture();
    const lock = staleLock(root, lockRecord(2_147_483_647));
    const stat = fs.lstatSync;
    const abort = new AbortController();
    let namedReads = 0;
    vi.spyOn(fs, "lstatSync").mockImplementation(((file: fs.PathLike, ...options: unknown[]) => {
      if (String(file) === lock && ++namedReads % 2 === 0) {
        // Bound the regression even on the old catch-all implementation.
        if (namedReads >= 4) abort.abort(new Error("repeated masked inspection failure"));
        throw Object.assign(new Error("final inspection failed"), { code });
      }
      return (stat as (...args: unknown[]) => unknown)(file, ...options);
    }) as typeof fs.lstatSync);
    await expect(provider.invoke("set", { key: "new", value: true }, { ...context, signal: abort.signal })).rejects.toMatchObject({ code });
    expect(namedReads).toBe(2);
    expect(fs.readFileSync(lock, "utf8")).toBe(JSON.stringify(lockRecord(2_147_483_647)));
    expect(fs.readdirSync(root)).toEqual([".state-mutation.lock"]);
  });
  it("serializes real reclaimers after SIGKILL without exposing a live writer window", async () => {
    const { base, root, provider, context } = fixture();
    buildSync({ entryPoints: [path.resolve("src/providers/state-provider.ts")], outfile: path.join(base, "state-provider.mjs"), bundle: true, platform: "node", format: "esm", logLevel: "silent" });
    const crashed = startWriter(base, root, "crash");
    await crashed.message("held");
    crashed.child.kill("SIGKILL");
    await exited(crashed.child);
    const lock = path.join(root, ".state-mutation.lock");
    const original = fs.lstatSync(lock);
    fs.utimesSync(lock, new Date(0), new Date(0));
    const first = startWriter(base, root, "hold");
    const firstResult = first.message("result");
    await first.message("claimed");
    const second = startWriter(base, root, "contender");
    const secondResult = second.message("result");
    await second.message("contending");
    // A second recovery attempt cannot clear the mutation pathname while the
    // first has authority. This barrier does not depend on guessed sleep times.
    expect(fs.lstatSync(lock).ino).toBe(original.ino);
    expect(fs.existsSync(path.join(root, "state.json"))).toBe(false);
    fs.writeFileSync(path.join(base, "release-claim"), "continue");
    const results = await Promise.all([firstResult, secondResult]);
    console.error("DIAG " + JSON.stringify(results) + " ROOT " + JSON.stringify(fs.readdirSync(root)));
    console.error("DIAG1 " + JSON.stringify(results));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.find(result => !result.ok)?.error).toContain("state revision conflict");
    await Promise.all([exited(first.child), exited(second.child)]);
    await expect(provider.invoke("get", { key: "shared" }, context)).resolves.toMatchObject({ revision: 1 });
    console.error("DIAG2 " + JSON.stringify(fs.readdirSync(root)));
    expect(fs.readdirSync(root), "writer results: " + JSON.stringify(results) + " listing: " + JSON.stringify(fs.readdirSync(root))).toEqual(["state.json"]);
  });
  it("preserves legacy stale locks that cannot safely arbitrate recovery", async () => {
    const { root, provider, context } = fixture();
    const lock = staleLock(root, { pid: 2_147_483_647, acquiredAt: 1 });
    deadOwner();
    const before = fs.readFileSync(lock);
    await expect(provider.invoke("set", { key: "new", value: true }, context)).rejects.toThrow(/legacy.*recovery/);
    expect(fs.readFileSync(lock)).toEqual(before);
    expect(fs.readdirSync(root)).toEqual([".state-mutation.lock"]);
  });

  it("recovers a definitely-dead versioned owner without losing revision checks", async () => {
    const { root, provider, context } = fixture();
    staleLock(root, lockRecord(2_147_483_647));
    deadOwner();
    const other = new StateProvider(root);
    const results = await Promise.allSettled([provider, other].map(writer =>
      writer.invoke("set", { key: "shared", value: "winner", expectedRevision: 0 }, context)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    await expect(provider.invoke("get", { key: "shared" }, context)).resolves.toMatchObject({ revision: 1, value: "winner" });
    expect(fs.readdirSync(root)).toEqual(["state.json"]);
  });

  it("does not move a live replacement discovered after taking a recovery claim", async () => {
    const { base, root, provider, context } = fixture();
    const lock = staleLock(root, lockRecord(2_147_483_647));
    deadOwner();
    const open = fs.openSync;
    const abort = new AbortController();
    let replaced = false;
    const live = JSON.stringify(lockRecord(process.pid, "b".repeat(32)));
    vi.spyOn(fs, "openSync").mockImplementation((file, flags, mode) => {
      const fd = open(file, flags, mode);
      if (!replaced && String(file).endsWith(".claim")) {
        replaced = true;
        fs.renameSync(lock, path.join(base, "stale-original"));
        fs.writeFileSync(lock, live, { mode: 0o600 });
        abort.abort(new Error("stop after replacement"));
      }
      return fd;
    });
    await expect(provider.invoke("set", { key: "new", value: true }, { ...context, signal: abort.signal })).rejects.toThrow();
    expect(replaced).toBe(true);
    expect(fs.readFileSync(lock, "utf8")).toBe(live);
    expect(fs.readdirSync(root)).toEqual([".state-mutation.lock"]);
  });

  it("preserves interrupted recovery claims and leaves the stale lock in place", async () => {
    const { root, provider, context } = fixture();
    const lock = staleLock(root, lockRecord(2_147_483_647));
    deadOwner();
    const claim = path.join(root, `.state-recovery-${"a".repeat(32)}.claim`);
    fs.writeFileSync(claim, "partial recovery evidence", { mode: 0o600 });
    const pending = provider.invoke("set", { key: "new", value: true }, { ...context, deadline: new FabricDeadline(40, 40) });
    await expect(pending).rejects.toThrow();
    expect(fs.readFileSync(claim, "utf8")).toBe("partial recovery evidence");
    expect(fs.existsSync(lock)).toBe(true);
    expect(fs.existsSync(path.join(root, "state.json"))).toBe(false);
  });
});

describe("state key bounds", () => {
  it.each([
    { name: "astral", key: "\u{1F600}".repeat(257) },
    { name: "combining", key: "a" + "\u0301".repeat(512) },
  ])("rejects a schema-admitted $name key without poisoning existing state", async ({ key }) => {
    const { root, provider, context } = fixture();
    const registry = new ActionRegistry();
    registry.register(provider);
    const scoped = { ...context, audits: [], maxResultChars: 16_000, approve: async () => {} };
    try {
      await registry.invoke("state.set", { key: "healthy", value: "unrelated" }, scoped);
      const file = path.join(root, "state.json");
      const before = fs.readFileSync(file);
      const args = { key, value: "poison" };
      const descriptor = await provider.describe("set");
      expect(validateSchemaValue(descriptor?.inputSchema, args)).toEqual({ status: "valid" });
      await expect(registry.invoke("state.set", args, scoped)).rejects.toThrow("state key exceeds configured bounds");
      expect(fs.readFileSync(file)).toEqual(before);
      expect(fs.readdirSync(root)).toEqual(["state.json"]);
      expect(await registry.invoke("state.get", { key: "healthy" }, scoped)).toMatchObject({ value: "unrelated", revision: 1 });
      expect(await registry.invoke("state.list", {}, scoped)).toMatchObject({ revision: 1, entries: [{ key: "healthy", revision: 1 }] });
      expect(await registry.invoke("state.delete", { key: "healthy", expectedRevision: 1 }, scoped)).toEqual({ key: "healthy", deleted: true, revision: 2 });
    } finally { await registry.close(); }
  });

  it.each([
    { name: "ASCII", key: "a".repeat(512) },
    { name: "astral", key: "\u{1F600}".repeat(256) },
    { name: "combining", key: "a" + "\u0301".repeat(511) },
  ])("round-trips a $name key at the persisted UTF-16 limit after reopening", async ({ key }) => {
    const { root, provider, context } = fixture();
    expect(key.length).toBe(512);
    await expect(provider.invoke("set", { key, value: "boundary" }, context)).resolves.toEqual({ key, revision: 1 });
    const reopened = new StateProvider(root);
    expect(await reopened.invoke("get", { key }, context)).toMatchObject({ key, value: "boundary", revision: 1 });
    expect(await reopened.invoke("list", {}, context)).toMatchObject({ revision: 1, entries: [{ key, revision: 1 }] });
    expect(await reopened.invoke("delete", { key, expectedRevision: 1 }, context)).toEqual({ key, deleted: true, revision: 2 });
  });

  it("rejects invalid direct-provider keys before opening state files or locks", async () => {
    const { root, provider, context } = fixture();
    const open = vi.spyOn(fs, "openSync");
    for (const key of ["", undefined, null, 42, "a".repeat(513), "\u{1F600}".repeat(257)]) {
      for (const action of ["get", "set", "delete"]) {
        await expect(provider.invoke(action, { key, value: "invalid" }, context)).rejects.toThrow("state key exceeds configured bounds");
      }
    }
    expect(open).not.toHaveBeenCalled();
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("preserves existing malformed state instead of silently repairing or discarding it", async () => {
    const { root, provider, context } = fixture();
    const file = path.join(root, "state.json");
    const text = JSON.stringify({ schemaVersion: 1, revision: 1, entries: {
      ["\u{1F600}".repeat(257)]: { revision: 1, value: "retained evidence", updatedAt: 1 },
    } });
    fs.writeFileSync(file, text, { mode: 0o600 });
    await expect(provider.invoke("get", { key: "healthy" }, context)).rejects.toThrow("state file is malformed");
    expect(fs.readFileSync(file, "utf8")).toBe(text);
  });
});
