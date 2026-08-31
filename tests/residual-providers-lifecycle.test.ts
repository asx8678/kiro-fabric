import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { KiroToolsProvider } from "../src/kiro/tools-provider.js";
import { KiroMemoryProvider } from "../src/kiro/memory-provider.js";
import { BoundedRegexWorkerSession } from "../src/memory/regex.js";
import type { FabricInvocationContext } from "../src/protocol.js";

const context = (cwd: string, signal?: AbortSignal): FabricInvocationContext => ({
  cwd, signal, parentToolCallId: "parent", nestedToolCallId: "nested",
  extensionContext: { cwd } as never, update() {},
} as FabricInvocationContext);

describe("residual provider lifecycle regressions", () => {
  it("moves truncated bash output into an opaque artifact and removes its spool", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "bash-spool-regression-"));
    let artifact = "";
    const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("kiro-fabric-bash-")));
    try {
      const result = await new KiroToolsProvider(cwd, {
        writeArtifact(content) { artifact = content; return `ka_${"a".repeat(48)}`; },
      }).invoke("bash", {
        command: "head -c 60000 /dev/zero | tr '\\0' x",
      }, context(cwd)) as { details: { artifactId: string; fullOutputPath?: string } };
      expect(result.details.artifactId).toBe(`ka_${"a".repeat(48)}`);
      expect(result.details.fullOutputPath).toBeUndefined();
      expect(artifact).toHaveLength(60_000);
      const after = fs.readdirSync(os.tmpdir()).filter((name) =>
        name.startsWith("kiro-fabric-bash-") && !before.has(name));
      expect(after).toEqual([]);
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  });

  it("rejects a missing PATH-resolved Bash without an uncaught spawn error", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "bash-spawn-regression-"));
    try {
      const provider = new KiroToolsProvider(cwd, { bashPath: `missing-bash-${crypto.randomUUID()}` });
      await expect(provider.invoke("bash", { command: "echo unreachable" }, context(cwd)))
        .rejects.toThrow(/failed to launch/);
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  });

  it("does not commit memory.set cancelled while waiting for its lock", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "memory-cancel-repro-"));
    try {
      const store = path.join(cwd, "store");
      const provider = new KiroMemoryProvider({ cwd, root: store });
      await provider.invoke("get", { key: "seed" }, context(cwd));
      const namespace = fs.readdirSync(path.join(store, "memory"), { withFileTypes: true })
        .find((entry) => entry.isDirectory())!.name;
      const lock = path.join(store, "memory", namespace, ".kiro-fabric-mutation-lock");
      fs.mkdirSync(lock);
      fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }));
      const controller = new AbortController();
      const pending = provider.invoke("set", { key: "late", value: "committed" }, context(cwd, controller.signal));
      await new Promise((resolve) => setTimeout(resolve, 30));
      controller.abort(new Error("cancelled"));
      await expect(pending).rejects.toThrow("cancelled");
      fs.rmSync(lock, { recursive: true, force: true });
      const entry = await provider.invoke("get", { key: "late" }, context(cwd)) as unknown;
      expect(entry).toBeNull();
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  });

  it("shares one regex worker deadline across all batches", async () => {
    const session = new BoundedRegexWorkerSession("needle", { maxPatternBytes: 100, timeoutMs: 100 });
    try {
      await expect(session.execute(["needle"])).resolves.toEqual({ complete: true, matched: [0] });
      await new Promise((resolve) => setTimeout(resolve, 110));
      await expect(session.execute(["needle"])).resolves.toMatchObject({
        complete: false,
        error: { code: "regex_timeout" },
      });
    } finally { await session.close(); }
  });
});
