import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { initializeOwnedFile } from "./owned-file.js";

export const probeHash = (text: string): string => createHash("sha256").update(text).digest("hex");
type Identity = { dev: number; ino: number };
export type ProbeDirectorySnapshot = { path: string; identity: Identity }[];
const identity = (stat: fs.Stats): Identity => ({ dev: stat.dev, ino: stat.ino });
const same = (stat: fs.Stats, expected: Identity): boolean => stat.dev === expected.dev && stat.ino === expected.ino;
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === "ENOENT";
const contains = (parent: string, child: string): boolean => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
const privateDirectory = (stat: fs.Stats): void => {
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new Error("probe directory must be private (0700) and host-owned");
};
const chain = (target: string): string[] => {
  const paths = [target];
  while (paths[0] !== path.parse(target).root) paths.unshift(path.dirname(paths[0]!));
  return paths;
};
const directory = (target: string): fs.Stats => {
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("probe path is not a regular no-symlink directory");
  return stat;
};

/** Provider path operations are no-follow/create-only and identity checked.
 * These pathname checks are NOT a sandbox against malicious same-user TOCTOU
 * races or an approved shell, which deliberately retains host authority. */
export class ProbeStorage {
  readonly root: string;
  readonly probesRoot: string;
  readonly #ancestors = new Map<string, Identity>();
  readonly #missing: string[] = [];
  readonly #owned = new Map<string, Identity>();

  constructor(root: string, probesRoot: string) {
    this.root = fs.realpathSync(root);
    if (!directory(this.root).isDirectory()) throw new Error("probe workspace must be a directory");
    if (!path.isAbsolute(probesRoot) || path.resolve(probesRoot) !== probesRoot || probesRoot.length > 3000) throw new Error("probesRoot must be a bounded canonical absolute path");
    if (contains(this.root, probesRoot) || contains(probesRoot, this.root)) throw new Error("probesRoot must be outside and not contain the repository");
    this.probesRoot = probesRoot;
    let absent = false;
    for (const current of chain(probesRoot)) {
      if (absent) { this.#missing.push(current); continue; }
      try { this.#ancestors.set(current, identity(directory(current))); }
      catch (error) {
        if (!missing(error)) throw error;
        absent = true; this.#missing.push(current);
      }
    }
    if (!absent) privateDirectory(directory(probesRoot));
  }

  verify(): void {
    for (const [target, expected] of this.#ancestors) {
      if (!same(directory(target), expected)) throw new Error("probe root/ancestor identity changed");
    }
    // A missing path may only appear through this instance's approved ensureRoot.
    for (const target of this.#missing) {
      try { fs.lstatSync(target); }
      catch (error) { if (missing(error)) continue; throw error; }
      throw new Error("probe previously missing root was replaced externally");
    }
    if (!this.#missing.length) privateDirectory(directory(this.probesRoot));
  }

  countRoots(limit: number): number {
    this.verify();
    if (this.#missing.length) return 0;
    const entries = fs.opendirSync(this.probesRoot);
    let count = 0;
    try { while (entries.readSync()) { count++; if (count >= limit) break; } }
    finally { entries.closeSync(); }
    return count;
  }

  ensureRoot(): void {
    this.verify();
    while (this.#missing.length) {
      const target = this.#missing[0]!;
      fs.mkdirSync(target, { mode: 0o700 });
      const stat = directory(target); privateDirectory(stat);
      this.#ancestors.set(target, identity(stat));
      this.#missing.shift();
    }
    this.verify();
  }

  createDirectory(target: string): void {
    this.verify();
    if (!contains(this.probesRoot, target) || target === this.probesRoot) throw new Error("probe directory escaped owned root");
    this.snapshot(path.dirname(target));
    fs.mkdirSync(target, { mode: 0o700 });
    const stat = directory(target); privateDirectory(stat);
    this.#owned.set(target, identity(stat));
  }

  snapshot(target: string): ProbeDirectorySnapshot {
    this.verify();
    if (!contains(this.probesRoot, target)) throw new Error("probe directory escaped owned root");
    const result: ProbeDirectorySnapshot = [];
    for (const current of chain(target).filter(item => contains(this.probesRoot, item))) {
      const stat = directory(current); privateDirectory(stat);
      const expected = current === this.probesRoot ? this.#ancestors.get(current) : this.#owned.get(current);
      if (!expected || !same(stat, expected)) throw new Error("probe directory identity is not host-owned or changed");
      result.push({ path: current, identity: identity(stat) });
    }
    return result;
  }

  verifySnapshot(snapshot: ProbeDirectorySnapshot): void {
    for (const item of snapshot) {
      const actual = this.snapshot(item.path).at(-1)!;
      if (actual.identity.dev !== item.identity.dev || actual.identity.ino !== item.identity.ino) throw new Error("probe approval directory identity changed");
    }
  }

  safeName(name: string): string[] {
    const parts = name.split("/");
    if (name.length > 240 || parts.length > 8 || parts.some(part => !/^[A-Za-z0-9_.-]{1,80}$/.test(part) || part === "." || part === "..")) throw new Error("probe file requires a bounded safe relative name (no traversal/symlinks)");
    return parts;
  }

  /** Capture existing owned parents and require a missing final file. No writes. */
  filePlan(project: string, name: string): ProbeDirectorySnapshot {
    const parts = this.safeName(name);
    const snapshots = this.snapshot(project);
    let current = project;
    let absent = false;
    for (const part of parts.slice(0, -1)) {
      current = path.join(current, part);
      if (absent) continue;
      try { fs.lstatSync(current); }
      catch (error) { if (missing(error)) { absent = true; continue; } throw error; }
      snapshots.push(...this.snapshot(current));
    }
    if (!absent) {
      try { fs.lstatSync(path.join(project, ...parts)); }
      catch (error) { if (missing(error)) return snapshots; throw error; }
      throw new Error("probe.write/create files are create-only; target already exists");
    }
    return snapshots;
  }

  writeProjectFile(project: string, name: string, content: string): void {
    this.filePlan(project, name);
    const parts = this.safeName(name);
    let current = project;
    for (const part of parts.slice(0, -1)) {
      current = path.join(current, part);
      try { fs.lstatSync(current); this.snapshot(current); }
      catch (error) { if (!missing(error)) throw error; this.createDirectory(current); }
    }
    this.writeRecord(path.join(project, ...parts), content);
  }

  /** Never overwrite or unlink anything, including a substituted symlink/hardlink. */
  writeRecord(target: string, text: string): void {
    const parents = this.snapshot(path.dirname(target));
    initializeOwnedFile(target, { created: false }, fd => {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1) throw new Error("probe record is not an independent regular file");
      this.verifySnapshot(parents);
      fs.writeFileSync(fd, text, "utf8");
      fs.fsyncSync(fd);
      const actual = fs.lstatSync(target);
      if (!same(actual, identity(stat)) || actual.isSymbolicLink() || actual.nlink !== 1) throw new Error("probe file changed during publication; inspect retained data");
    });
  }
}
