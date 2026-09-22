import fs from "node:fs";

/** Lifetime revalidation, not a kernel CAS or an OS sandbox. Canonical paths are
 * captured by the caller after admission; normal child creation must not revoke
 * a directory, while replacement, ancestor symlinks and privacy drift must.
 * No persistent descriptors are held by long-lived memory bindings. */
export function privateStorageDirectoryGuard(directory: string, failure: (message: string) => Error): () => void {
  const inspect = (): fs.Stats => {
    const current = fs.lstatSync(directory);
    if (!current.isDirectory() || current.isSymbolicLink() ||
        (process.platform !== "win32" && ((current.mode & 0o077) !== 0 ||
          (typeof process.getuid === "function" && current.uid !== process.getuid()))) ||
        fs.realpathSync(directory) !== directory) {
      throw failure(`Storage directory is unsafe or crosses a symlink: ${directory}`);
    }
    return current;
  };
  const expected = inspect();
  return () => {
    const current = inspect();
    if (current.dev !== expected.dev || current.ino !== expected.ino || current.birthtimeMs !== expected.birthtimeMs) {
      throw failure(`Storage directory identity changed; preserve replacement: ${directory}`);
    }
  };
}

/** Files must retain both inode identity and their captured metadata. In-place
 * modification is not ownership proof, and atime changes from reads are benign. */
export function sameStorageFile(current: fs.Stats, expected: fs.Stats): boolean {
  return current.isFile() && !current.isSymbolicLink() && current.nlink === 1 &&
    current.dev === expected.dev && current.ino === expected.ino && current.birthtimeMs === expected.birthtimeMs &&
    current.uid === expected.uid && current.gid === expected.gid && current.mode === expected.mode &&
    current.size === expected.size && current.mtimeMs === expected.mtimeMs && current.ctimeMs === expected.ctimeMs;
}
