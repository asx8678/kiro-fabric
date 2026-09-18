import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { finalizeQualificationDiagnostic, assertExternalDiagnosticPath, assertSafeQualificationPublication, qualificationFailureRecorder, runBoundedQualificationProcess, withQualificationFailureReport } from "../scripts/qualification-failure.mjs";
import { runRealKiroAgentDriver } from "../scripts/run-kiro-agent-real-driver.mjs";

const roots: string[] = [];
const fixture = () => { const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "qualification-fault-"))); roots.push(root); return { root, output: path.join(root, "safe.json"), raw: path.join(root, "auth-home") }; };
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("offline nonqualifying failure evidence", () => {
  it.each(["preflight", "archive-installation", "publication"])("retains only bounded phase metadata BEFORE cleanup at %s", async phase => {
    const f = fixture(); fs.mkdirSync(f.raw, { mode: 0o700 });
    const secret = "AUTH_TOKEN_and_raw_transcript_" + "s".repeat(10000); fs.writeFileSync(path.join(f.raw, "token"), secret);
    await expect(withQualificationFailureReport({ output: f.output, component: "wrapper", cleanupKind: "authHome", cleanup: () => {
      const before = JSON.parse(fs.readFileSync(f.output, "utf8"));
      expect(before).toMatchObject({ phase, reason: "error", qualifying: false, cleanup: { authHome: "pending" } });
      expect(fs.existsSync(f.raw)).toBe(true); fs.rmSync(f.raw, { recursive: true });
    } }, record => { record.phase(phase); throw new Error(secret); })).rejects.toThrow(secret);
    const bytes = fs.readFileSync(f.output, "utf8"); expect(Buffer.byteLength(bytes)).toBeLessThanOrEqual(4096); expect(bytes).not.toContain(secret); expect(bytes).not.toContain(f.raw);
    expect(JSON.parse(bytes)).toMatchObject({ ok: false, qualifying: false, cleanup: { authHome: "removed" } }); expect(fs.existsSync(f.raw)).toBe(false);
    expect(fs.statSync(f.output).mode & 0o777).toBe(0o600);
  });
  it("reports cleanup failure without exposing its message or masking the original phase", async () => {
    const f = fixture();
    await expect(withQualificationFailureReport({ output: f.output, component: "driver", cleanupKind: "processes", cleanup: () => { throw new Error("secret cleanup diagnostic"); } }, record => { record.phase("resume"); throw new Error("secret command output"); })).rejects.toThrow("secret command output");
    const text = fs.readFileSync(f.output, "utf8"); expect(text).not.toContain("secret"); expect(JSON.parse(text)).toMatchObject({ phase: "resume", cleanup: { processes: "failed" } });
  });
  it("always cleans raw auth even when safe-report writes fail", async () => {
    const f = fixture(); fs.mkdirSync(f.output); let cleaned = false;
    await expect(withQualificationFailureReport({ output: f.output, component: "wrapper", cleanupKind: "authHome", cleanup: () => { cleaned = true; } }, () => { throw new Error("not reached"); })).rejects.toThrow();
    expect(cleaned).toBe(true);
  });
  it("bounds a TERM-ignoring offline driver timeout and records it before raw cleanup", async () => {
    const f = fixture(); fs.mkdirSync(f.raw, { mode: 0o700 });
    await expect(withQualificationFailureReport({ output: f.output, component: "wrapper", cleanupKind: "authHome", cleanup: () => {
      expect(JSON.parse(fs.readFileSync(f.output, "utf8"))).toMatchObject({ phase: "driver-start", reason: "timeout" }); fs.rmSync(f.raw, { recursive: true });
    } }, async record => {
      record.phase("driver-start");
      await runBoundedQualificationProcess(process.execPath, ["-e", 'process.on("SIGTERM",()=>{});process.stdout.write("secret transcript");setInterval(()=>{},1000)'], { env: { PATH: "/usr/bin:/bin" }, timeoutMs: 150, graceMs: 50, onFailure: error => { record.failure(error); expect(fs.existsSync(f.raw)).toBe(true); } });
    })).rejects.toMatchObject({ code: "ETIMEDOUT" });
    expect(fs.readFileSync(f.output, "utf8")).not.toContain("secret"); expect(fs.existsSync(f.raw)).toBe(false);
  });
  it("records real wrapper early preflight failure with no auth flow or real-home access", () => {
    const f = fixture();
    const result = spawnSync(process.execPath, ["scripts/certify-kiro-agent-real.mjs", "--commit", "wrong-commit", "--output", path.join(f.root, "qualification.json"), "--failure-output", f.output, "--work-root", f.raw], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: f.root, KIRO_HOME: path.join(f.root, ".kiro") }, timeout: 10000 });
    expect(result.status).toBe(1); expect(result.stdout).toBe(""); expect(result.stderr).toContain("Raw output suppressed");
    expect(JSON.parse(fs.readFileSync(f.output, "utf8"))).toMatchObject({ component: "wrapper", phase: "preflight", qualifying: false, reason: "error" }); expect(fs.existsSync(f.raw)).toBe(false);
  });
  it("records driver authentication-flag rejection before inspecting or launching a client", async () => {
    const f = fixture();
    await expect(runRealKiroAgentDriver({ authMode: "invalid-offline-mode", failureOutput: f.output, isolatedHome: f.raw })).rejects.toThrow(/auth-mode/);
    expect(JSON.parse(fs.readFileSync(f.output, "utf8"))).toMatchObject({ component: "driver", phase: "preflight", qualifying: false, cleanup: { processes: "complete" } }); expect(fs.existsSync(f.raw)).toBe(false);
  });
  it.skipIf(process.platform === "win32")("replaces a writerless FIFO without blocking diagnostic cleanup", () => {
    const f = fixture();
    const made = spawnSync("mkfifo", [f.output], { encoding: "utf8", timeout: 2000 });
    expect(made.status).toBe(0);
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { finalizeQualificationDiagnostic } from './scripts/qualification-failure.mjs';
      finalizeQualificationDiagnostic(process.argv[1], 'removed');
    `, f.output], { encoding: "utf8", timeout: 2000, killSignal: "SIGKILL" });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(fs.lstatSync(f.output).isFile()).toBe(true);
    expect(fs.statSync(f.output).mode & 0o777).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(f.output, "utf8"))).toMatchObject({
      qualifying: false, ok: false, phase: "preflight", reason: "interrupted", cleanup: { authHome: "removed" },
    });
    expect(fs.readdirSync(f.root)).toEqual(["safe.json"]);
  });
  it.each(["symlink", "hardlink", "oversized"])("does not read unsafe %s diagnostic input or overwrite its linked target", kind => {
    const f = fixture();
    const target = path.join(f.root, "untrusted.json");
    const bytes = JSON.stringify({ component: "driver", phase: "resume", raw: "secret" }) + (kind === "oversized" ? " ".repeat(4096) : "");
    fs.writeFileSync(target, bytes);
    if (kind === "symlink") fs.symlinkSync(target, f.output);
    else if (kind === "hardlink") fs.linkSync(target, f.output);
    else fs.writeFileSync(f.output, bytes);
    expect(finalizeQualificationDiagnostic(f.output, "removed")).toMatchObject({
      component: "wrapper", phase: "preflight", qualifying: false, ok: false, cleanup: { authHome: "removed" },
    });
    expect(fs.readFileSync(target, "utf8")).toBe(bytes);
    expect(fs.lstatSync(f.output).isFile()).toBe(true);
    expect(fs.statSync(f.output).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(f.output, "utf8")).not.toContain("secret");
    expect(fs.readdirSync(f.root).sort()).toEqual(["safe.json", "untrusted.json"]);
  });
  it("reprojects CI fallback input instead of uploading arbitrary preexisting fields", () => {
    const f = fixture();
    fs.writeFileSync(f.output, JSON.stringify({ component: "driver", phase: "resume", phases: ["preflight", "secret-phase", "resume"], reason: "in-progress", raw: "secret transcript", cleanup: { processes: "pending" } }));
    const report = finalizeQualificationDiagnostic(f.output, "removed");
    expect(report).toMatchObject({ component: "driver", phase: "resume", reason: "interrupted", cleanup: { authHome: "removed", processes: "pending" }, qualifying: false });
    const text = fs.readFileSync(f.output, "utf8"); expect(text).not.toContain("secret"); expect(text).not.toContain('"raw"');
    fs.writeFileSync(f.output, "not json");
    expect(finalizeQualificationDiagnostic(f.output, "failed")).toMatchObject({ qualifying: false, phase: "preflight", cleanup: { authHome: "failed" } });
  });
  it("refuses arbitrary fields/phases, raw publication and report destinations inside auth homes", () => {
    const f = fixture(), recorder = qualificationFailureRecorder(f.output, "driver");
    expect(() => recorder.phase("secret-token")).toThrow(); expect(() => recorder.cleanup("stdout", "secret")).toThrow();
    expect(() => assertSafeQualificationPublication({ ok: true, transcript: [{ raw: "secret" }] })).toThrow(/BLOCKED/);
    expect(() => assertExternalDiagnosticPath(path.join(f.raw, "report.json"), [f.raw])).toThrow(/outside/);
    expect(() => assertExternalDiagnosticPath(f.output, [f.raw])).not.toThrow();
  });
});
