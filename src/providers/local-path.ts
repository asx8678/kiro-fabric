import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { LocalIdentity } from "./local-contract.js";
import { canonicalPathContains, inspectCanonicalPath, sameCanonicalFilesystemIdentity } from "../kiro/canonical-path.js";
import type { CanonicalFilesystemIdentity } from "../kiro/canonical-path.js";

export class LocalNonTextError extends Error {}

export const LOCAL_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const localHash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
export const localIdentity = (stat: fs.Stats): LocalIdentity => ({ dev: stat.dev, ino: stat.ino });
export const sameLocalIdentity = (a: LocalIdentity, b: LocalIdentity): boolean => a.dev === b.dev && a.ino === b.ino;
const code = (error: unknown): string | undefined => (error as NodeJS.ErrnoException)?.code;
export interface LocalPathSnapshot {
  path: string;
  parents: { path: string; identity: LocalIdentity }[];
  file: { identity: LocalIdentity; mode: number; size: number; mtimeMs: number; ctimeMs: number; sha256: string } | null;
}

/** Pathname checks are defense in depth, NOT race-proof isolation from hostile
 * same-user actors. Ancestors beneath the canonical root must not be symlinks.
 * New parents are deliberately unsupported. */
export class LocalPaths {
  readonly root: string;
  readonly identity: LocalIdentity;
  readonly #canonicalIdentity: CanonicalFilesystemIdentity;
  constructor(root: string) {
    const inspected = inspectCanonicalPath(root, { kind: "directory" });
    if (inspected.finalEntryIsSymlink || inspected.canonicalPath !== root || inspected.lexicalPath !== root) throw new Error("local root must be the verified canonical workspace path");
    this.root = root;
    this.identity = localIdentity(inspected.lexicalStats);
    this.#canonicalIdentity = inspected.identity;
  }
  verifyRoot(): void {
    const inspected = inspectCanonicalPath(this.root, { kind: "directory" });
    if (inspected.finalEntryIsSymlink || inspected.canonicalPath !== this.root || !sameCanonicalFilesystemIdentity(inspected.identity, this.#canonicalIdentity)) throw new Error("local workspace root identity changed");
  }
  resolve(input: string): string {
    this.verifyRoot();
    if (input.includes("\0") || input.split(/[\\/]/u).includes("..")) throw new Error("local path traversal is forbidden");
    const resolved = path.resolve(this.root, input);
    const relative = path.relative(this.root, resolved);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("local path is outside workspace");
    return resolved;
  }
  check(input: string, allowMissing = false): { path: string; stat: fs.Stats | null; parents: LocalPathSnapshot["parents"] } {
    const target = this.resolve(input);
    const parts = path.relative(this.root, target).split(path.sep).filter(Boolean);
    const parents = [{ path: this.root, identity: this.identity }];
    let current = this.root;
    let stat: fs.Stats | null = fs.lstatSync(current);
    for (let index = 0; index < parts.length; index++) {
      current = path.join(current, parts[index]!);
      try { stat = fs.lstatSync(current); }
      catch (error) {
        if (allowMissing && index === parts.length - 1 && code(error) === "ENOENT") return { path: target, stat: null, parents };
        throw error;
      }
      if (stat.isSymbolicLink()) throw new Error("local symlink components are forbidden");
      if (!stat.isFile() && !stat.isDirectory()) throw new Error("local special files are forbidden");
      if (stat.isFile() && stat.nlink !== 1) throw new Error("local hardlink regular files are forbidden");
      if (index < parts.length - 1) {
        if (!stat.isDirectory()) throw new Error("local parent must be an existing directory");
        parents.push({ path: current, identity: localIdentity(stat) });
      }
    }
    const canonical = fs.realpathSync(target);
    if (canonical !== target || !canonicalPathContains(this.root, canonical)) throw new Error("local path canonical containment changed");
    return { path: target, stat, parents };
  }
  directory(input: string): { path: string; identity: LocalIdentity; parents: LocalPathSnapshot["parents"] } {
    const found = this.check(input);
    if (!found.stat?.isDirectory()) throw new Error("local path must be a directory");
    return { path: found.path, identity: localIdentity(found.stat), parents: found.parents };
  }
  read(input: string): { text: string; snapshot: LocalPathSnapshot } {
    const found = this.check(input);
    if (!found.stat?.isFile()) throw new Error("local path must be a regular file");
    if (found.stat.size > LOCAL_MAX_FILE_BYTES) throw new Error("local file exceeds 2MiB byte limit");
    const fd = fs.openSync(found.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const before = fs.fstatSync(fd);
      if (!before.isFile() || before.nlink !== 1 || !sameLocalIdentity(before, found.stat)) throw new Error("local file identity changed");
      const bytes = Buffer.alloc(Math.min(before.size + 1, LOCAL_MAX_FILE_BYTES + 1));
      let length = 0;
      while (length < bytes.length) {
        const count = fs.readSync(fd, bytes, length, bytes.length - length, null);
        if (!count) break;
        length += count;
      }
      const after = fs.fstatSync(fd);
      if (length !== before.size || length > LOCAL_MAX_FILE_BYTES || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || after.nlink !== 1) throw new Error("local file changed during bounded read");
      const data = bytes.subarray(0, length);
      if (data.includes(0)) throw new LocalNonTextError("local binary file is unsupported");
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data); }
      catch { throw new LocalNonTextError("local file is not valid UTF-8"); }
      this.verifyRoot();
      const again = this.check(found.path);
      if (!again.stat || !sameLocalIdentity(again.stat, before) || JSON.stringify(again.parents) !== JSON.stringify(found.parents)) throw new Error("local file identity changed during read");
      return { text, snapshot: { path: found.path, parents: found.parents, file: { identity: localIdentity(before), mode: before.mode, size: before.size, mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs, sha256: localHash(data) } } };
    } finally { fs.closeSync(fd); }
  }
  snapshot(input: string): { text: string; snapshot: LocalPathSnapshot } {
    const found = this.check(input, true);
    return found.stat ? this.read(found.path) : { text: "", snapshot: { path: found.path, parents: found.parents, file: null } };
  }
  revalidate(snapshot: LocalPathSnapshot): void {
    if (JSON.stringify(this.snapshot(snapshot.path).snapshot) !== JSON.stringify(snapshot)) throw new Error("local approval snapshot conflict: file or parent identity/content changed");
  }
  relative(input: string): string { return path.relative(this.root, input) || "."; }
}
