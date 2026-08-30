import {
  installKiroProfile as installKiroProfileProduction,
  type KiroInstallOptions,
  type KiroInstallResult,
} from "./install.js";
import {
  withKiroInstallTestOverrides,
  type KiroInstallTestOverrides,
} from "./install-test-seam.js";
import { withPrivateKiroLauncherFixtures } from "./compatibility-test-seam.js";

export type KiroTestInstallOptions = KiroInstallOptions & KiroInstallTestOverrides & {
  dryRun?: boolean;
};

/** Test-only fixture seam; intentionally outside the package export surface. */
export const installKiroProfile = async (
  options: KiroTestInstallOptions = {},
): Promise<KiroInstallResult> => {
  const { runtimeNodeSourcePath, skipRuntimeClosure, ...production } = options;
  const fixture = production.kiroBinary;
  const operation = () => withKiroInstallTestOverrides(
    {
      ...(runtimeNodeSourcePath ? { runtimeNodeSourcePath } : {}),
      ...(skipRuntimeClosure !== undefined ? { skipRuntimeClosure } : {}),
    },
    () => installKiroProfileProduction(production),
  );
  return fixture
    ? withPrivateKiroLauncherFixtures([fixture], operation)
    : operation();
};
