import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixture as bundleFixture } from "./bundle-fixture.js";
import { detectInstallerPlatform } from "../scripts/installer-platform.mjs";

// Isolate the expensive packaging boundary only. The frontend, prerequisite
// execution, manager, backup and candidate-failure reporting remain real.
vi.mock("../scripts/build-complete-bundle.mjs", () => ({ buildCompleteBundle: vi.fn(), findReusableSourceBundle: vi.fn(), sourceProvenance: vi.fn(() => ({ sourceDigest: "a".repeat(64), gitHead: "b".repeat(40) })) }));
vi.mock("../scripts/installer-artifacts.mjs", () => ({ withInstallerArtifactLease: vi.fn() }));
import { buildCompleteBundle, findReusableSourceBundle } from "../scripts/build-complete-bundle.mjs";
import { withInstallerArtifactLease } from "../scripts/installer-artifacts.mjs";
import { runSourceInstaller } from "../scripts/source-install.mjs";

const roots: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findReusableSourceBundle).mockResolvedValue(null);
  vi.mocked(withInstallerArtifactLease).mockImplementation(async (_root, run) => await run());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });

describe("source frontend activation boundary", () => {
  it.each([{ reused: false, releaseFails: false, json: true }, { reused: true, releaseFails: false, json: true }, { reused: true, releaseFails: true, json: true }, { reused: false, releaseFails: false, json: false }, { reused: true, releaseFails: false, json: false }])("leases through activation, skips unused build work and emits one truthful result: %j", async ({ reused, releaseFails, json }) => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "source-installer-contract-"))); roots.push(root); fs.chmodSync(root, 0o700);
    const home = path.join(root, "home"), bin = path.join(root, "bin"), kiroHome = path.join(home, ".kiro"), record = path.join(root, "developer-commands");
    for (const directory of [home, bin, kiroHome]) fs.mkdirSync(directory, { mode: 0o700 });
    fs.writeFileSync(path.join(kiroHome, "settings.json"), "source fixture configuration", { mode: 0o600 });
    fs.writeFileSync(path.join(bin, "kiro-cli"), '#!/bin/sh\nif [ "$1" = --version ]; then printf "kiro-cli 2.21.1\\n"; else printf "%s\\n" --path; fi\n', { mode: 0o700 });
    if (!reused) fs.writeFileSync(path.join(bin, "pnpm"), `#!/bin/sh\ncase "$*" in\n --version) printf '11.20.0\\n' ;;\n 'install --frozen-lockfile'|'run build') printf '%s\\n' "$*" >> '${record}' ;;\n *) exit 91 ;;\nesac\n`, { mode: 0o700 });
    const bundle = await bundleFixture(detectInstallerPlatform().target); roots.push(bundle);
    vi.mocked(buildCompleteBundle).mockResolvedValue({ root: bundle } as Awaited<ReturnType<typeof buildCompleteBundle>>);
    if (reused) vi.mocked(findReusableSourceBundle).mockResolvedValue({ root: bundle } as NonNullable<Awaited<ReturnType<typeof findReusableSourceBundle>>>);
    if (releaseFails) vi.mocked(withInstallerArtifactLease).mockImplementation(async (_root, run) => {
      await run(); throw new Error("fixture lease release interrupted");
    });
    vi.stubEnv("HOME", home); vi.stubEnv("KIRO_HOME", kiroHome); vi.stubEnv("PATH", bin); vi.stubEnv("TMPDIR", root); vi.stubEnv("SHELL", "");
    let stdout = "", stderr = "";
    vi.spyOn(process.stdout, "write").mockImplementation(chunk => { stdout += String(chunk); return true; });
    vi.spyOn(process.stderr, "write").mockImplementation(chunk => { stderr += String(chunk); return true; });
    const code = await runSourceInstaller(["--source", "--yes", "--non-interactive", ...(json ? ["--json"] : []), "--no-shell-integration"]);
    const sourceRoot = fs.realpathSync(fileURLToPath(new URL("..", import.meta.url)));
    expect(findReusableSourceBundle).toHaveBeenCalledWith({ root: sourceRoot });
    expect(withInstallerArtifactLease).toHaveBeenCalledWith(sourceRoot, expect.any(Function));
    if (reused) { expect(buildCompleteBundle).not.toHaveBeenCalled(); expect(fs.existsSync(record)).toBe(false); }
    else { expect(buildCompleteBundle).toHaveBeenCalledWith({ root: sourceRoot, archive: false }); expect(fs.readFileSync(record, "utf8")).toBe("install --frozen-lockfile\nrun build\n"); }
    expect(code).toBe(7);
    if (!json) {
      expect(stdout).toBe(""); expect(stderr.match(/KIRO FABRIC/gu)).toHaveLength(1);
      expect(stderr.indexOf("KIRO FABRIC")).toBeLessThan(stderr.indexOf(reused ? "Reusing verified source bundle" : "Source build:"));
      expect(stderr).toContain("Target version: 1.0.0 (verified bundle)");
      expect(stderr).toContain("Prior configuration backup:");
      return;
    }
    expect(stderr).toBe(""); expect(stdout.trim().split("\n")).toHaveLength(1);
    const result = JSON.parse(stdout); expect(result).toMatchObject({ command: "install", committed: false, recoveryRequired: true, outcome: "recovery-required", configurationBackup: { sourceRoot } });
    expect(fs.readFileSync(path.join(result.configurationBackup.path, "settings.json"), "utf8")).toBe("source fixture configuration");
    expect(fs.readFileSync(path.join(kiroHome, "settings.json"), "utf8")).toBe("source fixture configuration");
    expect(fs.existsSync(path.join(kiroHome, "kiro-fabric/.transactions/candidate.json"))).toBe(true);
  });
});
