import { describe, expect, it } from "vitest";
import { KiroHeadlessRunner, runProcess } from "../../src/runners/kiro.js";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
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