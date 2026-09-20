import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateAgentPackage } from "../scripts/validate-agent-package.mjs";
import { buildAgentDev } from "../scripts/build-agent-dev.mjs";
import { packagingFixture, put } from "./installer-packaging-fixture.js";
const roots: string[] = [];
const fixture = () => { const root = packagingFixture(); roots.push(root); return root; };
const copyPackageFixture = (source: string, destination: string): void => {
  fs.cpSync(source, destination, { recursive: true });
  // cpSync creates every destination directory using the ambient umask.
  // Make only this test-owned copy private; keep the product validator unchanged.
  fs.chmodSync(destination, 0o700);
  for (const entry of fs.readdirSync(destination, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) fs.chmodSync(path.join(entry.parentPath, entry.name), 0o700);
  }
};
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const digestTree = (root: string): string => {
  const digest = createHash("sha256"), pending = [root];
  while (pending.length) for (const entry of fs.readdirSync(pending.pop()!, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const target = path.join(entry.parentPath, entry.name); digest.update(path.relative(root, target));
    if (entry.isDirectory()) pending.push(target); else digest.update(fs.readFileSync(target));
  }
  return digest.digest("hex");
};

describe("hermetic staging", () => {
  it("leaves a sentinel KIRO_HOME byte-for-byte unchanged using only a fixture closure", () => {
    const root = fixture(), home = path.join(root, "home"), kiroHome = path.join(root, "kiro");
    fs.mkdirSync(home); put(kiroHome, "sentinel", Buffer.from([0, 1, 255]));
    const before = digestTree(kiroHome);
    const result = spawnSync(process.execPath, [path.resolve("scripts/build-agent-dev.mjs")], { cwd: root, encoding: "utf8", env: { ...process.env, HOME: home, KIRO_HOME: kiroHome }, timeout: 60_000 });
    expect(result.status, result.stderr).toBe(0); expect(digestTree(kiroHome)).toBe(before);
  });
  it("imports the actual staged installer with the checkout unavailable", async () => {
    const root = fixture(), staged = await buildAgentDev({ root });
    const isolated = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "standalone-agent-"))); roots.push(isolated);
    const standalone = path.join(isolated, "package");
    copyPackageFixture(staged.generation, standalone);
    expect(fs.readFileSync(path.join(standalone, "scripts/filesystem-boundary.mjs"))).toEqual(fs.readFileSync(path.join(root, "src/installation/filesystem-boundary.mjs")));
    fs.rmSync(root, { recursive: true });
    expect(validateAgentPackage(standalone).ok).toBe(true);
    const probe = spawnSync(process.execPath, ["--input-type=module", "-e", `const installer=await import(${JSON.stringify(pathToFileURL(path.join(standalone, "scripts/install-agent-user.mjs")).href)}); if(typeof installer.installUserAgent!=='function'||typeof installer.installerSafety!=='object')throw Error('incomplete standalone installer');`], { cwd: isolated, encoding: "utf8", env: { ...process.env, HOME: path.join(isolated, "home"), KIRO_HOME: path.join(isolated, "kiro") }, timeout: 10000 });
    expect(probe.status, probe.stderr).toBe(0); expect(fs.existsSync(path.join(standalone, "src"))).toBe(false);
  });
  it("preserves historical three-script packages while rejecting incomplete or unknown new closures", async () => {
    const root = fixture(), staged = await buildAgentDev({ root }), legacy = path.join(root, "legacy-package");
    copyPackageFixture(staged.generation, legacy);
    fs.unlinkSync(path.join(legacy, "scripts/filesystem-boundary.mjs"));
    expect(() => validateAgentPackage(legacy)).toThrow(/dependency.*missing/);
    const historical = fs.readFileSync(new URL("./fixtures/installer-history/d33de003/install-agent-user.mjs.txt", import.meta.url), "utf8");
    expect(createHash("sha256").update(historical).digest("hex")).toBe("26588cd40f6d201ab84f8ac6018c14189412a57c250f02692188a3796b71f3fb");
    put(legacy, "scripts/install-agent-user.mjs", historical);
    // Exact pre-Fovea authority bytes; no Git checkout or current-product derivation.
    const productBytes = `{
  "$schema": "./docs/agent-product.schema.json",
  "schemaVersion": 1,
  "product": "kiro-fabric-agent",
  "entrypoint": "src/kiro/mcp-entry.ts",
  "outputBundle": "dist/kiro-agent-closure",
  "runtimeAssets": {
    "compilerWorker": "src/runtime/compiler-worker-entry.ts",
    "sandboxWorker": "src/runtime/sandbox-worker-entry.ts"
  },
  "tools": ["fabric_info", "fabric_workspace", "fabric_exec"],
  "mountedProviders": ["artifacts", "memory", "state", "mcp", "local", "fabric"],
  "bundledAgentResources": ["skills/fabric-exec/SKILL.md", "skills/fabric-exec/references/api.md", "skills/fabric-exec/references/recipes.md", "skills/fabric-exec/references/workflow.md", "skills/fabric-exec/references/review.md"],
  "allowedPackageDependencies": [
    "@jitl/quickjs-singlefile-mjs-release-sync",
    "@modelcontextprotocol/sdk",
    "mcporter",
    "quickjs-emscripten-core",
    "typebox",
    "typescript"
  ],
  "forbiddenRuntimeModules": [
    "src/actors/", "src/agents/", "src/capture/", "src/compaction/", "src/components/",
    "src/residency/", "src/schema/", "src/ui/", "src/verification/", "src/worker/",
    "src/worker.ts", "src/runtime/node-process-runtime.ts", "src/runtime/node-process-child-source.ts",
    "src/kiro/acp-process.ts", "src/kiro/acp-worker.ts", "src/kiro/agent-worker-entry.ts",
    "src/kiro/management-entry.ts"
  ]
}
`;
    expect(createHash("sha256").update(productBytes).digest("hex")).toBe("d09991a9c7fe5fe32104c21cfae7e4c35229fe2d50cbc4aef3f9a57b20a392e9");
    put(legacy, "agent-product.json", productBytes);
    fs.unlinkSync(path.join(legacy, "skills/fabric-exec/references/fovea.md"));
    const manifest = JSON.parse(fs.readFileSync(path.join(legacy, "runtime/closure-manifest.json"), "utf8"));
    manifest.files = manifest.files.filter((entry: { path: string }) => !entry.path.startsWith("fovea/") && entry.path !== "kiro/fovea-hook.js");
    delete manifest.foveaEngine; delete manifest.foveaHook; delete manifest.vendoredComponents;
    fs.rmSync(path.join(legacy, "runtime/fovea"), { recursive: true });
    fs.unlinkSync(path.join(legacy, "runtime/kiro/fovea-hook.js"));
    const digest = createHash("sha256");
    for (const entry of manifest.files) digest.update(entry.path).update("\0").update(fs.readFileSync(path.join(legacy, "runtime", entry.path)));
    manifest.contentDigest = digest.digest("hex");
    put(legacy, "runtime/closure-manifest.json", JSON.stringify(manifest));
    expect(validateAgentPackage(legacy).ok).toBe(true);
    const probe = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(path.join(legacy, "scripts/install-agent-user.mjs")).href)});`], { cwd: legacy, encoding: "utf8", timeout: 10000 });
    expect(probe.status, probe.stderr).toBe(0);
    put(legacy, "scripts/unknown.mjs", "export {};"); expect(() => validateAgentPackage(legacy)).toThrow(/installer script/);
    fs.unlinkSync(path.join(legacy, "scripts/unknown.mjs"));
    put(legacy, "scripts/filesystem-boundary.mjs", 'export * from "../src/installation/filesystem-boundary.mjs";');
    expect(() => validateAgentPackage(legacy)).toThrow(/standalone builtin-only/);
  });
  it("reuses before any staging copy and preserves generation inodes", async () => {
    const root = fixture(), first = await buildAgentDev({ root });
    const inode = fs.lstatSync(first.generation).ino;
    const copies = vi.spyOn(fs, "copyFileSync").mockImplementation(() => { throw new Error("must reuse before copy"); });
    const second = await buildAgentDev({ root });
    expect(second.reused).toBe(true); expect(second.generation).toBe(first.generation);
    expect(fs.lstatSync(second.generation).ino).toBe(inode); expect(copies).not.toHaveBeenCalled();
  });
  it("refuses a symlinked digest generation without replacing the stable pointer", async () => {
    const root = fixture(), first = await buildAgentDev({ root }), stable = path.join(root, ".tmp/kiro-fabric-agent");
    const alias = `.kiro-fabric-agent-generation-${"0".repeat(64)}`;
    fs.symlinkSync(path.basename(first.generation), path.join(root, ".tmp", alias), "dir");
    fs.unlinkSync(stable); fs.symlinkSync(alias, stable, "dir");
    expect(() => validateAgentPackage(stable)).toThrow("staging generation is not a regular directory");
    await expect(buildAgentDev({ root })).rejects.toThrow("staging generation is not a regular directory");
    expect(fs.readlinkSync(stable)).toBe(alias);
  });
  it.each(["modify", "delete", "add"])("refuses %s tampering in an existing generation before copy", async mutation => {
    const root = fixture(), first = await buildAgentDev({ root }), stable = path.join(root, ".tmp/kiro-fabric-agent"), previous = fs.readlinkSync(stable);
    const file = path.join(first.generation, "scripts/agent-profile.mjs");
    if (mutation === "modify") fs.appendFileSync(file, "\n");
    if (mutation === "delete") fs.unlinkSync(file);
    if (mutation === "add") put(first.generation, "runtime/extra.js", "foreign");
    const copies = vi.spyOn(fs, "copyFileSync");
    await expect(buildAgentDev({ root })).rejects.toThrow("digest-named staging generation does not match its contents");
    expect(copies).not.toHaveBeenCalled(); expect(fs.readlinkSync(stable)).toBe(previous);
  });
});
