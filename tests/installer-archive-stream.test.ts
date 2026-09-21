import { removeFixtureSync } from "./fixture-cleanup.mjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { fixture } from "./bundle-fixture.js";
import { canonical, createBundleManifest, LIMITS, sha256 } from "../scripts/bundle-contract.mjs";
import { createBundleArchive, writeBundleArchive, writeBundleArchiveForTest, parseBundleArchive } from "../scripts/bundle-archive.mjs";

const roots: string[] = [];
async function archiveFixture() {
  const root = await fixture(), outputRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "archive-stream-")));
  roots.push(root, outputRoot); return { root, outputRoot, output: path.join(outputRoot, "pending.tar.gz") };
}
async function addLargeFile(root: string) {
  // Incompressible, multi-buffer content exercises gzip's streaming boundaries.
  fs.writeFileSync(path.join(root, "app/payload.bin"), randomBytes(512 * 1024), { mode: 0o600 });
  const previous = JSON.parse(fs.readFileSync(path.join(root, "bundle-manifest.json"), "utf8"));
  const next = await createBundleManifest(root, previous);
  fs.writeFileSync(path.join(root, "bundle-manifest.json"), canonical(next) + "\n");
}
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });

describe("bounded streaming bundle archive writer", () => {
  it("is byte-identical to the compatibility USTAR/gzip encoder and deterministic across writes", async () => {
    const { root, outputRoot, output } = await archiveFixture(); await addLargeFile(root);
    const compatibility = path.join(outputRoot, "compatibility.tar.gz"), second = path.join(outputRoot, "second.tar.gz");
    await createBundleArchive(root, compatibility);
    const first = await writeBundleArchive(root, output), again = await writeBundleArchive(root, second);
    const bytes = fs.readFileSync(output);
    expect(bytes).toEqual(fs.readFileSync(compatibility)); expect(bytes).toEqual(fs.readFileSync(second));
    expect(first.size).toBe(bytes.length); expect(first.sha256).toBe(sha256(bytes)); expect(first.digest).toBe(parseBundleArchive(bytes).digest);
    expect(again.sha256).toBe(first.sha256); expect(fs.lstatSync(output).mode & 0o7777).toBe(0o600); expect(fs.lstatSync(output).nlink).toBe(1);
  });
  it("uses the inherited-fd child strategy without Darwin directory-FD traversal", async () => {
    const { root, output, outputRoot } = await archiveFixture();
    await createBundleArchive(root, path.join(outputRoot, "compatibility"));
    const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "darwin" });
    try { await writeBundleArchive(root, output); }
    finally { Object.defineProperty(process, "platform", descriptor); }
    expect(fs.readFileSync(output)).toEqual(fs.readFileSync(path.join(outputRoot, "compatibility")));
    // This forces the portable protocol on Linux; it is not native qualification.
  });
  it("does not allocate whole members or tar/gzip buffers", async () => {
    const { root, output } = await archiveFixture(); await addLargeFile(root);
    const alloc = vi.spyOn(Buffer, "alloc"), concat = vi.spyOn(Buffer, "concat");
    await writeBundleArchive(root, output);
    expect(Math.max(...alloc.mock.calls.map(call => call[0]))).toBeLessThanOrEqual(64 * 1024);
    // Metadata and zlib housekeeping may concatenate small buffers, never payload.
    expect(concat.mock.calls.every(call => call[0].reduce((n, bytes) => n + bytes.length, 0) < 128 * 1024)).toBe(true);
  });
  it.each(["modify", "grow", "truncate", "symlink", "hardlink"])("refuses %s after initial validation and removes only its pending output", async mutation => {
    const { root, output, outputRoot } = await archiveFixture();
    const file = path.join(root, "app/main.js"), original = fs.readFileSync(file);
    await expect(writeBundleArchiveForTest(root, output, { beforeMember: async (member: string) => {
      if (member !== "app/main.js") return;
      if (mutation === "modify") fs.writeFileSync(file, Buffer.alloc(original.length, 88));
      if (mutation === "grow") fs.appendFileSync(file, "grew");
      if (mutation === "truncate") fs.writeFileSync(file, "x");
      if (mutation === "symlink") { fs.unlinkSync(file); fs.symlinkSync("package.json", file); }
      if (mutation === "hardlink") fs.linkSync(file, path.join(outputRoot, "alias"));
    } })).rejects.toThrow();
    expect(fs.existsSync(output)).toBe(false);
  });
  it("reads through EOF/growth probe and rejects mid-stream mutation", async () => {
    const { root, output } = await archiveFixture(); await addLargeFile(root); let changed = false;
    await expect(writeBundleArchiveForTest(root, output, { afterChunk: async (member: string) => {
      if (member === "app/payload.bin" && !changed) { changed = true; fs.appendFileSync(path.join(root, member), "extra byte"); }
    } })).rejects.toThrow(/grew|changed/);
    expect(changed).toBe(true); expect(fs.existsSync(output)).toBe(false);
  });
  it.each(["member", "manifest", "addition", "deletion"])("independently rejects later %s drift before exposing successful output", async mutation => {
    const { root, output } = await archiveFixture();
    await expect(writeBundleArchiveForTest(root, output, { beforeValidation: async () => {
      if (mutation === "member") fs.appendFileSync(path.join(root, "app/main.js"), "changed after stream");
      if (mutation === "manifest") fs.appendFileSync(path.join(root, "bundle-manifest.json"), " ");
      if (mutation === "addition") fs.writeFileSync(path.join(root, "app/extra.js"), "new", { mode: 0o600 });
      if (mutation === "deletion") fs.unlinkSync(path.join(root, "app/main.js"));
    } })).rejects.toThrow();
    expect(fs.existsSync(output)).toBe(false);
  });
  it("binds the returned checksum to the actual pending output and detects late output modification", async () => {
    const { root, output } = await archiveFixture();
    await expect(writeBundleArchiveForTest(root, output, { beforeValidation: async (capture: string) => { const bytes = fs.readFileSync(capture); bytes[0] = bytes[0]! ^ 255; fs.writeFileSync(capture, bytes); } })).rejects.toThrow(/output changed/);
    expect(fs.existsSync(output)).toBe(false);
  });
  it("enforces compressed byte caps, cleans partial writes, and never overwrites prior output", async () => {
    const { root, output } = await archiveFixture(); await addLargeFile(root);
    await expect(writeBundleArchive(root, output, { maxBytes: 100 })).rejects.toThrow(/Compressed bound/);
    expect(fs.existsSync(output)).toBe(false);
    for (const maxBytes of [0, -1, LIMITS.archive + 1, Number.NaN]) await expect(writeBundleArchive(root, output, { maxBytes })).rejects.toThrow(/bound/);
    fs.writeFileSync(output, "foreign", { mode: 0o600 });
    await expect(writeBundleArchive(root, output)).rejects.toThrow(/EEXIST/);
    expect(fs.readFileSync(output, "utf8")).toBe("foreign");
  });
  it("cleans known completed captures but preserves uncertain partial evidence privately", async () => {
    const { root, output, outputRoot } = await archiveFixture();
    await expect(writeBundleArchiveForTest(root, output, { beforeValidation: async () => { fs.appendFileSync(path.join(root, "app/main.js"), "late drift"); } })).rejects.toThrow();
    expect(fs.existsSync(output)).toBe(false); expect(fs.readdirSync(outputRoot)).toEqual([]);
    const another = await archiveFixture(); await addLargeFile(another.root);
    try { await writeBundleArchive(another.root, another.output, { maxBytes: 100 }); throw new Error("expected failure"); }
    catch (error) {
      expect(String(error)).toMatch(/bound/i); expect(fs.existsSync(another.output)).toBe(false);
      const partials = fs.readdirSync(another.outputRoot).filter(name => name.startsWith(".archive-capture-"));
      if (partials.length) {
        expect((error as { recoveryPath?: string }).recoveryPath).toBe(path.join(another.outputRoot, partials[0]!));
        expect(fs.lstatSync(path.join(another.outputRoot, partials[0]!)).mode & 0o7777).toBe(0o600);
      }
    }
  });
  it("refuses symlinked/unsafe destinations and output inside the bundle", async () => {
    const { root, output, outputRoot } = await archiveFixture();
    const sentinel = path.join(outputRoot, "sentinel"); fs.writeFileSync(sentinel, "keep", { mode: 0o600 }); fs.symlinkSync(sentinel, output);
    await expect(writeBundleArchive(root, output)).rejects.toThrow(/EEXIST/); expect(fs.readFileSync(sentinel, "utf8")).toBe("keep");
    fs.unlinkSync(output); fs.chmodSync(outputRoot, 0o755);
    await expect(writeBundleArchive(root, output)).rejects.toThrow(/private/);
    await expect(writeBundleArchive(root, path.join(root, "pending.gz"))).rejects.toThrow(/outside/);
    expect(fs.existsSync(path.join(root, "pending.gz"))).toBe(false);
  });
});
