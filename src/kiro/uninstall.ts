// Safe Kiro uninstall. Removes only a profile whose current bytes still
// match the managed manifest hash, or restores the verified displaced-user
// backup. Never inspects or deletes a profile when no manifest is present.

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import {
  acquireOperationLock,
  assertBackupBytes,
  assertManagedTree,
  commitManagedTransaction,
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
  type KiroManagedLayout,
} from "./managed.js";
import { resolveKiroInstallRoots } from "./home.js";
import { removeRuntimeClosure } from "./runtime-closure.js";

export type KiroUninstallAction = "noop" | "remove" | "restore";

export interface KiroUninstallOptions {
  projectRoot?: string;
  dryRun?: boolean;
  scope?: KiroManagedLayout;
  kiroHome?: string;
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
      warnings: [],
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
      warnings: [],
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
      warnings: [],
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
      warnings: [],
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
  changed: !dryRun && (plan.needsProfileMutation || plan.needsManifestRemoval),
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

  const currentManifest = readManagedFileNoFollow(plan.installRoot, plan.manifestPath);
  commitManagedTransaction(
    plan.installRoot,
    plan.layout,
    "uninstall",
    managedFileTransition(currentProfileHash, nextProfile),
    managedFileTransition(
      currentManifest === null ? null : sha256Bytes(currentManifest),
      plan.needsManifestRemoval ? null : currentManifest,
    ),
  );
  fsyncDirectory(paths.agentsDir);
  fsyncDirectory(paths.manifestDir);

  if (plan.backupPath) {
    try {
      const stat = lstatOrNull(plan.backupPath);
      if (stat?.isFile() && !stat.isSymbolicLink()) unlinkSync(plan.backupPath);
    } catch (error) {
      warnings.push(`could not remove backup ${plan.backupPath}: ${(error as Error).message}`);
    }
  }

  // Remove the runtime closure directory
  try {
    removeRuntimeClosure(plan.installRoot, plan.layout);
  } catch (error) {
    warnings.push(`could not remove runtime closure: ${(error as Error).message}`);
  }

  return warnings;
};

const cleanupEmptyManagedDirs = (root: string, layout: KiroManagedLayout): void => {
  const paths = managedPaths(root, layout);
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
