import type { FabricActionDescriptor } from "../protocol.js";
import {
  KIRO_SEMANTIC_CONTEXT_MAX_ITEM_CHARS,
  KIRO_SEMANTIC_CONTEXT_MAX_ITEMS,
  KIRO_SEMANTIC_CONTEXT_MAX_OBJECTIVE_CHARS,
} from "./handoff.js";

const semanticContextSchema = {
  type: "object",
  description:
    "Bounded semantic context transferred to the Kiro ACP child before its task; this is not a native transcript handoff",
  properties: {
    objective: { type: "string", minLength: 1, maxLength: KIRO_SEMANTIC_CONTEXT_MAX_OBJECTIVE_CHARS },
    facts: {
      type: "array", maxItems: KIRO_SEMANTIC_CONTEXT_MAX_ITEMS,
      items: { type: "string", minLength: 1, maxLength: KIRO_SEMANTIC_CONTEXT_MAX_ITEM_CHARS },
    },
    relevantFiles: {
      type: "array", maxItems: KIRO_SEMANTIC_CONTEXT_MAX_ITEMS,
      items: { type: "string", minLength: 1, maxLength: KIRO_SEMANTIC_CONTEXT_MAX_ITEM_CHARS },
    },
    constraints: {
      type: "array", maxItems: KIRO_SEMANTIC_CONTEXT_MAX_ITEMS,
      items: { type: "string", minLength: 1, maxLength: KIRO_SEMANTIC_CONTEXT_MAX_ITEM_CHARS },
    },
    exclusions: {
      type: "array", maxItems: KIRO_SEMANTIC_CONTEXT_MAX_ITEMS,
      items: { type: "string", minLength: 1, maxLength: KIRO_SEMANTIC_CONTEXT_MAX_ITEM_CHARS },
    },
  },
  additionalProperties: false,
};

const runProperties = {
  task: { type: "string", description: "A self-contained task for the Kiro ACP child" },
  name: { type: "string" },
  runner: {
    type: "string",
    enum: ["kiro"],
    description: "Only `kiro` is accepted; it launches the configured `kiro-cli` binary over ACP.",
  },
  transport: { type: "string", enum: ["auto", "process"] },
  model: { type: "string", description: "Kiro v3 model ID applied through the ACP session configuration." },
  thinking: { type: "string", enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] },
  tools: { type: "array", items: { type: "string" } },
  timeoutMs: {
    type: "number",
    description: "Optional longer wall-clock limit in milliseconds. Values below the configured default are ignored.",
  },
  cwd: { type: "string", description: "Must resolve to the managed Kiro project root." },
  schema: { type: "object", description: "Optional JSON Schema for validated structured output" },
  context: semanticContextSchema,
};

const runSchema = {
  type: "object", properties: runProperties, required: ["task"], additionalProperties: false,
};

const idSchema = {
  type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false,
};

const messageSchema = {
  type: "object",
  properties: { id: { type: "string" }, message: { type: "string" }, data: {} },
  required: ["id", "message"],
  additionalProperties: false,
};

const modeSchema = {
  type: "object",
  properties: { id: { type: "string" }, mode: { type: "string", enum: ["all", "one-at-a-time"] } },
  required: ["id", "mode"],
  additionalProperties: false,
};

/** The complete action surface mounted by managed Kiro's ACP child provider. */
export const KIRO_AGENT_ACTION_DESCRIPTORS: FabricActionDescriptor[] = [
  {
    name: "run",
    description: "Run one narrowly scoped Kiro ACP child with trusted-shell verification and wait for its result; omitted models use capability routing when those models are advertised, otherwise Kiro auto",
    inputSchema: runSchema,
    risk: "agent",
  },
  {
    name: "spawn",
    description: "Start one narrowly scoped Kiro ACP child with trusted-shell verification and return its local handle immediately; fan out at most four non-overlapping tasks",
    inputSchema: runSchema,
    risk: "agent",
  },
  { name: "wait", description: "Wait for a Kiro ACP child started by this managed Kiro session", inputSchema: idSchema, risk: "read" },
  { name: "status", description: "Get the latest status of a Kiro ACP child started by this managed Kiro session", inputSchema: idSchema, risk: "read" },
  {
    name: "list",
    description: "List Kiro ACP children started by this managed Kiro session",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    risk: "read",
  },
  {
    name: "models",
    description: "List Kiro models discovered from `kiro-cli chat --v3 --list-models --format json` (cached, non-billable)",
    inputSchema: {
      type: "object",
      properties: { runner: { type: "string", enum: ["kiro"] }, refresh: { type: "boolean" } },
      additionalProperties: false,
    },
    risk: "execute",
  },
  { name: "stop", description: "Stop a Kiro ACP child started by this managed Kiro session", inputSchema: idSchema, risk: "agent" },
  { name: "cleanup", description: "Remove a completed Kiro ACP child's retained run files", inputSchema: idSchema, risk: "write" },
  { name: "steer", description: "Steer a running Kiro ACP child between turns", inputSchema: messageSchema, risk: "agent" },
  { name: "followUp", description: "Queue a follow-up turn for a running Kiro ACP child", inputSchema: messageSchema, risk: "agent" },
  { name: "setSteeringMode", description: "Set how queued steering messages are delivered to a Kiro ACP child", inputSchema: modeSchema, risk: "agent" },
  { name: "setFollowUpMode", description: "Set how queued follow-up messages are delivered to a Kiro ACP child", inputSchema: modeSchema, risk: "agent" },
  {
    name: "log",
    description: "Read a Kiro ACP child's retained Fabric event log",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Kiro ACP child run ID" },
        lines: { type: "number", minimum: 1, description: "Page line limit (default 200)" },
        before: { type: "number", minimum: 0, description: "Exclusive line cursor returned by a previous page to load older entries" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    risk: "read",
  },
];
