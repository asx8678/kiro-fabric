// W5 installer locking regressions (suite "locking"). Real production lock
// functions plus faithful strict control injection of the reviewed legacy
// protocol. All fixtures are task-owned and retained; nothing is deleted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { diskForeignOwner, diskSameBytesOwner, modelAdmissionHandoff, modelForeignOwner, modelLateRetention, modelReleaseDurability, modelSameBytesOwner, modelLateLegacyRetention, modelRootSwap, modelGateSwap, modelRootDivergence, modelUnsupportedIncarnation } from "./w5-hardening-cases.mjs";
import { createCallerCases, requiredIds as callerIds } from "./w5-callers-cases.mjs";
import { acquireInstallationLock } from "../../src/installation/installer-lock.mjs";

export const requiredIds = ["LK01", "LK02", "LK03", "LK04", "LK05", "LK06", "LK07", "LK08", "LK09", "LK10", "LK11", "LK12", "LK13", "LK14", "LK15", "LK16", ...callerIds, "LK20", "LK21", "LK22", "LK23", "LK24"];

const loadLock = async (context) => import(pathToFileURL(path.join(context.root, "src", "installation", "installer-lock.mjs")).href);
const newBase = (context, label) => { const root = fs.mkdtempSync(path.join(context.fixturesRoot, label + "-")); fs.chmodSync(root, 0o700); return fs.realpathSync(root); };
const exists = (target) => { try { fs.lstatSync(target); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
const held = async (action) => { try { return { held: true, release: await action() }; } catch (error) { return { held: false, code: error?.code ?? String(error?.message) }; } };
const LEGACY = ".install.lock";

function reviewedLegacyAcquire(base, pid = process.pid) {
  const target = path.join(base, LEGACY);
  fs.mkdirSync(target, { mode: 0o700 });
  const nonce = randomBytes(32).toString("hex");
  fs.writeFileSync(path.join(target, "owner.json"), JSON.stringify({ pid, nonce }) + "\n", { mode: 0o600, flag: "wx" });
  return function release() { try { fs.unlinkSync(path.join(target, "owner.json")); } catch {} try { fs.rmdirSync(target); } catch {} };
}
function writeLegacyGate(base, pid = process.pid, extra = null) {
  const target = path.join(base, LEGACY);
  fs.mkdirSync(target, { mode: 0o700 });
  const nonce = randomBytes(32).toString("hex");
  fs.writeFileSync(path.join(target, "owner.json"), JSON.stringify({ pid, nonce }) + "\n", { mode: 0o600, flag: "wx" });
  if (extra) fs.writeFileSync(path.join(target, extra), "x\n", { mode: 0o600 });
}

/** @returns {any[]} */
export function createCases() {
  return [
    {
      id: "LK01", title: "updated writers mutually exclude and release idempotently",
      effects: "real acquireInstallationExclusion on task-owned retained fixture directories; creates and removes only its own locks",
      run: async (context) => {
        const lock = await loadLock(context);
        const base = newBase(context, "lk01");
        const first = await held(() => lock.acquireInstallationExclusion(base));
        assert.equal(first.held, true, "first exclusion acquisition must succeed");
        const second = await held(() => lock.acquireInstallationExclusion(base));
        assert.equal(second.held, false, "a second updated writer must be excluded");
        assert.equal(second.code, "INSTALL_LOCK_BUSY");
        const release = first.release;
        release();
        assert.equal(release.releasedLegacyGate, true);
        release();
        assert.equal(exists(path.join(base, LEGACY)), false, "release must remove the legacy gate");
        assert.equal(exists(path.join(base, ".install-lock")), false, "release must remove the modern lock");
        return { firstAcquired: true, secondCode: second.code, idempotent: true, gateRemoved: true };
      },
    },
    {
      id: "LK02", title: "updated bridge excludes reviewed legacy and old modern writers",
      effects: "real lock functions plus a faithful legacy mkdir/pid-nonce control injection; retained fixtures",
      run: async (context) => {
        const lock = await loadLock(context);
        const base = newBase(context, "lk02");
        const bridge = await held(() => lock.acquireInstallationExclusion(base));
        assert.equal(bridge.held, true);
        const oldModern = await held(() => acquireInstallationLock(base, { recover: false }));
        assert.equal(oldModern.held, false, "old modern writer must be excluded by the modern lock");
        const oldLegacy = await held(() => reviewedLegacyAcquire(base));
        assert.equal(oldLegacy.held, false, "reviewed legacy writer must see the legacy gate as busy");
        if (oldModern.held) oldModern.release();
        if (oldLegacy.held) oldLegacy.release();
        bridge.release();
        assert.equal(exists(path.join(base, LEGACY)), false);
        return { blocksOldModern: true, blocksOldLegacy: true };
      },
    },
    {
      id: "LK03", title: "fixed-order failed second acquisition fails fast and leaks no gate",
      effects: "real lock functions; failed acquisitions only; retained fixtures",
      run: async (context) => {
        const lock = await loadLock(context);
        const legacyBase = newBase(context, "lk03-legacy");
        const legacy = reviewedLegacyAcquire(legacyBase);
        const blocked = await held(() => lock.acquireInstallationExclusion(legacyBase));
        assert.equal(blocked.held, false);
        assert.equal(blocked.code, "INSTALL_LOCK_BUSY");
        assert.equal(exists(path.join(legacyBase, LEGACY, "owner.json")), true, "foreign legacy evidence is preserved");
        legacy();
        const modernBase = newBase(context, "lk03-modern");
        const modern = await acquireInstallationLock(modernBase, { recover: false });
        const blocked2 = await held(() => lock.acquireInstallationExclusion(modernBase));
        assert.equal(blocked2.held, false);
        assert.equal(blocked2.code, "INSTALL_LOCK_BUSY");
        assert.equal(exists(path.join(modernBase, LEGACY)), false, "the bridge must release its own gate on a failed second acquisition");
        modern();
        return { legacyBlocked: true, modernBlocked: true, noGateLeak: true };
      },
    },
    {
      id: "LK04", title: "absent, live, stale, partial, foreign, symlink and unknown legacy states",
      effects: "real lock functions; strict legacy control injection; retains every ambiguous fixture",
      run: async (context) => {
        const lock = await loadLock(context);
        const absent = newBase(context, "lk04-absent");
        assert.equal(lock.inspectInstallationLock(absent).status, "absent");

        const liveBase = newBase(context, "lk04-live");
        writeLegacyGate(liveBase, process.pid);
        const live = lock.inspectInstallationLock(liveBase);
        assert.equal(live.available, false);
        assert.equal(live.status, "busy");

        const staleBase = newBase(context, "lk04-stale");
        writeLegacyGate(staleBase, 2147483646);
        const stale = await held(() => lock.acquireInstallationExclusion(staleBase));
        assert.equal(stale.held, false);
        assert.equal(stale.code, "INSTALL_LOCK_RECOVERY_REQUIRED");
        const staleInspect = lock.inspectInstallationLock(staleBase);
        assert.equal(staleInspect.status, "recovery-required");
        assert.equal(staleInspect.available, false);
        assert.ok(staleInspect.legacyGate, "inspect must not report absent while the legacy gate exists");
        assert.equal(exists(path.join(staleBase, LEGACY, "owner.json")), true, "stale PID/nonce evidence is never auto-reclaimed");

        const partialBase = newBase(context, "lk04-partial");
        fs.mkdirSync(path.join(partialBase, LEGACY), { mode: 0o700 });
        const partial = await held(() => lock.acquireInstallationExclusion(partialBase));
        assert.equal(partial.code, "INSTALL_LOCK_RECOVERY_REQUIRED");
        assert.equal(exists(path.join(partialBase, LEGACY)), true);

        const foreignBase = newBase(context, "lk04-foreign");
        writeLegacyGate(foreignBase, process.pid, "extra.json");
        const foreign = await held(() => lock.acquireInstallationExclusion(foreignBase));
        assert.equal(foreign.code, "INSTALL_LOCK_RECOVERY_REQUIRED");
        assert.equal(exists(path.join(foreignBase, LEGACY, "extra.json")), true);

        const unknownBase = newBase(context, "lk04-unknown");
        fs.mkdirSync(path.join(unknownBase, LEGACY), { mode: 0o700 });
        fs.writeFileSync(path.join(unknownBase, LEGACY, "owner.json"), JSON.stringify({ schemaVersion: 1, nonce: "a".repeat(64) }) + "\n", { mode: 0o600 });
        const unknown = await held(() => lock.acquireInstallationExclusion(unknownBase));
        assert.equal(unknown.code, "INSTALL_LOCK_RECOVERY_REQUIRED");
        assert.equal(exists(path.join(unknownBase, LEGACY, "owner.json")), true);

        const symlinkBase = newBase(context, "lk04-symlink");
        fs.mkdirSync(path.join(symlinkBase, "elsewhere"), { mode: 0o700 });
        fs.symlinkSync(path.join(symlinkBase, "elsewhere"), path.join(symlinkBase, LEGACY));
        const symlink = await held(() => lock.acquireInstallationExclusion(symlinkBase));
        assert.equal(symlink.code, "INSTALL_LOCK_RECOVERY_REQUIRED");
        assert.equal(fs.lstatSync(path.join(symlinkBase, LEGACY)).isSymbolicLink(), true);

        return { absent: true, liveBusy: true, stalePreserved: true, partialPreserved: true, foreignPreserved: true, unknownPreserved: true, symlinkPreserved: true };
      },
    },
    {
      id: "LK05", title: "read-only inspect and modern-only recovery stay distinct from the legacy gate",
      effects: "real inspect and acquire/release; retained fixtures",
      run: async (context) => {
        const lock = await loadLock(context);
        const base = newBase(context, "lk05");
        assert.equal(lock.inspectInstallationLock(base).available, true);
        const release = await lock.acquireInstallationExclusion(base);
        const during = lock.inspectInstallationLock(base);
        assert.equal(during.available, false, "inspect must not claim availability while the gate exists");
        release();
        const after = lock.inspectInstallationLock(base);
        assert.equal(after.status, "absent");
        assert.equal(after.available, true, "modern-only absence is still reported after a clean release");
        return { duringStatus: during.status, afterStatus: after.status };
      },
    },
    {
      id: "LK06", title: "pending modern journal or candidate evidence retains the legacy gate",
      effects: "real lock functions; writes .transactions evidence markers in retained fixtures; no installer run",
      run: async (context) => {
        const lock = await loadLock(context);
        for (const name of ["active.json", "candidate.json"]) {
          const base = newBase(context, "lk06-" + name.replace(".json", ""));
          const release = await lock.acquireInstallationExclusion(base);
          fs.mkdirSync(path.join(base, ".transactions"), { mode: 0o700 });
          fs.writeFileSync(path.join(base, ".transactions", name), "{}\n", { mode: 0o600, flag: "wx" });
          release();
          assert.equal(release.retainedLegacyGate, true, "unresolved modern evidence must retain the gate: " + name);
          assert.equal(exists(path.join(base, LEGACY, "owner.json")), true, "legacy gate must survive pending evidence: " + name);
          const blocked = await held(() => lock.acquireInstallationExclusion(base));
          assert.equal(blocked.held, false, "a retained gate must keep excluding writers: " + name);
        }
        return { activeRetained: true, candidateRetained: true };
      },
    },
    {
      id: "LK07", title: "release ownership reporting is truthful and retry-safe",
      effects: "real lock functions; retained fixtures",
      run: async (context) => {
        const lock = await loadLock(context);
        const base = newBase(context, "lk07");
        const release = await lock.acquireInstallationExclusion(base, { transactionId: "a".repeat(32) });
        assert.equal(typeof release.owner, "object");
        assert.equal(Array.isArray(release.recovered), true);
        assert.equal(release.releasedLegacyGate, false);
        assert.equal(release.retainedLegacyGate, false);
        release();
        assert.equal(release.releasedLegacyGate, true);
        assert.equal(release.retainedLegacyGate, false);
        release();
        assert.equal(release.releasedLegacyGate, true, "a repeated release must not change ownership facts");
        return { ownerReported: true, releasedReported: true, retrySafe: true };
      },
    },
    {
      id: "LK08", title: "inode swap between acquisition and release is preserved, never deleted",
      effects: "real lock functions; replaces the gate inode in a retained fixture",
      run: async (context) => {
        const lock = await loadLock(context);
        const base = newBase(context, "lk08");
        const release = await lock.acquireInstallationExclusion(base);
        const target = path.join(base, LEGACY);
        const replacement = path.join(base, "replacement");
        fs.renameSync(target, replacement);
        writeLegacyGate(base, process.pid);
        assert.throws(() => release(), /legacy gate/i);
        assert.equal(release.retainedLegacyGate, true);
        assert.equal(exists(path.join(base, LEGACY, "owner.json")), true, "the replacement gate must be preserved");
        return { releaseRefused: true, replacementPreserved: true };
      },
    },
    {
      id: "LK09", title: "protected interval holds both locks across the whole critical section",
      effects: "real lock functions; retained fixtures",
      run: async (context) => {
        const lock = await loadLock(context);
        const base = newBase(context, "lk09");
        const release = await lock.acquireInstallationExclusion(base);
        for (let step = 0; step < 3; step++) {
          assert.equal(exists(path.join(base, LEGACY)), true, "gate must be held throughout the critical section");
          assert.equal(exists(path.join(base, ".install-lock")), true, "modern lock must be held throughout the critical section");
          const competitor = await held(() => lock.acquireInstallationExclusion(base));
          assert.equal(competitor.held, false, "no competitor may enter the protected interval");
        }
        release();
        assert.equal(exists(path.join(base, LEGACY)), false);
        return { phasesChecked: 3, competitorDenied: true };
      },
    },
    {
      id: "LK10", title: "staged helper closure is declared and free of ../src checkout imports",
      effects: "reads build-agent-dev and validate-agent-package source; no writes",
      run: async (context) => {
        const build = fs.readFileSync(path.join(context.root, "scripts", "build-agent-dev.mjs"), "utf8");
        const validator = fs.readFileSync(path.join(context.root, "scripts", "validate-agent-package.mjs"), "utf8");
        const installer = fs.readFileSync(path.join(context.root, "scripts", "install-agent-user.mjs"), "utf8");
        const lockSource = fs.readFileSync(path.join(context.root, "src", "installation", "installer-lock.mjs"), "utf8");
        assert.match(build, /installer-lock\.mjs/);
        assert.match(build, /pinned-recovery\.mjs/);
        assert.match(validator, /installer-lock\.mjs/);
        assert.match(validator, /pinned-recovery\.mjs/);
        assert.match(installer, /installer-lock\.mjs/);
        assert.equal(installer.includes("../src/"), false, "installer must not depend on a source checkout");
        assert.equal(lockSource.includes("../src/"), false, "staged lock implementation must not import ../src");
        assert.match(installer, /pending modern installation transaction evidence/);
        assert.ok(installer.includes(".transactions/active.json") && installer.includes(".transactions/candidate.json"), "both journal and candidate evidence must be checked");
        return { buildStagesClosure: true, validatorAdmitsClosure: true, noCheckoutImport: true, refusesPendingEvidence: true };
      },
    },
    {
      id: "LK11", title: "modern-only stale recovery stays available without a legacy obstruction",
      effects: "spawns and SIGKILLs a real child holding the modern lock in a retained fixture; recovery retains quarantine",
      run: async (context) => {
        const lock = await loadLock(context);
        const base = newBase(context, "lk11");
        const lockUrl = pathToFileURL(path.join(context.root, "src", "installation", "installer-lock.mjs")).href;
        const childCode = `import { acquireInstallationLock } from ${JSON.stringify(lockUrl)}; acquireInstallationLock(${JSON.stringify(base)}, { recover: false }); process.stdout.write("ready"); setInterval(() => {}, 1000);`;
        const child = spawn(process.execPath, ["--input-type=module", "-e", childCode], { stdio: ["ignore", "pipe", "pipe"] });
        await new Promise((resolve, reject) => {
          let buffer = "";
          const timer = setTimeout(() => reject(new Error("child did not signal ready")), 15000);
          child.stdout.on("data", (chunk) => { buffer += chunk.toString("utf8"); if (buffer.includes("ready")) { clearTimeout(timer); resolve(); } });
          child.once("error", reject);
        });
        child.kill("SIGKILL");
        await new Promise((resolve) => child.once("exit", resolve));
        assert.equal(fs.existsSync(path.join(base, ".install-lock")), true);
        assert.equal(fs.existsSync(path.join(base, ".install.lock")), false);
        const release = await lock.acquireInstallationExclusion(base, { recover: true });
        assert.ok(Array.isArray(release.recovered) && release.recovered.length >= 1, "a dead modern owner must be recovered");
        release();
        assert.equal(fs.existsSync(path.join(base, ".install.lock")), false);
        assert.equal(fs.existsSync(path.join(base, ".install-lock")), false);
        return { recovered: release.recovered.length, quarantineRetained: fs.readdirSync(base).some((name) => name.startsWith(".install-lock-quarantine")) };
      },
    },
    {
      id: "LK12", title: "foreign owner evidence is never deleted by acquisition cleanup",
      effects: "real lock source with surgical O_EXCL fault injection (disk) and injected in-memory fs/process (model); retained fixtures",
      run: async (context) => {
        const lock = await loadLock(context);
        const base = newBase(context, "lk12-disk");
        const disk = await diskForeignOwner(lock, base);
        const model = await modelForeignOwner(context.fixturesRoot);
        return { diskInjected: disk.injected, diskHeld: disk.held, diskForeignPreserved: disk.foreignPreserved, diskGatePreserved: disk.gatePreserved, modelInjected: model.injected, modelHeld: model.held, modelForeignPreserved: model.foreignPreserved, modelGatePreserved: model.gatePreserved, modelRootValidatedFirst: model.rootValidatedFirst };
      },
    },
    {
      id: "LK13", title: "same-bytes replacement owner inode refuses release and is preserved",
      effects: "real lock source on disk and injected in-memory fs/process; retained fixtures",
      run: async (context) => {
        const lock = await loadLock(context);
        const base = newBase(context, "lk13-disk");
        const disk = await diskSameBytesOwner(lock, base);
        const model = await modelSameBytesOwner(context.fixturesRoot);
        return { diskReplaced: disk.replaced, diskRefused: disk.refused, diskReplacementPreserved: disk.replacementPreserved, diskReleasedFlag: disk.releasedFlag, diskRetainedFlag: disk.retainedFlag, modelReplaced: model.replaced, modelRefused: model.refused, modelReplacementPreserved: model.replacementPreserved, modelReleasedFlag: model.releasedFlag, modelRetainedFlag: model.retainedFlag };
      },
    },
    {
      id: "LK14", title: "final gate fsync fault reports physical release with uncertain durability",
      effects: "real lock source with injected in-memory fs/process and deterministic fsync fault schedule; retained fixture",
      run: async (context) => {
        const model = await modelReleaseDurability(context.fixturesRoot);
        return { injected: model.injected, firstOk: model.firstOk, firstReleased: model.released, firstDurabilityUncertain: model.durabilityUncertain, firstRetained: model.retained, modernGone: model.modernGone, gateGoneAfterFirst: model.gateGoneAfterFirst, retryOk: model.retryOk, replacementPreserved: model.replacementPreserved, retryReleased: model.retryReleased, retryRetained: model.retryRetained };
      },
    },
    {
      id: "LK15", title: "late retention callback and reentrant release stay truthful",
      effects: "real lock source with injected in-memory fs/process and callback schedules; retained fixture",
      run: async (context) => {
        const model = await modelLateRetention(context.fixturesRoot);
        return { requested: model.requested, retained: model.retained, released: model.released, gateExists: model.gateExists, reentrantSameObject: model.reentrantSameObject, reentrantReleased: model.reentrantReleased, reentrantRetained: model.reentrantRetained, phases: model.phases, innerError: model.innerError, gate2Removed: model.gate2Removed, release2Released: model.release2Released, release2Retained: model.release2Retained };
      },
    },
    {
      id: "LK16", title: "modern ownership fences admission and retention evidence is read while held",
      effects: "real lock source with injected in-memory fs/process; admission/retention plus unchanged-modern exclusion control; retained fixture",
      run: async (context) => {
        const model = await modelAdmissionHandoff(context.fixturesRoot);
        return { secondBlocked: model.secondBlocked, evidenceWhileModernHeld: model.evidenceWhileModernHeld, evidenceIndex: model.evidenceIndex, modernIndex: model.modernIndex, retained: model.retained, released: model.released, gateExists: model.gateExists, modernGone: model.modernGone, cleanReacquire: model.cleanReacquire, modernSecond: model.modernSecond, modernReacquire: model.modernReacquire };
      },
    },
    ...createCallerCases(),
    .../** @type {Array<[string, string, (root: string) => Promise<any>]>} */ ([
      ["LK20", "late legacy callback retention and physical release remain mutually exclusive", modelLateLegacyRetention],
      ["LK21", "root replacement during gate initialization preserves both identities", modelRootSwap],
      ["LK22", "gate replacement during initialization preserves foreign evidence", modelGateSwap],
      ["LK23", "legacy and modern acquisition must bind the same root and process incarnation", modelRootDivergence],
      ["LK24", "unsupported process incarnation refuses before creating a gate", modelUnsupportedIncarnation],
    ]).map(([id, title, probe]) => ({
      id, title,
      effects: "real lock source with injected in-memory filesystem/process and deterministic fault schedule; all evidence retained",
      run: (context) => probe(context.fixturesRoot),
    })),
  ];
}
