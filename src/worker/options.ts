import fs from "node:fs";
import type { AgentWorkerOptions } from "../agents/types.js";

// Keep the semantic-context contract dependency-free in this module. The
// source worker is launched directly by Node in tests and intentionally loads
// options.ts without relying on emitted sibling .js files.
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

const contextKeys = [
  "objective",
  "facts",
  "relevantFiles",
  "constraints",
  "exclusions",
] as const;

const checkedContextString = (value: unknown, label: string, maxChars: number): string => {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} must not be empty`);
  if (normalized.length > maxChars) {
    throw new RangeError(`${label} exceeds ${maxChars} characters`);
  }
  return normalized;
};

const checkedContextStringList = (value: unknown, label: string): string[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array of strings`);
  if (value.length > KIRO_SEMANTIC_CONTEXT_MAX_ITEMS) {
    throw new RangeError(`${label} exceeds ${KIRO_SEMANTIC_CONTEXT_MAX_ITEMS} items`);
  }
  return value.map((entry, index) =>
    checkedContextString(
      entry,
      `${label}[${index}]`,
      KIRO_SEMANTIC_CONTEXT_MAX_ITEM_CHARS,
    ));
};

/** Validate and canonicalize a Kiro context packet before process crossing. */
export const normalizeKiroSemanticContext = (
  value: unknown,
): KiroSemanticContextPacket => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Kiro semantic context must be an object");
  }
  const source = value as Record<string, unknown>;
  const unknown = Object.keys(source).filter(
    (key) => !(contextKeys as readonly string[]).includes(key),
  );
  if (unknown.length > 0) {
    throw new TypeError(`Unknown Kiro semantic context field: ${unknown[0]}`);
  }
  const objective = source.objective === undefined
    ? undefined
    : checkedContextString(
        source.objective,
        "Kiro semantic context objective",
        KIRO_SEMANTIC_CONTEXT_MAX_OBJECTIVE_CHARS,
      );
  const facts = checkedContextStringList(source.facts, "Kiro semantic context facts");
  const relevantFiles = checkedContextStringList(
    source.relevantFiles,
    "Kiro semantic context relevantFiles",
  );
  const constraints = checkedContextStringList(
    source.constraints,
    "Kiro semantic context constraints",
  );
  const exclusions = checkedContextStringList(
    source.exclusions,
    "Kiro semantic context exclusions",
  );
  const packet: KiroSemanticContextPacket = {
    ...(objective ? { objective } : {}),
    ...(facts ? { facts } : {}),
    ...(relevantFiles ? { relevantFiles } : {}),
    ...(constraints ? { constraints } : {}),
    ...(exclusions ? { exclusions } : {}),
  };
  if (JSON.stringify(packet).length > KIRO_SEMANTIC_CONTEXT_MAX_CHARS) {
    throw new RangeError(
      `Kiro semantic context exceeds ${KIRO_SEMANTIC_CONTEXT_MAX_CHARS} characters`,
    );
  }
  return packet;
};

const argumentMap = (argv: readonly string[]): Map<string, string> => {
  const result = new Map<string, string>();
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid worker argument near ${key ?? "<end>"}`);
    }
    result.set(key.slice(2), value);
  }
  return result;
};

const required = (args: Map<string, string>, name: string): string => {
  const value = args.get(name);
  if (!value) throw new Error(`Missing worker argument: --${name}`);
  return value;
};

const optional = (args: Map<string, string>, name: string): string | undefined =>
  args.get(name) || undefined;

export const parseWorkerOptions = (
  argv: readonly string[] = process.argv,
): AgentWorkerOptions => {
  const args = argumentMap(argv);
  const model = optional(args, "model");
  const thinking = optional(args, "thinking");
  const fabricExtensionPath = optional(args, "fabric-extension");
  const schemaFile = optional(args, "schema-file");
  const imagesFile = optional(args, "images-file");
  const systemPrompt = optional(args, "system-prompt");
  const sessionFile = optional(args, "session-file");
  const sessionExportFile = optional(args, "session-export-file");
  const actorId = optional(args, "actor-id");
  const actorName = optional(args, "actor-name");
  const capabilityRequirementsSource = optional(args, "capability-requirements");
  const capabilityDigest = optional(args, "capability-digest");
  const capabilityRequirements = capabilityRequirementsSource
    ? JSON.parse(capabilityRequirementsSource) as unknown
    : undefined;
  if (
    capabilityRequirements !== undefined &&
    (!Array.isArray(capabilityRequirements) ||
      capabilityRequirements.length > 128 ||
      capabilityRequirements.some((ref) => typeof ref !== "string" || ref.length > 256 || !ref.includes(".")))
  ) {
    throw new Error("Invalid worker capability requirements");
  }
  if ((capabilityRequirementsSource !== undefined) !== (capabilityDigest !== undefined)) {
    throw new Error("Worker capability commitment requires both requirements and digest");
  }
  if (capabilityDigest !== undefined && !/^[a-f0-9]{64}$/.test(capabilityDigest)) {
    throw new Error("Invalid worker capability digest");
  }
  const meshRoot = optional(args, "mesh-root");
  const projectRoot = optional(args, "project-root");
  const ownerHostId = optional(args, "owner-host-id");
  const ownerIdentityId = optional(args, "owner-identity-id");
  const runRoot = optional(args, "run-root");
  const steerFile = optional(args, "steer-file");
  const branch = optional(args, "branch");
  const worktree = optional(args, "worktree");
  const maxTokens = optional(args, "max-tokens");
  const runnerSessionId = optional(args, "runner-session-id");
  const kiroSessionProfileSha256 = optional(args, "kiro-session-profile-sha256");
  if (
    kiroSessionProfileSha256 !== undefined &&
    !/^[a-f0-9]{64}$/.test(kiroSessionProfileSha256)
  ) {
    throw new Error("Invalid worker Kiro session profile SHA-256");
  }
  const kiroResidency = optional(args, "kiro-residency");
  if (kiroResidency !== undefined && kiroResidency !== "one-shot" && kiroResidency !== "resident") {
    throw new Error(`Invalid worker Kiro residency: ${kiroResidency}`);
  }
  const kiroContext = (() => {
    const file = optional(args, "kiro-context-file");
    if (!file) return undefined;
    const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
    let descriptor: number;
    try {
      descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
    } catch (error) {
      throw new Error(
        `Cannot open Kiro semantic context file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    try {
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("Kiro semantic context path is not a regular file");
      }
      if (process.platform !== "win32") {
        if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
          throw new Error("Kiro semantic context file is owned by another user");
        }
        if ((stat.mode & 0o077) !== 0) {
          throw new Error("Kiro semantic context file must not be group/world accessible");
        }
      }
      if (stat.size > KIRO_SEMANTIC_CONTEXT_MAX_CHARS * 4) {
        throw new Error("Kiro semantic context file is too large");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(fs.readFileSync(descriptor, "utf8")) as unknown;
      } catch {
        throw new Error("Kiro semantic context file contains invalid JSON");
      }
      return normalizeKiroSemanticContext(parsed);
    } finally {
      fs.closeSync(descriptor);
    }
  })();
  if (
    runnerSessionId &&
    (runnerSessionId.length > 256 || !/^[\x21-\x7E]+$/.test(runnerSessionId))
  ) {
    throw new Error("Invalid worker runner session id");
  }
  const mainAgentId = optional(args, "main-agent-id");
  const runner = required(args, "runner");
  if (runner !== "pi" && runner !== "claude" && runner !== "veda" && runner !== "kiro") {
    throw new Error(`Unsupported Fabric agent runner: ${runner}`);
  }
  return {
    id: required(args, "id"),
    runner,
    name: required(args, "name"),
    taskFile: required(args, "task-file"),
    ...(imagesFile ? { imagesFile } : {}),
    statusFile: required(args, "status-file"),
    lifecycleFile: required(args, "lifecycle-file"),
    logFile: required(args, "log-file"),
    ...(schemaFile ? { schemaFile } : {}),
    cwd: required(args, "cwd"),
    piBinary: required(args, "pi-binary"),
    claudeBinary: required(args, "claude-binary"),
    vedaBinary: required(args, "veda-binary"),
    kiroBinary: required(args, "kiro-binary"),
    vedaBackend: required(args, "veda-backend"),
    vedaPersona: required(args, "veda-persona"),
    timeoutMs: Number(required(args, "timeout-ms")),
    depth: Number(required(args, "depth")),
    fullCodeMode: required(args, "full-code-mode") === "true",
    ...(mainAgentId ? { mainAgentId } : {}),
    extensions: required(args, "extensions") === "true",
    tools: JSON.parse(required(args, "tools")) as string[],
    grantedRisks: JSON.parse(required(args, "granted-risks")) as string[],
    transport: required(args, "transport") as AgentWorkerOptions["transport"],
    ...(fabricExtensionPath ? { fabricExtensionPath } : {}),
    ...(model ? { model } : {}),
    ...(thinking ? { thinking } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(sessionFile ? { sessionFile } : {}),
    ...(sessionExportFile ? { sessionExportFile } : {}),
    ...(actorId ? { actorId } : {}),
    ...(actorName ? { actorName } : {}),
    ...(capabilityRequirements
      ? { capabilityRequirements: [...new Set(capabilityRequirements as string[])] }
      : {}),
    ...(capabilityDigest ? { capabilityDigest } : {}),
    ...(meshRoot ? { meshRoot } : {}),
    ...(projectRoot ? { projectRoot } : {}),
    ...(ownerHostId ? { ownerHostId } : {}),
    ...(ownerIdentityId ? { ownerIdentityId } : {}),
    ...(runnerSessionId ? { runnerSessionId } : {}),
    ...(kiroSessionProfileSha256 ? { kiroSessionProfileSha256 } : {}),
    ...(runRoot ? { runRoot } : {}),
    ...(steerFile ? { steerFile } : {}),
    ...(branch ? { branch } : {}),
    ...(worktree ? { worktree } : {}),
    ...(maxTokens ? { maxTokens: Number(maxTokens) } : {}),
    ...(kiroResidency ? { kiroResidency } : {}),
    ...(kiroContext ? { kiroContext } : {}),
  };
};
