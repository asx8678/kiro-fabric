import childProcess, { type SpawnSyncReturns } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runInstallerProbe } from "../scripts/installer-probe.mjs";

const result = (kind: string): SpawnSyncReturns<string> => ({
  pid: 0, output: [], stdout: "fixture output", stderr: "", status: kind === "success" ? 0 : kind === "exit" ? 7 : null,
  signal: kind === "signal" ? "SIGTERM" : null,
  ...(["success", "exit", "signal"].includes(kind) ? {} : { error: Object.assign(new Error("fixture error"), { code: kind }) }),
});
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); });

describe("read-only installer probe retry", () => {
  it.each([
    ["success", "success", 1], ["exit", "success", 1], ["signal", "success", 1],
    ["ENOENT", "success", 1], ["EACCES", "success", 1], ["ENOBUFS", "success", 1],
    ["ETIMEDOUT", "success", 2], ["ETIMEDOUT", "ETIMEDOUT", 2],
    ["ETIMEDOUT", "exit", 2], ["ETIMEDOUT", "ENOENT", 2],
  ] as const)("handles %s then %s with %i attempts", (firstKind, secondKind, attempts) => {
    const first = result(firstKind), second = result(secondKind);
    const spawn = vi.spyOn(childProcess, "spawnSync").mockReturnValueOnce(first).mockReturnValue(second);
    syncBuiltinESMExports();
    const args = ["--version"], options = { timeout: 5000, maxBuffer: 4096, encoding: "utf8" as const, cwd: "/private", env: { PATH: "/usr/bin:/bin" } };
    expect(runInstallerProbe("/trusted/tool", args, options)).toBe(attempts === 1 ? first : second);
    expect(spawn).toHaveBeenCalledTimes(attempts);
    for (const call of spawn.mock.calls) expect(call).toEqual(["/trusted/tool", args, options]);
  });
});
