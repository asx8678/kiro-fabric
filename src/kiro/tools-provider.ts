import { spawn, type ChildProcess } from "node:child_process";
import { createTwoFilesPatch } from "diff";
import { closeSync, createReadStream, openSync, promises as fs, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import ignore, { type Ignore } from "ignore";
import { minimatch } from "minimatch";
import { runAbortable, throwIfAborted } from "../async-settlement.js";
import { writeFileAtomic } from "../core/atomic-write.js";
import { expandSkillDirMarkersForRead } from "../core/skill-dir.js";
import { executeBoundedRegex } from "../memory/regex.js";
import { ProjectRootGuard } from "../providers/project-root-guard.js";
import { MAX_WRITE_DIFF_BYTES, writeContentForPreview } from "../providers/write-diff-limits.js";
import type {
  FabricActionDescriptor,
  FabricInvocationContext,
  FabricProvider,
  FabricProviderListRequest,
  FabricRisk,
} from "../protocol.js";
import { createProcessTreeController } from "../worker/process-tree.js";

const TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;
type ToolName = (typeof TOOL_NAMES)[number];
const MAX_BYTES = 50_000;
const MAX_READ_LINES = 2_000;
const MAX_EDIT_CHARS = 2_000_000;
const MAX_WRITE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 16_384;
const MAX_IMAGE_PIXELS = 64 * 1024 * 1024;
const MAX_SEARCH_FILE_BYTES = 4 * 1024 * 1024;
const MAX_SEARCH_PATTERN_BYTES = 1_024;
const MAX_SEARCH_GLOB_BYTES = 4_096;
const MAX_GREP_CONTEXT = 100;
const MAX_GREP_MATCHES = 100;
const MAX_FIND_MATCHES = 1_000;
const GREP_REGEX_TIMEOUT_MS = 250;
const MAX_WALK_FILES = 100_000;
const MAX_WALK_DIRECTORIES = 20_000;
const MAX_WALK_DEPTH = 64;
const MAX_GITIGNORE_BYTES = 1024 * 1024;
const MAX_BASH_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_BASH_COMMAND_BYTES = 256 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".webp": "image/webp", ".bmp": "image/bmp",
};

const schemas: Record<ToolName, Omit<FabricActionDescriptor, "name" | "risk" | "namespace">> = {
  read: {
    description: "Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to 2000 lines or 50KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.",
    inputSchema: { type: "object", required: ["path"], properties: {
      path: { type: "string", description: "Path to the file to read (relative or absolute)" },
      offset: { type: "number", description: "Line number to start reading from (1-indexed)" },
      limit: { type: "number", description: "Maximum number of lines to read" },
    } },
  },
  bash: {
    description: "Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB (whichever is hit first). In Kiro, truncated output is retained under an opaque, session-scoped artifact ID. Optionally provide a timeout in seconds.",
    inputSchema: { type: "object", required: ["command"], properties: {
      command: { type: "string", description: "Bash command to execute" },
      timeout: { type: "number", description: "Timeout in seconds (optional, no default timeout)" },
    } },
  },
  edit: {
    description: "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
    inputSchema: { type: "object", required: ["path", "edits"], properties: {
      path: { type: "string", description: "Path to the file to edit (relative or absolute)" },
      edits: { type: "array", items: { type: "object", required: ["oldText", "newText"], properties: {
        oldText: { type: "string", description: "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call." },
        newText: { type: "string", description: "Replacement text for this targeted edit." },
      } }, description: "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead." },
    } },
  },
  write: {
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    inputSchema: { type: "object", required: ["path", "content"], properties: {
      path: { type: "string", description: "Path to the file to write (relative or absolute)" },
      content: { type: "string", description: "Content to write to the file" },
    } },
  },
  grep: {
    description: "Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated to 100 matches or 50KB (whichever is hit first). Long lines are truncated to 500 chars.",
    inputSchema: { type: "object", required: ["pattern"], properties: {
      pattern: { type: "string", description: "Search pattern (regex or literal string)" },
      path: { type: "string", description: "Directory or file to search (default: current directory)" },
      glob: { type: "string", description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" },
      ignoreCase: { type: "boolean", description: "Case-insensitive search (default: false)" },
      literal: { type: "boolean", description: "Treat pattern as literal string instead of regex (default: false)" },
      context: { type: "number", description: "Number of lines to show before and after each match (default: 0)" },
      limit: { type: "number", description: "Maximum number of matches to return (default: 100)" },
    } },
  },
  find: {
    description: "Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to 1000 results or 50KB (whichever is hit first).",
    inputSchema: { type: "object", required: ["pattern"], properties: {
      pattern: { type: "string", description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'" },
      path: { type: "string", description: "Directory to search in (default: current directory)" },
      limit: { type: "number", description: "Maximum number of results (default: 1000)" },
    } },
  },
  ls: {
    description: "List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output is truncated to 500 entries or 50KB (whichever is hit first).",
    inputSchema: { type: "object", properties: {
      path: { type: "string", description: "Directory to list (default: current directory)" },
      limit: { type: "number", description: "Maximum number of entries to return (default: 500)" },
    } },
  },
};

const riskFor = (name: ToolName): FabricRisk => name === "bash" ? "execute" : name === "edit" || name === "write" ? "write" : "read";
const stringArg = (args: Record<string, unknown>, key: string): string => {
  const value = args[key];
  if (typeof value !== "string") throw new Error(`k.${key === "command" ? "bash" : key} requires a ${key} string`);
  return value;
};
const positiveInteger = (value: unknown, fallback: number, minimum = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(minimum, Math.floor(value)) : fallback;
const truncateBytes = (value: string, fromEnd = false): { text: string; truncated: boolean } => {
  if (Buffer.byteLength(value) <= MAX_BYTES) return { text: value, truncated: false };
  let bytes = Buffer.from(value);
  bytes = fromEnd ? bytes.subarray(bytes.length - MAX_BYTES) : bytes.subarray(0, MAX_BYTES);
  return { text: bytes.toString("utf8"), truncated: true };
};
const truncateLines = (value: string, limit: number, fromEnd = false): { text: string; truncated: boolean } => {
  const lines = value.split("\n");
  if (lines.length <= limit) return { text: value, truncated: false };
  return { text: (fromEnd ? lines.slice(-limit) : lines.slice(0, limit)).join("\n"), truncated: true };
};
const normalizeRelative = (root: string, file: string): string => path.relative(root, file).split(path.sep).join("/");
const matchesGlob = (file: string, pattern: string): boolean => minimatch(file, pattern, {
  dot: true,
  matchBase: !pattern.includes("/"),
  maxGlobstarRecursion: 64,
});
const byteLength = (value: string): number => Buffer.byteLength(value, "utf8");
const abortReason = (signal: AbortSignal | undefined, fallback: string): Error => {
  const reason = signal?.reason;
  return reason instanceof Error ? reason : new Error(typeof reason === "string" ? reason : fallback);
};

const imageDimensions = (data: Buffer, extension: string): { width: number; height: number } | undefined => {
  if (extension === ".png" && data.length >= 24 && data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (extension === ".gif" && data.length >= 10 && (data.toString("ascii", 0, 6) === "GIF87a" || data.toString("ascii", 0, 6) === "GIF89a")) {
    return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  }
  if (extension === ".bmp" && data.length >= 26 && data.toString("ascii", 0, 2) === "BM") {
    return { width: Math.abs(data.readInt32LE(18)), height: Math.abs(data.readInt32LE(22)) };
  }
  if ((extension === ".jpg" || extension === ".jpeg") && data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    for (let offset = 2; offset + 9 < data.length;) {
      if (data[offset] !== 0xff) { offset += 1; continue; }
      const marker = data[offset + 1]!;
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) { offset += 2; continue; }
      if (offset + 4 > data.length) break;
      const length = data.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > data.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  if (extension === ".webp" && data.length >= 30 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
    const kind = data.toString("ascii", 12, 16);
    if (kind === "VP8X") return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) };
    if (kind === "VP8L" && data[20] === 0x2f) {
      const bits = data.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8 " && data.length >= 30 && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) {
      return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
    }
  }
  return undefined;
};

const assertImageBounds = (data: Buffer, extension: string): void => {
  const dimensions = imageDimensions(data, extension);
  if (!dimensions) throw new Error(`k.read could not validate ${extension || "image"} dimensions`);
  const { width, height } = dimensions;
  if (width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
    throw new Error(`k.read refuses images over ${MAX_IMAGE_DIMENSION}x${MAX_IMAGE_DIMENSION} or ${MAX_IMAGE_PIXELS} pixels (got ${width}x${height})`);
  }
};

interface IgnoreFrame {
  root: string;
  matcher: Ignore;
}

interface WalkState {
  files: number;
  directories: number;
}

export interface KiroToolsProviderOptions {
  readArtifact?: (args: { id: string; offset?: number; limit?: number }) => unknown | Promise<unknown>;
  /** Immutable managed release roots that workspace tools must never traverse. */
  protectedRoots?: readonly string[];
}

export class KiroToolsProvider implements FabricProvider {
  readonly name = "k";
  readonly description = "Kiro Fabric's built-in coding tools";
  readonly #cwd: string;
  readonly #guard: ProjectRootGuard;
  readonly #readArtifact: KiroToolsProviderOptions["readArtifact"];
  readonly #protectedRoots: string[];

  constructor(cwd: string, options: KiroToolsProviderOptions = {}) {
    this.#guard = new ProjectRootGuard(cwd);
    this.#cwd = this.#guard.canonicalRoot;
    this.#readArtifact = options.readArtifact;
    this.#protectedRoots = (options.protectedRoots ?? []).map((root) => path.resolve(root));
  }

  #isProtected(target: string): boolean {
    const resolved = path.resolve(target);
    return this.#protectedRoots.some((root) =>
      resolved === root || resolved.startsWith(root + path.sep),
    );
  }

  #assertNotProtected(target: string, action: string): void {
    if (this.#isProtected(target)) {
      throw new Error(`${action} refuses access to the managed immutable runtime`);
    }
  }

  async list(request: FabricProviderListRequest, context: FabricInvocationContext): Promise<FabricActionDescriptor[]> {
    const names = this.#readArtifact ? [...TOOL_NAMES, "readArtifact"] : [...TOOL_NAMES];
    const descriptors = await Promise.all(names.map((name) => this.describe(name, context)));
    const query = request.query?.toLowerCase();
    return descriptors.filter((item): item is FabricActionDescriptor => item !== undefined)
      .filter((item) => !query || `${item.name} ${item.description}`.toLowerCase().includes(query));
  }

  async describe(actionName: string, _context: FabricInvocationContext): Promise<FabricActionDescriptor | undefined> {
    if (actionName === "readArtifact" && this.#readArtifact) return {
      name: actionName,
      description: "Read a bounded chunk of an opaque overflow artifact returned by fabric_exec.",
      inputSchema: { type: "object", properties: {
        id: { type: "string", pattern: "^ka_[a-f0-9]{48}$" }, offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1, maximum: 16_000 },
      }, required: ["id"], additionalProperties: false },
      risk: "read", namespace: "ephemeral",
    };
    if (!TOOL_NAMES.includes(actionName as ToolName)) return undefined;
    const name = actionName as ToolName;
    return { name, ...schemas[name], risk: riskFor(name), namespace: "builtin" };
  }

  prepareArguments(actionName: string, args: Record<string, unknown>): Record<string, unknown> {
    if (!TOOL_NAMES.includes(actionName as ToolName)) return args;
    if (actionName === "bash") return args;
    const target = actionName === "grep" || actionName === "find" || actionName === "ls" ? (args.path ?? ".") : args.path;
    const resolved = this.#guard.assertPath(target, `k.${actionName}`);
    this.#assertNotProtected(resolved, `k.${actionName}`);
    return args;
  }

  async invoke(actionName: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<unknown> {
    throwIfAborted(context.signal);
    if (actionName === "readArtifact" && this.#readArtifact) {
      const call = () => this.#readArtifact!({ id: args.id as string,
        ...(args.offset !== undefined ? { offset: args.offset as number } : {}),
        ...(args.limit !== undefined ? { limit: args.limit as number } : {}) });
      return runAbortable(context.signal, call);
    }
    if (!TOOL_NAMES.includes(actionName as ToolName)) throw new Error(`Unknown Kiro Fabric tool: k.${actionName}`);
    const name = actionName as ToolName;
    if (name === "bash") return this.#bash(args, context);
    const requested = name === "grep" || name === "find" || name === "ls" ? (args.path ?? ".") : args.path;
    const target = this.#guard.assertPath(requested, `k.${name}`);
    this.#assertNotProtected(target, `k.${name}`);
    throwIfAborted(context.signal);
    if (name === "read") return this.#read(target, args, context);
    if (name === "write") return this.#write(target, args, context);
    if (name === "edit") return this.#edit(target, args, context);
    if (name === "ls") return this.#ls(target, args, context);
    if (name === "find") return this.#find(target, args, context);
    return this.#grep(target, args, context);
  }

  async #read(target: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<string> {
    const mimeType = IMAGE_TYPES[path.extname(target).toLowerCase()];
    if (mimeType) {
      const stat = await runAbortable(context.signal, () => fs.stat(target));
      if (!stat.isFile()) throw new Error(`k.read requires a regular file: ${String(args.path)}`);
      if (stat.size > MAX_IMAGE_BYTES) throw new Error(`k.read refuses images over ${MAX_IMAGE_BYTES} bytes`);
      const data = await runAbortable(context.signal, () => fs.readFile(target));
      assertImageBounds(data, path.extname(target).toLowerCase());
      const note = `Read image file [${mimeType}]`;
      context.attachMedia?.([{ type: "image", data: data.toString("base64"), mimeType }], note);
      return note;
    }
    const offset = positiveInteger(args.offset, 1, 1);
    const limit = Math.min(positiveInteger(args.limit, MAX_READ_LINES, 1), MAX_READ_LINES);
    const stream = createReadStream(target, { encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    const onAbort = (): void => { stream.destroy(abortReason(context.signal, "k.read aborted")); };
    context.signal?.addEventListener("abort", onAbort, { once: true });
    const selected: string[] = [];
    let lineNumber = 0;
    let selectedBytes = 0;
    try {
      for await (const line of lines) {
        throwIfAborted(context.signal);
        lineNumber += 1;
        if (lineNumber < offset) continue;
        if (selected.length >= limit) break;
        const separatorBytes = selected.length === 0 ? 0 : 1;
        const remainingBytes = MAX_BYTES - selectedBytes - separatorBytes;
        if (remainingBytes <= 0) break;
        if (byteLength(line) > remainingBytes) {
          selected.push(Buffer.from(line).subarray(0, remainingBytes).toString("utf8"));
          break;
        }
        selected.push(line);
        selectedBytes += separatorBytes + byteLength(line);
      }
    } catch (error) {
      if (context.signal?.aborted) throw abortReason(context.signal, "k.read aborted");
      throw error;
    } finally {
      context.signal?.removeEventListener("abort", onAbort);
      lines.close();
      stream.destroy();
    }
    let text = expandSkillDirMarkersForRead(selected.join("\n"), { ...args, path: args.path }, this.#cwd);
    text = truncateBytes(text).text;
    return text;
  }

  async #write(target: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<unknown> {
    const content = stringArg(args, "content");
    const contentBytes = byteLength(content);
    if (contentBytes > MAX_WRITE_BYTES) throw new Error(`k.write refuses content over ${MAX_WRITE_BYTES} bytes`);
    let before: { kind: "content"; content: string } | { kind: "skipped"; reason: string; byteLength?: number; maxBytes: number } | null = null;
    let existingMode: number | undefined;
    try {
      const stat = await fs.stat(target);
      if (!stat.isFile()) throw new Error(`k.write target is not a regular file: ${String(args.path)}`);
      existingMode = stat.mode & 0o777;
      before = stat.size <= MAX_WRITE_DIFF_BYTES
        ? { kind: "content", content: await fs.readFile(target, "utf8") }
        : { kind: "skipped", reason: "previous file too large", byteLength: stat.size, maxBytes: MAX_WRITE_DIFF_BYTES };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    throwIfAborted(context.signal);
    await runAbortable(context.signal, () => {
      writeFileAtomic(target, content, existingMode === undefined ? undefined : { mode: existingMode });
    });
    const result = { ok: true, output: `Successfully wrote ${contentBytes} bytes to ${target}`, details: null };
    const previewContent = writeContentForPreview(content);
    context.attachPreview?.({ result,
      ...(previewContent !== undefined ? { writeContent: previewContent } : {}),
      writeByteLength: contentBytes, writeLineCount: content.length === 0 ? 0 : content.split("\n").length,
      codePreviewBeforeWrite: before, writeBeforeCaptured: true });
    return result;
  }

  async #edit(target: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<unknown> {
    const stat = await runAbortable(context.signal, () => fs.stat(target));
    if (!stat.isFile()) throw new Error(`k.edit target is not a regular file: ${String(args.path)}`);
    const source = await runAbortable(context.signal, () => fs.readFile(target, "utf8"));
    if (source.length > MAX_EDIT_CHARS) throw new Error(`k.edit refuses files over ${MAX_EDIT_CHARS} characters; use scoped unique edits`);
    let parsedEdits = args.edits;
    if (typeof parsedEdits === "string") {
      try { parsedEdits = JSON.parse(parsedEdits); } catch { /* validation below reports the bad shape */ }
    }
    const raw = Array.isArray(parsedEdits) ? [...parsedEdits] : [];
    if (typeof args.oldText === "string" && typeof args.newText === "string") raw.push({ oldText: args.oldText, newText: args.newText, all: args.all });
    if (raw.length === 0) throw new Error("k.edit requires at least one edit");
    const changes = raw.map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`k.edit edits[${index}] must be an object`);
      const edit = entry as Record<string, unknown>;
      if (typeof edit.oldText !== "string" || typeof edit.newText !== "string" || edit.oldText.length === 0) throw new Error(`k.edit edits[${index}] requires non-empty oldText and newText strings`);
      const oldText = edit.oldText;
      const newText = edit.newText;
      const positions: number[] = [];
      for (let at = source.indexOf(oldText); at >= 0; at = source.indexOf(oldText, at + Math.max(1, oldText.length))) positions.push(at);
      if (positions.length === 0) throw new Error(`k.edit edits[${index}] oldText was not found`);
      const all = args.all === true || edit.all === true;
      if (!all && positions.length !== 1) throw new Error(`k.edit edits[${index}] found ${positions.length} occurrences; add all:true or use a unique anchor`);
      return (all ? positions : positions.slice(0, 1)).map((start) => ({ start, end: start + oldText.length, text: newText, index }));
    }).flat().sort((a, b) => a.start - b.start);
    for (let index = 1; index < changes.length; index += 1) if (changes[index]!.start < changes[index - 1]!.end) throw new Error("k.edit edits contain overlapping regions");
    let next = source;
    for (const change of [...changes].reverse()) next = next.slice(0, change.start) + change.text + next.slice(change.end);
    if (byteLength(next) > MAX_WRITE_BYTES) throw new Error(`k.edit result exceeds ${MAX_WRITE_BYTES} bytes`);
    throwIfAborted(context.signal);
    await runAbortable(context.signal, () => {
      writeFileAtomic(target, next, { mode: stat.mode & 0o777 });
    });
    const firstChangedLine = source.slice(0, changes[0]!.start).split("\n").length;
    const displayPath = String(args.path);
    const diff = createTwoFilesPatch(displayPath, displayPath, source, next, undefined, undefined, { context: 3 })
      .replace(/^={3,}\n/u, "")
      .trimEnd();
    const details = { diff, patch: diff, firstChangedLine };
    const result = { ok: true, output: `Successfully replaced ${raw.length} block(s) in ${String(args.path)}.`, details };
    context.attachPreview?.({ result, details });
    return result;
  }

  async #ls(target: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<string> {
    const entries = await runAbortable(context.signal, () => fs.readdir(target, { withFileTypes: true }));
    const limit = Math.min(positiveInteger(args.limit, 500, 1), 500);
    const text = entries
      .filter((entry) => !this.#isProtected(path.join(target, entry.name)))
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, limit)
      .map((entry) => entry.name + (entry.isDirectory() ? "/" : ""))
      .join("\n");
    return truncateBytes(text).text;
  }

  async #ignoreFrame(directory: string): Promise<IgnoreFrame | undefined> {
    const file = path.join(directory, ".gitignore");
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try { stat = await fs.stat(file); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (!stat.isFile()) return undefined;
    if (stat.size > MAX_GITIGNORE_BYTES) throw new Error(`k.find/k.grep refuses .gitignore files over ${MAX_GITIGNORE_BYTES} bytes`);
    return { root: directory, matcher: ignore().add(await fs.readFile(file, "utf8")) };
  }

  #isIgnored(full: string, directory: boolean, frames: readonly IgnoreFrame[]): boolean {
    let ignored = false;
    for (const frame of frames) {
      const relative = normalizeRelative(frame.root, full);
      if (!relative || relative === ".." || relative.startsWith("../")) continue;
      const result = frame.matcher.test(directory ? `${relative}/` : relative);
      if (result.ignored) ignored = true;
      else if (result.unignored) ignored = false;
    }
    return ignored;
  }

  async #ancestorIgnoreFrames(directory: string): Promise<IgnoreFrame[]> {
    const relative = path.relative(this.#cwd, directory);
    if (!relative || relative === ".") return [];
    const segments = relative.split(path.sep).filter(Boolean);
    const frames: IgnoreFrame[] = [];
    let current = this.#cwd;
    for (const segment of segments.slice(0, -1)) {
      const frame = await this.#ignoreFrame(current);
      if (frame) frames.push(frame);
      current = path.join(current, segment);
    }
    const parentFrame = await this.#ignoreFrame(current);
    if (parentFrame) frames.push(parentFrame);
    return frames;
  }

  async *#walk(
    root: string,
    signal: AbortSignal | undefined,
    state: WalkState = { files: 0, directories: 0 },
    inheritedFrames: readonly IgnoreFrame[] = [],
    depth = 0,
  ): AsyncGenerator<string> {
    throwIfAborted(signal);
    if (depth > MAX_WALK_DEPTH) throw new Error(`k.find/k.grep traversal exceeded maximum depth ${MAX_WALK_DEPTH}`);
    if (depth === 0 && inheritedFrames.length === 0) {
      inheritedFrames = await this.#ancestorIgnoreFrames(root);
      if (this.#isIgnored(root, true, inheritedFrames)) return;
    }
    state.directories += 1;
    if (state.directories > MAX_WALK_DIRECTORIES) throw new Error(`k.find/k.grep traversal exceeded ${MAX_WALK_DIRECTORIES} directories`);
    const localFrame = await this.#ignoreFrame(root);
    const frames = localFrame ? [...inheritedFrames, localFrame] : inheritedFrames;
    const entries = (await fs.readdir(root, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      throwIfAborted(signal);
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path.join(root, entry.name);
      if (this.#isProtected(full)) continue;
      if (entry.isDirectory()) {
        if (!this.#isIgnored(full, true, frames)) yield* this.#walk(full, signal, state, frames, depth + 1);
        continue;
      }
      if (!entry.isFile() || this.#isIgnored(full, false, frames)) continue;
      state.files += 1;
      if (state.files > MAX_WALK_FILES) throw new Error(`k.find/k.grep traversal exceeded ${MAX_WALK_FILES} files`);
      yield full;
    }
  }

  async #find(target: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<string> {
    const pattern = stringArg(args, "pattern");
    if (byteLength(pattern) > MAX_SEARCH_GLOB_BYTES) throw new Error(`k.find refuses patterns over ${MAX_SEARCH_GLOB_BYTES} bytes`);
    const limit = Math.min(positiveInteger(args.limit, MAX_FIND_MATCHES, 1), MAX_FIND_MATCHES);
    const matches: string[] = [];
    let bytes = 0;
    for await (const file of this.#walk(target, context.signal)) {
      const relative = normalizeRelative(target, file);
      if (!matchesGlob(relative, pattern)) continue;
      const nextBytes = byteLength(relative) + (matches.length === 0 ? 0 : 1);
      if (matches.length >= limit || bytes + nextBytes > MAX_BYTES) break;
      matches.push(relative);
      bytes += nextBytes;
    }
    return matches.join("\n");
  }

  async #grep(target: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<string> {
    const pattern = stringArg(args, "pattern");
    if (byteLength(pattern) > MAX_SEARCH_PATTERN_BYTES) throw new Error(`k.grep refuses patterns over ${MAX_SEARCH_PATTERN_BYTES} bytes`);
    const literal = args.literal === true;
    if (!literal) {
      try { new RegExp(pattern, args.ignoreCase === true ? "iu" : "u"); }
      catch (error) { throw new Error(`k.grep invalid regular expression: ${error instanceof Error ? error.message : String(error)}`); }
    }
    const stat = await runAbortable(context.signal, () => fs.stat(target));
    const glob = typeof args.glob === "string" ? args.glob : undefined;
    if (glob !== undefined && byteLength(glob) > MAX_SEARCH_GLOB_BYTES) throw new Error(`k.grep refuses globs over ${MAX_SEARCH_GLOB_BYTES} bytes`);
    const limit = Math.min(positiveInteger(args.limit, MAX_GREP_MATCHES, 1), MAX_GREP_MATCHES);
    const contextLines = Math.min(positiveInteger(args.context, 0, 0), MAX_GREP_CONTEXT);
    const output: string[] = [];
    let outputBytes = 0;
    let matches = 0;
    const files = stat.isDirectory() ? this.#walk(target, context.signal) : (async function* () { yield target; })();
    fileLoop: for await (const file of files) {
      throwIfAborted(context.signal);
      const relative = stat.isDirectory() ? normalizeRelative(target, file) : path.basename(file);
      if (glob && !matchesGlob(relative, glob)) continue;
      let source: string;
      try {
        const fileStat = await fs.stat(file);
        if (!fileStat.isFile() || fileStat.size > MAX_SEARCH_FILE_BYTES) continue;
        source = await fs.readFile(file, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (source.includes("\0")) continue;
      const lines = source.split("\n");
      let matchedLines: Set<number> | undefined;
      if (!literal) {
        const result = await executeBoundedRegex(pattern, lines, {
          maxPatternBytes: MAX_SEARCH_PATTERN_BYTES,
          timeoutMs: GREP_REGEX_TIMEOUT_MS,
        }, args.ignoreCase === true ? "iu" : "u");
        throwIfAborted(context.signal);
        if (!result.complete) throw new Error(`k.grep ${result.error.message}`);
        matchedLines = new Set(result.matched);
      }
      const literalNeedle = args.ignoreCase === true ? pattern.toLowerCase() : pattern;
      for (let line = 0; line < lines.length && matches < limit; line += 1) {
        const matched = literal
          ? (args.ignoreCase === true ? lines[line]!.toLowerCase() : lines[line]!).includes(literalNeedle)
          : matchedLines!.has(line);
        if (!matched) continue;
        matches += 1;
        for (let shown = Math.max(0, line - contextLines); shown <= Math.min(lines.length - 1, line + contextLines); shown += 1) {
          const rendered = `${relative}:${shown + 1}:${lines[shown]!.slice(0, 500)}`;
          const nextBytes = byteLength(rendered) + (output.length === 0 ? 0 : 1);
          if (outputBytes + nextBytes > MAX_BYTES) break fileLoop;
          output.push(rendered);
          outputBytes += nextBytes;
        }
      }
      if (matches >= limit) break;
    }
    return output.join("\n");
  }

  async #bash(args: Record<string, unknown>, context: FabricInvocationContext): Promise<unknown> {
    const command = stringArg(args, "command");
    if (byteLength(command) > MAX_BASH_COMMAND_BYTES) throw new Error(`k.bash refuses commands over ${MAX_BASH_COMMAND_BYTES} bytes`);
    const timeoutMs = typeof args.timeout === "number" && args.timeout > 0 ? args.timeout * 1_000 : undefined;
    const fullOutputPath = path.join(os.tmpdir(), `kiro-fabric-bash-${crypto.randomUUID()}.log`);
    let result: { output: string; fullOutput: Buffer; spooled: boolean; code: number | null; totalBytes: number; terminationError?: Error };
    try {
      result = await new Promise((resolve, reject) => {
        const shell = process.platform === "win32"
          ? "C:\\Program Files\\Git\\bin\\bash.exe"
          : "/bin/bash";
        const child = spawn(shell, ["-c", command], {
          cwd: this.#cwd,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32",
        });
        if (!child.pid) {
          reject(new Error("k.bash failed to launch bash"));
          return;
        }
        const tree = createProcessTreeController(child.pid, { ambientHelpers: false });
        let tail = Buffer.alloc(0);
        const capturedChunks: Buffer[] = [];
        let capturedBytes = 0;
        let outputDescriptor: number | undefined;
        let totalBytes = 0;
        let terminationError: Error | undefined;
        let stopPromise: Promise<void> | undefined;
        let timer: NodeJS.Timeout | undefined;
        let finished = false;

        const requestStop = (error: Error): void => {
          if (terminationError) return;
          terminationError = error;
          stopPromise = tree.terminate().then(() => undefined, (stopError: unknown) => {
            terminationError = stopError instanceof Error ? stopError : new Error(String(stopError));
          });
        };
        const enqueue = (raw: Buffer | string, preview: boolean, stream: ChildProcess["stdout"]): void => {
          const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
          const remaining = Math.max(0, MAX_BASH_OUTPUT_BYTES - totalBytes);
          const captured = remaining >= chunk.length ? chunk : chunk.subarray(0, remaining);
          totalBytes += chunk.length;
          if (captured.length > 0) {
            try {
              if (outputDescriptor === undefined) {
                capturedChunks.push(captured);
                capturedBytes += captured.length;
                if (capturedBytes > MAX_BYTES) {
                  outputDescriptor = openSync(fullOutputPath, "wx", 0o600);
                  for (const buffered of capturedChunks.splice(0)) writeSync(outputDescriptor, buffered);
                }
              } else {
                writeSync(outputDescriptor, captured);
              }
            } catch (error) {
              requestStop(error instanceof Error ? error : new Error(String(error)));
            }
            tail = Buffer.concat([tail, captured]);
            if (tail.length > MAX_BYTES) tail = tail.subarray(tail.length - MAX_BYTES);
          }
          if (preview) {
            const boundedPreview = truncateLines(tail.toString("utf8"), MAX_READ_LINES, true).text;
            context.attachPreview?.({ result: boundedPreview, bashCommand: command });
            context.update(`bash: ${boundedPreview.slice(-500) || "running"}`);
          }
          if (totalBytes > MAX_BASH_OUTPUT_BYTES) requestStop(new Error(`k.bash output exceeded the ${MAX_BASH_OUTPUT_BYTES}-byte safety limit`));
        };
        const abort = (): void => requestStop(abortReason(context.signal, "k.bash aborted"));
        const finish = async (code: number | null, signal: NodeJS.Signals | null): Promise<void> => {
          if (finished) return;
          finished = true;
          if (timer) clearTimeout(timer);
          context.signal?.removeEventListener("abort", abort);
          try {
            await stopPromise;
            if (outputDescriptor !== undefined) {
              closeSync(outputDescriptor);
              outputDescriptor = undefined;
            }
          } catch (error) {
            reject(error);
            return;
          }
          if (signal && !terminationError) terminationError = new Error(`k.bash terminated by ${signal}`);
          resolve({
            output: tail.toString("utf8"),
            fullOutput: Buffer.concat(capturedChunks),
            spooled: capturedBytes > MAX_BYTES,
            code,
            totalBytes,
            ...(terminationError ? { terminationError } : {}),
          });
        };

        context.signal?.addEventListener("abort", abort, { once: true });
        child.stdout?.on("data", (chunk: Buffer | string) => enqueue(chunk, true, child.stdout));
        child.stderr?.on("data", (chunk: Buffer | string) => enqueue(chunk, false, child.stderr));
        child.once("error", (error) => requestStop(error));
        child.once("close", (code, signal) => { void finish(code, signal); });
        if (timeoutMs !== undefined) {
          timer = setTimeout(() => requestStop(new Error(`k.bash timed out after ${args.timeout} seconds`)), timeoutMs);
        }
      });
    } catch (error) {
      await fs.rm(fullOutputPath, { force: true });
      throw error;
    }
    const byLines = truncateLines(result.output, MAX_READ_LINES, true);
    const bounded = truncateBytes(byLines.text, true);
    const truncated = result.totalBytes > byteLength(result.output) || byLines.truncated || bounded.truncated;
    let details: Record<string, unknown> | null = null;
    if (truncated) {
      if (!result.spooled) {
        await fs.writeFile(fullOutputPath, result.fullOutput, { flag: "wx", mode: 0o600 });
      }
      details = { fullOutputPath, truncation: { truncated: true } };
    }
    const fullOutputHint = truncated
      ? `\n[Full output saved to ${fullOutputPath}; inspect it with k.bash({ command: ${JSON.stringify(`tail -n 2000 -- ${JSON.stringify(fullOutputPath)}`)} })]`
      : "";
    if (result.terminationError) {
      const partial = bounded.text ? `${bounded.text}\n\n` : "";
      throw new Error(`${partial}${result.terminationError.message}${fullOutputHint}`);
    }
    if (result.code !== 0) {
      throw new Error(`${bounded.text}${fullOutputHint}\n\nCommand exited with code ${result.code ?? 1}`);
    }
    const normalized = { ok: true, output: bounded.text || "(no output)", details };
    context.attachPreview?.({ result: normalized, bashCommand: command, details });
    return normalized;
  }
}
