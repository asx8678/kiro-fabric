import { removeFixtureSync } from "./fixture-cleanup.mjs";
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { collectInstallerCache, collectInstallerCacheForTest, parseInstallerCacheArguments, withInstallerArtifactLease } from "../scripts/installer-cache.mjs";
import { withInstallerCacheGate } from "../scripts/installer-artifacts.mjs";
import { buildCompleteBundleForTest } from "../scripts/build-complete-bundle.mjs";
import { buildAgentDev } from "../scripts/build-agent-dev.mjs";
import { packagingFixture, fixtureDependencies, refreshFixtureClosure, put, hash } from "./installer-packaging-fixture.js";
import { canonical, sha256 } from "../scripts/bundle-contract.mjs";
const roots: string[] = [];
const fixture = () => { const root = packagingFixture(); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
async function generations(count = 3) {
  const root = fixture(), deps = fixtureDependencies(), bundles = [];
  for (let i = 0; i < count; i++) {
    put(root, "src/fixture-entry.ts", `export const fixture = ${i};`); refreshFixtureClosure(root);
    bundles.push(await buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps));
  }
  bundles.forEach((bundle, i) => fs.utimesSync(bundle.root, 1000 + i, 1000 + i));
  return { root, bundles };
}
const names = (entries: { name: string }[]) => entries.map(entry => entry.name);

describe("checkout cache GC", () => {
  it("defaults to dry-run; count retention preserves active pointers and current tool pins", async () => {
    const { root, bundles } = await generations(), parent = path.join(root, ".tmp");
    const before = fs.readdirSync(parent).sort(), pointer = fs.readFileSync(path.join(parent, "complete-bundle.json"));
    const plan = await collectInstallerCache({ root, keep: 2 });
    expect(plan.dryRun).toBe(true); expect(names(plan.planned)).toEqual([path.basename(bundles[0]!.root)]);
    expect(plan.removed).toEqual([]); expect(fs.readdirSync(parent).sort()).toEqual(before);
    expect(fs.readFileSync(path.join(parent, "complete-bundle.json"))).toEqual(pointer);
    const applied = await collectInstallerCache({ root, keep: 2, apply: true });
    expect(names(applied.removed)).toEqual(names(plan.planned));
    expect(fs.existsSync(bundles[0]!.root)).toBe(false); expect(fs.existsSync(bundles[1]!.root)).toBe(true); expect(fs.existsSync(bundles[2]!.root)).toBe(true);
    expect(fs.readdirSync(parent).some(name => name.startsWith("private-tools-"))).toBe(true);
    expect(fs.readFileSync(path.join(parent, "complete-bundle.json"))).toEqual(pointer);
  });
  it("byte budgets evict inactive entries, never active ones even over budget", async () => {
    const { root, bundles } = await generations();
    const result = await collectInstallerCache({ root, keep: 100, maxBytes: 0, apply: true });
    expect(names(result.removed).sort()).toEqual(bundles.slice(0, -1).map(bundle => path.basename(bundle.root)).sort());
    expect(fs.existsSync(bundles.at(-1)!.root)).toBe(true); expect(result.overBudget).toBe(true); expect(result.retainedBytes).toBeGreaterThan(0);
  });
  it("preserves Agent staging pointers and only prunes validated inactive Agent generations", async () => {
    const root = fixture();
    refreshFixtureClosure(root, process.platform === 'darwin');
    const first = await buildAgentDev({ root });
    put(root, "src/fixture-entry.ts", "export const fixture = 'B';"); refreshFixtureClosure(root, process.platform === 'darwin');
    const second = await buildAgentDev({ root });
    const result = await collectInstallerCache({ root, keep: 0, maxBytes: 0, apply: true });
    expect(names(result.removed)).toEqual([path.basename(first.generation)]);
    expect(fs.readlinkSync(path.join(root, ".tmp/kiro-fabric-agent"))).toBe(path.basename(second.generation));
    expect(fs.existsSync(second.generation)).toBe(true);
  });
  it("leaves foreign, symlinked, modified, unreceipted and incomplete entries untouched", async () => {
    const { root, bundles } = await generations(), parent = path.join(root, ".tmp");
    put(bundles[0]!.root, "manager/install-manager.mjs", "modified evidence");
    const foreign = `kiro-fabric-bundle-linux-x64-${"0".repeat(64)}`, alias = `private-tools-${"f".repeat(64)}`;
    put(parent, `${foreign}/sentinel`, "unknown generation");
    fs.symlinkSync(bundles[1]!.root, path.join(parent, alias));
    put(parent, "foreign-data/sentinel", "never prune runtime data");
    put(parent, ".complete-bundle-interrupted/sentinel", "interrupted build evidence");
    put(parent, "kiro-fabric-linux-x64.tar.gz", "archive is out of scope");
    const result = await collectInstallerCache({ root, keep: 0, apply: true });
    expect(names(result.removed)).toEqual([path.basename(bundles[1]!.root)]);
    expect(fs.readFileSync(path.join(bundles[0]!.root, "manager/install-manager.mjs"), "utf8")).toBe("modified evidence");
    for (const name of [foreign, alias, "foreign-data", ".complete-bundle-interrupted", "kiro-fabric-linux-x64.tar.gz"]) expect(fs.lstatSync(path.join(parent, name))).toBeTruthy();
  });
  it("prunes only obsolete validated tool pins, preserving the new active tool closure", async () => {
    const root = fixture(), deps = fixtureDependencies();
    const first = await buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps);
    const config = JSON.parse(fs.readFileSync(path.join(root, "build-toolchain.json"), "utf8"));
    const oldTools = `private-tools-${sha256(canonical(config.targets["linux-x64"]))}`;
    config.targets["linux-x64"].node.members[0].sha256 = hash("updated tools/node");
    put(root, "build-toolchain.json", JSON.stringify(config)); refreshFixtureClosure(root);
    const second = await buildCompleteBundleForTest({ root, target: "linux-x64", archive: false }, deps);
    const newTools = `private-tools-${sha256(canonical(config.targets["linux-x64"]))}`;
    const result = await collectInstallerCache({ root, keep: 0, maxBytes: 0, apply: true });
    expect(names(result.removed).sort()).toEqual([oldTools, path.basename(first.root)].sort());
    expect(fs.existsSync(path.join(root, ".tmp", newTools))).toBe(true); expect(fs.existsSync(second.root)).toBe(true);
  });
  it("refuses uncertain or modified active pointers, preserving all generations", async () => {
    const { root, bundles } = await generations();
    fs.writeFileSync(path.join(root, ".tmp/complete-bundle.json"), "{}");
    await expect(collectInstallerCache({ root, keep: 0, apply: true })).rejects.toThrow(/pointer/);
    for (const bundle of bundles) expect(fs.existsSync(bundle.root)).toBe(true);
  });
  it("lease scopes nest and each concurrent consumer retains its own protection", async () => {
    const root = fixture(), directory = path.join(root, ".tmp/.installer-artifact-leases");
    await withInstallerArtifactLease(root, async () => {
      expect(fs.readdirSync(directory)).toHaveLength(1);
      await withInstallerArtifactLease(root, async () => {
        expect(fs.readdirSync(directory)).toHaveLength(2);
        await expect(collectInstallerCache({ root, apply: true })).rejects.toThrow(/in use|leases/);
      });
      expect(fs.readdirSync(directory)).toHaveLength(1);
      await Promise.all([1, 2].map(() => withInstallerArtifactLease(root, async () => {
        await expect(collectInstallerCache({ root, apply: true })).rejects.toThrow(/in use|leases/);
      })));
    });
    expect(fs.readdirSync(directory)).toEqual([]);
  });
  it("refuses stale/malformed leases without PID scanning or reclaiming evidence", async () => {
    const root = fixture(); put(root, ".tmp/.installer-artifact-leases/stale.json", '{"pid":2147483647}');
    await expect(collectInstallerCache({ root, apply: true })).rejects.toThrow(/leases/);
    expect(fs.readFileSync(path.join(root, ".tmp/.installer-artifact-leases/stale.json"), "utf8")).toBe('{"pid":2147483647}');
  });
  it("consumer cannot enroll concurrently with GC's held gate; a competing GC also refuses", async () => {
    const root = fixture(); let consumed = false;
    await withInstallerCacheGate(root, async () => {
      await Promise.all([
        expect(withInstallerArtifactLease(root, async () => { consumed = true; })).rejects.toThrow(/gate busy or stale/),
        expect(collectInstallerCache({ root, apply: true })).rejects.toThrow(/gate busy or stale/),
      ]);
    });
    expect(consumed).toBe(false);
    expect(fs.existsSync(path.join(root, ".tmp/.installer-cache-gate"))).toBe(false);
  });
  it("rechecks bytes and metadata after planning and preserves concurrent modifications", async () => {
    const { root, bundles } = await generations(2);
    const result = await collectInstallerCacheForTest({ root, keep: 0, apply: true }, { beforeApply: async () => { put(bundles[0]!.root, "resources/concurrent.txt", "new evidence"); } });
    expect(result.removed).toEqual([]); expect(fs.existsSync(bundles[0]!.root)).toBe(true);
    expect(fs.readFileSync(path.join(bundles[0]!.root, "resources/concurrent.txt"), "utf8")).toBe("new evidence");
  });
  it("stale gates and modified consumer leases remain evidence", async () => {
    const root = fixture(); put(root, ".tmp/.installer-cache-gate/owner.json", "stale gate");
    await expect(collectInstallerCache({ root, apply: true })).rejects.toThrow(/gate busy or stale/);
    expect(fs.readFileSync(path.join(root, ".tmp/.installer-cache-gate/owner.json"), "utf8")).toBe("stale gate");
    const other = fixture();
    await expect(withInstallerArtifactLease(other, async () => {
      const directory = path.join(other, ".tmp/.installer-artifact-leases");
      fs.writeFileSync(path.join(directory, fs.readdirSync(directory)[0]!), "{}");
    })).rejects.toThrow(/lease changed/);
    expect(fs.readdirSync(path.join(other, ".tmp/.installer-artifact-leases"))).toHaveLength(1);
  });
  it("runs lease enrollment/cleanup and GC through the Darwin child strategy", async () => {
    const { root, bundles } = await generations(2);
    const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "darwin" });
    try {
      await withInstallerArtifactLease(root, async () => {
        await withInstallerArtifactLease(root, async () => {
          await expect(collectInstallerCache({ root, apply: true })).rejects.toThrow(/leases/);
        });
      });
      expect(fs.readdirSync(path.join(root, ".tmp/.installer-artifact-leases"))).toEqual([]);
      const result = await collectInstallerCache({ root, keep: 0, apply: true });
      expect(names(result.removed)).toEqual([path.basename(bundles[0]!.root)]);
      expect(fs.existsSync(bundles[1]!.root)).toBe(true);
    } finally { Object.defineProperty(process, "platform", descriptor); }
  });
  it("a separate GC process refuses an enrolled consumer", async () => {
    const root = fixture();
    await withInstallerArtifactLease(root, async () => {
      const probe = spawnSync(process.execPath, [path.resolve("scripts/installer-cache.mjs"), "--root", root, "--apply"], { encoding: "utf8", timeout: 10000 });
      expect(probe.status).not.toBe(0); expect(probe.stderr).toMatch(/leases/);
      expect(fs.readdirSync(path.join(root, ".tmp/.installer-artifact-leases"))).toHaveLength(1);
    });
  });
  it("refuses same-byte replaced leases and symlinked lease directories", async () => {
    const root = fixture();
    await expect(withInstallerArtifactLease(root, async () => {
      const directory = path.join(root, ".tmp/.installer-artifact-leases"), file = path.join(directory, fs.readdirSync(directory)[0]!);
      const bytes = fs.readFileSync(file); fs.renameSync(file, file + ".original"); fs.writeFileSync(file, bytes, { mode: 0o600 });
    })).rejects.toThrow(/lease changed/);
    expect(fs.readdirSync(path.join(root, ".tmp/.installer-artifact-leases"))).toHaveLength(2);
    const other = fixture(); fs.mkdirSync(path.join(other, "foreign"), { mode: 0o700 });
    fs.symlinkSync(path.join(other, "foreign"), path.join(other, ".tmp/.installer-artifact-leases"));
    await expect(collectInstallerCache({ root: other, apply: true })).rejects.toThrow(/ancestry/);
    expect(fs.readdirSync(path.join(other, "foreign"))).toEqual([]);
  });
  it("refuses non-checkout runtime/data roots without modifying their .tmp", async () => {
    const root = fixture(); fs.renameSync(path.join(root, "src"), path.join(root, "installed-runtime"));
    put(root, ".tmp/runtime-data/sentinel", "keep");
    const before = fs.readdirSync(path.join(root, ".tmp")).sort();
    await expect(collectInstallerCache({ root, keep: 0, apply: true })).rejects.toThrow();
    expect(fs.readdirSync(path.join(root, ".tmp")).sort()).toEqual(before);
    expect(fs.readFileSync(path.join(root, ".tmp/runtime-data/sentinel"), "utf8")).toBe("keep");
  });
  it("CLI is dry-run-first and parses only documented opt-in policies", () => {
    const root = fixture();
    expect(parseInstallerCacheArguments([])).toEqual({});
    expect(parseInstallerCacheArguments(["--apply", "--keep", "0", "--max-bytes", "100"])).toEqual({ apply: true, keep: 0, maxBytes: 100 });
    for (const args of [["--keep", "-1"], ["--max-bytes", "1e9"], ["--apply", "--apply"], ["--force"], ["--root"]]) expect(() => parseInstallerCacheArguments(args)).toThrow();
    const result = spawnSync(process.execPath, [path.resolve("scripts/installer-cache.mjs"), "--root", root, "--keep", "0"], { encoding: "utf8", timeout: 10000 });
    expect(result.status, result.stderr).toBe(0); expect(JSON.parse(result.stdout).dryRun).toBe(true);
  });
});
