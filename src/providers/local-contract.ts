import type { FabricDeadline } from "../runtime/deadline.js";

export interface LocalProviderOptions { root: string; lockRoot: string; maxResultChars?: number }
export interface LocalReadArguments { path: string; offset?: number; limit?: number }
export interface LocalGrepArguments { pattern: string; path?: string; glob?: string; literal?: boolean; ignoreCase?: boolean; limit?: number }
export interface LocalFindArguments { pattern: string; path?: string; limit?: number }
export interface LocalListArguments { path?: string; limit?: number }
export interface LocalWriteArguments { path: string; content: string; overwrite?: boolean }
export interface LocalEditArguments { path: string; oldText: string; newText: string; all?: boolean }
export interface LocalShellArguments { command: string; cwd?: string; timeoutMs?: number; settle?: boolean }
export interface LocalIdentity { dev: number; ino: number }
export interface LocalReadResult { path: string; text: string; truncated: boolean; nextOffset?: number; sha256: string; identity: LocalIdentity }
export interface LocalGrepResult { matches: { path: string; line: number; text: string }[]; truncated: boolean }
export interface LocalFindResult { paths: string[]; truncated: boolean }
export interface LocalListResult { entries: { path: string; type: "file" | "directory" }[]; truncated: boolean }
export interface LocalMutationResult { path: string; changed: boolean; sha256: string; bytes: number; identity: LocalIdentity }
export interface LocalShellResult { ok: boolean; exitCode: number | null; signal: string | null; stdout: string; stderr: string; truncated: boolean; stdoutTruncated: boolean; stderrTruncated: boolean }
export interface LocalShellOptions { command: string; cwd: string; timeoutMs?: number; settle?: boolean; maxOutputChars?: number; signal?: AbortSignal; deadline?: FabricDeadline }

/** No Node types or preparation metadata are exposed to the checked guest. */
export const LOCAL_GUEST_DECLARATIONS = `
type LocalIdentity = { dev: number; ino: number };
type LocalReadResult = { path: string; text: string; truncated: boolean; nextOffset?: number; sha256: string; identity: LocalIdentity };
type LocalGrepResult = { matches: { path: string; line: number; text: string }[]; truncated: boolean };
type LocalFindResult = { paths: string[]; truncated: boolean };
type LocalListResult = { entries: { path: string; type: "file" | "directory" }[]; truncated: boolean };
type LocalMutationResult = { path: string; changed: boolean; sha256: string; bytes: number; identity: LocalIdentity };
type LocalShellResult = { ok: boolean; exitCode: number | null; signal: string | null; stdout: string; stderr: string; truncated: boolean; stdoutTruncated: boolean; stderrTruncated: boolean };
/** Only ordinary nonzero local.shell rejections supply result. Hard failures do not. */
interface Error { readonly result?: LocalShellResult }
declare const local: {
  /** UTF-8, 1-based lines; default 200, max 2000. Files <=2MiB; oversized single lines fail. */
  read(args: { path: string; offset?: number; limit?: number }): Promise<LocalReadResult>;
  /** Requires rg. Respects ignore files; excludes hidden paths/symlinks. Skips binary/invalid UTF-8; >2MiB skipped with truncated=true. Default 100/max 1000 matches; text <=500 chars. */
  grep(args: { pattern: string; path?: string; glob?: string; literal?: boolean; ignoreCase?: boolean; limit?: number }): Promise<LocalGrepResult>;
  /** rg glob enumeration with the same ignore/hidden/no-follow semantics as grep. */
  find(args: { pattern: string; path?: string; limit?: number }): Promise<LocalFindResult>;
  /** Sorted direct children, including hidden entries. Unsafe entries are rejected. Default 100/max 1000. */
  list(args?: { path?: string; limit?: number }): Promise<LocalListResult>;
  /** Create-only unless overwrite=true. Parent must already exist. Exact approval binds snapshots and proposed content. */
  write(args: { path: string; content: string; overwrite?: boolean }): Promise<LocalMutationResult>;
  /** Nonempty exact unique anchor unless all=true. Parent must already exist. */
  edit(args: { path: string; oldText: string; newText: string; all?: boolean }): Promise<LocalMutationResult>;
  /** Approved /bin/sh execution; cwd is verified, NOT confinement. No managed background jobs. */
  shell(args: { command: string; cwd?: string; timeoutMs?: number; settle?: boolean }): Promise<LocalShellResult>;
};
`;
