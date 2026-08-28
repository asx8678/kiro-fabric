import fs from "node:fs";

export const KIRO_SEMANTIC_CONTEXT_MAX_ITEMS = 32;
export const KIRO_SEMANTIC_CONTEXT_MAX_ITEM_CHARS = 2_000;
export const KIRO_SEMANTIC_CONTEXT_MAX_OBJECTIVE_CHARS = 4_000;
export const KIRO_SEMANTIC_CONTEXT_MAX_CHARS = 32_000;

export interface KiroSemanticContextPacket {
  objective?: string;
  facts?: string[];
  relevantFiles?: string[];
  constraints?: string[];
  exclusions?: string[];
}

export interface KiroAgentWorkerOptions {
  id: string;
  runner: "kiro";
  name: string;
  taskFile: string;
  imagesFile?: string;
  statusFile: string;
  logFile: string;
  schemaFile?: string;
  cwd: string;
  kiroBinary: string;
  timeoutMs: number;
  tools: string[];
  transport: "auto" | "process" | "tmux" | "screen" | "localterm" | "herdr";
  model?: string;
  thinking?: string;
  systemPrompt?: string;
  sessionFile?: string;
  actorId?: string;
  actorName?: string;
  capabilityRequirements?: string[];
  capabilityDigest?: string;
  projectRoot?: string;
  runnerSessionId?: string;
  kiroSessionProfileSha256?: string;
  runRoot?: string;
  steerFile?: string;
  branch?: string;
  worktree?: string;
  kiroResidency?: "one-shot" | "resident";
  kiroContext?: KiroSemanticContextPacket;
}

const contextKeys = ["objective", "facts", "relevantFiles", "constraints", "exclusions"] as const;
const checkedString = (value: unknown, label: string, max: number): string => {
  if (typeof value !== "string") throw new TypeError(label + " must be a string");
  const normalized = value.trim();
  if (!normalized) throw new TypeError(label + " must not be empty");
  if (normalized.length > max) throw new RangeError(label + " exceeds " + max + " characters");
  return normalized;
};
const checkedList = (value: unknown, label: string): string[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError(label + " must be an array of strings");
  if (value.length > KIRO_SEMANTIC_CONTEXT_MAX_ITEMS) throw new RangeError(label + " exceeds " + KIRO_SEMANTIC_CONTEXT_MAX_ITEMS + " items");
  return value.map((entry, index) => checkedString(entry, label + "[" + index + "]", KIRO_SEMANTIC_CONTEXT_MAX_ITEM_CHARS));
};
export const normalizeKiroSemanticContext = (value: unknown): KiroSemanticContextPacket => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Kiro semantic context must be an object");
  const source = value as Record<string, unknown>;
  const unknownKey = Object.keys(source).find((key) => !(contextKeys as readonly string[]).includes(key));
  if (unknownKey) throw new TypeError("Unknown Kiro semantic context field: " + unknownKey);
  const objective = source.objective === undefined ? undefined : checkedString(source.objective, "Kiro semantic context objective", KIRO_SEMANTIC_CONTEXT_MAX_OBJECTIVE_CHARS);
  const facts = checkedList(source.facts, "Kiro semantic context facts");
  const relevantFiles = checkedList(source.relevantFiles, "Kiro semantic context relevantFiles");
  const constraints = checkedList(source.constraints, "Kiro semantic context constraints");
  const exclusions = checkedList(source.exclusions, "Kiro semantic context exclusions");
  const packet: KiroSemanticContextPacket = {
    ...(objective ? { objective } : {}), ...(facts ? { facts } : {}),
    ...(relevantFiles ? { relevantFiles } : {}), ...(constraints ? { constraints } : {}),
    ...(exclusions ? { exclusions } : {}),
  };
  if (JSON.stringify(packet).length > KIRO_SEMANTIC_CONTEXT_MAX_CHARS) throw new RangeError("Kiro semantic context exceeds " + KIRO_SEMANTIC_CONTEXT_MAX_CHARS + " characters");
  return packet;
};

const argumentMap = (argv: readonly string[]): Map<string, string> => {
  const result = new Map<string, string>();
  const start = argv[0]?.startsWith("--") ? 0 : 2;
  for (let index = start; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("Invalid Kiro worker argument near " + (key ?? "<end>"));
    result.set(key.slice(2), value);
  }
  return result;
};
const required = (args: Map<string, string>, name: string): string => {
  const value = args.get(name);
  if (!value) throw new Error("Missing Kiro worker argument: --" + name);
  return value;
};
const optional = (args: Map<string, string>, name: string): string | undefined => args.get(name) || undefined;
const finiteNumber = (args: Map<string, string>, name: string): number => {
  const value = Number(required(args, name));
  if (!Number.isFinite(value) || value < 0) throw new Error("Invalid Kiro worker argument: --" + name);
  return value;
};
const stringArray = (args: Map<string, string>, name: string, requiredValue = false): string[] | undefined => {
  const raw = requiredValue ? required(args, name) : optional(args, name);
  if (raw === undefined) return undefined;
  let value: unknown;
  try { value = JSON.parse(raw) as unknown; } catch { throw new Error("Invalid Kiro worker argument: --" + name); }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw new Error("Invalid Kiro worker argument: --" + name);
  return [...new Set(value)];
};
const readContext = (file: string | undefined): KiroSemanticContextPacket | undefined => {
  if (!file) return undefined;
  const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
  let descriptor: number;
  try { descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow); }
  catch (error) { throw new Error("Cannot open Kiro semantic context file: " + (error instanceof Error ? error.message : String(error))); }
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) throw new Error("Kiro semantic context path is not a regular file");
    if (process.platform !== "win32") {
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("Kiro semantic context file is owned by another user");
      if ((stat.mode & 0o077) !== 0) throw new Error("Kiro semantic context file must not be group/world accessible");
    }
    if (stat.size > KIRO_SEMANTIC_CONTEXT_MAX_CHARS * 4) throw new Error("Kiro semantic context file is too large");
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(descriptor, "utf8")) as unknown; } catch { throw new Error("Kiro semantic context file contains invalid JSON"); }
    return normalizeKiroSemanticContext(parsed);
  } finally { fs.closeSync(descriptor); }
};

export const parseKiroAgentWorkerOptions = (argv: readonly string[] = process.argv): KiroAgentWorkerOptions => {
  const args = argumentMap(argv);
  const runner = required(args, "runner");
  if (runner !== "kiro") throw new Error("Unsupported Kiro worker runner: " + runner);
  const transport = required(args, "transport");
  if (!["process", "tmux", "screen", "localterm", "herdr"].includes(transport)) throw new Error("Invalid Kiro worker transport: " + transport);
  const residency = optional(args, "kiro-residency");
  if (residency !== undefined && residency !== "one-shot" && residency !== "resident") throw new Error("Invalid Kiro worker residency: " + residency);
  const runnerSessionId = optional(args, "runner-session-id");
  if (runnerSessionId && (runnerSessionId.length > 256 || !/^[\x21-\x7E]+$/.test(runnerSessionId))) throw new Error("Invalid Kiro worker runner session id");
  const capabilityRequirements = stringArray(args, "capability-requirements");
  if (capabilityRequirements && (capabilityRequirements.length > 128 || capabilityRequirements.some((ref) => ref.length > 256 || !ref.includes(".")))) throw new Error("Invalid Kiro worker capability requirements");
  const pick = (name: string): string | undefined => optional(args, name);
  const context = readContext(pick("kiro-context-file"));
  return {
    id: required(args, "id"), runner: "kiro", name: required(args, "name"),
    taskFile: required(args, "task-file"), statusFile: required(args, "status-file"),
    logFile: required(args, "log-file"), cwd: required(args, "cwd"),
    kiroBinary: required(args, "kiro-binary"), timeoutMs: finiteNumber(args, "timeout-ms"),
    tools: stringArray(args, "tools", true)!, transport: transport as KiroAgentWorkerOptions["transport"],
    ...(pick("images-file") ? { imagesFile: pick("images-file")! } : {}),
    ...(pick("schema-file") ? { schemaFile: pick("schema-file")! } : {}),
    ...(pick("model") ? { model: pick("model")! } : {}), ...(pick("thinking") ? { thinking: pick("thinking")! } : {}),
    ...(pick("system-prompt") ? { systemPrompt: pick("system-prompt")! } : {}), ...(pick("session-file") ? { sessionFile: pick("session-file")! } : {}),
    ...(pick("actor-id") ? { actorId: pick("actor-id")! } : {}), ...(pick("actor-name") ? { actorName: pick("actor-name")! } : {}),
    ...(capabilityRequirements ? { capabilityRequirements } : {}), ...(pick("capability-digest") ? { capabilityDigest: pick("capability-digest")! } : {}),
    ...(pick("project-root") ? { projectRoot: pick("project-root")! } : {}), ...(runnerSessionId ? { runnerSessionId } : {}),
    ...(pick("kiro-session-profile-sha256") ? { kiroSessionProfileSha256: pick("kiro-session-profile-sha256")! } : {}),
    ...(pick("run-root") ? { runRoot: pick("run-root")! } : {}), ...(pick("steer-file") ? { steerFile: pick("steer-file")! } : {}),
    ...(pick("branch") ? { branch: pick("branch")! } : {}), ...(pick("worktree") ? { worktree: pick("worktree")! } : {}),
    ...(residency ? { kiroResidency: residency } : {}), ...(context ? { kiroContext: context } : {}),
  };
};
