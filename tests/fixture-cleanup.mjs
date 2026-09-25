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
// Directory handles keep the entry bound real: a single directory with a
// pathological entry count is stopped mid-stream instead of being materialized
// in full. Capture the raw descriptors at load time so later `fs` spies on the
// production seam are not consumed by the guard.
const lstat = fs.lstatSync, opendir = fs.opendirSync, realpath = fs.realpathSync;
// Git component names are conventionally uppercase, but a case-insensitive
// filesystem can expose them in any case; compare folded so a repository is
// never mistaken for a disposable fixture.
const isGitMetadataName = /** @param {string} name */ name => name.toLowerCase() === ".git";
const isBareRepository = /** @param {string[]} names */ names => {
  const folded = new Set(names.map(name => name.toLowerCase()));
  return folded.has("head") && folded.has("objects") && (folded.has("refs") || folded.has("packed-refs"));
};
// macOS exposes /var, /tmp and /etc as symlinks into /private, so a fixture
// path built from os.tmpdir() can carry that canonical prefix. Trust only
// those exact system aliases; every other intermediate redirect, including one
// into .git, is refused instead of resolved.
const isTrustedSystemAlias = /** @param {string} lexical @param {string} canonical */ (lexical, canonical) =>
  process.platform === "darwin" && ["var", "tmp", "etc"].includes(path.basename(lexical)) &&
  path.dirname(lexical) === path.sep && canonical === path.join(path.sep, "private", path.basename(lexical));
// rm unlinks a final symlink but traverses every intermediate one. Walk the
// target's ancestor components (everything above the final path component) and
// refuse an untrusted symlink, so an alias such as
// fixture/metadata-alias -> fixture/repo/.git cannot expose
// fixture/metadata-alias/objects to deletion. Fail closed when an ancestor
// cannot be inspected. This is a helper guard, not an OS sandbox: it does not
// close the race between inspection and removal.
const inspectAncestry = /** @param {string} root */ root => {
  const parsed = path.parse(root);
  const parts = root.slice(parsed.root.length).split(path.sep).filter(part => part.length > 0);
  let current = parsed.root;
  for (let index = 0; index < parts.length - 1; index++) {
    current = path.join(current, parts[index]);
    let stat;
    try { stat = lstat(current); }
    catch { return "inspection unavailable"; }
    if (stat.isSymbolicLink()) {
      let canonical;
      try { canonical = realpath(current); } catch { return "inspection unavailable"; }
      if (stat.uid !== 0 || !isTrustedSystemAlias(current, canonical)) return "symlinked cleanup ancestry";
    }
  }
  return undefined;
};
// A direct subtree target such as <bare>/objects has no `.git` component to
// match lexically and no bare layout of its own; walk the canonical ancestry
// and refuse when an enclosing directory is itself a bare repository.
const inspectEnclosingBareRepository = /** @param {string} start */ start => {
  let current = start, inspected = 0;
  for (let depth = 0; depth <= MAX_DEPTH; depth++) {
    const parsed = path.parse(current);
    let handle;
    try { handle = opendir(current); } catch { return "inspection unavailable"; }
    const names = [];
    try {
      for (;;) {
        if (inspected >= MAX_ENTRIES) return "inspection bound reached";
        const entry = handle.readSync();
        if (entry === null) break;
        inspected++; names.push(entry.name);
      }
    } catch { return "inspection unavailable"; }
    finally { try { handle.closeSync(); } catch { /* the handle is already closed */ } }
    if (isBareRepository(names)) return "bare Git repository";
    if (current === parsed.root) return undefined;
    current = path.dirname(current);
  }
  return "inspection bound reached";
};

/** @param {import('node:fs').PathLike} target */
function inspectForRemoval(target) {
  const root = path.resolve(target instanceof URL ? fileURLToPath(target) : String(target));
  const unsafe = [path.parse(root).root, process.cwd(), os.homedir(), os.tmpdir()];
  for (const candidate of unsafe) {
    if (root === path.resolve(candidate)) return { remove: false, reason: "unsafe cleanup root" };
    try { if (root === realpath(candidate)) return { remove: false, reason: "unsafe cleanup root" }; }
    catch { /* An absent HOME/TMPDIR test override cannot alias an existing root. */ }
  }
  if (Buffer.isBuffer(target) && !Buffer.from(String(target)).equals(target)) return { remove: false, reason: "uninspectable path encoding" };
  if (root.split(path.sep).some(isGitMetadataName)) return { remove: false, reason: "Git metadata" };
  try { lstat(root); }
  catch (error) { return error.code === "ENOENT" ? { remove: true, reason: "inspected generated fixture", path: root } : { remove: false, reason: "inspection unavailable" }; }
  const ancestry = inspectAncestry(root);
  if (ancestry) return { remove: false, reason: ancestry };
  let canonicalParent;
  try { canonicalParent = realpath(path.dirname(root)); } catch { return { remove: false, reason: "inspection unavailable" }; }
  const canonicalRoot = path.join(canonicalParent, path.basename(root));
  // Defense in depth: even if an intermediate alias escaped the walk above,
  // refuse when its canonical ancestry names Git metadata.
  if (canonicalRoot.split(path.sep).some(isGitMetadataName)) return { remove: false, reason: "Git metadata" };
  for (const candidate of unsafe) {
    try { if (canonicalRoot === realpath(candidate)) return { remove: false, reason: "unsafe cleanup root" }; }
    catch { /* An absent HOME/TMPDIR test override cannot alias an existing root. */ }
  }
  const enclosing = inspectEnclosingBareRepository(canonicalParent);
  if (enclosing) return { remove: false, reason: enclosing };
  let inspected = 0;
  /** @param {string} current @param {number} depth */
  const inspect = (current, depth) => {
    if (++inspected > MAX_ENTRIES || depth > MAX_DEPTH) return "inspection bound reached";
    let stat;
    try { stat = lstat(current); }
    catch (error) { return error.code === "ENOENT" ? undefined : "inspection unavailable"; }
    // rm unlinks symlinks, never their targets. Do not follow links outside the
    // owned fixture; a link named .git is caught before reaching this branch.
    if (!stat.isDirectory() || stat.isSymbolicLink()) return undefined;
    let handle;
    try { handle = opendir(current); } catch { return "inspection unavailable"; }
    const names = [];
    try {
      for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
        if (++inspected > MAX_ENTRIES) return "inspection bound reached";
        names.push(entry.name);
      }
    } catch { return "inspection unavailable"; }
    finally { try { handle.closeSync(); } catch { /* the handle is already closed */ } }
    if (names.some(isGitMetadataName)) return "Git metadata";
    if (isBareRepository(names)) return "bare Git repository";
    for (const name of names) {
      const reason = inspect(path.join(current, name), depth + 1);
      if (reason) return reason;
    }
    return undefined;
  };
  const reason = inspect(canonicalRoot, 0);
  return reason ? { remove: false, reason } : { remove: true, reason: "inspected generated fixture", path: canonicalRoot };
}

/** @param {import('node:fs').PathLike} target */
export function fixtureCleanupDecision(target) {
  const decision = inspectForRemoval(target);
  return decision.remove ? { remove: true, reason: decision.reason } : { remove: false, reason: decision.reason };
}

/** @param {import('node:fs').PathLike} target */
function mayRemove(target) {
  const decision = inspectForRemoval(target);
  if (!decision.remove) {
    if (!reported.has(String(target))) {
      reported.add(String(target));
      console.warn(`[fixture cleanup] retained ${String(target)}: ${decision.reason}`);
    }
    return null;
  }
  return decision.path;
}

/** @param {import('node:fs').PathLike} target @param {import('node:fs').RmOptions} [options] */
export function removeFixtureSync(target, options) {
  const toRemove = mayRemove(target);
  if (toRemove !== null) fs.rmSync(toRemove, options);
}

/** @param {import('node:fs').PathLike} target @param {import('node:fs').RmOptions} [options] */
export async function removeFixture(target, options) {
  const toRemove = mayRemove(target);
  if (toRemove !== null) await fs.promises.rm(toRemove, options);
}
