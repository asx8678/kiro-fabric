import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess, { spawn, spawnSync, type ChildProcess } from "node:child_process";
import vm from "node:vm";
import { createHash, randomBytes } from "node:crypto";
import { runPinnedRecovery } from "../src/installation/pinned-recovery.mjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireInstallationLock, inspectInstallationLock } from "../scripts/installer-lock.mjs";
import { fixture as bundleFixture } from "./bundle-fixture.js";
import { canonical, createBundleManifest, validateBundle } from "../scripts/bundle-contract.mjs";
import { installCompleteGeneration, rollbackCompleteGeneration, recoverCompleteInstallation } from "../scripts/managed-installation.mjs";

const roots: string[] = [], children: ChildProcess[] = [];
const fixture = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kf-release-")));
  fs.chmodSync(root, 0o700); roots.push(root); return root;
};
const lock = (base: string) => path.join(base, ".install-lock");
const marker = (base: string) => path.join(base, ".install-lock-release.json");
const owner = (base: string) => path.join(lock(base), "owner.json");
const id = (file: string) => { const s = fs.statSync(file, { bigint: true }); return { dev: String(s.dev), ino: String(s.ino) }; };
const moduleUrl = new URL("../scripts/installer-lock.mjs", import.meta.url).href;
const source = `
import fs from 'node:fs'; import {acquireInstallationLock} from ${JSON.stringify(moduleUrl)};
const [base, phase, mode, transactionId] = process.argv.slice(1);
const pause = name => { process.send({phase:name}); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0); };
const rmdir = fs.rmdirSync;
fs.rmdirSync = (file,...args) => { if (phase === 'actual-rmdir-gap' && file === base+'/.install-lock') pause(phase); return rmdir(file,...args); };
let held;
process.on('message', message => {
 try {
  if (message === 'release') { held(); process.disconnect(); return; }
  if (message !== 'go') return;
  held = acquireInstallationLock(base,{recover:true,transactionId,onPhase(name){if(name===phase)pause(name);}});
  if(mode==='release') held();
  process.send({acquired:true,recovered:held.recovered,owner:held.owner});
 } catch(error) { process.send({error:error.code??error.message});process.exitCode=1;process.disconnect(); }
}); process.send({ready:true});`;
type Message = { ready?: boolean; phase?: string; acquired?: boolean; error?: string; recovered?: Array<{ owner: { transactionId: string }; quarantine: string }> };
const message = (child: ChildProcess) => new Promise<Message>((resolve, reject) => {
  const timer = setTimeout(() => { cleanup(); reject(Error("release child deadline")); }, 8000);
  const received = (value: Message) => { cleanup(); resolve(value); };
  const failed = (error: unknown) => { cleanup(); reject(error); };
  const exited = (code: number | null, signal: string | null) => failed(Error(`release child exited ${code}/${signal}`));
  const cleanup = () => { clearTimeout(timer); child.off("message", received); child.off("error", failed); child.off("exit", exited); };
  child.once("message", received); child.once("error", failed); child.once("exit", exited);
});
const launch = async (base: string, phase = "", mode = "acquire", transactionId = "retry") => {
  const child = spawn(process.execPath, ["--input-type=module", "-e", source, base, phase, mode, transactionId], {
    env: { PATH: "/usr/bin:/bin", HOME: base, KIRO_HOME: path.join(base, "isolated-kiro") }, stdio: ["ignore", "ignore", "pipe", "ipc"],
  }); children.push(child); expect(await message(child)).toEqual({ ready: true }); return child;
};
const go = (child: ChildProcess) => { const result = message(child); child.send("go"); return result; };
const stop = async (child: ChildProcess, gracefully = false, strict = true) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  if (gracefully) child.send("release"); else child.kill("SIGKILL");
  await exited; if (strict) expect(gracefully ? child.exitCode : child.signalCode).toBe(gracefully ? 0 : "SIGKILL");
};
const deadRelease = async (base: string, phase = "actual-rmdir-gap") => {
  const child = await launch(base, phase, "release", "committed-rollback");
  expect(await go(child)).toEqual({ phase }); await stop(child); return JSON.parse(fs.readFileSync(marker(base), "utf8"));
};
// Shared bounded inspection preserves the entire fixture if it contains a repo.
const dispose = (root: string) => removeFixtureSync(root, { recursive: true, force: true });
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(children.splice(0).map(child => stop(child, false, false))); for (const root of roots.splice(0)) dispose(root); });

describe("crash-safe installation lock release", () => {
  it("retains an entire fixture if repository metadata is present", () => {
    const root = fixture(); fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, "sentinel"), "retained"); dispose(root);
    expect(fs.readFileSync(path.join(root, "sentinel"), "utf8")).toBe("retained");
    expect(fs.statSync(path.join(root, ".git")).isDirectory()).toBe(true);
  });
  it.each(["release-marked", "release-owner-removed", "actual-rmdir-gap", "release-directory-removed", "release-before-marker-remove"])("real SIGKILL at %s preserves exclusion and committed recovery", async phase => {
    const base = fixture(), child = await launch(base, phase, "release", "committed-rollback");
    expect(await go(child)).toEqual({ phase });
    const prior = JSON.parse(fs.readFileSync(marker(base), "utf8")), file = id(marker(base));
    expect(prior.file).toEqual(file);
    expect(inspectInstallationLock(base)).toMatchObject({ status: "busy", available: false });
    const contender = await launch(base); expect(await go(contender)).toEqual({ error: "INSTALL_LOCK_BUSY" });
    await stop(child);
    expect(inspectInstallationLock(base)).toMatchObject({ status: "stale", recoverable: true });
    expect(() => acquireInstallationLock(base)).toThrow("requires explicit recovery");
    const retry = await launch(base), result = await go(retry);
    expect(result.acquired).toBe(true);
    expect(result.recovered).toContainEqual({ quarantine: `.install-lock-quarantine-${prior.nonce}`, owner: prior });
    const archive = path.join(base, result.recovered![0]!.quarantine);
    expect(id(fs.statSync(archive).isDirectory() ? path.join(archive, "owner.json") : archive)).toEqual(file);
    expect(fs.existsSync(marker(base))).toBe(false);
    await stop(retry, true);
    const again = acquireInstallationLock(base, { recover: true }); expect(again.recovered).toEqual([]); again();
  });

  it.each(["actual-rmdir-gap", "release-directory-removed"])("six actual subprocess retries after %s admit exactly one manager", async phase => {
    const base = fixture(); await deadRelease(base, phase);
    const contenders = await Promise.all(Array.from({ length: 6 }, () => launch(base)));
    const results = await Promise.all(contenders.map(go));
    expect(results.filter(r => r.acquired)).toHaveLength(1); expect(results.filter(r => r.error)).toHaveLength(5);
    const index = results.findIndex(r => r.acquired);
    expect(results[index]!.recovered!.some(r => r.owner.transactionId === "committed-rollback")).toBe(true);
    expect(inspectInstallationLock(base).status).toBe("busy"); await stop(contenders[index]!, true);
  });

  it.each(["owner-initialized", "release-recovery-before-archive", "release-recovery-archived", "acquired"])("a killed retry at %s retains the original committed transaction", async phase => {
    const base = fixture(); await deadRelease(base, "release-directory-removed");
    const retry = await launch(base, phase); expect(await go(retry)).toEqual({ phase }); await stop(retry);
    const final = acquireInstallationLock(base, { recover: true, transactionId: "final" });
    expect(final.recovered.some(r => r.owner.transactionId === "committed-rollback")).toBe(true); final();
  });

  it.each(["release-recovery-before-restore", "release-recovery-restored", "recovery-claim-initialized", "recovery-quarantined"])("a SIGKILL during restored release recovery at %s cannot lose the committed action", async phase => {
    const base = fixture(); await deadRelease(base);
    const retry = await launch(base, phase); expect(await go(retry)).toEqual({ phase });
    if (phase === "recovery-claim-initialized") {
      const other = await launch(base); expect(await go(other)).toEqual({ error: "INSTALL_LOCK_BUSY" });
    }
    await stop(retry);
    const final = acquireInstallationLock(base, { recover: true, transactionId: "final" });
    expect(final.recovered.some(r => r.owner.transactionId === "committed-rollback")).toBe(true); final();
  });
  it.each(["release-marked", "release-owner-removed", "release-before-rmdir", "release-directory-removed", "release-before-marker-remove"])("same-process release retries after a throw at %s", phase => {
    const base = fixture(); let once = true;
    const release = acquireInstallationLock(base, { onPhase(name) { if (name === phase && once) { once = false; throw Error("fixture interrupted release"); } } });
    expect(release).toThrow("fixture interrupted release");
    expect(() => acquireInstallationLock(base, { recover: true })).toThrow("busy");
    release(); release(); expect(fs.readdirSync(base)).toEqual([]);
  });

  it.each(["rmdir", "marker-unlink", "final-fsync"])("retries actual %s cleanup failure and never removes a replacement lock", kind => {
    const base = fixture(), release = acquireInstallationLock(base); let once = true;
    const rmdir = fs.rmdirSync, unlink = fs.unlinkSync, sync = fs.fsyncSync;
    vi.spyOn(fs, "rmdirSync").mockImplementation(file => { if (kind === "rmdir" && once && String(file) === lock(base)) { once = false; throw Error("fixture cleanup"); } return rmdir(file); });
    vi.spyOn(fs, "unlinkSync").mockImplementation(file => { if (kind === "marker-unlink" && once && String(file) === marker(base)) { once = false; throw Error("fixture cleanup"); } return unlink(file); });
    vi.spyOn(fs, "fsyncSync").mockImplementation(fd => { if (kind === "final-fsync" && once && !fs.existsSync(lock(base)) && !fs.existsSync(marker(base))) { once = false; throw Error("fixture cleanup"); } return sync(fd); });
    expect(release).toThrow("fixture cleanup");
    if (kind === "final-fsync") {
      const winner = acquireInstallationLock(base), bytes = fs.readFileSync(owner(base));
      release(); expect(fs.readFileSync(owner(base))).toEqual(bytes); winner();
    } else { expect(() => acquireInstallationLock(base, { recover: true })).toThrow("busy"); release(); }
    expect(fs.readdirSync(base)).toEqual([]);
  });

  it.each(["marker", "owner", "directory", "root", "extra", "namespace"])("release preserves %s mutation at the durable marker boundary", kind => {
    const base = fixture(); let changed = false;
    const release = acquireInstallationLock(base, { onPhase(phase) {
      if (phase !== "release-marked" || changed) return; changed = true;
      if (kind === "marker" || kind === "owner") {
        const file = kind === "marker" ? marker(base) : owner(base), bytes = fs.readFileSync(file);
        fs.renameSync(file, path.join(base, "saved-control")); fs.writeFileSync(file, bytes, { mode: 0o600 });
      } else if (kind === "directory") { fs.renameSync(lock(base), path.join(base, "saved-lock")); fs.mkdirSync(lock(base), { mode: 0o700 }); }
      else if (kind === "root") { const saved = `${base}-saved`; roots.push(saved); fs.renameSync(base, saved); fs.mkdirSync(base, { mode: 0o700 }); }
      else if (kind === "extra") fs.writeFileSync(path.join(lock(base), "evidence"), "preserve", { mode: 0o600 });
      else { vi.spyOn(fs, "readlinkSync").mockReturnValue("pid:[0]"); }
    } });
    if (kind === "namespace" && process.platform !== "linux") {
      // Native Darwin's namespace is fixed host; process permission uncertainty
      // exercises the same release-incarnation failure without guessing a PID.
      const kill = process.kill; vi.spyOn(process, "kill").mockImplementation(((pid, signal) => { if (changed) throw Object.assign(Error("denied"), { code: "EPERM" }); return kill(pid, signal); }) as typeof process.kill);
    }
    expect(release).toThrow();
    const root = kind === "root" ? `${base}-saved` : base;
    expect(fs.existsSync(marker(root))).toBe(true);
    expect(fs.existsSync(path.join(kind === "directory" ? path.join(root, "saved-lock") : lock(root), "owner.json"))).toBe(true);
    expect(release).toThrow();
  });

  it.each(["empty", "malformed", "copied-inode", "root", "lock", "birth", "namespace", "symlink", "hardlink", "evidence"])("recovery refuses stale/foreign %s release material without mutation", async kind => {
    const base = fixture(); await deadRelease(base);
    if (kind === "empty") fs.writeFileSync(marker(base), "");
    else if (kind === "malformed") fs.writeFileSync(marker(base), "{");
    else if (kind === "copied-inode") { const bytes = fs.readFileSync(marker(base)); fs.renameSync(marker(base), path.join(base, "saved")); fs.writeFileSync(marker(base), bytes, { mode: 0o600 }); }
    else if (kind === "symlink") { fs.renameSync(marker(base), path.join(base, "saved")); fs.symlinkSync(path.join(base, "saved"), marker(base)); }
    else if (kind === "hardlink") fs.linkSync(marker(base), path.join(base, "foreign-link"));
    else if (kind === "evidence") fs.writeFileSync(path.join(lock(base), "evidence"), "preserve", { mode: 0o600 });
    else { const value = JSON.parse(fs.readFileSync(marker(base), "utf8")); if (kind === "root") value.root.ino = "0"; else if (kind === "lock") value.lock.ino = "0"; else if (kind === "birth") value.lockBirth = "1"; else value.process.namespace = process.platform === "linux" ? "pid:[0]" : "foreign"; fs.writeFileSync(marker(base), JSON.stringify(value) + "\n"); }
    const bytes = fs.readFileSync(marker(base)), inode = fs.lstatSync(lock(base)).ino, names = fs.readdirSync(lock(base));
    expect(inspectInstallationLock(base).status).toBe("recovery-required");
    expect(() => acquireInstallationLock(base, { recover: true })).toThrow();
    expect(fs.readFileSync(marker(base))).toEqual(bytes); expect(fs.lstatSync(lock(base)).ino).toBe(inode); expect(fs.readdirSync(lock(base))).toEqual(names);
  });

  it("never overwrites a foreign release target that appears at the actual link syscall", () => {
    const base = fixture(), release = acquireInstallationLock(base, { onPhase(phase) {
      if (process.platform === "darwin" && phase === "release-before-remove") fs.writeFileSync(marker(base), "foreign", { mode: 0o600 });
    } }), bytes = fs.readFileSync(owner(base));
    const link = fs.linkSync;
    vi.spyOn(fs, "linkSync").mockImplementation((from, to) => { if (String(to).endsWith("/.install-lock-release.json")) fs.writeFileSync(marker(base), "foreign", { mode: 0o600 }); return link(from, to); });
    expect(release).toThrow(); expect(fs.readFileSync(marker(base), "utf8")).toBe("foreign"); expect(fs.readFileSync(owner(base))).toEqual(bytes);
  });

  it("never overwrites a foreign archive after directory-free release", async () => {
    const base = fixture(), prior = await deadRelease(base, "release-directory-removed");
    const archive = path.join(base, `.install-lock-quarantine-${prior.nonce}`); fs.writeFileSync(archive, "foreign", { mode: 0o600 });
    expect(() => acquireInstallationLock(base, { recover: true })).toThrow();
    expect(fs.readFileSync(archive, "utf8")).toBe("foreign"); expect(JSON.parse(fs.readFileSync(marker(base), "utf8"))).toEqual(prior);
  });

  it("preserves an empty replacement created after rmdir, including recycled inode numbers", () => {
    const base = fixture(); let replacement: ReturnType<typeof id> | undefined;
    const release = acquireInstallationLock(base, { onPhase(phase) {
      if (phase === "release-directory-removed" && !replacement) { fs.mkdirSync(lock(base), { mode: 0o700 }); replacement = id(lock(base)); }
    } });
    expect(release).toThrow(); expect(id(lock(base))).toEqual(replacement); expect(fs.readdirSync(lock(base))).toEqual([]);
    expect(inspectInstallationLock(base).status).toBe("recovery-required");
    expect(() => acquireInstallationLock(base, { recover: true })).toThrow(); expect(id(lock(base))).toEqual(replacement);
  });

  it("preserves release evidence when the actual native restoration capability is unavailable", async () => {
    const base = fixture(); await deadRelease(base); const bytes = fs.readFileSync(marker(base));
    if (process.platform === "darwin") {
      const exec = childProcess.execFileSync;
      vi.spyOn(childProcess, "execFileSync").mockImplementation(((file: string, ...args: unknown[]) => { if (file === process.execPath) throw Error("unavailable"); return (exec as Function)(file, ...args); }) as typeof childProcess.execFileSync);
    } else {
      const stat = fs.statSync;
      vi.spyOn(fs, "statSync").mockImplementation(((file: fs.PathLike, ...args: unknown[]) => { if (String(file).startsWith("/proc/self/fd/")) throw Error("unavailable"); return (stat as Function)(file, ...args); }) as typeof fs.statSync);
    }
    expect(inspectInstallationLock(base)).toMatchObject({ status: "stale", recoverable: false });
    try { acquireInstallationLock(base, { recover: true }); throw Error("unexpected recovery"); }
    catch (error) { expect(error).toMatchObject({ code: "INSTALL_LOCK_UNSUPPORTED", recoveryRequired: true }); }
    expect(fs.readFileSync(marker(base))).toEqual(bytes); expect(fs.readdirSync(lock(base))).toEqual([]);
  });

  it("models the macOS release branch with real child inspection, not /dev/fd traversal (not native qualification)", () => {
    const base = fixture(), cwd = process.cwd(), operations: string[] = [];
    const source = fs.readFileSync(new URL("../src/installation/installer-lock.mjs", import.meta.url), "utf8").replace(/^import .*;\n/gmu, "").replace(/^export /gmu, "");
    const api = vm.runInNewContext(`${source}\n({acquireInstallationLock,inspectInstallationLock})`, {
      fs, path, Buffer, createHash, randomBytes,
      process: { platform: "darwin", pid: process.pid, getuid: process.getuid, kill: process.kill },
      execFileSync(file: string) { return file.endsWith("sysctl") ? "{ sec = 1780000000, usec = 123 }" : `${process.pid} Mon Sep  7 12:34:56 2026 S\n`; },
      runPinnedRecovery(target: string, expected: unknown, options?: { operation?: "inspect" | "create" | "publish" | "restore" }) {
        operations.push(options?.operation ?? "inspect"); return runPinnedRecovery(target, expected, options);
      },
    }) as { acquireInstallationLock: typeof acquireInstallationLock; inspectInstallationLock: typeof inspectInstallationLock };
    const stat = fs.statSync;
    vi.spyOn(fs, "statSync").mockImplementation(((file: fs.PathLike, ...args: unknown[]) => { if (String(file).startsWith("/dev/fd/")) throw Error("macOS directory traversal unavailable"); return (stat as Function)(file, ...args); }) as typeof fs.statSync);
    let once = true;
    const release = api.acquireInstallationLock(base, { onPhase(phase) { if (phase === "release-owner-removed" && once) { once = false; throw Error("fixture Mac release interruption"); } } });
    expect(release).toThrow("fixture Mac release interruption"); expect(api.inspectInstallationLock(base).status).toBe("busy");
    release(); expect(fs.readdirSync(base)).toEqual([]); expect(process.cwd()).toBe(cwd); expect(operations).toEqual(["inspect", "inspect"]);
  });
  it("still preserves a completely unowned empty lock", () => {
    const base = fixture(); fs.mkdirSync(lock(base), { mode: 0o700 }); const before = id(lock(base));
    expect(() => acquireInstallationLock(base, { recover: true })).toThrow(); expect(id(lock(base))).toEqual(before); expect(fs.readdirSync(lock(base))).toEqual([]);
  });

  it.each(["release-owner-removed", "release-directory-removed"])("actual rollback SIGKILL at %s does not toggle the default retry", async phase => {
    const root = fixture(), bundle = await bundleFixture(); roots.push(bundle);
    const userHome = path.join(root, "home"), kiroHome = path.join(userHome, ".kiro"); fs.mkdirSync(userHome, { mode: 0o700 });
    const opts = { userHome, kiroHome, env: {}, provenance: "source", validateCandidate: async (directory: string) => { await validateBundle(directory); } };
    const a = await installCompleteGeneration(bundle, opts);
    const prior = (await validateBundle(bundle)).manifest; fs.writeFileSync(path.join(bundle, "app/main.js"), "next");
    fs.writeFileSync(path.join(bundle, "bundle-manifest.json"), canonical(await createBundleManifest(bundle, prior)) + "\n");
    await installCompleteGeneration(bundle, opts);
    const module = new URL("../scripts/managed-installation.mjs", import.meta.url).href;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `import {rollbackCompleteGeneration} from ${JSON.stringify(module)}; await rollbackCompleteGeneration(${JSON.stringify(kiroHome)},{validateCandidate:async()=>{},onPhase:p=>{if(p===${JSON.stringify(phase)})process.kill(process.pid,'SIGKILL');}});`], { env: { HOME: userHome, KIRO_HOME: kiroHome, PATH: "" }, encoding: "utf8", timeout: 15000 });
    expect(child.stderr).toBe(""); expect(child.signal).toBe("SIGKILL");
    const result = await rollbackCompleteGeneration(kiroHome, { validateCandidate: async () => { throw Error("must not perform another rollback"); } });
    expect(result).toMatchObject({ outcome: "recovered", committed: true, recovered: true, owner: { currentRuntime: a.digest } });
    expect((await recoverCompleteInstallation(kiroHome)).recovered).toBe(false);
  });
});
