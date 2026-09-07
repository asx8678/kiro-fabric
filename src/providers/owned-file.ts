import fs from "node:fs";

export interface OwnedFile {
  created: boolean;
  identity?: { dev: number; ino: number };
}

/** Establish identity before initialization. On failure, retry identity only
 * while the descriptor is definitely open; close is attempted exactly once.
 * Callers retain this evidence until exact-identity pathname cleanup succeeds. */
export function initializeOwnedFile(target: string, owned: OwnedFile, initialize: (fd: number) => void): void {
  const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  owned.created = true;
  const errors: unknown[] = [];
  let closeUncertain = false;
  try {
    const stat = fs.fstatSync(fd);
    owned.identity = { dev: stat.dev, ino: stat.ino };
    initialize(fd);
  } catch (error) { errors.push(error); }
  finally {
    if (!owned.identity) {
      try {
        const stat = fs.fstatSync(fd);
        owned.identity = { dev: stat.dev, ino: stat.ino };
      } catch (error) { errors.push(error); }
    }
    // A throwing close may already have closed/reused fd. Never retry it.
    try { fs.closeSync(fd); } catch (error) { closeUncertain = true; errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, closeUncertain
    ? "owned file initialization failed; descriptor close uncertain (never retried)"
    : owned.identity
    ? "owned file initialization failed"
    : "uncertain lock/file: ownership identity unavailable; operator recovery required", { cause: errors[0] });
}
