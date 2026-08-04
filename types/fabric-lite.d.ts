type JsonSchema = Record<string, unknown>;
interface FileReadResult { path: string; content: string; chars: number; truncated: boolean; startLine: number; endLine: number }
interface FileStat { path: string; type: "file" | "directory"; size: number; modifiedMs: number }
interface GrepMatch { path: string; line: number; text: string; before: string[]; after: string[] }
interface GrepResult { matches: GrepMatch[]; files: string[]; truncated: boolean }
interface PatchResult { path: string; applied: boolean }
interface GitStatusResult { branch: string | null; clean: boolean; entries: string[] }
interface GitDiffResult { diff: string; truncated: boolean }
interface GitCommitResult { hash: string; branch: string | null; message: string; paths: string[] }
interface InspectionResult { tool: string; operation: string; stdout: string; stderr: string; exitCode: number | null; truncated: boolean }
interface ShellResult { command: string; exitCode: number | null; stdout: string; stderr: string; truncated: boolean; timedOut: boolean }
type PermissionPolicy = "allow" | "ask" | "deny";
interface PermissionsPolicy { read: PermissionPolicy; commit: PermissionPolicy; execute: PermissionPolicy; network: PermissionPolicy; destructive: PermissionPolicy }
interface AiRunInput { instruction: string; context?: unknown; model?: string; role?: "planner" | "worker" | "verifier" | "general"; outputSchema?: JsonSchema; maxInputChars?: number; maxOutputChars?: number; timeoutMs?: number; retryInvalidJson?: boolean }
interface AiRunResult<T = unknown> { value: T | undefined; role: string; /** @deprecated requested/legacy model */ model?: string; requestedModel?: string; resolvedModel?: string; resolutionSource: "kiro-metadata" | "runner" | "unknown"; inputChars: number; outputChars: number; repaired: boolean; error?: { code: string; message: string } }
interface AiParallelInput { tasks: AiRunInput[]; concurrency?: number; failFast?: boolean }
interface AiMapInput<T> { items: T[]; createTask: (item: T, index: number) => AiRunInput; concurrency?: number; maxItems?: number }
interface FabricLiteApi {
 fs: {
  read(input: { path: string; maxChars?: number; startLine?: number; endLine?: number }): Promise<FileReadResult>;
  readMany(input: { paths: string[]; maxFiles?: number; maxCharsPerFile?: number; maxTotalChars?: number }): Promise<FileReadResult[]>;
  glob(input: { pattern: string; cwd?: string; maxResults?: number; ignore?: string[] }): Promise<string[]>;
  grep(input: { query: string; paths?: string[]; glob?: string; maxMatches?: number; contextLines?: number }): Promise<GrepResult>;
  write(input: { path: string; content: string }): Promise<{ path: string; bytesWritten: number }>;
  patch(input: { path: string; patch: string }): Promise<PatchResult>;
  stat(input: { path: string }): Promise<FileStat>;
 };
 git: { status(): Promise<GitStatusResult>; changedFiles(input?: { base?: string; includeUntracked?: boolean }): Promise<string[]>; diff(input?: { base?: string; paths?: string[]; maxChars?: number }): Promise<GitDiffResult>; log(input?: { maxCount?: number; ref?: string }): Promise<GitDiffResult>; show(input?: { ref?: string; path?: string; maxChars?: number }): Promise<GitDiffResult>; branches(): Promise<string[]>; remotes(): Promise<string[]>; commit(input: { message: string; paths: string[] }): Promise<GitCommitResult> };
 inspect: {
  postgres(input: { query: string; host?: string; port?: number; user?: string; database?: string }): Promise<InspectionResult>;
  redis(input: { command: string; args?: string[]; host?: string; port?: number; database?: number }): Promise<InspectionResult>;
  sqlite(input: { path: string; query: string }): Promise<InspectionResult>;
  kubernetes(input: { operation: "get" | "describe" | "logs" | "explain" | "api-resources" | "api-versions"; resource?: string; name?: string; namespace?: string; context?: string; container?: string; tail?: number }): Promise<InspectionResult>;
  terraform(input: { operation: "validate" | "show" | "state-list" | "providers-schema"; cwd?: string; path?: string }): Promise<InspectionResult>;
 };
 shell: { run(input: { command: string; timeoutMs?: number; maxOutputChars?: number; cwd?: string }): Promise<ShellResult> };
 ai: { run<T = unknown>(input: AiRunInput): Promise<AiRunResult<T>>; parallel<T = unknown>(input: AiParallelInput): Promise<AiRunResult<T>[]>; map<TItem, TResult = unknown>(input: AiMapInput<TItem>): Promise<AiRunResult<TResult>[]> };
 util: { chunk<T>(items: T[], size: number): T[][]; unique<T>(items: T[]): T[]; sortBy<T>(items: T[], selector: (item: T) => string | number): T[]; truncate(text: string, maxChars: number): string; compactJson(value: unknown, maxChars: number): string };
}
declare const fabric: FabricLiteApi;
declare const console: { log(...values: unknown[]): void; info(...values: unknown[]): void; warn(...values: unknown[]): void; error(...values: unknown[]): void };