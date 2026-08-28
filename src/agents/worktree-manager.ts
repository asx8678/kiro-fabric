import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { executeFile } from "./transports/process-utils.js";

/**
 * Shared writable lease directory for cross-process single-writer enforcement.
 * Worktrees are created under os.tmpdir(); the lease lives under a user cache
 * directory that peer processes can open on the same host.
 */
const WRITER_LEASES_DIR = path.join(
  process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
  "kiro-fabric-writer-leases",
);

export type WorktreeWriteMode = "read" | "write";

/** Stable lease file name for a canonical repo root. */
const writerLeaseFile = (gitRoot: string): string => {
  const canonical = fs.realpathSync(gitRoot);
  const digest = createHash("sha256")
    .update(canonical)
    .digest("hex")
    .slice(0, 16);
  return `${digest}.lease`;
};

interface WriterLeaseRecord {
  token: string;
  pid: number;
  hostname: string;
  owner: string;
  branch: string;
  acquiredAt: number;
}

const LEASE_TTL_MS = 30 * 60 * 1000;

/** Parsed lease file (undefined when absent or unreadable). */
const readLeaseRecord = (file: string): WriterLeaseRecord | undefined => {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<WriterLeaseRecord>;
    if (
      typeof parsed.token !== "string" ||
      typeof parsed.owner !== "string"
    ) {
      return undefined;
    }
    return {
      token: parsed.token,
      pid: typeof parsed.pid === "number" ? parsed.pid : 0,
      hostname: typeof parsed.hostname === "string" ? parsed.hostname : "",
      owner: parsed.owner,
      branch: typeof parsed.branch === "string" ? parsed.branch : "",
      acquiredAt: typeof parsed.acquiredAt === "number" ? parsed.acquiredAt : 0,
    };
  } catch {
    return undefined;
  }
};

interface WriterLease {
  token: string;
  release: () => void;
}

/**
 * Cross-process single-writer lease (rec #1/#6). The in-process map alone
 * cannot prevent two separate Kiro/Fabric processes from writing the same
 * checkout, so the authoritative guard is an atomic lock file per git root.
 *
 * Returns a release handle, or throws when another live writer holds the lease
 * (or when a stale lease cannot be reclaimed safely).
 */
export const acquireWriterLease = (gitRoot: string, options: {
  owner: string;
  branch?: string;
}): WriterLease => {
  fs.mkdirSync(WRITER_LEASES_DIR, { recursive: true, mode: 0o700 });
  const file = path.join(WRITER_LEASES_DIR, writerLeaseFile(gitRoot));
  const token = randomBytes(16).toString("hex");
  const record: WriterLeaseRecord = {
    token,
    pid: process.pid,
    hostname: hostname(),
    owner: options.owner,
    branch: options.branch ?? "",
    acquiredAt: Date.now(),
  };

  const take = (): void => {
    try {
      fs.writeFileSync(file, JSON.stringify(record), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      reclaimOrThrow();
    }
  };

  const reclaimOrThrow = (): void => {
    const existing = readLeaseRecord(file);
    if (!existing) { take(); return; }
    const stale =
      existing.hostname === hostname() &&
      Date.now() - existing.acquiredAt > LEASE_TTL_MS;
    if (stale) {
      try {
        fs.unlinkSync(file);
        take();
      } catch {
        take(); // race lost; retry handles the winner's file
      }
    } else {
      throw new Error(
        `Single-writer violation: another process already owns the writer lease for ${gitRoot} ` +
          `(owner=${existing.owner}, branch=${existing.branch || "?"}, pid=${existing.pid}). ` +
          "Exactly one agent may modify production code for a patch (rec #6).",
      );
    }
  };

  take();
  return {
    token,
    release: () => {
      try {
        const current = readLeaseRecord(file);
        if (current && current.token === token) fs.unlinkSync(file);
      } catch { /* best effort */ }
    },
  };
};

export interface WorktreeLease {
  gitRoot: string;
  path: string;
  /** Effective child cwd inside the generated worktree. */
  cwd: string;
  branch: string;
  /** Read-only scouts may not modify the tree; exactly one writer per patch (rec #6). */
  writeMode: WorktreeWriteMode;
  /** Snapshot recorded before the agent started (for contamination checks, rec #1). */
  baseline?: RepoIntegrity;
  /** Cross-process writer lease held while active; released on cleanup. */
  writerLease?: { release: () => void };
}

/** Immutable repo state recorded before an agent session. */
export interface RepoIntegrity {
  commit: string;
  /** git status --porcelain output (empty when the tree is clean). */
  porcelain: string;
  /** Content hash of the git ls-files tree at this commit. */
  treeHash: string;
  /** Working directory the checks apply to (same as the lease cwd). */
  cwd: string;
  capturedAt: number;
}

export class WorktreeContaminationError extends Error {
  readonly baseline: RepoIntegrity;
  readonly after: RepoIntegrity;
  constructor(baseline: RepoIntegrity, after: RepoIntegrity) {
    super(
      `Worktree contamination detected: "${describeDrift(baseline, after).join("; ")}". ` +
        "Files changed outside the designated writer's session; stop and inspect.",
    );
    this.name = "WorktreeContaminationError";
    this.baseline = baseline;
    this.after = after;
  }
}

/** Capture the repo integrity snapshot at a given cwd. */
export const captureIntegrity = async (cwd: string): Promise<RepoIntegrity> => {
  const run = (cmd: string, args: string[]) =>
    executeFile(cmd, args, { cwd }).then((r) => r.stdout.trim());
  const [commit, porcelain, files] = await Promise.all([
    run("git", ["rev-parse", "HEAD"]),
    run("git", ["status", "--porcelain"]),
    run("git", ["ls-files"]),
  ]).catch(() => {
    throw new Error("Worktree integrity checks require a Git repository");
  });
  return { commit, porcelain, treeHash: hashFileList(files), cwd, capturedAt: Date.now() };
};

/** FNV-1a hash of the tracked-file list — a compact, stable tree fingerprint. */
const hashFileList = (list: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < list.length; i++) {
    h ^= list.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
};

/** Human-readable list of differences between two integrity snapshots. */
export const describeDrift = (before: RepoIntegrity, after: RepoIntegrity): string[] => {
  const notes: string[] = [];
  if (before.commit !== after.commit) notes.push(`HEAD moved ${before.commit.slice(0, 8)} -> ${after.commit.slice(0, 8)}`);
  if (before.treeHash !== after.treeHash) notes.push("tracked file list changed");
  const beforeSet = new Set(before.porcelain ? before.porcelain.split("\n") : []);
  const afterSet = new Set(after.porcelain ? after.porcelain.split("\n") : []);
  for (const line of afterSet) if (!beforeSet.has(line)) notes.push(`new/unstaged: ${line || "(empty)"}`);
  for (const line of beforeSet) if (!afterSet.has(line)) notes.push(`resolved: ${line || "(empty)"}`);
  if (notes.length === 0) notes.push("no change detected");
  return notes;
};

const safeLabel = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30) || "agent";

const isInside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

const worktreePrefixParts = (prefix: string): string[] | undefined => {
  const parts = prefix.split(/[\\/]+/).filter(Boolean);
  return parts.every((part) => part !== "." && part !== "..") ? parts : undefined;
};

export class WorktreeManager {
  readonly #leases = new Map<string, WorktreeLease>();
  /** Exactly one write-mode lease per gitRoot is allowed at a time (rec #6). */
  readonly #writerByRoot = new Map<string, WorktreeLease>();

  async create(
    id: string,
    cwd: string,
    name: string,
    options: { preserveSourceSubdirectory?: boolean; writeMode?: WorktreeWriteMode } = {},
  ): Promise<WorktreeLease> {
    const writeMode = options.writeMode ?? "read";
    const preserveSourceSubdirectory = options.preserveSourceSubdirectory ?? false;
    let gitRoot: string;
    let sourcePrefix = "";
    try {
      const [root, prefix] = await Promise.all([
        executeFile("git", ["rev-parse", "--show-toplevel"], { cwd }),
        preserveSourceSubdirectory
          ? executeFile("git", ["rev-parse", "--show-prefix"], { cwd })
          : Promise.resolve({ stdout: "" }),
      ]);
      const output = root.stdout.trim();
      if (!output) throw new Error("Git did not return a worktree root");
      gitRoot = fs.realpathSync(output);
      sourcePrefix = prefix.stdout.trim();
    } catch {
      throw new Error("Worktree isolation requires a Git repository");
    }

    // Enforce the single-writer rule BEFORE creating the worktree: only one
    // agent may modify production code for a given patch. The in-process map
    // catches same-process collisions; the cross-process lease file is the
    // authoritative guard over separate Kiro/Fabric processes.
    if (writeMode === "write" && this.#writerByRoot.has(gitRoot)) {
      throw new Error(
        `Single-writer violation: a producer worktree is already active for ${gitRoot}. ` +
          "Exactly one agent may modify production code for a given patch (rec #6).",
      );
    }

    const branch = `kiro-fabric/${safeLabel(name)}-${id.slice(0, 8)}`;
    const writerLease =
      writeMode === "write"
        ? acquireWriterLease(gitRoot, { owner: id, branch })
        : undefined;
    const parent = path.join(os.tmpdir(), "kiro-fabric-worktrees");
    fs.mkdirSync(parent, { recursive: true });
    const worktreePath = path.join(parent, id);
    try {
      // Reclaim any stale leftover from a previously crashed run before adding.
      if (fs.existsSync(worktreePath)) {
        try {
          await executeFile("git", ["worktree", "remove", "--force", worktreePath], {
            cwd: gitRoot,
            timeoutMs: 60_000,
          });
        } catch {
          fs.rmSync(worktreePath, { recursive: true, force: true });
        }
      }
      await executeFile("git", ["worktree", "add", "-b", branch, worktreePath, "HEAD"], {
        cwd: gitRoot,
        timeoutMs: 60_000,
      });
    } catch (error) {
      writerLease?.release();
      const detail = error instanceof Error && error.message ? `: ${error.message}` : "";
      throw new Error(`Failed to create isolated worktree for ${name}${detail}`);
    }
    const canonicalWorktreePath = fs.realpathSync(worktreePath);
    const prefix = preserveSourceSubdirectory ? worktreePrefixParts(sourcePrefix) : undefined;
    let effectiveCwd = canonicalWorktreePath;
    if (prefix && prefix.length > 0) {
      const candidate = path.resolve(canonicalWorktreePath, ...prefix);
      try {
        const canonicalCandidate = fs.realpathSync(candidate);
        if (fs.statSync(canonicalCandidate).isDirectory() && isInside(canonicalWorktreePath, canonicalCandidate)) {
          effectiveCwd = canonicalCandidate;
        }
      } catch {
        // The selected subdirectory may be untracked or absent from HEAD;
        // use the valid worktree root in that case.
      }
    }
    const lease: WorktreeLease = {
      gitRoot,
      path: worktreePath,
      cwd: effectiveCwd,
      branch,
      writeMode,
      ...(writerLease ? { writerLease } : {}),
    };
    if (writeMode === "write") this.#writerByRoot.set(gitRoot, lease);
    this.#leases.set(id, lease);
    return lease;
  }

  get(id: string): WorktreeLease | undefined {
    return this.#leases.get(id);
  }

  /** Record the repo baseline immediately before an agent starts. */
  async markStarted(id: string): Promise<RepoIntegrity> {
    const lease = this.#leases.get(id);
    if (!lease) throw new Error(`No worktree for ${id}`);
    const integrity = await captureIntegrity(lease.gitRoot);
    lease.baseline = integrity;
    return integrity;
  }

  /** Compare the current tree against the recorded baseline; returns drift notes. */
  async diffAfter(id: string): Promise<{ clean: boolean; notes: string[] }> {
    const lease = this.#leases.get(id);
    if (!lease || !lease.baseline) return { clean: true, notes: [] };
    const after = await captureIntegrity(lease.cwd);
    const notes = describeDrift(lease.baseline, after);
    const clean = notes.length === 1 && notes[0] === "no change detected";
    return { clean, notes };
  }

  /**
   * Strict post-session check: when the commit or the tracked file set changed
   * while the agent ran, raise contamination instead of continuing (rec #1).
   */
  async rejectContamination(id: string): Promise<void> {
    const lease = this.#leases.get(id);
    if (!lease || !lease.baseline) return;
    const after = await captureIntegrity(lease.gitRoot);
    if (after.commit !== lease.baseline.commit || after.treeHash !== lease.baseline.treeHash) {
      throw new WorktreeContaminationError(lease.baseline, after);
    }
  }

  async cleanup(id: string, deleteBranch = false): Promise<boolean> {
    const lease = this.#leases.get(id);
    if (!lease) return false;
    try {
      await executeFile("git", ["worktree", "remove", "--force", lease.path], {
        cwd: lease.gitRoot,
        timeoutMs: 60_000,
      });
    } catch {
      // worktree already removed; continue
    }
    if (deleteBranch) {
      try {
        await executeFile("git", ["branch", "-D", lease.branch], {
          cwd: lease.gitRoot,
          timeoutMs: 30_000,
        });
      } catch {
        // branch already gone; continue
      }
    }
    this.#leases.delete(id);
    if (lease.writeMode === "write" && this.#writerByRoot.get(lease.gitRoot) === lease) {
      this.#writerByRoot.delete(lease.gitRoot);
    }
    // Release the cross-process writer lease (rec #1/#6).
    lease.writerLease?.release();
    return true;
  }
}