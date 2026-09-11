import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

// Execute the actual private predicate without changing process identity, chmodding
// the running Node, requiring root, or touching any installation/home directory.
const source = fs.readFileSync(new URL("../scripts/install-agent-user.mjs", import.meta.url), "utf8");
const predicate = source.match(/^const assertTrustedExecutable = \(target\) => \{[\s\S]*?^\};/mu)?.[0];
if (!predicate) throw new Error("installer trust predicate not found");
const safe = { isFile: () => true, isSymbolicLink: () => false, uid: 1001, mode: 0o100755, nlink: 1 };
const check = (patch: Partial<typeof safe> = {}, platform = "linux", uid: number | undefined = 1001, target = "/runner/toolcache/node") => {
  const context = vm.createContext({
    fs: { lstatSync: () => ({ ...safe, ...patch }) }, path,
    // File-predicate unit isolation; real ancestry behavior has filesystem probes.
    captureDirectoryAncestry: () => undefined,
    process: { platform, getuid: uid === undefined ? undefined : () => uid },
  });
  const fn = vm.runInContext(`${predicate}\nassertTrustedExecutable`, context) as (value: string) => string;
  return fn(target);
};

describe("installer Node executable trust diagnostics", () => {
  it.each([
    [{ isFile: () => false }, "not a regular file"],
    [{ isSymbolicLink: () => true }, "symbolic link"],
    [{ nlink: 2 }, "link count must be 1"],
    [{ nlink: 0 }, "link count must be 1"],
    [{ uid: 1002 }, "owner must be current user or root"],
    [{ mode: 0o100775 }, "group-writable"],
    [{ mode: 0o100757 }, "world-writable"],
    [{ mode: 0o100644 }, "no execute bits"],
  ] as const)("rejects %j with precise reason %s on both supported platforms", (patch, reason) => {
    for (const platform of ["linux", "darwin"]) {
      expect(() => check(patch, platform)).toThrow(`unsafe Node executable: "/runner/toolcache/node"; ${reason}`);
      expect(() => check(patch, platform)).toThrow(/uid=\d+, currentUid=1001, mode=[0-7]+, nlink=\d+/u);
    }
  });

  it.each(["linux", "darwin"])("accepts legitimate current-user and root-owned CI Node on %s", platform => {
    for (const uid of [0, 1001]) {
      for (const mode of [0o100755, 0o100555, 0o100100, 0o100010, 0o100001]) {
        expect(check({ uid, mode }, platform)).toBe("/runner/toolcache/node");
      }
    }
  });

  it("preserves the missing-getuid and Windows mode exceptions, not other predicates", () => {
    // Pass undefined explicitly through a context to avoid the helper's default UID.
    const fn = vm.runInNewContext(`${predicate}\nassertTrustedExecutable`, {
      fs: { lstatSync: () => ({ ...safe, uid: 1002 }) }, path, process: { platform: "linux" }, captureDirectoryAncestry: () => undefined,
    }) as (value: string) => string;
    expect(fn("/node")).toBe("/node");
    expect(check({ mode: 0o100666 }, "win32")).toBe("/runner/toolcache/node");
    expect(() => check({ uid: 1002 }, "win32")).toThrow("owner must be current user or root");
    expect(() => check({ nlink: 2 }, "win32")).toThrow("link count must be 1");
  });

  it("reports all failing predicates with bounded single-line escaped path diagnostics", () => {
    let message = "";
    try {
      check({ isFile: () => false, isSymbolicLink: () => true, nlink: 2, uid: 1002, mode: 0o666 }, "linux", 1001, `/node\n\u001b\"${"x".repeat(10_000)}`);
    } catch (error) { message = (error as Error).message; }
    for (const reason of ["not a regular file", "symbolic link", "link count must be 1", "owner must be current user or root", "group-writable", "world-writable", "no execute bits"]) expect(message).toContain(reason);
    expect(message.length).toBeLessThan(1024);
    expect(message).not.toMatch(/[\n\r\u001b]/u);
    expect(message).toContain("…");
    expect(message).toContain("uid=1002, currentUid=1001, mode=666, nlink=2");
  });

  it("keeps realpath resolution at the installer call site", () => {
    expect(source).toContain("assertTrustedExecutable(fs.realpathSync(process.execPath))");
  });
});
