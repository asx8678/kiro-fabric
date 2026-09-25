export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export const bounded = (value: unknown, fallback: string, maximum = 800): string =>
  (value instanceof Error ? value.message : typeof value === "string" ? value : fallback)
    .replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, maximum) || fallback;
export const toolError = (code: string, error: unknown, issues?: readonly unknown[]) => ({
  content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message: bounded(error, "The request failed"), ...(issues?.length ? { issues: issues.slice(0, 8).map((issue) => bounded(issue, "invalid value", 200)) } : {}) } }) }],
  isError: true as const,
});

export const supportsKiroElicitation = (capabilities: unknown): boolean => {
  if (!isRecord(capabilities) || !isRecord(capabilities.elicitation)) return false;
  return Object.keys(capabilities.elicitation).length === 0 || Object.hasOwn(capabilities.elicitation, "form");
};
