import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import type { Dir } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { localProcessGroupAlive } from "../src/providers/local-process-group.js";

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const pid = 90000;
const stat = (entry: string, state = "Z", group = pid) => `${entry} (fixture with ) and spaces) ${state} 1 ${group} 0 0\n`;
const probe = (ms = 1000) => { syncBuiltinESMExports(); return localProcessGroupAlive(pid, performance.now() + ms); };
beforeEach(() => {
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  vi.spyOn(process, "kill").mockReturnValue(true);
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); syncBuiltinESMExports(); Object.defineProperty(process, "platform", platform); });
function proc(entries: number) {
  let closed = false;
  const directory = { async *[Symbol.asyncIterator]() { try { for (let i = 1; i <= entries; i++) yield { name: String(i) }; } finally { closed = true; } } };
  const open = vi.spyOn(fs, "opendir").mockResolvedValue(directory as unknown as Dir);
  let active = 0, peak = 0;
  const read = vi.spyOn(fs, "readFile").mockImplementation((async (file: unknown) => {
    active++; peak = Math.max(peak, active); await Promise.resolve(); active--;
    return stat(String(file).split("/")[2]!);
  }) as unknown as typeof fs.readFile);
  return { open, read, closed: () => closed, peak: () => peak };
}
it("returns immediately for an absent group without reading /proc", async () => {
  const f = proc(10); vi.mocked(process.kill).mockImplementation(() => { throw Object.assign(new Error(), { code: "ESRCH" }); });
  expect(await probe()).toBe(false); expect(f.open).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled();
});
it("uses the live leader fast path instead of scanning all processes", async () => {
  const f = proc(1024); f.read.mockResolvedValue(stat(String(pid), "S"));
  expect(await probe()).toBe(true); expect(f.read).toHaveBeenCalledTimes(1); expect(f.open).not.toHaveBeenCalled();
});
it("streams zombie-only evidence with at most eight concurrent stat reads", async () => {
  const f = proc(1024);
  expect(await probe()).toBe(false); expect(f.read).toHaveBeenCalledTimes(1025); expect(f.peak()).toBe(8); expect(f.closed()).toBe(true);
});
it("finds a live descendant, tolerates disappearing entries, and closes enumeration early", async () => {
  const f = proc(1024);
  f.read.mockImplementation((async (file: unknown) => {
    const entry = String(file).split("/")[2]!;
    if (entry === String(pid)) throw Object.assign(new Error(), { code: "ENOENT" });
    return stat(entry, entry === "3" ? "S" : "Z");
  }) as unknown as typeof fs.readFile);
  expect(await probe()).toBe(true); expect(f.read).toHaveBeenCalledTimes(9); expect(f.closed()).toBe(true);
});
it.each(["EACCES", "EPERM", "EIO"])("fails closed on unreadable evidence (%s)", async code => {
  const f = proc(10); f.read.mockRejectedValue(Object.assign(new Error("SECRET"), { code }));
  await expect(probe()).rejects.toThrow(/^Local shell cleanup uncertain$/);
});
it("rejects malformed stat evidence rather than reporting an inert group", async () => {
  const f = proc(10); f.read.mockResolvedValue("malformed");
  await expect(probe()).rejects.toThrow(/^Local shell cleanup uncertain$/);
});
it("bounds enumeration independently of elapsed wall time", async () => {
  const f = proc(32769);
  await expect(probe()).rejects.toThrow(/^Local shell cleanup uncertain$/); expect(f.closed()).toBe(true);
  expect(f.read.mock.calls.length).toBeLessThanOrEqual(32769);
});
it.each(["read", "open", "iterate"])("times out stalled %s evidence and stops scheduling work", async stage => {
  const f = proc(1024); let signal: AbortSignal | undefined;
  if (stage === "read") f.read.mockImplementation(((_file: unknown, options: { signal: AbortSignal }) => { signal = options.signal; return new Promise(() => {}); }) as unknown as typeof fs.readFile);
  if (stage === "open") f.open.mockImplementation(() => new Promise(() => {}));
  if (stage === "iterate") f.open.mockResolvedValue({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) } as unknown as Dir);
  const task = probe(40); const rejection = expect(task).rejects.toThrow(/^Local shell cleanup uncertain$/);
  await vi.advanceTimersByTimeAsync(40); await rejection;
  const reads = f.read.mock.calls.length; await vi.advanceTimersByTimeAsync(1000);
  expect(f.read).toHaveBeenCalledTimes(reads); if (signal) expect(signal.aborted).toBe(true);
});
it("caps an individual probe at 200ms even with a longer cleanup deadline", async () => {
  const f = proc(10); f.read.mockImplementation(() => new Promise(() => {}));
  const task = probe(); const rejection = expect(task).rejects.toThrow(/^Local shell cleanup uncertain$/);
  await vi.advanceTimersByTimeAsync(200); await rejection;
});
