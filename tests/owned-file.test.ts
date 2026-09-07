import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { initializeOwnedFile, type OwnedFile } from "../src/providers/owned-file.js";
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
it("reports close-before-close uncertainty without blindly retrying a numeric descriptor", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-owned-close-")); roots.push(root);
  const close = fs.closeSync; let fd: number | undefined;
  const spy = vi.spyOn(fs, "closeSync").mockImplementation((descriptor) => { fd = descriptor; throw new Error("injected before close"); });
  const owned: OwnedFile = { created: false };
  try {
    expect(() => initializeOwnedFile(path.join(root, "lock"), owned, () => {})).toThrow(/descriptor close uncertain/);
    expect(owned.identity).toBeDefined(); expect(spy).toHaveBeenCalledTimes(1);
    // Only the fixture knows this injected failure left fd open. Production
    // cannot infer that from a throwing close, and must not retry it.
    expect(fs.fstatSync(fd!).ino).toBe(owned.identity!.ino);
  } finally { if (fd !== undefined) close(fd); }
});
