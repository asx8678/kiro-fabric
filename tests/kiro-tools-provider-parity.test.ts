import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { KiroToolsProvider } from "../src/kiro/tools-provider.js";
import { PiToolsProvider } from "../src/providers/pi-tools-provider.js";
import type { FabricInvocationContext } from "../src/protocol.js";

const roots: string[] = [];
const root = (): string => { const value = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-native-tools-")); roots.push(value); return value; };
afterEach(() => { for (const value of roots.splice(0)) fs.rmSync(value, { recursive: true, force: true }); });
const context = (cwd: string, signal?: AbortSignal): FabricInvocationContext => ({
  cwd, signal, parentToolCallId: "parent", nestedToolCallId: "nested", extensionContext: { cwd } as never,
  update() {},
} as FabricInvocationContext);

describe("host-neutral Kiro tools provider", () => {
  it("preserves Pi core descriptor schemas, risks, and namespaces", async () => {
    const cwd = root();
    const native = new KiroToolsProvider(cwd);
    const pi = new PiToolsProvider(cwd, undefined, undefined, { namespace: "k", exposeSessionEnvironment: false });
    for (const name of ["read", "bash", "edit", "write", "grep", "find", "ls"]) {
      const nativeDescriptor = await native.describe(name, context(cwd));
      const piDescriptor = await pi.describe(name, context(cwd));
      expect({ ...nativeDescriptor, description: undefined }).toEqual({
        ...piDescriptor,
        description: undefined,
      });
    }
    expect((await native.list({ query: "directory" }, context(cwd))).map((item) => item.name)).toEqual(["bash", "find", "ls"]);
  });

  it("reads, writes, atomically edits, searches, lists, and executes", async () => {
    const cwd = root();
    const provider = new KiroToolsProvider(cwd);
    const ctx = context(cwd);
    await expect(provider.invoke("write", { path: "src/a.txt", content: "alpha\nbeta\nalpha\n" }, ctx)).resolves.toMatchObject({ ok: true, details: null });
    await expect(provider.invoke("read", { path: "src/a.txt", offset: 2, limit: 1 }, ctx)).resolves.toBe("beta");
    await expect(provider.invoke("edit", { path: "src/a.txt", edits: [{ oldText: "alpha", newText: "omega", all: true }] }, ctx)).resolves.toMatchObject({ ok: true });
    expect(fs.readFileSync(path.join(cwd, "src/a.txt"), "utf8")).toBe("omega\nbeta\nomega\n");
    await expect(provider.invoke("grep", { path: "src", pattern: "omega", limit: 2 }, ctx)).resolves.toContain("a.txt:1:omega");
    await expect(provider.invoke("find", { path: ".", pattern: "**/*.txt" }, ctx)).resolves.toBe("src/a.txt");
    await expect(provider.invoke("ls", { path: "." }, ctx)).resolves.toBe("src/");
    await expect(provider.invoke("bash", { command: "printf host-neutral" }, ctx)).resolves.toMatchObject({ ok: true, output: "host-neutral" });
  });

  it("uses standard globstar semantics and excludes gitignored files and directories", async () => {
    const cwd = root();
    fs.mkdirSync(path.join(cwd, "src", "generated"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".gitignore"), "ignored.txt\nsrc/generated/\n*.secret\n");
    fs.writeFileSync(path.join(cwd, "root.txt"), "visible root\n");
    fs.writeFileSync(path.join(cwd, "ignored.txt"), "hidden root\n");
    fs.writeFileSync(path.join(cwd, "root.secret"), "hidden secret\n");
    fs.writeFileSync(path.join(cwd, "src", "kept.txt"), "visible nested\n");
    fs.writeFileSync(path.join(cwd, "src", "generated", "hidden.txt"), "hidden generated\n");
    const provider = new KiroToolsProvider(cwd);
    const ctx = context(cwd);

    await expect(provider.invoke("find", { pattern: "**/*.txt" }, ctx))
      .resolves.toBe("root.txt\nsrc/kept.txt");
    await expect(provider.invoke("find", { path: "src", pattern: "**/*.txt" }, ctx))
      .resolves.toBe("kept.txt");
    const searched = await provider.invoke("grep", { pattern: "root|nested|hidden", path: "." }, ctx);
    expect(searched).toContain("root.txt:1:visible root");
    expect(searched).toContain("src/kept.txt:1:visible nested");
    expect(searched).not.toContain("ignored.txt");
    expect(searched).not.toContain("generated/hidden.txt");
    expect(searched).not.toContain("root.secret");
  });

  it("bounds a single long read line and preserves existing file permissions", async () => {
    const cwd = root();
    const file = path.join(cwd, "script.sh");
    fs.writeFileSync(file, "x".repeat(60_000), { mode: 0o755 });
    const provider = new KiroToolsProvider(cwd);
    const ctx = context(cwd);

    const read = await provider.invoke("read", { path: "script.sh" }, ctx);
    expect(Buffer.byteLength(String(read), "utf8")).toBe(50_000);
    await provider.invoke("write", { path: "script.sh", content: "#!/bin/sh\necho before\n" }, ctx);
    await provider.invoke("edit", {
      path: "script.sh",
      edits: [{ oldText: "before", newText: "after" }],
    }, ctx);
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o755);
    }
  });

  it("preserves partial bash output on timeout and abort", async () => {
    const cwd = root();
    const provider = new KiroToolsProvider(cwd);
    await expect(provider.invoke(
      "bash",
      { command: "printf timeout-prefix; sleep 10", timeout: 0.02 },
      context(cwd),
    )).rejects.toThrow(/timeout-prefix[\s\S]*timed out/);

    const controller = new AbortController();
    const call = provider.invoke(
      "bash",
      { command: "printf abort-prefix; sleep 10" },
      context(cwd, controller.signal),
    );
    setTimeout(() => controller.abort(new Error("requested stop")), 30);
    await expect(call).rejects.toThrow(/abort-prefix[\s\S]*requested stop/);
  });

  it("bounds image dimensions before attaching media", async () => {
    const cwd = root();
    const oversized = Buffer.alloc(24);
    Buffer.from("89504e470d0a1a0a", "hex").copy(oversized);
    oversized.writeUInt32BE(20_000, 16);
    oversized.writeUInt32BE(20_000, 20);
    fs.writeFileSync(path.join(cwd, "oversized.png"), oversized);
    const provider = new KiroToolsProvider(cwd);
    await expect(provider.invoke("read", { path: "oversized.png" }, context(cwd)))
      .rejects.toThrow(/refuses images/);
  });

  it("bounds grep regex execution and surfaces unreadable files", async () => {
    const cwd = root();
    fs.writeFileSync(path.join(cwd, "redos.txt"), `${"a".repeat(100_000)}!`);
    const provider = new KiroToolsProvider(cwd);
    await expect(provider.invoke("grep", { path: "redos.txt", pattern: "(a+)+$" }, context(cwd)))
      .rejects.toThrow(/Regex execution exceeded/);

    if (process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() !== 0) {
      const unreadable = path.join(cwd, "unreadable.txt");
      fs.writeFileSync(unreadable, "needle", { mode: 0o000 });
      await expect(provider.invoke("grep", { path: unreadable, pattern: "needle", literal: true }, context(cwd)))
        .rejects.toMatchObject({ code: expect.stringMatching(/EACCES|EPERM/) });
    }
  });

  it("emits the runtime settlement marker for nonzero bash exits", async () => {
    const cwd = root();
    const provider = new KiroToolsProvider(cwd);
    await expect(provider.invoke(
      "bash",
      { command: "printf failed-output; exit 7" },
      context(cwd),
    )).rejects.toThrow("failed-output\n\nCommand exited with code 7");
  });

  it("never traverses or mutates a protected managed release", async () => {
    const cwd = root();
    const release = path.join(cwd, ".fabric", "runtime", "digest");
    fs.mkdirSync(release, { recursive: true });
    fs.writeFileSync(path.join(release, "runtime.js"), "attested\n");
    const provider = new KiroToolsProvider(cwd, { protectedRoots: [release] });
    const ctx = context(cwd);

    await expect(provider.invoke("read", { path: path.join(release, "runtime.js") }, ctx))
      .rejects.toThrow(/managed immutable runtime/);
    await expect(provider.invoke("write", { path: path.join(release, "runtime.js"), content: "changed" }, ctx))
      .rejects.toThrow(/managed immutable runtime/);
    await expect(provider.invoke("find", { path: ".", pattern: "**/*.js" }, ctx)).resolves.toBe("");
    expect(fs.readFileSync(path.join(release, "runtime.js"), "utf8")).toBe("attested\n");
  });

  it("confines every filesystem operation, including missing write targets", async () => {
    const cwd = root();
    const outside = root();
    const provider = new KiroToolsProvider(cwd);
    const ctx = context(cwd);
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
    for (const [name, args] of [
      ["read", { path: path.join(outside, "secret.txt") }], ["write", { path: path.join(outside, "new.txt"), content: "x" }],
      ["edit", { path: path.join(outside, "secret.txt"), edits: [{ oldText: "secret", newText: "x" }] }],
      ["grep", { path: outside, pattern: "secret" }], ["find", { path: outside, pattern: "*" }], ["ls", { path: outside }],
    ] as const) await expect(provider.invoke(name, args, ctx)).rejects.toThrow(/escapes the project root/);
    expect(fs.existsSync(path.join(outside, "new.txt"))).toBe(false);
  });

  it("honors pre-abort and aborts bash and optional artifact reads", async () => {
    const cwd = root();
    const controller = new AbortController(); controller.abort(new Error("stop now"));
    const provider = new KiroToolsProvider(cwd, { readArtifact: async () => new Promise(() => undefined) });
    await expect(provider.invoke("ls", {}, context(cwd, controller.signal))).rejects.toThrow("stop now");
    const artifactAbort = new AbortController();
    const artifact = provider.invoke("readArtifact", { id: "ka_" + "a".repeat(48) }, context(cwd, artifactAbort.signal));
    artifactAbort.abort(new Error("artifact stopped"));
    await expect(artifact).rejects.toThrow("artifact stopped");
    const bashAbort = new AbortController();
    const bash = provider.invoke("bash", { command: "sleep 10" }, context(cwd, bashAbort.signal));
    setTimeout(() => bashAbort.abort(new Error("bash stopped")), 20);
    await expect(bash).rejects.toThrow("bash stopped");
  });
});
