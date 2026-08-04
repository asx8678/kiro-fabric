import { spawn } from "node:child_process";

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export async function command(
  argv: string[],
  cwd: string,
  timeoutMs = 30000,
  env?: NodeJS.ProcessEnv,
  maxChars = 100_000,
  stdin?: string | Buffer,
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const add = (which: "stdout" | "stderr", chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      const current = which === "stdout" ? stdout : stderr;
      const left = Math.max(0, maxChars - current.length);
      if (which === "stdout") {
        stdout += text.slice(0, left);
        stdoutTruncated ||= text.length > left;
      } else {
        stderr += text.slice(0, left);
        stderrTruncated ||= text.length > left;
      }
    };
    if (stdin !== undefined) child.stdin!.end(stdin);
    child.stdout!.on("data", (chunk: Buffer) => add("stdout", chunk));
    child.stderr!.on("data", (chunk: Buffer) => add("stderr", chunk));
    const kill = (): void => {
      try {
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // The process may already have exited.
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, stdoutTruncated, stderrTruncated });
    });
  });
}
