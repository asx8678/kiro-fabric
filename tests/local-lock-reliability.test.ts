import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { LocalCodingProvider } from "../src/providers/local-provider.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { fabricCommitAcknowledgement } from "../src/protocol.js";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-lock-fault-"))); roots.push(base);
  const root = path.join(base, "workspace"); const lockRoot = path.join(base, "locks"); fs.mkdirSync(root);
  const provider = new LocalCodingProvider({ root, lockRoot }); const registry = new ActionRegistry(); registry.register(provider);
  const context = () => ({ cwd: root, maxResultChars: 20000, audits: [], approve: async () => {} });
  return { root, lockRoot, provider, context, call: () => registry.invoke("local.write", { path: "new", content: "once" }, context()) };
}
it.each(["open", "fstat", "write", "close", "unknown"])("local lock %s failure preserves exact cleanup and closes once", async (fault) => {
  const f = fixture(); const originalOpen = fs.openSync; const originalStat = fs.fstatSync; const originalClose = fs.closeSync; const originalWrite = fs.writeFileSync;
  let descriptor: number | undefined; let closes = 0; let statFailed = false;
  vi.spyOn(fs, "openSync").mockImplementation((...args) => {
    if (String(args[0]).endsWith(".lock") && fault === "open") throw new Error("open fault");
    const fd = originalOpen(...args); if (String(args[0]).endsWith(".lock")) descriptor = fd; return fd;
  });
  vi.spyOn(fs, "fstatSync").mockImplementation((...args) => {
    if (args[0] === descriptor && ((fault === "fstat" && !statFailed) || fault === "unknown")) { statFailed = true; throw new Error("fstat fault"); }
    return originalStat(...args);
  });
  vi.spyOn(fs, "writeFileSync").mockImplementation((...args) => { if (args[0] === descriptor && fault === "write") { originalWrite(descriptor!, "partial"); throw new Error("write fault"); } return originalWrite(...args); });
  vi.spyOn(fs, "closeSync").mockImplementation((fd) => { if (fd === descriptor) { closes++; originalClose(fd); if (fault === "close") throw new Error("close-after-close fault"); } else originalClose(fd); });
  await expect(f.call()).rejects.toThrow(/initialization|unavailable|uncertain/);
  expect(fs.existsSync(path.join(f.root, "new"))).toBe(false);
  expect(closes).toBe(fault === "open" ? 0 : 1);
  if (descriptor !== undefined) expect(() => originalStat(descriptor!)).toThrow();
  expect(fs.readdirSync(f.lockRoot)).toHaveLength(fault === "unknown" ? 1 : 0);
  vi.restoreAllMocks();
  if (fault === "unknown") await expect(f.call()).rejects.toThrow(/uncertain/);
  else expect(await f.call()).toMatchObject({ changed: true });
});
it.each(["lstat", "unlink", "root"])("failed release %s retains retryable ownership and success is idempotent", async (fault) => {
  const f = fixture(); const args = await f.provider.prepareArguments("write", { path: "new", content: "once" }, f.context());
  const release = await f.provider.reserveInvocation("write", args, f.context());
  const lock = path.join(f.lockRoot, fs.readdirSync(f.lockRoot)[0]!);
  const originalStat = fs.lstatSync; const originalUnlink = fs.unlinkSync;
  if (fault === "unlink") vi.spyOn(fs, "unlinkSync").mockImplementationOnce(() => { throw new Error("unlink fault"); });
  else vi.spyOn(fs, "lstatSync").mockImplementation((...args) => { if (String(args[0]) === (fault === "root" ? f.lockRoot : lock)) throw new Error("lstat fault"); return originalStat(...args); });
  expect(release).toThrow(/uncertain/); expect(fs.existsSync(lock)).toBe(true);
  vi.restoreAllMocks(); const unlink = vi.spyOn(fs, "unlinkSync");
  release(); release(); expect(unlink).toHaveBeenCalledTimes(1); expect(fs.existsSync(lock)).toBe(false);
  expect(await f.call()).toMatchObject({ changed: true });
  expect(originalUnlink).toBeTypeOf("function");
});
it("never removes replacement inode or attributes an old commit to the next invocation", async () => {
  const f = fixture(); const args = await f.provider.prepareArguments("write", { path: "new", content: "once" }, f.context());
  const release = await f.provider.reserveInvocation("write", args, f.context()); await f.provider.invoke("write", args, f.context());
  const lock = path.join(f.lockRoot, fs.readdirSync(f.lockRoot)[0]!); fs.renameSync(lock, `${lock}.owned`); fs.writeFileSync(lock, "foreign");
  let error: unknown; try { release(); } catch (caught) { error = caught; }
  expect(fabricCommitAcknowledgement(error)?.operation).toBe("write"); expect(fs.readFileSync(lock, "utf8")).toBe("foreign");
  const next = await f.provider.prepareArguments("write", { path: "other", content: "no" }, f.context());
  const failure = await f.provider.reserveInvocation("write", next, f.context()).catch((error: unknown) => error);
  expect(fabricCommitAcknowledgement(failure)).toBeUndefined(); expect(fs.existsSync(path.join(f.root, "other"))).toBe(false);
});
it("temporary fstat failure closes and removes only the created inode before publication", async () => {
  const f = fixture(); const originalOpen = fs.openSync; const originalStat = fs.fstatSync; let descriptor: number | undefined; let failed = false;
  vi.spyOn(fs, "openSync").mockImplementation((...args) => { const fd = originalOpen(...args); if (String(args[0]).endsWith(".tmp")) descriptor = fd; return fd; });
  vi.spyOn(fs, "fstatSync").mockImplementation((...args) => { if (args[0] === descriptor && !failed) { failed = true; throw new Error("temporary fstat fault"); } return originalStat(...args); });
  await expect(f.call()).rejects.toThrow(/initialization/); expect(fs.readdirSync(f.root)).toEqual([]); expect(fs.readdirSync(f.lockRoot)).toEqual([]);
  expect(() => originalStat(descriptor!)).toThrow(); vi.restoreAllMocks(); expect(await f.call()).toMatchObject({ changed: true });
});
