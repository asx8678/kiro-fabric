import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// Explicit fixture teardown only: never monkey-patch production fs or alter its
// deletion assertions. Keep the entire fixture when it contains repository
// metadata (including worktree files and bare repositories), or cannot be fully
// inspected. Retained fixtures are evidence, not candidates for later pruning.
const MAX_ENTRIES = 25_000;
const MAX_DEPTH = 128;
const reported = new Set();
// Inspection must not consume filesystem fault-injection mocks intended for
// production code, or mistake a mocked ENOENT for a repository-free fixture.
const lstat = fs.lstatSync, readdir = fs.readdirSync, realpath = fs.realpathSync;

/** @param {import('node:fs').PathLike} target */
export function fixtureCleanupDecision(target) {
  const root = path.resolve(target instanceof URL ? fileURLToPath(target) : String(target));
  const unsafe = [path.parse(root).root, process.cwd(), os.homedir(), os.tmpdir()];
  for (const candidate of unsafe) {
    if (root === path.resolve(candidate)) return { remove: false, reason: "unsafe cleanup root" };
    try { if (root === realpath(candidate)) return { remove: false, reason: "unsafe cleanup root" }; }
    catch { /* An absent HOME/TMPDIR test override cannot alias an existing root. */ }
  }
  if (Buffer.isBuffer(target) && !Buffer.from(String(target)).equals(target)) return { remove: false, reason: "uninspectable path encoding" };
  if (root.split(path.sep).some(part => part.toLowerCase() === ".git")) return { remove: false, reason: "Git metadata" };
  let visited = 0;
  /** @param {string} current @param {number} depth */
  const inspect = (current, depth) => {
    if (++visited > MAX_ENTRIES || depth > MAX_DEPTH) return "inspection bound reached";
    let stat;
    try { stat = lstat(current); }
    catch (error) { return error.code === "ENOENT" ? undefined : "inspection unavailable"; }
    // rm unlinks symlinks, never their targets. Do not follow links outside the
    // owned fixture; a link named .git is caught before reaching this branch.
    if (!stat.isDirectory() || stat.isSymbolicLink()) return undefined;
    let names;
    try { names = readdir(current); } catch { return "inspection unavailable"; }
    if (names.some(name => name.toLowerCase() === ".git")) return "Git metadata";
    if (names.includes("HEAD") && names.includes("objects") && (names.includes("refs") || names.includes("packed-refs"))) return "bare Git repository";
    for (const name of names) {
      const reason = inspect(path.join(current, name), depth + 1);
      if (reason) return reason;
    }
    return undefined;
  };
  const reason = inspect(root, 0);
  return reason ? { remove: false, reason } : { remove: true, reason: "inspected generated fixture" };
}

/** @param {import('node:fs').PathLike} target */
function mayRemove(target) {
  const decision = fixtureCleanupDecision(target);
  if (!decision.remove && !reported.has(String(target))) {
    reported.add(String(target));
    console.warn(`[fixture cleanup] retained ${String(target)}: ${decision.reason}`);
  }
  return decision.remove;
}

/** @param {import('node:fs').PathLike} target @param {import('node:fs').RmOptions} [options] */
export function removeFixtureSync(target, options) {
  if (mayRemove(target)) fs.rmSync(target, options);
}

/** @param {import('node:fs').PathLike} target @param {import('node:fs').RmOptions} [options] */
export async function removeFixture(target, options) {
  if (mayRemove(target)) await fs.promises.rm(target, options);
}
