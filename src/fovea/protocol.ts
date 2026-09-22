import { fabricJsonText } from "../runtime/json-budget.js";

const FOVEA_IPC_VERSION = 1;
export const FOVEA_FRAME_CHARS = 1_000_000;
export const FOVEA_REQUEST_CHARS = 64_000;
export interface FoveaParserDescriptor { path: string; sha256: string; version: string; generationRoot?: string | undefined }
export interface FoveaEngineInitialization { parser: FoveaParserDescriptor; storageRoot: string; gitPath?: string }
export interface FoveaQuery {
  conversationId: string; conversationEpoch: number;
  rootId: string; root: string; authorizationEpoch: number;
  operation: string; args: Record<string, unknown>;
}
export type FoveaMessage =
  | { version: 1; type: "initialize"; id: string; options: FoveaEngineInitialization }
  | { version: 1; type: "query"; id: string; remainingMs: number; request: FoveaQuery }
  | { version: 1; type: "retireConversation"; id: string; conversationId: string; conversationEpoch: number }
  | { version: 1; type: "cancel"; id: string }
  | { version: 1; type: "shutdown"; id: string };
export type FoveaResponse = { version: 1; id: string; ok: true; value: Record<string, unknown> } | { version: 1; id: string; ok: false; error: string };
export const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const identifier = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{1,100}$/u.test(v);
const epoch = (v: unknown): boolean => Number.isSafeInteger(v) && Number(v) >= 0;
const keys = (v: Record<string, unknown>, names: string[]): boolean => Object.keys(v).every(k => names.includes(k));
export function encodeFrame(value: FoveaMessage | FoveaResponse): string { return fabricJsonText(value, FOVEA_FRAME_CHARS); }
export function decodeRequest(raw: unknown): FoveaMessage {
  if (typeof raw !== "string" || raw.length > FOVEA_REQUEST_CHARS) throw new Error("Fovea request frame limit");
  const v: unknown = JSON.parse(raw);
  fabricJsonText(v, FOVEA_REQUEST_CHARS);
  if (!record(v) || v.version !== FOVEA_IPC_VERSION || !identifier(v.id)) throw new Error("Fovea protocol identity mismatch");
  if ((v.type === "cancel" || v.type === "shutdown") && keys(v, ["version", "type", "id"])) return v as unknown as FoveaMessage;
  if (v.type === "retireConversation" && keys(v, ["version", "type", "id", "conversationId", "conversationEpoch"]) && identifier(v.conversationId) && epoch(v.conversationEpoch)) return v as unknown as FoveaMessage;
  if (v.type === "initialize" && keys(v, ["version", "type", "id", "options"]) && record(v.options)) {
    const o = v.options, p = o.parser;
    if (keys(o, ["parser", "storageRoot", "gitPath"]) && typeof o.storageRoot === "string" && o.storageRoot.length <= 4096 &&
        (o.gitPath === undefined || typeof o.gitPath === "string" && o.gitPath.length <= 4096) && record(p) &&
        keys(p, ["path", "sha256", "version", "generationRoot"]) && typeof p.path === "string" && p.path.length <= 4096 &&
        typeof p.sha256 === "string" && /^[a-f0-9]{64}$/u.test(p.sha256) && typeof p.version === "string" && p.version.length <= 100 &&
        (p.generationRoot === undefined || typeof p.generationRoot === "string" && p.generationRoot.length <= 4096)) return v as unknown as FoveaMessage;
  }
  if (v.type === "query" && keys(v, ["version", "type", "id", "remainingMs", "request"]) && Number.isSafeInteger(v.remainingMs) && Number(v.remainingMs) > 0 && Number(v.remainingMs) <= 900_000 && record(v.request)) {
    const q = v.request;
    if (keys(q, ["conversationId", "conversationEpoch", "rootId", "root", "authorizationEpoch", "operation", "args"]) && identifier(q.conversationId) && epoch(q.conversationEpoch) && identifier(q.rootId) && epoch(q.authorizationEpoch) && typeof q.root === "string" && q.root.length <= 4096 && identifier(q.operation) && record(q.args)) return v as unknown as FoveaMessage;
  }
  throw new Error("Invalid Fovea private request");
}
export function decodeResponse(raw: unknown): FoveaResponse {
  if (typeof raw !== "string" || raw.length > FOVEA_FRAME_CHARS) throw new Error("Fovea response frame limit");
  const v: unknown = JSON.parse(raw);
  fabricJsonText(v, FOVEA_FRAME_CHARS);
  if (!record(v) || v.version !== FOVEA_IPC_VERSION || !identifier(v.id)) throw new Error("Invalid Fovea response identity");
  if (v.ok === true && record(v.value) && keys(v, ["version", "id", "ok", "value"])) return v as unknown as FoveaResponse;
  if (v.ok === false && typeof v.error === "string" && v.error.length <= 800 && keys(v, ["version", "id", "ok", "error"])) return v as unknown as FoveaResponse;
  throw new Error("Invalid Fovea response");
}

/** Bounded projection of engine details; optional undefined members are omitted.
 * No prototypes, accessors, cycles, huge graphs or nonfinite numeric claims cross IPC. */
export function projectEngineJson(value: unknown, maxChars = FOVEA_FRAME_CHARS): Record<string, unknown> {
  let nodes = 0, chars = 0;
  const active = new Set<object>();
  function walk(v: unknown, depth: number): unknown {
    if (++nodes > 30_000 || depth > 24) throw new Error("Fovea result structural budget exceeded");
    if (typeof v === "string") { chars += v.length; if (chars > maxChars) throw new Error("Fovea result budget exceeded"); return v; }
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v !== "object" || !v || active.has(v)) throw new Error("Fovea result is not a JSON tree");
    active.add(v);
    try {
      if (Array.isArray(v)) return v.map(x => walk(x, depth + 1));
      if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new Error("Fovea result prototype rejected");
      const out: Record<string, unknown> = {};
      for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(v))) {
        if (!d.enumerable) continue;
        if (!("value" in d)) throw new Error("Fovea result accessor rejected");
        if (d.value !== undefined) out[key] = walk(d.value, depth + 1);
      }
      return out;
    } finally { active.delete(v); }
  }
  const result = walk(value, 0);
  if (!record(result)) throw new Error("Fovea result must be an object");
  fabricJsonText(result, maxChars);
  return result;
}
