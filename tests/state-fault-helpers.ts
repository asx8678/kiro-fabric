import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import * as pinnedDirectory from "../src/installation/pinned-directory-child.mjs";

/** Flatten an error with its aggregate causes into one comparable string. */
export const causes = (error: unknown): string =>
  error instanceof AggregateError ? `${error.message} ${error.errors.map(causes).join(" ")}` : error instanceof Error ? `${error.message} ${error.cause ? causes(error.cause) : ""}` : String(error);

/** Fail the active platform's state lock removal seam without weakening any
 * assertion: Linux removes through the rmSync descriptor alias, Darwin
 * through the pinned child. */
export const failLockRemoval = (message: string): void => {
  const rm = fs.rmSync, removePinned = pinnedDirectory.runPinnedDirectoryOperation;
  vi.spyOn(fs, "rmSync").mockImplementation((file, options) => {
    if (path.basename(String(file)) === ".state-mutation.lock") throw new Error(message);
    rm(file, options);
  });
  vi.spyOn(pinnedDirectory, "runPinnedDirectoryOperation").mockImplementation(options => {
    if (options.operation === "unlink" && options.name === ".state-mutation.lock") throw new Error(message);
    return removePinned(options);
  });
};
