import { removeFixtureSync } from "./fixture-cleanup.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { buildSync } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openKiroMemory } from "../src/kiro/memory.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true });
});
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-memory-lock-recovery-"));
  roots.push(root);
  const memory = openKiroMemory("workspace", root, { maxEntries: 1 });
  const directory = path.join(root, "memory", fs.readdirSync(path.join(root, "memory")).find(name => name.startsWith("workspace-"))!);
  const lock = path.join(directory, ".kiro-fabric-mutation-lock");
  const owner = path.join(lock, "owner.json");
  const token = "dead-owner";
  const claim = path.join(directory, `.kiro-fabric-recovery-${crypto.createHash("sha256").update(token).digest("hex")}.claim`);
  fs.mkdirSync(lock, { mode: 0o700 });
  fs.writeFileSync(owner, JSON.stringify({ pid: 12345, acquiredAt: 1, token }), { mode: 0o600 });
  fs.utimesSync(lock, new Date(0), new Date(0));
  return { root, memory, lock, owner, claim, token };
};
const dead = () => { throw Object.assign(new Error("dead"), { code: "ESRCH" }); };

// Child-side barriers suspend inside synchronous filesystem operations, exactly
// at the former check/unlink race and at publication after quota validation.
const worker = `
import fs from 'node:fs';
import path from 'node:path';
import { openKiroMemory } from './memory.mjs';
const [root, lock, role, scenario] = process.argv.slice(2);
const mark = name => fs.writeFileSync(path.join(root, name), '1');
const wait = name => {
  const end = Date.now() + 20000;
  const word = new Int32Array(new SharedArrayBuffer(4));
  while (!fs.existsSync(path.join(root, name))) {
    if (Date.now() > end) throw new Error('barrier timeout: ' + name);
    Atomics.wait(word, 0, 0, 5);
  }
};
const memory = openKiroMemory('workspace', root, { maxEntries: 1 });
const open = fs.openSync, unlink = fs.unlinkSync;
let paused = false, contended = false, published = false;
fs.openSync = (target, ...args) => {
  const name = String(target);
  if (role === 'A' && scenario === 'observer' && !paused && name.endsWith('.claim')) {
    paused = true; mark('a-paused'); wait('resume-a');
  }
  if (role === (scenario === 'observer' ? 'B' : 'A') && !published && path.basename(name).startsWith('.kiro-fabric-memory-')) {
    published = true; mark('writer-quota'); wait('publish');
  }
  try { return open(target, ...args); }
  catch (error) {
    if (role === 'B' && scenario === 'exclusive' && name.endsWith('.claim') && error.code === 'EEXIST' && !contended) {
      contended = true; mark('b-contended'); wait('resume-b');
    }
    throw error;
  }
};
fs.unlinkSync = (target, ...args) => {
  if (role === 'A' && scenario === 'exclusive' && !paused && String(target) === path.join(lock, 'owner.json')) {
    paused = true; mark('a-paused'); wait('resume-a');
  }
  return unlink(target, ...args);
};
try { await memory.set(role, role); console.log(JSON.stringify({ ok: true })); }
catch (error) { console.log(JSON.stringify({ ok: false, error: error.message })); }
`;

const waitFor = async (target: string) => {
  const end = Date.now() + 20000;
  while (!fs.existsSync(target)) {
    if (Date.now() >= end) throw new Error(`barrier timeout: ${target}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

describe("memory identity-bound exclusive recovery", () => {
  it.each(["exclusive", "observer"])("serializes competing reclaimers at the %s barrier", async scenario => {
    const { root, memory, lock, owner, claim, token } = fixture();
    const exited = spawnSync(process.execPath, ["-e", "process.exit(0)"], { timeout: 15000 });
    expect(exited.error).toBeUndefined();
    expect(exited.status).toBe(0);
    expect(() => process.kill(exited.pid, 0)).toThrowError(expect.objectContaining({ code: "ESRCH" }));
    fs.writeFileSync(owner, JSON.stringify({ pid: exited.pid, acquiredAt: 1, token }));
    buildSync({ entryPoints: ["src/kiro/memory.ts"], outfile: path.join(root, "memory.mjs"), bundle: true, platform: "node", format: "esm" });
    fs.writeFileSync(path.join(root, "worker.mjs"), worker);
    const mark = (name: string) => fs.writeFileSync(path.join(root, name), "1");
    const wait = (name: string) => waitFor(path.join(root, name));
    const start = (role: string) => {
      const child = spawn(process.execPath, [path.join(root, "worker.mjs"), root, lock, role, scenario], { stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
      let out = "", err = "";
      child.stdout.on("data", chunk => { out += chunk; });
      child.stderr.on("data", chunk => { err += chunk; });
      const done = new Promise<{ code: number | null; signal: string | null; out: string; err: string }>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal, out, err }));
      });
      return { child, done };
    };
    const a = start("A");
    let b: ReturnType<typeof start> | undefined;
    try {
      await wait("a-paused");
      b = start("B");
      if (scenario === "exclusive") {
        await wait("b-contended");
        expect(fs.existsSync(claim)).toBe(true);
        expect(fs.statSync(claim).mode & 0o077).toBe(0);
        mark("resume-a");
        await wait("writer-quota");
        mark("resume-b");
      } else {
        await wait("writer-quota");
        const liveIdentity = fs.lstatSync(lock);
        const liveOwner = fs.readFileSync(owner, "utf8");
        mark("resume-a");
        const result = await a.done;
        expect(result).toMatchObject({ code: 0, signal: null, err: "" });
        expect(JSON.parse(result.out)).toMatchObject({ ok: false, error: expect.stringMatching(/replacement|foreign/) });
        expect(fs.lstatSync(lock).ino).toBe(liveIdentity.ino);
        expect(fs.readFileSync(owner, "utf8")).toBe(liveOwner);
      }
      expect(JSON.parse(fs.readFileSync(owner, "utf8")).pid).toBe(scenario === "exclusive" ? a.child.pid : b.child.pid);
      mark("publish");
      const results = await Promise.all([a.done, b.done]);
      for (const result of results) expect(result).toMatchObject({ code: 0, signal: null, err: "" });
      const outcomes = results.map(result => JSON.parse(result.out));
      expect(outcomes.filter(result => result.ok)).toHaveLength(1);
      if (scenario === "exclusive") expect(outcomes[1].error).toMatch(/1 entries/);
      await expect(memory.index()).resolves.toHaveLength(1);
      await expect(memory.list()).resolves.toHaveLength(1);
      expect(fs.existsSync(lock)).toBe(false);
      expect(fs.existsSync(claim)).toBe(false);
    } finally {
      for (const name of ["resume-a", "resume-b", "publish"]) mark(name);
      await Promise.allSettled([a.done, ...(b ? [b.done] : [])]);
    }
  }, 60000);

  it.each(["dead", "malformed", "symlink"])("preserves %s abandoned claims and the stale lock", async kind => {
    const { memory, owner, claim } = fixture();
    const bytes = fs.readFileSync(owner, "utf8");
    if (kind === "symlink") fs.symlinkSync(owner, claim);
    else fs.writeFileSync(claim, kind === "dead" ? JSON.stringify({ pid: 12345 }) : "{", { mode: 0o600 });
    const identity = fs.lstatSync(claim);
    vi.spyOn(process, "kill").mockImplementation(dead);
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(6000);
    await expect(memory.set("key", 1)).rejects.toThrow(/Timed out/);
    expect(fs.lstatSync(claim).ino).toBe(identity.ino);
    expect(fs.readFileSync(owner, "utf8")).toBe(bytes);
    await expect(memory.index()).resolves.toEqual([]);
  });

  it.each(["before", "after"])("preserves evidence when a reclaimer dies %s owner unlink", async phase => {
    const { root, memory, lock, owner, claim } = fixture();
    buildSync({ entryPoints: ["src/kiro/memory.ts"], outfile: path.join(root, "memory.mjs"), bundle: true, platform: "node", format: "esm" });
    fs.writeFileSync(path.join(root, "crash.mjs"), `
      import fs from 'node:fs';
      import { openKiroMemory } from './memory.mjs';
      const [root, owner, phase] = process.argv.slice(2);
      process.kill = () => { throw Object.assign(new Error('dead'), { code: 'ESRCH' }); };
      const unlink = fs.unlinkSync;
      fs.unlinkSync = target => {
        if (String(target) === owner) {
          if (phase === 'after') unlink(target);
          process.exit(73); // Abrupt exit: no recovery finally block runs.
        }
        return unlink(target);
      };
      await openKiroMemory('workspace', root).set('crashed', true);
    `);
    const result = spawnSync(process.execPath, [path.join(root, "crash.mjs"), root, owner, phase], { timeout: 15000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(73);
    expect(result.signal).toBeNull();
    expect(result.stderr.toString()).toBe("");
    const evidence = fs.readFileSync(claim, "utf8");
    const identity = fs.lstatSync(lock);
    expect(() => process.kill(JSON.parse(evidence).pid, 0)).toThrowError(expect.objectContaining({ code: "ESRCH" }));
    // Make the remaining directory stale without relying on wall-clock sleep.
    fs.utimesSync(lock, new Date(0), new Date(0));
    vi.spyOn(process, "kill").mockImplementation(dead);
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(6000);
    await expect(memory.set("successor", true)).rejects.toThrow(phase === "before" ? /Timed out/ : /uncertain/);
    expect(fs.readFileSync(claim, "utf8")).toBe(evidence);
    expect(fs.lstatSync(lock).ino).toBe(identity.ino);
    expect(fs.existsSync(owner)).toBe(phase === "before");
    await expect(memory.index()).resolves.toEqual([]);
  });

  it("preserves recovery and claim-cleanup failures together", async () => {
    const { memory, claim, owner } = fixture();
    vi.spyOn(process, "kill").mockImplementation(dead);
    const unlink = fs.unlinkSync;
    const recovery = new Error("recovery fault"), cleanup = new Error("claim cleanup fault");
    vi.spyOn(fs, "unlinkSync").mockImplementation(target => {
      if (String(target) === owner) throw recovery;
      if (String(target) === claim) throw cleanup;
      return unlink(target);
    });
    await expect(memory.set("key", 1)).rejects.toMatchObject({ cause: recovery, errors: [recovery, cleanup] });
    expect(fs.existsSync(claim)).toBe(true);
    expect(fs.existsSync(owner)).toBe(true);
    await expect(memory.index()).resolves.toEqual([]);
  });

  it("preserves an unidentified claim after fstat failure", async () => {
    const { memory, claim, owner } = fixture();
    const bytes = fs.readFileSync(owner, "utf8");
    vi.spyOn(process, "kill").mockImplementation(dead);
    vi.spyOn(fs, "fstatSync").mockImplementationOnce(() => { throw new Error("metadata fault"); });
    await expect(memory.set("key", 1)).rejects.toMatchObject({ cause: expect.objectContaining({ message: "metadata fault" }), errors: expect.any(Array) });
    expect(fs.existsSync(claim)).toBe(true);
    expect(fs.readFileSync(owner, "utf8")).toBe(bytes);
  });
});
