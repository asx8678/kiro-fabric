const FORBIDDEN_CONFIG_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/** Reject keys that can change object semantics before a parsed config is merged or migrated. */
export const assertSafeConfigDocument = (value: unknown, path = "configuration"): void => {
  if (typeof value !== "object" || value === null) return;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_CONFIG_KEYS.has(key)) {
      throw new Error(`${path} contains forbidden key ${JSON.stringify(key)}`);
    }
    assertSafeConfigDocument((value as Record<string, unknown>)[key], `${path}.${key}`);
  }
};

export const safeConfigClone = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(safeConfigClone);
  if (typeof value !== "object" || value === null) return value;
  const clone: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value)) {
    clone[key] = safeConfigClone((value as Record<string, unknown>)[key]);
  }
  return clone;
};

export const safeConfigMerge = (
  base: Readonly<Record<string, unknown>>,
  override: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  assertSafeConfigDocument(base);
  assertSafeConfigDocument(override);
  const merged = safeConfigClone(base) as Record<string, unknown>;
  for (const key of Object.keys(override)) {
    const value = override[key];
    const current = merged[key];
    merged[key] = isConfigObject(current) && isConfigObject(value)
      ? safeConfigMerge(current, value)
      : safeConfigClone(value);
  }
  return merged;
};

export const isConfigObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
