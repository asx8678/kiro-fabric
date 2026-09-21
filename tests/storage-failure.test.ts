import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createKiroArtifactStore } from "../src/kiro/artifacts.js";
import { openKiroMemory } from "../src/kiro/memory.js";
import { KiroMcpProvider } from "../src/kiro/mcp-provider.js";
import { StateCommitAcknowledgementError, StateProvider } from "../src/providers/state-provider.js";
import * as pinnedDirectory from "../src/installation/pinned-directory-child.mjs";

const roots: string[] = [];
const temporary = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-write-fault-")); roots.push(root); return root; };
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });

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

const temporaryWriter = async (kind: "memory" | "mcp") => {
  const root = temporary();
  const matches = (file: string) => kind === "memory"
    ? path.basename(file).startsWith(".kiro-fabric-memory-") && file.endsWith(".tmp")
    : path.basename(file).startsWith(".kiro-fabric-mcp-snapshot-");
  const remaining = () => fs.readdirSync(root, { recursive: true, encoding: "utf8" }).map((file) => path.join(root, file)).filter(matches);
  if (kind === "memory") {
    const memory = openKiroMemory("workspace", root);
    await memory.set("fixture", "old");
    return {
      root, matches, remaining,
      write: () => memory.set("fixture", "new"),
      async verifyPreserved() { await expect(memory.get("fixture")).resolves.toMatchObject({ value: "old" }); },
      async close() {},
    };
  }
  const configPath = path.join(root, "mcp.json");
  const config = JSON.stringify({ imports: [], mcpServers: {} });
  fs.writeFileSync(configPath, config, { mode: 0o600 });
  const provider = new KiroMcpProvider(root, { enabled: true, configPath, disableOAuth: true, callTimeoutMs: 1_000 });
  return {
    root, matches, remaining,
    write: () => provider.invoke("$servers", {}, { cwd: root }),
    async verifyPreserved() { expect(fs.readFileSync(configPath, "utf8")).toBe(config); },
    close: () => provider.close(),
  };
};

const failTemporaryClose = (matches: (file: string) => boolean, afterClose?: (file: string) => void) => {
  const files = new Map<number, string>();
  const open = fs.openSync, close = fs.closeSync;
  const failure = Object.assign(new Error("temporary close completed then failed"), { code: "EIO" });
  let attempts = 0;
  vi.spyOn(fs, "openSync").mockImplementation((file, flags, mode) => {
    const fd = open(file, flags, mode);
    // Track subsequent reuse too; closing a different file is not a retry.
    files.set(fd, String(file));
    return fd;
  });
  vi.spyOn(fs, "closeSync").mockImplementation((fd) => {
    const file = files.get(fd);
    if (file !== undefined && matches(file)) {
      attempts += 1;
      close(fd);
      afterClose?.(file);
      throw failure;
    }
    close(fd);
  });
  return { failure, isTemporary: (fd: number) => matches(files.get(fd) ?? ""), attempts: () => attempts };
};

const failTemporaryIdentity = (matches: (file: string) => boolean, persistent: boolean, beforeFailure?: (file: string) => void) => {
  const files = new Map<number, string>();
  const open = fs.openSync, stat = fs.fstatSync, close = fs.closeSync;
  const failure = Object.assign(new Error("temporary identity unavailable"), { code: "EIO" });
  const retryFailure = Object.assign(new Error("temporary identity still unavailable"), { code: "EIO" });
  let attempts = 0, closes = 0;
  vi.spyOn(fs, "openSync").mockImplementation((...args) => {
    const fd = open(...args);
    files.set(fd, String(args[0]));
    return fd;
  });
  vi.spyOn(fs, "fstatSync").mockImplementation((...args) => {
    const file = files.get(args[0]);
    if (file !== undefined && matches(file)) {
      attempts += 1;
      if (attempts === 1) { beforeFailure?.(file); throw failure; }
      if (persistent) throw retryFailure;
    }
    return stat(...args);
  });
  vi.spyOn(fs, "closeSync").mockImplementation((fd) => {
    if (matches(files.get(fd) ?? "")) closes += 1;
    close(fd);
    files.delete(fd);
  });
  return { failure, retryFailure, attempts: () => attempts, closes: () => closes };
};

describe.each(["memory", "mcp"] as const)("%s temporary write ownership", (kind) => {
  it.each(["owned pathname", "foreign replacement"] as const)("recovers identity before closing after a transient metadata failure with %s", async (pathname) => {
    const fixture = await temporaryWriter(kind);
    const foreign = path.join(fixture.root, "foreign");
    fs.writeFileSync(foreign, "foreign content", { mode: 0o600 });
    let replacement: string | undefined;
    const fault = failTemporaryIdentity(fixture.matches, false, pathname === "foreign replacement" ? (file) => {
      fs.renameSync(file, path.join(fixture.root, "original-owned-file"));
      fs.renameSync(foreign, file);
      replacement = file;
    } : undefined);
    try {
      await expect(fixture.write()).rejects.toBe(fault.failure);
      expect(fault.attempts()).toBe(2);
      expect(fault.closes()).toBe(1);
      vi.restoreAllMocks();
      if (pathname === "foreign replacement") {
        expect(replacement).toBeDefined();
        expect(fs.readFileSync(replacement!, "utf8")).toBe("foreign content");
      } else expect(fixture.remaining()).toEqual([]);
      await fixture.verifyPreserved();
      await fixture.write();
      expect(fixture.remaining()).toEqual(replacement ? [replacement] : []);
    } finally { vi.restoreAllMocks(); await fixture.close(); }
  });

  it("bounds metadata recovery and reports unresolved identity without deleting an unverified file", async () => {
    const fixture = await temporaryWriter(kind);
    const fault = failTemporaryIdentity(fixture.matches, true);
    try {
      await expect(fixture.write()).rejects.toMatchObject({ cause: fault.failure, errors: [fault.failure, fault.retryFailure] });
      expect(fault.attempts()).toBe(2);
      expect(fault.closes()).toBe(1);
      const remaining = fixture.remaining();
      expect(remaining).toHaveLength(1);
      vi.restoreAllMocks();
      expect(fs.readFileSync(remaining[0]!, "utf8")).toBe("");
      await fixture.verifyPreserved();
      await fixture.write();
      expect(fixture.remaining()).toEqual(remaining);
    } finally { vi.restoreAllMocks(); await fixture.close(); }
  });

  it("preserves the close error, removes owned residue and permits a later write", async () => {
    const fixture = await temporaryWriter(kind);
    const fault = failTemporaryClose(fixture.matches);
    try {
      await expect(fixture.write()).rejects.toBe(fault.failure);
      expect(fault.attempts()).toBe(1);
      expect(fixture.remaining()).toEqual([]);
      vi.restoreAllMocks();
      await fixture.verifyPreserved();
      await fixture.write();
      expect(fixture.remaining()).toEqual([]);
    } finally { vi.restoreAllMocks(); await fixture.close(); }
  });

  it("cleans the temporary file even when both writing and closing fail", async () => {
    const fixture = await temporaryWriter(kind);
    const fault = failTemporaryClose(fixture.matches);
    const failure = new Error("primary temporary write failure"), write = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementation((file, data, options) => {
      if (typeof file === "number" && fault.isTemporary(file)) throw failure;
      write(file, data, options);
    });
    try {
      await expect(fixture.write()).rejects.toMatchObject({ cause: failure, errors: [failure, fault.failure] });
      expect(fault.attempts()).toBe(1);
      expect(fixture.remaining()).toEqual([]);
      vi.restoreAllMocks();
      await fixture.verifyPreserved();
      await fixture.write();
    } finally { vi.restoreAllMocks(); await fixture.close(); }
  });

  it("retains both the primary close error and a failed temporary cleanup", async () => {
    const fixture = await temporaryWriter(kind);
    const fault = failTemporaryClose(fixture.matches);
    const cleanup = new Error("temporary removal failed"), remove = fs.rmSync, unlink = fs.unlinkSync;
    vi.spyOn(fs, "rmSync").mockImplementation((file, options) => {
      if (fixture.matches(String(file))) throw cleanup;
      remove(file, options);
    });
    vi.spyOn(fs, "unlinkSync").mockImplementation((file) => {
      if (fixture.matches(String(file))) throw cleanup;
      unlink(file);
    });
    try {
      await expect(fixture.write()).rejects.toMatchObject({ cause: fault.failure, errors: [fault.failure, cleanup] });
      expect(fault.attempts()).toBe(1);
      expect(fixture.remaining()).toHaveLength(1);
      vi.restoreAllMocks();
      await fixture.verifyPreserved();
    } finally { vi.restoreAllMocks(); await fixture.close(); }
  });

  it("preserves a foreign replacement at the temporary pathname after close fails", async () => {
    const fixture = await temporaryWriter(kind);
    const foreign = path.join(fixture.root, "foreign");
    fs.writeFileSync(foreign, "foreign content", { mode: 0o600 });
    let replacement: string | undefined;
    const fault = failTemporaryClose(fixture.matches, (file) => {
      // Keep the old inode alive so the replacement has a distinct identity.
      fs.renameSync(file, path.join(fixture.root, "original-owned-file"));
      fs.renameSync(foreign, file);
      replacement = file;
    });
    try {
      await expect(fixture.write()).rejects.toBe(fault.failure);
      expect(fault.attempts()).toBe(1);
      vi.restoreAllMocks();
      expect(replacement).toBeDefined();
      expect(fs.readFileSync(replacement!, "utf8")).toBe("foreign content");
      await fixture.verifyPreserved();
    } finally { vi.restoreAllMocks(); await fixture.close(); }
  });
});

describe("operation-owned storage failure cleanup", () => {
  it.each(["expiry", "count eviction", "size eviction", "close"] as const)("retries artifact deletion after %s fails without losing ownership or quota", (operation) => {
    const root = temporary(); let now = 1_000;
    const store = createKiroArtifactStore({ root, ttlMs: 100, now: () => now, maxArtifacts: operation === "count eviction" ? 1 : 3, maxTotalChars: 6 });
    const id = store.write("old");
    const other = createKiroArtifactStore({ root });
    const otherId = other.write("other store");
    const failure = new Error("artifact deletion failed"), remove = fs.rmSync;
    vi.spyOn(fs, "rmSync").mockImplementation((file, options) => {
      if (String(file) === path.join(root, id)) throw failure;
      remove(file, options);
    });
    if (operation === "expiry") now += 101;
    const attempt = () => {
      if (operation === "expiry") store.read(id);
      else if (operation === "close") store.close();
      else store.write(operation === "size eviction" ? "next" : "new");
    };
    try {
      expect(attempt).toThrow(failure);
      // A persistent failure must not silently free a slot, quota, or shutdown.
      expect(attempt).toThrow(failure);
      expect(fs.readFileSync(path.join(root, id), "utf8")).toBe("old");
      expect(fs.readdirSync(root).sort()).toEqual([id, otherId].sort());
      vi.restoreAllMocks();
      store.close();
      expect(fs.existsSync(path.join(root, id))).toBe(false);
      expect(other.read(otherId).text).toBe("other store");
      expect(fs.readdirSync(root)).toEqual([otherId]);
    } finally { vi.restoreAllMocks(); store.close(); other.close(); }
  });

  it.each(["write", "permissions", "sync", "close"] as const)("preserves old state and cleans its temporary file after %s failure", async (method) => {
    const root = temporary(); const provider = new StateProvider(root); const context = { cwd: root };
    await provider.invoke("set", { key: "fixture", value: "old" }, context);
    inject(method, (file) => path.basename(file).startsWith(".state-") && file.endsWith(".tmp"));
    await expect(provider.invoke("set", { key: "fixture", value: "new", expectedRevision: 1 }, context)).rejects.toMatchObject({
      cause: expect.objectContaining({ message: "injected owned-file failure" }),
      errors: expect.arrayContaining([expect.objectContaining({ message: "injected owned-file failure" })]),
    });
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
    const root = temporary(); const provider = new StateProvider(root);
    const remove = fs.rmSync, removePinned = pinnedDirectory.runPinnedDirectoryOperation;
    vi.spyOn(fs, "rmSync").mockImplementation((file, options) => {
      if (path.basename(String(file)) === ".state-mutation.lock") throw new Error("injected lock removal failure");
      remove(file, options);
    });
    // Darwin removes through the pinned child rather than the Linux rmSync alias.
    vi.spyOn(pinnedDirectory, "runPinnedDirectoryOperation").mockImplementation(options => {
      if (options.operation === "unlink" && options.name === ".state-mutation.lock") throw new Error("injected lock removal failure");
      return removePinned(options);
    });
    await expect(provider.invoke("set", { key: "fixture", value: true }, { cwd: root })).rejects.toMatchObject({ committed: true, revision: 1 });
    vi.restoreAllMocks();
    await expect(provider.invoke("get", { key: "fixture" }, { cwd: root })).resolves.toMatchObject({ revision: 1, value: true });
    await expect(provider.invoke("set", { key: "fixture", value: "recovered", expectedRevision: 1 }, { cwd: root })).resolves.toEqual({ key: "fixture", revision: 2 });
    expect(fs.readdirSync(root)).toEqual(["state.json"]);
  });
});
