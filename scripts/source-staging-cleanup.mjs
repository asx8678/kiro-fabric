import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const STAGING_PREFIX = "fabric-source-activation-";

/** @typedef {{ dev: string, ino: string, mode: number, uid: number }} StagingIdentity */
/** @typedef {{ removed: boolean, path: string, retained: boolean, reason?: string }} CleanupResult */

/** Capture immediately after creating and securing the private staging directory.
 * @param {string} directory
 * @returns {StagingIdentity}
 */
export function identifyStagingRoot(directory) {
  if (typeof directory !== "string") throw new TypeError("Staging directory must be a string");
  const stat = fs.lstatSync(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Staging root is not a real directory");
  return { dev: String(stat.dev), ino: String(stat.ino), mode: Number(stat.mode), uid: Number(stat.uid) };
}

/** @param {string} root @param {string} directory */
function contains(root, directory) {
  const relative = path.relative(root, directory);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Inspect before deleting; never follow an entry symlink or enumerate an
 * unbounded directory. Non-string paths are retained with an empty path rather
 * than coerced. Missing identity is retention, not permission to infer ownership.
 *
 * This is a synchronous pathname guard, not an atomic filesystem transaction:
 * the caller must keep staging private and quiescent until cleanup finishes.
 * A removal failure can leave a partially removed tree; it is never success.
 *
 * @param {{ path?: unknown, identity?: StagingIdentity, tmpRoot?: string, maxEntries?: number }} [options]
 * @returns {CleanupResult}
 */
export function removeSourceActivationStaging({ path: directory, identity, tmpRoot = os.tmpdir(), maxEntries = 2048 } = {}) {
  if (typeof tmpRoot !== "string") throw new TypeError("tmpRoot must be a string");
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 0) throw new TypeError("maxEntries must be a nonnegative safe integer");
  const reportedPath = typeof directory === "string" ? directory : "";
  /** @param {string} reason @returns {CleanupResult} */
  const retain = reason => ({ removed: false, path: reportedPath, retained: true, reason });
  if (typeof directory !== "string" || !path.isAbsolute(directory) || path.normalize(directory) !== directory || path.resolve(directory) !== directory) {
    return retain("Staging path must be an absolute, normalized string");
  }
  if (!path.basename(directory).startsWith(STAGING_PREFIX)) return retain("Staging prefix mismatch");
  if (!contains(tmpRoot, directory)) return retain("Staging path is not contained in tmpRoot");
  if (!identity || typeof identity.dev !== "string" || typeof identity.ino !== "string") return retain("Missing or invalid staging identity");

  let phase = "inspection";
  try {
    /** @param {StagingIdentity} current */
    const matchesRoot = current => typeof process.getuid === "function" && current.uid === process.getuid() &&
      (current.mode & 0o077) === 0 && current.dev === identity.dev && current.ino === identity.ino;
    if (!matchesRoot(identifyStagingRoot(directory))) return retain("Staging ownership, permissions or identity mismatch");
    const canonicalRoot = fs.realpathSync(tmpRoot);
    const canonicalDirectory = fs.realpathSync(directory);
    if (!contains(canonicalRoot, canonicalDirectory)) return retain("Resolved staging path escapes tmpRoot");

    /** @param {import('node:fs').BigIntStats} before @param {import('node:fs').BigIntStats} after */
    const unchanged = (before, after) => after.isDirectory() && !after.isSymbolicLink() &&
      before.dev === after.dev && before.ino === after.ino && before.mode === after.mode &&
      before.uid === after.uid && before.gid === after.gid &&
      before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
    const pending = [{ directory, stat: fs.lstatSync(directory, { bigint: true }) }];
    /** @type {{ directory: string, stat: import('node:fs').BigIntStats }[]} */
    const inspected = [];
    let count = 0;
    while (pending.length) {
      const current = pending.pop();
      if (!unchanged(current.stat, fs.lstatSync(current.directory, { bigint: true }))) return retain("Staging directory changed during inspection");
      const handle = fs.opendirSync(current.directory, { bufferSize: 32 });
      const names = new Set();
      try {
        for (;;) {
          const entry = handle.readSync();
          if (!entry) break;
          if (++count > maxEntries) return retain("Staging entry bound exceeded");
          const name = entry.name.toLowerCase();
          if (name === ".git") return retain("Git metadata found in staging");
          names.add(name);
          if (names.has("head") && names.has("objects") && (names.has("refs") || names.has("packed-refs"))) {
            return retain("Bare repository signature found in staging");
          }
          const child = path.join(current.directory, entry.name);
          const stat = fs.lstatSync(child, { bigint: true });
          if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) return retain("Symlink or special entry found in staging");
          if (stat.isDirectory()) pending.push({ directory: child, stat });
        }
      } finally {
        handle.closeSync();
      }
      inspected.push(current);
    }
    // Recheck inspected directories for replacements or additions before effects.
    for (const current of inspected) {
      if (!unchanged(current.stat, fs.lstatSync(current.directory, { bigint: true }))) return retain("Staging directory changed during inspection");
    }
    if (!matchesRoot(identifyStagingRoot(directory))) return retain("Staging root changed before removal");
    if (fs.realpathSync(tmpRoot) !== canonicalRoot || fs.realpathSync(directory) !== canonicalDirectory) return retain("Staging ancestry changed before removal");

    phase = "removal";
    fs.rmSync(directory, { recursive: true, force: false });
    phase = "removal verification";
    try {
      fs.lstatSync(directory, { bigint: true });
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return { removed: true, path: directory, retained: false };
      throw error;
    }
    return retain("Staging path still exists after removal");
  } catch (error) {
    return retain(`Staging ${phase} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
