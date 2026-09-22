import { removeFixtureSync } from "./fixture-cleanup.mjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildCompleteBundleForTest, findReusableSourceBundleForTest } from "../scripts/build-complete-bundle.mjs";
import { withInstallerArtifactLease } from "../scripts/installer-cache.mjs";
import { canonical, sha256 } from "../scripts/bundle-contract.mjs";
import { generateBundleSbomOutputs } from "../scripts/generate-bundle-sbom.mjs";
import { parseBundleArchive } from "../scripts/bundle-archive.mjs";
import { packagingFixture, refreshFixtureClosure, fixtureDependencies, hash, put } from "./installer-packaging-fixture.js";
const roots: string[] = [];
const fixture = () => { const root = packagingFixture(); roots.push(root); return root; };
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });

describe("early installer bundle reuse", () => {
  it("skips copying, acquisition and manager compilation, including pre-pnpm lookup", async () => {
    const root = fixture(), deps = fixtureDependencies();
    const compile = vi.spyOn(deps, "compileManager"), acquire = vi.spyOn(deps, "acquireTools");
    const first = await buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps);
    expect(first.archive).toBeNull(); expect(first.reused).toBe(false);
    expect(fs.existsSync(path.join(root, ".tmp/kiro-fabric-linux-x64.tar.gz"))).toBe(false);
    const copies = vi.spyOn(fs, "copyFileSync").mockImplementation(() => { throw new Error("reuse must not copy"); });
    const second = await buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps);
    const early = await withInstallerArtifactLease(root, async () => findReusableSourceBundleForTest({ root, target: "linux-x64" }, deps));
    expect(second.root).toBe(first.root); expect(second.reused).toBe(true);
    expect(early?.root).toBe(first.root); expect(early?.archive).toBeNull();
    expect(compile).toHaveBeenCalledTimes(1); expect(acquire).toHaveBeenCalledTimes(1); expect(copies).not.toHaveBeenCalled();
    expect(fs.readdirSync(path.join(root, ".tmp")).filter(name => name.startsWith(".complete-bundle-") || name.startsWith(".archive-"))).toEqual([]);
  });
  it("retains explicit deterministic archive generation on reuse", async () => {
    const root = fixture(), deps = fixtureDependencies();
    const first = await buildCompleteBundleForTest({ root, target: "linux-x64" }, deps);
    const bytes = fs.readFileSync(first.archive!);
    const second = await buildCompleteBundleForTest({ root, target: "linux-x64" }, deps);
    expect(second.reused).toBe(true); expect(fs.readFileSync(second.archive!)).toEqual(bytes);
    expect((await buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps)).archive).toBeNull();
  });
  it("serializes an SBOM consumer starting between archive replacement and pointer publication", async () => {
    const root = fixture(), deps = fixtureDependencies();
    const closure = path.join(root, "dist/kiro-agent-closure/closure-manifest.json");
    const addPackages = () => { const m = JSON.parse(fs.readFileSync(closure, "utf8")); put(root, "dist/kiro-agent-closure/closure-manifest.json", JSON.stringify({ ...m, packageInputs: [] })); };
    addPackages();
    const a = await buildCompleteBundleForTest({ root, target: "linux-x64" }, deps);
    put(root, "src/fixture-entry.ts", "export const fixture = 'B';\n"); refreshFixtureClosure(root); addPackages();
    const rename = fs.renameSync;
    let consumer: ReturnType<typeof generateBundleSbomOutputs> | undefined;
    const spy = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      rename(from, to);
      if (to === a.archive) {
        expect(fs.existsSync(path.join(root, ".tmp/.installer-cache-gate/owner.json"))).toBe(true);
        expect(JSON.parse(fs.readFileSync(path.join(root, ".tmp/complete-bundle.json"), "utf8")).digest).toBe(a.digest);
        consumer = generateBundleSbomOutputs(root);
        // Attach immediately; the result below still asserts success.
        void consumer.catch(() => {});
      }
    });
    const b = await buildCompleteBundleForTest({ root, target: "linux-x64" }, deps);
    spy.mockRestore(); expect(b.digest).not.toBe(a.digest); expect(consumer).toBeDefined();
    const result = await consumer!;
    const captured = fs.readFileSync(b.archive!);
    expect(parseBundleArchive(captured).digest).toBe(b.digest);
    expect(result.archive?.sha256).toBe(sha256(captured));
    expect(JSON.parse(fs.readFileSync(result.archiveSidecar!, "utf8")).packages[0].checksums[0].checksumValue).toBe(b.digest);
  });
  it.each(["modify", "delete", "add", "symlink", "hardlink", "mode"])("refuses %s tampering before copying or recompiling", async mutation => {
    const root = fixture(), deps = fixtureDependencies();
    const first = await buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps);
    const file = path.join(first.root, "manager/install-manager.mjs"), bytes = fs.readFileSync(file);
    if (mutation === "modify") fs.writeFileSync(file, Buffer.alloc(bytes.length, 88));
    if (mutation === "delete") fs.unlinkSync(file);
    if (mutation === "add") put(first.root, "resources/unknown.txt", "foreign");
    if (mutation === "symlink") { fs.unlinkSync(file); fs.symlinkSync(path.join(root, "scripts/install-manager.mjs"), file); }
    if (mutation === "hardlink") fs.linkSync(file, path.join(root, "alias"));
    if (mutation === "mode") fs.chmodSync(file, 0o644);
    const compile = vi.spyOn(deps, "compileManager"), copies = vi.spyOn(fs, "copyFileSync");
    await expect(buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps)).rejects.toThrow();
    await expect(findReusableSourceBundleForTest({ root, target: "linux-x64" }, deps)).rejects.toThrow();
    expect(compile).not.toHaveBeenCalled(); expect(copies).not.toHaveBeenCalled();
    expect(fs.existsSync(first.root)).toBe(true);
  });
  it("treats indexes as hints and validates an inactive selected generation", async () => {
    const root = fixture(), deps = fixtureDependencies();
    const first = await buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps);
    fs.unlinkSync(path.join(root, ".tmp/complete-bundle.json"));
    fs.appendFileSync(path.join(first.root, "manager/install-manager.mjs"), "tampered");
    await expect(findReusableSourceBundleForTest({ root, target: "linux-x64" }, deps)).rejects.toThrow();
    const receipt = path.join(root, ".tmp/.installer-cache-records", `${path.basename(first.root)}.json`);
    fs.writeFileSync(receipt, "{}");
    await expect(buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps)).rejects.toThrow(/record/);
  });
  it.each(["edit", "addition", "deletion"])("returns a miss for intact stale closure after source %s", async mutation => {
    const root = fixture(), deps = fixtureDependencies();
    await buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps);
    if (mutation === "edit") fs.appendFileSync(path.join(root, "src/fixture-entry.ts"), "// changed");
    if (mutation === "addition") put(root, "src/added.ts", "export {};");
    if (mutation === "deletion") fs.unlinkSync(path.join(root, "src/fixture-entry.ts"));
    expect(await findReusableSourceBundleForTest({ root, target: "linux-x64" }, deps)).toBeNull();
    await expect(buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps)).rejects.toThrow(/Build inputs changed/);
  });
  it("refuses broken existing dist rather than silently rebuilding", async () => {
    const root = fixture(), deps = fixtureDependencies();
    await buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps);
    fs.unlinkSync(path.join(root, "dist/kiro-agent-closure/kiro/mcp-entry.js"));
    await expect(findReusableSourceBundleForTest({ root, target: "linux-x64" }, deps)).rejects.toThrow(/inventory/);
  });
  it("a pin change misses and acquires the new exact tool closure", async () => {
    const root = fixture(), deps = fixtureDependencies();
    const first = await buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps);
    const config = JSON.parse(fs.readFileSync(path.join(root, "build-toolchain.json"), "utf8"));
    const oldCache = `private-tools-${sha256(canonical(config.targets["linux-x64"]))}`;
    config.targets["linux-x64"].node.members[0].sha256 = hash("updated tools/node");
    put(root, "build-toolchain.json", JSON.stringify(config)); refreshFixtureClosure(root);
    expect(await findReusableSourceBundleForTest({ root, target: "linux-x64" }, deps)).toBeNull();
    const acquire = vi.spyOn(deps, "acquireTools");
    const second = await buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps);
    expect(acquire).toHaveBeenCalledOnce(); expect(second.root).not.toBe(first.root);
    expect(fs.readFileSync(path.join(second.root, "tools/node"), "utf8")).toBe("updated tools/node");
    expect(fs.existsSync(path.join(root, ".tmp", oldCache))).toBe(true);
  });
  it("records current dirty/HEAD provenance even when source payload is identical", async () => {
    const root = fixture(), deps = fixtureDependencies(), provenance = deps.provenance;
    deps.provenance = root => ({ ...provenance(root), dirty: false });
    const clean = await buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps);
    deps.provenance = root => ({ ...provenance(root), dirty: true, gitHead: "b".repeat(40) });
    expect(await findReusableSourceBundleForTest({ root, target: "linux-x64" }, deps)).toBeNull();
    const dirty = await buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps);
    expect(dirty.root).not.toBe(clean.root); expect(dirty.provenance.dirty).toBe(true); expect(dirty.provenance.gitHead).toBe("b".repeat(40));
    expect(dirty.provenance.sourceDigest).toBe(clean.provenance.sourceDigest);
  });
  it("refuses forged or missing stored input provenance instead of returning a miss", async () => {
    const root = fixture(), deps = fixtureDependencies();
    await buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps);
    const file = path.join(root, "dist/kiro-agent-closure/closure-manifest.json"), manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const buildInputs of [undefined, {}, { ...manifest.buildInputs, digest: "0".repeat(64) }]) {
      put(root, "dist/kiro-agent-closure/closure-manifest.json", JSON.stringify({ ...manifest, buildInputs }));
      await expect(findReusableSourceBundleForTest({ root, target: "linux-x64" }, deps)).rejects.toThrow(/Invalid build input provenance/);
    }
  });
  it("independent publication validation catches tampering after reuse selection", async () => {
    const root = fixture(), deps = fixtureDependencies();
    const first = await buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps);
    const provenance = deps.provenance; let changed = false;
    deps.provenance = root => {
      if (!changed) { changed = true; fs.appendFileSync(path.join(first.root, "manager/install-manager.mjs"), "tampered after initial validation"); }
      return provenance(root);
    };
    await expect(findReusableSourceBundleForTest({ root, target: "linux-x64" }, deps)).rejects.toThrow(/inventory/i);
  });
  it("checks checkout drift after streaming but BEFORE replacing a public archive", async () => {
    const root = fixture(), deps = fixtureDependencies();
    await buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps);
    const archive = path.join(root, ".tmp/kiro-fabric-linux-x64.tar.gz"); fs.writeFileSync(archive, "previous archive", { mode: 0o600 });
    const provenance = deps.provenance;
    deps.provenance = root => {
      if (fs.readdirSync(path.join(root, ".tmp")).some(name => name.startsWith(".archive-"))) put(root, "src/streaming-drift.ts", "export {};\n");
      return provenance(root);
    };
    await expect(buildCompleteBundleForTest({ root, target: "linux-x64" }, deps)).rejects.toThrow(/Source changed/);
    expect(fs.readFileSync(archive, "utf8")).toBe("previous archive");
    expect(fs.readdirSync(path.join(root, ".tmp")).some(name => name.startsWith(".archive-"))).toBe(false);
  });
  it("preserves a pending archive replaced before the publication gate commit", async () => {
    const root = fixture(), deps = fixtureDependencies();
    const first = await buildCompleteBundleForTest({ root, target: "linux-x64" }, deps);
    const previous = fs.readFileSync(first.archive!), pointer = fs.readFileSync(path.join(root, ".tmp/complete-bundle.json"));
    const provenance = deps.provenance; let replaced: string | undefined;
    deps.provenance = root => {
      const pending = fs.readdirSync(path.join(root, ".tmp")).find(name => /^\.archive-[a-f0-9]{32}\.tar\.gz$/u.test(name));
      if (pending && !replaced) {
        replaced = path.join(root, ".tmp", pending);
        fs.renameSync(replaced, replaced + ".original"); fs.writeFileSync(replaced, "replacement evidence", { mode: 0o600 });
      }
      return provenance(root);
    };
    await expect(buildCompleteBundleForTest({ root, target: "linux-x64" }, deps)).rejects.toThrow("Pending development archive changed");
    expect(replaced).toBeDefined(); expect(fs.readFileSync(replaced!, "utf8")).toBe("replacement evidence");
    expect(fs.readFileSync(replaced! + ".original")).toEqual(previous);
    expect(fs.readFileSync(first.archive!)).toEqual(previous);
    expect(fs.readFileSync(path.join(root, ".tmp/complete-bundle.json"))).toEqual(pointer);
  });
  it("binds exact manifest bytes, not only semantically equal manifest JSON", async () => {
    const root = fixture(), deps = fixtureDependencies();
    const first = await buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps);
    fs.appendFileSync(path.join(root, "dist/kiro-agent-closure/closure-manifest.json"), "\n");
    expect(await findReusableSourceBundleForTest({ root, target: "linux-x64" }, deps)).toBeNull();
    const second = await buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps);
    expect(second.root).not.toBe(first.root);
  });
  it("refreshes toolchain lookup provenance after a verified equal-output rebuild", async () => {
    const root = fixture(), deps = fixtureDependencies();
    const first = await buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps);
    const original = Object.getOwnPropertyDescriptor(process, "version")!;
    Object.defineProperty(process, "version", { value: "v24.99.0" });
    try {
      expect(await findReusableSourceBundleForTest({ root, target: "linux-x64" }, deps)).toBeNull();
      const rebuilt = await buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps);
      expect(rebuilt.root).toBe(first.root); expect(rebuilt.reused).toBe(false);
      expect((await findReusableSourceBundleForTest({ root, target: "linux-x64" }, deps))?.reused).toBe(true);
    } finally { Object.defineProperty(process, "version", original); }
  });
  it("concurrent producers converge without overwriting immutable generations", async () => {
    const root = fixture(), deps = fixtureDependencies();
    const [first, second] = await Promise.all([1, 2].map(() => buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps)));
    expect(first!.root).toBe(second!.root);
    expect((await findReusableSourceBundleForTest({ root, target: "linux-x64" }, deps))?.root).toBe(first!.root);
    expect(fs.readdirSync(path.join(root, ".tmp/.installer-artifact-leases"))).toEqual([]);
  });
  it("checks source drift independently during publication", async () => {
    const root = fixture(), deps = fixtureDependencies(), compile = deps.compileManager;
    deps.compileManager = async (root, outfile) => { await compile(root, outfile); put(root, "src/added-after-capture.ts", "export {};"); };
    await expect(buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps)).rejects.toThrow(/Build inputs changed/);
    expect(fs.existsSync(path.join(root, ".tmp/complete-bundle.json"))).toBe(false);
  });
});
