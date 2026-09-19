#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// One executable registry for local acceptance and every native CI target.
// Bundle integration deliberately runs only AFTER Main/CI stages real artifacts.
export const INSTALLER_SUITES = Object.freeze({
  contracts: Object.freeze([
    "installer-platform", "installer-probe", "bundle-archive", "release-trust", "release-download", "installer-bootstrap", "source-bootstrap",
    "private-tools", "installer-home", "installer-home-preparation", "installer-configuration-backup", "installer-shell-integration",
    "installer-cli-contract", "installer-presentation", "installer-manager-acceptance", "installer-diagnostics", "installer-profile-publication", "installer-executable-trust", "installer-boundary-regressions",
    "install-manager-start", "launch-profile", "agent-launch-context", "source-installer-contract", "source-frontend-acceptance",
    "installer-smoke-acceptance", "installer-native-zsh-acceptance", "installer-suite-registration", "installer-ci-cache-acceptance",
    "qualification-failure-acceptance", "release-workflow", "release-capture-boundaries", "managed-installation-lifecycle",
    "local-process-group", "local-shell", "local-search-work", "local-executable", "local-provider", "bundle-contract", "bundle-streaming",
    "managed-generation", "managed-generation-efficiency", "source-bundle-stage",
    "installer-cache", "installer-packaging-cache", "installer-archive-stream", "installer-extraction-portability",
    "hermetic-stage", "build-input-provenance", "bundle-sbom-artifacts",
  ]),
  bundle: Object.freeze([
    "installed-independence", "installer-lock", "installer-lock-release", "pinned-recovery", "install-transaction", "managed-installation", "installer-smoke-bundle-acceptance",
  ]),
});
export function installerSuiteFiles(suite = "all") {
  if (suite !== "all" && !Object.hasOwn(INSTALLER_SUITES, suite)) throw new Error("Unknown installer suite; expected contracts, bundle, or all");
  const names = suite === "all" ? Object.values(INSTALLER_SUITES).flat() : INSTALLER_SUITES[suite];
  return names.map(name => `tests/${name}.test.ts`);
}
/** On macOS do not turn the meaningful zsh regression into a silent skip. */
export function requireNativeInstallerShell(platform = process.platform, exists = fs.existsSync) {
  if (platform === "darwin" && !["/bin/zsh", "/usr/bin/zsh"].some(file => exists(file))) throw new Error("Native macOS installer acceptance requires executable zsh");
}
/** @param {string[]} argv
 * @param {{root?:string,run?:(command:string,args:string[],options:import('node:child_process').SpawnSyncOptions)=>{error?:Error,status:number|null}}} [options] */
export function runInstallerTests(argv, { root = fileURLToPath(new URL("..", import.meta.url)), run = spawnSync } = {}) {
  const [action = "run", suite = "all", ...extra] = argv;
  if (!["run", "list"].includes(action) || extra.length) throw new Error("Usage: node scripts/test-installer.mjs [run|list] [contracts|bundle|all]");
  const files = installerSuiteFiles(suite);
  for (const file of files) if (!fs.existsSync(path.join(root, file))) throw new Error(`Registered installer test is missing: ${file}`);
  if (action === "list") { process.stdout.write(files.join("\n") + "\n"); return 0; }
  requireNativeInstallerShell();
  const result = run(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", ...files], { cwd: root, env: process.env, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.exitCode = runInstallerTests(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
}
