import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { spawnAcpProcess } from "../src/kiro/acp-process.js";
import { spawnJsonRpcProcess } from "../src/kiro/supervisor.js";

const roots: string[] = [];
const waitFor = async (predicate: () => boolean, timeoutMs = 3_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for child process state");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

afterEach(() => {
  delete process.env.KIRO_FABRIC_TEST_PS_FAILURE;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const invalidJsonRpcChild = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-invalid-rpc-"));
  roots.push(root);
  const script = path.join(root, "child.mjs");
  fs.writeFileSync(script, [
    'import readline from "node:readline";',
    'const input = readline.createInterface({ input: process.stdin });',
    'input.on("line", (line) => {',
    '  const request = JSON.parse(line);',
    '  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id }) + "\\n");',
    '});',
  ].join("\n"));
  return script;
};

const stderrExitChild = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-stderr-rpc-"));
  roots.push(root);
  const script = path.join(root, "child.mjs");
  fs.writeFileSync(script, [
    'process.stderr.write("specific probe startup failure\\n");',
    'process.stdin.resume();',
    'setTimeout(() => process.exit(9), 20);',
  ].join("\n"));
  return script;
};

const malformedChild = (stubborn = false, detachedDescendant = true) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-protocol-child-"));
  roots.push(root);
  const pidFile = path.join(root, "pids.json");
  const script = path.join(root, "child.mjs");
  fs.writeFileSync(script, [
    'import fs from "node:fs";',
    'import { spawn } from "node:child_process";',
    `const pidFile = ${JSON.stringify(pidFile)};`,
    `const descendant = spawn(process.execPath, ["-e", ${JSON.stringify(stubborn ? "process.on('SIGTERM', () => {}); setInterval(() => {}, 1e6)" : "setInterval(() => {}, 1e6)")}], { detached: ${JSON.stringify(detachedDescendant)}, stdio: "ignore" });`,
    'descendant.unref();',
    'fs.writeFileSync(pidFile, JSON.stringify({ child: process.pid, descendant: descendant.pid }));',
    ...(stubborn ? ['process.on("SIGTERM", () => {});'] : []),
    'process.stdin.once("data", () => process.stdout.write("{malformed\\n"));',
    'setInterval(() => {}, 1e6);',
  ].join("\n"));
  return { script, pidFile };
};

describe("Kiro process lifecycle", () => {
  it("surfaces a missing ACP binary as a controlled error, never an uncaught ENOENT", async () => {
    const missing = path.join(os.tmpdir(), `kiro-fabric-missing-${process.pid}-does-not-exist`);
    expect(() => spawnAcpProcess({ argv: [missing] })).toThrow(/failed to spawn/);
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it("surfaces a missing supervisor probe binary as a controlled error", async () => {
    const missing = path.join(os.tmpdir(), `kiro-fabric-missing-probe-${process.pid}-does-not-exist`);
    expect(() => spawnJsonRpcProcess({ argv: [missing], timeoutMs: 5_000 })).toThrow(/failed to spawn/);
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it("rejects ACP RPC immediately on a fatal frame and terminates descendants", async () => {
    const fixture = malformedChild();
    const processHandle = spawnAcpProcess({ argv: [fixture.script], timeoutMs: 10_000 });
    await waitFor(() => fs.existsSync(fixture.pidFile));
    const pids = JSON.parse(fs.readFileSync(fixture.pidFile, "utf8")) as {
      child: number;
      descendant: number;
    };
    const started = Date.now();
    await expect(processHandle.call("session/test", {})).rejects.toThrow(/malformed JSON frame/);
    expect(Date.now() - started).toBeLessThan(1_000);
    await processHandle.terminate(200, 1_000);
    await waitFor(() => !alive(pids.child) && !alive(pids.descendant));
  });

  it("escalates to a real SIGKILL for a stubborn detached process tree", async () => {
    const fixture = malformedChild(true);
    const processHandle = spawnAcpProcess({ argv: [fixture.script], timeoutMs: 10_000 });
    await waitFor(() => fs.existsSync(fixture.pidFile));
    const pids = JSON.parse(fs.readFileSync(fixture.pidFile, "utf8")) as {
      child: number;
      descendant: number;
    };
    const result = await processHandle.terminate(100, 1_000);
    expect(result.escalated).toBe(true);
    await waitFor(() => !alive(pids.child) && !alive(pids.descendant));
  });

  it.skipIf(process.platform === "win32")(
    "falls back to detached process-group signalling when ps fails",
    async () => {
      const fixture = malformedChild(true, false);
      const processHandle = spawnAcpProcess({ argv: [fixture.script], timeoutMs: 10_000 });
      await waitFor(() => fs.existsSync(fixture.pidFile));
      const pids = JSON.parse(fs.readFileSync(fixture.pidFile, "utf8")) as {
        child: number;
        descendant: number;
      };
      process.env.KIRO_FABRIC_TEST_PS_FAILURE = "1";
      const result = await processHandle.terminate(100, 1_000);
      expect(result.escalated).toBe(true);
      await waitFor(() => !alive(pids.child) && !alive(pids.descendant));
    },
  );

  it("rejects the same incomplete JSON-RPC response in production and doctor clients", async () => {
    const script = invalidJsonRpcChild();
    const production = spawnAcpProcess({ argv: [script], timeoutMs: 5_000 });
    try {
      await expect(production.call("test", {})).rejects.toThrow("must include exactly one");
    } finally {
      await production.terminate(100, 500);
    }

    const doctor = spawnJsonRpcProcess({
      argv: [process.execPath, script],
      timeoutMs: 5_000,
    });
    try {
      await expect(doctor.call("test", {})).rejects.toThrow("must include exactly one");
    } finally {
      await doctor.terminate(100, 500);
    }
  });

  it("includes bounded stderr diagnostics when a supervisor child exits pending", async () => {
    const processHandle = spawnJsonRpcProcess({
      argv: [stderrExitChild()],
      timeoutMs: 5_000,
    });
    try {
      await expect(processHandle.call("probe/test", {})).rejects.toThrow(
        /specific probe startup failure/,
      );
    } finally {
      await processHandle.terminate(100, 500);
    }
  });

  it("treats a malformed probe frame as fatal instead of waiting for timeout", async () => {
    const fixture = malformedChild();
    const processHandle = spawnJsonRpcProcess({
      argv: [process.execPath, fixture.script],
      timeoutMs: 10_000,
    });
    await waitFor(() => fs.existsSync(fixture.pidFile));
    const pids = JSON.parse(fs.readFileSync(fixture.pidFile, "utf8")) as {
      child: number;
      descendant: number;
    };
    const started = Date.now();
    await expect(processHandle.call("probe/test", {})).rejects.toThrow(/malformed JSON frame/);
    expect(Date.now() - started).toBeLessThan(1_000);
    await processHandle.terminate(200, 1_000);
    await waitFor(() => !alive(pids.child) && !alive(pids.descendant));
  });
});
