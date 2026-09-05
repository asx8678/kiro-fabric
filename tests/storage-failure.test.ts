import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createKiroArtifactStore } from "../src/kiro/artifacts.js";
import { StateCommitAcknowledgementError, StateProvider } from "../src/providers/state-provider.js";

const roots: string[] = [];
const temporary = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-write-fault-")); roots.push(root); return root; };
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

const inject = (method: "write" | "permissions" | "sync" | "close", matches: (file: string) => boolean) => {
  let target: number | undefined;
  const open = fs.openSync;
  vi.spyOn(fs, "openSync").mockImplementation((file, flags, mode) => {
    const fd = open(file, flags, mode);
    if (matches(String(file))) target = fd;
    return fd;
  });
  const fail = () => { throw Object.assign(new Error("injected owned-file failure"), { code: "EIO" }); };
  if (method === "write") {
    const write = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementation((file, data, options) => { if (file === target) fail(); write(file, data, options); });
  } else if (method === "permissions") {
    const chmod = fs.fchmodSync;
    vi.spyOn(fs, "fchmodSync").mockImplementation((fd, mode) => { if (fd === target) fail(); chmod(fd, mode); });
  } else if (method === "sync") {
    const sync = fs.fsyncSync;
    vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => { if (fd === target) fail(); sync(fd); });
  } else {
    const close = fs.closeSync;
    vi.spyOn(fs, "closeSync").mockImplementation((fd) => { close(fd); if (fd === target) fail(); });
  }
};

describe("operation-owned storage failure cleanup", () => {
  it.each(["write", "permissions", "sync", "close"] as const)("preserves old state and cleans its temporary file after %s failure", async (method) => {
    const root = temporary(); const provider = new StateProvider(root); const context = { cwd: root };
    await provider.invoke("set", { key: "fixture", value: "old" }, context);
    inject(method, (file) => path.basename(file).startsWith(".state-") && file.endsWith(".tmp"));
    await expect(provider.invoke("set", { key: "fixture", value: "new", expectedRevision: 1 }, context)).rejects.toThrow("owned-file failure");
    vi.restoreAllMocks();
    expect(fs.readdirSync(root)).toEqual(["state.json"]);
    await expect(provider.invoke("get", { key: "fixture" }, context)).resolves.toMatchObject({ value: "old", revision: 1 });
    await expect(provider.invoke("set", { key: "fixture", value: "retry", expectedRevision: 1 }, context)).resolves.toEqual({ key: "fixture", revision: 2 });
  });

  it.each(["write", "permissions", "sync", "close"] as const)("cleans only its failed artifact after %s failure without charging quota", (method) => {
    const root = temporary(); const store = createKiroArtifactStore({ root, maxArtifacts: 3, maxTotalChars: 10 });
    const existing = store.write("old");
    inject(method, (file) => path.basename(file).startsWith("ka_") && path.basename(file) !== existing);
    expect(() => store.write("new")).toThrow("owned-file failure");
    vi.restoreAllMocks();
    expect(fs.readdirSync(root)).toEqual([existing]);
    expect(store.read(existing).text).toBe("old");
    const next = store.write("1234567");
    expect(store.read(next).text).toBe("1234567");
    store.close(); expect(fs.readdirSync(root)).toEqual([]);
  });

  it.each(["cancel", "rename"] as const)("preserves the prior revision after pre-publication %s", async (failure) => {
    const root = temporary(); const provider = new StateProvider(root); const context = { cwd: root };
    await provider.invoke("set", { key: "fixture", value: "old" }, context);
    const controller = new AbortController();
    if (failure === "cancel") {
      const chmod = fs.fchmodSync;
      vi.spyOn(fs, "fchmodSync").mockImplementationOnce((fd, mode) => { chmod(fd, mode); controller.abort(new Error("pre-commit cancellation")); });
    } else { vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw new Error("pre-commit rename failure"); }); }
    await expect(provider.invoke("set", { key: "fixture", value: "new" }, { ...context, signal: controller.signal })).rejects.toThrow("pre-commit");
    vi.restoreAllMocks();
    expect(fs.readdirSync(root)).toEqual(["state.json"]);
    await expect(provider.invoke("get", { key: "fixture" }, context)).resolves.toMatchObject({ revision: 1, value: "old" });
  });

  it("establishes permissions before rename and reports post-commit cancellation accurately", async () => {
    const root = temporary(); const provider = new StateProvider(root); const controller = new AbortController();
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      expect(fs.statSync(from).mode & 0o777).toBe(0o600);
      rename(from, to); controller.abort(new Error("cancelled after commit"));
    });
    const error = await provider.invoke("set", { key: "fixture", value: "committed" }, { cwd: root, signal: controller.signal }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(StateCommitAcknowledgementError);
    expect(error).toMatchObject({ committed: true, revision: 1 });
    vi.restoreAllMocks();
    await expect(provider.invoke("get", { key: "fixture" }, { cwd: root })).resolves.toMatchObject({ value: "committed", revision: 1 });
    await expect(provider.invoke("set", { key: "fixture", value: "retry", expectedRevision: 0 }, { cwd: root })).rejects.toThrow("revision conflict");
    expect(fs.readdirSync(root)).toEqual(["state.json"]);
  });

  it("reports a committed revision and recovers same-provider writes after transient lock removal failure", async () => {
    const root = temporary(); const provider = new StateProvider(root); const remove = fs.rmSync;
    vi.spyOn(fs, "rmSync").mockImplementation((file, options) => {
      if (path.basename(String(file)) === ".state-mutation.lock") throw new Error("injected lock removal failure");
      remove(file, options);
    });
    await expect(provider.invoke("set", { key: "fixture", value: true }, { cwd: root })).rejects.toMatchObject({ committed: true, revision: 1 });
    vi.restoreAllMocks();
    await expect(provider.invoke("get", { key: "fixture" }, { cwd: root })).resolves.toMatchObject({ revision: 1, value: true });
    await expect(provider.invoke("set", { key: "fixture", value: "recovered", expectedRevision: 1 }, { cwd: root })).resolves.toEqual({ key: "fixture", revision: 2 });
    expect(fs.readdirSync(root)).toEqual(["state.json"]);
  });
});
