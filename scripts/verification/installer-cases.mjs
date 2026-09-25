// Installer behavioral acceptance (N2 / I01-I09) without installing anything.
//
// Every case drives the REAL parser, the REAL frontend control flow and the
// REAL hook/staging helpers, with injected effects for build, activation, hook
// writes and process spawns. No real installation, hook write, shell write,
// build, download or client probe happens here.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runSourceInstaller } from "../source-install.mjs";
import { parseManagerArguments } from "../installer-cli-contract.mjs";
import { configurePullHook } from "../source-pull-hook.mjs";
import { stageSourceBundle } from "../source-bundle-stage.mjs";
import { canonical, sha256, createBundleManifest, validateBundle, compatibilityFor } from "../bundle-contract.mjs";
import { STAGING_PREFIX, identifyStagingRoot, removeSourceActivationStaging } from "../source-staging-cleanup.mjs";
import { snapshotStagingScope, assertStagingScopeUnchanged, assertStagingCallPreserved } from "./staging-preservation-snapshot.mjs";
import { stageWithControlledDrift } from "./staging-copy-boundary.mjs";

export const requiredIds = ["I01", "I02", "I03", "I04", "I05", "I06", "I07", "I08", "I09"];

const REPO_ROOT = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."));

/** @param {any} context @param {string} name */
function fixtureRoot(context, name) {
  const dir = path.join(context.fixturesRoot, name);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Deliberately explicit allowlist: no inherited browser, endpoint or auth vars. */
/** @param {string} root */
function isolatedEnv(root) {
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: path.join(root, "home"),
    TMPDIR: path.join(root, "tmp"),
  };
  for (const dir of [env.HOME, env.TMPDIR]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // The real resolveKiroHome refuses a KIRO_HOME that overlaps the source
  // checkout, so the isolated home must live outside the repository. It is
  // private, 0700, outside the checkout and retained (never cleaned up here).
  env.KIRO_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "verify-kiro-home-"));
  fs.chmodSync(env.KIRO_HOME, 0o700);
  return env;
}

/** Stable bounded tree digest, used to prove a path changed nothing on disk. */
/** @param {string} dir @returns {string} */
function snapshotTree(dir) {
  const hash = createHash("sha256");
  /** @param {string} current @param {string} prefix */
  const walk = (current, prefix) => {
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => (left.name < right.name ? -1 : 1));
    for (const entry of entries) {
      const relative = prefix === "" ? entry.name : prefix + "/" + entry.name;
      hash.update(relative + "|" + String(entry.isDirectory()) + "|" + String(entry.isSymbolicLink()) + "\n");
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) { walk(absolute, relative); continue; }
      if (!entry.isFile()) continue;
      const stats = fs.statSync(absolute);
      if (stats.size < 1024 * 1024) hash.update(fs.readFileSync(absolute));
      else hash.update("size:" + stats.size);
    }
  };
  if (fs.existsSync(dir)) walk(dir, "");
  return hash.digest("hex");
}

/**
 * Temporarily point Git at the isolated fixture environment. configurePullHook
 * spawns real git, which would otherwise read the developer's global config.
 * @param {Record<string,string>} overrides @param {() => any} action
 */
function withEnv(overrides, action) {
  /** @type {Record<string, string|undefined>} */
  const saved = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    process.env[key] = overrides[key];
  }
  try {
    return action();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function readPinnedPnpm() {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const match = /^pnpm@(\S+)$/u.exec(String(manifest.packageManager ?? ""));
  return match === null ? "11.20.0" : match[1];
}

/**
 * Injectable dependency table for the installer frontend. The real parser and
 * real control flow stay in place; only effects are injected.
 * @param {string} root @param {Record<string, any>} [options]
 */
function makeDeps(root, options = {}) {
  const env = isolatedEnv(root);
  const counters = {
    build: 0, reuse: 0, lease: 0, stage: 0, hookPreview: 0, hookWrite: 0,
    preparation: 0, shell: 0, kiroCheck: 0, manager: 0, provenance: 0,
    assertUnprivileged: 0, detectPlatform: 0, spawn: [], stderr: [],
    managerArgv: "", managerOptions: null, presented: null, presentedError: null,
  };
  const bundleRoot = path.join(root, "bundle");
  fs.mkdirSync(bundleRoot, { recursive: true, mode: 0o700 });
  const digestBefore = "a".repeat(64);
  const digestAfter = "b".repeat(64);
  const deps = {
    env,
    userHome: env.HOME,
    nodeVersion: options.nodeVersion ?? "v24.21.0",
    isInteractive: () => options.interactive === true,
    stderr: (/** @type {string} */ text) => { counters.stderr.push(text); },
    tempRoot: () => env.TMPDIR,
    makeTemp: (/** @type {string} */ prefix) => fs.mkdtempSync(path.join(env.TMPDIR, prefix)),
    identifyStaging: identifyStagingRoot,
    removeStaging: removeSourceActivationStaging,
    assertUnprivileged: () => {
      counters.assertUnprivileged += 1;
      if (options.privileged === true) throw new Error("fixture privilege denial");
    },
    detectPlatform: () => { counters.detectPlatform += 1; },
    kiroCheck: () => {
      counters.kiroCheck += 1;
      if (options.kiroMissing === true) throw new Error("fixture missing Kiro CLI");
    },
    planPreparation: () => { counters.preparation += 1; },
    planShell: () => { counters.shell += 1; },
    lease: async (_leaseRoot, action) => { counters.lease += 1; return await action(); },
    findBundle: async () => { counters.reuse += 1; return options.cacheMiss === true ? undefined : { root: bundleRoot }; },
    buildBundle: async () => {
      counters.build += 1;
      if (options.buildFails === true) throw new Error("fixture build failure");
      return { root: bundleRoot };
    },
    provenance: () => {
      counters.provenance += 1;
      const changed = options.provenanceChanged === true && counters.provenance > 1;
      return { sourceDigest: changed ? digestAfter : digestBefore, gitHead: null, dirty: false };
    },
    stageBundle: async (_from, to) => { counters.stage += 1; fs.mkdirSync(to, { recursive: true, mode: 0o700 }); },
    configureHook: (hookRoot, _hookHome, write) => {
      if (write === true) {
        counters.hookWrite += 1;
        if (options.hookWriteFails === true) throw new Error("fixture hook write failure");
      } else {
        counters.hookPreview += 1;
        if (options.hookPreviewFails === true) throw new Error("fixture hook preview failure");
      }
      return path.join(hookRoot, ".git", "hooks", "post-merge");
    },
    parseArguments: parseManagerArguments,
    manager: async (argv, managerOptions) => {
      counters.manager += 1;
      counters.managerArgv = argv.join(" ");
      counters.managerOptions = managerOptions ?? null;
      if (managerOptions && typeof managerOptions.present === "function") managerOptions.present({ committed: true, operationCompleted: true });
      if (managerOptions && typeof managerOptions.afterOperation === "function") await managerOptions.afterOperation();
      return { outcome: "fixture-manager", committed: true };
    },
    presentResult: (result) => { counters.presented = result; return result; },
    presentError: (error) => { counters.presentedError = error; return error.exitCode ?? 5; },
    spawnCommand: (file, args, _spawnOptions) => {
      counters.spawn.push([file, ...args].join(" "));
      if (args.length === 1 && args[0] === "--version") return { status: 0, stdout: readPinnedPnpm() + "\n", stderr: "", error: undefined };
      if (options.buildFails === true) return { status: 1, stdout: "", stderr: "fixture build failure", error: undefined };
      return { status: 0, stdout: "", stderr: "", error: undefined };
    },
  };
  return { deps, counters, bundleRoot, env };
}

/** @param {any} counters */
function totalEffects(counters) {
  return counters.build + counters.reuse + counters.lease + counters.stage +
    counters.hookPreview + counters.hookWrite + counters.preparation +
    counters.shell + counters.kiroCheck + counters.manager + counters.spawn.length;
}

/**
 * Build a structurally valid but deliberately non-functional schema-1 bundle
 * under a retained fixture root. Its manifest is produced and re-validated by
 * the real shared bundle contract, so the staging snapshot/copy/refusal
 * behavior exercised here is the production behavior. These synthetic bytes are
 * staging-only evidence: they are NOT native, downloaded, authenticated or
 * release-qualified bundle contents. Never execute them or stage them into a
 * live home.
 * @param {string} dir @param {{closureBytes?:number}} [options]
 * @returns {Promise<{manifest:any, files:Record<string,[string,string]>, digest:string}>}
 */
export async function buildSyntheticStagingBundle(dir, { closureBytes = 0 } = {}) {
  /** @type {Record<string, [string, string]>} */
  const files = {
    "app/kiro/mcp-entry.js": ["app", "export const kiroMcpEntry = 1;\n"],
    "app/runtime/compiler-worker-entry.js": ["app", "export const compilerWorkerEntry = 1;\n"],
    "app/runtime/sandbox-worker-entry.js": ["app", "export const sandboxWorkerEntry = 1;\n"],
    "app/package.json": ["app", "{ \"name\": \"synthetic-staging-only\" }\n"],
    "app/closure-manifest.json": ["app", "{ \"synthetic\": true }\n"],
    "manager/install-manager.mjs": ["manager", "export const installManager = 1;\n"],
    "resources/steering/fabric.md": ["resource", "# synthetic staging-only steering\n"],
    "resources/skills/fabric-exec/SKILL.md": ["resource", "# synthetic staging-only skill\n"],
    "resources/skills/fabric-exec/references/synthetic.md": ["resource", "# synthetic staging-only reference\n"],
    "notices/node-LICENSE": ["notice", "synthetic staging-only node notice\n"],
    "notices/rg-LICENSE-MIT": ["notice", "synthetic staging-only rg mit notice\n"],
    "notices/rg-COPYING": ["notice", "synthetic staging-only rg copying notice\n"],
    "notices/rg-UNLICENSE": ["notice", "synthetic staging-only rg unlicense notice\n"],
    "tools/node": ["executable", "SYNTHETIC-STAGING-ONLY-NODE\n"],
    "tools/rg": ["executable", "SYNTHETIC-STAGING-ONLY-RG\n"],
  };
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const [relative, [, body]] of Object.entries(files)) {
    const content = relative === "app/closure-manifest.json" && closureBytes > 0 ? "C".repeat(closureBytes) : body;
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, content, { mode: relative.startsWith("tools/") ? 0o700 : 0o600 });
  }
  const member = (relative) => ({ size: fs.statSync(path.join(dir, relative)).size, sha256: sha256(fs.readFileSync(path.join(dir, relative))) });
  const nodeName = "node-v24.20.0-linux-x64";
  const rgName = "ripgrep-14.1.1-x86_64-unknown-linux-musl";
  const nodeBase = "https://nodejs.org/dist/v24.20.0/";
  const rgBase = "https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/";
  const nodeUrl = nodeBase + nodeName + ".tar.gz";
  const rgUrl = rgBase + rgName + ".tar.gz";
  const tools = {
    node: { version: "24.20.0", url: nodeUrl, size: 1000, sha256: "a".repeat(64), checksumUrl: nodeBase + "SHASUMS256.txt", members: [
      { member: nodeName + "/bin/node", path: "tools/node", ...member("tools/node") },
      { member: nodeName + "/LICENSE", path: "notices/node-LICENSE", ...member("notices/node-LICENSE") },
    ] },
    rg: { version: "14.1.1", url: rgUrl, size: 1000, sha256: "b".repeat(64), checksumUrl: rgUrl + ".sha256", members: [
      { member: rgName + "/rg", path: "tools/rg", ...member("tools/rg") },
      { member: rgName + "/LICENSE-MIT", path: "notices/rg-LICENSE-MIT", ...member("notices/rg-LICENSE-MIT") },
      { member: rgName + "/COPYING", path: "notices/rg-COPYING", ...member("notices/rg-COPYING") },
      { member: rgName + "/UNLICENSE", path: "notices/rg-UNLICENSE", ...member("notices/rg-UNLICENSE") },
    ] },
  };
  const manifest = await createBundleManifest(dir, {
    version: "1.0.0", target: "linux-x64", compatibility: compatibilityFor("linux-x64", 1),
    provenance: { kind: "local-source", sourceDigest: "c".repeat(64), gitHead: null, dirty: false },
    tools, schema: 1,
  });
  fs.writeFileSync(path.join(dir, "bundle-manifest.json"), canonical(manifest) + "\n", { mode: 0o600 });
  return { manifest, files, digest: manifest.digest };
}

export function createCases() {
  return [
    {
      id: "I01",
      title: "help path mutates nothing",
      effects: "real parser and real frontend flow; injected manager; no install, build, hook or shell write",
      run: async (context) => {
        const root = fixtureRoot(context, "I01-help");
        const { deps, counters } = makeDeps(root);
        const before = snapshotTree(root);
        const outcome = await runSourceInstaller(["--source", "--help"], deps);
        const after = snapshotTree(root);
        assert.equal(counters.manager, 1, "help must be delegated to the manager exactly once");
        assert.equal(counters.managerArgv, "install --help --migrate-pi-fabric");
        assert.equal(counters.presentedError, null, "help must not report a failure");
        assert.ok(outcome && outcome.outcome === "fixture-manager", "help must return the manager result unchanged");
        assert.equal(totalEffects(counters) - counters.manager, 0, "help must not build, activate, hook or spawn");
        assert.equal(after, before, "help must not change the fixture tree");
        // The shell frontend must reach the same non-mutating help path. HOME,
        // KIRO_HOME and TMPDIR are isolated for the child.
        const shellRoot = fixtureRoot(context, "I01-shell-help");
        const shellEnv = isolatedEnv(shellRoot);
        const shellHelp = context.spawn("bash", [path.join(REPO_ROOT, "install.sh"), "--source", "--help"], { cwd: REPO_ROOT, env: shellEnv });
        assert.equal(shellHelp.spawnError, null, "the shell frontend must spawn: " + String(shellHelp.spawnError));
        assert.equal(shellHelp.code, 0, "install.sh --source --help must exit zero; stderr: " + shellHelp.stderr.slice(-400));
        assert.ok(shellHelp.stdout.length > 80, "the help path must print usage text");
        assert.deepEqual(fs.readdirSync(shellEnv.HOME), [], "help must not populate the isolated home");
        assert.deepEqual(fs.readdirSync(shellEnv.KIRO_HOME), [], "help must not populate the isolated KIRO_HOME");
        return { managerArgv: counters.managerArgv, treeUnchanged: after === before, shellHelpExit: shellHelp.code, isolatedHomeUntouched: true };
      },
    },
    {
      id: "I02",
      title: "usage refusals happen before any effect",
      effects: "real parser only; injected manager; no build, activation, hook or spawn",
      run: async (context) => {
        const scenarios = [
          { name: "missing-source", args: [], expect: "exactly one explicit --source" },
          { name: "duplicate-source", args: ["--source", "--source"], expect: "exactly one explicit --source" },
          { name: "duplicate-hook-flag", args: ["--source", "--enable-pull-hook", "--enable-pull-hook"], expect: "Duplicate --enable-pull-hook" },
          { name: "unknown-flag", args: ["--source", "--bogus-flag"], expect: "Unknown or duplicate option" },
          { name: "archive-conflict", args: ["--source", "--yes", "--from-archive", "pkg.tgz"], expect: "--source cannot be combined" },
          { name: "version-conflict", args: ["--source", "--yes", "--version", "1.2.3"], expect: "--source cannot be combined" },
        ];
        const observed = [];
        for (const scenario of scenarios) {
          const root = fixtureRoot(context, "I02-" + scenario.name);
          const { deps, counters } = makeDeps(root);
          await runSourceInstaller(scenario.args, deps);
          assert.ok(counters.presentedError, scenario.name + " must return a structured failure");
          const message = String(counters.presentedError.message ?? "");
          assert.ok(message.includes(scenario.expect), scenario.name + " expected " + scenario.expect + " but saw " + message);
          assert.equal(counters.presentedError.exitCode, 2, scenario.name + " must stay a usage failure");
          assert.equal(totalEffects(counters), 0, scenario.name + " must not reach any effect");
          observed.push({ scenario: scenario.name, exitCode: counters.presentedError.exitCode, message: message.slice(0, 70) });
        }
        return { scenarios: observed };
      },
    },

    {
      id: "I03",
      title: "consent and prerequisite denials stop before mutation",
      effects: "real parser and prerequisite order; injected manager; no build, activation, hook or spawn",
      run: async (context) => {
        const scenarios = [
          { name: "missing-consent", args: ["--source"], options: {}, expect: "requires --yes", exitCode: 2 },
          { name: "old-node", args: ["--source", "--yes"], options: { nodeVersion: "v20.11.0" }, expect: "Source mode requires Node >=24", exitCode: 4 },
          { name: "privileged", args: ["--source", "--yes"], options: { privileged: true }, expect: "fixture privilege denial", exitCode: 5 },
          { name: "no-kiro", args: ["--source", "--yes"], options: { kiroMissing: true }, expect: "fixture missing Kiro CLI", exitCode: 5 },
        ];
        const observed = [];
        for (const scenario of scenarios) {
          const root = fixtureRoot(context, "I03-" + scenario.name);
          const { deps, counters } = makeDeps(root, scenario.options);
          const before = snapshotTree(root);
          const outcome = await runSourceInstaller(scenario.args, deps);
          assert.ok(counters.presentedError, scenario.name + " must report a structured failure");
          const message = String(counters.presentedError.message ?? "");
          assert.ok(message.includes(scenario.expect), scenario.name + " expected " + scenario.expect + " but saw " + message);
          assert.equal(outcome, scenario.exitCode, scenario.name + " must map to exit code " + scenario.exitCode);
          assert.equal(counters.manager + counters.build + counters.reuse + counters.lease + counters.stage + counters.hookPreview + counters.hookWrite + counters.spawn.length, 0, scenario.name + " must not reach build, activation, hook or spawn");
          assert.equal(snapshotTree(root), before, scenario.name + " must not change the fixture tree");
          observed.push({ scenario: scenario.name, exitCode: outcome, message: message.slice(0, 70), prerequisitesChecked: counters.assertUnprivileged, preparation: counters.preparation });
        }
        return { scenarios: observed };
      },
    },
    {
      id: "I04",
      title: "isolated dry-run previews without any mutation",
      effects: "real parser and real KIRO_HOME resolution against the isolated env; injected manager; no build, activation, hook or spawn",
      run: async (context) => {
        const root = fixtureRoot(context, "I04-dry-run");
        const { deps, counters, env } = makeDeps(root);
        const before = snapshotTree(root);
        await runSourceInstaller(["--source", "--dry-run", "--json"], deps);
        assert.equal(counters.presentedError, null, "the dry-run preview must not fail: " + String(counters.presentedError && counters.presentedError.message));
        assert.equal(counters.manager, 1, "dry-run must reach the manager preview exactly once");
        assert.equal(counters.managerOptions.source, true, "the preview must be marked as a source install");
        assert.equal(counters.managerOptions.sourceRoot, REPO_ROOT, "the preview must carry the real checkout root");
        assert.ok(counters.managerArgv.includes("--dry-run"), "the preview must stay a dry run");
        assert.equal(totalEffects(counters) - counters.manager, 0, "dry-run must not build, activate, hook or spawn");
        assert.equal(counters.preparation, 0, "dry-run must not plan home preparation");
        assert.equal(snapshotTree(root), before, "dry-run must not change the fixture tree");
        assert.equal(fs.existsSync(env.KIRO_HOME), true, "the isolated KIRO_HOME fixture must pre-exist for real resolution");
        assert.equal(fs.existsSync(path.join(env.HOME, ".kiro")), false, "KIRO_HOME resolution must not fall back to or create HOME/.kiro");
        return { managerArgv: counters.managerArgv, sourceRootMatchesCheckout: counters.managerOptions.sourceRoot === REPO_ROOT, kiroHomeCreated: false };
      },
    },
    {
      id: "I05",
      title: "bundle reuse skips the build and a cache miss uses the pinned toolchain in order",
      effects: "injected lease, bundle lookup, build and spawn; no real build, install or download",
      run: async (context) => {
        const reuseRoot = fixtureRoot(context, "I05-reuse");
        const reuse = makeDeps(reuseRoot);
        await runSourceInstaller(["--source", "--yes"], reuse.deps);
        assert.equal(reuse.counters.presentedError, null, "reuse must not fail: " + String(reuse.counters.presentedError && reuse.counters.presentedError.message));
        assert.equal(reuse.counters.manager, 1, "a reused bundle must still activate");
        assert.equal(reuse.counters.build, 0, "a reused bundle must not rebuild");
        assert.deepEqual(reuse.counters.spawn, [], "a reused bundle must not run pnpm");
        assert.equal(reuse.counters.lease, 1, "the artifact lease must cover activation");
        const missRoot = fixtureRoot(context, "I05-miss");
        const miss = makeDeps(missRoot, { cacheMiss: true });
        await runSourceInstaller(["--source", "--yes"], miss.deps);
        assert.equal(miss.counters.presentedError, null, "a cache miss must not fail: " + String(miss.counters.presentedError && miss.counters.presentedError.message));
        assert.equal(miss.counters.build, 1, "a cache miss must build exactly once");
        assert.equal(miss.counters.manager, 1, "a cache miss must still activate");
        const commands = miss.counters.spawn;
        assert.ok(commands.length >= 3, "a cache miss must probe pnpm then install and build: " + commands.join(" | "));
        assert.ok(commands[0].startsWith("pnpm --version"), "the pinned toolchain must be verified first: " + commands[0]);
        assert.equal(commands[1], "pnpm install --frozen-lockfile", "dependency install must precede the build");
        assert.equal(commands[2], "pnpm run build", "the build must follow the frozen install");
        return { reuse: { build: reuse.counters.build, spawns: reuse.counters.spawn.length }, cacheMiss: { build: miss.counters.build, commands } };
      },
    },

    {
      id: "I06",
      title: "source drift or a failed build stops before activation and retains artifacts",
      effects: "injected lease, provenance and build; no real build, install or download; incomplete fixture artifacts retained",
      run: async (context) => {
        const driftRoot = fixtureRoot(context, "I06-drift");
        const drift = makeDeps(driftRoot, { provenanceChanged: true });
        await runSourceInstaller(["--source", "--yes"], drift.deps);
        assert.ok(drift.counters.presentedError, "source drift must fail closed");
        assert.equal(drift.counters.presentedError.exitCode, 5, "source drift must be a conflict");
        assert.ok(String(drift.counters.presentedError.message).includes("changed during build/reuse"), "drift must be named: " + drift.counters.presentedError.message);
        assert.equal(drift.counters.manager, 0, "drift must not activate");
        assert.equal(fs.existsSync(drift.bundleRoot), true, "incomplete artifacts must be retained for inspection");
        const failRoot = fixtureRoot(context, "I06-build-failure");
        const failed = makeDeps(failRoot, { cacheMiss: true, buildFails: true });
        await runSourceInstaller(["--source", "--yes"], failed.deps);
        assert.ok(failed.counters.presentedError, "a failed build must fail closed");
        assert.equal(failed.counters.presentedError.exitCode, 4, "a failed build must be a prerequisite failure");
        assert.equal(failed.counters.manager, 0, "a failed build must not activate");
        assert.equal(failed.counters.lease, 1, "the lease must be attempted exactly once");
        assert.equal(fs.existsSync(failed.bundleRoot), true, "the build root must be retained");
        return { drift: { exitCode: drift.counters.presentedError.exitCode, manager: drift.counters.manager }, buildFailure: { exitCode: failed.counters.presentedError.exitCode, manager: failed.counters.manager } };
      },
    },
    {
      id: "I07",
      title: "source staging refuses unsafe targets without writing and copies valid bundles",
      effects: "real staging validator, copy and directory-ancestry guards on a structurally valid synthetic schema-1 staging-only bundle; deterministic test-controlled copy boundary; tiny synthetic bytes; no execution, install, download, build, genuine, activation or native evidence",
      run: async (context) => {
        const root = fixtureRoot(context, "I07-staging");
        // Every call covers the entire I07 tree plus a shallow metadata/name
        // inventory of the owned fixturesRoot. Never traverse sibling fixtures
        // or unrelated repository/home ancestors. Actual output additions alone
        // justify direct-parent nlink/size/mtime/ctime changes, not mode/identity.
        const rootScope = () => snapshotStagingScope(root, {
          boundaryRoot: context.fixturesRoot, inventoryParent: true,
          maxEntries: 8192, maxBytes: 32 * 1024 * 1024,
        });
        const assertRootPreserved = (before, label, options) => assertStagingCallPreserved(before, rootScope(), label, options);
        let refusals = 0;
        const filesIn = (dir) => {
          const found = [];
          const walk = (current, prefix) => {
            for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
              const relative = prefix === "" ? entry.name : prefix + "/" + entry.name;
              if (entry.isDirectory()) walk(path.join(current, entry.name), relative);
              else found.push(relative);
            }
          };
          if (fs.existsSync(dir)) walk(dir, "");
          return found.sort();
        };

        // Kept from the original case: early usage refusals must not create output.
        const source = path.join(root, "source");
        fs.mkdirSync(source, { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(source, "payload.txt"), "synthetic\n", { mode: 0o600 });
        const nonCanonical = root + "/staging/../out";
        const nonCanonicalScope = rootScope();
        await assert.rejects(() => stageSourceBundle(source, nonCanonical), /canonical absolute/u);
        assert.equal(fs.existsSync(path.join(root, "out")), false, "a refused staging must not create output");
        assertRootPreserved(nonCanonicalScope, "a non-canonical target must not alter its source or any sibling");
        refusals += 1;
        const relativeScope = rootScope();
        await assert.rejects(() => stageSourceBundle(source, "relative-out"), /canonical absolute/u);
        assertRootPreserved(relativeScope, "a relative target must not alter its source or any sibling");
        refusals += 1;
        const invalidSource = path.join(root, "not-a-bundle");
        fs.mkdirSync(invalidSource, { recursive: true, mode: 0o700 });
        const validTarget = path.join(root, "staged-out");
        const invalidSourceScope = rootScope();
        await assert.rejects(() => stageSourceBundle(invalidSource, validTarget));
        assert.equal(fs.existsSync(validTarget), false, "an invalid source must not create a staging root");
        assertRootPreserved(invalidSourceScope, "an invalid source must not alter its source or any sibling");
        refusals += 1;

        // Positive control: a real validator-passing staging-only bundle copies
        // byte-for-byte, preserves modes and re-validates to the same digest.
        const bundle = await buildSyntheticStagingBundle(path.join(root, "synthetic-bundle"));
        const bundleBefore = snapshotStagingScope(path.join(root, "synthetic-bundle"));
        const stagedRoot = path.join(root, "synthetic-staged");
        const positiveScope = rootScope();
        const staged = await stageSourceBundle(path.join(root, "synthetic-bundle"), stagedRoot);
        assert.equal(staged.digest, bundle.digest, "staging must reproduce the source bundle digest");
        assert.equal((await validateBundle(stagedRoot)).digest, bundle.digest, "staged bytes must revalidate under the real contract");
        assertStagingScopeUnchanged(bundleBefore, snapshotStagingScope(path.join(root, "synthetic-bundle")), "a successful staging must not change its source bytes or metadata");
        assert.equal(fs.statSync(path.join(root, "synthetic-bundle", "app/package.json")).mode & 0o777, 0o600, "the source bundle member mode must be preserved");
        const stagedRootStat = fs.lstatSync(stagedRoot);
        assert.equal(stagedRootStat.mode & 0o777, 0o700, "the staged destination root must be private 0700");
        assert.equal(stagedRootStat.uid, process.getuid(), "the staged destination root must be owned by the staging user");
        assert.deepEqual(filesIn(stagedRoot), [...Object.keys(bundle.files), "bundle-manifest.json"].sort(), "staging must copy exactly the bundle members and manifest");
        for (const [relative, [role, body]] of Object.entries(bundle.files)) {
          const expected = relative === "app/closure-manifest.json" ? body : body;
          const stagedMemberStat = fs.statSync(path.join(stagedRoot, relative));
          assert.equal(fs.readFileSync(path.join(stagedRoot, relative), "utf8"), expected, "staged bytes must match the source for " + relative);
          assert.equal(stagedMemberStat.mode & 0o777, role === "executable" ? 0o700 : 0o600, "staged mode must match the role for " + relative);
          assert.equal(stagedMemberStat.nlink, 1, "a staged member must have exactly one link: " + relative);
          assert.equal(stagedMemberStat.uid, process.getuid(), "a staged member must be owned by the staging user: " + relative);
        }
        const stagedManifestStat = fs.statSync(path.join(stagedRoot, "bundle-manifest.json"));
        assert.equal(stagedManifestStat.mode & 0o777, 0o600, "the staged manifest must stay private");
        assert.equal(stagedManifestStat.nlink, 1, "the staged manifest must have exactly one link");
        assertRootPreserved(positiveScope, "a successful staging must add only the intended output subtree", { allowedAddedPrefixes: [path.basename(stagedRoot)] });

        // Overlap must refuse before writing, in both containment directions.
        const overlapSource = path.join(root, "overlap-src");
        await buildSyntheticStagingBundle(overlapSource);
        const overlapBefore = snapshotStagingScope(overlapSource);
        const overlapParentBefore = snapshotStagingScope(root, { maxEntries: 1024 });
        const overlapInsideScope = rootScope();
        await assert.rejects(() => stageSourceBundle(overlapSource, path.join(overlapSource, "stage")), /disjoint/u);
        assert.equal(fs.existsSync(path.join(overlapSource, "stage")), false, "an output inside the source must not be created");
        assertStagingScopeUnchanged(overlapBefore, snapshotStagingScope(overlapSource), "a refused overlap must not change the source bytes or metadata");
        assertStagingScopeUnchanged(overlapParentBefore, snapshotStagingScope(root, { maxEntries: 1024 }), "a refused overlap must not write beside the source");
        assertRootPreserved(overlapInsideScope, "a refused inside-source overlap must not alter any fixture beside it");
        refusals += 1;
        const outer = path.join(root, "overlap-outer");
        fs.mkdirSync(outer, { recursive: true, mode: 0o700 });
        const innerBundle = path.join(outer, "bundle");
        await buildSyntheticStagingBundle(innerBundle);
        const outerBefore = snapshotStagingScope(outer);
        const overlapOuterScope = rootScope();
        await assert.rejects(() => stageSourceBundle(innerBundle, outer), /disjoint/u);
        assertStagingScopeUnchanged(outerBefore, snapshotStagingScope(outer), "an output containing the source must be refused without any writes beside it");
        assertRootPreserved(overlapOuterScope, "an output containing the source must not alter any fixture beside it");
        refusals += 1;

        // An existing destination (directory, file or symlink) is preserved, not replaced.
        const destinationSource = path.join(root, "destination-src");
        await buildSyntheticStagingBundle(destinationSource);
        const destinationSourceBefore = snapshotStagingScope(destinationSource);
        const destinationDirectory = path.join(root, "destination-dir");
        fs.mkdirSync(destinationDirectory, { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(destinationDirectory, "sentinel.txt"), "keep\n", { mode: 0o600 });
        const destinationDirectoryBefore = snapshotStagingScope(destinationDirectory);
        const destinationDirectoryScope = rootScope();
        await assert.rejects(() => stageSourceBundle(destinationSource, destinationDirectory), /Pinned directory|EEXIST/u);
        assertStagingScopeUnchanged(destinationDirectoryBefore, snapshotStagingScope(destinationDirectory), "an existing destination directory must be preserved byte-for-byte and metadata-for-metadata");
        assertRootPreserved(destinationDirectoryScope, "a refused existing directory destination must not alter any sibling");
        refusals += 1;
        const destinationFile = path.join(root, "destination-file");
        fs.writeFileSync(destinationFile, "keep\n", { mode: 0o600 });
        const destinationFileBefore = snapshotStagingScope(destinationFile);
        const destinationFileScope = rootScope();
        await assert.rejects(() => stageSourceBundle(destinationSource, destinationFile), /Pinned directory|EEXIST/u);
        assertStagingScopeUnchanged(destinationFileBefore, snapshotStagingScope(destinationFile), "an existing destination file must be preserved including mode and identity");
        assertRootPreserved(destinationFileScope, "a refused existing file destination must not alter any sibling");
        refusals += 1;
        const symlinkTarget = path.join(root, "symlink-target");
        fs.mkdirSync(symlinkTarget, { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(symlinkTarget, "sentinel.txt"), "keep\n", { mode: 0o600 });
        const symlinkDestination = path.join(root, "symlink-destination");
        fs.symlinkSync(symlinkTarget, symlinkDestination, "dir");
        const symlinkTargetBefore = snapshotStagingScope(symlinkTarget);
        const symlinkDestinationBefore = snapshotStagingScope(symlinkDestination);
        const symlinkDestinationScope = rootScope();
        await assert.rejects(() => stageSourceBundle(destinationSource, symlinkDestination), /Pinned directory|EEXIST/u);
        assertStagingScopeUnchanged(symlinkTargetBefore, snapshotStagingScope(symlinkTarget), "a symlinked destination target must not be followed or corrupted");
        assertStagingScopeUnchanged(symlinkDestinationBefore, snapshotStagingScope(symlinkDestination), "a symlinked destination link must be preserved exactly");
        assertStagingScopeUnchanged(destinationSourceBefore, snapshotStagingScope(destinationSource), "a refused preexisting destination must not change its source");
        assertRootPreserved(symlinkDestinationScope, "a refused symlink destination must not alter any sibling");
        refusals += 1;

        // A symlinked parent must fail the ancestry guard before any effect.
        const realParent = path.join(root, "real-parent");
        fs.mkdirSync(realParent, { recursive: true, mode: 0o700 });
        const aliasParent = path.join(root, "alias-parent");
        fs.symlinkSync(realParent, aliasParent, "dir");
        const realParentBefore = snapshotStagingScope(realParent);
        const aliasParentBefore = snapshotStagingScope(aliasParent);
        const aliasParentScope = rootScope();
        await assert.rejects(() => stageSourceBundle(destinationSource, path.join(aliasParent, "out")), /Unsafe directory ancestry/u);
        assert.equal(fs.existsSync(path.join(realParent, "out")), false, "a refused symlinked parent must not create output");
        assertStagingScopeUnchanged(realParentBefore, snapshotStagingScope(realParent), "a refused symlinked parent must not write through the alias");
        assertStagingScopeUnchanged(aliasParentBefore, snapshotStagingScope(aliasParent), "a refused symlinked parent link must be preserved exactly");
        assertRootPreserved(aliasParentScope, "a refused symlinked parent must not alter any sibling");
        refusals += 1;

        // Mid-copy input drift must refuse and retain the incomplete private
        // output. A test-controlled loader boundary pauses the REAL pinned copy
        // deterministically: no polling, sleeps or oversized members are used.
        const driftSource = path.join(root, "drift-src");
        await buildSyntheticStagingBundle(driftSource);
        const driftOutput = path.join(root, "drift-out");
        const driftManifest = path.join(driftSource, "bundle-manifest.json");
        const driftScope = rootScope();
        const driftResult = await stageWithControlledDrift({
          source: driftSource,
          output: driftOutput,
          member: "manager/install-manager.mjs",
          mutate: () => {
            const original = fs.readFileSync(driftManifest);
            const tampered = Buffer.from(original);
            tampered[tampered.length - 1] ^= 0x01;
            fs.writeFileSync(driftManifest, tampered, { mode: 0o600 });
          },
        });
        assert.equal(driftResult.boundaryReached, true, "the deterministic copy boundary must be reached by control flow");
        assert.equal(driftResult.status, "rejected", "mid-copy drift must reject");
        assert.match(String(driftResult.error && driftResult.error.message), /Source changed during private staging/u, "mid-copy drift must be named: " + String(driftResult.error && driftResult.error.message));
        assert.equal(fs.existsSync(driftOutput), true, "incomplete private staging output must be retained for inspection");
        await assert.rejects(() => validateBundle(driftOutput), undefined, "tampered incomplete output must never revalidate");
        assertRootPreserved(driftScope, "a detected mid-copy drift must add only the retained output and the intended source mutation", { allowedAddedPrefixes: [path.basename(driftOutput)], allowedChanged: [{ path: "drift-src/bundle-manifest.json", fields: ["sha256", "mtimeNs", "ctimeNs"] }] });
        refusals += 1;

        // Genuine complete-bundle admission belongs to the mandatory activation
        // matrix. I07 stays a staging-only synthetic case: it has no cross-case
        // compile dependency, no optional build and no swallowed helper errors.
        return {
          refusals,
          refusalClasses: ["non-canonical", "relative", "invalid-source", "overlap-inside", "overlap-contains", "existing-dir", "existing-file", "existing-symlink", "symlinked-parent", "mid-copy-drift"],
          positive: {
            syntheticDigestEqual: true,
            syntheticSchema: 1,
            fixtureKind: "structurally-valid synthetic schema-1 staging-only; not native, downloaded, authenticated, genuine, activation or release-qualified evidence",
            copyBoundary: "deterministic test-controlled loader boundary; no polling, sleeps or oversized members",
            preservation: "bounded full-byte + dev/ino/mode/uid/gid/nlink/size/mtimeNs/ctimeNs/link-target tree snapshots; pinned canonical ancestry within fixturesRoot and shallow owned-parent metadata/name inventory; excludes atime, ACL/xattr and atomic-snapshot claims",
          },
          positiveSource: "synthetic",
          retainedFixture: root,
        };
      },
    },
    {
      id: "I08",
      title: "pull-hook preflight and post-activation failure stay truthful",
      effects: "real configurePullHook on retained fixture repositories; injected manager and hookPreview/hookWrite; no real activation or shell change",
      run: async (context) => {
        const root = fixtureRoot(context, "I08-hook");
        const env = isolatedEnv(root);
        const gitEnv = { PATH: env.PATH, HOME: env.HOME, GIT_CONFIG_NOSYSTEM: "1" };
        const elsewhere = path.join(root, "elsewhere");
        fs.mkdirSync(elsewhere, { recursive: true, mode: 0o700 });
        assert.throws(() => configurePullHook(root, elsewhere, false), /requires checkout exactly at KIRO_HOME/u);
        assert.throws(() => configurePullHook(root, root, false), /repository root/u);
        // Retained fixtures must stay re-runnable, so each hook repository gets a fresh root.
        const repo = fs.mkdtempSync(path.join(root, "repo-"));
        fs.chmodSync(repo, 0o700);
        const init = context.spawn("git", ["init", "--quiet", repo], { env: gitEnv });
        assert.equal(init.ok, true, "fixture git init failed: " + init.stderr);
        const target = withEnv(gitEnv, () => configurePullHook(repo, repo, false));
        assert.equal(fs.existsSync(target), false, "a preview must not create the hook");
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        fs.writeFileSync(target, "#!/bin/sh\necho foreign\n", { mode: 0o700 });
        const foreign = fs.readFileSync(target);
        assert.throws(() => withEnv(gitEnv, () => configurePullHook(repo, repo, false)), /preserved/u);
        assert.deepEqual(fs.readFileSync(target), foreign, "a foreign hook must not be modified");
        fs.rmSync(target, { force: true });
        withEnv(gitEnv, () => configurePullHook(repo, repo, true));
        const stats = fs.statSync(target);
        assert.equal(stats.mode & 0o777, 0o700, "the hook must be created 0700");
        assert.ok(fs.readFileSync(target, "utf8").includes("--source"), "the hook must invoke the documented source frontend");
        withEnv(gitEnv, () => configurePullHook(repo, repo, true));
        const other = fs.mkdtempSync(path.join(root, "repo-hookspath-"));
        fs.chmodSync(other, 0o700);
        context.spawn("git", ["init", "--quiet", other], { env: gitEnv });
        context.spawn("git", ["-C", other, "config", "core.hooksPath", ".githooks"], { env: gitEnv });
        assert.throws(() => withEnv(gitEnv, () => configurePullHook(other, other, false)), /hooksPath/u);
        const lateRoot = fixtureRoot(context, "I08-late-failure");
        const late = makeDeps(lateRoot, { hookWriteFails: true });
        await runSourceInstaller(["--source", "--yes", "--enable-pull-hook"], late.deps);
        assert.ok(late.counters.presentedError, "a late hook failure must be reported");
        assert.equal(late.counters.manager, 1, "the activation must have completed before the late failure");
        assert.equal(late.counters.presentedError.committed, true, "a completed activation must stay committed after a late failure");
        assert.equal(late.counters.presentedError.recoveryRequired, true, "a late failure must require recovery");
        assert.equal(late.counters.presentedError.operationCompleted, true, "the operation itself did complete");
        const previewRoot = fixtureRoot(context, "I08-preview-failure");
        const preview = makeDeps(previewRoot, { hookPreviewFails: true });
        await runSourceInstaller(["--source", "--yes", "--enable-pull-hook"], preview.deps);
        assert.ok(preview.counters.presentedError, "a preview failure must be reported");
        assert.equal(preview.counters.manager, 0, "a preview failure must stop before activation");
        return { foreignHookPreserved: true, hookMode: "0700", lateFailure: { committed: late.counters.presentedError.committed, recoveryRequired: late.counters.presentedError.recoveryRequired }, previewStoppedActivation: preview.counters.manager === 0, retainedFixtures: [repo, other] };
      },
    },
    {
      id: "I09",
      title: "guarded staging cleanup removes only positively identified staging roots",
      effects: "real cleanup helper on suite fixture directories; exactly one real removal of an owned staging dir; repository-metadata fixtures are retained forever",
      run: async (context) => {
        const root = fixtureRoot(context, "I09-cleanup");
        const tmpRoot = path.join(root, "tmp");
        fs.mkdirSync(tmpRoot, { recursive: true, mode: 0o700 });
        const owned = fs.mkdtempSync(path.join(tmpRoot, STAGING_PREFIX));
        fs.chmodSync(owned, 0o700);
        fs.writeFileSync(path.join(owned, "payload.txt"), "staging\n", { mode: 0o600 });
        const ownedResult = removeSourceActivationStaging({ path: owned, identity: identifyStagingRoot(owned), tmpRoot });
        assert.equal(ownedResult.removed, true, "an owned staging root must be removable: " + String(ownedResult.reason));
        assert.equal(fs.existsSync(owned), false, "the owned staging root must be gone");
        const sibling = path.join(tmpRoot, "keep-me");
        fs.mkdirSync(sibling, { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(sibling, "sentinel.txt"), "keep\n", { mode: 0o600 });
        const wrongPrefix = path.join(tmpRoot, "not-a-staging-root");
        fs.mkdirSync(wrongPrefix, { recursive: true, mode: 0o700 });
        const outside = fs.mkdtempSync(path.join(root, STAGING_PREFIX));
        fs.chmodSync(outside, 0o700);
        const identityMismatch = fs.mkdtempSync(path.join(tmpRoot, STAGING_PREFIX));
        fs.chmodSync(identityMismatch, 0o700);
        const worktreeLike = fs.mkdtempSync(path.join(tmpRoot, STAGING_PREFIX));
        fs.chmodSync(worktreeLike, 0o700);
        fs.writeFileSync(path.join(worktreeLike, ".git"), "gitdir: /nonexistent\n", { mode: 0o600 });
        const bareLike = fs.mkdtempSync(path.join(tmpRoot, STAGING_PREFIX));
        fs.chmodSync(bareLike, 0o700);
        for (const entry of ["HEAD", "objects", "refs"]) fs.mkdirSync(path.join(bareLike, entry), { mode: 0o700 });
        const symlinked = fs.mkdtempSync(path.join(tmpRoot, STAGING_PREFIX));
        fs.chmodSync(symlinked, 0o700);
        fs.symlinkSync(sibling, path.join(symlinked, "escape"));
        const retained = [
          removeSourceActivationStaging({ path: wrongPrefix, identity: identifyStagingRoot(wrongPrefix), tmpRoot }),
          removeSourceActivationStaging({ path: outside, identity: identifyStagingRoot(outside), tmpRoot }),
          removeSourceActivationStaging({ path: identityMismatch, identity: { dev: "0", ino: "0", mode: 0o700, uid: process.getuid() }, tmpRoot }),
          removeSourceActivationStaging({ path: worktreeLike, identity: identifyStagingRoot(worktreeLike), tmpRoot }),
          removeSourceActivationStaging({ path: bareLike, identity: identifyStagingRoot(bareLike), tmpRoot }),
          removeSourceActivationStaging({ path: symlinked, identity: identifyStagingRoot(symlinked), tmpRoot }),
        ];
        for (const result of retained) {
          assert.equal(result.removed, false, "uncertain staging must be retained: " + String(result.reason));
          assert.ok(typeof result.reason === "string" && result.reason.length > 0, "a retention must carry a reason");
          assert.equal(fs.existsSync(result.path), true, "retained staging must still exist: " + result.path);
        }
        assert.equal(fs.readFileSync(path.join(sibling, "sentinel.txt"), "utf8"), "keep\n", "a sibling must never be touched");
        assert.equal(fs.existsSync(path.join(worktreeLike, ".git")), true, "repository metadata must never be deleted");
        assert.equal(fs.existsSync(path.join(bareLike, "objects")), true, "bare-repository metadata must never be deleted");
        return { removed: 1, retained: retained.length, retentionReasons: retained.map((result) => result.reason), siblingIntact: true };
      },
    },
  ];
}
