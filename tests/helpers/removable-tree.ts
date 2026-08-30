import { chmodSync, existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Restore owner-write permission on sealed installer directories for test cleanup. */
export const makeTreeRemovable = (dir: string): void => {
  if (!existsSync(dir)) return;
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return;
  chmodSync(dir, 0o700);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) makeTreeRemovable(join(dir, entry.name));
  }
};
