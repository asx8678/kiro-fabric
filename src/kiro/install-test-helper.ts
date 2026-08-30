import {
  installKiroProfile as installKiroProfileProduction,
  type KiroInstallOptions,
  type KiroInstallResult,
} from "./install.js";
import {
  withKiroInstallTestOverrides,
  type KiroInstallTestOverrides,
} from "./install-test-seam.js";

export type KiroTestInstallOptions = KiroInstallOptions & KiroInstallTestOverrides & {
  dryRun?: boolean;
};

/** Test-only fixture seam; intentionally outside the package export surface. */
export const installKiroProfile = async (
  options: KiroTestInstallOptions = {},
): Promise<KiroInstallResult> => {
  const { runtimeNodeSourcePath, skipRuntimeClosure, ...production } = options;
  return withKiroInstallTestOverrides(
    {
      ...(runtimeNodeSourcePath ? { runtimeNodeSourcePath } : {}),
      ...(skipRuntimeClosure !== undefined ? { skipRuntimeClosure } : {}),
    },
    () => installKiroProfileProduction(production),
  );
};
