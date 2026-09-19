import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import childProcess, { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { doctorInstallation } from "../scripts/install-manager.mjs";
import { captureBuildInputs } from "../scripts/build-inputs.mjs";
import { canonical, createBundleManifest, sha256 } from "../scripts/bundle-contract.mjs";
import { inspectSourceComparison, installationGuidance } from "../scripts/installer-diagnostics.mjs";
import { installCompleteGeneration, inspectCompleteInstallation } from "../scripts/managed-installation.mjs";
import { fixture as bundleFixture } from "./bundle-fixture.js";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "installer-diagnostics-"))); roots.push(root); fs.chmodSync(root, 0o700);
  const source = path.join(root, "explicit checkout"), home = path.join(root, "kiro home"), closure = path.join(source, "dist/kiro-agent-closure");
  for (const dir of [source, closure, ...["scripts", "src", "skills", "resources"].map(name => path.join(source, name))]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const file of ["pnpm-lock.yaml", "agent-product.json", "build-toolchain.json", "tsconfig.json", "tsconfig.build.json"]) fs.writeFileSync(path.join(source, file), "{}", { mode: 0o600 });
  fs.writeFileSync(path.join(source, "package.json"), JSON.stringify({ name: "kiro-fabric", version: "1.0.0", scripts: { build: "touch forbidden-build" } }), { mode: 0o600 });
  for (const script of ["build", "build-kiro-closure", "build-inputs", "normalize-artifact-modes", "assert-build-artifacts", "build-agent-dev", "build-complete-bundle", "generate-agent-guidance", "agent-profile", "install-agent-user", "validate-agent-package", "install-manager"]) fs.writeFileSync(path.join(source, "scripts", `${script}.mjs`), 'throw Error("Do not execute this checkout");', { mode: 0o600 });
  fs.writeFileSync(path.join(source, "src/main.ts"), "// source identity fixture", { mode: 0o600 });
  const inputs = captureBuildInputs(source), content = Buffer.from("// inert build fixture"), contentDigest = createHash("sha256").update("main.js\0").update(content).digest("hex");
  fs.writeFileSync(path.join(closure, "main.js"), content, { mode: 0o600 });
  const manifest = { schemaVersion: 1, contentDigest, files: [{ path: "main.js", bytes: content.length, sha256: sha256(content) }], buildInputs: inputs };
  fs.writeFileSync(path.join(closure, "closure-manifest.json"), JSON.stringify(manifest), { mode: 0o600 });
  return { root, source, home, closure, inputs, manifest };
}

describe("explicit read-only source/build/installed diagnostics", () => {
  it("compares verified identities and strict profile bindings without executing checkout code", async () => {
    const f = fixture(), bundle = await bundleFixture(); roots.push(bundle);
    const previous = JSON.parse(fs.readFileSync(path.join(bundle, "bundle-manifest.json"), "utf8"));
    fs.writeFileSync(path.join(bundle, "app/closure-manifest.json"), JSON.stringify(f.manifest));
    const manifest = await createBundleManifest(bundle, { version: previous.version, target: previous.target, compatibility: previous.compatibility, tools: previous.tools, provenance: { ...previous.provenance, sourceDigest: f.inputs.digest } });
    fs.writeFileSync(path.join(bundle, "bundle-manifest.json"), canonical(manifest) + "\n");
    await installCompleteGeneration(bundle, { kiroHome: f.home, provenance: "source", validateCandidate: async () => {} });
    const installation = await inspectCompleteInstallation(f.home), ownerBefore = fs.readFileSync(installation.paths.manifest), profileBefore = fs.readFileSync(installation.paths.profile);
    const result = inspectSourceComparison(f.home, f.source, installation);
    expect(result).toMatchObject({ readOnly: true, source: { sourceDigest: f.inputs.digest }, build: { status: "verified-current" }, comparisons: { sourceToBuild: "match", sourceToInstalled: "match", buildToInstalled: "match" } });
    expect(result.installed.profileBindings).toMatchObject({ command: path.join(installation.paths.runtime, installation.owner!.currentRuntime, "tools/node"), dataRoot: installation.paths.data, tools: ["@fabric/fabric_exec"] });
    expect(fs.readFileSync(installation.paths.manifest)).toEqual(ownerBefore); expect(fs.readFileSync(installation.paths.profile)).toEqual(profileBefore); expect(fs.existsSync(path.join(f.source, "forbidden-build"))).toBe(false);
    const guidance = installationGuidance(f.home, installation); expect(guidance.commands.update).toContain("/path/to/checkout/install.sh"); expect(guidance.commands.update).toContain("--source"); expect(guidance.commands.update).not.toContain(f.source);
  });
  it("retries private-tool timeouts without mutating installation or claiming live readiness", async () => {
    const f = fixture(), bundle = await bundleFixture(); roots.push(bundle);
    await installCompleteGeneration(bundle, { kiroHome: f.home, provenance: "source", validateCandidate: async () => {} });
    const installed = await inspectCompleteInstallation(f.home);
    const ownerBefore = fs.readFileSync(installed.paths.manifest), profileBefore = fs.readFileSync(installed.paths.profile);
    const runtime = path.join(installed.paths.runtime, installed.owner!.currentRuntime);
    const nativeSpawn = childProcess.spawnSync;
    for (const mode of ["recovered", "timeout", "exit"]) {
      const counts = new Map<string, number>();
      const spawn = vi.spyOn(childProcess, "spawnSync").mockImplementation(((file: string, args: string[], options: SpawnSyncOptionsWithStringEncoding) => {
        if (![path.join(runtime, "tools/node"), path.join(runtime, "tools/rg")].includes(file)) return nativeSpawn(file, args, options);
        const count = (counts.get(file) ?? 0) + 1; counts.set(file, count);
        expect(options).toMatchObject({ timeout: 5000, maxBuffer: 4096, env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" } });
        expect(args).toEqual(file.endsWith("/node") ? ["--version"] : ["--no-config", "--version"]);
        const output = { pid: 0, output: [], stdout: "", stderr: "", signal: null };
        if (mode === "exit") return { ...output, status: 7 };
        if (count === 1 || mode === "timeout") return { ...output, status: null, error: Object.assign(new Error("fixture timeout"), { code: "ETIMEDOUT" }) };
        return { ...output, status: 0, stdout: file.endsWith("/node") ? "v24.20.0\n" : "ripgrep 14.1.1\n" };
      }) as typeof childProcess.spawnSync);
      syncBuiltinESMExports();
      const result = await doctorInstallation(f.home, { PATH: "/no-kiro" });
      expect(result.checks.find(check => check.id === "installation")?.status).toBe("PASS");
      for (const tool of ["node", "rg"]) {
        expect(result.checks.find(check => check.id === `private-${tool}`)?.status).toBe(mode === "recovered" ? "PASS" : "FAIL");
        expect(counts.get(path.join(runtime, "tools", tool))).toBe(mode === "exit" ? 1 : 2);
      }
      for (const id of ["authenticated-session", "client-tool-filtering", "elicitation"]) expect(result.checks.find(check => check.id === id)?.status).toBe("NOT TESTED");
      spawn.mockRestore(); syncBuiltinESMExports();
      expect(fs.readFileSync(installed.paths.manifest)).toEqual(ownerBefore);
      expect(fs.readFileSync(installed.paths.profile)).toEqual(profileBefore);
    }
  });
  it("reports stale and absent build identities honestly, never repairs or claims installed equivalence", () => {
    const f = fixture(); fs.appendFileSync(path.join(f.source, "src/main.ts"), " changed");
    const stale = inspectSourceComparison(f.home, f.source, undefined);
    expect(stale.build.status).toBe("unavailable-or-stale"); expect(stale.comparisons).toEqual({ sourceToBuild: "different", sourceToInstalled: "unknown", buildToInstalled: "unknown" });
    fs.unlinkSync(path.join(f.closure, "closure-manifest.json"));
    expect(inspectSourceComparison(f.home, f.source, undefined).build).toMatchObject({ status: "unavailable-or-stale", sourceDigest: null });
    expect(fs.existsSync(f.home)).toBe(false);
  });
  it.each(["source link", "build link", "hardlinked metadata"])('refuses %s rather than following or trusting it', kind => {
    const f = fixture();
    if (kind === "source link") { const link = path.join(f.root, "linked-source"); fs.symlinkSync(f.source, link); expect(() => inspectSourceComparison(f.home, link, undefined)).toThrow(/symlink|symbolic/i); }
    else {
      const file = path.join(f.closure, "closure-manifest.json");
      if (kind === "build link") { const original = path.join(f.root, "original-build"); fs.renameSync(file, original); fs.symlinkSync(original, file); }
      else fs.linkSync(file, path.join(f.root, "linked-metadata"));
      expect(inspectSourceComparison(f.home, f.source, undefined).build).toMatchObject({ status: "unavailable-or-stale", contentDigest: null });
    }
    expect(fs.existsSync(f.home)).toBe(false);
  });
  it("doctor exposes comparisons as JSON even when installation or Kiro is absent", () => {
    const f = fixture(), manager = new URL("../scripts/install-manager.mjs", import.meta.url);
    const result = spawnSync(process.execPath, [manager.pathname, "doctor", "--source-root", f.source, "--kiro-home", f.home, "--json"], { cwd: f.root, env: { HOME: f.root, PATH: "/no-executables", TMPDIR: f.root }, encoding: "utf8", timeout: 10000 });
    expect(result.status).toBe(5); expect(result.stderr).toBe(""); expect(result.stdout.trim().split("\n")).toHaveLength(1);
    const output = JSON.parse(result.stdout); expect(output.sourceComparison).toMatchObject({ build: { status: "verified-current" }, comparisons: { sourceToBuild: "match", sourceToInstalled: "unknown" } });
    expect(output.checks.find((value: { id: string }) => value.id === "authenticated-session").status).toBe("NOT TESTED"); expect(fs.existsSync(f.home)).toBe(false);
  });
  it("keeps release and unknown update guidance separate from explicit source acquisition", () => {
    const f = fixture();
    const release = installationGuidance(f.home, { status: "active", owner: { currentRuntime: "abc" }, generations: [{ digest: "abc", version: "1.0.0", manifest: { provenance: { kind: "release", sourceCommit: "a".repeat(40) } } }] });
    expect(release.commands.update).toMatch(/update --yes$/); expect(release.guidance).toContain("signature verification");
    expect(installationGuidance(f.home, undefined).guidance).toContain("unknown");
  });
});
