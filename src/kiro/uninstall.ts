// Safe Kiro uninstall. Removes only a profile whose current bytes still
// match the managed manifest hash, or restores the verified displaced-user
// backup. Never inspects or deletes a profile when no manifest is present.

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  acquireOperationLock,
  assertBackupBytes,
  assertManagedTree,
  commitManagedFileTransaction,
  fsyncDirectory,
  KiroInstallError,
  backupRelativePath,
  lstatOrNull,
  managedFileTransition,
  managedPaths,
  readManagedFileNoFollow,
  readManifest,
  recoverManagedTransaction,
  rmdirIfEmpty,
  sha256Bytes,
  type KiroBackupRecord,
  type KiroInstallManifest,
  type KiroManagedOwnedFile,
  type KiroManagedLayout,
} from "./managed.js";
import { resolveKiroInstallRoots } from "./home.js";
import {
  removeAttestedRuntimeClosure,
  removeRuntimeActivationMarker,
  runtimeClosureMarkerPath,
  verifyRuntimeClosureAttestation,
} from "./runtime-closure.js";

export type KiroUninstallAction = "noop" | "remove" | "restore";

export interface KiroUninstallOptions {
  projectRoot?: string;
  dryRun?: boolean;
  scope?: KiroManagedLayout;
  kiroHome?: string;
}

interface KiroSkillUninstallPlan {
  record: KiroManagedOwnedFile;
  path: string;
  currentSha256: string | null;
  nextBytes: Buffer | null;
  needsMutation: boolean;
}

export interface KiroUninstallPlan {
  action: KiroUninstallAction;
  projectRoot: string;
  installRoot: string;
  layout: KiroManagedLayout;
  profilePath: string;
  manifestPath: string;
  backupPath: string | null;
  managedSha256: string | null;
  restoredSha256: string | null;
  needsProfileMutation: boolean;
  needsManifestRemoval: boolean;
  warnings: string[];
  skills: KiroSkillUninstallPlan[];
  manifest: KiroInstallManifest | null;
}

export interface KiroUninstallResult {
  ok: true;
  dryRun: boolean;
  action: KiroUninstallAction;
  changed: boolean;
  projectRoot: string;
  profilePath: string;
  manifestPath: string;
  backupPath: string | null;
  managedSha256: string | null;
  restoredSha256: string | null;
  warnings: string[];
}

const backupAbs = (root: string, record: KiroBackupRecord): string =>
  join(root, ...record.path.split("/"));

export const planKiroProfileUninstall = (
  options: KiroUninstallOptions = {},
): KiroUninstallPlan => {
  const { layout, installRoot, projectRoot: root } = resolveKiroInstallRoots(options);
  assertManagedTree(installRoot, layout);
  const paths = managedPaths(installRoot, layout);
  const empty = (action: KiroUninstallAction): KiroUninstallPlan => ({
    action,
    projectRoot: root,
    installRoot,
    layout,
    profilePath: paths.profile,
    manifestPath: paths.manifest,
    backupPath: null,
    managedSha256: null,
    restoredSha256: null,
    needsProfileMutation: false,
    needsManifestRemoval: false,
    warnings: [],
    skills: [],
    manifest: null,
  });

  const manifestStat = lstatOrNull(paths.manifest);
  if (!manifestStat) return empty("noop");
  if (manifestStat.isSymbolicLink()) {
    throw new KiroInstallError("symlink", `refusing manifest symlink: ${paths.manifest}`);
  }
  if (!manifestStat.isFile()) {
    throw new KiroInstallError("manifest", `install manifest is not a regular file: ${paths.manifest}`);
  }

  const manifest: KiroInstallManifest = readManifest(installRoot, layout)!;
  const backup = manifest.profile.backup ?? null;
  if (backup) assertBackupBytes(installRoot, backup);

  const ownershipWarnings: string[] = [];
  const skills: KiroSkillUninstallPlan[] = (manifest.skills?.files ?? []).map((record) => {
    const path = join(installRoot, ...record.path.split("/"));
    const current = readManagedFileNoFollow(installRoot, path);
    const currentSha256 = current === null ? null : sha256Bytes(current);
    const backupBytes = record.backup ? assertBackupBytes(installRoot, record.backup) : null;
    let nextBytes: Buffer | null = current;
    let needsMutation = false;
    if (currentSha256 === record.installedSha256) {
      nextBytes = backupBytes;
      needsMutation = true;
    } else if (currentSha256 === null && backupBytes === null) {
      nextBytes = null;
    } else if (currentSha256 === null && backupBytes !== null) {
      nextBytes = backupBytes;
      needsMutation = true;
    } else if (record.backup && currentSha256 === record.backup.sha256) {
      nextBytes = current;
    } else {
      throw new KiroInstallError(
        "ownership",
        "managed skill changed; refusing to uninstall: " + path,
      );
    }
    return { record, path, currentSha256, nextBytes, needsMutation };
  });
  if (manifest.runtime.closure) {
    const generations = manifest.runtime.generations ?? [manifest.runtime.closure];
    const markerOwners = new Map<string, typeof generations>();
    for (const generation of generations) {
      const generationRoot = join(installRoot, ...generation.root.split("/"));
      if (existsSync(generationRoot)) verifyRuntimeClosureAttestation(installRoot, generation);
      else ownershipWarnings.push("recorded runtime generation is already absent: " + generation.digest);
      const marker = runtimeClosureMarkerPath(installRoot, layout, generation);
      markerOwners.set(marker, [...(markerOwners.get(marker) ?? []), generation]);
    }
    const activeMarker = runtimeClosureMarkerPath(installRoot, layout, manifest.runtime.closure);
    const activeRoot = join(installRoot, ...manifest.runtime.closure.root.split("/"));
    for (const [marker, owners] of markerOwners) {
      const markerStat = lstatOrNull(marker);
      if (markerStat && (markerStat.isSymbolicLink() || !markerStat.isFile())) {
        throw new KiroInstallError("ownership", "runtime closure marker does not match manifest");
      }
      const markerDigest = markerStat ? readFileSync(marker, "utf8").trim() : undefined;
      if (markerDigest && !owners.some((owner) => owner.digest === markerDigest)) {
        throw new KiroInstallError("ownership", "runtime closure marker is not owned by the manifest");
      }
      if (
        marker === activeMarker &&
        existsSync(activeRoot) &&
        markerDigest !== manifest.runtime.closure.digest
      ) {
        throw new KiroInstallError("ownership", "runtime closure marker does not match manifest");
      }
    }
  }
  const ownedState = { warnings: ownershipWarnings, skills, manifest };

  const profileStat = lstatOrNull(paths.profile);
  let currentHash: string | null = null;
  if (profileStat) {
    if (profileStat.isSymbolicLink()) {
      throw new KiroInstallError("symlink", `refusing profile symlink: ${paths.profile}`);
    }
    if (!profileStat.isFile()) {
      throw new KiroInstallError("ownership", `profile target is not a regular file: ${paths.profile}`);
    }
    currentHash = sha256Bytes(readFileSync(paths.profile));
  }

  const installed = manifest.profile.installedSha256;
  const backupPath = backup ? backupAbs(installRoot, backup) : null;

  if (currentHash === installed) {
    return {
      action: backup ? "restore" : "remove",
      projectRoot: root,
      installRoot,
      layout,
      profilePath: paths.profile,
      manifestPath: paths.manifest,
      backupPath,
      managedSha256: installed,
      restoredSha256: backup?.sha256 ?? null,
      needsProfileMutation: true,
      needsManifestRemoval: true,
      ...ownedState,
    };
  }

  if (currentHash === null && !backup) {
    return {
      action: "remove",
      projectRoot: root,
      installRoot,
      layout,
      profilePath: paths.profile,
      manifestPath: paths.manifest,
      backupPath: null,
      managedSha256: installed,
      restoredSha256: null,
      needsProfileMutation: false,
      needsManifestRemoval: true,
      ...ownedState,
    };
  }

  if (currentHash === null && backup) {
    return {
      action: "restore",
      projectRoot: root,
      installRoot,
      layout,
      profilePath: paths.profile,
      manifestPath: paths.manifest,
      backupPath,
      managedSha256: installed,
      restoredSha256: backup.sha256,
      needsProfileMutation: true,
      needsManifestRemoval: true,
      ...ownedState,
    };
  }

  if (backup && currentHash === backup.sha256) {
    return {
      action: "restore",
      projectRoot: root,
      installRoot,
      layout,
      profilePath: paths.profile,
      manifestPath: paths.manifest,
      backupPath,
      managedSha256: installed,
      restoredSha256: backup.sha256,
      needsProfileMutation: false,
      needsManifestRemoval: true,
      ...ownedState,
    };
  }

  throw new KiroInstallError(
    "ownership",
    `managed profile changed; refusing to uninstall: ${paths.profile}`,
  );
};

const resultFromPlan = (
  plan: KiroUninstallPlan,
  dryRun: boolean,
  extraWarnings: string[] = [],
): KiroUninstallResult => ({
  ok: true,
  dryRun,
  action: plan.action,
  changed: !dryRun && (
    plan.needsProfileMutation ||
    plan.needsManifestRemoval ||
    plan.skills.some((skill) => skill.needsMutation)
  ),
  projectRoot: plan.projectRoot,
  profilePath: plan.profilePath,
  manifestPath: plan.manifestPath,
  backupPath: plan.backupPath,
  managedSha256: plan.managedSha256,
  restoredSha256: plan.restoredSha256,
  warnings: [...plan.warnings, ...extraWarnings],
});

const commitUninstall = (plan: KiroUninstallPlan): string[] => {
  const warnings: string[] = [];
  const paths = managedPaths(plan.installRoot, plan.layout);
  assertManagedTree(plan.installRoot, plan.layout);

  const currentProfile = readManagedFileNoFollow(plan.installRoot, plan.profilePath);
  const currentProfileHash = currentProfile === null ? null : sha256Bytes(currentProfile);
  if (
    plan.needsProfileMutation &&
    currentProfileHash !== null &&
    currentProfileHash !== plan.managedSha256
  ) {
    throw new KiroInstallError(
      "ownership",
      `profile changed while uninstalling: ${plan.profilePath}`,
    );
  }
  let nextProfile: Buffer | null = currentProfile;
  if (plan.needsProfileMutation && plan.action === "restore" && plan.restoredSha256) {
    nextProfile = assertBackupBytes(plan.installRoot, {
      path: backupRelativePath(plan.restoredSha256, plan.layout),
      sha256: plan.restoredSha256,
    });
  } else if (plan.needsProfileMutation && plan.action === "remove") {
    nextProfile = null;
  }

  for (const skill of plan.skills) {
    const current = readManagedFileNoFollow(plan.installRoot, skill.path);
    const hash = current === null ? null : sha256Bytes(current);
    if (hash !== skill.currentSha256) {
      throw new KiroInstallError("concurrency", "managed skill changed while uninstalling: " + skill.path);
    }
  }
  // Runtime ownership is the durable tombstone. Remove every recorded
  // generation and its activation marker before the transaction drops the
  // manifest; a crash leaves the manifest recoverable and a retry continues
  // from any generations already absent. Cleanup errors are fatal.
  if (plan.manifest?.runtime.closure) {
    const generations = plan.manifest.runtime.generations ?? [plan.manifest.runtime.closure];
    const markers = new Map<string, { digest: string; owner: (typeof generations)[number] }>();
    for (const generation of generations) {
      const marker = runtimeClosureMarkerPath(plan.installRoot, plan.layout, generation);
      const markerStat = lstatOrNull(marker);
      if (!markerStat) continue;
      const digest = readFileSync(marker, "utf8").trim();
      const owner = generations.find((candidate) =>
        runtimeClosureMarkerPath(plan.installRoot, plan.layout, candidate) === marker &&
        candidate.digest === digest);
      if (!owner) throw new KiroInstallError("ownership", "runtime closure marker is not owned by the manifest");
      markers.set(marker, { digest, owner });
    }
    for (const generation of generations) {
      removeAttestedRuntimeClosure(plan.installRoot, plan.layout, generation);
    }
    for (const { digest, owner } of markers.values()) {
      removeRuntimeActivationMarker(plan.installRoot, plan.layout, digest, owner);
    }
  }

  const currentManifest = readManagedFileNoFollow(plan.installRoot, plan.manifestPath);
  commitManagedFileTransaction(
    plan.installRoot,
    plan.layout,
    "uninstall",
    [
      {
        path: plan.profilePath,
        transition: managedFileTransition(currentProfileHash, nextProfile),
      },
      ...plan.skills.map((skill) => ({
        path: skill.path,
        transition: managedFileTransition(skill.currentSha256, skill.nextBytes),
      })),
      {
        path: plan.manifestPath,
        transition: managedFileTransition(
          currentManifest === null ? null : sha256Bytes(currentManifest),
          plan.needsManifestRemoval ? null : currentManifest,
        ),
      },
    ],
  );
  fsyncDirectory(paths.agentsDir);
  if (plan.skills.length > 0) fsyncDirectory(paths.skillsDir);
  fsyncDirectory(paths.manifestDir);

  if (plan.backupPath) {
    const stat = lstatOrNull(plan.backupPath);
    if (stat?.isFile() && !stat.isSymbolicLink()) unlinkSync(plan.backupPath);
  }

  for (const skill of plan.skills) {
    if (skill.record.backup) {
      const backupPath = backupAbs(plan.installRoot, skill.record.backup);
      const stat = lstatOrNull(backupPath);
      if (stat?.isFile() && !stat.isSymbolicLink()) unlinkSync(backupPath);
    }
  }

  if (plan.manifest?.format === 1) {
    warnings.push("legacy format-1 manifest has no runtime ownership proof; runtime left untouched");
  }

  const skillDirs = [...new Set(plan.skills.map((skill) => dirname(skill.path)))].sort(
    (left, right) => right.length - left.length,
  );
  for (const dir of skillDirs) {
    rmdirIfEmpty(dir);
    rmdirIfEmpty(dirname(dir));
  }

  return warnings;
};

const cleanupEmptyManagedDirs = (root: string, layout: KiroManagedLayout): void => {
  const paths = managedPaths(root, layout);
  rmdirIfEmpty(paths.runtimeDir);
  rmdirIfEmpty(dirname(paths.runtimeDir));
  rmdirIfEmpty(paths.legacyRuntimeDir);
  rmdirIfEmpty(paths.skillsDir);
  rmdirIfEmpty(paths.backupDir);
  rmdirIfEmpty(paths.manifestDir);
  rmdirIfEmpty(paths.agentsDir);
  if (layout === "project") {
    rmdirIfEmpty(join(root, ".kiro"));
  }
};

export const uninstallKiroProfile = (
  options: KiroUninstallOptions = {},
): KiroUninstallResult => {
  if (!options.dryRun) {
    const roots = resolveKiroInstallRoots(options);
    const transaction = managedPaths(roots.installRoot, roots.layout).transaction;
    if (existsSync(transaction)) {
      const recoveryLock = acquireOperationLock(roots.installRoot, roots.layout);
      try {
        recoverManagedTransaction(roots.installRoot, roots.layout);
      } finally {
        recoveryLock.release();
      }
    }
  }
  const planned = planKiroProfileUninstall(options);
  if (options.dryRun) return resultFromPlan(planned, true);
  if (
    planned.action === "noop" &&
    !planned.needsManifestRemoval &&
    !existsSync(managedPaths(planned.installRoot, planned.layout).transaction)
  ) {
    cleanupEmptyManagedDirs(planned.installRoot, planned.layout);
    return resultFromPlan(planned, false);
  }

  const lock = acquireOperationLock(planned.installRoot, planned.layout);
  let result: KiroUninstallResult;
  try {
    recoverManagedTransaction(planned.installRoot, planned.layout);
    const plan = planKiroProfileUninstall(options);
    if (plan.action === "noop" && !plan.needsManifestRemoval) {
      result = resultFromPlan(plan, false);
    } else {
      result = resultFromPlan(plan, false, commitUninstall(plan));
    }
  } finally {
    lock.release();
  }
  cleanupEmptyManagedDirs(planned.installRoot, planned.layout);
  return result!;
};
