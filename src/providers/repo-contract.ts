import type { FabricActionDescriptor } from "../protocol.js";
/** Native navigation coverage, not a completeness receipt. The engine's recursive
 * transport budget may omit ANY field (including nested fields/array members).
 * Missing counts are unknown, never zero; consult detailsTruncated/detailsOmitted.
 * `source` is snapshot coverage: engine.ts overwrites discovery's git/walk label.
 */
export type RepoSourceCoverageReason = "depthCap" | "entryCap" | "unreadableDirectories" | "untrustedProjectRules" | "excluded" | "unavailableOrSymlink" | "closedBoundaries" | "notRegular" | "hardlinks" | "unsupported" | "oversized" | "raced" | "byteCap" | "generated";
export type RepoSourceCoverage = {
  sourceFiles?: number; sourceBytes?: number; entriesVisited?: number; capped?: boolean;
  maxFiles?: number; maxFileBytes?: number; maxBytes?: number;
  counts?: { [K in RepoSourceCoverageReason]?: number };
  examples?: { [K in RepoSourceCoverageReason]?: string[] };
  projectRules?: "host-approved-hash" | "untrusted-skipped"; trustedRulesSha256?: string;
  reusedPreviousSnapshot?: boolean;
}
export type RepoImportCoverageExample = {
  file?: string; line?: number; spec?: string;
  status?: "possible" | "unresolved" | "capped"; reason?: string;
}
export type RepoImportCoverage = {
  sites?: number; resolved?: number; possible?: number; unresolved?: number; capped?: number;
  unsupportedLanguages?: string[]; examples?: RepoImportCoverageExample[]; examplesOmitted?: number;
}
export type RepoCoverage = {
  source?: RepoSourceCoverage;
  recording?: "complete" | "partial" | "truncated";
  maxFiles?: number; candidateFilesSeen?: number; supportedFilesSeen?: number; indexedFiles?: number;
  unsupportedFilesSeen?: number; excludedEntriesSeen?: number; closedBoundariesSeen?: number;
  unreadableDirectoriesSeen?: number; unavailableFilesSeen?: number; capped?: boolean;
  /** null is the native unknown omission count, not an exact zero. */
  omittedSupported?: number | null;
  unsupportedExamples?: string[]; excludedExamples?: string[]; closedBoundaries?: string[];
  unreadableDirectories?: string[]; unavailableFiles?: string[]; excludedPolicies?: string[];
  extractedFiles?: number; partialFiles?: string[]; unreadableFiles?: string[];
  oversizedFiles?: string[]; generatedFiles?: string[];
  imports?: RepoImportCoverage; gitFailures?: string[];
  detailsTruncated?: true; detailsOmitted?: number;
}
export interface RepoReadWindow { path: string; offset: number; limit: number; expectedSha256?: string }
export interface RepoNavigationPacket {
  schemaVersion: 1; status: "ok" | "no-match"; advisory: true; resultId: string; rootId: string;
  sourceSnapshotId: string; graphGeneration: string; text: string; estimatedTokens: number;
  coverage: RepoCoverage; reads: RepoReadWindow[]; truncated: boolean;
  focusId?: string; focusRevision?: number;
}
const string = (maxLength = 512): Record<string, unknown> => ({ type: "string", minLength: 1, maxLength });
const integer = (minimum: number, maximum: number): Record<string, unknown> => ({ type: "integer", minimum, maximum });
const boolean = (): Record<string, unknown> => ({ type: "boolean" });
const choices = (values: string[]): Record<string, unknown> => ({ type: "string", enum: values });
const object = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({ type: "object", properties, required, additionalProperties: false });
const array = (items: Record<string, unknown>, maxItems: number): Record<string, unknown> => ({ type: "array", items, maxItems });
const base = (): Record<string, Record<string, unknown>> => ({ rootId: string(100) });
const budget = (): Record<string, unknown> => integer(256, 16000);
const focus = (): Record<string, Record<string, unknown>> => ({ ...base(), query: string(1000), path: string(), language: string(80), kind: choices(["function", "method", "class", "interface", "type", "field", "decl", "file", "anchor"]), fresh: boolean(), maxTokens: budget(), focusId: string(100) });
const readWindow = (): Record<string, unknown> => object({ path: string(4096), offset: integer(1, 2_000_000), limit: integer(1, 2000), expectedSha256: { type: "string", minLength: 64, maxLength: 64 } }, ["path", "offset", "limit"]);
// Keep every object closed and every collection/scalar bounded. Do not use
// combinators: Fabric's local runtime validator deliberately delegates them.
// No fields are required: boundResultDetails can stop within any nested object.
const coverageCount = (): Record<string, unknown> => integer(0, Number.MAX_SAFE_INTEGER);
const coverageText = (maxLength = 100_000): Record<string, unknown> => ({ type: "string", maxLength });
const coverageTexts = (maxItems = 1000): Record<string, unknown> => array(coverageText(), maxItems);
const sourceReasons: RepoSourceCoverageReason[] = ["depthCap", "entryCap", "unreadableDirectories", "untrustedProjectRules", "excluded", "unavailableOrSymlink", "closedBoundaries", "notRegular", "hardlinks", "unsupported", "oversized", "raced", "byteCap", "generated"];
export const REPO_COVERAGE_SCHEMA = object({
  source: object({
    sourceFiles: coverageCount(), sourceBytes: coverageCount(), entriesVisited: coverageCount(), capped: boolean(),
    maxFiles: coverageCount(), maxFileBytes: coverageCount(), maxBytes: coverageCount(),
    counts: object(Object.fromEntries(sourceReasons.map(reason => [reason, coverageCount()]))),
    examples: object(Object.fromEntries(sourceReasons.map(reason => [reason, coverageTexts(20)]))),
    projectRules: choices(["host-approved-hash", "untrusted-skipped"]),
    trustedRulesSha256: { type: "string", minLength: 64, maxLength: 64 },
    reusedPreviousSnapshot: boolean(),
  }),
  recording: choices(["complete", "partial", "truncated"]),
  maxFiles: coverageCount(), candidateFilesSeen: coverageCount(), supportedFilesSeen: coverageCount(), indexedFiles: coverageCount(),
  unsupportedFilesSeen: coverageCount(), excludedEntriesSeen: coverageCount(), closedBoundariesSeen: coverageCount(),
  unreadableDirectoriesSeen: coverageCount(), unavailableFilesSeen: coverageCount(), capped: boolean(),
  omittedSupported: { type: ["integer", "null"], minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  unsupportedExamples: coverageTexts(20), excludedExamples: coverageTexts(20), closedBoundaries: coverageTexts(20),
  unreadableDirectories: coverageTexts(20), unavailableFiles: coverageTexts(20), excludedPolicies: coverageTexts(),
  extractedFiles: coverageCount(), partialFiles: coverageTexts(20), unreadableFiles: coverageTexts(),
  oversizedFiles: coverageTexts(), generatedFiles: coverageTexts(),
  imports: object({
    sites: coverageCount(), resolved: coverageCount(), possible: coverageCount(), unresolved: coverageCount(), capped: coverageCount(),
    unsupportedLanguages: coverageTexts(), examplesOmitted: coverageCount(),
    examples: array(object({ file: coverageText(), line: coverageCount(), spec: coverageText(160),
      status: choices(["possible", "unresolved", "capped"]), reason: coverageText() }), 20),
  }),
  gitFailures: coverageTexts(10), detailsTruncated: { type: "boolean", const: true },
  detailsOmitted: integer(1, Number.MAX_SAFE_INTEGER),
});
export const REPO_NAVIGATION_SCHEMA = object({
  schemaVersion: { type: "integer", const: 1 }, status: choices(["ok", "no-match"]), advisory: { type: "boolean", const: true }, resultId: string(100), rootId: string(100), sourceSnapshotId: string(200), graphGeneration: string(200), text: { type: "string", maxLength: 100_000 }, estimatedTokens: integer(0, 50_000), coverage: structuredClone(REPO_COVERAGE_SCHEMA), reads: array(readWindow(), 1024), truncated: boolean(), focusId: string(100), focusRevision: integer(0, Number.MAX_SAFE_INTEGER),
}, ["schemaVersion", "status", "advisory", "resultId", "rootId", "sourceSnapshotId", "graphGeneration", "text", "estimatedTokens", "coverage", "reads", "truncated"]);
const descriptor = (name: string, description: string, inputSchema: Record<string, unknown>, mutation = false, navigation = false): FabricActionDescriptor => ({ name, description, inputSchema, ...(navigation ? { outputSchema: structuredClone(REPO_NAVIGATION_SCHEMA) } : {}), risk: mutation ? "write" : "read", effect: { kind: mutation ? "write" : "read" }, annotations: { readOnlyHint: !mutation, idempotentHint: !["focus", "dwell", "reset", "configure", "reload"].includes(name), openWorldHint: false } });
export const REPO_ACTION_DESCRIPTORS: FabricActionDescriptor[] = [
  descriptor("status", "Cheap Fovea health/identity/capability status. Does not index. Graph evidence is advisory, never a source receipt or correctness verdict.", object(base())),
  descriptor("sketch", "Production-first architecture silhouette with extraction coverage. Whole authorized root analysis; filters never grant extra roots.", object({ ...base(), maxTokens: budget() }), false, true),
  descriptor("focus", "Graph navigation by symbol, approximate identifier, path, route, literal or protocol ID. fresh resets disclosure. Exact reads require local.readMany with returned SHA-256 windows.", object(focus(), ["query"]), false, true),
  descriptor("augment", "Transient graph hint for grep/sync; never advances an explicit focus. No-match or backend failure must preserve native matches.", object({ ...base(), query: string(1000), path: string(), maxTokens: budget() }, ["query"]), false, true),
  descriptor("dwell", "Widen a stored focus semantically. Not result pagination; stale graph-bound state expires safely.", object({ ...base(), focusId: string(100), factor: { type: "number", minimum: 1.2, maximum: 64 }, maxTokens: budget() }), false, true),
  descriptor("impact", "Advisory hunk-aware impact from files, symbols, uncommitted changes or PR base; co-change suggestions are not required edits.", object({ ...base(), files: array(string(), 256), symbols: array(string(), 256), includeUncommitted: boolean(), base: string(256), maxTokens: budget() }), false, true),
  descriptor("result", "Replay a page of an immutable retained result. Repeating a cursor is safe. No fresh source/graph query.", object({ ...base(), resultId: string(100), cursor: string(100), maxChars: integer(256, 32000) }, ["resultId"])),
  descriptor("searchResult", "Literal search within one retained serialized result, not the repository or a semantic widening.", object({ ...base(), resultId: string(100), query: string(256), limit: integer(1, 32) }, ["resultId", "query"])),
  descriptor("anchors", "Bounded feature anchor inventory with rule/source evidence and uncertainty.", object({ ...base(), offset: integer(0, 1_000_000), limit: integer(1, 100) })),
  descriptor("rules", "Inspect built-in rules and discovered hypotheses; inspection does not adopt repository rules.", object({ ...base(), offset: integer(0, 1_000_000), limit: integer(1, 100) })),
  descriptor("adoptRules", "Approve session trust for an existing .fovea/rules.json at the exact local.read SHA-256. Publish declarations first using normal local.write. This grants no executable or extra-root authority.", object({ ...base(), expectedSha256: string(64) }, ["expectedSha256"]), true),
  descriptor("settings", "Inspect separate fovea.v1 configuration, revisions and settingSupport. sync.ackClean is stored but ineffective: native clean notifications are unsupported.", object(base())),
  descriptor("configure", "Approved session/project/global Fovea settings update. Use settings.revision for session, revisions.project/global for persistent layers; strict versioned config, no executable or extra-root authority. Returns settingSupport; stored sync.ackClean does not enable native notifications.", object({ ...base(), scope: choices(["session", "project", "global"]), expectedRevision: string(64), config: { type: "object" } }, ["scope", "expectedRevision", "config"]), true),
  descriptor("reset", "Reset this conversation/root navigation and retained results, not the host lifetime or source files.", object(base()), true),
  descriptor("reload", "Reload configuration and restart the same-generation engine. New code requires product update and a new session.", object(base()), true),
  descriptor("sync", "Explicit authorized reconciliation; returns prepared context, never claims it was delivered. No automatic agent restart.", object(base())),
];
export const REPO_GUEST_DECLARATIONS = `
/** Native navigation coverage, not a completeness receipt. The engine's recursive
 * transport budget may omit ANY field (including nested fields/array members).
 * Missing counts are unknown, never zero; consult detailsTruncated/detailsOmitted.
 * source is snapshot coverage: engine.ts overwrites discovery's git/walk label.
 */
type RepoSourceCoverageReason = "depthCap" | "entryCap" | "unreadableDirectories" | "untrustedProjectRules" | "excluded" | "unavailableOrSymlink" | "closedBoundaries" | "notRegular" | "hardlinks" | "unsupported" | "oversized" | "raced" | "byteCap" | "generated";
type RepoSourceCoverage = {
  sourceFiles?: number; sourceBytes?: number; entriesVisited?: number; capped?: boolean;
  maxFiles?: number; maxFileBytes?: number; maxBytes?: number;
  counts?: { [K in RepoSourceCoverageReason]?: number };
  examples?: { [K in RepoSourceCoverageReason]?: string[] };
  projectRules?: "host-approved-hash" | "untrusted-skipped"; trustedRulesSha256?: string;
  reusedPreviousSnapshot?: boolean;
}
type RepoImportCoverageExample = {
  file?: string; line?: number; spec?: string;
  status?: "possible" | "unresolved" | "capped"; reason?: string;
}
type RepoImportCoverage = {
  sites?: number; resolved?: number; possible?: number; unresolved?: number; capped?: number;
  unsupportedLanguages?: string[]; examples?: RepoImportCoverageExample[]; examplesOmitted?: number;
}
type RepoCoverage = {
  source?: RepoSourceCoverage;
  recording?: "complete" | "partial" | "truncated";
  maxFiles?: number; candidateFilesSeen?: number; supportedFilesSeen?: number; indexedFiles?: number;
  unsupportedFilesSeen?: number; excludedEntriesSeen?: number; closedBoundariesSeen?: number;
  unreadableDirectoriesSeen?: number; unavailableFilesSeen?: number; capped?: boolean;
  /** null is the native unknown omission count, not an exact zero. */
  omittedSupported?: number | null;
  unsupportedExamples?: string[]; excludedExamples?: string[]; closedBoundaries?: string[];
  unreadableDirectories?: string[]; unavailableFiles?: string[]; excludedPolicies?: string[];
  extractedFiles?: number; partialFiles?: string[]; unreadableFiles?: string[];
  oversizedFiles?: string[]; generatedFiles?: string[];
  imports?: RepoImportCoverage; gitFailures?: string[];
  detailsTruncated?: true; detailsOmitted?: number;
}
type RepoReadWindow = { path: string; offset: number; limit: number; expectedSha256?: string };
type RepoNavigationPacket = { schemaVersion: 1; status: "ok" | "no-match"; advisory: true; resultId: string; rootId: string; sourceSnapshotId: string; graphGeneration: string; text: string; estimatedTokens: number; coverage: RepoCoverage; reads: RepoReadWindow[]; truncated: boolean; focusId?: string; focusRevision?: number };
type RepoFocusArguments = { query: string; rootId?: string; path?: string; language?: string; kind?: "function" | "method" | "class" | "interface" | "type" | "field" | "decl" | "file" | "anchor"; fresh?: boolean; maxTokens?: number; focusId?: string };
type RepoConfig = { schemaVersion: 1; sync: { mode: "enabled" | "hidden" | "disabled"; scope: "session" | "repository"; budget: number; ackClean: boolean; steerThreshold: number; pushFocus: boolean }; tools: { defaultBudget: number; grepMode: "off" | "augment" | "replace"; grepAugmentBudget: number } };
type RepoSettings = { config: RepoConfig; revision: string; revisions: {global: string; project: string; session?: string}; scope: "session" | "project" | "global" | "defaults"; settingSupport: {"sync.ackClean": {supported: false; requested: boolean; effective: false; reason: string}} };
declare const repo: {
 status(args?: {rootId?: string}): Promise<JsonObject>;
 sketch(args?: {rootId?: string; maxTokens?: number}): Promise<RepoNavigationPacket>;
 focus(args: RepoFocusArguments): Promise<RepoNavigationPacket>;
 augment(args: {query:string; path?:string; rootId?:string; maxTokens?:number}): Promise<RepoNavigationPacket>;
 /** Explicit hybrid facade; local.grep itself is unchanged. Uses settings off/augment/replace, transient hints and native fallback. */
 grep(args: {pattern:string; path?:string; glob?:string; literal?:boolean; ignoreCase?:boolean; hidden?:boolean; limit?:number; paginate?:boolean; snapshotScope?:"query-v1"; cursor?:string}): Promise<{native: LocalGrepResult | null; advisory: RepoNavigationPacket | null; replacement: boolean; diagnostic?: string}>;
 dwell(args?: {rootId?: string; focusId?: string; factor?: number; maxTokens?: number}): Promise<RepoNavigationPacket>;
 impact(args?: {rootId?: string; files?: string[]; symbols?: string[]; base?: string; includeUncommitted?: boolean; maxTokens?: number}): Promise<RepoNavigationPacket>;
 result(args: {rootId?: string; resultId: string; cursor?: string; maxChars?: number}): Promise<{schemaVersion: 1; advisory: true; resultId: string; encoding: "json"; text: string; offset: number; totalChars: number; done: boolean; nextCursor?: string}>;
 searchResult(args: {rootId?: string; resultId: string; query: string; limit?: number}): Promise<JsonObject>;
 anchors(args?: {rootId?: string; offset?: number; limit?: number}): Promise<JsonObject>;
 rules(args?: {rootId?: string; offset?: number; limit?: number}): Promise<JsonObject>;
 adoptRules(args: {rootId?: string; expectedSha256: string}): Promise<JsonObject>;
 settings(args?: {rootId?: string}): Promise<RepoSettings>;
 configure(args: {rootId?: string; scope: "session" | "project" | "global"; expectedRevision: string; config: RepoConfig}): Promise<RepoSettings>;
 reset(args?: {rootId?: string}): Promise<JsonObject>;
 reload(args?: {rootId?: string}): Promise<JsonObject>;
 sync(args?: {rootId?: string}): Promise<JsonObject>;
 /** One ordinary registry focus + one local.readMany batch, never an authority bypass. Hash mismatch remains a failure; refresh/re-resolve, do not drop hashes. complete is requested windows only. */
 focusRead(args: RepoFocusArguments & {maxWindows?: number; maxChars?: number; partial?: boolean}): Promise<{navigation: RepoNavigationPacket; sources: LocalReadManyResult | null; deferredReads: RepoReadWindow[]}>;
};
`;
