// User Kiro home resolution. Interactive Kiro CLI loads global agents and
// steering from this directory (on this machine: /Users/adam2/.kiro).
// Project-scoped installs still write <project>/.kiro; --user writes here.

import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { realpathSync } from "node:fs";

import {
  KiroInstallError,
  lstatOrNull,
  resolveKiroProjectRoot,
  type KiroManagedLayout,
} from "./managed.js";

export const resolveKiroHome = (explicit?: string): string => {
  const raw = explicit ?? process.env.KIRO_HOME;
  const candidate =
    typeof raw === "string" && raw.trim() !== ""
      ? isAbsolute(raw)
        ? raw
        : resolve(process.cwd(), raw)
      : join(homedir(), ".kiro");
  const stat = lstatOrNull(candidate);
  if (stat?.isSymbolicLink()) {
    throw new KiroInstallError("symlink", `refusing Kiro home symlink: ${candidate}`);
  }
  if (stat && !stat.isDirectory()) {
    throw new KiroInstallError("root", `Kiro home is not a directory: ${candidate}`);
  }
  if (stat) {
    try {
      return realpathSync(candidate);
    } catch {
      return resolve(candidate);
    }
  }
  return resolve(candidate);
};

export interface KiroInstallRoots {
  layout: KiroManagedLayout;
  /** Filesystem root that contains Kiro profiles plus the managed `.fabric/runtime` closure. */
  installRoot: string;
  /** Canonical project bound into the profile MCP environment. */
  projectRoot: string;
}

export const resolveKiroInstallRoots = (options: {
  scope?: KiroManagedLayout;
  projectRoot?: string;
  kiroHome?: string;
} = {}): KiroInstallRoots => {
  const projectRoot = resolveKiroProjectRoot(options.projectRoot);
  if (options.scope === "user") {
    return {
      layout: "user",
      installRoot: resolveKiroHome(options.kiroHome),
      projectRoot,
    };
  }
  return { layout: "project", installRoot: projectRoot, projectRoot };
};
