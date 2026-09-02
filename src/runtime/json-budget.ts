/** Matches default executor.maxNestedResultChars. */
export const DEFAULT_FABRIC_JSON_CHARS = 2_000_000;

const budgetError = (received: number, maxChars: number): Error =>
  new Error(`Fabric host JSON exceeds ${maxChars} characters: received ${received}`);

export const fabricJsonText = (
  value: unknown,
  maxChars = DEFAULT_FABRIC_JSON_CHARS,
): string => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return "null";
  if (serialized.length > maxChars) throw budgetError(serialized.length, maxChars);
  return serialized;
};

export const assertFabricJsonBudget = (
  value: unknown,
  maxChars = DEFAULT_FABRIC_JSON_CHARS,
): void => {
  if (typeof value === "string") {
    if (value.length > maxChars) throw budgetError(value.length, maxChars);
    return;
  }
  fabricJsonText(value, maxChars);
};
