import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { StateProvider } from "../src/providers/state-provider.js";
import * as stateDirectory from "../src/providers/state-directory.js";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it.each(["set", "delete"])("refuses an already queued %s after a sibling loses its state lock", async action => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "state-uncertainty-"));
  console.warn(`[state uncertainty fixture] retained ${root}`);
  const store = path.join(root, "state"), provider = new StateProvider(store), context = { cwd: store };
  await provider.invoke("set", { key: "queued", value: "before" }, context);
  const lock = path.join(store, ".state-mutation.lock"), stateFile = path.join(store, "state.json");
  const rename = fs.renameSync, publish = stateDirectory.publishPinnedStateFile;
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }) + "\n", { mode: 0o600, flag: "wx" });
  let lost = false;
  vi.spyOn(stateDirectory, "publishPinnedStateFile").mockImplementation((directory, name, target, expected, targetExpected, published) => publish(directory, name, target, expected, targetExpected, () => {
    published();
    if (target === path.basename(stateFile) && !lost) {
      lost = true;
      // Simulate another actor removing the held lock, retaining its bytes.
      rename(lock, path.join(root, "lost-lock"));
    }
  }));
  vi.useFakeTimers();
  const first = provider.invoke("set", { key: "first", value: 1 }, context);
  const queued = provider.invoke(action, { key: "queued", ...(action === "set" ? { value: "after" } : {}) }, context);
  const results = Promise.allSettled([first, queued]);
  expect(vi.getTimerCount()).toBe(2); // Both callers actually suspended on contention.
  rename(lock, path.join(root, "initial-lock"));
  await vi.advanceTimersByTimeAsync(10);
  const [a, b] = await results;
  assert.ok(a?.status === "rejected");
  assert.ok(b?.status === "rejected");
  expect(a.reason).toMatchObject({ name: "StateCommitAcknowledgementError", committed: true, lockCleanup: "unresolved" });
  expect(b.reason.message).toContain("uncertain state lock ownership");
  expect(lost).toBe(true);
  await expect(provider.invoke("set", { key: "later", value: 3 }, context)).rejects.toThrow("uncertain state lock ownership");
  const document = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  expect(document.revision).toBe(2);
  expect(document.entries.queued.value).toBe("before");
  expect(document.entries.first.value).toBe(1);
});
