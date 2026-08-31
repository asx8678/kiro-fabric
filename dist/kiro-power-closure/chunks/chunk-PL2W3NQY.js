import { createRequire as __kfCreateRequire } from "node:module";
import { fileURLToPath as __kfFileURLToPath } from "node:url";
import { dirname as __kfDirname } from "node:path";
globalThis.__filename = __kfFileURLToPath(import.meta.url);
globalThis.__dirname = __kfDirname(globalThis.__filename);
const require = __kfCreateRequire(import.meta.url);


// src/kiro/run-scope.ts
var KIRO_CHILD_TOOL_REFS = {
  read: "k.read",
  bash: "k.bash",
  edit: "k.edit",
  write: "k.write",
  grep: "k.grep",
  find: "k.find",
  ls: "k.ls"
};
var KIRO_CHILD_TOOLS = Object.freeze(
  Object.keys(KIRO_CHILD_TOOL_REFS)
);
var MAX_RUNNER_SESSION_ID_CHARS = 256;
var RUNNER_SESSION_ID_PATTERN = /^[\x21-\x7E]{1,256}$/;
var KiroChildToolError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "KiroChildToolError";
  }
};
var isOwnBareName = (value) => Object.hasOwn(KIRO_CHILD_TOOL_REFS, value);
var rejectIdentifier = (value, label) => {
  const shown = typeof value === "string" ? JSON.stringify(value).slice(0, 80) : typeof value;
  throw new KiroChildToolError(`invalid Kiro ${label}: ${shown}`);
};
var parseKiroChildTools = (value) => {
  if (!Array.isArray(value)) {
    throw new KiroChildToolError("Kiro child tools must be an array of bare names");
  }
  if (value.length > KIRO_CHILD_TOOLS.length) {
    throw new KiroChildToolError("Kiro child tools list is longer than the closed portable set");
  }
  const seen = /* @__PURE__ */ new Set();
  const tools = [];
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
var kiroChildToolRefs = (tools) => [...tools.map((tool) => KIRO_CHILD_TOOL_REFS[tool]), "k.readArtifact"];
var serializeKiroChildTools = (tools) => JSON.stringify(parseKiroChildTools([...tools]));
var parseKiroChildToolsEnv = (value) => {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new KiroChildToolError("KIRO_FABRIC_KIRO_TOOLS must be a JSON array");
  }
  return parseKiroChildTools(parsed);
};
var isValidRunnerSessionId = (value) => typeof value === "string" && value.length > 0 && value.length <= MAX_RUNNER_SESSION_ID_CHARS && RUNNER_SESSION_ID_PATTERN.test(value);
var assertRunnerSessionId = (value, label = "runnerSessionId") => {
  if (!isValidRunnerSessionId(value)) {
    throw new KiroChildToolError(`invalid Kiro ${label}`);
  }
  return value;
};

export {
  parseKiroChildTools,
  kiroChildToolRefs,
  serializeKiroChildTools,
  parseKiroChildToolsEnv,
  isValidRunnerSessionId,
  assertRunnerSessionId
};
