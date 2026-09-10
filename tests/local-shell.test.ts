import { afterEach, describe, expect, it, vi } from "vitest";
import childProcess, { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runLocalShell } from "../src/providers/local-shell.js";
import * as processGroup from "../src/providers/local-process-group.js";
import { FabricDeadline } from "../src/runtime/deadline.js";

const roots: string[] = [];
const controllers: AbortController[] = [];
const pending: Promise<unknown>[] = [];
afterEach(async () => {
  controllers.splice(0).forEach((c) => c.abort());
  await Promise.allSettled(pending.splice(0));
  // Fixture leaders record the group ID before creating children. Even failed
  // assertions terminate the whole fixture group before deleting its files.
  for (const root of roots.splice(0)) {
    try { process.kill(-Number(await readFile(join(root, "group"), "utf8")), "SIGKILL"); } catch {}
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "fabric-shell-")); roots.push(cwd);
  const controller = new AbortController(); controllers.push(controller);
  return { cwd, controller };
}
function run(options: Parameters<typeof runLocalShell>[0]) {
  const task = runLocalShell(options); pending.push(task); void task.catch(() => {}); return task;
}
async function recorded(cwd: string, name: string) {
  for (let i = 0; i < 200; i++) {
    try { const value = Number(await readFile(join(cwd, name), "utf8")); if (value > 0) return value; } catch {}
    await delay(10);
  }
  throw new Error("Fixture did not start");
}
async function live(pid: number) {
  if (process.platform === "linux") {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      return !["Z", "X"].includes(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0]!);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  }
  try {
    const state = execFileSync("/bin/ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8", timeout: 1000 }).trim();
    return state.length > 0 && !state.startsWith("Z");
  } catch (error) {
    if ((error as { status?: number }).status === 1) return false;
    throw error;
  }
}

describe.skipIf(process.platform !== "linux" && process.platform !== "darwin")("local host shell", () => {
  it("captures both streams and ordinary exit status", async () => {
    const { cwd } = await fixture();
    expect(await run({ command: "printf hello; printf error >&2", cwd })).toEqual({ ok: true, exitCode: 0, signal: null, stdout: "hello", stderr: "error", truncated: false, stdoutTruncated: false, stderrTruncated: false });
    expect(await run({ command: "printf no; exit 7", cwd, settle: true })).toMatchObject({ ok: false, exitCode: 7, stdout: "no" });
    await expect(run({ command: "printf no; exit 7", cwd })).rejects.toMatchObject({ message: "Local shell exited with code 7", result: { exitCode: 7, stdout: "no" } });
  });
  it("drains noisy escaped output within the serialized budget", async () => {
    const { cwd } = await fixture();
    const result = await run({ command: "head -c 100000 /dev/zero; head -c 100000 /dev/zero >&2", cwd, maxOutputChars: 1024 });
    expect(result).toMatchObject({ ok: true, truncated: true, stdoutTruncated: true, stderrTruncated: true });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(1024);
    expect(JSON.stringify(await run({ command: "printf x", cwd, maxOutputChars: 256 })).length).toBeLessThanOrEqual(256);
  });
  it("captures asynchronous child-runtime stdout/stderr and exit status in both input forms", async () => {
    const { cwd } = await fixture();
    const script = 'console.log("node stdout"); console.error("node stderr"); process.exitCode = 9;';
    const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
    for (const input of [
      { command: `${quote(process.execPath)} -e ${quote(script)}` },
      { script: '"$1" -e "$2"', interpreter: "bash" as const, args: [process.execPath, script] },
    ]) {
      expect(await run({ ...input, cwd, settle: true })).toMatchObject({ ok: false, exitCode: 9, stdout: "node stdout\n", stderr: "node stderr\n", truncated: false });
    }
  });
  it("rejects invalid bounds and spawn failures without command/cwd evidence", async () => {
    const { cwd } = await fixture();
    for (const timeoutMs of [0, 900001, NaN, 1.5]) await expect(run({ command: "true", cwd, timeoutMs })).rejects.toThrow("timeoutMs");
    await expect(run({ command: "SECRET_COMMAND", cwd: join(cwd, "SECRET_CWD"), settle: true })).rejects.toThrow(/^Local shell spawn failed$/);
    await expect(run({ command: "true", cwd, maxOutputChars: 255 })).rejects.toThrow("maxOutputChars");
  });
  it("does not inherit credential or shell injection variables", async () => {
    const { cwd } = await fixture();
    const key = "FABRIC_SHELL_TEST_SECRET";
    const old = process.env[key]; process.env[key] = "secret-value";
    try { expect((await run({ command: `printf '%s' "$${key}"`, cwd })).stdout).toBe(""); }
    finally { if (old === undefined) delete process.env[key]; else process.env[key] = old; }
  });
  for (const mode of ["cancel", "close", "timeout", "deadline", "leader-exit"] as const) {
    it(`cleans child/grandchild on ${mode}`, async () => {
      const { cwd, controller } = await fixture();
      const command = `echo $$ > group; sh -c 'echo $$ > child; sleep 60 & echo $! > grandchild; wait' & ${mode === "leader-exit" ? "sleep 0.1; exit 0" : "wait"}`;
      const task = run({ command, cwd, signal: controller.signal, timeoutMs: mode === "timeout" ? 300 : 5000, ...(mode === "deadline" ? { deadline: new FabricDeadline(300, 300) } : {}) });
      const child = await recorded(cwd, "child"); const grandchild = await recorded(cwd, "grandchild");
      if (mode === "cancel" || mode === "close") controller.abort(new Error("SECRET_REASON"));
      if (mode === "leader-exit") expect((await task).ok).toBe(true);
      else await expect(task).rejects.toThrow(/cancelled|timed out/);
      expect(await live(child)).toBe(false); expect(await live(grandchild)).toBe(false);
      expect(await live(await recorded(cwd, "group"))).toBe(false);
    });
  }
  it("escalates TERM-resistant descendants and rejects signal exit even with settle", async () => {
    const { cwd } = await fixture();
    const task = run({ command: "echo $$ > group; sh -c 'trap \"\" TERM; echo $$ > child; while :; do :; done' & wait", cwd, timeoutMs: 200, settle: true });
    const child = await recorded(cwd, "child");
    await expect(task).rejects.toThrow("timed out"); expect(await live(child)).toBe(false);
    await expect(run({ command: "kill -TERM $$", cwd, settle: true })).rejects.toThrow("abnormally");
  });
  it.runIf(process.platform === "darwin").each(["live group", "unavailable process evidence"])("fails closed on EPERM with %s", async (mode) => {
    const { cwd } = await fixture();
    const kill = process.kill;
    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid < 0) throw Object.assign(new Error("permission denied"), { code: "EPERM" });
      return kill(pid, signal);
    });
    if (mode === "unavailable process evidence") {
      vi.spyOn(childProcess, "execFile").mockImplementation(() => { throw new Error("SECRET_PROBE_FAILURE"); });
    }
    try {
      await expect(run({ command: "echo $$ > group; sleep 60 & sleep 0.1", cwd })).rejects.toThrow(/^Local shell cleanup uncertain$/);
    } finally { vi.restoreAllMocks(); }
  });
  it("still sends SIGKILL when TERM process inspection fails", async () => {
    const { cwd } = await fixture();
    const kill = vi.spyOn(process, "kill");
    vi.spyOn(processGroup, "localProcessGroupAlive").mockRejectedValue(new Error("unreadable evidence"));
    try {
      const task = run({ command: "echo $$ > group; sh -c 'trap \"\" TERM; echo $$ > child; while :; do :; done' & sleep 0.1; exit 0", cwd });
      const child = await recorded(cwd, "child"), group = await recorded(cwd, "group");
      await expect(task).rejects.toThrow(/^Local shell cleanup uncertain$/);
      expect(kill.mock.calls).toContainEqual([-group, "SIGKILL"]);
      for (let i = 0; i < 100 && await live(child); i++) await delay(10);
      expect(await live(child)).toBe(false);
    } finally { vi.restoreAllMocks(); }
  });
  it("pre-abort and pre-expired deadline execute nothing", async () => {
    const { cwd, controller } = await fixture(); controller.abort("SECRET_REASON");
    await expect(run({ command: "touch marker", cwd, signal: controller.signal })).rejects.toThrow(/^Local shell cancelled or deadline expired$/);
    const deadline = new FabricDeadline(1, 1, () => 0);
    Object.defineProperty(deadline, "now", { value: () => 2 });
    await expect(run({ command: "touch marker", cwd, deadline })).rejects.toThrow("deadline expired");
    await expect(readFile(join(cwd, "marker"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
