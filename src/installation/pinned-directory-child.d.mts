/** Fixed operations under a caller-held parent fd; caller supplies full ancestry
 * check(), retains fd ownership and rechecks returned identities before reuse.
 * Names are single components. Existing destinations are never chmodded/reused.
 * rename without targetExpected is no-clobber, regular-file link+unlink; with an
 * expected destination it deliberately replaces that captured name. unlink,
 * rmdir and replacement retain identity prechecks but are NOT kernel CAS: callers
 * still need exclusive coordination of those names. Conflicts/partial outcomes
 * retain evidence; no recursive or automatic rollback is performed.
 * @param {OperationOptions} options @returns {EntryIdentity|null} */
export function runPinnedDirectoryOperation(options: OperationOptions): EntryIdentity | null;
/** Streaming exclusive writer: the verified child owns the output descriptor.
 * Source bytes travel only over bounded stdin; no temporary source file or argv.
 * A failed source/child closes resources and preserves partial output evidence.
 * @param {ParentOptions & {name:string,mode?:number,maxBytes:number}} options
 * @param {AsyncIterable<Uint8Array>} source @returns {Promise<EntryIdentity>} */
export function writePinnedDirectoryStream(options: ParentOptions & {
    name: string;
    mode?: number;
    maxBytes: number;
}, source: AsyncIterable<Uint8Array>): Promise<EntryIdentity>;
export function pinnedDirectoryIdentity(stat: import("node:fs").BigIntStats): DirectoryIdentity;
export function pinnedEntryIdentity(stat: import("node:fs").BigIntStats): EntryIdentity;
export type DirectoryIdentity = {
    dev: string;
    ino: string;
    mode: number;
    uid: number;
    gid: number;
};
export type EntryIdentity = DirectoryIdentity & {
    nlink: string;
    size: string;
    mtimeNs: string;
    ctimeNs: string;
};
export type ParentOptions = {
    fd: number;
    cwd: string;
    parent: DirectoryIdentity;
    check: () => void;
};
export type OperationOptions = ParentOptions & {
    operation: "mkdir0700" | "writeExclusive" | "rename" | "unlink" | "rmdir";
    name: string;
    target?: string;
    expected?: EntryIdentity;
    targetExpected?: EntryIdentity;
    mode?: number;
    data?: Buffer;
    maxBytes?: number;
};
