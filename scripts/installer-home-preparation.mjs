import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { installerSafety as s } from "./install-agent-user.mjs";
import { acquireInstallationExclusion } from "./installer-lock.mjs";
import { syncDirectory } from "./install-transaction.mjs";

function readLegacyProfile(kiroHome) {
  const profile = path.join(kiroHome, "agents", "kiro-fabric.json");
  const legacyRoot = path.join(kiroHome, ".kiro-fabric"), manifest = path.join(legacyRoot, "install.json");
  s.assertNoUnsafeSymlinkComponents(manifest);
  if (!s.lstat(manifest)) throw new Error(`Unowned kiro-fabric profile preserved: ${profile}; no Pi Fabric ownership record`);
  s.assertSafeDirectory(legacyRoot);
  for (const file of [manifest, profile]) {
    if (s.assertSafeFile(file).size > 2 * 1024 * 1024) throw new Error(`Legacy installation record exceeds bound: ${file}`);
  }
  const record = JSON.parse(fs.readFileSync(manifest, "utf8")), bytes = fs.readFileSync(profile);
  const sha256 = s.hash(bytes);
  if (record.format !== 1 || record.owner !== "kiro-fabric" || record.scope !== "user" ||
      record.profile?.path !== "agents/kiro-fabric.json" || record.profile.installedSha256 !== sha256) {
    throw new Error(`Modified or unrecognized Pi Fabric profile preserved: ${profile}`);
  }
  return { profile, sha256, bytes };
}

/** Read-only preflight: reject unsafe paths and unverified profile replacements before building. */
export function planInstallationPreparation(kiroHome, { migratePiFabric = false } = {}) {
  s.assertNoUnsafeSymlinkComponents(kiroHome);
  const permissions = [];
  for (const directory of [kiroHome, path.join(kiroHome, "agents")]) {
    if (!s.lstat(directory)) continue;
    s.assertSafeDirectory(directory);
    const stat = fs.lstatSync(directory);
    if ((stat.mode & 0o700) !== 0o700 || (stat.mode & 0o7000)) throw new Error(`Kiro directory requires owner read/write/execute permissions: ${directory}`);
    if (stat.mode & 0o077) permissions.push({ path: directory, mode: stat.mode & 0o777, dev: stat.dev, ino: stat.ino });
  }
  const profile = path.join(kiroHome, "agents", "kiro-fabric.json"), base = path.join(kiroHome, "kiro-fabric");
  if (s.lstat(base)) s.assertSafeDirectory(base, { private: true });
  let legacy;
  if (s.lstat(profile) && !s.lstat(path.join(base, "install-owner.json"))) {
    const verified = readLegacyProfile(kiroHome);
    if (!migratePiFabric) throw new Error("Older Pi Fabric profile found; rerun install with --migrate-pi-fabric to back it up and replace it");
    legacy = { profile: verified.profile, sha256: verified.sha256 };
  }
  return { permissions, legacy };
}

/** Tighten only the two verified user-owned directories, after installation confirmation. */
export function applyInstallationPermissions(plan) {
  const applied = [];
  try {
    for (const directory of plan.permissions) {
      s.assertNoUnsafeSymlinkComponents(directory.path);
      s.assertSafeDirectory(directory.path);
      const fd = fs.openSync(directory.path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      try {
        const stat = fs.fstatSync(fd);
        if (stat.dev !== directory.dev || stat.ino !== directory.ino || (stat.mode & 0o777) !== directory.mode) throw new Error(`Kiro directory changed during preparation: ${directory.path}`);
        fs.fchmodSync(fd, 0o700);
        // Record the applied change before fsync, which can itself fail.
        applied.push({ path: directory.path, previousMode: directory.mode.toString(8), mode: "700" });
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
    }
    return applied;
  } catch (error) { error.appliedPermissions = applied; throw error; }
}

/** Explicit migration is a separate, backed-up preparation step; old runtimes remain in place. */
export function preservePiFabricProfile(kiroHome, legacy, configurationBackup) {
  if (!configurationBackup) throw new Error("Pi Fabric migration requires a complete configuration backup");
  const base = path.join(kiroHome, "kiro-fabric");
  // Maintained writers share the fixed-order exclusion so a held legacy gate
  // (a paused pre-W5 entrypoint) is honoured with zero effect.
  const release = acquireInstallationExclusion(base);
  let saved;
  try {
    for (const name of ["install-owner.json", "runtime", ".transactions", "bin"]) {
      if (s.lstat(path.join(base, name))) throw new Error("Installation state changed; Pi Fabric profile preserved for review");
    }
    const current = readLegacyProfile(kiroHome);
    const backedUp = path.join(configurationBackup.path, "agents", "kiro-fabric.json");
    s.assertSafeFile(backedUp);
    if (current.sha256 !== legacy.sha256 || !fs.readFileSync(backedUp).equals(current.bytes)) throw new Error("Pi Fabric profile changed since preparation; migration stopped");
    const directory = path.join(base, "legacy-profiles");
    s.ensureDirectory(directory, { private: true }, []);
    saved = path.join(directory, `pi-fabric-${current.sha256}-${randomBytes(8).toString("hex")}.json`);
    fs.writeFileSync(saved, current.bytes, { flag: "wx", mode: 0o600 });
    const fd = fs.openSync(saved, "r");
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    syncDirectory(directory);
    // Recheck after the durable copy. Never remove a profile changed meanwhile.
    if (readLegacyProfile(kiroHome).sha256 !== current.sha256) throw new Error("Pi Fabric profile changed during backup; original preserved");
    fs.unlinkSync(current.profile);
    syncDirectory(path.dirname(current.profile));
    return saved;
  } catch (error) {
    if (saved) error.legacyProfileBackup = saved;
    throw error;
  } finally {
    try { release(); } catch (error) { if (saved) error.legacyProfileBackup = saved; throw error; }
  }
}
