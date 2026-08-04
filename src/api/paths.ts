import path from "node:path";
import { lstat, realpath, open } from "node:fs/promises";
import { FabricError } from "../errors.js";

export const denied =
  /(^|\/)(\.env(?:\..*)?|\.git|node_modules|dist|build|coverage|secrets?|\.fabric-lite)(\/|$)/i;
export const deniedGlobs = [
  "**/.git/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.env*",
  "**/secret/**",
  "**/secrets/**",
  "**/.fabric-lite/**",
];

export function relativeSafe(root: string, candidate: string): string {
  const absolute = path.resolve(root, candidate);
  const relative = path.relative(root, absolute);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    denied.test(relative.replaceAll(path.sep, "/"))
  ) {
    throw new FabricError("POLICY_DENIED", `Path is denied: ${candidate}`);
  }
  return absolute;
}

export async function safePath(root: string, candidate: string, existing = true): Promise<string> {
  const absolute = relativeSafe(root, candidate);
  try {
    const [actualRoot, actual] = await Promise.all([
      realpath(root),
      realpath(existing ? absolute : path.dirname(absolute)),
    ]);
    const relative = path.relative(actualRoot, actual);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new FabricError("POLICY_DENIED", `Symlink escapes project root: ${candidate}`);
    }
  } catch (error) {
    if (existing || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return absolute;
}

export function normalizedRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).replaceAll(path.sep, "/");
}

function writeAllowPattern(pattern: string): string {
  return pattern.replaceAll("\\", "/").replace(/^\.\//, "");
}

function writeAllowed(relative: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    const normalized = writeAllowPattern(pattern);
    // Root-wide pattern: allow any project-relative path. Traversal,
    // sensitive denied paths, and symlink escapes are still enforced by
    // safeWritePath before this matcher runs.
    if (normalized === "**") return true;
    return (
      relative === normalized ||
      (normalized.endsWith("/**") && relative.startsWith(`${normalized.slice(0, -3)}/`))
    );
  });
}

export async function safeWritePath(
  root: string,
  candidate: string,
  allowWrite: readonly string[],
): Promise<{ absolute: string; relative: string }> {
  const lexical = await safePath(root, candidate, false);
  const actualRoot = await realpath(root);
  let parent: string;
  try {
    parent = await realpath(path.dirname(lexical));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new FabricError("POLICY_DENIED", `Write parent does not exist: ${candidate}`);
    }
    throw error;
  }
  const canonical = path.join(parent, path.basename(lexical));
  const relative = normalizedRelative(actualRoot, canonical);
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    denied.test(relative) ||
    !writeAllowed(relative, allowWrite)
  ) {
    throw new FabricError(
      "POLICY_DENIED",
      `Filesystem writes are disabled or canonical path is not allowlisted: ${candidate}`,
    );
  }
  try {
    const info = await lstat(lexical);
    if (info.isSymbolicLink()) {
      throw new FabricError(
        "POLICY_DENIED",
        `Refusing to follow symlink write target: ${candidate}`,
      );
    }
  } catch (error) {
    if (error instanceof FabricError || (error as NodeJS.ErrnoException).code !== "ENOENT")
      throw error;
  }
  return { absolute: canonical, relative };
}

export function descriptorPath(fd: number): string | undefined {
  if (process.platform === "linux") return `/proc/self/fd/${fd}`;
  if (["darwin", "freebsd", "openbsd", "netbsd"].includes(process.platform)) return `/dev/fd/${fd}`;
  return undefined;
}

export function descriptorChildPath(fd: number, child: string): string | undefined {
  // Linux procfs supports openat-like path traversal through a directory fd.
  // macOS exposes /dev/fd for verification, but does not reliably support
  // appending a child path to that pseudo-symlink; its safe fallback opens
  // without truncation and verifies the resulting target descriptor first.
  return process.platform === "linux" ? `/proc/self/fd/${fd}/${child}` : undefined;
}

export async function verifyOpenedWriteTarget(
  handle: Awaited<ReturnType<typeof open>>,
  root: string,
  allowWrite: readonly string[],
  candidate: string,
  openedPath: string,
): Promise<{ relative: string }> {
  const fdPath = descriptorPath(handle.fd);
  let canonical: string;
  try {
    // /dev/fd on macOS is useful for identifying the descriptor but does not
    // resolve to the underlying path, so verify its stable inode against the
    // canonical path opened without truncation.
    canonical =
      process.platform === "darwin"
        ? await realpath(openedPath)
        : fdPath
          ? await realpath(fdPath)
          : await realpath(openedPath);
    const opened = await handle.stat();
    const canonicalInfo = await lstat(canonical);
    if (opened.dev !== canonicalInfo.dev || opened.ino !== canonicalInfo.ino) {
      throw new FabricError(
        "POLICY_DENIED",
        `Opened write target changed during verification: ${candidate}`,
      );
    }
  } catch (error) {
    if (error instanceof FabricError) throw error;
    throw new FabricError("POLICY_DENIED", `Unable to verify opened write target: ${candidate}`);
  }
  const actualRoot = await realpath(root);
  const relative = normalizedRelative(actualRoot, canonical);
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    denied.test(relative) ||
    !writeAllowed(relative, allowWrite)
  ) {
    throw new FabricError(
      "POLICY_DENIED",
      `Opened write target is outside the canonical allowlist: ${candidate}`,
    );
  }
  const info = await handle.stat();
  if (!info.isFile()) {
    throw new FabricError("POLICY_DENIED", `Write target is not a regular file: ${candidate}`);
  }
  return { relative };
}
