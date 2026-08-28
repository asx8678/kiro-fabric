import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  type AgentToolResult,
  type ExtensionContext,
  type ExtensionRunner,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { runAbortable, throwIfAborted } from "../async-settlement.js";
import { CapturedToolCatalog } from "../capture/catalog.js";
import { PI_CORE_TOOL_NAMES, type PiCoreToolName } from "../core/pi-tools.js";
import { expandSkillDirMarkersForRead } from "../core/skill-dir.js";
import { ProjectRootGuard } from "./project-root-guard.js";
import type {
  FabricActionDescriptor,
  FabricInvocationContext,
  FabricMediaBlock,
  FabricProvider,
  FabricProviderListRequest,
  FabricRisk,
} from "../protocol.js";
import { countContentLines } from "../ui/preview-lines.js";
import { CapturedToolsProvider } from "./captured-tools-provider.js";
import { writeContentForPreview } from "./write-diff-limits.js";
import { createPreviewWriteToolDefinition } from "./write-preview.js";

const MAX_RENDERER_ARGUMENT_CHARS = 200_000;
const MAX_REPLACE_ALL_FILE_CHARS = 2_000_000;

const expandReplaceAllEdit = (
  cwd: string,
  args: Record<string, unknown>,
  allForEveryEdit: boolean,
  namespace: PiToolsProviderNamespace,
): Record<string, unknown> => {
  const ref = `${namespace}.edit`;
  const filePath = args.path;
  if (typeof filePath !== "string") {
    throw new Error(`${ref} all:true requires a path`);
  }
  const edits = Array.isArray(args.edits)
    ? args.edits
    : [{ oldText: args.oldText, newText: args.newText }];
  if (edits.length === 0) throw new Error(`${ref} all:true requires at least one edit`);
  const normalized = edits.map((edit, index) => {
    if (typeof edit !== "object" || edit === null || Array.isArray(edit)) {
      throw new Error(`${ref} all:true edits[${index}] must be an object`);
    }
    const record = edit as Record<string, unknown>;
    const { oldText, newText } = record;
    if (typeof oldText !== "string" || typeof newText !== "string") {
      throw new Error(`${ref} all:true edits[${index}] requires oldText and newText strings`);
    }
    if (oldText.length === 0) {
      throw new Error(`${ref} all:true edits[${index}] oldText cannot be empty`);
    }
    return { oldText, newText, all: allForEveryEdit || record.all === true };
  });
  const resolvedPath = path.resolve(
    cwd,
    filePath.startsWith("@") ? filePath.slice(1) : filePath,
  );
  const current = readFileSync(resolvedPath, "utf8");
  if (current.length > MAX_REPLACE_ALL_FILE_CHARS) {
    throw new Error(
      `${ref} all:true refuses files over ${MAX_REPLACE_ALL_FILE_CHARS} characters; use scoped unique edits`,
    );
  }
  let next = current;
  for (const [index, edit] of normalized.entries()) {
    const occurrences = next.split(edit.oldText).length - 1;
    if (occurrences === 0) {
      throw new Error(`${ref} all:true edits[${index}] oldText was not found`);
    }
    if (!edit.all && occurrences !== 1) {
      throw new Error(
        `${ref} edits[${index}] found ${occurrences} occurrences; add all:true or use a unique anchor`,
      );
    }
    next = edit.all
      ? next.replaceAll(edit.oldText, edit.newText)
      : next.replace(edit.oldText, edit.newText);
  }
  return { path: filePath, edits: [{ oldText: current, newText: next }] };
};

const readTools = new Set<PiCoreToolName>(["read", "grep", "find", "ls"]);
const writeTools = new Set<PiCoreToolName>(["edit", "write"]);

// The content array every pi core tool returns: text and/or image blocks.
type ToolContent = AgentToolResult<unknown>["content"];

const riskForTool = (name: PiCoreToolName): FabricRisk => {
  if (readTools.has(name)) return "read";
  if (writeTools.has(name)) return "write";
  return "execute";
};

const textContent = (content: ToolContent): string =>
  content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");

const imageBlocks = (content: unknown): FabricMediaBlock[] => {
  if (!Array.isArray(content)) return [];
  const blocks: FabricMediaBlock[] = [];
  for (const part of content) {
    if (
      typeof part === "object" &&
      part !== null &&
      (part as { type?: unknown }).type === "image" &&
      typeof (part as { data?: unknown }).data === "string" &&
      typeof (part as { mimeType?: unknown }).mimeType === "string"
    ) {
      blocks.push({
        type: "image",
        data: (part as { data: string }).data,
        mimeType: (part as { mimeType: string }).mimeType,
      });
    }
  }
  return blocks;
};

const normalizeResult = (
  name: PiCoreToolName,
  result: { content: ToolContent; details?: unknown; isError?: boolean },
): unknown => {
  const text = textContent(result.content);
  if (result.isError) throw new Error(text || `${name} failed`);
  if (name === "read" || name === "grep" || name === "find" || name === "ls") {
    return text;
  }
  let details = result.details;
  if (name === "bash" && details && typeof details === "object" && !Array.isArray(details)) {
    const detailRecord = details as Record<string, unknown>;
    const truncation = detailRecord.truncation;
    if (truncation && typeof truncation === "object" && !Array.isArray(truncation)) {
      const { content, ...truncationMetadata } = truncation as Record<string, unknown>;
      if (typeof content === "string" && text.includes(content)) {
        details = { ...detailRecord, truncation: truncationMetadata };
      }
    }
  }
  if (name === "write" && details && typeof details === "object" && !Array.isArray(details)) {
    const { codePreviewBeforeWrite: _before, ...publicDetails } = details as Record<string, unknown>;
    details = Object.keys(publicDetails).length > 0 ? publicDetails : undefined;
  }
  return {
    ok: true,
    output: text,
    details: details ?? null,
  };
};

// Shape of a pi core tool's execute() result. AgentToolResult<unknown> is
// { content, details, terminate? }; pi core tools throw on error rather than
// returning isError, so isError is tracked separately in #invokeWithEvents.
interface PiToolResult {
  content: ToolContent;
  details: unknown;
  terminate?: boolean;
}

export type PiToolsProviderNamespace = "pi" | "k";

export interface PiToolsProviderOptions {
  /**
   * Whether Bash may derive environment values from a live Pi session.
   * Standalone hosts such as Kiro have no Pi session and must disable this.
   */
  exposeSessionEnvironment?: boolean;
  /**
   * Model-facing provider namespace. The shared Pi host keeps the canonical
   * `pi`; managed Kiro uses `k` without changing the original Pi API.
   */
  namespace?: PiToolsProviderNamespace;
  /** Kiro-only opaque overflow retrieval. Never expose this on the Pi host. */
  readArtifact?: (args: {
    id: string;
    offset?: number;
    limit?: number;
  }) => unknown;
}

export class PiToolsProvider implements FabricProvider {
  readonly name: PiToolsProviderNamespace;
  readonly description: string;
  readonly #tools: Record<PiCoreToolName, ToolDefinition<any, any, any>>;
  readonly #catalog: CapturedToolCatalog | undefined;
  readonly #capturedTools: CapturedToolsProvider | undefined;
  readonly #cwd: string;
  readonly #rootGuard: ProjectRootGuard;
  readonly #readArtifact: PiToolsProviderOptions["readArtifact"];
  readonly #requestedPaths = new WeakMap<Record<string, unknown>, unknown>();

  constructor(
    cwd: string,
    catalog?: CapturedToolCatalog,
    capturedTools?: CapturedToolsProvider,
    options: PiToolsProviderOptions = {},
  ) {
    this.name = options.namespace ?? "pi";
    this.description = this.name === "pi"
      ? "Pi's built-in coding tools"
      : "Kiro Fabric's built-in coding tools";
    this.#cwd = cwd;
    this.#rootGuard = new ProjectRootGuard(cwd);
    this.#readArtifact = options.namespace === "k" ? options.readArtifact : undefined;
    this.#tools = {
      read: createReadToolDefinition(cwd),
      bash: createBashToolDefinition(cwd, {
        exposeSessionEnvironment: options.exposeSessionEnvironment ?? true,
      }),
      edit: createEditToolDefinition(cwd),
      write: createPreviewWriteToolDefinition(cwd),
      grep: createGrepToolDefinition(cwd),
      find: createFindToolDefinition(cwd),
      ls: createLsToolDefinition(cwd),
    };
    this.#catalog = catalog;
    this.#capturedTools = capturedTools;
  }

  async list(
    request: FabricProviderListRequest,
    _context: FabricInvocationContext,
  ): Promise<FabricActionDescriptor[]> {
    const query = request.query?.toLowerCase();
    const names = this.#readArtifact
      ? [...PI_CORE_TOOL_NAMES, "readArtifact"]
      : [...PI_CORE_TOOL_NAMES];
    const descriptors = await Promise.all(names.map((name) => this.describe(name, _context)));
    return descriptors
      .filter((descriptor): descriptor is FabricActionDescriptor => descriptor !== undefined)
      .filter((descriptor) =>
        query ? `${descriptor.name} ${descriptor.description}`.toLowerCase().includes(query) : true,
      );
  }

  async describe(
    actionName: string,
    _context: FabricInvocationContext,
  ): Promise<FabricActionDescriptor | undefined> {
    if (actionName === "readArtifact" && this.#readArtifact) {
      return {
        name: actionName,
        description:
          "Read a bounded chunk of an opaque overflow artifact returned by fabric_exec.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", pattern: "^ka_[a-f0-9]{48}$" },
            offset: { type: "integer", minimum: 0 },
            limit: { type: "integer", minimum: 1, maximum: 16_000 },
          },
          required: ["id"],
          additionalProperties: false,
        },
        risk: "read",
        namespace: "ephemeral",
      };
    }
    if (!(actionName in this.#tools)) return undefined;
    const name = actionName as PiCoreToolName;
    const override = await this.#capturedTools?.describe(name, _context);
    if (override) return { ...override, namespace: "extension-override" };
    const tool = this.#tools[name];
    return this.#descriptor(name, tool);
  }

  prepareArguments(actionName: string, args: Record<string, unknown>): Record<string, unknown> {
    if (!(actionName in this.#tools)) return args;
    let record: Record<string, unknown>;
    const captured = this.#catalog?.get(actionName) !== undefined;
    // Built-in prepareArguments may read the target (notably edit all:true),
    // so reject escapes before preparing. Captured overrides own their input
    // schema and are checked after their preparer returns a filesystem path.
    if (!captured) this.#assertProjectPath(actionName as PiCoreToolName, args);
    if (captured) {
      record = this.#capturedTools!.prepareArguments(actionName, args);
    } else {
      const input = actionName === "edit" && Object.hasOwn(args, "all")
        ? Object.fromEntries(Object.entries(args).filter(([key]) => key !== "all"))
        : args;
      const prepare = this.#tools[actionName as PiCoreToolName].prepareArguments;
      const prepared = prepare ? prepare(input) : input;
      if (typeof prepared !== "object" || prepared === null || Array.isArray(prepared)) {
        throw new Error(`${this.#toolLabel(actionName)} prepared non-object arguments`);
      }
      record = prepared as Record<string, unknown>;
    }
    this.#assertProjectPath(actionName as PiCoreToolName, record);
    const hasPerEditAll = actionName === "edit"
      && Array.isArray(record.edits)
      && record.edits.some(
        (edit) => typeof edit === "object" && edit !== null
          && !Array.isArray(edit) && (edit as Record<string, unknown>).all === true,
      );
    return !captured && actionName === "edit" && (args.all === true || hasPerEditAll)
      ? expandReplaceAllEdit(this.#cwd, record, args.all === true, this.name)
      : record;
  }

  #assertProjectPath(
    name: PiCoreToolName,
    args: Record<string, unknown>,
    canonicalizeArguments = false,
  ): void {
    // Shell is separately execute-risk gated and intentionally remains capable
    // of invoking arbitrary programs. Filesystem tools are root-confined.
    if (name === "bash") return;
    let foundPath = false;
    const canonicalize = (record: Record<string, unknown>): void => {
      for (const key of ["path", "file", "absolutePath"] as const) {
        if (!Object.hasOwn(record, key)) continue;
        foundPath = true;
        const canonical = this.#rootGuard.assertPath(record[key], `${this.name}.${name}`);
        if (canonicalizeArguments) {
          if (record === args && key === "path" && !this.#requestedPaths.has(args)) {
            this.#requestedPaths.set(args, record[key]);
          }
          record[key] = canonical;
        }
      }
    };
    canonicalize(args);
    if (name === "edit" && Array.isArray(args.edits)) {
      for (const edit of args.edits) {
        if (typeof edit !== "object" || edit === null || Array.isArray(edit)) continue;
        canonicalize(edit as Record<string, unknown>);
      }
    }
    if (!foundPath) {
      this.#rootGuard.assertPath(
        (name === "grep" || name === "find" || name === "ls") ? "." : undefined,
        `${this.name}.${name}`,
      );
    }
  }

  async invoke(
    actionName: string,
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): Promise<unknown> {
    if (actionName === "readArtifact" && this.#readArtifact) {
      return this.#readArtifact({
        id: args.id as string,
        ...(args.offset !== undefined ? { offset: args.offset as number } : {}),
        ...(args.limit !== undefined ? { limit: args.limit as number } : {}),
      });
    }
    if (!(actionName in this.#tools)) {
      throw new Error(
        this.name === "pi"
          ? `Unknown Pi tool: ${actionName}`
          : `Unknown Kiro Fabric tool: k.${actionName}`,
      );
    }
    const name = actionName as PiCoreToolName;
    const captured = this.#catalog?.get(name) !== undefined;
    // Re-check immediately before invocation. Built-ins receive a canonical
    // in-root spelling; captured extension overrides retain their documented
    // caller argument shape but are still boundary-validated.
    this.#assertProjectPath(name, args, !captured);
    // A captured extension override (e.g. an extension that registered a "read"
    // tool) already replays the full event lifecycle itself via
    // CapturedToolsProvider, so delegate to it unchanged.
    if (captured) {
      const result = await this.#capturedTools!.invoke(name, args, context);
      this.#attachReadMedia(name, result, context);
      this.#attachReadNote(name, result, context);
      this.#attachPreview(name, result, args, context);
      return this.#normalizeResult(name, result, args);
    }
    const tool = this.#tools[name];
    const runner = this.#catalog?.runner;
    // Without a runner (e.g. before the first tool refresh populated the
    // catalog) fall back to a direct execute — no extension hooks fire, but
    // the call still works. Once tools are refreshed the runner is available.
    if (!runner) {
      const result = await runAbortable(context.signal, () =>
        tool.execute(
          context.nestedToolCallId,
          args,
          context.signal,
          (partialResult) => this.#attachPartialPreview(name, partialResult, args, context),
          context.extensionContext as ExtensionContext,
        ),
      );
      this.#attachReadMedia(name, result, context);
      this.#attachReadNote(name, result, context);
      this.#attachPreview(name, result, args, context);
      return this.#normalizeResult(name, result, args);
    }
    return this.#invokeWithEvents(name, tool, args, context, runner);
  }

  // Replay the agent-core tool-execution lifecycle for a nested pi.* call, so
  // extensions that hook tool_call / tool_result / tool_execution_* see pi
  // core tools invoked through fabric_exec in full-code mode — exactly as
  // they would for a top-level call in the normal (non-codemode) flow, and
  // exactly as CapturedToolsProvider already does for captured extension
  // tools. tool_result patches (content/details/isError) are applied, so
  // extensions like pi-vision-handoff can replace image blocks with text
  // descriptions before the result returns to the sandbox.
  async #invokeWithEvents(
    name: PiCoreToolName,
    tool: ToolDefinition<any, any, any>,
    args: Record<string, unknown>,
    context: FabricInvocationContext,
    runner: ExtensionRunner,
  ): Promise<unknown> {
    const toolCallId = context.nestedToolCallId;
    await runAbortable(context.signal, () => runner.emit({
      type: "tool_execution_start",
      toolCallId,
      toolName: name,
      args,
    }));
    let result: PiToolResult;
    let isError = false;
    let thrown: unknown;
    let updateTail: Promise<void> = Promise.resolve();
    try {
      const preflight = await runAbortable(context.signal, () => runner.emitToolCall({
        type: "tool_call",
        toolName: name,
        toolCallId,
        input: args,
      }));
      context.updateArguments?.(args);
      if (preflight?.block) {
        throw new Error(preflight.reason || `${this.#toolLabel(name)} was blocked`);
      }
      // tool_call hooks may mutate the argument object. Never let a hook move a
      // filesystem operation outside the committed project root.
      this.#assertProjectPath(name, args, true);
      result = (await runAbortable(context.signal, () => tool.execute(
        toolCallId,
        args,
        context.signal,
        (partialResult) => {
          this.#attachPartialPreview(name, partialResult, args, context);
          updateTail = updateTail
            .then(() =>
              runAbortable(context.signal, () => runner.emit({
                type: "tool_execution_update",
                toolCallId,
                toolName: name,
                args,
                partialResult,
              })),
            )
            .catch(() => undefined);
        },
        context.extensionContext as ExtensionContext,
      ))) as PiToolResult;
    } catch (error) {
      thrown = error;
      isError = true;
      result = {
        content: [
          { type: "text", text: error instanceof Error ? error.message : String(error) },
        ],
        details: undefined,
      };
    }

    await updateTail;
    throwIfAborted(context.signal);

    // Capture the read's image blocks BEFORE any tool_result patch —
    // pi-vision-handoff swaps image→description here, which would leave
    // nothing to re-attach for the kitty preview.
    this.#attachReadMedia(name, result, context);

    const patch = await runAbortable(context.signal, () => runner.emitToolResult({
      type: "tool_result",
      toolName: name,
      toolCallId,
      input: args,
      content: result.content,
      details: result.details,
      isError,
    }));
    if (patch) {
      result = {
        ...result,
        content: patch.content ?? result.content,
        ...(patch.details !== undefined ? { details: patch.details } : {}),
      };
      isError = patch.isError ?? isError;
    }

    // Capture the read's clean text note AFTER the patch — the handoff strips
    // pi's non-vision note and swaps the image for a description, so the first
    // surviving text block is the short read note (not the verbose description).
    this.#attachReadNote(name, result, context);

    await runAbortable(context.signal, () => runner.emit({
      type: "tool_execution_end",
      toolCallId,
      toolName: name,
      result,
      isError,
    }));

    if (isError) {
      const text = textContent(result.content).trim();
      throw new Error(text || (thrown instanceof Error ? thrown.message : `${this.#toolLabel(name)} failed`));
    }
    this.#attachPreview(name, result, args, context);
    return this.#normalizeResult(name, result, args);
  }

  // Schema-enforce and early-startup calls may have no ExtensionRunner, so the
  // top-level tool_result marker middleware cannot run. Expand again at the
  // provider boundary; replacement is idempotent when middleware already ran.
  #normalizeResult(
    name: PiCoreToolName,
    result: { content: ToolContent; details?: unknown; isError?: boolean },
    args: Record<string, unknown>,
  ): unknown {
    const normalized = normalizeResult(name, result);
    if (name !== "read" || typeof normalized !== "string") return normalized;
    const requestedPath = this.#requestedPaths.get(args);
    const markerArgs = requestedPath === undefined ? args : { ...args, path: requestedPath };
    return expandSkillDirMarkersForRead(normalized, markerArgs, this.#cwd);
  }

  #attachPartialPreview(
    name: PiCoreToolName,
    partialResult: { content: ToolContent; details?: unknown; isError?: boolean },
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): void {
    const progress = textContent(partialResult.content).trim();
    const boundedProgress = Array.from(progress).slice(-4_000).join("");
    const bashCommand =
      name === "bash" &&
      typeof args.command === "string" &&
      args.command.length <= MAX_RENDERER_ARGUMENT_CHARS
        ? args.command
        : undefined;
    context.attachPreview?.({
      result: boundedProgress,
      ...(bashCommand !== undefined ? { bashCommand } : {}),
    });
    context.update(`${name}: ${boundedProgress.slice(-500) || "running"}`);
  }

  #attachPreview(
    name: PiCoreToolName,
    result: { content: ToolContent; details?: unknown; isError?: boolean },
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): void {
    if (result.isError) return;
    const details = result.details;
    const detailRecord =
      typeof details === "object" && details !== null && !Array.isArray(details)
        ? (details as Record<string, unknown>)
        : undefined;
    const bashCommand =
      name === "bash" &&
      typeof args.command === "string" &&
      args.command.length <= MAX_RENDERER_ARGUMENT_CHARS
        ? args.command
        : undefined;
    const writeInput =
      name === "write" && typeof args.content === "string" ? args.content : undefined;
    const writeContent =
      writeInput !== undefined ? writeContentForPreview(writeInput) : undefined;
    const writeByteLength =
      writeInput !== undefined ? Buffer.byteLength(writeInput, "utf8") : undefined;
    const writeLineCount =
      writeInput !== undefined ? countContentLines(writeInput) : undefined;
    const hasWriteBefore =
      name === "write" &&
      detailRecord !== undefined &&
      Object.prototype.hasOwnProperty.call(detailRecord, "codePreviewBeforeWrite");
    context.attachPreview?.({
      result: normalizeResult(name, result),
      ...(bashCommand !== undefined ? { bashCommand } : {}),
      ...(writeContent !== undefined ? { writeContent } : {}),
      ...(writeByteLength !== undefined ? { writeByteLength } : {}),
      ...(writeLineCount !== undefined ? { writeLineCount } : {}),
      ...(details !== undefined ? { details } : {}),
      ...(hasWriteBefore
        ? {
            codePreviewBeforeWrite: detailRecord?.codePreviewBeforeWrite,
            writeBeforeCaptured: true,
          }
        : {}),
    });
  }

  // `pi.read` of an image file returns `{ type: "image" }` content blocks.
  // normalizeResult strips them — the sandbox holds text only and the model
  // return is a string — but the single-call render wants them re-attached so
  // pi core's ToolExecutionComponent renders the kitty image preview, the same
  // path a native `read` takes. Hand them out-of-band via context.attachMedia,
  // which the ActionRegistry stashes on the call audit; this bypasses the
  // result char bound that would otherwise truncate the base64 payload.
  //
  // Must run BEFORE any tool_result patch: pi-vision-handoff SWAPS image blocks
  // for text descriptions here (so the description becomes the sandbox value),
  // which would leave no image to capture. Capturing the original blocks lets
  // the single-call render show the kitty image, and the handoff's `context`
  // hook supplies the description to the model — exactly how a native `read`
  // keeps its image for kitty and swaps it only on the LLM-bound clone.
  #attachReadMedia(
    name: PiCoreToolName,
    result: { content?: unknown },
    context: FabricInvocationContext,
  ): void {
    if (name !== "read") return;
    const blocks = imageBlocks(result?.content);
    if (blocks.length > 0) context.attachMedia?.(blocks);
  }

  // The read tool's own text note (e.g. "Read image file [image/png]"), captured
  // AFTER any tool_result patch — pi-vision-handoff swaps image→description and
  // strips pi's "[Current model does not support images…]" note there, so the
  // first surviving text block is the clean note. Used as the single-call body
  // and content text so the preview shows the kitty image + the clean note
  // instead of the handoff's verbose description; the model still receives the
  // description via the handoff's `context` hook swapping the image block.
  #attachReadNote(
    name: PiCoreToolName,
    result: { content?: unknown },
    context: FabricInvocationContext,
  ): void {
    if (name !== "read") return;
    const content = result?.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        context.attachMedia?.([], (block as { text: string }).text);
        return;
      }
    }
  }

  #toolLabel(name: string): string {
    return this.name === "pi" ? `Pi tool ${name}` : `Kiro Fabric tool k.${name}`;
  }

  #descriptor(
    name: PiCoreToolName,
    tool: ToolDefinition<any, any, any>,
  ): FabricActionDescriptor {
    return {
      name,
      description: tool.description,
      inputSchema: tool.parameters as unknown as Record<string, unknown>,
      risk: riskForTool(name),
      namespace: "builtin",
    };
  }
}
