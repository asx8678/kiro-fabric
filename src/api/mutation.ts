import path from "node:path";
import { randomBytes } from "node:crypto";
import { lstat, mkdtemp, realpath, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { FabricError } from "../errors.js";
import type { FabricLiteApi } from "../../types/fabric-lite.js";
import { safeWritePath } from "./paths.js";
import { truncate } from "./text.js";
import { command } from "./command.js";
import { invalidArguments, isArgumentRecord } from "./args.js";
import type { ApiContext, MutationMode } from "./context.js";

export function createMutationApi(ctx: ApiContext): FabricLiteApi["mutate"] {
  const { config, root } = ctx;
  const mutation: FabricLiteApi["mutate"] = {
    async begin(input?: { mode?: MutationMode; label?: string }) {
      if (ctx.mutationSession)
        throw new FabricError("RUNTIME_FAILED", "A mutation session is already active");
      if (!config.mutation.enabled)
        throw new FabricError(
          "POLICY_DENIED",
          "The mutation workflow is disabled by project policy",
        );
      if (input !== undefined && !isArgumentRecord(input))
        invalidArguments("fabric.mutate.begin", "expected an options object");
      const requested = input as { mode?: unknown; label?: unknown } | undefined;
      const mode = (requested?.mode ?? config.mutation.require) as MutationMode;
      if (mode !== "clean" && mode !== "checkpoint")
        invalidArguments("fabric.mutate.begin", "mode must be clean or checkpoint");
      const label = requested?.label;
      if (
        label !== undefined &&
        (typeof label !== "string" || label.length > 200 || /[\u0000-\u001f\u007f]/.test(label))
      ) {
        invalidArguments("fabric.mutate.begin", "label must be at most 200 safe characters");
      }
      const repository = await command(["git", "rev-parse", "--show-toplevel"], root);
      const baseHeadResult = await command(["git", "rev-parse", "HEAD"], root);
      if (repository.code !== 0 || baseHeadResult.code !== 0 || !baseHeadResult.stdout.trim()) {
        throw new FabricError(
          "POLICY_DENIED",
          "Mutation workflow requires a Git repository with HEAD",
        );
      }
      const repositoryRoot = path.resolve(repository.stdout.trim());
      if ((await realpath(repositoryRoot)) !== (await realpath(root)))
        throw new FabricError(
          "POLICY_DENIED",
          "Git repository root must equal the Fabric project root",
        );
      const baseHead = baseHeadResult.stdout.trim();
      if (mode === "clean") {
        const status = await command(
          ["git", "-c", "core.fsmonitor=false", "status", "--porcelain=v1"],
          root,
        );
        if (status.code !== 0)
          throw new FabricError("RUNTIME_FAILED", status.stderr.trim() || "Git status failed");
        const dirty = status.stdout.split(/\r?\n/).filter(Boolean);
        if (dirty.length > 0) {
          const paths = dirty.slice(0, 10).map((line) => (line.length > 3 ? line.slice(3) : line));
          throw new FabricError(
            "POLICY_DENIED",
            `Mutation requires a clean worktree; dirty paths: ${paths.join(", ")}`,
          );
        }
        ctx.mutationSession = {
          checkpointId: baseHead,
          baseHead,
          mode,
          ...(label === undefined ? {} : { label }),
          createdFiles: new Set(),
          modifiedFiles: new Set(),
        };
        return {
          checkpoint: { id: baseHead, mode, baseHead },
          guidance: `Mutation session started from clean HEAD ${baseHead}. Review the diff before completing or roll back to this commit.`,
        };
      }
      const checkpointId = `cp_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
      const checkpointRef = `refs/fabric-lite/checkpoints/${checkpointId}`;
      const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "fabric-mutation-index-"));
      const temporaryIndex = path.join(temporaryDirectory, "index");
      const indexEnv: NodeJS.ProcessEnv = { ...process.env, GIT_INDEX_FILE: temporaryIndex };
      try {
        const initialized = await command(["git", "read-tree", "HEAD"], root, 30000, indexEnv);
        if (initialized.code !== 0)
          throw new FabricError(
            "RUNTIME_FAILED",
            initialized.stderr.trim() || "Git checkpoint index initialization failed",
          );
        const added = await command(
          ["git", "-c", "core.fsmonitor=false", "add", "-A"],
          root,
          30000,
          indexEnv,
        );
        if (added.code !== 0)
          throw new FabricError(
            "RUNTIME_FAILED",
            added.stderr.trim() || "Git checkpoint staging failed",
          );
        const tree = await command(
          ["git", "-c", "core.fsmonitor=false", "write-tree"],
          root,
          30000,
          indexEnv,
        );
        if (tree.code !== 0 || !tree.stdout.trim())
          throw new FabricError(
            "RUNTIME_FAILED",
            tree.stderr.trim() || "Git checkpoint tree creation failed",
          );
        const message = `fabric-lite mutation checkpoint${label ? ` ${label}` : ""}`;
        const created = await command(
          ["git", "-c", "commit.gpgSign=false", "commit-tree", tree.stdout.trim(), "-p", baseHead],
          root,
          30000,
          indexEnv,
          100000,
          `${message}\n`,
        );
        if (created.code !== 0 || !/^[0-9a-f]{40,64}$/.test(created.stdout.trim()))
          throw new FabricError(
            "RUNTIME_FAILED",
            created.stderr.trim() || "Git checkpoint commit creation failed",
          );
        const updated = await command(
          ["git", "update-ref", checkpointRef, created.stdout.trim()],
          root,
        );
        if (updated.code !== 0)
          throw new FabricError(
            "RUNTIME_FAILED",
            updated.stderr.trim() || "Git checkpoint ref creation failed",
          );
        ctx.mutationSession = {
          checkpointId: created.stdout.trim(),
          checkpointRef,
          baseHead,
          mode,
          ...(label === undefined ? {} : { label }),
          createdFiles: new Set(),
          modifiedFiles: new Set(),
        };
        return {
          checkpoint: { id: created.stdout.trim(), mode, baseHead },
          guidance: `Mutation checkpoint ${created.stdout.trim()} created without changing the branch or real index. Gitignored files are not included.`,
        };
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    },
    async diff(input?: { maxChars?: number }) {
      const session = ctx.mutationSession;
      if (!session) throw new FabricError("RUNTIME_FAILED", "No active mutation session");
      if (input !== undefined && !isArgumentRecord(input))
        invalidArguments("fabric.mutate.diff", "expected an options object");
      const requested = input as { maxChars?: unknown } | undefined;
      const requestedMax = requested?.maxChars;
      if (
        requestedMax !== undefined &&
        (!Number.isInteger(requestedMax) || (requestedMax as number) < 0)
      )
        invalidArguments("fabric.mutate.diff", "maxChars must be a nonnegative integer");
      const maxChars = Math.min(
        (requestedMax as number | undefined) ?? config.mutation.maxDiffChars,
        config.mutation.maxDiffChars,
      );
      // 'git diff <checkpoint>' excludes untracked files, so session-created
      // files would be invisible to mutate.review() — the riskiest change class.
      // Stage created and modified files into a throwaway index and diff it
      // cached against the checkpoint tree so new-file contents are reviewed too.
      const targets = [...session.createdFiles, ...session.modifiedFiles];
      const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "fabric-mutation-diff-"));
      const temporaryIndex = path.join(temporaryDirectory, "index");
      const indexEnv: NodeJS.ProcessEnv = { ...process.env, GIT_INDEX_FILE: temporaryIndex };
      let stdout: string;
      let stdoutTruncated: boolean;
      try {
        const initialized = await command(
          ["git", "read-tree", session.checkpointId],
          root,
          30000,
          indexEnv,
        );
        if (initialized.code !== 0)
          throw new FabricError(
            "RUNTIME_FAILED",
            initialized.stderr.trim() || "Git diff index initialization failed",
          );
        if (targets.length > 0) {
          const added = await command(
            ["git", "-c", "core.fsmonitor=false", "add", "--", ...targets],
            root,
            30000,
            indexEnv,
          );
          if (added.code !== 0)
            throw new FabricError(
              "RUNTIME_FAILED",
              added.stderr.trim() || "Git diff staging failed",
            );
        }
        const result = await command(
          ["git", "-c", "core.fsmonitor=false", "diff", "--cached", session.checkpointId],
          root,
          30000,
          indexEnv,
          maxChars + 1,
        );
        if (result.code !== 0)
          throw new FabricError(
            "RUNTIME_FAILED",
            result.stderr.trim() || "Git mutation diff failed",
          );
        stdout = result.stdout;
        stdoutTruncated = result.stdoutTruncated;
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
      const bounded = truncate(stdout, maxChars);
      return {
        diff: bounded.text,
        truncated: bounded.truncated || stdoutTruncated,
        createdFiles: [...session.createdFiles],
        changedFiles: [...session.modifiedFiles],
      };
    },
    async review(input?: { instruction?: string }) {
      const session = ctx.mutationSession;
      if (!session) throw new FabricError("RUNTIME_FAILED", "No active mutation session");
      if (input !== undefined && !isArgumentRecord(input))
        invalidArguments("fabric.mutate.review", "expected an options object");
      const instruction = (input as { instruction?: unknown } | undefined)?.instruction;
      if (
        instruction !== undefined &&
        (typeof instruction !== "string" || instruction.length === 0)
      )
        invalidArguments("fabric.mutate.review", "instruction must be a non-empty string");
      const diff = await mutation.diff({
        maxChars: Math.min(
          config.mutation.maxDiffChars,
          Math.max(0, config.budgets.maxContextCharsPerCall - 256),
        ),
      });
      const outputSchema = {
        type: "object",
        required: ["approved", "issues", "summary"],
        properties: {
          approved: { type: "boolean" },
          issues: { type: "array", items: { type: "string" } },
          summary: { type: "string" },
        },
      };
      return ctx.aiRun({
        instruction:
          instruction ??
          "Review this Fabric Lite mutation diff for correctness and safety. Identify risks, regressions, or missing changes and decide whether it is safe to complete.",
        context: JSON.stringify(diff),
        role: "verifier",
        outputSchema,
      });
    },
    async rollback() {
      const session = ctx.mutationSession;
      if (!session) throw new FabricError("RUNTIME_FAILED", "No active mutation session");
      const restored = await command(
        [
          "git",
          "-c",
          "core.fsmonitor=false",
          "restore",
          `--source=${session.checkpointId}`,
          "--worktree",
          "--",
          ".",
        ],
        root,
      );
      if (restored.code !== 0)
        throw new FabricError(
          "RUNTIME_FAILED",
          restored.stderr.trim() || "Git mutation rollback failed",
        );
      const removedFiles: string[] = [];
      for (const relative of session.createdFiles) {
        try {
          const target = await safeWritePath(root, relative, config.filesystem.allowWrite);
          const info = await lstat(target.absolute);
          if (!info.isFile() || info.isSymbolicLink()) continue;
          await unlink(target.absolute);
          removedFiles.push(relative);
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code === "ENOENT" ||
            (error instanceof FabricError && error.code === "POLICY_DENIED")
          )
            continue;
          throw error;
        }
      }
      if (session.checkpointRef) {
        const removed = await command(["git", "update-ref", "-d", session.checkpointRef], root);
        if (removed.code !== 0)
          throw new FabricError(
            "RUNTIME_FAILED",
            removed.stderr.trim() || "Git checkpoint ref deletion failed",
          );
      }
      ctx.mutationSession = undefined;
      return {
        restored: true as const,
        checkpoint: session.checkpointId,
        removedFiles,
        guidance: `Tracked files were restored to ${session.checkpointId}; files created during this session were removed where safely allowlisted.`,
      };
    },
    async complete() {
      const session = ctx.mutationSession;
      if (!session) throw new FabricError("RUNTIME_FAILED", "No active mutation session");
      ctx.mutationSession = undefined;
      const checkpoint = {
        id: session.checkpointId,
        mode: session.mode,
        baseHead: session.baseHead,
      };
      const created = [...session.createdFiles];
      const rollbackGuidance = session.checkpointRef
        ? `To roll back tracked files, run git restore --source=${session.checkpointId} --worktree -- .; delete created files manually (${created.join(", ") || "none"}); then clean up the checkpoint with git update-ref -d ${session.checkpointRef}.`
        : `To roll back tracked files, run git restore --source=${session.checkpointId} --worktree -- .; delete created files manually (${created.join(", ") || "none"}).`;
      return { checkpoint, createdFiles: created, rollbackGuidance };
    },
  };
  return mutation;
}
