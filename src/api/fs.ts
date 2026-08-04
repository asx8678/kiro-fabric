import path from "node:path";
import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath, readFile, stat } from "node:fs/promises";
import fg from "fast-glob";
import { FabricError } from "../errors.js";
import type {
  FabricLiteApi,
  FileReadResult,
  GrepMatch,
  GrepResult,
} from "../../types/fabric-lite.js";
import {
  denied,
  deniedGlobs,
  normalizedRelative,
  safePath,
  safeWritePath,
  descriptorPath,
  descriptorChildPath,
  verifyOpenedWriteTarget,
} from "./paths.js";
import { scanGrepFile, textContent, truncate } from "./text.js";
import {
  aliasedArguments,
  argumentRecord,
  invalidArguments,
  optionalNumber,
  positionalArguments,
  requiredString,
} from "./args.js";
import type { ApiContext } from "./context.js";

export function createFsApi(ctx: ApiContext): FabricLiteApi["fs"] {
  const { config, root, mutationWriteRequired, recordMutationWrite } = ctx;
  const fsApi: FabricLiteApi["fs"] = {
    async read(...args: unknown[]) {
      const rawInput = positionalArguments("fabric.fs.read", args, ["path"]);
      const input = aliasedArguments(rawInput, {
        file: "path",
        start: "startLine",
        max: "maxChars",
      });
      optionalNumber("fabric.fs.read", input.offset, "offset");
      optionalNumber("fabric.fs.read", input.limit, "limit");
      optionalNumber("fabric.fs.read", input.startLine, "startLine");
      optionalNumber("fabric.fs.read", input.endLine, "endLine");
      optionalNumber("fabric.fs.read", input.maxChars, "maxChars");
      if (input.offset !== undefined && input.startLine === undefined)
        input.startLine = input.offset;
      if (
        input.limit !== undefined &&
        input.endLine === undefined &&
        typeof input.startLine === "number"
      )
        input.endLine = input.startLine + Number(input.limit) - 1;
      const filePath = requiredString("fabric.fs.read", input.path, "path");
      const p = await safePath(root, filePath);
      // Bound memory before reading: a workspace file larger than the total
      // read budget is never loaded whole into the worker.
      const sizeInfo = await stat(p);
      if (sizeInfo.size > config.filesystem.maxTotalReadChars)
        throw new FabricError(
          "BUDGET_EXCEEDED",
          `File exceeds read budget: ${filePath} (${sizeInfo.size} bytes)`,
        );
      const raw = textContent(await readFile(p), filePath);
      const lines = raw.split("\n"),
        start = Math.max(1, Number(input.startLine ?? 1)),
        end = Math.min(lines.length, Number(input.endLine ?? lines.length));
      const selected = lines.slice(start - 1, end).join("\n"),
        t = truncate(
          selected,
          Math.min(
            Number(input.maxChars ?? config.filesystem.maxCharsPerFile),
            config.filesystem.maxCharsPerFile,
          ),
        );
      // endLine reflects the lines actually present in the returned content,
      // excluding the synthetic "[truncated]" marker line.
      const contentLines = (t.truncated ? t.text.replace(/\n\[truncated\]$/, "") : t.text).split(
        "\n",
      );
      return {
        path: path.relative(root, p),
        content: t.text,
        chars: t.text.length,
        truncated: t.truncated,
        startLine: start,
        endLine: start + contentLines.length - 1,
      };
    },
    async readMany(input: unknown) {
      const value = argumentRecord("fabric.fs.readMany", input);
      if (!Array.isArray(value.paths) || value.paths.some((item) => typeof item !== "string"))
        invalidArguments("fabric.fs.readMany", "paths must be an array of strings");
      const paths = value.paths as string[],
        maxFiles = Math.min(
          Number(value.maxFiles ?? config.filesystem.maxFilesPerReadMany),
          config.filesystem.maxFilesPerReadMany,
        );
      if (paths.length > maxFiles)
        throw new FabricError("BUDGET_EXCEEDED", `readMany file limit ${maxFiles} exceeded`);
      const out: FileReadResult[] = [],
        totalLimit = Math.min(
          Number(value.maxTotalChars ?? config.filesystem.maxTotalReadChars),
          config.filesystem.maxTotalReadChars,
        );
      let total = 0;
      for (const filePath of paths) {
        const result = await fsApi.read({
          path: filePath,
          maxChars: Number(value.maxCharsPerFile ?? config.filesystem.maxCharsPerFile),
        });
        if (total + result.chars > totalLimit) {
          const left = Math.max(0, totalLimit - total);
          out.push({
            ...result,
            content: result.content.slice(0, left),
            chars: left,
            truncated: true,
          });
          break;
        }
        out.push(result);
        total += result.chars;
      }
      return out;
    },
    async glob(...args: unknown[]) {
      const rawInput = positionalArguments("fabric.fs.glob", args, [
        "pattern",
        "cwd",
        "maxResults",
      ]);
      const input = aliasedArguments(rawInput, {
        query: "pattern",
        search: "pattern",
        regex: "pattern",
        path: "cwd",
        limit: "maxResults",
        max: "maxResults",
      }) as { pattern?: string; cwd?: string; maxResults?: number; ignore?: string[] };
      const pattern = requiredString("fabric.fs.glob", input.pattern, "pattern");
      if (input.cwd !== undefined && typeof input.cwd !== "string")
        invalidArguments("fabric.fs.glob", "cwd must be a string");
      optionalNumber("fabric.fs.glob", input.maxResults, "maxResults");
      if (
        path.posix.isAbsolute(pattern) ||
        path.win32.isAbsolute(pattern) ||
        /^(?:[A-Za-z]:|[\\\\])/.test(pattern) ||
        /(^|[\\\\/])\.\.([\\\\/]|$)/.test(pattern)
      )
        throw new FabricError(
          "POLICY_DENIED",
          "Glob patterns must be relative and cannot contain parent traversal",
        );
      const requestedCwd = await safePath(root, input.cwd ?? ".");
      const cwd = await realpath(requestedCwd);
      const cwdInfo = await lstat(cwd);
      if (!cwdInfo.isDirectory())
        throw new FabricError("POLICY_DENIED", "Glob cwd must be a directory");
      const canonicalRoot = await realpath(root);
      const max = Math.min(input.maxResults ?? 1000, 5000);
      const values = await fg(pattern, {
        cwd,
        onlyFiles: true,
        dot: false,
        followSymbolicLinks: false,
        ignore: [...deniedGlobs, ...(input.ignore ?? [])],
      });
      const results: string[] = [];
      for (const value of values.sort().slice(0, max)) {
        const candidate = path.resolve(cwd, value);
        let canonical: string;
        try {
          canonical = await realpath(candidate);
        } catch {
          throw new FabricError("POLICY_DENIED", "Unable to verify glob result");
        }
        const relative = normalizedRelative(canonicalRoot, canonical);
        if (relative.startsWith("..") || path.isAbsolute(relative) || denied.test(relative))
          throw new FabricError("POLICY_DENIED", "Glob result escaped project root");
        results.push(relative);
      }
      return results;
    },
    async grep(...args: unknown[]): Promise<GrepResult> {
      const rawInput = positionalArguments("fabric.fs.grep", args, ["query", "path", "maxMatches"]);
      const input = aliasedArguments(rawInput, {
        pattern: "query",
        regex: "query",
        search: "query",
        globPattern: "glob",
        limit: "maxMatches",
        max: "maxMatches",
        context: "contextLines",
        ctx: "contextLines",
        ic: "ignoreCase",
        caseInsensitive: "ignoreCase",
      }) as {
        query?: string;
        paths?: string[] | string;
        path?: string;
        glob?: string;
        maxMatches?: number;
        contextLines?: number;
        ignoreCase?: boolean;
        literal?: boolean;
      };
      if (typeof input.paths === "string") input.paths = [input.paths];
      if (input.path && !input.paths) input.paths = [input.path];
      const query = requiredString("fabric.fs.grep", input.query, "query");
      if (
        input.paths !== undefined &&
        (!Array.isArray(input.paths) || input.paths.some((item) => typeof item !== "string"))
      ) {
        invalidArguments("fabric.fs.grep", "paths must be an array of strings");
      }
      if (input.glob !== undefined && typeof input.glob !== "string")
        invalidArguments("fabric.fs.grep", "glob must be a string");
      optionalNumber("fabric.fs.grep", input.maxMatches, "maxMatches");
      optionalNumber("fabric.fs.grep", input.contextLines, "contextLines");
      let regex: RegExp;
      try {
        const expression = input.literal ? query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : query;
        regex = new RegExp(expression, input.ignoreCase === false ? "" : "i");
      } catch {
        throw new FabricError("POLICY_DENIED", "Invalid grep regular expression");
      }
      const files =
        input.paths ?? (await fsApi.glob({ pattern: input.glob ?? "**/*", maxResults: 2000 }));
      const maxMatches = Math.min(Math.max(Math.floor(input.maxMatches ?? 200), 1), 1000);
      const contextLines = Math.min(Math.max(Math.floor(input.contextLines ?? 0), 0), 10);
      const matches: GrepMatch[] = [];
      const scannedFiles: string[] = [];
      const skippedFiles: string[] = [];
      let limitHit = false;
      for (const file of files) {
        try {
          const resolved = await safePath(root, file);
          const info = await lstat(resolved);
          if (!info.isFile())
            throw new FabricError("POLICY_DENIED", `Grep source is not a file: ${file}`);
          limitHit ||= await scanGrepFile(resolved, file, regex, contextLines, matches, maxMatches);
          scannedFiles.push(file);
        } catch {
          skippedFiles.push(file);
        }
      }
      return {
        matches,
        files: [...new Set(matches.map((match) => match.path))],
        truncated: limitHit || skippedFiles.length > 0,
        scannedFiles: [...new Set(scannedFiles)],
        skippedFiles: [...new Set(skippedFiles)],
      };
    },
    async stat(...args: unknown[]) {
      const input = positionalArguments("fabric.fs.stat", args, ["path"]);
      const filePath = requiredString("fabric.fs.stat", input.path, "path");
      const p = await safePath(root, filePath),
        s = await lstat(p);
      return {
        path: path.relative(root, p),
        type: (s.isDirectory() ? "directory" : "file") as "directory" | "file",
        size: s.size,
        modifiedMs: s.mtimeMs,
      };
    },
    async write(...args: unknown[]) {
      const input = aliasedArguments(
        positionalArguments("fabric.fs.write", args, ["path", "content"]),
        { file: "path", contents: "content", body: "content", text: "content" },
      ) as { path: string; content: string };
      requiredString("fabric.fs.write", input.path, "path");
      if (typeof input.content !== "string")
        invalidArguments("fabric.fs.write", "content must be a string");
      const session = config.mutation.enabled ? mutationWriteRequired() : ctx.mutationSession;
      const target = await safeWritePath(root, input.path, config.filesystem.allowWrite);
      let existed = false;
      if (session) {
        try {
          await lstat(target.absolute);
          existed = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      let parentHandle: Awaited<ReturnType<typeof open>> | undefined;
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        const noFollow = fsConstants.O_NOFOLLOW;
        const directory = fsConstants.O_DIRECTORY;
        const parentFdPath = descriptorPath(0);
        if (noFollow === undefined || directory === undefined || !parentFdPath)
          throw new FabricError(
            "POLICY_DENIED",
            `Platform cannot establish a safe write primitive: ${input.path}`,
          );
        parentHandle = await open(
          path.dirname(target.absolute),
          fsConstants.O_RDONLY | directory | noFollow,
        );
        const targetFromParent = descriptorChildPath(
          parentHandle.fd,
          path.basename(target.absolute),
        );
        handle = await open(
          targetFromParent ?? target.absolute,
          fsConstants.O_WRONLY | fsConstants.O_CREAT | noFollow,
          0o666,
        );
        const verified = await verifyOpenedWriteTarget(
          handle,
          root,
          config.filesystem.allowWrite,
          input.path,
          target.absolute,
        );
        await handle.truncate(0);
        await handle.writeFile(input.content, "utf8");
        if (session)
          recordMutationWrite(
            session,
            { absolute: target.absolute, relative: verified.relative },
            existed,
          );
        return { path: verified.relative, bytesWritten: Buffer.byteLength(input.content) };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ELOOP" || code === "ENXIO")
          throw new FabricError(
            "POLICY_DENIED",
            `Refusing unsafe symlink write target: ${input.path}`,
          );
        throw error;
      } finally {
        await handle?.close().catch(() => undefined);
        await parentHandle?.close().catch(() => undefined);
      }
    },
    async patch(...args: unknown[]) {
      const input = positionalArguments("fabric.fs.patch", args, ["path", "patch"]) as {
        path: string;
        patch: string;
      };
      requiredString("fabric.fs.patch", input.path, "path");
      requiredString("fabric.fs.patch", input.patch, "patch");
      if (config.mutation.enabled) mutationWriteRequired();
      const read = await fsApi.read({
        path: input.path,
        maxChars: config.filesystem.maxCharsPerFile,
      });
      if (read.truncated)
        throw new FabricError("BUDGET_EXCEEDED", "Refusing to patch a truncated file");
      const current = read.content;
      let spec: { old: string; new: string };
      try {
        spec = JSON.parse(input.patch) as { old: string; new: string };
      } catch {
        throw new FabricError(
          "POLICY_DENIED",
          'patch must be JSON: {"old":"exact text","new":"replacement"}',
        );
      }
      if (
        typeof spec.old !== "string" ||
        typeof spec.new !== "string" ||
        !current.includes(spec.old)
      )
        throw new FabricError("POLICY_DENIED", "Patch old text not found");
      await fsApi.write({ path: input.path, content: current.replace(spec.old, spec.new) });
      return { path: input.path, applied: true };
    },
  };
  return fsApi;
}
