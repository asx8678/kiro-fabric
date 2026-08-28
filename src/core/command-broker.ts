/**
 * Central command broker — cache-heavy, commit-scoped execution of expensive
 * commands that multiple agents would otherwise rerun independently.
 *
 * Motivation (benchmark findings): subagents independently ran the full test
 * suite, coverage, and repo scans, causing duplicate credit use, repeated
 * compilation, Postgres contention, and inconsistent conclusions. The broker
 * owns expensive commands, keys each result by (commit/tree-hash + command +
 * environment + runtime), executes once, and serves the cached artifact to
 * every requester. It records command metadata (exit code, duration,
 * stdout/stderr, commit, seed, db id) so the synthesizer can prove a command
 * was actually executed (rec #7).
 */

import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Source-of-truth command spec used to settle binary facts (rec #7). */
interface SourceCommand {
  command: string;
  args: string[];
}

/** Source-of-truth commands used to settle binary facts (rec #7). */
export const SOURCE_OF_TRUTH: Record<string, SourceCommand> = {
  "file-tracked": { command: "git", args: ["ls-files"] },
  "tree-clean": { command: "git", args: ["status", "--porcelain"] },
  "pinned-commit": { command: "git", args: ["rev-parse", "HEAD"] },
};

export interface CommandMeta {
  command: string;
  args: string[];
  /** Git commit SHA the command ran against. */
  commit: string;
  /** Content-sensitive working-tree hash for tracked and untracked entries. */
  treeHash: string;
  /** Optional test seed, recorded for reproducibility. */
  seed?: string;
  /** Optional database identifier, e.g. konstruct_test_fabric_writer_01. */
  db?: string;
  cwd: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  cached: boolean;
  meta: CommandMeta;
}

const RUN_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const WORKSPACE_HASH_MAX_FILES = 20_000;
const WORKSPACE_HASH_MAX_BYTES = 512 * 1024 * 1024;
const GIT_METADATA_MAX_BYTES = 128 * 1024 * 1024;

const gitBytes = (cwd: string, args: string[]): Buffer =>
  execFileSync("git", args, {
    cwd,
    encoding: "buffer",
    timeout: 20_000,
    maxBuffer: GIT_METADATA_MAX_BYTES,
    stdio: ["ignore", "pipe", "ignore"],
  });

const nulPaths = (value: Buffer): string[] =>
  value.toString("utf8").split("\0").filter((entry) => entry.length > 0);

const inside = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    !path.isAbsolute(relative) &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`)
  );
};

const statSignature = (stat: fs.BigIntStats): string =>
  `${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}`;

export class CommandBroker {
  readonly #cacheDir: string;
  /** Dedupe concurrent identical executions to a single process. */
  readonly #inFlight = new Map<string, Promise<CommandResult>>();

  constructor(cacheDir?: string) {
    this.#cacheDir = cacheDir ?? path.join(os.tmpdir(), "kiro-fabric-command-cache");
    fs.mkdirSync(this.#cacheDir, { recursive: true });
  }

  /**
   * Hash HEAD, the exact index, and the bytes/modes of every tracked or
   * untracked workspace entry. Porcelain alone is insufficient: unstaged and
   * untracked status records can remain byte-identical across content rewrites.
   */
  static commitHash(cwd: string): string {
    try {
      return execFileSync("git", ["rev-parse", "--verify", "HEAD"], { cwd, encoding: "utf8", timeout: 20_000 }).trim();
    } catch {
      return "no-git";
    }
  }

  static treeHash(cwd: string): string {
    let workspaceDiscovered = false;
    try {
      const root = fs.realpathSync(
        execFileSync("git", ["rev-parse", "--show-toplevel"], {
          cwd,
          encoding: "utf8",
          timeout: 20_000,
        }).trim(),
      );
      workspaceDiscovered = true;
      const headBefore = gitBytes(root, ["rev-parse", "--verify", "HEAD"]);
      const indexBefore = gitBytes(root, ["ls-files", "--stage", "-z"]);
      const pathsBefore = gitBytes(root, [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ]);
      const statusBefore = gitBytes(root, [
        "status",
        "--porcelain=v2",
        "-z",
        "--untracked-files=all",
        "--ignore-submodules=none",
      ]);
      const relativePaths = [...new Set(nulPaths(pathsBefore))]
        .sort((left, right) => left.localeCompare(right));

      const hash = createHash("sha256");
      hash.update("kiro-fabric-workspace-v2\0");
      hash.update("head:").update(String(headBefore.byteLength)).update(":").update(headBefore);
      hash.update("\0index:").update(String(indexBefore.byteLength)).update(":").update(indexBefore);
      hash.update("\0status:").update(String(statusBefore.byteLength)).update(":").update(statusBefore);
      let bytes = 0;
      let entries = 0;
      const hashEntry = (relative: string): void => {
        entries += 1;
        if (entries > WORKSPACE_HASH_MAX_FILES) {
          throw new Error(`workspace hash exceeds ${WORKSPACE_HASH_MAX_FILES} files`);
        }
        const absolute = path.resolve(root, relative);
        if (!inside(root, absolute) || absolute === root) {
          throw new Error(`git reported an unsafe workspace path: ${relative}`);
        }
        hash.update("\0path\0")
          .update(String(Buffer.byteLength(relative, "utf8")))
          .update(":")
          .update(relative);
        let before: fs.BigIntStats;
        try {
          before = fs.lstatSync(absolute, { bigint: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            hash.update("\0absent");
            return;
          }
          throw error;
        }
        hash.update("\0mode\0").update(String(before.mode));
        if (before.isSymbolicLink()) {
          const target = fs.readlinkSync(absolute);
          const after = fs.lstatSync(absolute, { bigint: true });
          if (statSignature(before) !== statSignature(after)) {
            throw new Error(`workspace entry changed while hashing: ${relative}`);
          }
          hash.update("\0symlink:")
            .update(String(Buffer.byteLength(target, "utf8")))
            .update(":")
            .update(target);
        } else if (before.isFile()) {
          const size = Number(before.size);
          bytes += size;
          if (!Number.isSafeInteger(size) || bytes > WORKSPACE_HASH_MAX_BYTES) {
            throw new Error(`workspace hash exceeds ${WORKSPACE_HASH_MAX_BYTES} bytes`);
          }
          const content = fs.readFileSync(absolute);
          const after = fs.lstatSync(absolute, { bigint: true });
          if (content.byteLength !== size || statSignature(before) !== statSignature(after)) {
            throw new Error(`workspace entry changed while hashing: ${relative}`);
          }
          hash.update("\0file:").update(String(content.byteLength)).update(":").update(content);
        } else if (before.isDirectory()) {
          // Git reports a nested repository as a single directory. Porcelain
          // records its broad commit/dirty state, but not the bytes behind a
          // same-status rewrite, so deterministically descend into its worktree.
          const children = fs.readdirSync(absolute)
            .filter((name) => name !== ".git")
            .sort((left, right) => left.localeCompare(right));
          hash.update("\0directory:").update(String(children.length));
          for (const child of children) {
            hashEntry(path.join(relative, child));
          }
          const after = fs.lstatSync(absolute, { bigint: true });
          const childrenAfter = fs.readdirSync(absolute)
            .filter((name) => name !== ".git")
            .sort((left, right) => left.localeCompare(right));
          if (
            statSignature(before) !== statSignature(after) ||
            children.length !== childrenAfter.length ||
            children.some((name, index) => name !== childrenAfter[index])
          ) {
            throw new Error(`workspace entry changed while hashing: ${relative}`);
          }
        } else {
          throw new Error(`unsupported workspace entry while hashing: ${relative}`);
        }
      };
      for (const relative of relativePaths) {
        hashEntry(relative);
      }

      const headAfter = gitBytes(root, ["rev-parse", "--verify", "HEAD"]);
      const indexAfter = gitBytes(root, ["ls-files", "--stage", "-z"]);
      const pathsAfter = gitBytes(root, [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ]);
      const statusAfter = gitBytes(root, [
        "status",
        "--porcelain=v2",
        "-z",
        "--untracked-files=all",
        "--ignore-submodules=none",
      ]);
      if (
        !headBefore.equals(headAfter) ||
        !indexBefore.equals(indexAfter) ||
        !pathsBefore.equals(pathsAfter) ||
        !statusBefore.equals(statusAfter)
      ) {
        throw new Error("workspace changed while hashing");
      }
      return `sha256:${hash.digest("hex")}`;
    } catch (error) {
      if (workspaceDiscovered) throw error;
      return "no-git";
    }
  }

  /**
   * Execute `command`, or return the cached result when a matching key exists.
   * Concurrent callers with the same key share one execution (dedupe).
   */
  async execute(meta: CommandMeta): Promise<CommandResult> {
    const key = this.keyFor(meta);
    const cached = this.#readCache(key);
    if (cached) return { ...cached, cached: true };

    const existing = this.#inFlight.get(key);
    if (existing) return existing.then((res) => ({ ...res, cached: true }));

    const run = this.#runInner(meta).then((res) => {
      this.#inFlight.delete(key);
      return res;
    });
    this.#inFlight.set(key, run);
    return run;
  }

  /** Source-of-truth binary check used by the contradiction resolver. */
  async sourceOfTruth(which: keyof typeof SOURCE_OF_TRUTH, meta: CommandMeta): Promise<CommandResult> {
    const spec = SOURCE_OF_TRUTH[which];
    if (!spec) throw new Error(`Unknown source-of-truth command: ${String(which)}`);
    return this.execute({ ...meta, command: spec.command, args: spec.args });
  }

  keyFor(meta: CommandMeta): string {
    // Boundary-correct argument serialization (arg boundaries can never collide)
    // plus cwd so the same argv in a different repo does not share a cache key.
    const argv = meta.args.map((a) => JSON.stringify(a)).join("\u0000");
    const payload = [
      meta.commit,
      meta.treeHash,
      meta.cwd,
      meta.command,
      argv,
      meta.seed ?? "",
      meta.db ?? "",
    ].join("\u0000");
    return createHash("sha256").update(payload).digest("hex");
  }

  async #runInner(meta: CommandMeta): Promise<CommandResult> {
    const started = Date.now();
    const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
      execFile(
        meta.command,
        meta.args,
        { cwd: meta.cwd, encoding: "utf8", maxBuffer: MAX_OUTPUT_BYTES, timeout: RUN_TIMEOUT_MS },
        (error, stdout, stderr) => {
          if (error) {
            const errno = error as NodeJS.ErrnoException;
            const code: number = typeof errno.code === "number" && Number.isFinite(errno.code) ? errno.code : 1;
            resolve({ stdout: stdout ?? "", stderr: stderr ?? String(error.message ?? error), exitCode: code });
            return;
          }
          resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 });
        },
      );
    });

    const durationMs = Date.now() - started;
    const res: CommandResult = { ...result, durationMs, cached: false, meta };
    this.#writeCache(this.keyFor(meta), res);
    return res;
  }

  /**
   * Record an externally-produced command result (e.g. a coverage report read
   * from disk rather than rerun). Marked cached so it is served to every
   * requester without re-execution.
   */
  recordExternal(meta: CommandMeta, stdout: string): void {
    const res: CommandResult = { stdout, stderr: "", exitCode: 0, durationMs: 0, cached: true, meta };
    this.#writeCache(this.keyFor(meta), res);
  }

  #cachePath(key: string): string {
    return path.join(this.#cacheDir, `${key}.json`);
  }

  #readCache(key: string): CommandResult | undefined {
    try {
      const file = this.#cachePath(key);
      if (!fs.existsSync(file)) return undefined;
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<CommandResult>;
      // structural validation guards against cache poisoning / schema drift
      const meta = parsed.meta;
      const valid =
        parsed !== null &&
        typeof parsed === "object" &&
        typeof meta?.command === "string" &&
        typeof meta?.treeHash === "string" &&
        typeof meta?.commit === "string" &&
        typeof meta?.cwd === "string" &&
        Array.isArray(meta?.args) &&
        typeof parsed.stdout === "string" &&
        typeof parsed.stderr === "string" &&
        typeof parsed.exitCode === "number";
      return valid ? (parsed as CommandResult) : undefined;
    } catch {
      return undefined;
    }
  }

  #writeCache(key: string, result: CommandResult): void {
    // atomic publish: write a temp sibling then rename so a crash never leaves
    // a torn cache entry that would be silently trusted.
    const file = this.#cachePath(key);
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(result, null, 2));
    fs.renameSync(tmp, file);
  }
}
