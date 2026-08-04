import { describe, expect, it } from "vitest";
import { KiroHeadlessRunner, runProcess } from "../../src/runners/kiro.js";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("bounded child process capture", () => {
  it("caps stdout and stderr independently", async () => {
    const result = await runProcess(process.execPath, ["-e", "process.stdout.write('o'.repeat(80));process.stderr.write('e'.repeat(80))"], { timeoutMs: 5000, maxChars: 100 });
    expect(result.stdout).toHaveLength(80);
    expect(result.stderr).toHaveLength(80);
  });

  it("kills a child when either stream exceeds its cap", async () => {
    await expect(runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(1000))"], { timeoutMs: 5000, maxChars: 64 })).rejects.toThrow(/stdout limit of 64/);
  });

  it("rejects with a typed timeout error and kills the child", async () => {
    const started = Date.now();
    await expect(
      runProcess(process.execPath, ["-e", "setTimeout(()=>{},10000)"], { timeoutMs: 30 }),
    ).rejects.toMatchObject({ code: "TIMEOUT", message: "Process timed out after 30ms" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("terminates on cancellation", async () => {
    const controller = new AbortController();
    const pending = runProcess(process.execPath, ["-e", "setTimeout(()=>{},10000)"], { timeoutMs: 15000, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("keeps the chat prompt in documented positional input when stdin is unsupported", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "fabric-chat-"));
    const record = path.join(root, "invocation.json");
    try {
      const executable = path.join(root, "kiro");
      await writeFile(executable, `#!/usr/bin/env node\nconst fs = require("node:fs"); let input = ""; process.stdin.on("data", c => input += c); process.stdin.on("end", () => { fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args: process.argv.slice(2), input })); process.stdout.write("FABRIC_RESULT_BEGIN\\n{\\"ok\\":true}\\nFABRIC_RESULT_END"); });\n`);
      await chmod(executable, 0o755);
      const result = await new KiroHeadlessRunner(executable).run({ instruction: "stdin evidence", context: "", role: "general", maxOutputChars: 1000, timeoutMs: 5000 });
      expect(result.exitCode).toBe(0);
      const invocation = JSON.parse(await readFile(record, "utf8")) as { args: string[]; input: string };
      expect(invocation.args.slice(0, 4)).toEqual(["chat", "--no-interactive", "--agent", "fabric-lite-worker"]);
      expect(invocation.args.at(-1)).toContain("FABRIC_REQUEST_V1_BEGIN");
      expect(invocation.input).toBe("");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("resolves a bare executable through PATH across platforms", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "fabric-path-"));
    const previousPath = process.env.PATH;
    try {
      const bin = path.join(root, "bin");
      await mkdir(bin, { recursive: true });
      const executable = path.join(bin, "fake-kiro-cli");
      await writeFile(executable, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo fake-version; fi\nexit 0\n");
      await chmod(executable, 0o755);
      process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`;
      await expect(new KiroHeadlessRunner("fake-kiro-cli").doctor()).resolves.toMatchObject({ ok: true, version: "fake-version" });
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports useful model JSON parse errors", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "fabric-models-"));
    try {
      const executable = path.join(root, "kiro");
      await writeFile(executable, "#!/bin/sh\nprintf 'not-json'\n");
      await chmod(executable, 0o755);
      await expect(new KiroHeadlessRunner(executable).listModels()).rejects.toThrow(/invalid JSON.*not-json/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
