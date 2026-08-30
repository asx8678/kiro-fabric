// Module-private fixture seam for executable-format tests. This file is not
// exported or included in the published package surface. Production callers
// cannot opt a shebang launcher into the Kiro artifact contract.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

interface FixtureIdentity {
  sha256: string;
}

let activeFixtures: FixtureIdentity[] | undefined;

const fixtureIdentity = (path: string): FixtureIdentity => ({
  sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
});

export const isPrivateKiroLauncherFixture = (_path: string, sha256: string): boolean =>
  activeFixtures?.some((fixture) => fixture.sha256 === sha256) === true;

export const withPrivateKiroLauncherFixtures = async <T>(
  paths: string[],
  operation: () => Promise<T>,
): Promise<T> => {
  if (activeFixtures !== undefined) throw new Error("Kiro launcher fixture seam is already active");
  activeFixtures = paths.map(fixtureIdentity);
  try {
    return await operation();
  } finally {
    activeFixtures = undefined;
  }
};
