import { inspectCanonicalPath } from "./canonical-path.js";

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
 * Resolve and fingerprint a trusted project directory. Parent-component
 * aliases are canonicalized consistently, while a symlink at the selected
 * final directory remains forbidden. Profile generation and MCP startup use
 * this same check so their trust-boundary interpretation cannot drift.
 */
export const resolveCanonicalKiroProjectRootIdentity = (
  projectRoot: string,
): KiroProjectRootIdentity => {
  let inspected;
  try {
    inspected = inspectCanonicalPath(projectRoot, {
      kind: "directory",
      rejectFinalSymlink: true,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `trusted Kiro project root ${projectRoot} is unreadable (${detail}); reinstall the profile`,
    );
  }
  return {
    root: inspected.canonicalPath,
    dev: String(inspected.identity.dev),
    ino: String(inspected.identity.ino),
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
