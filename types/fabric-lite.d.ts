type JsonSchema = Record<string, unknown>;
interface FileReadResult { path: string; content: string; chars: number; truncated: boolean; startLine: number; endLine: number }
interface FileStat { path: string; type: "file" | "directory"; size: number; modifiedMs: number }
interface GrepMatch { path: string; line: number; text: string; before: string[]; after: string[] }
interface GrepResult { matches: GrepMatch[]; files: string[]; truncated: boolean }
interface PatchResult { path: string; applied: boolean }
interface GitStatusResult { branch: string | null; clean: boolean; entries: string[] }
interface GitDiffResult { diff: string; truncated: boolean }
interface ShellResult { command: string; exitCode: number | null; stdout: string; stderr: string; truncated: boolean; timedOut: boolean }
interface AiRunInput { instruction: string; context?: unknown; model?: string; role?: "planner" | "worker" | "verifier" | "general"; outputSchema?: JsonSchema; maxInputChars?: number; maxOutputChars?: number; timeoutMs?: number; retryInvalidJson?: boolean }
interface AiRunResult<T = unknown> { value: T | undefined; role: string; model?: string; inputChars: number; outputChars: number; repaired: boolean; error?: { code: string; message: string } }
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
 git: { status(): Promise<GitStatusResult>; changedFiles(input?: { base?: string; includeUntracked?: boolean }): Promise<string[]>; diff(input?: { base?: string; paths?: string[]; maxChars?: number }): Promise<GitDiffResult> };
 shell: { run(input: { command: string; timeoutMs?: number; maxOutputChars?: number; cwd?: string }): Promise<ShellResult> };
 ai: { run<T = unknown>(input: AiRunInput): Promise<AiRunResult<T>>; parallel<T = unknown>(input: AiParallelInput): Promise<AiRunResult<T>[]>; map<TItem, TResult = unknown>(input: AiMapInput<TItem>): Promise<AiRunResult<TResult>[]> };
 util: { chunk<T>(items: T[], size: number): T[][]; unique<T>(items: T[]): T[]; sortBy<T>(items: T[], selector: (item: T) => string | number): T[]; truncate(text: string, maxChars: number): string; compactJson(value: unknown, maxChars: number): string };
}
declare const fabric: FabricLiteApi;
declare const console: { log(...values: unknown[]): void; info(...values: unknown[]): void; warn(...values: unknown[]): void; error(...values: unknown[]): void };