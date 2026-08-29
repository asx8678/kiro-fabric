import { lstatSync, realpathSync, statSync, type BigIntStats, type Stats } from "node:fs";
import path from "node:path";

export interface KiroProjectRootIdentity {
  root: string;
  dev: string;
  ino: string;
}

export interface ExpectedKiroProjectRootIdentity {
  dev: string;
  ino: string;
}

/**
 * Resolve and fingerprint a trusted project directory without accepting a
 * symlinked or merely equivalent spelling. Profile generation and MCP startup
 * use this same check so their trust-boundary interpretation cannot drift.
 */
export const resolveCanonicalKiroProjectRootIdentity = (
  projectRoot: string,
): KiroProjectRootIdentity => {
  const configured = path.resolve(projectRoot);
  let lexical: Stats;
  let canonical: string;
  let identity: BigIntStats;
  try {
    lexical = lstatSync(configured);
    canonical = realpathSync(configured);
    identity = statSync(canonical, { bigint: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `trusted Kiro project root ${configured} is unreadable (${detail}); reinstall the profile`,
    );
  }
  if (lexical.isSymbolicLink() || !lexical.isDirectory() || canonical !== configured) {
    throw new Error(
      "trusted Kiro project root must be a canonical, non-symlink directory; " +
        "reinstall the profile from the canonical path",
    );
  }
  return {
    root: canonical,
    dev: String(identity.dev),
    ino: String(identity.ino),
  };
};

export const verifyCanonicalKiroProjectRootIdentity = (
  projectRoot: string,
  expected: ExpectedKiroProjectRootIdentity,
): KiroProjectRootIdentity => {
  const current = resolveCanonicalKiroProjectRootIdentity(projectRoot);
  if (current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new Error(
      "trusted Kiro project root filesystem identity changed; " +
        "reinstall the profile from the same canonical project path",
    );
  }
  return current;
};
