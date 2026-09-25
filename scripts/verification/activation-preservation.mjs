// Independent activation oracle: exact pre-existing bytes/metadata, exact new
// inventory, supported profile backup bindings, no journal/lock leftovers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateBundle, canonical } from '../bundle-contract.mjs';
import { inspectCompleteInstallation } from '../managed-installation.mjs';
import { snapshotTree, assertSnapshotDelta, readCapturedFile } from './activation-snapshot.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
const controlNames = ['agents/kiro-fabric.json', 'kiro-fabric/install-owner.json', 'kiro-fabric/bin/kiro-fabric'];
export function captureActivationHome(home) {
  const tree = snapshotTree(home);
  return { tree, owner: readCapturedFile(home, tree, controlNames[1]), profile: readCapturedFile(home, tree, controlNames[0]) };
}
export function assertLegacyBackupSeed(home, before) {
  const after = snapshotTree(home);
  const manifests = after.filter(r => /^kiro-fabric\/\.installing-[^/]+\/previous-manifest\.json$/u.test(r.path));
  assert.equal(manifests.length, 1, 'real second legacy write must retain exactly one previous manifest backup');
  const prefix = path.posix.dirname(manifests[0].path);
  const map = new Map(after.map(r => [r.path, r]));
  assert.equal(manifests[0].sha256, sha(before.owner), 'exact prior legacy manifest backup');
  assert.equal(map.get(prefix + '/previous-profile')?.sha256, sha(before.profile), 'exact prior legacy profile backup');
  const skill = 'kiro-fabric/skills/fabric-exec';
  const priorSkill = before.tree.filter(r => r.path === skill || r.path.startsWith(skill + '/'));
  assert.ok(priorSkill.length > 1, 'real legacy skills must be populated');
  const retained = after.filter(r => r.path === prefix + '/previous-skill' || r.path.startsWith(prefix + '/previous-skill/'));
  assert.equal(retained.length, priorSkill.length, 'exact retained skill backup inventory');
  for (const prior of priorSkill) {
    const name = prefix + '/previous-skill' + prior.path.slice(skill.length), current = map.get(name);
    assert.ok(current, 'missing retained skill backup: ' + name);
    // rename changes the moved root's ctime; all descendants, bytes, identities,
    // modes and other agreed metadata must remain exact.
    const expected = { ...prior, path: name, ...(prior.path === skill ? { ctimeNs: current.ctimeNs } : {}) };
    assert.deepEqual(current, expected, 'changed retained legacy skill backup');
  }
  return { previousManifestSha256: sha(before.owner), previousProfileSha256: sha(before.profile), backupRoot: prefix, exactSkillInventory: true };
}

export function seedActivationData(home) {
  const dir = path.join(home, 'kiro-fabric/data/fabric/activation-preservation');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'owned-data.txt'), 'activation owned data; retain exactly\n', { flag: 'wx', mode: 0o600 });
}

export async function assertActivationPublication(home, before, bundle, { previous = null, legacyManifest = null, retained = [] } = {}) {
  const after = snapshotTree(home), priorPaths = new Set(before.tree.map(r => r.path));
  const byName = new Map(after.map(r => [r.path, r]));
  const allowed = new Set(), add = name => { if (!priorPaths.has(name)) allowed.add(name); };
  const expectedFile = (name, size, hash, mode = 0o600) => {
    const entry = byName.get(name);
    assert.ok(entry, 'missing expected publication: ' + name);
    assert.equal(entry.type, 'file'); assert.equal(entry.sha256, hash, 'published checksum: ' + name);
    assert.equal(entry.size, String(size)); assert.equal(entry.mode, mode); assert.equal(entry.nlink, '1');
    assert.equal(entry.uid, String(process.getuid())); assert.equal(entry.gid, String(process.getgid()));
    add(name);
  };
  const base = 'kiro-fabric', runtime = base + '/runtime', generation = runtime + '/' + bundle.digest;
  const directories = new Set(['agents', base, runtime, base + '/bin', base + '/.transactions']);
  const addDirectory = name => {
    const entry = byName.get(name);
    assert.ok(entry && entry.type === 'directory', 'expected directory: ' + name);
    assert.equal(entry.mode, 0o700); assert.equal(entry.uid, String(process.getuid()));
    add(name);
  };
  for (const dir of ['agents', base, runtime, base + '/bin', base + '/.transactions', base + '/data', base + '/data/fabric']) addDirectory(dir);
  for (const file of bundle.inventory) {
    expectedFile(generation + '/' + file.path, file.size, file.sha256, file.mode);
    let parent = path.posix.dirname(generation + '/' + file.path);
    while (parent.startsWith(generation)) { addDirectory(parent); parent = path.posix.dirname(parent); }
  }
  const rawBundleManifest = Buffer.from(canonical(bundle.manifest) + '\n');
  expectedFile(generation + '/bundle-manifest.json', rawBundleManifest.length, sha(rawBundleManifest)); addDirectory(generation);
  const ownerBytes = readCapturedFile(home, after, controlNames[1]), owner = JSON.parse(ownerBytes.toString('utf8'));
  assert.equal(owner.currentRuntime, bundle.digest); assert.equal(owner.previousRuntime, previous);
  const profile = readCapturedFile(home, after, controlNames[0]), launcher = readCapturedFile(home, after, controlNames[2]);
  assert.equal(owner.profileSha256, sha(profile)); assert.equal(owner.launcherSha256, sha(launcher));
  assert.equal(owner.releaseStateSha256, null, 'source-only activation must not invent release state');
  /** @type {Array<[string, Buffer, number]>} */
  const controls = [[controlNames[0], profile, 0o600], [controlNames[1], ownerBytes, 0o600], [controlNames[2], launcher, 0o700]];
  for (const [name, bytes, mode] of controls) expectedFile(name, bytes.length, sha(bytes), mode);
  if (legacyManifest) assert.deepEqual(Buffer.from(owner.legacy.manifestBase64, 'base64'), legacyManifest, 'exact legacy ownership bytes must be embedded');
  const oldOwner = before.owner && JSON.parse(before.owner);
  if (oldOwner?.installationId) {
    assert.equal(owner.installationId, oldOwner.installationId);
    const store = base + '/profile-snapshots';
    addDirectory(store);
    const matches = after.filter(r => r.path.startsWith(store + '/' + oldOwner.currentRuntime + '.') && r.type === 'file');
    assert.equal(matches.length, 1, 'exactly one supported backup of prior active generation');
    const record = matches[0], raw = readCapturedFile(home, after, record.path, 256 * 1024), backup = JSON.parse(raw.toString('utf8'));
    assert.equal(path.basename(record.path), oldOwner.currentRuntime + '.' + sha(raw) + '.json');
    assert.equal(backup.kind, 'kiro-fabric-generation-profile');
    assert.equal(backup.generation, oldOwner.currentRuntime);
    assert.deepEqual(Buffer.from(backup.profileBase64, 'base64'), before.profile);
    // Existing immutable backups may bind the earlier owner of this generation.
    // Newly created backups MUST capture exactly the pre-operation owner bytes.
    if (!priorPaths.has(record.path)) assert.deepEqual(Buffer.from(backup.ownerBase64, 'base64'), before.owner);
    expectedFile(record.path, raw.length, sha(raw));
  }
  for (const name of allowed) {
    const entry = byName.get(name);
    assert.ok(entry, 'missing expected new path: ' + name);
    if (entry.type === 'directory') { assert.equal(entry.mode, 0o700); assert.equal(entry.uid, String(process.getuid())); }
  }
  // Only parents of exact new inventory (plus transient transaction/control
  // parents above) may change directory metadata. An unchanged home root/store
  // is not a blanket metadata exemption on updates or rollback.
  for (const name of allowed) directories.add(path.posix.dirname(name));
  assertSnapshotDelta(before.tree, after, { directories: [...directories], replacements: controlNames.filter(name => priorPaths.has(name)), additions: [...allowed] });
  for (const name of ['.install.lock', '.install-lock', '.transactions/active.json', '.transactions/candidate.json']) assert.equal(byName.has(base + '/' + name), false, 'unexpected lock/journal after commit: ' + name);
  for (const digest of new Set([bundle.digest, ...retained])) assert.equal((await validateBundle(path.join(home, runtime, digest))).digest, digest, 'retained generation must independently revalidate');
  const inspected = await inspectCompleteInstallation(home);
  assert.equal(inspected.status, 'active', 'complete profile/control/backup bindings must validate');
  assert.deepEqual(owner.runtimeGenerations.map(r => r.name).sort(), [...new Set([bundle.digest, ...retained])].sort(), 'exact managed A/B inventory');
  return { exactInventory: true, exactRetainedMetadata: true, supportedBackups: true, controlsBound: true, locksAndJournalsAbsent: true };
}
