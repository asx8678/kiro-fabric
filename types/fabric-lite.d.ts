export type JsonSchema = Record<string, unknown>;
export interface FileReadResult {
  path: string;
  content: string;
  chars: number;
  truncated: boolean;
  startLine: number;
  endLine: number;
}
export interface FileStat {
  path: string;
  type: "file" | "directory";
  size: number;
  modifiedMs: number;
}
export interface GrepMatch {
  path: string;
  line: number;
  text: string;
  before: string[];
  after: string[];
}
/** `truncated` is true when maxMatches stops the search or any requested source cannot be fully scanned. */
export interface GrepResult {
  matches: GrepMatch[];
  files: string[];
  truncated: boolean;
  scannedFiles: string[];
  skippedFiles: string[];
}
export interface PatchResult {
  path: string;
  applied: boolean;
}
export interface GitStatusResult {
  branch: string | null;
  clean: boolean;
  entries: string[];
}
export interface GitDiffResult {
  diff: string;
  truncated: boolean;
}
export interface GitTextResult {
  text: string;
  truncated: boolean;
}
export interface GitCommitResult {
  hash: string;
  branch: string | null;
  message: string;
  paths: string[];
}
export type MutationMode = "clean" | "checkpoint";
export interface MutationCheckpoint {
  id: string;
  mode: MutationMode;
  baseHead: string;
}
export interface MutationBeginResult {
  checkpoint: MutationCheckpoint;
  guidance: string;
}
export interface MutationDiffResult {
  diff: string;
  truncated: boolean;
  createdFiles: string[];
  changedFiles: string[];
}
export interface MutationReviewVerdict {
  approved: boolean;
  issues: string[];
  summary: string;
}
export interface MutationRollbackResult {
  restored: true;
  checkpoint: string;
  removedFiles: string[];
  guidance: string;
}
export interface MutationCompleteResult {
  checkpoint: MutationCheckpoint;
  createdFiles: string[];
  rollbackGuidance: string;
}
export interface InspectionResult {
  tool: string;
  operation: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  truncated: boolean;
}
export interface ShellResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
}
export type PermissionPolicy = "allow" | "ask" | "deny";
export interface PermissionsPolicy {
  read: PermissionPolicy;
  commit: PermissionPolicy;
  execute: PermissionPolicy;
  network: PermissionPolicy;
  destructive: PermissionPolicy;
}
export interface AiRunInput {
  instruction: string;
  /** Context data. Array items with a `relevanceHint` string get it prepended as a prioritization signal; items with `stability: "stable" | "volatile"` are reordered stable-first (volatile last, relative order preserved) to maximize provider prompt-cache hits. */ context?: unknown;
  /** When true, over-budget contexts are deterministically compressed (long-line truncation, duplicate/comment extraction, middle truncation) instead of failing with BUDGET_EXCEEDED; the result then carries compressed: true. */ compressContext?: boolean;
  /** Optional single-line call label (max 120 chars) echoed on the result and on parallel error entries for per-call observability. */ label?: string;
  model?: string;
  role?: "planner" | "worker" | "verifier" | "general";
  outputSchema?: JsonSchema;
  maxInputChars?: number;
  maxOutputChars?: number;
  /** Per-call wall-clock override. Like pi-fabric, the configured aiCallTimeoutMs is a floor: lower values are ignored, higher values extend the call. */ timeoutMs?: number;
  retryInvalidJson?: boolean;
}
export interface AiRunResult<T = unknown> {
  value: T | undefined;
  role: string;
  /** @deprecated requested/legacy model */ model?: string;
  requestedModel?: string;
  resolvedModel?: string;
  resolutionSource: "kiro-metadata" | "runner" | "unknown";
  inputChars: number;
  outputChars: number;
  repaired: boolean;
  /** How a malformed result was repaired: deterministic (schema-guided rules, no LLM call) or llm (paid repair retry). Present only when repaired is true. */ repairPath?:
    "deterministic" | "llm";
  /** Deterministic repair rules that fired (e.g. dropNullOptional(paths), salvageJson), when any. */ repairs?: string[];
  /** Echo of the optional request label for per-call observability. */ label?: string;
  /** True when the context exceeded the budget and was deterministically compressed (compressContext opt-in). */ compressed?: boolean;
  cached?: boolean;
  error?: { code: string; message: string; failedIndex?: number };
}
export interface AiParallelInput {
  tasks: AiRunInput[];
  concurrency?: number;
  failFast?: boolean;
}
export interface AiMapInput<T> {
  items: T[];
  createTask: (item: T, index: number) => AiRunInput;
  concurrency?: number;
  maxItems?: number;
}
export interface Metrics {
  aiCalls: number;
  workerCalls: number;
  retries: number;
  inputChars: number;
  outputChars: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheHits: number;
}
export interface ContextSymbol {
  name: string;
  kind: string;
  line: number;
  signature: string;
}
export interface ContextSketchInput {
  maxChars?: number;
  includeTests?: boolean;
}
export interface ContextSketchResult {
  repoHash: string;
  filesScanned: number;
  totalFiles: number;
  testFiles: number;
  truncated: boolean;
  outline: string;
}
export interface ContextFocusInput {
  query: string;
  maxChars?: number;
  maxFiles?: number;
}
export interface ContextFocusResult {
  repoHash: string;
  query: string;
  filesScanned: number;
  truncated: boolean;
  files: Array<{
    path: string;
    score: number;
    hash: string;
    symbols: ContextSymbol[];
    imports: string[];
    suggestedReads: Array<{ path: string; startLine: number; endLine: number }>;
  }>;
}
export interface ContextImpactInput {
  path?: string;
  symbol?: string;
  transitive?: boolean;
  maxResults?: number;
}
export interface ContextImpactResult {
  repoHash: string;
  target: { path?: string; symbol?: string };
  direct: string[];
  transitive: string[];
  truncated: boolean;
}
export interface FabricLiteApi {
  fs: {
    read(
      input:
        | string
        | {
            path: string;
            maxChars?: number;
            startLine?: number;
            endLine?: number;
            offset?: number;
            limit?: number;
            start?: number;
            max?: number;
          }
        | {
            file: string;
            maxChars?: number;
            startLine?: number;
            endLine?: number;
            offset?: number;
            limit?: number;
            start?: number;
            max?: number;
          },
    ): Promise<FileReadResult>;
    readMany(input: {
      paths: string[];
      maxFiles?: number;
      maxCharsPerFile?: number;
      maxTotalChars?: number;
    }): Promise<FileReadResult[]>;
    glob(
      input:
        | string
        | {
            pattern: string;
            cwd?: string;
            maxResults?: number;
            ignore?: string[];
            path?: string;
            limit?: number;
            max?: number;
          }
        | {
            query: string;
            cwd?: string;
            maxResults?: number;
            path?: string;
            limit?: number;
            max?: number;
          }
        | {
            search: string;
            cwd?: string;
            maxResults?: number;
            path?: string;
            limit?: number;
            max?: number;
          }
        | {
            regex: string;
            cwd?: string;
            maxResults?: number;
            path?: string;
            limit?: number;
            max?: number;
          },
    ): Promise<string[]>;
    glob(pattern: string, cwd?: string, maxResults?: number): Promise<string[]>;
    grep(
      input:
        | string
        | {
            query: string;
            paths?: string[];
            path?: string;
            glob?: string;
            globPattern?: string;
            maxMatches?: number;
            limit?: number;
            max?: number;
            contextLines?: number;
            context?: number;
            ctx?: number;
            ignoreCase?: boolean;
            ic?: boolean;
            caseInsensitive?: boolean;
            literal?: boolean;
          }
        | {
            pattern: string;
            paths?: string[];
            path?: string;
            glob?: string;
            globPattern?: string;
            maxMatches?: number;
            limit?: number;
            max?: number;
            contextLines?: number;
            context?: number;
            ctx?: number;
            ignoreCase?: boolean;
            ic?: boolean;
            caseInsensitive?: boolean;
            literal?: boolean;
          }
        | {
            regex: string;
            paths?: string[];
            path?: string;
            glob?: string;
            globPattern?: string;
            maxMatches?: number;
            limit?: number;
            max?: number;
            contextLines?: number;
            context?: number;
            ctx?: number;
            ignoreCase?: boolean;
            ic?: boolean;
            caseInsensitive?: boolean;
            literal?: boolean;
          }
        | {
            search: string;
            paths?: string[];
            path?: string;
            glob?: string;
            globPattern?: string;
            maxMatches?: number;
            limit?: number;
            max?: number;
            contextLines?: number;
            context?: number;
            ctx?: number;
            ignoreCase?: boolean;
            ic?: boolean;
            caseInsensitive?: boolean;
            literal?: boolean;
          },
    ): Promise<GrepResult>;
    grep(query: string, path?: string, maxMatches?: number): Promise<GrepResult>;
    write(
      input:
        | { path: string; content: string }
        | { file: string; content: string }
        | { path: string; contents: string }
        | { path: string; body: string }
        | { path: string; text: string },
    ): Promise<{ path: string; bytesWritten: number }>;
    write(path: string, content: string): Promise<{ path: string; bytesWritten: number }>;
    patch(input: { path: string; patch: string }): Promise<PatchResult>;
    patch(path: string, patch: string): Promise<PatchResult>;
    stat(input: string | { path: string }): Promise<FileStat>;
  };
  git: {
    status(): Promise<GitStatusResult>;
    changedFiles(input?: { base?: string; includeUntracked?: boolean }): Promise<string[]>;
    diff(input?: { base?: string; paths?: string[]; maxChars?: number }): Promise<GitDiffResult>;
    log(input?: { maxCount?: number; ref?: string }): Promise<GitTextResult>;
    show(input?: { ref?: string; path?: string; maxChars?: number }): Promise<GitTextResult>;
    branches(): Promise<string[]>;
    remotes(): Promise<string[]>;
    commit(input: { message: string; paths: string[] }): Promise<GitCommitResult>;
  };
  mutate: {
    begin(input?: { mode?: MutationMode; label?: string }): Promise<MutationBeginResult>;
    diff(input?: { maxChars?: number }): Promise<MutationDiffResult>;
    review(input?: { instruction?: string }): Promise<AiRunResult<MutationReviewVerdict>>;
    rollback(): Promise<MutationRollbackResult>;
    complete(): Promise<MutationCompleteResult>;
  };
  inspect: {
    postgres(input: {
      query: string;
      host?: string;
      port?: number;
      user?: string;
      database?: string;
    }): Promise<InspectionResult>;
    redis(input: {
      command: string;
      args?: string[];
      host?: string;
      port?: number;
      database?: number;
    }): Promise<InspectionResult>;
    sqlite(input: { path: string; query: string }): Promise<InspectionResult>;
    kubernetes(input: {
      operation: "get" | "describe" | "logs" | "explain" | "api-resources" | "api-versions";
      resource?: string;
      name?: string;
      namespace?: string;
      context?: string;
      container?: string;
      tail?: number;
    }): Promise<InspectionResult>;
    terraform(input: {
      operation: "validate" | "show" | "state-list" | "providers-schema";
      cwd?: string;
      path?: string;
    }): Promise<InspectionResult>;
  };
  shell: {
    run(
      input:
        | string
        | {
            command: string;
            timeoutMs?: number;
            timeout?: number;
            maxOutputChars?: number;
            cwd?: string;
          }
        | {
            cmd: string;
            timeoutMs?: number;
            timeout?: number;
            maxOutputChars?: number;
            cwd?: string;
          },
    ): Promise<ShellResult>;
  };
  ai: {
    run<T = unknown>(input: AiRunInput): Promise<AiRunResult<T>>;
    parallel<T = unknown>(input: AiParallelInput): Promise<AiRunResult<T>[]>;
    map<TItem, TResult = unknown>(input: AiMapInput<TItem>): Promise<AiRunResult<TResult>[]>;
  };
  /** Deterministic, token-budgeted repo mapping for context selection; no AI budget is consumed. Results carry content hashes (per-file hash, repoHash) that change exactly when code changes, making them safe to embed in AI-call contexts. One repo scan is shared per run. */
  context: {
    /** Production-first repo silhouette: files with exported symbols; test/fixture files are collapsed to a count unless includeTests. Degrades deterministically (signatures → names → files-only) to fit maxChars. */
    sketch(input?: ContextSketchInput): Promise<ContextSketchResult>;
    /** Sharp detail near a query: ranked files with matching symbols (line + signature), their imports, and suggested fs.read ranges. */
    focus(input: ContextFocusInput): Promise<ContextFocusResult>;
    /** Blast radius of a file (reverse imports) or symbol (word-boundary references); transitive adds one import-graph hop. */
    impact(input: ContextImpactInput): Promise<ContextImpactResult>;
  };
  /** Named payloads delivered out-of-band via --payloads <file.json>; large text belongs here, not in the checked program body. */ payloads: Record<
    string,
    string
  >;
  util: {
    chunk<T>(items: T[], size: number): T[][];
    unique<T>(items: T[]): T[];
    sortBy<T>(items: T[], selector: (item: T) => string | number): T[];
    truncate(text: string, maxChars: number): string;
    compactJson(value: unknown, maxChars: number): string;
    /** Deterministic context compression to maxChars (same extraction pipeline as ai.run compressContext). */ compressText(
      text: string,
      maxChars: number,
    ): string;
    /** Serialize a JSON-safe value as YAML — a token-cheaper encoding than JSON for AI-call contexts and structured results. */ toYaml(
      value: unknown,
      maxChars?: number,
    ): string;
  };
}

/** The worker's implementation is checked against this published contract in src/api.ts. */
declare global {
  const fabric: FabricLiteApi;
  const console: {
    log(...values: unknown[]): void;
    info(...values: unknown[]): void;
    warn(...values: unknown[]): void;
    error(...values: unknown[]): void;
  };
}
