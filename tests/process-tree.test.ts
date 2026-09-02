import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  IS_JOB_OBJECT_AVAILABLE,
  createProcessTreeController,
  descendantPids,
  killDescendantTree,
  observeProcessState,
  quoteCommandArg,
} from "../src/worker/process-tree.js";

const TEST_PLATFORM_ENV = "KIRO_FABRIC_TEST_PLATFORM";
const ALLOW_KILL_ENV = "KIRO_FABRIC_ALLOW_PROCESS_TREE_TESTS";

const withPlatform = <T>(platform: NodeJS.Platform, run: () => T): T => {
  const previous = process.env[TEST_PLATFORM_ENV];
  process.env[TEST_PLATFORM_ENV] = platform;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env[TEST_PLATFORM_ENV];
    else process.env[TEST_PLATFORM_ENV] = previous;
  }
};

const waitFor = async (
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs = 25,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, intervalMs);
      timer.unref?.();
    });
  }
  expect(predicate()).toBe(true);
};

const processIsAlive = (pid: number): boolean => observeProcessState(pid).running;

const tmpRoots: string[] = [];

afterEach(async () => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("process-tree helpers", () => {
  it("does not claim unavailable native Windows Job Object ownership", () => {
    expect(IS_JOB_OBJECT_AVAILABLE).toBe(false);
  });

  it("quotes POSIX arguments safely", () => {
    expect(withPlatform("linux", () => quoteCommandArg("plain"))).toBe("'plain'");
    expect(withPlatform("linux", () => quoteCommandArg("a b"))).toBe("'a b'");
    expect(withPlatform("linux", () => quoteCommandArg(`it's`))).toBe("'it'\"'\"'s'");
    expect(withPlatform("linux", () => quoteCommandArg(""))).toBe("''");
  });

  it("quotes Windows arguments safely", () => {
    expect(withPlatform("win32", () => quoteCommandArg("plain"))).toBe('"plain"');
    expect(withPlatform("win32", () => quoteCommandArg("a b"))).toBe('"a b"');
    expect(withPlatform("win32", () => quoteCommandArg("C:\\tmp\\"))).toBe(
      '"C:\\tmp\\\\"',
    );
    expect(withPlatform("win32", () => quoteCommandArg('say "hi"'))).toBe(
      '"say \\"hi\\""',
    );
  });

  it("reports no descendants gracefully when no process group or child listing exists", () => {
    expect(descendantPids(-1)).toEqual([]);
    expect(withPlatform("linux", () => descendantPids(999_999_999))).toEqual([]);
    expect(withPlatform("win32", () => descendantPids(999_999_999))).toEqual([999_999_999]);
  });

  it("no-ops when asked to kill a missing process group", async () => {
    await expect(killDescendantTree(999_999_999, "SIGTERM", 10)).resolves.toBeUndefined();
    await expect(
      withPlatform("win32", () => killDescendantTree(999_999_999, "SIGTERM", 10)),
    ).resolves.toBeUndefined();
  });

  it.skipIf(process.platform !== "win32" || process.env[ALLOW_KILL_ENV] !== "1")(
    "kills descendants in confined Windows mode without PATH discovery",
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-windows-tree-"));
      tmpRoots.push(root);
      const pidFile = path.join(root, "pids.json");
      const childCode = [
        "const fs = require('node:fs');",
        "const { spawn } = require('node:child_process');",
        `const pidFile = ${JSON.stringify(pidFile)};`,
        "const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { stdio: 'ignore' });",
        "fs.writeFileSync(pidFile, JSON.stringify({ root: process.pid, descendant: descendant.pid }));",
        "setInterval(() => {}, 1e6);",
      ].join(" ");
      const parent = spawn(process.execPath, ["-e", childCode], { stdio: "ignore" });
      if (!parent.pid) throw new Error("failed to spawn Windows tree root");
      const controller = createProcessTreeController(parent.pid, { ambientHelpers: false, child: parent });
      await waitFor(() => fs.existsSync(pidFile), 2_000);
      const pids = JSON.parse(fs.readFileSync(pidFile, "utf8")) as {
        root: number;
        descendant: number;
      };

      await controller.terminate(100, 1_000);
      await waitFor(() => !processIsAlive(pids.root) && !processIsAlive(pids.descendant), 2_000);
    },
  );

  it.skipIf(process.platform === "win32" || process.env[ALLOW_KILL_ENV] !== "1")(
    "kills a detached POSIX child tree within a bounded deadline",
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-process-tree-"));
      tmpRoots.push(root);
      const pidFile = path.join(root, "pids.json");
      const childCode = [
        "const fs = require('node:fs');",
        "const { spawn } = require('node:child_process');",
        `const pidFile = ${JSON.stringify(pidFile)};`,
        "const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { stdio: 'ignore' });",
        "fs.writeFileSync(pidFile, JSON.stringify({ childPid: process.pid, grandchildPid: grandchild.pid }), 'utf8');",
        "setInterval(() => {}, 1e6);",
      ].join(" ");
      const parent = spawn(process.execPath, ["-e", childCode], {
        detached: true,
        stdio: "ignore",
      });
      if (!parent.pid) throw new Error("failed to spawn parent process");
      const parentPid = parent.pid;
      parent.unref();

      await waitFor(() => fs.existsSync(pidFile), 2_000);
      const { childPid, grandchildPid } = JSON.parse(fs.readFileSync(pidFile, "utf8")) as {
        childPid: number;
        grandchildPid: number;
      };

      const members = descendantPids(parentPid);
      expect(members).toContain(parentPid);
      expect(members).toContain(childPid);
      expect(members).toContain(grandchildPid);

      await killDescendantTree(parentPid, "SIGTERM", 100);
      await waitFor(
        () => !processIsAlive(parentPid) && !processIsAlive(childPid) && !processIsAlive(grandchildPid),
        2_000,
      );
    },
  );
});
