import path from "node:path";
import { lstat, mkdtemp, readFile, realpath, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { FabricError } from "../errors.js";
import type { FabricLiteApi } from "../../types/fabric-lite.js";
import { commitRequest } from "../permissions.js";
import { denied, relativeSafe, safePath } from "./paths.js";
import { truncate } from "./text.js";
import { command } from "./command.js";
import type { ApiContext } from "./context.js";

export function createGitApi(ctx: ApiContext): FabricLiteApi["git"] {
  const { config, root, gate } = ctx;
  const git: FabricLiteApi["git"] = {
    async status() {
      const r = await command(["git", "status", "--porcelain=v1", "--branch"], root);
      if (r.code !== 0) throw new FabricError("RUNTIME_FAILED", r.stderr.trim());
      const lines = r.stdout.trimEnd().split("\n"),
        head = lines.shift() ?? "";
      return {
        // Porcelain v1 branch header is "## <branch>" or "## <branch>...<upstream>";
        // branch names may contain dots, so split on the upstream separator instead.
        branch: head.match(/^## (\S+?)(?:\.\.\.|\s|$)/)?.[1] ?? null,
        clean: lines.length === 0,
        entries: lines,
      };
    },
    async changedFiles(input: { base?: string; includeUntracked?: boolean } = {}) {
      const base = input.base ?? "HEAD";
      if (base.startsWith("-") || !/^[A-Za-z0-9._\/~^{}-]+$/.test(base))
        throw new FabricError("POLICY_DENIED", "Invalid Git base");
      const args = ["git", "diff", "--name-only", base, "--"];
      const r = await command(args, root);
      if (r.code !== 0) throw new FabricError("RUNTIME_FAILED", r.stderr.trim());
      const files = r.stdout.trim().split("\n").filter(Boolean);
      if (input.includeUntracked) {
        const u = await command(["git", "ls-files", "--others", "--exclude-standard"], root);
        files.push(...u.stdout.trim().split("\n").filter(Boolean));
      }
      return [...new Set(files)].filter((x) => !denied.test(x));
    },
    async diff(input: { base?: string; paths?: string[]; maxChars?: number } = {}) {
      for (const p of input.paths ?? []) relativeSafe(root, p);
      const base = input.base ?? "HEAD";
      if (base.startsWith("-") || !/^[A-Za-z0-9._\/~^{}-]+$/.test(base))
        throw new FabricError("POLICY_DENIED", "Invalid Git base");
      const r = await command(["git", "diff", base, "--", ...(input.paths ?? [])], root);
      if (r.code !== 0) throw new FabricError("RUNTIME_FAILED", r.stderr.trim());
      const t = truncate(r.stdout, input.maxChars ?? 30000);
      return { diff: t.text, truncated: t.truncated };
    },
    async log(input: { maxCount?: number; ref?: string } = {}) {
      const max = Math.min(Math.max(input.maxCount ?? 20, 1), 100);
      const ref = input.ref ?? "HEAD";
      if (ref.startsWith("-") || !/^[A-Za-z0-9._\/~^{}-]+$/.test(ref))
        throw new FabricError("POLICY_DENIED", "Invalid Git ref");
      const r = await command(
        [
          "git",
          "--no-pager",
          "log",
          `--max-count=${max}`,
          "--date=iso-strict",
          "--format=%H%x09%ad%x09%an%x09%s",
          ref,
        ],
        root,
      );
      if (r.code !== 0) throw new FabricError("RUNTIME_FAILED", r.stderr.trim());
      const t = truncate(r.stdout, 30000);
      return { text: t.text, truncated: t.truncated };
    },
    async show(input: { ref?: string; path?: string; maxChars?: number } = {}) {
      const ref = input.ref ?? "HEAD";
      if (ref.startsWith("-") || !/^[A-Za-z0-9._\/~^{}-]+$/.test(ref))
        throw new FabricError("POLICY_DENIED", "Invalid Git ref");
      let spec = ref;
      if (input.path) {
        const absolute = relativeSafe(root, input.path);
        const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
        if (!relative) throw new FabricError("POLICY_DENIED", "Invalid Git path");
        spec = `${ref}:${relative}`;
      }
      const r = await command(
        ["git", "--no-pager", "show", "--no-ext-diff", "--no-textconv", spec],
        root,
      );
      if (r.code !== 0) throw new FabricError("RUNTIME_FAILED", r.stderr.trim());
      const t = truncate(r.stdout, Math.min(input.maxChars ?? 30000, 30000));
      return { text: t.text, truncated: t.truncated };
    },
    async branches() {
      const r = await command(
        [
          "git",
          "for-each-ref",
          "--format=%(refname:short)%09%(objectname)%09%(upstream:short)",
          "refs/heads",
          "refs/remotes",
        ],
        root,
      );
      if (r.code !== 0) throw new FabricError("RUNTIME_FAILED", r.stderr.trim());
      return r.stdout.trim().split("\n").filter(Boolean);
    },
    async remotes() {
      const r = await command(["git", "remote", "-v"], root);
      if (r.code !== 0) throw new FabricError("RUNTIME_FAILED", r.stderr.trim());
      return r.stdout.trim().split("\n").filter(Boolean);
    },
    async commit(input: { message: string; paths: string[] }) {
      if (!config.git.allowCommit)
        throw new FabricError("POLICY_DENIED", "Local Git commits are disabled by project policy");
      if (
        typeof input?.message !== "string" ||
        input.message.trim() !== input.message ||
        input.message.length < 1 ||
        input.message.length > 200 ||
        /[\u0000-\u001f\u007f]/.test(input.message)
      )
        throw new FabricError(
          "POLICY_DENIED",
          "Commit message must be one trimmed line of 1-200 safe characters",
        );
      if (
        !Array.isArray(input.paths) ||
        input.paths.length === 0 ||
        input.paths.some((candidate) => typeof candidate !== "string" || candidate.length === 0)
      )
        throw new FabricError("POLICY_DENIED", "Commit requires non-empty explicit paths");
      const repo = await command(["git", "rev-parse", "--show-toplevel"], root);
      if (repo.code !== 0)
        throw new FabricError("RUNTIME_FAILED", repo.stderr.trim() || "Not a Git repository");
      if ((await realpath(repo.stdout.trim())) !== (await realpath(root)))
        throw new FabricError(
          "POLICY_DENIED",
          "Git repository root must equal the Fabric project root",
        );
      const repository = await realpath(root);
      const stagedBefore = await command(["git", "diff", "--cached", "--name-only"], root);
      if (stagedBefore.code !== 0)
        throw new FabricError("RUNTIME_FAILED", stagedBefore.stderr.trim());
      if (stagedBefore.stdout.trim())
        throw new FabricError(
          "POLICY_DENIED",
          "Refusing to commit with pre-existing staged changes",
        );
      const paths: string[] = [];
      const entries: Array<
        { relative: string; absolute: string; mode: string } | { relative: string; deleted: true }
      > = [];
      for (const candidate of input.paths) {
        const absolute = relativeSafe(root, candidate);
        const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
        if (!relative || relative === ".")
          throw new FabricError("POLICY_DENIED", `Path is denied: ${candidate}`);
        try {
          const info = await lstat(absolute);
          if (!info.isFile())
            throw new FabricError(
              "POLICY_DENIED",
              `Commit paths must name regular files: ${candidate}`,
            );
          const checked = await safePath(root, candidate);
          const canonical = await realpath(checked);
          const canonicalRelative = path.relative(repository, canonical).replaceAll(path.sep, "/");
          entries.push({
            relative: canonicalRelative,
            absolute: canonical,
            mode: (info.mode & 0o111) !== 0 ? "100755" : "100644",
          });
        } catch (error) {
          if (error instanceof FabricError) throw error;
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          const tracked = await command(
            ["git", "ls-files", "--error-unmatch", "--", relative],
            root,
          );
          if (tracked.code !== 0)
            throw new FabricError(
              "POLICY_DENIED",
              `Commit path does not exist and is not a tracked deletion: ${candidate}`,
            );
          entries.push({ relative, deleted: true });
        }
        paths.push(relative);
      }
      const canonicalPaths = [
        ...new Set(
          entries.map((entry) =>
            "absolute" in entry ? entry.absolute : path.join(repository, entry.relative),
          ),
        ),
      ];
      if (!(await gate.authorize(commitRequest(input.message, repository, canonicalPaths))))
        throw new FabricError("POLICY_DENIED", "Local Git commit was not approved");
      const unique = [...new Set(paths)];
      const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "fabric-index-"));
      const temporaryIndex = path.join(temporaryDirectory, "index");
      const indexEnv: NodeJS.ProcessEnv = { ...process.env, GIT_INDEX_FILE: temporaryIndex };
      try {
        const initialized = await command(["git", "read-tree", "HEAD"], root, 30000, indexEnv);
        if (initialized.code !== 0)
          throw new FabricError(
            "RUNTIME_FAILED",
            initialized.stderr.trim() || "Git temporary index initialization failed",
          );
        for (const entry of entries.filter(
          (value, index) =>
            entries.findIndex((candidate) => candidate.relative === value.relative) === index,
        )) {
          if ("deleted" in entry) {
            const removed = await command(
              [
                "git",
                "-c",
                "core.fsmonitor=false",
                "update-index",
                "--force-remove",
                "--",
                entry.relative,
              ],
              root,
              30000,
              indexEnv,
            );
            if (removed.code !== 0)
              throw new FabricError(
                "RUNTIME_FAILED",
                removed.stderr.trim() || "Git index deletion failed",
              );
            continue;
          }
          const content = await readFile(entry.absolute);
          if (content.length > config.filesystem.maxCharsPerFile)
            throw new FabricError(
              "BUDGET_EXCEEDED",
              `Commit file exceeds ${config.filesystem.maxCharsPerFile} bytes: ${entry.relative}`,
            );
          const hashed = await command(
            ["git", "hash-object", "-w", "--stdin"],
            root,
            30000,
            undefined,
            100000,
            content,
          );
          if (hashed.code !== 0 || !/^[0-9a-f]{40,64}$/.test(hashed.stdout.trim()))
            throw new FabricError(
              "RUNTIME_FAILED",
              hashed.stderr.trim() || "Git object hashing failed",
            );
          const stagedEntry = await command(
            [
              "git",
              "-c",
              "core.fsmonitor=false",
              "update-index",
              "--add",
              "--cacheinfo",
              `${entry.mode},${hashed.stdout.trim()},${entry.relative}`,
            ],
            root,
            30000,
            indexEnv,
          );
          if (stagedEntry.code !== 0)
            throw new FabricError(
              "RUNTIME_FAILED",
              stagedEntry.stderr.trim() || "Git index update failed",
            );
        }
        const staged = await command(
          ["git", "diff", "--cached", "--name-only"],
          root,
          30000,
          indexEnv,
        );
        if (staged.code !== 0) throw new FabricError("RUNTIME_FAILED", staged.stderr.trim());
        const committedPaths = staged.stdout.trim().split("\n").filter(Boolean);
        if (committedPaths.length === 0)
          throw new FabricError("RUNTIME_FAILED", "Explicit paths contain no changes to commit");
        if (committedPaths.some((file) => !unique.includes(file)))
          throw new FabricError(
            "POLICY_DENIED",
            "Git staged a path outside the explicit commit set",
          );
        const [oldHead, branch, tree] = await Promise.all([
          command(["git", "rev-parse", "HEAD"], root),
          command(["git", "symbolic-ref", "--quiet", "--short", "HEAD"], root),
          command(["git", "-c", "core.fsmonitor=false", "write-tree"], root, 30000, indexEnv),
        ]);
        if (oldHead.code !== 0 || tree.code !== 0)
          throw new FabricError("RUNTIME_FAILED", oldHead.stderr.trim() || tree.stderr.trim());
        if (branch.code !== 0 || !branch.stdout.trim())
          throw new FabricError("POLICY_DENIED", "Local commits require an attached branch");
        const created = await command(
          [
            "git",
            "-c",
            "commit.gpgSign=false",
            "commit-tree",
            tree.stdout.trim(),
            "-p",
            oldHead.stdout.trim(),
          ],
          root,
          30000,
          undefined,
          100000,
          `${input.message}\n`,
        );
        if (created.code !== 0 || !/^[0-9a-f]{40,64}$/.test(created.stdout.trim()))
          throw new FabricError(
            "RUNTIME_FAILED",
            created.stderr.trim() || "Git commit object creation failed",
          );
        // Build the post-commit index before moving the branch. The real index is
        // untouched until this succeeds, and replacing it atomically avoids
        // staging unrelated worktree changes or exposing a partial index.
        const indexPathResult = await command(["git", "rev-parse", "--git-path", "index"], root);
        if (indexPathResult.code !== 0 || !indexPathResult.stdout.trim())
          throw new FabricError(
            "RUNTIME_FAILED",
            indexPathResult.stderr.trim() || "Git index path lookup failed",
          );
        const realIndex = path.resolve(root, indexPathResult.stdout.trim());
        const syncDirectory = await mkdtemp(
          path.join(path.dirname(realIndex), ".fabric-index-sync-"),
        );
        const syncIndex = path.join(syncDirectory, "index");
        try {
          const synchronized = await command(
            ["git", "read-tree", created.stdout.trim()],
            root,
            30000,
            { ...indexEnv, GIT_INDEX_FILE: syncIndex },
          );
          if (synchronized.code !== 0)
            throw new FabricError(
              "RUNTIME_FAILED",
              synchronized.stderr.trim() || "Git index synchronization failed",
            );
          const ref = `refs/heads/${branch.stdout.trim()}`;
          const updated = await command(
            ["git", "update-ref", ref, created.stdout.trim(), oldHead.stdout.trim()],
            root,
          );
          if (updated.code !== 0)
            throw new FabricError(
              "RUNTIME_FAILED",
              updated.stderr.trim() || "Git branch update failed",
            );
          await rename(syncIndex, realIndex);
        } finally {
          await rm(syncDirectory, { recursive: true, force: true });
        }
        return {
          hash: created.stdout.trim(),
          branch: branch.stdout.trim(),
          message: input.message,
          paths: committedPaths,
        };
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    },
  };
  return git;
}
