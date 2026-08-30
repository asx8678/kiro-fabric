export const KIRO_INTEGRATION_MODES = [
  "power",
  "strict",
  "internal-child",
] as const;

export type KiroIntegrationMode = (typeof KIRO_INTEGRATION_MODES)[number];

export const isKiroIntegrationMode = (
  value: unknown,
): value is KiroIntegrationMode =>
  typeof value === "string" &&
  (KIRO_INTEGRATION_MODES as readonly string[]).includes(value);

/** Parse a security-relevant integration selector without a permissive fallback. */
export const parseKiroIntegrationMode = (
  value: unknown,
  source = "Kiro integration mode",
): KiroIntegrationMode => {
  if (!isKiroIntegrationMode(value)) {
    const rendered = typeof value === "string" ? JSON.stringify(value) : String(value);
    throw new Error(
      `${source} must be one of power, strict, or internal-child; received ${rendered}`,
    );
  }
  return value;
};

/** Compatibility mapping for profile-owned values emitted before Power support. */
export const integrationModeFromProfileKind = (
  value: unknown,
): Exclude<KiroIntegrationMode, "power"> => {
  if (value === "managed-main" || value === "strict") return "strict";
  if (value === "internal-child") return "internal-child";
  throw new Error(
    `KIRO_FABRIC_PROFILE_KIND must be managed-main, strict, or internal-child; received ${JSON.stringify(value)}`,
  );
};
