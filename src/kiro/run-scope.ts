// Closed Kiro child-tool mapper. Bare names only; never normalize, trim, or
// accept prototype / control-character / namespaced variants.

const KIRO_CHILD_TOOL_REFS = {
  read: "k.read",
  bash: "k.bash",
  edit: "k.edit",
  write: "k.write",
  grep: "k.grep",
  find: "k.find",
  ls: "k.ls",
} as const;

export type KiroChildTool = keyof typeof KIRO_CHILD_TOOL_REFS;

const KIRO_CHILD_TOOLS = Object.freeze(
  Object.keys(KIRO_CHILD_TOOL_REFS) as KiroChildTool[],
);

const MAX_RUNNER_SESSION_ID_CHARS = 256;
const RUNNER_SESSION_ID_PATTERN = /^[\x21-\x7E]{1,256}$/;

class KiroChildToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KiroChildToolError";
  }
}

const isOwnBareName = (value: string): value is KiroChildTool =>
  Object.hasOwn(KIRO_CHILD_TOOL_REFS, value);

const rejectIdentifier = (value: unknown, label: string): never => {
  const shown =
    typeof value === "string"
      ? JSON.stringify(value).slice(0, 80)
      : typeof value;
  throw new KiroChildToolError(`invalid Kiro ${label}: ${shown}`);
};

export const parseKiroChildTools = (value: unknown): KiroChildTool[] => {
  if (!Array.isArray(value)) {
    throw new KiroChildToolError("Kiro child tools must be an array of bare names");
  }
  if (value.length > KIRO_CHILD_TOOLS.length) {
    throw new KiroChildToolError("Kiro child tools list is longer than the closed portable set");
  }
  const seen = new Set<KiroChildTool>();
  const tools: KiroChildTool[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !isOwnBareName(entry)) {
      rejectIdentifier(entry, "child tool");
    }
    if (seen.has(entry)) continue;
    seen.add(entry);
    tools.push(entry);
  }
  return tools;
};

export const kiroChildToolRefs = (tools: readonly KiroChildTool[]): string[] =>
  [...tools.map((tool) => KIRO_CHILD_TOOL_REFS[tool]), "k.readArtifact"];

export const serializeKiroChildTools = (tools: readonly KiroChildTool[]): string =>
  JSON.stringify(parseKiroChildTools([...tools]));

export const parseKiroChildToolsEnv = (value: string): KiroChildTool[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new KiroChildToolError("KIRO_FABRIC_KIRO_TOOLS must be a JSON array");
  }
  return parseKiroChildTools(parsed);
};

export const isValidRunnerSessionId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_RUNNER_SESSION_ID_CHARS &&
  RUNNER_SESSION_ID_PATTERN.test(value);

export const assertRunnerSessionId = (value: unknown, label = "runnerSessionId"): string => {
  if (!isValidRunnerSessionId(value)) {
    throw new KiroChildToolError(`invalid Kiro ${label}`);
  }
  return value;
};
