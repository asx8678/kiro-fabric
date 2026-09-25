// W5 hardening regressions: independent-reviewer fault schedules exercised
// through the REAL production lock source. The model functions run
// installer-lock.mjs with injected in-memory fs/process; the disk functions run
// the same source on real retained fixture directories with surgical faul
// injection. No toy lock algorithm is reimplemented here.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createModelLockFixture } from "./w5-hardening-model.mjs";

const LEGACY = ".install.lock";
const gateOf = (base) => path.join(base, LEGACY);
const ownerOf = (base) => path.join(gateOf(base), "owner.json");

/** Reviewer schedule 1 (disk): a foreign owner appears before our O_EXCL open. */
export async function diskForeignOwner(lock, base) {
  const gate = gateOf(base), owner = ownerOf(base);
  const originalOpen = fs.openSync;
  let injected = false;
  fs.openSync = function (target, ...args) {
    if (target === owner && !injected) {
      injected = true;
      fs.writeFileSync(owner, JSON.stringify({ pid: process.pid, nonce: "b".repeat(64) }) + "\n", { mode: 0o600 });
    }
    return originalOpen.call(fs, target, ...args);
  };
  let held = true, code = null;
  try { lock.acquireInstallationExclusion(base); }
  catch (error) { held = false; code = error.code ?? error.message; }
  finally { fs.openSync = originalOpen; }
  const facts = { injected, held, code, foreignPreserved: fs.existsSync(owner), gatePreserved: fs.existsSync(gate) };
  assert.equal(injected, true, "disk foreign-owner injection must fire");
  assert.equal(held, false, "foreign legacy owner must refuse acquisition");
  assert.equal(facts.foreignPreserved, true, "foreign EEXIST evidence must be preserved");
  assert.equal(facts.gatePreserved, true, "the foreign gate directory must be preserved");
  return facts;
}

/** Reviewer schedule 1 (model): same, against injected in-memory fs/process. */
export async function modelForeignOwner(fixturesRoot) {
  const { memory, lock } = await createModelLockFixture(fixturesRoot, { label: "lk12-model" });
  const base = "/lk12";
  memory.mkdirSync(base, { mode: 0o700 });
  const gate = base + "/" + LEGACY, owner = gate + "/owner.json";
  const originalOpen = memory.openSync;
  let injected = false;
  memory.openSync = function (target, flags, mode) {
    if (target === owner && !injected) {
      injected = true;
      memory.writeFileSync(owner, JSON.stringify({ pid: process.pid, nonce: "b".repeat(64) }) + "\n");
    }
    return originalOpen.call(memory, target, flags, mode);
  };
  let held = true, code = null;
  try { lock.acquireInstallationExclusion(base); }
  catch (error) { held = false; code = error.code ?? error.message; }
  finally { memory.openSync = originalOpen; }
  const facts = { injected, held, code, foreignPreserved: memory.existsSync(owner), gatePreserved: memory.existsSync(gate) };
  assert.equal(injected, true, "model foreign-owner injection must fire");
  assert.equal(held, false, "model foreign legacy owner must refuse acquisition");
  assert.equal(facts.foreignPreserved, true, "model foreign evidence must be preserved");
  assert.equal(facts.gatePreserved, true, "model foreign gate must be preserved");
  // Root validation must precede any mkdir/write: an unsafe root refuses with no gate.
  const unsafe = "/lk12-unsafe";
  memory.mkdirSync(unsafe, { mode: 0o755 });
  let unsafeCode = null;
  try { lock.acquireInstallationExclusion(unsafe); } catch (error) { unsafeCode = error.code ?? error.message; }
  const unsafeNoGate = !memory.existsSync(unsafe + "/" + LEGACY);
  assert.ok(unsafeCode, "an unsafe installation root must be refused");
  assert.equal(unsafeNoGate, true, "root validation must occur before any gate mkdir/write");
  facts.rootValidatedFirst = true;
  return facts;
}

/** Reviewer schedule 2 (disk): identical bytes, different owner inode. */
export async function diskSameBytesOwner(lock, base) {
  const owner = ownerOf(base);
  const release = lock.acquireInstallationExclusion(base);
  const bytes = fs.readFileSync(owner);
  const before = fs.statSync(owner).ino;
  fs.renameSync(owner, path.join(base, "original-owner.json"));
  fs.writeFileSync(owner, bytes, { mode: 0o600 });
  const replaced = fs.statSync(owner).ino !== before;
  let refused = false;
  try { release(); } catch { refused = true; }
  const facts = { replaced, refused, replacementPreserved: fs.existsSync(owner), releasedFlag: release.releasedLegacyGate, retainedFlag: release.retainedLegacyGate };
  assert.equal(replaced, true, "disk replacement inode must differ");
  assert.equal(refused, true, "a same-bytes replacement owner inode must refuse release");
  assert.equal(facts.replacementPreserved, true, "replacement owner bytes must be preserved");
  assert.equal(facts.releasedFlag, false, "a refused release must not report physical release");
  assert.equal(facts.retainedFlag, true, "a refused release must report retention");
  return facts;
}

/** Reviewer schedule 2 (model): same, against injected in-memory fs/process. */
export async function modelSameBytesOwner(fixturesRoot) {
  const { memory, lock } = await createModelLockFixture(fixturesRoot, { label: "lk13-model" });
  const base = "/lk13";
  memory.mkdirSync(base, { mode: 0o700 });
  const gate = base + "/" + LEGACY, owner = gate + "/owner.json";
  const release = lock.acquireInstallationExclusion(base);
  const bytes = Buffer.from(memory.readFileSync(owner));
  const before = memory.__nodes.get(owner).ino;
  memory.unlinkSync(owner);
  memory.writeFileSync(owner, bytes);
  const replaced = memory.__nodes.get(owner).ino !== before;
  let refused = false;
  try { release(); } catch { refused = true; }
  const facts = { replaced, refused, replacementPreserved: memory.existsSync(owner), releasedFlag: release.releasedLegacyGate, retainedFlag: release.retainedLegacyGate };
  assert.equal(replaced, true, "model replacement inode must differ");
  assert.equal(refused, true, "model same-bytes replacement owner inode must refuse release");
  assert.equal(facts.replacementPreserved, true, "model replacement owner bytes must be preserved");
  assert.equal(facts.releasedFlag, false, "model refused release must not report release");
  assert.equal(facts.retainedFlag, true, "model refused release must report retention");
  return facts;
}

/** Reviewer schedule 3 (model): final gate fsync EIO must be physically
 * released/durability-uncertain; retry finishes durability only. */
export async function modelReleaseDurability(fixturesRoot) {
  const { memory, lock } = await createModelLockFixture(fixturesRoot, { label: "lk14-model" });
  const base = "/lk14";
  memory.mkdirSync(base, { mode: 0o700 });
  const gate = base + "/" + LEGACY, owner = gate + "/owner.json";
  const release = lock.acquireInstallationExclusion(base);
  const originalFsync = memory.fsyncSync, originalRmdir = memory.rmdirSync;
  let removed = false, injected = false;
  memory.rmdirSync = function (target) { const value = originalRmdir.call(memory, target); if (target === gate) removed = true; return value; };
  memory.fsyncSync = function (fd) {
    if (removed && !injected) { injected = true; throw Object.assign(new Error("injected final gate fsync EIO"), { code: "EIO" }); }
    return originalFsync.call(memory, fd);
  };
  let firstOk = true, error = null;
  try { release(); } catch (caught) { firstOk = false; error = caught; }
  memory.fsyncSync = originalFsync; memory.rmdirSync = originalRmdir;
  const firstFacts = { injected, firstOk, released: error?.legacyGateReleased, durabilityUncertain: error?.legacyGateDurabilityUncertain, retained: error?.legacyGateRetained };
  const modernGone = !memory.existsSync(base + "/.install-lock");
  const gateGoneAfterFirst = !memory.existsSync(gate);
  // A replacement gate created after the physical release must survive retry.
  memory.mkdirSync(gate, { mode: 0o700 });
  memory.writeFileSync(owner, JSON.stringify({ pid: process.pid, nonce: "c".repeat(64) }) + "\n");
  let retryOk = true, retryError = null;
  try { release(); } catch (caught) { retryOk = false; retryError = caught; }
  const facts = { ...firstFacts, firstOk, modernGone, gateGoneAfterFirst, retryOk, retryError: retryError ? retryError.message : null, replacementPreserved: memory.existsSync(owner), retryReleased: release.releasedLegacyGate, retryRetained: release.retainedLegacyGate };
  assert.equal(injected, true, "final gate fsync fault must fire");
  assert.equal(firstOk, false, "the injected fsync fault must surface");
  assert.equal(firstFacts.released, true, "a physically removed gate must report released");
  assert.equal(firstFacts.durabilityUncertain, true, "durability of the removal fsync must be uncertain");
  assert.equal(firstFacts.retained, false, "a physically removed gate must NOT report retained");
  assert.equal(modernGone, true, "modern lock must be released");
  assert.equal(gateGoneAfterFirst, true, "gate must be physically removed before the fsync fault");
  assert.equal(retryOk, true, "retry must finish the durability fsync");
  assert.equal(facts.replacementPreserved, true, "retry must never remove a replacement gate");
  assert.equal(release.releasedLegacyGate, true, "retry must keep physical release truth");
  assert.equal(release.retainedLegacyGate, false, "retry must never report false retention");
  return facts;
}

/** Reviewer schedule 4 (model): late retention from the modern release callback,
 * plus a reentrant release that must not double-release. */
export async function modelLateRetention(fixturesRoot) {
  const { memory, lock } = await createModelLockFixture(fixturesRoot, { label: "lk15-model" });
  const base = "/lk15";
  memory.mkdirSync(base, { mode: 0o700 });
  const gate = base + "/" + LEGACY;
  let release;
  let requested = false, reentrantSameObject = false, reentrantFlags = {};
  release = lock.acquireInstallationExclusion(base, {
    onPhase: (phase) => {
      if (phase === "release-before-remove") {
        requested = true;
        release.retainLegacyGate();
        const inner = release();
        reentrantSameObject = inner === release;
        reentrantFlags = { released: release.releasedLegacyGate, retained: release.retainedLegacyGate };
      }
    },
  });
  release();
  const retained = release.retainedLegacyGate, released = release.releasedLegacyGate;

  // Second schedule: reentrant release WITHOUT retention must not release twice.
  const base2 = "/lk15b";
  memory.mkdirSync(base2, { mode: 0o700 });
  const gate2 = base2 + "/" + LEGACY;
  let release2, phases = 0, innerError = null;
  release2 = lock.acquireInstallationExclusion(base2, {
    onPhase: (phase) => { if (phase === "release-before-remove") { phases++; try { release2(); } catch (caught) { innerError = caught.message; } } },
  });
  release2();

  const facts = { requested, retained, released, gateExists: memory.existsSync(gate), reentrantSameObject, reentrantReleased: reentrantFlags?.released, reentrantRetained: reentrantFlags?.retained, phases, innerError, gate2Removed: !memory.existsSync(gate2), release2Released: release2.releasedLegacyGate, release2Retained: release2.retainedLegacyGate };
  assert.equal(requested, true, "the release callback must run");
  assert.equal(retained, true, "late retainLegacyGate must take effect");
  assert.equal(released, false, "a retained gate must not report release");
  assert.equal(facts.gateExists, true, "a retained gate must remain on disk");
  assert.equal(reentrantSameObject, true, "reentrant release must return the same release handle");
  assert.equal(facts.reentrantReleased, false, "reentrant release must not report release before commit");
  assert.equal(facts.reentrantRetained, true, "reentrant release must observe the retained request");
  assert.equal(retained && released, false, "release must never report both retained and released");
  assert.equal(phases, 1, "reentrant release must not re-enter the release phase machine");
  assert.equal(innerError, null, "reentrant release must not throw");
  assert.equal(facts.gate2Removed, true, "a non-retaining reentrant release must complete once");
  assert.equal(release2.releasedLegacyGate, true, "a completed release must report release");
  assert.equal(release2.retainedLegacyGate, false, "a completed release must not report retention");
  return facts;
}

/** Model admission/retention: modern ownership still fences admission; retention
 * evidence is read while modern is held; clean release restores admission; the
 * unchanged modern helper still excludes independently. */
export async function modelAdmissionHandoff(fixturesRoot) {
  const { memory, lock } = await createModelLockFixture(fixturesRoot, { label: "lk16-model" });
  const base = "/lk16";
  memory.mkdirSync(base, { mode: 0o700 });
  const order = [];
  const originalLstat = memory.lstatSync, originalRmdir = memory.rmdirSync;
  memory.lstatSync = function (target, opts) { if (typeof target === "string" && target.includes("/.transactions/")) order.push("evidence-read"); return originalLstat.call(memory, target, opts); };
  memory.rmdirSync = function (target) { if (typeof target === "string" && target.endsWith("/.install-lock")) order.push("modern-lock-removed"); return originalRmdir.call(memory, target); };
  const release = lock.acquireInstallationExclusion(base);
  const secondBlocked = (() => { try { lock.acquireInstallationExclusion(base); return null; } catch (error) { return error.code; } })();
  memory.mkdirSync(base + "/.transactions", { mode: 0o700 });
  memory.writeFileSync(base + "/.transactions/active.json", "{}\n");
  release();
  memory.lstatSync = originalLstat; memory.rmdirSync = originalRmdir;
  const evidenceIndex = order.indexOf("evidence-read"), modernIndex = order.indexOf("modern-lock-removed");
  const evidenceWhileModernHeld = evidenceIndex >= 0 && modernIndex >= 0 && evidenceIndex < modernIndex;

  const base2 = "/lk16b";
  memory.mkdirSync(base2, { mode: 0o700 });
  const clean = lock.acquireInstallationExclusion(base2);
  clean();
  let cleanReacquire = null;
  try { lock.acquireInstallationExclusion(base2)(); } catch (error) { cleanReacquire = error.code; }

  const base3 = "/lk16c";
  memory.mkdirSync(base3, { mode: 0o700 });
  const modern = lock.acquireInstallationLock(base3, { recover: false });
  const modernSecond = (() => { try { lock.acquireInstallationLock(base3, { recover: false }); return null; } catch (error) { return error.code; } })();
  modern();
  let modernReacquire = null;
  try { lock.acquireInstallationLock(base3, { recover: false })(); } catch (error) { modernReacquire = error.code; }

  const facts = {
    secondBlocked, evidenceWhileModernHeld, evidenceIndex, modernIndex,
    retained: release.retainedLegacyGate, released: release.releasedLegacyGate,
    gateExists: memory.existsSync(base + "/" + LEGACY), modernGone: !memory.existsSync(base + "/.install-lock"),
    cleanReacquire, modernSecond, modernReacquire,
  };
  assert.equal(secondBlocked, "INSTALL_LOCK_BUSY", "modern ownership must fence a second admission");
  assert.equal(evidenceWhileModernHeld, true, "retention evidence must be read while the modern lock is held");
  assert.equal(facts.retained, true, "pending transaction evidence must retain the gate");
  assert.equal(facts.released, false, "a retained handoff must not report release");
  assert.equal(facts.gateExists, true, "the retained gate must remain");
  assert.equal(facts.modernGone, true, "the modern lock must still be released after retention");
  assert.equal(cleanReacquire, null, "a clean release must restore admission");
  assert.equal(modernSecond, "INSTALL_LOCK_BUSY", "the unchanged modern helper must exclude independently");
  assert.equal(modernReacquire, null, "the unchanged modern helper must release cleanly");
  return facts;
}

/** Reviewer schedule 5 (model): retention requested from the two legacy release
 * callbacks. Before the physical gate removal it preserves the gate directory;
 * at/after the gate removal it is refused and only release is reported. Also
 * checks a reentrant release initiated from a legacy callback. */
export async function modelLateLegacyRetention(fixturesRoot) {
  const { memory, lock } = await createModelLockFixture(fixturesRoot, { label: "lk-legacy-late-model" });

  // A. retention from `legacy-owner-removed` (before the physical gate removal).
  const baseA = "/lklr-a";
  memory.mkdirSync(baseA, { mode: 0o700 });
  const gateA = baseA + "/" + LEGACY, ownerA = gateA + "/owner.json";
  let releaseA, requestedA = false;
  const phasesA = [];
  releaseA = lock.acquireInstallationExclusion(baseA, {
    onPhase: (phase) => {
      if (phase.startsWith("legacy-")) phasesA.push(phase);
      if (phase === "legacy-owner-removed") { requestedA = true; releaseA.retainLegacyGate(); }
    },
  });
  releaseA();
  const a = { requested: requestedA, retained: releaseA.retainedLegacyGate, released: releaseA.releasedLegacyGate, gateExists: memory.existsSync(gateA), ownerExists: memory.existsSync(ownerA), phases: phasesA.slice() };

  // B. retention from `legacy-gate-removed` (after the physical removal).
  const baseB = "/lklr-b";
  memory.mkdirSync(baseB, { mode: 0o700 });
  const gateB = baseB + "/" + LEGACY;
  let releaseB, requestedB = false;
  releaseB = lock.acquireInstallationExclusion(baseB, {
    onPhase: (phase) => { if (phase === "legacy-gate-removed") { requestedB = true; releaseB.retainLegacyGate(); } },
  });
  releaseB();
  const b = { requested: requestedB, retained: releaseB.retainedLegacyGate, released: releaseB.releasedLegacyGate, gateExists: memory.existsSync(gateB) };

  // C. reentrant release from `legacy-owner-removed` must not release twice.
  const baseC = "/lklr-c";
  memory.mkdirSync(baseC, { mode: 0o700 });
  const gateC = baseC + "/" + LEGACY;
  let releaseC, reentrantSame = false, reentrantError = null;
  let innerReleased = null, innerRetained = null;
  releaseC = lock.acquireInstallationExclusion(baseC, {
    onPhase: (phase) => {
      if (phase === "legacy-owner-removed") {
        try { reentrantSame = releaseC() === releaseC; } catch (error) { reentrantError = error.message; }
        innerReleased = releaseC.releasedLegacyGate;
        innerRetained = releaseC.retainedLegacyGate;
      }
    },
  });
  releaseC();
  const c = { reentrantSame, reentrantError, innerReleased, innerRetained, gateExists: memory.existsSync(gateC), released: releaseC.releasedLegacyGate, retained: releaseC.retainedLegacyGate };

  assert.equal(a.requested, true, "the legacy owner-removed callback must run");
  assert.equal(a.retained, true, "retention before the physical removal must preserve the gate");
  assert.equal(a.released, false, "a retained gate must not report release");
  assert.equal(a.gateExists, true, "a retained (possibly partial) gate directory must remain");
  assert.equal(a.ownerExists, false, "the owner was already removed when retention was requested");
  assert.equal(a.retained && a.released, false, "release must never report both retained and released");
  assert.equal(a.phases.includes("legacy-gate-removed"), false, "retention must stop before the physical gate removal");

  assert.equal(b.requested, true, "the legacy gate-removed callback must run");
  assert.equal(b.retained, false, "retention after the physical removal cannot grant exclusion");
  assert.equal(b.released, true, "an already-removed gate must report release");
  assert.equal(b.gateExists, false, "the released gate must be gone");
  assert.equal(b.retained && b.released, false, "release must never report both retained and released");

  assert.equal(c.reentrantSame, true, "a reentrant release must return the same handle");
  assert.equal(c.reentrantError, null, "a reentrant release from a legacy callback must not throw");
  assert.equal(c.innerReleased, false, "a reentrant release must not report release before commit");
  assert.equal(c.innerRetained, false, "a reentrant release must not invent retention");
  assert.equal(c.released, true, "the outer release must complete");
  assert.equal(c.retained, false, "a completed clean release must not report retention");
  assert.equal(c.gateExists, false, "the gate must be removed exactly once");

  return { a, b, c };
}

/** Reviewer schedule 6 (model): the root is swapped after the initial identity
 * proof but before the gate owner is created. The bridge must refuse admission
 * and preserve the replaced root and the partial gate evidence. */
export async function modelRootSwap(fixturesRoot) {
  const { memory, lock } = await createModelLockFixture(fixturesRoot, { label: "lk-root-swap-model" });
  const base = "/lkr";
  memory.mkdirSync(base, { mode: 0o700 });
  const originalMkdir = memory.mkdirSync;
  let swapped = false;
  memory.mkdirSync = function (target, opts) {
    if (!swapped && target === base + "/" + LEGACY) {
      swapped = true;
      memory.renameSync(base, base + "-original");
      originalMkdir.call(memory, base, { mode: 0o700 });
    }
    return originalMkdir.call(memory, target, opts);
  };
  let code = null;
  try { lock.acquireInstallationExclusion(base); } catch (error) { code = error.code ?? error.message; }
  memory.mkdirSync = originalMkdir;
  const facts = {
    swapped, code,
    replacementRoot: memory.existsSync(base + "-original"),
    gatePreserved: memory.existsSync(base + "/" + LEGACY),
    ownerPreserved: memory.existsSync(base + "/" + LEGACY + "/owner.json"),
  };
  assert.equal(swapped, true, "root swap injection must fire");
  assert.ok(code, "a root swapped before owner creation must refuse admission");
  assert.equal(facts.replacementRoot, true, "the replaced root must be preserved");
  assert.equal(facts.gatePreserved, true, "the partial gate under the replacement root must be preserved");
  assert.equal(facts.ownerPreserved, true, "the partial owner under the replacement root must be preserved");
  return facts;
}

/** Reviewer schedule 7 (model): the gate is replaced during its durability sync.
 * The bridge must refuse and preserve the replacement gate and the original bytes. */
export async function modelGateSwap(fixturesRoot) {
  const { memory, lock } = await createModelLockFixture(fixturesRoot, { label: "lk-gate-swap-model" });
  const base = "/lkg";
  memory.mkdirSync(base, { mode: 0o700 });
  const gate = base + "/" + LEGACY;
  const originalFsync = memory.fsyncSync;
  let swapped = false;
  memory.fsyncSync = function (fd) {
    const opened = memory.__fds.get(fd);
    if (!swapped && opened && opened.path === gate) {
      swapped = true;
      memory.renameSync(gate, base + "-gate-original");
      memory.mkdirSync(gate, { mode: 0o700 });
      memory.writeFileSync(gate + "/owner.json", JSON.stringify({ pid: process.pid, nonce: "d".repeat(64) }) + "\n");
    }
    return originalFsync.call(memory, fd);
  };
  let code = null;
  try { lock.acquireInstallationExclusion(base); } catch (error) { code = error.code ?? error.message; }
  memory.fsyncSync = originalFsync;
  const facts = {
    swapped, code,
    gatePreserved: memory.existsSync(gate),
    replacementOwnerPreserved: memory.existsSync(gate + "/owner.json"),
    originalArchived: memory.existsSync(base + "-gate-original"),
  };
  assert.equal(swapped, true, "gate swap injection must fire");
  assert.ok(code, "a gate replaced during durability must refuse admission");
  assert.equal(facts.gatePreserved, true, "the replacement gate must be preserved");
  assert.equal(facts.replacementOwnerPreserved, true, "the replacement owner must be preserved");
  assert.equal(facts.originalArchived, true, "the original gate bytes must be preserved as evidence");
  return facts;
}

/** Reviewer schedule 8b (model): the root diverges between the legacy-gate root
 * proof and the modern lock's root proof. The bridge must refuse admission and
 * preserve the gate evidence under the original root. */
export async function modelRootDivergence(fixturesRoot) {
  const { memory, lock } = await createModelLockFixture(fixturesRoot, { label: "lk-root-diverge-model" });
  const base = "/lkdiv";
  memory.mkdirSync(base, { mode: 0o700 });
  const originalRealpath = memory.realpathSync;
  let proofs = 0, diverged = false;
  memory.realpathSync = function (target) {
    if (target === base) {
      const value = originalRealpath.call(memory, target);
      proofs += 1;
      // Proof 1 is the gate root; proof 2 is the gate's post-write re-proof; proof
      // 3 is the modern lock's independent root proof. Diverging at proof 3 lands
      // strictly between the two halves of the bridge.
      if (proofs === 3) {
        diverged = true;
        memory.renameSync(base, base + "-original");
        memory.mkdirSync(base, { mode: 0o700 });
      }
      return value;
    }
    return originalRealpath.call(memory, target);
  };
  let code = null;
  try { lock.acquireInstallationExclusion(base); } catch (error) { code = error.code ?? error.message; }
  memory.realpathSync = originalRealpath;
  const facts = {
    diverged, code,
    modernUnderNewRoot: memory.existsSync(base + "/.install-lock"),
    originalGatePreserved: memory.existsSync(base + "-original/" + LEGACY),
    originalOwnerPreserved: memory.existsSync(base + "-original/" + LEGACY + "/owner.json"),
  };
  assert.equal(diverged, true, "root divergence injection must fire");
  assert.equal(code, "INSTALL_LOCK_RECOVERY_REQUIRED", "a root diverging between the gate and modern proofs must refuse admission");
  assert.equal(facts.originalGatePreserved, true, "the gate under the original root must be preserved");
  assert.equal(facts.originalOwnerPreserved, true, "the gate owner under the original root must be preserved");
  return facts;
}

/** Reviewer schedule 8 (model): an unsupported own process incarnation must be
 * refused BEFORE any bridge state is created. */
export async function modelUnsupportedIncarnation(fixturesRoot) {
  const { memory, lock } = await createModelLockFixture(fixturesRoot, { label: "lk-incarnation-model" });
  const base = "/lki";
  memory.mkdirSync(base, { mode: 0o700 });
  const originalOpen = memory.openSync;
  let injected = false;
  memory.openSync = function (target, ...rest) {
    if (typeof target === "string" && target.endsWith("/random/boot_id")) {
      injected = true;
      throw Object.assign(new Error("injected boot_id ENOENT"), { code: "ENOENT" });
    }
    return originalOpen.call(memory, target, ...rest);
  };
  let code = null;
  try { lock.acquireInstallationExclusion(base); } catch (error) { code = error.code ?? error.message; }
  memory.openSync = originalOpen;
  const facts = { injected, code, gateCreated: memory.existsSync(base + "/" + LEGACY), modernCreated: memory.existsSync(base + "/.install-lock") };
  assert.equal(injected, true, "incarnation fault injection must fire");
  assert.ok(code, "an unsupported incarnation must refuse acquisition");
  assert.equal(facts.gateCreated, false, "an unsupported incarnation must not create any bridge state");
  assert.equal(facts.modernCreated, false, "an unsupported incarnation must not create the modern lock");
  return facts;
}
