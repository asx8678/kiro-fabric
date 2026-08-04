import { readFile } from "node:fs/promises";
import path from "node:path";
import { FabricError } from "./errors.js";

export interface Budgets {
  maxAiCalls: number;
  maxPlannerCalls: number;
  maxWorkerCalls: number;
  maxVerifierCalls: number;
  maxConcurrency: number;
  maxRetriesPerCall: number;
  maxPromptCharsPerCall: number;
  maxContextCharsPerCall: number;
  maxOutputCharsPerWorker: number;
  maxOutputCharsVerifier: number;
  maxTotalAiInputChars: number;
  maxTotalAiOutputChars: number;
  executionTimeoutMs: number;
  aiCallTimeoutMs: number;
}

export interface FabricConfig {
  version: 1;
  projectRoot: string;
  runner: {
    type: "kiro-headless" | "fake";
    executable: string;
    workerAgent: string;
    defaultModel: string | null;
  };
  budgets: Budgets;
  filesystem: {
    allowWrite: string[];
    denySymlinkEscape: boolean;
    maxFilesPerReadMany: number;
    maxCharsPerFile: number;
    maxTotalReadChars: number;
  };
  git: {
    allowCommit: boolean;
  };
  permissions: {
    read: "allow" | "ask" | "deny";
    commit: "allow" | "ask" | "deny";
    execute: "allow" | "ask" | "deny";
    network: "allow" | "ask" | "deny";
    destructive: "allow" | "ask" | "deny";
  };
  shell: {
    enabled: boolean;
    allowedCommands: string[];
    timeoutMs: number;
    maxOutputChars: number;
  };
  output: {
    maxFinalChars: number;
    includeMetrics: boolean;
  };
}

export const defaults: FabricConfig = {
  version: 1,
  projectRoot: ".",
  runner: {
    type: "kiro-headless",
    executable: process.env.KIRO_CLI_PATH ?? "kiro-cli",
    workerAgent: "fabric-lite-worker",
    defaultModel: null,
  },
  budgets: {
    maxAiCalls: 7,
    maxPlannerCalls: 1,
    maxWorkerCalls: 5,
    maxVerifierCalls: 1,
    maxConcurrency: 3,
    maxRetriesPerCall: 1,
    maxPromptCharsPerCall: 30000,
    maxContextCharsPerCall: 24000,
    maxOutputCharsPerWorker: 8000,
    maxOutputCharsVerifier: 16000,
    maxTotalAiInputChars: 120000,
    maxTotalAiOutputChars: 40000,
    executionTimeoutMs: 180000,
    aiCallTimeoutMs: 90000,
  },
  filesystem: {
    allowWrite: [],
    denySymlinkEscape: true,
    maxFilesPerReadMany: 20,
    maxCharsPerFile: 20000,
    maxTotalReadChars: 100000,
  },
  git: {
    allowCommit: false,
  },
  permissions: {
    read: "allow",
    commit: "ask",
    execute: "ask",
    network: "ask",
    destructive: "deny",
  },
  shell: {
    enabled: false,
    allowedCommands: [],
    timeoutMs: 30000,
    maxOutputChars: 20000,
  },
  output: { maxFinalChars: 20000, includeMetrics: true },
};

type Validator = (value: unknown, location: string) => void;
interface Shape {
  [key: string]: Validator | Shape;
}

const fail = (location: string, expectation: string): never => {
  throw new FabricError("CONFIG_ERROR", `Invalid config ${location}: expected ${expectation}`);
};
const positiveInteger: Validator = (value, location) => {
  if (!Number.isInteger(value) || (value as number) < 1) fail(location, "a positive integer");
};
const nonnegativeInteger: Validator = (value, location) => {
  if (!Number.isInteger(value) || (value as number) < 0) fail(location, "a nonnegative integer");
};
const booleanValue: Validator = (value, location) => {
  if (typeof value !== "boolean") fail(location, "a boolean");
};
const stringValue: Validator = (value, location) => {
  if (typeof value !== "string") fail(location, "a string");
};
const nonemptyString: Validator = (value, location) => {
  if (typeof value !== "string" || value.length === 0) fail(location, "a non-empty string");
};
const stringArray: Validator = (value, location) => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    fail(location, "an array of strings");
  }
};
const permissionValue: Validator = (value, location) => {
  if (value !== "allow" && value !== "ask" && value !== "deny") fail(location, "allow, ask, or deny");
};

const configShape: Shape = {
  version: (value, location) => {
    if (value !== 1) fail(location, "1");
  },
  projectRoot: nonemptyString,
  runner: {
    type: (value, location) => {
      if (value !== "kiro-headless" && value !== "fake") fail(location, "kiro-headless or fake");
    },
    executable: nonemptyString,
    workerAgent: nonemptyString,
    defaultModel: (value, location) => {
      if (value !== null) stringValue(value, location);
    },
  },
  budgets: {
    maxAiCalls: positiveInteger,
    maxPlannerCalls: positiveInteger,
    maxWorkerCalls: positiveInteger,
    maxVerifierCalls: positiveInteger,
    maxConcurrency: positiveInteger,
    maxRetriesPerCall: nonnegativeInteger,
    maxPromptCharsPerCall: positiveInteger,
    maxContextCharsPerCall: positiveInteger,
    maxOutputCharsPerWorker: positiveInteger,
    maxOutputCharsVerifier: positiveInteger,
    maxTotalAiInputChars: positiveInteger,
    maxTotalAiOutputChars: positiveInteger,
    executionTimeoutMs: positiveInteger,
    aiCallTimeoutMs: positiveInteger,
  },
  filesystem: {
    allowWrite: stringArray,
    denySymlinkEscape: booleanValue,
    maxFilesPerReadMany: positiveInteger,
    maxCharsPerFile: positiveInteger,
    maxTotalReadChars: positiveInteger,
  },
  git: {
    allowCommit: booleanValue,
  },
  permissions: {
    read: permissionValue,
    commit: permissionValue,
    execute: permissionValue,
    network: permissionValue,
    destructive: permissionValue,
  },
  shell: {
    enabled: booleanValue,
    allowedCommands: stringArray,
    timeoutMs: positiveInteger,
    maxOutputChars: positiveInteger,
  },
  output: {
    maxFinalChars: positiveInteger,
    includeMetrics: booleanValue,
  },
};

const dangerousKeys = new Set(["__proto__", "prototype", "constructor"]);

function validateObject(value: unknown, shape: Shape, location: string, requireAll: boolean): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(location, "an object");
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object)) {
    const childLocation = location === "root" ? key : `${location}.${key}`;
    if (dangerousKeys.has(key)) fail(childLocation, "a safe property name");
    if (!Object.hasOwn(shape, key)) fail(childLocation, "a recognized property");
    const validator = shape[key]!;
    if (typeof validator === "function") validator(object[key], childLocation);
    else validateObject(object[key], validator, childLocation, requireAll);
  }
  if (requireAll) {
    for (const key of Object.keys(shape)) {
      if (!Object.hasOwn(object, key)) fail(location === "root" ? key : `${location}.${key}`, "a required property");
    }
  }
}

function merge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const baseValue = base[key];
    out[key] =
      typeof value === "object" && value !== null && !Array.isArray(value) &&
      typeof baseValue === "object" && baseValue !== null && !Array.isArray(baseValue)
        ? merge(baseValue as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  }
  return out;
}

export async function loadConfig(cwd: string): Promise<FabricConfig> {
  try {
    const raw: unknown = JSON.parse(await readFile(path.join(cwd, ".fabric-lite/config.json"), "utf8"));
    validateObject(raw, configShape, "root", false);
    const config = merge(
      defaults as unknown as Record<string, unknown>,
      raw,
    );
    validateObject(config, configShape, "root", true);
    const result = config as unknown as FabricConfig;
    if (result.permissions.read !== "allow") {
      fail("permissions.read", "allow (read is fixed allow)");
    }
    if (result.permissions.destructive !== "deny") {
      fail("permissions.destructive", "deny (destructive is fixed deny)");
    }
    result.projectRoot = path.resolve(cwd, result.projectRoot);
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {
      ...defaults,
      runner: { ...defaults.runner },
      budgets: { ...defaults.budgets },
      filesystem: { ...defaults.filesystem, allowWrite: [...defaults.filesystem.allowWrite] },
      git: { ...defaults.git },
      permissions: { ...defaults.permissions },
      shell: { ...defaults.shell, allowedCommands: [...defaults.shell.allowedCommands] },
      output: { ...defaults.output },
      projectRoot: path.resolve(cwd),
    };
  }
}