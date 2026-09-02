import { createRequire as __createRequire } from "node:module";
import { fileURLToPath as __fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
globalThis.__filename = __fileURLToPath(import.meta.url);
globalThis.__dirname = __dirnameOf(globalThis.__filename);
const require = __createRequire(import.meta.url);

import {
  canonicalPathContains,
  inspectCanonicalPath,
  sameCanonicalFilesystemIdentity
} from "./chunk-4KRLFCN5.js";
import {
  transpileFabricCodeWithSourceMap,
  typeCheckFabricCodeInWorker
} from "./chunk-LMHNRHGR.js";
import "./chunk-G3LABT6U.js";
import "./chunk-FWH3VULO.js";
import "./chunk-G6V3LW4W.js";
import {
  AjvJsonSchemaValidator,
  CallToolRequestSchema,
  CallToolResultSchema,
  CreateMessageResultSchema,
  CreateMessageResultWithToolsSchema,
  CreateTaskResultSchema,
  ElicitResultSchema,
  EmptyResultSchema,
  ErrorCode,
  InitializeRequestSchema,
  InitializedNotificationSchema,
  LATEST_PROTOCOL_VERSION,
  ListRootsResultSchema,
  ListToolsRequestSchema,
  LoggingLevelSchema,
  McpError,
  Protocol,
  ReadBuffer,
  RootsListChangedNotificationSchema,
  SUPPORTED_PROTOCOL_VERSIONS,
  SetLevelRequestSchema,
  assertClientRequestTaskCapability,
  assertToolsCallTaskCapability,
  getLiteralValue,
  getObjectShape,
  mergeCapabilities,
  safeParse,
  serializeMessage
} from "./chunk-4LKE3ECX.js";
import {
  __export
} from "./chunk-LSWTYIW3.js";

// src/kiro/mcp-server.ts
import { readFileSync } from "node:fs";
import path8 from "node:path";

// node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@4.4.3/node_modules/@modelcontextprotocol/sdk/dist/esm/experimental/tasks/server.js
var ExperimentalServerTasks = class {
  constructor(_server) {
    this._server = _server;
  }
  /**
   * Sends a request and returns an AsyncGenerator that yields response messages.
   * The generator is guaranteed to end with either a 'result' or 'error' message.
   *
   * This method provides streaming access to request processing, allowing you to
   * observe intermediate task status updates for task-augmented requests.
   *
   * @param request - The request to send
   * @param resultSchema - Zod schema for validating the result
   * @param options - Optional request options (timeout, signal, task creation params, etc.)
   * @returns AsyncGenerator that yields ResponseMessage objects
   *
   * @experimental
   */
  requestStream(request, resultSchema, options) {
    return this._server.requestStream(request, resultSchema, options);
  }
  /**
   * Sends a sampling request and returns an AsyncGenerator that yields response messages.
   * The generator is guaranteed to end with either a 'result' or 'error' message.
   *
   * For task-augmented requests, yields 'taskCreated' and 'taskStatus' messages
   * before the final result.
   *
   * @example
   * ```typescript
   * const stream = server.experimental.tasks.createMessageStream({
   *     messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
   *     maxTokens: 100
   * }, {
   *     onprogress: (progress) => {
   *         // Handle streaming tokens via progress notifications
   *         console.log('Progress:', progress.message);
   *     }
   * });
   *
   * for await (const message of stream) {
   *     switch (message.type) {
   *         case 'taskCreated':
   *             console.log('Task created:', message.task.taskId);
   *             break;
   *         case 'taskStatus':
   *             console.log('Task status:', message.task.status);
   *             break;
   *         case 'result':
   *             console.log('Final result:', message.result);
   *             break;
   *         case 'error':
   *             console.error('Error:', message.error);
   *             break;
   *     }
   * }
   * ```
   *
   * @param params - The sampling request parameters
   * @param options - Optional request options (timeout, signal, task creation params, onprogress, etc.)
   * @returns AsyncGenerator that yields ResponseMessage objects
   *
   * @experimental
   */
  createMessageStream(params, options) {
    const clientCapabilities = this._server.getClientCapabilities();
    if ((params.tools || params.toolChoice) && !clientCapabilities?.sampling?.tools) {
      throw new Error("Client does not support sampling tools capability.");
    }
    if (params.messages.length > 0) {
      const lastMessage = params.messages[params.messages.length - 1];
      const lastContent = Array.isArray(lastMessage.content) ? lastMessage.content : [lastMessage.content];
      const hasToolResults = lastContent.some((c) => c.type === "tool_result");
      const previousMessage = params.messages.length > 1 ? params.messages[params.messages.length - 2] : void 0;
      const previousContent = previousMessage ? Array.isArray(previousMessage.content) ? previousMessage.content : [previousMessage.content] : [];
      const hasPreviousToolUse = previousContent.some((c) => c.type === "tool_use");
      if (hasToolResults) {
        if (lastContent.some((c) => c.type !== "tool_result")) {
          throw new Error("The last message must contain only tool_result content if any is present");
        }
        if (!hasPreviousToolUse) {
          throw new Error("tool_result blocks are not matching any tool_use from the previous message");
        }
      }
      if (hasPreviousToolUse) {
        const toolUseIds = new Set(previousContent.filter((c) => c.type === "tool_use").map((c) => c.id));
        const toolResultIds = new Set(lastContent.filter((c) => c.type === "tool_result").map((c) => c.toolUseId));
        if (toolUseIds.size !== toolResultIds.size || ![...toolUseIds].every((id) => toolResultIds.has(id))) {
          throw new Error("ids of tool_result blocks and tool_use blocks from previous message do not match");
        }
      }
    }
    return this.requestStream({
      method: "sampling/createMessage",
      params
    }, CreateMessageResultSchema, options);
  }
  /**
   * Sends an elicitation request and returns an AsyncGenerator that yields response messages.
   * The generator is guaranteed to end with either a 'result' or 'error' message.
   *
   * For task-augmented requests (especially URL-based elicitation), yields 'taskCreated'
   * and 'taskStatus' messages before the final result.
   *
   * @example
   * ```typescript
   * const stream = server.experimental.tasks.elicitInputStream({
   *     mode: 'url',
   *     message: 'Please authenticate',
   *     elicitationId: 'auth-123',
   *     url: 'https://example.com/auth'
   * }, {
   *     task: { ttl: 300000 } // Task-augmented for long-running auth flow
   * });
   *
   * for await (const message of stream) {
   *     switch (message.type) {
   *         case 'taskCreated':
   *             console.log('Task created:', message.task.taskId);
   *             break;
   *         case 'taskStatus':
   *             console.log('Task status:', message.task.status);
   *             break;
   *         case 'result':
   *             console.log('User action:', message.result.action);
   *             break;
   *         case 'error':
   *             console.error('Error:', message.error);
   *             break;
   *     }
   * }
   * ```
   *
   * @param params - The elicitation request parameters
   * @param options - Optional request options (timeout, signal, task creation params, etc.)
   * @returns AsyncGenerator that yields ResponseMessage objects
   *
   * @experimental
   */
  elicitInputStream(params, options) {
    const clientCapabilities = this._server.getClientCapabilities();
    const mode = params.mode ?? "form";
    switch (mode) {
      case "url": {
        if (!clientCapabilities?.elicitation?.url) {
          throw new Error("Client does not support url elicitation.");
        }
        break;
      }
      case "form": {
        if (!clientCapabilities?.elicitation?.form) {
          throw new Error("Client does not support form elicitation.");
        }
        break;
      }
    }
    const normalizedParams = mode === "form" && params.mode === void 0 ? { ...params, mode: "form" } : params;
    return this.requestStream({
      method: "elicitation/create",
      params: normalizedParams
    }, ElicitResultSchema, options);
  }
  /**
   * Gets the current status of a task.
   *
   * @param taskId - The task identifier
   * @param options - Optional request options
   * @returns The task status
   *
   * @experimental
   */
  async getTask(taskId, options) {
    return this._server.getTask({ taskId }, options);
  }
  /**
   * Retrieves the result of a completed task.
   *
   * @param taskId - The task identifier
   * @param resultSchema - Zod schema for validating the result
   * @param options - Optional request options
   * @returns The task result
   *
   * @experimental
   */
  async getTaskResult(taskId, resultSchema, options) {
    return this._server.getTaskResult({ taskId }, resultSchema, options);
  }
  /**
   * Lists tasks with optional pagination.
   *
   * @param cursor - Optional pagination cursor
   * @param options - Optional request options
   * @returns List of tasks with optional next cursor
   *
   * @experimental
   */
  async listTasks(cursor, options) {
    return this._server.listTasks(cursor ? { cursor } : void 0, options);
  }
  /**
   * Cancels a running task.
   *
   * @param taskId - The task identifier
   * @param options - Optional request options
   *
   * @experimental
   */
  async cancelTask(taskId, options) {
    return this._server.cancelTask({ taskId }, options);
  }
};

// node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@4.4.3/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js
var Server = class extends Protocol {
  /**
   * Initializes this server with the given name and version information.
   */
  constructor(_serverInfo, options) {
    super(options);
    this._serverInfo = _serverInfo;
    this._loggingLevels = /* @__PURE__ */ new Map();
    this.LOG_LEVEL_SEVERITY = new Map(LoggingLevelSchema.options.map((level, index) => [level, index]));
    this.isMessageIgnored = (level, sessionId) => {
      const currentLevel = this._loggingLevels.get(sessionId);
      return currentLevel ? this.LOG_LEVEL_SEVERITY.get(level) < this.LOG_LEVEL_SEVERITY.get(currentLevel) : false;
    };
    this._capabilities = options?.capabilities ?? {};
    this._instructions = options?.instructions;
    this._jsonSchemaValidator = options?.jsonSchemaValidator ?? new AjvJsonSchemaValidator();
    this.setRequestHandler(InitializeRequestSchema, (request) => this._oninitialize(request));
    this.setNotificationHandler(InitializedNotificationSchema, () => this.oninitialized?.());
    if (this._capabilities.logging) {
      this.setRequestHandler(SetLevelRequestSchema, async (request, extra) => {
        const transportSessionId = extra.sessionId || extra.requestInfo?.headers["mcp-session-id"] || void 0;
        const { level } = request.params;
        const parseResult = LoggingLevelSchema.safeParse(level);
        if (parseResult.success) {
          this._loggingLevels.set(transportSessionId, parseResult.data);
        }
        return {};
      });
    }
  }
  /**
   * Access experimental features.
   *
   * WARNING: These APIs are experimental and may change without notice.
   *
   * @experimental
   */
  get experimental() {
    if (!this._experimental) {
      this._experimental = {
        tasks: new ExperimentalServerTasks(this)
      };
    }
    return this._experimental;
  }
  /**
   * Registers new capabilities. This can only be called before connecting to a transport.
   *
   * The new capabilities will be merged with any existing capabilities previously given (e.g., at initialization).
   */
  registerCapabilities(capabilities) {
    if (this.transport) {
      throw new Error("Cannot register capabilities after connecting to transport");
    }
    this._capabilities = mergeCapabilities(this._capabilities, capabilities);
  }
  /**
   * Override request handler registration to enforce server-side validation for tools/call.
   */
  setRequestHandler(requestSchema, handler) {
    const shape = getObjectShape(requestSchema);
    const methodSchema = shape?.method;
    if (!methodSchema) {
      throw new Error("Schema is missing a method literal");
    }
    const methodValue = getLiteralValue(methodSchema);
    if (typeof methodValue !== "string") {
      throw new Error("Schema method literal must be a string");
    }
    const method = methodValue;
    if (method === "tools/call") {
      const wrappedHandler = async (request, extra) => {
        const validatedRequest = safeParse(CallToolRequestSchema, request);
        if (!validatedRequest.success) {
          const errorMessage = validatedRequest.error instanceof Error ? validatedRequest.error.message : String(validatedRequest.error);
          throw new McpError(ErrorCode.InvalidParams, `Invalid tools/call request: ${errorMessage}`);
        }
        const { params } = validatedRequest.data;
        const result = await Promise.resolve(handler(request, extra));
        if (params.task) {
          const taskValidationResult = safeParse(CreateTaskResultSchema, result);
          if (!taskValidationResult.success) {
            const errorMessage = taskValidationResult.error instanceof Error ? taskValidationResult.error.message : String(taskValidationResult.error);
            throw new McpError(ErrorCode.InvalidParams, `Invalid task creation result: ${errorMessage}`);
          }
          return taskValidationResult.data;
        }
        const validationResult = safeParse(CallToolResultSchema, result);
        if (!validationResult.success) {
          const errorMessage = validationResult.error instanceof Error ? validationResult.error.message : String(validationResult.error);
          throw new McpError(ErrorCode.InvalidParams, `Invalid tools/call result: ${errorMessage}`);
        }
        return validationResult.data;
      };
      return super.setRequestHandler(requestSchema, wrappedHandler);
    }
    return super.setRequestHandler(requestSchema, handler);
  }
  assertCapabilityForMethod(method) {
    switch (method) {
      case "sampling/createMessage":
        if (!this._clientCapabilities?.sampling) {
          throw new Error(`Client does not support sampling (required for ${method})`);
        }
        break;
      case "elicitation/create":
        if (!this._clientCapabilities?.elicitation) {
          throw new Error(`Client does not support elicitation (required for ${method})`);
        }
        break;
      case "roots/list":
        if (!this._clientCapabilities?.roots) {
          throw new Error(`Client does not support listing roots (required for ${method})`);
        }
        break;
      case "ping":
        break;
    }
  }
  assertNotificationCapability(method) {
    switch (method) {
      case "notifications/message":
        if (!this._capabilities.logging) {
          throw new Error(`Server does not support logging (required for ${method})`);
        }
        break;
      case "notifications/resources/updated":
      case "notifications/resources/list_changed":
        if (!this._capabilities.resources) {
          throw new Error(`Server does not support notifying about resources (required for ${method})`);
        }
        break;
      case "notifications/tools/list_changed":
        if (!this._capabilities.tools) {
          throw new Error(`Server does not support notifying of tool list changes (required for ${method})`);
        }
        break;
      case "notifications/prompts/list_changed":
        if (!this._capabilities.prompts) {
          throw new Error(`Server does not support notifying of prompt list changes (required for ${method})`);
        }
        break;
      case "notifications/elicitation/complete":
        if (!this._clientCapabilities?.elicitation?.url) {
          throw new Error(`Client does not support URL elicitation (required for ${method})`);
        }
        break;
      case "notifications/cancelled":
        break;
      case "notifications/progress":
        break;
    }
  }
  assertRequestHandlerCapability(method) {
    if (!this._capabilities) {
      return;
    }
    switch (method) {
      case "completion/complete":
        if (!this._capabilities.completions) {
          throw new Error(`Server does not support completions (required for ${method})`);
        }
        break;
      case "logging/setLevel":
        if (!this._capabilities.logging) {
          throw new Error(`Server does not support logging (required for ${method})`);
        }
        break;
      case "prompts/get":
      case "prompts/list":
        if (!this._capabilities.prompts) {
          throw new Error(`Server does not support prompts (required for ${method})`);
        }
        break;
      case "resources/list":
      case "resources/templates/list":
      case "resources/read":
        if (!this._capabilities.resources) {
          throw new Error(`Server does not support resources (required for ${method})`);
        }
        break;
      case "tools/call":
      case "tools/list":
        if (!this._capabilities.tools) {
          throw new Error(`Server does not support tools (required for ${method})`);
        }
        break;
      case "tasks/get":
      case "tasks/list":
      case "tasks/result":
      case "tasks/cancel":
        if (!this._capabilities.tasks) {
          throw new Error(`Server does not support tasks capability (required for ${method})`);
        }
        break;
      case "ping":
      case "initialize":
        break;
    }
  }
  assertTaskCapability(method) {
    assertClientRequestTaskCapability(this._clientCapabilities?.tasks?.requests, method, "Client");
  }
  assertTaskHandlerCapability(method) {
    if (!this._capabilities) {
      return;
    }
    assertToolsCallTaskCapability(this._capabilities.tasks?.requests, method, "Server");
  }
  async _oninitialize(request) {
    const requestedVersion = request.params.protocolVersion;
    this._clientCapabilities = request.params.capabilities;
    this._clientVersion = request.params.clientInfo;
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion) ? requestedVersion : LATEST_PROTOCOL_VERSION;
    return {
      protocolVersion,
      capabilities: this.getCapabilities(),
      serverInfo: this._serverInfo,
      ...this._instructions && { instructions: this._instructions }
    };
  }
  /**
   * After initialization has completed, this will be populated with the client's reported capabilities.
   */
  getClientCapabilities() {
    return this._clientCapabilities;
  }
  /**
   * After initialization has completed, this will be populated with information about the client's name and version.
   */
  getClientVersion() {
    return this._clientVersion;
  }
  getCapabilities() {
    return this._capabilities;
  }
  async ping() {
    return this.request({ method: "ping" }, EmptyResultSchema);
  }
  // Implementation
  async createMessage(params, options) {
    if (params.tools || params.toolChoice) {
      if (!this._clientCapabilities?.sampling?.tools) {
        throw new Error("Client does not support sampling tools capability.");
      }
    }
    if (params.messages.length > 0) {
      const lastMessage = params.messages[params.messages.length - 1];
      const lastContent = Array.isArray(lastMessage.content) ? lastMessage.content : [lastMessage.content];
      const hasToolResults = lastContent.some((c) => c.type === "tool_result");
      const previousMessage = params.messages.length > 1 ? params.messages[params.messages.length - 2] : void 0;
      const previousContent = previousMessage ? Array.isArray(previousMessage.content) ? previousMessage.content : [previousMessage.content] : [];
      const hasPreviousToolUse = previousContent.some((c) => c.type === "tool_use");
      if (hasToolResults) {
        if (lastContent.some((c) => c.type !== "tool_result")) {
          throw new Error("The last message must contain only tool_result content if any is present");
        }
        if (!hasPreviousToolUse) {
          throw new Error("tool_result blocks are not matching any tool_use from the previous message");
        }
      }
      if (hasPreviousToolUse) {
        const toolUseIds = new Set(previousContent.filter((c) => c.type === "tool_use").map((c) => c.id));
        const toolResultIds = new Set(lastContent.filter((c) => c.type === "tool_result").map((c) => c.toolUseId));
        if (toolUseIds.size !== toolResultIds.size || ![...toolUseIds].every((id) => toolResultIds.has(id))) {
          throw new Error("ids of tool_result blocks and tool_use blocks from previous message do not match");
        }
      }
    }
    if (params.tools) {
      return this.request({ method: "sampling/createMessage", params }, CreateMessageResultWithToolsSchema, options);
    }
    return this.request({ method: "sampling/createMessage", params }, CreateMessageResultSchema, options);
  }
  /**
   * Creates an elicitation request for the given parameters.
   * For backwards compatibility, `mode` may be omitted for form requests and will default to `'form'`.
   * @param params The parameters for the elicitation request.
   * @param options Optional request options.
   * @returns The result of the elicitation request.
   */
  async elicitInput(params, options) {
    const mode = params.mode ?? "form";
    switch (mode) {
      case "url": {
        if (!this._clientCapabilities?.elicitation?.url) {
          throw new Error("Client does not support url elicitation.");
        }
        const urlParams = params;
        return this.request({ method: "elicitation/create", params: urlParams }, ElicitResultSchema, options);
      }
      case "form": {
        if (!this._clientCapabilities?.elicitation?.form) {
          throw new Error("Client does not support form elicitation.");
        }
        const formParams = params.mode === "form" ? params : { ...params, mode: "form" };
        const result = await this.request({ method: "elicitation/create", params: formParams }, ElicitResultSchema, options);
        if (result.action === "accept" && result.content && formParams.requestedSchema) {
          try {
            const validator = this._jsonSchemaValidator.getValidator(formParams.requestedSchema);
            const validationResult = validator(result.content);
            if (!validationResult.valid) {
              throw new McpError(ErrorCode.InvalidParams, `Elicitation response content does not match requested schema: ${validationResult.errorMessage}`);
            }
          } catch (error) {
            if (error instanceof McpError) {
              throw error;
            }
            throw new McpError(ErrorCode.InternalError, `Error validating elicitation response: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        return result;
      }
    }
  }
  /**
   * Creates a reusable callback that, when invoked, will send a `notifications/elicitation/complete`
   * notification for the specified elicitation ID.
   *
   * @param elicitationId The ID of the elicitation to mark as complete.
   * @param options Optional notification options. Useful when the completion notification should be related to a prior request.
   * @returns A function that emits the completion notification when awaited.
   */
  createElicitationCompletionNotifier(elicitationId, options) {
    if (!this._clientCapabilities?.elicitation?.url) {
      throw new Error("Client does not support URL elicitation (required for notifications/elicitation/complete)");
    }
    return () => this.notification({
      method: "notifications/elicitation/complete",
      params: {
        elicitationId
      }
    }, options);
  }
  async listRoots(params, options) {
    return this.request({ method: "roots/list", params }, ListRootsResultSchema, options);
  }
  /**
   * Sends a logging message to the client, if connected.
   * Note: You only need to send the parameters object, not the entire JSON RPC message
   * @see LoggingMessageNotification
   * @param params
   * @param sessionId optional for stateless and backward compatibility
   */
  async sendLoggingMessage(params, sessionId) {
    if (this._capabilities.logging) {
      if (!this.isMessageIgnored(params.level, sessionId)) {
        return this.notification({ method: "notifications/message", params });
      }
    }
  }
  async sendResourceUpdated(params) {
    return this.notification({
      method: "notifications/resources/updated",
      params
    });
  }
  async sendResourceListChanged() {
    return this.notification({
      method: "notifications/resources/list_changed"
    });
  }
  async sendToolListChanged() {
    return this.notification({ method: "notifications/tools/list_changed" });
  }
  async sendPromptListChanged() {
    return this.notification({ method: "notifications/prompts/list_changed" });
  }
};

// node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_zod@4.4.3/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js
import process2 from "node:process";
var StdioServerTransport = class {
  constructor(_stdin = process2.stdin, _stdout = process2.stdout, options) {
    this._stdin = _stdin;
    this._stdout = _stdout;
    this._started = false;
    this._ondata = (chunk) => {
      try {
        this._readBuffer.append(chunk);
        this.processReadBuffer();
      } catch (error) {
        this.onerror?.(error);
        this.close().catch(() => {
        });
      }
    };
    this._onerror = (error) => {
      this.onerror?.(error);
    };
    this._readBuffer = new ReadBuffer({ maxBufferSize: options?.maxBufferSize });
  }
  /**
   * Starts listening for messages on stdin.
   */
  async start() {
    if (this._started) {
      throw new Error("StdioServerTransport already started! If using Server class, note that connect() calls start() automatically.");
    }
    this._started = true;
    this._stdin.on("data", this._ondata);
    this._stdin.on("error", this._onerror);
  }
  processReadBuffer() {
    while (true) {
      try {
        const message = this._readBuffer.readMessage();
        if (message === null) {
          break;
        }
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error);
      }
    }
  }
  async close() {
    this._stdin.off("data", this._ondata);
    this._stdin.off("error", this._onerror);
    const remainingDataListeners = this._stdin.listenerCount("data");
    if (remainingDataListeners === 0) {
      this._stdin.pause();
    }
    this._readBuffer.clear();
    this.onclose?.();
  }
  send(message) {
    return new Promise((resolve) => {
      const json = serializeMessage(message);
      if (this._stdout.write(json)) {
        resolve();
      } else {
        this._stdout.once("drain", resolve);
      }
    });
  }
};

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/arguments/arguments.mjs
var arguments_exports = {};
__export(arguments_exports, {
  Match: () => Match
});
function Match(args, match) {
  return match[args.length]?.(...args) ?? (() => {
    throw Error("Invalid Arguments");
  })();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/guard/guard.mjs
var guard_exports = {};
__export(guard_exports, {
  Counted: () => Counted,
  Entries: () => Entries,
  EntriesRegExp: () => EntriesRegExp,
  Every: () => Every,
  EveryAll: () => EveryAll,
  GraphemeCount: () => GraphemeCount2,
  HasPropertyKey: () => HasPropertyKey,
  IsArray: () => IsArray,
  IsBigInt: () => IsBigInt,
  IsBoolean: () => IsBoolean,
  IsClassInstance: () => IsClassInstance,
  IsConstructor: () => IsConstructor,
  IsDeepEqual: () => IsDeepEqual,
  IsEqual: () => IsEqual,
  IsFunction: () => IsFunction,
  IsGreaterEqualThan: () => IsGreaterEqualThan,
  IsGreaterThan: () => IsGreaterThan,
  IsInteger: () => IsInteger,
  IsLessEqualThan: () => IsLessEqualThan,
  IsLessThan: () => IsLessThan,
  IsMaxLength: () => IsMaxLength2,
  IsMinLength: () => IsMinLength2,
  IsMultipleOf: () => IsMultipleOf,
  IsNull: () => IsNull,
  IsNumber: () => IsNumber,
  IsObject: () => IsObject,
  IsObjectNotArray: () => IsObjectNotArray,
  IsString: () => IsString,
  IsSymbol: () => IsSymbol,
  IsUndefined: () => IsUndefined,
  IsUnsafePropertyKey: () => IsUnsafePropertyKey,
  IsValueLike: () => IsValueLike,
  Keys: () => Keys,
  ShiftLeft: () => ShiftLeft,
  Some: () => Some,
  SomeAll: () => SomeAll,
  Symbols: () => Symbols,
  Values: () => Values
});

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/guard/string.mjs
function IsBetween(value, min, max) {
  return value >= min && value <= max;
}
function IsZeroWidthJoiner(value) {
  return value === 8205;
}
function IsHighSurrogate(value) {
  return IsBetween(value, 55296, 56319);
}
function IsRegionalIndicator(value) {
  return IsBetween(value, 127462, 127487);
}
function IsVariationSelector(value) {
  return IsBetween(value, 65024, 65039);
}
function IsCombiningMark(value) {
  return IsBetween(value, 768, 879) || IsBetween(value, 6832, 6911) || IsBetween(value, 7616, 7679) || IsBetween(value, 65056, 65071);
}
function CodePointLength(value) {
  return value > 65535 ? 2 : 1;
}
function ConsumeModifiers(value, index) {
  while (index < value.length) {
    const point = value.codePointAt(index);
    if (IsCombiningMark(point) || IsVariationSelector(point)) {
      index += CodePointLength(point);
    } else {
      break;
    }
  }
  return index;
}
function NextGraphemeClusterIndex(value, clusterStart) {
  const startCP = value.codePointAt(clusterStart);
  let clusterEnd = clusterStart + CodePointLength(startCP);
  clusterEnd = ConsumeModifiers(value, clusterEnd);
  while (clusterEnd < value.length - 1 && value[clusterEnd] === "\u200D") {
    const nextCP = value.codePointAt(clusterEnd + 1);
    clusterEnd += 1 + CodePointLength(nextCP);
    clusterEnd = ConsumeModifiers(value, clusterEnd);
  }
  if (IsRegionalIndicator(startCP) && clusterEnd < value.length && IsRegionalIndicator(value.codePointAt(clusterEnd))) {
    clusterEnd += CodePointLength(value.codePointAt(clusterEnd));
  }
  return clusterEnd;
}
function IsGraphemeCodePoint(value) {
  return IsHighSurrogate(value) || IsCombiningMark(value) || IsVariationSelector(value) || IsZeroWidthJoiner(value);
}
function GraphemeCount(value) {
  let count = 0;
  let index = 0;
  while (index < value.length) {
    index = NextGraphemeClusterIndex(value, index);
    count++;
  }
  return count;
}
function IsMinLength(value, minLength) {
  if (minLength === 0)
    return true;
  let count = 0;
  let index = 0;
  while (index < value.length) {
    index = NextGraphemeClusterIndex(value, index);
    count++;
    if (count >= minLength)
      return true;
  }
  return false;
}
function IsMaxLength(value, maxLength) {
  let count = 0;
  let index = 0;
  while (index < value.length) {
    index = NextGraphemeClusterIndex(value, index);
    count++;
    if (count > maxLength)
      return false;
  }
  return true;
}
function IsMinLengthFast(value, minLength) {
  if (minLength === 0)
    return true;
  let index = 0;
  while (index < value.length) {
    if (IsGraphemeCodePoint(value.charCodeAt(index))) {
      return IsMinLength(value, minLength);
    }
    index++;
    if (index >= minLength)
      return true;
  }
  return false;
}
function IsMaxLengthFast(value, maxLength) {
  let index = 0;
  while (index < value.length) {
    if (IsGraphemeCodePoint(value.charCodeAt(index))) {
      return IsMaxLength(value, maxLength);
    }
    index++;
    if (index > maxLength)
      return false;
  }
  return true;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/guard/guard.mjs
function IsArray(value) {
  return Array.isArray(value);
}
function IsBigInt(value) {
  return IsEqual(typeof value, "bigint");
}
function IsBoolean(value) {
  return IsEqual(typeof value, "boolean");
}
function IsConstructor(value) {
  if (IsUndefined(value) || !IsFunction(value))
    return false;
  const result = Function.prototype.toString.call(value);
  if (/^class\s/.test(result))
    return true;
  if (/\[native code\]/.test(result))
    return true;
  return false;
}
function IsFunction(value) {
  return IsEqual(typeof value, "function");
}
function IsInteger(value) {
  return Number.isInteger(value);
}
function IsNull(value) {
  return IsEqual(value, null);
}
function IsNumber(value) {
  return Number.isFinite(value);
}
function IsObjectNotArray(value) {
  return IsObject(value) && !IsArray(value);
}
function IsObject(value) {
  return IsEqual(typeof value, "object") && !IsNull(value);
}
function IsString(value) {
  return IsEqual(typeof value, "string");
}
function IsSymbol(value) {
  return IsEqual(typeof value, "symbol");
}
function IsUndefined(value) {
  return IsEqual(value, void 0);
}
function IsEqual(left, right) {
  return left === right;
}
function IsGreaterThan(left, right) {
  return left > right;
}
function IsLessThan(left, right) {
  return left < right;
}
function IsLessEqualThan(left, right) {
  return left <= right;
}
function IsGreaterEqualThan(left, right) {
  return left >= right;
}
function IsMultipleOf(dividend, divisor) {
  if (IsBigInt(dividend) || IsBigInt(divisor)) {
    return BigInt(dividend) % BigInt(divisor) === 0n;
  }
  const tolerance = 1e-10;
  if (!IsNumber(dividend))
    return true;
  if (IsInteger(dividend) && 1 / divisor % 1 === 0)
    return true;
  const mod = dividend % divisor;
  return Math.min(Math.abs(mod), Math.abs(mod - divisor), Math.abs(mod + divisor)) < tolerance;
}
function IsClassInstance(value) {
  if (!IsObject(value))
    return false;
  const proto = globalThis.Object.getPrototypeOf(value);
  if (IsNull(proto))
    return false;
  return IsEqual(typeof proto.constructor, "function") && !(IsEqual(proto.constructor, globalThis.Object) || IsEqual(proto.constructor.name, "Object"));
}
function IsValueLike(value) {
  return IsBigInt(value) || IsBoolean(value) || IsNull(value) || IsNumber(value) || IsString(value) || IsUndefined(value);
}
function GraphemeCount2(value) {
  return GraphemeCount(value);
}
function IsMaxLength2(value, length) {
  return IsMaxLengthFast(value, length);
}
function IsMinLength2(value, length) {
  return IsMinLengthFast(value, length);
}
function Every(value, offset, callback) {
  for (let index = offset; index < value.length; index++) {
    if (!callback(value[index], index))
      return false;
  }
  return true;
}
function EveryAll(value, offset, callback) {
  let result = true;
  for (let index = offset; index < value.length; index++) {
    if (!callback(value[index], index))
      result = false;
  }
  return result;
}
function Some(value, callback) {
  for (let index = 0; index < value.length; index++) {
    if (callback(value[index], index))
      return true;
  }
  return false;
}
function SomeAll(value, callback) {
  let result = false;
  for (let index = 0; index < value.length; index++) {
    if (callback(value[index], index))
      result = true;
  }
  return result;
}
function Counted(value, callback) {
  return value.reduce((result, value2, index) => callback(value2, index) ? ++result : result, 0);
}
function ShiftLeft(array, true_, false_) {
  return IsEqual(array.length, 0) ? false_() : true_(array[0], array.slice(1));
}
function IsUnsafePropertyKey(key) {
  return IsEqual(key, "__proto__") || IsEqual(key, "constructor") || IsEqual(key, "prototype");
}
function HasPropertyKey(value, key) {
  return IsUnsafePropertyKey(key) ? Object.prototype.hasOwnProperty.call(value, key) : key in value;
}
function EntriesRegExp(value) {
  return Keys(value).map((key) => [new RegExp(`^${key}$`), value[key]]);
}
function Entries(value) {
  return Object.entries(value);
}
function Keys(value) {
  return Object.getOwnPropertyNames(value);
}
function Symbols(value) {
  return Object.getOwnPropertySymbols(value);
}
function Values(value) {
  return Object.values(value);
}
function DeepEqualObject(left, right) {
  if (!IsObject(right))
    return false;
  const keys = Keys(left);
  return IsEqual(keys.length, Keys(right).length) && keys.every((key) => IsDeepEqual(left[key], right[key]));
}
function DeepEqualArray(left, right) {
  return IsArray(right) && IsEqual(left.length, right.length) && left.every((_, index) => IsDeepEqual(left[index], right[index]));
}
function IsDeepEqual(left, right) {
  return IsArray(left) ? DeepEqualArray(left, right) : IsObject(left) ? DeepEqualObject(left, right) : IsEqual(left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/guard/globals.mjs
var globals_exports = {};
__export(globals_exports, {
  IsBigInt64Array: () => IsBigInt64Array,
  IsBigUint64Array: () => IsBigUint64Array,
  IsBoolean: () => IsBoolean2,
  IsDate: () => IsDate,
  IsFloat32Array: () => IsFloat32Array,
  IsFloat64Array: () => IsFloat64Array,
  IsInt16Array: () => IsInt16Array,
  IsInt32Array: () => IsInt32Array,
  IsInt8Array: () => IsInt8Array,
  IsMap: () => IsMap,
  IsNumber: () => IsNumber2,
  IsRegExp: () => IsRegExp,
  IsSet: () => IsSet,
  IsString: () => IsString2,
  IsTypeArray: () => IsTypeArray,
  IsUint16Array: () => IsUint16Array,
  IsUint32Array: () => IsUint32Array,
  IsUint8Array: () => IsUint8Array,
  IsUint8ClampedArray: () => IsUint8ClampedArray
});
function IsBoolean2(value) {
  return value instanceof Boolean;
}
function IsNumber2(value) {
  return value instanceof Number;
}
function IsString2(value) {
  return value instanceof String;
}
function IsTypeArray(value) {
  return globalThis.ArrayBuffer.isView(value);
}
function IsInt8Array(value) {
  return value instanceof globalThis.Int8Array;
}
function IsUint8Array(value) {
  return value instanceof globalThis.Uint8Array;
}
function IsUint8ClampedArray(value) {
  return value instanceof globalThis.Uint8ClampedArray;
}
function IsInt16Array(value) {
  return value instanceof globalThis.Int16Array;
}
function IsUint16Array(value) {
  return value instanceof globalThis.Uint16Array;
}
function IsInt32Array(value) {
  return value instanceof globalThis.Int32Array;
}
function IsUint32Array(value) {
  return value instanceof globalThis.Uint32Array;
}
function IsFloat32Array(value) {
  return value instanceof globalThis.Float32Array;
}
function IsFloat64Array(value) {
  return value instanceof globalThis.Float64Array;
}
function IsBigInt64Array(value) {
  return value instanceof globalThis.BigInt64Array;
}
function IsBigUint64Array(value) {
  return value instanceof globalThis.BigUint64Array;
}
function IsRegExp(value) {
  return value instanceof globalThis.RegExp;
}
function IsDate(value) {
  return value instanceof globalThis.Date;
}
function IsSet(value) {
  return value instanceof globalThis.Set;
}
function IsMap(value) {
  return value instanceof globalThis.Map;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/guard/index.mjs
var guard_default = guard_exports;

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/_refine.mjs
function IsRefine(value) {
  return guard_exports.HasPropertyKey(value, "~refine") && guard_exports.IsArray(value["~refine"]) && guard_exports.Every(value["~refine"], 0, (value2) => guard_exports.IsObject(value2) && guard_exports.HasPropertyKey(value2, "check") && guard_exports.HasPropertyKey(value2, "error") && guard_exports.IsFunction(value2.check) && guard_exports.IsFunction(value2.error));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/schema.mjs
function IsSchemaObject(value) {
  return guard_exports.IsObject(value) && !guard_exports.IsArray(value);
}
function IsSchemaBoolean(value) {
  return guard_exports.IsBoolean(value);
}
function IsSchema(value) {
  return IsSchemaObject(value) || IsSchemaBoolean(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/additionalItems.mjs
function IsAdditionalItems(schema) {
  return guard_exports.HasPropertyKey(schema, "additionalItems") && IsSchema(schema.additionalItems);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/additionalProperties.mjs
function IsAdditionalProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "additionalProperties") && IsSchema(schema.additionalProperties);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/allOf.mjs
function IsAllOf(schema) {
  return guard_exports.HasPropertyKey(schema, "allOf") && guard_exports.IsArray(schema.allOf) && schema.allOf.every((value) => IsSchema(value));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/anchor.mjs
function IsAnchor(schema) {
  return guard_exports.HasPropertyKey(schema, "$anchor") && guard_exports.IsString(schema.$anchor);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/anyOf.mjs
function IsAnyOf(schema) {
  return guard_exports.HasPropertyKey(schema, "anyOf") && guard_exports.IsArray(schema.anyOf) && schema.anyOf.every((value) => IsSchema(value));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/const.mjs
function IsConst(value) {
  return guard_exports.HasPropertyKey(value, "const");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/contains.mjs
function IsContains(schema) {
  return guard_exports.HasPropertyKey(schema, "contains") && IsSchema(schema.contains);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/default.mjs
function IsDefault(schema) {
  return guard_exports.HasPropertyKey(schema, "default");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/dependencies.mjs
function IsDependencies(schema) {
  return guard_exports.HasPropertyKey(schema, "dependencies") && guard_exports.IsObject(schema.dependencies) && Object.values(schema.dependencies).every((value) => IsSchema(value) || guard_exports.IsArray(value) && value.every((value2) => guard_exports.IsString(value2)));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/dependentRequired.mjs
function IsDependentRequired(schema) {
  return guard_exports.HasPropertyKey(schema, "dependentRequired") && guard_exports.IsObject(schema.dependentRequired) && Object.values(schema.dependentRequired).every((value) => guard_exports.IsArray(value) && value.every((value2) => guard_exports.IsString(value2)));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/dependentSchemas.mjs
function IsDependentSchemas(schema) {
  return guard_exports.HasPropertyKey(schema, "dependentSchemas") && guard_exports.IsObject(schema.dependentSchemas) && Object.values(schema.dependentSchemas).every((value) => IsSchema(value));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/dynamicAnchor.mjs
function IsDynamicAnchor(schema) {
  return guard_exports.HasPropertyKey(schema, "$dynamicAnchor") && guard_exports.IsString(schema.$dynamicAnchor);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/dynamicRef.mjs
function IsDynamicRef(schema) {
  return guard_exports.HasPropertyKey(schema, "$dynamicRef") && guard_exports.IsString(schema.$dynamicRef);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/else.mjs
function IsElse(schema) {
  return guard_exports.HasPropertyKey(schema, "else") && IsSchema(schema.else);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/enum.mjs
function IsEnum(schema) {
  return guard_exports.HasPropertyKey(schema, "enum") && guard_exports.IsArray(schema.enum);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/exclusiveMaximum.mjs
function IsExclusiveMaximum(schema) {
  return guard_exports.HasPropertyKey(schema, "exclusiveMaximum") && (guard_exports.IsNumber(schema.exclusiveMaximum) || guard_exports.IsBigInt(schema.exclusiveMaximum));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/exclusiveMinimum.mjs
function IsExclusiveMinimum(schema) {
  return guard_exports.HasPropertyKey(schema, "exclusiveMinimum") && (guard_exports.IsNumber(schema.exclusiveMinimum) || guard_exports.IsBigInt(schema.exclusiveMinimum));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/format.mjs
function IsFormat(schema) {
  return guard_exports.HasPropertyKey(schema, "format") && guard_exports.IsString(schema.format);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/id.mjs
function IsId(schema) {
  return guard_exports.HasPropertyKey(schema, "$id") && guard_exports.IsString(schema.$id);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/if.mjs
function IsIf(schema) {
  return guard_exports.HasPropertyKey(schema, "if") && IsSchema(schema.if);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/items.mjs
function IsItems(schema) {
  return guard_exports.HasPropertyKey(schema, "items") && (IsSchema(schema.items) || guard_exports.IsArray(schema.items) && schema.items.every((value) => {
    return IsSchema(value);
  }));
}
function IsItemsSized(schema) {
  return IsItems(schema) && guard_exports.IsArray(schema.items);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/maximum.mjs
function IsMaximum(schema) {
  return guard_exports.HasPropertyKey(schema, "maximum") && (guard_exports.IsNumber(schema.maximum) || guard_exports.IsBigInt(schema.maximum));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/maxContains.mjs
function IsMaxContains(schema) {
  return guard_exports.HasPropertyKey(schema, "maxContains") && guard_exports.IsNumber(schema.maxContains);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/maxItems.mjs
function IsMaxItems(schema) {
  return guard_exports.HasPropertyKey(schema, "maxItems") && guard_exports.IsNumber(schema.maxItems);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/maxLength.mjs
function IsMaxLength3(schema) {
  return guard_exports.HasPropertyKey(schema, "maxLength") && guard_exports.IsNumber(schema.maxLength);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/maxProperties.mjs
function IsMaxProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "maxProperties") && guard_exports.IsNumber(schema.maxProperties);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/minimum.mjs
function IsMinimum(schema) {
  return guard_exports.HasPropertyKey(schema, "minimum") && (guard_exports.IsNumber(schema.minimum) || guard_exports.IsBigInt(schema.minimum));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/minContains.mjs
function IsMinContains(schema) {
  return guard_exports.HasPropertyKey(schema, "minContains") && guard_exports.IsNumber(schema.minContains);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/minItems.mjs
function IsMinItems(schema) {
  return guard_exports.HasPropertyKey(schema, "minItems") && guard_exports.IsNumber(schema.minItems);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/minLength.mjs
function IsMinLength3(schema) {
  return guard_exports.HasPropertyKey(schema, "minLength") && guard_exports.IsNumber(schema.minLength);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/minProperties.mjs
function IsMinProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "minProperties") && guard_exports.IsNumber(schema.minProperties);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/multipleOf.mjs
function IsMultipleOf2(schema) {
  return guard_exports.HasPropertyKey(schema, "multipleOf") && (guard_exports.IsNumber(schema.multipleOf) || guard_exports.IsBigInt(schema.multipleOf));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/not.mjs
function IsNot(schema) {
  return guard_exports.HasPropertyKey(schema, "not") && IsSchema(schema.not);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/oneOf.mjs
function IsOneOf(schema) {
  return guard_exports.HasPropertyKey(schema, "oneOf") && guard_exports.IsArray(schema.oneOf) && schema.oneOf.every((value) => IsSchema(value));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/pattern.mjs
function IsPattern(schema) {
  return guard_exports.HasPropertyKey(schema, "pattern") && (guard_exports.IsString(schema.pattern) || schema.pattern instanceof RegExp);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/patternProperties.mjs
function IsPatternProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "patternProperties") && guard_exports.IsObject(schema.patternProperties) && Object.values(schema.patternProperties).every((value) => IsSchema(value));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/prefixItems.mjs
function IsPrefixItems(schema) {
  return guard_exports.HasPropertyKey(schema, "prefixItems") && guard_exports.IsArray(schema.prefixItems) && schema.prefixItems.every((schema2) => IsSchema(schema2));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/properties.mjs
function IsProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "properties") && guard_exports.IsObject(schema.properties) && Object.values(schema.properties).every((value) => IsSchema(value));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/propertyNames.mjs
function IsPropertyNames(schema) {
  return guard_exports.HasPropertyKey(schema, "propertyNames") && (guard_exports.IsObject(schema.propertyNames) || IsSchema(schema.propertyNames));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/recursiveAnchor.mjs
function IsRecursiveAnchor(schema) {
  return guard_exports.HasPropertyKey(schema, "$recursiveAnchor") && guard_exports.IsBoolean(schema.$recursiveAnchor);
}
function IsRecursiveAnchorTrue(schema) {
  return IsRecursiveAnchor(schema) && guard_exports.IsEqual(schema.$recursiveAnchor, true);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/recursiveRef.mjs
function IsRecursiveRef(schema) {
  return guard_exports.HasPropertyKey(schema, "$recursiveRef") && guard_exports.IsString(schema.$recursiveRef);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/ref.mjs
function IsRef(schema) {
  return guard_exports.HasPropertyKey(schema, "$ref") && guard_exports.IsString(schema.$ref);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/required.mjs
function IsRequired(schema) {
  return guard_exports.HasPropertyKey(schema, "required") && guard_exports.IsArray(schema.required) && schema.required.every((value) => guard_exports.IsString(value));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/then.mjs
function IsThen(schema) {
  return guard_exports.HasPropertyKey(schema, "then") && IsSchema(schema.then);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/type.mjs
function IsType(schema) {
  return guard_exports.HasPropertyKey(schema, "type") && (guard_exports.IsString(schema.type) || guard_exports.IsArray(schema.type) && schema.type.every((value) => guard_exports.IsString(value)));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/uniqueItems.mjs
function IsUniqueItems(schema) {
  return guard_exports.HasPropertyKey(schema, "uniqueItems") && guard_exports.IsBoolean(schema.uniqueItems);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/unevaluatedItems.mjs
function IsUnevaluatedItems(schema) {
  return guard_exports.HasPropertyKey(schema, "unevaluatedItems") && IsSchema(schema.unevaluatedItems);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/types/unevaluatedProperties.mjs
function IsUnevaluatedProperties(schema) {
  return guard_exports.HasPropertyKey(schema, "unevaluatedProperties") && IsSchema(schema.unevaluatedProperties);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/_context.mjs
var CheckContext = class {
  constructor() {
    const indices = /* @__PURE__ */ new Set();
    const keys = /* @__PURE__ */ new Set();
    this.stack = [{ indices, keys }];
  }
  // ----------------------------------------------------------------
  // Stack
  // ----------------------------------------------------------------
  Push() {
    const indices = /* @__PURE__ */ new Set();
    const keys = /* @__PURE__ */ new Set();
    this.stack.push({ indices, keys });
    return true;
  }
  Pop() {
    this.stack.pop();
    return true;
  }
  // ----------------------------------------------------------------
  // Top
  // ----------------------------------------------------------------
  AddIndex(index) {
    this.GetIndices().add(index);
    return true;
  }
  AddKey(key) {
    this.GetKeys().add(key);
    return true;
  }
  GetIndices() {
    const top = this.stack[this.stack.length - 1];
    return top.indices;
  }
  GetKeys() {
    const top = this.stack[this.stack.length - 1];
    return top.keys;
  }
  Merge(results) {
    for (const context of results) {
      context.GetIndices().forEach((value) => this.GetIndices().add(value));
      context.GetKeys().forEach((value) => this.GetKeys().add(value));
    }
    return true;
  }
};
var ErrorContext = class extends CheckContext {
  constructor(callback) {
    super();
    this.callback = callback;
  }
  AddError(error) {
    this.callback(error);
    return false;
  }
};
var AccumulatedErrorContext = class extends ErrorContext {
  constructor() {
    super((error) => this.errors.push(error));
    this.errors = [];
  }
  AddError(error) {
    this.errors.push(error);
    return false;
  }
  GetErrors() {
    return this.errors;
  }
};

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/_refine.mjs
function CheckRefine(_stack, _context, schema, value) {
  return guard_exports.Every(schema["~refine"], 0, (refinement, _) => refinement.check(value));
}
function ErrorRefine(_stack, context, schemaPath, instancePath, schema, value) {
  return guard_exports.EveryAll(schema["~refine"], 0, (refinement, index) => {
    return refinement.check(value) || context.AddError({
      keyword: "~refine",
      schemaPath,
      instancePath,
      params: { index, message: refinement.error(value) }
    });
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/additionalItems.mjs
function IsValid(schema) {
  return IsItems(schema) && guard_exports.IsArray(schema.items);
}
function CheckAdditionalItems(stack, context, schema, value) {
  if (!IsValid(schema))
    return true;
  const isAdditionalItems = guard_exports.Every(value, 0, (item, index) => {
    return guard_exports.IsLessThan(index, schema.items.length) || CheckSchemaPushStack(stack, context, schema.additionalItems, item) && context.AddIndex(index);
  });
  return isAdditionalItems;
}
function ErrorAdditionalItems(stack, context, schemaPath, instancePath, schema, value) {
  if (!IsValid(schema))
    return true;
  const isAdditionalItems = guard_exports.Every(value, 0, (item, index) => {
    const nextSchemaPath = `${schemaPath}/additionalItems`;
    const nextInstancePath = `${instancePath}/${index}`;
    return guard_exports.IsLessThan(index, schema.items.length) || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema.additionalItems, item) && context.AddIndex(index);
  });
  return isAdditionalItems;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/additionalProperties.mjs
function GetPropertyKeyAsPattern(key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `^${escaped}$`;
}
function GetPropertiesPattern(schema) {
  const patterns = [];
  if (IsPatternProperties(schema))
    patterns.push(...guard_exports.Keys(schema.patternProperties));
  if (IsProperties(schema))
    patterns.push(...guard_exports.Keys(schema.properties).map(GetPropertyKeyAsPattern));
  return guard_exports.IsEqual(patterns.length, 0) ? "(?!)" : `(${patterns.join("|")})`;
}
function CheckAdditionalProperties(stack, context, schema, value) {
  const regexp = new RegExp(GetPropertiesPattern(schema));
  const isAdditionalProperties = guard_exports.Every(guard_exports.Keys(value), 0, (key, _index) => {
    return regexp.test(key) || CheckSchemaPushStack(stack, context, schema.additionalProperties, value[key]) && context.AddKey(key);
  });
  return isAdditionalProperties;
}
function ErrorAdditionalProperties(stack, context, schemaPath, instancePath, schema, value) {
  const regexp = new RegExp(GetPropertiesPattern(schema));
  const additionalProperties = [];
  const isAdditionalProperties = guard_exports.EveryAll(guard_exports.Keys(value), 0, (key, _index) => {
    const nextSchemaPath = `${schemaPath}/additionalProperties`;
    const nextInstancePath = `${instancePath}/${key}`;
    const nextContext = new AccumulatedErrorContext();
    const isAdditionalProperty = regexp.test(key) || ErrorSchemaPushStack(stack, nextContext, nextSchemaPath, nextInstancePath, schema.additionalProperties, value[key]) && context.AddKey(key);
    if (!isAdditionalProperty)
      additionalProperties.push(key);
    return isAdditionalProperty;
  });
  return isAdditionalProperties || context.AddError({
    keyword: "additionalProperties",
    schemaPath,
    instancePath,
    params: { additionalProperties }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/allOf.mjs
function CheckAllOf(stack, context, schema, value) {
  const results = schema.allOf.reduce((result, schema2) => {
    const nextContext = new CheckContext();
    return CheckSchema(stack, nextContext, schema2, value) ? [...result, nextContext] : result;
  }, []);
  return guard_exports.IsEqual(results.length, schema.allOf.length) && context.Merge(results);
}
function ErrorAllOf(stack, context, schemaPath, instancePath, schema, value) {
  const failedContexts = [];
  const results = schema.allOf.reduce((result, schema2, index) => {
    const nextSchemaPath = `${schemaPath}/allOf/${index}`;
    const nextContext = new AccumulatedErrorContext();
    const isSchema = ErrorSchema(stack, nextContext, nextSchemaPath, instancePath, schema2, value);
    if (!isSchema)
      failedContexts.push(nextContext);
    return isSchema ? [...result, nextContext] : result;
  }, []);
  const isAllOf = guard_exports.IsEqual(results.length, schema.allOf.length) && context.Merge(results);
  if (!isAllOf)
    failedContexts.forEach((failed) => failed.GetErrors().forEach((error) => context.AddError(error)));
  return isAllOf;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/anyOf.mjs
function CheckAnyOf(stack, context, schema, value) {
  const results = schema.anyOf.reduce((result, schema2) => {
    const nextContext = new CheckContext();
    return CheckSchema(stack, nextContext, schema2, value) ? [...result, nextContext] : result;
  }, []);
  return guard_exports.IsGreaterThan(results.length, 0) && context.Merge(results);
}
function ErrorAnyOf(stack, context, schemaPath, instancePath, schema, value) {
  const failedContexts = [];
  const results = schema.anyOf.reduce((result, schema2, index) => {
    const nextContext = new AccumulatedErrorContext();
    const nextSchemaPath = `${schemaPath}/anyOf/${index}`;
    const isSchema = ErrorSchema(stack, nextContext, nextSchemaPath, instancePath, schema2, value);
    if (!isSchema)
      failedContexts.push(nextContext);
    return isSchema ? [...result, nextContext] : result;
  }, []);
  const isAnyOf = guard_exports.IsGreaterThan(results.length, 0) && context.Merge(results);
  if (!isAnyOf)
    failedContexts.forEach((failed) => failed.GetErrors().forEach((error) => context.AddError(error)));
  return isAnyOf || context.AddError({
    keyword: "anyOf",
    schemaPath,
    instancePath,
    params: {}
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/boolean.mjs
function CheckSchemaBoolean(_stack, _context, schema, _value) {
  return schema;
}
function ErrorSchemaBoolean(stack, context, schemaPath, instancePath, schema, value) {
  return CheckSchemaBoolean(stack, context, schema, value) || context.AddError({
    keyword: "boolean",
    schemaPath,
    instancePath,
    params: {}
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/const.mjs
function CheckConst(_stack, _context, schema, value) {
  return guard_exports.IsValueLike(schema.const) ? guard_exports.IsEqual(value, schema.const) : guard_exports.IsDeepEqual(value, schema.const);
}
function ErrorConst(stack, context, schemaPath, instancePath, schema, value) {
  return CheckConst(stack, context, schema, value) || context.AddError({
    keyword: "const",
    schemaPath,
    instancePath,
    params: { allowedValue: schema.const }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/contains.mjs
function IsValid2(schema) {
  return !(IsMinContains(schema) && guard_exports.IsEqual(schema.minContains, 0));
}
function CheckContains(stack, context, schema, value) {
  if (!IsValid2(schema))
    return true;
  return !guard_exports.IsEqual(value.length, 0) && guard_exports.SomeAll(value, (item, index) => {
    return CheckSchema(stack, context, schema.contains, item) && context.AddIndex(index);
  });
}
function ErrorContains(stack, context, schemaPath, instancePath, schema, value) {
  return CheckContains(stack, context, schema, value) || context.AddError({
    keyword: "contains",
    schemaPath,
    instancePath,
    params: { minContains: 1 }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/dependencies.mjs
function CheckDependencies(stack, context, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.Every(guard_exports.Entries(schema.dependencies), 0, ([key, schema2]) => {
    return !guard_exports.HasPropertyKey(value, key) || (guard_exports.IsArray(schema2) ? schema2.every((key2) => guard_exports.HasPropertyKey(value, key2)) : CheckSchema(stack, context, schema2, value));
  });
  return isLength || isEvery;
}
function ErrorDependencies(stack, context, schemaPath, instancePath, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.EveryAll(guard_exports.Entries(schema.dependencies), 0, ([key, schema2]) => {
    const nextSchemaPath = `${schemaPath}/dependencies/${key}`;
    return !guard_exports.HasPropertyKey(value, key) || (guard_exports.IsArray(schema2) ? schema2.every((dependency) => guard_exports.HasPropertyKey(value, dependency) || context.AddError({
      keyword: "dependencies",
      schemaPath,
      instancePath,
      params: { property: key, dependencies: schema2 }
    })) : ErrorSchema(stack, context, nextSchemaPath, instancePath, schema2, value));
  });
  return isLength || isEvery;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/dependentRequired.mjs
function CheckDependentRequired(_stack, _context, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.Every(guard_exports.Entries(schema.dependentRequired), 0, ([key, keys]) => {
    return !guard_exports.HasPropertyKey(value, key) || keys.every((key2) => guard_exports.HasPropertyKey(value, key2));
  });
  return isLength || isEvery;
}
function ErrorDependentRequired(_stack, context, schemaPath, instancePath, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEveryEntry = guard_exports.EveryAll(guard_exports.Entries(schema.dependentRequired), 0, ([key, keys]) => {
    return !guard_exports.HasPropertyKey(value, key) || guard_exports.EveryAll(keys, 0, (dependency) => guard_exports.HasPropertyKey(value, dependency) || context.AddError({
      keyword: "dependentRequired",
      schemaPath,
      instancePath,
      params: { property: key, dependencies: keys }
    }));
  });
  return isLength || isEveryEntry;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/dependentSchemas.mjs
function CheckDependentSchemas(stack, context, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.Every(guard_exports.Entries(schema.dependentSchemas), 0, ([key, schema2]) => {
    return !guard_exports.HasPropertyKey(value, key) || CheckSchema(stack, context, schema2, value);
  });
  return isLength || isEvery;
}
function ErrorDependentSchemas(stack, context, schemaPath, instancePath, schema, value) {
  const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
  const isEvery = guard_exports.EveryAll(guard_exports.Entries(schema.dependentSchemas), 0, ([key, schema2]) => {
    const nextSchemaPath = `${schemaPath}/dependentSchemas/${key}`;
    return !guard_exports.HasPropertyKey(value, key) || ErrorSchema(stack, context, nextSchemaPath, instancePath, schema2, value);
  });
  return isLength || isEvery;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/dynamicRef.mjs
function CheckDynamicRef(stack, context, schema, value) {
  const target = stack.DynamicRef(schema) ?? false;
  return IsSchema(target) && CheckSchema(stack, context, target, value);
}
function ErrorDynamicRef(stack, context, _schemaPath, instancePath, schema, value) {
  const target = stack.DynamicRef(schema) ?? false;
  return IsSchema(target) && ErrorSchema(stack, context, "#", instancePath, target, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/enum.mjs
function CheckEnum(_stack, _context, schema, value) {
  return guard_exports.Some(schema.enum, (option) => guard_exports.IsValueLike(option) ? guard_exports.IsEqual(value, option) : guard_exports.IsDeepEqual(value, option));
}
function ErrorEnum(stack, context, schemaPath, instancePath, schema, value) {
  return CheckEnum(stack, context, schema, value) || context.AddError({
    keyword: "enum",
    schemaPath,
    instancePath,
    params: { allowedValues: schema.enum }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/exclusiveMaximum.mjs
function CheckExclusiveMaximum(_stack, _context, schema, value) {
  return guard_exports.IsLessThan(value, schema.exclusiveMaximum);
}
function ErrorExclusiveMaximum(stack, context, schemaPath, instancePath, schema, value) {
  return CheckExclusiveMaximum(stack, context, schema, value) || context.AddError({
    keyword: "exclusiveMaximum",
    schemaPath,
    instancePath,
    params: { comparison: "<", limit: schema.exclusiveMaximum }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/exclusiveMinimum.mjs
function CheckExclusiveMinimum(_stack, _context, schema, value) {
  return guard_exports.IsGreaterThan(value, schema.exclusiveMinimum);
}
function ErrorExclusiveMinimum(stack, context, schemaPath, instancePath, schema, value) {
  return CheckExclusiveMinimum(stack, context, schema, value) || context.AddError({
    keyword: "exclusiveMinimum",
    schemaPath,
    instancePath,
    params: { comparison: ">", limit: schema.exclusiveMinimum }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/format.mjs
var format_exports = {};
__export(format_exports, {
  Clear: () => Clear,
  Entries: () => Entries2,
  Get: () => Get,
  Has: () => Has,
  IsDate: () => IsDate2,
  IsDateTime: () => IsDateTime,
  IsDuration: () => IsDuration,
  IsEmail: () => IsEmail,
  IsHostname: () => IsHostname,
  IsIPv4: () => IsIPv4,
  IsIPv6: () => IsIPv6,
  IsIdnEmail: () => IsIdnEmail,
  IsIdnHostname: () => IsIdnHostname,
  IsIri: () => IsIri,
  IsIriReference: () => IsIriReference,
  IsJsonPointer: () => IsJsonPointer,
  IsJsonPointerUriFragment: () => IsJsonPointerUriFragment,
  IsRegex: () => IsRegex,
  IsRelativeJsonPointer: () => IsRelativeJsonPointer,
  IsTime: () => IsTime,
  IsUri: () => IsUri,
  IsUriReference: () => IsUriReference,
  IsUriTemplate: () => IsUriTemplate,
  IsUrl: () => IsUrl,
  IsUuid: () => IsUuid,
  Reset: () => Reset,
  Set: () => Set2,
  Test: () => Test
});

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/date.mjs
var DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
var DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
function IsLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
function IsDate2(value) {
  const matches = DATE.exec(value);
  if (!matches)
    return false;
  const year = +matches[1];
  const month = +matches[2];
  const day = +matches[3];
  return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && IsLeapYear(year) ? 29 : DAYS[month]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/time.mjs
var TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(?:Z|([+-])(\d\d):(\d\d))?$/i;
function IsTime(value, strictTimeZone = true) {
  const matches = TIME.exec(value);
  if (!matches)
    return false;
  const hr = +matches[1];
  const min = +matches[2];
  const sec = +matches[3];
  const tzSign = matches[4] === "-" ? -1 : 1;
  const tzH = +(matches[5] || 0);
  const tzM = +(matches[6] || 0);
  if (tzH > 23 || tzM > 59)
    return false;
  if (strictTimeZone && !matches[4] && value.toLowerCase().indexOf("z") === -1) {
    return false;
  }
  if (hr <= 23 && min <= 59 && sec < 60)
    return true;
  const utcMin = min - tzM * tzSign;
  const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
  return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/date_time.mjs
function IsDateTime(value, strictTimeZone = true) {
  const dateTime = value.split(/T/i);
  return dateTime.length === 2 && IsDate2(dateTime[0]) && IsTime(dateTime[1], strictTimeZone);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/duration.mjs
var Duration = /^P((\d+Y(\d+M(\d+D)?)?|\d+M(\d+D)?|\d+D)(T(\d+H(\d+M(\d+S)?)?|\d+M(\d+S)?|\d+S))?|T(\d+H(\d+M(\d+S)?)?|\d+M(\d+S)?|\d+S)|\d+W)$/;
function IsDuration(value) {
  return Duration.test(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/email.mjs
var Email = /^(?!.*\.\.)[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
function IsEmail(value) {
  return Email.test(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/unreachable/unreachable.mjs
function Unreachable() {
  throw new Error("Unreachable");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/_puny.mjs
var PUNYCODE_BASE = 36;
var PUNYCODE_TMIN = 1;
var PUNYCODE_TMAX = 26;
var PUNYCODE_SKEW = 38;
var PUNYCODE_DAMP = 700;
var PUNYCODE_INITIAL_BIAS = 72;
var PUNYCODE_INITIAL_N = 128;
function Adapt(delta, numPoints, firstTime) {
  delta = firstTime ? Math.floor(delta / PUNYCODE_DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > (PUNYCODE_BASE - PUNYCODE_TMIN) * PUNYCODE_TMAX >> 1) {
    delta = Math.floor(delta / (PUNYCODE_BASE - PUNYCODE_TMIN));
    k += PUNYCODE_BASE;
  }
  return k + Math.floor((PUNYCODE_BASE - PUNYCODE_TMIN + 1) * delta / (delta + PUNYCODE_SKEW));
}
function Decode(value) {
  const output = [];
  let n = PUNYCODE_INITIAL_N;
  let i = 0;
  let bias = PUNYCODE_INITIAL_BIAS;
  const delimIdx = value.lastIndexOf("-");
  if (delimIdx > 0) {
    for (let j = 0; j < delimIdx; j++) {
      const cp = value.charCodeAt(j);
      if (cp >= 128)
        throw new Error("Invalid punycode: non-basic before delimiter");
      output.push(cp);
    }
  }
  let inIdx = delimIdx < 0 ? 0 : delimIdx + 1;
  while (inIdx < value.length) {
    const oldi = i;
    let w = 1;
    let k = PUNYCODE_BASE;
    while (true) {
      if (inIdx >= value.length)
        throw new Error("Invalid punycode: unexpected end of input");
      const ch = value.charCodeAt(inIdx++);
      let digit;
      if (ch >= 97 && ch <= 122)
        digit = ch - 97;
      else if (ch >= 48 && ch <= 57)
        digit = ch - 48 + 26;
      else if (ch >= 65 && ch <= 90)
        Unreachable();
      else
        throw new Error("Invalid punycode: bad digit character");
      i += digit * w;
      const t = k <= bias ? PUNYCODE_TMIN : k >= bias + PUNYCODE_TMAX ? PUNYCODE_TMAX : k - bias;
      if (digit < t)
        break;
      w *= PUNYCODE_BASE - t;
      k += PUNYCODE_BASE;
    }
    const outLen = output.length + 1;
    bias = Adapt(i - oldi, outLen, oldi === 0);
    n += Math.floor(i / outLen);
    i %= outLen;
    output.splice(i, 0, n);
    i++;
  }
  return globalThis.String.fromCodePoint(...output);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/_idna.mjs
function IsNonspacingMark(cp) {
  return new RegExp("\\p{Mn}", "u").test(String.fromCodePoint(cp));
}
function IsSpacingCombiningMark(cp) {
  return new RegExp("\\p{Mc}", "u").test(String.fromCodePoint(cp));
}
function IsEnclosingMark(cp) {
  return new RegExp("\\p{Me}", "u").test(String.fromCodePoint(cp));
}
function IsCombiningMark2(cp) {
  return IsNonspacingMark(cp) || IsSpacingCombiningMark(cp) || IsEnclosingMark(cp);
}
var RFC5892_DISALLOWED = /* @__PURE__ */ new Set([
  1600,
  // ARABIC TATWEEL
  2042,
  // NKO LAJANYALAN
  12334,
  // HANGUL SINGLE DOT TONE MARK
  12335,
  // HANGUL DOUBLE DOT TONE MARK
  12337,
  // VERTICAL KANA REPEAT MARK
  12338,
  // VERTICAL KANA REPEAT WITH VOICED ITERATION MARK
  12339,
  // VERTICAL KANA REPEAT MARK UPPER HALF
  12340,
  // VERTICAL KANA REPEAT WITH VOICED ITERATION MARK UPPER HALF
  12341,
  // VERTICAL KANA REPEAT MARK LOWER HALF
  12347
  // VERTICAL IDEOGRAPHIC ITERATION MARK
]);
var VIRAMA_CPS = /* @__PURE__ */ new Set([
  2381,
  2509,
  2637,
  2765,
  2893,
  3021,
  3149,
  3277,
  3387,
  3388,
  3405,
  3530,
  6980,
  7082,
  7083,
  43456,
  69702,
  69759,
  69817,
  69939,
  69940,
  70080,
  70197,
  70477,
  70722,
  70850,
  71103,
  71231,
  71350,
  72767,
  73028,
  73029
]);
function IsGreek(cp) {
  return new RegExp("\\p{Script=Greek}", "u").test(String.fromCodePoint(cp));
}
function IsHebrew(cp) {
  return new RegExp("\\p{Script=Hebrew}", "u").test(String.fromCodePoint(cp));
}
function IsHiragana(cp) {
  return new RegExp("\\p{Script=Hiragana}", "u").test(String.fromCodePoint(cp));
}
function IsKatakana(cp) {
  return new RegExp("\\p{Script=Katakana}", "u").test(String.fromCodePoint(cp));
}
function IsHan(cp) {
  return new RegExp("\\p{Script=Han}", "u").test(String.fromCodePoint(cp));
}
function IsArabicIndicDigit(cp) {
  return cp >= 1632 && cp <= 1641;
}
function IsExtendedArabicIndicDigit(cp) {
  return cp >= 1776 && cp <= 1785;
}
function IsVirama(cp) {
  return VIRAMA_CPS.has(cp);
}
function IsUnicodeLabel(value) {
  if (value.length === 0)
    return Unreachable();
  const cps = [...value].map((c) => c.codePointAt(0));
  const len = cps.length;
  if (cps[0] === 45 || cps[len - 1] === 45)
    return false;
  if (len >= 4 && cps[2] === 45 && cps[3] === 45)
    return false;
  if (IsCombiningMark2(cps[0]))
    return false;
  let hasJapanese = false;
  let hasArabicIndic = false;
  let hasExtendedArabicIndic = false;
  for (let i = 0; i < len; i++) {
    const cp = cps[i];
    if (RFC5892_DISALLOWED.has(cp))
      return false;
    if (IsHiragana(cp) || IsKatakana(cp) || IsHan(cp))
      hasJapanese = true;
    if (IsArabicIndicDigit(cp))
      hasArabicIndic = true;
    if (IsExtendedArabicIndicDigit(cp))
      hasExtendedArabicIndic = true;
    const prev = cps[i - 1], next = cps[i + 1];
    switch (cp) {
      case 183:
        if (prev !== 108 || next !== 108)
          return false;
        break;
      // MIDDLE DOT (Catalan)
      case 885:
        if (next === void 0 || !IsGreek(next))
          return false;
        break;
      // Greek KERAIA
      case 1523:
      case 1524:
        if (prev === void 0 || !IsHebrew(prev))
          return false;
        break;
      // Hebrew GERESH
      case 8204:
        if (prev === void 0 || prev < 128 && !IsVirama(prev))
          return false;
        break;
      case 8205:
        if (prev === void 0 || !IsVirama(prev))
          return false;
        break;
      case 12539:
        break;
    }
  }
  if (value.includes("\u30FB") && !hasJapanese)
    return false;
  if (hasArabicIndic && hasExtendedArabicIndic)
    return false;
  return true;
}
function IsAsciiLabel(value) {
  if (value.charCodeAt(0) === 45 || value.charCodeAt(value.length - 1) === 45)
    return false;
  if (value.length >= 4 && value.charCodeAt(2) === 45 && value.charCodeAt(3) === 45)
    return false;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    if (!(ch >= 97 && ch <= 122 || // a-z
    ch >= 65 && ch <= 90 || // A-Z
    ch >= 48 && ch <= 57 || // 0-9
    ch === 45))
      return false;
  }
  return true;
}
function IsPuny(value) {
  return value.toLowerCase().startsWith("xn--");
}
function IsPunyLabel(value) {
  try {
    const payload = value.slice(4).toLowerCase();
    const lastHyphen = payload.lastIndexOf("-");
    if (lastHyphen === 0) {
      return false;
    }
    const decoded = Decode(payload);
    if (!decoded)
      return false;
    return IsUnicodeLabel(decoded);
  } catch {
    return false;
  }
}
function IsIdnLabel(value) {
  if (value.length === 0 || value.length > 63)
    return false;
  return IsPuny(value) ? IsPunyLabel(value) : IsUnicodeLabel(value);
}
function IsLabel(value) {
  if (value.length === 0 || value.length > 63)
    return false;
  return IsPuny(value) ? IsPunyLabel(value) : IsAsciiLabel(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/hostname.mjs
function IsHostname(value) {
  if (value.length === 0 || value.length > 253)
    return false;
  if (value.charCodeAt(value.length - 1) === 46)
    return false;
  for (const label of value.split(".")) {
    if (!IsLabel(label))
      return false;
  }
  return true;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/idn_email.mjs
var IdnEmail = /^(?!.*\.\.)[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+(?:\.[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+)*@[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?)*$/iu;
function IsIdnEmail(value) {
  return IdnEmail.test(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/idn_hostname.mjs
function IsIdnHostname(value) {
  if (value.length === 0 || value.includes(" "))
    return false;
  const canonical = value.normalize("NFC").replace(/[\u002E\u3002\uFF0E\uFF61]/g, ".");
  if (canonical.length > 253)
    return false;
  for (const label of canonical.split(".")) {
    if (!IsIdnLabel(label))
      return false;
  }
  return true;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/ipv4.mjs
function IsIPv4Internal(value, start, end) {
  let dots = 0;
  let num = 0;
  let digits = 0;
  let leading = 0;
  for (let i = start; i < end; i++) {
    const ch = value.charCodeAt(i);
    if (ch === 46) {
      if (digits === 0 || num > 255 || leading === 48 && digits > 1)
        return false;
      dots++;
      num = 0;
      digits = 0;
      leading = 0;
    } else if (ch >= 48 && ch <= 57) {
      if (digits === 0)
        leading = ch;
      num = num * 10 + (ch - 48);
      digits++;
    } else {
      return false;
    }
  }
  return dots === 3 && digits > 0 && num <= 255 && !(leading === 48 && digits > 1);
}
function IsIPv4(value) {
  return IsIPv4Internal(value, 0, value.length);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/ipv6.mjs
function InRange(ch) {
  return ch >= 48 && ch <= 57 || // 0-9
  ch >= 65 && ch <= 70 || // A-F
  ch >= 97 && ch <= 102;
}
function IsIPv6(value) {
  const length = value.length;
  if (length === 0)
    return false;
  let groups = 0;
  let compressed = false;
  let i = 0;
  if (value.charCodeAt(0) === 58 && value.charCodeAt(1) === 58) {
    if (length === 2)
      return true;
    compressed = true;
    i = 2;
  }
  while (i < length) {
    let digits = 0;
    const start = i;
    while (i < length && InRange(value.charCodeAt(i))) {
      i++;
      digits++;
    }
    if (digits === 0)
      return false;
    const next = value.charCodeAt(i);
    if (next === 46) {
      if (!IsIPv4Internal(value, start, length))
        return false;
      groups += 2;
      i = length;
      break;
    }
    if (digits > 4)
      return false;
    groups++;
    if (i === length)
      break;
    if (next !== 58)
      return false;
    i++;
    if (value.charCodeAt(i) === 58) {
      if (compressed)
        return false;
      if (value.charCodeAt(i + 1) === 58)
        return false;
      compressed = true;
      i++;
      if (i === length)
        break;
    }
  }
  return compressed ? groups <= 7 : groups === 8;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/iri_reference.mjs
function TryUrl(value) {
  try {
    new URL(value, "http://example.com");
    return true;
  } catch {
    return false;
  }
}
function IsIriReference(value) {
  if (value.includes(" ")) {
    return false;
  }
  if (value.includes("\\")) {
    return false;
  }
  if (/[\x00-\x1F\x7F]/.test(value)) {
    return false;
  }
  if (/%(?![0-9a-fA-F]{2})/.test(value)) {
    return false;
  }
  if (value === "") {
    return true;
  }
  const colonIndex = value.indexOf(":");
  const hasValidSchemePrefix = colonIndex > 0 && // Colon must not be at the very beginning (e.g., ":foo")
  /^[a-zA-Z][a-zA-Z0-9+\-.]*$/.test(value.substring(0, colonIndex));
  if (hasValidSchemePrefix) {
    return TryUrl(value);
  } else {
    const looksLikeMalformedSchemeAndAuthority = value.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*)(\/\/)/);
    if (looksLikeMalformedSchemeAndAuthority && colonIndex === -1) {
      return false;
    }
    return TryUrl(value);
  }
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/iri.mjs
function IsIri(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/json_pointer_uri_fragment.mjs
var JsonPointerUriFragment = /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i;
function IsJsonPointerUriFragment(value) {
  return JsonPointerUriFragment.test(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/json_pointer.mjs
var JsonPointer = /^(?:\/(?:[^~/]|~0|~1)*)*$/;
function IsJsonPointer(value) {
  return JsonPointer.test(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/regex.mjs
function IsRegex(value) {
  if (value.length === 0) {
    return false;
  }
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/relative_json_pointer.mjs
var RelativeJsonPointer = /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/;
function IsRelativeJsonPointer(value) {
  return RelativeJsonPointer.test(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/uri_reference.mjs
var UriReference = /^(?!.*[^\x00-\x7F])(?!.*\\)(?:(?:[a-z][a-z0-9+\-.]*:)?(?:\/\/[^\s[\]{}<>^`|]*)?|[^\s[\]{}<>^`|]*)(?:\?[^\s[\]{}<>^`|]*)?(?:#[^\s[\]{}<>^`|]*)?$/i;
function IsUriReference(value) {
  return UriReference.test(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/uri_template.mjs
var UriTemplate = /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i;
function IsUriTemplate(value) {
  return UriTemplate.test(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/uri.mjs
function IsAlpha(ch) {
  return ch >= 97 && ch <= 122 || ch >= 65 && ch <= 90;
}
function IsAlphaNumeric(ch) {
  return IsAlpha(ch) || ch >= 48 && ch <= 57;
}
function IsHex(ch) {
  return ch >= 48 && ch <= 57 || // 0-9
  ch >= 65 && ch <= 70 || // A-F
  ch >= 97 && ch <= 102;
}
function IsSchemeChar(ch) {
  return IsAlphaNumeric(ch) || ch === 43 || ch === 45 || ch === 46;
}
function IsUnreserved(ch) {
  return IsAlphaNumeric(ch) || ch === 45 || ch === 46 || // '-', '.'
  ch === 95 || ch === 126;
}
function IsSubDelim(ch) {
  return ch === 33 || ch === 36 || ch === 38 || ch === 39 || ch === 40 || ch === 41 || ch === 42 || ch === 43 || ch === 44 || ch === 59 || ch === 61;
}
function IsPchar(ch) {
  return IsUnreserved(ch) || IsSubDelim(ch) || ch === 58 || ch === 64;
}
function IsUri(value) {
  const length = value.length;
  if (length === 0)
    return false;
  if (!IsAlpha(value.charCodeAt(0)))
    return false;
  let i = 1;
  while (i < length) {
    const ch = value.charCodeAt(i);
    if (ch === 58)
      break;
    if (!IsSchemeChar(ch))
      return false;
    i++;
  }
  if (value.charCodeAt(i) !== 58)
    return false;
  i++;
  if (value.charCodeAt(i) === 47 && value.charCodeAt(i + 1) === 47) {
    i += 2;
    const authorityStart = i;
    let atPos = -1;
    for (let j = i; j < length; j++) {
      const ch = value.charCodeAt(j);
      if (ch === 64) {
        atPos = j;
        break;
      }
      if (ch === 47 || ch === 63 || ch === 35)
        break;
    }
    if (atPos !== -1) {
      for (let j = authorityStart; j < atPos; j++) {
        const ch = value.charCodeAt(j);
        if (ch === 91 || ch === 93)
          return false;
        if (ch === 37) {
          if (j + 2 >= atPos || !IsHex(value.charCodeAt(j + 1)) || !IsHex(value.charCodeAt(j + 2)))
            return false;
          j += 2;
        } else if (!IsUnreserved(ch) && !IsSubDelim(ch) && ch !== 58)
          return false;
      }
      i = atPos + 1;
    }
    if (value.charCodeAt(i) === 91) {
      i++;
      while (i < length && value.charCodeAt(i) !== 93)
        i++;
      if (value.charCodeAt(i) !== 93)
        return false;
      i++;
    } else {
      while (i < length) {
        const ch = value.charCodeAt(i);
        if (ch === 47 || ch === 63 || ch === 35 || ch === 58)
          break;
        if (ch < 128 && !IsUnreserved(ch) && !IsSubDelim(ch))
          return false;
        i++;
      }
    }
    if (value.charCodeAt(i) === 58) {
      i++;
      while (i < length) {
        const ch = value.charCodeAt(i);
        if (ch === 47 || ch === 63 || ch === 35)
          break;
        if (ch < 48 || ch > 57)
          return false;
        i++;
      }
    }
  }
  while (i < length) {
    const ch = value.charCodeAt(i);
    if (ch === 37) {
      if (i + 2 >= length || !IsHex(value.charCodeAt(i + 1)) || !IsHex(value.charCodeAt(i + 2)))
        return false;
      i += 2;
    } else if (ch > 127) {
      return false;
    } else if (!(IsPchar(ch) || ch === 47 || ch === 63 || ch === 35)) {
      return false;
    }
    i++;
  }
  return true;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/url.mjs
var Url = /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu;
function IsUrl(value) {
  return Url.test(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/uuid.mjs
var Uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function IsUuid(value) {
  return Uuid.test(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/format/_registry.mjs
var formats = /* @__PURE__ */ new Map();
function Clear() {
  formats.clear();
}
function Entries2() {
  return [...formats.entries()];
}
function Set2(format, check) {
  formats.set(format, check);
}
function Has(format) {
  return formats.has(format);
}
function Get(format) {
  return formats.get(format);
}
function Test(format, value) {
  return formats.get(format)?.(value) ?? true;
}
function Reset() {
  Clear();
  formats.set("date-time", IsDateTime);
  formats.set("date", IsDate2);
  formats.set("duration", IsDuration);
  formats.set("email", IsEmail);
  formats.set("hostname", IsHostname);
  formats.set("idn-email", IsIdnEmail);
  formats.set("idn-hostname", IsIdnHostname);
  formats.set("ipv4", IsIPv4);
  formats.set("ipv6", IsIPv6);
  formats.set("iri-reference", IsIriReference);
  formats.set("iri", IsIri);
  formats.set("json-pointer-uri-fragment", IsJsonPointerUriFragment);
  formats.set("json-pointer", IsJsonPointer);
  formats.set("regex", IsRegex);
  formats.set("relative-json-pointer", IsRelativeJsonPointer);
  formats.set("time", IsTime);
  formats.set("uri-reference", IsUriReference);
  formats.set("uri-template", IsUriTemplate);
  formats.set("uri", IsUri);
  formats.set("url", IsUrl);
  formats.set("uuid", IsUuid);
}
Reset();

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/format.mjs
function CheckFormat(_stack, _context, schema, value) {
  return format_exports.Test(schema.format, value);
}
function ErrorFormat(stack, context, schemaPath, instancePath, schema, value) {
  return CheckFormat(stack, context, schema, value) || context.AddError({
    keyword: "format",
    schemaPath,
    instancePath,
    params: { format: schema.format }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/if.mjs
function CheckIf(stack, context, schema, value) {
  const thenSchema = IsThen(schema) ? schema.then : true;
  const elseSchema = IsElse(schema) ? schema.else : true;
  return CheckSchema(stack, context, schema.if, value) ? CheckSchema(stack, context, thenSchema, value) : CheckSchema(stack, context, elseSchema, value);
}
function ErrorIf(stack, context, schemaPath, instancePath, schema, value) {
  const thenSchema = IsThen(schema) ? schema.then : true;
  const elseSchema = IsElse(schema) ? schema.else : true;
  const trueContext = new AccumulatedErrorContext();
  const isIf = ErrorSchema(stack, trueContext, `${schemaPath}/if`, instancePath, schema.if, value) ? ErrorSchema(stack, trueContext, `${schemaPath}/then`, instancePath, thenSchema, value) || context.AddError({
    keyword: "if",
    schemaPath,
    instancePath,
    params: { failingKeyword: "then" }
  }) : ErrorSchema(stack, context, `${schemaPath}/else`, instancePath, elseSchema, value) || context.AddError({
    keyword: "if",
    schemaPath,
    instancePath,
    params: { failingKeyword: "else" }
  });
  if (isIf)
    context.Merge([trueContext]);
  return isIf;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/items.mjs
function CheckItemsSized(stack, context, schema, value) {
  return guard_exports.Every(schema.items, 0, (schema2, index) => {
    return guard_exports.IsLessEqualThan(value.length, index) || CheckSchemaPushStack(stack, context, schema2, value[index]) && context.AddIndex(index);
  });
}
function ErrorItemsSized(stack, context, schemaPath, instancePath, schema, value) {
  return guard_exports.EveryAll(schema.items, 0, (schema2, index) => {
    const nextSchemaPath = `${schemaPath}/items/${index}`;
    const nextInstancePath = `${instancePath}/${index}`;
    return guard_exports.IsLessEqualThan(value.length, index) || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema2, value[index]) && context.AddIndex(index);
  });
}
function CheckItemsUnsized(stack, context, schema, value) {
  const offset = IsPrefixItems(schema) ? schema.prefixItems.length : 0;
  return guard_exports.Every(value, offset, (element, index) => {
    return CheckSchemaPushStack(stack, context, schema.items, element) && context.AddIndex(index);
  });
}
function ErrorItemsUnsized(stack, context, schemaPath, instancePath, schema, value) {
  const offset = IsPrefixItems(schema) ? schema.prefixItems.length : 0;
  return guard_exports.EveryAll(value, offset, (element, index) => {
    const nextSchemaPath = `${schemaPath}/items`;
    const nextInstancePath = `${instancePath}/${index}`;
    return ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema.items, element) && context.AddIndex(index);
  });
}
function CheckItems(stack, context, schema, value) {
  return IsItemsSized(schema) ? CheckItemsSized(stack, context, schema, value) : CheckItemsUnsized(stack, context, schema, value);
}
function ErrorItems(stack, context, schemaPath, instancePath, schema, value) {
  return IsItemsSized(schema) ? ErrorItemsSized(stack, context, schemaPath, instancePath, schema, value) : ErrorItemsUnsized(stack, context, schemaPath, instancePath, schema, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/maxContains.mjs
function IsValid3(schema) {
  return IsContains(schema);
}
function CheckMaxContains(stack, context, schema, value) {
  if (!IsValid3(schema))
    return true;
  const count = guard_exports.Counted(value, (item) => CheckSchema(stack, context, schema.contains, item));
  return guard_exports.IsLessEqualThan(count, schema.maxContains);
}
function ErrorMaxContains(stack, context, schemaPath, instancePath, schema, value) {
  const minContains = IsMinContains(schema) ? schema.minContains : 1;
  return CheckMaxContains(stack, context, schema, value) || context.AddError({
    keyword: "contains",
    schemaPath,
    instancePath,
    params: { minContains, maxContains: schema.maxContains }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/maximum.mjs
function CheckMaximum(_stack, _context, schema, value) {
  return guard_exports.IsLessEqualThan(value, schema.maximum);
}
function ErrorMaximum(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMaximum(stack, context, schema, value) || context.AddError({
    keyword: "maximum",
    schemaPath,
    instancePath,
    params: { comparison: "<=", limit: schema.maximum }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/maxItems.mjs
function CheckMaxItems(_stack, _context, schema, value) {
  return guard_exports.IsLessEqualThan(value.length, schema.maxItems);
}
function ErrorMaxItems(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMaxItems(stack, context, schema, value) || context.AddError({
    keyword: "maxItems",
    schemaPath,
    instancePath,
    params: { limit: schema.maxItems }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/maxLength.mjs
function CheckMaxLength(_stack, _context, schema, value) {
  return guard_exports.IsMaxLength(value, schema.maxLength);
}
function ErrorMaxLength(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMaxLength(stack, context, schema, value) || context.AddError({
    keyword: "maxLength",
    schemaPath,
    instancePath,
    params: { limit: schema.maxLength }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/maxProperties.mjs
function CheckMaxProperties(_stack, _context, schema, value) {
  return guard_exports.IsLessEqualThan(guard_exports.Keys(value).length, schema.maxProperties);
}
function ErrorMaxProperties(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMaxProperties(stack, context, schema, value) || context.AddError({
    keyword: "maxProperties",
    schemaPath,
    instancePath,
    params: { limit: schema.maxProperties }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/minContains.mjs
function IsValid4(schema) {
  return IsContains(schema);
}
function CheckMinContains(stack, context, schema, value) {
  if (!IsValid4(schema))
    return true;
  const count = guard_exports.Counted(value, (item, index) => CheckSchema(stack, context, schema.contains, item) && context.AddIndex(index));
  return guard_exports.IsGreaterEqualThan(count, schema.minContains);
}
function ErrorMinContains(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMinContains(stack, context, schema, value) || context.AddError({
    keyword: "contains",
    schemaPath,
    instancePath,
    params: { minContains: schema.minContains }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/minimum.mjs
function CheckMinimum(_stack, _context, schema, value) {
  return guard_exports.IsGreaterEqualThan(value, schema.minimum);
}
function ErrorMinimum(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMinimum(stack, context, schema, value) || context.AddError({
    keyword: "minimum",
    schemaPath,
    instancePath,
    params: { comparison: ">=", limit: schema.minimum }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/minItems.mjs
function CheckMinItems(_stack, _context, schema, value) {
  return guard_exports.IsGreaterEqualThan(value.length, schema.minItems);
}
function ErrorMinItems(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMinItems(stack, context, schema, value) || context.AddError({
    keyword: "minItems",
    schemaPath,
    instancePath,
    params: { limit: schema.minItems }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/minLength.mjs
function CheckMinLength(_stack, _context, schema, value) {
  return guard_exports.IsMinLength(value, schema.minLength);
}
function ErrorMinLength(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMinLength(stack, context, schema, value) || context.AddError({
    keyword: "minLength",
    schemaPath,
    instancePath,
    params: { limit: schema.minLength }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/minProperties.mjs
function CheckMinProperties(_stack, _context, schema, value) {
  return guard_exports.IsGreaterEqualThan(guard_exports.Keys(value).length, schema.minProperties);
}
function ErrorMinProperties(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMinProperties(stack, context, schema, value) || context.AddError({
    keyword: "minProperties",
    schemaPath,
    instancePath,
    params: { limit: schema.minProperties }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/multipleOf.mjs
function CheckMultipleOf(_stack, _context, schema, value) {
  return guard_exports.IsMultipleOf(value, schema.multipleOf);
}
function ErrorMultipleOf(stack, context, schemaPath, instancePath, schema, value) {
  return CheckMultipleOf(stack, context, schema, value) || context.AddError({
    keyword: "multipleOf",
    schemaPath,
    instancePath,
    params: { multipleOf: schema.multipleOf }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/not.mjs
function CheckNot(stack, context, schema, value) {
  const nextContext = new CheckContext();
  const isSchema = !CheckSchema(stack, nextContext, schema.not, value);
  const isNot = isSchema && context.Merge([nextContext]);
  return isNot;
}
function ErrorNot(stack, context, schemaPath, instancePath, schema, value) {
  return CheckNot(stack, context, schema, value) || context.AddError({
    keyword: "not",
    schemaPath,
    instancePath,
    params: {}
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/oneOf.mjs
function CheckOneOf(stack, context, schema, value) {
  const passedContexts = schema.oneOf.reduce((result, schema2) => {
    const nextContext = new CheckContext();
    return CheckSchema(stack, nextContext, schema2, value) ? [...result, nextContext] : result;
  }, []);
  return guard_exports.IsEqual(passedContexts.length, 1) && context.Merge(passedContexts);
}
function ErrorOneOf(stack, context, schemaPath, instancePath, schema, value) {
  const failedContexts = [];
  const passingSchemas = [];
  const passedContexts = schema.oneOf.reduce((result, schema2, index) => {
    const nextContext = new AccumulatedErrorContext();
    const nextSchemaPath = `${schemaPath}/oneOf/${index}`;
    const isSchema = ErrorSchema(stack, nextContext, nextSchemaPath, instancePath, schema2, value);
    if (isSchema)
      passingSchemas.push(index);
    if (!isSchema)
      failedContexts.push(nextContext);
    return isSchema ? [...result, nextContext] : result;
  }, []);
  const isOneOf = guard_exports.IsEqual(passedContexts.length, 1) && context.Merge(passedContexts);
  if (!isOneOf && guard_exports.IsEqual(passingSchemas.length, 0))
    failedContexts.forEach((failed) => failed.GetErrors().forEach((error) => context.AddError(error)));
  return isOneOf || context.AddError({
    keyword: "oneOf",
    schemaPath,
    instancePath,
    params: { passingSchemas }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/pattern.mjs
function CheckPattern(_stack, _context, schema, value) {
  const regexp = guard_exports.IsString(schema.pattern) ? new RegExp(schema.pattern, "u") : schema.pattern;
  return regexp.test(value);
}
function ErrorPattern(stack, context, schemaPath, instancePath, schema, value) {
  return CheckPattern(stack, context, schema, value) || context.AddError({
    keyword: "pattern",
    schemaPath,
    instancePath,
    params: { pattern: schema.pattern }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/patternProperties.mjs
function CheckPatternProperties(stack, context, schema, value) {
  return guard_exports.Every(guard_exports.Entries(schema.patternProperties), 0, ([pattern, schema2]) => {
    const regexp = new RegExp(pattern, "u");
    return guard_exports.Every(guard_exports.Entries(value), 0, ([key, prop]) => {
      return !regexp.test(key) || CheckSchemaPushStack(stack, context, schema2, prop) && context.AddKey(key);
    });
  });
}
function ErrorPatternProperties(stack, context, schemaPath, instancePath, schema, value) {
  return guard_exports.EveryAll(guard_exports.Entries(schema.patternProperties), 0, ([pattern, schema2]) => {
    const nextSchemaPath = `${schemaPath}/patternProperties/${pattern}`;
    const regexp = new RegExp(pattern, "u");
    return guard_exports.EveryAll(guard_exports.Entries(value), 0, ([key, value2]) => {
      const nextInstancePath = `${instancePath}/${key}`;
      const notKey = !regexp.test(key);
      return notKey || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema2, value2) && context.AddKey(key);
    });
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/prefixItems.mjs
function CheckPrefixItems(stack, context, schema, value) {
  return guard_exports.IsEqual(value.length, 0) || guard_exports.Every(schema.prefixItems, 0, (schema2, index) => {
    return guard_exports.IsLessEqualThan(value.length, index) || CheckSchemaPushStack(stack, context, schema2, value[index]) && context.AddIndex(index);
  });
}
function ErrorPrefixItems(stack, context, schemaPath, instancePath, schema, value) {
  return guard_exports.IsEqual(value.length, 0) || guard_exports.EveryAll(schema.prefixItems, 0, (schema2, index) => {
    const nextSchemaPath = `${schemaPath}/prefixItems/${index}`;
    const nextInstancePath = `${instancePath}/${index}`;
    return guard_exports.IsLessEqualThan(value.length, index) || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema2, value[index]) && context.AddIndex(index);
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/settings/settings.mjs
var settings_exports = {};
__export(settings_exports, {
  Get: () => Get2,
  Reset: () => Reset2,
  Set: () => Set3
});
var settings = {
  immutableTypes: false,
  maxErrors: 8,
  useAcceleration: true,
  exactOptionalPropertyTypes: false,
  enumerableKind: false,
  correctiveParse: false,
  unionPrioritySort: true
};
function Reset2() {
  settings.immutableTypes = false;
  settings.maxErrors = 8;
  settings.useAcceleration = true;
  settings.exactOptionalPropertyTypes = false;
  settings.enumerableKind = false;
  settings.correctiveParse = false;
  settings.unionPrioritySort = true;
}
function Set3(options) {
  for (const key of guard_exports.Keys(options)) {
    const value = options[key];
    if (value !== void 0) {
      Object.defineProperty(settings, key, { value });
    }
  }
}
function Get2() {
  return settings;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/_exact_optional.mjs
function IsExactOptional(required, key) {
  return required.includes(key) || settings_exports.Get().exactOptionalPropertyTypes;
}
function InexactOptionalCheck(value, key) {
  return guard_exports.IsUndefined(value[key]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/properties.mjs
function CheckProperties(stack, context, schema, value) {
  const required = IsRequired(schema) ? schema.required : [];
  const isProperties = guard_exports.Every(guard_exports.Entries(schema.properties), 0, ([key, schema2]) => {
    const isProperty = !guard_exports.HasPropertyKey(value, key) || CheckSchemaPushStack(stack, context, schema2, value[key]) && context.AddKey(key);
    return IsExactOptional(required, key) ? isProperty : InexactOptionalCheck(value, key) || isProperty;
  });
  return isProperties;
}
function ErrorProperties(stack, context, schemaPath, instancePath, schema, value) {
  const required = IsRequired(schema) ? schema.required : [];
  const isProperties = guard_exports.EveryAll(guard_exports.Entries(schema.properties), 0, ([key, schema2]) => {
    const nextSchemaPath = `${schemaPath}/properties/${key}`;
    const nextInstancePath = `${instancePath}/${key}`;
    const isProperty = () => !guard_exports.HasPropertyKey(value, key) || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema2, value[key]) && context.AddKey(key);
    return IsExactOptional(required, key) ? isProperty() : InexactOptionalCheck(value, key) || isProperty();
  });
  return isProperties;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/propertyNames.mjs
function CheckPropertyNames(stack, context, schema, value) {
  return guard_exports.Every(guard_exports.Keys(value), 0, (key, _index) => CheckSchema(stack, context, schema.propertyNames, key));
}
function ErrorPropertyNames(stack, context, schemaPath, instancePath, schema, value) {
  const propertyNames = [];
  const isPropertyNames = guard_exports.EveryAll(guard_exports.Keys(value), 0, (key, _index) => {
    const nextInstancePath = `${instancePath}/${key}`;
    const nextSchemaPath = `${schemaPath}/propertyNames`;
    const nextContext = new AccumulatedErrorContext();
    const isPropertyName = ErrorSchema(stack, nextContext, nextSchemaPath, nextInstancePath, schema.propertyNames, key);
    if (!isPropertyName)
      propertyNames.push(key);
    return isPropertyName;
  });
  return isPropertyNames || context.AddError({
    keyword: "propertyNames",
    schemaPath,
    instancePath,
    params: { propertyNames }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/recursiveRef.mjs
function CheckRecursiveRef(stack, context, schema, value) {
  const target = stack.RecursiveRef(schema) ?? false;
  return IsSchema(target) && CheckSchema(stack, context, target, value);
}
function ErrorRecursiveRef(stack, context, _schemaPath, instancePath, schema, value) {
  const target = stack.RecursiveRef(schema) ?? false;
  return IsSchema(target) && ErrorSchema(stack, context, "#", instancePath, target, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/ref.mjs
function CheckRef(stack, context, schema, value) {
  const target = stack.Ref(schema) ?? false;
  const nextContext = new CheckContext();
  const result = IsSchema(target) && CheckSchema(stack, nextContext, target, value);
  if (result)
    context.Merge([nextContext]);
  return result;
}
function ErrorRef(stack, context, _schemaPath, instancePath, schema, value) {
  const target = stack.Ref(schema) ?? false;
  const nextContext = new AccumulatedErrorContext();
  const result = IsSchema(target) && ErrorSchema(stack, nextContext, "#", instancePath, target, value);
  if (result)
    context.Merge([nextContext]);
  if (!result)
    nextContext.GetErrors().forEach((error) => context.AddError(error));
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/required.mjs
function CheckRequired(_stack, _context, schema, value) {
  return guard_exports.Every(schema.required, 0, (key) => guard_exports.HasPropertyKey(value, key));
}
function ErrorRequired(_stack, context, schemaPath, instancePath, schema, value) {
  const requiredProperties = [];
  const isRequired = guard_exports.EveryAll(schema.required, 0, (key) => {
    const hasKey = guard_exports.HasPropertyKey(value, key);
    if (!hasKey)
      requiredProperties.push(key);
    return hasKey;
  });
  return isRequired || context.AddError({
    keyword: "required",
    schemaPath,
    instancePath,
    params: { requiredProperties }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/type.mjs
function CheckTypeName(_stack, _context, type, _schema, value) {
  return (
    // jsonschema
    guard_exports.IsEqual(type, "object") ? guard_exports.IsObjectNotArray(value) : guard_exports.IsEqual(type, "array") ? guard_exports.IsArray(value) : guard_exports.IsEqual(type, "boolean") ? guard_exports.IsBoolean(value) : guard_exports.IsEqual(type, "integer") ? guard_exports.IsInteger(value) : guard_exports.IsEqual(type, "number") ? guard_exports.IsNumber(value) : guard_exports.IsEqual(type, "null") ? guard_exports.IsNull(value) : guard_exports.IsEqual(type, "string") ? guard_exports.IsString(value) : (
      // xschema
      guard_exports.IsEqual(type, "bigint") ? guard_exports.IsBigInt(value) : guard_exports.IsEqual(type, "constructor") ? guard_exports.IsConstructor(value) : guard_exports.IsEqual(type, "function") ? guard_exports.IsFunction(value) : guard_exports.IsEqual(type, "symbol") ? guard_exports.IsSymbol(value) : guard_exports.IsEqual(type, "undefined") ? guard_exports.IsUndefined(value) : guard_exports.IsEqual(type, "void") ? guard_exports.IsUndefined(value) : true
    )
  );
}
function CheckTypeNames(stack, context, types, schema, value) {
  return guard_exports.Some(types, (type) => CheckTypeName(stack, context, type, schema, value));
}
function CheckType(stack, context, schema, value) {
  return guard_exports.IsArray(schema.type) ? CheckTypeNames(stack, context, schema.type, schema, value) : CheckTypeName(stack, context, schema.type, schema, value);
}
function ErrorType(stack, context, schemaPath, instancePath, schema, value) {
  const isType = guard_exports.IsArray(schema.type) ? CheckTypeNames(stack, context, schema.type, schema, value) : CheckTypeName(stack, context, schema.type, schema, value);
  return isType || context.AddError({
    keyword: "type",
    schemaPath,
    instancePath,
    params: { type: schema.type }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/unevaluatedItems.mjs
function CheckUnevaluatedItems(stack, context, schema, value) {
  const indices = context.GetIndices();
  return guard_exports.Every(value, 0, (item, index) => {
    return (indices.has(index) || CheckSchema(stack, context, schema.unevaluatedItems, item)) && context.AddIndex(index);
  });
}
function ErrorUnevaluatedItems(stack, context, schemaPath, instancePath, schema, value) {
  const indices = context.GetIndices();
  const unevaluatedItems = [];
  const isUnevaluatedItems = guard_exports.EveryAll(value, 0, (item, index) => {
    const nextContext = new AccumulatedErrorContext();
    const isEvaluatedItem = (indices.has(index) || ErrorSchema(stack, nextContext, schemaPath, instancePath, schema.unevaluatedItems, item)) && context.AddIndex(index);
    if (!isEvaluatedItem)
      unevaluatedItems.push(index);
    return isEvaluatedItem;
  });
  return isUnevaluatedItems || context.AddError({
    keyword: "unevaluatedItems",
    schemaPath,
    instancePath,
    params: { unevaluatedItems }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/unevaluatedProperties.mjs
function CheckUnevaluatedProperties(stack, context, schema, value) {
  const keys = context.GetKeys();
  return guard_exports.Every(guard_exports.Entries(value), 0, ([key, prop]) => {
    return keys.has(key) || CheckSchema(stack, context, schema.unevaluatedProperties, prop) && context.AddKey(key);
  });
}
function ErrorUnevaluatedProperties(stack, context, schemaPath, instancePath, schema, value) {
  const keys = context.GetKeys();
  const unevaluatedProperties = [];
  const isUnevaluatedProperties = guard_exports.EveryAll(guard_exports.Entries(value), 0, ([key, prop]) => {
    const nextContext = new AccumulatedErrorContext();
    const isEvaluatedProperty = keys.has(key) || ErrorSchema(stack, nextContext, schemaPath, instancePath, schema.unevaluatedProperties, prop) && context.AddKey(key);
    if (!isEvaluatedProperty)
      unevaluatedProperties.push(key);
    return isEvaluatedProperty;
  });
  return isUnevaluatedProperties || context.AddError({
    keyword: "unevaluatedProperties",
    schemaPath,
    instancePath,
    params: { unevaluatedProperties }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/hashing/hash.mjs
var hash_exports = {};
__export(hash_exports, {
  Hash: () => Hash,
  HashCode: () => HashCode
});
function InstanceKeys(value) {
  const propertyKeys = /* @__PURE__ */ new Set();
  let current = value;
  while (current && current !== Object.prototype) {
    for (const key of Reflect.ownKeys(current)) {
      if (key !== "constructor" && typeof key !== "symbol")
        propertyKeys.add(key);
    }
    current = Object.getPrototypeOf(current);
  }
  return [...propertyKeys];
}
function IsIEEE754(value) {
  return typeof value === "number";
}
var ByteMarker;
(function(ByteMarker2) {
  ByteMarker2[ByteMarker2["Array"] = 0] = "Array";
  ByteMarker2[ByteMarker2["BigInt"] = 1] = "BigInt";
  ByteMarker2[ByteMarker2["Boolean"] = 2] = "Boolean";
  ByteMarker2[ByteMarker2["Date"] = 3] = "Date";
  ByteMarker2[ByteMarker2["Constructor"] = 4] = "Constructor";
  ByteMarker2[ByteMarker2["Function"] = 5] = "Function";
  ByteMarker2[ByteMarker2["Null"] = 6] = "Null";
  ByteMarker2[ByteMarker2["Number"] = 7] = "Number";
  ByteMarker2[ByteMarker2["Object"] = 8] = "Object";
  ByteMarker2[ByteMarker2["RegExp"] = 9] = "RegExp";
  ByteMarker2[ByteMarker2["String"] = 10] = "String";
  ByteMarker2[ByteMarker2["Symbol"] = 11] = "Symbol";
  ByteMarker2[ByteMarker2["TypeArray"] = 12] = "TypeArray";
  ByteMarker2[ByteMarker2["Undefined"] = 13] = "Undefined";
})(ByteMarker || (ByteMarker = {}));
var Accumulator = BigInt("14695981039346656037");
var [Prime, Size] = [BigInt("1099511628211"), BigInt(
  "18446744073709551616"
  /* 2 ^ 64 */
)];
var Bytes = Array.from({ length: 256 }).map((_, i) => BigInt(i));
var F64 = new Float64Array(1);
var F64In = new DataView(F64.buffer);
var F64Out = new Uint8Array(F64.buffer);
function FNV1A64_OP(byte) {
  Accumulator = Accumulator ^ Bytes[byte];
  Accumulator = Accumulator * Prime % Size;
}
function FromArray(value) {
  FNV1A64_OP(ByteMarker.Array);
  for (const item of value) {
    FromValue(item);
  }
}
function FromBigInt(value) {
  FNV1A64_OP(ByteMarker.BigInt);
  F64In.setBigInt64(0, value);
  for (const byte of F64Out) {
    FNV1A64_OP(byte);
  }
}
function FromBoolean(value) {
  FNV1A64_OP(ByteMarker.Boolean);
  FNV1A64_OP(value ? 1 : 0);
}
function FromConstructor(value) {
  FNV1A64_OP(ByteMarker.Constructor);
  FromValue(value.toString());
}
function FromDate(value) {
  FNV1A64_OP(ByteMarker.Date);
  FromValue(value.getTime());
}
function FromFunction(value) {
  FNV1A64_OP(ByteMarker.Function);
  FromValue(value.toString());
}
function FromNull(_value) {
  FNV1A64_OP(ByteMarker.Null);
}
function FromNumber(value) {
  FNV1A64_OP(ByteMarker.Number);
  F64In.setFloat64(
    0,
    value,
    true
    /* little-endian */
  );
  for (const byte of F64Out) {
    FNV1A64_OP(byte);
  }
}
function FromObject(value) {
  FNV1A64_OP(ByteMarker.Object);
  for (const key of InstanceKeys(value).sort()) {
    FromValue(key);
    FromValue(value[key]);
  }
}
function FromRegExp(value) {
  FNV1A64_OP(ByteMarker.RegExp);
  FromString(value.toString());
}
var encoder = new TextEncoder();
function FromString(value) {
  FNV1A64_OP(ByteMarker.String);
  for (const byte of encoder.encode(value)) {
    FNV1A64_OP(byte);
  }
}
function FromSymbol(value) {
  FNV1A64_OP(ByteMarker.Symbol);
  FromValue(value.toString());
}
function FromTypeArray(value) {
  FNV1A64_OP(ByteMarker.TypeArray);
  const buffer = new Uint8Array(value.buffer);
  for (let i = 0; i < buffer.length; i++) {
    FNV1A64_OP(buffer[i]);
  }
}
function FromUndefined(_value) {
  return FNV1A64_OP(ByteMarker.Undefined);
}
function FromValue(value) {
  return globals_exports.IsTypeArray(value) ? FromTypeArray(value) : globals_exports.IsDate(value) ? FromDate(value) : globals_exports.IsRegExp(value) ? FromRegExp(value) : globals_exports.IsBoolean(value) ? FromBoolean(value.valueOf()) : globals_exports.IsString(value) ? FromString(value.valueOf()) : globals_exports.IsNumber(value) ? FromNumber(value.valueOf()) : IsIEEE754(value) ? FromNumber(value) : guard_exports.IsArray(value) ? FromArray(value) : guard_exports.IsBoolean(value) ? FromBoolean(value) : guard_exports.IsBigInt(value) ? FromBigInt(value) : guard_exports.IsConstructor(value) ? FromConstructor(value) : guard_exports.IsNull(value) ? FromNull(value) : guard_exports.IsObject(value) ? FromObject(value) : guard_exports.IsString(value) ? FromString(value) : guard_exports.IsSymbol(value) ? FromSymbol(value) : guard_exports.IsUndefined(value) ? FromUndefined(value) : guard_exports.IsFunction(value) ? FromFunction(value) : Unreachable();
}
function HashCode(value) {
  Accumulator = BigInt("14695981039346656037");
  FromValue(value);
  return Accumulator;
}
function Hash(value) {
  return HashCode(value).toString(16).padStart(16, "0");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/uniqueItems.mjs
function IsValid5(schema) {
  return !guard_exports.IsEqual(schema.uniqueItems, false);
}
function CheckUniqueItems(_stack, _context, schema, value) {
  if (!IsValid5(schema))
    return true;
  const set = new Set(value.map(hash_exports.Hash)).size;
  const isLength = value.length;
  return guard_exports.IsEqual(set, isLength);
}
function ErrorUniqueItems(_stack, context, schemaPath, instancePath, schema, value) {
  if (!IsValid5(schema))
    return true;
  const set = /* @__PURE__ */ new Set();
  const duplicateItems = value.reduce((result, value2, index) => {
    const hash = hash_exports.Hash(value2);
    if (set.has(hash))
      return [...result, index];
    set.add(hash);
    return result;
  }, []);
  const isUniqueItems = guard_exports.IsEqual(duplicateItems.length, 0);
  return isUniqueItems || context.AddError({
    keyword: "uniqueItems",
    schemaPath,
    instancePath,
    params: { duplicateItems }
  });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/schema.mjs
function CheckSchemaPushStack(stack, context, schema, value) {
  return context.Push() && CheckSchema(stack, context, schema, value) && context.Pop();
}
function CheckSchema(stack, context, schema, value) {
  stack.Push(schema);
  const result = IsSchemaBoolean(schema) ? CheckSchemaBoolean(stack, context, schema, value) : (!IsType(schema) || CheckType(stack, context, schema, value)) && (!(guard_exports.IsObject(value) && !guard_exports.IsArray(value)) || (!IsRequired(schema) || CheckRequired(stack, context, schema, value)) && (!IsAdditionalProperties(schema) || CheckAdditionalProperties(stack, context, schema, value)) && (!IsDependencies(schema) || CheckDependencies(stack, context, schema, value)) && (!IsDependentRequired(schema) || CheckDependentRequired(stack, context, schema, value)) && (!IsDependentSchemas(schema) || CheckDependentSchemas(stack, context, schema, value)) && (!IsPatternProperties(schema) || CheckPatternProperties(stack, context, schema, value)) && (!IsProperties(schema) || CheckProperties(stack, context, schema, value)) && (!IsPropertyNames(schema) || CheckPropertyNames(stack, context, schema, value)) && (!IsMinProperties(schema) || CheckMinProperties(stack, context, schema, value)) && (!IsMaxProperties(schema) || CheckMaxProperties(stack, context, schema, value))) && (!guard_exports.IsArray(value) || (!IsAdditionalItems(schema) || CheckAdditionalItems(stack, context, schema, value)) && (!IsContains(schema) || CheckContains(stack, context, schema, value)) && (!IsItems(schema) || CheckItems(stack, context, schema, value)) && (!IsMaxContains(schema) || CheckMaxContains(stack, context, schema, value)) && (!IsMaxItems(schema) || CheckMaxItems(stack, context, schema, value)) && (!IsMinContains(schema) || CheckMinContains(stack, context, schema, value)) && (!IsMinItems(schema) || CheckMinItems(stack, context, schema, value)) && (!IsPrefixItems(schema) || CheckPrefixItems(stack, context, schema, value)) && (!IsUniqueItems(schema) || CheckUniqueItems(stack, context, schema, value))) && (!guard_exports.IsString(value) || (!IsMaxLength3(schema) || CheckMaxLength(stack, context, schema, value)) && (!IsMinLength3(schema) || CheckMinLength(stack, context, schema, value)) && (!IsFormat(schema) || CheckFormat(stack, context, schema, value)) && (!IsPattern(schema) || CheckPattern(stack, context, schema, value))) && (!(guard_exports.IsNumber(value) || guard_exports.IsBigInt(value)) || (!IsExclusiveMaximum(schema) || CheckExclusiveMaximum(stack, context, schema, value)) && (!IsExclusiveMinimum(schema) || CheckExclusiveMinimum(stack, context, schema, value)) && (!IsMaximum(schema) || CheckMaximum(stack, context, schema, value)) && (!IsMinimum(schema) || CheckMinimum(stack, context, schema, value)) && (!IsMultipleOf2(schema) || CheckMultipleOf(stack, context, schema, value))) && (!IsRef(schema) || CheckRef(stack, context, schema, value)) && (!IsRecursiveRef(schema) || CheckRecursiveRef(stack, context, schema, value)) && (!IsDynamicRef(schema) || CheckDynamicRef(stack, context, schema, value)) && (!IsConst(schema) || CheckConst(stack, context, schema, value)) && (!IsEnum(schema) || CheckEnum(stack, context, schema, value)) && (!IsIf(schema) || CheckIf(stack, context, schema, value)) && (!IsNot(schema) || CheckNot(stack, context, schema, value)) && (!IsAllOf(schema) || CheckAllOf(stack, context, schema, value)) && (!IsAnyOf(schema) || CheckAnyOf(stack, context, schema, value)) && (!IsOneOf(schema) || CheckOneOf(stack, context, schema, value)) && (!IsUnevaluatedItems(schema) || (!guard_exports.IsArray(value) || CheckUnevaluatedItems(stack, context, schema, value))) && (!IsUnevaluatedProperties(schema) || (!guard_exports.IsObject(value) || CheckUnevaluatedProperties(stack, context, schema, value))) && (!IsRefine(schema) || CheckRefine(stack, context, schema, value));
  stack.Pop(schema);
  return result;
}
function ErrorSchemaPushStack(stack, context, schemaPath, instancePath, schema, value) {
  return context.Push() && ErrorSchema(stack, context, schemaPath, instancePath, schema, value) && context.Pop();
}
function ErrorSchema(stack, context, schemaPath, instancePath, schema, value) {
  stack.Push(schema);
  const result = IsSchemaBoolean(schema) ? ErrorSchemaBoolean(stack, context, schemaPath, instancePath, schema, value) : !!(+(!IsType(schema) || ErrorType(stack, context, schemaPath, instancePath, schema, value)) & +(!(guard_exports.IsObject(value) && !guard_exports.IsArray(value)) || !!(+(!IsRequired(schema) || ErrorRequired(stack, context, schemaPath, instancePath, schema, value)) & +(!IsAdditionalProperties(schema) || ErrorAdditionalProperties(stack, context, schemaPath, instancePath, schema, value)) & +(!IsDependencies(schema) || ErrorDependencies(stack, context, schemaPath, instancePath, schema, value)) & +(!IsDependentRequired(schema) || ErrorDependentRequired(stack, context, schemaPath, instancePath, schema, value)) & +(!IsDependentSchemas(schema) || ErrorDependentSchemas(stack, context, schemaPath, instancePath, schema, value)) & +(!IsPatternProperties(schema) || ErrorPatternProperties(stack, context, schemaPath, instancePath, schema, value)) & +(!IsProperties(schema) || ErrorProperties(stack, context, schemaPath, instancePath, schema, value)) & +(!IsPropertyNames(schema) || ErrorPropertyNames(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinProperties(schema) || ErrorMinProperties(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMaxProperties(schema) || ErrorMaxProperties(stack, context, schemaPath, instancePath, schema, value)))) & +(!guard_exports.IsArray(value) || !!(+(!IsAdditionalItems(schema) || ErrorAdditionalItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsContains(schema) || ErrorContains(stack, context, schemaPath, instancePath, schema, value)) & +(!IsItems(schema) || ErrorItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMaxContains(schema) || ErrorMaxContains(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMaxItems(schema) || ErrorMaxItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinContains(schema) || ErrorMinContains(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinItems(schema) || ErrorMinItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsPrefixItems(schema) || ErrorPrefixItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsUniqueItems(schema) || ErrorUniqueItems(stack, context, schemaPath, instancePath, schema, value)))) & +(!guard_exports.IsString(value) || !!(+(!IsMaxLength3(schema) || ErrorMaxLength(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinLength3(schema) || ErrorMinLength(stack, context, schemaPath, instancePath, schema, value)) & +(!IsFormat(schema) || ErrorFormat(stack, context, schemaPath, instancePath, schema, value)) & +(!IsPattern(schema) || ErrorPattern(stack, context, schemaPath, instancePath, schema, value)))) & +(!(guard_exports.IsNumber(value) || guard_exports.IsBigInt(value)) || !!(+(!IsExclusiveMaximum(schema) || ErrorExclusiveMaximum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsExclusiveMinimum(schema) || ErrorExclusiveMinimum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMaximum(schema) || ErrorMaximum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinimum(schema) || ErrorMinimum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMultipleOf2(schema) || ErrorMultipleOf(stack, context, schemaPath, instancePath, schema, value)))) & +(!IsRef(schema) || ErrorRef(stack, context, schemaPath, instancePath, schema, value)) & +(!IsRecursiveRef(schema) || ErrorRecursiveRef(stack, context, schemaPath, instancePath, schema, value)) & +(!IsDynamicRef(schema) || ErrorDynamicRef(stack, context, schemaPath, instancePath, schema, value)) & +(!IsConst(schema) || ErrorConst(stack, context, schemaPath, instancePath, schema, value)) & +(!IsEnum(schema) || ErrorEnum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsIf(schema) || ErrorIf(stack, context, schemaPath, instancePath, schema, value)) & +(!IsNot(schema) || ErrorNot(stack, context, schemaPath, instancePath, schema, value)) & +(!IsAllOf(schema) || ErrorAllOf(stack, context, schemaPath, instancePath, schema, value)) & +(!IsAnyOf(schema) || ErrorAnyOf(stack, context, schemaPath, instancePath, schema, value)) & +(!IsOneOf(schema) || ErrorOneOf(stack, context, schemaPath, instancePath, schema, value)) & +(!IsUnevaluatedItems(schema) || (!guard_exports.IsArray(value) || ErrorUnevaluatedItems(stack, context, schemaPath, instancePath, schema, value))) & +(!IsUnevaluatedProperties(schema) || (!guard_exports.IsObject(value) || ErrorUnevaluatedProperties(stack, context, schemaPath, instancePath, schema, value)))) && (!IsRefine(schema) || ErrorRefine(stack, context, schemaPath, instancePath, schema, value));
  stack.Pop(schema);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/resolve/resolve.mjs
var resolve_exports = {};
__export(resolve_exports, {
  DynamicRef: () => DynamicRef,
  Ref: () => Ref
});

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/pointer/pointer.mjs
var pointer_exports = {};
__export(pointer_exports, {
  Delete: () => Delete,
  Get: () => Get3,
  Has: () => Has2,
  Indices: () => Indices,
  Set: () => Set4
});
function AssertNotRoot(indices) {
  if (indices.length === 0)
    throw Error("Cannot set root");
}
function AssertCanSet(value) {
  if (!guard_exports.IsObject(value))
    throw Error("Cannot set value");
}
function AssertIndex(index) {
  if (guard_exports.IsUnsafePropertyKey(index))
    throw Error("Pointer contains unsafe property key");
}
function AssertIndices(indices) {
  for (const index of indices)
    AssertIndex(index);
}
function IsNumericIndex(index) {
  return /^(0|[1-9]\d*)$/.test(index);
}
function TakeIndexRight(indices) {
  return [
    indices.slice(0, indices.length - 1),
    indices.slice(indices.length - 1)[0]
  ];
}
function HasIndex(index, value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, index);
}
function GetIndex(index, value) {
  return guard_exports.IsObject(value) && !guard_exports.IsUnsafePropertyKey(index) ? value[index] : void 0;
}
function GetIndices(indices, value) {
  return indices.reduce((value2, index) => GetIndex(index, value2), value);
}
function Indices(pointer) {
  if (guard_exports.IsEqual(pointer.length, 0))
    return [];
  const indices = pointer.split("/").map((index) => index.replace(/~1/g, "/").replace(/~0/g, "~"));
  return indices.length > 0 && indices[0] === "" ? indices.slice(1) : indices;
}
function Has2(value, pointer) {
  let current = value;
  return Indices(pointer).every((index) => {
    if (!HasIndex(index, current))
      return false;
    current = current[index];
    return true;
  });
}
function Get3(value, pointer) {
  const indices = Indices(pointer);
  return GetIndices(indices, value);
}
function Set4(value, pointer, next) {
  const indices = Indices(pointer);
  AssertNotRoot(indices);
  AssertIndices(indices);
  const [head, index] = TakeIndexRight(indices);
  const parent = GetIndices(head, value);
  AssertCanSet(parent);
  parent[index] = next;
  return value;
}
function Delete(value, pointer) {
  const indices = Indices(pointer);
  AssertNotRoot(indices);
  AssertIndices(indices);
  const [head, index] = TakeIndexRight(indices);
  const parent = GetIndices(head, value);
  AssertCanSet(parent);
  if (guard_exports.IsArray(parent) && IsNumericIndex(index)) {
    parent.splice(+index, 1);
  } else {
    delete parent[index];
  }
  return value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/resolve/ref.mjs
function MatchId(schema, base, ref) {
  if (schema.$id === ref.hash)
    return schema;
  const absoluteId = new URL(schema.$id, base.href);
  const absoluteRef = new URL(ref.href, base.href);
  if (guard_exports.IsEqual(absoluteId.pathname, absoluteRef.pathname)) {
    return ref.hash.startsWith("#") ? MatchHash(schema, base, ref) : schema;
  }
  return void 0;
}
function MatchAnchor(schema, base, ref) {
  const absoluteAnchor = new URL(`#${schema.$anchor}`, base.href);
  const absoluteRef = new URL(ref.href, base.href);
  return guard_exports.IsEqual(absoluteAnchor.href, absoluteRef.href) ? schema : void 0;
}
function MatchDynamicAnchor(schema, base, ref) {
  const absoluteAnchor = new URL(`#${schema.$dynamicAnchor}`, base.href);
  const absoluteRef = new URL(ref.href, base.href);
  return guard_exports.IsEqual(absoluteAnchor.href, absoluteRef.href) ? schema : void 0;
}
function MatchHash(schema, _base, ref) {
  if (ref.href.endsWith("#"))
    return schema;
  if (!ref.hash.startsWith("#"))
    return void 0;
  const fragment = decodeURIComponent(ref.hash.slice(1));
  if (!fragment.startsWith("/"))
    return void 0;
  return pointer_exports.Get(schema, fragment);
}
function Match2(schema, base, ref) {
  if (IsId(schema)) {
    const result = MatchId(schema, base, ref);
    if (!guard_exports.IsUndefined(result))
      return result;
  }
  if (IsAnchor(schema)) {
    const result = MatchAnchor(schema, base, ref);
    if (!guard_exports.IsUndefined(result))
      return result;
  }
  if (IsDynamicAnchor(schema)) {
    const result = MatchDynamicAnchor(schema, base, ref);
    if (!guard_exports.IsUndefined(result))
      return result;
  }
  return MatchHash(schema, base, ref);
}
function FromArray2(schema, base, ref) {
  return schema.reduce((result, item) => {
    const match = FromValue2(item, base, ref);
    return !guard_exports.IsUndefined(match) ? match : result;
  }, void 0);
}
function FromObject2(schema, base, ref) {
  return guard_exports.Keys(schema).reduce((result, key) => {
    const match = FromValue2(schema[key], base, ref);
    return !guard_exports.IsUndefined(match) ? match : result;
  }, void 0);
}
function FromValue2(schema, base, ref) {
  const nextBase = IsSchemaObject(schema) && IsId(schema) ? new URL(schema.$id, base.href) : base;
  if (IsSchemaObject(schema)) {
    const result = Match2(schema, nextBase, ref);
    if (!guard_exports.IsUndefined(result))
      return result;
  }
  if (guard_exports.IsArray(schema))
    return FromArray2(schema, nextBase, ref);
  if (guard_exports.IsObject(schema))
    return FromObject2(schema, nextBase, ref);
  return void 0;
}
function Ref(schema, ref) {
  const defaultBase = new URL("http://unknown/");
  const initialBase = IsId(schema) ? new URL(schema.$id, defaultBase.href) : defaultBase;
  const initialRef = new URL(ref, initialBase.href);
  return FromValue2(schema, initialBase, initialRef);
}
function DynamicRef(root, base, dynamicRef, dynamicAnchors) {
  const fragmentTarget = dynamicRef.$dynamicRef.startsWith("#") ? Ref(base, dynamicRef.$dynamicRef) : Ref(root, dynamicRef.$dynamicRef);
  if (guard_exports.IsUndefined(fragmentTarget))
    return void 0;
  if (!IsSchemaObject(fragmentTarget) || !IsDynamicAnchor(fragmentTarget))
    return fragmentTarget;
  const fragment = new URL(dynamicRef.$dynamicRef, "http://unknown/").hash;
  if (fragment.startsWith("#/"))
    return fragmentTarget;
  const anchorTarget = dynamicAnchors.find((anchor) => anchor.$dynamicAnchor === fragmentTarget.$dynamicAnchor);
  return anchorTarget ?? fragmentTarget;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/engine/_stack.mjs
var __classPrivateFieldGet = function(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _Stack_instances;
var _Stack_PushResourceAnchors;
var _Stack_PopResourceAnchors;
var _Stack_FromContext;
var _Stack_FromRef;
var Stack = class {
  constructor(context, schema) {
    _Stack_instances.add(this);
    this.context = context;
    this.schema = schema;
    this.ids = [];
    this.anchors = [];
    this.recursiveAnchors = [];
    this.dynamicAnchors = [];
  }
  // ----------------------------------------------------------------
  // Base
  // ----------------------------------------------------------------
  BaseURL() {
    return this.ids.reduce((result, schema) => new URL(schema.$id, result), new URL("http://unknown"));
  }
  Base() {
    return this.ids[this.ids.length - 1] ?? this.schema;
  }
  // ----------------------------------------------------------------
  // Stack
  // ----------------------------------------------------------------
  Push(schema) {
    if (!IsSchemaObject(schema))
      return;
    if (IsId(schema)) {
      this.ids.push(schema);
      __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_PushResourceAnchors).call(this, schema);
    }
    if (IsAnchor(schema))
      this.anchors.push(schema);
    if (IsRecursiveAnchorTrue(schema))
      this.recursiveAnchors.push(schema);
    if (IsDynamicAnchor(schema))
      this.dynamicAnchors.push(schema);
  }
  Pop(schema) {
    if (!IsSchemaObject(schema))
      return;
    if (IsId(schema)) {
      this.ids.pop();
      __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_PopResourceAnchors).call(this, schema);
    }
    if (IsAnchor(schema))
      this.anchors.pop();
    if (IsRecursiveAnchorTrue(schema))
      this.recursiveAnchors.pop();
    if (IsDynamicAnchor(schema))
      this.dynamicAnchors.pop();
  }
  Ref(ref) {
    return __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_FromContext).call(this, ref) ?? __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_FromRef).call(this, ref);
  }
  // ----------------------------------------------------------------
  // RecursiveRef
  // ----------------------------------------------------------------
  RecursiveRef(recursiveRef) {
    return IsRecursiveAnchorTrue(this.Base()) ? resolve_exports.Ref(this.recursiveAnchors[0], recursiveRef.$recursiveRef) : resolve_exports.Ref(this.Base(), recursiveRef.$recursiveRef);
  }
  // ----------------------------------------------------------------
  // DynamicRef
  // ----------------------------------------------------------------
  DynamicRef(dynamicRef) {
    const root = this.schema;
    return resolve_exports.DynamicRef(root, this.Base(), dynamicRef, this.dynamicAnchors);
  }
};
_Stack_instances = /* @__PURE__ */ new WeakSet(), _Stack_PushResourceAnchors = function _Stack_PushResourceAnchors2(schema, isRoot = true) {
  if (!IsSchemaObject(schema))
    return;
  const current = schema;
  if (!isRoot && IsId(current))
    return;
  if (!isRoot && IsDynamicAnchor(current))
    this.dynamicAnchors.push(current);
  for (const key of guard_exports.Keys(current))
    __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_PushResourceAnchors2).call(this, current[key], false);
}, _Stack_PopResourceAnchors = function _Stack_PopResourceAnchors2(schema, isRoot = true) {
  if (!IsSchemaObject(schema))
    return;
  const current = schema;
  if (!isRoot && IsId(current))
    return;
  if (!isRoot && IsDynamicAnchor(current))
    this.dynamicAnchors.pop();
  for (const key of guard_exports.Keys(current))
    __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_PopResourceAnchors2).call(this, current[key], false);
}, _Stack_FromContext = function _Stack_FromContext2(ref) {
  return guard_exports.HasPropertyKey(this.context, ref.$ref) ? this.context[ref.$ref] : void 0;
}, _Stack_FromRef = function _Stack_FromRef2(ref) {
  const root = this.schema;
  return !ref.$ref.startsWith("#") ? resolve_exports.Ref(root, ref.$ref) : resolve_exports.Ref(this.Base(), ref.$ref);
};

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/locale/en_US.mjs
function en_US(error) {
  switch (error.keyword) {
    case "additionalProperties":
      return "must not have additional properties";
    case "anyOf":
      return "must match a schema in anyOf";
    case "boolean":
      return "schema is false";
    case "const":
      return "must be equal to constant";
    case "contains":
      return "must contain at least 1 valid item";
    case "dependencies":
      return `must have properties ${error.params.dependencies.join(", ")} when property ${error.params.property} is present`;
    case "dependentRequired":
      return `must have properties ${error.params.dependencies.join(", ")} when property ${error.params.property} is present`;
    case "enum":
      return "must be equal to one of the allowed values";
    case "exclusiveMaximum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "exclusiveMinimum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "format":
      return `must match format "${error.params.format}"`;
    case "if":
      return `must match "${error.params.failingKeyword}" schema`;
    case "maxItems":
      return `must not have more than ${error.params.limit} items`;
    case "maxLength":
      return `must not have more than ${error.params.limit} characters`;
    case "maxProperties":
      return `must not have more than ${error.params.limit} properties`;
    case "maximum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "minItems":
      return `must not have fewer than ${error.params.limit} items`;
    case "minLength":
      return `must not have fewer than ${error.params.limit} characters`;
    case "minProperties":
      return `must not have fewer than ${error.params.limit} properties`;
    case "minimum":
      return `must be ${error.params.comparison} ${error.params.limit}`;
    case "multipleOf":
      return `must be multiple of ${error.params.multipleOf}`;
    case "not":
      return "must not be valid";
    case "oneOf":
      return "must match exactly one schema in oneOf";
    case "pattern":
      return `must match pattern "${error.params.pattern}"`;
    case "propertyNames":
      return `property names ${error.params.propertyNames.join(", ")} are invalid`;
    case "required":
      return `must have required properties ${error.params.requiredProperties.join(", ")}`;
    case "type":
      return typeof error.params.type === "string" ? `must be ${error.params.type}` : `must be either ${error.params.type.join(" or ")}`;
    case "unevaluatedItems":
      return "must not have unevaluated items";
    case "unevaluatedProperties":
      return "must not have unevaluated properties";
    case "uniqueItems":
      return `must not have duplicate items`;
    case "~refine":
      return error.params.message;
    // deno-coverage-ignore - unreachable
    default:
      return "an unknown validation error occurred";
  }
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/locale/_config.mjs
var locale = en_US;
function Get4() {
  return locale;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/errors.mjs
function Errors(...args) {
  const [context, schema, value] = arguments_exports.Match(args, {
    3: (context2, schema2, value2) => [context2, schema2, value2],
    2: (schema2, value2) => [{}, schema2, value2]
  });
  const settings2 = settings_exports.Get();
  const locale2 = Get4();
  const errors = [];
  const stack = new Stack(context, schema);
  const errorContext = new ErrorContext((error) => {
    if (guard_exports.IsGreaterEqualThan(errors.length, settings2.maxErrors))
      return;
    return errors.push({ ...error, message: locale2(error) });
  });
  const result = ErrorSchema(stack, errorContext, "#", "", schema, value);
  return [result, errors];
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/schema/check.mjs
function Check(...args) {
  const [context, schema, value] = arguments_exports.Match(args, {
    3: (context2, schema2, value2) => [context2, schema2, value2],
    2: (schema2, value2) => [{}, schema2, value2]
  });
  const stack = new Stack(context, schema);
  const checkContext = new CheckContext();
  return CheckSchema(stack, checkContext, schema, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/check/check.mjs
function Check2(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  return Check(context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/errors/errors.mjs
function Errors2(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  const [_, errors] = Errors(context, type, value);
  return errors;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/assert/assert.mjs
var AssertError = class extends Error {
  constructor(source, value, errors) {
    super(source);
    Object.defineProperty(this, "cause", {
      value: { source, errors, value },
      writable: false,
      configurable: false,
      enumerable: false
    });
  }
};
function Assert(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  const check = Check2(context, type, value);
  if (!check)
    throw new AssertError("Assert", value, Errors2(context, type, value));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/memory/memory.mjs
var memory_exports = {};
__export(memory_exports, {
  Assign: () => Assign,
  Clone: () => Clone,
  Create: () => Create,
  Discard: () => Discard,
  Metrics: () => Metrics,
  Update: () => Update
});

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/memory/metrics.mjs
var Metrics = {
  assign: 0,
  create: 0,
  clone: 0,
  discard: 0,
  update: 0
};

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/memory/assign.mjs
function Assign(left, right) {
  Metrics.assign += 1;
  return { ...left, ...right };
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/memory/clone.mjs
function FromClassInstance(value) {
  return value;
}
function IsTypeObject(value) {
  return guard_exports.HasPropertyKey(value, "~kind") || guard_exports.HasPropertyKey(value, "~unsafe");
}
function FromTypeObject(value) {
  const result = {};
  const descriptors4 = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.keys(descriptors4)) {
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    const descriptor2 = descriptors4[key];
    if (guard_exports.HasPropertyKey(descriptor2, "value")) {
      Object.defineProperty(result, key, { ...descriptor2, value: FromValue3(descriptor2.value) });
    }
  }
  return result;
}
function FromPlainObject(value) {
  const result = {};
  for (const key of guard_exports.Keys(value)) {
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    result[key] = FromValue3(value[key]);
  }
  for (const key of guard_exports.Symbols(value)) {
    result[key] = FromValue3(value[key]);
  }
  return result;
}
function FromObject3(value) {
  return guard_exports.IsClassInstance(value) ? FromClassInstance(value) : IsTypeObject(value) ? FromTypeObject(value) : FromPlainObject(value);
}
function FromArray3(value) {
  return value.map((element) => FromValue3(element));
}
function FromTypedArray(value) {
  return value.slice();
}
function FromRegExp2(value) {
  return new RegExp(value.source, value.flags);
}
function FromMap(value) {
  return new Map(FromValue3([...value.entries()]));
}
function FromSet(value) {
  return new Set(FromValue3([...value.values()]));
}
function FromValue3(value) {
  return globals_exports.IsTypeArray(value) ? FromTypedArray(value) : globals_exports.IsRegExp(value) ? FromRegExp2(value) : globals_exports.IsMap(value) ? FromMap(value) : globals_exports.IsSet(value) ? FromSet(value) : guard_exports.IsArray(value) ? FromArray3(value) : guard_exports.IsObject(value) ? FromObject3(value) : value;
}
function Clone(value) {
  Metrics.clone += 1;
  return FromValue3(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/memory/create.mjs
function MergeHidden(left, right) {
  for (const key of Object.keys(right)) {
    Object.defineProperty(left, key, {
      configurable: true,
      writable: true,
      enumerable: false,
      value: right[key]
    });
  }
  return left;
}
function Merge(left, right) {
  return { ...left, ...right };
}
function Create(hidden, enumerable, options = {}) {
  Metrics.create += 1;
  const settings2 = settings_exports.Get();
  const withOptions = Merge(enumerable, options);
  const withHidden = settings2.enumerableKind ? Merge(withOptions, hidden) : MergeHidden(withOptions, hidden);
  return settings2.immutableTypes ? Object.freeze(withHidden) : withHidden;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/memory/discard.mjs
function Discard(value, propertyKeys) {
  Metrics.discard += 1;
  const result = {};
  const descriptors4 = Object.getOwnPropertyDescriptors(Clone(value));
  const keysToDiscard = new Set(propertyKeys);
  for (const key of Object.keys(descriptors4)) {
    if (keysToDiscard.has(key))
      continue;
    Object.defineProperty(result, key, descriptors4[key]);
  }
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/system/memory/update.mjs
function Update(current, hidden, enumerable) {
  Metrics.update += 1;
  const settings2 = settings_exports.Get();
  const result = Clone(current);
  for (const key of Object.keys(hidden)) {
    Object.defineProperty(result, key, {
      configurable: true,
      writable: true,
      enumerable: settings2.enumerableKind,
      value: hidden[key]
    });
  }
  for (const key of Object.keys(enumerable)) {
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: enumerable[key]
    });
  }
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/schema.mjs
function IsKind(value, kind) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.IsEqual(value["~kind"], kind);
}
function IsSchema2(value) {
  return guard_exports.IsObject(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/deferred.mjs
function Deferred(action, parameters, options) {
  return memory_exports.Create({ "~kind": "Deferred" }, { type: "deferred", action, parameters, options }, {});
}
function IsDeferred(value) {
  return IsKind(value, "Deferred");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/readonly/instantiate_add.mjs
function AddReadonlyOperation(type) {
  return memory_exports.Update(type, { "~readonly": true }, {});
}
function AddReadonlyAction(type, options) {
  const result = memory_exports.Update(AddReadonlyOperation(type), {}, options);
  return result;
}
function AddReadonlyInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return AddReadonlyAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/optional/instantiate_add.mjs
function AddOptionalOperation(type) {
  return memory_exports.Update(type, { "~optional": true }, {});
}
function AddOptionalAction(type, options) {
  const result = memory_exports.Update(AddOptionalOperation(type), {}, options);
  return result;
}
function AddOptionalInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return AddOptionalAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/array.mjs
function _Array_(items, options) {
  return memory_exports.Create({ "~kind": "Array" }, { type: "array", items }, options);
}
function IsArray2(value) {
  return IsKind(value, "Array");
}
function ArrayOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "items"]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/constructor.mjs
function Constructor(parameters, instanceType, options = {}) {
  return memory_exports.Create({ "~kind": "Constructor" }, { type: "constructor", parameters, instanceType }, options);
}
function IsConstructor2(value) {
  return IsKind(value, "Constructor");
}
function ConstructorOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "parameters", "instanceType"]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/function.mjs
function _Function_(parameters, returnType, options = {}) {
  return memory_exports.Create({ ["~kind"]: "Function" }, { type: "function", parameters, returnType }, options);
}
function IsFunction2(value) {
  return IsKind(value, "Function");
}
function FunctionOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "parameters", "returnType"]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/ref.mjs
function Ref2(ref, options) {
  return memory_exports.Create({ ["~kind"]: "Ref" }, { $ref: ref }, options);
}
function IsRef2(value) {
  return IsKind(value, "Ref");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/generic.mjs
function Generic(parameters, expression) {
  return memory_exports.Create({ "~kind": "Generic" }, { type: "generic", parameters, expression });
}
function IsGeneric(value) {
  return IsKind(value, "Generic");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/any.mjs
function Any(options) {
  return memory_exports.Create({ ["~kind"]: "Any" }, {}, options);
}
function IsAny(value) {
  return IsKind(value, "Any");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/never.mjs
var NeverPattern = "(?!)";
function Never(options) {
  return memory_exports.Create({ "~kind": "Never" }, { not: {} }, options);
}
function IsNever(value) {
  return IsKind(value, "Never");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/_add_optional.mjs
function AddOptionalDeferred(type, options = {}) {
  return Deferred("AddOptional", [type], options);
}
function AddOptional(type, options = {}) {
  return AddOptionalAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/_optional.mjs
function Optional(type) {
  return AddOptional(type);
}
function IsOptional(value) {
  return IsSchema2(value) && guard_exports.HasPropertyKey(value, "~optional");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/properties.mjs
function RequiredArray(properties) {
  return guard_exports.Keys(properties).filter((key) => !IsOptional(properties[key]));
}
function PropertyKeys(properties) {
  return guard_exports.Keys(properties);
}
function PropertyValues(properties) {
  return guard_exports.Values(properties);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/object.mjs
function _Object_(properties, options = {}) {
  const requiredKeys = RequiredArray(properties);
  const required = requiredKeys.length > 0 ? { required: requiredKeys } : {};
  return memory_exports.Create({ "~kind": "Object" }, { type: "object", ...required, properties }, options);
}
function IsObject2(value) {
  return IsKind(value, "Object");
}
function ObjectOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "properties", "required"]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/unknown.mjs
function Unknown(options) {
  return memory_exports.Create({ ["~kind"]: "Unknown" }, {}, options);
}
function IsUnknown(value) {
  return IsKind(value, "Unknown");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/cyclic.mjs
function Cyclic($defs, $ref, options) {
  const defs = guard_exports.Keys($defs).reduce((result, key) => {
    return { ...result, [key]: memory_exports.Update($defs[key], {}, { $id: key }) };
  }, {});
  return memory_exports.Create({ ["~kind"]: "Cyclic" }, { $defs: defs, $ref }, options);
}
function IsCyclic(value) {
  return IsKind(value, "Cyclic");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/unsafe.mjs
function Unsafe(schema) {
  return memory_exports.Update(schema, { ["~unsafe"]: null }, {});
}
function IsUnsafe(value) {
  return guard_exports.IsObjectNotArray(value) && guard_exports.HasPropertyKey(value, "~unsafe") && guard_exports.IsNull(value["~unsafe"]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/infer.mjs
function Infer(...args) {
  const [name, extends_] = arguments_exports.Match(args, {
    2: (name2, extends_2) => [name2, extends_2, extends_2],
    1: (name2) => [name2, Unknown(), Unknown()]
  });
  return memory_exports.Create({ ["~kind"]: "Infer" }, { type: "infer", name, extends: extends_ }, {});
}
function IsInfer(value) {
  return IsKind(value, "Infer");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/dependent.mjs
function Dependent(if_, then_, else_, options = {}) {
  return memory_exports.Create({ "~kind": "Dependent" }, { if: if_, then: then_, else: else_ }, options);
}
function IsDependent(value) {
  return IsKind(value, "Dependent");
}
function DependentOptions(type) {
  return memory_exports.Discard(type, ["~kind", "if", "then", "else"]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/enum/typescript_enum_to_enum_values.mjs
function IsTypeScriptEnumLike(value) {
  return guard_exports.IsObjectNotArray(value);
}
function TypeScriptEnumToEnumValues(type) {
  const keys = guard_exports.Keys(type).filter((key) => isNaN(key));
  return keys.reduce((result, key) => [...result, type[key]], []);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/enum.mjs
function IsEnumValue(value) {
  return guard_exports.IsString(value) || guard_exports.IsNumber(value);
}
function Enum(value, options) {
  const values = IsTypeScriptEnumLike(value) ? TypeScriptEnumToEnumValues(value) : value;
  return memory_exports.Create({ "~kind": "Enum" }, { enum: values }, options);
}
function IsEnum2(value) {
  return IsKind(value, "Enum");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/intersect.mjs
function Intersect(types, options = {}) {
  return memory_exports.Create({ "~kind": "Intersect" }, { allOf: types }, options);
}
function IsIntersect(value) {
  return IsKind(value, "Intersect");
}
function IntersectOptions(type) {
  return memory_exports.Discard(type, ["~kind", "allOf"]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/_codec.mjs
var EncodeBuilder = class {
  constructor(type, decode) {
    this.type = type;
    this.decode = decode;
  }
  Encode(callback) {
    const type = this.type;
    const decode = IsCodec(type) ? (value) => this.decode(type["~codec"].decode(value)) : this.decode;
    const encode = IsCodec(type) ? (value) => type["~codec"].encode(callback(value)) : callback;
    const codec = { decode, encode };
    return memory_exports.Update(this.type, { "~codec": codec }, {});
  }
};
var DecodeBuilder = class {
  constructor(type) {
    this.type = type;
  }
  Decode(callback) {
    return new EncodeBuilder(this.type, callback);
  }
};
function Codec(type) {
  return new DecodeBuilder(type);
}
function Decode2(type, callback) {
  return Codec(type).Decode(callback).Encode(() => {
    throw Error("Encode not implemented");
  });
}
function Encode(type, callback) {
  return Codec(type).Decode(() => {
    throw Error("Decode not implemented");
  }).Encode(callback);
}
function IsCodec(value) {
  return IsSchema2(value) && guard_exports.HasPropertyKey(value, "~codec") && guard_exports.IsObject(value["~codec"]) && guard_exports.HasPropertyKey(value["~codec"], "encode") && guard_exports.HasPropertyKey(value["~codec"], "decode");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/_immutable.mjs
function Immutable(type) {
  return AddImmutable(type);
}
function IsImmutable(value) {
  return IsSchema2(value) && guard_exports.HasPropertyKey(value, "~immutable");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/_add_readonly.mjs
function AddReadonlyDeferred(type, options = {}) {
  return Deferred("AddReadonly", [type], options);
}
function AddReadonly(type, options = {}) {
  return AddReadonlyAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/_readonly.mjs
function Readonly(type) {
  return AddReadonly(type);
}
function IsReadonly(value) {
  return IsSchema2(value) && guard_exports.HasPropertyKey(value, "~readonly");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/_refine.mjs
function RefineAdd(type, refinement) {
  const refinements = IsRefine2(type) ? [...type["~refine"], refinement] : [refinement];
  return memory_exports.Update(type, { "~refine": refinements }, {});
}
function Refine(...args) {
  const [type, check, error] = arguments_exports.Match(args, {
    3: (type2, check2, error2) => [type2, check2, error2],
    2: (type2, check2) => [type2, check2, () => "Refine Error"]
  });
  return RefineAdd(type, { check, error });
}
function IsRefinement(value) {
  return guard_exports.IsObjectNotArray(value) && guard_exports.HasPropertyKey(value, "check") && guard_exports.HasPropertyKey(value, "error") && guard_exports.IsFunction(value.check) && guard_exports.IsFunction(value.error);
}
function IsRefine2(value) {
  return IsSchema2(value) && guard_exports.HasPropertyKey(value, "~refine") && guard_exports.IsArray(value["~refine"]) && guard_exports.Every(value["~refine"], 0, (value2) => IsRefinement(value2));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/bigint.mjs
var BigIntPattern = "-?(?:0|[1-9][0-9]*)n";
function BigInt2(options) {
  return memory_exports.Create({ "~kind": "BigInt" }, { type: "bigint" }, options);
}
function IsBigInt2(value) {
  return IsKind(value, "BigInt");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/boolean.mjs
function Boolean2(options) {
  return memory_exports.Create({ "~kind": "Boolean" }, { type: "boolean" }, options);
}
function IsBoolean3(value) {
  return IsKind(value, "Boolean");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/identifier.mjs
function Identifier(name) {
  return memory_exports.Create({ "~kind": "Identifier" }, { name });
}
function IsIdentifier(value) {
  return IsKind(value, "Identifier");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/integer.mjs
var IntegerPattern = "-?(?:0|[1-9][0-9]*)";
function Integer(options) {
  return memory_exports.Create({ "~kind": "Integer" }, { type: "integer" }, options);
}
function IsInteger2(value) {
  return IsKind(value, "Integer");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/literal.mjs
var InvalidLiteralValue = class extends Error {
  constructor(value) {
    super(`Invalid Literal value`);
    Object.defineProperty(this, "cause", {
      value: { value },
      writable: false,
      configurable: false,
      enumerable: false
    });
  }
};
function LiteralTypeName(value) {
  return guard_exports.IsBigInt(value) ? "bigint" : guard_exports.IsBoolean(value) ? "boolean" : guard_exports.IsNumber(value) ? "number" : guard_exports.IsString(value) ? "string" : (() => {
    throw new InvalidLiteralValue(value);
  })();
}
function Literal(value, options) {
  return memory_exports.Create({ "~kind": "Literal" }, { type: LiteralTypeName(value), const: value }, options);
}
function IsLiteralValue(value) {
  return guard_exports.IsBigInt(value) || guard_exports.IsBoolean(value) || guard_exports.IsNumber(value) || guard_exports.IsString(value);
}
function IsLiteralBigInt(value) {
  return IsLiteral(value) && guard_exports.IsBigInt(value.const);
}
function IsLiteralBoolean(value) {
  return IsLiteral(value) && guard_exports.IsBoolean(value.const);
}
function IsLiteralNumber(value) {
  return IsLiteral(value) && guard_exports.IsNumber(value.const);
}
function IsLiteralString(value) {
  return IsLiteral(value) && guard_exports.IsString(value.const);
}
function IsLiteral(value) {
  return IsKind(value, "Literal");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/null.mjs
function Null(options) {
  return memory_exports.Create({ "~kind": "Null" }, { type: "null" }, options);
}
function IsNull2(value) {
  return IsKind(value, "Null");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/number.mjs
var NumberPattern = "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?";
function Number2(options) {
  return memory_exports.Create({ "~kind": "Number" }, { type: "number" }, options);
}
function IsNumber3(value) {
  return IsKind(value, "Number");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/symbol.mjs
function Symbol2(options) {
  return memory_exports.Create({ "~kind": "Symbol" }, { type: "symbol" }, options);
}
function IsSymbol2(value) {
  return IsKind(value, "Symbol");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/parameter.mjs
function Parameter(...args) {
  const [name, extends_, equals] = arguments_exports.Match(args, {
    3: (name2, extends_2, equals2) => [name2, extends_2, equals2],
    2: (name2, extends_2) => [name2, extends_2, extends_2],
    1: (name2) => [name2, Unknown(), Unknown()]
  });
  return memory_exports.Create({ "~kind": "Parameter" }, { name, extends: extends_, equals }, {});
}
function IsParameter(value) {
  return IsKind(value, "Parameter");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/string.mjs
var StringPattern = ".*";
function String2(options) {
  return memory_exports.Create({ "~kind": "String" }, { type: "string" }, options);
}
function IsString3(value) {
  return IsKind(value, "String");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/union.mjs
function Union(anyOf, options = {}) {
  return memory_exports.Create({ "~kind": "Union" }, { anyOf }, options);
}
function IsUnion(value) {
  return IsKind(value, "Union");
}
function UnionOptions(type) {
  return memory_exports.Discard(type, ["~kind", "anyOf"]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/patterns/pattern.mjs
function ParsePatternIntoTypes(pattern) {
  const parsed = Pattern(pattern);
  const result = guard_exports.IsEqual(parsed.length, 2) ? parsed[0] : [];
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/template_literal/is_finite.mjs
function FromLiteral(_value) {
  return true;
}
function FromTypesReduce(types) {
  return guard_exports.ShiftLeft(types, (left, right) => FromType(left) ? FromTypesReduce(right) : false, () => true);
}
function FromTypes(types) {
  const result = guard_exports.IsEqual(types.length, 0) ? false : FromTypesReduce(types);
  return result;
}
function FromType(type) {
  return IsUnion(type) ? FromTypes(type.anyOf) : IsLiteral(type) ? FromLiteral(type.const) : false;
}
function IsTemplateLiteralFinite(types) {
  const result = FromTypes(types);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/template_literal/create.mjs
function TemplateLiteralCreate(pattern) {
  return memory_exports.Create({ ["~kind"]: "TemplateLiteral" }, { type: "string", pattern }, {});
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/template_literal/decode.mjs
function FromLiteralPush(variants, value, result = []) {
  return guard_exports.ShiftLeft(variants, (left, right) => FromLiteralPush(right, value, [...result, `${left}${value}`]), () => result);
}
function FromLiteral2(variants, value) {
  return guard_exports.IsEqual(variants.length, 0) ? [`${value}`] : FromLiteralPush(variants, value);
}
function FromUnion(variants, types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => FromUnion(variants, right, [...result, ...FromType2(variants, left)]), () => result);
}
function FromType2(variants, type) {
  const result = IsUnion(type) ? FromUnion(variants, type.anyOf) : IsLiteral(type) ? FromLiteral2(variants, type.const) : Unreachable();
  return result;
}
function DecodeFromSpan(variants, types) {
  return guard_exports.ShiftLeft(types, (left, right) => DecodeFromSpan(FromType2(variants, left), right), () => variants);
}
function VariantsToLiterals(variants) {
  return variants.map((variant2) => Literal(variant2));
}
function DecodeTypesAsUnion(types) {
  const variants = DecodeFromSpan([], types);
  const literals = VariantsToLiterals(variants);
  const result = Union(literals);
  return result;
}
function DecodeTypes(types) {
  return guard_exports.IsEqual(types.length, 0) ? Unreachable() : (
    // Literal('') :
    guard_exports.IsEqual(types.length, 1) && IsLiteral(types[0]) ? types[0] : DecodeTypesAsUnion(types)
  );
}
function TemplateLiteralDecodeUnsafe(pattern) {
  const types = ParsePatternIntoTypes(pattern);
  const result = guard_exports.IsEqual(types.length, 0) ? String2() : IsTemplateLiteralFinite(types) ? DecodeTypes(types) : TemplateLiteralCreate(pattern);
  return result;
}
function TemplateLiteralDecode(pattern) {
  const decoded = TemplateLiteralDecodeUnsafe(pattern);
  const result = IsTemplateLiteral(decoded) ? String2() : decoded;
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/record_create.mjs
function CreateRecord(key, value) {
  const type = "object";
  const patternProperties = { [key]: value };
  return memory_exports.Create({ ["~kind"]: "Record" }, { type, patternProperties });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/from_key_any.mjs
function FromAnyKey(value) {
  return CreateRecord(StringKey, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/from_key_boolean.mjs
function FromBooleanKey(value) {
  return _Object_({ true: value, false: value });
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/tuple.mjs
function Tuple(types, options = {}) {
  const [items, minItems, additionalItems] = [types, types.length, false];
  return memory_exports.Create({ ["~kind"]: "Tuple" }, { type: "array", additionalItems, items, minItems }, options);
}
function IsTuple(value) {
  return IsKind(value, "Tuple");
}
function TupleOptions(type) {
  return memory_exports.Discard(type, ["~kind", "type", "items", "minItems", "additionalItems"]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/readonly/instantiate_remove.mjs
function RemoveReadonlyOperation(type) {
  return memory_exports.Discard(type, ["~readonly"]);
}
function RemoveReadonlyAction(type, options) {
  const result = memory_exports.Update(RemoveReadonlyOperation(type), {}, options);
  return result;
}
function RemoveReadonlyInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return RemoveReadonlyAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/_remove_readonly.mjs
function RemoveReadonlyDeferred(type, options = {}) {
  return Deferred("RemoveReadonly", [type], options);
}
function RemoveReadonly(type, options = {}) {
  return RemoveReadonlyAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/optional/instantiate_remove.mjs
function RemoveOptionalOperation(type) {
  return memory_exports.Discard(type, ["~optional"]);
}
function RemoveOptionalAction(type, options) {
  const result = memory_exports.Update(RemoveOptionalOperation(type), {}, options);
  return result;
}
function RemoveOptionalInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return RemoveOptionalAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/_remove_optional.mjs
function RemoveOptionalDeferred(type, options = {}) {
  return Deferred("RemoveOptional", [type], options);
}
function RemoveOptional(type, options = {}) {
  return RemoveOptionalAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/tuple/to_object.mjs
function TupleElementsToProperties(types) {
  const result = types.reduceRight((result2, right, index) => {
    return { [index]: right, ...result2 };
  }, {});
  return result;
}
function TupleToObject(type) {
  const properties = TupleElementsToProperties(type.items);
  const result = _Object_(properties);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/evaluate/composite.mjs
function IsReadonlyProperty(left, right) {
  return IsReadonly(left) ? IsReadonly(right) ? true : false : false;
}
function IsOptionalProperty(left, right) {
  return IsOptional(left) ? IsOptional(right) ? true : false : false;
}
function CompositeProperty(left, right) {
  const isReadonly = IsReadonlyProperty(left, right);
  const isOptional = IsOptionalProperty(left, right);
  const evaluated = EvaluateIntersect([left, right]);
  const property = RemoveReadonly(RemoveOptional(evaluated));
  return isReadonly && isOptional ? AddReadonly(AddOptional(property)) : isReadonly && !isOptional ? AddReadonly(property) : !isReadonly && isOptional ? AddOptional(property) : property;
}
function CompositePropertyKey(left, right, key) {
  return key in left ? key in right ? CompositeProperty(left[key], right[key]) : left[key] : key in right ? right[key] : Never();
}
function CompositeProperties(left, right) {
  const keys = /* @__PURE__ */ new Set([...guard_exports.Keys(right), ...guard_exports.Keys(left)]);
  return [...keys].reduce((result, key) => {
    return { ...result, [key]: CompositePropertyKey(left, right, key) };
  }, {});
}
function GetProperties(type) {
  const result = IsObject2(type) ? type.properties : IsTuple(type) ? TupleElementsToProperties(type.items) : Unreachable();
  return result;
}
function Composite(left, right) {
  const leftProperties = GetProperties(left);
  const rightProperties = GetProperties(right);
  const properties = CompositeProperties(leftProperties, rightProperties);
  return _Object_(properties);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/evaluate/narrow.mjs
function Narrow(left, right) {
  const result = Compare(left, right);
  return guard_exports.IsEqual(result, ResultLeftInside) ? left : guard_exports.IsEqual(result, ResultRightInside) ? right : guard_exports.IsEqual(result, ResultEqual) ? right : Never();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/evaluate/distribute.mjs
function IsObjectLike(type) {
  return IsObject2(type) || IsTuple(type);
}
function IsUnionOperand(left, right) {
  const isUnionLeft = IsUnion(left);
  const isUnionRight = IsUnion(right);
  const result = isUnionLeft || isUnionRight;
  return result;
}
function DistributeOperation(left, right) {
  const evaluatedLeft = EvaluateType(left);
  const evaluatedRight = EvaluateType(right);
  const isUnionOperand = IsUnionOperand(evaluatedLeft, evaluatedRight);
  const isObjectLeft = IsObjectLike(evaluatedLeft);
  const IsObjectRight = IsObjectLike(evaluatedRight);
  const result = isUnionOperand ? EvaluateIntersect([evaluatedLeft, evaluatedRight]) : isObjectLeft && IsObjectRight ? Composite(evaluatedLeft, evaluatedRight) : isObjectLeft && !IsObjectRight ? evaluatedLeft : !isObjectLeft && IsObjectRight ? evaluatedRight : Narrow(evaluatedLeft, evaluatedRight);
  return result;
}
function DistributeType(type, types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => DistributeType(type, right, [...result, DistributeOperation(type, left)]), () => guard_exports.IsEqual(result.length, 0) ? [type] : result);
}
function DistributeUnion(types, distribution, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => DistributeUnion(right, distribution, [...result, ...Distribute([left], distribution)]), () => result);
}
function Distribute(types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => IsUnion(left) ? Distribute(right, DistributeUnion(left.anyOf, result)) : Distribute(right, DistributeType(left, result)), () => result);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/exclude/operation.mjs
function ExcludeType(left, right) {
  const check = Extends({}, left, right);
  const result = result_exports.IsExtendsTrueLike(check) ? [] : [left];
  return result;
}
function ExcludeUnion(types, right) {
  return types.reduce((result, head) => {
    return [...result, ...ExcludeType(head, right)];
  }, []);
}
function ExcludeOperation(left, right) {
  const evaluated = EvaluateType(left);
  const canonical = IsUnion(evaluated) ? evaluated.anyOf : [evaluated];
  const remaining = ExcludeUnion(canonical, right);
  const result = EvaluateUnion(remaining);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/evaluate/evaluate.mjs
function EvaluateDependent(if_, then_, else_) {
  const intersect = Intersect([if_, then_]);
  const excluded = ExcludeOperation(else_, if_);
  const result = EvaluateUnion([intersect, excluded]);
  return result;
}
function EvaluateEnum(values) {
  const result = values.map((value) => Literal(value));
  return EvaluateUnion(result);
}
function EvaluateIntersect(types) {
  const distribution = Distribute(types);
  const broadend = Broaden(distribution);
  const result = EvaluateUnionFast(broadend);
  return result;
}
function EvaluateTemplateLiteral(pattern) {
  const evaluated = TemplateLiteralDecode(pattern);
  const result = EvaluateType(evaluated);
  return result;
}
function EvaluateUnion(types) {
  const broadend = Broaden(types);
  const result = EvaluateUnionFast(broadend);
  return result;
}
function EvaluateType(type) {
  return IsDependent(type) ? EvaluateDependent(type.if, type.then, type.else) : IsEnum2(type) ? EvaluateEnum(type.enum) : IsIntersect(type) ? EvaluateIntersect(type.allOf) : IsTemplateLiteral(type) ? EvaluateTemplateLiteral(type.pattern) : IsUnion(type) ? EvaluateUnion(type.anyOf) : type;
}
function EvaluateUnionFast(types) {
  const result = guard_exports.IsEqual(types.length, 1) ? types[0] : guard_exports.IsEqual(types.length, 0) ? Never() : Union(types);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/from_key_enum.mjs
function FromEnumKey(values, value) {
  const unionKey = EvaluateEnum(values);
  const result = FromKey(unionKey, value);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/from_key_integer.mjs
function FromIntegerKey(_key, value) {
  const result = CreateRecord(IntegerKey, value);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/from_key_intersect.mjs
function FromIntersectKey(types, value) {
  const evaluatedKey = EvaluateIntersect(types);
  const result = FromKey(evaluatedKey, value);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/from_key_literal.mjs
function FromLiteralKey(key, value) {
  return guard_exports.IsString(key) || guard_exports.IsNumber(key) ? _Object_({ [key]: value }) : guard_exports.IsEqual(key, false) ? _Object_({ false: value }) : guard_exports.IsEqual(key, true) ? _Object_({ true: value }) : _Object_({});
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/from_key_number.mjs
function FromNumberKey(_key, value) {
  const result = CreateRecord(NumberKey, value);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/from_key_string.mjs
function FromStringKey(key, value) {
  return guard_exports.HasPropertyKey(key, "pattern") && (guard_exports.IsString(key.pattern) || key.pattern instanceof RegExp) ? CreateRecord(key.pattern.toString(), value) : CreateRecord(StringKey, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/from_key_template_literal.mjs
function FromTemplateKey(pattern, value) {
  const types = ParsePatternIntoTypes(pattern);
  const finite = IsTemplateLiteralFinite(types);
  const result = finite ? FromKey(EvaluateTemplateLiteral(pattern), value) : CreateRecord(pattern, value);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/evaluate/flatten.mjs
function FlattenType(type) {
  const result = IsUnion(type) ? Flatten(type.anyOf) : [type];
  return result;
}
function Flatten(types) {
  return types.reduce((result, type) => {
    return [...result, ...FlattenType(type)];
  }, []);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/from_key_union.mjs
function StringOrNumberCheck(types) {
  return types.some((type) => IsString3(type) || IsNumber3(type) || IsInteger2(type));
}
function TryBuildRecord(types, value) {
  return guard_exports.IsEqual(StringOrNumberCheck(types), true) ? CreateRecord(StringKey, value) : void 0;
}
function CreateProperties(types, value) {
  return types.reduce((result, left) => {
    return IsLiteral(left) && (guard_exports.IsString(left.const) || guard_exports.IsNumber(left.const)) ? { ...result, [left.const]: value } : result;
  }, {});
}
function CreateObject(types, value) {
  const properties = CreateProperties(types, value);
  const result = _Object_(properties);
  return result;
}
function FromUnionKey(types, value) {
  const flattened = Flatten(types);
  const record2 = TryBuildRecord(flattened, value);
  return IsSchema2(record2) ? record2 : CreateObject(flattened, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/from_key.mjs
function FromKey(key, value) {
  const result = IsAny(key) ? FromAnyKey(value) : IsBoolean3(key) ? FromBooleanKey(value) : IsEnum2(key) ? FromEnumKey(key.enum, value) : IsInteger2(key) ? FromIntegerKey(key, value) : IsIntersect(key) ? FromIntersectKey(key.allOf, value) : IsLiteral(key) ? FromLiteralKey(key.const, value) : IsNumber3(key) ? FromNumberKey(key, value) : IsUnion(key) ? FromUnionKey(key.anyOf, value) : IsString3(key) ? FromStringKey(key, value) : IsTemplateLiteral(key) ? FromTemplateKey(key.pattern, value) : _Object_({});
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/record/instantiate.mjs
function RecordAction(key, value, options) {
  const result = CanInstantiate([key]) ? memory_exports.Update(FromKey(key, value), {}, options) : RecordDeferred(key, value, options);
  return result;
}
function RecordInstantiate(context, state, key, value, options) {
  const instantiatedKey = InstantiateType(context, state, key);
  const instantiatedValue = InstantiateType(context, state, value);
  return RecordAction(instantiatedKey, instantiatedValue, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/record.mjs
var IntegerKey = `^${IntegerPattern}$`;
var NumberKey = `^${NumberPattern}$`;
var StringKey = `^${StringPattern}$`;
function RecordDeferred(key, value, options = {}) {
  return Deferred("Record", [key, value], options);
}
function Record(key, value, options = {}) {
  return RecordAction(key, value, options);
}
function RecordFromPattern(pattern, value) {
  return CreateRecord(pattern, value);
}
function RecordPatternToType(pattern) {
  const result = guard_exports.IsEqual(pattern, StringKey) ? String2() : guard_exports.IsEqual(pattern, IntegerKey) ? Integer() : guard_exports.IsEqual(pattern, NumberKey) ? Number2() : TemplateLiteralDecodeUnsafe(pattern);
  return result;
}
function RecordPattern(type) {
  return guard_exports.Keys(type.patternProperties)[0];
}
function RecordKey(type) {
  const pattern = RecordPattern(type);
  const result = RecordPatternToType(pattern);
  return result;
}
function RecordValue(type) {
  return type.patternProperties[RecordPattern(type)];
}
function IsRecord(value) {
  return IsKind(value, "Record");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/rest.mjs
function Rest(type) {
  return memory_exports.Create({ "~kind": "Rest" }, { type: "rest", items: type }, {});
}
function IsRest(value) {
  return IsKind(value, "Rest");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/this.mjs
function This(options) {
  return memory_exports.Create({ ["~kind"]: "This" }, { $ref: "#" }, options);
}
function IsThis(value) {
  return IsKind(value, "This");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/undefined.mjs
function Undefined(options) {
  return memory_exports.Create({ "~kind": "Undefined" }, { type: "undefined" }, options);
}
function IsUndefined2(value) {
  return IsKind(value, "Undefined");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/void.mjs
function Void(options) {
  return memory_exports.Create({ "~kind": "Void" }, { type: "void" }, options);
}
function IsVoid(value) {
  return IsKind(value, "Void");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/mapping.mjs
function IntrinsicOrCall(ref, parameters) {
  return guard_exports.IsEqual(ref, "Array") ? _Array_(parameters[0]) : guard_exports.IsEqual(ref, "Capitalize") ? CapitalizeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "ConstructorParameters") ? ConstructorParametersDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Evaluate") ? EvaluateDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Exclude") ? ExcludeDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Extract") ? ExtractDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Index") ? IndexDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "InstanceType") ? InstanceTypeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Lowercase") ? LowercaseDeferred(parameters[0]) : guard_exports.IsEqual(ref, "NonNullable") ? NonNullableDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Omit") ? OmitDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Parameters") ? ParametersDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Partial") ? PartialDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Pick") ? PickDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Readonly") ? ReadonlyObjectDeferred(parameters[0]) : guard_exports.IsEqual(ref, "KeyOf") ? KeyOfDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Record") ? RecordDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Required") ? RequiredDeferred(parameters[0]) : guard_exports.IsEqual(ref, "ReturnType") ? ReturnTypeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Uncapitalize") ? UncapitalizeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Uppercase") ? UppercaseDeferred(parameters[0]) : CallConstruct(Ref2(ref), parameters);
}
function Unreachable2() {
  throw Error("Unreachable");
}
var DelimitedDecode = (input, result = []) => {
  return input.reduce((result2, left) => {
    return guard_exports.IsArray(left) && guard_exports.IsEqual(left.length, 2) ? [...result2, left[0]] : [...result2, left];
  }, []);
};
var Delimited = (input) => {
  const [left, right] = input;
  return DelimitedDecode([...left, ...right]);
};
function GenericParameterExtendsEqualsMapping(input) {
  return Parameter(input[0], input[2], input[4]);
}
function GenericParameterExtendsMapping(input) {
  return Parameter(input[0], input[2], input[2]);
}
function GenericParameterEqualsMapping(input) {
  return Parameter(input[0], Unknown(), input[2]);
}
function GenericParameterIdentifierMapping(input) {
  return Parameter(input, Unknown(), Unknown());
}
function GenericParameterMapping(input) {
  return input;
}
function GenericParameterListMapping(input) {
  return Delimited(input);
}
function GenericParametersMapping(input) {
  return input[1];
}
function GenericCallArgumentListMapping(input) {
  return Delimited(input);
}
function GenericCallArgumentsMapping(input) {
  return input[1];
}
function GenericCallMapping(input) {
  return IntrinsicOrCall(input[0], input[1]);
}
function OptionalSemiColonMapping(input) {
  return null;
}
function KeywordStringMapping(input) {
  return String2();
}
function KeywordNumberMapping(input) {
  return Number2();
}
function KeywordBooleanMapping(input) {
  return Boolean2();
}
function KeywordUndefinedMapping(input) {
  return Undefined();
}
function KeywordNullMapping(input) {
  return Null();
}
function KeywordIntegerMapping(input) {
  return Integer();
}
function KeywordBigIntMapping(input) {
  return BigInt2();
}
function KeywordUnknownMapping(input) {
  return Unknown();
}
function KeywordAnyMapping(input) {
  return Any();
}
function KeywordObjectMapping(input) {
  return _Object_({});
}
function KeywordNeverMapping(input) {
  return Never();
}
function KeywordSymbolMapping(input) {
  return Symbol2();
}
function KeywordVoidMapping(input) {
  return Void();
}
function KeywordThisMapping(input) {
  return This();
}
function LiteralBigIntMapping(input) {
  return Literal(BigInt(input));
}
function LiteralBooleanMapping(input) {
  return Literal(guard_exports.IsEqual(input, "true"));
}
function LiteralNumberMapping(input) {
  return Literal(parseFloat(input));
}
function LiteralStringMapping(input) {
  return Literal(input);
}
function TemplateInterpolateMapping(input) {
  return input[1];
}
function TemplateSpanMapping(input) {
  return Literal(input);
}
function TemplateBodyMapping(input) {
  return guard_exports.IsEqual(input.length, 3) ? [input[0], input[1], ...input[2]] : [input[0]];
}
function TemplateLiteralTypesMapping(input) {
  return input[1];
}
function TemplateLiteralMapping(input) {
  return TemplateLiteralDeferred(input);
}
function DependentMapping(input) {
  return guard_exports.IsEqual(input.length, 6) ? Dependent(input[1], input[3], input[5]) : Dependent(input[1], input[3], Unknown());
}
function KeyOfMapping(input) {
  return input.length > 0;
}
function IndexArrayMapping(input) {
  return input.reduce((result, current) => {
    return guard_exports.IsEqual(current.length, 3) ? [...result, [current[1]]] : [...result, []];
  }, []);
}
function ExtendsMapping(input) {
  return guard_exports.IsEqual(input.length, 6) ? [input[1], input[3], input[5]] : [];
}
function BaseMapping(input) {
  return guard_exports.IsArray(input) && guard_exports.IsEqual(input.length, 3) ? input[1] : input;
}
function WithMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? input[1] : [];
}
function FactorIndexArray(Type2, indexArray) {
  return indexArray.reduce((result, left) => {
    const _left = left;
    return guard_exports.IsEqual(_left.length, 1) ? IndexDeferred(result, _left[0]) : guard_exports.IsEqual(_left.length, 0) ? _Array_(result) : Unreachable2();
  }, Type2);
}
function FactorExtends(type, extend) {
  return guard_exports.IsEqual(extend.length, 3) ? ConditionalDeferred(type, extend[0], extend[1], extend[2]) : type;
}
function FactorWith(type, withClause) {
  return guard_exports.IsArray(withClause) && guard_exports.IsEqual(withClause.length, 0) ? type : WithDeferred(type, withClause);
}
function FactorMapping(input) {
  const [keyOf, type, indexArray, extend, withClause] = input;
  return FactorWith(keyOf ? FactorExtends(KeyOfDeferred(FactorIndexArray(type, indexArray)), extend) : FactorExtends(FactorIndexArray(type, indexArray), extend), withClause);
}
function ExprBinaryMapping(left, rest) {
  return guard_exports.IsEqual(rest.length, 3) ? (() => {
    const [operator, right, next] = rest;
    const Schema = ExprBinaryMapping(right, next);
    if (guard_exports.IsEqual(operator, "&")) {
      return IsIntersect(Schema) ? Intersect([left, ...Schema.allOf]) : Intersect([left, Schema]);
    }
    if (guard_exports.IsEqual(operator, "|")) {
      return IsUnion(Schema) ? Union([left, ...Schema.anyOf]) : Union([left, Schema]);
    }
    Unreachable2();
  })() : left;
}
function ExprTermTailMapping(input) {
  return input;
}
function ExprTermMapping(input) {
  const [left, rest] = input;
  return ExprBinaryMapping(left, rest);
}
function ExprTailMapping(input) {
  return input;
}
function ExprMapping(input) {
  const [left, rest] = input;
  return ExprBinaryMapping(left, rest);
}
function ExprReadonlyMapping(input) {
  return AddImmutableDeferred(input[1]);
}
function ExprPipeMapping(input) {
  return input[1];
}
function GenericTypeMapping(input) {
  return Generic(input[0], input[2]);
}
function InferTypeMapping(input) {
  return guard_exports.IsEqual(input.length, 4) ? Infer(input[1], input[3]) : guard_exports.IsEqual(input.length, 2) ? Infer(input[1], Unknown()) : Unreachable2();
}
function TypeMapping(input) {
  return input;
}
function PropertyKeyNumberMapping(input) {
  return `${input}`;
}
function PropertyKeyIdentMapping(input) {
  return input;
}
function PropertyKeyQuotedMapping(input) {
  return input;
}
function PropertyKeyIndexMapping(input) {
  return IsInteger2(input[3]) ? IntegerKey : IsNumber3(input[3]) ? NumberKey : IsSymbol2(input[3]) ? StringKey : IsString3(input[3]) ? StringKey : Unreachable2();
}
function PropertyKeyMapping(input) {
  return input;
}
function ReadonlyMapping(input) {
  return input.length > 0;
}
function OptionalMapping(input) {
  return input.length > 0;
}
function PropertyMapping(input) {
  const [isReadonly, key, isOptional, _colon, type] = input;
  return {
    [key]: isReadonly && isOptional ? AddReadonlyDeferred(AddOptionalDeferred(type)) : isReadonly && !isOptional ? AddReadonlyDeferred(type) : !isReadonly && isOptional ? AddOptionalDeferred(type) : type
  };
}
function PropertyDelimiterMapping(input) {
  return input;
}
function PropertyListMapping(input) {
  return Delimited(input);
}
function PropertiesReduce(propertyList) {
  return propertyList.reduce((result, left) => {
    const isPatternProperties = guard_exports.HasPropertyKey(left, IntegerKey) || guard_exports.HasPropertyKey(left, NumberKey) || guard_exports.HasPropertyKey(left, StringKey);
    return isPatternProperties ? [result[0], memory_exports.Assign(result[1], left)] : [memory_exports.Assign(result[0], left), result[1]];
  }, [{}, {}]);
}
function PropertiesMapping(input) {
  return PropertiesReduce(input[1]);
}
function _Object_Mapping(input) {
  const [properties, patternProperties] = input;
  const options = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
  return _Object_(properties, options);
}
function ElementNamedMapping(input) {
  return guard_exports.IsEqual(input.length, 5) ? AddReadonlyDeferred(AddOptionalDeferred(input[4])) : guard_exports.IsEqual(input.length, 3) ? input[2] : guard_exports.IsEqual(input.length, 4) ? guard_exports.IsEqual(input[2], "readonly") ? AddReadonlyDeferred(input[3]) : AddOptionalDeferred(input[3]) : Unreachable2();
}
function ElementReadonlyOptionalMapping(input) {
  return AddReadonlyDeferred(AddOptionalDeferred(input[1]));
}
function ElementReadonlyMapping(input) {
  return AddReadonlyDeferred(input[1]);
}
function ElementOptionalMapping(input) {
  return AddOptionalDeferred(input[0]);
}
function ElementBaseMapping(input) {
  return input;
}
function ElementMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? Rest(input[1]) : guard_exports.IsEqual(input.length, 1) ? input[0] : Unreachable2();
}
function ElementListMapping(input) {
  return Delimited(input);
}
function _Tuple_Mapping(input) {
  return Tuple(input[1]);
}
function ParameterReadonlyOptionalMapping(input) {
  return AddReadonlyDeferred(AddOptionalDeferred(input[4]));
}
function ParameterReadonlyMapping(input) {
  return AddReadonlyDeferred(input[3]);
}
function ParameterOptionalMapping(input) {
  return AddOptionalDeferred(input[3]);
}
function ParameterTypeMapping(input) {
  return input[2];
}
function ParameterBaseMapping(input) {
  return input;
}
function ParameterMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? Rest(input[1]) : guard_exports.IsEqual(input.length, 1) ? input[0] : Unreachable2();
}
function ParameterListMapping(input) {
  return Delimited(input);
}
function _Function_Mapping(input) {
  return _Function_(input[1], input[4]);
}
function _Constructor_Mapping(input) {
  return Constructor(input[2], input[5]);
}
function ApplyReadonly(state, type) {
  return guard_exports.IsEqual(state, "remove") ? RemoveReadonlyDeferred(type) : guard_exports.IsEqual(state, "add") ? AddReadonlyDeferred(type) : type;
}
function MappedReadonlyMapping(input) {
  return guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "-") ? "remove" : guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "+") ? "add" : guard_exports.IsEqual(input.length, 1) ? "add" : "none";
}
function ApplyOptional(state, type) {
  return guard_exports.IsEqual(state, "remove") ? RemoveOptionalDeferred(type) : guard_exports.IsEqual(state, "add") ? AddOptionalDeferred(type) : type;
}
function MappedOptionalMapping(input) {
  return guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "-") ? "remove" : guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "+") ? "add" : guard_exports.IsEqual(input.length, 1) ? "add" : "none";
}
function MappedAsMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? [input[1]] : [];
}
function _Mapped_Mapping(input) {
  return guard_exports.IsArray(input[6]) && guard_exports.IsEqual(input[6].length, 1) ? MappedDeferred(Identifier(input[3]), input[5], input[6][0], ApplyReadonly(input[1], ApplyOptional(input[8], input[10]))) : MappedDeferred(Identifier(input[3]), input[5], Ref2(input[3]), ApplyReadonly(input[1], ApplyOptional(input[8], input[10])));
}
function ReferenceMapping(input) {
  return Ref2(input);
}
function WithBigIntMapping(input) {
  return BigInt(input);
}
function WithNumberMapping(input) {
  return parseFloat(input);
}
function WithBooleanMapping(input) {
  return guard_exports.IsEqual(input, "true");
}
function WithStringMapping(input) {
  return input;
}
function WithNullMapping(input) {
  return null;
}
function WithUndefinedMapping(input) {
  return void 0;
}
function WithPropertyMapping(input) {
  return { [input[0]]: input[2] };
}
function WithPropertyListMapping(input) {
  return Delimited(input);
}
function WithObjectMappingReduce(propertyList) {
  return propertyList.reduce((result, left) => {
    return memory_exports.Assign(result, left);
  }, {});
}
function WithObjectMapping(input) {
  return WithObjectMappingReduce(input[1]);
}
function WithElementListMapping(input) {
  return Delimited(input);
}
function WithArrayMapping(input) {
  return input[1];
}
function WithValueMapping(input) {
  return input;
}
function PatternBigIntMapping(input) {
  return BigInt2();
}
function PatternStringMapping(input) {
  return String2();
}
function PatternNumberMapping(input) {
  return Number2();
}
function PatternIntegerMapping(input) {
  return Integer();
}
function PatternNeverMapping(input) {
  return Never();
}
function PatternTextMapping(input) {
  return Literal(input);
}
function PatternBaseMapping(input) {
  return input;
}
function PatternGroupMapping(input) {
  return Union(input[1]);
}
function PatternUnionMapping(input) {
  return input.length === 3 ? [...input[0], ...input[2]] : input.length === 1 ? [...input[0]] : [];
}
function PatternTermMapping(input) {
  return [input[0], ...input[1]];
}
function PatternBodyMapping(input) {
  return input;
}
function PatternMapping(input) {
  return input[1];
}
function InterfaceDeclarationHeritageListMapping(input) {
  return Delimited(input);
}
function InterfaceDeclarationHeritageMapping(input) {
  return guard_exports.IsEqual(input.length, 2) ? input[1] : [];
}
function InterfaceDeclarationGenericMapping(input) {
  const parameters = input[2];
  const heritage = input[3];
  const [properties, patternProperties] = input[4];
  const options = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
  return { [input[1]]: Generic(parameters, InterfaceDeferred(heritage, properties, options)) };
}
function InterfaceDeclarationMapping(input) {
  const heritage = input[2];
  const [properties, patternProperties] = input[3];
  const options = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
  return { [input[1]]: InterfaceDeferred(heritage, properties, options) };
}
function TypeAliasDeclarationGenericMapping(input) {
  return { [input[1]]: Generic(input[2], input[4]) };
}
function TypeAliasDeclarationMapping(input) {
  return { [input[1]]: input[3] };
}
function ExportKeywordMapping(input) {
  return null;
}
function ModuleDeclarationDelimiterMapping(input) {
  return input;
}
function ModuleDeclarationListMapping(input) {
  return PropertiesReduce(Delimited(input));
}
function ModuleDeclarationMapping(input) {
  return input[1];
}
function ModuleMapping(input) {
  const moduleDeclaration = input[0];
  const moduleDeclarationList = input[1];
  return ModuleDeferred(memory_exports.Assign(moduleDeclaration, moduleDeclarationList[0]));
}
function ScriptMapping(input) {
  return input;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/internal/match.mjs
function IsMatch(value) {
  return IsEqual(value.length, 2);
}
function Match3(input, ok, fail) {
  return IsMatch(input) ? ok(input[0], input[1]) : fail();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/internal/take.mjs
function TakeVariant(variant2, input) {
  return IsEqual(input.indexOf(variant2), 0) ? [variant2, input.slice(variant2.length)] : [];
}
function Take(variants, input) {
  for (let i = 0; i < variants.length; i++) {
    const result = TakeVariant(variants[i], input);
    if (IsMatch(result))
      return result;
  }
  return [];
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/internal/char.mjs
function Range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, i) => String.fromCharCode(start + i));
}
var Alpha = [
  ...Range(97, 122),
  // Lowercase
  ...Range(65, 90)
  // Uppercase
];
var Zero = "0";
var NonZero = Range(49, 57);
var Digit = [Zero, ...NonZero];
var WhiteSpace = " ";
var NewLine = "\n";
var UnderScore = "_";
var Dot = ".";
var DollarSign = "$";
var Hyphen = "-";

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/internal/trim.mjs
var LineComment = "//";
var OpenComment = "/*";
var CloseComment = "*/";
function DiscardMultilineComment(input) {
  const index = input.indexOf(CloseComment);
  const result = IsEqual(index, -1) ? "" : input.slice(index + 2);
  return result;
}
function DiscardLineComment(input) {
  const index = input.indexOf(NewLine);
  const result = IsEqual(index, -1) ? "" : input.slice(index);
  return result;
}
function TrimStartUntilNewline(input) {
  return input.replace(/^[ \t\r\f\v]+/, "");
}
function TrimWhitespace(input) {
  const trimmed = TrimStartUntilNewline(input);
  return trimmed.startsWith(OpenComment) ? TrimWhitespace(DiscardMultilineComment(trimmed.slice(2))) : trimmed.startsWith(LineComment) ? TrimWhitespace(DiscardLineComment(trimmed.slice(2))) : trimmed;
}
function Trim(input) {
  const trimmed = input.trimStart();
  return trimmed.startsWith(OpenComment) ? Trim(DiscardMultilineComment(trimmed.slice(2))) : trimmed.startsWith(LineComment) ? Trim(DiscardLineComment(trimmed.slice(2))) : trimmed;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/internal/optional.mjs
function Optional2(value, input) {
  return Match3(Take([value], input), (Optional4, Rest2) => [Optional4, Rest2], () => ["", input]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/internal/many.mjs
function IsDiscard(discard, input) {
  return discard.includes(input);
}
function Many(allowed, discard, input, result = "") {
  return Match3(Take(allowed, input), (Char, Rest2) => IsDiscard(discard, Char) ? Many(allowed, discard, Rest2, result) : Many(allowed, discard, Rest2, `${result}${Char}`), () => [result, input]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/unsigned_integer.mjs
function TakeNonZero(input) {
  return Take(NonZero, input);
}
var AllowedDigits = [...Digit, UnderScore];
function TakeDigits(input) {
  return Many(AllowedDigits, [UnderScore], input);
}
function TakeUnsignedInteger(input) {
  return Match3(Take([Zero], input), (Zero2, ZeroRest) => [Zero2, ZeroRest], () => Match3(
    TakeNonZero(input),
    (NonZero2, NonZeroRest) => Match3(TakeDigits(NonZeroRest), (Digits, DigitsRest) => [`${NonZero2}${Digits}`, DigitsRest], () => []),
    // fail: did not match Digits
    () => []
  ));
}
function UnsignedInteger(input) {
  return TakeUnsignedInteger(Trim(input));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/integer.mjs
function TakeSign(input) {
  return Optional2(Hyphen, input);
}
function TakeSignedInteger(input) {
  return Match3(
    TakeSign(input),
    (Sign, SignRest) => Match3(UnsignedInteger(SignRest), (UnsignedInteger2, UnsignedIntegerRest) => [`${Sign}${UnsignedInteger2}`, UnsignedIntegerRest], () => []),
    // fail: did not match unsigned integer
    () => []
  );
}
function Integer2(input) {
  return TakeSignedInteger(Trim(input));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/bigint.mjs
function TakeBigInt(input) {
  return Match3(
    Integer2(input),
    (Integer3, IntegerRest) => Match3(Take(["n"], IntegerRest), (_N, NRest) => [`${Integer3}`, NRest], () => []),
    // fail: did not match 'n'
    () => []
  );
}
function BigInt3(input) {
  return TakeBigInt(input);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/const.mjs
function TakeConst(const_, input) {
  return Take([const_], input);
}
function Const(const_, input) {
  return IsEqual(const_, "") ? ["", input] : const_.startsWith(NewLine) ? TakeConst(const_, TrimWhitespace(input)) : const_.startsWith(WhiteSpace) ? TakeConst(const_, input) : TakeConst(const_, Trim(input));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/ident.mjs
var Initial = [...Alpha, UnderScore, DollarSign];
function TakeInitial(input) {
  return Take(Initial, input);
}
var Remaining = [...Initial, ...Digit];
function TakeRemaining(input, result = "") {
  return Match3(Take(Remaining, input), (Remaining2, RemainingRest) => TakeRemaining(RemainingRest, `${result}${Remaining2}`), () => [result, input]);
}
function TakeIdent(input) {
  return Match3(
    TakeInitial(input),
    (Initial2, InitialRest) => Match3(TakeRemaining(InitialRest), (Remaining2, RemainingRest) => [`${Initial2}${Remaining2}`, RemainingRest], () => []),
    // fail: did not match Remaining
    () => []
  );
}
function Ident(input) {
  return TakeIdent(Trim(input));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/unsigned_number.mjs
var AllowedDigits2 = [...Digit, UnderScore];
function IsLeadingDot(input) {
  return IsMatch(Take([Dot], input));
}
function TakeFractional(input) {
  return Match3(Many(AllowedDigits2, [UnderScore], input), (Digits, DigitsRest) => IsEqual(Digits, "") ? [] : [Digits, DigitsRest], () => []);
}
function LeadingDot(input) {
  return Match3(
    Take([Dot], input),
    (Dot2, DotRest) => Match3(TakeFractional(DotRest), (Fractional, FractionalRest) => [`0${Dot2}${Fractional}`, FractionalRest], () => []),
    // fail: did not match Fractional
    () => []
  );
}
function LeadingInteger(input) {
  return Match3(
    UnsignedInteger(input),
    (Integer3, IntegerRest) => Match3(
      Take([Dot], IntegerRest),
      (Dot2, DotRest) => Match3(TakeFractional(DotRest), (Fractional, FractionalRest) => [`${Integer3}${Dot2}${Fractional}`, FractionalRest], () => [`${Integer3}`, DotRest]),
      // fail: did not match Fractional, use Integer
      () => [`${Integer3}`, IntegerRest]
    ),
    // fail: did not match Dot, use Integer
    () => []
  );
}
function TakeUnsignedNumber(input) {
  return IsLeadingDot(input) ? LeadingDot(input) : LeadingInteger(input);
}
function UnsignedNumber(input) {
  return TakeUnsignedNumber(Trim(input));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/number.mjs
function TakeSign2(input) {
  return Optional2(Hyphen, input);
}
function TakeSignedNumber(input) {
  return Match3(
    TakeSign2(input),
    (Sign, SignRest) => Match3(UnsignedNumber(SignRest), (UnsignedInteger2, UnsignedIntegerRest) => [`${Sign}${UnsignedInteger2}`, UnsignedIntegerRest], () => []),
    // fail: did not match unsigned integer
    () => []
  );
}
function Number3(input) {
  return TakeSignedNumber(Trim(input));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/until.mjs
function TakeOne(input) {
  const result = IsEqual(input, "") ? [] : [input.slice(0, 1), input.slice(1)];
  return result;
}
function IsInputMatchSentinal(end, input) {
  return ShiftLeft(end, (left, right) => input.startsWith(left) ? true : IsInputMatchSentinal(right, input), () => false);
}
function Until(end, input, result = "") {
  return Match3(
    TakeOne(input),
    (One, Rest2) => IsInputMatchSentinal(end, input) ? [result, input] : Until(end, Rest2, `${result}${One}`),
    () => []
  );
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/span.mjs
function MultiLine(start, end, input) {
  return Match3(
    Take([start], input),
    (_, Rest2) => Match3(
      Until([end], Rest2),
      (Until2, UntilRest) => Match3(Take([end], UntilRest), (_2, Rest3) => [`${Until2}`, Rest3], () => []),
      // fail: did not match End
      () => []
    ),
    // fail: did not match Until
    () => []
  );
}
function SingleLine(start, end, input) {
  return Match3(
    Take([start], input),
    (_, Rest2) => Match3(
      Until([NewLine, end], Rest2),
      (Until2, UntilRest) => Match3(Take([end], UntilRest), (_2, EndRest) => [`${Until2}`, EndRest], () => []),
      // fail: did not match End
      () => []
    ),
    // fail: did not match Until
    () => []
  );
}
function Span(start, end, multiLine, input) {
  return multiLine ? MultiLine(start, end, Trim(input)) : SingleLine(start, end, Trim(input));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/string.mjs
function TakeInitial2(quotes, input) {
  return Take(quotes, input);
}
function TakeSpan(quote, input) {
  return Span(quote, quote, false, input);
}
function TakeString(quotes, input) {
  return Match3(TakeInitial2(quotes, input), (Initial2, InitialRest) => TakeSpan(Initial2, `${Initial2}${InitialRest}`), () => []);
}
function String3(quotes, input) {
  return TakeString(quotes, Trim(input));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/token/until_1.mjs
function Until_1(end, input) {
  return Match3(Until(end, input), (Until2, UntilRest) => IsEqual(Until2, "") ? [] : [Until2, UntilRest], () => []);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/parser.mjs
var If = (result, left, right = () => []) => result.length === 2 ? left(result) : right();
var GenericParameterExtendsEquals = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("extends", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => If(Const("=", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [GenericParameterExtendsEqualsMapping(_0), input2]);
var GenericParameterExtends = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("extends", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParameterExtendsMapping(_0), input2]);
var GenericParameterEquals = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("=", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParameterEqualsMapping(_0), input2]);
var GenericParameterIdentifier = (input) => If(Ident(input), ([_0, input2]) => [GenericParameterIdentifierMapping(_0), input2]);
var GenericParameter = (input) => If(If(GenericParameterExtendsEquals(input), ([_0, input2]) => [_0, input2], () => If(GenericParameterExtends(input), ([_0, input2]) => [_0, input2], () => If(GenericParameterEquals(input), ([_0, input2]) => [_0, input2], () => If(GenericParameterIdentifier(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [GenericParameterMapping(_0), input2]);
var GenericParameterList_0 = (input, result = []) => If(If(GenericParameter(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => GenericParameterList_0(input2, [...result, _0]), () => [result, input]);
var GenericParameterList = (input) => If(If(GenericParameterList_0(input), ([_0, input2]) => If(If(If(GenericParameter(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [GenericParameterListMapping(_0), input2]);
var GenericParameters = (input) => If(If(Const("<", input), ([_0, input2]) => If(GenericParameterList(input2), ([_1, input3]) => If(Const(">", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParametersMapping(_0), input2]);
var GenericCallArgumentList_0 = (input, result = []) => If(If(Type(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => GenericCallArgumentList_0(input2, [...result, _0]), () => [result, input]);
var GenericCallArgumentList = (input) => If(If(GenericCallArgumentList_0(input), ([_0, input2]) => If(If(If(Type(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [GenericCallArgumentListMapping(_0), input2]);
var GenericCallArguments = (input) => If(If(Const("<", input), ([_0, input2]) => If(GenericCallArgumentList(input2), ([_1, input3]) => If(Const(">", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericCallArgumentsMapping(_0), input2]);
var GenericCall = (input) => If(If(Ident(input), ([_0, input2]) => If(GenericCallArguments(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [GenericCallMapping(_0), input2]);
var OptionalSemiColon = (input) => If(If(If(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [OptionalSemiColonMapping(_0), input2]);
var KeywordString = (input) => If(Const("string", input), ([_0, input2]) => [KeywordStringMapping(_0), input2]);
var KeywordNumber = (input) => If(Const("number", input), ([_0, input2]) => [KeywordNumberMapping(_0), input2]);
var KeywordBoolean = (input) => If(Const("boolean", input), ([_0, input2]) => [KeywordBooleanMapping(_0), input2]);
var KeywordUndefined = (input) => If(Const("undefined", input), ([_0, input2]) => [KeywordUndefinedMapping(_0), input2]);
var KeywordNull = (input) => If(Const("null", input), ([_0, input2]) => [KeywordNullMapping(_0), input2]);
var KeywordInteger = (input) => If(Const("integer", input), ([_0, input2]) => [KeywordIntegerMapping(_0), input2]);
var KeywordBigInt = (input) => If(Const("bigint", input), ([_0, input2]) => [KeywordBigIntMapping(_0), input2]);
var KeywordUnknown = (input) => If(Const("unknown", input), ([_0, input2]) => [KeywordUnknownMapping(_0), input2]);
var KeywordAny = (input) => If(Const("any", input), ([_0, input2]) => [KeywordAnyMapping(_0), input2]);
var KeywordObject = (input) => If(Const("object", input), ([_0, input2]) => [KeywordObjectMapping(_0), input2]);
var KeywordNever = (input) => If(Const("never", input), ([_0, input2]) => [KeywordNeverMapping(_0), input2]);
var KeywordSymbol = (input) => If(Const("symbol", input), ([_0, input2]) => [KeywordSymbolMapping(_0), input2]);
var KeywordVoid = (input) => If(Const("void", input), ([_0, input2]) => [KeywordVoidMapping(_0), input2]);
var KeywordThis = (input) => If(Const("this", input), ([_0, input2]) => [KeywordThisMapping(_0), input2]);
var TemplateInterpolate = (input) => If(If(Const("${", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [TemplateInterpolateMapping(_0), input2]);
var TemplateSpan = (input) => If(Until(["${", "`"], input), ([_0, input2]) => [TemplateSpanMapping(_0), input2]);
var TemplateBody = (input) => If(If(If(TemplateSpan(input), ([_0, input2]) => If(TemplateInterpolate(input2), ([_1, input3]) => If(TemplateBody(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(If(TemplateSpan(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(TemplateSpan(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [TemplateBodyMapping(_0), input2]);
var TemplateLiteralTypes = (input) => If(If(Const("`", input), ([_0, input2]) => If(TemplateBody(input2), ([_1, input3]) => If(Const("`", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [TemplateLiteralTypesMapping(_0), input2]);
var TemplateLiteral = (input) => If(TemplateLiteralTypes(input), ([_0, input2]) => [TemplateLiteralMapping(_0), input2]);
var Dependent2 = (input) => If(If(If(Const("if", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("then", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => If(Const("else", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_0, input2], () => If(If(Const("if", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("then", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [DependentMapping(_0), input2]);
var LiteralBigInt = (input) => If(BigInt3(input), ([_0, input2]) => [LiteralBigIntMapping(_0), input2]);
var LiteralBoolean = (input) => If(If(Const("true", input), ([_0, input2]) => [_0, input2], () => If(Const("false", input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [LiteralBooleanMapping(_0), input2]);
var LiteralNumber = (input) => If(Number3(input), ([_0, input2]) => [LiteralNumberMapping(_0), input2]);
var LiteralString = (input) => If(String3(["'", '"'], input), ([_0, input2]) => [LiteralStringMapping(_0), input2]);
var KeyOf = (input) => If(If(If(Const("keyof", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [KeyOfMapping(_0), input2]);
var IndexArray_0 = (input, result = []) => If(If(If(Const("[", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(If(Const("[", input), ([_0, input2]) => If(Const("]", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => IndexArray_0(input2, [...result, _0]), () => [result, input]);
var IndexArray = (input) => If(IndexArray_0(input), ([_0, input2]) => [IndexArrayMapping(_0), input2]);
var Extends2 = (input) => If(If(If(Const("extends", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("?", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => If(Const(":", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExtendsMapping(_0), input2]);
var Base = (input) => If(If(If(Const("(", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const(")", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(KeywordString(input), ([_0, input2]) => [_0, input2], () => If(KeywordNumber(input), ([_0, input2]) => [_0, input2], () => If(KeywordBoolean(input), ([_0, input2]) => [_0, input2], () => If(KeywordUndefined(input), ([_0, input2]) => [_0, input2], () => If(KeywordNull(input), ([_0, input2]) => [_0, input2], () => If(KeywordInteger(input), ([_0, input2]) => [_0, input2], () => If(KeywordBigInt(input), ([_0, input2]) => [_0, input2], () => If(KeywordUnknown(input), ([_0, input2]) => [_0, input2], () => If(KeywordAny(input), ([_0, input2]) => [_0, input2], () => If(KeywordObject(input), ([_0, input2]) => [_0, input2], () => If(KeywordNever(input), ([_0, input2]) => [_0, input2], () => If(KeywordSymbol(input), ([_0, input2]) => [_0, input2], () => If(KeywordVoid(input), ([_0, input2]) => [_0, input2], () => If(KeywordThis(input), ([_0, input2]) => [_0, input2], () => If(LiteralBigInt(input), ([_0, input2]) => [_0, input2], () => If(LiteralBoolean(input), ([_0, input2]) => [_0, input2], () => If(LiteralNumber(input), ([_0, input2]) => [_0, input2], () => If(LiteralString(input), ([_0, input2]) => [_0, input2], () => If(TemplateLiteral(input), ([_0, input2]) => [_0, input2], () => If(Dependent2(input), ([_0, input2]) => [_0, input2], () => If(_Object_2(input), ([_0, input2]) => [_0, input2], () => If(_Tuple_(input), ([_0, input2]) => [_0, input2], () => If(_Constructor_(input), ([_0, input2]) => [_0, input2], () => If(_Function_2(input), ([_0, input2]) => [_0, input2], () => If(_Mapped_(input), ([_0, input2]) => [_0, input2], () => If(GenericCall(input), ([_0, input2]) => [_0, input2], () => If(Reference(input), ([_0, input2]) => [_0, input2], () => [])))))))))))))))))))))))))))), ([_0, input2]) => [BaseMapping(_0), input2]);
var With = (input) => If(If(If(Const("with", input), ([_0, input2]) => If(WithObject(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [WithMapping(_0), input2]);
var Factor = (input) => If(If(KeyOf(input), ([_0, input2]) => If(Base(input2), ([_1, input3]) => If(IndexArray(input3), ([_2, input4]) => If(Extends2(input4), ([_3, input5]) => If(With(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [FactorMapping(_0), input2]);
var ExprTermTail = (input) => If(If(If(Const("&", input), ([_0, input2]) => If(Factor(input2), ([_1, input3]) => If(ExprTermTail(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExprTermTailMapping(_0), input2]);
var ExprTerm = (input) => If(If(Factor(input), ([_0, input2]) => If(ExprTermTail(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprTermMapping(_0), input2]);
var ExprTail = (input) => If(If(If(Const("|", input), ([_0, input2]) => If(ExprTerm(input2), ([_1, input3]) => If(ExprTail(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExprTailMapping(_0), input2]);
var Expr = (input) => If(If(ExprTerm(input), ([_0, input2]) => If(ExprTail(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprMapping(_0), input2]);
var ExprReadonly = (input) => If(If(Const("readonly", input), ([_0, input2]) => If(Expr(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprReadonlyMapping(_0), input2]);
var ExprPipe = (input) => If(If(Const("|", input), ([_0, input2]) => If(Expr(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprPipeMapping(_0), input2]);
var GenericType = (input) => If(If(GenericParameters(input), ([_0, input2]) => If(Const("=", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericTypeMapping(_0), input2]);
var InferType = (input) => If(If(If(Const("infer", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(Const("extends", input3), ([_2, input4]) => If(Expr(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If(If(Const("infer", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [InferTypeMapping(_0), input2]);
var Type = (input) => If(If(InferType(input), ([_0, input2]) => [_0, input2], () => If(ExprPipe(input), ([_0, input2]) => [_0, input2], () => If(ExprReadonly(input), ([_0, input2]) => [_0, input2], () => If(Expr(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [TypeMapping(_0), input2]);
var PropertyKeyNumber = (input) => If(Number3(input), ([_0, input2]) => [PropertyKeyNumberMapping(_0), input2]);
var PropertyKeyIdent = (input) => If(Ident(input), ([_0, input2]) => [PropertyKeyIdentMapping(_0), input2]);
var PropertyKeyQuoted = (input) => If(String3(["'", '"'], input), ([_0, input2]) => [PropertyKeyQuotedMapping(_0), input2]);
var PropertyKeyIndex = (input) => If(If(Const("[", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(If(KeywordInteger(input4), ([_02, input5]) => [_02, input5], () => If(KeywordNumber(input4), ([_02, input5]) => [_02, input5], () => If(KeywordString(input4), ([_02, input5]) => [_02, input5], () => If(KeywordSymbol(input4), ([_02, input5]) => [_02, input5], () => [])))), ([_3, input5]) => If(Const("]", input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [PropertyKeyIndexMapping(_0), input2]);
var PropertyKey = (input) => If(If(PropertyKeyNumber(input), ([_0, input2]) => [_0, input2], () => If(PropertyKeyIdent(input), ([_0, input2]) => [_0, input2], () => If(PropertyKeyQuoted(input), ([_0, input2]) => [_0, input2], () => If(PropertyKeyIndex(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [PropertyKeyMapping(_0), input2]);
var Readonly2 = (input) => If(If(If(Const("readonly", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ReadonlyMapping(_0), input2]);
var Optional3 = (input) => If(If(If(Const("?", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [OptionalMapping(_0), input2]);
var Property = (input) => If(If(Readonly2(input), ([_0, input2]) => If(PropertyKey(input2), ([_1, input3]) => If(Optional3(input3), ([_2, input4]) => If(Const(":", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [PropertyMapping(_0), input2]);
var PropertyDelimiter = (input) => If(If(If(Const(",", input), ([_0, input2]) => If(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const(";", input), ([_0, input2]) => If(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const(",", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(Const("\n", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))))), ([_0, input2]) => [PropertyDelimiterMapping(_0), input2]);
var PropertyList_0 = (input, result = []) => If(If(Property(input), ([_0, input2]) => If(PropertyDelimiter(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => PropertyList_0(input2, [...result, _0]), () => [result, input]);
var PropertyList = (input) => If(If(PropertyList_0(input), ([_0, input2]) => If(If(If(Property(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [PropertyListMapping(_0), input2]);
var Properties = (input) => If(If(Const("{", input), ([_0, input2]) => If(PropertyList(input2), ([_1, input3]) => If(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PropertiesMapping(_0), input2]);
var _Object_2 = (input) => If(Properties(input), ([_0, input2]) => [_Object_Mapping(_0), input2]);
var ElementNamed = (input) => If(If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Const("readonly", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [_0, input2], () => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Const("readonly", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [ElementNamedMapping(_0), input2]);
var ElementReadonlyOptional = (input) => If(If(Const("readonly", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => If(Const("?", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [ElementReadonlyOptionalMapping(_0), input2]);
var ElementReadonly = (input) => If(If(Const("readonly", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ElementReadonlyMapping(_0), input2]);
var ElementOptional = (input) => If(If(Type(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ElementOptionalMapping(_0), input2]);
var ElementBase = (input) => If(If(ElementNamed(input), ([_0, input2]) => [_0, input2], () => If(ElementReadonlyOptional(input), ([_0, input2]) => [_0, input2], () => If(ElementReadonly(input), ([_0, input2]) => [_0, input2], () => If(ElementOptional(input), ([_0, input2]) => [_0, input2], () => If(Type(input), ([_0, input2]) => [_0, input2], () => []))))), ([_0, input2]) => [ElementBaseMapping(_0), input2]);
var Element = (input) => If(If(If(Const("...", input), ([_0, input2]) => If(ElementBase(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(ElementBase(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ElementMapping(_0), input2]);
var ElementList_0 = (input, result = []) => If(If(Element(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ElementList_0(input2, [...result, _0]), () => [result, input]);
var ElementList = (input) => If(If(ElementList_0(input), ([_0, input2]) => If(If(If(Element(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ElementListMapping(_0), input2]);
var _Tuple_ = (input) => If(If(Const("[", input), ([_0, input2]) => If(ElementList(input2), ([_1, input3]) => If(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_Tuple_Mapping(_0), input2]);
var ParameterReadonlyOptional = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Const("readonly", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [ParameterReadonlyOptionalMapping(_0), input2]);
var ParameterReadonly = (input) => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Const("readonly", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [ParameterReadonlyMapping(_0), input2]);
var ParameterOptional = (input) => If(If(Ident(input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => If(Const(":", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [ParameterOptionalMapping(_0), input2]);
var ParameterType = (input) => If(If(Ident(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [ParameterTypeMapping(_0), input2]);
var ParameterBase = (input) => If(If(ParameterReadonlyOptional(input), ([_0, input2]) => [_0, input2], () => If(ParameterReadonly(input), ([_0, input2]) => [_0, input2], () => If(ParameterOptional(input), ([_0, input2]) => [_0, input2], () => If(ParameterType(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [ParameterBaseMapping(_0), input2]);
var Parameter2 = (input) => If(If(If(Const("...", input), ([_0, input2]) => If(ParameterBase(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(ParameterBase(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ParameterMapping(_0), input2]);
var ParameterList_0 = (input, result = []) => If(If(Parameter2(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ParameterList_0(input2, [...result, _0]), () => [result, input]);
var ParameterList = (input) => If(If(ParameterList_0(input), ([_0, input2]) => If(If(If(Parameter2(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ParameterListMapping(_0), input2]);
var _Function_2 = (input) => If(If(Const("(", input), ([_0, input2]) => If(ParameterList(input2), ([_1, input3]) => If(Const(")", input3), ([_2, input4]) => If(Const("=>", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [_Function_Mapping(_0), input2]);
var _Constructor_ = (input) => If(If(Const("new", input), ([_0, input2]) => If(Const("(", input2), ([_1, input3]) => If(ParameterList(input3), ([_2, input4]) => If(Const(")", input4), ([_3, input5]) => If(Const("=>", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_Constructor_Mapping(_0), input2]);
var MappedReadonly = (input) => If(If(If(Const("+", input), ([_0, input2]) => If(Const("readonly", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("-", input), ([_0, input2]) => If(Const("readonly", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("readonly", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [MappedReadonlyMapping(_0), input2]);
var MappedOptional = (input) => If(If(If(Const("+", input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("-", input), ([_0, input2]) => If(Const("?", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const("?", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [MappedOptionalMapping(_0), input2]);
var MappedAs = (input) => If(If(If(Const("as", input), ([_0, input2]) => If(Type(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [MappedAsMapping(_0), input2]);
var _Mapped_ = (input) => If(If(Const("{", input), ([_0, input2]) => If(MappedReadonly(input2), ([_1, input3]) => If(Const("[", input3), ([_2, input4]) => If(Ident(input4), ([_3, input5]) => If(Const("in", input5), ([_4, input6]) => If(Type(input6), ([_5, input7]) => If(MappedAs(input7), ([_6, input8]) => If(Const("]", input8), ([_7, input9]) => If(MappedOptional(input9), ([_8, input10]) => If(Const(":", input10), ([_9, input11]) => If(Type(input11), ([_10, input12]) => If(OptionalSemiColon(input12), ([_11, input13]) => If(Const("}", input13), ([_12, input14]) => [[_0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12], input14]))))))))))))), ([_0, input2]) => [_Mapped_Mapping(_0), input2]);
var Reference = (input) => If(Ident(input), ([_0, input2]) => [ReferenceMapping(_0), input2]);
var WithBigInt = (input) => If(BigInt3(input), ([_0, input2]) => [WithBigIntMapping(_0), input2]);
var WithNumber = (input) => If(Number3(input), ([_0, input2]) => [WithNumberMapping(_0), input2]);
var WithBoolean = (input) => If(If(Const("true", input), ([_0, input2]) => [_0, input2], () => If(Const("false", input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [WithBooleanMapping(_0), input2]);
var WithString = (input) => If(String3(['"', "'"], input), ([_0, input2]) => [WithStringMapping(_0), input2]);
var WithNull = (input) => If(Const("null", input), ([_0, input2]) => [WithNullMapping(_0), input2]);
var WithUndefined = (input) => If(Const("undefined", input), ([_0, input2]) => [WithUndefinedMapping(_0), input2]);
var WithProperty = (input) => If(If(PropertyKey(input), ([_0, input2]) => If(Const(":", input2), ([_1, input3]) => If(WithValue(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithPropertyMapping(_0), input2]);
var WithPropertyList_0 = (input, result = []) => If(If(WithProperty(input), ([_0, input2]) => If(PropertyDelimiter(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => WithPropertyList_0(input2, [...result, _0]), () => [result, input]);
var WithPropertyList = (input) => If(If(WithPropertyList_0(input), ([_0, input2]) => If(If(If(WithProperty(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [WithPropertyListMapping(_0), input2]);
var WithObject = (input) => If(If(Const("{", input), ([_0, input2]) => If(WithPropertyList(input2), ([_1, input3]) => If(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithObjectMapping(_0), input2]);
var WithElementList_0 = (input, result = []) => If(If(WithValue(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => WithElementList_0(input2, [...result, _0]), () => [result, input]);
var WithElementList = (input) => If(If(WithElementList_0(input), ([_0, input2]) => If(If(If(WithValue(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [WithElementListMapping(_0), input2]);
var WithArray = (input) => If(If(Const("[", input), ([_0, input2]) => If(WithElementList(input2), ([_1, input3]) => If(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithArrayMapping(_0), input2]);
var WithValue = (input) => If(If(WithBigInt(input), ([_0, input2]) => [_0, input2], () => If(WithNumber(input), ([_0, input2]) => [_0, input2], () => If(WithBoolean(input), ([_0, input2]) => [_0, input2], () => If(WithString(input), ([_0, input2]) => [_0, input2], () => If(WithNull(input), ([_0, input2]) => [_0, input2], () => If(WithUndefined(input), ([_0, input2]) => [_0, input2], () => If(WithObject(input), ([_0, input2]) => [_0, input2], () => If(WithArray(input), ([_0, input2]) => [_0, input2], () => [])))))))), ([_0, input2]) => [WithValueMapping(_0), input2]);
var PatternBigInt = (input) => If(Const("-?(?:0|[1-9][0-9]*)n", input), ([_0, input2]) => [PatternBigIntMapping(_0), input2]);
var PatternString = (input) => If(Const(".*", input), ([_0, input2]) => [PatternStringMapping(_0), input2]);
var PatternNumber = (input) => If(Const("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?", input), ([_0, input2]) => [PatternNumberMapping(_0), input2]);
var PatternInteger = (input) => If(Const("-?(?:0|[1-9][0-9]*)", input), ([_0, input2]) => [PatternIntegerMapping(_0), input2]);
var PatternNever = (input) => If(Const("(?!)", input), ([_0, input2]) => [PatternNeverMapping(_0), input2]);
var PatternText = (input) => If(Until_1(["-?(?:0|[1-9][0-9]*)n", ".*", "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?", "-?(?:0|[1-9][0-9]*)", "(?!)", "(", ")", "$", "|"], input), ([_0, input2]) => [PatternTextMapping(_0), input2]);
var PatternBase = (input) => If(If(PatternBigInt(input), ([_0, input2]) => [_0, input2], () => If(PatternString(input), ([_0, input2]) => [_0, input2], () => If(PatternNumber(input), ([_0, input2]) => [_0, input2], () => If(PatternInteger(input), ([_0, input2]) => [_0, input2], () => If(PatternNever(input), ([_0, input2]) => [_0, input2], () => If(PatternGroup(input), ([_0, input2]) => [_0, input2], () => If(PatternText(input), ([_0, input2]) => [_0, input2], () => []))))))), ([_0, input2]) => [PatternBaseMapping(_0), input2]);
var PatternGroup = (input) => If(If(Const("(", input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => If(Const(")", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PatternGroupMapping(_0), input2]);
var PatternUnion = (input) => If(If(If(PatternTerm(input), ([_0, input2]) => If(Const("|", input2), ([_1, input3]) => If(PatternUnion(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If(If(PatternTerm(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [PatternUnionMapping(_0), input2]);
var PatternTerm = (input) => If(If(PatternBase(input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [PatternTermMapping(_0), input2]);
var PatternBody = (input) => If(If(PatternUnion(input), ([_0, input2]) => [_0, input2], () => If(PatternTerm(input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [PatternBodyMapping(_0), input2]);
var Pattern = (input) => If(If(Const("^", input), ([_0, input2]) => If(PatternBody(input2), ([_1, input3]) => If(Const("$", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PatternMapping(_0), input2]);
var InterfaceDeclarationHeritageList_0 = (input, result = []) => If(If(Type(input), ([_0, input2]) => If(Const(",", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => InterfaceDeclarationHeritageList_0(input2, [...result, _0]), () => [result, input]);
var InterfaceDeclarationHeritageList = (input) => If(If(InterfaceDeclarationHeritageList_0(input), ([_0, input2]) => If(If(If(Type(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [InterfaceDeclarationHeritageListMapping(_0), input2]);
var InterfaceDeclarationHeritage = (input) => If(If(If(Const("extends", input), ([_0, input2]) => If(InterfaceDeclarationHeritageList(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [InterfaceDeclarationHeritageMapping(_0), input2]);
var InterfaceDeclarationGeneric = (input) => If(If(Const("interface", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(GenericParameters(input3), ([_2, input4]) => If(InterfaceDeclarationHeritage(input4), ([_3, input5]) => If(Properties(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [InterfaceDeclarationGenericMapping(_0), input2]);
var InterfaceDeclaration = (input) => If(If(Const("interface", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(InterfaceDeclarationHeritage(input3), ([_2, input4]) => If(Properties(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [InterfaceDeclarationMapping(_0), input2]);
var TypeAliasDeclarationGeneric = (input) => If(If(Const("type", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(GenericParameters(input3), ([_2, input4]) => If(Const("=", input4), ([_3, input5]) => If(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [TypeAliasDeclarationGenericMapping(_0), input2]);
var TypeAliasDeclaration = (input) => If(If(Const("type", input), ([_0, input2]) => If(Ident(input2), ([_1, input3]) => If(Const("=", input3), ([_2, input4]) => If(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [TypeAliasDeclarationMapping(_0), input2]);
var ExportKeyword = (input) => If(If(If(Const("export", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExportKeywordMapping(_0), input2]);
var ModuleDeclarationDelimiter = (input) => If(If(If(Const(";", input), ([_0, input2]) => If(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If(If(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If(If(Const("\n", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [ModuleDeclarationDelimiterMapping(_0), input2]);
var ModuleDeclarationList_0 = (input, result = []) => If(If(ModuleDeclaration(input), ([_0, input2]) => If(ModuleDeclarationDelimiter(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ModuleDeclarationList_0(input2, [...result, _0]), () => [result, input]);
var ModuleDeclarationList = (input) => If(If(ModuleDeclarationList_0(input), ([_0, input2]) => If(If(If(ModuleDeclaration(input2), ([_02, input3]) => [[_02], input3]), ([_02, input3]) => [_02, input3], () => If([[], input2], ([_02, input3]) => [_02, input3], () => [])), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ModuleDeclarationListMapping(_0), input2]);
var ModuleDeclaration = (input) => If(If(ExportKeyword(input), ([_0, input2]) => If(If(InterfaceDeclarationGeneric(input2), ([_02, input3]) => [_02, input3], () => If(InterfaceDeclaration(input2), ([_02, input3]) => [_02, input3], () => If(TypeAliasDeclarationGeneric(input2), ([_02, input3]) => [_02, input3], () => If(TypeAliasDeclaration(input2), ([_02, input3]) => [_02, input3], () => [])))), ([_1, input3]) => If(OptionalSemiColon(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [ModuleDeclarationMapping(_0), input2]);
var Module = (input) => If(If(ModuleDeclaration(input), ([_0, input2]) => If(ModuleDeclarationList(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ModuleMapping(_0), input2]);
var Script = (input) => If(If(Module(input), ([_0, input2]) => [_0, input2], () => If(GenericType(input), ([_0, input2]) => [_0, input2], () => If(Type(input), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [ScriptMapping(_0), input2]);

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/patterns/template.mjs
function ParseTemplateIntoTypes(template) {
  const parsed = TemplateLiteralTypes(`\`${template}\``);
  const result = guard_exports.IsEqual(parsed.length, 2) ? parsed[0] : Unreachable();
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/template_literal/encode.mjs
function JoinString(input) {
  return input.join("|");
}
function UnwrapTemplateLiteralPattern(pattern) {
  return pattern.slice(1, pattern.length - 1);
}
function EncodeLiteral(value, right, pattern) {
  return EncodeTypes(right, `${pattern}${value}`);
}
function EncodeBigInt(right, pattern) {
  return EncodeTypes(right, `${pattern}${BigIntPattern}`);
}
function EncodeInteger(right, pattern) {
  return EncodeTypes(right, `${pattern}${IntegerPattern}`);
}
function EncodeNumber(right, pattern) {
  return EncodeTypes(right, `${pattern}${NumberPattern}`);
}
function EncodeBoolean(right, pattern) {
  return EncodeType(Union([Literal("false"), Literal("true")]), right, pattern);
}
function EncodeString(right, pattern) {
  return EncodeTypes(right, `${pattern}${StringPattern}`);
}
function EncodeTemplateLiteral(templatePattern, right, pattern) {
  return EncodeTypes(right, `${pattern}${UnwrapTemplateLiteralPattern(templatePattern)}`);
}
function EncodeTemplateLiteralDeferred(types, right, pattern) {
  const templateLiteral = TemplateLiteralAction(types, {});
  const result = EncodeType(templateLiteral, right, pattern);
  return result;
}
function EncodeEnum(values, right, pattern) {
  const evaluated = EvaluateEnum(values);
  return EncodeType(evaluated, right, pattern);
}
function EncodeUnion(types, right, pattern, result = []) {
  return guard_exports.ShiftLeft(types, (head, tail) => EncodeUnion(tail, right, pattern, [...result, EncodeType(head, [], "")]), () => EncodeTypes(right, `${pattern}(${JoinString(result)})`));
}
function EncodeType(type, right, pattern) {
  return IsEnum2(type) ? EncodeEnum(type.enum, right, pattern) : IsInteger2(type) ? EncodeInteger(right, pattern) : IsLiteral(type) ? EncodeLiteral(type.const, right, pattern) : IsBigInt2(type) ? EncodeBigInt(right, pattern) : IsBoolean3(type) ? EncodeBoolean(right, pattern) : IsNumber3(type) ? EncodeNumber(right, pattern) : IsString3(type) ? EncodeString(right, pattern) : IsTemplateLiteral(type) ? EncodeTemplateLiteral(type.pattern, right, pattern) : IsTemplateLiteralDeferred(type) ? EncodeTemplateLiteralDeferred(type.parameters[0], right, pattern) : IsUnion(type) ? EncodeUnion(type.anyOf, right, pattern) : NeverPattern;
}
function EncodeTypes(types, pattern) {
  return guard_exports.ShiftLeft(types, (left, right) => EncodeType(left, right, pattern), () => pattern);
}
function EncodePattern(types) {
  const encoded = EncodeTypes(types, "");
  const result = `^${encoded}$`;
  return result;
}
function TemplateLiteralEncode(types) {
  const pattern = EncodePattern(types);
  const result = TemplateLiteralCreate(pattern);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/template_literal/instantiate.mjs
function TemplateLiteralAction(types, options) {
  const result = CanInstantiate(types) ? memory_exports.Update(TemplateLiteralEncode(types), {}, options) : TemplateLiteralDeferred(types, options);
  return result;
}
function TemplateLiteralInstantiate(context, state, types, options) {
  const instantiatedTypes = InstantiateTypes(context, state, types);
  return TemplateLiteralAction(instantiatedTypes, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/template_literal.mjs
function TemplateLiteralDeferred(types, options = {}) {
  return Deferred("TemplateLiteral", [types], options);
}
function IsTemplateLiteralDeferred(value) {
  return IsSchema2(value) && guard_exports.HasPropertyKey(value, "action") && guard_exports.IsEqual(value.action, "TemplateLiteral");
}
function TemplateLiteralFromTypes(types) {
  return TemplateLiteralAction(types, {});
}
function TemplateLiteralFromString(template) {
  const types = ParseTemplateIntoTypes(template);
  return TemplateLiteralFromTypes(types);
}
function TemplateLiteral2(input, options = {}) {
  const type = guard_exports.IsString(input) ? TemplateLiteralFromString(input) : TemplateLiteralFromTypes(input);
  return memory_exports.Update(type, {}, options);
}
function IsTemplateLiteral(value) {
  return IsKind(value, "TemplateLiteral");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/result.mjs
var result_exports = {};
__export(result_exports, {
  ExtendsFalse: () => ExtendsFalse,
  ExtendsTrue: () => ExtendsTrue,
  ExtendsUnion: () => ExtendsUnion,
  IsExtendsFalse: () => IsExtendsFalse,
  IsExtendsTrue: () => IsExtendsTrue,
  IsExtendsTrueLike: () => IsExtendsTrueLike,
  IsExtendsUnion: () => IsExtendsUnion,
  Match: () => Match4
});
function ExtendsUnion(inferred) {
  return memory_exports.Create({ ["~kind"]: "ExtendsUnion" }, { inferred });
}
function IsExtendsUnion(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "inferred") && guard_exports.IsEqual(value["~kind"], "ExtendsUnion") && guard_exports.IsObject(value.inferred);
}
function ExtendsTrue(inferred) {
  return memory_exports.Create({ ["~kind"]: "ExtendsTrue" }, { inferred });
}
function IsExtendsTrue(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "inferred") && guard_exports.IsEqual(value["~kind"], "ExtendsTrue") && guard_exports.IsObject(value.inferred);
}
function ExtendsFalse() {
  return memory_exports.Create({ ["~kind"]: "ExtendsFalse" }, {});
}
function IsExtendsFalse(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.IsEqual(value["~kind"], "ExtendsFalse");
}
function IsExtendsTrueLike(value) {
  return IsExtendsUnion(value) || IsExtendsTrue(value);
}
function Match4(result, true_, false_) {
  return IsExtendsTrueLike(result) ? true_(result.inferred) : false_();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/extends_right.mjs
function ExtendsRightInfer(inferred, name, left, right) {
  return Match4(ExtendsLeft(inferred, left, right), (checkInferred) => ExtendsTrue(memory_exports.Assign(memory_exports.Assign(inferred, checkInferred), { [name]: left })), () => ExtendsFalse());
}
function ExtendsRightAny(inferred, _left) {
  return ExtendsTrue(inferred);
}
function ExtendsRightDependent(inferred, left, if_, then_, else_) {
  return Match4(ExtendsLeft(inferred, left, if_), (inferred2) => Match4(ExtendsLeft(inferred2, left, then_), (inferred3) => ExtendsTrue(inferred3), () => ExtendsFalse()), () => Match4(ExtendsLeft(inferred, left, else_), (inferred2) => ExtendsTrue(inferred2), () => ExtendsFalse()));
}
function ExtendsRightEnum(inferred, left, right) {
  const evaluated = EvaluateEnum(right);
  return ExtendsLeft(inferred, left, evaluated);
}
function ExtendsRightIntersect(inferred, left, right) {
  return guard_exports.ShiftLeft(right, (head, tail) => Match4(ExtendsLeft(inferred, left, head), (inferred2) => ExtendsRightIntersect(inferred2, left, tail), () => ExtendsFalse()), () => ExtendsTrue(inferred));
}
function ExtendsRightTemplateLiteral(inferred, left, right) {
  const evaluated = EvaluateTemplateLiteral(right);
  return ExtendsLeft(inferred, left, evaluated);
}
function ExtendsRightUnion(inferred, left, right) {
  return guard_exports.ShiftLeft(right, (head, tail) => Match4(ExtendsLeft(inferred, left, head), (inferred2) => ExtendsTrue(inferred2), () => ExtendsRightUnion(inferred, left, tail)), () => ExtendsFalse());
}
function ExtendsRight(inferred, left, right) {
  return IsAny(right) ? ExtendsRightAny(inferred, left) : IsDependent(right) ? ExtendsRightDependent(inferred, left, right.if, right.then, right.else) : IsEnum2(right) ? ExtendsRightEnum(inferred, left, right.enum) : IsInfer(right) ? ExtendsRightInfer(inferred, right.name, left, right.extends) : IsIntersect(right) ? ExtendsRightIntersect(inferred, left, right.allOf) : IsTemplateLiteral(right) ? ExtendsRightTemplateLiteral(inferred, left, right.pattern) : IsUnion(right) ? ExtendsRightUnion(inferred, left, right.anyOf) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/any.mjs
function ExtendsAny(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsUnion(inferred);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/array.mjs
function ExtendsImmutable(left, right) {
  const isImmutableLeft = IsImmutable(left);
  const isImmutableRight = IsImmutable(right);
  return isImmutableLeft && isImmutableRight ? true : !isImmutableLeft && isImmutableRight ? true : isImmutableLeft && !isImmutableRight ? false : true;
}
function ExtendsArray(inferred, arrayLeft, left, right) {
  return IsArray2(right) ? ExtendsImmutable(arrayLeft, right) ? ExtendsLeft(inferred, left, right.items) : ExtendsFalse() : ExtendsRight(inferred, arrayLeft, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/bigint.mjs
function ExtendsBigInt(inferred, left, right) {
  return IsBigInt2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/boolean.mjs
function ExtendsBoolean(inferred, left, right) {
  return IsBoolean3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/parameters.mjs
function ParameterCompare(inferred, left, leftRest, right, rightRest) {
  const checkLeft = IsInfer(right) ? left : right;
  const checkRight = IsInfer(right) ? right : left;
  const isLeftOptional = IsOptional(left);
  const isRightOptional = IsOptional(right);
  return !isLeftOptional && isRightOptional ? ExtendsFalse() : Match4(ExtendsLeft(inferred, checkLeft, checkRight), (inferred2) => ExtendsParameters(inferred2, leftRest, rightRest), () => ExtendsFalse());
}
function ParameterRight(inferred, left, leftRest, rightRest) {
  return guard_exports.ShiftLeft(rightRest, (head, tail) => ParameterCompare(inferred, left, leftRest, head, tail), () => IsOptional(left) ? ExtendsTrue(inferred) : ExtendsFalse());
}
function ParametersLeft(inferred, left, rightRest) {
  return guard_exports.ShiftLeft(left, (head, tail) => ParameterRight(inferred, head, tail, rightRest), () => ExtendsTrue(inferred));
}
function ExtendsParameters(inferred, left, right) {
  return ParametersLeft(inferred, left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/return_type.mjs
function ExtendsReturnType(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : ExtendsLeft(inferred, left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/constructor.mjs
function ExtendsConstructor(inferred, parameters, returnType, right) {
  return IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : IsConstructor2(right) ? Match4(ExtendsParameters(inferred, parameters, right["parameters"]), (inferred2) => ExtendsReturnType(inferred2, returnType, right["instanceType"]), () => ExtendsFalse()) : ExtendsFalse();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/dependent.mjs
function ExtendsDependent(inferred, if_, then_, else_, right) {
  return Match4(ExtendsLeft(inferred, if_, right), () => ExtendsLeft(inferred, then_, right), () => ExtendsLeft(inferred, else_, right));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/enum.mjs
function ExtendsEnum(inferred, left, right) {
  const evaluated = EvaluateEnum(left);
  return ExtendsLeft(inferred, evaluated, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/function.mjs
function ExtendsFunction(inferred, parameters, returnType, right) {
  return IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : IsFunction2(right) ? Match4(ExtendsParameters(inferred, parameters, right["parameters"]), (inferred2) => ExtendsReturnType(inferred2, returnType, right["returnType"]), () => ExtendsFalse()) : ExtendsFalse();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/integer.mjs
function ExtendsInteger(inferred, left, right) {
  return IsInteger2(right) ? ExtendsTrue(inferred) : IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/intersect.mjs
function ExtendsIntersect(inferred, left, right) {
  const evaluated = EvaluateIntersect(left);
  return ExtendsLeft(inferred, evaluated, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/literal.mjs
function ExtendsLiteralValue(inferred, left, right) {
  return left === right ? ExtendsTrue(inferred) : ExtendsFalse();
}
function ExtendsLiteralBigInt(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsBigInt2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralBoolean(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsBoolean3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralNumber(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteralString(inferred, left, right) {
  return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsString3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
}
function ExtendsLiteral(inferred, left, right) {
  return guard_exports.IsBigInt(left.const) ? ExtendsLiteralBigInt(inferred, left.const, right) : guard_exports.IsBoolean(left.const) ? ExtendsLiteralBoolean(inferred, left.const, right) : guard_exports.IsNumber(left.const) ? ExtendsLiteralNumber(inferred, left.const, right) : guard_exports.IsString(left.const) ? ExtendsLiteralString(inferred, left.const, right) : Unreachable();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/never.mjs
function ExtendsNever(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : ExtendsTrue(inferred);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/null.mjs
function ExtendsNull(inferred, left, right) {
  return IsNull2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/number.mjs
function ExtendsNumber(inferred, left, right) {
  return IsNumber3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/object.mjs
function ExtendsPropertyOptional(inferred, left, right) {
  return IsOptional(left) ? IsOptional(right) ? ExtendsTrue(inferred) : ExtendsFalse() : ExtendsTrue(inferred);
}
function ExtendsProperty(inferred, left, right) {
  return (
    // Right TInfer<TNever> is TExtendsFalse
    IsInfer(right) && IsNever(right.extends) ? ExtendsFalse() : Match4(ExtendsLeft(inferred, left, right), (inferred2) => ExtendsPropertyOptional(inferred2, left, right), () => ExtendsFalse())
  );
}
function ExtractInferredProperties(keys, properties) {
  return keys.reduce((result, key) => {
    return key in properties ? IsExtendsTrueLike(properties[key]) ? { ...result, ...properties[key].inferred } : Unreachable() : Unreachable();
  }, {});
}
function ExtendsPropertiesComparer(inferred, left, right) {
  const properties = {};
  for (const rightKey of guard_exports.Keys(right)) {
    properties[rightKey] = rightKey in left ? ExtendsProperty({}, left[rightKey], right[rightKey]) : IsOptional(right[rightKey]) ? IsInfer(right[rightKey]) ? ExtendsTrue(memory_exports.Assign(inferred, { [right[rightKey].name]: right[rightKey].extends })) : ExtendsTrue(inferred) : ExtendsFalse();
  }
  const checked = guard_exports.Values(properties).every((result) => IsExtendsTrueLike(result));
  const extracted = checked ? ExtractInferredProperties(guard_exports.Keys(properties), properties) : {};
  return checked ? ExtendsTrue(extracted) : ExtendsFalse();
}
function ExtendsProperties(inferred, left, right) {
  const compared = ExtendsPropertiesComparer(inferred, left, right);
  return IsExtendsTrueLike(compared) ? ExtendsTrue(memory_exports.Assign(inferred, compared.inferred)) : ExtendsFalse();
}
function ExtendsObjectToObject(inferred, left, right) {
  return ExtendsProperties(inferred, left, right);
}
function RecordMergeInferred(left, right) {
  return guard_exports.Keys(right).reduce((result, key) => {
    return {
      ...result,
      [key]: guard_exports.HasPropertyKey(left, key) ? IsUnion(result[key]) ? Union([...result[key].anyOf, right[key]]) : Union([left[key], right[key]]) : right[key]
    };
  }, left);
}
function ExtendsRecordComparer(properties, keys, type, result) {
  return guard_exports.ShiftLeft(keys, (left, right) => Match4(ExtendsLeft({}, properties[left], type), (inferred) => ExtendsRecordComparer(properties, right, type, RecordMergeInferred(result, inferred)), () => ExtendsFalse()), () => ExtendsTrue(result));
}
function ExtendsObjectToRecord(inferred, properties, _pattern, value) {
  const keys = guard_exports.Keys(properties);
  const result = ExtendsRecordComparer(properties, keys, value, inferred);
  return result;
}
function ExtendsObject(inferred, left, right) {
  return IsRecord(right) ? ExtendsObjectToRecord(inferred, left, RecordPattern(right), RecordValue(right)) : IsObject2(right) ? ExtendsObjectToObject(inferred, left, right.properties) : ExtendsRight(inferred, _Object_(left), right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/record.mjs
function FromObject4(inferred, properties) {
  return guard_exports.IsEqual(guard_exports.Keys(properties).length, 0) ? ExtendsTrue(inferred) : ExtendsFalse();
}
function FromRecord(inferred, _leftKey, leftValue, _rightKey, rightValue) {
  return ExtendsLeft(inferred, leftValue, rightValue);
}
function ExtendsRecord(inferred, leftPattern, leftValue, right) {
  return IsRecord(right) ? FromRecord(inferred, RecordPatternToType(leftPattern), leftValue, RecordPatternToType(RecordPattern(right)), RecordValue(right)) : IsObject2(right) ? FromObject4(inferred, right.properties) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/string.mjs
function ExtendsString(inferred, left, right) {
  return IsString3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/symbol.mjs
function ExtendsSymbol(inferred, left, right) {
  return IsSymbol2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/template_literal.mjs
function ExtendsTemplateLiteral(inferred, left, right) {
  const evaluated = EvaluateTemplateLiteral(left);
  return ExtendsLeft(inferred, evaluated, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/inference.mjs
function Inferrable(name, type) {
  return memory_exports.Create({ "~kind": "Inferrable" }, { name, type }, {});
}
function IsInferable(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "name") && guard_exports.HasPropertyKey(value, "type") && guard_exports.IsEqual(value["~kind"], "Inferrable") && guard_exports.IsString(value.name) && guard_exports.IsObject(value.type);
}
function TryRestInferable(type) {
  return IsRest(type) ? IsInfer(type.items) ? IsArray2(type.items.extends) ? Inferrable(type.items.name, type.items.extends.items) : IsUnknown(type.items.extends) ? Inferrable(type.items.name, type.items.extends) : void 0 : Unreachable() : void 0;
}
function TryInferable(type) {
  return IsInfer(type) ? Inferrable(type.name, type.extends) : void 0;
}
function TryInferResults(rest, right, result = []) {
  return guard_exports.ShiftLeft(rest, (head, tail) => Match4(ExtendsLeft({}, head, right), () => TryInferResults(tail, right, [...result, head]), () => void 0), () => result);
}
function InferTupleResult(inferred, name, left, right) {
  const results = TryInferResults(left, right);
  return guard_exports.IsArray(results) ? ExtendsTrue(memory_exports.Assign(inferred, { [name]: Tuple(results) })) : ExtendsFalse();
}
function InferUnionResult(inferred, name, left, right) {
  const results = TryInferResults(left, right);
  return guard_exports.IsArray(results) ? ExtendsTrue(memory_exports.Assign(inferred, { [name]: Union(results) })) : ExtendsFalse();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/tuple.mjs
function Reverse(types) {
  return [...types].reverse();
}
function ApplyReverse(types, reversed) {
  return reversed ? Reverse(types) : types;
}
function Reversed(types) {
  const first = types.length > 0 ? types[0] : void 0;
  const inferrable = IsSchema2(first) ? TryRestInferable(first) : void 0;
  return IsSchema2(inferrable);
}
function ElementsCompare(inferred, reversed, left, leftRest, right, rightRest) {
  return Match4(ExtendsLeft(inferred, left, right), (checkInferred) => Elements(checkInferred, reversed, leftRest, rightRest), () => ExtendsFalse());
}
function ElementsLeft(inferred, reversed, leftRest, right, rightRest) {
  const inferable = TryRestInferable(right);
  return (
    // Rest Inferrable Right Means we delegate to TInferTupleResult to Generate a Result
    IsInferable(inferable) ? InferTupleResult(inferred, inferable["name"], ApplyReverse(leftRest, reversed), inferable["type"]) : guard_exports.ShiftLeft(leftRest, (head, tail) => ElementsCompare(inferred, reversed, head, tail, right, rightRest), () => ExtendsFalse())
  );
}
function ElementsRight(inferred, reversed, leftRest, rightRest) {
  return guard_exports.ShiftLeft(rightRest, (head, tail) => ElementsLeft(inferred, reversed, leftRest, head, tail), () => guard_exports.IsEqual(leftRest.length, 0) ? ExtendsTrue(inferred) : ExtendsFalse());
}
function Elements(inferred, reversed, leftRest, rightRest) {
  return ElementsRight(inferred, reversed, leftRest, rightRest);
}
function ExtendsTupleToTuple(inferred, left, right) {
  const instantiatedRight = InstantiateElements(inferred, State([], []), right);
  const reversed = Reversed(instantiatedRight);
  return Elements(inferred, reversed, ApplyReverse(left, reversed), ApplyReverse(instantiatedRight, reversed));
}
function ExtendsTupleToArray(inferred, left, right) {
  const inferrable = TryInferable(right);
  return IsInferable(inferrable) ? InferUnionResult(inferred, inferrable["name"], left, inferrable["type"]) : guard_exports.ShiftLeft(left, (head, tail) => Match4(ExtendsLeft(inferred, head, right), (inferred2) => ExtendsTupleToArray(inferred2, tail, right), () => ExtendsFalse()), () => ExtendsTrue(inferred));
}
function ExtendsTuple(inferred, left, right) {
  const instantiatedLeft = InstantiateElements(inferred, State([], []), left);
  return IsTuple(right) ? ExtendsTupleToTuple(inferred, instantiatedLeft, right.items) : IsArray2(right) ? ExtendsTupleToArray(inferred, instantiatedLeft, right.items) : ExtendsRight(inferred, Tuple(instantiatedLeft), right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/undefined.mjs
function ExtendsUndefined(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : IsUndefined2(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/union.mjs
function ExtendsUnionSome(inferred, type, unionTypes) {
  return guard_exports.ShiftLeft(unionTypes, (head, tail) => Match4(ExtendsLeft(inferred, type, head), (inferred2) => ExtendsTrue(inferred2), () => ExtendsUnionSome(inferred, type, tail)), () => ExtendsFalse());
}
function ExtendsUnionLeft(inferred, left, right) {
  return guard_exports.ShiftLeft(left, (head, tail) => Match4(ExtendsUnionSome(inferred, head, right), (inferred2) => ExtendsUnionLeft(inferred2, tail, right), () => ExtendsFalse()), () => ExtendsTrue(inferred));
}
function ExtendsUnion2(inferred, left, right) {
  const inferrable = TryInferable(right);
  return IsInferable(inferrable) ? InferUnionResult(inferred, inferrable.name, left, inferrable.type) : IsUnion(right) ? ExtendsUnionLeft(inferred, left, right.anyOf) : ExtendsUnionLeft(inferred, left, [right]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/unknown.mjs
function ExtendsUnknown(inferred, left, right) {
  return IsInfer(right) ? ExtendsRight(inferred, left, right) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/void.mjs
function ExtendsVoid(inferred, left, right) {
  return IsVoid(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/extends_left.mjs
function ExtendsLeft(inferred, left, right) {
  return IsAny(left) ? ExtendsAny(inferred, left, right) : IsArray2(left) ? ExtendsArray(inferred, left, left.items, right) : IsBigInt2(left) ? ExtendsBigInt(inferred, left, right) : IsBoolean3(left) ? ExtendsBoolean(inferred, left, right) : IsConstructor2(left) ? ExtendsConstructor(inferred, left.parameters, left.instanceType, right) : IsDependent(left) ? ExtendsDependent(inferred, left.if, left.then, left.else, right) : IsEnum2(left) ? ExtendsEnum(inferred, left.enum, right) : IsFunction2(left) ? ExtendsFunction(inferred, left.parameters, left.returnType, right) : IsInteger2(left) ? ExtendsInteger(inferred, left, right) : IsIntersect(left) ? ExtendsIntersect(inferred, left.allOf, right) : IsLiteral(left) ? ExtendsLiteral(inferred, left, right) : IsNever(left) ? ExtendsNever(inferred, left, right) : IsNull2(left) ? ExtendsNull(inferred, left, right) : IsNumber3(left) ? ExtendsNumber(inferred, left, right) : IsObject2(left) ? ExtendsObject(inferred, left.properties, right) : IsRecord(left) ? ExtendsRecord(inferred, RecordPattern(left), RecordValue(left), right) : IsString3(left) ? ExtendsString(inferred, left, right) : IsSymbol2(left) ? ExtendsSymbol(inferred, left, right) : IsTemplateLiteral(left) ? ExtendsTemplateLiteral(inferred, left.pattern, right) : IsTuple(left) ? ExtendsTuple(inferred, left.items, right) : IsUndefined2(left) ? ExtendsUndefined(inferred, left, right) : IsUnion(left) ? ExtendsUnion2(inferred, left.anyOf, right) : IsUnknown(left) ? ExtendsUnknown(inferred, left, right) : IsVoid(left) ? ExtendsVoid(inferred, left, right) : ExtendsFalse();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/interface/instantiate.mjs
function InterfaceOperation(heritage, properties) {
  const result = EvaluateIntersect([...heritage, _Object_(properties)]);
  return result;
}
function InterfaceAction(heritage, properties, options) {
  const result = CanInstantiate(heritage) ? memory_exports.Update(InterfaceOperation(heritage, properties), {}, options) : InterfaceDeferred(heritage, properties, options);
  return result;
}
function InterfaceInstantiate(context, state, heritage, properties, options) {
  const instantiatedHeritage = InstantiateTypes(context, state, heritage);
  const instantiatedProperties = InstantiateProperties(context, state, properties);
  return InterfaceAction(instantiatedHeritage, instantiatedProperties, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/interface.mjs
function InterfaceDeferred(heritage, properties, options = {}) {
  return Deferred("Interface", [heritage, properties], options);
}
function IsInterfaceDeferred(value) {
  return IsSchema2(value) && guard_exports.HasPropertyKey(value, "action") && guard_exports.IsEqual(value.action, "Interface");
}
function Interface(heritage, properties, options = {}) {
  return InterfaceAction(heritage, properties, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/cyclic/check.mjs
function FromRef(stack, context, ref) {
  return stack.includes(ref) ? true : FromType3([...stack, ref], context, context[ref]);
}
function FromProperties(stack, context, properties) {
  const types = PropertyValues(properties);
  return FromTypes2(stack, context, types);
}
function FromTypes2(stack, context, types) {
  return guard_exports.ShiftLeft(types, (left, right) => FromType3(stack, context, left) ? true : FromTypes2(stack, context, right), () => false);
}
function FromType3(stack, context, type) {
  return IsRef2(type) ? FromRef(stack, context, type.$ref) : IsArray2(type) ? FromType3(stack, context, type.items) : IsConstructor2(type) ? FromTypes2(stack, context, [...type.parameters, type.instanceType]) : IsFunction2(type) ? FromTypes2(stack, context, [...type.parameters, type.returnType]) : IsInterfaceDeferred(type) ? FromProperties(stack, context, type.parameters[1]) : IsIntersect(type) ? FromTypes2(stack, context, type.allOf) : IsObject2(type) ? FromProperties(stack, context, type.properties) : IsUnion(type) ? FromTypes2(stack, context, type.anyOf) : IsTuple(type) ? FromTypes2(stack, context, type.items) : IsRecord(type) ? FromType3(stack, context, RecordValue(type)) : false;
}
function CyclicCheck(stack, context, type) {
  const result = FromType3(stack, context, type);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/cyclic/candidates.mjs
function ResolveCandidateKeys(context, keys) {
  return keys.reduce((result, left) => {
    return CyclicCheck([left], context, context[left]) ? [...result, left] : result;
  }, []);
}
function CyclicCandidates(context) {
  const keys = PropertyKeys(context);
  const result = ResolveCandidateKeys(context, keys);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/cyclic/dependencies.mjs
function FromRef2(context, ref, result) {
  return result.includes(ref) ? result : ref in context ? FromType4(context, context[ref], [...result, ref]) : Unreachable();
}
function FromProperties2(context, properties, result) {
  const types = PropertyValues(properties);
  return FromTypes3(context, types, result);
}
function FromTypes3(context, types, result) {
  return types.reduce((result2, left) => {
    return FromType4(context, left, result2);
  }, result);
}
function FromType4(context, type, result) {
  return IsRef2(type) ? FromRef2(context, type.$ref, result) : IsArray2(type) ? FromType4(context, type.items, result) : IsConstructor2(type) ? FromTypes3(context, [...type.parameters, type.instanceType], result) : IsFunction2(type) ? FromTypes3(context, [...type.parameters, type.returnType], result) : IsInterfaceDeferred(type) ? FromProperties2(context, type.parameters[1], result) : IsIntersect(type) ? FromTypes3(context, type.allOf, result) : IsObject2(type) ? FromProperties2(context, type.properties, result) : IsUnion(type) ? FromTypes3(context, type.anyOf, result) : IsTuple(type) ? FromTypes3(context, type.items, result) : IsRecord(type) ? FromType4(context, RecordValue(type), result) : result;
}
function CyclicDependencies(context, key, type) {
  const result = FromType4(context, type, [key]);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/cyclic/extends.mjs
function FromRef3(_ref) {
  return Any();
}
function FromProperties3(properties) {
  return guard_exports.Keys(properties).reduce((result, key) => {
    return { ...result, [key]: FromType5(properties[key]) };
  }, {});
}
function FromTypes4(types) {
  return types.reduce((result, left) => {
    return [...result, FromType5(left)];
  }, []);
}
function FromType5(type) {
  return IsRef2(type) ? FromRef3(type.$ref) : IsArray2(type) ? _Array_(FromType5(type.items), ArrayOptions(type)) : IsConstructor2(type) ? Constructor(FromTypes4(type.parameters), FromType5(type.instanceType)) : IsFunction2(type) ? _Function_(FromTypes4(type.parameters), FromType5(type.returnType)) : IsIntersect(type) ? Intersect(FromTypes4(type.allOf)) : IsObject2(type) ? _Object_(FromProperties3(type.properties)) : IsRecord(type) ? Record(RecordKey(type), FromType5(RecordValue(type))) : IsUnion(type) ? Union(FromTypes4(type.anyOf)) : IsTuple(type) ? Tuple(FromTypes4(type.items)) : type;
}
function CyclicAnyFromParameters(defs, ref) {
  return ref in defs ? FromType5(defs[ref]) : Unknown();
}
function CyclicExtends(type) {
  return CyclicAnyFromParameters(type.$defs, type.$ref);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/cyclic/instantiate.mjs
function CyclicInterface(context, heritage, properties) {
  const instantiatedHeritage = InstantiateTypes(context, State([], []), heritage);
  const instantiatedProperties = InstantiateProperties({}, State([], []), properties);
  const evaluatedInterface = EvaluateIntersect([...instantiatedHeritage, _Object_(instantiatedProperties)]);
  return evaluatedInterface;
}
function CyclicDefinitions(context, dependencies) {
  const keys = guard_exports.Keys(context).filter((key) => dependencies.includes(key));
  return keys.reduce((result, key) => {
    const type = context[key];
    const instantiatedType = IsInterfaceDeferred(type) ? CyclicInterface(context, type.parameters[0], type.parameters[1]) : type;
    return { ...result, [key]: instantiatedType };
  }, {});
}
function InstantiateCyclic(context, ref, type) {
  const dependencies = CyclicDependencies(context, ref, type);
  const definitions = CyclicDefinitions(context, dependencies);
  const result = Cyclic(definitions, ref);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/cyclic/target.mjs
function Resolve(defs, ref) {
  return ref in defs ? IsRef2(defs[ref]) ? Resolve(defs, defs[ref].$ref) : defs[ref] : Never();
}
function CyclicTarget(defs, ref) {
  const result = Resolve(defs, ref);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/extends/extends.mjs
function Canonical(type) {
  return IsCyclic(type) ? CyclicExtends(type) : IsUnsafe(type) ? Unknown() : type;
}
function Extends(inferred, left, right) {
  const canonicalLeft = Canonical(left);
  const canonicalRight = Canonical(right);
  return ExtendsLeft(inferred, canonicalLeft, canonicalRight);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/evaluate/compare.mjs
var ResultEqual = "equal";
var ResultDisjoint = "disjoint";
var ResultLeftInside = "left-inside";
var ResultRightInside = "right-inside";
function Compare(left, right) {
  const extendsCheck = [
    IsUnknown(left) ? result_exports.ExtendsFalse() : Extends({}, left, right),
    IsUnknown(left) ? result_exports.ExtendsTrue({}) : Extends({}, right, left)
  ];
  return result_exports.IsExtendsTrueLike(extendsCheck[0]) && result_exports.IsExtendsTrueLike(extendsCheck[1]) ? ResultEqual : result_exports.IsExtendsTrueLike(extendsCheck[0]) && result_exports.IsExtendsFalse(extendsCheck[1]) ? ResultLeftInside : result_exports.IsExtendsFalse(extendsCheck[0]) && result_exports.IsExtendsTrueLike(extendsCheck[1]) ? ResultRightInside : ResultDisjoint;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/evaluate/broaden.mjs
function BroadFilter(type, types) {
  return types.filter((left) => {
    return Compare(type, left) === ResultRightInside ? false : true;
  });
}
function IsBroadestType(type, types) {
  const result = types.some((left) => {
    const result2 = Compare(type, left);
    return guard_exports.IsEqual(result2, ResultLeftInside) || guard_exports.IsEqual(result2, ResultEqual);
  });
  return guard_exports.IsEqual(result, false);
}
function BroadenType(type, types) {
  const evaluated = EvaluateType(type);
  return IsAny(evaluated) ? [evaluated] : IsBroadestType(evaluated, types) ? [...BroadFilter(evaluated, types), evaluated] : types;
}
function BroadenTypes(types) {
  return types.reduce((result, left) => {
    return IsObject2(left) ? [...result, left] : (
      // push
      IsNever(left) ? result : (
        // ignore
        BroadenType(left, result)
      )
    );
  }, []);
}
function Broaden(types) {
  const broadened = BroadenTypes(types);
  const flattened = Flatten(broadened);
  return flattened;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/evaluate/instantiate.mjs
function EvaluateAction(type, options) {
  const result = memory_exports.Update(EvaluateType(type), {}, options);
  return result;
}
function EvaluateInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return EvaluateAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/call/distribute_arguments.mjs
function CollectDistributionNames(expression, result = []) {
  return (
    // Conditional
    IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Conditional") ? IsRef2(expression.parameters[0]) ? CollectDistributionNames(expression.parameters[2], CollectDistributionNames(expression.parameters[3], [...result, expression.parameters[0]["$ref"]])) : CollectDistributionNames(expression.parameters[2], CollectDistributionNames(expression.parameters[3], result)) : IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Mapped") ? IsDeferred(expression.parameters[1]) && guard_exports.IsEqual(expression.parameters[1].action, "KeyOf") && IsRef2(expression.parameters[1].parameters[0]) ? [...result, expression.parameters[1].parameters[0]["$ref"]] : result : result
  );
}
function BuildDistributionArray(parameters, names) {
  return parameters.reduce((result, left) => [...result, names.includes(left.name)], []);
}
function ZipDistributionArray(arguments_, distributionArray, result = []) {
  return guard_exports.ShiftLeft(arguments_, (argumentLeft, argumentRight) => guard_exports.ShiftLeft(distributionArray, (booleanLeft, booleanRight) => ZipDistributionArray(argumentRight, booleanRight, [...result, [booleanLeft, argumentLeft]]), () => result), () => result);
}
function Expand(type) {
  return IsUnion(type) ? [...type.anyOf] : [type];
}
function Append(current, type) {
  return current.reduce((result, left) => [...result, [...left, type]], []);
}
function Cross(current, variants) {
  return variants.reduce((result, left) => {
    return [...result, ...Append(current, left)];
  }, []);
}
function Distribute2(zipped) {
  return zipped.reduce((result, left) => {
    return guard_exports.IsEqual(left[0], true) ? Cross(result, Expand(left[1])) : Cross(result, [left[1]]);
  }, [[]]);
}
function DistributeArguments(parameters, arguments_, expression) {
  const distributionNames = CollectDistributionNames(expression);
  const distributionArray = BuildDistributionArray(parameters, distributionNames);
  const zippedArguments = ZipDistributionArray(arguments_, distributionArray);
  return IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Conditional") ? Distribute2(zippedArguments) : IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Mapped") ? Distribute2(zippedArguments) : [arguments_];
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/call/resolve_target.mjs
function FromNotResolvable() {
  return ["(not-resolvable)", Never()];
}
function FromNotGeneric() {
  return ["(not-generic)", Never()];
}
function FromGeneric(name, parameters, expression) {
  return [name, Generic(parameters, expression)];
}
function FromRef4(context, ref, arguments_) {
  return ref in context ? FromType6(context, ref, context[ref], arguments_) : FromNotResolvable();
}
function FromType6(context, name, target, arguments_) {
  return IsGeneric(target) ? FromGeneric(name, target.parameters, target.expression) : IsRef2(target) ? FromRef4(context, target.$ref, arguments_) : FromNotGeneric();
}
function ResolveTarget(context, target, arguments_) {
  return FromType6(context, "(anonymous)", target, arguments_);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/call/resolve_arguments.mjs
function AssertArgumentExtends(name, type, extends_) {
  if (IsInfer(type) || IsCall(type) || result_exports.IsExtendsTrueLike(Extends({}, type, extends_)))
    return;
  const cause = { parameter: name, expect: extends_, actual: type };
  throw new Error(`Argument for parameter ${name} does not satisfy constraint`, { cause });
}
function BindArgument(context, state, name, extends_, type) {
  const instantiatedArgument = InstantiateType(context, state, type);
  AssertArgumentExtends(name, instantiatedArgument, extends_);
  return memory_exports.Assign(context, { [name]: instantiatedArgument });
}
function BindArguments(context, state, parameterLeft, parameterRight, arguments_) {
  const instantiatedExtends = InstantiateType(context, state, parameterLeft.extends);
  const instantiatedEquals = InstantiateType(context, state, parameterLeft.equals);
  return guard_exports.ShiftLeft(arguments_, (left, right) => BindParameters(BindArgument(context, state, parameterLeft["name"], instantiatedExtends, left), state, parameterRight, right), () => BindParameters(BindArgument(context, state, parameterLeft["name"], instantiatedExtends, instantiatedEquals), state, parameterRight, []));
}
function BindParameters(context, state, parameters, arguments_) {
  return guard_exports.ShiftLeft(parameters, (left, right) => BindArguments(context, state, left, right, arguments_), () => context);
}
function ResolveArgumentsContext(context, state, parameters, arguments_) {
  return BindParameters(context, state, parameters, arguments_);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/call/instantiate.mjs
function Peek(state) {
  const result = guard_exports.IsGreaterThan(state.callstack.length, 0) ? state.callstack[state.callstack.length - 1] : "";
  return result;
}
function IsTailCall(state, name) {
  const result = guard_exports.IsEqual(Peek(state), name);
  return result;
}
function CallDispatch(context, state, target, parameters, expression, arguments_) {
  const argumentsContext = ResolveArgumentsContext(context, state, parameters, arguments_);
  const returnType = InstantiateType(argumentsContext, State([...state["callstack"], target["$ref"]], state["visited"]), expression);
  return InstantiateType(argumentsContext, State([], []), returnType);
}
function CallDistributed(context, state, target, parameters, expression, distributedArguments) {
  return distributedArguments.reduce((result, arguments_) => [...result, CallDispatch(context, state, target, parameters, expression, arguments_)], []);
}
function CallImmediate(context, state, target, parameters, expression, arguments_) {
  const distributedArguments = DistributeArguments(parameters, arguments_, expression);
  const returnTypes = CallDistributed(context, state, target, parameters, expression, distributedArguments);
  const result = guard_exports.IsEqual(returnTypes.length, 1) ? returnTypes[0] : EvaluateUnion(returnTypes);
  return result;
}
function CallInstantiate(context, state, target, arguments_) {
  const instantiatedArguments = InstantiateTypes(context, state, arguments_);
  const resolved2 = ResolveTarget(context, target, arguments_);
  const name = resolved2[0];
  const type = resolved2[1];
  const result = IsGeneric(type) ? IsTailCall(state, name) ? CallConstruct(Ref2(name), instantiatedArguments) : CallImmediate(context, state, Ref2(name), type.parameters, type.expression, instantiatedArguments) : CallConstruct(target, instantiatedArguments);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/types/call.mjs
function CallConstruct(target, arguments_) {
  return memory_exports.Create({ ["~kind"]: "Call" }, { type: "call", target, arguments: arguments_ }, {});
}
function Call(target, arguments_) {
  return CallInstantiate({}, State([], []), target, arguments_);
}
function IsCall(value) {
  return IsKind(value, "Call");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/immutable/instantiate_remove.mjs
function RemoveImmutableOperation(type) {
  return memory_exports.Discard(type, ["~immutable"]);
}
function RemoveImmutableAction(type, options) {
  const result = memory_exports.Update(RemoveImmutableOperation(type), {}, options);
  return result;
}
function RemoveImmutableInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return RemoveImmutableAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/intrinsics/mapping.mjs
function ApplyMapping(mapping, value) {
  return mapping(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/intrinsics/from_literal.mjs
function FromLiteral3(mapping, value) {
  return guard_exports.IsString(value) ? Literal(ApplyMapping(mapping, value)) : Literal(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/intrinsics/from_template_literal.mjs
function FromTemplateLiteral(mapping, pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType7(mapping, evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/intrinsics/from_union.mjs
function FromUnion2(mapping, types) {
  const result = types.map((type) => FromType7(mapping, type));
  return Union(result);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/intrinsics/from_type.mjs
function FromType7(mapping, type) {
  return IsLiteral(type) ? FromLiteral3(mapping, type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral(mapping, type.pattern) : IsUnion(type) ? FromUnion2(mapping, type.anyOf) : type;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/capitalize.mjs
function CapitalizeDeferred(type, options = {}) {
  return Deferred("Capitalize", [type], options);
}
function Capitalize(type, options = {}) {
  return CapitalizeAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/lowercase.mjs
function LowercaseDeferred(type, options = {}) {
  return Deferred("Lowercase", [type], options);
}
function Lowercase(type, options = {}) {
  return LowercaseAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/uncapitalize.mjs
function UncapitalizeDeferred(type, options = {}) {
  return Deferred("Uncapitalize", [type], options);
}
function Uncapitalize(type, options = {}) {
  return UncapitalizeAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/uppercase.mjs
function UppercaseDeferred(type, options = {}) {
  return Deferred("Uppercase", [type], options);
}
function Uppercase(type, options = {}) {
  return UppercaseAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/intrinsics/instantiate.mjs
var CapitalizeMapping = (input) => input[0].toUpperCase() + input.slice(1);
var LowercaseMapping = (input) => input.toLowerCase();
var UncapitalizeMapping = (input) => input[0].toLowerCase() + input.slice(1);
var UppercaseMapping = (input) => input.toUpperCase();
function CapitalizeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(CapitalizeMapping, type), {}, options) : CapitalizeDeferred(type, options);
  return result;
}
function LowercaseAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(LowercaseMapping, type), {}, options) : LowercaseDeferred(type, options);
  return result;
}
function UncapitalizeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(UncapitalizeMapping, type), {}, options) : UncapitalizeDeferred(type, options);
  return result;
}
function UppercaseAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType7(UppercaseMapping, type), {}, options) : UppercaseDeferred(type, options);
  return result;
}
function CapitalizeInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return CapitalizeAction(instantiatedType, options);
}
function LowercaseInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return LowercaseAction(instantiatedType, options);
}
function UncapitalizeInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return UncapitalizeAction(instantiatedType, options);
}
function UppercaseInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return UppercaseAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/conditional.mjs
function ConditionalDeferred(left, right, true_, false_, options = {}) {
  return Deferred("Conditional", [left, right, true_, false_], options);
}
function Conditional(left, right, true_, false_, options = {}) {
  return ConditionalAction({}, State([], []), left, right, true_, false_, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/conditional/instantiate.mjs
function ConditionalOperation(context, state, left, right, true_, false_) {
  const extendsResult = Extends(context, left, right);
  return result_exports.IsExtendsUnion(extendsResult) ? Union([InstantiateType(extendsResult.inferred, state, true_), InstantiateType(context, state, false_)]) : result_exports.IsExtendsTrue(extendsResult) ? InstantiateType(extendsResult.inferred, state, true_) : InstantiateType(context, state, false_);
}
function ConditionalAction(context, state, left, right, true_, false_, options) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ConditionalOperation(context, state, left, right, true_, false_), {}, options) : ConditionalDeferred(left, right, true_, false_, options);
  return result;
}
function ConditionalInstantiate(context, state, left, right, true_, false_, options) {
  const instantiatedLeft = InstantiateType(context, state, left);
  const instantiatedRight = InstantiateType(context, state, right);
  return ConditionalAction(context, state, instantiatedLeft, instantiatedRight, true_, false_, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/constructor_parameters.mjs
function ConstructorParametersDeferred(type, options = {}) {
  return Deferred("ConstructorParameters", [type], options);
}
function ConstructorParameters(type, options = {}) {
  return ConstructorParametersAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/constructor_parameters/instantiate.mjs
function ConstructorParametersOperation(type) {
  const parameters = IsConstructor2(type) ? type["parameters"] : [];
  const instantiatedParameters = InstantiateElements({}, State([], []), parameters);
  const result = Tuple(instantiatedParameters);
  return result;
}
function ConstructorParametersAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ConstructorParametersOperation(type), {}, options) : ConstructorParametersDeferred(type, options);
  return result;
}
function ConstructorParametersInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return ConstructorParametersAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/exclude.mjs
function ExcludeDeferred(left, right, options = {}) {
  return Deferred("Exclude", [left, right], options);
}
function Exclude(left, right, options = {}) {
  return ExcludeAction(left, right, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/exclude/instantiate.mjs
function ExcludeAction(left, right, options) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ExcludeOperation(left, right), {}, options) : ExcludeDeferred(left, right, options);
  return result;
}
function ExcludeInstantiate(context, state, left, right, options) {
  const instantiatedLeft = InstantiateType(context, state, left);
  const instantiatedRight = InstantiateType(context, state, right);
  return ExcludeAction(instantiatedLeft, instantiatedRight, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/extract.mjs
function ExtractDeferred(left, right, options = {}) {
  return Deferred("Extract", [left, right], options);
}
function Extract(left, right, options = {}) {
  return ExtractAction(left, right, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/extract/operation.mjs
function ExtractType(left, right) {
  const check = Extends({}, left, right);
  const result = result_exports.IsExtendsTrueLike(check) ? [left] : [];
  return result;
}
function ExtractUnion(types, right) {
  return types.reduce((result, head) => {
    return [...result, ...ExtractType(head, right)];
  }, []);
}
function ExtractOperation(left, right) {
  const evaluated = EvaluateType(left);
  const canonical = IsUnion(evaluated) ? evaluated.anyOf : [evaluated];
  const remaining = ExtractUnion(canonical, right);
  const result = EvaluateUnion(remaining);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/extract/instantiate.mjs
function ExtractAction(left, right, options) {
  const result = CanInstantiate([left, right]) ? memory_exports.Update(ExtractOperation(left, right), {}, options) : ExtractDeferred(left, right, options);
  return result;
}
function ExtractInstantiate(context, state, left, right, options) {
  const instantiatedLeft = InstantiateType(context, state, left);
  const instantiatedRight = InstantiateType(context, state, right);
  return ExtractAction(instantiatedLeft, instantiatedRight, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/helpers/keys_to_indexer.mjs
function KeysToLiterals(keys) {
  return keys.reduce((result, left) => {
    return IsLiteralValue(left) ? [...result, Literal(left)] : result;
  }, []);
}
function KeysToIndexer(keys) {
  const literals = KeysToLiterals(keys);
  const result = Union(literals);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/indexed.mjs
function IndexDeferred(type, indexer, options = {}) {
  return Deferred("Index", [type, indexer], options);
}
function Index(type, indexer_or_keys, options = {}) {
  const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
  return IndexAction(type, indexer, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/object/from_cyclic.mjs
function FromCyclic(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const result = FromType8(target);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/object/from_dependent.mjs
function FromDependent(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType8(evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/object/from_intersect.mjs
function CollapseIntersectProperties(left, right) {
  const leftKeys = guard_exports.Keys(left).filter((key) => !guard_exports.HasPropertyKey(right, key));
  const rightKeys = guard_exports.Keys(right).filter((key) => !guard_exports.HasPropertyKey(left, key));
  const sharedKeys = guard_exports.Keys(left).filter((key) => guard_exports.HasPropertyKey(right, key));
  const leftProperties = leftKeys.reduce((result, key) => ({ ...result, [key]: left[key] }), {});
  const rightProperties = rightKeys.reduce((result, key) => ({ ...result, [key]: right[key] }), {});
  const sharedProperties = sharedKeys.reduce((result, key) => ({ ...result, [key]: EvaluateIntersect([left[key], right[key]]) }), {});
  const unique = memory_exports.Assign(leftProperties, rightProperties);
  const shared = memory_exports.Assign(unique, sharedProperties);
  return shared;
}
function FromIntersect(types) {
  return types.reduce((result, left) => {
    return CollapseIntersectProperties(result, FromType8(left));
  }, {});
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/object/from_object.mjs
function FromObject5(properties) {
  return properties;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/object/from_tuple.mjs
function FromTuple(types) {
  const object = TupleToObject(Tuple(types));
  const result = FromType8(object);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/object/from_union.mjs
function CollapseUnionProperties(left, right) {
  const sharedKeys = guard_exports.Keys(left).filter((key) => key in right);
  const result = sharedKeys.reduce((result2, key) => {
    return { ...result2, [key]: EvaluateUnion([left[key], right[key]]) };
  }, {});
  return result;
}
function ReduceVariants(types, result) {
  return guard_exports.ShiftLeft(types, (left, right) => ReduceVariants(right, CollapseUnionProperties(result, FromType8(left))), () => result);
}
function FromUnion3(types) {
  return guard_exports.ShiftLeft(types, (left, right) => ReduceVariants(right, FromType8(left)), () => Unreachable());
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/object/from_type.mjs
function FromType8(type) {
  return IsCyclic(type) ? FromCyclic(type.$defs, type.$ref) : IsDependent(type) ? FromDependent(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect(type.allOf) : IsUnion(type) ? FromUnion3(type.anyOf) : IsTuple(type) ? FromTuple(type.items) : IsObject2(type) ? FromObject5(type.properties) : {};
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/object/collapse.mjs
function CollapseToObject(type) {
  const properties = FromType8(type);
  const result = _Object_(properties);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/helpers/keys.mjs
var integerKeyPattern = new RegExp("^(?:0|[1-9][0-9]*)$");
function ConvertToIntegerKey(value) {
  const normal = `${value}`;
  return integerKeyPattern.test(normal) ? parseInt(normal) : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexed/from_array.mjs
function NormalizeLiteral(value) {
  return Literal(ConvertToIntegerKey(value));
}
function NormalizeIndexerTypes(types) {
  return types.map((type) => NormalizeIndexer(type));
}
function NormalizeIndexer(type) {
  return IsIntersect(type) ? Intersect(NormalizeIndexerTypes(type.allOf)) : IsUnion(type) ? Union(NormalizeIndexerTypes(type.anyOf)) : IsLiteral(type) ? NormalizeLiteral(type.const) : type;
}
function FromArray4(type, indexer) {
  const normalizedIndexer = NormalizeIndexer(indexer);
  const check = Extends({}, normalizedIndexer, Number2());
  const result = (
    // indexer
    result_exports.IsExtendsTrueLike(check) ? type : IsLiteral(indexer) && guard_exports.IsEqual(indexer.const, "length") ? Number2() : Never()
  );
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexable/from_cyclic.mjs
function FromCyclic2(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const result = FromType9(target);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexable/from_dependent.mjs
function FromDependent2(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexable/from_enum.mjs
function FromEnum(values) {
  const evaluated = EvaluateEnum(values);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexable/from_intersect.mjs
function FromIntersect2(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexable/from_literal.mjs
function FromLiteral4(value) {
  const result = [`${value}`];
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexable/from_template_literal.mjs
function FromTemplateLiteral2(pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType9(evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexable/from_union.mjs
function FromUnion4(types) {
  return types.reduce((result, left) => {
    return [...result, ...FromType9(left)];
  }, []);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexable/from_type.mjs
function FromType9(type) {
  return IsCyclic(type) ? FromCyclic2(type.$defs, type.$ref) : IsDependent(type) ? FromDependent2(type.if, type.then, type.else) : IsEnum2(type) ? FromEnum(type.enum) : IsIntersect(type) ? FromIntersect2(type.allOf) : IsLiteral(type) ? FromLiteral4(type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral2(type.pattern) : IsUnion(type) ? FromUnion4(type.anyOf) : [];
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexable/to_indexable_keys.mjs
function ToIndexableKeys(type) {
  const result = FromType9(type);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/this/expand_this.mjs
function FromTypes5(properties, types) {
  return types.map((type) => FromType10(properties, type));
}
function FromType10(properties, type) {
  return IsArray2(type) ? _Array_(FromType10(properties, type.items)) : IsConstructor2(type) ? Constructor(FromTypes5(properties, type.parameters), FromType10(properties, type.instanceType)) : IsFunction2(type) ? _Function_(FromTypes5(properties, type.parameters), FromType10(properties, type.returnType)) : IsTuple(type) ? Tuple(FromTypes5(properties, type.items)) : IsUnion(type) ? Union(FromTypes5(properties, type.anyOf)) : IsIntersect(type) ? Intersect(FromTypes5(properties, type.allOf)) : IsThis(type) ? _Object_(properties) : type;
}
function ExpandThis(properties, type) {
  const result = FromType10(properties, type);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexed/from_object.mjs
function IndexProperty(properties, key) {
  const selectedType = key in properties ? properties[key] : Never();
  const result = ExpandThis(properties, selectedType);
  return result;
}
function IndexProperties(properties, keys) {
  return keys.reduce((result, left) => {
    return [...result, IndexProperty(properties, left)];
  }, []);
}
function FromIndexer(properties, indexer) {
  const keys = ToIndexableKeys(indexer);
  const variants = IndexProperties(properties, keys);
  const result = EvaluateUnion(variants);
  return result;
}
var NumericKeyPattern = new RegExp(IntegerKey);
function NumericKeys(keys) {
  const result = keys.filter((key) => NumericKeyPattern.test(key));
  return result;
}
function FromIndexerNumber(properties) {
  const keys = PropertyKeys(properties);
  const numericKeys = NumericKeys(keys);
  const variants = IndexProperties(properties, numericKeys);
  const result = EvaluateUnion(variants);
  return result;
}
function FromObject6(properties, indexer) {
  const result = IsNumber3(indexer) ? FromIndexerNumber(properties) : FromIndexer(properties, indexer);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexed/array_indexer.mjs
function ConvertLiteral(value) {
  return Literal(ConvertToIntegerKey(value));
}
function ArrayIndexerTypes(types) {
  return types.map((type) => FormatArrayIndexer(type));
}
function FormatArrayIndexer(type) {
  return IsIntersect(type) ? Intersect(ArrayIndexerTypes(type.allOf)) : IsUnion(type) ? Union(ArrayIndexerTypes(type.anyOf)) : IsLiteral(type) ? ConvertLiteral(type.const) : type;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexed/from_tuple.mjs
function IndexElementsWithIndexer(types, indexer) {
  return types.reduceRight((result, right, index) => {
    const check = Extends({}, Literal(index), indexer);
    return result_exports.IsExtendsTrueLike(check) ? [right, ...result] : result;
  }, []);
}
function FromTupleWithIndexer(types, indexer) {
  const formattedArrayIndexer = FormatArrayIndexer(indexer);
  const elements = IndexElementsWithIndexer(types, formattedArrayIndexer);
  return EvaluateUnionFast(elements);
}
function FromTupleWithoutIndexer(types) {
  return EvaluateUnionFast(types);
}
function FromTuple2(types, indexer) {
  return (
    // length (intrinsic)
    IsLiteral(indexer) && guard_exports.IsEqual(indexer.const, "length") ? Literal(types.length) : IsNumber3(indexer) || IsInteger2(indexer) ? FromTupleWithoutIndexer(types) : FromTupleWithIndexer(types, indexer)
  );
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexed/from_type.mjs
function FromType11(type, indexer) {
  return IsArray2(type) ? FromArray4(type.items, indexer) : IsObject2(type) ? FromObject6(type.properties, indexer) : IsTuple(type) ? FromTuple2(type.items, indexer) : Never();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexed/instantiate.mjs
function NormalizeType(type) {
  const result = IsCyclic(type) || IsDependent(type) || IsIntersect(type) || IsUnion(type) ? CollapseToObject(type) : type;
  return result;
}
function IndexAction(type, indexer, options) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType11(NormalizeType(type), indexer), {}, options) : IndexDeferred(type, indexer, options);
  return result;
}
function IndexInstantiate(context, state, type, indexer, options) {
  const instantiatedType = InstantiateType(context, state, type);
  const instantiatedIndexer = InstantiateType(context, state, indexer);
  return IndexAction(instantiatedType, instantiatedIndexer, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/instance_type.mjs
function InstanceTypeDeferred(type, options = {}) {
  return Deferred("InstanceType", [type], options);
}
function InstanceType(type, options = {}) {
  return InstanceTypeAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/instance_type/instantiate.mjs
function InstanceTypeOperation(type) {
  return IsConstructor2(type) ? type["instanceType"] : Never();
}
function InstanceTypeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(InstanceTypeOperation(type), {}, options) : InstanceTypeDeferred(type, options);
  return result;
}
function InstanceTypeInstantiate(context, state, type, options = {}) {
  const instantiatedType = InstantiateType(context, state, type);
  return InstanceTypeAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/keyof.mjs
function KeyOfDeferred(type, options = {}) {
  return Deferred("KeyOf", [type], options);
}
function KeyOf2(type, options = {}) {
  return KeyOfAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/keyof/from_any.mjs
function FromAny() {
  return Union([Number2(), String2(), Symbol2()]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/keyof/from_array.mjs
function FromArray5(_type) {
  return Number2();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/keyof/from_object.mjs
function FromPropertyKeys(keys) {
  const result = keys.reduce((result2, left) => {
    return IsLiteralValue(left) ? [...result2, Literal(ConvertToIntegerKey(left))] : Unreachable();
  }, []);
  return result;
}
function FromObject7(properties) {
  const propertyKeys = guard_exports.Keys(properties);
  const variants = FromPropertyKeys(propertyKeys);
  const result = EvaluateUnionFast(variants);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/keyof/from_record.mjs
function FromRecord2(type) {
  return RecordKey(type);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/keyof/from_tuple.mjs
function FromTuple3(types) {
  const result = types.map((_, index) => Literal(index));
  return EvaluateUnionFast(result);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/keyof/from_type.mjs
function FromType12(type) {
  return IsAny(type) ? FromAny() : IsArray2(type) ? FromArray5(type.items) : IsObject2(type) ? FromObject7(type.properties) : IsRecord(type) ? FromRecord2(type) : IsTuple(type) ? FromTuple3(type.items) : Never();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/keyof/instantiate.mjs
function NormalizeType2(type) {
  const result = IsCyclic(type) || IsDependent(type) || IsIntersect(type) || IsUnion(type) ? CollapseToObject(type) : type;
  return result;
}
function KeyOfAction(type, options) {
  return CanInstantiate([type]) ? memory_exports.Update(FromType12(NormalizeType2(type)), {}, options) : KeyOfDeferred(type, options);
}
function KeyOfInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return KeyOfAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/mapped.mjs
function MappedDeferred(identifier, type, as, property, options = {}) {
  return Deferred("Mapped", [identifier, type, as, property], options);
}
function Mapped(identifier, type, as, property, options = {}) {
  return MappedAction({}, State([], []), identifier, type, as, property, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/mapped/mapped_variants.mjs
function FromTemplateLiteral3(pattern) {
  const evaluated = EvaluateTemplateLiteral(pattern);
  const result = FromType13(evaluated);
  return result;
}
function FromUnion5(types) {
  return types.reduce((result, left) => {
    return [...result, ...FromType13(left)];
  }, []);
}
function FromEnum2(values) {
  const evaluated = EvaluateEnum(values);
  const result = FromType13(evaluated);
  return result;
}
function FromLiteral5(value) {
  const result = guard_exports.IsNumber(value) ? [Literal(`${value}`)] : [Literal(value)];
  return result;
}
function FromType13(type) {
  const result = IsEnum2(type) ? FromEnum2(type.enum) : IsLiteral(type) ? FromLiteral5(type.const) : IsTemplateLiteral(type) ? FromTemplateLiteral3(type.pattern) : IsUnion(type) ? FromUnion5(type.anyOf) : [type];
  return result;
}
function MappedVariants(type) {
  const result = FromType13(type);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/mapped/mapped_operation.mjs
function CanonicalAs(instantiatedAs) {
  const result = IsTemplateLiteral(instantiatedAs) ? EvaluateTemplateLiteral(instantiatedAs.pattern) : instantiatedAs;
  return result;
}
function MappedVariant(context, state, identifier, variant2, as, property) {
  const variantContext = memory_exports.Assign(context, { [identifier["name"]]: variant2 });
  const instantiatedAs = InstantiateType(variantContext, state, as);
  const canonicalAs = CanonicalAs(instantiatedAs);
  const instantiatedProperty = InstantiateType(variantContext, state, property);
  return IsLiteralNumber(canonicalAs) || IsLiteralString(canonicalAs) ? { [canonicalAs.const]: instantiatedProperty } : {};
}
function MappedProperties(context, state, identifier, variants, as, property) {
  return variants.reduce((result, left) => {
    return [...result, MappedVariant(context, state, identifier, left, as, property)];
  }, []);
}
function MappedObjects(properties) {
  return properties.reduce((result, left) => {
    return [...result, _Object_(left)];
  }, []);
}
function MappedOperation(context, state, identifier, type, as, property) {
  const variants = MappedVariants(type);
  const mappedProperties = MappedProperties(context, state, identifier, variants, as, property);
  const mappedObjects = MappedObjects(mappedProperties);
  const result = EvaluateIntersect(mappedObjects);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/mapped/instantiate.mjs
function MappedAction(context, state, identifier, type, as, property, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(MappedOperation(context, state, identifier, type, as, property), {}, options) : MappedDeferred(identifier, type, as, property, options);
  return result;
}
function MappedInstantiate(context, state, identifier, type, as, property, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return MappedAction(context, state, identifier, instantiatedType, as, property, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/module/instantiate.mjs
function InstantiateCyclics(context, declarations, cyclicKeys) {
  const declarationContext = memory_exports.Assign(context, declarations);
  const declarationKeys = guard_exports.Keys(declarations).filter((key) => cyclicKeys.includes(key));
  return declarationKeys.reduce((result, key) => {
    return { ...result, [key]: InstantiateCyclic(declarationContext, key, declarations[key]) };
  }, {});
}
function InstantiateNonCyclics(context, declarations, cyclicKeys) {
  const declarationContext = memory_exports.Assign(context, declarations);
  const declarationKeys = guard_exports.Keys(declarations).filter((key) => !cyclicKeys.includes(key));
  return declarationKeys.reduce((result, key) => {
    return { ...result, [key]: InstantiateType(declarationContext, State([], []), declarations[key]) };
  }, {});
}
function InstantiateModule(context, declarations, options) {
  const cyclicCandidates = CyclicCandidates(declarations);
  const instantiatedCyclics = InstantiateCyclics(context, declarations, cyclicCandidates);
  const instantiatedNonCyclics = InstantiateNonCyclics(context, declarations, cyclicCandidates);
  const instantiatedModule = { ...instantiatedCyclics, ...instantiatedNonCyclics };
  return memory_exports.Update(instantiatedModule, {}, options);
}
function ModuleInstantiate(context, _state, declarations, options) {
  const instantiatedModule = InstantiateModule(context, declarations, options);
  return instantiatedModule;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/non_nullable.mjs
function NonNullableDeferred(type, options = {}) {
  return Deferred("NonNullable", [type], options);
}
function NonNullable(type, options = {}) {
  return NonNullableAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/non_nullable/instantiate.mjs
function NonNullableOperation(type) {
  const excluded = Union([Null(), Undefined()]);
  return ExcludeAction(type, excluded, {});
}
function NonNullableAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(NonNullableOperation(type), {}, options) : NonNullableDeferred(type, options);
  return result;
}
function NonNullableInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return NonNullableAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/omit.mjs
function OmitDeferred(type, indexer, options = {}) {
  return Deferred("Omit", [type, indexer], options);
}
function Omit(type, indexer_or_keys, options = {}) {
  const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
  return OmitAction(type, indexer, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/indexable/to_indexable.mjs
function ToIndexable(type) {
  const collapsed = CollapseToObject(type);
  const result = IsObject2(collapsed) ? collapsed.properties : Unreachable();
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/omit/from_type.mjs
function FromKeys(properties, keys) {
  const result = guard_exports.Keys(properties).reduce((result2, key) => {
    return keys.includes(key) ? result2 : { ...result2, [key]: properties[key] };
  }, {});
  return result;
}
function FromType14(type, indexer) {
  const indexable = ToIndexable(type);
  const indexableKeys = ToIndexableKeys(indexer);
  const omitted = FromKeys(indexable, indexableKeys);
  const result = _Object_(omitted);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/omit/instantiate.mjs
function OmitAction(type, indexer, options) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType14(type, indexer), {}, options) : OmitDeferred(type, indexer, options);
  return result;
}
function OmitInstantiate(context, state, type, indexer, options) {
  const instantiatedType = InstantiateType(context, state, type);
  const instantiatedIndexer = InstantiateType(context, state, indexer);
  return OmitAction(instantiatedType, instantiatedIndexer, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/parameters.mjs
function ParametersDeferred(type, options = {}) {
  return Deferred("Parameters", [type], options);
}
function Parameters(type, options = {}) {
  return ParametersAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/parameters/instantiate.mjs
function ParametersOperation(type) {
  const parameters = IsFunction2(type) ? type["parameters"] : [];
  const instantiatedParameters = InstantiateElements({}, State([], []), parameters);
  const result = Tuple(instantiatedParameters);
  return result;
}
function ParametersAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ParametersOperation(type), {}, options) : ParametersDeferred(type, options);
  return result;
}
function ParametersInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return ParametersAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/partial.mjs
function PartialDeferred(type, options = {}) {
  return Deferred("Partial", [type], options);
}
function Partial(type, options = {}) {
  return PartialAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/partial/from_cyclic.mjs
function FromCyclic3(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType15(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/partial/from_dependent.mjs
function FromDependent3(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType15(evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/partial/from_intersect.mjs
function FromIntersect3(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType15(evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/partial/from_union.mjs
function FromUnion6(types) {
  const result = types.map((type) => FromType15(type));
  return Union(result);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/partial/from_object.mjs
function FromObject8(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: AddOptional(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/partial/from_type.mjs
function FromType15(type) {
  return IsCyclic(type) ? FromCyclic3(type.$defs, type.$ref) : IsDependent(type) ? FromDependent3(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect3(type.allOf) : IsUnion(type) ? FromUnion6(type.anyOf) : IsObject2(type) ? FromObject8(type.properties) : _Object_({});
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/partial/instantiate.mjs
function PartialAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType15(type), {}, options) : PartialDeferred(type, options);
  return result;
}
function PartialInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return PartialAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/pick.mjs
function PickDeferred(type, indexer, options = {}) {
  return Deferred("Pick", [type, indexer], options);
}
function Pick(type, indexer_or_keys, options = {}) {
  const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
  return PickAction(type, indexer, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/pick/from_type.mjs
function FromKeys2(properties, keys) {
  const result = guard_exports.Keys(properties).reduce((result2, key) => {
    return keys.includes(key) ? memory_exports.Assign(result2, { [key]: properties[key] }) : result2;
  }, {});
  return result;
}
function FromType16(type, indexer) {
  const indexable = ToIndexable(type);
  const keys = ToIndexableKeys(indexer);
  const applied = FromKeys2(indexable, keys);
  const result = _Object_(applied);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/pick/instantiate.mjs
function PickAction(type, indexer, options) {
  const result = CanInstantiate([type, indexer]) ? memory_exports.Update(FromType16(type, indexer), {}, options) : PickDeferred(type, indexer, options);
  return result;
}
function PickInstantiate(context, state, type, indexer, options) {
  const instantiatedType = InstantiateType(context, state, type);
  const instantiatedIndexer = InstantiateType(context, state, indexer);
  return PickAction(instantiatedType, instantiatedIndexer, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/readonly_object.mjs
function ReadonlyObjectDeferred(type, options = {}) {
  return Deferred("ReadonlyObject", [type], options);
}
function ReadonlyObject(type, options = {}) {
  return ReadonlyObjectAction(type, options);
}
var ReadonlyType = ReadonlyObject;

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/readonly_object/from_array.mjs
function FromArray6(type) {
  const result = AddImmutable(_Array_(type));
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/readonly_object/from_cyclic.mjs
function FromCyclic4(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType17(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/readonly_object/from_dependent.mjs
function FromDependent4(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType17(evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/readonly_object/from_intersect.mjs
function FromIntersect4(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType17(evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/readonly_object/from_object.mjs
function FromObject9(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: AddReadonly(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/readonly_object/from_tuple.mjs
function FromTuple4(types) {
  const result = AddImmutable(Tuple(types));
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/readonly_object/from_union.mjs
function FromUnion7(types) {
  const result = types.map((type) => FromType17(type));
  return Union(result);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/readonly_object/from_type.mjs
function FromType17(type) {
  return IsArray2(type) ? FromArray6(type.items) : IsCyclic(type) ? FromCyclic4(type.$defs, type.$ref) : IsDependent(type) ? FromDependent4(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect4(type.allOf) : IsObject2(type) ? FromObject9(type.properties) : IsTuple(type) ? FromTuple4(type.items) : IsUnion(type) ? FromUnion7(type.anyOf) : type;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/readonly_object/instantiate.mjs
function ReadonlyObjectAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType17(type), {}, options) : ReadonlyObjectDeferred(type);
  return result;
}
function ReadonlyObjectInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return ReadonlyObjectAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/ref/instantiate.mjs
function RefInstantiate(context, state, type, ref) {
  return state.visited.includes(ref) ? type : ref in context ? InstantiateType(context, State(state["callstack"], [...state["visited"], ref]), context[ref]) : type;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/required/from_cyclic.mjs
function FromCyclic5(defs, ref) {
  const target = CyclicTarget(defs, ref);
  const partial = FromType18(target);
  const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/required/from_dependent.mjs
function FromDependent5(if_, then_, else_) {
  const evaluated = EvaluateDependent(if_, then_, else_);
  const result = FromType18(evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/required/from_intersect.mjs
function FromIntersect5(types) {
  const evaluated = EvaluateIntersect(types);
  const result = FromType18(evaluated);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/required/from_union.mjs
function FromUnion8(types) {
  const result = types.map((type) => FromType18(type));
  return Union(result);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/required/from_object.mjs
function FromObject10(properties) {
  const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
    return { ...result2, [left]: RemoveOptional(properties[left]) };
  }, {});
  const result = _Object_(mapped);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/required/from_type.mjs
function FromType18(type) {
  return IsCyclic(type) ? FromCyclic5(type.$defs, type.$ref) : IsDependent(type) ? FromDependent5(type.if, type.then, type.else) : IsIntersect(type) ? FromIntersect5(type.allOf) : IsUnion(type) ? FromUnion8(type.anyOf) : IsObject2(type) ? FromObject10(type.properties) : _Object_({});
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/required.mjs
function RequiredDeferred(type, options = {}) {
  return Deferred("Required", [type], options);
}
function Required(type, options = {}) {
  return RequiredAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/required/instantiate.mjs
function RequiredAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(FromType18(type), {}, options) : RequiredDeferred(type, options);
  return result;
}
function RequiredInstantiate(context, state, type, options) {
  const instaniatedType = InstantiateType(context, state, type);
  return RequiredAction(instaniatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/return_type.mjs
function ReturnTypeDeferred(type, options = {}) {
  return Deferred("ReturnType", [type], options);
}
function ReturnType(type, options = {}) {
  return ReturnTypeAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/return_type/instantiate.mjs
function ReturnTypeOperation(type) {
  return IsFunction2(type) ? type["returnType"] : Never();
}
function ReturnTypeAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(ReturnTypeOperation(type), {}, options) : ReturnTypeDeferred(type, options);
  return result;
}
function ReturnTypeInstantiate(context, state, type, options = {}) {
  const instantiatedType = InstantiateType(context, state, type);
  return ReturnTypeAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/with.mjs
function WithDeferred(type, options) {
  return Deferred("With", [type, options], {});
}
function With2(type, options) {
  return WithAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/with/instantiate.mjs
function WithAction(type, options) {
  const result = CanInstantiate([type]) ? memory_exports.Update(type, {}, options) : WithDeferred(type, options);
  return result;
}
function WithInstantiate(context, state, type, options) {
  const instaniatedType = InstantiateType(context, state, type);
  return WithAction(instaniatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/rest/spread.mjs
function SpreadElement(type) {
  const result = IsRest(type) ? IsTuple(type.items) ? RestSpread(type.items.items) : IsInfer(type.items) ? [type] : IsRef2(type.items) ? [type] : [Never()] : [type];
  return result;
}
function RestSpread(types) {
  const result = types.reduce((result2, left) => {
    return [...result2, ...SpreadElement(left)];
  }, []);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/instantiate.mjs
function State(callstack, visited2) {
  return { callstack, visited: visited2 };
}
function CanInstantiate(types) {
  return guard_exports.ShiftLeft(types, (left, right) => IsRef2(left) ? false : CanInstantiate(right), () => true);
}
function InstantiateProperties(context, state, properties) {
  return guard_exports.Keys(properties).reduce((result, key) => {
    return { ...result, [key]: InstantiateType(context, state, properties[key]) };
  }, {});
}
function InstantiateElements(context, state, types) {
  const elements = InstantiateTypes(context, state, types);
  const result = RestSpread(elements);
  return result;
}
function InstantiateTypes(context, state, types) {
  return types.map((type) => InstantiateType(context, state, type));
}
function WithModifiers(type, instantiatedType) {
  const withOptional = IsOptional(type) ? AddOptionalAction(instantiatedType, {}) : instantiatedType;
  const withReadonly = IsReadonly(type) ? AddReadonlyAction(withOptional, {}) : withOptional;
  const withImmutable = IsImmutable(type) ? AddImmutableAction(withReadonly, {}) : withReadonly;
  return withImmutable;
}
function InstantiateDeferred(context, state, action, parameters, options) {
  return (
    // Modifiers
    guard_exports.IsEqual(action, "AddImmutable") ? AddImmutableInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "RemoveImmutable") ? RemoveImmutableInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "AddReadonly") ? AddReadonlyInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "RemoveReadonly") ? RemoveReadonlyInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "AddOptional") ? AddOptionalInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "RemoveOptional") ? RemoveOptionalInstantiate(context, state, parameters[0], options) : (
      // Actions
      guard_exports.IsEqual(action, "Capitalize") ? CapitalizeInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Conditional") ? ConditionalInstantiate(context, state, parameters[0], parameters[1], parameters[2], parameters[3], options) : guard_exports.IsEqual(action, "ConstructorParameters") ? ConstructorParametersInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Evaluate") ? EvaluateInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Exclude") ? ExcludeInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Extract") ? ExtractInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Index") ? IndexInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "InstanceType") ? InstanceTypeInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Interface") ? InterfaceInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "KeyOf") ? KeyOfInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Lowercase") ? LowercaseInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Mapped") ? MappedInstantiate(context, state, parameters[0], parameters[1], parameters[2], parameters[3], options) : guard_exports.IsEqual(action, "Module") ? ModuleInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "NonNullable") ? NonNullableInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Pick") ? PickInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Parameters") ? ParametersInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Partial") ? PartialInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Omit") ? OmitInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "ReadonlyObject") ? ReadonlyObjectInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Record") ? RecordInstantiate(context, state, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Required") ? RequiredInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "ReturnType") ? ReturnTypeInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "TemplateLiteral") ? TemplateLiteralInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Uncapitalize") ? UncapitalizeInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "Uppercase") ? UppercaseInstantiate(context, state, parameters[0], options) : guard_exports.IsEqual(action, "With") ? WithInstantiate(context, state, parameters[0], parameters[1]) : Deferred(action, parameters, options)
    )
  );
}
function InstantiateImmediate(context, state, type) {
  const instantiatedType = IsRef2(type) ? RefInstantiate(context, state, type, type.$ref) : IsArray2(type) ? _Array_(InstantiateType(context, state, type.items), ArrayOptions(type)) : IsCall(type) ? CallInstantiate(context, state, type.target, type.arguments) : IsConstructor2(type) ? Constructor(InstantiateTypes(context, state, type.parameters), InstantiateType(context, state, type.instanceType), ConstructorOptions(type)) : IsFunction2(type) ? _Function_(InstantiateTypes(context, state, type.parameters), InstantiateType(context, state, type.returnType), FunctionOptions(type)) : IsDependent(type) ? Dependent(InstantiateType(context, state, type.if), InstantiateType(context, state, type.then), InstantiateType(context, state, type.else), DependentOptions(type)) : IsIntersect(type) ? Intersect(InstantiateTypes(context, state, type.allOf), IntersectOptions(type)) : IsObject2(type) ? _Object_(InstantiateProperties(context, state, type.properties), ObjectOptions(type)) : IsRecord(type) ? RecordFromPattern(RecordPattern(type), InstantiateType(context, state, RecordValue(type))) : IsRest(type) ? Rest(InstantiateType(context, state, type.items)) : IsTuple(type) ? Tuple(InstantiateElements(context, state, type.items), TupleOptions(type)) : IsUnion(type) ? Union(InstantiateTypes(context, state, type.anyOf), UnionOptions(type)) : type;
  const withModifiers = WithModifiers(type, instantiatedType);
  return withModifiers;
}
function InstantiateType(context, state, type) {
  const result = IsDeferred(type) ? InstantiateDeferred(context, state, type.action, type.parameters, type.options) : InstantiateImmediate(context, state, type);
  return result;
}
function Instantiate(context, type) {
  return InstantiateType(context, State([], []), type);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/immutable/instantiate_add.mjs
function AddImmutableOperation(type) {
  return memory_exports.Update(type, { "~immutable": true }, {});
}
function AddImmutableAction(type, options) {
  const result = memory_exports.Update(AddImmutableOperation(type), {}, options);
  return result;
}
function AddImmutableInstantiate(context, state, type, options) {
  const instantiatedType = InstantiateType(context, state, type);
  return AddImmutableAction(instantiatedType, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/_add_immutable.mjs
function AddImmutableDeferred(type, options = {}) {
  return Deferred("AddImmutable", [type], options);
}
function AddImmutable(type, options = {}) {
  return AddImmutableAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/evaluate.mjs
function EvaluateDeferred(type, options = {}) {
  return Deferred("Evaluate", [type], options);
}
function Evaluate(type, options = {}) {
  return EvaluateAction(type, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/action/module.mjs
function ModuleDeferred(declarations, options = {}) {
  return Deferred("Module", [declarations], options);
}
function Module2(declarations, options = {}) {
  return ModuleInstantiate({}, State([], []), declarations, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/engine/priority/priority.mjs
function Comparer(left, right) {
  const compareResult = Compare(left, right);
  const result = guard_exports.IsEqual(compareResult, "right-inside") ? 1 : guard_exports.IsEqual(compareResult, "disjoint") ? 1 : 0;
  return result;
}
function Insert(type, types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => guard_exports.IsEqual(Comparer(type, left), 1) ? Insert(type, right, [...result, left]) : [...result, type, ...types], () => [...result, type]);
}
function Sort(types, result = []) {
  return guard_exports.ShiftLeft(types, (left, right) => Sort(right, Insert(left, result)), () => result);
}
function Priority(types) {
  const result = Sort(types);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/type/script/script.mjs
function Script2(...args) {
  const [context, input, options] = arguments_exports.Match(args, {
    2: (script, options2) => guard_exports.IsString(script) ? [{}, script, options2] : [script, options2, {}],
    3: (context2, script, options2) => [context2, script, options2],
    1: (script) => [{}, script, {}]
  });
  const result = Script(input);
  const parsed = guard_exports.IsArray(result) && guard_exports.IsEqual(result.length, 2) ? InstantiateType(context, State([], []), result[0]) : Never();
  return memory_exports.Update(parsed, {}, options);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clean/from_array.mjs
function FromArray7(context, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  return value.map((value2) => FromType19(context, type.items, value2));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clean/from_cyclic.mjs
function FromCyclic6(context, type, value) {
  return FromType19({ ...context, ...type.$defs }, Ref2(type.$ref), value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clean/from_intersect.mjs
function EvaluateIntersection(context, type) {
  const additionalProperties = guard_exports.HasPropertyKey(type, "unevaluatedProperties") ? { additionalProperties: type.unevaluatedProperties } : {};
  const instantiated = Instantiate(context, type);
  const evaluated = Evaluate(instantiated);
  return IsObject2(evaluated) ? With2(evaluated, additionalProperties) : evaluated;
}
function FromIntersect6(context, type, value) {
  const evaluated = EvaluateIntersection(context, type);
  return FromType19(context, evaluated, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clean/additional.mjs
function GetAdditionalProperties(type) {
  const additionalProperties = guard_exports.HasPropertyKey(type, "additionalProperties") ? type.additionalProperties : void 0;
  return additionalProperties;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clean/from_object.mjs
function FromObject11(context, type, value) {
  if (!guard_exports.IsObject(value) || guard_exports.IsArray(value))
    return value;
  const additionalProperties = GetAdditionalProperties(type);
  for (const key of guard_exports.Keys(value)) {
    if (guard_exports.HasPropertyKey(type.properties, key)) {
      value[key] = FromType19(context, type.properties[key], value[key]);
      continue;
    }
    const unknownCheck = (
      // 1. additionalProperties: true
      guard_exports.IsBoolean(additionalProperties) && guard_exports.IsEqual(additionalProperties, true) || IsSchema2(additionalProperties) && Check2(context, additionalProperties, value[key])
    );
    if (unknownCheck) {
      value[key] = FromType19(context, additionalProperties, value[key]);
      continue;
    }
    delete value[key];
  }
  return value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clean/from_record.mjs
function FromRecord3(context, type, value) {
  if (!guard_exports.IsObject(value))
    return value;
  const additionalProperties = GetAdditionalProperties(type);
  const [recordPattern, recordValue] = [new RegExp(RecordPattern(type)), RecordValue(type)];
  for (const key of guard_exports.Keys(value)) {
    if (recordPattern.test(key)) {
      value[key] = FromType19(context, recordValue, value[key]);
      continue;
    }
    const unknownCheck = (
      // 1. additionalProperties: true
      guard_exports.IsBoolean(additionalProperties) && guard_exports.IsEqual(additionalProperties, true) || IsSchema2(additionalProperties) && Check2(context, additionalProperties, value[key])
    );
    if (unknownCheck) {
      value[key] = FromType19(context, additionalProperties, value[key]);
      continue;
    }
    delete value[key];
  }
  return value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clean/from_ref.mjs
function FromRef5(context, type, value) {
  return guard_exports.HasPropertyKey(context, type.$ref) ? FromType19(context, context[type.$ref], value) : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clean/from_tuple.mjs
function FromTuple5(context, schema, value) {
  if (!guard_exports.IsArray(value))
    return value;
  const length = Math.min(value.length, schema.items.length);
  for (let index = 0; index < length; index++) {
    value[index] = FromType19(context, schema.items[index], value[index]);
  }
  return guard_exports.IsGreaterThan(value.length, length) ? value.slice(0, length) : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clone/clone.mjs
function Clone2(value) {
  return Clone(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clean/from_union.mjs
function FromUnion9(context, type, value) {
  for (const schema of type.anyOf) {
    const clean = FromType19(context, schema, Clone2(value));
    if (Check2(context, schema, clean))
      return clean;
  }
  return value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clean/from_type.mjs
function FromType19(context, type, value) {
  return IsArray2(type) ? FromArray7(context, type, value) : IsCyclic(type) ? FromCyclic6(context, type, value) : IsIntersect(type) ? FromIntersect6(context, type, value) : IsObject2(type) ? FromObject11(context, type, value) : IsRecord(type) ? FromRecord3(context, type, value) : IsRef2(type) ? FromRef5(context, type, value) : IsTuple(type) ? FromTuple5(context, type, value) : IsUnion(type) ? FromUnion9(context, type, value) : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/shared/union_priority_sort.mjs
function Modifiers(type, next) {
  for (const key of guard_default.Keys(type)) {
    if (guard_default.HasPropertyKey(next, key))
      continue;
    next[key] = type[key];
  }
  return next;
}
function FromProperties4(properties) {
  const result = {};
  for (const key of guard_default.Keys(properties))
    result[key] = FromType20(properties[key]);
  return result;
}
function FromPriorityTypes(types) {
  return FromTypes6(Priority(types));
}
function FromTypes6(types) {
  return types.map((type) => FromType20(type));
}
function FromType20(type) {
  const next = IsArray2(type) ? _Array_(FromType20(type.items), ArrayOptions(type)) : IsIntersect(type) ? Intersect(FromTypes6(type.allOf)) : IsUnion(type) ? Union(FromPriorityTypes(type.anyOf)) : IsObject2(type) ? _Object_(FromProperties4(type.properties)) : IsRecord(type) ? Record(RecordKey(type), FromType20(RecordValue(type))) : IsTuple(type) ? Tuple(FromTypes6(type.items)) : type;
  return Modifiers(type, next);
}
function UnionPrioritySort(type) {
  const result = FromType20(type);
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/clean/clean.mjs
function Clean(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  const sorted = settings_exports.Get().unionPrioritySort ? UnionPrioritySort(type) : type;
  return FromType19(context, sorted, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/try/try.mjs
var try_exports = {};
__export(try_exports, {
  Fail: () => Fail,
  IsOk: () => IsOk,
  Ok: () => Ok,
  TryArray: () => TryArray,
  TryBigInt: () => TryBigInt,
  TryBoolean: () => TryBoolean,
  TryNull: () => TryNull,
  TryNumber: () => TryNumber,
  TryString: () => TryString,
  TryUndefined: () => TryUndefined
});

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/try/try_result.mjs
function IsOk(value) {
  return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "value");
}
function Ok(value) {
  return { value };
}
function Fail() {
  return void 0;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/try/try_array.mjs
function TryArray(value) {
  return guard_exports.IsArray(value) ? Ok(value) : Ok([value]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/try/try_bigint.mjs
function FromBoolean2(value) {
  return guard_exports.IsEqual(value, true) ? Ok(BigInt(1)) : Ok(BigInt(0));
}
var bigintPattern = /^-?(0|[1-9]\d*)n$/;
var decimalPattern = /^-?(0|[1-9]\d*)\.\d+$/;
var integerPattern = /^-?(0|[1-9]\d*)$/;
function IsStringBigIntLike(value) {
  return bigintPattern.test(value);
}
function IsStringDecimalLike(value) {
  return decimalPattern.test(value);
}
function IsStringIntegerLike(value) {
  return integerPattern.test(value);
}
function FromString2(value) {
  const lowercase = value.toLowerCase();
  return IsStringBigIntLike(value) ? Ok(BigInt(value.slice(0, value.length - 1))) : IsStringDecimalLike(value) ? Ok(BigInt(value.split(".")[0])) : IsStringIntegerLike(value) ? Ok(BigInt(value)) : guard_exports.IsEqual(lowercase, "false") ? Ok(BigInt(0)) : guard_exports.IsEqual(lowercase, "true") ? Ok(BigInt(1)) : Fail();
}
function TryBigInt(value) {
  return guard_exports.IsBigInt(value) ? Ok(value) : guard_exports.IsBoolean(value) ? FromBoolean2(value) : guard_exports.IsNumber(value) ? Ok(BigInt(Math.trunc(value))) : guard_exports.IsNull(value) ? Ok(BigInt(0)) : guard_exports.IsString(value) ? FromString2(value) : guard_exports.IsUndefined(value) ? Ok(BigInt(0)) : Fail();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/try/try_boolean.mjs
function FromBigInt2(value) {
  return guard_exports.IsEqual(value, BigInt(0)) ? Ok(false) : guard_exports.IsEqual(value, BigInt(1)) ? Ok(true) : Fail();
}
function FromNumber2(value) {
  return guard_exports.IsEqual(value, 0) ? Ok(false) : guard_exports.IsEqual(value, 1) ? Ok(true) : Fail();
}
function FromString3(value) {
  return guard_exports.IsEqual(value.toLowerCase(), "false") ? Ok(false) : guard_exports.IsEqual(value.toLowerCase(), "true") ? Ok(true) : guard_exports.IsEqual(value, "0") ? Ok(false) : guard_exports.IsEqual(value, "1") ? Ok(true) : Fail();
}
function TryBoolean(value) {
  return guard_exports.IsBigInt(value) ? FromBigInt2(value) : guard_exports.IsBoolean(value) ? Ok(value) : guard_exports.IsNumber(value) ? FromNumber2(value) : guard_exports.IsNull(value) ? Ok(false) : guard_exports.IsString(value) ? FromString3(value) : guard_exports.IsUndefined(value) ? Ok(false) : Fail();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/try/try_null.mjs
function FromBigInt3(value) {
  return guard_exports.IsEqual(value, BigInt(0)) ? Ok(null) : Fail();
}
function FromBoolean3(value) {
  return guard_exports.IsEqual(value, false) ? Ok(null) : Fail();
}
function FromNumber3(value) {
  return guard_exports.IsEqual(value, 0) ? Ok(null) : Fail();
}
function FromString4(value) {
  const lowercase = value.toLowerCase();
  const predicate = guard_exports.IsEqual(lowercase, "undefined") || guard_exports.IsEqual(lowercase, "null") || guard_exports.IsEqual(value, "") || guard_exports.IsEqual(value, "0");
  return predicate ? Ok(null) : Fail();
}
function TryNull(value) {
  return guard_exports.IsBigInt(value) ? FromBigInt3(value) : guard_exports.IsBoolean(value) ? FromBoolean3(value) : guard_exports.IsNumber(value) ? FromNumber3(value) : guard_exports.IsNull(value) ? Ok(null) : guard_exports.IsString(value) ? FromString4(value) : guard_exports.IsUndefined(value) ? Ok(null) : Fail();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/try/try_number.mjs
var maxBigInt = BigInt(Number.MAX_SAFE_INTEGER);
var minBigInt = BigInt(Number.MIN_SAFE_INTEGER);
function FromBigInt4(value) {
  return value <= maxBigInt && value >= minBigInt ? Ok(Number(value)) : Fail();
}
function FromBoolean4(value) {
  return Ok(value ? 1 : 0);
}
function FromString5(value) {
  const coerced = +value;
  if (guard_exports.IsNumber(coerced))
    return Ok(coerced);
  const lowercase = value.toLowerCase();
  if (guard_exports.IsEqual(lowercase, "false"))
    return Ok(0);
  if (guard_exports.IsEqual(lowercase, "true"))
    return Ok(1);
  const result = TryBigInt(value);
  if (IsOk(result))
    return result.value <= maxBigInt && result.value >= minBigInt ? Ok(Number(result.value)) : Fail();
  return Fail();
}
function TryNumber(value) {
  return guard_exports.IsBigInt(value) ? FromBigInt4(value) : guard_exports.IsBoolean(value) ? FromBoolean4(value) : guard_exports.IsNumber(value) ? Ok(value) : guard_exports.IsNull(value) ? Ok(0) : guard_exports.IsString(value) ? FromString5(value) : guard_exports.IsUndefined(value) ? Ok(0) : Fail();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/try/try_string.mjs
function TryString(value) {
  return guard_exports.IsBigInt(value) ? Ok(value.toString()) : guard_exports.IsBoolean(value) ? Ok(value.toString()) : guard_exports.IsNumber(value) ? Ok(value.toString()) : guard_exports.IsNull(value) ? Ok("null") : guard_exports.IsString(value) ? Ok(value) : guard_exports.IsUndefined(value) ? Ok("") : Fail();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/try/try_undefined.mjs
function FromBigInt5(value) {
  return guard_exports.IsEqual(value, BigInt(0)) ? Ok(void 0) : Fail();
}
function FromBoolean5(value) {
  return guard_exports.IsEqual(value, false) ? Ok(void 0) : Fail();
}
function FromNumber4(value) {
  return guard_exports.IsEqual(value, 0) ? Ok(void 0) : Fail();
}
function FromString6(value) {
  const lowercase = value.toLowerCase();
  const predicate = guard_exports.IsEqual(lowercase, "undefined") || guard_exports.IsEqual(lowercase, "null") || guard_exports.IsEqual(value, "") || guard_exports.IsEqual(value, "0");
  return predicate ? Ok(void 0) : Fail();
}
function TryUndefined(value) {
  return guard_exports.IsBigInt(value) ? FromBigInt5(value) : guard_exports.IsBoolean(value) ? FromBoolean5(value) : guard_exports.IsNumber(value) ? FromNumber4(value) : guard_exports.IsNull(value) ? Ok(void 0) : guard_exports.IsString(value) ? FromString6(value) : guard_exports.IsUndefined(value) ? Ok(value) : Fail();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_array.mjs
function FromArray8(context, type, value) {
  const result = try_exports.TryArray(value);
  return result.value.map((value2) => FromType21(context, type.items, value2));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_bigint.mjs
function FromBigInt6(_context, _type, value) {
  const result = try_exports.TryBigInt(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_boolean.mjs
function FromBoolean6(_context, _type, value) {
  const result = try_exports.TryBoolean(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_cyclic.mjs
function FromCyclic7(context, type, value) {
  return FromType21({ ...context, ...type.$defs }, Ref2(type.$ref), value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_enum.mjs
function FromEnum3(context, type, value) {
  return FromType21(context, Evaluate(type), value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_integer.mjs
function FromInteger(_context, _type, value) {
  const result = try_exports.TryNumber(value);
  return try_exports.IsOk(result) ? Math.trunc(result.value) : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_intersect.mjs
function FromIntersect7(context, type, value) {
  const instantiated = Instantiate(context, type);
  const evaluated = Evaluate(instantiated);
  return FromType21(context, evaluated, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_literal.mjs
function FromLiteralBigInt(_context, type, value) {
  const result = try_exports.TryBigInt(value);
  return try_exports.IsOk(result) && guard_exports.IsEqual(type.const, result.value) ? result.value : value;
}
function FromLiteralBoolean(_context, type, value) {
  const result = try_exports.TryBoolean(value);
  return try_exports.IsOk(result) && guard_exports.IsEqual(type.const, result.value) ? result.value : value;
}
function FromLiteralNumber(_context, type, value) {
  const result = try_exports.TryNumber(value);
  return try_exports.IsOk(result) && guard_exports.IsEqual(type.const, result.value) ? result.value : value;
}
function FromLiteralString(_context, type, value) {
  const result = try_exports.TryString(value);
  return try_exports.IsOk(result) && guard_exports.IsEqual(type.const, result.value) ? result.value : value;
}
function FromLiteral6(context, type, value) {
  if (guard_exports.IsEqual(type.const, value))
    return value;
  return IsLiteralBigInt(type) ? FromLiteralBigInt(context, type, value) : IsLiteralBoolean(type) ? FromLiteralBoolean(context, type, value) : IsLiteralNumber(type) ? FromLiteralNumber(context, type, value) : IsLiteralString(type) ? FromLiteralString(context, type, value) : Unreachable();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_null.mjs
function FromNull2(_context, _type, value) {
  const result = try_exports.TryNull(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_number.mjs
function FromNumber5(_context, _type, value) {
  const result = try_exports.TryNumber(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_additional.mjs
function FromAdditionalProperties(context, entries, additionalProperties, value) {
  const keys = guard_exports.Keys(value);
  for (const [regexp, _] of entries) {
    for (const key of keys) {
      if (!regexp.test(key)) {
        value[key] = FromType21(context, additionalProperties, value[key]);
      }
    }
  }
  return value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/shared/optional_undefined.mjs
function IsOptionalUndefined(property, key, value) {
  return IsOptional(property) && guard_exports.IsUndefined(value[key]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_object.mjs
function FromProperties5(context, type, value) {
  const entries = guard_exports.EntriesRegExp(type.properties);
  const keys = guard_exports.Keys(value);
  for (const [regexp, property] of entries) {
    for (const key of keys) {
      if (!regexp.test(key) || IsOptionalUndefined(property, key, value))
        continue;
      value[key] = FromType21(context, property, value[key]);
    }
  }
  return guard_exports.HasPropertyKey(type, "additionalProperties") && guard_exports.IsObject(type.additionalProperties) ? FromAdditionalProperties(context, entries, type.additionalProperties, value) : value;
}
function FromObject12(context, type, value) {
  return guard_exports.IsObjectNotArray(value) ? FromProperties5(context, type, value) : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_record.mjs
function FromPatternProperties(context, type, value) {
  const entries = guard_exports.EntriesRegExp(type.patternProperties);
  const keys = guard_exports.Keys(value);
  for (const [regexp, schema] of entries) {
    for (const key of keys) {
      if (regexp.test(key)) {
        value[key] = FromType21(context, schema, value[key]);
      }
    }
  }
  return guard_exports.HasPropertyKey(type, "additionalProperties") && guard_exports.IsObject(type.additionalProperties) ? FromAdditionalProperties(context, entries, type.additionalProperties, value) : value;
}
function FromRecord4(context, type, value) {
  return guard_exports.IsObjectNotArray(value) ? FromPatternProperties(context, type, value) : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_ref.mjs
function FromRef6(context, type, value) {
  return guard_exports.HasPropertyKey(context, type.$ref) ? FromType21(context, context[type.$ref], value) : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_string.mjs
function FromString7(_context, _type, value) {
  const result = try_exports.TryString(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_template_literal.mjs
function FromTemplateLiteral4(context, type, value) {
  return FromType21(context, Evaluate(type), value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_tuple.mjs
function FromTuple6(context, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  for (let index = 0; index < Math.min(type.items.length, value.length); index++) {
    value[index] = FromType21(context, type.items[index], value[index]);
  }
  return value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_undefined.mjs
function FromUndefined2(_context, _type, value) {
  const result = try_exports.TryUndefined(value);
  return try_exports.IsOk(result) ? result.value : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_union.mjs
function FromUnion10(context, type, value) {
  const matched = type.anyOf.some((type2) => Check2(context, type2, value));
  if (matched)
    return value;
  const candidates = type.anyOf.map((type2) => FromType21(context, type2, Clone2(value)));
  const selected = candidates.find((value2) => Check2(context, type, value2));
  return guard_exports.IsUndefined(selected) ? value : selected;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_void.mjs
function FromVoid(_context, _type, value) {
  const result = try_exports.TryUndefined(value);
  return try_exports.IsOk(result) ? void 0 : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/from_type.mjs
function FromType21(context, type, value) {
  return IsArray2(type) ? FromArray8(context, type, value) : IsBigInt2(type) ? FromBigInt6(context, type, value) : IsBoolean3(type) ? FromBoolean6(context, type, value) : IsCyclic(type) ? FromCyclic7(context, type, value) : IsEnum2(type) ? FromEnum3(context, type, value) : IsInteger2(type) ? FromInteger(context, type, value) : IsIntersect(type) ? FromIntersect7(context, type, value) : IsLiteral(type) ? FromLiteral6(context, type, value) : IsNull2(type) ? FromNull2(context, type, value) : IsNumber3(type) ? FromNumber5(context, type, value) : IsObject2(type) ? FromObject12(context, type, value) : IsRecord(type) ? FromRecord4(context, type, value) : IsRef2(type) ? FromRef6(context, type, value) : IsString3(type) ? FromString7(context, type, value) : IsTemplateLiteral(type) ? FromTemplateLiteral4(context, type, value) : IsTuple(type) ? FromTuple6(context, type, value) : IsUndefined2(type) ? FromUndefined2(context, type, value) : IsUnion(type) ? FromUnion10(context, type, value) : IsVoid(type) ? FromVoid(context, type, value) : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/convert/convert.mjs
function Convert(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  return FromType21(context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/default/from_array.mjs
function FromArray9(context, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  for (let i = 0; i < value.length; i++) {
    value[i] = FromType22(context, type.items, value[i]);
  }
  return value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/default/from_cyclic.mjs
function FromCyclic8(context, type, value) {
  return FromType22({ ...context, ...type.$defs }, Ref2(type.$ref), value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/default/from_default.mjs
function FromDefault(type, value) {
  if (!guard_exports.IsUndefined(value))
    return value;
  return guard_exports.IsFunction(type.default) ? type.default() : Clone2(type.default);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/default/from_intersect.mjs
function FromIntersect8(context, type, value) {
  const instantiated = Instantiate(context, type);
  const evaluated = Evaluate(instantiated);
  return FromType22(context, evaluated, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/default/from_object.mjs
function FromObject13(context, type, value) {
  if (!guard_exports.IsObject(value))
    return value;
  const knownPropertyKeys = guard_exports.Keys(type.properties);
  for (const key of knownPropertyKeys) {
    const propertyValue = FromType22(context, type.properties[key], value[key]);
    const isUnassignableUndefined = guard_exports.IsUndefined(propertyValue) && (IsOptional(type.properties[key]) || !guard_exports.HasPropertyKey(type.properties[key], "default"));
    if (isUnassignableUndefined)
      continue;
    value[key] = propertyValue;
  }
  if (!IsAdditionalProperties(type) || guard_exports.IsBoolean(type.additionalProperties))
    return value;
  for (const key of guard_exports.Keys(value)) {
    if (knownPropertyKeys.includes(key))
      continue;
    value[key] = FromType22(context, type.additionalProperties, value[key]);
  }
  return value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/default/from_record.mjs
function FromRecord5(context, type, value) {
  if (!guard_exports.IsObject(value))
    return value;
  const [recordKey, recordValue] = [new RegExp(RecordPattern(type)), RecordValue(type)];
  for (const key of guard_exports.Keys(value)) {
    if (!(recordKey.test(key) && IsDefault(recordValue)))
      continue;
    value[key] = FromType22(context, recordValue, value[key]);
  }
  if (!IsAdditionalProperties(type))
    return value;
  for (const key of guard_exports.Keys(value)) {
    if (recordKey.test(key))
      continue;
    value[key] = FromType22(context, type.additionalProperties, value[key]);
  }
  return value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/default/from_ref.mjs
function FromRef7(context, type, value) {
  return guard_exports.HasPropertyKey(context, type.$ref) ? FromType22(context, context[type.$ref], value) : value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/default/from_tuple.mjs
function FromTuple7(context, schema, value) {
  if (!guard_exports.IsArray(value))
    return value;
  const [items, max] = [schema.items, Math.max(schema.items.length, value.length)];
  for (let i = 0; i < max; i++) {
    if (i < items.length)
      value[i] = FromType22(context, items[i], value[i]);
  }
  return value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/default/from_union.mjs
function FromUnion11(context, schema, value) {
  for (const inner of schema.anyOf) {
    const result = FromType22(context, inner, Clone2(value));
    if (Check2(context, inner, result)) {
      return result;
    }
  }
  return value;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/default/from_type.mjs
function FromType22(context, type, value) {
  const defaulted = IsDefault(type) ? FromDefault(type, value) : value;
  return IsArray2(type) ? FromArray9(context, type, defaulted) : IsCyclic(type) ? FromCyclic8(context, type, defaulted) : IsIntersect(type) ? FromIntersect8(context, type, defaulted) : IsObject2(type) ? FromObject13(context, type, defaulted) : IsRecord(type) ? FromRecord5(context, type, defaulted) : IsRef2(type) ? FromRef7(context, type, defaulted) : IsTuple(type) ? FromTuple7(context, type, defaulted) : IsUnion(type) ? FromUnion11(context, type, defaulted) : defaulted;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/default/default.mjs
function Default(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  return FromType22(context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/pipeline/pipeline.mjs
function Pipeline(pipeline) {
  return (...args) => {
    const [context, type, value] = arguments_exports.Match(args, {
      3: (context2, type2, value2) => [context2, type2, value2],
      2: (type2, value2) => [{}, type2, value2]
    });
    return pipeline.reduce((result, func) => func(context, type, result), value);
  };
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/callback.mjs
function Decode3(_context, type, value) {
  return type["~codec"].decode(value);
}
function Encode2(_context, type, value) {
  return type["~codec"].encode(value);
}
function Callback(direction, context, type, value) {
  if (!IsCodec(type))
    return value;
  return guard_exports.IsEqual(direction, "Decode") ? Decode3(context, type, value) : Encode2(context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/from_array.mjs
function Decode4(direction, context, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  for (let i = 0; i < value.length; i++) {
    value[i] = FromType23(direction, context, type.items, value[i]);
  }
  return Callback(direction, context, type, value);
}
function Encode3(direction, context, type, value) {
  const exterior = Callback(direction, context, type, value);
  if (!guard_exports.IsArray(exterior))
    return exterior;
  for (let i = 0; i < exterior.length; i++) {
    exterior[i] = FromType23(direction, context, type.items, exterior[i]);
  }
  return exterior;
}
function FromArray10(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode4(direction, context, type, value) : Encode3(direction, context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/from_cyclic.mjs
function FromCyclic9(direction, context, type, value) {
  value = FromType23(direction, { ...context, ...type.$defs }, Ref2(type.$ref), value);
  return Callback(direction, context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/from_intersect.mjs
function MergeInteriors(interiors) {
  return interiors.reduce((results, interior) => ({ ...results, ...interior }), {});
}
function NonMatchingInterior(value, interiors) {
  for (const interior of interiors)
    if (!guard_exports.IsDeepEqual(value, interior))
      return interior;
  return value;
}
function Decode5(direction, context, type, value) {
  if (guard_exports.IsEqual(type.allOf.length, 0))
    return Callback(direction, context, type, value);
  const interiors = type.allOf.map((schema) => FromType23(direction, context, schema, Clean(schema, Clone2(value))));
  const structural = interiors.every((result) => guard_exports.IsObject(result));
  const exterior = structural ? MergeInteriors(interiors) : NonMatchingInterior(value, interiors);
  return Callback(direction, context, type, exterior);
}
function Encode4(direction, context, type, value) {
  if (guard_exports.IsEqual(type.allOf.length, 0))
    return Callback(direction, context, type, value);
  const exterior = Callback(direction, context, type, value);
  const interiors = type.allOf.map((schema) => FromType23(direction, context, schema, Clean(schema, Clone2(exterior))));
  const structural = interiors.every((result) => guard_exports.IsObject(result));
  if (structural)
    return MergeInteriors(interiors);
  return NonMatchingInterior(exterior, interiors);
}
function FromIntersect9(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode5(direction, context, type, value) : Encode4(direction, context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/from_object.mjs
function Decode6(direction, context, type, value) {
  if (!guard_exports.IsObjectNotArray(value))
    return value;
  for (const key of guard_exports.Keys(type.properties)) {
    if (!guard_exports.HasPropertyKey(value, key) || IsOptionalUndefined(type.properties[key], key, value))
      continue;
    value[key] = FromType23(direction, context, type.properties[key], value[key]);
  }
  return Callback(direction, context, type, value);
}
function Encode5(direction, context, type, value) {
  const exterior = Callback(direction, context, type, value);
  if (!guard_exports.IsObjectNotArray(exterior))
    return exterior;
  for (const key of guard_exports.Keys(type.properties)) {
    if (!guard_exports.HasPropertyKey(exterior, key) || IsOptionalUndefined(type.properties[key], key, exterior))
      continue;
    exterior[key] = FromType23(direction, context, type.properties[key], exterior[key]);
  }
  return exterior;
}
function FromObject14(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode6(direction, context, type, value) : Encode5(direction, context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/from_record.mjs
function Decode7(direction, context, type, value) {
  if (!guard_exports.IsObjectNotArray(value))
    return value;
  const regexp = new RegExp(RecordPattern(type));
  for (const key of guard_exports.Keys(value)) {
    if (!regexp.test(key))
      continue;
    value[key] = FromType23(direction, context, RecordValue(type), value[key]);
  }
  return Callback(direction, context, type, value);
}
function Encode6(direction, context, type, value) {
  const exterior = Callback(direction, context, type, value);
  if (!guard_exports.IsObjectNotArray(exterior))
    return exterior;
  const regexp = new RegExp(RecordPattern(type));
  for (const key of guard_exports.Keys(exterior)) {
    if (!regexp.test(key))
      continue;
    exterior[key] = FromType23(direction, context, RecordValue(type), exterior[key]);
  }
  return exterior;
}
function FromRecord6(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode7(direction, context, type, value) : Encode6(direction, context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/from_ref.mjs
function ResolveRef(direction, context, type, value) {
  return guard_exports.HasPropertyKey(context, type.$ref) ? FromType23(direction, context, context[type.$ref], value) : value;
}
function FromRef8(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Callback(direction, context, type, ResolveRef(direction, context, type, value)) : ResolveRef(direction, context, type, Callback(direction, context, type, value));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/from_tuple.mjs
function Decode8(direction, context, type, value) {
  if (!guard_exports.IsArray(value))
    return value;
  for (let i = 0; i < Math.min(type.items.length, value.length); i++) {
    value[i] = FromType23(direction, context, type.items[i], value[i]);
  }
  return Callback(direction, context, type, value);
}
function Encode7(direction, context, type, value) {
  const exterior = Callback(direction, context, type, value);
  if (!guard_exports.IsArray(exterior))
    return value;
  for (let i = 0; i < Math.min(type.items.length, exterior.length); i++) {
    exterior[i] = FromType23(direction, context, type.items[i], exterior[i]);
  }
  return exterior;
}
function FromTuple8(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode8(direction, context, type, value) : Encode7(direction, context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/from_union.mjs
function Decode9(direction, context, type, value) {
  for (const schema of type.anyOf) {
    if (!Check2(context, schema, value))
      continue;
    const variant2 = FromType23(direction, context, schema, value);
    return Callback(direction, context, type, variant2);
  }
  return value;
}
function Encode8(direction, context, type, value) {
  const exterior = Callback(direction, context, type, value);
  for (const schema of type.anyOf) {
    const variant2 = FromType23(direction, context, schema, Clone2(exterior));
    if (!Check2(context, schema, variant2))
      continue;
    return variant2;
  }
  return exterior;
}
function FromUnion12(direction, context, type, value) {
  return guard_exports.IsEqual(direction, "Decode") ? Decode9(direction, context, type, value) : Encode8(direction, context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/from_type.mjs
function FromType23(direction, context, type, value) {
  return IsArray2(type) ? FromArray10(direction, context, type, value) : IsCyclic(type) ? FromCyclic9(direction, context, type, value) : IsIntersect(type) ? FromIntersect9(direction, context, type, value) : IsObject2(type) ? FromObject14(direction, context, type, value) : IsRecord(type) ? FromRecord6(direction, context, type, value) : IsRef2(type) ? FromRef8(direction, context, type, value) : IsTuple(type) ? FromTuple8(direction, context, type, value) : IsUnion(type) ? FromUnion12(direction, context, type, value) : Callback(direction, context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/decode.mjs
var DecodeError = class extends AssertError {
  constructor(value, errors) {
    super("Decode", value, errors);
  }
};
function Assert2(context, type, value) {
  if (!Check2(context, type, value))
    throw new DecodeError(value, Errors2(context, type, value));
  return value;
}
function DecodeUnsafe(context, type, value) {
  const sorted = settings_exports.Get().unionPrioritySort ? UnionPrioritySort(type) : type;
  return FromType23("Decode", context, sorted, value);
}
var Decoder = Pipeline([
  (_context, _type, value) => Clone2(value),
  (context, type, value) => Default(context, type, value),
  (context, type, value) => Convert(context, type, value),
  (context, type, value) => Clean(context, type, value),
  (context, type, value) => Assert2(context, type, value),
  (context, type, value) => DecodeUnsafe(context, type, value)
]);
function Decode10(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  return Decoder(context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/encode.mjs
var EncodeError = class extends AssertError {
  constructor(value, errors) {
    super("Encode", value, errors);
  }
};
function Assert3(context, type, value) {
  if (!Check2(context, type, value))
    throw new EncodeError(value, Errors2(context, type, value));
  return value;
}
function EncodeUnsafe(context, type, value) {
  const sorted = settings_exports.Get().unionPrioritySort ? UnionPrioritySort(type) : type;
  return FromType23("Encode", context, sorted, value);
}
var Encoder = Pipeline([
  (_context, _type, value) => Clone2(value),
  (context, type, value) => EncodeUnsafe(context, type, value),
  (context, type, value) => Default(context, type, value),
  (context, type, value) => Convert(context, type, value),
  (context, type, value) => Clean(context, type, value),
  (context, type, value) => Assert3(context, type, value)
]);
function Encode9(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  return Encoder(context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/codec/has.mjs
function FromArray11(context, type) {
  return IsCodec(type) || FromType24(context, type.items);
}
function FromCyclic10(context, type) {
  return IsCodec(type) || FromRef9({ ...context, ...type.$defs }, Ref2(type.$ref));
}
function FromIntersect10(context, type) {
  return IsCodec(type) || type.allOf.some((type2) => FromType24(context, type2));
}
function FromObject15(context, type) {
  return IsCodec(type) || guard_exports.Keys(type.properties).some((key) => {
    return FromType24(context, type.properties[key]);
  });
}
function FromRecord7(context, type) {
  return IsCodec(type) || FromType24(context, RecordValue(type));
}
function FromRef9(context, type) {
  if (visited.has(type.$ref))
    return false;
  visited.add(type.$ref);
  return IsCodec(type) || guard_exports.HasPropertyKey(context, type.$ref) && FromType24(context, context[type.$ref]);
}
function FromTuple9(context, type) {
  return IsCodec(type) || type.items.some((type2) => FromType24(context, type2));
}
function FromUnion13(context, type) {
  return IsCodec(type) || type.anyOf.some((type2) => FromType24(context, type2));
}
function FromType24(context, type) {
  return IsArray2(type) ? FromArray11(context, type) : IsCyclic(type) ? FromCyclic10(context, type) : IsIntersect(type) ? FromIntersect10(context, type) : IsObject2(type) ? FromObject15(context, type) : IsRecord(type) ? FromRecord7(context, type) : IsRef2(type) ? FromRef9(context, type) : IsTuple(type) ? FromTuple9(context, type) : IsUnion(type) ? FromUnion13(context, type) : IsCodec(type);
}
var visited = /* @__PURE__ */ new Set();
function HasCodec(...args) {
  const [context, type] = arguments_exports.Match(args, {
    2: (context2, type2) => [context2, type2],
    1: (type2) => [{}, type2]
  });
  visited.clear();
  return FromType24(context, type);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/error.mjs
var CreateError = class extends Error {
  constructor(type, message) {
    super(message);
    this.type = type;
  }
};

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_default.mjs
function FromDefault2(_context, schema) {
  return guard_exports.IsFunction(schema.default) ? schema.default(schema) : guard_exports.IsObject(schema.default) ? Clone2(schema.default) : schema.default;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_array.mjs
function FromArray12(context, type) {
  if (IsUniqueItems(type) && !IsDefault(type))
    throw new CreateError(type, "Arrays with uniqueItems constraints must specify a default annotation");
  const length = IsMinItems(type) ? type.minItems : 0;
  return Array.from({ length }, () => FromType25(context, type.items));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_bigint.mjs
function FromBigInt7(_context, type) {
  return IsExclusiveMinimum(type) ? BigInt(type.exclusiveMinimum) + BigInt(1) : IsMinimum(type) ? BigInt(type.minimum) : BigInt(0);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_boolean.mjs
function FromBoolean7(_context, _type) {
  return false;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_constructor.mjs
function FromConstructor2(context, type) {
  const instanceType = FromType25(context, type.instanceType);
  return class {
    constructor() {
      Object.assign(this, instanceType);
    }
  };
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_cyclic.mjs
function FromCyclic11(context, type) {
  return FromType25({ ...context, ...type.$defs }, Ref2(type.$ref));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_enum.mjs
function FromEnum4(context, type) {
  return FromType25(context, Evaluate(type));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_function.mjs
function FromFunction2(context, type) {
  const returnType = FromType25(context, type.returnType);
  return () => returnType;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_integer.mjs
function FromInteger2(_context, type) {
  return IsExclusiveMinimum(type) && guard_exports.IsNumber(type.exclusiveMinimum) ? type.exclusiveMinimum + 1 : IsMinimum(type) ? type.minimum : 0;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_intersect.mjs
function FromIntersect11(context, type) {
  const instantiated = Instantiate(context, type);
  const evaluated = Evaluate(instantiated);
  return FromType25(context, evaluated);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_literal.mjs
function FromLiteral7(_context, type) {
  return type.const;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_never.mjs
function FromNever(_context, type) {
  throw new CreateError(type, "Cannot create TNever types");
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_null.mjs
function FromNull3(_context, _type) {
  return null;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_number.mjs
function FromNumber6(_context, type) {
  return IsExclusiveMinimum(type) && guard_exports.IsNumber(type.exclusiveMinimum) ? type.exclusiveMinimum + 1 : IsMinimum(type) ? type.minimum : 0;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_object.mjs
function FromObject16(context, type) {
  const required = guard_exports.IsUndefined(type.required) ? [] : type.required;
  return required.reduce((result, key) => {
    return { ...result, [key]: FromType25(context, type.properties[key]) };
  }, {});
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_record.mjs
function FromRecord8(_context, type) {
  if (IsMinProperties(type) && !IsDefault(type))
    throw new CreateError(type, "Record with the minProperties constraint must have a default annotation");
  return {};
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_ref.mjs
function FromRef10(context, type) {
  return guard_exports.HasPropertyKey(context, type.$ref) ? FromType25(context, context[type.$ref]) : (() => {
    throw new CreateError(type, "Unable to deref Ref");
  })();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_string.mjs
function FromString8(_context, type) {
  const needsDefault = (IsPattern(type) || IsFormat(type)) && !IsDefault(type);
  if (needsDefault)
    throw Error("Strings with format or pattern constraints must specify default");
  const minLength = IsMinLength3(type) ? type.minLength : 0;
  return "".padEnd(minLength);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_symbol.mjs
function FromSymbol2(_context, _type) {
  return Symbol();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_template_literal.mjs
function FromTemplateLiteral5(context, type) {
  const decoded = TemplateLiteralDecode(type.pattern);
  if (IsString3(decoded))
    throw new CreateError(type, "Unable to create TemplateLiteral due to infinite type expansion");
  return FromType25(context, decoded);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_tuple.mjs
function FromTuple10(context, type) {
  return Array.from({ length: type.minItems }, (_, i) => FromType25(context, type.items[i]));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_undefined.mjs
function FromUndefined3(_context, _type) {
  return void 0;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_union.mjs
function FromUnion14(context, type) {
  if (guard_exports.IsEqual(type.anyOf.length, 0)) {
    throw Error("Unable to create Union with no variants");
  }
  return FromType25(context, type.anyOf[0]);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_void.mjs
function FromVoid2(_context, _type) {
  return void 0;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/from_type.mjs
function FromType25(context, type) {
  return (
    // -----------------------------------------------------
    // Default
    // -----------------------------------------------------
    IsDefault(type) ? FromDefault2(context, type) : (
      // -----------------------------------------------------
      // Types
      // -----------------------------------------------------
      IsArray2(type) ? FromArray12(context, type) : IsBigInt2(type) ? FromBigInt7(context, type) : IsBoolean3(type) ? FromBoolean7(context, type) : IsConstructor2(type) ? FromConstructor2(context, type) : IsCyclic(type) ? FromCyclic11(context, type) : IsEnum2(type) ? FromEnum4(context, type) : IsFunction2(type) ? FromFunction2(context, type) : IsInteger2(type) ? FromInteger2(context, type) : IsIntersect(type) ? FromIntersect11(context, type) : IsLiteral(type) ? FromLiteral7(context, type) : IsNever(type) ? FromNever(context, type) : IsNull2(type) ? FromNull3(context, type) : IsNumber3(type) ? FromNumber6(context, type) : IsObject2(type) ? FromObject16(context, type) : IsRecord(type) ? FromRecord8(context, type) : IsRef2(type) ? FromRef10(context, type) : IsString3(type) ? FromString8(context, type) : IsSymbol2(type) ? FromSymbol2(context, type) : IsTemplateLiteral(type) ? FromTemplateLiteral5(context, type) : IsTuple(type) ? FromTuple10(context, type) : IsUndefined2(type) ? FromUndefined3(context, type) : IsUnion(type) ? FromUnion14(context, type) : IsVoid(type) ? FromVoid2(context, type) : void 0
    )
  );
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/create/create.mjs
function Create2(...args) {
  const [context, type] = arguments_exports.Match(args, {
    2: (context2, type2) => [context2, type2],
    1: (type2) => [{}, type2]
  });
  return FromType25(context, type);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/equal/equal.mjs
function Equal(left, right) {
  return guard_exports.IsDeepEqual(left, right);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/hash/hash.mjs
function Hash2(value) {
  return hash_exports.Hash(value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/parse/parse.mjs
var ParseError2 = class extends AssertError {
  constructor(value, errors) {
    super("Parse", value, errors);
  }
};
function Assert4(context, type, value) {
  if (!Check2(context, type, value))
    throw new ParseError2(value, Errors2(context, type, value));
  return value;
}
var Parser = Pipeline([
  (_context, _type, value) => Clone2(value),
  (context, type, value) => Default(context, type, value),
  (context, type, value) => Convert(context, type, value),
  (context, type, value) => Clean(context, type, value),
  (context, type, value) => Assert4(context, type, value)
]);
function Parse(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  const checked = Check2(context, type, value);
  if (checked)
    return value;
  if (settings_exports.Get().correctiveParse)
    return Parser(context, type, value);
  throw new ParseError2(value, Errors2(context, type, value));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/delta/diff.mjs
function CreateUpdate(path9, value) {
  return { type: "update", path: path9, value };
}
function CreateInsert(path9, value) {
  return { type: "insert", path: path9, value };
}
function CreateDelete(path9) {
  return { type: "delete", path: path9 };
}
function AssertCanDiffObject(value) {
  if (guard_exports.IsObject(value) && guard_exports.IsEqual(guard_exports.Symbols(value).length, 0))
    return;
  throw new Error("Cannot create diffs for objects with symbols keys");
}
function* FromObject17(path9, left, right) {
  if (!guard_exports.IsObject(right) || guard_exports.IsArray(right))
    return yield CreateUpdate(path9, right);
  AssertCanDiffObject(left);
  AssertCanDiffObject(right);
  const leftKeys = guard_exports.Keys(left);
  const rightKeys = guard_exports.Keys(right);
  for (const key of rightKeys) {
    if (guard_exports.HasPropertyKey(left, key))
      continue;
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    yield CreateInsert(`${path9}/${key}`, right[key]);
  }
  for (const key of leftKeys) {
    if (!guard_exports.HasPropertyKey(right, key))
      continue;
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    if (Equal(left, right))
      continue;
    yield* FromValue4(`${path9}/${key}`, left[key], right[key]);
  }
  for (const key of leftKeys) {
    if (guard_exports.HasPropertyKey(right, key))
      continue;
    if (guard_exports.IsUnsafePropertyKey(key))
      continue;
    yield CreateDelete(`${path9}/${key}`);
  }
}
function* FromArray13(path9, left, right) {
  if (!guard_exports.IsArray(right))
    return yield CreateUpdate(path9, right);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    yield* FromValue4(`${path9}/${i}`, left[i], right[i]);
  }
  for (let i = 0; i < right.length; i++) {
    if (i < left.length)
      continue;
    yield CreateInsert(`${path9}/${i}`, right[i]);
  }
  for (let i = left.length - 1; i >= 0; i--) {
    if (i < right.length)
      continue;
    yield CreateDelete(`${path9}/${i}`);
  }
}
function* FromTypedArray2(path9, left, right) {
  const typeLeft = globalThis.Object.getPrototypeOf(left).constructor.name;
  const typeRight = globalThis.Object.getPrototypeOf(right).constructor.name;
  const predicate = globals_exports.IsTypeArray(right) && guard_exports.IsEqual(left.length, right.length) && guard_exports.IsEqual(typeLeft, typeRight);
  if (predicate) {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
      yield* FromValue4(`${path9}/${index}`, left[index], right[index]);
    }
  } else {
    return yield CreateUpdate(path9, right);
  }
}
function* FromUnknown(path9, left, right) {
  if (left === right)
    return;
  yield CreateUpdate(path9, right);
}
function* FromValue4(path9, left, right) {
  return globals_exports.IsTypeArray(left) ? yield* FromTypedArray2(path9, left, right) : guard_exports.IsArray(left) ? yield* FromArray13(path9, left, right) : guard_exports.IsObject(left) ? yield* FromObject17(path9, left, right) : yield* FromUnknown(path9, left, right);
}
function Diff(current, next) {
  return [...FromValue4("", current, next)];
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/delta/edit.mjs
var Insert2 = _Object_({
  type: Literal("insert"),
  path: String2(),
  value: Unknown()
});
var Update2 = Object({
  type: Literal("update"),
  path: String2(),
  value: Unknown()
});
var Delete2 = _Object_({
  type: Literal("delete"),
  path: String2()
});
var Edit = Union([Insert2, Update2, Delete2]);

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/delta/patch.mjs
function IsRoot(edits) {
  return edits.length > 0 && edits[0].path === "" && edits[0].type === "update";
}
function IsEmpty(edits) {
  return edits.length === 0;
}
function Patch(current, edits) {
  if (IsRoot(edits))
    return Clone2(edits[0].value);
  if (IsEmpty(edits))
    return Clone2(current);
  const clone = Clone2(current);
  for (const edit of edits) {
    switch (edit.type) {
      case "insert": {
        pointer_exports.Set(clone, edit.path, edit.value);
        break;
      }
      case "update": {
        pointer_exports.Set(clone, edit.path, edit.value);
        break;
      }
      case "delete": {
        pointer_exports.Delete(clone, edit.path);
        break;
      }
    }
  }
  return clone;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/error.mjs
var RepairError = class extends Error {
  constructor(context, type, value, message) {
    super(message);
    this.context = context;
    this.type = type;
    this.value = value;
  }
};

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/from_array.mjs
function MakeUnique(values) {
  const [hashes, result] = [/* @__PURE__ */ new Set(), []];
  for (const value of values) {
    const hash = Hash2(value);
    if (hashes.has(hash))
      continue;
    hashes.add(hash);
    result.push(value);
  }
  return result;
}
function FromArray14(context, type, value) {
  if (Check2(context, type, value))
    return value;
  const created = guard_exports.IsArray(value) ? value : Create2(context, type);
  const minimum = IsMinItems(type) && created.length < type.minItems ? [...created, ...Array.from({ length: type.minItems - created.length }, () => Create2(context, type))] : created;
  const maximum = IsMaxItems(type) && minimum.length > type.maxItems ? minimum.slice(0, type.maxItems) : minimum;
  const repaired = maximum.map((value2) => FromType26(context, type.items, value2));
  if (!IsUniqueItems(type) || IsUniqueItems(type) && !guard_exports.IsEqual(type.uniqueItems, true))
    return repaired;
  const unique = MakeUnique(repaired);
  if (!Check2(context, type, unique))
    throw new RepairError(context, type, value, "Failed to repair Array due to uniqueItems constraint");
  return unique;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/from_enum.mjs
function FromEnum5(context, type, value) {
  return FromType26(context, Evaluate(type), value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/from_intersect.mjs
function FromIntersect12(context, type, value) {
  const instantiated = Instantiate(context, type);
  const evaluated = Evaluate(instantiated);
  return FromType26(context, evaluated, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/from_object.mjs
function FromObject18(context, type, value) {
  if (Check2(context, type, value))
    return value;
  if (!guard_exports.IsObjectNotArray(value))
    return Create2(context, type);
  const required = new Set(guard_exports.IsUndefined(type.required) ? [] : type.required);
  const result = {};
  for (const [key, schema] of guard_exports.Entries(type.properties)) {
    if (!required.has(key) && guard_exports.IsUndefined(value[key]))
      continue;
    result[key] = key in value ? FromType26(context, schema, value[key]) : Create2(context, schema);
  }
  const evaluatedKeys = guard_exports.Keys(type.properties);
  if (IsAdditionalProperties(type) && guard_exports.IsObject(type.additionalProperties)) {
    for (const key of guard_exports.Keys(value)) {
      if (evaluatedKeys.includes(key))
        continue;
      result[key] = FromType26(context, type.additionalProperties, value[key]);
    }
  }
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/from_record.mjs
function FromRecord9(context, type, value) {
  if (Check2(context, type, value))
    return value;
  if (guard_exports.IsNull(value) || !guard_exports.IsObject(value) || guard_exports.IsArray(value))
    return Create2(context, type);
  const recordKey = new RegExp(RecordPattern(type));
  const recordValue = RecordValue(type);
  const evaluatedKeys = /* @__PURE__ */ new Set();
  const result = {};
  for (const [key, value_] of guard_exports.Entries(value)) {
    if (!recordKey.test(key))
      continue;
    result[key] = FromType26(context, recordValue, value_);
    evaluatedKeys.add(key);
  }
  if (IsAdditionalProperties(type)) {
    for (const key of guard_exports.Keys(value)) {
      if (evaluatedKeys.has(key))
        continue;
      result[key] = FromType26(context, type.additionalProperties, value[key]);
    }
  }
  return result;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/from_ref.mjs
function FromRef11(context, type, value) {
  return guard_exports.HasPropertyKey(context, type.$ref) ? FromType26(context, context[type.$ref], value) : (() => {
    throw new RepairError(context, type, value, "Unable to de-reference target type");
  })();
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/from_template_literal.mjs
function FromTemplateLiteral6(context, type, value) {
  const decoded = TemplateLiteralDecode(type.pattern);
  return FromType26(context, decoded, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/from_tuple.mjs
function FromTuple11(context, schema, value) {
  if (Check2(context, schema, value))
    return value;
  if (!guard_exports.IsArray(value))
    return Create2(context, schema);
  return schema.items.map((schema2, index) => FromType26(context, schema2, value[index]));
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/shared/union_score_select.mjs
function Deref(context, type, value) {
  return IsRef2(type) ? guard_exports.HasPropertyKey(context, type.$ref) ? Deref(context, context[type.$ref], value) : (() => {
    throw new Error("Unable to Deref target");
  })() : type;
}
function ScoreVariant(context, type, value) {
  if (!(IsObject2(type) && guard_exports.IsObject(value)))
    return 0;
  const keys = guard_exports.Keys(value);
  const entries = guard_exports.Entries(type.properties);
  return entries.reduce((result, [key, schema]) => {
    const literal = IsLiteral(schema) && guard_exports.IsEqual(schema.const, value[key]) ? 100 : 0;
    const checks = Check2(context, schema, value[key]) ? 10 : 0;
    const exists = keys.includes(key) ? 1 : 0;
    return result + (literal + checks + exists);
  }, 0);
}
function UnionScoreSelect(context, type, value) {
  const schemas = type.anyOf.map((schema) => Deref(context, schema, value));
  let [select, best] = [schemas[0], 0];
  for (const schema of schemas) {
    const score = ScoreVariant(context, schema, value);
    if (score > best) {
      select = schema;
      best = score;
    }
  }
  return select;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/from_union.mjs
function RepairUnion(context, type, value) {
  const union = Union(Flatten(type.anyOf));
  const schema = UnionScoreSelect(context, union, value);
  return FromType26(context, schema, value);
}
function FromUnion15(context, type, value) {
  if (Check2(context, type, value))
    return Clone2(value);
  if (IsDefault(type))
    return Create2(context, type);
  return RepairUnion(context, type, value);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/from_unknown.mjs
function FromUnknown2(context, type, value) {
  if (Check2(context, type, value))
    return value;
  const converted = Convert(context, type, value);
  if (Check2(context, type, converted))
    return converted;
  return Create2(context, type);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/from_type.mjs
function AssertRepairableValue(context, type, value) {
  const unsupported = globals_exports.IsDate(value) || globals_exports.IsMap(value) || globals_exports.IsSet(value) || globals_exports.IsTypeArray(value) || guard_exports.IsConstructor(value) || guard_exports.IsFunction(value);
  if (unsupported) {
    throw new RepairError(context, type, value, "Value is not repairable");
  }
}
function AssertRepairableType(context, type, value) {
  const unsupported = IsConstructor2(type) || IsFunction2(type) || IsNever(type);
  if (unsupported) {
    throw new RepairError(context, type, value, "Type is not repairable");
  }
}
function CreateWhenUndefined(context, type, value) {
  return guard_exports.IsUndefined(value) && !IsUndefined2(type) ? Create2(context, type) : value;
}
function FinalizeRepair(context, type, repaired) {
  return IsRefine2(type) ? Check2(context, type, repaired) ? repaired : Create2(context, type) : repaired;
}
function FromType26(context, type, value) {
  AssertRepairableValue(context, type, value);
  AssertRepairableType(context, type, value);
  const candidate = CreateWhenUndefined(context, type, value);
  const repaired = IsArray2(type) ? FromArray14(context, type, candidate) : IsEnum2(type) ? FromEnum5(context, type, candidate) : IsIntersect(type) ? FromIntersect12(context, type, candidate) : IsObject2(type) ? FromObject18(context, type, candidate) : IsRecord(type) ? FromRecord9(context, type, candidate) : IsRef2(type) ? FromRef11(context, type, candidate) : IsTemplateLiteral(type) ? FromTemplateLiteral6(context, type, candidate) : IsTuple(type) ? FromTuple11(context, type, candidate) : IsUnion(type) ? FromUnion15(context, type, candidate) : FromUnknown2(context, type, candidate);
  return FinalizeRepair(context, type, repaired);
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/repair/repair.mjs
function Repair(...args) {
  const [context, type, value] = arguments_exports.Match(args, {
    3: (context2, type2, value2) => [context2, type2, value2],
    2: (type2, value2) => [{}, type2, value2]
  });
  const repaired = FromType26(context, type, value);
  Assert(context, type, repaired);
  return repaired;
}

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/value/value.mjs
var value_exports = {};
__export(value_exports, {
  Assert: () => Assert,
  Check: () => Check2,
  Clean: () => Clean,
  Clone: () => Clone2,
  Convert: () => Convert,
  Create: () => Create2,
  Decode: () => Decode10,
  Default: () => Default,
  Diff: () => Diff,
  Encode: () => Encode9,
  Equal: () => Equal,
  Errors: () => Errors2,
  HasCodec: () => HasCodec,
  Hash: () => Hash2,
  Parse: () => Parse,
  Patch: () => Patch,
  Pointer: () => pointer_exports,
  Repair: () => Repair
});

// src/config.ts
import fs from "node:fs";
import os from "node:os";

// src/runtime/source-limit.ts
import { Buffer as Buffer2 } from "node:buffer";
var DEFAULT_EXECUTOR_SOURCE_BYTES = 256 * 1024;
var MIN_EXECUTOR_SOURCE_BYTES = 1024;
var MAX_EXECUTOR_SOURCE_BYTES = 2 * 1024 * 1024;
var MAX_FABRIC_PAYLOAD_KEYS = 128;
var MAX_FABRIC_PAYLOAD_KEY_BYTES = 1024;
var effectiveFabricSourceLimit = (value) => Number.isSafeInteger(value) ? Math.max(MIN_EXECUTOR_SOURCE_BYTES, Math.min(MAX_EXECUTOR_SOURCE_BYTES, value)) : DEFAULT_EXECUTOR_SOURCE_BYTES;
var fabricSourceLimitError = (code, maximum) => {
  const bytes = Buffer2.byteLength(code, "utf8");
  return bytes > maximum ? `Fabric source exceeds ${maximum} bytes: received ${bytes}` : void 0;
};
var fabricPayloadsLimitError = (payloads, maximum) => {
  if (payloads === void 0) return void 0;
  const keys = Object.keys(payloads);
  if (keys.length > MAX_FABRIC_PAYLOAD_KEYS) return `Fabric payloads exceed ${MAX_FABRIC_PAYLOAD_KEYS} keys`;
  let total = 0;
  for (const key of keys) {
    if (Buffer2.byteLength(key, "utf8") > MAX_FABRIC_PAYLOAD_KEY_BYTES) return "Fabric payload key is too large";
    const value = payloads[key];
    if (typeof value !== "string") return "Fabric payload values must be strings";
    total += Buffer2.byteLength(key, "utf8") + Buffer2.byteLength(value, "utf8");
    if (total > maximum) return `Fabric payloads exceed ${maximum} bytes: received ${total}`;
  }
  return void 0;
};
var fabricTranspiledLimitError = (code) => {
  const maximum = MAX_EXECUTOR_SOURCE_BYTES * 4;
  const bytes = Buffer2.byteLength(code, "utf8");
  return bytes > maximum ? `Transpiled guest source exceeds ${maximum} bytes: received ${bytes}` : void 0;
};

// src/config.ts
var QUICKJS_MAX_MEMORY_LIMIT_BYTES = 4294967295;
var MAX_EXECUTOR_MEMORY_LIMIT_BYTES = Math.min(
  QUICKJS_MAX_MEMORY_LIMIT_BYTES,
  Math.max(8 * 1024 * 1024, Math.floor(os.totalmem()))
);
var DEFAULT_FABRIC_POWER_CONFIG = {
  executor: {
    timeoutMs: 12e4,
    maxTimeoutMs: 9e5,
    memoryLimitBytes: 64 * 1024 * 1024,
    maxSourceBytes: DEFAULT_EXECUTOR_SOURCE_BYTES,
    maxInputBytes: DEFAULT_EXECUTOR_SOURCE_BYTES,
    maxOutputChars: 5e4,
    maxNestedResultChars: 2e6,
    resultFormat: "auto"
  },
  approvals: { read: "allow", write: "ask", execute: "ask", network: "ask" },
  mcp: {
    enabled: true,
    disableOAuth: true,
    callTimeoutMs: 12e4
  },
  memory: { enabled: true, maxEntries: 128, maxValueChars: 16e3 },
  state: {
    enabled: true,
    maxEntries: 1e3,
    maxValueChars: 1e5,
    maxTotalChars: 8e6
  },
  artifacts: {
    maxArtifacts: 32,
    maxArtifactChars: 2e6,
    maxTotalChars: 8e6,
    ttlMs: 36e5
  }
};
var record = (value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
var integer = (value, fallback, minimum, maximum) => typeof value === "number" && Number.isSafeInteger(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
var bool = (value, fallback) => typeof value === "boolean" ? value : fallback;
var approval = (value, fallback) => value === "allow" || value === "ask" || value === "deny" ? value : fallback;
var FILE_CONFIG_KEYS = {
  executor: ["timeoutMs", "maxTimeoutMs", "memoryLimitBytes", "maxSourceBytes", "maxInputBytes", "maxOutputChars", "maxNestedResultChars", "resultFormat"],
  approvals: ["read", "write", "execute", "network"],
  mcp: ["enabled", "disableOAuth", "callTimeoutMs"],
  memory: ["enabled", "maxEntries", "maxValueChars"],
  state: ["enabled", "maxEntries", "maxValueChars", "maxTotalChars"],
  artifacts: ["maxArtifacts", "maxArtifactChars", "maxTotalChars", "ttlMs"]
};
var assertFileConfigShape = (value) => {
  const root = record(value);
  if (!root) throw new Error("configuration root must be an object");
  for (const [section, raw] of Object.entries(root)) {
    const allowed = FILE_CONFIG_KEYS[section];
    if (!allowed) throw new Error(`unknown configuration section: ${section}`);
    const fields = record(raw);
    if (!fields) throw new Error(`configuration section must be an object: ${section}`);
    for (const field of Object.keys(fields)) {
      if (!allowed.includes(field)) throw new Error(`unknown configuration field: ${section}.${field}`);
    }
  }
};
var normalizeFabricPowerConfig = (input, defaults = DEFAULT_FABRIC_POWER_CONFIG) => {
  const root = record(input) ?? {};
  const executor = record(root.executor) ?? {};
  const approvals = record(root.approvals) ?? {};
  const mcp = record(root.mcp) ?? {};
  const memory = record(root.memory) ?? {};
  const state = record(root.state) ?? {};
  const artifacts = record(root.artifacts) ?? {};
  const timeoutMs = integer(executor.timeoutMs, defaults.executor.timeoutMs, 1, 9e5);
  const maxTimeoutMs = integer(executor.maxTimeoutMs, defaults.executor.maxTimeoutMs, timeoutMs, 9e5);
  const resultFormat = executor.resultFormat === "json" || executor.resultFormat === "text" || executor.resultFormat === "auto" ? executor.resultFormat : defaults.executor.resultFormat;
  return {
    executor: {
      timeoutMs,
      maxTimeoutMs,
      memoryLimitBytes: integer(executor.memoryLimitBytes, defaults.executor.memoryLimitBytes, 8 * 1024 * 1024, MAX_EXECUTOR_MEMORY_LIMIT_BYTES),
      maxSourceBytes: integer(executor.maxSourceBytes, defaults.executor.maxSourceBytes, MIN_EXECUTOR_SOURCE_BYTES, MAX_EXECUTOR_SOURCE_BYTES),
      maxInputBytes: integer(executor.maxInputBytes, defaults.executor.maxInputBytes, 1024, MAX_EXECUTOR_SOURCE_BYTES),
      maxOutputChars: integer(executor.maxOutputChars, defaults.executor.maxOutputChars, 1e3, 2e6),
      maxNestedResultChars: integer(executor.maxNestedResultChars, defaults.executor.maxNestedResultChars, 1e3, 8e6),
      resultFormat
    },
    approvals: {
      read: approval(approvals.read, defaults.approvals.read),
      write: approval(approvals.write, defaults.approvals.write),
      execute: approval(approvals.execute, defaults.approvals.execute),
      network: approval(approvals.network, defaults.approvals.network)
    },
    mcp: {
      enabled: bool(mcp.enabled, defaults.mcp.enabled),
      ...typeof mcp.configPath === "string" && mcp.configPath ? { configPath: mcp.configPath } : defaults.mcp.configPath ? { configPath: defaults.mcp.configPath } : {},
      disableOAuth: bool(mcp.disableOAuth, defaults.mcp.disableOAuth),
      callTimeoutMs: integer(mcp.callTimeoutMs, defaults.mcp.callTimeoutMs, 1e3, maxTimeoutMs)
    },
    memory: {
      enabled: bool(memory.enabled, defaults.memory.enabled),
      maxEntries: integer(memory.maxEntries, defaults.memory.maxEntries, 1, 128),
      maxValueChars: integer(memory.maxValueChars, defaults.memory.maxValueChars, 1e3, 16e3)
    },
    state: {
      enabled: bool(state.enabled, defaults.state.enabled),
      maxEntries: integer(state.maxEntries, defaults.state.maxEntries, 1, 1e4),
      maxValueChars: integer(state.maxValueChars, defaults.state.maxValueChars, 1e3, 2e6),
      maxTotalChars: integer(state.maxTotalChars, defaults.state.maxTotalChars, 4096, 32e6)
    },
    artifacts: {
      maxArtifacts: integer(artifacts.maxArtifacts, defaults.artifacts.maxArtifacts, 1, 128),
      maxArtifactChars: integer(artifacts.maxArtifactChars, defaults.artifacts.maxArtifactChars, 1e3, 8e6),
      maxTotalChars: integer(artifacts.maxTotalChars, defaults.artifacts.maxTotalChars, 1e3, 32e6),
      ttlMs: integer(artifacts.ttlMs, defaults.artifacts.ttlMs, 1e3, 864e5)
    }
  };
};
var MAX_CONFIG_BYTES = 256 * 1024;
var loadFabricPowerConfig = (configFile, defaults = DEFAULT_FABRIC_POWER_CONFIG) => {
  let descriptor2;
  let observed = false;
  try {
    const lexicalStats = fs.lstatSync(configFile);
    observed = true;
    if (!lexicalStats.isFile() || lexicalStats.isSymbolicLink() || lexicalStats.nlink !== 1) {
      throw new Error("configuration must be a private regular file");
    }
    descriptor2 = fs.openSync(
      configFile,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
    );
    const stats = fs.fstatSync(descriptor2);
    if (!stats.isFile() || stats.nlink !== 1 || stats.dev !== lexicalStats.dev || stats.ino !== lexicalStats.ino) {
      throw new Error("configuration changed while it was being opened");
    }
    if (stats.size > MAX_CONFIG_BYTES) throw new Error("configuration exceeds 262144 bytes");
    if (process.platform !== "win32") {
      if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
        throw new Error("configuration must be owned by the current user");
      }
      if ((stats.mode & 63) !== 0) throw new Error("configuration permissions must be private");
    }
    const buffer = Buffer.allocUnsafe(MAX_CONFIG_BYTES + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = fs.readSync(descriptor2, buffer, bytes, buffer.length - bytes, null);
      if (count === 0) break;
      bytes += count;
    }
    if (bytes > MAX_CONFIG_BYTES) throw new Error("configuration exceeds 262144 bytes");
    const value = JSON.parse(buffer.subarray(0, bytes).toString("utf8"));
    assertFileConfigShape(value);
    return normalizeFabricPowerConfig(value, defaults);
  } catch (error) {
    if (error.code === "ENOENT" && !observed) {
      return normalizeFabricPowerConfig(void 0, defaults);
    }
    throw error;
  } finally {
    if (descriptor2 !== void 0) fs.closeSync(descriptor2);
  }
};

// src/core/action-registry.ts
import { randomUUID } from "node:crypto";

// src/async-settlement.ts
var abortError = (signal) => {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  return new Error(typeof reason === "string" && reason ? reason : "Operation aborted");
};
var throwIfAborted = (signal) => {
  if (signal?.aborted) throw abortError(signal);
};
var raceWithAbort = (operation, signal) => {
  if (!signal) return Promise.resolve(operation);
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(abortError(signal)));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(operation).then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    );
  });
};
var runAbortable = (signal, operation) => {
  try {
    throwIfAborted(signal);
    return raceWithAbort(Promise.resolve(operation()), signal);
  } catch (error) {
    return Promise.reject(error);
  }
};
var settleWithin = async (operations, timeoutMs) => {
  const pending = [...operations].map((operation) => Promise.resolve(operation));
  if (pending.length === 0) return true;
  let timer;
  try {
    return await Promise.race([
      Promise.allSettled(pending).then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

// src/schema-validation.ts
var MAX_VALIDATION_MESSAGE_CHARS = 2e3;
var REDACTED_PROPERTY_SEGMENT = "<property>";
var truncateString = (value, max) => value.length <= max ? value : `${value.slice(0, max)}\u2026`;
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var delegatedSchemaKeywords = /* @__PURE__ */ new Set([
  "allOf",
  "anyOf",
  "contains",
  "dependentSchemas",
  "else",
  "if",
  "not",
  "oneOf",
  "pattern",
  "patternProperties",
  "propertyNames",
  "then",
  "uniqueItems"
]);
var locallyBoundedSchema = (schema) => {
  const stack = [{ value: schema, depth: 0 }];
  const seen = /* @__PURE__ */ new Set();
  let nodes = 0;
  let stringChars = 0;
  while (stack.length > 0) {
    const { value, depth } = stack.pop();
    nodes += 1;
    if (nodes > 5e3 || depth > 32) return false;
    if (typeof value === "string") {
      stringChars += value.length;
      if (stringChars > 1e5) return false;
      continue;
    }
    if (typeof value !== "object" || value === null) continue;
    if (seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const child of value) stack.push({ value: child, depth: depth + 1 });
      continue;
    }
    for (const [key, child] of Object.entries(value)) {
      if (delegatedSchemaKeywords.has(key)) return false;
      stack.push({ value: child, depth: depth + 1 });
    }
  }
  return true;
};
var pointerPart = (value) => value.replaceAll("~", "~0").replaceAll("/", "~1");
var decodePointerPart = (value) => value.replaceAll("~1", "/").replaceAll("~0", "~");
var schemaForDynamicProperty = (schema, property) => {
  const patterns = isRecord(schema.patternProperties) ? schema.patternProperties : void 0;
  if (patterns) {
    for (const [pattern, child] of Object.entries(patterns)) {
      try {
        if (new RegExp(pattern).test(property)) return child;
      } catch {
      }
    }
  }
  return isRecord(schema.additionalProperties) ? schema.additionalProperties : void 0;
};
var traceSafePath = (schema, path9) => {
  const rawParts = typeof path9 === "string" ? path9 === "" || path9 === "/" ? [] : path9.split("/").slice(1).map(decodePointerPart) : Array.isArray(path9) ? path9.filter(
    (part) => typeof part === "string" || typeof part === "number"
  ).map(String) : [];
  const safeParts = [];
  let current = schema;
  for (const part of rawParts) {
    if (!isRecord(current)) {
      safeParts.push(REDACTED_PROPERTY_SEGMENT);
      continue;
    }
    if (current.type === "array" && /^\d+$/.test(part)) {
      safeParts.push(part);
      current = Array.isArray(current.items) ? current.items[Number(part)] : current.items;
      continue;
    }
    const properties = isRecord(current.properties) ? current.properties : void 0;
    if (properties && Object.hasOwn(properties, part)) {
      safeParts.push(part);
      current = properties[part];
      continue;
    }
    safeParts.push(REDACTED_PROPERTY_SEGMENT);
    current = schemaForDynamicProperty(current, part);
  }
  return safeParts.map((part) => `/${pointerPart(part)}`).join("");
};
var prefixedPath = (schema, prefix, path9) => `${prefix}${traceSafePath(schema, path9)}` || "/";
var traceSafeErrorMessage = (error) => {
  if (error.keyword === "additionalProperties") return "must not have additional properties";
  if (error.keyword === "propertyNames") return "property names are invalid";
  return typeof error.message === "string" ? error.message : "Schema validation failed";
};
var validateSchemaValue = (schema, value, options = {}) => {
  if (!isRecord(schema) || !locallyBoundedSchema(schema)) return { status: "unavailable" };
  const prefix = options.pathPrefix ?? "";
  try {
    const messages = [];
    for (const rawError of value_exports.Errors(schema, value)) {
      const error = rawError;
      const path9 = error.path ?? (options.includeInstancePath ? error.instancePath : void 0);
      const parentPath = prefixedPath(schema, prefix, path9);
      const safePath = error.keyword === "additionalProperties" || error.keyword === "propertyNames" ? `${parentPath === "/" ? "" : parentPath}/${REDACTED_PROPERTY_SEGMENT}` : parentPath;
      messages.push(`${safePath}: ${traceSafeErrorMessage(error)}`);
      if (messages.length >= 5) break;
    }
    if (messages.length === 0) return { status: "valid" };
    return {
      status: "invalid",
      message: truncateString(
        messages.join("; ") || `${prefixedPath(schema, prefix, void 0)}: Schema validation failed`,
        MAX_VALIDATION_MESSAGE_CHARS
      )
    };
  } catch {
    return { status: "unavailable" };
  }
};
var schemaValidationMessage = (schema, value) => {
  const result = validateSchemaValue(schema, value, { includeInstancePath: true });
  if (result.status === "valid") return void 0;
  if (result.status === "unavailable") return "Schema validator failed";
  return result.message.replace(/^\/: /, "");
};

// src/runtime/json-budget.ts
import { isProxy } from "node:util/types";
var MAX_FABRIC_JSON_CHARS = 8e6;
var DEFAULT_FABRIC_JSON_CHARS = 2e6;
var MAX_FABRIC_JSON_DEPTH = 64;
var MAX_FABRIC_JSON_NODES = 1e5;
var budgetError = (detail) => new Error(`Fabric host JSON is outside the bounded JSON contract: ${detail}`);
var normalizedLimit = (value) => {
  if (!Number.isSafeInteger(value) || value < 1) throw budgetError("invalid character limit");
  return Math.min(value, MAX_FABRIC_JSON_CHARS);
};
var preflight = (root, maxChars) => {
  const seen = /* @__PURE__ */ new WeakSet();
  const stack = [
    { value: root, depth: 0, nested: false }
  ];
  let nodes = 0;
  let rawChars = 0;
  while (stack.length > 0) {
    const { value, depth, nested } = stack.pop();
    nodes += 1;
    if (nodes > MAX_FABRIC_JSON_NODES) throw budgetError("node limit exceeded");
    if (value === null || typeof value === "boolean") continue;
    if (typeof value === "string") {
      rawChars += value.length;
      if (rawChars > maxChars) throw budgetError(`more than ${maxChars} raw characters`);
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw budgetError("non-finite number");
      continue;
    }
    if (value === void 0 && !nested) continue;
    if (typeof value !== "object") throw budgetError(`unsupported ${typeof value} value`);
    if (isProxy(value)) throw budgetError("proxy object");
    if (depth >= MAX_FABRIC_JSON_DEPTH) throw budgetError("depth limit exceeded");
    if (seen.has(value)) throw budgetError("cyclic or shared object graph");
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length + nodes > MAX_FABRIC_JSON_NODES) throw budgetError("node limit exceeded");
      for (let index = value.length - 1; index >= 0; index--) {
        stack.push({ value: value[index], depth: depth + 1, nested: true });
      }
      continue;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw budgetError("non-plain object");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) throw budgetError("symbol property");
    const descriptors4 = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors4);
    if (keys.length + nodes > MAX_FABRIC_JSON_NODES) throw budgetError("node limit exceeded");
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index];
      const descriptor2 = descriptors4[key];
      if (!("value" in descriptor2)) throw budgetError("accessor property");
      if (!descriptor2.enumerable) continue;
      rawChars += key.length;
      if (rawChars > maxChars) throw budgetError(`more than ${maxChars} raw characters`);
      stack.push({ value: descriptor2.value, depth: depth + 1, nested: true });
    }
  }
};
var fabricJsonText = (value, maxChars = DEFAULT_FABRIC_JSON_CHARS) => {
  const limit = normalizedLimit(maxChars);
  preflight(value, limit);
  if (value === void 0) return "null";
  const serialized = JSON.stringify(value);
  if (serialized === void 0) throw budgetError("value is not serializable");
  if (serialized.length > limit) throw budgetError(`more than ${limit} serialized characters`);
  return serialized;
};
var assertFabricJsonBudget = (value, maxChars = DEFAULT_FABRIC_JSON_CHARS) => {
  void fabricJsonText(value, maxChars);
};

// src/core/action-registry.ts
var providerName = /^[a-z][a-z0-9_-]{0,63}$/u;
var MAX_ACTION_REFERENCE_CHARS = 512;
var MAX_SEARCH_QUERY_CHARS = 2e3;
var isRecord2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var resolved = (provider, descriptor2) => ({
  ...structuredClone(descriptor2),
  provider: provider.name,
  ref: `${provider.name}.${descriptor2.name}`
});
var boundedResult = (value, maximum) => {
  const text = fabricJsonText(value, MAX_FABRIC_JSON_CHARS);
  if (text.length <= maximum) return { value, chars: text.length, truncated: false };
  return {
    value: { fabricTruncated: true, originalChars: text.length, preview: text.slice(0, Math.max(1, maximum - 100)) },
    chars: text.length,
    truncated: true
  };
};
var overlaps = (left, right) => left.includes("*") || right.includes("*") || left.some((entry) => right.includes(entry));
var ActionRegistry = class {
  #providers = /* @__PURE__ */ new Map();
  #unavailable = /* @__PURE__ */ new Map();
  #activeWrites = /* @__PURE__ */ new Map();
  register(provider) {
    if (!providerName.test(provider.name)) throw new Error(`Invalid Fabric provider name: ${provider.name}`);
    if (this.#providers.has(provider.name)) throw new Error(`Fabric provider already registered: ${provider.name}`);
    this.#providers.set(provider.name, provider);
    this.#unavailable.delete(provider.name);
  }
  markUnavailable(name, reason) {
    if (!providerName.test(name) || this.#providers.has(name)) return;
    this.#unavailable.set(name, reason);
  }
  has(name) {
    return this.#providers.has(name);
  }
  providers() {
    return [
      ...[...this.#providers.values()].map((provider) => ({ name: provider.name, description: provider.description, available: true })),
      ...[...this.#unavailable].map(([name, reason]) => ({ name, description: reason, available: false, reason }))
    ].sort((left, right) => left.name.localeCompare(right.name));
  }
  async list() {
    const lists = await Promise.all([...this.#providers.values()].map(async (provider) => (await provider.list()).map((descriptor2) => resolved(provider, descriptor2))));
    return lists.flat().sort((left, right) => left.ref.localeCompare(right.ref));
  }
  async search(query, limit = 30) {
    if (query.length > MAX_SEARCH_QUERY_CHARS) throw new Error("Fabric search query exceeds 2000 characters");
    const normalized = query.normalize("NFKC").trim().toLowerCase();
    if (!normalized) return [];
    if (normalized.length > MAX_SEARCH_QUERY_CHARS) throw new Error("Normalized Fabric search query exceeds 2000 characters");
    return (await this.list()).filter((action) => `${action.ref} ${action.description}`.toLowerCase().includes(normalized)).slice(0, Math.max(1, Math.min(100, Math.floor(limit))));
  }
  async describe(ref) {
    if (ref.length > MAX_ACTION_REFERENCE_CHARS) throw new Error("Fabric action reference exceeds 512 characters");
    const separator = ref.indexOf(".");
    if (separator <= 0) throw new Error(`Fabric action reference must be provider.action: ${ref}`);
    const provider = this.#providers.get(ref.slice(0, separator));
    if (!provider) throw new Error(`Unknown Fabric provider: ${ref.slice(0, separator)}`);
    const descriptor2 = await provider.describe(ref.slice(separator + 1));
    if (!descriptor2) throw new Error(`Unknown Fabric action: ${ref}`);
    return resolved(provider, descriptor2);
  }
  async invoke(ref, args, context) {
    throwIfAborted(context.signal);
    if (!isRecord2(args)) throw new Error(`Arguments for ${ref} must be an object`);
    const action = await this.describe(ref);
    const provider = this.#providers.get(action.provider);
    const prepared = provider.prepareArguments ? await runAbortable(context.signal, () => provider.prepareArguments(action.name, { ...args }, context)) : { ...args };
    if (!isRecord2(prepared)) throw new Error(`Argument preparation for ${ref} must return an object`);
    const invalid = schemaValidationMessage(action.inputSchema, prepared);
    if (invalid) throw new Error(`Invalid arguments for ${ref}: ${invalid}`);
    const approvedArgs = structuredClone(prepared);
    await runAbortable(context.signal, () => context.approve(
      structuredClone(action),
      structuredClone(approvedArgs)
    ));
    throwIfAborted(context.signal);
    const invocationArgs = structuredClone(approvedArgs);
    const resources = provider.effectResources?.(action.name, structuredClone(invocationArgs), context) ?? action.effect?.resources ?? (action.risk === "write" ? ["*"] : []);
    const writeLike = action.risk === "write" || action.effect?.kind === "write";
    if (writeLike) {
      for (const active of this.#activeWrites.values()) {
        if (overlaps(resources, active.resources)) throw new Error(`Overlapping write rejected: ${ref} conflicts with ${active.ref}`);
      }
    }
    const nestedToolCallId = `fabric_${randomUUID()}`;
    const audit = { ref, nestedToolCallId, startedAt: Date.now() };
    context.audits.push(audit);
    if (writeLike) this.#activeWrites.set(nestedToolCallId, { ref, resources });
    try {
      const value = await provider.invoke(action.name, invocationArgs, context);
      const bounded3 = boundedResult(value, context.maxResultChars);
      audit.endedAt = Date.now();
      audit.success = true;
      audit.resultChars = bounded3.chars;
      audit.resultTruncated = bounded3.truncated;
      return bounded3.value;
    } catch (error) {
      audit.endedAt = Date.now();
      audit.success = false;
      audit.error = error instanceof Error ? error.message.slice(0, 1e3) : String(error).slice(0, 1e3);
      throw error;
    } finally {
      this.#activeWrites.delete(nestedToolCallId);
    }
  }
  async close() {
    await Promise.allSettled([...this.#providers.values()].map((provider) => provider.close?.()));
    this.#providers.clear();
    this.#activeWrites.clear();
  }
};

// src/runtime/guest-types.ts
var powerGuestDeclarations = `
type JsonPrimitive = null | boolean | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };
type EmptyArgs = Record<string, never>;
interface FabricActionSummary { ref: string; provider: string; name: string; description: string; risk: "read" | "write" | "execute" | "network"; inputSchema: JsonObject; }
interface FabricTools {
  providers(): Promise<Array<{ name: string; description: string; available: boolean; reason?: string }>>;
  list(): Promise<FabricActionSummary[]>;
  search(input: string | { query: string; limit?: number }): Promise<FabricActionSummary[]>;
  describe(input: string | { ref: string }): Promise<FabricActionSummary>;
  call(input: { ref: string; args?: JsonObject }): Promise<JsonValue>;
}
declare const tools: Readonly<FabricTools>;
declare const payloads: Readonly<Record<string, string>>;
declare const artifacts: Readonly<{ read(args: { id: string; offset?: number; limit?: number }): Promise<JsonValue> }>;
declare const memory: Readonly<{
  get(args: { key: string }): Promise<JsonValue>;
  set(args: { key: string; value: JsonValue }): Promise<JsonValue>;
  search(args: { query: string; limit?: number }): Promise<JsonValue>;
  index(args?: EmptyArgs): Promise<JsonValue>;
}>;
declare const state: Readonly<{
  get(args: { key: string }): Promise<JsonValue>;
  set(args: { key: string; value: JsonValue; expectedRevision?: number }): Promise<JsonValue>;
  list(args?: { limit?: number }): Promise<JsonValue>;
  delete(args: { key: string; expectedRevision?: number }): Promise<JsonValue>;
}>;
declare const mcp: Readonly<{
  servers(args?: EmptyArgs): Promise<JsonValue>;
  call(args: { server: string; tool: string; args?: JsonObject }): Promise<JsonValue>;
}>;
declare function print(...values: unknown[]): void;
`;

// node_modules/.pnpm/@jitl+quickjs-singlefile-mjs-release-sync@0.32.0/node_modules/@jitl/quickjs-singlefile-mjs-release-sync/dist/index.mjs
var variant = { type: "sync", importFFI: () => import("./ffi-E3EUE5UE.js").then((mod) => mod.QuickJSFFI), importModuleLoader: () => import("./emscripten-module-Q67P5WYC-QODKBPIA.js").then((mod) => mod.default) };
var src_default = variant;

// node_modules/.pnpm/quickjs-emscripten-core@0.32.0/node_modules/quickjs-emscripten-core/dist/index.mjs
async function newQuickJSWASMModuleFromVariant(variantOrPromise) {
  let variant2 = smartUnwrap(await variantOrPromise), [wasmModuleLoader, QuickJSFFI, { QuickJSWASMModule: QuickJSWASMModule2 }] = await Promise.all([variant2.importModuleLoader().then(smartUnwrap), variant2.importFFI(), import("./module-ES6BEMUI-364UO5I4.js").then(smartUnwrap)]), wasmModule = await wasmModuleLoader();
  wasmModule.type = "sync";
  let ffi = new QuickJSFFI(wasmModule);
  return new QuickJSWASMModule2(wasmModule, ffi);
}
function smartUnwrap(val) {
  return val && "default" in val && val.default ? val.default && "default" in val.default && val.default.default ? val.default.default : val.default : val;
}

// src/runtime/quickjs-runtime.ts
import { performance as performance2 } from "node:perf_hooks";

// src/runtime/guest-stack-map.ts
var BASE64_VALUES = (() => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const table = /* @__PURE__ */ new Map();
  for (let index = 0; index < alphabet.length; index += 1) {
    table.set(alphabet[index], index);
  }
  return table;
})();
var decodeVlqSegment = (segment) => {
  const values = [];
  let index = 0;
  while (index < segment.length) {
    let value = 0;
    let shift = 0;
    let continuation = true;
    while (continuation) {
      const digit = BASE64_VALUES.get(segment[index]);
      if (digit === void 0) return values;
      index += 1;
      continuation = (digit & 32) !== 0;
      value += (digit & 31) * 2 ** shift;
      shift += 5;
    }
    values.push((value & 1) === 1 ? -(value >> 1) : value >> 1);
  }
  return values;
};
var decodeMappings = (mappings) => {
  const lines = [];
  let sourceLine = 0;
  let sourceColumn = 0;
  for (const line of mappings.split(";")) {
    const segments = [];
    let generatedColumn = 0;
    for (const rawSegment of line.split(",")) {
      if (!rawSegment) continue;
      const values = decodeVlqSegment(rawSegment);
      if (values.length < 4) continue;
      generatedColumn += values[0];
      sourceLine += values[2];
      sourceColumn += values[3];
      segments.push({ generatedColumn, sourceLine, sourceColumn });
    }
    lines.push(segments);
  }
  return lines;
};
var createGuestStackMap = (sourceMapText) => {
  if (!sourceMapText) return void 0;
  let mappings;
  try {
    const parsed = JSON.parse(sourceMapText);
    if (typeof parsed.mappings !== "string") return void 0;
    mappings = parsed.mappings;
  } catch {
    return void 0;
  }
  let decoded;
  return {
    lookup(line, column) {
      decoded ??= decodeMappings(mappings);
      const segments = decoded[line - 1];
      if (!segments) return void 0;
      const target = column - 1;
      let best;
      for (const segment of segments) {
        if (segment.generatedColumn > target) break;
        best = segment;
      }
      best ??= segments[0];
      if (!best) return void 0;
      return { line: best.sourceLine, column: best.sourceColumn + 1 };
    }
  };
};
var GUEST_FRAME_PATTERN = /kiro-fabric-guest\.js:(\d+):(\d+)/g;
var remapGuestErrorText = (text, stackMap, guestLineCount) => {
  if (!stackMap || !text.includes("kiro-fabric-guest.js:")) return text;
  return text.replace(GUEST_FRAME_PATTERN, (match, lineText, columnText) => {
    const line = Number(lineText);
    const mapped = stackMap.lookup(line, Number(columnText));
    if (mapped) return `guest code:${mapped.line}:${mapped.column}`;
    if (guestLineCount !== void 0 && line > guestLineCount) return "fabric driver";
    return match;
  });
};

// src/runtime/quickjs-runtime.ts
var modulePromise;
var quickJsModule = () => modulePromise ??= newQuickJSWASMModuleFromVariant(src_default);
var GUEST_SETUP = `
(() => {
  const bridge = globalThis.__fabricHostCall;
  delete globalThis.__fabricHostCall;
  const call = (ref, args = {}) => bridge(ref, args);
  globalThis.tools = Object.freeze({
    providers: () => call("fabric.providers"),
    list: () => call("fabric.list"),
    search: (input) => call("fabric.search", typeof input === "string" ? { query: input } : input),
    describe: (input) => call("fabric.describe", typeof input === "string" ? { ref: input } : input),
    call: (input) => call("fabric.call", input),
  });
  globalThis.artifacts = Object.freeze({ read: (args) => call("artifacts.read", args) });
  globalThis.memory = Object.freeze({
    get: (args) => call("memory.get", args),
    set: (args) => call("memory.set", args),
    search: (args) => call("memory.search", args),
    index: (args = {}) => call("memory.index", args),
  });
  globalThis.state = Object.freeze({
    get: (args) => call("state.get", args),
    set: (args) => call("state.set", args),
    list: (args = {}) => call("state.list", args),
    delete: (args) => call("state.delete", args),
  });
  globalThis.mcp = Object.freeze({
    servers: (args = {}) => call("mcp.$servers", args),
    call: (args) => call("mcp.$call", args),
  });
  Object.freeze(globalThis.payloads);
})();
`;
var formatValue = (value, maxChars = 1e5) => {
  if (typeof value === "string") return value.slice(0, maxChars);
  try {
    return fabricJsonText(value, Math.max(1, maxChars));
  } catch {
    return "[value outside bounded JSON]";
  }
};
var jsonHandle = (context, jsonObject, jsonParse, value, maxChars) => {
  if (value === void 0 || value === null) return context.null;
  if (typeof value === "string") {
    assertFabricJsonBudget(value, maxChars);
    return context.newString(value);
  }
  if (typeof value === "boolean") return value ? context.true : context.false;
  if (typeof value === "number") {
    assertFabricJsonBudget(value, maxChars);
    return context.newNumber(value);
  }
  const serialized = context.newString(fabricJsonText(value, maxChars));
  try {
    return context.unwrapResult(context.callFunction(jsonParse, jsonObject, serialized));
  } finally {
    serialized.dispose();
  }
};
var QUICKJS_MAX_STACK_SIZE_BYTES = 256 * 1024;
var HOST_SETTLE_GRACE_MS = 1500;
var GC_ASSERTION = "list_empty(&rt->gc_obj_list)";
var disposeContext = (context) => {
  try {
    context.dispose();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(GC_ASSERTION)) throw error;
  }
};
var QuickJsRuntime = class {
  async execute(code, hostCall, options) {
    if (options.signal?.aborted) return { value: void 0, logs: [], terminationReason: "aborted", error: "Execution cancelled" };
    const sourceLimit = effectiveFabricSourceLimit(options.maxSourceBytes);
    const inputLimit = effectiveFabricSourceLimit(options.maxInputBytes ?? options.maxSourceBytes);
    const inputError = fabricSourceLimitError(code, sourceLimit) ?? fabricPayloadsLimitError(options.payloads, inputLimit);
    if (inputError) return { value: void 0, logs: [], terminationReason: "runtime_error", error: inputError };
    if (!Number.isSafeInteger(options.memoryLimitBytes) || options.memoryLimitBytes < 1 || options.memoryLimitBytes > 4294967295) {
      return { value: void 0, logs: [], terminationReason: "runtime_error", error: "QuickJS memory limit is outside the WASM32 range" };
    }
    const module = await quickJsModule();
    if (options.signal?.aborted) {
      return { value: void 0, logs: [], terminationReason: "aborted", error: "Execution cancelled" };
    }
    const context = module.newContext();
    const runtime = context.runtime;
    const jsonObject = context.getProp(context.global, "JSON");
    const jsonParse = context.getProp(jsonObject, "parse");
    runtime.setMemoryLimit(options.memoryLimitBytes);
    runtime.setMaxStackSize(QUICKJS_MAX_STACK_SIZE_BYTES);
    const started = performance2.now();
    const maximum = Math.max(1, Math.floor(options.maxTimeoutMs));
    let effectiveTimeoutMs = Math.min(maximum, Math.max(1, Math.floor(options.timeoutMs)));
    let deadlineAt = started + effectiveTimeoutMs;
    let interrupted = false;
    let timedOut = false;
    let closing = false;
    runtime.setInterruptHandler(() => {
      if (options.signal?.aborted) return true;
      if (performance2.now() <= deadlineAt) return false;
      interrupted = true;
      return true;
    });
    const logs = [];
    const maxLogChars = Math.max(0, options.maxLogChars ?? 1e5);
    let logChars = 0;
    const hostController = new AbortController();
    const hostTasks = /* @__PURE__ */ new Set();
    const pendingPromises = /* @__PURE__ */ new Set();
    let deadlineTimer;
    let rejectDeadline;
    let abortListener;
    let activeHandle;
    const abortHost = (reason) => {
      if (!hostController.signal.aborted) hostController.abort(reason);
    };
    const timeoutMessage = () => `Execution timed out after ${effectiveTimeoutMs}ms`;
    const expire = () => {
      if (closing || timedOut) return;
      timedOut = true;
      const error = new Error(timeoutMessage());
      abortHost(error);
      rejectDeadline?.(error);
    };
    const schedule = () => {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      deadlineTimer = setTimeout(expire, Math.max(0, deadlineAt - performance2.now()));
      deadlineTimer.unref?.();
    };
    const extendForExactAction = (ref, args) => {
      const floor = options.minimumTimeoutMsForHostCall?.(ref, args);
      if (typeof floor !== "number" || !Number.isFinite(floor)) return;
      const next = Math.min(maximum, Math.max(effectiveTimeoutMs, Math.max(1, Math.floor(floor))));
      if (next <= effectiveTimeoutMs) return;
      effectiveTimeoutMs = next;
      deadlineAt = started + next;
      schedule();
    };
    try {
      const hostFunction = context.newFunction("__fabricHostCall", (refHandle, argsHandle) => {
        const ref = context.getString(refHandle);
        const dumped = context.dump(argsHandle);
        const args = typeof dumped === "object" && dumped !== null && !Array.isArray(dumped) ? dumped : {};
        assertFabricJsonBudget(args);
        extendForExactAction(ref, args);
        const promise = context.newPromise();
        pendingPromises.add(promise);
        void promise.settled.then(
          () => pendingPromises.delete(promise),
          () => pendingPromises.delete(promise)
        );
        const rejectGuestPromise = (error) => {
          if (closing || promise.alive === false) return;
          const raw = error instanceof Error ? error.message : String(error);
          const handle = context.newError(raw.slice(0, 4096));
          promise.reject(handle);
          handle.dispose();
        };
        const task = runAbortable(hostController.signal, () => hostCall(ref, args, hostController.signal)).then((value2) => {
          if (closing || promise.alive === false) return;
          try {
            const handle = jsonHandle(
              context,
              jsonObject,
              jsonParse,
              value2,
              options.maxNestedResultChars
            );
            promise.resolve(handle);
            handle.dispose();
          } catch (error) {
            rejectGuestPromise(error);
          }
        }, rejectGuestPromise).then(() => {
          if (!closing) runtime.executePendingJobs();
        }, () => {
        });
        hostTasks.add(task);
        void task.then(
          () => hostTasks.delete(task),
          () => hostTasks.delete(task)
        );
        return promise.handle;
      });
      context.setProp(context.global, "__fabricHostCall", hostFunction);
      hostFunction.dispose();
      const printFunction = context.newFunction("print", (...handles) => {
        let remaining = maxLogChars - logChars;
        if (remaining <= 0) return;
        const parts = [];
        for (const handle of handles) {
          const separator = parts.length > 0 ? " " : "";
          if (remaining <= separator.length) break;
          const rendered = formatValue(context.dump(handle), remaining - separator.length);
          parts.push(`${separator}${rendered}`);
          remaining -= separator.length + rendered.length;
        }
        const line = parts.join("");
        if (line) logs.push(line);
        logChars += line.length;
      });
      context.setProp(context.global, "print", printFunction);
      printFunction.dispose();
      const payloadHandle = jsonHandle(
        context,
        jsonObject,
        jsonParse,
        options.payloads ?? {},
        MAX_FABRIC_JSON_CHARS
      );
      context.setProp(context.global, "payloads", payloadHandle);
      payloadHandle.dispose();
      const setup = context.evalCode(GUEST_SETUP, "kiro-fabric-setup.js");
      if (setup.error) {
        const error = formatValue(context.dump(setup.error));
        setup.error.dispose();
        return { value: void 0, logs, terminationReason: "runtime_error", error };
      }
      setup.value.dispose();
      const bundle = options.transpiledCode === void 0 ? transpileFabricCodeWithSourceMap(code) : { code: options.transpiledCode, sourceMap: options.transpiledSourceMap };
      const transpiledError = fabricTranspiledLimitError(bundle.code);
      if (transpiledError) return { value: void 0, logs, terminationReason: "runtime_error", error: transpiledError };
      const stackMap = createGuestStackMap(bundle.sourceMap);
      const guestLineCount = bundle.code.split("\n").length;
      const evaluation = context.evalCode(`${bundle.code}
__kiroFabricMain()`, "kiro-fabric-guest.js");
      runtime.executePendingJobs();
      if (evaluation.error) {
        const deadlineExceeded = interrupted || performance2.now() > deadlineAt;
        const error = options.signal?.aborted ? "Execution cancelled" : deadlineExceeded ? timeoutMessage() : remapGuestErrorText(formatValue(context.dump(evaluation.error)), stackMap, guestLineCount);
        evaluation.error.dispose();
        abortHost(new Error(error));
        return { value: void 0, logs, terminationReason: options.signal?.aborted ? "aborted" : deadlineExceeded ? "timed_out" : "runtime_error", error };
      }
      activeHandle = evaluation.value;
      const resolution = context.resolvePromise(activeHandle);
      runtime.executePendingJobs();
      const deadline = new Promise((_resolve, reject) => {
        rejectDeadline = reject;
        schedule();
      });
      const cancellation = new Promise((_resolve, reject) => {
        abortListener = () => {
          const error = new Error("Execution cancelled");
          abortHost(error);
          reject(error);
        };
        if (options.signal?.aborted) abortListener();
        else options.signal?.addEventListener("abort", abortListener, { once: true });
      });
      const settled = await Promise.race([resolution, deadline, cancellation]);
      activeHandle.dispose();
      activeHandle = void 0;
      if (settled.error) {
        const deadlineExceeded = timedOut || interrupted || performance2.now() > deadlineAt;
        const error = options.signal?.aborted ? "Execution cancelled" : deadlineExceeded ? timeoutMessage() : remapGuestErrorText(formatValue(context.dump(settled.error)), stackMap, guestLineCount);
        settled.error.dispose();
        abortHost(new Error(error));
        return { value: void 0, logs, terminationReason: options.signal?.aborted ? "aborted" : deadlineExceeded ? "timed_out" : "runtime_error", error };
      }
      const value = context.dump(settled.value);
      settled.value.dispose();
      return { value, logs, terminationReason: "completed" };
    } catch (error) {
      const message = options.signal?.aborted ? "Execution cancelled" : timedOut || interrupted ? timeoutMessage() : error instanceof Error ? error.message : String(error);
      abortHost(new Error(message));
      return { value: void 0, logs, terminationReason: options.signal?.aborted ? "aborted" : timedOut || interrupted ? "timed_out" : "runtime_error", error: message };
    } finally {
      closing = true;
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (abortListener) options.signal?.removeEventListener("abort", abortListener);
      abortHost(new Error("Execution request ended"));
      await settleWithin(hostTasks, HOST_SETTLE_GRACE_MS);
      if (activeHandle?.alive !== false) activeHandle?.dispose();
      for (const promise of pendingPromises) if (promise.alive !== false) promise.dispose();
      jsonParse.dispose();
      jsonObject.dispose();
      disposeContext(context);
    }
  }
};

// src/execution-service.ts
var FABRIC_COMPILER_TIMEOUT_MS = 1e4;
var FABRIC_APPROVAL_TIMEOUT_MS = 3e4;
var FABRIC_PROVIDER_TIMEOUT_GRACE_MS = 2e3;
var MAX_MCP_APPROVAL_STAGES = 2;
var statusFor = (reason) => reason === "completed" ? "succeeded" : reason === "aborted" ? "aborted" : reason === "timed_out" ? "timed_out" : "failed";
var effectiveFabricTimeout = (configuredMaximum, executorDefault, exactActionFloor, invocationTimeout) => Math.min(configuredMaximum, Math.max(executorDefault, exactActionFloor, invocationTimeout));
var exactActionTimeoutFloor = (ref, mcpCallTimeoutMs) => ref === "mcp.$call" ? mcpCallTimeoutMs + FABRIC_APPROVAL_TIMEOUT_MS * MAX_MCP_APPROVAL_STAGES + FABRIC_PROVIDER_TIMEOUT_GRACE_MS : 0;
var exactHostActionReference = (bridgeRef, args) => bridgeRef === "fabric.call" ? typeof args.ref === "string" ? args.ref : void 0 : bridgeRef;
var FabricExecutionService = class {
  constructor(registry, config, cwd) {
    this.registry = registry;
    this.config = config;
    this.cwd = cwd;
  }
  #runtime = new QuickJsRuntime();
  async execute(options) {
    const started = performance.now();
    const configuredMaximum = this.config.executor.maxTimeoutMs;
    const invocationTimeout = options.timeoutMs ?? 0;
    const effectiveTimeoutMs = effectiveFabricTimeout(
      configuredMaximum,
      this.config.executor.timeoutMs,
      0,
      invocationTimeout
    );
    let observedEffectiveTimeoutMs = effectiveTimeoutMs;
    const sourceError = fabricSourceLimitError(options.code, this.config.executor.maxSourceBytes) ?? fabricPayloadsLimitError(options.payloads, this.config.executor.maxInputBytes);
    if (sourceError) return { status: "failed", success: false, logs: [], audits: [], elapsedMs: performance.now() - started, error: sourceError, effectiveTimeoutMs };
    let checked;
    try {
      checked = await typeCheckFabricCodeInWorker({
        code: options.code,
        declarations: powerGuestDeclarations
      }, {
        ...options.signal ? { signal: options.signal } : {},
        timeoutMs: Math.min(FABRIC_COMPILER_TIMEOUT_MS, effectiveTimeoutMs)
      });
    } catch (error) {
      const aborted = options.signal?.aborted === true;
      return { status: aborted ? "aborted" : "failed", success: false, logs: [], audits: [], elapsedMs: performance.now() - started, error: aborted ? "Execution cancelled" : error instanceof Error ? error.message : String(error), effectiveTimeoutMs };
    }
    if (checked.errors.length) {
      return { status: "failed", success: false, logs: [], audits: [], elapsedMs: performance.now() - started, error: "TypeScript validation failed", typeErrors: checked.errors, effectiveTimeoutMs };
    }
    const audits = [];
    const providerContext = (signal) => ({
      cwd: this.cwd,
      signal
    });
    const result = await this.#runtime.execute(options.code, async (ref, args, signal) => {
      const context = providerContext(signal);
      if (ref === "fabric.providers") return this.registry.providers();
      if (ref === "fabric.list") return this.registry.list();
      if (ref === "fabric.search") {
        if (typeof args.query !== "string") throw new Error("fabric.search query must be a string");
        return this.registry.search(args.query, typeof args.limit === "number" ? args.limit : 30);
      }
      if (ref === "fabric.describe") {
        if (typeof args.ref !== "string") throw new Error("fabric.describe ref must be a string");
        return this.registry.describe(args.ref);
      }
      const actionRef = ref === "fabric.call" ? args.ref : ref;
      const actionArgs = ref === "fabric.call" ? args.args ?? {} : args;
      if (typeof actionRef !== "string" || typeof actionArgs !== "object" || actionArgs === null || Array.isArray(actionArgs)) {
        throw new Error("Fabric provider call requires an exact ref and object args");
      }
      return this.registry.invoke(actionRef, actionArgs, {
        ...context,
        audits,
        maxResultChars: this.config.executor.maxNestedResultChars,
        approve: (action, exactArgs) => options.approver.approve(action, exactArgs, signal)
      });
    }, {
      timeoutMs: effectiveTimeoutMs,
      maxTimeoutMs: configuredMaximum,
      memoryLimitBytes: this.config.executor.memoryLimitBytes,
      maxSourceBytes: this.config.executor.maxSourceBytes,
      maxInputBytes: this.config.executor.maxInputBytes,
      maxLogChars: this.config.executor.maxOutputChars,
      maxNestedResultChars: this.config.executor.maxNestedResultChars,
      ...options.payloads ? { payloads: options.payloads } : {},
      ...options.signal ? { signal: options.signal } : {},
      ...checked.javascript ? { transpiledCode: checked.javascript } : {},
      ...checked.sourceMap ? { transpiledSourceMap: checked.sourceMap } : {},
      minimumTimeoutMsForHostCall: (bridgeRef, args) => {
        const actionRef = exactHostActionReference(bridgeRef, args);
        const actionFloor = actionRef ? exactActionTimeoutFloor(actionRef, this.config.mcp.callTimeoutMs) : 0;
        const candidate = effectiveFabricTimeout(
          configuredMaximum,
          this.config.executor.timeoutMs,
          actionFloor,
          invocationTimeout
        );
        observedEffectiveTimeoutMs = Math.max(observedEffectiveTimeoutMs, candidate);
        return candidate;
      }
    });
    let status = statusFor(result.terminationReason);
    let outputError = result.error;
    if (status === "succeeded") {
      try {
        assertFabricJsonBudget(result.value, this.config.artifacts.maxArtifactChars);
      } catch (error) {
        status = "failed";
        outputError = error instanceof Error ? error.message : String(error);
      }
    }
    return {
      status,
      success: status === "succeeded",
      ...status === "succeeded" ? { value: result.value } : {},
      logs: result.logs,
      audits,
      elapsedMs: performance.now() - started,
      ...outputError ? { error: outputError } : {},
      effectiveTimeoutMs: observedEffectiveTimeoutMs
    };
  }
  async close() {
    await this.registry.close();
  }
};

// node_modules/.pnpm/typebox@1.3.8/node_modules/typebox/build/typebox.mjs
var typebox_exports = {};
__export(typebox_exports, {
  Any: () => Any,
  Array: () => _Array_,
  BigInt: () => BigInt2,
  Boolean: () => Boolean2,
  Call: () => Call,
  Capitalize: () => Capitalize,
  Codec: () => Codec,
  Conditional: () => Conditional,
  Constructor: () => Constructor,
  ConstructorParameters: () => ConstructorParameters,
  Cyclic: () => Cyclic,
  Decode: () => Decode2,
  DecodeBuilder: () => DecodeBuilder,
  Dependent: () => Dependent,
  Encode: () => Encode,
  EncodeBuilder: () => EncodeBuilder,
  Enum: () => Enum,
  Evaluate: () => Evaluate,
  Exclude: () => Exclude,
  Extends: () => Extends,
  ExtendsResult: () => result_exports,
  Extract: () => Extract,
  Function: () => _Function_,
  Generic: () => Generic,
  Identifier: () => Identifier,
  Immutable: () => Immutable,
  Index: () => Index,
  Infer: () => Infer,
  InstanceType: () => InstanceType,
  Instantiate: () => Instantiate,
  Integer: () => Integer,
  Interface: () => Interface,
  Intersect: () => Intersect,
  IsAny: () => IsAny,
  IsArray: () => IsArray2,
  IsBigInt: () => IsBigInt2,
  IsBoolean: () => IsBoolean3,
  IsCall: () => IsCall,
  IsCodec: () => IsCodec,
  IsConstructor: () => IsConstructor2,
  IsCyclic: () => IsCyclic,
  IsDependent: () => IsDependent,
  IsEnum: () => IsEnum2,
  IsEnumValue: () => IsEnumValue,
  IsFunction: () => IsFunction2,
  IsGeneric: () => IsGeneric,
  IsIdentifier: () => IsIdentifier,
  IsImmutable: () => IsImmutable,
  IsInfer: () => IsInfer,
  IsInteger: () => IsInteger2,
  IsIntersect: () => IsIntersect,
  IsKind: () => IsKind,
  IsLiteral: () => IsLiteral,
  IsNever: () => IsNever,
  IsNull: () => IsNull2,
  IsNumber: () => IsNumber3,
  IsObject: () => IsObject2,
  IsOptional: () => IsOptional,
  IsParameter: () => IsParameter,
  IsReadonly: () => IsReadonly,
  IsRecord: () => IsRecord,
  IsRef: () => IsRef2,
  IsRefine: () => IsRefine2,
  IsRest: () => IsRest,
  IsSchema: () => IsSchema2,
  IsString: () => IsString3,
  IsSymbol: () => IsSymbol2,
  IsTemplateLiteral: () => IsTemplateLiteral,
  IsThis: () => IsThis,
  IsTuple: () => IsTuple,
  IsUndefined: () => IsUndefined2,
  IsUnion: () => IsUnion,
  IsUnknown: () => IsUnknown,
  IsUnsafe: () => IsUnsafe,
  IsVoid: () => IsVoid,
  KeyOf: () => KeyOf2,
  Literal: () => Literal,
  Lowercase: () => Lowercase,
  Mapped: () => Mapped,
  Module: () => Module2,
  Never: () => Never,
  NonNullable: () => NonNullable,
  Null: () => Null,
  Number: () => Number2,
  Object: () => _Object_,
  Omit: () => Omit,
  Optional: () => Optional,
  Parameter: () => Parameter,
  Parameters: () => Parameters,
  Partial: () => Partial,
  Pick: () => Pick,
  Readonly: () => Readonly,
  ReadonlyObject: () => ReadonlyObject,
  ReadonlyType: () => ReadonlyType,
  Record: () => Record,
  RecordKey: () => RecordKey,
  RecordPattern: () => RecordPattern,
  RecordValue: () => RecordValue,
  Ref: () => Ref2,
  Refine: () => Refine,
  Required: () => Required,
  Rest: () => Rest,
  ReturnType: () => ReturnType,
  Script: () => Script2,
  String: () => String2,
  Symbol: () => Symbol2,
  TemplateLiteral: () => TemplateLiteral2,
  This: () => This,
  Tuple: () => Tuple,
  Uncapitalize: () => Uncapitalize,
  Undefined: () => Undefined,
  Union: () => Union,
  Unknown: () => Unknown,
  Unsafe: () => Unsafe,
  Uppercase: () => Uppercase,
  Void: () => Void,
  With: () => With2
});

// src/kernel/fabric-exec-contract.ts
var FABRIC_EXEC_RESULT_FORMATS = ["auto", "json", "text"];
var fabricExecInputSchema = typebox_exports.Object({
  code: typebox_exports.String({
    minLength: 1,
    maxLength: MAX_EXECUTOR_SOURCE_BYTES,
    description: "Checked TypeScript function body. Top-level await and return are supported."
  }),
  payloads: typebox_exports.Optional(typebox_exports.Record(
    typebox_exports.String({ minLength: 1, maxLength: 1024 }),
    typebox_exports.String({ maxLength: MAX_EXECUTOR_SOURCE_BYTES }),
    {
      maxProperties: 128,
      description: "Named immutable string payloads exposed to guest code as payloads.key."
    }
  )),
  resultFormat: typebox_exports.Optional(typebox_exports.Union(FABRIC_EXEC_RESULT_FORMATS.map((value) => typebox_exports.Literal(value)))),
  timeoutMs: typebox_exports.Optional(typebox_exports.Integer({ minimum: 1, maximum: 9e5, description: "Requested guest deadline, capped by Power policy." }))
}, { additionalProperties: false });
var isRecord3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var stringMap = (value) => {
  if (!isRecord3(value)) return false;
  let entries = 0;
  let characters = 0;
  for (const key of Object.keys(value)) {
    const entry = value[key];
    entries += 1;
    if (entries > 128 || key.length < 1 || key.length > 1024 || typeof entry !== "string") return false;
    characters += key.length + entry.length;
    if (characters > MAX_EXECUTOR_SOURCE_BYTES) return false;
  }
  return true;
};
var MAX_ENCODED_PAYLOAD_CHARS = 8e6;
var FABRIC_EXEC_KEYS = /* @__PURE__ */ new Set(["code", "payloads", "resultFormat", "timeoutMs"]);
var repairPayloads = (value) => {
  if (value.length > MAX_ENCODED_PAYLOAD_CHARS) return void 0;
  try {
    const once = JSON.parse(value);
    if (stringMap(once)) return { value: once, repair: "json-string-map" };
    if (typeof once === "string") {
      const twice = JSON.parse(once);
      if (stringMap(twice)) return { value: twice, repair: "double-encoded-json-string-map" };
    }
  } catch {
  }
  return void 0;
};
var prepareFabricExecArgumentsWithDiagnostics = (input) => {
  if (!isRecord3(input)) return { value: input, diagnostics: [] };
  const keys = Object.keys(input);
  if (keys.length > FABRIC_EXEC_KEYS.size || keys.some((key) => !FABRIC_EXEC_KEYS.has(key))) {
    return { value: { invalidFabricExecEnvelope: true }, diagnostics: [] };
  }
  const value = { ...input };
  const diagnostics = [];
  if (typeof value.payloads === "string") {
    const repaired = repairPayloads(value.payloads);
    if (repaired) {
      diagnostics.push({ field: "payloads", repair: repaired.repair });
      value.payloads = repaired.value;
    }
  }
  return { value, diagnostics };
};
var fabricExecInputSchemaJson = () => JSON.parse(JSON.stringify(fabricExecInputSchema));

// src/kiro/deadlines.ts
var KIRO_MCP_DEADLINE_GRACE_MS = 2e3;
var KIRO_MCP_DRAIN_TIMEOUT_MS = 3e3;
var kiroMcpOuterDeadlineMs = (guestMaximumMs, compilerTimeoutMs) => guestMaximumMs + compilerTimeoutMs + KIRO_MCP_DEADLINE_GRACE_MS;

// src/kiro/power/approver.ts
import path from "node:path";
var SECRET_KEY = /(?:apikey|authorization|authtoken|bearer|clientkey|clientsecret|cookie|credential|idtoken|passphrase|password|privatekey|refreshtoken|secret|session|token)/iu;
var SECRET_VALUE = /^(?:(?:basic|bearer)\s+|gh[pousr]_|github_pat_|sk-[a-z0-9_-]{12,}|akia[0-9a-z]{12,}|eyj[a-z0-9_-]+\.[a-z0-9_-]+\.|-----begin\s)|(?:^|[?&])(?:api[_-]?key|password|secret|token)=/iu;
var URL_VALUE = /^[a-z][a-z0-9+.-]*:\/\//iu;
var isSecretKey = (key) => SECRET_KEY.test(key.replace(/[_\-\s]/gu, ""));
var bounded = (value, maximum = 1500) => value.replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, maximum);
var KiroPowerApprover = class {
  constructor(adapter, timeoutMs = FABRIC_APPROVAL_TIMEOUT_MS) {
    this.adapter = adapter;
    this.timeoutMs = timeoutMs;
  }
  async approveOnce(request) {
    request.signal?.throwIfAborted();
    if (!this.adapter.supported()) return false;
    try {
      const result = await this.adapter.request({
        title: "Approve one Fabric action",
        message: bounded(`Risk: ${request.risk}
Action: ${request.provider}.${request.action}
${request.summary}`),
        ...request.signal ? { signal: request.signal } : {},
        timeoutMs: this.timeoutMs
      });
      request.signal?.throwIfAborted();
      return result.action === "accept" && result.approved === true;
    } catch {
      if (request.signal?.aborted) request.signal.throwIfAborted();
      return false;
    }
  }
};
var summarize = (args, cwd) => {
  const safe = /* @__PURE__ */ Object.create(null);
  for (const [key, value] of Object.entries(args).slice(0, 12)) {
    if (isSecretKey(key) || /env/iu.test(key)) safe[key] = "<redacted>";
    else if (typeof value === "string") {
      if (SECRET_VALUE.test(value)) safe[key] = "<redacted>";
      else if (path.isAbsolute(value)) {
        const relative = path.relative(cwd, value);
        safe[key] = relative === "" ? "." : relative.startsWith("..") || path.isAbsolute(relative) ? "<outside-workspace>" : relative;
      } else if (URL_VALUE.test(value) || /(?:url|uri|endpoint)/iu.test(key)) {
        try {
          const url = new URL(value);
          url.username = "";
          url.password = "";
          if (url.pathname !== "/") url.pathname = "/<redacted>";
          if (url.search) url.search = "?<redacted>";
          url.hash = "";
          safe[key] = bounded(url.toString(), 500);
        } catch {
          safe[key] = "<redacted-url>";
        }
      } else safe[key] = bounded(value, 500);
    } else if (value === null || typeof value === "number" || typeof value === "boolean") safe[key] = value;
    else safe[key] = Array.isArray(value) ? `<${value.length} items>` : "<object>";
  }
  return bounded(JSON.stringify(safe));
};
var KiroPowerFabricApprover = class {
  constructor(config, elicitation, cwd) {
    this.config = config;
    this.elicitation = elicitation;
    this.cwd = cwd;
  }
  async approve(action, args, signal) {
    const mode = this.config[action.risk];
    if (mode === "allow") return;
    if (mode === "deny") throw new Error(`${action.ref} is denied by Fabric policy`);
    const approved = await this.elicitation.approveOnce({
      risk: action.risk,
      provider: action.provider,
      action: action.name,
      summary: summarize(args, this.cwd),
      ...signal ? { signal } : {}
    });
    if (!approved) throw new Error(`${action.ref} approval was denied or unavailable`);
  }
};

// src/kiro/power/data-paths.ts
import { createHash } from "node:crypto";
import fs2 from "node:fs";
import path2 from "node:path";
var assertCurrentUser = (stats, target) => {
  if (process.platform !== "win32" && typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    throw new Error(`Power data path is owned by another user: ${target}`);
  }
};
var privateDirectory = (directory, boundary) => {
  const root = path2.resolve(boundary);
  const rootStats = fs2.lstatSync(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw new Error(`Power storage root is not a regular directory: ${boundary}`);
  assertCurrentUser(rootStats, root);
  const target = path2.resolve(directory);
  const relative = path2.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path2.sep}`) || path2.isAbsolute(relative)) throw new Error(`Power data path escapes storage: ${directory}`);
  let cursor = root;
  for (const segment of relative.split(path2.sep).filter(Boolean)) {
    cursor = path2.join(cursor, segment);
    try {
      fs2.mkdirSync(cursor, { mode: 448 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const stats = fs2.lstatSync(cursor);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`Power data path contains a non-directory: ${cursor}`);
    assertCurrentUser(stats, cursor);
    fs2.chmodSync(cursor, 448);
  }
  return target;
};
var privateJson = (target, initial) => {
  try {
    const descriptor2 = fs2.openSync(target, "wx", 384);
    try {
      fs2.writeFileSync(descriptor2, `${JSON.stringify(initial, null, 2)}
`);
    } finally {
      fs2.closeSync(descriptor2);
    }
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const stats = fs2.lstatSync(target);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) throw new Error(`Power configuration is not a private regular file: ${target}`);
  assertCurrentUser(stats, target);
  if (stats.size > 1024 * 1024) throw new Error(`Power configuration exceeds 1048576 bytes: ${target}`);
  fs2.chmodSync(target, 384);
  return target;
};
var prepareKiroPowerDataPaths = (pluginData) => {
  const root = privateDirectory(path2.join(pluginData, "fabric"), pluginData);
  const config = privateDirectory(path2.join(root, "config"), root);
  return {
    root,
    config,
    configFile: path2.join(config, "config.json"),
    mcpConfig: privateJson(path2.join(config, "mcp.json"), { mcpServers: {}, imports: [] }),
    artifacts: privateDirectory(path2.join(root, "artifacts"), root),
    projects: privateDirectory(path2.join(root, "projects"), root)
  };
};
var kiroPowerWorkspaceId = (identity) => createHash("sha256").update("kiro-fabric-power-workspace-v3\0").update(identity.canonicalPath).update("\0").update(identity.deviceId).update("\0").update(identity.fileId).digest("hex");
var prepareKiroPowerProjectPaths = (projects, identity) => {
  const root = privateDirectory(path2.join(projects, kiroPowerWorkspaceId(identity)), projects);
  const identityFile = privateJson(path2.join(root, "workspace-identity.json"), identity);
  const persisted = JSON.parse(fs2.readFileSync(identityFile, "utf8"));
  if (JSON.stringify(persisted) !== JSON.stringify(identity)) throw new Error("Power workspace identity does not match the current filesystem object");
  return {
    root,
    identityFile,
    memory: privateDirectory(path2.join(root, "memory"), root),
    state: privateDirectory(path2.join(root, "state"), root),
    artifacts: privateDirectory(path2.join(root, "artifacts"), root)
  };
};

// src/kiro/power/workspace-binding.ts
import { createHash as createHash2 } from "node:crypto";
import { existsSync } from "node:fs";
import os2 from "node:os";
import path3 from "node:path";
import { fileURLToPath } from "node:url";
var kiroPowerWorkspaceRequestSchema = typebox_exports.Union([
  typebox_exports.Object({ action: typebox_exports.Literal("status") }, { additionalProperties: false }),
  typebox_exports.Object({ action: typebox_exports.Literal("list") }, { additionalProperties: false }),
  typebox_exports.Object({
    action: typebox_exports.Literal("select"),
    rootId: typebox_exports.String({ minLength: 1, maxLength: 64 })
  }, { additionalProperties: false }),
  typebox_exports.Object({
    action: typebox_exports.Literal("attach"),
    path: typebox_exports.String({ minLength: 1, maxLength: 4096 })
  }, { additionalProperties: false }),
  typebox_exports.Object({ action: typebox_exports.Literal("detach") }, { additionalProperties: false })
]);
var idFor = (root) => createHash2("sha256").update("kiro-fabric-power-session-root-v1\0").update(root).digest("hex").slice(0, 16);
var KiroPowerWorkspaceBinding = class {
  #pluginRoot;
  #pluginData;
  #elicitor;
  #home;
  #temporary;
  #kiroHome;
  #candidates = [];
  #binding;
  #initialAutoBindAllowed = true;
  constructor(options) {
    this.#pluginRoot = inspectCanonicalPath(options.pluginRoot, {
      kind: "directory",
      rejectFinalSymlink: true
    }).canonicalPath;
    this.#pluginData = inspectCanonicalPath(options.pluginData, {
      kind: "directory",
      rejectFinalSymlink: true
    }).canonicalPath;
    this.#elicitor = options.elicitor;
    this.#home = inspectCanonicalPath(os2.homedir(), { kind: "directory" }).canonicalPath;
    this.#temporary = inspectCanonicalPath(os2.tmpdir(), { kind: "directory" }).canonicalPath;
    const kiroHome = path3.join(this.#home, ".kiro");
    this.#kiroHome = existsSync(kiroHome) ? inspectCanonicalPath(kiroHome, { kind: "directory" }).canonicalPath : kiroHome;
  }
  #canonical(candidate) {
    if (!path3.isAbsolute(candidate)) throw new Error("workspace root must be absolute");
    const inspected = inspectCanonicalPath(candidate, {
      kind: "directory",
      rejectFinalSymlink: true
    });
    const root = inspected.canonicalPath;
    const currentKiroHome = existsSync(this.#kiroHome) ? inspectCanonicalPath(this.#kiroHome, { kind: "directory" }).canonicalPath : this.#kiroHome;
    const insideKiroHome = canonicalPathContains(currentKiroHome, root);
    const unsafe = [path3.parse(root).root, this.#home, this.#temporary, this.#pluginRoot, this.#pluginData];
    if (unsafe.includes(root) || insideKiroHome || canonicalPathContains(root, this.#home)) {
      throw new Error("workspace root is too broad or reserved");
    }
    for (const reserved of [this.#pluginRoot, this.#pluginData]) {
      if (canonicalPathContains(reserved, root) || canonicalPathContains(root, reserved)) {
        throw new Error("workspace root and plugin storage must not contain one another");
      }
    }
    return {
      id: idFor(root),
      root,
      lexicalPath: inspected.lexicalPath,
      name: path3.basename(root) || "workspace",
      ...inspected.identity
    };
  }
  updateClientRoots(roots) {
    const candidates = [];
    const advertisedCanonicalRoots = /* @__PURE__ */ new Set();
    for (const item of roots) {
      let advertised;
      try {
        if (!item.uri.startsWith("file:")) continue;
        advertised = path3.resolve(fileURLToPath(item.uri));
        const candidate = this.#canonical(advertised);
        advertisedCanonicalRoots.add(candidate.root);
        candidates.push({ ...candidate, name: (item.name?.trim() || candidate.name).slice(0, 120) });
      } catch {
        if (advertised && this.#binding?.lexicalPath === advertised) {
          advertisedCanonicalRoots.add(this.#binding.root);
        }
      }
    }
    this.#candidates = [...new Map(candidates.map((entry) => [entry.id, entry])).values()];
    if (this.#binding?.source === "client-roots") {
      const current = this.#candidates.find((entry) => entry.id === this.#binding.id);
      const transient = advertisedCanonicalRoots.has(this.#binding.root) && !current;
      if (!transient && (!current || current.dev !== this.#binding.dev || current.ino !== this.#binding.ino)) {
        this.#binding = void 0;
        this.#initialAutoBindAllowed = false;
      }
    }
    if (this.#candidates.length > 1) this.#initialAutoBindAllowed = false;
    if (!this.#binding && this.#initialAutoBindAllowed && this.#candidates.length === 1) {
      this.#binding = { ...this.#candidates[0], source: "client-roots" };
      this.#initialAutoBindAllowed = false;
    }
  }
  bindingIdentity() {
    const binding = this.#binding;
    return binding ? `${binding.root}\0${binding.dev}\0${binding.ino}` : "<unbound>";
  }
  bindingSource() {
    return this.#binding?.source;
  }
  workspaceObservation() {
    const binding = this.#binding;
    if (!binding) return { status: "unbound" };
    if (binding.source === "client-roots") {
      const advertised = this.#candidates.find((entry) => entry.id === binding.id);
      if (!advertised || !sameCanonicalFilesystemIdentity(advertised, binding)) {
        return { status: "temporarily-unavailable" };
      }
    }
    try {
      const current = this.#canonical(binding.root);
      if (!sameCanonicalFilesystemIdentity(current, binding)) {
        return { status: "temporarily-unavailable" };
      }
      return {
        status: "verified",
        workspace: {
          schemaVersion: 1,
          canonicalPath: binding.root,
          deviceId: binding.dev.toString(),
          fileId: binding.ino.toString(),
          rootId: binding.id,
          name: binding.name,
          source: binding.source
        }
      };
    } catch {
      return { status: "temporarily-unavailable" };
    }
  }
  boundWorkspace() {
    const observation = this.workspaceObservation();
    return observation.status === "verified" ? observation.workspace : void 0;
  }
  boundRoot() {
    return this.boundWorkspace()?.canonicalPath;
  }
  status() {
    const workspace = this.boundWorkspace();
    return workspace ? { status: "bound", rootId: workspace.rootId, name: workspace.name, source: workspace.source } : { status: "unbound", requiresSelection: this.#candidates.length > 1 };
  }
  list() {
    return { ...this.status(), roots: this.#candidates.map(({ id, name }) => ({ rootId: id, name })) };
  }
  async prepareMutation(request, signal) {
    if (request.action === "detach") return request;
    if (request.action === "select") {
      if (!this.#candidates.some((entry) => entry.id === request.rootId)) {
        throw new Error("unknown workspace rootId; call fabric_workspace list first");
      }
      return request;
    }
    const candidate = this.#canonical(request.path);
    if (candidate.ctimeNs === void 0) {
      throw new Error("workspace root identity cannot be verified for approval");
    }
    if (!this.#elicitor) throw new Error("manual workspace attachment requires MCP elicitation support");
    signal?.throwIfAborted();
    const approved = await this.#elicitor.approveWorkspace(candidate.root, signal);
    signal?.throwIfAborted();
    if (!approved) throw new Error("manual workspace attachment was not approved");
    const approvedIdentity = inspectCanonicalPath(candidate.root, {
      kind: "directory",
      rejectFinalSymlink: true
    });
    if (!sameCanonicalFilesystemIdentity(approvedIdentity.identity, candidate, { includeCtime: true })) {
      throw new Error("workspace root identity changed during approval; attach and approve again");
    }
    return {
      action: "attach",
      root: candidate.root,
      dev: candidate.dev,
      ino: candidate.ino,
      ctimeNs: candidate.ctimeNs
    };
  }
  commitMutation(mutation) {
    if (mutation.action === "detach") {
      this.#binding = void 0;
    } else if (mutation.action === "select") {
      const candidate = this.#candidates.find((entry) => entry.id === mutation.rootId);
      if (!candidate) throw new Error("workspace root selection changed while the request was pending; list and retry");
      const current = this.#canonical(candidate.root);
      if (!sameCanonicalFilesystemIdentity(current, candidate)) {
        throw new Error("workspace root identity changed while the request was pending; list and retry");
      }
      this.#binding = { ...candidate, source: "client-roots" };
    } else {
      const candidate = this.#canonical(mutation.root);
      const approvedIdentity = inspectCanonicalPath(candidate.root, {
        kind: "directory",
        rejectFinalSymlink: true
      });
      if (candidate.dev !== mutation.dev || candidate.ino !== mutation.ino || approvedIdentity.identity.ctimeNs === void 0 || approvedIdentity.identity.ctimeNs !== mutation.ctimeNs) {
        throw new Error("workspace root identity changed after approval; attach and approve again");
      }
      this.#binding = { ...candidate, source: "manual" };
    }
    this.#initialAutoBindAllowed = false;
    return this.status();
  }
  async handle(request, signal) {
    if (request.action === "status") return this.status();
    if (request.action === "list") return this.list();
    return this.commitMutation(await this.prepareMutation(request, signal));
  }
};

// src/kiro/power/workspace-context.ts
var MAX_WORKSPACE_ROOTS = 128;
var MAX_WORKSPACE_URI_CHARS = 8192;
var MAX_WORKSPACE_NAME_CHARS = 256;
var boundedRoots = (value) => {
  if (value.length > MAX_WORKSPACE_ROOTS) throw new Error("workspace root count exceeds 128");
  return value.map((root) => {
    if (!root || typeof root.uri !== "string" || root.uri.length < 1 || root.uri.length > MAX_WORKSPACE_URI_CHARS) {
      throw new Error("workspace root URI is outside configured bounds");
    }
    if (root.name !== void 0 && (typeof root.name !== "string" || root.name.length > MAX_WORKSPACE_NAME_CHARS)) {
      throw new Error("workspace root name is outside configured bounds");
    }
    return { uri: root.uri, ...root.name === void 0 ? {} : { name: root.name } };
  });
};
var CachedWorkspaceContextProvider = class {
  #source;
  #ttlMs;
  #now;
  #listeners = /* @__PURE__ */ new Set();
  #snapshot;
  #stale = true;
  #refresh;
  #invalidationGeneration = 0;
  #revision = 0;
  constructor(source, options = {}) {
    this.#source = source;
    this.#ttlMs = options.ttlMs ?? 3e4;
    this.#now = options.now ?? Date.now;
  }
  invalidate() {
    this.#stale = true;
    this.#invalidationGeneration++;
  }
  subscribe(listener) {
    this.#listeners.add(listener);
    return { dispose: () => {
      this.#listeners.delete(listener);
    } };
  }
  async current(options = {}) {
    const now = this.#now();
    if (!options.force && !this.#stale && this.#snapshot && now - this.#snapshot.observedAt < this.#ttlMs) {
      return this.#snapshot;
    }
    if (this.#refresh) return this.#refresh;
    this.#refresh = (async () => {
      while (true) {
        const generation = this.#invalidationGeneration;
        const snapshot = await this.#load(this.#now());
        if (generation !== this.#invalidationGeneration) continue;
        snapshot.revision = ++this.#revision;
        this.#stale = snapshot.status === "temporarily-unavailable";
        this.#publish(snapshot);
        return snapshot;
      }
    })().finally(() => {
      this.#refresh = void 0;
    });
    return this.#refresh;
  }
  async #load(observedAt) {
    try {
      const roots = this.#source.supported() ? boundedRoots(await this.#source.load()) : [];
      return {
        revision: 0,
        status: roots.length === 0 ? "explicitly-empty" : "verified",
        roots,
        observedAt
      };
    } catch (error) {
      return {
        revision: 0,
        status: "temporarily-unavailable",
        roots: this.#snapshot?.roots ?? [],
        observedAt,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  #publish(snapshot) {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) {
      try {
        listener(snapshot);
      } catch {
      }
    }
  }
};

// src/kiro/projection.ts
var stringify = (value, format) => {
  if (format === "text" && typeof value === "string") return value;
  return JSON.stringify(value, null, format === "json" ? 2 : void 0) ?? "null";
};
var projectFabricExecutionText = (options) => {
  const value = options.result.success ? options.result.value : {
    status: options.result.status,
    error: options.result.error ?? "Fabric execution failed",
    ...options.result.typeErrors ? { typeErrors: options.result.typeErrors } : {},
    effectiveTimeoutMs: options.result.effectiveTimeoutMs
  };
  const body = stringify(value, options.resultFormat);
  const diagnostics = options.normalizationDiagnostics?.length ? `

Normalization diagnostics: ${JSON.stringify(options.normalizationDiagnostics)}` : "";
  const logs = options.result.logs.length ? `

Fabric logs: ${JSON.stringify(options.result.logs)}` : "";
  const complete = `${body}${diagnostics}${logs}`;
  if (complete.length <= options.maxOutputChars) return { text: complete, isError: !options.result.success };
  try {
    const artifactId = options.writeArtifact(complete);
    const hint = `

Output exceeded ${options.maxOutputChars} characters. Full result is artifact ${artifactId}; read it with await artifacts.read({ id: ${JSON.stringify(artifactId)} }).`;
    return {
      text: `${complete.slice(0, Math.max(1, options.maxOutputChars - hint.length))}${hint}`,
      isError: !options.result.success,
      artifactId
    };
  } catch {
    const hint = `

Output exceeded ${options.maxOutputChars} characters and could not be retained within artifact bounds.`;
    return {
      text: `${complete.slice(0, Math.max(1, options.maxOutputChars - hint.length))}${hint}`,
      isError: true
    };
  }
};

// src/providers/state-provider.ts
import { randomBytes } from "node:crypto";
import fs3 from "node:fs";
import path4 from "node:path";
var emptyEntries = () => /* @__PURE__ */ Object.create(null);
var emptyDocument = () => ({ schemaVersion: 1, revision: 0, entries: emptyEntries() });
var KEY_MAX = 512;
var LOCK_NAME = ".state-mutation.lock";
var LOCK_TIMEOUT_MS = 5e3;
var STALE_LOCK_MS = 3e4;
var descriptors = [
  { name: "get", description: "Read one workspace-bound state value", inputSchema: { type: "object", properties: { key: { type: "string", minLength: 1, maxLength: KEY_MAX } }, required: ["key"], additionalProperties: false }, risk: "read", effect: { kind: "read" } },
  { name: "set", description: "Atomically set one workspace-bound state value", inputSchema: { type: "object", properties: { key: { type: "string", minLength: 1, maxLength: KEY_MAX }, value: {}, expectedRevision: { type: "integer", minimum: 0 } }, required: ["key", "value"], additionalProperties: false }, risk: "write", effect: { kind: "write" } },
  { name: "list", description: "List bounded workspace state metadata", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 1e3 } }, additionalProperties: false }, risk: "read", effect: { kind: "read" } },
  { name: "delete", description: "Atomically delete one workspace-bound state value", inputSchema: { type: "object", properties: { key: { type: "string", minLength: 1, maxLength: KEY_MAX }, expectedRevision: { type: "integer", minimum: 0 } }, required: ["key"], additionalProperties: false }, risk: "write", effect: { kind: "write" } }
];
var isRecord4 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var hasExactKeys = (value, keys) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
var errorCode = (error) => isRecord4(error) && typeof error.code === "string" ? error.code : void 0;
var delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
var processIsAlive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
};
var privateRoot = (root) => {
  fs3.mkdirSync(root, { recursive: true, mode: 448 });
  const stat = fs3.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("state root must be a private regular directory");
  }
  if (process.platform !== "win32" && typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error("state root must be owned by the current user");
  }
  fs3.chmodSync(root, 448);
  return fs3.realpathSync(root);
};
var StateProvider = class {
  name = "state";
  description = "Workspace-bound atomic state";
  #root;
  #file;
  #lock;
  #maxEntries;
  #maxValueChars;
  #maxTotalChars;
  constructor(root, options = {}) {
    this.#root = privateRoot(root);
    this.#file = path4.join(this.#root, "state.json");
    this.#lock = path4.join(this.#root, LOCK_NAME);
    this.#maxEntries = options.maxEntries ?? 1e3;
    this.#maxValueChars = options.maxValueChars ?? 1e5;
    this.#maxTotalChars = options.maxTotalChars ?? 8e6;
  }
  async list() {
    return [...descriptors];
  }
  async describe(actionName) {
    return descriptors.find((entry) => entry.name === actionName);
  }
  effectResources(_actionName, args) {
    return typeof args.key === "string" ? [`state:${args.key}`] : ["state:index"];
  }
  async invoke(actionName, args, context) {
    throwIfAborted(context.signal);
    if (actionName === "get") {
      const entry = this.#read().entries[args.key];
      return entry ? { key: args.key, ...entry } : { key: args.key, found: false };
    }
    if (actionName === "list") {
      const document = this.#read();
      const limit = typeof args.limit === "number" ? args.limit : 100;
      return {
        revision: document.revision,
        entries: Object.entries(document.entries).sort(([left], [right]) => left.localeCompare(right)).slice(0, limit).map(([key, entry]) => ({ key, revision: entry.revision, updatedAt: entry.updatedAt }))
      };
    }
    if (actionName !== "set" && actionName !== "delete") {
      throw new Error(`Unknown state action: ${actionName}`);
    }
    return this.#withMutationLock(context.signal, () => {
      const document = this.#read();
      const key = args.key;
      const current = document.entries[key];
      if (args.expectedRevision !== void 0 && args.expectedRevision !== (current?.revision ?? 0)) {
        throw new Error("state revision conflict");
      }
      if (actionName === "delete") {
        if (!current) return { key, deleted: false, revision: document.revision };
        delete document.entries[key];
        document.revision += 1;
        this.#write(document);
        return { key, deleted: true, revision: document.revision };
      }
      const serialized = JSON.stringify(args.value);
      if (serialized === void 0 || serialized.length > this.#maxValueChars) {
        throw new Error("state value exceeds configured bounds");
      }
      if (!current && Object.keys(document.entries).length >= this.#maxEntries) {
        throw new Error("state entry limit reached");
      }
      document.revision += 1;
      document.entries[key] = {
        revision: document.revision,
        value: JSON.parse(serialized),
        updatedAt: Date.now()
      };
      throwIfAborted(context.signal);
      this.#write(document);
      return { key, revision: document.revision };
    });
  }
  #read() {
    let descriptor2;
    try {
      const lexicalStats = fs3.lstatSync(this.#file);
      if (!lexicalStats.isFile() || lexicalStats.isSymbolicLink() || lexicalStats.nlink !== 1) {
        throw new Error("state file is not a private regular file");
      }
      descriptor2 = fs3.openSync(
        this.#file,
        fs3.constants.O_RDONLY | (fs3.constants.O_NOFOLLOW ?? 0)
      );
      const stat = fs3.fstatSync(descriptor2);
      if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== lexicalStats.dev || stat.ino !== lexicalStats.ino) {
        throw new Error("state file changed while it was being opened");
      }
      if (process.platform !== "win32") {
        if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
          throw new Error("state file must be owned by the current user");
        }
        if ((stat.mode & 63) !== 0) throw new Error("state file permissions must be private");
      }
      if (stat.size > this.#maxTotalChars * 4) throw new Error("state document exceeds configured bounds");
      const text = fs3.readFileSync(descriptor2, "utf8");
      if (text.length > this.#maxTotalChars) throw new Error("state document exceeds configured bounds");
      const parsed = JSON.parse(text);
      if (!isRecord4(parsed) || !hasExactKeys(parsed, ["schemaVersion", "revision", "entries"]) || parsed.schemaVersion !== 1 || !Number.isSafeInteger(parsed.revision) || parsed.revision < 0 || !isRecord4(parsed.entries)) {
        throw new Error("state file is malformed");
      }
      const entries = parsed.entries;
      if (Object.keys(entries).length > this.#maxEntries) throw new Error("state entry limit reached");
      const normalizedEntries = emptyEntries();
      for (const [key, entry] of Object.entries(entries)) {
        if (key.length < 1 || key.length > KEY_MAX || !isRecord4(entry) || !hasExactKeys(entry, ["revision", "value", "updatedAt"]) || !Number.isSafeInteger(entry.revision) || entry.revision < 1 || entry.revision > parsed.revision || !Number.isSafeInteger(entry.updatedAt) || entry.updatedAt < 0) {
          throw new Error("state file is malformed");
        }
        const value = JSON.stringify(entry.value);
        if (value === void 0 || value.length > this.#maxValueChars) {
          throw new Error("state value exceeds configured bounds");
        }
        normalizedEntries[key] = entry;
      }
      return {
        schemaVersion: 1,
        revision: parsed.revision,
        entries: normalizedEntries
      };
    } catch (error) {
      if (errorCode(error) === "ENOENT") return emptyDocument();
      throw error;
    } finally {
      if (descriptor2 !== void 0) fs3.closeSync(descriptor2);
    }
  }
  #write(document) {
    const text = `${JSON.stringify(document, null, 2)}
`;
    if (text.length > this.#maxTotalChars) throw new Error("state document exceeds configured bounds");
    const temporary = path4.join(
      this.#root,
      `.state-${process.pid}-${randomBytes(8).toString("hex")}.tmp`
    );
    const descriptor2 = fs3.openSync(temporary, "wx", 384);
    try {
      fs3.writeFileSync(descriptor2, text);
      fs3.fsyncSync(descriptor2);
    } finally {
      fs3.closeSync(descriptor2);
    }
    try {
      fs3.renameSync(temporary, this.#file);
      fs3.chmodSync(this.#file, 384);
    } catch (error) {
      fs3.rmSync(temporary, { force: true });
      throw error;
    }
  }
  async #withMutationLock(signal, operation) {
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    let identity;
    while (!identity) {
      throwIfAborted(signal);
      try {
        const descriptor2 = fs3.openSync(this.#lock, "wx", 384);
        try {
          fs3.writeFileSync(descriptor2, `${JSON.stringify({ pid: process.pid, acquiredAt: Date.now() })}
`);
          fs3.fsyncSync(descriptor2);
          const stat = fs3.fstatSync(descriptor2);
          identity = { dev: stat.dev, ino: stat.ino };
        } finally {
          fs3.closeSync(descriptor2);
        }
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
        let stat;
        try {
          stat = fs3.lstatSync(this.#lock);
        } catch (statError) {
          if (errorCode(statError) === "ENOENT") continue;
          throw statError;
        }
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("state mutation lock is foreign");
        if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
          let ownerPid = 0;
          try {
            const owner = JSON.parse(fs3.readFileSync(this.#lock, "utf8"));
            if (typeof owner.pid === "number") ownerPid = owner.pid;
          } catch {
          }
          if (!processIsAlive(ownerPid)) {
            const current = fs3.lstatSync(this.#lock);
            if (current.dev === stat.dev && current.ino === stat.ino && current.isFile()) {
              fs3.rmSync(this.#lock);
              continue;
            }
          }
        }
        if (Date.now() >= deadline) throw new Error("timed out waiting for state mutation lock");
        await delay(10);
      }
    }
    try {
      throwIfAborted(signal);
      return operation();
    } finally {
      try {
        const current = fs3.lstatSync(this.#lock);
        if (current.isFile() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino) {
          fs3.rmSync(this.#lock);
        }
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
    }
  }
};

// src/kiro/artifacts.ts
import { randomBytes as randomBytes2 } from "node:crypto";
import fs4 from "node:fs";
import path5 from "node:path";
var ARTIFACT_ID = /^ka_[a-f0-9]{48}$/u;
var MAX_ARTIFACT_RESIDUE_AGE_MS = 864e5;
var KiroArtifactStoreError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "KiroArtifactStoreError";
  }
};
var ArtifactStore = class {
  #entries = /* @__PURE__ */ new Map();
  #now;
  #root;
  #maxArtifacts;
  #maxArtifactChars;
  #maxTotalChars;
  #ttlMs;
  #totalChars = 0;
  #closed = false;
  constructor(options) {
    this.#now = options.now ?? Date.now;
    this.#maxArtifacts = options.maxArtifacts ?? 32;
    this.#maxArtifactChars = options.maxArtifactChars ?? 2e6;
    this.#maxTotalChars = options.maxTotalChars ?? 8e6;
    this.#ttlMs = options.ttlMs ?? 36e5;
    if (options.root) {
      fs4.mkdirSync(options.root, { recursive: true, mode: 448 });
      const stat = fs4.lstatSync(options.root);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new KiroArtifactStoreError("artifact root must be a regular directory");
      if (process.platform !== "win32" && typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new KiroArtifactStoreError("artifact root must be owned by the current user");
      }
      fs4.chmodSync(options.root, 448);
      const canonicalRoot = fs4.realpathSync(options.root);
      for (const entry of fs4.readdirSync(canonicalRoot, { withFileTypes: true })) {
        const target = path5.join(canonicalRoot, entry.name);
        const targetStats = fs4.lstatSync(target);
        if (!entry.isFile() || targetStats.isSymbolicLink() || !ARTIFACT_ID.test(entry.name)) {
          throw new KiroArtifactStoreError(`artifact root contains an unsupported entry: ${entry.name}`);
        }
        if (this.#now() - targetStats.mtimeMs > MAX_ARTIFACT_RESIDUE_AGE_MS) {
          fs4.rmSync(target);
        }
      }
      this.#root = canonicalRoot;
    }
  }
  #open() {
    if (this.#closed) throw new KiroArtifactStoreError("artifact store is closed");
  }
  write(content) {
    this.#open();
    if (typeof content !== "string" || content.length > this.#maxArtifactChars) throw new KiroArtifactStoreError("artifact exceeds configured bounds");
    this.sweep(this.#ttlMs, this.#maxArtifacts - 1);
    while (this.#entries.size && this.#totalChars + content.length > this.#maxTotalChars) this.#remove(this.#oldest());
    if (this.#totalChars + content.length > this.#maxTotalChars) throw new KiroArtifactStoreError("artifact quota exceeded");
    let id;
    do
      id = `ka_${randomBytes2(24).toString("hex")}`;
    while (this.#entries.has(id) || this.#root !== void 0 && fs4.existsSync(path5.join(this.#root, id)));
    const file = this.#root ? path5.join(this.#root, id) : void 0;
    if (file) {
      const descriptor2 = fs4.openSync(file, "wx", 384);
      try {
        fs4.writeFileSync(descriptor2, content);
        fs4.fsyncSync(descriptor2);
      } finally {
        fs4.closeSync(descriptor2);
      }
      fs4.chmodSync(file, 384);
    }
    const now = this.#now();
    this.#entries.set(id, { content, createdAt: now, lastReadAt: now, ...file ? { file } : {} });
    this.#totalChars += content.length;
    return id;
  }
  read(id, offset = 0, limit = 12e3) {
    this.#open();
    if (!ARTIFACT_ID.test(id)) throw new KiroArtifactStoreError("invalid artifact id");
    this.sweep(this.#ttlMs, this.#maxArtifacts);
    const entry = this.#entries.get(id);
    if (!entry) throw new KiroArtifactStoreError("artifact is unavailable or expired");
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) throw new KiroArtifactStoreError("artifact offset and limit must be positive integers");
    const text = entry.content.slice(offset, offset + Math.min(limit, 16e3));
    if (text) entry.lastReadAt = this.#now();
    const nextOffset = offset + text.length;
    return { id, text, offset, nextOffset, totalChars: entry.content.length, done: nextOffset >= entry.content.length };
  }
  sweep(maxAgeMs = this.#ttlMs, maxEntries = this.#maxArtifacts) {
    this.#open();
    const now = this.#now();
    for (const [id, entry] of this.#entries) if (now - entry.lastReadAt > maxAgeMs) this.#remove(id);
    while (this.#entries.size > maxEntries) this.#remove(this.#oldest());
  }
  #oldest() {
    const entries = [...this.#entries].sort((a, b) => a[1].lastReadAt - b[1].lastReadAt || a[0].localeCompare(b[0]));
    if (!entries[0]) throw new KiroArtifactStoreError("artifact store is empty");
    return entries[0][0];
  }
  #remove(id) {
    const entry = this.#entries.get(id);
    if (!entry) return;
    this.#entries.delete(id);
    this.#totalChars -= entry.content.length;
    if (entry.file) fs4.rmSync(entry.file, { force: true });
  }
  close() {
    if (this.#closed) return;
    for (const id of [...this.#entries.keys()]) this.#remove(id);
    this.#closed = true;
  }
};
var createKiroArtifactStore = (options = {}) => new ArtifactStore(options);

// src/kiro/mcp-provider.ts
import path6 from "node:path";
var descriptors2 = [
  {
    name: "$servers",
    description: "List explicitly configured MCP servers without connecting",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    risk: "read",
    namespace: "management",
    effect: { kind: "none" }
  },
  {
    name: "$call",
    description: "Call one configured MCP tool after network approval",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string", minLength: 1, maxLength: 256 },
        tool: { type: "string", minLength: 1, maxLength: 256 },
        args: { type: "object", additionalProperties: true }
      },
      required: ["server", "tool"],
      additionalProperties: false
    },
    risk: "network",
    namespace: "management",
    effect: { kind: "emission" }
  }
];
var isRecord5 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var MCP_CLOSE_GRACE_MS = 1e3;
var executeApproval = (name, description) => ({
  name,
  ref: `mcp.${name}`,
  provider: "mcp",
  description,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  risk: "execute",
  namespace: "management",
  effect: { kind: "emission" }
});
var STDIO_APPROVAL = executeApproval("$stdio", "Start one explicitly configured stdio MCP server");
var OAUTH_APPROVAL = executeApproval("$oauth", "Launch configured HTTP MCP authorization");
var abortError2 = (signal) => signal.reason instanceof Error ? signal.reason : new Error(typeof signal.reason === "string" && signal.reason ? signal.reason : "MCP call cancelled");
var normalizeMcpResult = (result) => {
  assertFabricJsonBudget(result);
  if (!isRecord5(result) || !Array.isArray(result.content)) return result;
  const text = result.content.filter((part) => isRecord5(part) && part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
  if (result.isError === true) throw new Error((text || "MCP tool returned an error").slice(0, 2e3));
  return {
    text,
    content: result.content,
    structuredContent: result.structuredContent ?? null
  };
};
var KiroMcpProvider = class {
  name = "mcp";
  description = "Approval-gated calls to explicitly configured MCP servers";
  #cwd;
  #config;
  #runtimeFactory;
  #closeController = new AbortController();
  #runtime;
  #runtimeCreation;
  #closed = false;
  constructor(cwd, config, runtimeFactory) {
    this.#cwd = cwd;
    this.#config = config;
    this.#runtimeFactory = runtimeFactory ?? (async () => {
      const { createRuntime } = await import("./dist-VQONG42M.js");
      return createRuntime({
        rootDir: this.#cwd,
        ...this.#config.configPath ? { configPath: this.#config.configPath } : {},
        clientInfo: { name: "kiro-fabric", version: "1" }
      });
    });
  }
  async list() {
    return [...descriptors2];
  }
  async describe(actionName) {
    return descriptors2.find((entry) => entry.name === actionName);
  }
  async invoke(actionName, args, context) {
    if (actionName === "$servers") {
      throwIfAborted(context.signal);
      const runtime2 = await this.#getRuntime(context.signal);
      throwIfAborted(context.signal);
      const servers = runtime2.listServers();
      if (servers.length > 128) throw new Error("Configured MCP server limit exceeded");
      return servers.map((name) => {
        const definition2 = runtime2.getDefinition(name);
        return {
          name,
          description: definition2.description ?? null,
          transport: definition2.command.kind
        };
      });
    }
    if (actionName !== "$call") throw new Error(`Unknown MCP federation action: ${actionName}`);
    const server = typeof args.server === "string" ? args.server.trim() : "";
    const toolName = typeof args.tool === "string" ? args.tool.trim() : "";
    const toolArgs = args.args === void 0 ? {} : args.args;
    if (!server || !toolName || !isRecord5(toolArgs)) {
      throw new Error("MCP call requires non-empty server/tool strings and object args");
    }
    const runtime = await this.#getRuntime(context.signal);
    throwIfAborted(context.signal);
    if (!runtime.listServers().includes(server)) throw new Error(`Unknown configured MCP server: ${server}`);
    const definition = runtime.getDefinition(server);
    if (definition.command.kind === "stdio") {
      await this.#approveExecution(STDIO_APPROVAL, {
        server,
        executable: path6.basename(definition.command.command),
        cwd: definition.command.cwd ?? this.#cwd
      }, context);
    } else if (!this.#config.disableOAuth) {
      await this.#approveExecution(OAUTH_APPROVAL, {
        server,
        endpoint: definition.command.url.origin
      }, context);
    }
    throwIfAborted(context.signal);
    const actionDeadline = Date.now() + this.#config.callTimeoutMs;
    const discoveryBudget = this.#remainingCallBudget(actionDeadline);
    const tools = await this.#bounded(
      runtime,
      server,
      runtime.listTools(server, {
        includeSchema: true,
        disableOAuth: this.#config.disableOAuth
      }),
      context.signal,
      "tool discovery",
      discoveryBudget
    );
    assertFabricJsonBudget(tools);
    if (tools.length > 1e3) throw new Error("Configured MCP tool limit exceeded");
    const matches = tools.filter((tool) => tool.name === toolName);
    if (matches.length !== 1) throw new Error(`Unknown or ambiguous MCP tool: ${server}.${toolName}`);
    this.#validateToolArguments(matches[0], toolArgs);
    throwIfAborted(context.signal);
    const callBudget = this.#remainingCallBudget(actionDeadline);
    const result = await this.#bounded(
      runtime,
      server,
      runtime.callTool(server, toolName, {
        args: toolArgs,
        timeoutMs: callBudget,
        disableOAuth: this.#config.disableOAuth
      }),
      context.signal,
      "tool call",
      callBudget
    );
    return normalizeMcpResult(result);
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#closeController.abort(new Error("MCP provider is closed"));
    const runtime = this.#runtime;
    const creation = this.#runtimeCreation;
    this.#runtime = void 0;
    this.#runtimeCreation = void 0;
    if (runtime) {
      await settleWithin([Promise.resolve().then(() => runtime.close())], MCP_CLOSE_GRACE_MS);
    } else if (creation) {
      await settleWithin([creation], MCP_CLOSE_GRACE_MS);
    }
  }
  async #approveExecution(action, details, context) {
    if (!context.approve) throw new Error(`${action.ref} execution approval is unavailable`);
    await runAbortable(context.signal, () => context.approve(action, details));
    throwIfAborted(context.signal);
  }
  #validateToolArguments(tool, args) {
    const validation = validateSchemaValue(tool.inputSchema, args, {
      pathPrefix: "/args",
      includeInstancePath: true
    });
    if (validation.status === "invalid") {
      throw new Error(`Invalid arguments for mcp.call: ${validation.message}`);
    }
  }
  async #getRuntime(requestSignal) {
    if (this.#closed) throw new Error("MCP provider is closed");
    if (this.#runtime) return this.#runtime;
    if (!this.#runtimeCreation) {
      const creation = this.#runtimeFactory().then(async (runtime) => {
        if (this.#closed) {
          await runtime.close();
          throw new Error("MCP provider closed during runtime creation");
        }
        this.#runtime = runtime;
        return runtime;
      });
      this.#runtimeCreation = creation;
      void creation.finally(() => {
        if (this.#runtimeCreation === creation) this.#runtimeCreation = void 0;
      }).catch(() => void 0);
    }
    const signal = requestSignal ? AbortSignal.any([requestSignal, this.#closeController.signal]) : this.#closeController.signal;
    return runAbortable(signal, () => this.#runtimeCreation);
  }
  #remainingCallBudget(deadline) {
    const remaining = Math.ceil(deadline - Date.now());
    if (remaining < 1) throw new Error(`MCP call timed out after ${this.#config.callTimeoutMs}ms`);
    return remaining;
  }
  #bounded(runtime, server, operation, signal, label, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let terminating = false;
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      const finish = (callback) => {
        if (settled || terminating) return;
        settled = true;
        cleanup();
        callback();
      };
      const terminate = (error) => {
        if (settled || terminating) return;
        terminating = true;
        cleanup();
        void settleWithin([Promise.resolve().then(() => runtime.close(server))], MCP_CLOSE_GRACE_MS).then(() => {
          settled = true;
          reject(error);
        });
      };
      const onAbort = () => terminate(abortError2(signal));
      const timer = setTimeout(
        () => terminate(new Error(`MCP ${label} timed out after ${this.#config.callTimeoutMs}ms total`)),
        timeoutMs
      );
      timer.unref?.();
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
      operation.then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error))
      );
    });
  }
};

// src/kiro/memory-provider.ts
import { createHash as createHash3 } from "node:crypto";

// src/kiro/memory.ts
import crypto from "node:crypto";
import fs5 from "node:fs";
import path7 from "node:path";
var DEFAULT_MAX_NAMESPACE_ENTRIES = 128;
var DEFAULT_MAX_NAMESPACE_BYTES = 256 * 1024;
var DEFAULT_MAX_ENTRY_BYTES = 16 * 1024;
var MEMORY_DIR = "memory";
var MEMORY_OWNER = "kiro-fabric";
var MEMORY_FORMAT = 1;
var OWNERSHIP_MARKER = ".kiro-fabric-owner";
var MAX_FILE_NAME_BYTES = 240;
var MUTATION_LOCK = ".kiro-fabric-mutation-lock";
var MUTATION_LOCK_OWNER = "owner.json";
var MUTATION_LOCK_TIMEOUT_MS = 5e3;
var STALE_MUTATION_LOCK_MS = 3e4;
var OWNERSHIP_INITIALIZATION_WAIT_MS = 250;
var KiroMemoryScopeError = class extends Error {
  code = "kiro_memory_scope";
  constructor(message) {
    super(message);
    this.name = "KiroMemoryScopeError";
  }
};
var utf8Bytes = (value) => Buffer.byteLength(value, "utf8");
var assertMemoryToken = (value, label) => {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} must not be empty`);
  if (trimmed === "." || trimmed === "..") {
    throw new KiroMemoryScopeError(`${label} must stay within its Kiro memory scope`);
  }
  return trimmed;
};
var encodeName = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
var hashNamespace = (namespace) => crypto.createHash("sha256").update(namespace).digest("hex").slice(0, 16);
var isWithinOrEqual = (root, candidate) => {
  const relative = path7.relative(root, candidate);
  if (relative === "" || relative === ".") return true;
  if (path7.isAbsolute(relative)) return false;
  return relative.split(path7.sep).filter(Boolean)[0] !== "..";
};
var lstatOrNull = (target) => {
  try {
    return fs5.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};
var errorCode2 = (error) => error instanceof Error && "code" in error ? String(error.code) : void 0;
var delay2 = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
var processIsAlive2 = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode2(error) === "EPERM";
  }
};
var withNamespaceMutationLock = async (namespaceRoot, operation, signal) => {
  const lockPath = path7.join(namespaceRoot, MUTATION_LOCK);
  const deadline = Date.now() + MUTATION_LOCK_TIMEOUT_MS;
  let identity;
  while (!identity) {
    throwIfAborted(signal);
    try {
      fs5.mkdirSync(lockPath, { mode: 448 });
      const stat = fs5.lstatSync(lockPath);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new KiroMemoryScopeError("Kiro memory mutation lock is not a real directory");
      }
      identity = { dev: stat.dev, ino: stat.ino };
      try {
        fs5.writeFileSync(
          path7.join(lockPath, MUTATION_LOCK_OWNER),
          JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }),
          { encoding: "utf8", mode: 384, flag: "wx" }
        );
      } catch (error) {
        identity = void 0;
        try {
          fs5.rmdirSync(lockPath);
        } catch {
        }
        throw error;
      }
    } catch (error) {
      if (errorCode2(error) !== "EEXIST") throw error;
      let stat;
      try {
        stat = fs5.lstatSync(lockPath);
      } catch (statError) {
        if (errorCode2(statError) === "ENOENT") continue;
        throw statError;
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new KiroMemoryScopeError("Kiro memory mutation lock is foreign");
      }
      if (Date.now() - stat.mtimeMs > STALE_MUTATION_LOCK_MS) {
        let ownerPid;
        try {
          const owner = JSON.parse(fs5.readFileSync(path7.join(lockPath, MUTATION_LOCK_OWNER), "utf8"));
          if (typeof owner.pid === "number") ownerPid = owner.pid;
        } catch {
        }
        if (ownerPid !== void 0 && processIsAlive2(ownerPid)) {
          if (Date.now() >= deadline) {
            throw new KiroMemoryScopeError("Timed out waiting for a live Kiro memory mutation lock");
          }
          await delay2(10);
          continue;
        }
        try {
          const current = fs5.lstatSync(lockPath);
          if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== stat.dev || current.ino !== stat.ino) continue;
          fs5.rmSync(path7.join(lockPath, MUTATION_LOCK_OWNER), { force: true });
          fs5.rmdirSync(lockPath);
        } catch {
          if (Date.now() >= deadline) {
            throw new KiroMemoryScopeError("Stale Kiro memory mutation lock is not reclaimable");
          }
          await delay2(10);
        }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new KiroMemoryScopeError("Timed out waiting for Kiro memory mutation lock");
      }
      await delay2(10);
    }
  }
  try {
    throwIfAborted(signal);
    return await operation();
  } finally {
    try {
      const current = fs5.lstatSync(lockPath);
      if (current.isDirectory() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino) {
        fs5.rmSync(path7.join(lockPath, MUTATION_LOCK_OWNER), { force: true });
        fs5.rmdirSync(lockPath);
      }
    } catch {
    }
  }
};
var ensureDirectory = (target) => {
  fs5.mkdirSync(target, { recursive: true, mode: 448 });
  const stat = fs5.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new KiroMemoryScopeError(`Kiro memory directory must be a real directory: ${target}`);
  }
  if (process.platform !== "win32" && typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new KiroMemoryScopeError(`Kiro memory directory is owned by another user: ${target}`);
  }
  fs5.chmodSync(target, 448);
};
var assertPrivateDirectory = (target, stat) => {
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new KiroMemoryScopeError(`Kiro memory directory must be a real directory: ${target}`);
  }
  if (process.platform !== "win32") {
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      throw new KiroMemoryScopeError(`Kiro memory directory is owned by another user: ${target}`);
    }
    if ((stat.mode & 63) !== 0) {
      throw new KiroMemoryScopeError(`Kiro memory directory must be private: ${target}`);
    }
  }
};
var readOwnershipMarker = (filePath) => {
  let descriptor2;
  try {
    descriptor2 = fs5.openSync(
      filePath,
      fs5.constants.O_RDONLY | (fs5.constants.O_NOFOLLOW ?? 0)
    );
    const stat = fs5.fstatSync(descriptor2);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8 * 1024) {
      throw new KiroMemoryScopeError(`Kiro memory ownership marker is invalid: ${filePath}`);
    }
    if (process.platform !== "win32") {
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new KiroMemoryScopeError(`Kiro memory ownership marker is owned by another user: ${filePath}`);
      }
      if ((stat.mode & 63) !== 0) {
        throw new KiroMemoryScopeError(`Kiro memory ownership marker is not private: ${filePath}`);
      }
    }
    return JSON.parse(fs5.readFileSync(descriptor2, "utf8"));
  } catch (error) {
    if (error instanceof KiroMemoryScopeError) throw error;
    throw new KiroMemoryScopeError(
      `Kiro memory directory is foreign or its ownership marker is unreadable: ${filePath}`
    );
  } finally {
    if (descriptor2 !== void 0) fs5.closeSync(descriptor2);
  }
};
var ensureOwnedDirectory = (memoryRoot, target, marker) => {
  assertNoSymlinkComponents(memoryRoot, target);
  const existing = lstatOrNull(target);
  let created = false;
  if (!existing) {
    try {
      fs5.mkdirSync(target, { mode: 448 });
      created = true;
    } catch (error) {
      if (errorCode2(error) !== "EEXIST") throw error;
    }
  }
  const stat = fs5.lstatSync(target);
  assertPrivateDirectory(target, stat);
  const markerPath = path7.join(target, OWNERSHIP_MARKER);
  if (created) {
    const temporaryMarker = path7.join(
      target,
      `.kiro-fabric-owner-${process.pid}-${crypto.randomBytes(8).toString("hex")}.tmp`
    );
    try {
      const descriptor2 = fs5.openSync(
        temporaryMarker,
        fs5.constants.O_WRONLY | fs5.constants.O_CREAT | fs5.constants.O_EXCL | (fs5.constants.O_NOFOLLOW ?? 0),
        384
      );
      try {
        fs5.writeFileSync(descriptor2, `${JSON.stringify(marker)}
`, "utf8");
        fs5.fsyncSync(descriptor2);
      } finally {
        fs5.closeSync(descriptor2);
      }
      fs5.linkSync(temporaryMarker, markerPath);
      fs5.unlinkSync(temporaryMarker);
    } catch (error) {
      try {
        fs5.unlinkSync(temporaryMarker);
      } catch {
      }
      try {
        fs5.rmdirSync(target);
      } catch {
      }
      throw error;
    }
  } else if (!lstatOrNull(markerPath)) {
    let entries = [];
    try {
      entries = fs5.readdirSync(target);
    } catch {
    }
    if (entries.every((name) => name.startsWith(".kiro-fabric-owner-"))) {
      const waiter = new Int32Array(new SharedArrayBuffer(4));
      const deadline = Date.now() + OWNERSHIP_INITIALIZATION_WAIT_MS;
      while (!lstatOrNull(markerPath) && Date.now() < deadline) {
        Atomics.wait(waiter, 0, 0, Math.min(10, deadline - Date.now()));
      }
    }
  }
  const found = readOwnershipMarker(markerPath);
  if (JSON.stringify(found) !== JSON.stringify(marker)) {
    throw new KiroMemoryScopeError(`Kiro memory directory ownership mismatch: ${target}`);
  }
};
var assertNoSymlinkComponents = (root, target) => {
  if (!isWithinOrEqual(root, target)) {
    throw new KiroMemoryScopeError(`Kiro memory path escapes its root: ${target}`);
  }
  let cursor = root;
  const relative = path7.relative(root, target);
  for (const part of relative.split(path7.sep).filter(Boolean)) {
    cursor = path7.join(cursor, part);
    const stat = lstatOrNull(cursor);
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      throw new KiroMemoryScopeError(`Kiro memory path crosses a symlink: ${cursor}`);
    }
  }
};
var canonicalDirectory = (root) => {
  const candidate = path7.resolve(assertMemoryToken(root, "root"));
  ensureDirectory(candidate);
  const canonical = fs5.realpathSync(candidate);
  const stat = fs5.statSync(canonical);
  if (!stat.isDirectory()) {
    throw new KiroMemoryScopeError(`Kiro memory root is not a directory: ${canonical}`);
  }
  return canonical;
};
var memoryNamespaceRoot = (root, namespace) => path7.join(root, MEMORY_DIR, `${encodeName(namespace)}-${hashNamespace(namespace)}`);
var entryPath = (namespaceRoot, key) => (() => {
  const name = `${encodeName(key)}.json`;
  if (utf8Bytes(name) > MAX_FILE_NAME_BYTES) {
    throw new KiroMemoryScopeError(
      `Kiro memory key is too long after filesystem-safe encoding`
    );
  }
  return path7.join(namespaceRoot, name);
})();
var readEntry = (filePath, expectedNamespace, maxValueChars) => {
  let descriptor2;
  let raw;
  try {
    descriptor2 = fs5.openSync(filePath, fs5.constants.O_RDONLY | (fs5.constants.O_NOFOLLOW ?? 0));
    const stat = fs5.fstatSync(descriptor2);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > DEFAULT_MAX_ENTRY_BYTES) {
      throw new KiroMemoryScopeError(`Kiro memory entry must be a bounded regular file: ${filePath}`);
    }
    if (process.platform !== "win32") {
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new KiroMemoryScopeError(`Kiro memory entry is owned by another user: ${filePath}`);
      }
      if ((stat.mode & 63) !== 0) {
        throw new KiroMemoryScopeError(`Kiro memory entry must be private: ${filePath}`);
      }
    }
    raw = fs5.readFileSync(descriptor2, "utf8");
  } finally {
    if (descriptor2 !== void 0) fs5.closeSync(descriptor2);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new KiroMemoryScopeError(`Kiro memory entry is foreign or malformed: ${filePath}`);
  }
  if (!parsed || typeof parsed !== "object" || parsed.format !== MEMORY_FORMAT || parsed.owner !== MEMORY_OWNER || parsed.kind !== "memory-entry" || typeof parsed.namespace !== "string" || typeof parsed.key !== "string" || typeof parsed.updatedAt !== "string" || !("value" in parsed)) {
    throw new Error(`Kiro memory entry is malformed: ${filePath}`);
  }
  let encodedValue;
  try {
    encodedValue = JSON.stringify(parsed.value);
  } catch {
  }
  if (parsed.namespace !== expectedNamespace || assertMemoryToken(parsed.key, "key") !== parsed.key || entryPath(path7.dirname(filePath), parsed.key) !== filePath || encodedValue === void 0 || encodedValue.length > maxValueChars) {
    throw new KiroMemoryScopeError(`Kiro memory entry violates its configured scope: ${filePath}`);
  }
  return {
    namespace: parsed.namespace,
    key: parsed.key,
    value: parsed.value,
    updatedAt: parsed.updatedAt,
    bytes: utf8Bytes(raw)
  };
};
var writeJsonAtomic = (filePath, content) => {
  const directory = path7.dirname(filePath);
  const temporary = path7.join(
    directory,
    `.${path7.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );
  let descriptor2;
  try {
    descriptor2 = fs5.openSync(temporary, "wx", 384);
    fs5.writeFileSync(descriptor2, content, "utf8");
    fs5.fsyncSync(descriptor2);
    fs5.closeSync(descriptor2);
    descriptor2 = void 0;
    fs5.renameSync(temporary, filePath);
    try {
      const directoryDescriptor = fs5.openSync(directory, "r");
      try {
        fs5.fsyncSync(directoryDescriptor);
      } finally {
        fs5.closeSync(directoryDescriptor);
      }
    } catch {
    }
  } catch (error) {
    if (descriptor2 !== void 0) fs5.closeSync(descriptor2);
    try {
      fs5.rmSync(temporary, { force: true });
    } catch {
    }
    throw error;
  }
};
var listEntryFiles = (namespaceRoot) => {
  try {
    return fs5.readdirSync(namespaceRoot, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => path7.join(namespaceRoot, entry.name)).sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};
var collectNamespaceEntries = (namespaceRoot, namespace, maxValueChars) => listEntryFiles(namespaceRoot).map((filePath) => readEntry(filePath, namespace, maxValueChars));
var assertEntryFits = (namespaceRoot, next, targetPath, maxEntries, maxValueChars) => {
  const entries = collectNamespaceEntries(namespaceRoot, next.namespace, maxValueChars);
  let totalBytes = next.bytes;
  let entryCount = 1;
  for (const entry of entries) {
    const currentPath = entryPath(namespaceRoot, entry.key);
    if (currentPath === targetPath) continue;
    totalBytes += entry.bytes;
    entryCount += 1;
  }
  if (next.bytes > DEFAULT_MAX_ENTRY_BYTES) {
    throw new Error(
      `Kiro memory entry exceeds ${DEFAULT_MAX_ENTRY_BYTES} bytes for namespace ${JSON.stringify(next.namespace)}`
    );
  }
  if (entryCount > maxEntries) {
    throw new Error(
      `Kiro memory namespace ${JSON.stringify(next.namespace)} exceeds ${maxEntries} entries`
    );
  }
  if (totalBytes > DEFAULT_MAX_NAMESPACE_BYTES) {
    throw new Error(
      `Kiro memory namespace ${JSON.stringify(next.namespace)} exceeds ${DEFAULT_MAX_NAMESPACE_BYTES} bytes`
    );
  }
};
var openKiroMemory = (namespace, root, limits = {}) => {
  const maxEntries = Number.isSafeInteger(limits.maxEntries) && limits.maxEntries > 0 ? Math.min(DEFAULT_MAX_NAMESPACE_ENTRIES, limits.maxEntries) : DEFAULT_MAX_NAMESPACE_ENTRIES;
  const maxValueChars = Number.isSafeInteger(limits.maxValueChars) && limits.maxValueChars > 0 ? Math.min(DEFAULT_MAX_ENTRY_BYTES, limits.maxValueChars) : DEFAULT_MAX_ENTRY_BYTES;
  const memoryNamespace = assertMemoryToken(namespace, "namespace");
  const memoryRoot = canonicalDirectory(root);
  const scopedRoot = path7.join(memoryRoot, MEMORY_DIR);
  ensureOwnedDirectory(memoryRoot, scopedRoot, {
    format: MEMORY_FORMAT,
    owner: MEMORY_OWNER,
    kind: "memory-root",
    root: memoryRoot
  });
  const namespaceRoot = memoryNamespaceRoot(memoryRoot, memoryNamespace);
  ensureOwnedDirectory(memoryRoot, namespaceRoot, {
    format: MEMORY_FORMAT,
    owner: MEMORY_OWNER,
    kind: "memory-namespace",
    root: memoryRoot,
    namespace: memoryNamespace
  });
  const resolveEntryPath = (key) => {
    const normalizedKey = assertMemoryToken(key, "key");
    const filePath = entryPath(namespaceRoot, normalizedKey);
    assertNoSymlinkComponents(memoryRoot, filePath);
    if (!isWithinOrEqual(namespaceRoot, filePath)) {
      throw new KiroMemoryScopeError(
        `Kiro memory key resolves outside namespace ${JSON.stringify(memoryNamespace)}`
      );
    }
    return filePath;
  };
  return {
    async get(key) {
      const filePath = resolveEntryPath(key);
      const stat = lstatOrNull(filePath);
      if (!stat) return null;
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new KiroMemoryScopeError(`Kiro memory entry must be a real file: ${filePath}`);
      }
      const entry = readEntry(filePath, memoryNamespace, maxValueChars);
      if (entry.namespace !== memoryNamespace) {
        throw new Error(`Kiro memory namespace mismatch for key ${JSON.stringify(entry.key)}`);
      }
      return entry;
    },
    async set(key, value, signal) {
      return withNamespaceMutationLock(namespaceRoot, () => {
        const normalizedKey = assertMemoryToken(key, "key");
        const filePath = resolveEntryPath(normalizedKey);
        let encodedValue;
        try {
          encodedValue = JSON.stringify(value);
        } catch {
          encodedValue = void 0;
        }
        if (encodedValue === void 0) {
          throw new TypeError("Kiro memory values must be JSON-serializable");
        }
        if (encodedValue.length > maxValueChars) {
          throw new Error(`Kiro memory value exceeds ${maxValueChars} configured characters`);
        }
        const normalizedValue = JSON.parse(encodedValue);
        const existing = lstatOrNull(filePath);
        if (existing) {
          if (!existing.isFile() || existing.isSymbolicLink()) {
            throw new KiroMemoryScopeError(`Kiro memory entry must be a real file: ${filePath}`);
          }
          const previous = readEntry(filePath, memoryNamespace, maxValueChars);
          if (previous.namespace !== memoryNamespace || previous.key !== normalizedKey) {
            throw new KiroMemoryScopeError(
              `Refusing foreign Kiro memory entry collision for ${JSON.stringify(normalizedKey)}`
            );
          }
        }
        const entry = {
          namespace: memoryNamespace,
          key: normalizedKey,
          value: normalizedValue,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
          bytes: 0
        };
        const content = JSON.stringify({
          format: MEMORY_FORMAT,
          owner: MEMORY_OWNER,
          kind: "memory-entry",
          namespace: entry.namespace,
          key: entry.key,
          value: entry.value,
          updatedAt: entry.updatedAt
        });
        entry.bytes = utf8Bytes(content);
        assertEntryFits(namespaceRoot, entry, filePath, maxEntries, maxValueChars);
        throwIfAborted(signal);
        writeJsonAtomic(filePath, content);
        return entry;
      }, signal);
    },
    async list() {
      const entries = collectNamespaceEntries(namespaceRoot, memoryNamespace, maxValueChars).sort((left, right) => left.key.localeCompare(right.key));
      if (entries.length > maxEntries) {
        throw new Error(
          `Kiro memory namespace ${JSON.stringify(memoryNamespace)} exceeds ${maxEntries} entries`
        );
      }
      const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
      if (totalBytes > DEFAULT_MAX_NAMESPACE_BYTES) {
        throw new Error(
          `Kiro memory namespace ${JSON.stringify(memoryNamespace)} exceeds ${DEFAULT_MAX_NAMESPACE_BYTES} bytes`
        );
      }
      return entries;
    },
    async search(query, limit = 8) {
      const needle = query.trim().toLowerCase();
      if (!needle) return [];
      const capped = Math.max(1, Math.min(Math.floor(limit), maxEntries));
      const scored = [];
      for (const entry of collectNamespaceEntries(namespaceRoot, memoryNamespace, maxValueChars)) {
        const haystack = `${entry.key}
${JSON.stringify(entry.value)}`.toLowerCase();
        const position = haystack.indexOf(needle);
        if (position === -1) continue;
        const score = (entry.key.toLowerCase().includes(needle) ? 0 : 1e5) + position;
        scored.push({ entry, score });
      }
      return scored.sort(
        (left, right) => left.score - right.score || right.entry.updatedAt.localeCompare(left.entry.updatedAt)
      ).slice(0, capped).map(({ entry }) => entry);
    },
    async index() {
      const entries = collectNamespaceEntries(namespaceRoot, memoryNamespace, maxValueChars).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      if (entries.length > maxEntries) {
        throw new Error(
          `Kiro memory namespace ${JSON.stringify(memoryNamespace)} exceeds ${maxEntries} entries`
        );
      }
      return entries.map((entry) => ({ key: entry.key, bytes: entry.bytes, updatedAt: entry.updatedAt }));
    }
  };
};

// src/kiro/memory-provider.ts
var KEY_MAX2 = 512;
var QUERY_MAX = 2e3;
var descriptors3 = [
  { name: "get", description: "Read one value from Power-scoped workspace memory", inputSchema: { type: "object", properties: { key: { type: "string", minLength: 1, maxLength: KEY_MAX2 } }, required: ["key"], additionalProperties: false }, risk: "read", effect: { kind: "read" } },
  { name: "set", description: "Persist one bounded JSON value in Power-scoped workspace memory", inputSchema: { type: "object", properties: { key: { type: "string", minLength: 1, maxLength: KEY_MAX2 }, value: {} }, required: ["key", "value"], additionalProperties: false }, risk: "write", effect: { kind: "write" } },
  { name: "search", description: "Search Power-scoped workspace memory with bounded ranked results", inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1, maxLength: QUERY_MAX }, limit: { type: "integer", minimum: 1, maximum: 32 } }, required: ["query"], additionalProperties: false }, risk: "read", effect: { kind: "read" } },
  { name: "index", description: "List bounded memory metadata without values", inputSchema: { type: "object", properties: {}, additionalProperties: false }, risk: "read", effect: { kind: "read" } }
];
var KiroMemoryProvider = class {
  name = "memory";
  description = "Private workspace-scoped Power memory";
  #root;
  #namespace;
  #maxEntries;
  #maxValueChars;
  #binding;
  constructor(options) {
    this.#root = options.root;
    this.#namespace = createHash3("sha256").update(options.cwd).digest("hex").slice(0, 32);
    this.#maxEntries = options.maxEntries;
    this.#maxValueChars = options.maxValueChars;
  }
  #memory() {
    return this.#binding ??= openKiroMemory(this.#namespace, this.#root, {
      maxEntries: this.#maxEntries,
      maxValueChars: this.#maxValueChars
    });
  }
  async list() {
    return descriptors3;
  }
  async describe(actionName) {
    return descriptors3.find((entry) => entry.name === actionName);
  }
  effectResources(_action, args) {
    return typeof args.key === "string" ? [`memory:${args.key}`] : ["memory:index"];
  }
  async invoke(actionName, args, context) {
    throwIfAborted(context.signal);
    const memory = this.#memory();
    if (actionName === "get") return await memory.get(args.key) ?? { key: args.key, found: false };
    if (actionName === "set") return memory.set(args.key, args.value, context.signal);
    if (actionName === "search") return memory.search(args.query, typeof args.limit === "number" ? args.limit : 8);
    if (actionName === "index") return memory.index();
    throw new Error(`Unknown memory action: ${actionName}`);
  }
};

// src/kiro/power/artifacts-provider.ts
var descriptor = {
  name: "read",
  description: "Read a bounded chunk of an opaque overflow artifact",
  inputSchema: { type: "object", properties: { id: { type: "string", minLength: 51, maxLength: 51 }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 16e3 } }, required: ["id"], additionalProperties: false },
  risk: "read",
  namespace: "workspace",
  effect: { kind: "read" }
};
var KiroPowerArtifactsProvider = class {
  constructor(store) {
    this.store = store;
  }
  name = "artifacts";
  description = "Bounded private Power artifacts";
  async list() {
    return [descriptor];
  }
  async describe(actionName) {
    return actionName === "read" ? descriptor : void 0;
  }
  async invoke(actionName, args, context) {
    if (actionName !== "read") throw new Error(`Unknown artifacts action: ${actionName}`);
    throwIfAborted(context.signal);
    return this.store.read(args.id, args.offset, args.limit);
  }
};

// src/kiro/runtime.ts
var createKiroRuntime = (options) => {
  const loaded = options.config ?? loadFabricPowerConfig(options.configFile, DEFAULT_FABRIC_POWER_CONFIG);
  const config = normalizeFabricPowerConfig({
    ...loaded,
    mcp: { ...loaded.mcp, configPath: options.mcpConfigPath }
  });
  const registry = new ActionRegistry();
  const artifacts = createKiroArtifactStore({ root: options.artifactsRoot, ...config.artifacts });
  registry.register(new KiroPowerArtifactsProvider(artifacts));
  if (config.mcp.enabled) registry.register(new KiroMcpProvider(options.cwd, config.mcp));
  if (options.memoryRoot && config.memory.enabled) {
    registry.register(new KiroMemoryProvider({
      cwd: options.cwd,
      root: options.memoryRoot,
      maxEntries: config.memory.maxEntries,
      maxValueChars: config.memory.maxValueChars
    }));
  } else registry.markUnavailable("memory", "workspace binding is required");
  if (options.stateRoot && config.state.enabled) registry.register(new StateProvider(options.stateRoot, config.state));
  else registry.markUnavailable("state", "workspace binding is required");
  const service = new FabricExecutionService(registry, config, options.cwd);
  return {
    service,
    registry,
    artifacts,
    providers: () => registry.providers(),
    async close() {
      try {
        await service.close();
      } finally {
        artifacts.close();
      }
    }
  };
};

// src/kiro/mcp-server.ts
var EXEC_DESCRIPTION = "Execute bounded checked TypeScript for provider composition, artifacts, Power-scoped memory, workspace-bound state, and configured MCP federation. Use Kiro native tools for files, shell, web, and subagents.";
var isRecord6 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var bounded2 = (value, fallback, maximum = 800) => (value instanceof Error ? value.message : typeof value === "string" ? value : fallback).replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, maximum) || fallback;
var toolError = (code, error, issues) => ({
  content: [{ type: "text", text: JSON.stringify({ error: { code, message: bounded2(error, "The request failed"), ...issues?.length ? { issues: issues.slice(0, 8).map((issue) => bounded2(issue, "invalid value", 200)) } : {} } }) }],
  isError: true
});
var supportsKiroPowerElicitation = (capabilities) => {
  if (!isRecord6(capabilities) || !isRecord6(capabilities.elicitation)) return false;
  return Object.keys(capabilities.elicitation).length === 0 || Object.hasOwn(capabilities.elicitation, "form");
};
var workspaceRequest = (value) => {
  if (value_exports.Check(kiroPowerWorkspaceRequestSchema, value)) return value;
  const issues = [...value_exports.Errors(kiroPowerWorkspaceRequestSchema, value)].map((entry) => entry.message);
  throw Object.assign(new Error("Invalid fabric_workspace arguments"), { issues });
};
var createKiroMcpServer = async (options) => {
  if (!options.pluginRoot || !options.pluginData) throw new Error("Power MCP launch requires PLUGIN_ROOT and PLUGIN_DATA");
  const version = options.version ?? String(JSON.parse(readFileSync(path8.join(options.pluginRoot, "package.json"), "utf8")).version);
  const server = new Server({ name: "kiro-fabric", version }, { capabilities: { tools: {} } });
  const data = prepareKiroPowerDataPaths(options.pluginData);
  const powerApprover = new KiroPowerApprover({
    supported: () => supportsKiroPowerElicitation(server.getClientCapabilities()),
    request: async ({ title: _title, message, signal, timeoutMs }) => {
      const result = await server.elicitInput({
        mode: "form",
        message,
        requestedSchema: { type: "object", properties: { approved: { type: "boolean", title: "Approve once", default: false } }, required: ["approved"] }
      }, { ...signal ? { signal } : {}, timeout: timeoutMs });
      return { action: result.action, ...isRecord6(result.content) && result.content.approved === true ? { approved: true } : {} };
    }
  });
  const binding = new KiroPowerWorkspaceBinding({
    pluginRoot: options.pluginRoot,
    pluginData: options.pluginData,
    elicitor: { approveWorkspace: (canonicalPath, signal) => powerApprover.approveOnce({ risk: "write", provider: "fabric_workspace", action: "attach", summary: `Canonical workspace: ${canonicalPath}`, ...signal ? { signal } : {} }) }
  });
  const workspaceContext = options.workspaceContext ?? new CachedWorkspaceContextProvider({
    supported: () => server.getClientCapabilities()?.roots !== void 0,
    load: async () => (await server.listRoots(void 0, { timeout: 2e3 })).roots
  });
  let workspaceSnapshot;
  let runtime = options.runtime;
  let runtimeIdentity = runtime ? "<injected>" : "";
  let closing = false;
  let lifecycleTail = Promise.resolve();
  const active = /* @__PURE__ */ new Set();
  const lifecycle = (operation) => {
    const result = lifecycleTail.then(operation, operation);
    lifecycleTail = result.then(() => void 0, () => void 0);
    return result;
  };
  const drain = async (items, reason) => {
    for (const item of items) item.controller.abort(reason);
    if (!items.length) return true;
    let timer;
    try {
      return await Promise.race([
        Promise.allSettled(items.map((item) => item.settled)).then(() => true),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), KIRO_MCP_DRAIN_TIMEOUT_MS);
          timer.unref?.();
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const closeRuntime = async (reason, knownDrained) => {
    const current = runtime;
    runtime = void 0;
    runtimeIdentity = "";
    if (!current) return;
    const leases = [...active].filter((item) => item.runtime === current);
    const drained = knownDrained ?? await drain(leases, reason);
    if (drained || !leases.length) await current.close();
    else void Promise.allSettled(leases.map((item) => item.settled)).then(() => current.close()).catch(() => {
    });
  };
  const syncWorkspace = async (force = false) => {
    const snapshot = await workspaceContext.current({ force });
    await lifecycle(async () => {
      workspaceSnapshot = snapshot;
      const before = binding.bindingIdentity();
      if (snapshot.status !== "temporarily-unavailable") {
        binding.updateClientRoots(snapshot.roots);
      }
      const observation = binding.workspaceObservation();
      const contextBlocks = snapshot.status === "temporarily-unavailable" && binding.bindingSource() !== "manual";
      if (before !== binding.bindingIdentity() || contextBlocks || observation.status === "temporarily-unavailable") {
        await closeRuntime(new Error("workspace identity became unavailable or changed"));
      }
    });
    return snapshot;
  };
  const createRuntimeFor = async (workspace) => {
    const project = workspace ? prepareKiroPowerProjectPaths(data.projects, workspace) : void 0;
    const create = options.prepareRuntime ?? createKiroRuntime;
    return create({
      cwd: workspace?.canonicalPath ?? data.root,
      configFile: data.configFile,
      mcpConfigPath: data.mcpConfig,
      artifactsRoot: project?.artifacts ?? data.artifacts,
      ...project ? { memoryRoot: project.memory, stateRoot: project.state } : {}
    });
  };
  const runtimeForIdentity = async () => {
    const observation = binding.workspaceObservation();
    if (observation.status === "temporarily-unavailable") throw new Error("bound workspace is temporarily unverifiable");
    const workspace = observation.status === "verified" ? observation.workspace : void 0;
    const identity = binding.bindingIdentity();
    if (runtime && (runtimeIdentity === identity || runtimeIdentity === "<injected>")) return runtime;
    await closeRuntime(new Error("workspace binding changed"));
    runtime = await createRuntimeFor(workspace);
    runtimeIdentity = identity;
    return runtime;
  };
  const getRuntime = () => lifecycle(async () => {
    if (closing) throw new Error("Power MCP server is shutting down");
    return runtimeForIdentity();
  });
  const acquireRuntime = (controller) => lifecycle(async () => {
    if (closing) throw new Error("Power MCP server is shutting down");
    const current = await runtimeForIdentity();
    let settle;
    const settled = new Promise((resolve) => {
      settle = resolve;
    });
    const execution = { controller, runtime: current, settled, settle };
    active.add(execution);
    return { current, execution };
  });
  const unavailableWorkspace = () => workspaceSnapshot?.status === "temporarily-unavailable" && binding.bindingSource() !== "manual";
  server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
    workspaceContext.invalidate();
    await syncWorkspace(true);
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    await syncWorkspace();
    return { tools: [
      { name: "fabric_info", description: "Report bounded Kiro Fabric Power health and provider status without secrets.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "fabric_workspace", description: "Inspect or explicitly bind the canonical workspace used for Power-scoped state and memory.", inputSchema: JSON.parse(JSON.stringify(kiroPowerWorkspaceRequestSchema)), annotations: { readOnlyHint: false } },
      { name: "fabric_exec", description: EXEC_DESCRIPTION, inputSchema: fabricExecInputSchemaJson(), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } }
    ] };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    await syncWorkspace();
    const name = request.params.name;
    if (name === "fabric_info") {
      if (Object.keys(request.params.arguments ?? {}).length) return toolError("invalid_info_arguments", "fabric_info accepts no arguments");
      try {
        const workspaceObservation = binding.workspaceObservation();
        const workspaceBlocked = unavailableWorkspace() || workspaceObservation.status === "temporarily-unavailable";
        const current = workspaceBlocked ? runtime : await getRuntime();
        const limits = current?.service.config.executor ?? loadFabricPowerConfig(data.configFile).executor;
        const providers = current ? current.providers().map((provider) => workspaceBlocked ? { ...provider, available: false, reason: "workspace identity is temporarily unverifiable" } : provider) : ["artifacts", "memory", "state", "mcp"].map((name2) => ({
          name: name2,
          description: "Provider unavailable until workspace identity can be verified",
          available: false,
          reason: "workspace identity is temporarily unverifiable"
        }));
        return { content: [{ type: "text", text: JSON.stringify({
          product: "kiro-fabric-power",
          version,
          executor: "quickjs",
          limits,
          workspace: {
            ...binding.status(),
            context: workspaceSnapshot?.status ?? "temporarily-unavailable",
            verification: workspaceObservation.status
          },
          providers,
          nativeKiroTools: { files: true, shell: true, web: true, subagents: true, owner: "kiro" }
        }) }] };
      } catch (error) {
        return toolError("info_request_failed", error);
      }
    }
    if (name === "fabric_workspace") {
      try {
        const parsed = workspaceRequest(request.params.arguments ?? {});
        if (parsed.action === "status") return { content: [{ type: "text", text: JSON.stringify({
          ...binding.status(),
          context: workspaceSnapshot?.status ?? "temporarily-unavailable",
          verification: binding.workspaceObservation().status
        }) }] };
        if (parsed.action === "list") return { content: [{ type: "text", text: JSON.stringify({
          ...binding.list(),
          context: workspaceSnapshot?.status ?? "temporarily-unavailable"
        }) }] };
        if (parsed.action === "select" && unavailableWorkspace()) throw new Error("workspace roots are temporarily unverifiable");
        const mutation = await binding.prepareMutation(parsed, extra.signal);
        const result = await lifecycle(async () => {
          const before = binding.bindingIdentity();
          const committed = binding.commitMutation(mutation);
          if (before !== binding.bindingIdentity()) await closeRuntime(new Error("workspace binding changed"));
          return committed;
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error) {
        const issues = isRecord6(error) && Array.isArray(error.issues) ? error.issues : void 0;
        return toolError("workspace_request_failed", error, issues);
      }
    }
    if (name !== "fabric_exec") return toolError("unknown_tool", `Unknown tool: ${String(name)}`);
    if (unavailableWorkspace()) return toolError("workspace_unavailable", "workspace roots are temporarily unverifiable");
    const normalized = prepareFabricExecArgumentsWithDiagnostics(request.params.arguments ?? {});
    const normalizedRecord = isRecord6(normalized.value) ? normalized.value : void 0;
    const absoluteInputError = typeof normalizedRecord?.code === "string" ? fabricSourceLimitError(normalizedRecord.code, MAX_EXECUTOR_SOURCE_BYTES) : void 0;
    const absolutePayloadError = isRecord6(normalizedRecord?.payloads) ? fabricPayloadsLimitError(
      normalizedRecord.payloads,
      MAX_EXECUTOR_SOURCE_BYTES
    ) : void 0;
    if (absoluteInputError || absolutePayloadError) {
      return toolError("invalid_exec_arguments", absoluteInputError ?? absolutePayloadError);
    }
    if (!value_exports.Check(fabricExecInputSchema, normalized.value)) {
      const errors = [...value_exports.Errors(fabricExecInputSchema, normalized.value)].map((entry) => entry.message);
      return toolError("invalid_exec_arguments", "Invalid fabric_exec arguments", errors);
    }
    const input = normalized.value;
    const controller = new AbortController();
    const cancel = () => controller.abort(extra.signal.reason ?? new Error("MCP request cancelled"));
    if (extra.signal.aborted) cancel();
    else extra.signal.addEventListener("abort", cancel, { once: true });
    let execution;
    let timer;
    try {
      const acquired = await acquireRuntime(controller);
      execution = acquired.execution;
      const current = acquired.current;
      const outerDeadline = kiroMcpOuterDeadlineMs(
        current.service.config.executor.maxTimeoutMs,
        FABRIC_COMPILER_TIMEOUT_MS
      );
      timer = setTimeout(() => controller.abort(new Error(`MCP request exceeded ${outerDeadline}ms`)), outerDeadline);
      timer.unref?.();
      const approver = new KiroPowerFabricApprover(
        current.service.config.approvals,
        powerApprover,
        current.service.cwd
      );
      const result = await current.service.execute({
        code: input.code,
        ...input.payloads ? { payloads: input.payloads } : {},
        ...input.timeoutMs !== void 0 ? { timeoutMs: input.timeoutMs } : {},
        signal: controller.signal,
        approver
      });
      const projection = projectFabricExecutionText({
        result,
        resultFormat: input.resultFormat ?? current.service.config.executor.resultFormat,
        maxOutputChars: current.service.config.executor.maxOutputChars,
        writeArtifact: (content) => current.artifacts.write(content),
        normalizationDiagnostics: normalized.diagnostics.map(({ field, repair }) => ({ field, repair }))
      });
      return { content: [{ type: "text", text: projection.text }], ...projection.isError ? { isError: true } : {} };
    } catch (error) {
      return toolError("adapter_error", error);
    } finally {
      if (timer) clearTimeout(timer);
      if (execution) {
        active.delete(execution);
        execution.settle();
      }
      extra.signal.removeEventListener("abort", cancel);
    }
  });
  await server.connect(new StdioServerTransport());
  let closeTask;
  return { close() {
    closeTask ??= (async () => {
      try {
        await lifecycle(async () => {
          closing = true;
          const reason = new Error("Power MCP server shutting down");
          const drained = await drain([...active], reason);
          await closeRuntime(reason, drained);
        });
      } finally {
        await server.close();
      }
    })();
    return closeTask;
  } };
};
export {
  createKiroMcpServer,
  supportsKiroPowerElicitation
};
