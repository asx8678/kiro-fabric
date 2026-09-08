import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireInstallationLock, inspectInstallationLock, installationLockAvailability, inspectInstallationProcesses } from "../scripts/installer-lock.mjs";

import { hasDirectoryFdTraversal } from "./installer-capability-fixture.js";
const recoveryIt = it.skipIf(!hasDirectoryFdTraversal);
const modulePath = fileURLToPath(new URL("../src/installation/installer-lock.mjs", import.meta.url));
const fixtures: string[] = [];
const children: ChildProcess[] = [];
const fixture = () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kf-lock-")));
  fs.chmodSync(base, 0o700);
  fixtures.push(base);
  return base;
};
const target = (base: string) => path.join(base, ".install-lock");
const ownerPath = (base: string) => path.join(target(base), "owner.json");
const readOwner = (base: string) => JSON.parse(fs.readFileSync(ownerPath(base), "utf8"));
const writeOwner = (base: string, value: object) => fs.writeFileSync(ownerPath(base), `${JSON.stringify(value)}\n`, { mode: 0o600 });
const quarantine = (base: string) => fs.readdirSync(base).filter(name => name.startsWith(".install-lock-quarantine-"));
const childSource = `
import { acquireInstallationLock } from ${JSON.stringify(new URL("../scripts/installer-lock.mjs", import.meta.url).href)};
const base = process.argv[1];
const phase = process.argv[2];
process.on('message', message => {
 if (message !== 'go') return;
 try {
  const release = acquireInstallationLock(base, { recover: true, transactionId: 'fixture-transaction', onPhase(name) {
   if (name === phase) { process.send({ phase: name }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); }
  }});
  process.send({ acquired: true, recovered: release.recovered });
  setInterval(() => {}, 1000);
 } catch(error) { process.send({ error: error.code ?? error.message }); process.exitCode = 1; process.disconnect(); }
});
process.send({ ready: true });
`;
type Message = { ready?: boolean; phase?: string; acquired?: boolean; error?: string; recovered?: unknown[] };
const nextMessage = (child: ChildProcess): Promise<Message> => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { cleanup(); reject(new Error("child message deadline")); }, 8000);
  const onMessage = (value: Message) => { cleanup(); resolve(value); };
  const onExit = (code: number | null, signal: string | null) => { cleanup(); reject(new Error(`child exited before message ${code}/${signal}`)); };
  const cleanup = () => { clearTimeout(timeout); child.off("message", onMessage); child.off("exit", onExit); };
  child.once("message", onMessage);
  child.once("exit", onExit);
});
const launch = async (base: string, phase = "", executable = process.execPath) => {
  const home = fixture();
  const child = spawn(executable, ["--input-type=module", "-e", childSource, base, phase], {
    env: { PATH: "/usr/bin:/bin", HOME: home, KIRO_HOME: path.join(home, ".kiro") },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  children.push(child);
  expect(await nextMessage(child)).toEqual({ ready: true });
  return child;
};
const go = async (child: ChildProcess) => { const reply = nextMessage(child); child.send("go"); return reply; };
const kill = async (child: ChildProcess) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  child.kill("SIGKILL");
  await exited;
  expect(child.signalCode).toBe("SIGKILL");
};
const deadOwner = async (base: string) => {
  const child = await launch(base, "owner-initialized");
  expect(await go(child)).toEqual({ phase: "owner-initialized" });
  await kill(child);
};
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(children.splice(0).map(kill));
  for (const base of fixtures.splice(0)) fs.rmSync(base, { recursive: true, force: true });
});

describe("installation lock gate 0b", () => {
  it("reports actual process evidence, with automatic purge explicitly unsupported", () => {
    const info = installationLockAvailability();
    expect(info.supported).toBe(true);
    expect(info.incarnation?.pid).toBe(process.pid);
    expect(info.incarnation?.platform).toBe(process.platform);
    expect(inspectInstallationProcesses()).toMatchObject({ supported: false, inactive: false });
  });

  it("is an exclusive shared startup admission fence with transaction-only binding", () => {
    const base = fixture();
    expect(inspectInstallationLock(base)).toMatchObject({ status: "absent", available: true });
    const release = acquireInstallationLock(base, { transactionId: "tx-fixture" });
    expect(readOwner(base).transactionId).toBe("tx-fixture");
    expect(inspectInstallationLock(base)).toMatchObject({ status: "busy", available: false });
    expect(() => acquireInstallationLock(base)).toThrow("busy");
    expect(fs.statSync(target(base)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(ownerPath(base)).mode & 0o777).toBe(0o600);
    release(); release();
    const admit = acquireInstallationLock(base); admit();
    expect(fs.readdirSync(base)).toEqual([]);
    for (const transactionId of ["../escape", "/absolute", "x\ny", "", "x".repeat(129)]) {
      expect(() => acquireInstallationLock(base, { transactionId })).toThrow("invalid installation lock options");
      expect(fs.readdirSync(base)).toEqual([]);
    }
  });

  it("doctor inspection is read-only for live, stale and malformed controls", async () => {
    const base = fixture();
    await deadOwner(base);
    const before = fs.readFileSync(ownerPath(base));
    const stat = fs.statSync(ownerPath(base));
    for (let i = 0; i < 3; i++) expect(inspectInstallationLock(base).status).toBe("stale");
    expect(fs.readFileSync(ownerPath(base))).toEqual(before);
    expect(fs.statSync(ownerPath(base)).mtimeMs).toBe(stat.mtimeMs);
    expect(fs.readdirSync(target(base))).toEqual(["owner.json"]);
    fs.writeFileSync(ownerPath(base), "{");
    expect(inspectInstallationLock(base).status).toBe("recovery-required");
    expect(fs.readFileSync(ownerPath(base), "utf8")).toBe("{");
  });

  recoveryIt("recovers a real SIGKILL fully initialized owner into exact retained quarantine", async () => {
    const base = fixture();
    await deadOwner(base);
    const old = readOwner(base);
    const inode = fs.statSync(target(base)).ino;
    expect(() => acquireInstallationLock(base)).toThrow("requires explicit recovery");
    const release = acquireInstallationLock(base, { recover: true, transactionId: "next" });
    expect(release.recovered).toEqual([{ quarantine: `.install-lock-quarantine-${old.nonce}`, owner: old }]);
    expect(fs.statSync(path.join(base, release.recovered[0]!.quarantine)).ino).toBe(inode);
    expect(readOwner(base).nonce).not.toBe(old.nonce);
    release();
    expect(quarantine(base)).toHaveLength(1);
    const again = acquireInstallationLock(base, { recover: true });
    expect(again.recovered).toEqual([]); again();
  });

  recoveryIt("concurrent real subprocess reclaimers admit exactly one manager", async () => {
    const base = fixture();
    await deadOwner(base);
    const contenders = await Promise.all(Array.from({ length: 6 }, () => launch(base)));
    const results = await Promise.all(contenders.map(go));
    expect(results.filter(result => result.acquired)).toHaveLength(1);
    expect(results.filter(result => result.error)).toHaveLength(5);
    expect(quarantine(base)).toHaveLength(1);
    expect(inspectInstallationLock(base).status).toBe("busy");
    await Promise.all(contenders.map(kill));
    const next = acquireInstallationLock(base, { recover: true }); next();
    expect(quarantine(base)).toHaveLength(2);
  });

  recoveryIt("a live recovery claim excludes competitors; SIGKILL permits a chained exact successor", async () => {
    const base = fixture();
    await deadOwner(base);
    const reclaimer = await launch(base, "recovery-claim-initialized");
    expect(await go(reclaimer)).toEqual({ phase: "recovery-claim-initialized" });
    const first = fs.readFileSync(path.join(target(base), "claim-00.json"));
    expect(() => acquireInstallationLock(base, { recover: true })).toThrow("busy");
    await kill(reclaimer);
    const release = acquireInstallationLock(base, { recover: true });
    const quarantined = path.join(base, release.recovered[0]!.quarantine);
    expect(fs.readFileSync(path.join(quarantined, "claim-00.json"))).toEqual(first);
    expect(fs.readdirSync(quarantined)).toEqual(["claim-00.json", "claim-01.json", "owner.json"]);
    release();
  });

  it.for(["lock-created", "owner-created", "recovery-claim-created"])("preserves unknown partial state after real SIGKILL at %s", async (phase, context) => {
    if (phase === "recovery-claim-created" && !hasDirectoryFdTraversal) context.skip();
    const base = fixture();
    if (phase.startsWith("recovery")) await deadOwner(base);
    const child = await launch(base, phase);
    expect(await go(child)).toEqual({ phase });
    await kill(child);
    const names = fs.readdirSync(target(base));
    expect(() => acquireInstallationLock(base, { recover: true })).toThrow(/uninitialized|foreign/u);
    expect(inspectInstallationLock(base).status).toBe("recovery-required");
    expect(fs.readdirSync(target(base))).toEqual(names);
    expect(quarantine(base)).toEqual([]);
  });

  recoveryIt("bounds repeated killed reclaimers without deleting exhausted evidence", async () => {
    const base = fixture();
    await deadOwner(base);
    for (let index = 0; index < 16; index++) {
      const child = await launch(base, "recovery-claim-initialized");
      expect(await go(child)).toEqual({ phase: "recovery-claim-initialized" });
      await kill(child);
    }
    const names = fs.readdirSync(target(base));
    expect(names).toHaveLength(17);
    expect(() => acquireInstallationLock(base, { recover: true })).toThrow("capacity reached");
    expect(fs.readdirSync(target(base))).toEqual(names);
    expect(quarantine(base)).toEqual([]);
  });

  it("prevents startup durable-data preparation while mutation owns the same fence", () => {
    const base = fixture();
    const start = () => {
      const release = acquireInstallationLock(base);
      try { fs.mkdirSync(path.join(base, "durable-data"), { mode: 0o700 }); }
      finally { release(); }
    };
    const mutate = acquireInstallationLock(base);
    expect(start).toThrow("busy");
    expect(fs.existsSync(path.join(base, "durable-data"))).toBe(false);
    mutate();
    start();
    expect(fs.existsSync(path.join(base, "durable-data"))).toBe(true);
  });

  recoveryIt("recovers after a reclaimer dies immediately following quarantine, retaining evidence", async () => {
    const base = fixture();
    await deadOwner(base);
    const child = await launch(base, "recovery-quarantined");
    expect(await go(child)).toEqual({ phase: "recovery-quarantined" });
    await kill(child);
    expect(fs.existsSync(target(base))).toBe(false);
    const names = quarantine(base);
    expect(names).toHaveLength(1);
    const release = acquireInstallationLock(base, { recover: true }); release();
    expect(quarantine(base)).toEqual(names);
  });

  it.each(["lock-created", "owner-created", "owner-initialized", "acquired"])("cleans exact initialization failure in-process at %s", phase => {
    const base = fixture();
    expect(() => acquireInstallationLock(base, { onPhase(name) { if (name === phase) throw new Error("injected"); } })).toThrow("injected");
    expect(fs.readdirSync(base)).toEqual([]);
    const release = acquireInstallationLock(base); release();
  });

  it("cleans an exact partially written owner after an in-process write failure", () => {
    const base = fixture();
    const realWrite = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementationOnce((file, _data) => {
      realWrite(file, "{partial"); throw new Error("injected write failure");
    });
    expect(() => acquireInstallationLock(base)).toThrow("injected write failure");
    expect(fs.readdirSync(base)).toEqual([]);
  });

  it("preserves replacement owner inode, foreign contents and replaced lock directory on release", () => {
    for (const kind of ["owner", "foreign", "directory", "root"]) {
      const base = fixture();
      const release = acquireInstallationLock(base);
      if (kind === "owner") {
        const text = fs.readFileSync(ownerPath(base));
        fs.renameSync(ownerPath(base), path.join(base, "saved-owner"));
        fs.writeFileSync(ownerPath(base), text, { mode: 0o600 });
      } else if (kind === "foreign") fs.writeFileSync(path.join(target(base), "foreign"), "keep");
      else if (kind === "directory") {
        fs.renameSync(target(base), path.join(base, "saved-lock"));
        fs.mkdirSync(target(base), { mode: 0o700 });
        fs.writeFileSync(ownerPath(base), "foreign", { mode: 0o600 });
      } else {
        const saved = `${base}-saved`; fixtures.push(saved);
        fs.renameSync(base, saved); fs.mkdirSync(base, { mode: 0o700 });
        fs.mkdirSync(target(base), { mode: 0o700 }); fs.writeFileSync(ownerPath(base), "foreign", { mode: 0o600 });
      }
      const before = fs.readFileSync(ownerPath(base));
      expect(() => release()).toThrow();
      expect(fs.readFileSync(ownerPath(base))).toEqual(before);
    }
  });

  it.each(["mode", "hardlink", "symlink", "oversize", "schema", "nonce", "root", "extra", "claim-gap"])("preserves malformed/foreign %s locks during recovery", async kind => {
    const base = fixture();
    await deadOwner(base);
    if (kind === "mode") fs.chmodSync(ownerPath(base), 0o644);
    else if (kind === "hardlink") fs.linkSync(ownerPath(base), path.join(base, "link"));
    else if (kind === "symlink") { fs.renameSync(ownerPath(base), path.join(base, "outside")); fs.symlinkSync(path.join(base, "outside"), ownerPath(base)); }
    else if (kind === "oversize") fs.writeFileSync(ownerPath(base), "x".repeat(4097));
    else if (kind === "extra") fs.writeFileSync(path.join(target(base), "foreign"), "keep");
    else if (kind === "claim-gap") fs.writeFileSync(path.join(target(base), "claim-01.json"), "{}\n", { mode: 0o600 });
    else { const value = readOwner(base); if (kind === "schema") value.schema = 2; else if (kind === "nonce") value.nonce = "../../escape"; else value.root.ino = "0"; writeOwner(base, value); }
    const before = fs.readFileSync(ownerPath(base));
    expect(() => acquireInstallationLock(base, { recover: true })).toThrow();
    expect(fs.readFileSync(ownerPath(base))).toEqual(before);
    expect(quarantine(base)).toEqual([]);
  });

  it.skipIf(hasDirectoryFdTraversal)("preserves a real stale lock when native directory-FD traversal is unsupported", async () => {
    const base = fixture();
    await deadOwner(base);
    const before = fs.readFileSync(ownerPath(base));
    expect(() => acquireInstallationLock(base, { recover: true })).toThrow("directory-FD traversal unavailable");
    expect(fs.readFileSync(ownerPath(base))).toEqual(before);
    expect(fs.readdirSync(target(base))).toEqual(["owner.json"]);
    expect(quarantine(base)).toEqual([]);
  });

  it("refuses recovery when kernel directory-FD traversal is unavailable, with no pathname fallback", async () => {
    const base = fixture();
    await deadOwner(base);
    const stat = fs.statSync;
    vi.spyOn(fs, "statSync").mockImplementation(((file: fs.PathLike, options: unknown) => {
      if (/^\/(proc\/self\/fd|dev\/fd)\//u.test(String(file))) throw Object.assign(new Error("unsupported"), { code: "ENOTDIR" });
      return stat(file, options as fs.StatOptions);
    }) as typeof fs.statSync);
    expect(() => acquireInstallationLock(base, { recover: true })).toThrow("directory-FD traversal unavailable");
    expect(fs.readdirSync(target(base))).toEqual(["owner.json"]);
    expect(quarantine(base)).toEqual([]);
  });

  it("closes the new owner descriptor if fstat evidence acquisition fails, preserving unknown partials", () => {
    const base = fixture();
    const before = process.platform === "linux" ? fs.readdirSync("/proc/self/fd").length : null;
    vi.spyOn(fs, "fstatSync").mockImplementationOnce(() => { throw new Error("injected fstat"); });
    expect(() => acquireInstallationLock(base)).toThrow("injected fstat");
    expect(fs.readFileSync(ownerPath(base), "utf8")).toBe("");
    expect(inspectInstallationLock(base).status).toBe("recovery-required");
    if (before !== null) expect(fs.readdirSync("/proc/self/fd").length).toBe(before);
  });

  recoveryIt("pins claim creation inside the exact stale inode when a competing manager replaces its pathname", async () => {
    const base = fixture();
    await deadOwner(base);
    let winner: ReturnType<typeof acquireInstallationLock> | undefined;
    expect(() => acquireInstallationLock(base, { recover: true, onPhase(phase) {
      if (phase !== "recovery-before-claim") return;
      winner = acquireInstallationLock(base, { recover: true, transactionId: "winner" });
    } })).toThrow("busy");
    expect(winner).toBeDefined();
    expect(readOwner(base).transactionId).toBe("winner");
    expect(fs.readdirSync(target(base))).toEqual(["owner.json"]);
    expect(quarantine(base)).toHaveLength(1);
    winner!();
  });

  recoveryIt("preserves a replacement immediately before stale quarantine", async () => {
    const base = fixture();
    await deadOwner(base);
    expect(() => acquireInstallationLock(base, { recover: true, onPhase(phase) {
      if (phase !== "recovery-before-quarantine") return;
      fs.renameSync(target(base), path.join(base, "saved-lock"));
      fs.mkdirSync(target(base), { mode: 0o700 });
      fs.writeFileSync(ownerPath(base), "foreign", { mode: 0o600 });
    } })).toThrow();
    expect(fs.readFileSync(ownerPath(base), "utf8")).toBe("foreign");
    expect(quarantine(base)).toEqual([]);
    expect(fs.existsSync(path.join(base, "saved-lock", "claim-00.json"))).toBe(true);
  });

  it("does not adopt a replaced initialized owner for exception cleanup", () => {
    const base = fixture();
    expect(() => acquireInstallationLock(base, { onPhase(phase) {
      if (phase !== "owner-initialized") return;
      fs.renameSync(ownerPath(base), path.join(base, "saved-owner"));
      fs.writeFileSync(ownerPath(base), "foreign", { mode: 0o600 });
      throw new Error("injected replacement");
    } })).toThrow("injected replacement");
    expect(fs.readFileSync(ownerPath(base), "utf8")).toBe("foreign");
  });

  it("cleans exact in-process fsync failure and closes its descriptors", () => {
    const base = fixture();
    const before = process.platform === "linux" ? fs.readdirSync("/proc/self/fd").length : null;
    vi.spyOn(fs, "fsyncSync").mockImplementationOnce(() => { throw new Error("injected sync"); });
    expect(() => acquireInstallationLock(base)).toThrow("injected sync");
    expect(fs.readdirSync(base)).toEqual([]);
    if (before !== null) expect(fs.readdirSync("/proc/self/fd").length).toBe(before);
  });

  it.runIf(process.platform === "linux")("natively detects a copied private Node by kernel executable identity, never authorizes negative purge", async () => {
    const base = fixture();
    const node = path.join(base, "node");
    fs.copyFileSync(process.execPath, node); fs.chmodSync(node, 0o700);
    const child = await launch(base, "", node);
    const release = acquireInstallationLock(base);
    const active = inspectInstallationProcesses({ retainedNodePaths: [node] });
    expect(active).toMatchObject({ supported: true, inactive: false, active: true });
    expect(active.observedPids).toContain(child.pid);
    await kill(child);
    const after = inspectInstallationProcesses({ retainedNodePaths: [node] });
    expect(after).toMatchObject({ inactive: false, active: false });
    expect(after.reason).toMatch(/unknown|not qualified|unavailable/u);
    release();
  });

  it("process inspection refuses invalid inventory and unavailable visibility", () => {
    expect(inspectInstallationProcesses({ retainedNodePaths: Array.from({ length: 257 }, () => "/invalid") })).toMatchObject({ supported: false, inactive: false });
    expect(inspectInstallationProcesses({ retainedNodePaths: ["relative"] })).toMatchObject({ supported: false, inactive: false });
    const base = fixture();
    const file = path.join(base, "node"); fs.writeFileSync(file, "fixture", { mode: 0o700 }); fs.chmodSync(file, 0o700);
    vi.spyOn(fs, "opendirSync").mockImplementation(() => { throw Object.assign(new Error("denied"), { code: "EACCES" }); });
    expect(inspectInstallationProcesses({ retainedNodePaths: [file] })).toMatchObject({ supported: false, inactive: false });
  });

  it("rejects symlink/nonprivate roots and lock symlinks without writes", () => {
    const base = fixture();
    const alias = path.join(fixture(), "alias"); fs.symlinkSync(base, alias);
    expect(() => acquireInstallationLock(alias)).toThrow();
    fs.chmodSync(base, 0o755); expect(() => acquireInstallationLock(base)).toThrow(); fs.chmodSync(base, 0o700);
    fs.symlinkSync(fixture(), target(base));
    expect(() => acquireInstallationLock(base, { recover: true })).toThrow();
    expect(fs.lstatSync(target(base)).isSymbolicLink()).toBe(true);
  });
});

// Exercise actual private branches with injected OS observations, not a second
// implementation and not a production test-bypass option. These are NOT native
// macOS or reboot/PID-reuse qualification.
const source = fs.readFileSync(modulePath, "utf8").replace(/^import .*;\n/gmu, "").replace(/^export /gmu, "");
const mockMac = (options: { start?: string; boot?: string; killCode?: string; psFailure?: boolean } = {}) => {
  const calls: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = [];
  const start = "Mon Sep  7 12:34:56 2026";
  const context = {
    fs, path, Buffer, process: { platform: "darwin", pid: 42, kill(pid: number) { if (pid !== 42 && options.killCode) throw Object.assign(new Error(), { code: options.killCode }); } },
    execFileSync(file: string, args: string[], opts: Record<string, unknown>) {
      calls.push({ file, args, options: opts });
      if (file.endsWith("sysctl")) return `{ sec = ${options.boot ?? "1780000000"}, usec = 123 }`;
      if (args[1] === "42") return ` 42 ${start} S\n`;
      if (options.psFailure) throw Object.assign(new Error("timeout"), { signal: "SIGKILL" });
      if (options.killCode === "ESRCH") throw Object.assign(new Error(), { status: 1, stdout: "", stderr: "" });
      return ` 99 ${options.start ?? start} S\n`;
    },
  };
  const inspect = vm.runInNewContext(`${source}\nincarnationState`, context) as (owner: object) => string;
  const state = inspect({ platform: "darwin", pid: 99, boot: "1780000000:123", start, namespace: "host" });
  return { state, calls };
};
describe("bounded process evidence model cases (not native platform qualification)", () => {
  it("macOS equal coarse start remains live; changed boot wall time remains uncertain", () => {
    expect(mockMac().state).toBe("live");
    expect(mockMac({ start: "Mon Sep  7 12:34:57 2026" }).state).toBe("dead");
    expect(mockMac({ boot: "1780000001" }).state).toBe("uncertain");
    expect(mockMac({ killCode: "ESRCH" }).state).toBe("dead");
  });
  it("macOS ambiguity/permissions/timeouts fail closed and probes are bounded absolute commands", () => {
    expect(mockMac({ killCode: "EPERM" }).state).toBe("uncertain");
    expect(mockMac({ psFailure: true }).state).toBe("uncertain");
    expect(mockMac({ start: "ambiguous" }).state).toBe("uncertain");
    const { calls } = mockMac();
    expect(calls.length).toBeLessThanOrEqual(8);
    for (const call of calls) {
      expect(["/usr/sbin/sysctl", "/bin/ps"]).toContain(call.file);
      expect(call.options).toMatchObject({ timeout: 1000, killSignal: "SIGKILL", maxBuffer: 4096, env: { LC_ALL: "C", TZ: "UTC" } });
    }
  });
  it.runIf(process.platform === "linux")("Linux reboot/PID reuse model evidence never treats namespace/permission ambiguity as death", () => {
    const own = installationLockAvailability().incarnation!;
    const inspect = vm.runInNewContext(`${source}\nincarnationState`, { fs, path, Buffer, process }) as (owner: object) => string;
    expect(inspect(own)).toBe("live");
    expect(inspect({ ...own, start: "0" })).toBe("dead");
    expect(inspect({ ...own, boot: "00000000-0000-0000-0000-000000000000" })).toBe("dead");
    expect(inspect({ ...own, namespace: "pid:[0]" })).toBe("uncertain");
    vi.spyOn(process, "kill").mockImplementation(() => { throw Object.assign(new Error(), { code: "EPERM" }); });
    expect(inspect(own)).toBe("uncertain");
  });
  it("Linux process start parser handles a hostile-looking comm without splitting fields", () => {
    const text = `123 (a ) strange\nname) S ${Array.from({ length: 18 }, () => "0").join(" ")} 456 0`;
    const fn = vm.runInNewContext(`${source}\nprocessSample`, {
      fs: { constants: fs.constants, openSync: () => 3, closeSync: () => {}, readSync(_fd: number, buffer: Buffer, offset: number) { if (offset) return 0; return buffer.write(text); } },
      process: { platform: "linux" }, Buffer,
    }) as (pid: number) => { start: string; zombie: boolean };
    expect(fn(123)).toEqual({ start: "456", zombie: false });
  });
});
