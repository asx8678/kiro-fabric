import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { acceptanceBundle } from "./installer-acceptance-fixture.js";
import { inspectCompleteInstallation } from "../scripts/managed-installation.mjs";
import { sha256 } from "../scripts/bundle-contract.mjs";

it.each([{ behavior: "success", verbose: false, legacy: false }, { behavior: "empty-search", verbose: false, legacy: false }, { behavior: "success", verbose: true, legacy: false }, { behavior: "success", verbose: false, legacy: true }] as const)("source frontend reaches backup and real activation with realistic private-node artifact (%j)", async ({ behavior, verbose, legacy }) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "source-frontend-acceptance-"))); fs.chmodSync(root, 0o700);
  try {
    const home = path.join(root, "home"), source = path.join(home, ".kiro"), bin = path.join(root, "bin"), log = path.join(root, "developer-commands");
    for (const directory of [home, source, bin, path.join(source, "scripts"), path.join(source, ".tmp"), path.join(source, "node_modules")]) fs.mkdirSync(directory, { mode: 0o700 });
    const bundle = await acceptanceBundle(path.join(source, ".tmp", "candidate"), behavior);
    expect(fs.statSync(path.join(bundle.root, "tools/node")).size).toBeGreaterThan(64 * 1024 * 1024);
    fs.writeFileSync(path.join(source, "settings.json"), "private fixture configuration", { mode: 0o600 });
    const skill = path.join(source, "skills/fabric-exec/SKILL.md");
    fs.mkdirSync(path.dirname(skill), { recursive: true, mode: 0o700 });
    fs.writeFileSync(skill, "user skill must survive the upgrade\n", { mode: 0o600 });
    const skillIdentity = fs.statSync(skill);
    const oldProfile = '{"name":"kiro-fabric","description":"legacy Fabric"}\n';
    const oldRuntime = path.join(source, ".kiro-fabric/runtime.js"), oldSkill = path.join(source, ".kiro-fabric/skills/custom/SKILL.md");
    if (legacy) {
      fs.mkdirSync(path.join(source, "agents"), { mode: 0o700 });
      fs.mkdirSync(path.dirname(oldSkill), { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(source, "agents/kiro-fabric.json"), oldProfile, { mode: 0o600 });
      fs.writeFileSync(path.join(source, ".kiro-fabric/install.json"), JSON.stringify({ format: 1, owner: "kiro-fabric", scope: "user", profile: { path: "agents/kiro-fabric.json", installedSha256: sha256(oldProfile) } }), { mode: 0o600 });
      fs.writeFileSync(oldRuntime, "retained for existing sessions\n", { mode: 0o600 });
      fs.writeFileSync(oldSkill, "legacy user skill\n", { mode: 0o600 });
    }
    // The source frontend resolves its checkout root script-relatively and reads
    // the packageManager pin from <checkout>/package.json before any build command.
    fs.writeFileSync(path.join(source, "package.json"), JSON.stringify({ packageManager: "pnpm@11.20.0" }), { mode: 0o600 });
    fs.writeFileSync(path.join(bin, "kiro-cli"), '#!/bin/sh\nif [ "$1" = --version ]; then printf "kiro-cli 2.21.1\\n"; else printf "%s\\n" --path; fi\n', { mode: 0o700 });
    fs.writeFileSync(path.join(bin, "pnpm"), `#!/bin/sh\ncase "$*" in\n --version) printf '11.20.0\\n' ;;\n 'install --frozen-lockfile'|'run build') printf '%s\\n' "$*" >> '${log}'; printf 'build stdout\\n'; printf 'build stderr\\n' >&2 ;;\n *) exit 91 ;;\nesac\n`, { mode: 0o700 });
    const entry = path.join(source, "scripts/source-install.mjs");
    // Small local fixture compile only. Replace expensive packaging, not source
    // frontend, manager, backup, smoke transport, activation or result formatting.
    await build({ entryPoints: [new URL("../scripts/source-install.mjs", import.meta.url).pathname], outfile: entry, bundle: true, platform: "node", format: "esm", logLevel: "silent", plugins: [{ name: "fixture-packaging-only", setup(builder) {
      builder.onResolve({ filter: /build-complete-bundle[.]mjs$/ }, () => ({ path: "fixture-packaging", namespace: "acceptance" }));
      builder.onResolve({ filter: /^[.]/ }, args => ({ path: pathToFileURL(path.resolve(args.resolveDir, args.path)).href, external: true }));
      builder.onLoad({ filter: /.*/, namespace: "acceptance" }, () => ({ contents: `
export const sourceProvenance = () => ({sourceDigest:'${"a".repeat(64)}',gitHead:null});
export const findReusableSourceBundle = async () => null;
export const buildCompleteBundle = async options => { if(options.archive !== false || options.root !== ${JSON.stringify(source)}) throw Error('wrong source build boundary'); return {root:${JSON.stringify(bundle.root)}}; };
`, loader: "js" }));
    } }] });
    // esbuild uses the ambient umask; this generated file is backed up as configuration.
    fs.chmodSync(entry, 0o600);
    const result = spawnSync(process.execPath, [entry, "--source", "--yes", "--non-interactive", "--json", ...(verbose ? ["--verbose"] : []), "--no-shell-integration"], { cwd: root, env: { HOME: home, KIRO_HOME: source, PATH: bin, TMPDIR: root, SHELL: "", LANG: "C", LC_ALL: "C" }, encoding: "utf8", timeout: 60000 });
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe(verbose ? "build stdout\nbuild stderr\nbuild stdout\nbuild stderr\n" : ""); expect(result.stdout.trim().split("\n")).toHaveLength(1);
    const output = JSON.parse(result.stdout); expect(output.exitCode).toBe(result.status);
    expect(fs.readFileSync(log, "utf8")).toBe("install --frozen-lockfile\nrun build\n");
    expect(output.configurationBackup, JSON.stringify(output)).toMatchObject({ sourceRoot: source, excludes: expect.arrayContaining([".tmp", "node_modules"]) });
    expect(fs.readFileSync(path.join(output.configurationBackup.path, "settings.json"), "utf8")).toBe("private fixture configuration");
    expect(fs.existsSync(path.join(output.configurationBackup.path, ".tmp"))).toBe(false);
    expect(fs.readFileSync(path.join(source, "settings.json"), "utf8")).toBe("private fixture configuration");
    expect(fs.readFileSync(skill, "utf8")).toBe("user skill must survive the upgrade\n");
    expect(fs.statSync(skill).ino).toBe(skillIdentity.ino);
    expect(fs.readFileSync(path.join(output.configurationBackup.path, "skills/fabric-exec/SKILL.md"), "utf8")).toBe("user skill must survive the upgrade\n");
    const inspection = await inspectCompleteInstallation(source, { verifyGenerations: true });
    if (behavior === "success") {
      expect(output, JSON.stringify(output)).toMatchObject({ committed: true, recoveryRequired: false, exitCode: 0 });
      expect(inspection.status).toBe("active");
      expect(output.warnings.join(" ")).toContain("Authenticated Kiro session and resource loading not tested");
      if (legacy) {
        expect(fs.readFileSync(output.homePreparation.legacyProfileBackup, "utf8")).toBe(oldProfile);
        expect(fs.readFileSync(oldRuntime, "utf8")).toBe("retained for existing sessions\n");
        expect(fs.readFileSync(oldSkill, "utf8")).toBe("legacy user skill\n");
        const profile = JSON.parse(fs.readFileSync(path.join(source, "agents/kiro-fabric.json"), "utf8"));
        expect(profile.mcpServers.fabric.env.KIRO_FABRIC_BUNDLE_ROOT).toBe(path.join(source, "kiro-fabric/runtime", inspection.owner.currentRuntime));
      }
    } else {
      expect(output).toMatchObject({ committed: false, recoveryRequired: true, exitCode: 7 });
      expect(output.error).toContain("checked search"); expect(inspection.status).toBe("recovery-required");
      expect(fs.existsSync(path.join(source, "kiro-fabric/.transactions/candidate.json"))).toBe(true);
    }
  } finally { removeFixtureSync(root, { recursive: true, force: true }); }
}, 90000);
