import type { ManagedSearchExecutable } from "./local-executable.js";
import type { FabricDeadline } from "../runtime/deadline.js";

export interface LocalProviderOptions { root: string; lockRoot: string; maxResultChars?: number; managedSearch?: ManagedSearchExecutable }
export interface LocalReadArguments { path: string; offset?: number; limit?: number }
export interface LocalReadWindow extends LocalReadArguments { expectedSha256?: string }
export interface LocalReadManyArguments { windows: LocalReadWindow[]; maxChars?: number }
export interface LocalSourceWindow { path: string; startLine: number; endLine: number | null; totalLines: number; sha256: string; source: string; truncated: boolean; nextOffset?: number }
export interface LocalReadManyResult { files: LocalSourceWindow[]; remaining: LocalReadWindow[]; complete: boolean }
export interface LocalGrepArguments { pattern: string; path?: string; glob?: string; literal?: boolean; ignoreCase?: boolean; hidden?: boolean; limit?: number }
export interface LocalFindArguments { pattern: string; path?: string; hidden?: boolean; limit?: number }
export interface LocalListArguments { path?: string; limit?: number }
export interface LocalWriteArguments { path: string; content: string; overwrite?: boolean }
export interface LocalEditArguments { path: string; oldText: string; newText: string; all?: boolean }
export type LocalShellInput = { command: string; script?: never; interpreter?: never; args?: never } | { script: string; interpreter?: "bash" | "sh"; args?: string[]; command?: never };
export type LocalShellArguments = LocalShellInput & { cwd?: string; timeoutMs?: number; settle?: boolean };
export interface LocalIdentity { dev: number; ino: number }
export interface LocalReadResult { path: string; text: string; totalLines: number; truncated: boolean; nextOffset?: number; sha256: string; identity: LocalIdentity }
export interface LocalSearchScope { path: string; glob?: string; hidden: boolean; ignoreFiles: true }
export interface LocalGrepResult { scope: LocalSearchScope; matches: { path: string; line: number; text: string }[]; truncated: boolean }
export interface LocalFindResult { scope: LocalSearchScope; paths: string[]; truncated: boolean }
export interface LocalListResult { entries: { path: string; type: "file" | "directory" }[]; truncated: boolean }
export interface LocalMutationResult { path: string; changed: boolean; sha256: string; bytes: number; identity: LocalIdentity }
export interface LocalShellResult { ok: boolean; exitCode: number | null; signal: string | null; stdout: string; stderr: string; truncated: boolean; stdoutTruncated: boolean; stderrTruncated: boolean }
export type LocalShellOptions = LocalShellInput & { cwd: string; timeoutMs?: number; settle?: boolean; maxOutputChars?: number; signal?: AbortSignal; deadline?: FabricDeadline };

/** No Node types or preparation metadata are exposed to the checked guest. */
export const LOCAL_GUEST_DECLARATIONS = `
type LocalIdentity = { dev: number; ino: number };
type LocalReadResult = { path: string; text: string; totalLines: number; truncated: boolean; nextOffset?: number; sha256: string; identity: LocalIdentity };
type LocalReadWindow = { path: string; offset?: number; limit?: number; expectedSha256?: string };
type LocalSourceWindow = { path: string; startLine: number; endLine: number | null; totalLines: number; sha256: string; source: string; truncated: boolean; nextOffset?: number };
type LocalReadManyResult = { files: LocalSourceWindow[]; remaining: LocalReadWindow[]; complete: boolean };
type LocalShellInput = { command: string; script?: never; interpreter?: never; args?: never } | { script: string; interpreter?: "bash" | "sh"; args?: string[]; command?: never };
type LocalSearchScope = { path: string; glob?: string; hidden: boolean; ignoreFiles: true };
type LocalGrepResult = { scope: LocalSearchScope; matches: { path: string; line: number; text: string }[]; truncated: boolean };
type LocalFindResult = { scope: LocalSearchScope; paths: string[]; truncated: boolean };
type LocalListResult = { entries: { path: string; type: "file" | "directory" }[]; truncated: boolean };
type LocalMutationResult = { path: string; changed: boolean; sha256: string; bytes: number; identity: LocalIdentity };
type LocalShellResult = { ok: boolean; exitCode: number | null; signal: string | null; stdout: string; stderr: string; truncated: boolean; stdoutTruncated: boolean; stderrTruncated: boolean };
/** Only ordinary nonzero local.shell rejections supply result. Hard failures do not. */
interface Error { readonly result?: LocalShellResult }
declare const local: {
  /** UTF-8 whole lines; 1-based, default 200/max 2000, files <=2MiB. totalLines is the whole-file count. truncated means unread suffix; nextOffset is the next line. Stop at requested end. Oversized single lines fail. */
  read(args: { path: string; offset?: number; limit?: number }): Promise<LocalReadResult>;
  /** Numbered source and hashes, bounded across 1..32 windows. Default 200/max 2000 lines per window, 16000 chars overall. Continue remaining verbatim; hash conflicts fail. complete covers requested ranges, not the repo or understanding. */
  readMany(args: { windows: LocalReadWindow[]; maxChars?: number }): Promise<LocalReadManyResult>;
  /** Requires rg. hidden:true includes dotfiles; default false. Ignore files still apply; VCS metadata/symlinks excluded. scope describes enumeration, not whole-repo completeness. Skips binary/invalid UTF-8; >2MiB skipped with truncated=true. Default 100/max 1000 matches; text <=500 chars. */
  grep(args: { pattern: string; path?: string; glob?: string; literal?: boolean; ignoreCase?: boolean; hidden?: boolean; limit?: number }): Promise<LocalGrepResult>;
  /** Recursive rg glob enumeration; hidden:true for repository reviews. Same scope/ignore/VCS/no-follow semantics as grep. */
  find(args: { pattern: string; path?: string; hidden?: boolean; limit?: number }): Promise<LocalFindResult>;
  /** Sorted direct children, including hidden entries. Only path/limit; no depth. Use find for nested files. Unsafe entries are rejected. Default 100/max 1000. */
  list(args?: { path?: string; limit?: number }): Promise<LocalListResult>;
  /** Create-only unless overwrite=true. Parent must already exist. Exact approval binds snapshots and proposed content. */
  write(args: { path: string; content: string; overwrite?: boolean }): Promise<LocalMutationResult>;
  /** Nonempty exact unique anchor unless all=true. Parent must already exist. */
  edit(args: { path: string; oldText: string; newText: string; all?: boolean }): Promise<LocalMutationResult>;
  /** Approved /bin/sh; cwd is NOT confinement. Within one exec, shell/write/edit queue FIFO before preparation. Failure stops queued effects; settle handles ordinary nonzero exits. No background jobs. */
  /** For multiline Bash use {script,interpreter:"bash",args?}: passed literally without outer shell expansion or scratch files. Default script interpreter sh. args become $1...; same approvals/queue/cleanup as command. Neither form provides network isolation. */
  shell(args: LocalShellInput & { cwd?: string; timeoutMs?: number; settle?: boolean }): Promise<LocalShellResult>;
};
`;
