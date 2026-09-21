import { removeFixture as rm, removeFixtureSync } from "../fixture-cleanup.mjs";
import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { open, opendir, type FileHandle } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { SourceAccess, type SourceSnapshot } from "../../src/fovea/source-access.js";
import { sourcePlatform, type SourceHandle, type SourcePlatform, type SourceStat } from "../../src/fovea/source-platform.js";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const sha = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");

/** Portable test-only platform seam: handles carry their path and reads go
 * through a real descriptor, with the same no-symlink and directory-kind
 * refusals as the production adapters. It exists to exercise the capture's
 * streaming and retention logic on every platform; the descriptor-relative
 * production adapters keep their own Linux/Darwin contract suites. */
interface FakeHooks { onFileRead?: (absolutePath: string) => void }
const fakePlatform = (hooks: FakeHooks = {}): SourcePlatform => {
  const openAt = async (path: string, kind: "root" | "directory" | "entry"): Promise<SourceHandle & { path: string }> => {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) { const error = new Error(`ELOOP: ${path}`) as NodeJS.ErrnoException; error.code = "ELOOP"; throw error; }
    if (kind === "directory" && !stats.isDirectory()) { const error = new Error(`ENOTDIR: ${path}`) as NodeJS.ErrnoException; error.code = "ENOTDIR"; throw error; }
    if (!stats.isDirectory() && !stats.isFile()) { const error = new Error(`ENOTSUP: ${path}`) as NodeJS.ErrnoException; error.code = "ENOTSUP"; throw error; }
    let file: FileHandle | undefined;
    let readStarted = false;
    const handle: SourceHandle & { path: string } = {
      path,
      stat: async (): Promise<SourceStat> => await lstat(path),
      read: async (buffer: Buffer, offset: number, length: number, _position: null) => {
        if (!readStarted) { readStarted = true; hooks.onFileRead?.(path); }
        file ??= await open(path, "r");
        return await file.read(buffer, offset, length, null);
      },
      close: async () => { if (file) { await file.close(); file = undefined; } },
    };
    return handle;
  };
  const pathOf = (handle: SourceHandle): string => (handle as SourceHandle & { path: string }).path;
  return {
    async openRootDirectory() { return await openAt("/", "root"); },
    async openChild(directory, name, kind) { return await openAt(join(pathOf(directory), name), kind); },
    async *entries(directory) {
      const stream = await opendir(pathOf(directory), { bufferSize: 128 });
      for await (const entry of stream) yield entry.name;
    },
  };
};

async function fixture(prefix: string): Promise<{ base: string; root: string; destination: string }> {
  const base = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  dirs.push(base);
  const root = join(base, "source"), destination = join(base, "snapshot");
  await mkdir(root, { mode: 0o700 }); await mkdir(destination, { mode: 0o700 });
  return { base, root, destination };
}
const write = async (root: string, rel: string, data: string | Buffer): Promise<void> => {
  const target = join(root, rel);
  if (dirname(target) !== root) await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, data);
};
const capture = (root: string, destination: string, previous?: SourceSnapshot, signal?: AbortSignal, hooks?: FakeHooks): Promise<SourceSnapshot> =>
  new SourceAccess(fakePlatform(hooks)).captureSourceSnapshot(root, destination, signal,
    previous ? { previous: { id: previous.id, root: previous.root, hashes: previous.hashes } } : {});

describe("bounded streaming source capture", () => {
  it("stages each admitted file before the next is read and preserves modes", async () => {
    const { root, destination, base } = await fixture("fovea-retention-cold-");
    await write(root, "a.ts", "export const a = 1;");
    await write(root, "nested/b.ts", "export const b = 2;");
    await write(root, "nested/c.ts", "export const c = 3;");
    await write(root, "d.ts", "export const d = 4;");
    await symlink(join(base, "outside-target"), join(root, "escape.ts"));
    const readOrder: string[] = [];
    const snapshot = await capture(root, destination, undefined, undefined, {
      onFileRead: absolute => {
        const rel = relative(root, absolute);
        // Streaming contract: every previously admitted file is already staged
        // before the next live file is read; buffering the whole tree would
        // leave the destination empty mid-walk.
        for (const prior of readOrder) if (!existsSync(join(destination, prior))) throw new Error(`previous file not staged yet: ${prior}`);
        readOrder.push(rel);
      },
    });
    expect(readOrder).toEqual(["a.ts", "d.ts", "nested/b.ts", "nested/c.ts"]);
    expect([...snapshot.hashes.entries()]).toEqual([
      ["a.ts", sha("export const a = 1;")],
      ["d.ts", sha("export const d = 4;")],
      ["nested/b.ts", sha("export const b = 2;")],
      ["nested/c.ts", sha("export const c = 3;")],
    ]);
    expect(snapshot.root).toBe(destination);
    expect(await readFile(join(destination, "nested", "b.ts"), "utf8")).toBe("export const b = 2;");
    expect((await stat(join(destination, "nested"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(destination, "nested", "b.ts"))).mode & 0o777).toBe(0o400);
    expect(snapshot.coverage.counts).toMatchObject({ unavailableOrSymlink: 1 });
  });

  it("reuses a matching previous snapshot without writing a second copy", async () => {
    const { root, base } = await fixture("fovea-retention-reuse-");
    await write(root, "a.ts", "export const a = 1;");
    const first = await capture(root, join(base, "snapshot-1"));
    const secondDestination = join(base, "snapshot-2");
    await mkdir(secondDestination, { mode: 0o700 });
    const second = await capture(root, secondDestination, first);
    expect(second.id).toBe(first.id);
    expect(second.root).toBe(first.root);
    expect(second.coverage.reusedPreviousSnapshot).toBe(true);
    expect(existsSync(join(secondDestination, "a.ts"))).toBe(false);
  });

  it("reassembles unchanged files from the previous snapshot when one file changes", async () => {
    const { root, base } = await fixture("fovea-retention-change-");
    await write(root, "a.ts", "export const a = 1;");
    await write(root, "b.ts", "aaaa");
    await write(root, "c.ts", "export const c = 3;");
    const first = await capture(root, join(base, "snapshot-1"));
    // Same-size changed bytes: the hash differs even though stat-based checks cannot tell.
    await write(root, "b.ts", "bbbb");
    const secondDestination = join(base, "snapshot-2");
    await mkdir(secondDestination, { mode: 0o700 });
    const reassembled: string[] = [];
    const second = await capture(root, secondDestination, first, undefined, {
      onFileRead: absolute => { if (absolute.startsWith(first.root + "/")) reassembled.push(relative(first.root, absolute)); },
    });
    expect(second.root).toBe(secondDestination);
    expect(second.coverage.reusedPreviousSnapshot).toBeUndefined();
    expect(second.hashes.get("a.ts")).toBe(first.hashes.get("a.ts"));
    expect(second.hashes.get("c.ts")).toBe(first.hashes.get("c.ts"));
    expect(second.hashes.get("b.ts")).toBe(sha("bbbb"));
    expect(await readFile(join(secondDestination, "b.ts"), "utf8")).toBe("bbbb");
    expect(await readFile(join(secondDestination, "a.ts"), "utf8")).toBe("export const a = 1;");
    expect(await readFile(join(secondDestination, "c.ts"), "utf8")).toBe("export const c = 3;");
    // The unchanged bytes came from the previous private tree, not the live root.
    expect(reassembled.sort()).toEqual(["a.ts", "c.ts"]);
    expect(await readFile(join(first.root, "a.ts"), "utf8")).toBe("export const a = 1;");
  });

  it("drops deleted files and stages added ones against a previous snapshot", async () => {
    const { root, base } = await fixture("fovea-retention-delta-");
    await write(root, "x.ts", "export const x = 1;");
    const first = await capture(root, join(base, "snapshot-1"));
    await unlink(join(root, "x.ts"));
    await write(root, "y.ts", "export const y = 2;");
    const secondDestination = join(base, "snapshot-2");
    await mkdir(secondDestination, { mode: 0o700 });
    const second = await capture(root, secondDestination, first);
    expect([...second.hashes.keys()]).toEqual(["y.ts"]);
    expect(second.id).not.toBe(first.id);
    expect(await readFile(join(secondDestination, "y.ts"), "utf8")).toBe("export const y = 2;");
    expect(existsSync(join(secondDestination, "x.ts"))).toBe(false);
  });

  it("fails closed when the previous snapshot disappears mid-capture and retries fresh", async () => {
    const { root, base } = await fixture("fovea-retention-vanish-");
    await write(root, "a.ts", "export const a = 1;");
    await write(root, "z.ts", "export const z = 1;");
    const first = await capture(root, join(base, "snapshot-1"));
    await write(root, "z.ts", "export const z = 2;");
    const secondDestination = join(base, "snapshot-2");
    await mkdir(secondDestination, { mode: 0o700 });
    const error = await capture(root, secondDestination, first, undefined, {
      // The changed file is read last: remove the previous tree mid-capture,
      // synchronously so the failure is deterministic.
      onFileRead: absolute => { if (absolute === join(root, "z.ts")) removeFixtureSync(first.root, { recursive: true, force: true }); },
    }).then(() => undefined, error => error as Error);
    expect(error?.message).toContain("Previous snapshot became unavailable during capture");
    expect(existsSync(join(secondDestination, "z.ts"))).toBe(true);
    expect(existsSync(join(secondDestination, "a.ts"))).toBe(false);
    // A later explicit capture without the vanished previous starts fresh.
    const thirdDestination = join(base, "snapshot-3");
    await mkdir(thirdDestination, { mode: 0o700 });
    const third = await capture(root, thirdDestination);
    expect([...third.hashes.keys()].sort()).toEqual(["a.ts", "z.ts"]);
    expect(await readFile(join(thirdDestination, "z.ts"), "utf8")).toBe("export const z = 2;");
  });

  it("fails closed when previous snapshot bytes no longer match their recorded hashes", async () => {
    const { root, base } = await fixture("fovea-retention-tamper-");
    await write(root, "a.ts", "export const a = 1;");
    await write(root, "z.ts", "export const z = 1;");
    const first = await capture(root, join(base, "snapshot-1"));
    // Tamper the private previous tree after its hashes were recorded.
    await chmod(join(first.root, "a.ts"), 0o600);
    await writeFile(join(first.root, "a.ts"), "tampered");
    await chmod(join(first.root, "a.ts"), 0o400);
    await write(root, "z.ts", "export const z = 2;");
    const secondDestination = join(base, "snapshot-2");
    await mkdir(secondDestination, { mode: 0o700 });
    await expect(capture(root, secondDestination, first)).rejects.toThrow("do not match the observed hash");
  });

  it("propagates cancellation during streaming without staging later files", async () => {
    const { root, destination } = await fixture("fovea-retention-cancel-");
    await write(root, "a.ts", "export const a = 1;");
    await write(root, "b.ts", "export const b = 2;");
    await write(root, "c.ts", "export const c = 3;");
    const controller = new AbortController();
    const error = await capture(root, destination, undefined, controller.signal, {
      onFileRead: absolute => { if (absolute === join(root, "b.ts")) controller.abort(); },
    }).then(() => undefined, error => error as Error);
    expect(controller.signal.aborted).toBe(true);
    expect(error).toBeInstanceOf(Error);
    expect(existsSync(join(destination, "a.ts"))).toBe(true);
    expect(existsSync(join(destination, "c.ts"))).toBe(false);
  });

  it("bounds retained live memory well below the admitted tree size", async () => {
    const { root, destination } = await fixture("fovea-retention-memory-");
    // 160 files x 256 KiB = 40 MiB of admitted source. The old capture held
    // every admitted buffer until the walk finished, so that regression grows
    // arrayBuffers by the full tree size (>= 40 MiB) by construction. The
    // streaming capture retains at most one bounded file read, and the 20 MiB
    // arrayBuffers bound enforces that property exactly on a deterministic
    // measure with a 2x margin. Process-wide rss was deliberately dropped as
    // a harness bound: under serial-suite load it measured 23-38 MiB for the
    // CORRECT capture (pure allocator/page noise), so it cannot discriminate
    // the regression.
    const payload = "a".repeat(256 * 1024);
    await mkdir(join(root, "deep"), { recursive: true, mode: 0o700 });
    for (let index = 0; index < 160; index++) {
      await writeFile(join(root, index < 80 ? "." : "deep", `f${index}.ts`), payload);
    }
    const before = process.memoryUsage();
    const snapshot = await capture(root, destination);
    const after = process.memoryUsage();
    expect(snapshot.hashes.size).toBe(160);
    expect(snapshot.coverage.sourceBytes).toBe(160 * 256 * 1024);
    expect(after.arrayBuffers - before.arrayBuffers).toBeLessThan(20 * 1024 * 1024);
    expect(await readFile(join(destination, "deep", "f159.ts"), "utf8")).toBe(payload);
  });

  it("keeps exclusions intact: nested repositories, unsupported files and symlinks", async () => {
    const { root, destination, base } = await fixture("fovea-retention-exclusions-");
    await write(root, "safe.ts", "export const safe = 1;");
    await write(root, "note.txt", "not source");
    await mkdir(join(root, "nested"), { recursive: true });
    await writeFile(join(root, "nested", ".git"), "gitdir: external");
    await symlink(join(base, "outside-target"), join(root, "escape.ts"));
    const snapshot = await capture(root, destination);
    expect([...snapshot.hashes.keys()]).toEqual(["safe.ts"]);
    expect(snapshot.coverage.counts).toMatchObject({ closedBoundaries: 1, unsupported: 1, unavailableOrSymlink: 1 });
  });
});

// The descriptor-relative production adapter runs the same retention scenarios
// on Linux CI. Mid-walk interposition (streaming-order hooks and the
// mid-capture vanish scenario) remains fake-platform coverage because the
// real adapter's handles do not expose source paths.
describe.skipIf(process.platform !== "linux")("retention contract parity on the real Linux adapter", () => {
  const realCapture = (root: string, destination: string, previous?: SourceSnapshot): Promise<SourceSnapshot> =>
    new SourceAccess(sourcePlatform("linux")).captureSourceSnapshot(root, destination, undefined,
      previous ? { previous: { id: previous.id, root: previous.root, hashes: previous.hashes } } : {});

  it("streams cold captures with exact bytes and private modes", async () => {
    const { root, destination } = await fixture("fovea-retention-linux-cold-");
    await write(root, "a.ts", "export const a = 1;");
    await write(root, "nested/b.ts", "export const b = 2;");
    const snapshot = await realCapture(root, destination);
    expect([...snapshot.hashes.entries()]).toEqual([["a.ts", sha("export const a = 1;")], ["nested/b.ts", sha("export const b = 2;")]]);
    expect(snapshot.coverage.sourceFiles).toBe(2);
    expect(await readFile(join(destination, "nested", "b.ts"), "utf8")).toBe("export const b = 2;");
    expect((await stat(join(destination, "nested"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(destination, "nested", "b.ts"))).mode & 0o777).toBe(0o400);
  });

  it("reuses a matching previous snapshot without writing a second copy", async () => {
    const { root, base } = await fixture("fovea-retention-linux-reuse-");
    await write(root, "a.ts", "export const a = 1;");
    const first = await realCapture(root, join(base, "snapshot-1"));
    const secondDestination = join(base, "snapshot-2");
    await mkdir(secondDestination, { mode: 0o700 });
    const second = await realCapture(root, secondDestination, first);
    expect(second.id).toBe(first.id);
    expect(second.root).toBe(first.root);
    expect(second.coverage.reusedPreviousSnapshot).toBe(true);
    expect(existsSync(join(secondDestination, "a.ts"))).toBe(false);
  });

  it("reassembles unchanged files from the previous snapshot when one file changes", async () => {
    const { root, base } = await fixture("fovea-retention-linux-change-");
    await write(root, "a.ts", "export const a = 1;");
    await write(root, "b.ts", "aaaa");
    await write(root, "c.ts", "export const c = 3;");
    const first = await realCapture(root, join(base, "snapshot-1"));
    await write(root, "b.ts", "bbbb");
    const secondDestination = join(base, "snapshot-2");
    await mkdir(secondDestination, { mode: 0o700 });
    const second = await realCapture(root, secondDestination, first);
    expect(second.root).toBe(secondDestination);
    expect(second.coverage.reusedPreviousSnapshot).toBeUndefined();
    expect(second.hashes.get("a.ts")).toBe(first.hashes.get("a.ts"));
    expect(second.hashes.get("c.ts")).toBe(first.hashes.get("c.ts"));
    expect(second.hashes.get("b.ts")).toBe(sha("bbbb"));
    expect(await readFile(join(secondDestination, "b.ts"), "utf8")).toBe("bbbb");
    expect(await readFile(join(secondDestination, "a.ts"), "utf8")).toBe("export const a = 1;");
    expect(await readFile(join(secondDestination, "c.ts"), "utf8")).toBe("export const c = 3;");
  });

  it("drops deleted files and stages added ones against a previous snapshot", async () => {
    const { root, base } = await fixture("fovea-retention-linux-delta-");
    await write(root, "x.ts", "export const x = 1;");
    const first = await realCapture(root, join(base, "snapshot-1"));
    await unlink(join(root, "x.ts"));
    await write(root, "y.ts", "export const y = 2;");
    const secondDestination = join(base, "snapshot-2");
    await mkdir(secondDestination, { mode: 0o700 });
    const second = await realCapture(root, secondDestination, first);
    expect([...second.hashes.keys()]).toEqual(["y.ts"]);
    expect(await readFile(join(secondDestination, "y.ts"), "utf8")).toBe("export const y = 2;");
    expect(existsSync(join(secondDestination, "x.ts"))).toBe(false);
  });

  it("fails closed when previous snapshot bytes no longer match their recorded hashes", async () => {
    const { root, base } = await fixture("fovea-retention-linux-tamper-");
    await write(root, "a.ts", "export const a = 1;");
    await write(root, "z.ts", "export const z = 1;");
    const first = await realCapture(root, join(base, "snapshot-1"));
    await chmod(join(first.root, "a.ts"), 0o600);
    await writeFile(join(first.root, "a.ts"), "tampered");
    await chmod(join(first.root, "a.ts"), 0o400);
    await write(root, "z.ts", "export const z = 2;");
    const secondDestination = join(base, "snapshot-2");
    await mkdir(secondDestination, { mode: 0o700 });
    await expect(realCapture(root, secondDestination, first)).rejects.toThrow("do not match the observed hash");
  });
});
