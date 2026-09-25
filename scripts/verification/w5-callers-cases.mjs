// W5 caller/handoff regressions (callers suite: LK17-LK19). These exercise the
// maintained mutation callers and the backend admission ordering against real
// production lock semantics and the authentic reconstructed pre-W5 entrypoint.
// All fixtures are task-owned and retained; recursive cleanup is intercepted.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { snapshotTree } from "../validate-agent-package.mjs";
import { loadMaintainedInstaller, loadHistoricalInstaller } from "./w5-callers-legacy.mjs";
import { stagePortableAgentPackage } from "./w5-portable-package.mjs";
import { bundleMcpEntry } from "./w5-callers-admission.mjs";
import { planShellIntegration, applyShellIntegration } from "../installer-shell-integration.mjs";
import { preservePiFabricProfile } from "../installer-home-preparation.mjs";
import { rollbackCompleteGeneration } from "../managed-installation.mjs";

export const requiredIds = Object.freeze(["LK17", "LK18", "LK19"]);

const OWNER = "kiro-fabric-agent-user-install";
const MANAGED_OWNER = "kiro-fabric-agent-user-install";
const CHILD = path.join("scripts", "verification", "w5-callers-historical-child.mjs");
const LEGACY_GATE = ".install.lock";

// Clean-checkout independence guard: no maintained W5 caller/hardening source may
// reference this session's ignored capture directory. The literal is assembled so
// this guard itself never contains the forbidden contiguous path.
const SESSION_ARTIFACT = [".tmp", "w5-w7-KFgyWY"].join("/");
function assertNoSessionArtifactDependency(repoRoot) {
  const directory = path.join(repoRoot, "scripts", "verification");
  for (const name of fs.readdirSync(directory).sort()) {
    if (!/^w5-(callers|hardening)[^/]*\.mjs$/u.test(name)) continue;
    const text = fs.readFileSync(path.join(directory, name), "utf8");
    assert.equal(text.includes(SESSION_ARTIFACT), false, name + " must not depend on the session capture " + SESSION_ARTIFACT);
  }
}

const exists = (target) => { try { fs.lstatSync(target); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
const mk = (target, mode = 0o700) => { fs.mkdirSync(target, { recursive: true, mode }); if (process.platform !== "win32") fs.chmodSync(target, mode); return target; };
const write = (target, value, mode = 0o600) => fs.writeFileSync(target, value, { mode });
const sha = (value) => createHash("sha256").update(value).digest("hex");
const freshDir = (context, label) => mk(fs.mkdtempSync(path.join(context.fixturesRoot, label + "-")), 0o700);
const paths = (home) => ({
  base: path.join(home, "kiro-fabric"),
  profile: path.join(home, "agents", "kiro-fabric.json"),
  manifest: path.join(home, "kiro-fabric", "install-owner.json"),
  runtime: path.join(home, "kiro-fabric", "runtime"),
  skills: path.join(home, "kiro-fabric", "skills"),
  data: path.join(home, "kiro-fabric", "data"),
});

function stagePackage(context, label) {
  // Build solely from current repository inputs plus the built dist closure under
  // this case's retained fixture root. No session-local package record is read.
  // Returns the real validator result (root + digest + inventories).
  return stagePortableAgentPackage(context.root, context.fixturesRoot, label).validated;
}
function writeLegacyGate(base, pid = process.pid) {
  const target = path.join(base, LEGACY_GATE);
  mk(target, 0o700);
  write(path.join(target, "owner.json"), JSON.stringify({ pid, nonce: "a".repeat(64) }) + "\n");
  return target;
}
function digestTree(root) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix ? prefix + "/" + entry.name : entry.name;
      const full = path.join(dir, entry.name);
      const stat = fs.lstatSync(full);
      if (stat.isDirectory()) { out.push("d:" + relative); walk(full, relative); }
      else if (stat.isFile()) out.push("f:" + relative + ":" + stat.size + ":" + sha(fs.readFileSync(full)));
      else out.push("o:" + relative);
    }
  };
  walk(root, "");
  return out;
}
function buildLegacyManifestInstallation(home, generationName = "a".repeat(64)) {
  mk(home); mk(path.join(home, "agents"));
  const p = paths(home);
  const generationRoot = mk(path.join(p.runtime, generationName));
  const skillRoot = mk(path.join(p.skills, "fabric-exec"));
  write(path.join(generationRoot, "index.mjs"), "// inert authenticated fixture\n");
  write(path.join(skillRoot, "SKILL.md"), "fixture skill\n");
  const profileBytes = Buffer.from("{}\n");
  write(p.profile, profileBytes);
  const manifest = { schemaVersion: 2, owner: OWNER, packageDigest: generationName, profileSha256: sha(profileBytes), skill: snapshotTree(skillRoot), currentRuntime: generationName, runtimeGenerations: [{ name: generationName, tree: snapshotTree(generationRoot) }] };
  write(p.manifest, JSON.stringify(manifest, null, 2) + "\n");
  return { p, manifest };
}
function buildLegacyInstallation(home, generationName = "b".repeat(64)) {
  mk(home); mk(path.join(home, "agents"));
  const p = paths(home);
  const generationRoot = mk(path.join(p.runtime, generationName));
  const skillRoot = mk(path.join(p.skills, "fabric-exec"));
  write(path.join(generationRoot, "index.mjs"), "// inert legacy fixture\n");
  write(path.join(skillRoot, "SKILL.md"), "legacy skill\n");
  const profileBytes = Buffer.from("{}\n");
  write(p.profile, profileBytes);
  const manifest = { schemaVersion: 1, owner: OWNER, packageDigest: generationName, profileSha256: sha(profileBytes), skillSha256: sha(fs.readFileSync(path.join(skillRoot, "SKILL.md"))), runtime: generationRoot };
  write(p.manifest, JSON.stringify(manifest, null, 2) + "\n");
  return { p, manifest };
}

function pauseHistorical(context, { home, user, pkg, pauseStep, cacheDir }) {
  mk(cacheDir, 0o700);
  const args = JSON.stringify({ repoRoot: context.root, home, user, pkg, pauseStep, cacheDir });
  const child = spawn(process.execPath, [path.join(context.root, CHILD), args], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const marker = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stopChild(child); reject(new Error("historical child did not pause; stderr=" + stderr.slice(0, 400))); }, 60000);
    const inspect = () => { const line = stdout.split("\n").find((entry) => entry.startsWith("PAUSED:")); if (line) { clearTimeout(timer); resolve(line.trim()); } };
    child.stdout.on("data", inspect);
    child.once("error", (error) => { clearTimeout(timer); stopChild(child); reject(error); });
  });
  return marker.then((line) => ({ child, line, stderr: () => stderr }));
}
function stopChild(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", resolve);
    child.kill("SIGKILL");
  });
}

async function lk17(context) {
  assertNoSessionArtifactDependency(context.root);
  const staged = stagePackage(context, "lk17-pkg");
  const pkg = staged.root;
  const cacheDir = freshDir(context, "lk17");
  const { module: maintained, trustBoundary } = await loadMaintainedInstaller(context.root, cacheDir, { inertTrust: true });
  assert.ok(maintained, "maintained installer could not be loaded for the harness");
  const historical = await loadHistoricalInstaller(context.root, freshDir(context, "lk17-hist"));

  // A. real schema-2 uninstall whose injected rollback rename fails.
  const homeA = mk(path.join(cacheDir, "home-a")); const userA = mk(path.join(cacheDir, "user-a"));
  const built = buildLegacyManifestInstallation(homeA);
  const rename = fs.renameSync, remove = fs.rmSync;
  let quarantined = false, restoreFault = false;
  fs.renameSync = (source, target, ...rest) => {
    if (quarantined && target === path.join(built.p.runtime, built.manifest.packageDigest)) { restoreFault = true; throw Object.assign(new Error("probe: rollback rename EIO"), { code: "EIO" }); }
    return rename(source, target, ...rest);
  };
  let uninstallError;
  try {
    maintained.uninstallUserAgent({ KIRO_HOME: homeA }, userA, { onCommitStep: (step) => { if (step === "quarantined") { quarantined = true; throw new Error("probe: uninstall failure after quarantine"); } } });
  } catch (error) { uninstallError = error; } finally { fs.renameSync = rename; }
  assert.ok(restoreFault, "probe must reach the real rollback rename");
  assert.ok(uninstallError instanceof AggregateError, "rollback failure must surface an AggregateError: " + uninstallError?.message);
  const uninstallGateRetained = exists(path.join(built.p.base, LEGACY_GATE, "owner.json"));
  const modernReleased = !exists(path.join(built.p.base, ".install-lock"));
  const quarantines = fs.readdirSync(built.p.base).filter((name) => name.startsWith(".uninstalling-"));
  const recoveryRetained = quarantines.length > 0 && quarantines.every((name) => exists(path.join(built.p.base, name, "recovery-manifest.json")));
  assert.equal(uninstallGateRetained, true, "failed uninstall rollback must retain the legacy gate");
  assert.equal(modernReleased, true, "failed uninstall rollback must release the modern lock");
  assert.equal(recoveryRetained, true, "failed uninstall rollback must retain its recovery evidence");

  // Authentic pre-W5 writer must be excluded by that retained gate. The pre-W5
  // writer uses recursive fs.rmSync for its private transaction payload; that is
  // task-owned fixture cleanup, but all recursive cleanup from the historical
  // writer is intercepted here so a probe never widens deletion.
  assert.ok(historical.available, "authentic pre-W5 entrypoint required: " + historical.reason);
  fs.rmSync = () => { throw new Error("probe: recursive cleanup denied"); };
  let published = false, historyError;
  try {
    historical.module.installUserAgent(pkg, { KIRO_HOME: homeA }, userA, { onCommitStep: (step) => { if (step === "runtime") published = true; } });
  } catch (error) { historyError = error; } finally { fs.rmSync = remove; }
  const historicalDenied = !published && /install is in progress|legacy installation lock/u.test(historyError?.message ?? "");
  assert.equal(historicalDenied, true, "authentic pre-W5 writer must be denied by the retained gate, not publish: " + historyError?.message);
  assert.equal(exists(path.join(built.p.base, LEGACY_GATE, "owner.json")), true, "gate must survive the denied historical attempt");

  // B. real fresh install whose injected rollback generation removal fails.
  const homeB = mk(path.join(cacheDir, "home-b")); const userB = mk(path.join(cacheDir, "user-b"));
  // Task-owned payload: this fixture generation is created by the maintained
  // installer inside the retained case root, so its removal is in-scope; the
  // injected EIO only proves the real rollback path, it does not widen deletion.
  const generationPath = path.join(paths(homeB).base, "runtime", staged.digest);
  let rmInjected = false;
  fs.rmSync = (target, ...rest) => { if (target === generationPath) { rmInjected = true; throw Object.assign(new Error("probe: generation removal EIO"), { code: "EIO" }); } return remove(target, ...rest); };
  let installError;
  try {
    maintained.installUserAgent(pkg, { KIRO_HOME: homeB }, userB, { onCommitStep: (step) => { if (step === "runtime") throw new Error("probe: stop after runtime publication"); } });
  } catch (error) { installError = error; } finally { fs.rmSync = remove; }
  assert.ok(rmInjected, "probe must reach the real rollback generation removal");
  assert.ok(installError instanceof AggregateError, "install rollback failure must surface an AggregateError: " + installError?.message);
  const installGateRetained = exists(path.join(paths(homeB).base, LEGACY_GATE, "owner.json"));
  assert.equal(installGateRetained, true, "failed install rollback must retain the legacy gate");
  assert.equal(exists(path.join(paths(homeB).base, ".install-lock")), false, "failed install rollback must release the modern lock");
  assert.ok(fs.readdirSync(paths(homeB).base).some((name) => name.startsWith(".installing-")), "installing recovery evidence must be retained");

  return { trustBoundary, historicalDigest: historical.digest, historicalRecorded: historical.recorded, uninstallGateRetained, modernReleased, recoveryRetained, historicalDenied, installGateRetained, aggregateUninstall: uninstallError instanceof AggregateError, aggregateInstall: installError instanceof AggregateError };
}

async function lk18(context) {
  // A. Shell integration must be excluded by a held legacy gate with zero effect.
  const shellHome = mk(path.join(freshDir(context, "lk18-shell"), "home")); const shellUser = mk(path.join(freshDir(context, "lk18-shell-user"), "user"));
  const shellBase = mk(path.join(shellHome, "kiro-fabric"));
  writeLegacyGate(shellBase);
  const shellPlan = planShellIntegration(shellHome, { env: { SHELL: "/bin/bash", HOME: shellUser }, userHome: shellUser });
  assert.equal(shellPlan.status, "planned", "shell plan must be planned before admission");
  let shellError;
  try { applyShellIntegration(shellHome, shellPlan); } catch (error) { shellError = error; }
  assert.equal(shellError?.code, "INSTALL_LOCK_BUSY", "shell integration must be excluded by the held legacy gate: " + shellError?.message);
  const shellRcUnchanged = !exists(path.join(shellUser, ".bashrc"));
  const shellStateUnchanged = !exists(path.join(shellBase, "shell-integration.json"));
  const shellGateHeld = exists(path.join(shellBase, LEGACY_GATE, "owner.json"));
  assert.equal(shellRcUnchanged && shellStateUnchanged && shellGateHeld, true, "shell admission must have zero effect and leave the gate held");

  // Positive control: a clean base with no held gate still admits and releases both locks.
  const cleanHome = mk(path.join(freshDir(context, "lk18-shell-clean"), "home"));
  const cleanUser = mk(path.join(freshDir(context, "lk18-shell-clean-user"), "user"));
  const cleanBase = mk(path.join(cleanHome, "kiro-fabric"));
  const cleanPlan = planShellIntegration(cleanHome, { env: { SHELL: "/bin/bash", HOME: cleanUser }, userHome: cleanUser });
  const cleanResult = applyShellIntegration(cleanHome, cleanPlan);
  assert.equal(cleanResult.status, "configured", "clean shell admission must still proceed");
  const cleanGateRemoved = !exists(path.join(cleanBase, LEGACY_GATE)) && !exists(path.join(cleanBase, ".install-lock"));
  assert.equal(cleanGateRemoved, true, "clean shell admission must release both locks");

  // B. Pi Fabric profile migration must be excluded by the same gate.
  const profileHome = mk(path.join(freshDir(context, "lk18-profile"), "home")); const backup = mk(path.join(freshDir(context, "lk18-backup"), "backup"));
  const p = { base: mk(path.join(profileHome, "kiro-fabric")), legacy: path.join(profileHome, ".kiro-fabric"), profile: path.join(profileHome, "agents", "kiro-fabric.json") };
  mk(path.join(profileHome, "agents"));
  const profileBytes = Buffer.from("{}\n");
  write(p.profile, profileBytes); mk(path.join(backup, "agents")); write(path.join(backup, "agents", "kiro-fabric.json"), profileBytes);
  mk(p.legacy);
  write(path.join(p.legacy, "install.json"), JSON.stringify({ format: 1, owner: "kiro-fabric", scope: "user", profile: { path: "agents/kiro-fabric.json", installedSha256: sha(profileBytes) } }) + "\n");
  writeLegacyGate(p.base);
  let profileError;
  try { preservePiFabricProfile(profileHome, { sha256: sha(profileBytes) }, { path: backup }); } catch (error) { profileError = error; }
  assert.equal(profileError?.code, "INSTALL_LOCK_BUSY", "profile migration must be excluded by the held legacy gate: " + profileError?.message);
  const profilePreserved = exists(p.profile);
  const noBackupWritten = !exists(path.join(p.base, "legacy-profiles"));
  const profileGateHeld = exists(path.join(p.base, LEGACY_GATE, "owner.json"));
  assert.equal(profilePreserved && noBackupWritten && profileGateHeld, true, "profile admission must have zero effect and leave the gate held");

  // C. Backend admission (bundled real mcp-entry.ts) must be excluded before any data preparation.
  const backendHome = mk(path.join(freshDir(context, "lk18-backend"), "home"));
  const backendBase = mk(path.join(backendHome, "kiro-fabric"));
  const bundleRoot = mk(path.join(backendBase, "runtime", "c".repeat(64)));
  const runtimeRoot = mk(path.join(bundleRoot, "app"));
  const dataRoot = mk(path.join(backendBase, "data"));
  writeLegacyGate(backendBase);
  const { startKiroMcpServer } = await bundleMcpEntry(context.root, path.join(freshDir(context, "lk18-bundle"), "mcp-entry.bundle.mjs"));
  const saved = { ...process.env };
  Object.assign(process.env, { KIRO_FABRIC_RUNTIME_ROOT: runtimeRoot, KIRO_FABRIC_DATA_ROOT: dataRoot, KIRO_FABRIC_BUNDLE_ROOT: bundleRoot });
  let backendError;
  try { await startKiroMcpServer(); } catch (error) { backendError = error; }
  finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
  assert.ok(backendError, "backend admission must reject a held legacy gate");
  const backendExcluded = backendError.code === "INSTALL_LOCK_BUSY" || /installation mutation is in progress|legacy installation lock/u.test(backendError.message);
  assert.equal(backendExcluded, true, "backend admission must be excluded by the legacy gate: " + (backendError.code ?? "") + " " + backendError.message);
  const dataUntouched = fs.readdirSync(dataRoot).length === 0;
  const backendGateHeld = exists(path.join(backendBase, LEGACY_GATE, "owner.json"));
  assert.equal(dataUntouched && backendGateHeld, true, "backend admission must not prepare durable data while excluded");

  return { shellExcluded: true, shellRcUnchanged, shellStateUnchanged, shellPositiveControl: cleanResult.status === "configured" && cleanGateRemoved, profileExcluded: true, profilePreserved, noBackupWritten, backendExcluded, dataUntouched };
}

function buildManagedOwnerManifest(home) {
  const p = paths(home);
  // Structurally genuine managed schema-3 ownership record (see nextOwner in
  // scripts/managed-installation.mjs). It uses installationId/manifestSha256
  // controls, NOT the legacy installer manifest shape.
  return {
    schemaVersion: 3, owner: MANAGED_OWNER, installationId: "b".repeat(32), kiroHome: home, dataRoot: p.data,
    status: "active", currentRuntime: "c".repeat(64), previousRuntime: null,
    runtimeGenerations: [{ name: "c".repeat(64), manifestSha256: "d".repeat(64) }],
    profileSha256: "e".repeat(64), launcherSha256: "f".repeat(64), releaseStateSha256: null, transactionId: "a".repeat(32),
  };
}

/** Genuine managed-owner manifest refusal. The manifest is absent during the
 * historical writer's pre-lock inspection and appears exactly when it creates
 * its legacy lock directory, so the writer's post-lock re-read performs the
 * refusal. No mutation or recursive cleanup may occur; the manifest must be
 * preserved byte-exactly. */
async function lk19ManagedManifestRefusal(context, pkg) {
  const { module: historical } = await loadHistoricalInstaller(context.root, freshDir(context, "lk19-managed-hist"));
  assert.ok(historical, "authentic pre-W5 entrypoint required for the managed manifest refusal");

  const dir = freshDir(context, "lk19-managed");
  const home = mk(path.join(dir, "home"));
  const user = mk(path.join(dir, "user"));
  const p = paths(home);
  mk(path.join(home, "agents"));
  mk(p.base);
  const manifestBytes = Buffer.from(JSON.stringify(buildManagedOwnerManifest(home), null, 2) + "\n");
  const manifestSha = sha(manifestBytes);

  const originalMkdir = fs.mkdirSync;
  const remove = fs.rmSync;
  const lockDir = path.join(p.base, LEGACY_GATE);
  let injected = false;
  const recursiveCleanup = [];
  fs.mkdirSync = function (target, ...rest) {
    const value = originalMkdir.call(fs, target, ...rest);
    if (target === lockDir && !injected) { injected = true; fs.writeFileSync(p.manifest, manifestBytes, { mode: 0o600 }); }
    return value;
  };
  fs.rmSync = function (target, options) {
    if (options && options.recursive) { recursiveCleanup.push(String(target)); throw new Error("probe: recursive cleanup denied"); }
    return remove.call(fs, target, options);
  };

  let error;
  try { historical.installUserAgent(pkg, { KIRO_HOME: home }, user, {}); } catch (caught) { error = caught; }
  finally { fs.mkdirSync = originalMkdir; fs.rmSync = remove; }

  const entries = fs.readdirSync(p.base).sort();
  const manifestPreserved = exists(p.manifest) && sha(fs.readFileSync(p.manifest)) === manifestSha;
  const lockReleased = !exists(lockDir);

  assert.equal(injected, true, "the post-lock manifest injection must fire");
  assert.ok(error, "the historical writer must refuse a genuine managed-owner manifest");
  assert.equal(manifestPreserved, true, "the managed-owner manifest must be preserved byte-exactly");
  assert.equal(lockReleased, true, "the historical writer must release its own legacy lock after refusal");
  assert.deepEqual(entries, ["install-owner.json"], "the refusal must not add or remove any other base entry");
  assert.equal(recursiveCleanup.length, 0, "the refusal must not attempt prohibited recursive cleanup");

  return { injected, refused: true, manifestPreserved, lockReleased, entries, recursiveCleanup: recursiveCleanup.length, reason: error.message.slice(0, 160) };
}

async function lk19(context) {
  assertNoSessionArtifactDependency(context.root);
  const staged = stagePackage(context, "lk19-pkg");
  const pkg = staged.root;
  const cacheDir = freshDir(context, "lk19");
  const { module: maintained } = await loadMaintainedInstaller(context.root, cacheDir, { inertTrust: true });
  assert.ok(maintained, "maintained installer could not be loaded for the harness");
  assert.ok((await loadHistoricalInstaller(context.root, freshDir(context, "lk19-hist"))).available, "authentic pre-W5 entrypoint required");

  const scenarios = [
    { state: "absent", pauseStep: "profile", setup: (home) => { mk(home); mk(path.join(home, "agents")); }, seeded: null },
    { state: "legacy", pauseStep: "profile", setup: (home) => { buildLegacyInstallation(home); }, seeded: (home) => sha(fs.readFileSync(paths(home).manifest)) },
    { state: "legacy-manifest", pauseStep: "manifest", setup: (home) => { buildLegacyManifestInstallation(home); }, seeded: (home) => sha(fs.readFileSync(paths(home).manifest)) },
  ];
  const matrix = [];
  for (const scenario of scenarios) {
    const scenarioDir = freshDir(context, "lk19-" + scenario.state);
    const home = mk(path.join(scenarioDir, "home"));
    const user = mk(path.join(scenarioDir, "user"));
    scenario.setup(home);
    const base = paths(home).base;
    const seeded = scenario.seeded ? scenario.seeded(home) : null;
    const paused = await pauseHistorical(context, { home, user, pkg, pauseStep: scenario.pauseStep, cacheDir: freshDir(context, "lk19-child-" + scenario.state) });
    try {
      const fields = paused.line.split(":");
      const pausedStep = fields[1];
      const manifestState = fields.slice(2).join(":");
      let ownerLast;
      if (scenario.pauseStep === "manifest") ownerLast = manifestState.startsWith("sha:") && manifestState !== "sha:" + seeded;
      else if (scenario.state === "absent") ownerLast = manifestState === "absent";
      else ownerLast = manifestState === "sha:" + seeded;
      assert.equal(pausedStep, scenario.pauseStep, "historical child must pause at the requested step");
      assert.equal(ownerLast, true, "install manifest must be written last (" + scenario.state + ")");

      const before = digestTree(base);
      // NOTE: maintained.installUserAgent is the updated LEGACY writer, not
      // managed activation. It must be excluded by the paused pre-W5 gate with
      // zero effect.
      let legacyError;
      try { maintained.installUserAgent(pkg, { KIRO_HOME: home }, user, {}); } catch (error) { legacyError = error; }
      const afterLegacy = digestTree(base);
      assert.ok(legacyError, "the updated legacy writer must refuse while the pre-W5 entrypoint is paused (" + scenario.state + ")");
      assert.deepEqual(afterLegacy, before, "the updated legacy writer must have zero effect (" + scenario.state + ")");

      // Maintained managed mutator admission against the same paused legacy gate.
      // This is the real managed mutual-exclusion path, distinct from the legacy
      // writer; admission must reject before any effect.
      let managedError;
      try { await rollbackCompleteGeneration(home, {}); } catch (error) { managedError = error; }
      const afterManaged = digestTree(base);
      assert.ok(managedError, "the managed mutator must refuse while the pre-W5 entrypoint is paused (" + scenario.state + ")");
      assert.deepEqual(afterManaged, before, "the managed mutator must have zero effect (" + scenario.state + ")");

      const gateHeld = exists(path.join(base, LEGACY_GATE, "owner.json"));
      assert.equal(gateHeld, true, "the paused pre-W5 gate must stay held (" + scenario.state + ")");

      const gateDenial = /installation mutation is in progress|legacy installation lock|INSTALL_LOCK_BUSY/u.test(legacyError.message);
      if (scenario.state === "legacy-manifest") {
        // The only scenario with a legacy manifest already present: both the
        // updated legacy writer and the managed mutator must get PAST their
        // pre-lock admission validation and be blocked by the paused legacy gate.
        assert.equal(gateDenial, true, "the updated legacy writer must be excluded by the paused legacy gate: " + legacyError.message);
        assert.equal(managedError.code, "INSTALL_LOCK_BUSY", "the managed mutator must be excluded by the paused legacy gate: " + managedError.message);
      }
      matrix.push({ state: scenario.state, pauseStep: pausedStep, manifestState, ownerLast, refused: true, zeroEffect: true, managedRefused: true, managedZeroEffect: true, gateHeld, gateDenial, reason: legacyError.message.slice(0, 160), managedReason: managedError.message.slice(0, 160), managedCode: managedError.code ?? null });
    } finally {
      await stopChild(paused.child); // Always reap the paused child on success or assertion failure.
    }
  }

  const managed = await lk19ManagedManifestRefusal(context, pkg);

  // The full managed activation matrix requires a built complete release bundle;
  // report the exact gate rather than silently claiming activation coverage.
  const completeBundle = path.join(context.root, "dist", "kiro-agent-closure", "bundle-manifest.json");
  const managedActivationGate = fs.existsSync(completeBundle)
    ? "complete bundle manifest present; installCompleteGeneration activation still requires a trusted candidate callback"
    : "not-built: dist/kiro-agent-closure/bundle-manifest.json (complete release bundle) is absent; installCompleteGeneration activation not exercised";

  return { ownerLast: true, matrix, managed, managedActivationGate, legacyWriterCoverage: "updated legacy writer only", managedAdmissionCoverage: "managed mutator admission against paused legacy gate" };
}

/** @returns {any[]} */
export function createCallerCases() {
  return [
    { id: "LK17", title: "failed install/uninstall rollback retains the legacy gate and denies the authentic pre-W5 writer", effects: "real production installer/uninstaller on retained fixtures plus the authentic hash-verified pre-W5 entrypoint; injected rollback faults; recursive cleanup intercepted", run: lk17 },
    { id: "LK18", title: "shell, profile and bundled backend admission exclude a held legacy gate with zero effect", effects: "real maintained shell/profile callers, bundled src/kiro/mcp-entry.ts, and strict legacy control injection; retained fixtures", run: lk18 },
    { id: "LK19", title: "paused authentic pre-W5 entrypoint vs updated legacy writer and managed mutator admission, plus managed-owner manifest refusal", effects: "spawns the authentic hash-verified pre-W5 installer as a paused child holding the legacy gate; exercises the maintained updated legacy writer and the maintained managed mutator (admission only; full activation needs a built complete bundle); retained fixtures; recursive cleanup intercepted", run: lk19 },
  ];
}
