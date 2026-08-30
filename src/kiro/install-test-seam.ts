// Module-private test seam for installer fixture artifacts. This module is not
// exported by the package. Production behavior never consults environment
// variables or public install options to weaken runtime closure deployment.

export interface KiroInstallTestOverrides {
  runtimeNodeSourcePath?: string;
  skipRuntimeClosure?: boolean;
}

let activeOverrides: KiroInstallTestOverrides | undefined;

export const currentKiroInstallTestOverrides = (): KiroInstallTestOverrides | undefined =>
  activeOverrides;

export const withKiroInstallTestOverrides = async <T>(
  overrides: KiroInstallTestOverrides,
  operation: () => Promise<T>,
): Promise<T> => {
  if (activeOverrides !== undefined) {
    throw new Error("Kiro installer test seam is already active");
  }
  activeOverrides = { ...overrides };
  try {
    return await operation();
  } finally {
    activeOverrides = undefined;
  }
};
