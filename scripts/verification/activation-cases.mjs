// W5 REAL complete-bundle activation matrix. These cases exercise the actual
// `installCompleteGeneration` entrypoint with genuine, validator-passing
// complete bundles staged from the current built closure plus the repository's
// verified private-tool cache, and the real `smokeCandidate` production
// validation seam (which launches the bundle's bundled Node backend). The
// installer, lock, transaction and smoke paths run for real. One documented
// harness-only seam is substituted by scripts/verification/w5-callers-legacy.mjs:
// the legacy writers' executable-trust line is replaced with an inert boundary so
// locking/admission regressions can run under a harness Node. That means the
// executable-trust acceptance path itself is NOT exercised here, and no claim of
// untouched historical production closure is made.
//
// Scope: absent / legacy / modern incoming installations, paused old/updated
// writer exclusion in both directions, successful publication order, and
// fail-safe retained fences/refusals (not successful automatic recovery).
//
// Fixtures are caller-owned and retained. This module performs no recursive
// deletion; child processes receive signals only and settle under the maintained
// inherited-group / no-detach contract. The real `smokeCandidate` production
// seam is retain-only (Main removed its former transitive recursive scratch
// deletion); this matrix must not be executed against an older smokeCandidate
// that still deletes scratch. That retain-only scope covers this module's own
// paths; it is not a blanket claim that every historical branch reachable through
// the substituted legacy writers is deletion-free.
// No network path is reachable: use an explicitly admitted task base or the
// verified offline tool cache; missing authority is a hard error.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import os from "node:os";
import { validateBundle } from "../bundle-contract.mjs";
import { smokeCandidate } from "../installer-smoke.mjs";
import { installCompleteGeneration, rollbackCompleteGeneration, recoverCompleteInstallation, inspectCompleteInstallation } from "../managed-installation.mjs";
import { stagePortableAgentPackage } from "./w5-portable-package.mjs";
import { loadHistoricalInstaller, loadMaintainedInstaller } from "./w5-callers-legacy.mjs";
import { inheritedCaseGroup, caseGroupEnvironment } from "./case-process.mjs";
import { snapshotTree, assertSnapshotDelta } from "./activation-snapshot.mjs";
import { installLegacyCleanupGuard } from "./activation-legacy-cleanup.mjs";
import { captureActivationHome, seedActivationData, assertActivationPublication, assertLegacyBackupSeed } from "./activation-preservation.mjs";

const OWNER = "kiro-fabric-agent-user-install";
const LEGACY_GATE = ".install.lock";
const MANAGED_LOCK = ".install-lock";
const INSTALL_CHILD = path.join("scripts", "verification", "activation-install-child.mjs");
const LEGACY_CHILD = path.join("scripts", "verification", "activation-paused-legacy-writer-child.mjs");
const GATE_CHILD = path.join("scripts", "verification", "activation-legacy-gate-child.mjs");
const CHILD_OUTPUT_BOUND = 1024 * 1024;
const DEFAULT_CASE_DEADLINE_MS = 900000;

const exists = (target) => { try { fs.lstatSync(target); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
const mk = (target, mode = 0o700) => { fs.mkdirSync(target, { recursive: true, mode }); if (process.platform !== "win32") fs.chmodSync(target, mode); return target; };
const sha = (value) => createHash("sha256").update(value).digest("hex");
const freshDir = (context, label) => mk(fs.mkdtempSync(path.join(context.fixturesRoot, label + "-")), 0o700);

/** Mirrors scripts/install-transaction.mjs transactionPaths (no import needed). */
const paths = (home) => ({
  base: path.join(home, "kiro-fabric"),
  profile: path.join(home, "agents", "kiro-fabric.json"),
  manifest: path.join(home, "kiro-fabric", "install-owner.json"),
  runtime: path.join(home, "kiro-fabric", "runtime"),
  skills: path.join(home, "kiro-fabric", "skills"),
  data: path.join(home, "kiro-fabric", "data"),
});

/** Genuine, task-owned current bundle; cached per case/run context. */
async function getBundle(context, marker = null) {
  const key = marker ? 'bundleVariant' : 'bundle';
  const { stageGenuineCompleteBundle, resolvePublicActiveBundle, admitCurrentActivationBundle, activationBundleIdentity } = await import('./activation-bundle.mjs');
  const explicitRoot = context.activationBase ?? process.env.KIRO_FABRIC_ACTIVATION_BASE;
  const explicitTask = context.activationTaskRoot ?? process.env.KIRO_FABRIC_ACTIVATION_TASK_ROOT;
  if (!!explicitRoot !== !!explicitTask) throw Error('Explicit activation base and task root must be supplied together');
  let bundle = context[key];
  if (bundle) {
    const rebound = bundle.source === 'public-active' ? await resolvePublicActiveBundle(context.root) : await admitCurrentActivationBundle({ repoRoot: context.root, bundleRoot: bundle.root, taskRoot: bundle.taskRoot });
    assert.ok(rebound && rebound.digest === bundle.digest && rebound.buildInputsDigest === bundle.buildInputsDigest && rebound.closureManifestSha === bundle.closureManifestSha && rebound.toolsDigest === bundle.toolsDigest, 'cached activation bundle changed/current inputs drifted');
    bundle = { ...rebound, source: bundle.source };
  } else if (marker) {
    const base = await getBundle(context);
    bundle = await stageGenuineCompleteBundle({ repoRoot: context.root, fixtureRoot: context.fixturesRoot, label: key, qualificationMarker: marker, baseBundle: base });
  } else if (explicitRoot) {
    bundle = await admitCurrentActivationBundle({ repoRoot: context.root, bundleRoot: explicitRoot, taskRoot: explicitTask });
  } else {
    // A PRESENT invalid shared pointer throws here. Never catch it or fall back.
    bundle = await resolvePublicActiveBundle(context.root);
    if (!bundle) bundle = await stageGenuineCompleteBundle({ repoRoot: context.root, fixtureRoot: context.fixturesRoot, label: key });
  }
  context[key] = bundle;
  context.activationIdentities ??= {};
  context.activationIdentities[key] = activationBundleIdentity(bundle);
  return bundle;
}

/** Genuine validation-ready Agent package for the real legacy writers. */
async function getPkg(context) {
  if (context.pkgRoot) return context.pkgRoot;
  const dir = freshDir(context, "pkg");
  context.pkgRoot = stagePortableAgentPackage(context.root, dir, "activation-pkg").validated.root;
  return context.pkgRoot;
}

/** Isolated child environment: no ambient HOME/tokens/Node/auth options. */
function isolatedEnv(fixtureDir) {
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  // Environment dirs must not alias the install home: the managed resolver
  // refuses a KIRO_HOME that is dangerously broad (equal to HOME).
  for (const [key, name] of Object.entries({ HOME: "env-home", XDG_CONFIG_HOME: "env-config", XDG_CACHE_HOME: "env-cache", XDG_DATA_HOME: "env-data" })) env[key] = mk(path.join(fixtureDir, name));
  // TMPDIR deliberately keeps honoring the caller's inherited TMPDIR via
  // os.tmpdir(). A valid in-checkout TMPDIR no longer hides the smoke fixture
  // files: production smokeCandidate now pins discovery to its own exclusively
  // created workspace with an owned unborn Git boundary, so no external-temp
  // workaround is assumed here.
  env.TMPDIR = mk(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "fabric-activation-tmp-")), 0o700);
  return env;
}

/** Harness-only disposal bound. Production deadlines stay independent/exact. */
const SETTLE_BUDGET_MS = 5000;

/** Bounded child under the maintained inherited-group / no-detach contract.

 * Under the shared supervisor the case worker inherits the outer case group's
 * fd-3 identity: this child joins that group and never detaches, so the outer
 * case-process owner can settle the whole group. A standalone direct run owns a
 * fresh group instead. Deadline, overflow, spawn error, stop request and the
 * close/census observations are latched facts. `settle()` waits for stdio
 * `close` plus group census and THROWS on uncertainty - it never returns success
 * after an unconfirmed 5s disposal budget. Cleanup scope is the owned child group
 * only: detached descendants (the Navigator engine forks its own detached group
 * and owns its IPC-disconnect cleanup) are explicitly outside this receipt. */
function spawnBounded(script, context, request, { fixtureDir, deadlineMs }) {
  const inherited = inheritedCaseGroup();
  const child = spawn(process.execPath, [path.join(context.root, script), JSON.stringify(request)], {
    cwd: context.root,
    env: caseGroupEnvironment(isolatedEnv(fixtureDir)),
    stdio: inherited === null ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "pipe", 3],
    detached: inherited === null,
  });
  const facts = { timedOut: false, overflowed: false, aborted: false, spawnError: null, stopError: null, stopRequested: false, closed: false, groupGone: null, settleUncertain: false };
  let stdout = "", stderr = "", bytes = 0, exitInfo = null, closeInfo = null;

  const groupGone = () => {
    if (inherited !== null) return true; // The outer case-process owns group-wide census.
    if (!child.pid) return true;
    try { process.kill(-child.pid, 0); return false; }
    catch (error) { if (error.code === "ESRCH") return true; throw error; }
  };
  const signal = () => {
    if (!child.pid) return;
    try { if (inherited === null) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); }
    catch (error) { if (error.code !== "ESRCH") facts.stopError = error.message; }
  };
  const stop = () => { facts.stopRequested = true; signal(); };
  const timer = setTimeout(() => { facts.timedOut = true; stop(); }, deadlineMs);
  const abort = () => { facts.aborted = true; stop(); };
  process.once("SIGINT", abort); process.once("SIGTERM", abort);

  const collect = (chunk, channel) => {
    bytes += chunk.length;
    if (bytes > CHILD_OUTPUT_BOUND) { if (!facts.overflowed) { facts.overflowed = true; stop(); } return; }
    if (channel === "stdout") stdout += chunk.toString("utf8");
    else stderr += chunk.toString("utf8");
  };
  child.stdout.on("data", (chunk) => collect(chunk, "stdout"));
  child.stderr.on("data", (chunk) => collect(chunk, "stderr"));

  let resolveExit;
  const exited = new Promise((resolve) => { resolveExit = resolve; });
  child.once("error", (error) => { facts.spawnError = error; stop(); });
  child.once("exit", (code, signalValue) => { exitInfo = { code, signal: signalValue }; });
  child.once("close", (code, signalValue) => { closeInfo = { code, signal: signalValue }; facts.closed = true; clearTimeout(timer); resolveExit(closeInfo); });

  const receipt = () => ({
    pid: child.pid ?? null,
    code: closeInfo?.code ?? exitInfo?.code ?? null,
    signal: closeInfo?.signal ?? exitInfo?.signal ?? null,
    timedOut: facts.timedOut,
    aborted: facts.aborted,
    detachedNavigatorSettlement: "unqualified; outside owned group census",
    overflowed: facts.overflowed,
    spawnError: facts.spawnError ? String(facts.spawnError.message) : null,
    stopError: facts.stopError,
    stopRequested: facts.stopRequested,
    closed: facts.closed,
    groupGone: facts.groupGone,
    settleUncertain: facts.settleUncertain,
    cleanupScope: inherited === null ? "owned-child-process-group" : "direct-child; outer case owns process group",
  });

  let settlement;
  function settle() {
    settlement ??= join();
    return settlement;
  }
  async function join() {
    clearTimeout(timer);
    try {
    if (!facts.closed || !groupGone()) stop();
    const deadline = Date.now() + SETTLE_BUDGET_MS;
    while (!facts.closed || !groupGone()) {
      if (Date.now() >= deadline) {
        facts.settleUncertain = true;
        try { child.stdout?.destroy(); child.stderr?.destroy(); } catch { /* streams already gone */ }
        try { child.unref(); } catch { /* already reaped */ }
        throw new Error("child settlement unconfirmed within " + SETTLE_BUDGET_MS + "ms: " + JSON.stringify(receipt()));
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    facts.groupGone = inherited === null ? groupGone() : null;
    if (facts.stopError) throw Error("child disposal signalling failed: " + JSON.stringify(receipt()));
    return receipt();
    } finally { process.removeListener("SIGINT", abort); process.removeListener("SIGTERM", abort); }
  }

  /** Normal completion keeps the execution deadline live. Disposal is separate:
   * only failure/abort/deadline or a residual OWNED group triggers signalling. */
  async function result() {
    let primary;
    try {
      while (!facts.closed && !facts.stopRequested) await new Promise(resolve => setTimeout(resolve, 25));
      if (facts.timedOut || facts.overflowed || facts.spawnError || facts.aborted || facts.stopRequested) throw Error("child execution failed: " + JSON.stringify(receipt()));
      await settle(); // Natural stdio close, then bounded residual-group census.
      const settled = receipt();
      if (settled.code !== 0 || settled.signal !== null || settled.stopRequested || settled.stopError) throw Error("child did not exit cleanly: " + JSON.stringify(settled) + " stdout=" + stdout.slice(-400) + " stderr=" + stderr.slice(-400));
      const lines = stdout.split("\n").filter(line => line.startsWith("RESULT:") || line.startsWith("ERROR:"));
      if (lines.length !== 1 || !lines[0].startsWith("RESULT:")) throw Error("child did not emit exactly one strict RESULT receipt: " + stdout.slice(-600));
      const parsed = JSON.parse(lines[0].slice("RESULT:".length));
      if (parsed?.schemaVersion !== 1) throw Error("child RESULT receipt schema mismatch");
      return { ...parsed, settlement: settled };
    } catch (error) { primary = error; }
    try { await settle(); } catch (cleanup) { throw new AggregateError([primary, cleanup], "child execution and settlement failed: primary=" + primary.message + "; cleanup=" + cleanup.message); }
    throw primary;
  }

  const assertRunning = () => { if (facts.closed || facts.spawnError || facts.stopRequested) throw Error("child stopped before pause: " + JSON.stringify(receipt()) + " stderr=" + stderr.slice(-400)); };
  return { child, exited, stop, settle, result, receipt, assertRunning, stdout: () => stdout, stderr: () => stderr, overflowed: () => facts.overflowed, timedOut: () => facts.timedOut };
}

async function waitForFile(file, budgetMs, diagnostics, started) {
  const deadline = Date.now() + budgetMs;
  while (!exists(file)) {
    started?.assertRunning();
    if (Date.now() > deadline) throw new Error("child did not reach pause boundary: " + diagnostics());
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return fs.readFileSync(file, "utf8").trim();
}

function assertPublicationOrder(phases) {
  const first = (phase) => phases.indexOf(phase);
  assert.ok(first("candidate-journal-synced") >= 0, "candidate journal must be synced");
  assert.ok(first("candidate-root-owned") > first("candidate-journal-synced"), "candidate root must be owned after journal sync");
  for (const phase of phases) {
    if (!phase.startsWith("before-copy:")) continue;
    const rest = phase.slice("before-copy:".length);
    assert.ok(phases.indexOf("copied-bytes:" + rest) > phases.indexOf(phase), "copied-bytes must follow before-copy: " + rest);
    assert.ok(phases.indexOf("copied:" + rest) > phases.indexOf("copied-bytes:" + rest), "copied must follow copied-bytes: " + rest);
  }
  const copyEnd = phases.reduce((max, phase, index) => phase.startsWith("copied:") ? index : max, -1);
  assert.ok(copyEnd >= 0, "at least one copied phase must be emitted");
  assert.ok(first("before-candidate-validation") > copyEnd, "all copies must precede candidate validation");
  assert.ok(first("candidate-validated") > first("before-candidate-validation"), "candidate validation phase order");
  assert.ok(first("candidate-synced") > first("candidate-validated"), "candidate sync must follow validation");
  assert.ok(first("generation-published") > first("candidate-synced"), "publication must follow sync");
  assert.ok(first("profile-snapshot-retained") > first("generation-published"), "profile snapshot must follow publication");
  // Full owner-last ordering: the transaction publishes profile, launcher and
  // release state before the owner manifest, exactly as activateInstallTransaction
  // emits. ownerLast must not be reported from a narrower prefix.
  const publicationOrder = ["profile-snapshot-retained", "journal-synced", "before-profile", "profile-published", "before-launcher", "launcher-published", "before-releaseState", "releaseState-published", "before-manifest", "owner-committed"];
  for (let index = 1; index < publicationOrder.length; index++) {
    assert.ok(first(publicationOrder[index]) > first(publicationOrder[index - 1]), "publication order violated: " + publicationOrder[index - 1] + " must precede " + publicationOrder[index]);
  }
}

const installGeneration = (bundleRoot, home, options = {}) => installCompleteGeneration(bundleRoot, { kiroHome: home, provenance: "source", validateCandidate: options.validateCandidate ?? smokeCandidate, ...(options.onPhase ? { onPhase: options.onPhase } : {}) });

// ---------------------------------------------------------------- ACT-01
async function act01(context) {
  const bundle = await getBundle(context);
  const home = mk(path.join(freshDir(context, "act01"), "home"));
  const phases = [];
  const result = await installGeneration(bundle.root, home, { onPhase: (phase) => phases.push(phase) });
  assert.equal(result.outcome, "activated", "fresh installation must activate");
  assert.equal(result.committed, true, "fresh activation must commit");
  assert.equal(result.digest, bundle.digest, "activated generation must match the staged bundle");
  assertPublicationOrder(phases);
  const p = paths(home);
  assert.equal(exists(p.manifest), true, "owner manifest must exist");
  assert.equal(exists(p.profile), true, "generation profile must exist");
  assert.equal(exists(path.join(p.base, "bin", "kiro-fabric")), true, "launcher must exist");
  assert.equal(exists(path.join(p.runtime, bundle.digest, "bundle-manifest.json")), true, "generation must be published");
  const owner = JSON.parse(fs.readFileSync(p.manifest, "utf8"));
  assert.equal(owner.schemaVersion, 3, "managed owner schema");
  assert.equal(owner.owner, OWNER, "managed owner identity");
  assert.equal(owner.status, "active", "managed owner status");
  assert.equal(owner.currentRuntime, bundle.digest, "owner runtime binding");
  assert.equal(owner.installationId.length, 32, "owner installation id");
  assert.equal(fs.readdirSync(p.runtime).length, 1, "exactly one generation after fresh install");
  const installed = await validateBundle(path.join(p.runtime, bundle.digest));
  assert.equal(installed.digest, bundle.digest, "installed generation must revalidate");
  const ownerLast = phases.indexOf("owner-committed") > phases.indexOf("profile-published") &&
    phases.indexOf("owner-committed") > phases.indexOf("launcher-published") &&
    phases.indexOf("owner-committed") > phases.indexOf("releaseState-published") &&
    phases.indexOf("owner-committed") > phases.indexOf("profile-snapshot-retained");
  assert.equal(ownerLast, true, "owner manifest must be committed after profile, launcher and release state");
  return { caseName: "absent-installation-real-activation", phaseCount: phases.length, digest: result.digest, version: result.version, committed: result.committed, ownerLast, installedValid: true };
}

// ---------------------------------------------------------------- ACT-02
async function act02(context) {
  const bundle = await getBundle(context);
  const pkg = await getPkg(context);
  const dir = freshDir(context, "act02");
  const home = mk(path.join(dir, "home"));
  const user = mk(path.join(dir, "user"));

  // Real maintained legacy writer installs the actual staged package: this is a
  // genuine pre-managed installation, not a structural manifest fixture.
  const guard = installLegacyCleanupGuard(dir);
  try {
    const maintained = await loadMaintainedInstaller(context.root, freshDir(context, "act02-cache"), { inertTrust: true });
    assert.ok(maintained.module, "maintained legacy writer must load");
    maintained.module.installUserAgent(pkg, { KIRO_HOME: home }, user, {});
    const firstLegacy = captureActivationHome(home);
    // A real second legacy publication creates previous-manifest/profile/skill
    // backups. The guard retains them rather than fabricating foreign controls.
    maintained.module.installUserAgent(pkg, { KIRO_HOME: home }, user, {});
    assertLegacyBackupSeed(home, firstLegacy);
  } finally { guard.restore(); }
  const pre = await inspectCompleteInstallation(home);
  assert.equal(pre.status, "legacy", "maintained writer must produce a legacy incoming state");
  assert.ok(pre.legacy?.manifest, "legacy manifest must be readable");
  const legacyGeneration = pre.legacy.manifest.packageDigest ?? pre.legacy.manifest.currentRuntime;
  seedActivationData(home);
  const beforeMigration = captureActivationHome(home);
  const legacyManifest = Buffer.from(pre.legacy.bytes);
  assert.deepEqual(beforeMigration.owner, legacyManifest);

  const result = await installGeneration(bundle.root, home);
  assert.equal(result.outcome, "activated", "legacy migration must activate");
  assert.equal(result.digest, bundle.digest, "migrated runtime must be the staged bundle");
  const p = paths(home);
  const owner = JSON.parse(fs.readFileSync(p.manifest, "utf8"));
  assert.equal(owner.currentRuntime, bundle.digest, "owner must bind the new generation");
  assert.ok(owner.legacy && typeof owner.legacy.manifestBase64 === "string", "legacy ownership evidence must be embedded");
  assert.equal(exists(path.join(p.runtime, legacyGeneration)), true, "legacy runtime generation must be retained at its exact path");
  assert.equal(exists(path.join(p.runtime, legacyGeneration, "bundle-manifest.json")), false, "legacy generation must not be relabelled as a bundle");
  assert.equal(owner.runtimeGenerations.length, 1, "only the new bundle is a managed generation");
  const after = await inspectCompleteInstallation(home);
  assert.equal(after.status, "active", "post-migration inspection must be active");
  const preservation = await assertActivationPublication(home, beforeMigration, bundle, { legacyManifest });
  return { preservation, legacyCleanupRetained: guard.retained, caseName: "legacy-installation-migration", legacyGeneration, digest: result.digest, legacyRetained: true, legacyEvidence: true };
}

// ---------------------------------------------------------------- ACT-03
async function act03(context) {
  const a = await getBundle(context);
  const b = await getBundle(context, "activation qualification generation B: harmless notice-only fixture difference");
  assert.notEqual(a.digest, b.digest, "the qualification variant must be a distinct generation");
  const home = mk(path.join(freshDir(context, "act03"), "home"));
  const first = await installGeneration(a.root, home);
  assert.equal(first.digest, a.digest, "generation A must install first");
  seedActivationData(home);
  const beforeUpdate = captureActivationHome(home);
  const second = await installGeneration(b.root, home);
  const updatePreservation = await assertActivationPublication(home, beforeUpdate, b, { previous: a.digest, retained: [a.digest] });
  assert.equal(second.digest, b.digest, "generation B must install over A");
  let owner = JSON.parse(fs.readFileSync(paths(home).manifest, "utf8"));
  assert.equal(owner.currentRuntime, b.digest, "current runtime after update");
  assert.equal(owner.previousRuntime, a.digest, "previous runtime must be generation A");
  assert.equal(owner.runtimeGenerations.length, 2, "both generations must be retained after update");
  const beforeRollback = captureActivationHome(home);
  const rollback = await rollbackCompleteGeneration(home, { validateCandidate: smokeCandidate });
  const rollbackPreservation = await assertActivationPublication(home, beforeRollback, a, { previous: b.digest, retained: [b.digest] });
  assert.notEqual(rollback.outcome, "noop", "rollback must not be a noop");
  assert.deepEqual(fs.readFileSync(paths(home).profile), beforeUpdate.profile, "rollback must restore exact original A profile bytes");
  owner = JSON.parse(fs.readFileSync(paths(home).manifest, "utf8"));
  assert.equal(owner.currentRuntime, a.digest, "rollback must restore generation A");
  assert.equal(owner.previousRuntime, b.digest, "rollback must make generation B previous");
  assert.equal(exists(path.join(paths(home).runtime, a.digest)), true, "rolled-back generation must be installed");
  return { updatePreservation, rollbackPreservation, caseName: "modern-update-and-real-rollback", generationA: a.digest, generationB: b.digest, rollbackTo: owner.currentRuntime, updatePublished: true };
}

// ---------------------------------------------------------------- ACT-04
async function act04(context) {
  const pkg = await getPkg(context);
  const bundle = await getBundle(context);

  // (a) Otherwise-admissible home with only the REAL maintained exclusion held.
  // The gate holder writes no payload; status must be 'absent' before the managed
  // attempt, so the lone held gate - not unowned targets - is what refuses.
  const loneDir = freshDir(context, "act04-lone");
  const loneHome = mk(path.join(loneDir, "home"));
  const loneMarker = path.join(loneDir, "paused");
  const loneRelease = path.join(loneDir, "release");
  const holder = spawnBounded(GATE_CHILD, context, { home: loneHome, markerFile: loneMarker, releaseFile: loneRelease, pauseBudgetMs: 60000 }, { fixtureDir: loneDir, deadlineMs: 90000 });
  let loneInstallError, loneReleased, lonePrimary;
  try {
    const held = await waitForFile(loneMarker, 60000, () => "out=" + holder.stdout().slice(-400) + " err=" + holder.stderr().slice(-400), holder);
    assert.equal(held, "legacy-gate-held", "gate holder must reach its pause");
    const preAdmission = await inspectCompleteInstallation(loneHome);
    assert.equal(preAdmission.status, "absent", "home must be otherwise admissible; only the held gate may obstruct");
    const before = snapshotTree(loneHome);
    try { await installGeneration(bundle.root, loneHome); } catch (error) { loneInstallError = error; }
    assert.ok(loneInstallError, "managed activation must be refused while the lone maintained gate is held");
    assert.equal(loneInstallError.code, "INSTALL_LOCK_BUSY", "refusal must be the lock-admission exclusion: " + loneInstallError.message);
    assert.match(String(loneInstallError.message), /in progress|INSTALL_LOCK_BUSY/u, "refusal must be a lock guard: " + loneInstallError.message);
    assert.equal(exists(paths(loneHome).manifest), false, "no managed owner may appear under the lone gate");
    assert.deepEqual(snapshotTree(loneHome), before, "the lone-gate refusal must have zero effect on the full home");
    fs.writeFileSync(loneRelease, "go\n", { mode: 0o600 });
    loneReleased = await holder.result();
    assert.equal(loneReleased.releasedLegacyGate, true, "gate holder must confirm legacy gate release");
    assert.equal(exists(path.join(paths(loneHome).base, LEGACY_GATE)), false, "legacy gate must be released");
    assert.equal(exists(path.join(paths(loneHome).base, MANAGED_LOCK)), false, "modern lock must be released");
  } catch (error) { lonePrimary = error; throw error; } finally {
    try { await holder.settle(); } catch (error) { throw lonePrimary ? new AggregateError([lonePrimary, error], "lock case and settlement failed: primary=" + lonePrimary.message + "; cleanup=" + error.message) : error; }
  }

  // (b) Paused historical writer that already published an unowned runtime
  // generation: the maintained pre-admission guard refuses with zero effect.
  const dir = freshDir(context, "act04");
  const home = mk(path.join(dir, "home"));
  const user = mk(path.join(dir, "user"));
  const marker = path.join(dir, "paused");
  const release = path.join(dir, "release");
  const started = spawnBounded(LEGACY_CHILD, context, { repoRoot: context.root, taskRoot: dir, home, user, pkg, mode: "historical", pauseStep: "runtime", markerFile: marker, releaseFile: release, cacheDir: freshDir(context, "act04-cache"), pauseBudgetMs: 100000 }, { fixtureDir: dir, deadlineMs: 120000 });
  let installError, rollbackError, primary;
  try {
    const phase = await waitForFile(marker, 120000, () => "out=" + started.stdout().slice(-400) + " err=" + started.stderr().slice(-400), started);
    assert.equal(phase, "runtime", "historical writer must pause at the runtime step");
    const before = snapshotTree(home);
    try { await installGeneration(bundle.root, home); } catch (error) { installError = error; }
    assert.deepEqual(snapshotTree(home), before, "paused historical writer: install refusal independently preserves home");
    try { await rollbackCompleteGeneration(home, {}); } catch (error) { rollbackError = error; }
    assert.ok(installError, "managed activation must be refused while the pre-W5 writer holds the gate");
    assert.ok(rollbackError, "managed mutation must be refused while the pre-W5 writer holds the gate");
    const guard = /unowned installation targets|in progress|installation lock|INSTALL_LOCK_BUSY/u;
    assert.match(String(installError.message), guard, "managed refusal must be an admission/exclusion guard: " + installError.message);
    assert.match(String(rollbackError.message), guard, "managed rollback refusal must be an admission/exclusion guard: " + rollbackError.message);
    assert.equal(exists(paths(home).manifest), false, "no managed owner manifest may appear while excluded");
    assert.equal(exists(path.join(paths(home).base, LEGACY_GATE, "owner.json")), true, "the paused pre-W5 gate must stay held");
    assert.deepEqual(snapshotTree(home), before, "managed operations must have zero effect on the full home while excluded");
    return {
      caseName: "lone-gate-and-paused-old-writer-exclusion",
      loneGate: { otherwiseAdmissible: true, refused: true, code: loneInstallError.code, releasedLegacyGate: loneReleased.releasedLegacyGate === true },
      pausedWriter: { pausedStep: phase, installRefused: true, rollbackRefused: true, installReason: String(installError.message).slice(0, 120), rollbackReason: String(rollbackError.message).slice(0, 120) },
      zeroEffect: true, gateHeld: true,
    };
  } catch (error) { primary = error; throw error; }
  finally {
    try { await started.settle(); } catch (error) { throw primary ? new AggregateError([primary, error], "activation and settlement failed: primary=" + primary.message + "; cleanup=" + error.message) : error; }
  }
}

// ---------------------------------------------------------------- ACT-05
async function act05(context) {
  // Preserve the original absent-home lock gate AND cover populated admissible
  // legacy state. Modern owners are rejected by legacy pre-admission before
  // locks, so they are not a valid fixture for the same lock-cause assertion.
  const absent = await pausedManagedExclusion(context, false);
  const seededLegacy = await pausedManagedExclusion(context, true);
  return { caseName: 'paused-managed-excludes-old-and-updated-writers', absent, seededLegacy };
}
async function pausedManagedExclusion(context, seeded) {
  const pkg = await getPkg(context);
  const bundle = await getBundle(context);
  const dir = freshDir(context, seeded ? 'act05-seeded' : 'act05-absent');
  const home = mk(path.join(dir, 'home'));
  if (seeded) {
    const seedGuard = installLegacyCleanupGuard(dir);
    try {
      const loaded = await loadMaintainedInstaller(context.root, freshDir(context, 'act05-seed-cache'), { inertTrust: true });
      assert.ok(loaded.module, 'real maintained seed writer must load');
      const user = mk(path.join(dir, 'user-seed'));
      loaded.module.installUserAgent(pkg, { KIRO_HOME: home }, user, {});
      const firstLegacy = captureActivationHome(home);
      loaded.module.installUserAgent(pkg, { KIRO_HOME: home }, user, {});
      assertLegacyBackupSeed(home, firstLegacy);
    } finally { seedGuard.restore(); }
    assert.equal((await inspectCompleteInstallation(home)).status, 'legacy');
  }
  seedActivationData(home);
  const beforeActivation = captureActivationHome(home);
  const marker = path.join(dir, "paused");
  const release = path.join(dir, "release");
  const started = spawnBounded(INSTALL_CHILD, context, { repoRoot: context.root, home, bundleRoot: bundle.root, bundleTaskRoot: bundle.taskRoot, publicSelection: bundle.source === "public-active", expectedDigest: bundle.digest, pausePhase: "candidate-validated", markerFile: marker, releaseFile: release, pauseBudgetMs: 150000 }, { fixtureDir: dir, deadlineMs: 200000 });
  let primary;
  try {
    const phase = await waitForFile(marker, 200000, () => "out=" + started.stdout().slice(-400) + " err=" + started.stderr().slice(-400), started);
    assert.equal(phase, "candidate-validated", "managed activation must pause after real candidate validation");
    if (seeded) assert.deepEqual(fs.readFileSync(paths(home).manifest), beforeActivation.owner, "paused migration preserves the exact legacy owner");
    else assert.equal(exists(paths(home).manifest), false, "owner manifest must be absent during a paused candidate transaction");
    assert.equal(exists(path.join(paths(home).base, ".transactions", "candidate.json")), true, "pending candidate journal must exist during the pause");

    const beforeWriters = snapshotTree(home);
    const guard = installLegacyCleanupGuard(dir);
    let historicalError, maintainedError;
    try {
      // Guard precedes BOTH dynamic imports and every execution/failure path.
      const historical = await loadHistoricalInstaller(context.root, freshDir(context, "act05-hist"));
      assert.ok(historical.available, "pinned pre-W5 entrypoint must be available: " + historical.reason);
      const maintained = await loadMaintainedInstaller(context.root, freshDir(context, "act05-maint"), { inertTrust: true });
      assert.ok(maintained.module, "maintained legacy writer must load");
      try { historical.module.installUserAgent(pkg, { KIRO_HOME: home }, path.join(dir, "user-old"), {}); } catch (error) { historicalError = error; }
      assert.deepEqual(snapshotTree(home), beforeWriters, "historical refusal independently preserves the complete home");
      const beforeMaintained = snapshotTree(home);
      try { maintained.module.installUserAgent(pkg, { KIRO_HOME: home }, path.join(dir, "user-new"), {}); } catch (error) { maintainedError = error; }
      assert.deepEqual(snapshotTree(home), beforeMaintained, "maintained refusal independently preserves the complete home");
    } finally { guard.restore(); }
    assert.ok(historicalError, "paused managed transaction must exclude the authentic pre-W5 writer");
    assert.match(String(historicalError.message), /in progress|installation lock|INSTALL_LOCK_BUSY/u, "historical writer must be denied by the held exclusion: " + historicalError.message);
    assert.ok(maintainedError, "paused managed transaction must exclude the updated legacy writer");
    assert.equal(maintainedError.code, "INSTALL_LOCK_BUSY", "updated writer must be excluded by the held managed lock: " + maintainedError.message);
    if (seeded) assert.deepEqual(fs.readFileSync(paths(home).manifest), beforeActivation.owner, "excluded writers must not replace the legacy owner");
    else assert.equal(exists(paths(home).manifest), false, "excluded writers must not publish a managed owner");
    assert.deepEqual(snapshotTree(home), beforeWriters, "excluded legacy writers must have zero effect on the full home");

    fs.writeFileSync(release, "go\n", { mode: 0o600 });
    const outcome = await started.result();
    assert.equal(outcome.outcome, "activated", "paused managed activation must complete after release: " + started.stdout() + started.stderr());
    assert.equal(outcome.committed, true, "managed activation must commit");
    assert.equal(outcome.digest, bundle.digest, "managed activation must publish the staged bundle");
    assert.equal(exists(paths(home).manifest), true, "owner manifest must exist after release");
    assert.equal(exists(path.join(paths(home).base, LEGACY_GATE)), false, "legacy gate must be released after completion");
    assert.equal(exists(path.join(paths(home).base, MANAGED_LOCK)), false, "managed lock must be released after completion");
    const preservation = await assertActivationPublication(home, beforeActivation, bundle, { legacyManifest: seeded ? beforeActivation.owner : null });
    return { preservation, settlement: outcome.settlement, caseName: "paused-managed-excludes-old-and-updated-writers", pausedStep: phase, historicalDenied: true, maintainedCode: maintainedError.code, activatedAfterRelease: true, zeroEffect: true };
  } catch (error) { primary = error; throw error; }
  finally {
    try { await started.settle(); } catch (error) { throw primary ? new AggregateError([primary, error], "activation and settlement failed: primary=" + primary.message + "; cleanup=" + error.message) : error; }
  }
}

// ---------------------------------------------------------------- ACT-06
async function act06(context) {
  const bundle = await getBundle(context);
  const home = mk(path.join(freshDir(context, "act06"), "home"));
  let injected = false;
  const failing = async () => { injected = true; throw new Error("activation qualification: injected candidate validation failure"); };
  let installError;
  try { await installGeneration(bundle.root, home, { validateCandidate: failing }); } catch (error) { installError = error; }
  assert.equal(injected, true, "the injected candidate fault must be reached");
  assert.ok(installError, "the injected candidate failure must surface");
  assert.equal(installError.message, "activation qualification: injected candidate validation failure");
  assert.equal(installError.committed, false);
  assert.equal(installError.recoveryRequired, true, "a failed activation with a pending candidate must require recovery");
  const p = paths(home);
  assert.equal(exists(path.join(p.base, ".transactions", "candidate.json")), true, "pending candidate journal must be retained");
  assert.equal(exists(path.join(p.base, LEGACY_GATE, "owner.json")), true, "failed activation must retain the legacy admission fence");
  assert.equal(exists(p.manifest), false, "no owner may be committed on failure");
  const before = snapshotTree(home);

  // Fail-safe: automatic recovery must NOT silently reclaim the retained fence.
  let recoveryError;
  try { await recoverCompleteInstallation(home); } catch (error) { recoveryError = error; }
  assert.ok(recoveryError, "automatic recovery must be refused while the retained fence is held");
  assert.equal(recoveryError.code, "INSTALL_LOCK_BUSY");
  assert.equal(recoveryError.message, "another Kiro Fabric installation mutation is in progress");
  assert.deepEqual(snapshotTree(home), before, "recovery refusal independently preserves retained fence state");
  const beforeReinstall = snapshotTree(home);
  let reinstallError;
  try { await installGeneration(bundle.root, home); } catch (error) { reinstallError = error; }
  assert.ok(reinstallError, "a fresh activation must be fenced while the retained gate is held");
  assert.equal(reinstallError.code, "INSTALL_LOCK_BUSY");
  assert.equal(reinstallError.message, "another Kiro Fabric installation mutation is in progress");
  assert.deepEqual(snapshotTree(home), beforeReinstall, "reinstall refusal independently preserves retained fence state");
  assert.equal(exists(p.manifest), false, "no owner may be invented during the fence");
  assert.deepEqual(snapshotTree(home), before, "the fenced failure state must be preserved byte-for-byte across the full home");
  return { caseName: "fail-safe-retained-fence-and-refused-auto-recovery", injected, installRecoveryRequired: true, candidateRetained: true, gateRetained: true, autoRecoveryRefused: true, reinstallRefused: true };
}

// ---------------------------------------------------------------- ACT-07
async function act07(context) {
  const dir = freshDir(context, "act07");
  const stale = path.join(dir, "stale-closure");
  fs.cpSync(path.join(context.root, "dist", "kiro-agent-closure"), stale, { recursive: true });
  const manifestPath = path.join(stale, "closure-manifest.json");
  const original = fs.readFileSync(manifestPath);
  const { stageGenuineCompleteBundle } = await import("./activation-bundle.mjs");
  const fixtureEntriesBefore = fs.readdirSync(dir).sort();
  const currentClosureManifest = path.join(context.root, "dist", "kiro-agent-closure", "closure-manifest.json");
  const currentClosureManifestSha = sha(fs.readFileSync(currentClosureManifest));

  // (a) Self-consistent but stale build-input identity: refused before staging.
  const forged = JSON.parse(original.toString());
  forged.buildInputs.files[0].sha256 = "1".repeat(64);
  forged.buildInputs.digest = sha(Buffer.from(JSON.stringify(forged.buildInputs.files)));
  fs.writeFileSync(manifestPath, JSON.stringify(forged, null, 2) + "\n", { mode: 0o600 });
  const beforeStaleRefusal = snapshotTree(dir);
  let staleError;
  try { await stageGenuineCompleteBundle({ repoRoot: context.root, fixtureRoot: dir, label: "stale-inputs", closure: stale }); }
  catch (error) { staleError = error; }
  assert.ok(staleError, "a closure with stale build inputs must be refused");
  assert.match(String(staleError.message), /Build inputs changed|Invalid build input provenance/u, "stale refusal must be a build-input identity failure: " + staleError.message);
  assert.deepEqual(snapshotTree(dir), beforeStaleRefusal, "stale-input refusal must preserve all fixture bytes/metadata");
  fs.writeFileSync(manifestPath, original, { mode: 0o600 });

  // (b) Corrupted/mixed closure bytes: refused before staging.
  const victim = path.join(stale, "package.json");
  const victimBytes = fs.readFileSync(victim);
  fs.appendFileSync(victim, "\n");
  const beforeMixedRefusal = snapshotTree(dir);
  let mixedError;
  try { await stageGenuineCompleteBundle({ repoRoot: context.root, fixtureRoot: dir, label: "mixed-bytes", closure: stale }); }
  catch (error) { mixedError = error; }
  assert.ok(mixedError, "a corrupted closure must be refused");
  assert.equal(mixedError.message, "Closure manifest checksum mismatch: package.json");
  assert.deepEqual(snapshotTree(dir), beforeMixedRefusal, "mixed-byte refusal must preserve all fixture bytes/metadata");
  fs.writeFileSync(victim, victimBytes, { mode: 0o600 });

  // Both refusals must happen before any staging/output directory or compiler is
  // created: the fixture root's inventory is unchanged.
  assert.deepEqual(fs.readdirSync(dir).sort(), fixtureEntriesBefore, "stale/mixed refusals must not write any staging output");
  assert.equal(sha(fs.readFileSync(manifestPath)), sha(original), "the stale-closure manifest must be restored to its original bytes");

  // Real good/control: the untouched current closure stages, validates, and its
  // captured build-input identity matches the live checkout and differs from the
  // forged stale identity. The current closure manifest bytes are unchanged.
  const good = await getBundle(context);
  const { captureBuildInputs } = await import("../build-inputs.mjs");
  assert.equal(good.buildInputsDigest, captureBuildInputs(context.root).digest, "genuine bundle must bind the current checkout build-input digest");
  assert.ok(/^[a-f0-9]{64}$/u.test(good.closureContentDigest ?? ""), "genuine bundle must record a closure content digest");
  assert.notEqual(good.buildInputsDigest, forged.buildInputs.digest, "the genuine control must differ from the forged stale input identity");
  const revalidated = await validateBundle(good.root);
  assert.equal(revalidated.digest, good.digest, "genuine control bundle must revalidate");
  assert.equal(sha(fs.readFileSync(currentClosureManifest)), currentClosureManifestSha, "the current closure manifest must be unchanged by the control staging");
  return { caseName: "stale-or-mixed-closure-refused-and-genuine-control", staleRefused: true, mixedRefused: true, staleReason: String(staleError.message).slice(0, 140), mixedReason: String(mixedError.message).slice(0, 140), genuineControlDigest: good.digest, controlSelection: good.source, controlRestaged: false, genuineInputsPreserved: true, noOutputWrites: true };
}

// ---------------------------------------------------------------- ACT-08
// ACT-04 retains BOTH original lock gates. This separate case requires actual
// backend entry past all admission and tool-version checks, not a callback throw.
async function act08(context) {
  const bundle = await getBundle(context);
  const dir = freshDir(context, 'act08');
  const home = mk(path.join(dir, 'home'));
  seedActivationData(home);
  assert.equal((await inspectCompleteInstallation(home)).status, 'absent');
  const { smokeWithBackendInventoryFault } = await import('./activation-backend-diagnostic.mjs');
  const phases = [];
  let atBackend, failure;
  try {
    await installGeneration(bundle.root, home, {
      onPhase: phase => phases.push(phase),
      validateCandidate: async candidate => {
        atBackend = snapshotTree(home);
        return smokeWithBackendInventoryFault(candidate);
      },
    });
  } catch (error) { failure = error; }
  assert.ok(atBackend, 'must enter actual candidate callback past admission');
  assert.equal(failure?.message, 'Candidate raw backend inventory mismatch');
  assert.equal(failure?.activationBackendDiagnostic?.faultInjected, true);
  assert.equal(failure?.activationBackendDiagnostic?.closed, true);
  assert.equal(failure.committed, false); assert.equal(failure.recoveryRequired, true);
  assert.ok(phases.includes('before-candidate-validation'));
  for (const phase of ['candidate-validated', 'generation-published', 'profile-published', 'owner-committed']) assert.equal(phases.includes(phase), false, 'backend failure must not publish: ' + phase);
  const after = snapshotTree(home);
  assertSnapshotDelta(atBackend, after, { directories: ['kiro-fabric'], removals: ['kiro-fabric/.install-lock', 'kiro-fabric/.install-lock/owner.json'] });
  assert.equal(exists(paths(home).manifest), false);
  assert.equal(exists(paths(home).profile), false);
  assert.equal(exists(path.join(paths(home).runtime, bundle.digest)), false);
  assert.equal(exists(path.join(paths(home).base, '.transactions/candidate.json')), true);
  assert.equal(exists(path.join(paths(home).base, '.install.lock/owner.json')), true);
  return { caseName: 'real-backend-inventory-diagnostic-before-publication', cause: failure.message, diagnostic: failure.activationBackendDiagnostic, retainedCandidateAndFence: true, recovered: false };
}

export const requiredIds = Object.freeze(["ACT-01", "ACT-02", "ACT-03", "ACT-04", "ACT-05", "ACT-06", "ACT-07", "ACT-08"]);

/** @returns {any[]} Maintained-suite case entries (ACT ids; Main owns registration). */
export function createCases() {
  const entries = [
    { id: "ACT-01", title: "fresh real activation of a genuine complete bundle", effects: "real installCompleteGeneration + smokeCandidate on a retained fixture home", deadlineMs: DEFAULT_CASE_DEADLINE_MS, run: act01 },
    { id: "ACT-02", title: "real legacy installation migration retains legacy ownership", effects: "maintained legacy writer install of the staged package, then real managed activation", deadlineMs: DEFAULT_CASE_DEADLINE_MS, run: act02 },
    { id: "ACT-03", title: "modern update publishes and rolls back two genuine generations", effects: "two task-owned genuine bundles + real rollbackCompleteGeneration", deadlineMs: DEFAULT_CASE_DEADLINE_MS, run: act03 },
    { id: "ACT-04", title: "lone held gate and paused pre-W5 writer exclude managed activation and mutation", effects: "maintained exclusion holder on an otherwise-admissible home + bounded pre-W5 child; real managed admission refusals with full-home zero-effect snapshots", deadlineMs: DEFAULT_CASE_DEADLINE_MS, run: act04 },
    { id: "ACT-05", title: "paused managed transaction excludes old and updated writers", effects: "bounded paused managed activation child; real legacy writer refusals with full-home zero-effect snapshots and a strict child result receipt", deadlineMs: DEFAULT_CASE_DEADLINE_MS, run: act05 },
    { id: "ACT-06", title: "failed activation retains the fence and refuses automatic recovery", effects: "injected candidate fault; real recoverCompleteInstallation refusal; retained state", deadlineMs: DEFAULT_CASE_DEADLINE_MS, run: act06 },
    { id: "ACT-07", title: "stale or mixed bundle closure is refused before staging, with a genuine control", effects: "production build-input/closure identity guards; no staging output; genuine current-closure control bundle", deadlineMs: DEFAULT_CASE_DEADLINE_MS, run: act07 },
    { id: 'ACT-08', title: 'actual backend diagnostic gate past admission retains candidate/fence', effects: 'real production smoke plus explicit tools/list response fault after genuine initialization; no publication; retained evidence', deadlineMs: DEFAULT_CASE_DEADLINE_MS, run: act08 },
  ];
  return entries.map(entry => ({ ...entry, run: async context => {
    if (inheritedCaseGroup() === null) throw Error('Activation qualification requires maintained case supervision');
    const sourceFiles = ['activation-cases.mjs', 'activation-bundle.mjs', 'activation-snapshot.mjs', 'activation-preservation.mjs', 'activation-legacy-cleanup.mjs', 'activation-backend-diagnostic.mjs', 'activation-install-child.mjs', 'activation-legacy-gate-child.mjs', 'activation-paused-legacy-writer-child.mjs'];
    const sources = () => Object.fromEntries(sourceFiles.map(name => [name, sha(fs.readFileSync(path.join(context.root, 'scripts/verification', name)))]));
    const sourceHashes = sources();
    const legacyFixtureSha256 = sha(fs.readFileSync(path.join(context.root, 'scripts/verification/fixtures/w5/install-agent-user.pre-w5.mjs.txt')));
    assert.equal(legacyFixtureSha256, '43c1932d604a66117d26cba1fbfd5e11eed0b7891e58a300b04df720730fdc6b');
    const facts = await entry.run(context);
    assert.deepEqual(sources(), sourceHashes, 'activation harness source drifted during case');
    return { ...facts, bundles: context.activationIdentities ?? {}, sourceHashes, legacyFixtureSha256, supervision: 'maintained case worker; execution deadline enforced externally', detachedNavigatorForcedSettlement: 'unqualified' };
  } }));
}

export const createActivationCases = createCases;

/** The former direct loop did not enforce its advertised deadlines. Refuse
 * BEFORE any candidate/staging execution. Use the maintained offline supervisor.
 * Detached Navigator forced settlement is still explicitly unqualified. */
export async function runActivationMatrix() {
  throw Error('Unsupervised activation matrix refused: use verify-offline activation with maintained case supervision; detached Navigator forced settlement remains unqualified');
}
