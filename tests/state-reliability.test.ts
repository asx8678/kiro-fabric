import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StateProvider } from "../src/providers/state-provider.js";
import { fabricCommitAcknowledgement } from "../src/protocol.js";
import { normalizeFabricConfig } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { projectFabricExecutionText } from "../src/kiro/projection.js";
const roots: string[] = [];
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "state-reliability-")); roots.push(root);
  return { root, provider: new StateProvider(root), context: { cwd: root } };
};
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const causes = (error: unknown): string => error instanceof AggregateError ? `${error.message} ${error.errors.map(causes).join(" ")}` : error instanceof Error ? `${error.message} ${error.cause ? causes(error.cause) : ""}` : String(error);

describe("state ownership fault matrix", () => {
  for (const target of ["lock", "temporary"] as const) {
    it.each(["open", "fstat", "identity", "write", "fsync", "close"] as const)(`${target} %s closes once and never mutates`, async (fault) => {
      const { root, provider, context } = fixture();
      const open = fs.openSync, stat = fs.fstatSync, close = fs.closeSync, write = fs.writeFileSync, sync = fs.fsyncSync;
      const live = new Set<number>(); let selected: number | undefined; let closes = 0; let stats = 0;
      const fail = () => { throw new Error(`fault-${fault}`); };
      vi.spyOn(fs, "openSync").mockImplementation((file, flags, mode) => {
        const match = target === "lock" ? String(file).endsWith(".lock") : String(file).endsWith(".tmp");
        if (match && fault === "open") fail();
        const fd = open(file, flags, mode); live.add(fd); if (match) selected = fd; return fd;
      });
      vi.spyOn(fs, "fstatSync").mockImplementation(((fd: number) => {
        if (fd === selected) { stats++; if (fault === "identity" || (fault === "fstat" && stats === 1)) fail(); }
        return stat(fd);
      }) as typeof fs.fstatSync);
      vi.spyOn(fs, "writeFileSync").mockImplementation((fd, data, options) => { if (fd === selected && fault === "write") fail(); write(fd, data, options); });
      vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => { if (fd === selected && fault === "fsync") fail(); sync(fd); });
      vi.spyOn(fs, "closeSync").mockImplementation((fd) => { close(fd); live.delete(fd); if (fd === selected) { closes++; if (fault === "close") fail(); } });
      const error = await provider.invoke("set", { key: "key", value: "secret" }, context).catch(e => e);
      expect(fabricCommitAcknowledgement(error)).toBeUndefined();
      expect(causes(error)).toContain(`fault-${fault}`);
      expect(live.size).toBe(0); expect(closes).toBe(fault === "open" ? 0 : 1);
      if (fault === "identity") expect(causes(error)).toContain("ownership identity unavailable");
      vi.restoreAllMocks();
      expect(fs.existsSync(path.join(root, "state.json"))).toBe(false);
      if (fault !== "identity") {
        expect(fs.readdirSync(root)).toEqual([]);
        expect(await provider.invoke("set", { key: "key", value: true }, context)).toMatchObject({ revision: 1 });
      } else {
        expect(fs.readdirSync(root)).toHaveLength(1);
        if (target === "lock") await expect(provider.invoke("set", { key: "key", value: true }, context)).rejects.toThrow(/uncertain state lock ownership/);
      }
    });
  }
  it.each(["lstat", "rm", "replacement"] as const)("release %s reports proof and retains deferred responsibility", async (fault) => {
    const { root, provider, context } = fixture(); const lock = path.join(root, ".state-mutation.lock");
    const rename = fs.renameSync, stat = fs.lstatSync, rm = fs.rmSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      rename(from, to);
      if (fault === "replacement") { rename(lock, `${lock}.original`); fs.writeFileSync(lock, "foreign"); }
      if (fault === "lstat") vi.spyOn(fs, "lstatSync").mockImplementation(((file: fs.PathLike) => { if (String(file) === lock) throw new Error("release stat"); return stat(file); }) as typeof fs.lstatSync);
      // Release deletes through the descriptor-anchored /proc/self/fd alias on Linux, so match by basename, not the lexical path.
      if (fault === "rm") vi.spyOn(fs, "rmSync").mockImplementation((file, options) => { if (path.basename(String(file)) === ".state-mutation.lock") throw new Error("release rm"); rm(file, options); });
    });
    const error = await provider.invoke("set", { key: "key", value: true }, context).catch(e => e);
    expect(error).toMatchObject({ committed: true, revision: 1 });
    expect(fabricCommitAcknowledgement(error)).toEqual({ version: 1, operation: "set" });
    vi.restoreAllMocks();
    if (fault === "replacement") {
      expect(fs.readFileSync(lock, "utf8")).toBe("foreign");
      await expect(provider.invoke("delete", { key: "key" }, context)).rejects.toThrow("replacement");
      fs.rmSync(lock); fs.renameSync(`${lock}.original`, lock);
    }
    await expect(provider.invoke("set", { key: "key", value: false, expectedRevision: 0 }, context)).rejects.toThrow("revision conflict");
    expect(await provider.invoke("delete", { key: "key", expectedRevision: 1 }, context)).toMatchObject({ revision: 2 });
  });
  it("preserves operation and cleanup causes without claiming noop or precommit", async () => {
    const { provider, context } = fixture(); const rm = fs.rmSync;
    vi.spyOn(fs, "rmSync").mockImplementation((file, options) => { if (String(file).endsWith(".lock")) throw new Error("cleanup cause"); rm(file, options); });
    for (const args of [{ key: "missing" }, { key: "missing", expectedRevision: 9 }]) {
      // Restore cleanup for the deferred retry, then fail this operation's release.
      if ("expectedRevision" in args) { vi.restoreAllMocks(); await provider.invoke("delete", { key: "missing" }, context); vi.spyOn(fs, "rmSync").mockImplementation(() => { throw new Error("cleanup cause"); }); }
      const error = await provider.invoke("delete", args, context).catch(e => e);
      expect(fabricCommitAcknowledgement(error)).toBeUndefined(); expect(causes(error)).toContain("cleanup cause");
      if ("expectedRevision" in args) expect(causes(error)).toContain("revision conflict");
    }
  });
  it("preserves a replacement temporary and all initialization/close/cleanup causes", async () => {
    const { root, provider, context } = fixture();
    const open = fs.openSync, write = fs.writeFileSync, close = fs.closeSync;
    let selected: number | undefined; let temporary = "";
    vi.spyOn(fs, "openSync").mockImplementation((file, flags, mode) => { const fd = open(file, flags, mode); if (String(file).endsWith(".tmp")) { selected = fd; temporary = String(file); } return fd; });
    vi.spyOn(fs, "writeFileSync").mockImplementation((file, data, options) => {
      if (file === selected) { fs.renameSync(temporary, `${temporary}.original`); write(temporary, "foreign"); throw new Error("write cause"); }
      write(file, data, options);
    });
    vi.spyOn(fs, "closeSync").mockImplementation((fd) => { close(fd); if (fd === selected) throw new Error("close cause"); });
    const error = await provider.invoke("set", { key: "key", value: true }, context).catch(e => e);
    expect(causes(error)).toContain("write cause"); expect(causes(error)).toContain("close cause"); expect(causes(error)).toContain("replacement preserved");
    expect(fabricCommitAcknowledgement(error)).toBeUndefined();
    vi.restoreAllMocks(); expect(fs.readFileSync(temporary, "utf8")).toBe("foreign"); expect(fs.existsSync(path.join(root, "state.json"))).toBe(false);
  });
  it.each(["not-json", "{}", '{"pid":0}'])("never reclaims malformed stale owner %s", async (owner) => {
    const { root, provider, context } = fixture(); const lock = path.join(root, ".state-mutation.lock");
    fs.writeFileSync(lock, owner); fs.utimesSync(lock, new Date(0), new Date(0));
    await expect(provider.invoke("set", { key: "key", value: true }, context)).rejects.toThrow("uncertain");
    expect(fs.readFileSync(lock, "utf8")).toBe(owner);
  });
});

describe("state execution acknowledgement", () => {
  for (const operation of ["set", "delete"] as const) it.each(["cleanup", "aborted", "timed_out"] as const)(`${operation} %s proof reaches projection without secrets`, async (fault) => {
    const { root, provider, context } = fixture();
    if (operation === "delete") await provider.invoke("set", { key: "PRIVATE-key", value: "PRIVATE-value" }, context);
    const registry = new ActionRegistry(); registry.register(provider);
    const service = new FabricExecutionService(registry, normalizeFabricConfig({ executor: { timeoutMs: 5000 } }), root);
    const controller = new AbortController(); const rename = fs.renameSync, rm = fs.rmSync; let publications = 0;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => { rename(from, to); publications++; if (fault === "aborted") controller.abort(new Error("PRIVATE abort")); if (fault === "timed_out") vi.spyOn(performance, "now").mockReturnValue(Number.MAX_SAFE_INTEGER); });
    if (fault === "cleanup") vi.spyOn(fs, "rmSync").mockImplementation((file, options) => { if (String(file).endsWith(".lock")) throw new Error("PRIVATE cleanup"); rm(file, options); });
    try {
      const result = await service.execute({ code: `return await state.${operation}({key:'PRIVATE-key'${operation === "set" ? ",value:'PRIVATE-value'" : ""}})`, signal: controller.signal, approver: { async approve() {} } });
      if (fault !== "cleanup") expect(result.status).toBe(fault);
      expect(result.audits[0]?.commitAcknowledgement).toEqual({ version: 1, operation }); expect(publications).toBe(1);
      const text = projectFabricExecutionText({ result: { ...result, error: "execution failed" }, resultFormat: "json", maxOutputChars: 20000, writeArtifact: () => "unused" }).text;
      expect(text).toContain("known committed although acknowledgement failed");
      expect(text.slice(text.indexOf("Completed nested calls"))).not.toContain("PRIVATE");
      vi.restoreAllMocks();
      expect(await provider.invoke("list", {}, context)).toMatchObject({ revision: operation === "set" ? 1 : 2 });
      expect(await provider.invoke("get", { key: "PRIVATE-key" }, context)).toMatchObject(operation === "set" ? { value: "PRIVATE-value" } : { found: false });
    } finally { vi.restoreAllMocks(); await service.close(); }
  });
});
