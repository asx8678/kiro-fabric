import type { ManagedSearchExecutable } from "./local-executable.js";
import type { FabricDeadline } from "../runtime/deadline.js";

export interface LocalProviderOptions {
  root: string;
  lockRoot: string;
  maxResultChars?: number;
  /** Optional visible-output allowance for source batches; other local limits stay unchanged. */
  maxReadManyChars?: number;
  managedSearch?: ManagedSearchExecutable;
}
export interface LocalReadArguments { path: string; offset?: number; limit?: number }
export interface LocalReadWindow extends LocalReadArguments { expectedSha256?: string }
export interface LocalReadManyArguments { windows: LocalReadWindow[]; maxChars?: number; partial?: boolean }
export type LocalReadEvidenceArguments = LocalReadManyArguments;
/** Versioned text packet, not an inspection receipt. Budget includes JSON string escaping. */
export type LocalReadEvidenceResult = string;
export interface LocalEvidenceMetadata {
  scope: "requested windows only; not proof of inspection";
  /** UTF-16 offsets/lengths into the decoded packet; source is numbered text, not raw bytes. */
  files: (Omit<LocalSourceWindow, "source"> & { sourceOffset: number; sourceChars: number })[];
  remaining: LocalReadWindow[];
  complete: boolean;
  unreadTails: LocalReadWindow[];
  failures: NonNullable<LocalReadManyResult["failures"]>;
}
export interface LocalSourceWindow { path: string; startLine: number; endLine: number | null; totalLines: number; sha256: string; source: string; truncated: boolean; nextOffset?: number }
export interface LocalReadManyResult { files: LocalSourceWindow[]; remaining: LocalReadWindow[]; complete: boolean; unreadTails: LocalReadWindow[]; failures?: { index: number; path: string; code: "read" | "stale-hash"; message: string }[] }
export interface LocalGrepArguments { pattern: string; path?: string; glob?: string; literal?: boolean; ignoreCase?: boolean; hidden?: boolean; limit?: number; paginate?: boolean; snapshotScope?: "query-v1"; cursor?: string }
export interface LocalFindArguments { pattern: string; path?: string; hidden?: boolean; limit?: number; paginate?: boolean; snapshotScope?: "query-v1"; cursor?: string }
export interface LocalListArguments { path?: string; limit?: number }
export interface LocalWriteArguments { path: string; content: string; overwrite?: boolean; expectedSha256?: string }
export type LocalEditArguments = { path: string; expectedSha256: string } & ({ oldText: string; newText: string; all?: boolean; edits?: never } | { edits: { oldText: string; newText: string; all?: boolean }[]; oldText?: never; newText?: never; all?: never });
export type LocalShellInput = { command: string; script?: never; interpreter?: never; args?: never } | { script: string; interpreter?: "bash" | "sh"; args?: string[]; command?: never };
export type LocalShellArguments = LocalShellInput & { cwd?: string; timeoutMs?: number; settle?: boolean };
export interface LocalIdentity { dev: number; ino: number }
export interface LocalReadResult { path: string; text: string; totalLines: number; truncated: boolean; nextOffset?: number; sha256: string; identity: LocalIdentity; /** Requested range fully delivered, even when the file continues. */ requestedRangeDelivered: boolean; /** No unread file suffix remains (explicit inverse of truncated). */ fileExhausted: boolean }
export interface LocalSearchScope { path: string; glob?: string; hidden: boolean; ignoreFiles: true; snapshotScope?: "query-v1" }
export interface LocalGrepResult { scope: LocalSearchScope; matches: { path: string; line: number; text: string }[]; truncated: boolean; /** Conservative inverse of truncated in the recorded scope; false also covers clipped text or skipped files, not just more pages. */ scopeExhausted: boolean; nextCursor?: string; truncationReasons?: ("match-text" | "count" | "output" | "oversized-files")[] }
export interface LocalFindResult { scope: LocalSearchScope; paths: string[]; truncated: boolean; /** Conservative inverse of truncated in the recorded scope; false also covers clipped text or skipped files, not just more pages. */ scopeExhausted: boolean; nextCursor?: string; truncationReasons?: ("match-text" | "count" | "output" | "oversized-files")[] }
export interface LocalListResult { entries: { path: string; type: "file" | "directory" }[]; truncated: boolean }
export interface LocalMutationResult { path: string; changed: boolean; sha256: string; bytes: number; identity: LocalIdentity }
export interface LocalShellResult { ok: boolean; exitCode: number | null; signal: string | null; stdout: string; stderr: string; truncated: boolean; stdoutTruncated: boolean; stderrTruncated: boolean }
export type LocalShellOptions = LocalShellInput & { cwd: string; timeoutMs?: number; settle?: boolean; maxOutputChars?: number; signal?: AbortSignal; deadline?: FabricDeadline };

/** No Node types or preparation metadata are exposed to the checked guest. */
export const LOCAL_GUEST_DECLARATIONS = `
type LocalIdentity = { dev: number; ino: number };
type LocalReadResult = { path: string; text: string; totalLines: number; truncated: boolean; nextOffset?: number; sha256: string; identity: LocalIdentity; requestedRangeDelivered: boolean; fileExhausted: boolean };
type LocalReadWindow = { path: string; offset?: number; limit?: number; expectedSha256?: string };
type LocalSourceWindow = { path: string; startLine: number; endLine: number | null; totalLines: number; sha256: string; source: string; truncated: boolean; nextOffset?: number };
type LocalReadManyResult = { files: LocalSourceWindow[]; remaining: LocalReadWindow[]; complete: boolean; unreadTails: LocalReadWindow[]; failures?: { index: number; path: string; code: "read" | "stale-hash"; message: string }[] };
type LocalReadEvidenceArguments = { windows: LocalReadWindow[]; maxChars?: number; partial?: boolean };
type LocalReadEvidenceResult = string;
type LocalEvidenceMetadata = {
  scope: "requested windows only; not proof of inspection";
  files: (Omit<LocalSourceWindow, "source"> & { sourceOffset: number; sourceChars: number })[];
  remaining: LocalReadWindow[]; complete: boolean; unreadTails: LocalReadWindow[];
  failures: NonNullable<LocalReadManyResult["failures"]>;
};
type LocalShellInput = { command: string; script?: never; interpreter?: never; args?: never } | { script: string; interpreter?: "bash" | "sh"; args?: string[]; command?: never };
type LocalSearchScope = { path: string; glob?: string; hidden: boolean; ignoreFiles: true; snapshotScope?: "query-v1" };
type LocalGrepResult = { scope: LocalSearchScope; matches: { path: string; line: number; text: string }[]; truncated: boolean; scopeExhausted: boolean; nextCursor?: string; truncationReasons?: ("match-text" | "count" | "output" | "oversized-files")[] };
type LocalFindResult = { scope: LocalSearchScope; paths: string[]; truncated: boolean; scopeExhausted: boolean; nextCursor?: string; truncationReasons?: ("match-text" | "count" | "output" | "oversized-files")[] };
type LocalSearchReadArguments = { pattern: string; path?: string; glob?: string; literal?: boolean; ignoreCase?: boolean; hidden?: boolean; limit?: number; contextLines?: number; maxChars?: number; maxWindows?: number };
type LocalSearchReadResult = LocalGrepResult & LocalReadManyResult;
type LocalListResult = { entries: { path: string; type: "file" | "directory" }[]; truncated: boolean };
type LocalMutationResult = { path: string; changed: boolean; sha256: string; bytes: number; identity: LocalIdentity };
type LocalShellResult = { ok: boolean; exitCode: number | null; signal: string | null; stdout: string; stderr: string; truncated: boolean; stdoutTruncated: boolean; stderrTruncated: boolean };
/** Only ordinary nonzero local.shell rejections supply result. Hard failures do not. */
interface Error { readonly result?: LocalShellResult }
declare const local: {
  /** UTF-8 whole lines; 1-based, default 200/max 2000, files <=2MiB. totalLines is the whole-file count. truncated means unread suffix; fileExhausted is its inverse. requestedRangeDelivered means the requested range (clipped to EOF) was returned. nextOffset is the next line. Stop at requested end. Oversized single lines fail. */
  read(args: { path: string; offset?: number; limit?: number }): Promise<LocalReadResult>;
  /** partial:true retains independent successes and indexed ordinary read/stale-hash failures in failures and remaining; complete:false. Safety/cancellation/final drift reject. Same-file windows reuse one invocation snapshot, verified before return. Numbered source and hashes across 1..32 windows. Default 200/max 2000 lines per window; request 2000 for whole relevant files. 32000 aggregate JSON chars, maxChars 1000..40000, clamped to runtime budgets. Continue remaining verbatim first, then relevant unreadTails (hash-bound suffix windows, <=2000 lines). They can overlap remaining. complete covers requested ranges only; empty tails do not cover omitted prefixes/gaps or other files. */
  readMany(args: { windows: LocalReadWindow[]; maxChars?: number; partial?: boolean }): Promise<LocalReadManyResult>;
  /** Explicit compact string packet: KIRO_LOCAL_EVIDENCE/1 header, numbered sources, final newline + META + space + JSON footer (LocalEvidenceMetadata). sourceOffset/sourceChars use UTF-16 in the decoded packet. Same windows, safety, snapshots and partial semantics as readMany. maxChars budgets the ENTIRE JSON-serialized string (including escaping), default 32000/max 40000, min 1000, clamped to runtime/visible allowances. Metadata never silently drops; too-small budgets/oversized lines reject. Return the packet directly, preferably resultFormat:"text"; leave headroom for other returned data/logs. Continue remaining verbatim after repairing failures, then relevant unreadTails; tails can overlap remaining and omit prefixes/gaps. complete means requested windows only; not proof of inspection. No automatic inspection, steering, or delivery guarantee if a caller discards/remaps the result. */
  readEvidence(args: LocalReadEvidenceArguments): Promise<LocalReadEvidenceResult>;
  /** truncationReasons: match-text => read the line; count => raise limit/narrow scope; output => narrow scope; oversized-files => inspect separately. paginate:true enables snapshot pages; repeat identical options with cursor:nextCursor. Optional snapshotScope:"query-v1" with paginate:true validates glob-selected candidates, including nonmatching grep files, not unrelated files; scope.snapshotScope reports this contract. Default validates unfiltered scope. Provider-owned single-use cursors expire after 60s; collection rejects work/cache limits; count/output resumable, match-text not resumable. Requires rg. hidden:true includes dotfiles; default false. Ignore files still apply; VCS metadata/symlinks excluded. scope describes enumeration, not whole-repo completeness. Skips binary/invalid UTF-8; >2MiB skipped with truncated=true. Default 100/max 1000 matches; text <=500 chars. */
  grep(args: { pattern: string; path?: string; glob?: string; literal?: boolean; ignoreCase?: boolean; hidden?: boolean; limit?: number; paginate?: boolean; snapshotScope?: "query-v1"; cursor?: string }): Promise<LocalGrepResult>;
  /** Recursive rg glob enumeration; hidden:true for repository reviews. Same scope/ignore/VCS/no-follow semantics as grep. */
  find(args: { pattern: string; path?: string; hidden?: boolean; limit?: number; paginate?: boolean; snapshotScope?: "query-v1"; cursor?: string }): Promise<LocalFindResult>;
  /** Guest-only grep -> readMany composition, not a registered action. Groups paths, merges overlapping/adjacent context windows, splits at 2000 lines. contextLines integer 0..50 (default 3); maxWindows integer 1..32 (default 8); maxChars is readMany's budget, not the combined result budget. One read batch; zero matches skip it. remaining preserves ALL read continuations then deferred windows (may exceed 32); resume via readMany in <=32-window chunks, keeping hashes. complete covers windows derived from returned matches only; scopeExhausted/truncated/truncationReasons remain search values. No search pagination or atomic search/read snapshot; hashes bind reads, not prior grep. */
  searchRead(args: LocalSearchReadArguments): Promise<LocalSearchReadResult>;
  /** Sorted direct children, including hidden entries. Only path/limit; no depth. Use find for nested files. Unsafe entries are rejected. Default 100/max 1000. */
  list(args?: { path?: string; limit?: number }): Promise<LocalListResult>;
  /** Create-only unless overwrite=true. Replacing an existing file requires expectedSha256 from its read; omit it for creation. Parent must already exist. Exact approval binds snapshots and proposed content. */
  write(args: { path: string; content: string; overwrite?: boolean; expectedSha256?: string }): Promise<LocalMutationResult>;
  /** oldText/newText OR edits[1..100]; required expectedSha256 binds the original read (or prior mutation result). All nonempty anchors resolve on that snapshot, unique unless all=true, disjoint across edits. One complete multi-hunk approval/publication; unchanged text between hunks is summarized, changed text is never omitted; no writes on late-anchor failure. Parent must exist. */
  edit(args: { path: string; expectedSha256: string } & ({ oldText: string; newText: string; all?: boolean; edits?: never } | { edits: { oldText: string; newText: string; all?: boolean }[]; oldText?: never; newText?: never; all?: never })): Promise<LocalMutationResult>;
  /** Approved /bin/sh; cwd is NOT confinement. Within one exec, shell/write/edit queue FIFO before preparation. Failure stops queued effects; settle handles ordinary nonzero exits. No background jobs. */
  /** For multiline Bash use {script,interpreter:"bash",args?}: passed literally without outer shell expansion or scratch files. Default script interpreter sh. args become $1...; same approvals/queue/cleanup as command. Neither form provides network isolation. */
  shell(args: LocalShellInput & { cwd?: string; timeoutMs?: number; settle?: boolean }): Promise<LocalShellResult>;
};
`;
