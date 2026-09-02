export declare const USER_POWER_NAME: "kiro-fabric";

export declare function resolveKiroHome(
  env?: NodeJS.ProcessEnv,
  home?: string,
): string;

export declare function resolveUserPowerRoot(
  env?: NodeJS.ProcessEnv,
  home?: string,
): string;

export declare function shouldInstallUserPower(env?: NodeJS.ProcessEnv): boolean;

export declare function installPowerPackage(
  stagingRoot: string,
  destination: string,
): string;
