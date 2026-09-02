import { cpSync, lstatSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const USER_POWER_NAME = "kiro-fabric";

const lstatOrNull = (target) => {
  try {
    return lstatSync(target);
  } catch (error) {
    if (error && /** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return undefined;
    throw error;
  }
};

/** User Kiro home: $KIRO_HOME if set, otherwise ~/.kiro. Refuses symlinks. */
export const resolveKiroHome = (env = process.env, home = homedir()) => {
  const raw = env.KIRO_HOME;
  const candidate = typeof raw === "string" && raw.trim() !== ""
    ? path.resolve(raw.trim())
    : path.join(home, ".kiro");
  const stat = lstatOrNull(candidate);
  if (stat?.isSymbolicLink()) {
    throw new Error(`refusing Kiro home symlink: ${candidate}`);
  }
  if (stat && !stat.isDirectory()) {
    throw new Error(`Kiro home is not a directory: ${candidate}`);
  }
  return candidate;
};

export const resolveUserPowerRoot = (env = process.env, home = homedir()) =>
  path.join(resolveKiroHome(env, home), "powers", USER_POWER_NAME);

/** Opt out of writing ~/.kiro during CI or read-only sandboxes. */
export const shouldInstallUserPower = (env = process.env) =>
  env.KIRO_FABRIC_SKIP_USER_POWER_INSTALL !== "1";

/** Replace the user-global Power package with the staged folder. */
export const installPowerPackage = (stagingRoot, destination) => {
  const staging = lstatOrNull(stagingRoot);
  if (!staging?.isDirectory() || staging.isSymbolicLink()) {
    throw new Error(`Power staging root is missing or is not a directory: ${stagingRoot}`);
  }
  const existing = lstatOrNull(destination);
  if (existing?.isSymbolicLink()) {
    throw new Error(`refusing Power install symlink: ${destination}`);
  }
  mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  rmSync(destination, { recursive: true, force: true });
  cpSync(stagingRoot, destination, { recursive: true });
  return destination;
};
