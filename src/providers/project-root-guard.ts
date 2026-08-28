import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UNICODE_SPACES = /[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g;

const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

const normalizeToolPath = (input: string): string => {
  let normalized = input.replace(UNICODE_SPACES, " ");
  if (normalized.startsWith("@")) normalized = normalized.slice(1);
  if (/^file:\/\//i.test(normalized)) normalized = fileURLToPath(normalized);
  if (normalized === "~") return homedir();
  if (
    normalized.startsWith("~/") ||
    (process.platform === "win32" && normalized.startsWith("~\\"))
  ) {
    return path.join(homedir(), normalized.slice(2));
  }
  return normalized;
};

const realpath = (value: string): string =>
  typeof fs.realpathSync.native === "function"
    ? fs.realpathSync.native(value)
    : fs.realpathSync(value);

/**
 * Canonical project-root boundary for Pi filesystem tools.
 *
 * Both the lexical path and the nearest existing canonical ancestor must stay
 * below cwd. Checking the ancestor makes writes to non-existent files safe
 * from pre-existing symlink/junction escapes. Existing targets are themselves
 * canonicalized, so a final symlink cannot escape either.
 */
export class ProjectRootGuard {
  readonly cwd: string;
  readonly canonicalRoot: string;

  constructor(cwd: string) {
    this.cwd = path.resolve(cwd);
    this.canonicalRoot = realpath(this.cwd);
  }

  assertPath(input: unknown, action: string): string {
    if (typeof input !== "string" || input.length === 0) {
      throw new Error(`${action} requires a non-empty path inside the project root`);
    }
    let normalized: string;
    try {
      normalized = normalizeToolPath(input);
    } catch {
      throw new Error(`${action} received an invalid file URL or path: ${input}`);
    }
    const absolute = path.isAbsolute(normalized)
      ? path.resolve(normalized)
      : path.resolve(this.cwd, normalized);
    // Do not reject on lexical spelling alone: on systems where /var (or cwd)
    // is a symlink, both an absolute canonical path and the launch spelling are
    // valid. The nearest-existing-ancestor check below is authoritative.
    let existing = absolute;
    for (;;) {
      try {
        const stat = fs.lstatSync(existing);
        if (stat.isSymbolicLink()) {
          // A dangling final symlink has no safe canonical target. A live one
          // is handled by realpath below.
          try {
            realpath(existing);
          } catch {
            throw new Error(`${action} path uses a dangling symlink: ${input}`);
          }
        }
        break;
      } catch (error) {
        if (
          error instanceof Error &&
          !((error as NodeJS.ErrnoException).code === "ENOENT" ||
            (error as NodeJS.ErrnoException).code === "ENOTDIR")
        ) {
          throw error;
        }
        const parent = path.dirname(existing);
        if (parent === existing) {
          throw new Error(`${action} path has no accessible project ancestor: ${input}`);
        }
        existing = parent;
      }
    }

    const canonicalAncestor = realpath(existing);
    if (!isWithin(this.canonicalRoot, canonicalAncestor)) {
      throw new Error(`${action} path escapes the project root through a symlink or junction: ${input}`);
    }

    // Existing targets get a final canonical check. For a non-existent target,
    // rebuild the suffix under the canonical existing ancestor. Returning this
    // canonical spelling lets the provider replace symlinked aliases before
    // tool execution, narrowing the remaining check/use window.
    try {
      const canonicalTarget = realpath(absolute);
      if (!isWithin(this.canonicalRoot, canonicalTarget)) {
        throw new Error(`${action} path escapes the project root through a symlink or junction: ${input}`);
      }
      return canonicalTarget;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }
    const canonicalTarget = path.resolve(canonicalAncestor, path.relative(existing, absolute));
    if (!isWithin(this.canonicalRoot, canonicalTarget)) {
      throw new Error(`${action} path escapes the project root through a symlink or junction: ${input}`);
    }
    return canonicalTarget;
  }
}
