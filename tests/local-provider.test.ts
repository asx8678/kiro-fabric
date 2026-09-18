import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
import type { FabricRegistryInvocationContext } from "../src/core/action-registry.js";
import { fabricCommitAcknowledgement } from "../src/protocol.js";
import { LocalCodingProvider } from "../src/providers/local-provider.js";
import { LOCAL_GUEST_DECLARATIONS } from "../src/providers/local-contract.js";
import type { LocalFindResult, LocalGrepResult, LocalListResult, LocalMutationResult, LocalReadResult, LocalShellResult } from "../src/providers/local-contract.js";
import { schemaValidationMessage } from "../src/schema-validation.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";
import { fabricGuestDeclarations } from "../src/runtime/guest-types.js";
import { fabricJsonText } from "../src/runtime/json-budget.js";

const fixtures: { base: string; providers: LocalCodingProvider[] }[] = [];
const searchScope = (glob?: string) => ({ path: ".", ...(glob ? { glob } : {}), hidden: false, ignoreFiles: true });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function fixture(budget = 20000) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-local-test-")));
  const root = path.join(base, "workspace");
  const lockRoot = path.join(base, "locks");
  fs.mkdirSync(root);
  const provider = new LocalCodingProvider({ root, lockRoot, maxResultChars: budget });
  const providers = [provider];
  fixtures.push({ base, providers });
  const registry = new ActionRegistry();
  registry.register(provider);
  const context = (approve: FabricRegistryInvocationContext["approve"] = async () => {}): FabricRegistryInvocationContext => ({ cwd: "/not-the-workspace", maxResultChars: budget, audits: [], approve });
  const put = (name: string, text: string | Buffer) => fs.writeFileSync(path.join(root, name), text);
  const call = (name: string, args: Record<string, unknown> = {}, ctx = context()) => registry.invoke(`local.${name}`, args, ctx);
  const second = () => {
    const next = new LocalCodingProvider({ root, lockRoot, maxResultChars: budget });
    providers.push(next);
    const other = new ActionRegistry(); other.register(next);
    return other;
  };
  return { base, root, lockRoot, provider, registry, context, put, call, second };
}
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const item of fixtures.splice(0)) {
    await Promise.all(item.providers.map((provider) => provider.close()));
    fs.rmSync(item.base, { recursive: true, force: true });
  }
});
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

// These approvers are fixture-only. They are not live-client permission evidence.
describe("LocalCodingProvider read contracts", () => {
  it("returns every public result through the real checked JsonValue wrapper without weakening types", () => {
    const samples = [
      'return await local.read({path:"x"});', 'return await local.grep({pattern:"x"});',
      'return await local.readMany({windows:[{path:"x"}]});',
      'return await local.readEvidence({windows:[{path:"x"}]});',
      'return await local.find({pattern:"*"});', 'return await local.list();',
      'return await local.write({path:"x",content:"x"});', 'return await local.edit({path:"x",expectedSha256:"a".repeat(64),oldText:"x",newText:"y"});',
      'return await local.shell({command:"true"});',
      'return await local.shell({script:"printf hello",interpreter:"bash",args:["literal"]});',
    ];
    for (const code of samples) expect(typeCheckFabricCode(code, fabricGuestDeclarations).errors, code).toEqual([]);
    for (const code of ['return await local.read({path:1});', 'return await local.write({path:"x",content:"x",review:"forged"});', 'return await local.shell({command:"true",settle:"yes"});']) {
      expect(typeCheckFabricCode(code, fabricGuestDeclarations).errors.length, code).toBeGreaterThan(0);
    }
  });
  it("keeps public descriptors JSON trees and validates representative raw and prepared calls", async () => {
    const f = fixture(); f.put("x", "x");
    const args: Record<string, Record<string, unknown>> = {
      read: { path: "x" }, readMany: { windows: [{ path: "x" }] }, readEvidence: { windows: [{ path: "x" }] }, grep: { pattern: "x" }, find: { pattern: "*" }, list: {},
      write: { path: "new", content: "x" }, edit: { path: "x", expectedSha256: hash("x"), oldText: "x", newText: "y" }, shell: { command: "true" },
    };
    const descriptors = await f.provider.list();
    expect(() => fabricJsonText(descriptors)).not.toThrow();
    for (const descriptor of descriptors) {
      expect(() => fabricJsonText(descriptor)).not.toThrow();
      expect(schemaValidationMessage(descriptor.inputSchema, args[descriptor.name]!)).toBeUndefined();
      const prepared = await f.provider.prepareArguments(descriptor.name, args[descriptor.name]!, f.context());
      expect(schemaValidationMessage(descriptor.inputSchema, prepared)).toBeUndefined();
    }
  });
  it("registers closed typed descriptors and a shared write resource", async () => {
    const f = fixture();
    const descriptors = await f.provider.list();
    expect(descriptors.map((item) => item.name)).toEqual(["read", "readMany", "readEvidence", "grep", "find", "list", "write", "edit", "shell"]);
    for (const descriptor of descriptors) {
      expect(descriptor.inputSchema.additionalProperties).toBe(false);
      if (descriptor.name === "readEvidence") expect(descriptor.outputSchema?.type).toBe("string");
      else expect(descriptor.outputSchema?.additionalProperties).toBe(false);
      expect(LOCAL_GUEST_DECLARATIONS).toContain(`${descriptor.name}(`);
      expect(await f.provider.describe(descriptor.name)).toEqual(descriptor);
      if (["write", "edit", "shell"].includes(descriptor.name)) expect(descriptor.effect).toEqual({ kind: "write", resources: [`local-workspace:${f.root}`] });
    }
    expect((await f.provider.describe("shell"))?.risk).toBe("execute");
    expect(await f.provider.describe("missing")).toBeUndefined();
    descriptors[0]!.description = "tampered";
    expect((await f.provider.describe("read"))?.description).not.toBe("tampered");
  });
  it("reads one-based bounded lines with continuation, identity and whole-file digest", async () => {
    const f = fixture();
    f.put("text", "one\ntwo\nthree\n");
    const result = await f.call("read", { path: "text", offset: 2, limit: 1 }) as LocalReadResult;
    expect(result).toMatchObject({ path: "text", text: "two\n", truncated: true, nextOffset: 3, sha256: hash("one\ntwo\nthree\n") });
    expect(result.identity.ino).toBe(fs.statSync(path.join(f.root, "text")).ino);
    expect(await f.call("read", { path: "text", offset: result.nextOffset })).toMatchObject({ text: "three\n", truncated: false });
    expect(await f.call("read", { path: "text", offset: 50 })).toMatchObject({ text: "", truncated: false });
    f.put("empty", "");
    expect(await f.call("read", { path: "empty" })).toMatchObject({ text: "", truncated: false });
  });
  it("returns an entire requested CRLF range even when the file suffix is unread", async () => {
    const f = fixture();
    const selected = ["  START 雪  ", "LONG:" + "x".repeat(9000) + ":END", "line 43", "\tSTOP\t"];
    f.put("range.txt", [...Array.from({ length: 40 }, (_, i) => String(i)), ...selected, "unrequested suffix"].join("\r\n") + "\r\n");
    const r = await f.call("read", { path: "range.txt", offset: 41, limit: 4 }) as LocalReadResult;
    expect(r.truncated).toBe(true); expect(r.nextOffset).toBe(45);
    expect(r.text).toBe(selected.join("\r\n") + "\r\n");
    expect(r.text.replace(/\r?\n$/, "").split(/\r?\n/)).toEqual(selected);
    expect((await f.provider.describe("read"))?.description).toContain("truncated means unread file suffix");
    expect(LOCAL_GUEST_DECLARATIONS).toContain("Stop at requested end");
  });

  it("defaults to 200 lines, accepts at most 2000, and never previews instead of typed output", async () => {
    const f = fixture(); f.put("many", "x\n".repeat(2001));
    expect(await f.call("read", { path: "many" })).toMatchObject({ text: "x\n".repeat(200), truncated: true, nextOffset: 201 });
    expect(await f.call("read", { path: "many", limit: 2000 })).toMatchObject({ nextOffset: 2001 });
    await expect(f.call("read", { path: "many", limit: 2001 })).rejects.toThrow(/Invalid arguments/);
  });
  it.each([256, 512, 1000])("scales escaped UTF-8 read output to a %i-character bridge budget", async (budget) => {
    const f = fixture(budget); f.put("x", "\t\"é\n".repeat(300));
    const value = await f.call("read", { path: "x" }) as LocalReadResult;
    expect(JSON.stringify(value).length).toBeLessThanOrEqual(budget);
    expect(value.text.length).toBeGreaterThan(0);
    expect(value.truncated).toBe(true);
    expect(value.nextOffset).toBeGreaterThan(1);
    expect(value).not.toHaveProperty("fabricTruncated");
  });
  it("rejects oversized lines/files, binary, invalid UTF-8, and directories", async () => {
    const f = fixture(512);
    f.put("long", "x".repeat(2000));
    f.put("large", Buffer.alloc(2 * 1024 * 1024 + 1, 97));
    f.put("binary", Buffer.from([97, 0, 98])); f.put("invalid", Buffer.from([0xff]));
    await expect(f.call("read", { path: "long" })).rejects.toThrow(/single line/);
    await expect(f.call("read", { path: "large" })).rejects.toThrow(/2MiB/);
    await expect(f.call("read", { path: "binary" })).rejects.toThrow(/binary/);
    await expect(f.call("read", { path: "invalid" })).rejects.toThrow(/UTF-8/);
    await expect(f.call("read", { path: "." })).rejects.toThrow(/regular file/);
  });
  it("rejects traversal, outside paths, symlink components, hardlinks and special files", async () => {
    const f = fixture(); f.put("safe", "text");
    fs.symlinkSync(path.join(f.root, "safe"), path.join(f.root, "link"));
    fs.mkdirSync(path.join(f.root, "dir"));
    fs.symlinkSync(path.join(f.root, "dir"), path.join(f.root, "alias"));
    fs.writeFileSync(path.join(f.root, "dir", "nested"), "text");
    for (const target of ["../workspace/safe", path.join(f.base, "outside"), "link", "alias/nested"]) await expect(f.call("read", { path: target })).rejects.toThrow(/traversal|outside|symlink/);
    fs.linkSync(path.join(f.root, "safe"), path.join(f.root, "hard"));
    await expect(f.call("read", { path: "hard" })).rejects.toThrow(/hardlink/);
    execFileSync("mkfifo", [path.join(f.root, "fifo")]);
    await expect(f.call("read", { path: "fifo" })).rejects.toThrow(/special/);
    await expect(f.call("list")).rejects.toThrow(/symlink|special|hardlink/);
  });
  it("pins canonical root identity and refuses root aliases and replacement", async () => {
    const f = fixture(); f.put("x", "old");
    fs.symlinkSync(f.root, path.join(f.base, "alias"));
    expect(() => new LocalCodingProvider({ root: path.join(f.base, "alias"), lockRoot: f.lockRoot })).toThrow(/canonical/);
    fs.renameSync(f.root, `${f.root}-old`); fs.mkdirSync(f.root); f.put("x", "new");
    await expect(f.call("read", { path: "x" })).rejects.toThrow(/root identity/);
  });
  it("lists sorted children including hidden entries, bounded independently in parallel", async () => {
    const f = fixture(512);
    for (let index = 0; index < 120; index++) f.put(`f${String(index).padStart(3, "0")}`, "x");
    f.put(".hidden", "x"); fs.mkdirSync(path.join(f.root, "dir"));
    const results = await Promise.all([f.call("list", { limit: 2 }), f.call("read", { path: "f000" }), f.call("list")]);
    expect(results[0]).toEqual({ entries: [{ path: ".hidden", type: "file" }, { path: "dir", type: "directory" }], truncated: true });
    expect((results[2] as LocalListResult).truncated).toBe(true);
    for (const value of results) expect(JSON.stringify(value).length).toBeLessThanOrEqual(512);
  });
  it("uses real rg ordering/globs/literal/ignoreCase, ignores hidden and ignored paths", async () => {
    const f = fixture();
    fs.mkdirSync(path.join(f.root, ".git"));
    f.put(".gitignore", "ignored.txt\n"); f.put("ignored.txt", "Hello.[x]\n"); f.put(".hidden.txt", "Hello.[x]\n");
    f.put("b.txt", "nothing\nHello.[x]\n"); f.put("a.txt", "HELLO.[x]\n"); f.put("c.md", "Hello.[x]\n");
    const [found, matches] = await Promise.all([f.call("find", { pattern: "*.txt" }), f.call("grep", { pattern: "hello.[x]", literal: true, ignoreCase: true, glob: "*.txt" })]);
    expect(found).toEqual({ scopeExhausted: true, scope: searchScope("*.txt"), paths: ["a.txt", "b.txt"], truncated: false });
    expect(matches).toEqual({ scopeExhausted: true, scope: searchScope("*.txt"), matches: [{ path: "a.txt", line: 1, text: "HELLO.[x]" }, { path: "b.txt", line: 2, text: "Hello.[x]" }], truncated: false });
    expect(await f.call("grep", { pattern: "no-match", literal: true })).toEqual({ scopeExhausted: true, scope: searchScope(), matches: [], truncated: false });
  });
  it("does not fail a bounded listing because of an unsafe entry beyond the limit", async () => {
    const f = fixture();
    f.put("a.txt", "a");
    f.put("b.txt", "b");
    fs.symlinkSync(path.join(f.root, "a.txt"), path.join(f.root, "z-link"));
    const listed = await f.call("list", { limit: 2 }) as LocalListResult;
    expect(listed.entries.map((entry) => entry.path)).toEqual(["a.txt", "b.txt"]);
    expect(listed.truncated).toBe(true);
  });

  it("bounds find and grep counts, record text and small-budget result shapes", async () => {
    const f = fixture(512);
    for (let index = 0; index < 12; index++) f.put(`${String(index).padStart(2, "0")}.txt`, "match\n".repeat(10));
    const found = await f.call("find", { pattern: "*.txt", limit: 2 }) as LocalFindResult;
    expect(found).toEqual({ scopeExhausted: false, scope: searchScope("*.txt"), paths: ["00.txt", "01.txt"], truncated: true, truncationReasons: ["count"] });
    const matches = await f.call("grep", { pattern: "match", limit: 1000 }) as LocalGrepResult;
    expect(matches.matches.length).toBeGreaterThan(0); expect(matches.truncated).toBe(true);
    expect(JSON.stringify(matches).length).toBeLessThanOrEqual(512);
    const g = fixture(); g.put("long", `match${"x".repeat(1000)}\n`);
    const long = await g.call("grep", { pattern: "match" }) as LocalGrepResult;
    expect(long.matches[0]!.text).toHaveLength(500); expect(long.truncated).toBe(true);
    g.put("many", "match\n".repeat(1001));
    const defaults = await g.call("grep", { pattern: "match", path: "many" }) as LocalGrepResult;
    expect(defaults.matches).toHaveLength(100); expect(defaults.truncated).toBe(true);
    await expect(g.call("grep", { pattern: "match", limit: 1001 })).rejects.toThrow(/Invalid arguments/);
  });
  it("skips binary/invalid UTF-8 search content without relaxing alias checks and flags oversized omissions", async () => {
    const f = fixture(); f.put("text", "needle\n"); f.put("image", Buffer.from([0, 1, 2])); f.put("invalid", Buffer.from([0xff, 0xfe]));
    expect(await f.call("grep", { pattern: "needle" })).toEqual({ scopeExhausted: true, scope: searchScope(), matches: [{ path: "text", line: 1, text: "needle" }], truncated: false });
    f.put("oversized", Buffer.alloc(2 * 1024 * 1024 + 1));
    expect(await f.call("grep", { pattern: "needle" })).toMatchObject({ matches: [{ path: "text", line: 1, text: "needle" }], truncated: true });
    fs.linkSync(path.join(f.root, "image"), path.join(f.root, "image-alias"));
    await expect(f.call("grep", { pattern: "needle" })).rejects.toThrow(/hardlink/);
  });
  it("ignores ripgrep config, refuses process-output overflow, and does not follow enumerated symlinks", async () => {
    const f = fixture(); f.put("text", "needle\n");
    const config = path.join(f.base, "rg-config"); fs.writeFileSync(config, "--invalid-config-option\n");
    vi.stubEnv("RIPGREP_CONFIG_PATH", config);
    fs.symlinkSync(path.join(f.root, "text"), path.join(f.root, "alias"));
    expect(await f.call("find", { pattern: "*" })).toEqual({ scopeExhausted: true, scope: searchScope("*"), paths: ["text"], truncated: false });
    f.put("a", `needle${"x".repeat(1200000)}\n`); f.put("b", `needle${"x".repeat(1200000)}\n`);
    await expect(f.call("grep", { pattern: "needle" })).rejects.toThrow(/bounded work\/output/);
  });
  it("defaults find/list to 100 and rejects the 1000-result maximum before approval", async () => {
    const f = fixture(); for (let index = 0; index < 101; index++) f.put(`file-${index}`, "x");
    const found = await f.call("find", { pattern: "*" }) as LocalFindResult;
    const listed = await f.call("list") as LocalListResult;
    expect(found.paths).toHaveLength(100); expect(found.truncated).toBe(true);
    expect(listed.entries).toHaveLength(100); expect(listed.truncated).toBe(true);
    for (const name of ["find", "list"]) await expect(f.call(name, { ...(name === "find" ? { pattern: "*" } : {}), limit: 1001 })).rejects.toThrow(/Invalid arguments/);
  });
  it("fails clearly without rg, rejects invalid patterns and unsafe selected files", async () => {
    const f = fixture(); f.put("x", "text");
    await expect(f.call("grep", { pattern: "[" })).rejects.toThrow(/rg failed/);
    fs.linkSync(path.join(f.root, "x"), path.join(f.root, "y"));
    await expect(f.call("find", { pattern: "*" })).rejects.toThrow(/hardlink/);
    fs.unlinkSync(path.join(f.root, "y"));
    vi.stubEnv("PATH", path.join(f.base, "no-executable"));
    // Executable selection is pinned at startup, not repeated from changed PATH.
    expect(await f.call("find", { pattern: "*" })).toEqual({ scopeExhausted: true, scope: searchScope("*"), paths: ["x"], truncated: false });
    expect(() => f.second()).toThrow(/ripgrep .*required.*not found/);
  });
  it.each([
    ["read", { path: 5 }], ["read", { path: "x", offset: 0 }], ["grep", { pattern: "x", literal: "yes" }],
    ["find", { pattern: "*", extra: true }], ["list", { limit: 0 }], ["write", { path: "x", content: 5 }],
    ["edit", { path: "x", expectedSha256: hash("x"), oldText: "", newText: "y" }], ["shell", { command: "true", timeoutMs: "10" }],
  ])("preserves meaningful direct/generic malformed arguments for %s", async (name, args) => {
    const f = fixture(); f.put("x", "x");
    const approve = vi.fn(async () => {});
    await expect(f.call(name as string, args as Record<string, unknown>, f.context(approve))).rejects.toThrow(/Invalid arguments/);
    await expect(f.provider.invoke(name as string, args as Record<string, unknown>, f.context())).rejects.toThrow(/Invalid arguments/);
    expect(approve).not.toHaveBeenCalled();
    const descriptor = await f.provider.describe(name as string);
    expect(schemaValidationMessage(descriptor!.inputSchema, args)).toBeTruthy();
  });
});

describe("LocalCodingProvider snapshot-bound mutations", () => {
  const mutations = [
    { name: "edit", form: "single", args: { oldText: "old", newText: "new" } },
    { name: "edit", form: "batch", args: { edits: [{ oldText: "old", newText: "new" }] } },
    { name: "write", form: "overwrite", args: { content: "new", overwrite: true } },
  ];
  it.each(mutations)("rejects missing/malformed hashes before approval for $form", async ({ name, args }) => {
    const f = fixture(); f.put("x", "old");
    const approve = vi.fn(async () => {});
    for (const pin of [{}, ...[null, 42, "", "a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64)].map(expectedSha256 => ({ expectedSha256 }))]) {
      const input = { path: "x", ...args, ...pin };
      await expect(f.provider.prepareArguments(name, input, f.context(approve))).rejects.toThrow(/expectedSha256/);
      await expect(f.call(name, input, f.context(approve))).rejects.toThrow(/expectedSha256/);
      expect(fs.readFileSync(path.join(f.root, "x"), "utf8")).toBe("old");
    }
    expect(approve).not.toHaveBeenCalled();
    expect(fs.readdirSync(f.root)).toEqual(["x"]);
    if (fs.existsSync(f.lockRoot)) expect(fs.readdirSync(f.lockRoot)).toEqual([]);
  });
  it.each(mutations)("rejects stale whole-file hashes even when anchors still match for $form", async ({ name, args }) => {
    const f = fixture(); f.put("x", "old\ncontext\n");
    const before = await f.call("read", { path: "x" }) as LocalReadResult;
    const drift = "old\nexternal change\n"; f.put("x", drift);
    const approve = vi.fn(async () => {});
    const failure = await f.call(name, { path: "x", ...args, expectedSha256: before.sha256 }, f.context(approve)).catch(error => error as Error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/expectedSha256 conflict; reread/);
    expect((failure as Error).message).not.toContain(hash(drift));
    expect(approve).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(f.root, "x"), "utf8")).toBe(drift);
  });
  it("accepts read hashes and chains returned mutation hashes including no-ops", async () => {
    const f = fixture(); f.put("x", "old");
    const before = await f.call("read", { path: "x" }) as LocalReadResult;
    const changed = await f.call("edit", { path: "x", expectedSha256: before.sha256, oldText: "old", newText: "new" }) as LocalMutationResult;
    expect(changed).toMatchObject({ changed: true, sha256: hash("new") });
    const rewritten = await f.call("write", { path: "x", overwrite: true, expectedSha256: changed.sha256, content: "replacement" }) as LocalMutationResult;
    expect(rewritten).toMatchObject({ changed: true, sha256: hash("replacement") });
    expect(await f.call("write", { path: "x", overwrite: true, expectedSha256: rewritten.sha256, content: "replacement" })).toMatchObject({ changed: false });
    expect(await f.call("edit", { path: "x", expectedSha256: rewritten.sha256, edits: [{ oldText: "replacement", newText: "replacement" }] })).toMatchObject({ changed: false });
    const approve = vi.fn(async () => {});
    for (const args of [{ path: "x", overwrite: true, content: "replacement" }, { path: "x", overwrite: true, content: "replacement", expectedSha256: before.sha256 }]) {
      await expect(f.call("write", args, f.context(approve))).rejects.toThrow(/expectedSha256/);
    }
    expect(approve).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(f.root, "x"), "utf8")).toBe("replacement");
  });
  it("keeps creation hash-free but never recreates a deleted hash-bound file", async () => {
    const f = fixture(); f.put("empty", "");
    const before = await f.call("read", { path: "empty" }) as LocalReadResult;
    expect(await f.call("write", { path: "empty", content: "filled", overwrite: true, expectedSha256: before.sha256 })).toMatchObject({ changed: true });
    fs.unlinkSync(path.join(f.root, "empty"));
    const approve = vi.fn(async () => {});
    for (const overwrite of [false, true]) {
      await expect(f.call("write", { path: "empty", content: "recreated", overwrite, expectedSha256: before.sha256 }, f.context(approve))).rejects.toThrow(/cannot bind a missing file/);
      expect(fs.existsSync(path.join(f.root, "empty"))).toBe(false);
    }
    expect(approve).not.toHaveBeenCalled();
    expect(await f.call("write", { path: "new", content: "created" })).toMatchObject({ changed: true });
    expect(await f.call("write", { path: "upsert", content: "created", overwrite: true })).toMatchObject({ changed: true });
    await expect(f.call("write", { path: "new", content: "forbidden", expectedSha256: hash("created") })).rejects.toThrow(/create-only/);
  });
  it("still rejects overwrite drift during approval with a valid precondition", async () => {
    const f = fixture(); f.put("x", "old");
    const before = await f.call("read", { path: "x" }) as LocalReadResult;
    const approve = vi.fn(async () => { f.put("x", "external"); });
    await expect(f.call("write", { path: "x", overwrite: true, expectedSha256: before.sha256, content: "new" }, f.context(approve))).rejects.toThrow(/conflict/);
    expect(approve).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(path.join(f.root, "x"), "utf8")).toBe("external");
    expect(fs.readdirSync(f.lockRoot)).toEqual([]);
  });
  it("publishes matching required edit and optional write hash contracts", async () => {
    const f = fixture();
    const edit = (await f.provider.describe("edit"))!;
    const write = (await f.provider.describe("write"))!;
    expect(edit.inputSchema.required).toContain("expectedSha256");
    expect(write.inputSchema.required).not.toContain("expectedSha256");
    expect(write.inputSchema.properties).toHaveProperty("expectedSha256");
    expect(typeCheckFabricCode('return await local.edit({path:"x",oldText:"a",newText:"b"});', fabricGuestDeclarations).errors.length).toBeGreaterThan(0);
    expect(typeCheckFabricCode('return await local.write({path:"x",overwrite:true,expectedSha256:"a".repeat(64),content:"b"});', fabricGuestDeclarations).errors).toEqual([]);
  });
});

describe("LocalCodingProvider exact effects and lock lifetime", () => {
  it("creates only after approval, captures actual review, and ignores approver argument tampering", async () => {
    const f = fixture();
    const ctx = f.context(async (_action, args) => {
      expect(fs.existsSync(path.join(f.root, "new"))).toBe(false);
      expect(args.path).toBe(path.join(f.root, "new"));
      expect(args.review).toContain(`--- "new" sha256:${hash("")}`);
      expect(args.review).toContain(`+++ "new" sha256:${hash("hello\n")}`);
      expect(args.review).toContain('\n-""\n+"hello\\n"');
      expect(args.review).toContain("original lines 1-1");
      expect(args._localPreparation).toMatchObject({ beforeSha256: null, afterSha256: hash("hello\n"), identity: null });
      expect(fs.readdirSync(f.lockRoot)).toHaveLength(1);
      args.content = "evil"; args.review = "evil";
    });
    const result = await f.call("write", { path: "./new", content: "hello\n" }, ctx) as LocalMutationResult;
    expect(result).toMatchObject({ path: "new", changed: true, sha256: hash("hello\n"), bytes: 6 });
    expect(fs.readFileSync(path.join(f.root, "new"), "utf8")).toBe("hello\n");
    expect(fs.statSync(path.join(f.root, "new")).nlink).toBe(1);
    expect(fs.readdirSync(f.lockRoot)).toEqual([]);
    await expect(f.call("write", { path: "new", content: "again" })).rejects.toThrow(/create-only/);
    expect(await f.call("write", { path: "new", content: "hello\n", overwrite: true, expectedSha256: hash("hello\n") })).toMatchObject({ changed: false });
  });
  it("preserves typed effect results even with a 256-character bridge budget", async () => {
    const f = fixture(256);
    const created = await f.call("write", { path: "x", content: "old" });
    const edited = await f.call("edit", { path: "x", expectedSha256: hash("old"), oldText: "old", newText: "new" });
    const shell = await f.call("shell", { command: "printf output" });
    expect(created).toMatchObject({ changed: true, sha256: hash("old") });
    expect(edited).toMatchObject({ changed: true, sha256: hash("new") });
    expect(shell).toMatchObject({ ok: true, exitCode: 0, stdout: "", truncated: true, stdoutTruncated: true });
    for (const value of [created, edited, shell]) {
      expect(JSON.stringify(value).length).toBeLessThanOrEqual(256);
      expect(value).not.toHaveProperty("fabricTruncated");
    }
  });
  it("denial and unavailable approval never write or run shell, and release reservations", async () => {
    const f = fixture();
    for (const [name, args] of [["write", { path: "denied", content: "x" }], ["shell", { command: "touch denied" }]] as const) {
      await expect(f.call(name, args, f.context(async () => { throw new Error("denied fixture approval"); }))).rejects.toThrow(/denied/);
      expect(fs.existsSync(path.join(f.root, "denied"))).toBe(false);
      expect(fs.readdirSync(f.lockRoot)).toEqual([]);
    }
    const missing = { cwd: f.root, maxResultChars: 20000, audits: [] } as unknown as FabricRegistryInvocationContext;
    await expect(f.call("write", { path: "denied", content: "x" }, missing)).rejects.toThrow();
    expect(fs.existsSync(path.join(f.root, "denied"))).toBe(false);
    expect(fs.readdirSync(f.lockRoot)).toEqual([]);
  });
  it("rejects injected review/preparation before overwrite and altered canonical invocation", async () => {
    const f = fixture();
    for (const injected of [{ review: "fake" }, { _localPreparation: { token: "fake" } }]) await expect(f.call("write", { path: "new", content: "x", ...injected })).rejects.toThrow(/Caller-injected/);
    const prepared = await f.provider.prepareArguments("write", { path: "new", content: "x" }, f.context());
    const release = await f.provider.reserveInvocation("write", prepared, f.context());
    try {
      await expect(f.provider.invoke("write", { ...prepared, content: "evil" }, f.context())).rejects.toThrow(/altered/);
      await expect(f.provider.invoke("write", { path: "new", content: "x" }, f.context())).rejects.toThrow(/preparation/);
    } finally { release(); }
    expect(fs.existsSync(path.join(f.root, "new"))).toBe(false);
  });
  it("requires existing parents, bounds exact review, and rejects invalid new text", async () => {
    const f = fixture();
    await expect(f.call("write", { path: "missing/new", content: "x" })).rejects.toThrow();
    expect(fs.existsSync(path.join(f.root, "missing"))).toBe(false);
    const approve = vi.fn(async () => {});
    await expect(f.call("write", { path: "huge", content: "x".repeat(15000) }, f.context(approve))).rejects.toThrow(/approval budget/);
    for (const content of ["a\0b", "\ud800"]) await expect(f.call("write", { path: "invalid", content })).rejects.toThrow(/valid UTF-8/);
    expect(approve).not.toHaveBeenCalled();
  });
  it("reviews a tiny exact hunk in a large source file without hiding any changed text", async () => {
    const f = fixture();
    const before = `${"prefix\n".repeat(6000)}old-token\n${"suffix\n".repeat(6000)}`;
    const after = before.replace("old-token", "new-token"); f.put("large-source", before);
    const result = await f.call("edit", { path: "large-source", expectedSha256: hash(before), oldText: "old-token", newText: "new-token" }, f.context(async (_action, args) => {
      const review = args.review as string;
      expect(review.length).toBeLessThan(2000);
      expect(review).toContain(`sha256:${hash(before)}`); expect(review).toContain(`sha256:${hash(after)}`);
      expect(review).toContain("original lines 6001-6001");
      expect(review).toContain('\n-"old"\n+"new"');
      expect(review).toContain("Unchanged prefix omitted: 41979 UTF-16 chars");
      expect(review).toContain("Unchanged suffix omitted:");
    }));
    expect(result).toMatchObject({ changed: true, sha256: hash(after) });
    expect(fs.readFileSync(path.join(f.root, "large-source"), "utf8")).toBe(after);
  });
  it("bounds a two-hunk preview instead of repeating the unchanged middle", async () => {
    const f = fixture();
    const lines = Array.from({ length: 1000 }, (_, index) => `line ${index + 1}: value-${index}`).join("\n") + "\n";
    const after = lines.replace("value-0", "value-A").replace("value-999", "value-99B");
    f.put("two-hunks", lines);
    const approve = vi.fn<NonNullable<FabricRegistryInvocationContext["approve"]>>(async (_action, args) => {
      const review = args.review as string;
      expect(review.length).toBeLessThan(2000);
      expect(review).toContain(`sha256:${hash(lines)}`);
      expect(review).toContain(`sha256:${hash(after)}`);
      expect(review).toContain("@@ change 1/2: original lines 1-1");
      expect(review).toContain("@@ change 2/2: original lines 1000-1000");
      expect(review).toContain('\n-"0"\n+"A"');
      expect(review).toContain('\n-"9"\n+"B"');
      expect(review).toMatch(/Unchanged region omitted: \d+ UTF-16 chars \(\d+ line breaks;/);
      expect(review).not.toContain("line 500:");
      expect(review).not.toContain("Unchanged prefix omitted:");
      expect(review).not.toContain("Unchanged suffix omitted:");
    });
    const result = await f.call("edit", {
      path: "two-hunks", expectedSha256: hash(lines),
      edits: [{ oldText: "value-0", newText: "value-A" }, { oldText: "value-999", newText: "value-99B" }],
    }, f.context(approve));
    expect(approve).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ changed: true, sha256: hash(after) });
    expect(fs.readFileSync(path.join(f.root, "two-hunks"), "utf8")).toBe(after);
  });
  it.each([
    { name: "nearby out-of-order edits", before: "alpha beta", after: "beta gamma", edits: [{ oldText: "beta", newText: "gamma" }, { oldText: "alpha", newText: "beta" }], hunks: 2 },
    { name: "adjacent deletion and replacement", before: "abcd", after: "C\nD", edits: [{ oldText: "ab", newText: "" }, { oldText: "cd", newText: "C\nD" }], hunks: 2 },
    { name: "insertions within anchors", before: "head tail", after: "head-new tail!", edits: [{ oldText: "head", newText: "head-new" }, { oldText: "tail", newText: "tail!" }], hunks: 2 },
    { name: "no-op anchors", before: "keep\nold\n", after: "keep\nnew\n", edits: [{ oldText: "keep", newText: "keep" }, { oldText: "old", newText: "new" }], hunks: 1 },
    { name: "distant all=true occurrences", before: `old\n${"gap\n".repeat(1000)}old\n`, after: `new\n${"gap\n".repeat(1000)}new\n`, edits: [{ oldText: "old", newText: "new", all: true }], hunks: 2 },
    { name: "CRLF and UTF-16 surrogate boundaries", before: "\uFEFF😀 A\r\nB 😀\r\n", after: "\uFEFF🙂 A\r\nB 🙂\r\n", edits: [{ oldText: "😀", newText: "🙂", all: true }], hunks: 2 },
    { name: "multiline changes shifting subsequent lines", before: "first\nmiddle\nlast", after: "FIRST\nMORE\nmiddle\nEND", edits: [{ oldText: "first", newText: "FIRST\nMORE" }, { oldText: "last", newText: "END" }], hunks: 2 },
    { name: "long single-line gaps", before: `old${"x".repeat(10000)}old`, after: `new${"x".repeat(10000)}new`, edits: [{ oldText: "old", newText: "new", all: true }], hunks: 2 },
  ])("renders complete exact hunks with unchanged context for $name", async ({ before, after, edits, hunks }) => {
    const f = fixture(); f.put("exact-hunks", before);
    const approve = vi.fn<NonNullable<FabricRegistryInvocationContext["approve"]>>(async (_action, args) => {
      const review = args.review as string;
      const blocks = [...review.matchAll(/^@@ change (\d+)\/(\d+): original lines (\d+)-(\d+), UTF-16 \[(\d+),(\d+)\); proposed lines (\d+)-(\d+), UTF-16 \[(\d+),(\d+)\) @@\n context-before (.*)\n-(.*)\n\+(.*)\n context-after (.*)$/gm)];
      expect(blocks).toHaveLength(hunks);
      expect(review.length).toBeLessThan(2000);
      const lineAt = (text: string, offset: number) => text.slice(0, offset).split("\n").length;
      let previousBefore = 0, previousAfter = 0, previousContextEnd = 0, reconstructed = "";
      for (const [index, block] of blocks.entries()) {
        const beforeStart = Number(block[5]), beforeEnd = Number(block[6]);
        const afterStart = Number(block[9]), afterEnd = Number(block[10]);
        const contextBefore = JSON.parse(block[11]!) as string, contextAfter = JSON.parse(block[14]!) as string;
        const removed = JSON.parse(block[12]!) as string, added = JSON.parse(block[13]!) as string;
        expect([Number(block[1]), Number(block[2])]).toEqual([index + 1, hunks]);
        expect([Number(block[3]), Number(block[4]), Number(block[7]), Number(block[8])]).toEqual([
          lineAt(before, beforeStart), lineAt(before, beforeEnd), lineAt(after, afterStart), lineAt(after, afterEnd),
        ]);
        expect(beforeStart).toBeGreaterThanOrEqual(previousBefore);
        expect(afterStart).toBeGreaterThanOrEqual(previousAfter);
        expect(removed).toBe(before.slice(beforeStart, beforeEnd));
        expect(added).toBe(after.slice(afterStart, afterEnd));
        expect(before.slice(previousBefore, beforeStart)).toBe(after.slice(previousAfter, afterStart));
        expect(contextBefore).toBe(before.slice(beforeStart - contextBefore.length, beforeStart));
        expect(contextAfter).toBe(before.slice(beforeEnd, beforeEnd + contextAfter.length));
        expect(beforeStart - contextBefore.length).toBeGreaterThanOrEqual(previousContextEnd);
        expect(beforeEnd + contextAfter.length).toBeLessThanOrEqual(Number(blocks[index + 1]?.[5] ?? before.length));
        for (const context of [contextBefore, contextAfter]) {
          expect(context.length).toBeLessThanOrEqual(200);
          expect(context.split("\n").length - 1).toBeLessThanOrEqual(3);
        }
        reconstructed += before.slice(previousBefore, beforeStart) + added;
        previousBefore = beforeEnd; previousAfter = afterEnd; previousContextEnd = beforeEnd + contextAfter.length;
      }
      expect(before.slice(previousBefore)).toBe(after.slice(previousAfter));
      expect(reconstructed + before.slice(previousBefore)).toBe(after);
    });
    await f.call("edit", { path: "exact-hunks", expectedSha256: hash(before), edits }, f.context(approve));
    expect(approve).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(path.join(f.root, "exact-hunks"), "utf8")).toBe(after);
  });
  it("refuses too many complete hunks rather than silently dropping occurrences", async () => {
    const f = fixture(); const before = "old\n".repeat(200); f.put("many-hunks", before);
    const approve = vi.fn(async () => {});
    await expect(f.call("edit", { path: "many-hunks", expectedSha256: hash(before), oldText: "old", newText: "new", all: true }, f.context(approve))).rejects.toThrow(/approval budget/);
    expect(approve).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(f.root, "many-hunks"), "utf8")).toBe(before);
  });
  it("still refuses an edit whose changed text alone exceeds the approval budget", async () => {
    const f = fixture();
    const large = "x".repeat(12000);
    f.put("oversized", `head\n${large}\ntail\n`);
    const approve = vi.fn(async () => {});
    await expect(f.call("edit", { path: "oversized", expectedSha256: hash(`head\n${large}\ntail\n`), oldText: large, newText: "y".repeat(12000) }, f.context(approve))).rejects.toThrow(/approval budget/);
    expect(approve).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(f.root, "oversized"), "utf8")).toBe(`head\n${large}\ntail\n`);
  });
  it("revalidates after temporary file preparation and publishes new files atomically create-only", async () => {
    const f = fixture(); f.put("existing", "old");
    const originalSync = fs.fsyncSync;
    vi.spyOn(fs, "fsyncSync").mockImplementationOnce((fd) => { originalSync(fd); f.put("existing", "external"); });
    await expect(f.call("write", { path: "existing", content: "approved", overwrite: true, expectedSha256: hash("old") })).rejects.toThrow(/conflict/);
    expect(fs.readFileSync(path.join(f.root, "existing"), "utf8")).toBe("external");
    const originalLink = fs.linkSync;
    vi.spyOn(fs, "linkSync").mockImplementationOnce((oldPath, newPath) => { fs.writeFileSync(newPath, "racing create"); originalLink(oldPath, newPath); });
    await expect(f.call("write", { path: "new", content: "approved" })).rejects.toThrow(/EEXIST/);
    expect(fs.readFileSync(path.join(f.root, "new"), "utf8")).toBe("racing create");
    expect(fs.readdirSync(f.root).filter((name) => name.startsWith(".fabric-local-"))).toEqual([]);
    expect(fs.readdirSync(f.lockRoot)).toEqual([]);
  });
  it("enforces exact unique anchors, all=true replacements, no-change and ordinary mode preservation", async () => {
    const f = fixture(); f.put("edit", "old old\n"); fs.chmodSync(path.join(f.root, "edit"), 0o751);
    await expect(f.call("edit", { path: "edit", expectedSha256: hash("old old\n"), oldText: "absent", newText: "x" })).rejects.toThrow(/not found/);
    await expect(f.call("edit", { path: "edit", expectedSha256: hash("old old\n"), oldText: "old", newText: "x" })).rejects.toThrow(/not unique/);
    expect(await f.call("edit", { path: "edit", expectedSha256: hash("old old\n"), oldText: "old", newText: "$&", all: true })).toMatchObject({ changed: true, sha256: hash("$& $&\n") });
    expect(fs.readFileSync(path.join(f.root, "edit"), "utf8")).toBe("$& $&\n");
    expect(fs.statSync(path.join(f.root, "edit")).mode & 0o777).toBe(0o751);
    expect(await f.call("edit", { path: "edit", expectedSha256: hash("$& $&\n"), oldText: "$& $&", newText: "$& $&" })).toMatchObject({ changed: false });
    f.put("overlap", "aaa");
    await expect(f.call("edit", { path: "overlap", expectedSha256: hash("aaa"), oldText: "aa", newText: "x" })).rejects.toThrow(/not unique/);
  });
  it.each(["content", "file", "parent", "symlink", "hardlink", "root"])("rejects approval-time %s replacement", async (kind) => {
    const f = fixture(); fs.mkdirSync(path.join(f.root, "dir")); f.put("dir/x", "old");
    const ctx = f.context(async () => {
      const file = path.join(f.root, "dir/x");
      if (kind === "content") fs.writeFileSync(file, "external");
      if (kind === "file") { fs.renameSync(file, `${file}-old`); fs.writeFileSync(file, "old"); }
      if (kind === "parent") { fs.renameSync(path.dirname(file), path.join(f.root, "previous")); fs.mkdirSync(path.dirname(file)); fs.writeFileSync(file, "old"); }
      if (kind === "symlink") { fs.renameSync(file, `${file}-old`); fs.symlinkSync(`${file}-old`, file); }
      if (kind === "hardlink") fs.linkSync(file, `${file}-alias`);
      if (kind === "root") { fs.renameSync(f.root, `${f.root}-old`); fs.mkdirSync(f.root); fs.mkdirSync(path.join(f.root, "dir")); f.put("dir/x", "old"); }
    });
    await expect(f.call("edit", { path: "dir/x", expectedSha256: hash("old"), oldText: "old", newText: "approved" }, ctx)).rejects.toThrow(/conflict|identity|symlink|hardlink/);
    expect(fs.readFileSync(path.join(f.root, "dir/x"), "utf8")).not.toBe("approved");
    expect(fs.readdirSync(f.lockRoot)).toEqual([]);
  });
  it("detects create-only conflict introduced during approval", async () => {
    const f = fixture();
    await expect(f.call("write", { path: "new", content: "approved" }, f.context(async () => f.put("new", "external")))).rejects.toThrow(/conflict/);
    expect(fs.readFileSync(path.join(f.root, "new"), "utf8")).toBe("external");
  });
  it("fails fast before another approval across calls, providers and a separate process", async () => {
    const f = fixture(); const other = f.second();
    const entered = deferred(); const finish = deferred();
    const first = f.call("write", { path: "one", content: "1" }, f.context(async () => { entered.resolve(); await finish.promise; }));
    await Promise.race([entered.promise, first]);
    const approve = vi.fn(async () => {});
    await expect(f.call("shell", { command: "true" }, f.context(approve))).rejects.toThrow(/Overlapping write/);
    await expect(other.invoke("local.write", { path: "two", content: "2" }, f.context(approve))).rejects.toThrow(/lock unavailable/);
    expect(approve).not.toHaveBeenCalled();
    finish.resolve(); await first;
    const lock = path.join(f.lockRoot, `local-${hash(f.root)}.lock`);
    const child = spawn(process.execPath, ["-e", "const fs=require('fs');const fd=fs.openSync(process.argv[1],'wx',0o600);process.stdout.write('ready');process.stdin.resume();process.stdin.on('end',()=>{fs.closeSync(fd);fs.unlinkSync(process.argv[1]);process.exit(0)});", lock], { stdio: ["pipe", "pipe", "pipe"] });
    const closed = new Promise<void>((resolve, reject) => { child.on("error", reject); child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`fixture lock process exited ${code}`))); });
    try {
      await new Promise<void>((resolve, reject) => { child.stdout.once("data", () => resolve()); child.once("error", reject); });
      await expect(f.call("write", { path: "two", content: "2" }, f.context(approve))).rejects.toThrow(/lock unavailable/);
      expect(approve).not.toHaveBeenCalled();
    } finally { child.stdin.end(); await closed; }
    expect(await other.invoke("local.write", { path: "two", content: "2" }, f.context())).toMatchObject({ changed: true });
  });
  it("never breaks uncertain locks or releases another inode; acknowledges committed cleanup failure", async () => {
    const f = fixture();
    const prepared = await f.provider.prepareArguments("write", { path: "new", content: "x" }, f.context());
    const release = await f.provider.reserveInvocation("write", prepared, f.context());
    await f.provider.invoke("write", prepared, f.context());
    const lock = path.join(f.lockRoot, fs.readdirSync(f.lockRoot)[0]!);
    fs.renameSync(lock, `${lock}-owned`); fs.writeFileSync(lock, "uncertain replacement", { mode: 0o600 });
    let failure: unknown;
    try { release(); } catch (error) { failure = error; }
    expect(fabricCommitAcknowledgement(failure)).toEqual({ version: 1, operation: "write" });
    expect(fs.readFileSync(lock, "utf8")).toBe("uncertain replacement");
    await expect(f.call("shell", { command: "true" })).rejects.toThrow(/lock unavailable/);
  });
  it("rejects an unsafe lockRoot and replacement of the pinned lock directory", async () => {
    const f = fixture();
    const inSource = path.join(f.root, ".locks");
    expect(() => new LocalCodingProvider({ root: f.root, lockRoot: inSource })).toThrow(/outside the source workspace/);
    expect(fs.existsSync(inSource)).toBe(false);
    const unsafe = path.join(f.base, "unsafe"); fs.mkdirSync(unsafe, { mode: 0o755 });
    expect(() => new LocalCodingProvider({ root: f.root, lockRoot: unsafe })).toThrow(/private/);
    fs.renameSync(f.lockRoot, `${f.lockRoot}-old`); fs.mkdirSync(f.lockRoot, { mode: 0o700 });
    await expect(f.call("write", { path: "new", content: "x" })).rejects.toThrow(/lockRoot identity/);
  });
  it("delegates shell with exact command/canonical cwd, bounded output and settle", async () => {
    const f = fixture(1000);
    const result = await f.call("shell", { command: "printf hello; printf error >&2; exit 7", settle: true }, f.context(async (_action, args) => {
      expect(args.cwd).toBe(f.root); expect(args.review).toContain('Command: "printf hello; printf error >&2; exit 7"'); expect(args.review).toContain(JSON.stringify(f.root));
    })) as LocalShellResult;
    expect(result).toMatchObject({ ok: false, exitCode: 7, stdout: "hello", stderr: "error" });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(1000);
    await expect(f.call("shell", { command: "exit 7" })).rejects.toThrow(/code 7/);
    fs.mkdirSync(path.join(f.root, "cwd"));
    await expect(f.call("shell", { command: "true", cwd: "cwd" }, f.context(async () => { fs.renameSync(path.join(f.root, "cwd"), path.join(f.root, "old-cwd")); fs.mkdirSync(path.join(f.root, "cwd")); }))).rejects.toThrow(/cwd identity/);
  });
  it("validates script alternatives before approval and binds literal scripts/argv to approval", async () => {
    const f = fixture();
    const invalid = [{}, { command: "true", script: "true" }, { command: "true", args: [] },
      { script: "true", interpreter: "zsh" }, { script: "true", args: ["nul\0value"] }];
    for (const args of invalid) {
      const approved = vi.fn();
      await expect(f.call("shell", args, f.context(approved))).rejects.toThrow();
      expect(approved).not.toHaveBeenCalled();
    }
    const script = 'printf "%s" "$1"';
    const input = "'$(touch unexpected)`touch unexpected`\nsecond line";
    expect(await f.call("shell", { script, interpreter: "bash", args: [input] }, f.context(async (action, args) => {
      expect(action.risk).toBe("execute");
      expect(args.review).toContain(`Script: ${JSON.stringify(script)}`);
      expect(args.review).toContain(`Arguments: ${JSON.stringify([input])}`);
      expect(args.cwd).toBe(f.root);
    }))).toMatchObject({ ok: true, stdout: input });
    await expect(f.call("shell", { script: "touch denied", interpreter: "bash" }, f.context(async () => { throw new Error("denied"); }))).rejects.toThrow("denied");
    expect(fs.readdirSync(f.root)).toEqual([]);
  });
  it("holds the lock across pending approval even when closed, and never starts a late effect", async () => {
    const f = fixture(); const entered = deferred(); const finish = deferred();
    const running = f.call("write", { path: "late", content: "x" }, f.context(async () => { entered.resolve(); await finish.promise; }));
    const outcome = running.catch((error: unknown) => error);
    await Promise.race([entered.promise, outcome]);
    await f.provider.close();
    expect(fs.readdirSync(f.lockRoot)).toHaveLength(1);
    finish.resolve();
    expect(await outcome).toBeInstanceOf(Error);
    expect(fs.existsSync(path.join(f.root, "late"))).toBe(false);
    expect(fs.readdirSync(f.lockRoot)).toEqual([]);
  });
  it("reports committed write evidence if release fails through the registry", async () => {
    const f = fixture();
    const originalRename = fs.renameSync;
    f.put("existing", "old");
    const ctx = f.context();
    vi.spyOn(fs, "renameSync").mockImplementationOnce((oldPath, newPath) => {
      originalRename(oldPath, newPath);
      const lock = path.join(f.lockRoot, fs.readdirSync(f.lockRoot)[0]!);
      originalRename(lock, `${lock}-owned`); fs.writeFileSync(lock, "uncertain", { mode: 0o600 });
    });
    await expect(f.call("write", { path: "existing", content: "new", overwrite: true, expectedSha256: hash("old") }, ctx)).rejects.toThrow(/committed/);
    expect(fs.readFileSync(path.join(f.root, "existing"), "utf8")).toBe("new");
    expect(ctx.audits[0]?.commitAcknowledgement).toEqual({ version: 1, operation: "write" });
    expect(ctx.audits[0]?.success).toBe(false);
  });
  it("close aborts and awaits pending shell cleanup before lock release", async () => {
    const f = fixture();
    const running = f.call("shell", { command: "printf ready > started; sleep 60" });
    const outcome = running.catch((error: unknown) => error);
    await vi.waitFor(() => expect(fs.existsSync(path.join(f.root, "started"))).toBe(true));
    expect(fs.readdirSync(f.lockRoot)).toHaveLength(1);
    await f.provider.close();
    expect(await outcome).toBeInstanceOf(Error);
    expect(fs.readdirSync(f.lockRoot)).toEqual([]);
    await expect(f.call("read", { path: "started" })).rejects.toThrow(/closed/);
  });
});
