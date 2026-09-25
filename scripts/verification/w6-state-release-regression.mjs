// W6 state release regression: an unproven held-lock release must fail closed,
// including when a later acquisition reuses the released filesystem identity.
// Receives SB07's real source bundle; no production file is edited and every
// generated file/fixture stays under the case-owned fixture root.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const privateDir = (parent, name) => fs.mkdtempSync(path.join(parent, `${name}-`));

/** Paired production-source regression. Invariant: after any held mutation lock
 * release that cannot be proven complete (this provider acquired the lock and
 * its pathname is gone), the provider must refuse every later effect until
 * operator recovery -- even when a later acquisition reuses the released inode. */
export async function assertStateReleaseRegression(api, { fixturesRoot }) {
  const { StateProvider, FabricDeadline } = api;
  const invocation = () => ({ signal: new AbortController().signal, deadline: new FabricDeadline(30000, 30000) });
  const real = { renameSync: fs.renameSync, fsyncSync: fs.fsyncSync, fstatSync: fs.fstatSync, openSync: fs.openSync };
  const patchedFs = async (seams, body) => {
    const saved = {};
    for (const key of Object.keys(seams)) { saved[key] = fs[key]; fs[key] = seams[key]; }
    try { return await body(); }
    finally { for (const key of Object.keys(seams)) fs[key] = saved[key]; }
  };
  const caught = async (body) => { try { await body(); return undefined; } catch (error) { return error; } };
  const revisionOf = (file) => JSON.parse(fs.readFileSync(file, "utf8")).revision;

  // --- Paired: reused identity vs a distinct identity, both with failed
  // initialization that removes the newly held lock.
  const paired = [];
  for (const reuse of [false, true]) {
    const dir = privateDir(fixturesRoot, reuse ? "release-reuse" : "release-distinct");
    const provider = new StateProvider(dir, {});
    const lock = path.join(dir, ".state-mutation.lock");
    const file = path.join(dir, "state.json");
    let firstIdentity;
    await patchedFs({ fsyncSync(descriptor) {
      const stat = real.fstatSync(descriptor);
      if (stat.isFile() && !firstIdentity) firstIdentity = { dev: stat.dev, ino: stat.ino };
      return real.fsyncSync(descriptor);
    } }, () => provider.invoke("set", { key: "first", value: 1 }, invocation()));
    assert.equal(revisionOf(file), 1, "the priming write must publish exactly once");
    assert.equal(fs.existsSync(lock), false, "the priming release must remove the lock");

    let lockFd;
    const failure = await patchedFs({
      openSync(...args) { const fd = Reflect.apply(real.openSync, real, args); if (args[0] === lock && lockFd === undefined) lockFd = fd; return fd; },
      fstatSync(descriptor, options) {
        const stat = real.fstatSync(descriptor, options);
        if (reuse && descriptor === lockFd && !options?.bigint) { stat.dev = firstIdentity.dev; stat.ino = firstIdentity.ino; }
        return stat;
      },
      fsyncSync(descriptor) {
        if (descriptor === lockFd) { real.renameSync(lock, lock + ".lost-retained"); throw new Error("injected lock initialization fsync failure"); }
        return real.fsyncSync(descriptor);
      },
    }, () => caught(() => provider.invoke("set", { key: "failed", value: 2 }, invocation())));
    assert.ok(failure, "a failed lock initialization must reject the mutation");
    const later = await caught(() => provider.invoke("set", { key: "later", value: 3 }, invocation()));
    assert.ok(later, `${reuse ? "reused" : "distinct"}-identity lock loss must refuse later effects`);
    assert.match(String(later.message ?? later), /uncertain state lock ownership/u);
    assert.equal(revisionOf(file), 1, "an unproven release must never advance the revision");
    assert.equal(fs.existsSync(lock + ".lost-retained"), true, "the displaced lock must be retained as evidence");
    assert.equal(fs.existsSync(lock), false, "a failed release must not recreate the lock path");
    paired.push({ reuse, refused: true, revision: revisionOf(file) });
  }

  // --- Ordinary sequential writes still acquire and release normally.
  const ordinaryDir = privateDir(fixturesRoot, "release-ordinary");
  const ordinaryProvider = new StateProvider(ordinaryDir, {});
  const ordinaryLock = path.join(ordinaryDir, ".state-mutation.lock");
  const ordinaryRevisions = [];
  for (let index = 0; index < 3; index += 1) {
    const result = await ordinaryProvider.invoke("set", { key: `ordinary-${index}`, value: index }, invocation());
    ordinaryRevisions.push(result.revision);
    assert.equal(result.revision, index + 1, "ordinary writes must keep incrementing revisions");
    assert.equal(fs.existsSync(ordinaryLock), false, "every ordinary release must remove its lock");
  }

  // --- A foreign same-bytes replacement is preserved; restoring the original
  // lock lets the deferred cleanup retry and normal writes proceed.
  const retryDir = privateDir(fixturesRoot, "release-retry");
  const retryProvider = new StateProvider(retryDir, {});
  const retryLock = path.join(retryDir, ".state-mutation.lock");
  const retryFile = path.join(retryDir, "state.json");
  let swapped = false;
  const swappedError = await patchedFs({ renameSync(from, to) {
    const mapped = real.renameSync(from, to);
    if (String(to) === retryFile) {
      const bytes = fs.readFileSync(retryLock);
      real.renameSync(retryLock, retryLock + ".original");
      fs.writeFileSync(retryLock, bytes, { mode: 0o600, flag: "wx" });
      swapped = true;
    }
    return mapped;
  } }, () => caught(() => retryProvider.invoke("set", { key: "swapped", value: 1 }, invocation())));
  assert.equal(swapped, true, "the fixture must replace the lock after publication");
  assert.ok(swappedError, "a foreign lock replacement must surface a cleanup failure");
  assert.equal(swappedError.lockCleanup, "unresolved", "a foreign replacement leaves cleanup unresolved");
  const blocked = await caught(() => retryProvider.invoke("set", { key: "blocked", value: 9 }, invocation()));
  assert.ok(blocked, "a preserved foreign lock must keep blocking effects");
  assert.match(String(blocked.message ?? blocked), /replacement lock preserved/u);
  assert.equal(revisionOf(retryFile), 1, "blocked retries must not advance the revision");
  real.renameSync(retryLock, retryLock + ".foreign-retained");
  real.renameSync(retryLock + ".original", retryLock);
  const retried = await retryProvider.invoke("set", { key: "retried", value: 2 }, invocation());
  assert.equal(retried.revision, 2, "restoring the original lock must let the deferred retry complete");
  assert.equal(fs.existsSync(retryLock), false, "the successful retry must remove the original lock");
  const after = await retryProvider.invoke("set", { key: "after", value: 3 }, invocation());
  assert.equal(after.revision, 3, "ordinary writes must continue after recovery");

  return {
    status: "passed",
    variant: "stateReleaseLossFailsClosed",
    paired,
    ordinaryRevisions,
    retry: { swappedError: swappedError.name, blocked: true, recoveredRevision: retried.revision },
  };
}
