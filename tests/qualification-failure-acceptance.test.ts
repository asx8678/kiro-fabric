import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { assertExternalDiagnosticPath, assertSafeQualificationPublication, runBoundedQualificationProcess, withQualificationFailureReport } from "../scripts/qualification-failure.mjs";

// The public contract is now:
//   * withQualificationFailureReport(...) for in-process wrapper/driver seams, and
//   * `node scripts/qualification-failure.mjs initialize|finalize <output> [rawRoot]`
//     for the CI always-run finalization. The historical in-process
//     `finalizeQualificationDiagnostic` reprojection wrapper is intentionally gone
//     and must not be revived: it accepted a caller-supplied "removed" disposition
//     and rewrote the untrusted original in place. The CLI instead reads a strictly
//     bounded diagnostic and writes a SEPARATE sanitized copy, never the original.
const roots: string[] = [];
const fixture = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "qualification-fault-")));
  roots.push(root);
  return {
    root,
    output: path.join(root, "safe.json"),
    raw: path.join(root, "auth-home"),
    run: (args: string[]) => spawnSync(process.execPath, ["scripts/qualification-failure.mjs", ...args], { encoding: "utf8", timeout: 10_000 }),
  };
};
const sanitized = (output: string) => `${output}.sanitized.json`;
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });

describe("offline nonqualifying failure evidence", () => {
  it.each(["preflight", "archive-installation", "publication"])("retains only bounded phase metadata BEFORE cleanup at %s", async phase => {
    const f = fixture(); fs.mkdirSync(f.raw, { mode: 0o700 });
    const secret = "AUTH_TOKEN_and_raw_transcript_" + "s".repeat(10000); fs.writeFileSync(path.join(f.raw, "token"), secret);
    await expect(withQualificationFailureReport({ output: f.output, component: "wrapper", cleanupKind: "authHome", cleanup: () => {
      const before = JSON.parse(fs.readFileSync(f.output, "utf8"));
      expect(before).toMatchObject({ phase, reason: "error", qualifying: false, cleanup: { authHome: "pending" } });
      expect(fs.existsSync(f.raw)).toBe(true); removeFixtureSync(f.raw, { recursive: true }); return "removed";
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
    await expect(withQualificationFailureReport({ output: f.output, component: "wrapper", cleanupKind: "authHome", cleanup: () => { cleaned = true; return "not-created"; } }, () => { throw new Error("not reached"); })).rejects.toThrow();
    expect(cleaned).toBe(true);
  });
  it("bounds a TERM-ignoring offline driver timeout and records it before raw cleanup", async () => {
    const f = fixture(); fs.mkdirSync(f.raw, { mode: 0o700 });
    await expect(withQualificationFailureReport({ output: f.output, component: "wrapper", cleanupKind: "authHome", cleanup: () => {
      expect(JSON.parse(fs.readFileSync(f.output, "utf8"))).toMatchObject({ phase: "driver-start", reason: "timeout" }); removeFixtureSync(f.raw, { recursive: true }); return "removed";
    } }, async record => {
      record.phase("driver-start");
      await runBoundedQualificationProcess(process.execPath, ["-e", 'process.on("SIGTERM",()=>{});process.stdout.write("secret transcript");setInterval(()=>{},1000)'], { env: { PATH: "/usr/bin:/bin" }, timeoutMs: 150, graceMs: 50, onFailure: error => { record.failure(error); expect(fs.existsSync(f.raw)).toBe(true); } });
    })).rejects.toMatchObject({ code: "ETIMEDOUT" });
    expect(fs.readFileSync(f.output, "utf8")).not.toContain("secret"); expect(fs.existsSync(f.raw)).toBe(false);
  });

  it.each([
    ["not-created", "completed", false],
    ["removed", "completed", false],
    ["retained", "retained-state", true],
    ["unverified", "error", true],
    ["failed", "error", true],
  ] as const)("records authHome cleanup state %s as %s with the report pending before cleanup", async (outcome, reason, rejects) => {
    const f = fixture();
    const pendingSeen: string[] = [];
    const pending = withQualificationFailureReport({ output: f.output, component: "wrapper", cleanupKind: "authHome", cleanup: () => {
      pendingSeen.push(JSON.parse(fs.readFileSync(f.output, "utf8")).cleanup.authHome);
      return outcome;
    } }, record => { record.phase("archive-installation"); });
    if (rejects) await expect(pending).rejects.toThrow(); else await expect(pending).resolves.toBeUndefined();
    expect(pendingSeen).toEqual(["pending"]);
    expect(JSON.parse(fs.readFileSync(f.output, "utf8"))).toMatchObject({ cleanup: { authHome: outcome }, reason });
  });

  it.each([
    ["complete", "completed", false],
    ["unverified", "error", true],
    ["failed", "error", true],
  ] as const)("records processes cleanup outcome %s as %s", async (outcome, reason, rejects) => {
    const f = fixture();
    const pending = withQualificationFailureReport({ output: f.output, component: "wrapper", cleanupKind: "processes", cleanup: () => outcome }, record => { record.phase("driver-start"); });
    if (rejects) await expect(pending).rejects.toThrow(); else await expect(pending).resolves.toBeUndefined();
    expect(JSON.parse(fs.readFileSync(f.output, "utf8"))).toMatchObject({ cleanup: { processes: outcome }, reason });
  });

  it("records real wrapper early preflight failure with no auth flow or real-home access", () => {
    const f = fixture();
    const result = spawnSync(process.execPath, ["scripts/certify-kiro-agent-real.mjs", "--commit", "wrong-commit", "--output", path.join(f.root, "qualification.json"), "--failure-output", f.output, "--work-root", f.raw], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: f.root, KIRO_HOME: path.join(f.root, ".kiro") }, timeout: 10000 });
    expect(result.status).toBe(1); expect(result.stdout).toBe(""); expect(result.stderr).toContain("Raw output suppressed");
    expect(JSON.parse(fs.readFileSync(f.output, "utf8"))).toMatchObject({ component: "wrapper", phase: "preflight", qualifying: false, reason: "error" }); expect(fs.existsSync(f.raw)).toBe(false);
  });
  it("records driver authentication-flag rejection before inspecting or launching a client", () => {
    const f = fixture();
    // Sterile child only: the offline audit of run-kiro-agent-real-driver.mjs proves
    // `resolveRealClientAuthFlags` throws at phase "preflight" BEFORE `resolveKiroCli`,
    // any `assertPrivateDirectory` home access, or any authentication step. Passing
    // non-existent paths therefore cannot create, read, or launch anything.
    const result = spawnSync(process.execPath, ["scripts/run-kiro-agent-real-driver.mjs",
      "--output", path.join(f.root, "evidence.json"),
      "--workspace", f.raw, "--kiro-home", f.raw, "--home", f.raw, "--install-cwd", f.raw,
      "--auth-mode", "invalid-offline-mode", "--failure-output", f.output,
    ], { encoding: "utf8", timeout: 10_000, env: { PATH: process.env.PATH, HOME: f.root } });
    expect(result.status).toBe(1); expect(result.stdout).toBe(""); expect(result.stderr).toContain("Raw output suppressed");
    expect(JSON.parse(fs.readFileSync(f.output, "utf8"))).toMatchObject({ component: "driver", phase: "preflight", qualifying: false, reason: "error", cleanup: { processes: "complete" } });
    expect(fs.existsSync(f.raw)).toBe(false); expect(fs.existsSync(path.join(f.root, "evidence.json"))).toBe(false);
  });

  it("finalizes a valid completed no-state receipt and fails closed on the same receipt with retained private state", async () => {
    const f = fixture();
    await withQualificationFailureReport({ output: f.output, component: "wrapper", cleanupKind: "authHome", cleanup: () => "not-created" }, record => { record.phase("publication"); });
    const positive = f.run(["finalize", f.output, f.raw]);
    expect(positive.status, positive.stderr).toBe(0);
    const clean = JSON.parse(fs.readFileSync(sanitized(f.output), "utf8"));
    expect(clean).toMatchObject({ kind: "kiro-fabric.qualification-diagnostic", qualifying: false, ok: false, reason: "completed", cleanup: { authHome: "not-created" } });
    expect(fs.statSync(sanitized(f.output)).mode & 0o777).toBe(0o600);
    // The untrusted original is never rewritten; only the separate copy is emitted.
    expect(fs.statSync(f.output).mode & 0o777).toBe(0o600);
    // Same receipt, retained raw state: fail closed with no raw disclosure.
    fs.mkdirSync(f.raw, { mode: 0o700 }); fs.writeFileSync(path.join(f.raw, "secret-token"), "PRIVATE-RAW-STATE");
    const negative = f.run(["finalize", f.output, f.raw]);
    expect(negative.status).toBe(1); expect(negative.stderr).toContain("Qualification remains blocked");
    const retained = JSON.parse(fs.readFileSync(sanitized(f.output), "utf8"));
    expect(retained).toMatchObject({ reason: "retained-state", cleanup: { authHome: "retained" }, qualifying: false });
    expect(fs.readFileSync(path.join(f.raw, "secret-token"), "utf8")).toBe("PRIVATE-RAW-STATE");
    expect(fs.readFileSync(sanitized(f.output), "utf8")).not.toContain("PRIVATE-RAW-STATE");
  });

  it.skipIf(process.platform === "win32")("does not block on or alter a writerless FIFO original and emits only a separate sanitized copy", () => {
    const f = fixture();
    const made = spawnSync("mkfifo", [f.output], { encoding: "utf8", timeout: 2000 });
    expect(made.status).toBe(0);
    const result = f.run(["finalize", f.output, f.raw]);
    expect(result.error).toBeUndefined(); expect(result.status).toBe(1);
    expect(fs.lstatSync(f.output).isFIFO()).toBe(true);
    const copy = sanitized(f.output);
    expect(fs.lstatSync(copy).isFile()).toBe(true); expect(fs.statSync(copy).mode & 0o777).toBe(0o600);
    const bytes = fs.readFileSync(copy, "utf8"); expect(Buffer.byteLength(bytes)).toBeLessThanOrEqual(4096);
    expect(JSON.parse(bytes)).toMatchObject({ kind: "kiro-fabric.qualification-diagnostic", qualifying: false, ok: false, scope: "nonqualifying-sanitized-diagnostic-only" });
    expect(fs.readdirSync(f.root).sort()).toEqual(["safe.json", "safe.json.sanitized.json"]);
  });
  it.each(["symlink", "hardlink", "oversized"])("never reads or overwrites an unsafe %s original; the sanitized copy stays strict, private and bounded", kind => {
    const f = fixture();
    const target = path.join(f.root, "untrusted.json");
    const bytes = JSON.stringify({ component: "driver", phase: "resume", raw: "secret" }) + (kind === "oversized" ? " ".repeat(4096) : "");
    fs.writeFileSync(target, bytes);
    if (kind === "symlink") fs.symlinkSync(target, f.output);
    else if (kind === "hardlink") fs.linkSync(target, f.output);
    else fs.writeFileSync(f.output, bytes);
    const result = f.run(["finalize", f.output, f.raw]);
    expect(result.status).toBe(1);
    expect(fs.readFileSync(target, "utf8")).toBe(bytes);
    const copy = sanitized(f.output);
    expect(fs.lstatSync(copy).isFile()).toBe(true); expect(fs.statSync(copy).mode & 0o777).toBe(0o600);
    const text = fs.readFileSync(copy, "utf8"); expect(Buffer.byteLength(text)).toBeLessThanOrEqual(4096); expect(text).not.toContain("secret");
    expect(JSON.parse(text)).toMatchObject({ kind: "kiro-fabric.qualification-diagnostic", component: "wrapper", qualifying: false, ok: false, cleanup: { authHome: "unverified" } });
  });
  it("reprojects arbitrary CI fallback input instead of uploading preexisting fields", () => {
    const f = fixture();
    fs.writeFileSync(f.output, JSON.stringify({ component: "driver", phase: "resume", phases: ["preflight", "secret-phase", "resume"], reason: "in-progress", raw: "secret transcript", cleanup: { processes: "pending" } }));
    const first = f.run(["finalize", f.output, f.raw]); expect(first.status).toBe(1);
    const copy = JSON.parse(fs.readFileSync(sanitized(f.output), "utf8"));
    expect(copy).toMatchObject({ component: "wrapper", phase: "preflight", qualifying: false, reason: "error", cleanup: { processes: "unverified", authHome: "unverified" } });
    const text = fs.readFileSync(sanitized(f.output), "utf8"); expect(text).not.toContain("secret"); expect(text).not.toContain('"raw"');
    fs.writeFileSync(f.output, "not json");
    const second = f.run(["finalize", f.output, f.raw]); expect(second.status).toBe(1);
    expect(JSON.parse(fs.readFileSync(sanitized(f.output), "utf8"))).toMatchObject({ qualifying: false, phase: "preflight", cleanup: { authHome: "unverified" } });
  });
  it("refuses arbitrary fields/phases, raw publication and report destinations inside auth homes", async () => {
    const f = fixture();
    await expect(withQualificationFailureReport({ output: f.output, component: "driver", cleanupKind: "processes", cleanup: () => "complete" }, record => { record.phase("secret-token"); })).rejects.toThrow();
    await expect(withQualificationFailureReport({ output: f.output, component: "driver", cleanupKind: "authHome", cleanup: () => "removed" }, record => { record.cleanup("stdout", "secret"); })).rejects.toThrow();
    expect(() => assertSafeQualificationPublication({ ok: true, transcript: [{ raw: "secret" }] })).toThrow(/BLOCKED/);
    expect(() => assertExternalDiagnosticPath(path.join(f.raw, "report.json"), [f.raw])).toThrow(/outside/);
    expect(() => assertExternalDiagnosticPath(f.output, [f.raw])).not.toThrow();
  });
});
