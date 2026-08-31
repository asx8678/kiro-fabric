import { createRequire as __kfCreateRequire } from "node:module";
import { fileURLToPath as __kfFileURLToPath } from "node:url";
import { dirname as __kfDirname } from "node:path";
globalThis.__filename = __kfFileURLToPath(import.meta.url);
globalThis.__dirname = __kfDirname(globalThis.__filename);
const require = __kfCreateRequire(import.meta.url);

import {
  MAX_AGENT_TIMEOUT_MS,
  MIN_AGENT_TIMEOUT_MS,
  assertKiroAccountingCompatible,
  fabricExecInputSchema,
  fabricExecInputSchemaJson,
  fsyncDirectory,
  isFabricThinking,
  loadFabricConfig,
  normalizeRunDisplay,
  prepareFabricExecArguments,
  require_dist,
  resolveAgentDir,
  writeFileAtomic
} from "./chunk-6UT4PSAK.js";
import {
  spawnDetached
} from "./chunk-5A4B7V74.js";
import {
  runAbortable,
  settleWithin,
  throwIfAborted
} from "./chunk-SY6LZTI3.js";
import {
  fabricSourceLimitError
} from "./chunk-PGDCKPF6.js";
import {
  sanitizeMcpRefPart
} from "./chunk-NVONZONP.js";
import "./chunk-D27TRCNO.js";
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
} from "./chunk-YLCJCAIG.js";
import {
  KIRO_SEMANTIC_CONTEXT_MAX_ITEMS,
  KIRO_SEMANTIC_CONTEXT_MAX_ITEM_CHARS,
  KIRO_SEMANTIC_CONTEXT_MAX_OBJECTIVE_CHARS,
  MAX_AGENT_STEER_LINE_BYTES,
  normalizeKiroSemanticContext,
  value_exports
} from "./chunk-7TD7WBCG.js";
import {
  KIRO_EXECUTION_TIMEOUT_MS,
  KIRO_MCP_CALL_TIMEOUT_MS,
  assertSupportedKiro,
  assertSupportedKiroUnchanged
} from "./chunk-ULR3BHCM.js";
import {
  processInstanceIdentity,
  processInstanceIsAlive,
  readPackageVersion,
  resolveKiroProjectRoot,
  sha256Bytes
} from "./chunk-G3LPLMI7.js";
import {
  createProcessTreeController
} from "./chunk-SXRQQ7MG.js";
import {
  kiroChildToolRefs,
  parseKiroChildTools
} from "./chunk-PL2W3NQY.js";
import {
  __commonJS,
  __toESM
} from "./chunk-GX475RD4.js";

// node_modules/.pnpm/ignore@7.0.5/node_modules/ignore/index.js
var require_ignore = __commonJS({
  "node_modules/.pnpm/ignore@7.0.5/node_modules/ignore/index.js"(exports, module) {
    function makeArray(subject) {
      return Array.isArray(subject) ? subject : [subject];
    }
    var UNDEFINED = void 0;
    var EMPTY = "";
    var SPACE = " ";
    var ESCAPE = "\\";
    var REGEX_TEST_BLANK_LINE = /^\s+$/;
    var REGEX_INVALID_TRAILING_BACKSLASH = /(?:[^\\]|^)\\$/;
    var REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION = /^\\!/;
    var REGEX_REPLACE_LEADING_EXCAPED_HASH = /^\\#/;
    var REGEX_SPLITALL_CRLF = /\r?\n/g;
    var REGEX_TEST_INVALID_PATH = /^\.{0,2}\/|^\.{1,2}$/;
    var REGEX_TEST_TRAILING_SLASH = /\/$/;
    var SLASH = "/";
    var TMP_KEY_IGNORE = "node-ignore";
    if (typeof Symbol !== "undefined") {
      TMP_KEY_IGNORE = Symbol.for("node-ignore");
    }
    var KEY_IGNORE = TMP_KEY_IGNORE;
    var define = (object, key, value) => {
      Object.defineProperty(object, key, { value });
      return value;
    };
    var REGEX_REGEXP_RANGE = /([0-z])-([0-z])/g;
    var RETURN_FALSE = () => false;
    var sanitizeRange = (range2) => range2.replace(
      REGEX_REGEXP_RANGE,
      (match2, from, to) => from.charCodeAt(0) <= to.charCodeAt(0) ? match2 : EMPTY
    );
    var cleanRangeBackSlash = (slashes) => {
      const { length } = slashes;
      return slashes.slice(0, length - length % 2);
    };
    var REPLACERS = [
      [
        // Remove BOM
        // TODO:
        // Other similar zero-width characters?
        /^\uFEFF/,
        () => EMPTY
      ],
      // > Trailing spaces are ignored unless they are quoted with backslash ("\")
      [
        // (a\ ) -> (a )
        // (a  ) -> (a)
        // (a ) -> (a)
        // (a \ ) -> (a  )
        /((?:\\\\)*?)(\\?\s+)$/,
        (_, m1, m2) => m1 + (m2.indexOf("\\") === 0 ? SPACE : EMPTY)
      ],
      // Replace (\ ) with ' '
      // (\ ) -> ' '
      // (\\ ) -> '\\ '
      // (\\\ ) -> '\\ '
      [
        /(\\+?)\s/g,
        (_, m1) => {
          const { length } = m1;
          return m1.slice(0, length - length % 2) + SPACE;
        }
      ],
      // Escape metacharacters
      // which is written down by users but means special for regular expressions.
      // > There are 12 characters with special meanings:
      // > - the backslash \,
      // > - the caret ^,
      // > - the dollar sign $,
      // > - the period or dot .,
      // > - the vertical bar or pipe symbol |,
      // > - the question mark ?,
      // > - the asterisk or star *,
      // > - the plus sign +,
      // > - the opening parenthesis (,
      // > - the closing parenthesis ),
      // > - and the opening square bracket [,
      // > - the opening curly brace {,
      // > These special characters are often called "metacharacters".
      [
        /[\\$.|*+(){^]/g,
        (match2) => `\\${match2}`
      ],
      [
        // > a question mark (?) matches a single character
        /(?!\\)\?/g,
        () => "[^/]"
      ],
      // leading slash
      [
        // > A leading slash matches the beginning of the pathname.
        // > For example, "/*.c" matches "cat-file.c" but not "mozilla-sha1/sha1.c".
        // A leading slash matches the beginning of the pathname
        /^\//,
        () => "^"
      ],
      // replace special metacharacter slash after the leading slash
      [
        /\//g,
        () => "\\/"
      ],
      [
        // > A leading "**" followed by a slash means match in all directories.
        // > For example, "**/foo" matches file or directory "foo" anywhere,
        // > the same as pattern "foo".
        // > "**/foo/bar" matches file or directory "bar" anywhere that is directly
        // >   under directory "foo".
        // Notice that the '*'s have been replaced as '\\*'
        /^\^*\\\*\\\*\\\//,
        // '**/foo' <-> 'foo'
        () => "^(?:.*\\/)?"
      ],
      // starting
      [
        // there will be no leading '/'
        //   (which has been replaced by section "leading slash")
        // If starts with '**', adding a '^' to the regular expression also works
        /^(?=[^^])/,
        function startingReplacer() {
          return !/\/(?!$)/.test(this) ? "(?:^|\\/)" : "^";
        }
      ],
      // two globstars
      [
        // Use lookahead assertions so that we could match more than one `'/**'`
        /\\\/\\\*\\\*(?=\\\/|$)/g,
        // Zero, one or several directories
        // should not use '*', or it will be replaced by the next replacer
        // Check if it is not the last `'/**'`
        (_, index, str) => index + 6 < str.length ? "(?:\\/[^\\/]+)*" : "\\/.+"
      ],
      // normal intermediate wildcards
      [
        // Never replace escaped '*'
        // ignore rule '\*' will match the path '*'
        // 'abc.*/' -> go
        // 'abc.*'  -> skip this rule,
        //    coz trailing single wildcard will be handed by [trailing wildcard]
        /(^|[^\\]+)(\\\*)+(?=.+)/g,
        // '*.js' matches '.js'
        // '*.js' doesn't match 'abc'
        (_, p1, p2) => {
          const unescaped = p2.replace(/\\\*/g, "[^\\/]*");
          return p1 + unescaped;
        }
      ],
      [
        // unescape, revert step 3 except for back slash
        // For example, if a user escape a '\\*',
        // after step 3, the result will be '\\\\\\*'
        /\\\\\\(?=[$.|*+(){^])/g,
        () => ESCAPE
      ],
      [
        // '\\\\' -> '\\'
        /\\\\/g,
        () => ESCAPE
      ],
      [
        // > The range notation, e.g. [a-zA-Z],
        // > can be used to match one of the characters in a range.
        // `\` is escaped by step 3
        /(\\)?\[([^\]/]*?)(\\*)($|\])/g,
        (match2, leadEscape, range2, endEscape, close) => leadEscape === ESCAPE ? `\\[${range2}${cleanRangeBackSlash(endEscape)}${close}` : close === "]" ? endEscape.length % 2 === 0 ? `[${sanitizeRange(range2)}${endEscape}]` : "[]" : "[]"
      ],
      // ending
      [
        // 'js' will not match 'js.'
        // 'ab' will not match 'abc'
        /(?:[^*])$/,
        // WTF!
        // https://git-scm.com/docs/gitignore
        // changes in [2.22.1](https://git-scm.com/docs/gitignore/2.22.1)
        // which re-fixes #24, #38
        // > If there is a separator at the end of the pattern then the pattern
        // > will only match directories, otherwise the pattern can match both
        // > files and directories.
        // 'js*' will not match 'a.js'
        // 'js/' will not match 'a.js'
        // 'js' will match 'a.js' and 'a.js/'
        (match2) => /\/$/.test(match2) ? `${match2}$` : `${match2}(?=$|\\/$)`
      ]
    ];
    var REGEX_REPLACE_TRAILING_WILDCARD = /(^|\\\/)?\\\*$/;
    var MODE_IGNORE = "regex";
    var MODE_CHECK_IGNORE = "checkRegex";
    var UNDERSCORE = "_";
    var TRAILING_WILD_CARD_REPLACERS = {
      [MODE_IGNORE](_, p1) {
        const prefix = p1 ? `${p1}[^/]+` : "[^/]*";
        return `${prefix}(?=$|\\/$)`;
      },
      [MODE_CHECK_IGNORE](_, p1) {
        const prefix = p1 ? `${p1}[^/]*` : "[^/]*";
        return `${prefix}(?=$|\\/$)`;
      }
    };
    var makeRegexPrefix = (pattern) => REPLACERS.reduce(
      (prev, [matcher, replacer]) => prev.replace(matcher, replacer.bind(pattern)),
      pattern
    );
    var isString = (subject) => typeof subject === "string";
    var checkPattern = (pattern) => pattern && isString(pattern) && !REGEX_TEST_BLANK_LINE.test(pattern) && !REGEX_INVALID_TRAILING_BACKSLASH.test(pattern) && pattern.indexOf("#") !== 0;
    var splitPattern = (pattern) => pattern.split(REGEX_SPLITALL_CRLF).filter(Boolean);
    var IgnoreRule = class {
      constructor(pattern, mark, body, ignoreCase, negative, prefix) {
        this.pattern = pattern;
        this.mark = mark;
        this.negative = negative;
        define(this, "body", body);
        define(this, "ignoreCase", ignoreCase);
        define(this, "regexPrefix", prefix);
      }
      get regex() {
        const key = UNDERSCORE + MODE_IGNORE;
        if (this[key]) {
          return this[key];
        }
        return this._make(MODE_IGNORE, key);
      }
      get checkRegex() {
        const key = UNDERSCORE + MODE_CHECK_IGNORE;
        if (this[key]) {
          return this[key];
        }
        return this._make(MODE_CHECK_IGNORE, key);
      }
      _make(mode, key) {
        const str = this.regexPrefix.replace(
          REGEX_REPLACE_TRAILING_WILDCARD,
          // It does not need to bind pattern
          TRAILING_WILD_CARD_REPLACERS[mode]
        );
        const regex = this.ignoreCase ? new RegExp(str, "i") : new RegExp(str);
        return define(this, key, regex);
      }
    };
    var createRule = ({
      pattern,
      mark
    }, ignoreCase) => {
      let negative = false;
      let body = pattern;
      if (body.indexOf("!") === 0) {
        negative = true;
        body = body.substr(1);
      }
      body = body.replace(REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION, "!").replace(REGEX_REPLACE_LEADING_EXCAPED_HASH, "#");
      const regexPrefix = makeRegexPrefix(body);
      return new IgnoreRule(
        pattern,
        mark,
        body,
        ignoreCase,
        negative,
        regexPrefix
      );
    };
    var RuleManager = class {
      constructor(ignoreCase) {
        this._ignoreCase = ignoreCase;
        this._rules = [];
      }
      _add(pattern) {
        if (pattern && pattern[KEY_IGNORE]) {
          this._rules = this._rules.concat(pattern._rules._rules);
          this._added = true;
          return;
        }
        if (isString(pattern)) {
          pattern = {
            pattern
          };
        }
        if (checkPattern(pattern.pattern)) {
          const rule = createRule(pattern, this._ignoreCase);
          this._added = true;
          this._rules.push(rule);
        }
      }
      // @param {Array<string> | string | Ignore} pattern
      add(pattern) {
        this._added = false;
        makeArray(
          isString(pattern) ? splitPattern(pattern) : pattern
        ).forEach(this._add, this);
        return this._added;
      }
      // Test one single path without recursively checking parent directories
      //
      // - checkUnignored `boolean` whether should check if the path is unignored,
      //   setting `checkUnignored` to `false` could reduce additional
      //   path matching.
      // - check `string` either `MODE_IGNORE` or `MODE_CHECK_IGNORE`
      // @returns {TestResult} true if a file is ignored
      test(path20, checkUnignored, mode) {
        let ignored = false;
        let unignored = false;
        let matchedRule;
        this._rules.forEach((rule) => {
          const { negative } = rule;
          if (unignored === negative && ignored !== unignored || negative && !ignored && !unignored && !checkUnignored) {
            return;
          }
          const matched = rule[mode].test(path20);
          if (!matched) {
            return;
          }
          ignored = !negative;
          unignored = negative;
          matchedRule = negative ? UNDEFINED : rule;
        });
        const ret = {
          ignored,
          unignored
        };
        if (matchedRule) {
          ret.rule = matchedRule;
        }
        return ret;
      }
    };
    var throwError = (message, Ctor) => {
      throw new Ctor(message);
    };
    var checkPath = (path20, originalPath, doThrow) => {
      if (!isString(path20)) {
        return doThrow(
          `path must be a string, but got \`${originalPath}\``,
          TypeError
        );
      }
      if (!path20) {
        return doThrow(`path must not be empty`, TypeError);
      }
      if (checkPath.isNotRelative(path20)) {
        const r = "`path.relative()`d";
        return doThrow(
          `path should be a ${r} string, but got "${originalPath}"`,
          RangeError
        );
      }
      return true;
    };
    var isNotRelative = (path20) => REGEX_TEST_INVALID_PATH.test(path20);
    checkPath.isNotRelative = isNotRelative;
    checkPath.convert = (p) => p;
    var Ignore = class {
      constructor({
        ignorecase = true,
        ignoreCase = ignorecase,
        allowRelativePaths = false
      } = {}) {
        define(this, KEY_IGNORE, true);
        this._rules = new RuleManager(ignoreCase);
        this._strictPathCheck = !allowRelativePaths;
        this._initCache();
      }
      _initCache() {
        this._ignoreCache = /* @__PURE__ */ Object.create(null);
        this._testCache = /* @__PURE__ */ Object.create(null);
      }
      add(pattern) {
        if (this._rules.add(pattern)) {
          this._initCache();
        }
        return this;
      }
      // legacy
      addPattern(pattern) {
        return this.add(pattern);
      }
      // @returns {TestResult}
      _test(originalPath, cache2, checkUnignored, slices) {
        const path20 = originalPath && checkPath.convert(originalPath);
        checkPath(
          path20,
          originalPath,
          this._strictPathCheck ? throwError : RETURN_FALSE
        );
        return this._t(path20, cache2, checkUnignored, slices);
      }
      checkIgnore(path20) {
        if (!REGEX_TEST_TRAILING_SLASH.test(path20)) {
          return this.test(path20);
        }
        const slices = path20.split(SLASH).filter(Boolean);
        slices.pop();
        if (slices.length) {
          const parent = this._t(
            slices.join(SLASH) + SLASH,
            this._testCache,
            true,
            slices
          );
          if (parent.ignored) {
            return parent;
          }
        }
        return this._rules.test(path20, false, MODE_CHECK_IGNORE);
      }
      _t(path20, cache2, checkUnignored, slices) {
        if (path20 in cache2) {
          return cache2[path20];
        }
        if (!slices) {
          slices = path20.split(SLASH).filter(Boolean);
        }
        slices.pop();
        if (!slices.length) {
          return cache2[path20] = this._rules.test(path20, checkUnignored, MODE_IGNORE);
        }
        const parent = this._t(
          slices.join(SLASH) + SLASH,
          cache2,
          checkUnignored,
          slices
        );
        return cache2[path20] = parent.ignored ? parent : this._rules.test(path20, checkUnignored, MODE_IGNORE);
      }
      ignores(path20) {
        return this._test(path20, this._ignoreCache, false).ignored;
      }
      createFilter() {
        return (path20) => !this.ignores(path20);
      }
      filter(paths) {
        return makeArray(paths).filter(this.createFilter());
      }
      // @returns {TestResult}
      test(path20) {
        return this._test(path20, this._testCache, true);
      }
    };
    var factory = (options) => new Ignore(options);
    var isPathValid = (path20) => checkPath(path20 && checkPath.convert(path20), path20, RETURN_FALSE);
    var setupWindows = () => {
      const makePosix = (str) => /^\\\\\?\\/.test(str) || /["<>|\u0000-\u001F]+/u.test(str) ? str : str.replace(/\\/g, "/");
      checkPath.convert = makePosix;
      const REGEX_TEST_WINDOWS_PATH_ABSOLUTE = /^[a-z]:\//i;
      checkPath.isNotRelative = (path20) => REGEX_TEST_WINDOWS_PATH_ABSOLUTE.test(path20) || isNotRelative(path20);
    };
    if (
      // Detect `process` so that it can run in browsers.
      typeof process !== "undefined" && process.platform === "win32"
    ) {
      setupWindows();
    }
    module.exports = factory;
    factory.default = factory;
    module.exports.isPathValid = isPathValid;
    define(module.exports, Symbol.for("setupWindows"), setupWindows);
  }
});

// src/kiro/mcp-server.ts
import { randomUUID as randomUUID7 } from "node:crypto";
import { readFileSync } from "node:fs";
import path19 from "node:path";

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
          const errorMessage3 = validatedRequest.error instanceof Error ? validatedRequest.error.message : String(validatedRequest.error);
          throw new McpError(ErrorCode.InvalidParams, `Invalid tools/call request: ${errorMessage3}`);
        }
        const { params } = validatedRequest.data;
        const result = await Promise.resolve(handler(request, extra));
        if (params.task) {
          const taskValidationResult = safeParse(CreateTaskResultSchema, result);
          if (!taskValidationResult.success) {
            const errorMessage3 = taskValidationResult.error instanceof Error ? taskValidationResult.error.message : String(taskValidationResult.error);
            throw new McpError(ErrorCode.InvalidParams, `Invalid task creation result: ${errorMessage3}`);
          }
          return taskValidationResult.data;
        }
        const validationResult = safeParse(CallToolResultSchema, result);
        if (!validationResult.success) {
          const errorMessage3 = validationResult.error instanceof Error ? validationResult.error.message : String(validationResult.error);
          throw new McpError(ErrorCode.InvalidParams, `Invalid tools/call result: ${errorMessage3}`);
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

// src/kiro/power/approver.ts
import path from "node:path";
var SECRET_NAME = "(?:access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|client[_-]?secret|api[_-]?key|private[_-]?key|authorization|cookie|password|secret|token)";
var SECRET = new RegExp(
  `\\b(${SECRET_NAME})\\b["']?\\s*[:=]\\s*(?:"[^"\\r\\n]*"|'[^'\\r\\n]*'|[^\\r\\n,;}]+)`,
  "gi"
);
var NORMALIZED_SECRET_KEY = /^(?:accesstoken|refreshtoken|idtoken|authtoken|clientsecret|apikey|privatekey|authorization|cookie|password|secret|token)$/i;
var isSecretKey = (key) => NORMALIZED_SECRET_KEY.test(key.replace(/[_\-\s]/g, ""));
var bounded = (value, maximum = 1500) => value.replace(SECRET, "$1=<redacted>").slice(0, maximum);
var KiroPowerApprover = class {
  constructor(adapter, timeoutMs = 3e4) {
    this.adapter = adapter;
    this.timeoutMs = timeoutMs;
  }
  async approveOnce(request) {
    if (!this.adapter.supported() || request.signal?.aborted) return false;
    try {
      const result = await this.adapter.request({
        title: "Approve one Fabric action",
        message: bounded(`Risk: ${request.risk}
Action: ${request.provider}.${request.action}
${request.summary}`),
        ...request.signal ? { signal: request.signal } : {},
        timeoutMs: this.timeoutMs
      });
      return !request.signal?.aborted && result.action === "accept" && result.approved === true;
    } catch {
      return false;
    }
  }
};
var summarizeArguments = (args, cwd) => {
  const projectPath = (value) => {
    if (!path.isAbsolute(value)) return value;
    const relative2 = path.relative(cwd, value);
    if (relative2 === "") return ".";
    return !relative2.startsWith(`..${path.sep}`) && relative2 !== ".." && !path.isAbsolute(relative2) ? relative2 : "<outside-workspace>";
  };
  const safe = {};
  for (const [key, value] of Object.entries(args).slice(0, 12)) {
    if (isSecretKey(key) || /env/i.test(key)) {
      safe[key] = "<redacted>";
    } else if (typeof value === "string") {
      safe[key] = /(?:path|file|cwd|root)/i.test(key) ? projectPath(value).slice(0, 500) : bounded(value, 500);
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      safe[key] = value;
    } else if (Array.isArray(value)) {
      safe[key] = `<${value.length} items>`;
    } else {
      safe[key] = "<object>";
    }
  }
  return bounded(JSON.stringify(safe), 1500);
};
var KiroPowerFabricApprover = class {
  constructor(config, elicitation, cwd) {
    this.config = config;
    this.elicitation = elicitation;
    this.cwd = cwd;
  }
  async approve(action, args, scope = {}) {
    const mode = this.config[action.risk];
    if (mode === "allow") return;
    if (mode === "deny") throw new Error(`${action.ref} is denied by Fabric policy`);
    const approved = await this.elicitation.approveOnce({
      risk: action.risk,
      provider: action.provider,
      action: action.name,
      summary: `${summarizeArguments(args, this.cwd)}${scope.projectDigest ? "\nWorkspace-bound request" : ""}`
    });
    if (!approved) throw new Error(`${action.ref} approval was denied or unavailable`);
  }
};

// src/kiro/power/data-paths.ts
import { createHash } from "node:crypto";
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import path2 from "node:path";
var privateDirectory = (directory, boundary) => {
  const root = path2.resolve(boundary);
  const rootStats = lstatSync(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error(`Power storage root is a symlink or non-directory: ${boundary}`);
  }
  const target = path2.resolve(directory);
  const relative2 = path2.relative(root, target);
  if (relative2 === ".." || relative2.startsWith(`..${path2.sep}`) || path2.isAbsolute(relative2)) {
    throw new Error(`Power data path escapes its storage root: ${directory}`);
  }
  let cursor = root;
  for (const segment of relative2.split(path2.sep).filter(Boolean)) {
    cursor = path2.join(cursor, segment);
    try {
      mkdirSync(cursor, { mode: 448 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const stats = lstatSync(cursor);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`Power data path contains a symlink or non-directory: ${cursor}`);
    }
    chmodSync(cursor, 448);
  }
  return target;
};
var privateMcpConfig = (configDirectory) => {
  const target = path2.join(configDirectory, "mcporter.json");
  try {
    const descriptor = openSync(target, "wx", 384);
    try {
      writeFileSync(descriptor, `${JSON.stringify({ mcpServers: {}, imports: [] }, null, 2)}
`);
    } finally {
      closeSync(descriptor);
    }
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const stats = lstatSync(target);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
    throw new Error(`Power MCP configuration is a symlink, hardlink, or non-file: ${target}`);
  }
  chmodSync(target, 384);
  return target;
};
var prepareKiroPowerDataPaths = (pluginData) => {
  const root = privateDirectory(path2.join(pluginData, "fabric"), pluginData);
  const config = privateDirectory(path2.join(root, "config"), root);
  return {
    root,
    config,
    mcpConfig: privateMcpConfig(config),
    cache: privateDirectory(path2.join(root, "global", "cache"), root),
    logs: privateDirectory(path2.join(root, "global", "logs"), root),
    projects: privateDirectory(path2.join(root, "projects"), root),
    daemon: privateDirectory(path2.join(root, "daemon"), root)
  };
};
var kiroPowerWorkspaceId = (canonicalRoot) => createHash("sha256").update("kiro-fabric-power-workspace-v1\0").update(canonicalRoot).digest("hex");
var prepareKiroPowerProjectPaths = (projects, canonicalRoot) => {
  const root = privateDirectory(path2.join(projects, kiroPowerWorkspaceId(canonicalRoot)), projects);
  return {
    root,
    memory: privateDirectory(path2.join(root, "memory"), root),
    state: privateDirectory(path2.join(root, "state"), root),
    runs: privateDirectory(path2.join(root, "runs"), root),
    artifacts: privateDirectory(path2.join(root, "artifacts"), root),
    logs: privateDirectory(path2.join(root, "logs"), root)
  };
};

// src/kiro/power/workspace-binding.ts
import { createHash as createHash2 } from "node:crypto";
import { lstatSync as lstatSync2, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path3 from "node:path";
import { fileURLToPath } from "node:url";
var idFor = (root) => createHash2("sha256").update("kiro-fabric-power-session-root-v1\0").update(root).digest("hex").slice(0, 16);
var KiroPowerWorkspaceBinding = class {
  #pluginRoot;
  #pluginData;
  #elicitor;
  #candidates = [];
  #binding;
  #initialAutoBindAllowed = true;
  constructor(options) {
    this.#pluginRoot = options.pluginRoot;
    this.#pluginData = options.pluginData;
    this.#elicitor = options.elicitor;
  }
  #canonical(candidate) {
    if (!path3.isAbsolute(candidate)) throw new Error("workspace root must be absolute");
    const resolved = path3.resolve(candidate);
    const lexical = lstatSync2(resolved);
    const root = realpathSync(resolved);
    if (lexical.isSymbolicLink() || root !== resolved) {
      throw new Error("workspace root must be a canonical, non-symlink directory");
    }
    const stats = statSync(root, { bigint: true });
    if (!stats.isDirectory()) throw new Error("workspace root must be an existing directory");
    const home = realpathSync(os.homedir());
    const kiroHome = path3.join(home, ".kiro");
    const kiroRelative = path3.relative(kiroHome, root);
    const insideKiroHome = kiroRelative === "" || kiroRelative !== ".." && !kiroRelative.startsWith(`..${path3.sep}`) && !path3.isAbsolute(kiroRelative);
    const unsafe = [path3.parse(root).root, home, this.#pluginRoot, this.#pluginData];
    if (unsafe.includes(root) || insideKiroHome) {
      throw new Error("workspace root is too broad or reserved");
    }
    for (const reserved of [this.#pluginRoot, this.#pluginData]) {
      const rootInsideReserved = path3.relative(reserved, root);
      const reservedInsideRoot = path3.relative(root, reserved);
      const isContained = (relative2) => relative2 === "" || relative2 !== ".." && !relative2.startsWith(`..${path3.sep}`) && !path3.isAbsolute(relative2);
      if (isContained(rootInsideReserved) || isContained(reservedInsideRoot)) {
        throw new Error("workspace root and plugin storage must not contain one another");
      }
    }
    return { id: idFor(root), root, name: path3.basename(root) || "workspace", dev: stats.dev, ino: stats.ino };
  }
  updateClientRoots(roots) {
    const candidates = [];
    for (const item of roots) {
      try {
        if (!item.uri.startsWith("file:")) continue;
        const candidate = this.#canonical(fileURLToPath(item.uri));
        candidates.push({ ...candidate, name: (item.name?.trim() || candidate.name).slice(0, 120) });
      } catch {
      }
    }
    this.#candidates = [...new Map(candidates.map((entry) => [entry.id, entry])).values()];
    if (this.#binding?.source === "client-roots" && !this.#candidates.some((entry) => entry.id === this.#binding.id)) {
      this.#binding = void 0;
      this.#initialAutoBindAllowed = false;
    }
    if (this.#candidates.length > 1) this.#initialAutoBindAllowed = false;
    if (!this.#binding && this.#initialAutoBindAllowed && this.#candidates.length === 1) {
      this.#binding = { ...this.#candidates[0], source: "client-roots" };
      this.#initialAutoBindAllowed = false;
    }
  }
  boundRoot() {
    const binding = this.#binding;
    if (!binding) return void 0;
    try {
      const current = this.#canonical(binding.root);
      if (current.dev !== binding.dev || current.ino !== binding.ino) throw new Error("identity changed");
      return binding.root;
    } catch {
      this.#binding = void 0;
      this.#initialAutoBindAllowed = false;
      return void 0;
    }
  }
  status() {
    const root = this.boundRoot();
    return root ? { status: "bound", rootId: this.#binding.id, name: this.#binding.name, source: this.#binding.source, capabilities: ["checked-execution", "overflow-artifacts", "state"] } : { status: "unbound", requiresSelection: this.#candidates.length > 1, capabilities: ["checked-execution", "overflow-artifacts"] };
  }
  list() {
    return { ...this.status(), roots: this.#candidates.map(({ id, name }) => ({ rootId: id, name })) };
  }
  async handle(request, signal) {
    switch (request.action) {
      case "status":
        return this.status();
      case "list":
        return this.list();
      case "detach":
        this.#binding = void 0;
        this.#initialAutoBindAllowed = false;
        return this.status();
      case "select": {
        const candidate = this.#candidates.find((entry) => entry.id === request.rootId);
        if (!candidate) throw new Error("unknown workspace rootId; call fabric_workspace list first");
        this.#binding = { ...candidate, source: "client-roots" };
        this.#initialAutoBindAllowed = false;
        return this.status();
      }
      case "attach": {
        const candidate = this.#canonical(request.path);
        if (!this.#elicitor) throw new Error("manual workspace attachment requires MCP elicitation support");
        if (signal?.aborted || !await this.#elicitor.approveWorkspace(candidate.root, signal) || signal?.aborted) {
          throw new Error("manual workspace attachment was not approved");
        }
        this.#binding = { ...candidate, source: "manual" };
        this.#initialAutoBindAllowed = false;
        return this.status();
      }
    }
  }
};

// src/ui/structured.ts
var import_yaml = __toESM(require_dist(), 1);

// src/util.ts
var countNewlines = (value) => {
  let count = 0;
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) === 10) count++;
  }
  return count;
};
var truncateMiddle = (value, maxChars) => {
  if (value.length <= maxChars) return value;
  const marker = `

... ${value.length - maxChars} characters omitted by Pi Fabric ...

`;
  const available = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(available / 2);
  const tail = Math.floor(available / 2);
  return `${value.slice(0, head)}${marker}${value.slice(value.length - tail)}`;
};

// src/ui/structured.ts
var normalizeJsonValue = (value) => {
  try {
    const serialized = JSON.stringify(value);
    return serialized === void 0 ? void 0 : JSON.parse(serialized);
  } catch {
    return void 0;
  }
};
var formatJsonAsYaml = (value) => {
  const normalized = normalizeJsonValue(value);
  if (normalized === void 0) return void 0;
  return (0, import_yaml.stringify)(normalized, { indent: 2, lineWidth: 0 }).trimEnd();
};
var isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var hoistMultilineStrings = (value, path20, sections, seen) => {
  if (typeof value === "string") {
    if (!value.includes("\n")) return value;
    sections.push({ path: path20, text: value });
    return `<multi-line string, see section: ${path20}>`;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[circular reference]";
    seen.add(value);
    const skeleton = value.map(
      (item, index) => hoistMultilineStrings(item, `${path20}[${index}]`, sections, seen)
    );
    seen.delete(value);
    return skeleton;
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return "[circular reference]";
    seen.add(value);
    const skeleton = {};
    for (const [key, item] of Object.entries(value)) {
      skeleton[key] = hoistMultilineStrings(
        item,
        path20 ? `${path20}.${key}` : key,
        sections,
        seen
      );
    }
    seen.delete(value);
    return skeleton;
  }
  return value;
};
var boundedSection = (value, maxChars) => {
  if (value.length <= maxChars) return value;
  if (maxChars <= 0) return "";
  let omitted = value.length - maxChars;
  let marker = `\u2026[${omitted} chars omitted]\u2026`;
  for (let pass = 0; pass < 2; pass++) {
    omitted = value.length - Math.max(0, maxChars - marker.length);
    marker = `\u2026[${omitted} chars omitted]\u2026`;
  }
  if (marker.length >= maxChars) return marker.slice(0, maxChars);
  const available = maxChars - marker.length;
  const head = Math.ceil(available / 2);
  const tail = Math.floor(available / 2);
  return `${value.slice(0, head)}${marker}${value.slice(value.length - tail)}`;
};
var fairSectionBudgets = (lengths, budget) => {
  const budgets = Array.from({ length: lengths.length }, () => 0);
  const pending = lengths.map((length, index) => ({ length, index })).sort((left, right) => left.length - right.length);
  let remaining = Math.max(0, budget);
  for (let position = 0; position < pending.length; position++) {
    const item = pending[position];
    const share = Math.floor(remaining / (pending.length - position));
    const allocated = Math.min(item.length, share);
    budgets[item.index] = allocated;
    remaining -= allocated;
  }
  return budgets;
};
var renderHoistedSections = (yaml, sections, maxChars) => {
  const headers = sections.map((section) => `--- ${section.path} (${section.text.length} chars) ---
`);
  const separators = sections.length * 2;
  const fixedChars = yaml.length + separators + headers.reduce((sum, header) => sum + header.length, 0);
  const fullChars = fixedChars + sections.reduce((sum, section) => sum + section.text.length, 0);
  const budgets = maxChars !== void 0 && fullChars > maxChars ? fairSectionBudgets(sections.map((section) => section.text.length), maxChars - fixedChars) : sections.map((section) => section.text.length);
  const raw = sections.map((section, index) => `${headers[index]}${boundedSection(section.text, budgets[index])}`).join("\n\n");
  return `${yaml}

${raw}`;
};
var formatFabricValue = (value, format, maxChars) => {
  if (value === void 0) return { text: "" };
  if (format === "text" && typeof value === "object" && value !== null && "text" in value) {
    const text = value.text;
    if (typeof text === "string") return { text };
  }
  if (typeof value === "string") return { text: value };
  if (format === "auto" || format === "yaml") {
    const sections = [];
    const skeleton = hoistMultilineStrings(value, "", sections, /* @__PURE__ */ new Set());
    const yaml = formatJsonAsYaml(skeleton);
    if (yaml !== void 0) {
      if (sections.length === 0) return { text: yaml, language: "yaml" };
      return {
        text: renderHoistedSections(yaml, sections, maxChars),
        language: "yaml",
        highlightedLineCount: countNewlines(yaml) + 1
      };
    }
  }
  try {
    return {
      text: JSON.stringify(value, null, format === "json" ? 2 : 0),
      ...format === "json" ? { language: "json" } : {}
    };
  } catch {
    return { text: String(value) };
  }
};

// src/failure-progress.ts
var MAX_COMPLETED_CALLS = 8;
var MAX_PATH_CHARS = 100;
var compactPath = (value) => {
  const singleLine = value.replaceAll(/\s+/g, " ").trim();
  if (singleLine.length <= MAX_PATH_CHARS) return singleLine;
  return `\u2026${singleLine.slice(-(MAX_PATH_CHARS - 1))}`;
};
var formatFailureProgress = (trace) => {
  if (trace.outcome === "succeeded") return void 0;
  const completed = trace.operations.filter(
    (operation) => operation.outcome === "succeeded"
  );
  if (completed.length === 0) return void 0;
  const summaries = completed.slice(0, MAX_COMPLETED_CALLS).map((operation) => {
    const path20 = operation.args.path;
    return typeof path20 === "string" ? `${operation.ref}(${compactPath(path20)})` : operation.ref;
  });
  const omitted = completed.length - summaries.length;
  return [
    `Completed before the outer failure (outputs not returned): ${summaries.join("; ")}${omitted > 0 ? `; +${omitted} more` : ""}.`,
    "Successful calls may already have changed the workspace; inspect before repeating mutations."
  ].join("\n");
};

// src/output-budget.ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path4 from "node:path";
var MAX_FAILURE_MODEL_OUTPUT_CHARS = 2e4;
var modelOutputBudget = (configuredMaxChars, success) => success ? configuredMaxChars : Math.min(configuredMaxChars, MAX_FAILURE_MODEL_OUTPUT_CHARS);
var writeOutputArtifact = async (content) => {
  const directory = await mkdtemp(path4.join(tmpdir(), "kiro-fabric-output-"));
  const artifactPath = path4.join(directory, "output.txt");
  await writeFile(artifactPath, content, { encoding: "utf8", mode: 384 });
  return artifactPath;
};
var boundModelOutput = async (visible, maxChars, fullOutput = visible, writeArtifact = writeOutputArtifact, artifactReadHint = (id) => `k.readArtifact({ id: "${id}" })`) => {
  if (visible.length <= maxChars && fullOutput.length <= maxChars) {
    return { text: visible, originalChars: fullOutput.length, omittedChars: 0 };
  }
  let artifactPath;
  try {
    artifactPath = await writeArtifact(fullOutput);
  } catch {
    artifactPath = void 0;
  }
  const suffix = artifactPath ? artifactPath.startsWith("ka_") ? `

[Full output (${fullOutput.length} chars) available as artifact ${artifactPath}; read it with ${artifactReadHint(artifactPath)}.]` : `

[Full output (${fullOutput.length} chars) saved to: ${artifactPath}]` : "";
  const bodyBudget = Math.max(1, maxChars - suffix.length);
  const text = `${truncateMiddle(visible, bodyBudget)}${suffix}`;
  return {
    text: text.length <= maxChars ? text : truncateMiddle(text, maxChars),
    ...artifactPath ? { artifactPath } : {},
    originalChars: fullOutput.length,
    omittedChars: Math.max(0, fullOutput.length - Math.min(fullOutput.length, bodyBudget))
  };
};

// src/type-error-guidance.ts
var SYNTAX_ERROR_PATTERN = /expected|unterminated|unexpected|invalid character/i;
var PAYLOAD_CALL_PATTERN = /\bpi\.(?:edit|write)\s*\(/;
var typeErrorRecoveryHint = (code, errors) => {
  if (!PAYLOAD_CALL_PATTERN.test(code)) return void 0;
  if (!errors.some((error) => SYNTAX_ERROR_PATTERN.test(error.message))) {
    return void 0;
  }
  return "Recovery hint: if embedded edit/write payload text caused the syntax error, pass it through top-level `strings` and reference `\u03C0.key` instead of escaping it inside `code`.";
};

// node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/base.js
var Diff = class {
  diff(oldStr, newStr, options = {}) {
    let callback;
    if (typeof options === "function") {
      callback = options;
      options = {};
    } else if ("callback" in options) {
      callback = options.callback;
    }
    const oldString = this.castInput(oldStr, options);
    const newString = this.castInput(newStr, options);
    const oldTokens = this.removeEmpty(this.tokenize(oldString, options));
    const newTokens = this.removeEmpty(this.tokenize(newString, options));
    return this.diffWithOptionsObj(oldTokens, newTokens, options, callback);
  }
  diffWithOptionsObj(oldTokens, newTokens, options, callback) {
    var _a2;
    const done = (value) => {
      value = this.postProcess(value, options);
      if (callback) {
        setTimeout(function() {
          callback(value);
        }, 0);
        return void 0;
      } else {
        return value;
      }
    };
    const newLen = newTokens.length, oldLen = oldTokens.length;
    let editLength = 1;
    let maxEditLength = newLen + oldLen;
    if (options.maxEditLength != null) {
      maxEditLength = Math.min(maxEditLength, options.maxEditLength);
    }
    const maxExecutionTime = (_a2 = options.timeout) !== null && _a2 !== void 0 ? _a2 : Infinity;
    const abortAfterTimestamp = Date.now() + maxExecutionTime;
    const bestPath = [{ oldPos: -1, lastComponent: void 0 }];
    let newPos = this.extractCommon(bestPath[0], newTokens, oldTokens, 0, options);
    if (bestPath[0].oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
      return done(this.buildValues(bestPath[0].lastComponent, newTokens, oldTokens));
    }
    let minDiagonalToConsider = -Infinity, maxDiagonalToConsider = Infinity;
    const execEditLength = () => {
      for (let diagonalPath = Math.max(minDiagonalToConsider, -editLength); diagonalPath <= Math.min(maxDiagonalToConsider, editLength); diagonalPath += 2) {
        let basePath;
        const removePath = bestPath[diagonalPath - 1], addPath = bestPath[diagonalPath + 1];
        if (removePath) {
          bestPath[diagonalPath - 1] = void 0;
        }
        let canAdd = false;
        if (addPath) {
          const addPathNewPos = addPath.oldPos - diagonalPath;
          canAdd = addPath && 0 <= addPathNewPos && addPathNewPos < newLen;
        }
        const canRemove = removePath && removePath.oldPos + 1 < oldLen;
        if (!canAdd && !canRemove) {
          bestPath[diagonalPath] = void 0;
          continue;
        }
        if (!canRemove || canAdd && removePath.oldPos < addPath.oldPos) {
          basePath = this.addToPath(addPath, true, false, 0, options);
        } else {
          basePath = this.addToPath(removePath, false, true, 1, options);
        }
        newPos = this.extractCommon(basePath, newTokens, oldTokens, diagonalPath, options);
        if (basePath.oldPos + 1 >= oldLen && newPos + 1 >= newLen) {
          return done(this.buildValues(basePath.lastComponent, newTokens, oldTokens)) || true;
        } else {
          bestPath[diagonalPath] = basePath;
          if (basePath.oldPos + 1 >= oldLen) {
            maxDiagonalToConsider = Math.min(maxDiagonalToConsider, diagonalPath - 1);
          }
          if (newPos + 1 >= newLen) {
            minDiagonalToConsider = Math.max(minDiagonalToConsider, diagonalPath + 1);
          }
        }
      }
      editLength++;
    };
    if (callback) {
      (function exec() {
        setTimeout(function() {
          if (editLength > maxEditLength || Date.now() > abortAfterTimestamp) {
            return callback(void 0);
          }
          if (!execEditLength()) {
            exec();
          }
        }, 0);
      })();
    } else {
      while (editLength <= maxEditLength && Date.now() <= abortAfterTimestamp) {
        const ret = execEditLength();
        if (ret) {
          return ret;
        }
      }
    }
  }
  addToPath(path20, added, removed, oldPosInc, options) {
    const last = path20.lastComponent;
    if (last && !options.oneChangePerToken && last.added === added && last.removed === removed) {
      return {
        oldPos: path20.oldPos + oldPosInc,
        lastComponent: { count: last.count + 1, added, removed, previousComponent: last.previousComponent }
      };
    } else {
      return {
        oldPos: path20.oldPos + oldPosInc,
        lastComponent: { count: 1, added, removed, previousComponent: last }
      };
    }
  }
  extractCommon(basePath, newTokens, oldTokens, diagonalPath, options) {
    const newLen = newTokens.length, oldLen = oldTokens.length;
    let oldPos = basePath.oldPos, newPos = oldPos - diagonalPath, commonCount = 0;
    while (newPos + 1 < newLen && oldPos + 1 < oldLen && this.equals(oldTokens[oldPos + 1], newTokens[newPos + 1], options)) {
      newPos++;
      oldPos++;
      commonCount++;
      if (options.oneChangePerToken) {
        basePath.lastComponent = { count: 1, previousComponent: basePath.lastComponent, added: false, removed: false };
      }
    }
    if (commonCount && !options.oneChangePerToken) {
      basePath.lastComponent = { count: commonCount, previousComponent: basePath.lastComponent, added: false, removed: false };
    }
    basePath.oldPos = oldPos;
    return newPos;
  }
  equals(left, right, options) {
    if (options.comparator) {
      return options.comparator(left, right);
    } else {
      return left === right || !!options.ignoreCase && left.toLowerCase() === right.toLowerCase();
    }
  }
  removeEmpty(array) {
    const ret = [];
    for (let i = 0; i < array.length; i++) {
      if (array[i]) {
        ret.push(array[i]);
      }
    }
    return ret;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  castInput(value, options) {
    return value;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tokenize(value, options) {
    return Array.from(value);
  }
  join(chars) {
    return chars.join("");
  }
  postProcess(changeObjects, options) {
    return changeObjects;
  }
  get useLongestToken() {
    return false;
  }
  buildValues(lastComponent, newTokens, oldTokens) {
    const components = [];
    let nextComponent;
    while (lastComponent) {
      components.push(lastComponent);
      nextComponent = lastComponent.previousComponent;
      delete lastComponent.previousComponent;
      lastComponent = nextComponent;
    }
    components.reverse();
    const componentLen = components.length;
    let componentPos = 0, newPos = 0, oldPos = 0;
    for (; componentPos < componentLen; componentPos++) {
      const component = components[componentPos];
      if (!component.removed) {
        if (!component.added && this.useLongestToken) {
          let value = newTokens.slice(newPos, newPos + component.count);
          value = value.map(function(value2, i) {
            const oldValue = oldTokens[oldPos + i];
            return oldValue.length > value2.length ? oldValue : value2;
          });
          component.value = this.join(value);
        } else {
          component.value = this.join(newTokens.slice(newPos, newPos + component.count));
        }
        newPos += component.count;
        if (!component.added) {
          oldPos += component.count;
        }
      } else {
        component.value = this.join(oldTokens.slice(oldPos, oldPos + component.count));
        oldPos += component.count;
      }
    }
    return components;
  }
};

// node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/line.js
var LineDiff = class extends Diff {
  constructor() {
    super(...arguments);
    this.tokenize = tokenize;
  }
  equals(left, right, options) {
    if (options.ignoreWhitespace) {
      if (!options.newlineIsToken || !left.includes("\n")) {
        left = left.trim();
      }
      if (!options.newlineIsToken || !right.includes("\n")) {
        right = right.trim();
      }
    } else if (options.ignoreNewlineAtEof && !options.newlineIsToken) {
      if (left.endsWith("\n")) {
        left = left.slice(0, -1);
      }
      if (right.endsWith("\n")) {
        right = right.slice(0, -1);
      }
    }
    return super.equals(left, right, options);
  }
};
var lineDiff = new LineDiff();
function diffLines(oldStr, newStr, options) {
  return lineDiff.diff(oldStr, newStr, options);
}
function tokenize(value, options) {
  if (options.stripTrailingCr) {
    value = value.replace(/\r\n/g, "\n");
  }
  const retLines = [], linesAndNewlines = value.split(/(\n|\r\n)/);
  if (!linesAndNewlines[linesAndNewlines.length - 1]) {
    linesAndNewlines.pop();
  }
  for (let i = 0; i < linesAndNewlines.length; i++) {
    const line = linesAndNewlines[i];
    if (i % 2 && !options.newlineIsToken) {
      retLines[retLines.length - 1] += line;
    } else {
      retLines.push(line);
    }
  }
  return retLines;
}

// node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/patch/create.js
function needsQuoting(s) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] < " " || s[i] > "~" || s[i] === '"' || s[i] === "\\") {
      return true;
    }
  }
  return false;
}
function quoteFileNameIfNeeded(s) {
  if (!needsQuoting(s)) {
    return s;
  }
  let result = '"';
  const bytes = new TextEncoder().encode(s);
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 7) {
      result += "\\a";
    } else if (b === 8) {
      result += "\\b";
    } else if (b === 9) {
      result += "\\t";
    } else if (b === 10) {
      result += "\\n";
    } else if (b === 11) {
      result += "\\v";
    } else if (b === 12) {
      result += "\\f";
    } else if (b === 13) {
      result += "\\r";
    } else if (b === 34) {
      result += '\\"';
    } else if (b === 92) {
      result += "\\\\";
    } else if (b >= 32 && b <= 126) {
      result += String.fromCharCode(b);
    } else {
      result += "\\" + b.toString(8).padStart(3, "0");
    }
    i++;
  }
  result += '"';
  return result;
}
var INCLUDE_HEADERS = {
  includeIndex: true,
  includeUnderline: true,
  includeFileHeaders: true
};
function structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options) {
  let optionsObj;
  if (!options) {
    optionsObj = {};
  } else if (typeof options === "function") {
    optionsObj = { callback: options };
  } else {
    optionsObj = options;
  }
  if (typeof optionsObj.context === "undefined") {
    optionsObj.context = 4;
  }
  const context = optionsObj.context;
  if (optionsObj.newlineIsToken) {
    throw new Error("newlineIsToken may not be used with patch-generation functions, only with diffing functions");
  }
  if (!optionsObj.callback) {
    return diffLinesResultToPatch(diffLines(oldStr, newStr, optionsObj));
  } else {
    const { callback } = optionsObj;
    diffLines(oldStr, newStr, Object.assign(Object.assign({}, optionsObj), { callback: (diff) => {
      const patch = diffLinesResultToPatch(diff);
      callback(patch);
    } }));
  }
  function diffLinesResultToPatch(diff) {
    if (!diff) {
      return;
    }
    diff.push({ value: "", lines: [] });
    function contextLines(lines) {
      return lines.map(function(entry) {
        return " " + entry;
      });
    }
    const hunks = [];
    let oldRangeStart = 0, newRangeStart = 0, curRange = [], oldLine = 1, newLine = 1;
    for (let i = 0; i < diff.length; i++) {
      const current = diff[i], lines = current.lines || splitLines(current.value);
      current.lines = lines;
      if (current.added || current.removed) {
        if (!oldRangeStart) {
          const prev = diff[i - 1];
          oldRangeStart = oldLine;
          newRangeStart = newLine;
          if (prev) {
            curRange = context > 0 ? contextLines(prev.lines.slice(-context)) : [];
            oldRangeStart -= curRange.length;
            newRangeStart -= curRange.length;
          }
        }
        for (const line of lines) {
          curRange.push((current.added ? "+" : "-") + line);
        }
        if (current.added) {
          newLine += lines.length;
        } else {
          oldLine += lines.length;
        }
      } else {
        if (oldRangeStart) {
          if (lines.length <= context * 2 && i < diff.length - 2) {
            for (const line of contextLines(lines)) {
              curRange.push(line);
            }
          } else {
            const contextSize = Math.min(lines.length, context);
            for (const line of contextLines(lines.slice(0, contextSize))) {
              curRange.push(line);
            }
            const hunk = {
              oldStart: oldRangeStart,
              oldLines: oldLine - oldRangeStart + contextSize,
              newStart: newRangeStart,
              newLines: newLine - newRangeStart + contextSize,
              lines: curRange
            };
            hunks.push(hunk);
            oldRangeStart = 0;
            newRangeStart = 0;
            curRange = [];
          }
        }
        oldLine += lines.length;
        newLine += lines.length;
      }
    }
    for (const hunk of hunks) {
      for (let i = 0; i < hunk.lines.length; i++) {
        if (hunk.lines[i].endsWith("\n")) {
          hunk.lines[i] = hunk.lines[i].slice(0, -1);
        } else {
          hunk.lines.splice(i + 1, 0, "\\ No newline at end of file");
          i++;
        }
      }
    }
    return {
      oldFileName,
      newFileName,
      oldHeader,
      newHeader,
      hunks
    };
  }
}
function formatPatch(patch, headerOptions) {
  var _a2, _b, _c, _d, _e, _f;
  if (!headerOptions) {
    headerOptions = INCLUDE_HEADERS;
  }
  if (Array.isArray(patch)) {
    if (patch.length > 1 && !headerOptions.includeFileHeaders && !patch.every((p) => p.isGit)) {
      throw new Error("Cannot omit file headers on a multi-file patch. (The result would be unparseable; how would a tool trying to apply the patch know which changes are to which file?)");
    }
    return patch.map((p) => formatPatch(p, headerOptions)).join("\n");
  }
  const ret = [];
  if (patch.isGit) {
    headerOptions = INCLUDE_HEADERS;
    if (!patch.oldFileName) {
      throw new Error("oldFileName must be specified for Git patches");
    }
    if (!patch.newFileName) {
      throw new Error("newFileName must be specified for Git patches");
    }
    let gitOldName = patch.oldFileName;
    let gitNewName = patch.newFileName;
    if (patch.isCreate && gitOldName === "/dev/null") {
      gitOldName = gitNewName.replace(/^b\//, "a/");
    } else if (patch.isDelete && gitNewName === "/dev/null") {
      gitNewName = gitOldName.replace(/^a\//, "b/");
    }
    ret.push("diff --git " + quoteFileNameIfNeeded(gitOldName) + " " + quoteFileNameIfNeeded(gitNewName));
    if (patch.isDelete) {
      ret.push("deleted file mode " + ((_a2 = patch.oldMode) !== null && _a2 !== void 0 ? _a2 : "100644"));
    }
    if (patch.isCreate) {
      ret.push("new file mode " + ((_b = patch.newMode) !== null && _b !== void 0 ? _b : "100644"));
    }
    if (patch.oldMode && patch.newMode && !patch.isDelete && !patch.isCreate) {
      ret.push("old mode " + patch.oldMode);
      ret.push("new mode " + patch.newMode);
    }
    if (patch.isRename) {
      ret.push("rename from " + quoteFileNameIfNeeded(((_c = patch.oldFileName) !== null && _c !== void 0 ? _c : "").replace(/^a\//, "")));
      ret.push("rename to " + quoteFileNameIfNeeded(((_d = patch.newFileName) !== null && _d !== void 0 ? _d : "").replace(/^b\//, "")));
    }
    if (patch.isCopy) {
      ret.push("copy from " + quoteFileNameIfNeeded(((_e = patch.oldFileName) !== null && _e !== void 0 ? _e : "").replace(/^a\//, "")));
      ret.push("copy to " + quoteFileNameIfNeeded(((_f = patch.newFileName) !== null && _f !== void 0 ? _f : "").replace(/^b\//, "")));
    }
  } else {
    if (headerOptions.includeIndex && patch.oldFileName == patch.newFileName && patch.oldFileName !== void 0) {
      ret.push("Index: " + patch.oldFileName);
    }
    if (headerOptions.includeUnderline) {
      ret.push("===================================================================");
    }
  }
  const hasHunks = patch.hunks.length > 0;
  if (headerOptions.includeFileHeaders && patch.oldFileName !== void 0 && patch.newFileName !== void 0 && (!patch.isGit || hasHunks)) {
    ret.push("--- " + quoteFileNameIfNeeded(patch.oldFileName) + (patch.oldHeader ? "	" + patch.oldHeader : ""));
    ret.push("+++ " + quoteFileNameIfNeeded(patch.newFileName) + (patch.newHeader ? "	" + patch.newHeader : ""));
  }
  for (let i = 0; i < patch.hunks.length; i++) {
    const hunk = patch.hunks[i];
    const oldStart = hunk.oldLines === 0 ? hunk.oldStart - 1 : hunk.oldStart;
    const newStart = hunk.newLines === 0 ? hunk.newStart - 1 : hunk.newStart;
    ret.push("@@ -" + oldStart + "," + hunk.oldLines + " +" + newStart + "," + hunk.newLines + " @@");
    for (const line of hunk.lines) {
      ret.push(line);
    }
  }
  return ret.join("\n") + "\n";
}
function createTwoFilesPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options) {
  if (typeof options === "function") {
    options = { callback: options };
  }
  if (!(options === null || options === void 0 ? void 0 : options.callback)) {
    const patchObj = structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options);
    if (!patchObj) {
      return;
    }
    return formatPatch(patchObj, options === null || options === void 0 ? void 0 : options.headerOptions);
  } else {
    const { callback } = options;
    structuredPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, Object.assign(Object.assign({}, options), { callback: (patchObj) => {
      if (!patchObj) {
        callback(void 0);
      } else {
        callback(formatPatch(patchObj, options.headerOptions));
      }
    } }));
  }
}
function splitLines(text) {
  const hasTrailingNl = text.endsWith("\n");
  const result = text.split("\n").map((line) => line + "\n");
  if (hasTrailingNl) {
    result.pop();
  } else {
    result.push(result.pop().slice(0, -1));
  }
  return result;
}

// src/kiro/mutation-diff.ts
var MUTATION_REFS = /* @__PURE__ */ new Set(["k.edit", "k.write"]);
var MAX_DIFFS = 8;
var MAX_DIFF_CHARS = 8e3;
var RESET = "\x1B[0m";
var ADD = "\x1B[32m";
var DEL = "\x1B[31m";
var HUNK = "\x1B[36m";
var META = "\x1B[2m";
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var stringOf = (value) => typeof value === "string" && value.length > 0 ? value : void 0;
var mutationPath = (audit) => {
  const args = isRecord(audit.args) ? audit.args : void 0;
  return stringOf(args?.path) ?? stringOf(args?.file) ?? stringOf(args?.absolutePath) ?? audit.ref;
};
var writeDiff = (audit, preview, previewDetails) => {
  if (audit.ref !== "k.write" || preview?.writeBeforeCaptured !== true) return void 0;
  const after = typeof preview.writeContent === "string" ? preview.writeContent : void 0;
  if (after === void 0) return void 0;
  const beforeValue = preview.codePreviewBeforeWrite ?? previewDetails?.codePreviewBeforeWrite;
  const beforeRecord = isRecord(beforeValue) ? beforeValue : void 0;
  const before = beforeRecord?.kind === "content" && typeof beforeRecord.content === "string" ? beforeRecord.content : beforeValue === void 0 ? "" : void 0;
  if (before === void 0 || before === after) return void 0;
  const displayPath = mutationPath(audit).replace(/^[/\\]+/u, "");
  const patch = createTwoFilesPatch(
    `a/${displayPath}`,
    `b/${displayPath}`,
    before,
    after,
    void 0,
    void 0,
    { context: 3 }
  );
  return patch.replace(/^={3,}\n/u, "").trimEnd() || void 0;
};
var mutationDiff = (audit) => {
  const preview = isRecord(audit.preview) ? audit.preview : void 0;
  const previewDetails = isRecord(preview?.details) ? preview.details : void 0;
  const result = isRecord(audit.result) ? audit.result : void 0;
  const resultDetails = isRecord(result?.details) ? result.details : void 0;
  return stringOf(previewDetails?.diff) ?? stringOf(resultDetails?.diff) ?? writeDiff(audit, preview, previewDetails);
};
var countDiff = (diff) => {
  let additions = 0;
  let removals = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) removals++;
  }
  return { additions, removals };
};
var clipDiff = (diff, maxChars) => {
  if (diff.length <= maxChars) return diff;
  return `${diff.slice(0, Math.max(0, maxChars - 24)).trimEnd()}
... diff truncated ...`;
};
var colorizeUnifiedDiff = (diff) => diff.split("\n").map((line) => {
  if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("diff ")) {
    return `${META}${line}${RESET}`;
  }
  if (line.startsWith("@@")) return `${HUNK}${line}${RESET}`;
  if (line.startsWith("+") && !line.startsWith("+++")) return `${ADD}${line}${RESET}`;
  if (line.startsWith("-") && !line.startsWith("---")) return `${DEL}${line}${RESET}`;
  return line.startsWith(" ") ? `${META}${line}${RESET}` : line;
}).join("\n");
var colorizeReturnedMutationDiffs = (text, audits) => {
  let colored = text;
  for (const audit of audits) {
    if (!MUTATION_REFS.has(audit.ref) || audit.success !== true) continue;
    const diff = mutationDiff(audit);
    if (diff && colored.includes(diff)) {
      colored = colored.replaceAll(diff, colorizeUnifiedDiff(diff));
    }
  }
  return colored;
};
var formatMutationDiffs = (audits, alreadyShown = "") => {
  const blocks = [];
  let omitted = 0;
  for (const audit of audits) {
    if (!MUTATION_REFS.has(audit.ref) || audit.success !== true) continue;
    const diff = mutationDiff(audit);
    if (!diff) continue;
    const fingerprint = diff.slice(0, 160);
    if (fingerprint && alreadyShown.includes(fingerprint)) continue;
    if (blocks.length >= MAX_DIFFS) {
      omitted++;
      continue;
    }
    const { additions, removals } = countDiff(diff);
    const header = `${META}${audit.ref} ${mutationPath(audit)}  +${additions} \u2212${removals}${RESET}`;
    blocks.push(`${header}
${colorizeUnifiedDiff(clipDiff(diff, MAX_DIFF_CHARS))}`);
  }
  if (blocks.length === 0) return void 0;
  const note = omitted > 0 ? `
${META}+${omitted} more diffs omitted${RESET}` : "";
  return blocks.join("\n\n") + note;
};

// src/kiro/projection.ts
var KIRO_MODEL_OUTPUT_MAX_CHARS = 16e3;
var projectFabricExecutionText = async (options) => {
  const { result, code, resultFormat, maxOutputChars, writeArtifact, artifactReadHint } = options;
  const outputBudget = modelOutputBudget(
    Math.min(maxOutputChars, KIRO_MODEL_OUTPUT_MAX_CHARS),
    result.success
  );
  if (result.typeErrors) {
    const text = result.typeErrors.map(
      (error) => error.line > 0 ? `Line ${error.line}:${error.column} \u2014 ${error.message}` : error.message
    ).join("\n");
    const recoveryHint = typeErrorRecoveryHint(code, result.typeErrors);
    const fullOutput2 = `Type errors; code was not executed:
${text}${recoveryHint ? `

${recoveryHint}` : ""}`;
    const bounded3 = await boundModelOutput(
      fullOutput2,
      outputBudget,
      fullOutput2,
      writeArtifact,
      artifactReadHint
    );
    return { text: bounded3.text, isError: true };
  }
  const formatted = formatFabricValue(result.value, resultFormat, outputBudget);
  const fullFormatted = formatFabricValue(result.value, resultFormat);
  const failureProgress = formatFailureProgress(
    result.trace
  );
  const renderOutput = (formattedText) => {
    const sections = [...result.logs];
    const visibleBeforeDiff = [...result.logs, formattedText].filter(Boolean).join("\n\n");
    if (formattedText) {
      sections.push(colorizeReturnedMutationDiffs(
        formattedText,
        result.audits
      ));
    }
    const mutationDiffs = formatMutationDiffs(
      result.audits,
      visibleBeforeDiff
    );
    if (mutationDiffs) sections.push(`Changes:
${mutationDiffs}`);
    if (result.error) sections.push(`Runtime error: ${result.error}`);
    if (failureProgress) sections.push(failureProgress);
    return sections.join("\n\n") || "(no output)";
  };
  const visibleOutput = renderOutput(formatted.text);
  const fullOutput = fullFormatted.text === formatted.text ? visibleOutput : renderOutput(fullFormatted.text);
  const bounded2 = await boundModelOutput(
    visibleOutput,
    outputBudget,
    fullOutput,
    writeArtifact,
    artifactReadHint
  );
  return { text: bounded2.text, isError: result.success ? false : true };
};

// src/kiro/runtime.ts
import { createHash as createHash6 } from "node:crypto";
import path18 from "node:path";

// src/core/action-registry.ts
import { randomUUID as randomUUID3 } from "node:crypto";

// src/audit/projection.ts
var emptyProjection = (args) => ({
  value: {},
  droppedValues: topLevelKeyCount(args)
});
var topLevelKeyCount = (value) => {
  try {
    return Object.keys(value).length;
  } catch {
    return 1;
  }
};
var finiteNumber = (value) => typeof value === "number" && Number.isFinite(value) ? value : void 0;
var stringValue = (value) => typeof value === "string" ? value : void 0;
var isWindowsDrivePath = (value) => {
  if (value.length < 3 || value[1] !== ":" || value[2] !== "\\" && value[2] !== "/") {
    return false;
  }
  const drive = value.charCodeAt(0);
  return drive >= 65 && drive <= 90 || drive >= 97 && drive <= 122;
};
var localPath = (value) => {
  if (typeof value !== "string" || value.includes("\0")) return void 0;
  if (!isWindowsDrivePath(value)) {
    try {
      const absolute = new URL(value);
      if (absolute.protocol) return void 0;
    } catch {
    }
    try {
      const based = new URL(value, "https://fabric.invalid/");
      if (based.hostname !== "fabric.invalid") return void 0;
    } catch {
      return void 0;
    }
  }
  const query = value.indexOf("?");
  const fragment = value.indexOf("#");
  const end = Math.min(
    query < 0 ? value.length : query,
    fragment < 0 ? value.length : fragment
  );
  return value.slice(0, end) || void 0;
};
var copyString = (output, args, key) => {
  const value = stringValue(args[key]);
  if (value !== void 0) output[key] = value;
};
var copyNumber = (output, args, key) => {
  const value = finiteNumber(args[key]);
  if (value !== void 0) output[key] = value;
};
var structuralIdentifier = (value) => {
  if (typeof value !== "string" || value.length === 0) return void 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    const alphanumeric = code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122;
    if (alphanumeric) continue;
    if (index > 0 && (code === 45 || code === 46 || code === 47 || code === 58 || code === 95)) {
      continue;
    }
    return void 0;
  }
  return value;
};
var copyIdentifier = (output, args, key) => {
  const value = structuralIdentifier(args[key]);
  if (value !== void 0) output[key] = value;
};
var copyPath = (output, args) => {
  const value = localPath(args.path);
  if (value !== void 0) output.path = value;
};
var projected = (args, build) => {
  const value = {};
  try {
    build(value);
  } catch {
    return emptyProjection(args);
  }
  return {
    value,
    droppedValues: Math.max(0, topLevelKeyCount(args) - Object.keys(value).length)
  };
};
var idOnlyAgentActions = /* @__PURE__ */ new Set([
  "agents.wait",
  "agents.status",
  "agents.stop",
  "agents.cleanup",
  "agents.ask",
  "agents.tell",
  "agents.steer",
  "agents.followUp",
  "agents.setSteeringMode",
  "agents.setFollowUpMode",
  "agents.compact",
  "agents.actorStatus",
  "agents.setModel",
  "agents.setThinking",
  "agents.setTools",
  "agents.setEvents",
  "agents.setDeliveryPolicy",
  "agents.clearMessages",
  "agents.setInstructions",
  "agents.messages",
  "agents.remove",
  "agents.import",
  "agents.export",
  "agents.log"
]);
var canonicalCoreProjectionRef = (ref, namespace) => namespace === "k" && ref.startsWith("k.") ? `pi.${ref.slice(2)}` : ref;
var projectFabricAuditArgs = (ref, args, coreToolNamespace = "pi") => {
  switch (canonicalCoreProjectionRef(ref, coreToolNamespace)) {
    case "fabric.discovery.providers":
    case "fabric.discovery.models":
    case "fabric.workflow.progress":
      return emptyProjection(args);
    case "fabric.approval.auto":
      return projected(args, (output) => {
        copyIdentifier(output, args, "action");
        copyIdentifier(output, args, "risk");
      });
    case "fabric.discovery.catalog":
      return projected(args, (output) => {
        copyIdentifier(output, args, "provider");
        copyNumber(output, args, "limit");
      });
    case "fabric.discovery.list":
      return projected(args, (output) => {
        copyIdentifier(output, args, "provider");
        copyIdentifier(output, args, "namespace");
        copyNumber(output, args, "limit");
      });
    case "fabric.discovery.search":
      return projected(args, (output) => copyNumber(output, args, "limit"));
    case "fabric.discovery.describe":
      return projected(args, (output) => copyIdentifier(output, args, "ref"));
    case "fabric.workflow.configure":
      return projected(args, (output) => copyString(output, args, "name"));
    case "fabric.workflow.phase":
      return projected(args, (output) => {
        copyString(output, args, "name");
        copyIdentifier(output, args, "id");
        copyNumber(output, args, "total");
      });
    case "fabric.workflow.item":
      return projected(args, (output) => {
        copyIdentifier(output, args, "id");
        copyIdentifier(output, args, "status");
        copyIdentifier(output, args, "phase");
        copyIdentifier(output, args, "kind");
        copyNumber(output, args, "total");
        copyNumber(output, args, "completed");
      });
    case "fabric.workflow.event":
      return projected(args, (output) => copyIdentifier(output, args, "level"));
    case "fabric.workflow.parallel":
    case "fabric.workflow.pipeline":
      return projected(args, (output) => {
        copyIdentifier(output, args, "kind");
        copyNumber(output, args, "itemCount");
        copyNumber(output, args, "stageCount");
        copyNumber(output, args, "concurrency");
      });
    case "pi.read":
      return projected(args, (output) => {
        copyPath(output, args);
        copyNumber(output, args, "offset");
        copyNumber(output, args, "limit");
      });
    case "pi.grep":
      return projected(args, (output) => {
        copyPath(output, args);
        copyNumber(output, args, "context");
        copyNumber(output, args, "limit");
      });
    case "pi.find":
    case "pi.ls":
      return projected(args, (output) => {
        copyPath(output, args);
        copyNumber(output, args, "limit");
      });
    case "pi.edit":
    case "pi.write":
      return projected(args, (output) => copyPath(output, args));
    case "pi.bash":
      return projected(args, (output) => copyString(output, args, "command"));
    case "mesh.publish":
      return projected(args, (output) => {
        copyString(output, args, "topic");
        copyString(output, args, "to");
      });
    case "mesh.read":
      return projected(args, (output) => {
        copyString(output, args, "topic");
        copyString(output, args, "to");
        copyNumber(output, args, "after");
        copyNumber(output, args, "limit");
      });
    case "mesh.get":
    case "mesh.put":
    case "mesh.delete":
      return projected(args, (output) => copyString(output, args, "key"));
    case "mesh.list":
      return projected(args, (output) => {
        copyString(output, args, "prefix");
        copyNumber(output, args, "limit");
      });
    default:
      if (idOnlyAgentActions.has(ref)) {
        return projected(args, (output) => copyString(output, args, "id"));
      }
      return emptyProjection(args);
  }
};
var projectFabricAuditResult = (ref, result, coreToolNamespace = "pi") => {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return void 0;
  }
  const record = result;
  if (ref === "fabric.approval.auto") {
    return projected(record, (output) => {
      copyIdentifier(output, record, "action");
      copyIdentifier(output, record, "risk");
      copyIdentifier(output, record, "decision");
      copyIdentifier(output, record, "model");
      copyNumber(output, record, "at");
    });
  }
  if (canonicalCoreProjectionRef(ref, coreToolNamespace) !== "pi.write") return void 0;
  const details = typeof record.details === "object" && record.details !== null && !Array.isArray(record.details) ? record.details : void 0;
  if (record.created !== true && details?.created !== true) return void 0;
  return {
    value: { created: true },
    droppedValues: Math.max(0, topLevelKeyCount(record) - 1)
  };
};

// src/audit/trace.ts
var FABRIC_EXECUTION_TRACE_KIND = "kiro-fabric.execution";
var FABRIC_EXECUTION_TRACE_VERSION = 1;
var FABRIC_EXECUTION_TRACE_MAX_BYTES = 512 * 1024;
var MAX_IDENTIFIER_BYTES = 1024;
var MAX_PHASE_BYTES = 1024;
var MAX_STRING_BYTES = 16 * 1024;
var MAX_ERROR_BYTES = 8 * 1024;
var MAX_ARGS_BYTES = 64 * 1024;
var MAX_RESULT_BYTES = 64 * 1024;
var MAX_DEPTH = 12;
var MAX_KEYS = 128;
var MAX_ARRAY_ITEMS = 128;
var MAX_NODES = 8192;
var MAX_RECORDED_OPERATIONS = 2048;
var MAX_PHASES = 512;
var DROP = Symbol("drop");
var emptyCounts = () => ({
  droppedValues: 0,
  truncatedValues: 0,
  redactedValues: 0
});
var byteLength = (value) => Buffer.byteLength(value, "utf8");
var serializedBytes = (value) => byteLength(JSON.stringify(value));
var truncateUtf8 = (value, maxBytes) => {
  if (byteLength(value) <= maxBytes) return value;
  const suffix = "\u2026[truncated]";
  const available = Math.max(0, maxBytes - byteLength(suffix));
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (byteLength(value.slice(0, middle)) <= available) low = middle;
    else high = middle - 1;
  }
  return `${value.slice(0, low)}${suffix}`;
};
var truncateUtf8Middle = (value, maxBytes) => {
  if (byteLength(value) <= maxBytes) return value;
  const marker = "\n\u2026[truncated]\n";
  const available = Math.max(0, maxBytes - byteLength(marker));
  const headBytes = Math.floor(available / 2);
  const tailBytes = available - headBytes;
  const head = truncateUtf8(value, headBytes + byteLength("\u2026[truncated]")).replace(/…\[truncated\]$/, "");
  let tailStart = value.length;
  while (tailStart > 0 && byteLength(value.slice(tailStart - 1)) <= tailBytes) tailStart--;
  return `${head}${marker}${value.slice(tailStart)}`;
};
var boundedIdentifier = (value, maxBytes = MAX_IDENTIFIER_BYTES) => truncateUtf8(value, maxBytes);
var normalizedKey = (key) => key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
var isSensitiveKey = (key) => {
  const normalized = normalizedKey(key);
  return [
    "password",
    "passwd",
    "secret",
    "token",
    "accesstoken",
    "refreshtoken",
    "authorization",
    "cookie",
    "credential",
    "credentials",
    "apikey",
    "privatekey",
    "clientsecret"
  ].some((sensitive) => normalized === sensitive || normalized.endsWith(sensitive));
};
var isMediaKey = (key) => ["media", "image", "images", "audio", "video", "base64"].includes(normalizedKey(key));
var isMediaObject = (value) => {
  if (value.type === "image" || value.type === "audio" || value.type === "video") return true;
  const mimeType = value.mimeType ?? value.mime_type;
  return typeof mimeType === "string" && (mimeType.startsWith("image/") || mimeType.startsWith("audio/") || mimeType.startsWith("video/"));
};
var looksLikeBase64 = (value) => {
  if (value.startsWith("data:") && value.includes(";base64,")) return true;
  if (value.length < 1024 || value.length % 4 !== 0) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    const valid = code >= 65 && code <= 90 || code >= 97 && code <= 122 || code >= 48 && code <= 57 || code === 43 || code === 47 || code === 61 || code === 10 || code === 13;
    if (!valid) return false;
  }
  return true;
};
var sanitize = (input, maxBytes) => {
  const counts = emptyCounts();
  const ancestors = /* @__PURE__ */ new Set();
  let nodes = 0;
  const visit = (value2, depth, key) => {
    nodes++;
    if (nodes > MAX_NODES) {
      counts.droppedValues++;
      return DROP;
    }
    if (key !== void 0 && isSensitiveKey(key)) {
      counts.redactedValues++;
      return "[REDACTED]";
    }
    if (key !== void 0 && isMediaKey(key)) {
      counts.droppedValues++;
      return DROP;
    }
    if (value2 === null || typeof value2 === "boolean") return value2;
    if (typeof value2 === "number") {
      if (Number.isFinite(value2)) return value2;
      counts.truncatedValues++;
      return `[non-finite:${String(value2)}]`;
    }
    if (typeof value2 === "string") {
      if (looksLikeBase64(value2)) {
        counts.droppedValues++;
        return "[OMITTED_BASE64]";
      }
      const bounded2 = truncateUtf8(value2, MAX_STRING_BYTES);
      if (bounded2 !== value2) counts.truncatedValues++;
      return bounded2;
    }
    if (typeof value2 === "bigint") {
      counts.truncatedValues++;
      return `${String(value2)}n`;
    }
    if (typeof value2 === "undefined" || typeof value2 === "function" || typeof value2 === "symbol") {
      counts.droppedValues++;
      return DROP;
    }
    if (typeof value2 !== "object") {
      counts.droppedValues++;
      return DROP;
    }
    if (depth >= MAX_DEPTH) {
      counts.truncatedValues++;
      return "[MAX_DEPTH]";
    }
    if (ancestors.has(value2)) {
      counts.droppedValues++;
      return "[CIRCULAR]";
    }
    const record = value2;
    if (!Array.isArray(value2) && isMediaObject(record)) {
      counts.droppedValues++;
      return "[OMITTED_MEDIA]";
    }
    ancestors.add(value2);
    if (Array.isArray(value2)) {
      const output2 = [];
      const limit2 = Math.min(value2.length, MAX_ARRAY_ITEMS);
      for (let index = 0; index < limit2; index++) {
        const item = visit(value2[index], depth + 1);
        output2.push(item === DROP ? "[DROPPED]" : item);
      }
      if (value2.length > limit2) {
        counts.droppedValues += value2.length - limit2;
        counts.truncatedValues++;
      }
      ancestors.delete(value2);
      return output2;
    }
    const output = {};
    const keys = Object.keys(record).sort();
    const limit = Math.min(keys.length, MAX_KEYS);
    for (let index = 0; index < limit; index++) {
      const childKey = keys[index];
      const child = visit(record[childKey], depth + 1, childKey);
      if (child !== DROP) output[childKey] = child;
    }
    if (keys.length > limit) {
      counts.droppedValues += keys.length - limit;
      counts.truncatedValues++;
    }
    ancestors.delete(value2);
    return output;
  };
  let value = visit(input, 0);
  if (value === DROP) value = "[DROPPED]";
  const originalBytes = serializedBytes(value);
  if (originalBytes > maxBytes) {
    counts.truncatedValues++;
    if (Array.isArray(value)) {
      const output = [];
      for (const item of value) {
        const next = [...output, item];
        if (serializedBytes(next) > maxBytes - 128) break;
        output.push(item);
      }
      counts.droppedValues += value.length - output.length;
      value = output;
    } else if (typeof value === "object" && value !== null) {
      const output = {};
      const entries = Object.entries(value);
      let included = 0;
      for (const [childKey, child] of entries) {
        const next = { ...output, [childKey]: child };
        if (serializedBytes(next) > maxBytes - 128) break;
        output[childKey] = child;
        included++;
      }
      counts.droppedValues += entries.length - included;
      value = output;
    }
  }
  return { value, counts };
};
var sanitizeObject = (value, droppedValues = 0) => {
  const sanitized = sanitize(value, MAX_ARGS_BYTES);
  sanitized.counts.droppedValues += droppedValues;
  if (typeof sanitized.value === "object" && sanitized.value !== null && !Array.isArray(sanitized.value)) {
    return sanitized;
  }
  sanitized.counts.droppedValues++;
  return { value: {}, counts: sanitized.counts };
};
var projectedArgs = (ref, args, coreToolNamespace) => {
  const projection = projectFabricAuditArgs(ref, args, coreToolNamespace);
  return sanitizeObject(projection.value, projection.droppedValues);
};
var sanitizeString = (value, maxBytes) => {
  const bounded2 = truncateUtf8(value, maxBytes);
  return {
    value: bounded2,
    counts: {
      ...emptyCounts(),
      truncatedValues: bounded2 === value ? 0 : 1
    }
  };
};
var addCounts = (target, source) => {
  target.droppedValues += source.droppedValues;
  target.truncatedValues += source.truncatedValues;
  target.redactedValues += source.redactedValues;
};
var lexicalIdentity = (ref) => {
  const separator = ref.indexOf(".");
  if (separator <= 0 || separator === ref.length - 1) return {};
  return {
    provider: ref.slice(0, separator),
    action: ref.slice(separator + 1)
  };
};
var FabricTraceSafeError = class extends Error {
};
var FabricResolutionError = class extends FabricTraceSafeError {
};
var errorCause = (error) => {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : void 0;
  const trimmed = message?.trim();
  return trimmed ? truncateUtf8Middle(trimmed, MAX_ERROR_BYTES - 256) : void 0;
};
var failureMessage = (stage, outcome, cause) => {
  if (outcome === "timed_out") return "Call timed out";
  if (outcome === "aborted") return "Call aborted";
  const summary = `Call failed during ${stage}`;
  return cause ? `${summary}: ${cause}` : summary;
};
var executionErrorMessage = (outcome) => {
  if (outcome === "succeeded") return void 0;
  if (outcome === "timed_out") return "Execution timed out";
  if (outcome === "aborted") return "Execution aborted";
  return "Execution failed";
};
var FabricExecutionTraceOperationHandle = class {
  constructor(recorder, operation) {
    this.recorder = recorder;
    this.operation = operation;
  }
  resolved(provider, action) {
    if (!this.operation || this.recorder.sealed) return;
    const boundedProvider = boundedIdentifier(provider);
    const boundedAction = boundedIdentifier(action);
    if (this.operation.provider !== boundedProvider) {
      this.operation.provider = this.recorder.snapshotIdentifier(provider);
    }
    if (this.operation.action !== boundedAction) {
      this.operation.action = this.recorder.snapshotIdentifier(action);
    }
  }
  prepared(args) {
    if (!this.operation || this.recorder.sealed) return;
    this.operation.args = projectedArgs(
      this.operation.projectionRef,
      args,
      this.recorder.coreToolNamespace
    );
  }
  succeed(result, meta) {
    if (!this.operation || this.recorder.sealed) return;
    const projected2 = projectFabricAuditResult(
      this.operation.projectionRef,
      result,
      this.recorder.coreToolNamespace
    );
    if (projected2 !== void 0) {
      this.operation.result = sanitize(projected2.value, MAX_RESULT_BYTES);
      this.operation.result.counts.droppedValues += projected2.droppedValues;
    } else if (result !== void 0) {
      this.operation.droppedResultValues++;
    }
    this.operation.outcome = "succeeded";
    if (meta?.resultTruncated === true) this.operation.resultTruncated = true;
  }
  fail(stage, error, outcome = "failed", result, meta) {
    if (!this.operation || this.recorder.sealed) return;
    this.operation.failureStage = stage;
    if (error instanceof FabricTraceSafeError) this.operation.causeSafe = true;
    const cause = outcome === "failed" && (this.operation.causeSafe === true || this.recorder.isCoreBashRef(this.operation.projectionRef) && stage === "invoke") ? errorCause(error) : void 0;
    this.operation.error = sanitizeString(
      failureMessage(stage, outcome, cause),
      MAX_ERROR_BYTES
    );
    this.operation.outcome = outcome;
    if (meta?.resultTruncated === true) this.operation.resultTruncated = true;
    const projected2 = projectFabricAuditResult(
      this.operation.projectionRef,
      result,
      this.recorder.coreToolNamespace
    );
    if (projected2 !== void 0) {
      this.operation.result = sanitize(projected2.value, MAX_RESULT_BYTES);
      this.operation.result.counts.droppedValues += projected2.droppedValues;
    } else if (result !== void 0) {
      this.operation.droppedResultValues++;
    }
  }
};
var FabricExecutionTraceRecorder = class {
  constructor(coreToolNamespace = "pi") {
    this.coreToolNamespace = coreToolNamespace;
  }
  #operations = [];
  #nextSequence = 0;
  #droppedOperations = 0;
  #truncatedIdentifiers = 0;
  sealed = false;
  isCoreBashRef(ref) {
    return ref === `${this.coreToolNamespace}.bash`;
  }
  snapshotIdentifier(value, maxBytes = MAX_IDENTIFIER_BYTES) {
    const bounded2 = boundedIdentifier(value, maxBytes);
    if (bounded2 !== value) this.#truncatedIdentifiers++;
    return bounded2;
  }
  issueCall(ref, args) {
    const sequence = this.#nextSequence++;
    if (this.sealed || this.#operations.length >= MAX_RECORDED_OPERATIONS) {
      this.#droppedOperations++;
      return new FabricExecutionTraceOperationHandle(this, void 0);
    }
    const identity = lexicalIdentity(ref);
    const operation = {
      type: "call",
      sequence,
      ref: this.snapshotIdentifier(ref),
      projectionRef: ref,
      ...identity.provider ? { provider: this.snapshotIdentifier(identity.provider) } : {},
      ...identity.action ? { action: this.snapshotIdentifier(identity.action) } : {},
      args: projectedArgs(ref, args, this.coreToolNamespace),
      droppedResultValues: 0
    };
    this.#operations.push(operation);
    return new FabricExecutionTraceOperationHandle(this, operation);
  }
  // safeError must contain no guest source text, tool output, or argument
  // payloads — callers pass it only for Fabric-generated failure summaries
  // (for example the type-check stage). Guest and provider error text is
  // deliberately not persisted here.
  seal(outcome, phases, safeError) {
    this.sealed = true;
    for (const operation of this.#operations) {
      if (!operation.outcome) {
        operation.outcome = outcome === "timed_out" ? "timed_out" : outcome === "aborted" ? "aborted" : "failed";
        operation.failureStage ??= "invoke";
      } else if (operation.outcome === "aborted" && outcome === "timed_out") {
        operation.outcome = "timed_out";
      }
      if (operation.outcome !== "succeeded") {
        const preserveCause = operation.error !== void 0 && (operation.causeSafe === true || this.isCoreBashRef(operation.projectionRef) && operation.outcome === "failed");
        if (!preserveCause) {
          operation.error = sanitizeString(
            failureMessage(operation.failureStage ?? "invoke", operation.outcome),
            MAX_ERROR_BYTES
          );
        }
      }
    }
    const counts = {
      droppedValues: 0,
      truncatedValues: this.#truncatedIdentifiers,
      redactedValues: 0,
      droppedOperations: this.#droppedOperations
    };
    const operations = this.#operations.map((operation) => {
      addCounts(counts, operation.args.counts);
      counts.droppedValues += operation.droppedResultValues;
      if (operation.error) addCounts(counts, operation.error.counts);
      if (operation.result) addCounts(counts, operation.result.counts);
      return {
        type: "call",
        sequence: operation.sequence,
        ref: operation.ref,
        ...operation.provider ? { provider: operation.provider } : {},
        ...operation.action ? { action: operation.action } : {},
        args: operation.args.value,
        outcome: operation.outcome,
        ...operation.failureStage ? { failureStage: operation.failureStage } : {},
        ...operation.error ? { error: operation.error.value } : {},
        ...operation.result ? { result: operation.result.value } : {},
        ...operation.resultTruncated === true ? { resultTruncated: true } : {}
      };
    });
    const boundedPhases = phases.slice(0, MAX_PHASES).map((phase) => {
      const bounded2 = boundedIdentifier(phase, MAX_PHASE_BYTES);
      if (bounded2 !== phase) counts.truncatedValues++;
      return bounded2;
    });
    if (phases.length > boundedPhases.length) {
      counts.droppedValues += phases.length - boundedPhases.length;
      counts.truncatedValues++;
    }
    const safeRunError = safeError?.trim() || executionErrorMessage(outcome);
    const runError = safeRunError ? sanitizeString(safeRunError, MAX_ERROR_BYTES) : void 0;
    if (runError) addCounts(counts, runError.counts);
    const trace = {
      kind: FABRIC_EXECUTION_TRACE_KIND,
      version: FABRIC_EXECUTION_TRACE_VERSION,
      outcome,
      phases: boundedPhases,
      operations,
      counts,
      ...runError ? { error: runError.value } : {}
    };
    let traceBytes = serializedBytes(trace);
    const adjustMutation = (beforeValueBytes, afterValueBytes, beforeCountsBytes) => {
      traceBytes += afterValueBytes - beforeValueBytes + serializedBytes(trace.counts) - beforeCountsBytes;
    };
    for (let index = trace.operations.length - 1; traceBytes > FABRIC_EXECUTION_TRACE_MAX_BYTES && index >= 0; index--) {
      const operation = trace.operations[index];
      if (operation.result === void 0) continue;
      const beforeOperationBytes = serializedBytes(operation);
      const beforeCountsBytes = serializedBytes(trace.counts);
      delete operation.result;
      trace.counts.droppedValues++;
      adjustMutation(
        beforeOperationBytes,
        serializedBytes(operation),
        beforeCountsBytes
      );
    }
    for (let index = trace.operations.length - 1; traceBytes > FABRIC_EXECUTION_TRACE_MAX_BYTES && index >= 0; index--) {
      const operation = trace.operations[index];
      if (Object.keys(operation.args).length === 0) continue;
      const beforeOperationBytes = serializedBytes(operation);
      const beforeCountsBytes = serializedBytes(trace.counts);
      operation.args = {};
      trace.counts.droppedValues++;
      trace.counts.truncatedValues++;
      adjustMutation(
        beforeOperationBytes,
        serializedBytes(operation),
        beforeCountsBytes
      );
    }
    while (traceBytes > FABRIC_EXECUTION_TRACE_MAX_BYTES && trace.operations.length > 0) {
      const beforeCountsBytes = serializedBytes(trace.counts);
      const operation = trace.operations.pop();
      traceBytes -= serializedBytes(operation);
      if (trace.operations.length > 0) traceBytes--;
      trace.counts.droppedOperations++;
      traceBytes += serializedBytes(trace.counts) - beforeCountsBytes;
    }
    while (traceBytes > FABRIC_EXECUTION_TRACE_MAX_BYTES && trace.phases.length > 0) {
      const beforeCountsBytes = serializedBytes(trace.counts);
      const phase = trace.phases.pop();
      traceBytes -= serializedBytes(phase);
      if (trace.phases.length > 0) traceBytes--;
      trace.counts.droppedValues++;
      traceBytes += serializedBytes(trace.counts) - beforeCountsBytes;
    }
    return trace;
  }
};
var executionOutcomeFromError = (error, signal) => {
  if (signal?.aborted) return "aborted";
  return error === void 0 ? "succeeded" : "failed";
};

// src/core/stable-hash.ts
import { createHash as createHash3 } from "node:crypto";
var stableJsonValue = (value) => {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value instanceof URL) return value.href;
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, stableJsonValue(nested)])
  );
};
var stableJsonHash = (value) => createHash3("sha256").update(JSON.stringify(stableJsonValue(value))).digest("hex");

// src/protocol.ts
var FABRIC_NESTED_TOOL_CALL_ID_PREFIX = "fabric_";

// src/schema-validation.ts
var MAX_VALIDATION_MESSAGE_CHARS = 2e3;
var REDACTED_PROPERTY_SEGMENT = "<property>";
var truncateString = (value, max) => value.length <= max ? value : `${value.slice(0, max)}\u2026`;
var isRecord2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var pointerPart = (value) => value.replaceAll("~", "~0").replaceAll("/", "~1");
var decodePointerPart = (value) => value.replaceAll("~1", "/").replaceAll("~0", "~");
var schemaForDynamicProperty = (schema, property) => {
  const patterns = isRecord2(schema.patternProperties) ? schema.patternProperties : void 0;
  if (patterns) {
    for (const [pattern, child] of Object.entries(patterns)) {
      try {
        if (new RegExp(pattern).test(property)) return child;
      } catch {
      }
    }
  }
  return isRecord2(schema.additionalProperties) ? schema.additionalProperties : void 0;
};
var traceSafePath = (schema, path20) => {
  const rawParts = typeof path20 === "string" ? path20 === "" || path20 === "/" ? [] : path20.split("/").slice(1).map(decodePointerPart) : Array.isArray(path20) ? path20.filter(
    (part) => typeof part === "string" || typeof part === "number"
  ).map(String) : [];
  const safeParts = [];
  let current = schema;
  for (const part of rawParts) {
    if (!isRecord2(current)) {
      safeParts.push(REDACTED_PROPERTY_SEGMENT);
      continue;
    }
    if (current.type === "array" && /^\d+$/.test(part)) {
      safeParts.push(part);
      current = Array.isArray(current.items) ? current.items[Number(part)] : current.items;
      continue;
    }
    const properties = isRecord2(current.properties) ? current.properties : void 0;
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
var prefixedPath = (schema, prefix, path20) => `${prefix}${traceSafePath(schema, path20)}` || "/";
var traceSafeErrorMessage = (error) => {
  if (error.keyword === "additionalProperties") return "must not have additional properties";
  if (error.keyword === "propertyNames") return "property names are invalid";
  return typeof error.message === "string" ? error.message : "Schema validation failed";
};
var validateSchemaValue = (schema, value, options = {}) => {
  if (!isRecord2(schema)) return { status: "unavailable" };
  const prefix = options.pathPrefix ?? "";
  try {
    const messages = [];
    for (const rawError of value_exports.Errors(schema, value)) {
      const error = rawError;
      const path20 = error.path ?? (options.includeInstancePath ? error.instancePath : void 0);
      const parentPath = prefixedPath(schema, prefix, path20);
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

// src/core/effect-conflict.ts
var reasonText = (reason) => reason === "unknown_resource" ? "unknown resource footprint; declare resources and ordering" : "shared noncommutative resource";
var formatFabricEffectConflict = (target, resources, reason) => `${target} [${resources.join(", ")}] (${reasonText(reason)})`;

// src/core/session-approvals.ts
import { randomUUID } from "node:crypto";
var leaseHandles = /* @__PURE__ */ new WeakMap();
var leaseCoordinators = /* @__PURE__ */ new WeakMap();
var FABRIC_APPROVAL_LEASE_TTL_MS = 3e4;
var digest = (domain, value) => stableJsonHash([domain, value]);
var fabricApprovalArgumentDigest = (args) => digest("fabric.approval.arguments.v1", args);
var fabricApprovalScope = (input) => ({
  ...input.plan === void 0 ? {} : { planDigest: digest("fabric.approval.plan.v1", input.plan) },
  ...input.project === void 0 ? {} : { projectDigest: digest("fabric.approval.project.v1", input.project) }
});
var approvalBinding = (action, args, scope = {}) => ({
  action: action.ref,
  risk: action.risk,
  descriptorDigest: digest("fabric.approval.descriptor.v1", {
    ref: action.ref,
    provider: action.provider,
    name: action.name,
    description: action.description,
    inputSchema: action.inputSchema,
    outputSchema: action.outputSchema,
    risk: action.risk,
    namespace: action.namespace,
    effect: action.effect
  }),
  argumentDigest: fabricApprovalArgumentDigest(args),
  ...scope.planDigest === void 0 ? {} : { planDigest: scope.planDigest },
  ...scope.projectDigest === void 0 ? {} : { projectDigest: scope.projectDigest }
});
var sameBinding = (left, right) => left.action === right.action && left.risk === right.risk && left.descriptorDigest === right.descriptorDigest && left.argumentDigest === right.argumentDigest && left.planDigest === right.planDigest && left.projectDigest === right.projectDigest;
var FabricApprovalLeaseError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "FabricApprovalLeaseError";
  }
};
var FabricSessionApprovals = class {
  approvedRisks = /* @__PURE__ */ new Set();
  #leases = /* @__PURE__ */ new Map();
  #clock;
  #leaseTtlMs;
  #tail = Promise.resolve();
  constructor(options = {}) {
    this.#clock = options.clock ?? Date.now;
    this.#leaseTtlMs = Math.max(1, Math.floor(options.leaseTtlMs ?? FABRIC_APPROVAL_LEASE_TTL_MS));
    leaseCoordinators.set(this, {
      now: () => this.#clock(),
      validate: (id, candidate, now) => this.#validateLease(id, candidate, now),
      consume: (id, record, now) => this.#consumeValidatedLease(id, record, now),
      burn: (id, now) => this.#burnLease(id, now)
    });
  }
  issueLease(action, args, scope, source) {
    const id = randomUUID();
    const issuedAt = this.#clock();
    const record = {
      binding: approvalBinding(action, args, scope),
      source,
      issuedAt,
      expiresAt: issuedAt + this.#leaseTtlMs
    };
    this.#leases.set(id, record);
    this.#prune(issuedAt);
    const lease = {
      id,
      expiresAt: record.expiresAt,
      consume: (candidateAction, candidateArgs, candidateScope = {}) => consumeFabricApprovalLease(lease, candidateAction, candidateArgs, candidateScope)
    };
    leaseHandles.set(lease, { session: this, id });
    return lease;
  }
  #validateLease(id, candidate, now) {
    const record = this.#leases.get(id);
    if (!record) throw new FabricApprovalLeaseError("Fabric approval lease is unknown or retired");
    if (record.consumedAt !== void 0) {
      throw new FabricApprovalLeaseError("Fabric approval lease has already been consumed");
    }
    if (now >= record.expiresAt) {
      throw new FabricApprovalLeaseError("Fabric approval lease has expired");
    }
    if (!sameBinding(record.binding, candidate)) {
      throw new FabricApprovalLeaseError("Fabric approval lease binding does not match this call");
    }
    return record;
  }
  #consumeValidatedLease(id, record, now) {
    if (this.#leases.get(id) !== record || record.consumedAt !== void 0) {
      throw new FabricApprovalLeaseError("Fabric approval lease changed during consumption");
    }
    record.consumedAt = now;
    return {
      leaseId: id,
      source: record.source,
      action: record.binding.action,
      risk: record.binding.risk,
      descriptorDigest: record.binding.descriptorDigest,
      argumentDigest: record.binding.argumentDigest,
      ...record.binding.planDigest === void 0 ? {} : { planDigest: record.binding.planDigest },
      ...record.binding.projectDigest === void 0 ? {} : { projectDigest: record.binding.projectDigest },
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
      consumedAt: now
    };
  }
  #burnLease(id, now) {
    const record = this.#leases.get(id);
    if (record && record.consumedAt === void 0) record.consumedAt = now;
  }
  #prune(now) {
    if (this.#leases.size <= 2048) return;
    for (const [id, record] of this.#leases) {
      if (record.consumedAt !== void 0 && now - record.consumedAt > this.#leaseTtlMs) {
        this.#leases.delete(id);
      }
      if (this.#leases.size <= 1024) break;
    }
  }
  async serialize(request) {
    const previous = this.#tail;
    let release;
    this.#tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await request();
    } finally {
      release?.();
    }
  }
};
var bindFabricApprovalLease = (lease, action) => {
  const handle = leaseHandles.get(lease);
  if (!handle) throw new FabricApprovalLeaseError("Fabric approval lease cannot be delegated");
  const bound = {
    id: lease.id,
    expiresAt: lease.expiresAt,
    consume: (_action, args, scope = {}) => consumeFabricApprovalLease(bound, action, args, scope)
  };
  leaseHandles.set(bound, { ...handle, action });
  return bound;
};
var consumeFabricApprovalLease = (lease, action, args, scope) => {
  try {
    return consumeFabricApprovalLeases([lease], action, args, scope)[0];
  } catch (error) {
    const handle = leaseHandles.get(lease);
    const coordinator = handle ? leaseCoordinators.get(handle.session) : void 0;
    if (handle && coordinator) coordinator.burn(handle.id, coordinator.now());
    throw error;
  }
};
var consumeFabricApprovalLeases = (leases, action, args, scope = {}) => {
  if (leases.length === 0) {
    throw new FabricApprovalLeaseError("Fabric approval grant contains no leases");
  }
  const seen = /* @__PURE__ */ new Map();
  const pending = leases.map((lease) => {
    const handle = leaseHandles.get(lease);
    if (!handle) throw new FabricApprovalLeaseError("Fabric approval lease is not host-issued");
    const sessionIds = seen.get(handle.session) ?? /* @__PURE__ */ new Set();
    if (sessionIds.has(handle.id)) throw new FabricApprovalLeaseError("Fabric approval grant repeats a lease");
    sessionIds.add(handle.id);
    seen.set(handle.session, sessionIds);
    const coordinator = leaseCoordinators.get(handle.session);
    if (!coordinator) throw new FabricApprovalLeaseError("Fabric approval lease issuer is unavailable");
    const candidate = approvalBinding(handle.action ?? action, args, scope);
    const now = coordinator.now();
    return {
      ...handle,
      coordinator,
      now,
      record: coordinator.validate(handle.id, candidate, now)
    };
  });
  return pending.map(({ coordinator, id, record, now }) => coordinator.consume(id, record, now));
};

// src/core/provider-bindings.ts
import { randomUUID as randomUUID2 } from "node:crypto";
var snapshot = (binding) => ({
  ...binding,
  ...binding.closeTask ? { closeTask: binding.closeTask } : {}
});
var FabricProviderBindings = class {
  #current = /* @__PURE__ */ new Map();
  #staged = /* @__PURE__ */ new Map();
  #all = /* @__PURE__ */ new Map();
  #generations = /* @__PURE__ */ new Map();
  #listeners = /* @__PURE__ */ new Set();
  #closeWaiters = /* @__PURE__ */ new Map();
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  current(name) {
    return this.#current.get(name);
  }
  binding(id) {
    const binding = this.#all.get(id);
    return binding?.state === "closed" ? void 0 : binding;
  }
  has(name) {
    return this.#current.has(name);
  }
  providers() {
    return [...this.#current.values()].map((binding) => binding.provider);
  }
  entries() {
    return [...this.#all.values()].filter((binding) => binding.state !== "closed");
  }
  mount(provider, options = {}) {
    const current = this.#current.get(provider.name);
    const staged = this.#staged.get(provider.name);
    if ((current || staged) && !options.overwrite) {
      throw new Error(`Fabric provider already registered: ${provider.name}`);
    }
    if (staged && options.overwrite) this.retire(staged.id);
    const generation = (this.#generations.get(provider.name) ?? 0) + 1;
    this.#generations.set(provider.name, generation);
    const binding = {
      id: randomUUID2(),
      name: provider.name,
      generation,
      provider,
      state: options.staged ? "staged" : "active",
      ownerRetained: true,
      allowReplace: options.overwrite === true,
      retainers: 0,
      inFlight: 0
    };
    let resolveClosed;
    const closed = new Promise((resolve) => {
      resolveClosed = resolve;
    });
    this.#closeWaiters.set(binding.id, { promise: closed, resolve: resolveClosed });
    if (provider.subscribeCatalog) {
      binding.unsubscribeCatalog = provider.subscribeCatalog(
        () => this.notifyCatalogChanged(provider.name)
      );
    }
    this.#all.set(binding.id, binding);
    if (options.staged) {
      this.#staged.set(binding.name, binding);
      this.#emit({ type: "staged", binding: snapshot(binding) });
    } else {
      const replaced = this.#activateOne(binding);
      if (replaced && options.overwrite) void this.releaseOwner(replaced.id).catch(() => void 0);
    }
    let released = false;
    return {
      bindingId: binding.id,
      name: binding.name,
      generation: binding.generation,
      get active() {
        return binding.state === "active";
      },
      retire: () => this.retire(binding.id),
      release: async () => {
        if (released) return binding.closeTask;
        released = true;
        return this.releaseOwner(binding.id);
      }
    };
  }
  activate(bindingIds) {
    const bindings = bindingIds.map((id) => {
      const binding = this.#all.get(id);
      if (!binding || binding.state === "closed") {
        throw new Error(`Unknown Fabric provider binding: ${id}`);
      }
      if (binding.state !== "staged" && binding.state !== "active") {
        throw new Error(`Fabric provider binding is ${binding.state}: ${binding.name}`);
      }
      return binding;
    });
    const names = /* @__PURE__ */ new Set();
    for (const binding of bindings) {
      if (names.has(binding.name)) {
        throw new Error(`Cannot activate multiple Fabric bindings for provider ${binding.name}`);
      }
      names.add(binding.name);
      const current = this.#current.get(binding.name);
      if (current && current.id !== binding.id && !binding.allowReplace) {
        throw new Error(`Fabric provider already registered: ${binding.name}`);
      }
    }
    const replaced = [];
    for (const binding of bindings) {
      const previous = this.#activateOne(binding);
      if (previous && previous.id !== binding.id) {
        replaced.push(previous.id);
        if (binding.allowReplace) void this.releaseOwner(previous.id).catch(() => void 0);
      }
    }
    return replaced;
  }
  unregister(name) {
    const binding = this.#current.get(name);
    if (!binding) return void 0;
    this.retire(binding.id);
    void this.releaseOwner(binding.id).catch(() => void 0);
    return binding.provider;
  }
  retire(id) {
    const binding = this.#all.get(id);
    if (!binding || binding.state === "retiring" || binding.state === "closed") return;
    if (this.#current.get(binding.name)?.id === id) this.#current.delete(binding.name);
    if (this.#staged.get(binding.name)?.id === id) this.#staged.delete(binding.name);
    binding.state = "retiring";
    this.#emit({ type: "retiring", binding: snapshot(binding) });
    void this.#maybeClose(binding).catch(() => void 0);
  }
  retain(ids) {
    const retained = [];
    try {
      for (const id of new Set(ids)) {
        const binding = this.#all.get(id);
        if (!binding || binding.state === "closed") {
          throw new Error(`Unknown Fabric provider binding: ${id}`);
        }
        binding.retainers++;
        retained.push(binding);
      }
    } catch (error) {
      for (const binding of retained) binding.retainers--;
      throw error;
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await Promise.all(retained.map(async (binding) => {
        binding.retainers = Math.max(0, binding.retainers - 1);
        await this.#maybeClose(binding);
      }));
    };
  }
  beginInvocation(id) {
    const binding = this.#all.get(id);
    if (!binding || binding.state === "closed") {
      throw new Error(`Unknown Fabric provider binding: ${id}`);
    }
    binding.inFlight++;
    let ended = false;
    return async () => {
      if (ended) return;
      ended = true;
      binding.inFlight = Math.max(0, binding.inFlight - 1);
      await this.#maybeClose(binding);
    };
  }
  notifyCatalogChanged(provider) {
    if (this.#current.has(provider)) this.#emit({ type: "catalog", provider });
  }
  async close(excludedProviderNames = /* @__PURE__ */ new Set()) {
    const tasks = [];
    for (const binding of this.#all.values()) {
      if (binding.state === "closed") continue;
      if (excludedProviderNames.has(binding.name)) {
        if (this.#current.get(binding.name)?.id === binding.id) this.#current.delete(binding.name);
        binding.unsubscribeCatalog?.();
        delete binding.unsubscribeCatalog;
        binding.state = "closed";
        this.#all.delete(binding.id);
        this.#resolveClosed(binding.id);
        continue;
      }
      const waiter = this.#closeWaiters.get(binding.id);
      this.retire(binding.id);
      binding.ownerRetained = false;
      binding.retainers = 0;
      void this.#maybeClose(binding).catch(() => void 0);
      if (waiter) tasks.push(waiter.promise);
    }
    await Promise.allSettled(tasks);
    this.#current.clear();
    this.#staged.clear();
  }
  #activateOne(binding) {
    const current = this.#current.get(binding.name);
    if (current?.id === binding.id && binding.state === "active") return current;
    if (current && current.id !== binding.id) this.retire(current.id);
    if (this.#staged.get(binding.name)?.id === binding.id) this.#staged.delete(binding.name);
    binding.state = "active";
    this.#current.set(binding.name, binding);
    this.#emit({ type: "activated", binding: snapshot(binding) });
    return current;
  }
  async releaseOwner(id) {
    const binding = this.#all.get(id);
    if (!binding) return;
    this.retire(id);
    binding.ownerRetained = false;
    await this.#maybeClose(binding);
  }
  async #maybeClose(binding) {
    if (binding.state !== "retiring" || binding.ownerRetained || binding.retainers > 0 || binding.inFlight > 0) {
      return;
    }
    if (binding.closeTask) return binding.closeTask;
    binding.closeTask = (async () => {
      binding.unsubscribeCatalog?.();
      delete binding.unsubscribeCatalog;
      try {
        await binding.provider.close?.();
      } catch (error) {
        binding.closeError = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        binding.state = "closed";
        this.#all.delete(binding.id);
        this.#emit({ type: "closed", binding: snapshot(binding) });
        this.#resolveClosed(binding.id);
      }
    })();
    return binding.closeTask;
  }
  #resolveClosed(id) {
    const waiter = this.#closeWaiters.get(id);
    if (!waiter) return;
    this.#closeWaiters.delete(id);
    waiter.resolve();
  }
  #emit(event) {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch {
      }
    }
  }
};

// src/core/action-registry.ts
var NESTED_TOOL_CALL_ID_PREFIX = FABRIC_NESTED_TOOL_CALL_ID_PREFIX;
var providerNamePattern = /^[a-z][a-z0-9_-]*$/;
var PREVIEW_ARG_CHARS = 2e3;
var WRITE_PREVIEW_CONTENT_CHARS = 16e3;
var PREVIEW_ARG_KEYS = 32;
var PREVIEW_RESULT_CHARS = 16e3;
var PREVIEW_NESTED_CHARS = 16e3;
var MAX_AUDIT_VALUE_CHARS = 64e3;
var truncateString2 = (value, max) => value.length <= max ? value : `${value.slice(0, max)}\u2026`;
var boundedPreviewValue = (value, maxChars) => {
  if (value === void 0 || value === null || typeof value !== "object") return value;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= maxChars) return JSON.parse(serialized);
    return {
      fabricTruncated: true,
      originalChars: serialized.length,
      preview: serialized.slice(0, Math.max(1, maxChars - 100))
    };
  } catch {
    return truncateString2(String(value), maxChars);
  }
};
var previewArgs = (ref, args) => {
  const out = {};
  let count = 0;
  for (const [key, value] of Object.entries(args)) {
    if (count++ >= PREVIEW_ARG_KEYS) break;
    const maxChars = ref === "pi.write" && key === "content" ? WRITE_PREVIEW_CONTENT_CHARS : PREVIEW_ARG_CHARS;
    out[key] = typeof value === "string" ? truncateString2(value, maxChars) : boundedPreviewValue(value, PREVIEW_NESTED_CHARS);
  }
  return out;
};
var previewResult = (value) => {
  if (typeof value === "string") return truncateString2(value, PREVIEW_RESULT_CHARS);
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const out = {};
    let count = 0;
    for (const [key, val] of Object.entries(value)) {
      if (count++ >= PREVIEW_ARG_KEYS) break;
      out[key] = typeof val === "string" ? truncateString2(val, PREVIEW_RESULT_CHARS) : boundedPreviewValue(val, PREVIEW_NESTED_CHARS);
    }
    return out;
  }
  return boundedPreviewValue(value, PREVIEW_RESULT_CHARS);
};
var failedResultError = (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
  const record = value;
  const status = record.status;
  if (status !== "failed" && status !== "stopped" && status !== "timed_out") return void 0;
  const error = typeof record.error === "string" ? record.error.trim() : "";
  return error ? truncateString2(error, PREVIEW_RESULT_CHARS) : `Fabric action returned ${status}`;
};
var failedResultOutcome = (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "failed";
  const status = value.status;
  return status === "timed_out" ? "timed_out" : status === "stopped" ? "aborted" : "failed";
};
var boundedResult = (value, maxChars) => {
  let serialized;
  try {
    const encoded = JSON.stringify(value);
    if (encoded === void 0 && value !== void 0) {
      throw new Error(`unsupported result type: ${typeof value}`);
    }
    serialized = encoded ?? "null";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Fabric action returned a non-JSON-serializable value: ${message}`);
  }
  if (serialized.length <= maxChars) {
    return { value, chars: serialized.length, truncated: false };
  }
  const previewChars = Math.max(1, maxChars - 200);
  return {
    value: {
      fabricTruncated: true,
      originalChars: serialized.length,
      preview: serialized.slice(0, previewChars)
    },
    chars: serialized.length,
    truncated: true
  };
};
var resolveDescriptor = (provider, descriptor) => ({
  ...descriptor,
  effect: descriptor.effect ?? (descriptor.risk === "read" ? { kind: "none", ordering: "commutative" } : { kind: "emission", ordering: "unknown" }),
  provider: provider.name,
  ref: `${provider.name}.${descriptor.name}`
});
var descriptorHash = stableJsonHash;
var actionDescriptorHash = (action) => descriptorHash({
  ref: action.ref,
  description: action.description,
  inputSchema: action.inputSchema,
  outputSchema: action.outputSchema,
  risk: action.risk,
  namespace: action.namespace,
  effect: action.effect
});
var discoveryTerms = (value) => [...value.normalize("NFKC").matchAll(/[\p{L}\p{N}_]+/gu)].map((match2) => match2[0].toLowerCase());
var conflictBetween = (left, right) => {
  if (left.kind === "none" || right.kind === "none") return void 0;
  const resources = (effect) => [...new Set((effect.resources ?? []).filter(
    (resource) => typeof resource === "string" && resource.length > 0
  ).map((resource) => resource.slice(0, 256)))].slice(0, 64);
  const leftResources = resources(left);
  const rightResources = resources(right);
  if (leftResources.length === 0 || rightResources.length === 0) {
    if (left.ordering === "commutative" && right.ordering === "commutative") return void 0;
    return { resources: ["*"], reason: "unknown_resource" };
  }
  const rightSet = new Set(rightResources);
  const overlap = leftResources.filter((resource) => rightSet.has(resource)).sort();
  if (overlap.length === 0) return void 0;
  if (left.ordering === "commutative" && right.ordering === "commutative") return void 0;
  return { resources: overlap, reason: "shared_resource" };
};
var ActionRegistry = class {
  constructor(toolResultProxy) {
    this.toolResultProxy = toolResultProxy;
  }
  #providerBindings = new FabricProviderBindings();
  // Compatibility for internal/external invocation contexts that explicitly
  // grant the call by returning void. They still receive a bound, single-use
  // lease at the registry boundary rather than bypassing lease consumption.
  #compatibilityApprovalLeases = new FabricSessionApprovals();
  #activeEffects = /* @__PURE__ */ new Map();
  #unavailable = /* @__PURE__ */ new Map();
  /**
   * Monotonic capability epoch (PR3). Advanced only when the effective
   * discovery/type surface changes so unchanged execution paths reuse cached
   * declaration and search snapshots instead of re-deriving them.
   */
  #catalogEpoch = 0;
  /** Guest type sources keyed by epoch + capability-view semantic digest. */
  #guestTypeCache = /* @__PURE__ */ new Map();
  /** Search results keyed by epoch + view digest + normalized query + limit. */
  #searchCache = /* @__PURE__ */ new Map();
  /** Monotonic epoch; consumers key declaration/search caches off this. */
  get catalogEpoch() {
    return this.#catalogEpoch;
  }
  /** Bump the epoch and drop all capability-derived caches. */
  #invalidateCatalog() {
    this.#catalogEpoch += 1;
    this.#guestTypeCache.clear();
    this.#searchCache.clear();
  }
  /** Stable key for the visible capability surface (committed view or live). */
  #viewKey(context) {
    return context.capabilityView?.semanticDigest ?? "live";
  }
  register(provider, options = {}) {
    this.mount(provider, options);
  }
  mount(provider, options = {}) {
    if (!providerNamePattern.test(provider.name)) {
      throw new Error(`Invalid Fabric provider name: ${provider.name}`);
    }
    const lease = this.#providerBindings.mount(provider, options);
    this.#unavailable.delete(provider.name);
    this.#invalidateCatalog();
    return lease;
  }
  activateProviderBindings(bindingIds) {
    return this.#providerBindings.activate(bindingIds);
  }
  subscribeProviderChanges(listener) {
    return this.#providerBindings.subscribe(listener);
  }
  notifyCatalogChanged(provider) {
    this.#providerBindings.notifyCatalogChanged(provider);
    this.#invalidateCatalog();
  }
  has(name) {
    return this.#providerBindings.has(name);
  }
  markUnavailable(name, reason) {
    if (!providerNamePattern.test(name)) {
      throw new Error(`Invalid Fabric provider name: ${name}`);
    }
    if (this.#providerBindings.has(name)) {
      throw new Error(`Cannot mark a registered Fabric provider unavailable: ${name}`);
    }
    this.#unavailable.set(name, reason);
  }
  unavailableProviders() {
    return [...this.#unavailable.entries()].map(([name, reason]) => ({ name, reason })).sort((left, right) => left.name.localeCompare(right.name));
  }
  unregister(name) {
    const removed = this.#providerBindings.unregister(name);
    this.#invalidateCatalog();
    return removed;
  }
  providers() {
    return this.#providerBindings.providers().map((provider) => ({ name: provider.name, description: provider.description })).sort((left, right) => left.name.localeCompare(right.name));
  }
  async inspectCapabilities(requirements, context) {
    return this.#resolveCapabilities(requirements, context, false);
  }
  async acquireCapabilityView(requirements, context) {
    return this.#resolveCapabilities(requirements, context, true);
  }
  /**
   * Snapshot the tool schemas backing the dynamic guest surfaces (mcp and
   * extensions) so the type gate can reject argument-shape mistakes before
   * the sandbox runs. Side-effect-free by construction: MCP data comes from
   * the provider's cache-warm descriptor slice (listing would schedule
   * background revalidation), extension data from the captured-tool catalog.
   * Providers that cannot supply data yet simply contribute no section and
   * the loose declarations stand for that execution.
   */
  async guestTypeSources(context) {
    const key = `${this.#catalogEpoch}|${this.#viewKey(context)}`;
    const cached = this.#guestTypeCache.get(key);
    if (cached) {
      return cached.then((s) => cloneGuestTypeSources(s));
    }
    const pending = this.#computeGuestTypeSources(context);
    this.#guestTypeCache.set(key, pending);
    return pending.then((s) => cloneGuestTypeSources(s));
  }
  async #computeGuestTypeSources(context) {
    const sources = {};
    if (context.capabilityView) {
      const actions = await this.list({ limit: 1e3 }, context);
      const byServer = /* @__PURE__ */ new Map();
      for (const action of actions.filter((candidate) => candidate.provider === "mcp")) {
        const server = action.namespace;
        if (!server || server === "management" || action.name.startsWith("$")) continue;
        const prefix = `${server}.`;
        const name = action.name.startsWith(prefix) ? action.name.slice(prefix.length) : action.name;
        const tools = byServer.get(server) ?? [];
        tools.push({ name, inputSchema: action.inputSchema });
        byServer.set(server, tools);
      }
      if (byServer.size > 0) {
        sources.mcpServers = [...byServer.entries()].map(([server, tools]) => ({
          server,
          tools
        }));
      }
      const extensionTools = actions.filter((action) => action.provider === "extensions").map((action) => ({ name: action.name, inputSchema: action.inputSchema }));
      if (extensionTools.length > 0) sources.extensionTools = extensionTools;
      return sources;
    }
    const mcp = this.#providerBindings.current("mcp")?.provider;
    const mcpDescriptors = mcp?.sliceDescriptors?.();
    if (mcpDescriptors && mcpDescriptors.length > 0) {
      const byServer = /* @__PURE__ */ new Map();
      for (const descriptor of mcpDescriptors) {
        const server = descriptor.namespace;
        if (!server || server === "management" || descriptor.name.startsWith("$")) continue;
        const prefix = `${server}.`;
        const toolName = descriptor.name.startsWith(prefix) ? descriptor.name.slice(prefix.length) : descriptor.name;
        let tools = byServer.get(server);
        if (!tools) {
          tools = /* @__PURE__ */ new Map();
          byServer.set(server, tools);
        }
        tools.set(toolName, { name: toolName, inputSchema: descriptor.inputSchema });
      }
      if (byServer.size > 0) {
        sources.mcpServers = [...byServer.entries()].map(([server, tools]) => ({
          server,
          tools: [...tools.values()]
        }));
      }
    }
    const extensions = this.#providerBindings.current("extensions")?.provider;
    if (extensions) {
      try {
        const descriptors4 = await extensions.list({}, context);
        if (descriptors4.length > 0) {
          sources.extensionTools = descriptors4.map((descriptor) => ({
            name: descriptor.name,
            inputSchema: descriptor.inputSchema
          }));
        }
      } catch {
      }
    }
    return sources;
  }
  async list(request, context) {
    if (context.capabilityView) {
      const refs = Object.keys(context.capabilityView.bindings).filter((ref) => !request.provider || ref.startsWith(`${request.provider}.`)).sort();
      const actions = await Promise.all(refs.map((ref) => this.describe(ref, context)));
      const query = request.query?.normalize("NFKC").trim().toLowerCase();
      return actions.filter((action) => !request.namespace || action.namespace === request.namespace).filter(
        (action) => !query || `${action.ref} ${action.description}`.toLowerCase().includes(query)
      ).slice(0, Math.max(1, Math.min(request.limit ?? 100, 1e3)));
    }
    const providers = request.provider ? [this.#requireProvider(request.provider)] : this.#providerBindings.providers();
    const lists = await Promise.all(
      providers.map(async (provider) => {
        const descriptors4 = await provider.list(request, context);
        return descriptors4.map((descriptor) => resolveDescriptor(provider, descriptor));
      })
    );
    const limit = Math.max(1, Math.min(request.limit ?? 100, 1e3));
    return lists.flat().slice(0, limit);
  }
  async catalog(context, options = {}) {
    const providers = (context.capabilityView ? [...new Map(
      Object.values(context.capabilityView.bindings).flatMap((pinned) => {
        const binding = this.#providerBindings.binding(pinned.providerBindingId);
        return binding ? [[binding.name, binding.provider]] : [];
      })
    ).values()] : options.provider ? [this.#requireProvider(options.provider)] : this.#providerBindings.providers()).filter((provider) => !options.provider || provider.name === options.provider).filter((provider) => options.includeProvider?.(provider.name) ?? true).sort((left, right) => left.name.localeCompare(right.name));
    const lists = await Promise.all(
      providers.map(async (provider) => ({
        provider,
        actions: context.capabilityView ? await this.list({ provider: provider.name, limit: 1e3 }, context) : (await provider.list({}, context)).map((descriptor) => resolveDescriptor(provider, descriptor))
      }))
    );
    const allActions = lists.flatMap(({ actions }) => actions).sort((left, right) => left.ref.localeCompare(right.ref));
    const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 1e3), 1e3));
    const retainedRefs = new Set(allActions.slice(0, limit).map((action) => action.ref));
    const providerHeads = lists.map(({ provider, actions }) => {
      const actionHeads = actions.filter((action) => retainedRefs.has(action.ref)).sort((left, right) => left.ref.localeCompare(right.ref)).map((action) => ({
        key: `action:${action.ref}`,
        parentKey: `provider:${provider.name}`,
        ref: action.ref,
        name: action.name,
        description: action.description,
        descriptorHash: actionDescriptorHash(action),
        risk: action.risk,
        ...action.namespace === void 0 ? {} : { namespace: action.namespace },
        ...action.effect === void 0 ? {} : { effect: action.effect }
      }));
      return {
        key: `provider:${provider.name}`,
        parentKey: "capability:fabric",
        name: provider.name,
        description: provider.description,
        descriptorHash: descriptorHash({
          name: provider.name,
          description: provider.description,
          actions: actionHeads.map((action) => action.descriptorHash)
        }),
        actions: actionHeads
      };
    });
    const indexedActions = providerHeads.reduce((total, provider) => total + provider.actions.length, 0);
    const rootHash = descriptorHash(providerHeads.map((provider) => provider.descriptorHash));
    return {
      kind: "kiro-fabric.capability-catalog",
      version: 1,
      root: {
        key: "capability:fabric",
        name: "Fabric capabilities",
        description: context.capabilityView ? "Committed provider and action metadata for this execution; not historical session evidence." : "Current registered provider and action metadata for navigation; not historical session evidence.",
        descriptorHash: rootHash
      },
      providers: providerHeads,
      totalActions: allActions.length,
      indexedActions,
      complete: indexedActions === allActions.length,
      reasons: indexedActions === allActions.length ? [] : ["action_limit"]
    };
  }
  async search(query, context, limit = 30) {
    const normalizedQuery = query.normalize("NFKC").trim().toLowerCase();
    if (!normalizedQuery) return [];
    const key = `${this.#catalogEpoch}|${this.#viewKey(context)}|${normalizedQuery}|${Math.max(
      1,
      Math.min(limit, 100)
    )}`;
    const cached = this.#searchCache.get(key);
    if (cached) return cached.map((action) => action);
    const computed = await this.#computeSearch(normalizedQuery, context, limit);
    this.#searchCache.set(key, computed.map((action) => action));
    return computed;
  }
  async #computeSearch(normalizedQuery, context, limit) {
    const queryTerms = [...new Set(discoveryTerms(normalizedQuery))];
    const listed = await this.list({ limit: 1e3 }, context);
    return listed.map((action) => {
      const providerDescription = this.#providerBindings.current(action.provider)?.provider.description ?? "";
      const ref = action.ref.normalize("NFKC").toLowerCase();
      const name = action.name.normalize("NFKC").toLowerCase();
      const description = action.description.normalize("NFKC").toLowerCase();
      const provider = action.provider.normalize("NFKC").toLowerCase();
      const providerBody = providerDescription.normalize("NFKC").toLowerCase();
      const namespace = (action.namespace ?? "").normalize("NFKC").toLowerCase();
      const schema = JSON.stringify(action.inputSchema).normalize("NFKC").toLowerCase();
      const tokenSets = {
        ref: new Set(discoveryTerms(ref)),
        name: new Set(discoveryTerms(name)),
        description: new Set(discoveryTerms(description)),
        provider: new Set(discoveryTerms(provider)),
        providerBody: new Set(discoveryTerms(providerBody)),
        namespace: new Set(discoveryTerms(namespace)),
        schema: new Set(discoveryTerms(schema))
      };
      const fields = Object.values(tokenSets);
      let score = 0;
      if (ref === normalizedQuery) score += 1e3;
      if (name === normalizedQuery) score += 800;
      if (ref.startsWith(normalizedQuery)) score += 300;
      else if (ref.includes(normalizedQuery)) score += 120;
      if (description.includes(normalizedQuery)) score += 40;
      if (providerBody.includes(normalizedQuery)) score += 20;
      if (schema.includes(normalizedQuery)) score += 10;
      let matchedTerms = 0;
      for (const term of queryTerms) {
        const matched = fields.some((field) => field.has(term));
        if (!matched) continue;
        matchedTerms += 1;
        if (tokenSets.ref.has(term) || tokenSets.name.has(term)) score += 30;
        if (tokenSets.provider.has(term)) score += 20;
        if (tokenSets.description.has(term)) score += 8;
        if (tokenSets.providerBody.has(term)) score += 4;
        if (tokenSets.namespace.has(term)) score += 6;
        if (tokenSets.schema.has(term)) score += 2;
      }
      if (queryTerms.length > 0 && matchedTerms === queryTerms.length) score += 15;
      return { action, score };
    }).filter((entry) => entry.score > 0).sort(
      (left, right) => right.score - left.score || left.action.ref.localeCompare(right.action.ref)
    ).slice(0, Math.max(1, Math.min(limit, 100))).map((entry) => entry.action);
  }
  async describe(ref, context) {
    if (ref.includes(".")) {
      const { provider, actionName, expectedDescriptorHash } = this.#parseRef(
        ref,
        context.capabilityView
      );
      const descriptor = await provider.describe(actionName, context);
      if (!descriptor) throw new FabricResolutionError(`Unknown Fabric action: ${ref}`);
      const action = resolveDescriptor(provider, descriptor);
      if (expectedDescriptorHash && actionDescriptorHash(action) !== expectedDescriptorHash) {
        throw new FabricResolutionError(`Fabric capability descriptor changed: ${ref}`);
      }
      return action;
    }
    if (context.capabilityView) {
      const pinned = await Promise.all(
        Object.keys(context.capabilityView.bindings).map(
          (candidate) => this.describe(candidate, context)
        )
      );
      const matches2 = pinned.filter((action) => action.name === ref);
      if (matches2.length === 1) return matches2[0];
      if (matches2.length > 1) {
        throw new Error(
          `"${ref}" matches ${matches2.length} committed Fabric actions; qualify with provider.action: ` + matches2.map((match2) => match2.ref).sort().join(", ")
        );
      }
      throw new FabricResolutionError(`Unknown Fabric action in committed view: ${ref}`);
    }
    const matches = [];
    for (const provider of this.#providerBindings.providers()) {
      let descriptors4;
      try {
        descriptors4 = await provider.list({}, context);
      } catch {
        continue;
      }
      for (const descriptor of descriptors4) {
        if (descriptor.name === ref) matches.push(resolveDescriptor(provider, descriptor));
      }
    }
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(
        `"${ref}" matches ${matches.length} Fabric actions; qualify with provider.action: ` + matches.map((match2) => match2.ref).sort().join(", ")
      );
    }
    throw new FabricResolutionError(`Unknown Fabric action: ${ref}`);
  }
  async acquireScoped(ref, args, context) {
    const { binding, provider, actionName, expectedDescriptorHash } = this.#parseRef(
      ref,
      context.capabilityView
    );
    const endInvocation = this.#providerBindings.beginInvocation(binding.id);
    const releaseBinding = this.#providerBindings.retain([binding.id]);
    let retentionTransferred = false;
    try {
      const descriptor = await runAbortable(
        context.signal,
        () => provider.describe(actionName, context)
      );
      if (!descriptor) throw new FabricResolutionError(`Unknown Fabric action: ${ref}`);
      const action = resolveDescriptor(provider, descriptor);
      if (expectedDescriptorHash && actionDescriptorHash(action) !== expectedDescriptorHash) {
        throw new FabricResolutionError(`Fabric capability descriptor changed: ${ref}`);
      }
      if (action.effect?.kind !== "scoped") {
        throw new Error(`Fabric action is not a scoped acquisition: ${ref}`);
      }
      if (!provider.acquire) {
        throw new Error(`Fabric provider does not implement scoped acquisition: ${provider.name}`);
      }
      const preparedArgs = provider.prepareArguments ? await runAbortable(
        context.signal,
        () => provider.prepareArguments(actionName, args, context)
      ) : args;
      if (typeof preparedArgs !== "object" || preparedArgs === null || Array.isArray(preparedArgs)) {
        throw new Error(`Argument preparation for ${ref} did not return an object`);
      }
      const invalid = schemaValidationMessage(action.inputSchema, preparedArgs);
      if (invalid) throw new Error(`Invalid arguments for ${ref}: ${invalid}`);
      const acquired = await runAbortable(
        context.signal,
        () => provider.acquire(actionName, preparedArgs, context)
      );
      if (!acquired || typeof acquired.dispose !== "function") {
        throw new Error(`Scoped acquisition ${ref} did not return a disposer`);
      }
      let disposal;
      retentionTransferred = true;
      return {
        value: acquired.value,
        dispose: () => {
          disposal ??= (async () => {
            try {
              await acquired.dispose();
            } finally {
              await releaseBinding();
            }
          })();
          return disposal;
        }
      };
    } finally {
      await endInvocation().catch(() => void 0);
      if (!retentionTransferred) await releaseBinding().catch(() => void 0);
    }
  }
  async invoke(ref, args, context) {
    const traceOperation = context.traceOperation ?? context.trace?.issueCall(ref, args);
    let failureStage = "resolve";
    let audit;
    let invocationActive = false;
    let endBindingInvocation;
    try {
      const { binding, provider, actionName, expectedDescriptorHash } = this.#parseRef(
        ref,
        context.capabilityView
      );
      endBindingInvocation = this.#providerBindings.beginInvocation(binding.id);
      const descriptor = await runAbortable(
        context.signal,
        () => provider.describe(actionName, context)
      );
      if (!descriptor) throw new FabricResolutionError(`Unknown Fabric action: ${ref}`);
      const action = resolveDescriptor(provider, descriptor);
      if (expectedDescriptorHash && actionDescriptorHash(action) !== expectedDescriptorHash) {
        throw new FabricResolutionError(`Fabric capability descriptor changed: ${ref}`);
      }
      traceOperation?.resolved(action.provider, action.name);
      failureStage = "guard";
      if (action.effect?.kind === "scoped") {
        throw new FabricTraceSafeError(
          `Fabric scoped action ${ref} requires a supervised acquisition context`
        );
      }
      if (context.authorize) {
        await runAbortable(context.signal, () => context.authorize(action));
      }
      failureStage = "prepare";
      const preparedArgs = provider.prepareArguments ? await runAbortable(
        context.signal,
        () => provider.prepareArguments(actionName, args, context)
      ) : args;
      if (typeof preparedArgs !== "object" || preparedArgs === null || Array.isArray(preparedArgs)) {
        throw new FabricTraceSafeError(`Argument preparation for ${ref} did not return an object`);
      }
      traceOperation?.prepared(preparedArgs);
      failureStage = "validate";
      const invalid = schemaValidationMessage(action.inputSchema, preparedArgs);
      if (invalid) throw new FabricTraceSafeError(`Invalid arguments for ${ref}: ${invalid}`);
      failureStage = "approve";
      const requestApproval = (candidateArgs) => context.approvalScope === void 0 ? context.approve(action, candidateArgs) : context.approve(action, candidateArgs, context.approvalScope);
      const granted = await runAbortable(context.signal, () => requestApproval(preparedArgs));
      const effectiveGrant = granted ?? this.#compatibilityApprovalLeases.issueLease(
        action,
        preparedArgs,
        context.approvalScope ?? {},
        "explicit-broad"
      );
      const approvalAudits = consumeFabricApprovalLeases(
        Array.isArray(effectiveGrant) ? effectiveGrant : [effectiveGrant],
        action,
        preparedArgs,
        context.approvalScope
      );
      const nestedToolCallId = `${NESTED_TOOL_CALL_ID_PREFIX}${randomUUID3()}`;
      const effect = action.effect;
      const effectConflicts = [...this.#activeEffects.values()].flatMap((active) => {
        const conflict = conflictBetween(effect, active.effect);
        return conflict ? [{ withRef: active.ref, ...conflict }] : [];
      }).slice(0, 32);
      const argsPreview = previewArgs(ref, preparedArgs);
      const activeAudit = {
        ref,
        nestedToolCallId,
        startedAt: Date.now(),
        tool: action.name,
        provider: action.provider,
        args: boundedPreviewValue(
          argsPreview,
          MAX_AUDIT_VALUE_CHARS
        ),
        ...effectConflicts.length > 0 ? { effectConflicts } : {},
        approval: approvalAudits
      };
      audit = activeAudit;
      context.audits.push(activeAudit);
      context.observeInvocation?.({
        type: "call_start",
        callId: nestedToolCallId,
        ref,
        args: argsPreview
      });
      if (effectConflicts.length > 0 && context.effectPolicy === "strict") {
        failureStage = "guard";
        throw new FabricTraceSafeError(
          `Fabric effect conflict for ${ref}: ${effectConflicts.map((conflict) => formatFabricEffectConflict(
            conflict.withRef,
            conflict.resources,
            conflict.reason
          )).join("; ")}`
        );
      }
      failureStage = "invoke";
      invocationActive = true;
      context.update(`Calling ${ref}`);
      this.#activeEffects.set(nestedToolCallId, { ref, effect });
      let providerValue;
      try {
        providerValue = await runAbortable(
          context.signal,
          () => provider.invoke(actionName, preparedArgs, {
            ...context,
            nestedToolCallId,
            update(message) {
              if (!invocationActive) return;
              context.update(message);
              context.observeInvocation?.({
                type: "call_update",
                callId: nestedToolCallId,
                update: { type: "progress", message }
              });
            },
            activity(update) {
              if (!invocationActive) return;
              context.activity?.(update);
              context.observeInvocation?.({
                type: "call_update",
                callId: nestedToolCallId,
                update
              });
            },
            attachMedia(blocks, note) {
              if (!invocationActive) return;
              if (!activeAudit.media) activeAudit.media = [];
              for (const block of blocks) activeAudit.media.push(block);
              if (note) activeAudit.mediaNote = note;
            },
            updateArguments: async (updatedArgs) => {
              if (!invocationActive) return;
              const updatedDigest = fabricApprovalArgumentDigest(updatedArgs);
              if (approvalAudits.every((approved) => approved.argumentDigest !== updatedDigest)) {
                const rebound = await requestApproval(updatedArgs);
                const reboundGrant = rebound ?? this.#compatibilityApprovalLeases.issueLease(
                  action,
                  updatedArgs,
                  context.approvalScope ?? {},
                  "explicit-broad"
                );
                approvalAudits.push(...consumeFabricApprovalLeases(
                  Array.isArray(reboundGrant) ? reboundGrant : [reboundGrant],
                  action,
                  updatedArgs,
                  context.approvalScope
                ));
              }
              const updatedPreview = previewArgs(ref, updatedArgs);
              activeAudit.args = boundedPreviewValue(
                updatedPreview,
                MAX_AUDIT_VALUE_CHARS
              );
              traceOperation?.prepared(updatedArgs);
              context.observeInvocation?.({
                type: "call_args",
                callId: nestedToolCallId,
                args: updatedPreview
              });
            },
            attachPreview(preview) {
              if (!invocationActive) return;
              activeAudit.preview = preview;
            }
          })
        );
      } finally {
        this.#activeEffects.delete(nestedToolCallId);
      }
      const value = this.toolResultProxy ? await runAbortable(context.signal, () => this.toolResultProxy.proxy({
        action,
        args: preparedArgs,
        toolCallId: nestedToolCallId,
        value: providerValue,
        ...context.signal ? { signal: context.signal } : {}
      })) : providerValue;
      const bounded2 = boundedResult(value, context.maxResultChars);
      const resultError = failedResultError(value);
      activeAudit.success = resultError === void 0;
      if (resultError) activeAudit.error = resultError;
      activeAudit.resultChars = bounded2.chars;
      activeAudit.resultTruncated = bounded2.truncated;
      const resultPreview = previewResult(bounded2.value);
      activeAudit.result = boundedPreviewValue(resultPreview, MAX_AUDIT_VALUE_CHARS);
      activeAudit.endedAt = Date.now();
      context.observeInvocation?.({
        type: "call_end",
        callId: nestedToolCallId,
        success: resultError === void 0,
        result: resultPreview,
        ...activeAudit.preview !== void 0 ? { preview: activeAudit.preview } : {},
        ...resultError ? { error: resultError } : {}
      });
      if (resultError) {
        traceOperation?.fail("invoke", resultError, failedResultOutcome(value), bounded2.value, {
          resultTruncated: bounded2.truncated
        });
      } else {
        traceOperation?.succeed(bounded2.value, { resultTruncated: bounded2.truncated });
      }
      return bounded2.value;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      traceOperation?.fail(failureStage, error, executionOutcomeFromError(error, context.signal));
      if (audit) {
        audit.success = false;
        audit.error = message;
        audit.endedAt = Date.now();
        context.observeInvocation?.({
          type: "call_end",
          callId: audit.nestedToolCallId,
          success: false,
          error: audit.error
        });
      }
      throw error;
    } finally {
      invocationActive = false;
      if (audit) audit.endedAt ??= Date.now();
      await endBindingInvocation?.().catch(() => void 0);
    }
  }
  async endInvocation(parentToolCallId, timeoutMs = 1e3) {
    const providers = new Set(
      this.#providerBindings.entries().map((binding) => binding.provider)
    );
    const finalizers = [...providers].flatMap(
      (provider) => provider.invocationEnded ? [Promise.resolve().then(() => provider.invocationEnded(parentToolCallId))] : []
    );
    await settleWithin(finalizers, timeoutMs);
  }
  async close(excludedProviderNames = /* @__PURE__ */ new Set()) {
    await this.#providerBindings.close(excludedProviderNames);
  }
  async #resolveCapabilities(requirements, context, retain) {
    const normalized = /* @__PURE__ */ new Map();
    for (const requirement of requirements) {
      const ref = (typeof requirement === "string" ? requirement : requirement.ref).trim();
      if (!ref || ref.length > 256 || !ref.includes(".")) {
        throw new Error(`Fabric capability requirements must use provider.action: ${ref || "<empty>"}`);
      }
      const optional = typeof requirement === "string" ? false : requirement.optional === true;
      normalized.set(ref, (normalized.get(ref) ?? true) && optional);
    }
    const missing = [];
    const optionalMissing = [];
    const resolved = /* @__PURE__ */ new Map();
    const temporaryReleases = [];
    let permanentRelease;
    try {
      for (const [ref, optional] of [...normalized].sort(
        ([left], [right]) => left.localeCompare(right)
      )) {
        try {
          const { binding, provider, actionName, expectedDescriptorHash } = this.#parseRef(
            ref,
            context.capabilityView
          );
          const release = this.#providerBindings.retain([binding.id]);
          temporaryReleases.push(release);
          const descriptor = await runAbortable(
            context.signal,
            () => provider.describe(actionName, context)
          );
          if (!descriptor) throw new FabricResolutionError(`Unknown Fabric action: ${ref}`);
          const action = resolveDescriptor(provider, descriptor);
          if (expectedDescriptorHash && actionDescriptorHash(action) !== expectedDescriptorHash) {
            throw new FabricResolutionError(`Fabric capability descriptor changed: ${ref}`);
          }
          resolved.set(ref, {
            ref,
            provider: provider.name,
            providerBindingId: binding.id,
            generation: binding.generation,
            descriptorHash: actionDescriptorHash(action)
          });
        } catch (error) {
          if (!(error instanceof FabricResolutionError)) throw error;
          (optional ? optionalMissing : missing).push(ref);
        }
      }
      let view;
      if (missing.length === 0) {
        const bindings = Object.fromEntries(resolved);
        const values = [...resolved.values()];
        if (retain) permanentRelease = this.#providerBindings.retain(
          values.map((binding) => binding.providerBindingId)
        );
        view = {
          id: randomUUID3(),
          digest: descriptorHash(values),
          semanticDigest: descriptorHash(
            values.map(({ ref, provider, descriptorHash: hash }) => ({
              ref,
              provider,
              descriptorHash: hash
            }))
          ),
          bindings
        };
      }
      return {
        satisfied: missing.length === 0,
        missing,
        optionalMissing,
        ...view ? { view } : {},
        release: async () => {
          const release = permanentRelease;
          permanentRelease = void 0;
          await release?.();
        }
      };
    } finally {
      await Promise.allSettled(temporaryReleases.map((release) => release()));
    }
  }
  #parseRef(ref, view) {
    const separator = ref.indexOf(".");
    if (separator <= 0 || separator === ref.length - 1) {
      throw new Error(`Fabric action references must use provider.action: ${ref}`);
    }
    const providerName = ref.slice(0, separator);
    const pinned = view && Object.hasOwn(view.bindings, ref) ? view.bindings[ref] : void 0;
    if (view && !pinned) {
      throw new FabricResolutionError(`Fabric capability is outside the committed view: ${ref}`);
    }
    const binding = pinned ? this.#providerBindings.binding(pinned.providerBindingId) : this.#providerBindings.current(providerName);
    if (!binding || binding.name !== providerName) {
      if (pinned) {
        throw new FabricResolutionError(
          `Fabric capability binding is no longer available: ${ref} (${pinned.providerBindingId})`
        );
      }
      this.#requireProvider(providerName);
      throw new FabricResolutionError(`Unknown Fabric provider: ${providerName}`);
    }
    return {
      binding,
      provider: binding.provider,
      actionName: ref.slice(separator + 1),
      ...pinned ? { expectedDescriptorHash: pinned.descriptorHash } : {}
    };
  }
  #requireProvider(name) {
    const provider = this.#providerBindings.current(name)?.provider;
    if (provider) return provider;
    const unavailableReason = this.#unavailable.get(name);
    if (unavailableReason) {
      throw new FabricResolutionError(
        `Fabric provider "${name}" is unavailable: ${unavailableReason}`
      );
    }
    const registered = this.#providerBindings.providers().map((provider2) => provider2.name).sort((left, right) => left.localeCompare(right));
    throw new FabricResolutionError(
      `Unknown Fabric provider: ${name}` + (registered.length > 0 ? ` (registered providers: ${registered.join(", ")})` : "")
    );
  }
};
var cloneGuestTypeSources = (sources) => {
  const out = {};
  if (sources.mcpServers) {
    out.mcpServers = sources.mcpServers.map(({ server, tools }) => ({
      server,
      tools: tools.map((tool) => ({ name: tool.name, inputSchema: { ...tool.inputSchema } }))
    }));
  }
  if (sources.extensionTools) {
    out.extensionTools = sources.extensionTools.map((tool) => ({
      name: tool.name,
      inputSchema: { ...tool.inputSchema }
    }));
  }
  return out;
};

// src/activity/store.ts
import { randomUUID as randomUUID4 } from "node:crypto";

// src/runtime/orchestration.ts
var BLOCKING_ORCHESTRATION_REFS = /* @__PURE__ */ new Set([
  "agents.run",
  "agents.wait",
  "agents.ask"
]);
var isBlockingOrchestrationRef = (ref) => BLOCKING_ORCHESTRATION_REFS.has(ref);
var ORCHESTRATION_RE = /\b(?:workflow\.agent|agents\.(?:run|wait|ask))\s*\(|(?<!\.)\bagent\s*(?:<[^<>]*>)?\s*\(/;
var codeUsesOrchestration = (code) => ORCHESTRATION_RE.test(code);

// src/ui/fabric-code-parser.ts
var identifierStart = (char) => /[A-Za-z_$π]/u.test(char);
var identifierPart = (char) => /[A-Za-z0-9_$π]/u.test(char);
var readEscape = (source, index) => {
  const char = source[index];
  if (char === void 0) return { value: "", next: index };
  const simple = {
    n: "\n",
    r: "\r",
    t: "	",
    b: "\b",
    f: "\f",
    v: "\v",
    0: "\0"
  };
  if (char in simple) return { value: simple[char], next: index + 1 };
  if (char === "\n") return { value: "", next: index + 1 };
  if (char === "\r") return { value: "", next: source[index + 1] === "\n" ? index + 2 : index + 1 };
  if (char === "x") {
    const digits = source.slice(index + 1, index + 3);
    if (/^[0-9a-f]{2}$/i.test(digits)) return { value: String.fromCharCode(Number.parseInt(digits, 16)), next: index + 3 };
  }
  if (char === "u") {
    if (source[index + 1] === "{") {
      const end = source.indexOf("}", index + 2);
      const digits2 = end < 0 ? "" : source.slice(index + 2, end);
      if (/^[0-9a-f]{1,6}$/i.test(digits2)) {
        return { value: String.fromCodePoint(Number.parseInt(digits2, 16)), next: end + 1 };
      }
    }
    const digits = source.slice(index + 1, index + 5);
    if (/^[0-9a-f]{4}$/i.test(digits)) return { value: String.fromCharCode(Number.parseInt(digits, 16)), next: index + 5 };
  }
  return { value: char, next: index + 1 };
};
var tokenize2 = (source) => {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/u.test(char)) {
      index++;
      continue;
    }
    if (char === "/" && source[index + 1] === "/") {
      index = source.indexOf("\n", index + 2);
      if (index < 0) break;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      const quote = char;
      let value = "";
      let dynamicTemplate = false;
      index++;
      while (index < source.length) {
        const current = source[index];
        if (current === quote) {
          index++;
          break;
        }
        if (quote === "`" && current === "$" && source[index + 1] === "{") dynamicTemplate = true;
        if (current === "\\") {
          const escaped = readEscape(source, index + 1);
          value += escaped.value;
          index = escaped.next;
          continue;
        }
        value += current;
        index++;
      }
      if (!dynamicTemplate) tokens.push({ kind: "string", text: value });
      continue;
    }
    if (identifierStart(char)) {
      const start = index++;
      while (index < source.length && identifierPart(source[index])) index++;
      tokens.push({ kind: "identifier", text: source.slice(start, index) });
      continue;
    }
    tokens.push({ kind: "punctuation", text: char });
    index++;
  }
  return tokens;
};
var propertyName = (token) => token?.kind === "identifier" || token?.kind === "string" ? token.text : void 0;
var TITLE_MAX_CHARS = 80;
var TITLE_MAX_ANCHOR_CHARS = 40;
var TITLE_MAX_COMMAND_CHARS = 30;
var TITLE_MAX_TASK_CHARS = 40;
var TITLE_MAX_PATTERN_CHARS = 24;
var TITLE_MAX_KEY_CHARS = 24;
var TITLE_MAX_WINDOW_TOKENS = 96;
var TITLE_SAFE_ANCHOR = /^[A-Za-z0-9_./~@*+,-]+$/;
var TITLE_FILE_LIKE = /\.[A-Za-z0-9]{1,8}$/;
var PI_VERB_LABELS = {
  read: "Read",
  bash: "Shell",
  edit: "Edit",
  write: "Write",
  grep: "Search",
  find: "Search",
  ls: "Search"
};
var ROOT_VERB_LABELS = {
  agents: "Agent",
  memory: "Memory",
  state: "State",
  schema: "Schema",
  compact: "Compact",
  mesh: "Mesh",
  tools: "Tools"
};
var TITLE_PATH_KEYS = /* @__PURE__ */ new Set(["path", "file", "file_path"]);
var humanizeIdentifier = (value) => value.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase());
var titleAnchorPathLike = (value) => value.length > 0 && value.length <= 64 && TITLE_SAFE_ANCHOR.test(value) && (value.includes("/") || TITLE_FILE_LIKE.test(value) || value.includes("*"));
var titleBasename = (value) => value.split("/").filter(Boolean).pop() ?? value;
var titleClip = (value, maxChars) => value.length > maxChars ? `${value.slice(0, maxChars - 1)}\u2026` : value;
var clipWords = (value, maxChars) => {
  if (value.length <= maxChars) return value;
  const cut = value.slice(0, maxChars - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > 0 ? cut.slice(0, space) : cut}\u2026`;
};
var callWindow = (tokens, openIndex) => {
  let depth = 0;
  let end = openIndex;
  while (end < tokens.length && end - openIndex < TITLE_MAX_WINDOW_TOKENS) {
    const text = tokens[end].text;
    if (text === "(" || text === "[" || text === "{") depth++;
    else if (text === ")" || text === "]" || text === "}") {
      depth--;
      if (depth <= 0) break;
    }
    end++;
  }
  return { start: openIndex + 1, end };
};
var isNamedStringToken = (tokens, index) => tokens[index]?.kind === "string" && tokens[index - 1]?.text === "[" && tokens[index - 2]?.text === "\u03C0";
var windowKeyedString = (tokens, start, end, keys) => {
  for (let index = start; index < end; index++) {
    if (tokens[index]?.kind !== "string" || isNamedStringToken(tokens, index)) continue;
    if (tokens[index - 1]?.text !== ":") continue;
    const key = propertyName(tokens[index - 2]);
    if (key === void 0 || !(typeof keys === "string" ? key === keys : keys.has(key))) continue;
    return tokens[index].text;
  }
  return void 0;
};
var windowFirstString = (tokens, start, end) => {
  for (let index = start; index < end; index++) {
    if (tokens[index]?.kind === "string" && !isNamedStringToken(tokens, index)) return tokens[index].text;
  }
  return void 0;
};
var windowPathLike = (tokens, start, end) => {
  for (let index = start; index < end; index++) {
    if (tokens[index]?.kind === "string" && !isNamedStringToken(tokens, index) && titleAnchorPathLike(tokens[index].text)) {
      return tokens[index].text;
    }
  }
  return void 0;
};
var dirQualifier = (value) => TITLE_FILE_LIKE.test(titleBasename(value)) ? titleClip(titleBasename(value), TITLE_MAX_ANCHOR_CHARS) : TITLE_SAFE_ANCHOR.test(value) && value !== "." && value.length <= TITLE_MAX_ANCHOR_CHARS ? value : void 0;
var searchTarget = (tokens, start, end) => {
  const pattern = windowKeyedString(tokens, start, end, "pattern");
  let head;
  if (pattern !== void 0) {
    if (titleAnchorPathLike(pattern)) head = titleClip(titleBasename(pattern), TITLE_MAX_ANCHOR_CHARS);
    else if (TITLE_SAFE_ANCHOR.test(pattern) && pattern.length <= TITLE_MAX_PATTERN_CHARS) head = `"${pattern}"`;
  }
  const pathValue = windowKeyedString(tokens, start, end, TITLE_PATH_KEYS);
  let tail = pathValue !== void 0 ? dirQualifier(pathValue) : void 0;
  if (tail === void 0 && pathValue === void 0) {
    const positional = windowFirstString(tokens, start, end);
    if (positional !== void 0 && TITLE_SAFE_ANCHOR.test(positional) && positional.length <= TITLE_MAX_ANCHOR_CHARS) {
      tail = titleAnchorPathLike(positional) ? titleClip(titleBasename(positional), TITLE_MAX_ANCHOR_CHARS) : positional;
    }
  }
  if (head !== void 0 && tail !== void 0) return `${head} in ${tail}`;
  return head ?? tail;
};
var pathTarget = (tokens, start, end) => {
  const keyed = windowKeyedString(tokens, start, end, TITLE_PATH_KEYS);
  if (keyed !== void 0 && TITLE_FILE_LIKE.test(titleBasename(keyed))) {
    return titleClip(titleBasename(keyed), TITLE_MAX_ANCHOR_CHARS);
  }
  const loose = windowPathLike(tokens, start, end);
  if (loose !== void 0) return titleClip(titleBasename(loose), TITLE_MAX_ANCHOR_CHARS);
  return keyed !== void 0 ? dirQualifier(keyed) : void 0;
};
var piCallTarget = (label, tokens, start, end) => {
  if (label === "Shell") {
    const command = windowFirstString(tokens, start, end);
    return command !== void 0 ? titleClip(command.split("\n")[0], TITLE_MAX_COMMAND_CHARS) : void 0;
  }
  if (label === "Search") return searchTarget(tokens, start, end);
  return pathTarget(tokens, start, end);
};
var fabricExecTitleHint = (code) => {
  const tokens = tokenize2(code);
  const groups = /* @__PURE__ */ new Map();
  const record = (verb, target) => {
    const list = groups.get(verb);
    if (list) list.push(target);
    else groups.set(verb, [target]);
  };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind !== "identifier") continue;
    if ((token.text === "agents" || token.text === "compact") && tokens[index + 1]?.text === "(") {
      const window = callWindow(tokens, index + 1);
      const target = token.text === "agents" ? (() => {
        const task = windowKeyedString(tokens, window.start, window.end, "task");
        return task !== void 0 ? clipWords(task.split("\n")[0], TITLE_MAX_TASK_CHARS) : void 0;
      })() : void 0;
      record(ROOT_VERB_LABELS[token.text], target);
      continue;
    }
    const dot = tokens[index + 1];
    const leaf = tokens[index + 2];
    if (dot?.text !== "." || leaf?.kind !== "identifier") continue;
    if (token.text === "pi" && tokens[index + 3]?.text === "(") {
      const label = PI_VERB_LABELS[leaf.text] ?? humanizeIdentifier(leaf.text);
      const window = callWindow(tokens, index + 3);
      record(label, piCallTarget(label, tokens, window.start, window.end));
      continue;
    }
    if (token.text === "mcp" && tokens[index + 3]?.text === "." && tokens[index + 4]?.kind === "identifier" && tokens[index + 5]?.text === "(") {
      record("Mcp", `${leaf.text}.${tokens[index + 4].text}`);
      continue;
    }
    if (tokens[index + 3]?.text === "(") {
      const label = ROOT_VERB_LABELS[token.text];
      if (!label) continue;
      if (token.text === "memory" || token.text === "state") {
        const window = callWindow(tokens, index + 3);
        const key = windowKeyedString(tokens, window.start, window.end, "key");
        record(label, key !== void 0 ? clipWords(key.split("\n")[0], TITLE_MAX_KEY_CHARS) : void 0);
      } else {
        record(label, void 0);
      }
    }
  }
  if (groups.size === 0) return void 0;
  const segments = [];
  for (const [verb, targets] of groups) {
    const first = targets.find((target) => target !== void 0);
    let segment = verb;
    if (first !== void 0) {
      segment = `${verb} ${first}`;
      if (targets.length > 1) {
        segment += targets.every((target) => target === first) ? ` \xD7${targets.length}` : ` +${targets.length - 1}`;
      }
    } else if (targets.length > 1) {
      segment += ` \xD7${targets.length}`;
    }
    segments.push(segment);
  }
  let title;
  let overflow = false;
  for (const segment of segments) {
    if (title === void 0) {
      title = segment.length <= TITLE_MAX_CHARS ? segment : clipWords(segment, TITLE_MAX_CHARS);
      continue;
    }
    const candidate = `${title} + ${segment}`;
    if (candidate.length <= TITLE_MAX_CHARS) {
      title = candidate;
      continue;
    }
    overflow = true;
    break;
  }
  if (overflow && title !== void 0 && title.length + 3 <= TITLE_MAX_CHARS) title = `${title} +\u2026`;
  return title;
};

// src/ui/fabric-title-hint.ts
var TITLE_HINT_CACHE_MAX = 256;
var titleHintCache = /* @__PURE__ */ new Map();
var fabricExecTitleHintCached = (code) => {
  const hit = titleHintCache.get(code);
  if (hit !== void 0 || titleHintCache.has(code)) return hit;
  const hint = fabricExecTitleHint(code);
  if (titleHintCache.size >= TITLE_HINT_CACHE_MAX) {
    const oldest = titleHintCache.keys().next().value;
    if (oldest !== void 0) titleHintCache.delete(oldest);
  }
  titleHintCache.set(code, hint);
  return hint;
};

// src/execution-service.ts
var runtimeDependencies;
var loadRuntimeDependencies = () => runtimeDependencies ??= Promise.all([
  import("./quickjs-runtime-UKTCV7WC.js"),
  import("./node-process-runtime-4TNNXN7G.js"),
  import("./type-checker-YEYZNXI4.js"),
  import("./guest-types-6A5BKABT.js"),
  import("./dynamic-guest-types-YIYN3HDU.js"),
  import("./core-override-guest-types-R4QKUYMW.js")
]).then(([quickjs, nodeProcess, checker, guest, dynamicGuest, coreOverrides]) => ({
  QuickJsRuntime: quickjs.QuickJsRuntime,
  NodeProcessRuntime: nodeProcess.NodeProcessRuntime,
  typeCheckFabricCode: checker.typeCheckFabricCode,
  guestTypeDeclarations: guest.guestTypeDeclarations,
  buildDynamicGuestDeclarations: dynamicGuest.buildDynamicGuestDeclarations,
  buildCoreOverrideGuestDeclarations: coreOverrides.buildCoreOverrideGuestDeclarations
}));
var executionOutcomeFromTermination = (reason) => {
  switch (reason) {
    case "completed":
      return "succeeded";
    case "aborted":
      return "aborted";
    case "timed_out":
      return "timed_out";
    case "runtime_error":
      return "failed";
  }
};
var aggregateUsage = (usages) => ({
  input: usages.reduce((total, usage) => total + usage.input, 0),
  output: usages.reduce((total, usage) => total + usage.output, 0),
  cacheRead: usages.reduce((total, usage) => total + usage.cacheRead, 0),
  cacheWrite: usages.reduce((total, usage) => total + usage.cacheWrite, 0),
  ...usages.some((usage) => usage.cacheWrite1h !== void 0) ? { cacheWrite1h: usages.reduce((total, usage) => total + (usage.cacheWrite1h ?? 0), 0) } : {},
  ...usages.some((usage) => usage.reasoning !== void 0) ? { reasoning: usages.reduce((total, usage) => total + (usage.reasoning ?? 0), 0) } : {},
  totalTokens: usages.reduce((total, usage) => total + usage.totalTokens, 0),
  cost: {
    input: usages.reduce((total, usage) => total + usage.cost.input, 0),
    output: usages.reduce((total, usage) => total + usage.cost.output, 0),
    cacheRead: usages.reduce((total, usage) => total + usage.cost.cacheRead, 0),
    cacheWrite: usages.reduce((total, usage) => total + usage.cost.cacheWrite, 0),
    total: usages.reduce((total, usage) => total + usage.cost.total, 0)
  }
});
var FabricExecutionService = class {
  constructor(registry, config, activity, authorizer, autoApprovalClassifier, sessionApprovals = new FabricSessionApprovals(), capturedTools) {
    this.registry = registry;
    this.config = config;
    this.activity = activity;
    this.authorizer = authorizer;
    this.autoApprovalClassifier = autoApprovalClassifier;
    this.sessionApprovals = sessionApprovals;
    this.capturedTools = capturedTools;
  }
  #runtime;
  #runtimeKind;
  #capabilityView;
  setCapabilityView(view) {
    this.#capabilityView = view;
  }
  async execute(options) {
    const startedAt = performance.now();
    const coreToolNamespace = this.registry.has("k") && !this.registry.has("pi") ? "k" : "pi";
    const traceRecorder = new FabricExecutionTraceRecorder(coreToolNamespace);
    const sourceError = fabricSourceLimitError(options.code, this.config.executor.maxSourceBytes);
    if (sourceError) {
      return {
        success: false,
        value: void 0,
        logs: [],
        audits: [],
        phases: [],
        trace: traceRecorder.seal("failed", [], sourceError),
        elapsedMs: performance.now() - startedAt,
        error: sourceError
      };
    }
    this.activity?.start(
      options.parentToolCallId,
      options.display,
      options.display?.name?.trim() ? void 0 : fabricExecTitleHintCached(options.code)
    );
    const dependencies = await loadRuntimeDependencies();
    const effectiveFullCodeMode = this.config.fullCodeMode || this.config.schema.mode === "enforce";
    const unavailable = new Map(
      this.registry.unavailableProviders().map((entry) => [entry.name, entry.reason])
    );
    const guestTypeSources = await this.registry.guestTypeSources({
      cwd: options.host.cwd,
      signal: options.signal,
      parentToolCallId: options.parentToolCallId,
      nestedToolCallId: `${options.parentToolCallId}_typedecls`,
      extensionContext: options.host.payload,
      update() {
      },
      ...this.#capabilityView ? { capabilityView: this.#capabilityView } : {}
    });
    const coreOverrideDeclarations = effectiveFullCodeMode ? dependencies.buildCoreOverrideGuestDeclarations(
      this.capturedTools?.list().map((entry) => ({
        name: entry.name,
        inputSchema: entry.definition.parameters
      })) ?? []
    ) : void 0;
    const checked = dependencies.typeCheckFabricCode(
      options.code,
      dependencies.guestTypeDeclarations(effectiveFullCodeMode, {
        excludeGlobals: [...unavailable.keys()],
        dynamic: dependencies.buildDynamicGuestDeclarations(guestTypeSources),
        ...coreOverrideDeclarations ? { coreOverrides: coreOverrideDeclarations } : {},
        coreToolNamespace,
        agentBackedOrchestration: options.host.agentBackedOrchestration !== false
      })
    );
    if (checked.errors.length > 0) {
      for (const error of checked.errors) {
        const missing = /^Cannot find name '([^']+)'/.exec(error.message);
        const reason = missing?.[1] ? unavailable.get(missing[1]) : void 0;
        if (missing && reason) {
          error.message = `${error.message} Fabric provider "${missing[1]}" is unavailable: ${reason}`;
        }
      }
      this.activity?.finish(options.parentToolCallId, false, "Type checking failed");
      return {
        success: false,
        value: void 0,
        logs: [],
        audits: [],
        phases: [],
        trace: traceRecorder.seal(
          "failed",
          [],
          `Type checking failed (${checked.errors.length} ${checked.errors.length === 1 ? "error" : "errors"})`
        ),
        elapsedMs: performance.now() - startedAt,
        typeErrors: checked.errors
      };
    }
    const classifierUsages = [];
    const recordAutoDecision = (audit, decision) => {
      const operation = traceRecorder.issueCall("fabric.approval.auto", {
        action: audit.action,
        risk: audit.risk
      });
      operation.succeed(audit);
      if (decision) classifierUsages.push(decision.usage);
    };
    const approval = options.host.createApprover(recordAutoDecision, (usage) => {
      classifierUsages.push(usage);
    });
    const approvalScope = fabricApprovalScope({
      plan: options.code,
      project: options.host.cwd
    });
    const requestApprovalLease = async (action, args, scope = approvalScope) => await approval.approve(action, args, scope) ?? this.sessionApprovals.issueLease(action, args, scope, "explicit-broad");
    const audits = [];
    const phases = [];
    const workflowSpans = /* @__PURE__ */ new Map();
    let agentCalls = 0;
    let handoffRequest;
    const maxAgentCalls = Math.max(
      1,
      Math.min(
        options.maxAgentCalls ?? this.config.agents.maxPerExecution,
        this.config.agents.maxPerExecution
      )
    );
    const guardAgentCall = (ref) => {
      if (ref !== "agents.run" && ref !== "agents.handoff" && ref !== "agents.spawn" && ref !== "agents.create") return;
      agentCalls++;
      if (agentCalls > maxAgentCalls) {
        throw new FabricTraceSafeError(`Fabric agent budget exhausted (${maxAgentCalls} per execution)`);
      }
    };
    const fullCodeProvider = (value) => {
      const separator = value.indexOf(".");
      const provider = separator > 0 ? value.slice(0, separator) : value;
      return provider === coreToolNamespace || provider === "extensions" ? provider : void 0;
    };
    const guardFullCodeRef = (ref) => {
      if (effectiveFullCodeMode) return;
      const provider = fullCodeProvider(ref);
      if (!provider) return;
      throw new FabricTraceSafeError(
        `Fabric full code mode is disabled; call ${provider === coreToolNamespace ? coreToolNamespace === "pi" ? "Pi core" : "Kiro core" : "registered extension"} tools directly outside fabric_exec`
      );
    };
    let currentProgress;
    let emitPending = false;
    let emitTimer;
    const emitNow = () => {
      emitPending = false;
      options.onPartial({
        audits: audits.slice(),
        phases: phases.slice(),
        progress: currentProgress
      });
    };
    const flushEmit = () => {
      if (emitTimer) clearTimeout(emitTimer);
      emitTimer = void 0;
      if (emitPending) emitNow();
    };
    const emit = () => {
      emitPending = true;
      const debounceMs = this.config.ui.updateDebounceMs;
      if (debounceMs <= 0) {
        flushEmit();
        return;
      }
      if (emitTimer) return;
      emitTimer = setTimeout(() => {
        emitTimer = void 0;
        if (emitPending) emitNow();
      }, debounceMs);
      emitTimer.unref?.();
    };
    const update = (message) => {
      currentProgress = message;
      emit();
    };
    const observeInvocation = (event) => {
      if (this.activity) {
        if (event.type === "call_start") {
          this.activity.beginCall(options.parentToolCallId, event);
        } else if (event.type === "call_update") {
          this.activity.updateCall(options.parentToolCallId, event.callId, event.update);
        } else if (event.type === "call_args") {
          this.activity.updateCallArgs(options.parentToolCallId, event.callId, event.args);
        } else {
          this.activity.finishCall(options.parentToolCallId, event.callId, event);
        }
      }
      if (event.type === "call_end") emit();
    };
    const baseContext = {
      cwd: options.host.cwd,
      signal: options.signal,
      parentToolCallId: options.parentToolCallId,
      nestedToolCallId: `${options.parentToolCallId}_metadata`,
      extensionContext: options.host.payload,
      update,
      ...this.#capabilityView ? { capabilityView: this.#capabilityView } : {},
      approvalScope
    };
    const orchestrationTimeoutMs = Math.max(
      this.config.executor.timeoutMs,
      this.config.agents.timeoutMs
    );
    const effectiveTimeoutMs = codeUsesOrchestration(options.code) ? orchestrationTimeoutMs : this.config.executor.timeoutMs;
    const minimumTimeoutMsForHostCall = (ref, args) => {
      const targetRef = ref === "fabric.$call" && typeof args.ref === "string" ? args.ref : ref;
      const targetArgs = ref === "fabric.$call" && typeof args.args === "object" && args.args !== null && !Array.isArray(args.args) ? args.args : args;
      if (targetRef === `${coreToolNamespace}.bash`) {
        const seconds = targetArgs.timeout;
        const milliseconds = targetArgs.timeoutMs;
        const requested = typeof seconds === "number" && Number.isFinite(seconds) ? seconds * 1e3 : typeof milliseconds === "number" && Number.isFinite(milliseconds) ? milliseconds : 0;
        if (requested > 0) {
          return Math.max(
            this.config.executor.timeoutMs,
            Math.min(Math.floor(requested) + 5e3, MAX_AGENT_TIMEOUT_MS)
          );
        }
      }
      if (!isBlockingOrchestrationRef(targetRef)) return void 0;
      const requestedTimeoutMs = targetRef === "agents.run" && typeof targetArgs.timeoutMs === "number" && Number.isFinite(targetArgs.timeoutMs) ? Math.max(
        MIN_AGENT_TIMEOUT_MS,
        Math.min(Math.floor(targetArgs.timeoutMs), MAX_AGENT_TIMEOUT_MS)
      ) : 0;
      return Math.max(orchestrationTimeoutMs, requestedTimeoutMs);
    };
    const traceAttempt = async (ref, args, signal, run) => {
      const operation = traceRecorder.issueCall(ref, args);
      let stage = "invoke";
      try {
        const value = await run((nextStage) => {
          stage = nextStage;
        });
        operation.succeed(void 0);
        return value;
      } catch (error) {
        operation.fail(stage, error, executionOutcomeFromError(error, signal));
        throw error;
      }
    };
    const invokeAction = async (ref, args, callContext) => {
      const traceOperation = traceRecorder.issueCall(ref, args);
      try {
        guardFullCodeRef(ref);
        guardAgentCall(ref);
      } catch (error) {
        traceOperation.fail(
          "guard",
          error,
          executionOutcomeFromError(error, callContext.signal)
        );
        throw error;
      }
      return this.registry.invoke(ref, args, {
        ...callContext,
        ...ref === "agents.handoff" ? {
          deferHandoff(request) {
            if (handoffRequest) {
              throw new Error(
                "Only one agents.handoff request is allowed per fabric_exec invocation"
              );
            }
            handoffRequest = structuredClone(request);
            return {
              scheduled: true,
              status: "deferred",
              boundary: "fabric_exec_end"
            };
          }
        } : {},
        ...this.authorizer ? {
          authorize: (action) => this.authorizer.authorize(action.ref, options.parentToolCallId)
        } : {},
        approve: async (action, preparedArgs, scope) => {
          if (action.ref === "schema.commit") {
            const writeAction = { ...action, risk: "write" };
            const executeAction = { ...action, risk: "execute" };
            const consumedScope = scope ?? approvalScope;
            const writeLease = await requestApprovalLease(
              writeAction,
              preparedArgs,
              consumedScope
            );
            const executeLease = await requestApprovalLease(
              executeAction,
              preparedArgs,
              consumedScope
            );
            return [
              bindFabricApprovalLease(writeLease, writeAction),
              bindFabricApprovalLease(executeLease, executeAction)
            ];
          }
          return requestApprovalLease(action, preparedArgs, scope ?? approvalScope);
        },
        audits,
        maxResultChars: this.config.executor.maxNestedResultChars,
        traceOperation,
        observeInvocation
      });
    };
    let sandboxResult;
    try {
      const runtimeKind = this.config.executor.runtime;
      if (!this.#runtime || this.#runtimeKind !== runtimeKind) {
        this.#runtime = runtimeKind === "node-process" ? new dependencies.NodeProcessRuntime() : new dependencies.QuickJsRuntime();
        this.#runtimeKind = runtimeKind;
      }
      sandboxResult = await this.#runtime.execute(
        options.code,
        async (ref, args, runtimeSignal) => {
          const callContext = { ...baseContext, signal: runtimeSignal };
          switch (ref) {
            case "fabric.$providers":
              return traceAttempt(
                "fabric.discovery.providers",
                args,
                runtimeSignal,
                () => this.registry.providers().filter(
                  (provider) => !callContext.capabilityView || Object.values(callContext.capabilityView.bindings).some((binding) => binding.provider === provider.name)
                ).filter(
                  (provider) => effectiveFullCodeMode || !fullCodeProvider(provider.name)
                )
              );
            case "fabric.$catalog":
              return traceAttempt(
                "fabric.discovery.catalog",
                args,
                runtimeSignal,
                async (setStage) => {
                  const provider = typeof args.provider === "string" ? args.provider : void 0;
                  setStage("guard");
                  if (provider) guardFullCodeRef(`${provider}.*`);
                  setStage(provider && !this.registry.has(provider) ? "resolve" : "invoke");
                  return this.registry.catalog(callContext, {
                    ...provider ? { provider } : {},
                    ...typeof args.limit === "number" ? { limit: args.limit } : {},
                    includeProvider: (name) => effectiveFullCodeMode || !fullCodeProvider(name)
                  });
                }
              );
            case "fabric.$models": {
              const operation = traceRecorder.issueCall("fabric.discovery.models", args);
              try {
                const models = options.host.listModels?.() ?? [];
                operation.succeed(void 0);
                return models;
              } catch (error) {
                operation.fail(
                  "invoke",
                  error,
                  executionOutcomeFromError(error, runtimeSignal)
                );
                return [];
              }
            }
            case "fabric.$list":
              return traceAttempt(
                "fabric.discovery.list",
                args,
                runtimeSignal,
                async (setStage) => {
                  setStage("guard");
                  if (typeof args.provider === "string") {
                    guardFullCodeRef(`${args.provider}.*`);
                  }
                  setStage(
                    typeof args.provider === "string" && !this.registry.has(args.provider) ? "resolve" : "invoke"
                  );
                  const actions = await this.registry.list(
                    {
                      ...typeof args.provider === "string" ? { provider: args.provider } : {},
                      ...typeof args.namespace === "string" ? { namespace: args.namespace } : {},
                      ...typeof args.query === "string" ? { query: args.query } : {},
                      ...typeof args.limit === "number" ? { limit: args.limit } : {}
                    },
                    callContext
                  );
                  return actions.filter(
                    (action) => effectiveFullCodeMode || !fullCodeProvider(action.provider)
                  );
                }
              );
            case "fabric.$search":
              return traceAttempt(
                "fabric.discovery.search",
                args,
                runtimeSignal,
                async () => {
                  const actions = await this.registry.search(
                    String(args.query ?? ""),
                    callContext,
                    typeof args.limit === "number" ? args.limit : void 0
                  );
                  return actions.filter(
                    (action) => effectiveFullCodeMode || !fullCodeProvider(action.provider)
                  );
                }
              );
            case "fabric.$describe":
              return traceAttempt(
                "fabric.discovery.describe",
                args,
                runtimeSignal,
                async (setStage) => {
                  const targetRef = String(args.ref ?? "");
                  setStage("guard");
                  guardFullCodeRef(targetRef);
                  setStage("resolve");
                  return this.registry.describe(targetRef, callContext);
                }
              );
            case "fabric.$call": {
              const callArgs = typeof args.args === "object" && args.args !== null && !Array.isArray(args.args) ? args.args : {};
              const targetRef = String(args.ref ?? "");
              return invokeAction(targetRef, callArgs, callContext);
            }
            case "fabric.$progress":
              return traceAttempt(
                "fabric.workflow.progress",
                args,
                runtimeSignal,
                () => update(String(args.message ?? "Working"))
              );
            case "fabric.$configure":
              return traceAttempt(
                "fabric.workflow.configure",
                args,
                runtimeSignal,
                () => {
                  const display = {
                    ...typeof args.name === "string" ? { name: args.name } : {},
                    ...typeof args.description === "string" ? { description: args.description } : {}
                  };
                  return this.activity?.configure(options.parentToolCallId, display) ?? display;
                }
              );
            case "fabric.$phase":
              return traceAttempt(
                "fabric.workflow.phase",
                args,
                runtimeSignal,
                (setStage) => {
                  setStage("validate");
                  const name = typeof args.name === "string" ? args.name.trim() : "";
                  if (!name) throw new Error("Workflow phase name must be a non-empty string");
                  phases.push(name);
                  const phaseIndex = phases.length - 1;
                  const phaseInput = {
                    name,
                    ...typeof args.id === "string" ? { id: args.id } : {},
                    ...typeof args.description === "string" ? { description: args.description } : {},
                    ...typeof args.total === "number" ? { total: args.total } : {}
                  };
                  setStage("invoke");
                  const activityPhase = this.activity?.phase(options.parentToolCallId, phaseInput);
                  update(`Phase: ${name}`);
                  return {
                    name,
                    index: phaseIndex,
                    ...activityPhase ? { id: activityPhase.id } : {}
                  };
                }
              );
            case "fabric.$item":
              return traceAttempt(
                "fabric.workflow.item",
                args,
                runtimeSignal,
                () => {
                  const item = args;
                  return this.activity?.upsertItem(options.parentToolCallId, item) ?? item;
                }
              );
            case "fabric.$event":
              return traceAttempt(
                "fabric.workflow.event",
                args,
                runtimeSignal,
                () => {
                  const event = args;
                  this.activity?.event(options.parentToolCallId, event);
                }
              );
            case "fabric.$spanStart": {
              const id = typeof args.id === "string" ? args.id : "";
              const kind = args.kind;
              if (!id || kind !== "parallel" && kind !== "pipeline") {
                throw new Error("Invalid internal workflow span start");
              }
              if (workflowSpans.has(id)) throw new Error("Duplicate internal workflow span");
              const operation = traceRecorder.issueCall(`fabric.workflow.${kind}`, args);
              workflowSpans.set(id, { kind, operation });
              return void 0;
            }
            case "fabric.$spanEnd": {
              const id = typeof args.id === "string" ? args.id : "";
              const span = workflowSpans.get(id);
              if (!span) throw new Error("Unknown internal workflow span");
              workflowSpans.delete(id);
              if (args.outcome === "succeeded") span.operation.succeed(void 0);
              else {
                span.operation.fail(
                  "invoke",
                  void 0,
                  executionOutcomeFromError(new Error("Workflow span failed"), runtimeSignal)
                );
              }
              return void 0;
            }
            default:
              return invokeAction(ref, args, callContext);
          }
        },
        {
          timeoutMs: effectiveTimeoutMs,
          memoryLimitBytes: this.config.executor.memoryLimitBytes,
          maxSourceBytes: this.config.executor.maxSourceBytes,
          maxLogChars: this.config.executor.maxOutputChars,
          minimumTimeoutMsForHostCall,
          coreToolNamespace,
          agentBackedOrchestration: options.host.agentBackedOrchestration !== false,
          ...options.host.defaultAgentRunner ? { defaultAgentRunner: options.host.defaultAgentRunner } : {},
          ...options.host.unaccountedAgentRunners ? { unaccountedAgentRunners: options.host.unaccountedAgentRunners } : {},
          ...checked.javascript ? { transpiledCode: checked.javascript } : {},
          ...checked.sourceMap ? { transpiledSourceMap: checked.sourceMap } : {},
          ...options.strings ? { strings: options.strings } : {},
          ...options.tokenBudget !== void 0 ? { tokenBudget: options.tokenBudget } : {},
          ...options.signal ? { signal: options.signal } : {}
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.activity?.finish(options.parentToolCallId, false, message);
      throw error;
    } finally {
      await this.registry.endInvocation(options.parentToolCallId);
      flushEmit();
    }
    const runOutcome = executionOutcomeFromTermination(sandboxResult.terminationReason);
    const succeeded = runOutcome === "succeeded";
    this.activity?.finish(options.parentToolCallId, succeeded, sandboxResult.error);
    return {
      success: succeeded,
      value: sandboxResult.value,
      logs: sandboxResult.logs,
      audits,
      phases,
      // Guest and provider error text may embed tool output or source
      // literals, so the durable trace records only safe causes.
      trace: traceRecorder.seal(runOutcome, phases),
      elapsedMs: performance.now() - startedAt,
      ...sandboxResult.error ? { error: sandboxResult.error } : {},
      ...handoffRequest ? { handoffRequest } : {},
      ...classifierUsages.length > 0 ? { usage: aggregateUsage(classifierUsages) } : {}
    };
  }
};

// src/kiro/tools-provider.ts
import { spawn } from "node:child_process";
var import_ignore = __toESM(require_ignore(), 1);
import { createReadStream, promises as fs2 } from "node:fs";
import os2 from "node:os";
import path8 from "node:path";
import { createInterface } from "node:readline";

// node_modules/.pnpm/balanced-match@4.0.4/node_modules/balanced-match/dist/esm/index.js
var balanced = (a, b, str) => {
  const ma = a instanceof RegExp ? maybeMatch(a, str) : a;
  const mb = b instanceof RegExp ? maybeMatch(b, str) : b;
  const r = ma !== null && mb != null && range(ma, mb, str);
  return r && {
    start: r[0],
    end: r[1],
    pre: str.slice(0, r[0]),
    body: str.slice(r[0] + ma.length, r[1]),
    post: str.slice(r[1] + mb.length)
  };
};
var maybeMatch = (reg, str) => {
  const m = str.match(reg);
  return m ? m[0] : null;
};
var range = (a, b, str) => {
  let begs, beg, left, right = void 0, result;
  let ai = str.indexOf(a);
  let bi = str.indexOf(b, ai + 1);
  let i = ai;
  if (ai >= 0 && bi > 0) {
    if (a === b) {
      return [ai, bi];
    }
    begs = [];
    left = str.length;
    while (i >= 0 && !result) {
      if (i === ai) {
        begs.push(i);
        ai = str.indexOf(a, i + 1);
      } else if (begs.length === 1) {
        const r = begs.pop();
        if (r !== void 0)
          result = [r, bi];
      } else {
        beg = begs.pop();
        if (beg !== void 0 && beg < left) {
          left = beg;
          right = bi;
        }
        bi = str.indexOf(b, i + 1);
      }
      i = ai < bi && ai >= 0 ? ai : bi;
    }
    if (begs.length && right !== void 0) {
      result = [left, right];
    }
  }
  return result;
};

// node_modules/.pnpm/brace-expansion@5.0.8/node_modules/brace-expansion/dist/esm/index.js
var escSlash = "\0SLASH" + Math.random() + "\0";
var escOpen = "\0OPEN" + Math.random() + "\0";
var escClose = "\0CLOSE" + Math.random() + "\0";
var escComma = "\0COMMA" + Math.random() + "\0";
var escPeriod = "\0PERIOD" + Math.random() + "\0";
var escSlashPattern = new RegExp(escSlash, "g");
var escOpenPattern = new RegExp(escOpen, "g");
var escClosePattern = new RegExp(escClose, "g");
var escCommaPattern = new RegExp(escComma, "g");
var escPeriodPattern = new RegExp(escPeriod, "g");
var slashPattern = /\\\\/g;
var openPattern = /\\{/g;
var closePattern = /\\}/g;
var commaPattern = /\\,/g;
var periodPattern = /\\\./g;
var EXPANSION_MAX = 1e5;
var EXPANSION_MAX_LENGTH = 4e6;
function numeric(str) {
  return !isNaN(str) ? parseInt(str, 10) : str.charCodeAt(0);
}
function escapeBraces(str) {
  return str.replace(slashPattern, escSlash).replace(openPattern, escOpen).replace(closePattern, escClose).replace(commaPattern, escComma).replace(periodPattern, escPeriod);
}
function unescapeBraces(str) {
  return str.replace(escSlashPattern, "\\").replace(escOpenPattern, "{").replace(escClosePattern, "}").replace(escCommaPattern, ",").replace(escPeriodPattern, ".");
}
function parseCommaParts(str) {
  if (!str) {
    return [""];
  }
  const parts = [];
  const m = balanced("{", "}", str);
  if (!m) {
    return str.split(",");
  }
  const { pre, body, post } = m;
  const p = pre.split(",");
  p[p.length - 1] += "{" + body + "}";
  const postParts = parseCommaParts(post);
  if (post.length) {
    ;
    p[p.length - 1] += postParts.shift();
    p.push.apply(p, postParts);
  }
  parts.push.apply(parts, p);
  return parts;
}
function expand(str, options = {}) {
  if (!str) {
    return [];
  }
  const { max = EXPANSION_MAX, maxLength = EXPANSION_MAX_LENGTH } = options;
  if (str.slice(0, 2) === "{}") {
    str = "\\{\\}" + str.slice(2);
  }
  return expand_(escapeBraces(str), max, maxLength, true).map(unescapeBraces);
}
function embrace(str) {
  return "{" + str + "}";
}
function isPadded(el) {
  return /^-?0\d/.test(el);
}
function lte(i, y) {
  return i <= y;
}
function gte(i, y) {
  return i >= y;
}
function combine(acc, pre, values, max, maxLength, dropEmpties) {
  const out = [];
  let length = 0;
  for (let a = 0; a < acc.length; a++) {
    for (let v = 0; v < values.length; v++) {
      if (out.length >= max)
        return out;
      const expansion = acc[a] + pre + values[v];
      if (dropEmpties && !expansion)
        continue;
      if (length + expansion.length > maxLength)
        return out;
      out.push(expansion);
      length += expansion.length;
    }
  }
  return out;
}
function expandSequence(body, isAlphaSequence, max) {
  const n = body.split(/\.\./);
  const N = [];
  if (n[0] === void 0 || n[1] === void 0) {
    return N;
  }
  const x = numeric(n[0]);
  const y = numeric(n[1]);
  const width = Math.max(n[0].length, n[1].length);
  let incr = n.length === 3 && n[2] !== void 0 ? Math.max(Math.abs(numeric(n[2])), 1) : 1;
  let test = lte;
  const reverse = y < x;
  if (reverse) {
    incr *= -1;
    test = gte;
  }
  const pad = n.some(isPadded);
  for (let i = x; test(i, y) && N.length < max; i += incr) {
    let c;
    if (isAlphaSequence) {
      c = String.fromCharCode(i);
      if (c === "\\") {
        c = "";
      }
    } else {
      c = String(i);
      if (pad) {
        const need = width - c.length;
        if (need > 0) {
          const z = new Array(need + 1).join("0");
          if (i < 0) {
            c = "-" + z + c.slice(1);
          } else {
            c = z + c;
          }
        }
      }
    }
    N.push(c);
  }
  return N;
}
function expand_(str, max, maxLength, isTop) {
  let acc = [""];
  let dropEmpties = false;
  let firstGroup = true;
  for (; ; ) {
    const m = balanced("{", "}", str);
    if (!m) {
      return combine(acc, str, [""], max, maxLength, dropEmpties);
    }
    const pre = m.pre;
    if (/\$$/.test(pre)) {
      acc = combine(acc, pre + "{" + m.body + "}", [""], max, maxLength, dropEmpties && !m.post.length);
      firstGroup = false;
      if (!m.post.length)
        break;
      str = m.post;
      continue;
    }
    const isNumericSequence = /^-?\d+\.\.-?\d+(?:\.\.-?\d+)?$/.test(m.body);
    const isAlphaSequence = /^[a-zA-Z]\.\.[a-zA-Z](?:\.\.-?\d+)?$/.test(m.body);
    const isSequence = isNumericSequence || isAlphaSequence;
    const isOptions = m.body.indexOf(",") >= 0;
    if (!isSequence && !isOptions) {
      if (m.post.match(/,(?!,).*\}/)) {
        str = m.pre + "{" + m.body + escClose + m.post;
        isTop = true;
        continue;
      }
      return combine(acc, pre + "{" + m.body + "}" + m.post, [""], max, maxLength, dropEmpties);
    }
    if (firstGroup) {
      dropEmpties = isTop && !isSequence;
      firstGroup = false;
    }
    let values;
    if (isSequence) {
      values = expandSequence(m.body, isAlphaSequence, max);
    } else {
      let n = parseCommaParts(m.body);
      if (n.length === 1 && n[0] !== void 0) {
        n = expand_(n[0], max, maxLength, false).map(embrace);
        if (n.length === 1) {
          acc = combine(acc, pre + n[0], [""], max, maxLength, dropEmpties && !m.post.length);
          if (!m.post.length)
            break;
          str = m.post;
          continue;
        }
      }
      values = [];
      for (let j = 0; j < n.length; j++) {
        values.push.apply(values, expand_(n[j], max, maxLength, false));
      }
    }
    acc = combine(acc, pre, values, max, maxLength, dropEmpties && !m.post.length);
    if (!m.post.length)
      break;
    str = m.post;
  }
  return acc;
}

// node_modules/.pnpm/minimatch@10.2.5/node_modules/minimatch/dist/esm/assert-valid-pattern.js
var MAX_PATTERN_LENGTH = 1024 * 64;
var assertValidPattern = (pattern) => {
  if (typeof pattern !== "string") {
    throw new TypeError("invalid pattern");
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new TypeError("pattern is too long");
  }
};

// node_modules/.pnpm/minimatch@10.2.5/node_modules/minimatch/dist/esm/brace-expressions.js
var posixClasses = {
  "[:alnum:]": ["\\p{L}\\p{Nl}\\p{Nd}", true],
  "[:alpha:]": ["\\p{L}\\p{Nl}", true],
  "[:ascii:]": ["\\x00-\\x7f", false],
  "[:blank:]": ["\\p{Zs}\\t", true],
  "[:cntrl:]": ["\\p{Cc}", true],
  "[:digit:]": ["\\p{Nd}", true],
  "[:graph:]": ["\\p{Z}\\p{C}", true, true],
  "[:lower:]": ["\\p{Ll}", true],
  "[:print:]": ["\\p{C}", true],
  "[:punct:]": ["\\p{P}", true],
  "[:space:]": ["\\p{Z}\\t\\r\\n\\v\\f", true],
  "[:upper:]": ["\\p{Lu}", true],
  "[:word:]": ["\\p{L}\\p{Nl}\\p{Nd}\\p{Pc}", true],
  "[:xdigit:]": ["A-Fa-f0-9", false]
};
var braceEscape = (s) => s.replace(/[[\]\\-]/g, "\\$&");
var regexpEscape = (s) => s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
var rangesToString = (ranges) => ranges.join("");
var parseClass = (glob, position) => {
  const pos = position;
  if (glob.charAt(pos) !== "[") {
    throw new Error("not in a brace expression");
  }
  const ranges = [];
  const negs = [];
  let i = pos + 1;
  let sawStart = false;
  let uflag = false;
  let escaping = false;
  let negate = false;
  let endPos = pos;
  let rangeStart = "";
  WHILE: while (i < glob.length) {
    const c = glob.charAt(i);
    if ((c === "!" || c === "^") && i === pos + 1) {
      negate = true;
      i++;
      continue;
    }
    if (c === "]" && sawStart && !escaping) {
      endPos = i + 1;
      break;
    }
    sawStart = true;
    if (c === "\\") {
      if (!escaping) {
        escaping = true;
        i++;
        continue;
      }
    }
    if (c === "[" && !escaping) {
      for (const [cls, [unip, u, neg]] of Object.entries(posixClasses)) {
        if (glob.startsWith(cls, i)) {
          if (rangeStart) {
            return ["$.", false, glob.length - pos, true];
          }
          i += cls.length;
          if (neg)
            negs.push(unip);
          else
            ranges.push(unip);
          uflag = uflag || u;
          continue WHILE;
        }
      }
    }
    escaping = false;
    if (rangeStart) {
      if (c > rangeStart) {
        ranges.push(braceEscape(rangeStart) + "-" + braceEscape(c));
      } else if (c === rangeStart) {
        ranges.push(braceEscape(c));
      }
      rangeStart = "";
      i++;
      continue;
    }
    if (glob.startsWith("-]", i + 1)) {
      ranges.push(braceEscape(c + "-"));
      i += 2;
      continue;
    }
    if (glob.startsWith("-", i + 1)) {
      rangeStart = c;
      i += 2;
      continue;
    }
    ranges.push(braceEscape(c));
    i++;
  }
  if (endPos < i) {
    return ["", false, 0, false];
  }
  if (!ranges.length && !negs.length) {
    return ["$.", false, glob.length - pos, true];
  }
  if (negs.length === 0 && ranges.length === 1 && /^\\?.$/.test(ranges[0]) && !negate) {
    const r = ranges[0].length === 2 ? ranges[0].slice(-1) : ranges[0];
    return [regexpEscape(r), false, endPos - pos, false];
  }
  const sranges = "[" + (negate ? "^" : "") + rangesToString(ranges) + "]";
  const snegs = "[" + (negate ? "" : "^") + rangesToString(negs) + "]";
  const comb = ranges.length && negs.length ? "(" + sranges + "|" + snegs + ")" : ranges.length ? sranges : snegs;
  return [comb, uflag, endPos - pos, true];
};

// node_modules/.pnpm/minimatch@10.2.5/node_modules/minimatch/dist/esm/unescape.js
var unescape = (s, { windowsPathsNoEscape = false, magicalBraces = true } = {}) => {
  if (magicalBraces) {
    return windowsPathsNoEscape ? s.replace(/\[([^/\\])\]/g, "$1") : s.replace(/((?!\\).|^)\[([^/\\])\]/g, "$1$2").replace(/\\([^/])/g, "$1");
  }
  return windowsPathsNoEscape ? s.replace(/\[([^/\\{}])\]/g, "$1") : s.replace(/((?!\\).|^)\[([^/\\{}])\]/g, "$1$2").replace(/\\([^/{}])/g, "$1");
};

// node_modules/.pnpm/minimatch@10.2.5/node_modules/minimatch/dist/esm/ast.js
var _a;
var types = /* @__PURE__ */ new Set(["!", "?", "+", "*", "@"]);
var isExtglobType = (c) => types.has(c);
var isExtglobAST = (c) => isExtglobType(c.type);
var adoptionMap = /* @__PURE__ */ new Map([
  ["!", ["@"]],
  ["?", ["?", "@"]],
  ["@", ["@"]],
  ["*", ["*", "+", "?", "@"]],
  ["+", ["+", "@"]]
]);
var adoptionWithSpaceMap = /* @__PURE__ */ new Map([
  ["!", ["?"]],
  ["@", ["?"]],
  ["+", ["?", "*"]]
]);
var adoptionAnyMap = /* @__PURE__ */ new Map([
  ["!", ["?", "@"]],
  ["?", ["?", "@"]],
  ["@", ["?", "@"]],
  ["*", ["*", "+", "?", "@"]],
  ["+", ["+", "@", "?", "*"]]
]);
var usurpMap = /* @__PURE__ */ new Map([
  ["!", /* @__PURE__ */ new Map([["!", "@"]])],
  [
    "?",
    /* @__PURE__ */ new Map([
      ["*", "*"],
      ["+", "*"]
    ])
  ],
  [
    "@",
    /* @__PURE__ */ new Map([
      ["!", "!"],
      ["?", "?"],
      ["@", "@"],
      ["*", "*"],
      ["+", "+"]
    ])
  ],
  [
    "+",
    /* @__PURE__ */ new Map([
      ["?", "*"],
      ["*", "*"]
    ])
  ]
]);
var startNoTraversal = "(?!(?:^|/)\\.\\.?(?:$|/))";
var startNoDot = "(?!\\.)";
var addPatternStart = /* @__PURE__ */ new Set(["[", "."]);
var justDots = /* @__PURE__ */ new Set(["..", "."]);
var reSpecials = new Set("().*{}+?[]^$\\!");
var regExpEscape = (s) => s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
var qmark = "[^/]";
var star = qmark + "*?";
var starNoEmpty = qmark + "+?";
var ID = 0;
var AST = class {
  type;
  #root;
  #hasMagic;
  #uflag = false;
  #parts = [];
  #parent;
  #parentIndex;
  #negs;
  #filledNegs = false;
  #options;
  #toString;
  // set to true if it's an extglob with no children
  // (which really means one child of '')
  #emptyExt = false;
  id = ++ID;
  get depth() {
    return (this.#parent?.depth ?? -1) + 1;
  }
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return {
      "@@type": "AST",
      id: this.id,
      type: this.type,
      root: this.#root.id,
      parent: this.#parent?.id,
      depth: this.depth,
      partsLength: this.#parts.length,
      parts: this.#parts
    };
  }
  constructor(type, parent, options = {}) {
    this.type = type;
    if (type)
      this.#hasMagic = true;
    this.#parent = parent;
    this.#root = this.#parent ? this.#parent.#root : this;
    this.#options = this.#root === this ? options : this.#root.#options;
    this.#negs = this.#root === this ? [] : this.#root.#negs;
    if (type === "!" && !this.#root.#filledNegs)
      this.#negs.push(this);
    this.#parentIndex = this.#parent ? this.#parent.#parts.length : 0;
  }
  get hasMagic() {
    if (this.#hasMagic !== void 0)
      return this.#hasMagic;
    for (const p of this.#parts) {
      if (typeof p === "string")
        continue;
      if (p.type || p.hasMagic)
        return this.#hasMagic = true;
    }
    return this.#hasMagic;
  }
  // reconstructs the pattern
  toString() {
    return this.#toString !== void 0 ? this.#toString : !this.type ? this.#toString = this.#parts.map((p) => String(p)).join("") : this.#toString = this.type + "(" + this.#parts.map((p) => String(p)).join("|") + ")";
  }
  #fillNegs() {
    if (this !== this.#root)
      throw new Error("should only call on root");
    if (this.#filledNegs)
      return this;
    this.toString();
    this.#filledNegs = true;
    let n;
    while (n = this.#negs.pop()) {
      if (n.type !== "!")
        continue;
      let p = n;
      let pp = p.#parent;
      while (pp) {
        for (let i = p.#parentIndex + 1; !pp.type && i < pp.#parts.length; i++) {
          for (const part of n.#parts) {
            if (typeof part === "string") {
              throw new Error("string part in extglob AST??");
            }
            part.copyIn(pp.#parts[i]);
          }
        }
        p = pp;
        pp = p.#parent;
      }
    }
    return this;
  }
  push(...parts) {
    for (const p of parts) {
      if (p === "")
        continue;
      if (typeof p !== "string" && !(p instanceof _a && p.#parent === this)) {
        throw new Error("invalid part: " + p);
      }
      this.#parts.push(p);
    }
  }
  toJSON() {
    const ret = this.type === null ? this.#parts.slice().map((p) => typeof p === "string" ? p : p.toJSON()) : [this.type, ...this.#parts.map((p) => p.toJSON())];
    if (this.isStart() && !this.type)
      ret.unshift([]);
    if (this.isEnd() && (this === this.#root || this.#root.#filledNegs && this.#parent?.type === "!")) {
      ret.push({});
    }
    return ret;
  }
  isStart() {
    if (this.#root === this)
      return true;
    if (!this.#parent?.isStart())
      return false;
    if (this.#parentIndex === 0)
      return true;
    const p = this.#parent;
    for (let i = 0; i < this.#parentIndex; i++) {
      const pp = p.#parts[i];
      if (!(pp instanceof _a && pp.type === "!")) {
        return false;
      }
    }
    return true;
  }
  isEnd() {
    if (this.#root === this)
      return true;
    if (this.#parent?.type === "!")
      return true;
    if (!this.#parent?.isEnd())
      return false;
    if (!this.type)
      return this.#parent?.isEnd();
    const pl = this.#parent ? this.#parent.#parts.length : 0;
    return this.#parentIndex === pl - 1;
  }
  copyIn(part) {
    if (typeof part === "string")
      this.push(part);
    else
      this.push(part.clone(this));
  }
  clone(parent) {
    const c = new _a(this.type, parent);
    for (const p of this.#parts) {
      c.copyIn(p);
    }
    return c;
  }
  static #parseAST(str, ast, pos, opt, extDepth) {
    const maxDepth = opt.maxExtglobRecursion ?? 2;
    let escaping = false;
    let inBrace = false;
    let braceStart = -1;
    let braceNeg = false;
    if (ast.type === null) {
      let i2 = pos;
      let acc2 = "";
      while (i2 < str.length) {
        const c = str.charAt(i2++);
        if (escaping || c === "\\") {
          escaping = !escaping;
          acc2 += c;
          continue;
        }
        if (inBrace) {
          if (i2 === braceStart + 1) {
            if (c === "^" || c === "!") {
              braceNeg = true;
            }
          } else if (c === "]" && !(i2 === braceStart + 2 && braceNeg)) {
            inBrace = false;
          }
          acc2 += c;
          continue;
        } else if (c === "[") {
          inBrace = true;
          braceStart = i2;
          braceNeg = false;
          acc2 += c;
          continue;
        }
        const doRecurse = !opt.noext && isExtglobType(c) && str.charAt(i2) === "(" && extDepth <= maxDepth;
        if (doRecurse) {
          ast.push(acc2);
          acc2 = "";
          const ext2 = new _a(c, ast);
          i2 = _a.#parseAST(str, ext2, i2, opt, extDepth + 1);
          ast.push(ext2);
          continue;
        }
        acc2 += c;
      }
      ast.push(acc2);
      return i2;
    }
    let i = pos + 1;
    let part = new _a(null, ast);
    const parts = [];
    let acc = "";
    while (i < str.length) {
      const c = str.charAt(i++);
      if (escaping || c === "\\") {
        escaping = !escaping;
        acc += c;
        continue;
      }
      if (inBrace) {
        if (i === braceStart + 1) {
          if (c === "^" || c === "!") {
            braceNeg = true;
          }
        } else if (c === "]" && !(i === braceStart + 2 && braceNeg)) {
          inBrace = false;
        }
        acc += c;
        continue;
      } else if (c === "[") {
        inBrace = true;
        braceStart = i;
        braceNeg = false;
        acc += c;
        continue;
      }
      const doRecurse = !opt.noext && isExtglobType(c) && str.charAt(i) === "(" && /* c8 ignore start - the maxDepth is sufficient here */
      (extDepth <= maxDepth || ast && ast.#canAdoptType(c));
      if (doRecurse) {
        const depthAdd = ast && ast.#canAdoptType(c) ? 0 : 1;
        part.push(acc);
        acc = "";
        const ext2 = new _a(c, part);
        part.push(ext2);
        i = _a.#parseAST(str, ext2, i, opt, extDepth + depthAdd);
        continue;
      }
      if (c === "|") {
        part.push(acc);
        acc = "";
        parts.push(part);
        part = new _a(null, ast);
        continue;
      }
      if (c === ")") {
        if (acc === "" && ast.#parts.length === 0) {
          ast.#emptyExt = true;
        }
        part.push(acc);
        acc = "";
        ast.push(...parts, part);
        return i;
      }
      acc += c;
    }
    ast.type = null;
    ast.#hasMagic = void 0;
    ast.#parts = [str.substring(pos - 1)];
    return i;
  }
  #canAdoptWithSpace(child) {
    return this.#canAdopt(child, adoptionWithSpaceMap);
  }
  #canAdopt(child, map = adoptionMap) {
    if (!child || typeof child !== "object" || child.type !== null || child.#parts.length !== 1 || this.type === null) {
      return false;
    }
    const gc = child.#parts[0];
    if (!gc || typeof gc !== "object" || gc.type === null) {
      return false;
    }
    return this.#canAdoptType(gc.type, map);
  }
  #canAdoptType(c, map = adoptionAnyMap) {
    return !!map.get(this.type)?.includes(c);
  }
  #adoptWithSpace(child, index) {
    const gc = child.#parts[0];
    const blank = new _a(null, gc, this.options);
    blank.#parts.push("");
    gc.push(blank);
    this.#adopt(child, index);
  }
  #adopt(child, index) {
    const gc = child.#parts[0];
    this.#parts.splice(index, 1, ...gc.#parts);
    for (const p of gc.#parts) {
      if (typeof p === "object")
        p.#parent = this;
    }
    this.#toString = void 0;
  }
  #canUsurpType(c) {
    const m = usurpMap.get(this.type);
    return !!m?.has(c);
  }
  #canUsurp(child) {
    if (!child || typeof child !== "object" || child.type !== null || child.#parts.length !== 1 || this.type === null || this.#parts.length !== 1) {
      return false;
    }
    const gc = child.#parts[0];
    if (!gc || typeof gc !== "object" || gc.type === null) {
      return false;
    }
    return this.#canUsurpType(gc.type);
  }
  #usurp(child) {
    const m = usurpMap.get(this.type);
    const gc = child.#parts[0];
    const nt = m?.get(gc.type);
    if (!nt)
      return false;
    this.#parts = gc.#parts;
    for (const p of this.#parts) {
      if (typeof p === "object") {
        p.#parent = this;
      }
    }
    this.type = nt;
    this.#toString = void 0;
    this.#emptyExt = false;
  }
  static fromGlob(pattern, options = {}) {
    const ast = new _a(null, void 0, options);
    _a.#parseAST(pattern, ast, 0, options, 0);
    return ast;
  }
  // returns the regular expression if there's magic, or the unescaped
  // string if not.
  toMMPattern() {
    if (this !== this.#root)
      return this.#root.toMMPattern();
    const glob = this.toString();
    const [re, body, hasMagic, uflag] = this.toRegExpSource();
    const anyMagic = hasMagic || this.#hasMagic || this.#options.nocase && !this.#options.nocaseMagicOnly && glob.toUpperCase() !== glob.toLowerCase();
    if (!anyMagic) {
      return body;
    }
    const flags = (this.#options.nocase ? "i" : "") + (uflag ? "u" : "");
    return Object.assign(new RegExp(`^${re}$`, flags), {
      _src: re,
      _glob: glob
    });
  }
  get options() {
    return this.#options;
  }
  // returns the string match, the regexp source, whether there's magic
  // in the regexp (so a regular expression is required) and whether or
  // not the uflag is needed for the regular expression (for posix classes)
  // TODO: instead of injecting the start/end at this point, just return
  // the BODY of the regexp, along with the start/end portions suitable
  // for binding the start/end in either a joined full-path makeRe context
  // (where we bind to (^|/), or a standalone matchPart context (where
  // we bind to ^, and not /).  Otherwise slashes get duped!
  //
  // In part-matching mode, the start is:
  // - if not isStart: nothing
  // - if traversal possible, but not allowed: ^(?!\.\.?$)
  // - if dots allowed or not possible: ^
  // - if dots possible and not allowed: ^(?!\.)
  // end is:
  // - if not isEnd(): nothing
  // - else: $
  //
  // In full-path matching mode, we put the slash at the START of the
  // pattern, so start is:
  // - if first pattern: same as part-matching mode
  // - if not isStart(): nothing
  // - if traversal possible, but not allowed: /(?!\.\.?(?:$|/))
  // - if dots allowed or not possible: /
  // - if dots possible and not allowed: /(?!\.)
  // end is:
  // - if last pattern, same as part-matching mode
  // - else nothing
  //
  // Always put the (?:$|/) on negated tails, though, because that has to be
  // there to bind the end of the negated pattern portion, and it's easier to
  // just stick it in now rather than try to inject it later in the middle of
  // the pattern.
  //
  // We can just always return the same end, and leave it up to the caller
  // to know whether it's going to be used joined or in parts.
  // And, if the start is adjusted slightly, can do the same there:
  // - if not isStart: nothing
  // - if traversal possible, but not allowed: (?:/|^)(?!\.\.?$)
  // - if dots allowed or not possible: (?:/|^)
  // - if dots possible and not allowed: (?:/|^)(?!\.)
  //
  // But it's better to have a simpler binding without a conditional, for
  // performance, so probably better to return both start options.
  //
  // Then the caller just ignores the end if it's not the first pattern,
  // and the start always gets applied.
  //
  // But that's always going to be $ if it's the ending pattern, or nothing,
  // so the caller can just attach $ at the end of the pattern when building.
  //
  // So the todo is:
  // - better detect what kind of start is needed
  // - return both flavors of starting pattern
  // - attach $ at the end of the pattern when creating the actual RegExp
  //
  // Ah, but wait, no, that all only applies to the root when the first pattern
  // is not an extglob. If the first pattern IS an extglob, then we need all
  // that dot prevention biz to live in the extglob portions, because eg
  // +(*|.x*) can match .xy but not .yx.
  //
  // So, return the two flavors if it's #root and the first child is not an
  // AST, otherwise leave it to the child AST to handle it, and there,
  // use the (?:^|/) style of start binding.
  //
  // Even simplified further:
  // - Since the start for a join is eg /(?!\.) and the start for a part
  // is ^(?!\.), we can just prepend (?!\.) to the pattern (either root
  // or start or whatever) and prepend ^ or / at the Regexp construction.
  toRegExpSource(allowDot) {
    const dot = allowDot ?? !!this.#options.dot;
    if (this.#root === this) {
      this.#flatten();
      this.#fillNegs();
    }
    if (!isExtglobAST(this)) {
      const noEmpty = this.isStart() && this.isEnd() && !this.#parts.some((s) => typeof s !== "string");
      const src = this.#parts.map((p) => {
        const [re, _, hasMagic, uflag] = typeof p === "string" ? _a.#parseGlob(p, this.#hasMagic, noEmpty) : p.toRegExpSource(allowDot);
        this.#hasMagic = this.#hasMagic || hasMagic;
        this.#uflag = this.#uflag || uflag;
        return re;
      }).join("");
      let start2 = "";
      if (this.isStart()) {
        if (typeof this.#parts[0] === "string") {
          const dotTravAllowed = this.#parts.length === 1 && justDots.has(this.#parts[0]);
          if (!dotTravAllowed) {
            const aps = addPatternStart;
            const needNoTrav = (
              // dots are allowed, and the pattern starts with [ or .
              dot && aps.has(src.charAt(0)) || // the pattern starts with \., and then [ or .
              src.startsWith("\\.") && aps.has(src.charAt(2)) || // the pattern starts with \.\., and then [ or .
              src.startsWith("\\.\\.") && aps.has(src.charAt(4))
            );
            const needNoDot = !dot && !allowDot && aps.has(src.charAt(0));
            start2 = needNoTrav ? startNoTraversal : needNoDot ? startNoDot : "";
          }
        }
      }
      let end = "";
      if (this.isEnd() && this.#root.#filledNegs && this.#parent?.type === "!") {
        end = "(?:$|\\/)";
      }
      const final2 = start2 + src + end;
      return [
        final2,
        unescape(src),
        this.#hasMagic = !!this.#hasMagic,
        this.#uflag
      ];
    }
    const repeated = this.type === "*" || this.type === "+";
    const start = this.type === "!" ? "(?:(?!(?:" : "(?:";
    let body = this.#partsToRegExp(dot);
    if (this.isStart() && this.isEnd() && !body && this.type !== "!") {
      const s = this.toString();
      const me = this;
      me.#parts = [s];
      me.type = null;
      me.#hasMagic = void 0;
      return [s, unescape(this.toString()), false, false];
    }
    let bodyDotAllowed = !repeated || allowDot || dot || !startNoDot ? "" : this.#partsToRegExp(true);
    if (bodyDotAllowed === body) {
      bodyDotAllowed = "";
    }
    if (bodyDotAllowed) {
      body = `(?:${body})(?:${bodyDotAllowed})*?`;
    }
    let final = "";
    if (this.type === "!" && this.#emptyExt) {
      final = (this.isStart() && !dot ? startNoDot : "") + starNoEmpty;
    } else {
      const close = this.type === "!" ? (
        // !() must match something,but !(x) can match ''
        "))" + (this.isStart() && !dot && !allowDot ? startNoDot : "") + star + ")"
      ) : this.type === "@" ? ")" : this.type === "?" ? ")?" : this.type === "+" && bodyDotAllowed ? ")" : this.type === "*" && bodyDotAllowed ? `)?` : `)${this.type}`;
      final = start + body + close;
    }
    return [
      final,
      unescape(body),
      this.#hasMagic = !!this.#hasMagic,
      this.#uflag
    ];
  }
  #flatten() {
    if (!isExtglobAST(this)) {
      for (const p of this.#parts) {
        if (typeof p === "object") {
          p.#flatten();
        }
      }
    } else {
      let iterations = 0;
      let done = false;
      do {
        done = true;
        for (let i = 0; i < this.#parts.length; i++) {
          const c = this.#parts[i];
          if (typeof c === "object") {
            c.#flatten();
            if (this.#canAdopt(c)) {
              done = false;
              this.#adopt(c, i);
            } else if (this.#canAdoptWithSpace(c)) {
              done = false;
              this.#adoptWithSpace(c, i);
            } else if (this.#canUsurp(c)) {
              done = false;
              this.#usurp(c);
            }
          }
        }
      } while (!done && ++iterations < 10);
    }
    this.#toString = void 0;
  }
  #partsToRegExp(dot) {
    return this.#parts.map((p) => {
      if (typeof p === "string") {
        throw new Error("string type in extglob ast??");
      }
      const [re, _, _hasMagic, uflag] = p.toRegExpSource(dot);
      this.#uflag = this.#uflag || uflag;
      return re;
    }).filter((p) => !(this.isStart() && this.isEnd()) || !!p).join("|");
  }
  static #parseGlob(glob, hasMagic, noEmpty = false) {
    let escaping = false;
    let re = "";
    let uflag = false;
    let inStar = false;
    for (let i = 0; i < glob.length; i++) {
      const c = glob.charAt(i);
      if (escaping) {
        escaping = false;
        re += (reSpecials.has(c) ? "\\" : "") + c;
        continue;
      }
      if (c === "*") {
        if (inStar)
          continue;
        inStar = true;
        re += noEmpty && /^[*]+$/.test(glob) ? starNoEmpty : star;
        hasMagic = true;
        continue;
      } else {
        inStar = false;
      }
      if (c === "\\") {
        if (i === glob.length - 1) {
          re += "\\\\";
        } else {
          escaping = true;
        }
        continue;
      }
      if (c === "[") {
        const [src, needUflag, consumed, magic] = parseClass(glob, i);
        if (consumed) {
          re += src;
          uflag = uflag || needUflag;
          i += consumed - 1;
          hasMagic = hasMagic || magic;
          continue;
        }
      }
      if (c === "?") {
        re += qmark;
        hasMagic = true;
        continue;
      }
      re += regExpEscape(c);
    }
    return [re, unescape(glob), !!hasMagic, uflag];
  }
};
_a = AST;

// node_modules/.pnpm/minimatch@10.2.5/node_modules/minimatch/dist/esm/escape.js
var escape = (s, { windowsPathsNoEscape = false, magicalBraces = false } = {}) => {
  if (magicalBraces) {
    return windowsPathsNoEscape ? s.replace(/[?*()[\]{}]/g, "[$&]") : s.replace(/[?*()[\]\\{}]/g, "\\$&");
  }
  return windowsPathsNoEscape ? s.replace(/[?*()[\]]/g, "[$&]") : s.replace(/[?*()[\]\\]/g, "\\$&");
};

// node_modules/.pnpm/minimatch@10.2.5/node_modules/minimatch/dist/esm/index.js
var minimatch = (p, pattern, options = {}) => {
  assertValidPattern(pattern);
  if (!options.nocomment && pattern.charAt(0) === "#") {
    return false;
  }
  return new Minimatch(pattern, options).match(p);
};
var starDotExtRE = /^\*+([^+@!?*[(]*)$/;
var starDotExtTest = (ext2) => (f) => !f.startsWith(".") && f.endsWith(ext2);
var starDotExtTestDot = (ext2) => (f) => f.endsWith(ext2);
var starDotExtTestNocase = (ext2) => {
  ext2 = ext2.toLowerCase();
  return (f) => !f.startsWith(".") && f.toLowerCase().endsWith(ext2);
};
var starDotExtTestNocaseDot = (ext2) => {
  ext2 = ext2.toLowerCase();
  return (f) => f.toLowerCase().endsWith(ext2);
};
var starDotStarRE = /^\*+\.\*+$/;
var starDotStarTest = (f) => !f.startsWith(".") && f.includes(".");
var starDotStarTestDot = (f) => f !== "." && f !== ".." && f.includes(".");
var dotStarRE = /^\.\*+$/;
var dotStarTest = (f) => f !== "." && f !== ".." && f.startsWith(".");
var starRE = /^\*+$/;
var starTest = (f) => f.length !== 0 && !f.startsWith(".");
var starTestDot = (f) => f.length !== 0 && f !== "." && f !== "..";
var qmarksRE = /^\?+([^+@!?*[(]*)?$/;
var qmarksTestNocase = ([$0, ext2 = ""]) => {
  const noext = qmarksTestNoExt([$0]);
  if (!ext2)
    return noext;
  ext2 = ext2.toLowerCase();
  return (f) => noext(f) && f.toLowerCase().endsWith(ext2);
};
var qmarksTestNocaseDot = ([$0, ext2 = ""]) => {
  const noext = qmarksTestNoExtDot([$0]);
  if (!ext2)
    return noext;
  ext2 = ext2.toLowerCase();
  return (f) => noext(f) && f.toLowerCase().endsWith(ext2);
};
var qmarksTestDot = ([$0, ext2 = ""]) => {
  const noext = qmarksTestNoExtDot([$0]);
  return !ext2 ? noext : (f) => noext(f) && f.endsWith(ext2);
};
var qmarksTest = ([$0, ext2 = ""]) => {
  const noext = qmarksTestNoExt([$0]);
  return !ext2 ? noext : (f) => noext(f) && f.endsWith(ext2);
};
var qmarksTestNoExt = ([$0]) => {
  const len = $0.length;
  return (f) => f.length === len && !f.startsWith(".");
};
var qmarksTestNoExtDot = ([$0]) => {
  const len = $0.length;
  return (f) => f.length === len && f !== "." && f !== "..";
};
var defaultPlatform = typeof process === "object" && process ? typeof process.env === "object" && process.env && process.env.__MINIMATCH_TESTING_PLATFORM__ || process.platform : "posix";
var path5 = {
  win32: { sep: "\\" },
  posix: { sep: "/" }
};
var sep = defaultPlatform === "win32" ? path5.win32.sep : path5.posix.sep;
minimatch.sep = sep;
var GLOBSTAR = Symbol("globstar **");
minimatch.GLOBSTAR = GLOBSTAR;
var qmark2 = "[^/]";
var star2 = qmark2 + "*?";
var twoStarDot = "(?:(?!(?:\\/|^)(?:\\.{1,2})($|\\/)).)*?";
var twoStarNoDot = "(?:(?!(?:\\/|^)\\.).)*?";
var filter = (pattern, options = {}) => (p) => minimatch(p, pattern, options);
minimatch.filter = filter;
var ext = (a, b = {}) => Object.assign({}, a, b);
var defaults = (def) => {
  if (!def || typeof def !== "object" || !Object.keys(def).length) {
    return minimatch;
  }
  const orig = minimatch;
  const m = (p, pattern, options = {}) => orig(p, pattern, ext(def, options));
  return Object.assign(m, {
    Minimatch: class Minimatch extends orig.Minimatch {
      constructor(pattern, options = {}) {
        super(pattern, ext(def, options));
      }
      static defaults(options) {
        return orig.defaults(ext(def, options)).Minimatch;
      }
    },
    AST: class AST extends orig.AST {
      /* c8 ignore start */
      constructor(type, parent, options = {}) {
        super(type, parent, ext(def, options));
      }
      /* c8 ignore stop */
      static fromGlob(pattern, options = {}) {
        return orig.AST.fromGlob(pattern, ext(def, options));
      }
    },
    unescape: (s, options = {}) => orig.unescape(s, ext(def, options)),
    escape: (s, options = {}) => orig.escape(s, ext(def, options)),
    filter: (pattern, options = {}) => orig.filter(pattern, ext(def, options)),
    defaults: (options) => orig.defaults(ext(def, options)),
    makeRe: (pattern, options = {}) => orig.makeRe(pattern, ext(def, options)),
    braceExpand: (pattern, options = {}) => orig.braceExpand(pattern, ext(def, options)),
    match: (list, pattern, options = {}) => orig.match(list, pattern, ext(def, options)),
    sep: orig.sep,
    GLOBSTAR
  });
};
minimatch.defaults = defaults;
var braceExpand = (pattern, options = {}) => {
  assertValidPattern(pattern);
  if (options.nobrace || !/\{(?:(?!\{).)*\}/.test(pattern)) {
    return [pattern];
  }
  return expand(pattern, { max: options.braceExpandMax });
};
minimatch.braceExpand = braceExpand;
var makeRe = (pattern, options = {}) => new Minimatch(pattern, options).makeRe();
minimatch.makeRe = makeRe;
var match = (list, pattern, options = {}) => {
  const mm = new Minimatch(pattern, options);
  list = list.filter((f) => mm.match(f));
  if (mm.options.nonull && !list.length) {
    list.push(pattern);
  }
  return list;
};
minimatch.match = match;
var globMagic = /[?*]|[+@!]\(.*?\)|\[|\]/;
var regExpEscape2 = (s) => s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
var Minimatch = class {
  options;
  set;
  pattern;
  windowsPathsNoEscape;
  nonegate;
  negate;
  comment;
  empty;
  preserveMultipleSlashes;
  partial;
  globSet;
  globParts;
  nocase;
  isWindows;
  platform;
  windowsNoMagicRoot;
  maxGlobstarRecursion;
  regexp;
  constructor(pattern, options = {}) {
    assertValidPattern(pattern);
    options = options || {};
    this.options = options;
    this.maxGlobstarRecursion = options.maxGlobstarRecursion ?? 200;
    this.pattern = pattern;
    this.platform = options.platform || defaultPlatform;
    this.isWindows = this.platform === "win32";
    const awe = "allowWindowsEscape";
    this.windowsPathsNoEscape = !!options.windowsPathsNoEscape || options[awe] === false;
    if (this.windowsPathsNoEscape) {
      this.pattern = this.pattern.replace(/\\/g, "/");
    }
    this.preserveMultipleSlashes = !!options.preserveMultipleSlashes;
    this.regexp = null;
    this.negate = false;
    this.nonegate = !!options.nonegate;
    this.comment = false;
    this.empty = false;
    this.partial = !!options.partial;
    this.nocase = !!this.options.nocase;
    this.windowsNoMagicRoot = options.windowsNoMagicRoot !== void 0 ? options.windowsNoMagicRoot : !!(this.isWindows && this.nocase);
    this.globSet = [];
    this.globParts = [];
    this.set = [];
    this.make();
  }
  hasMagic() {
    if (this.options.magicalBraces && this.set.length > 1) {
      return true;
    }
    for (const pattern of this.set) {
      for (const part of pattern) {
        if (typeof part !== "string")
          return true;
      }
    }
    return false;
  }
  debug(..._) {
  }
  make() {
    const pattern = this.pattern;
    const options = this.options;
    if (!options.nocomment && pattern.charAt(0) === "#") {
      this.comment = true;
      return;
    }
    if (!pattern) {
      this.empty = true;
      return;
    }
    this.parseNegate();
    this.globSet = [...new Set(this.braceExpand())];
    if (options.debug) {
      this.debug = (...args) => console.error(...args);
    }
    this.debug(this.pattern, this.globSet);
    const rawGlobParts = this.globSet.map((s) => this.slashSplit(s));
    this.globParts = this.preprocess(rawGlobParts);
    this.debug(this.pattern, this.globParts);
    let set = this.globParts.map((s, _, __) => {
      if (this.isWindows && this.windowsNoMagicRoot) {
        const isUNC = s[0] === "" && s[1] === "" && (s[2] === "?" || !globMagic.test(s[2])) && !globMagic.test(s[3]);
        const isDrive = /^[a-z]:/i.test(s[0]);
        if (isUNC) {
          return [
            ...s.slice(0, 4),
            ...s.slice(4).map((ss) => this.parse(ss))
          ];
        } else if (isDrive) {
          return [s[0], ...s.slice(1).map((ss) => this.parse(ss))];
        }
      }
      return s.map((ss) => this.parse(ss));
    });
    this.debug(this.pattern, set);
    this.set = set.filter((s) => s.indexOf(false) === -1);
    if (this.isWindows) {
      for (let i = 0; i < this.set.length; i++) {
        const p = this.set[i];
        if (p[0] === "" && p[1] === "" && this.globParts[i][2] === "?" && typeof p[3] === "string" && /^[a-z]:$/i.test(p[3])) {
          p[2] = "?";
        }
      }
    }
    this.debug(this.pattern, this.set);
  }
  // various transforms to equivalent pattern sets that are
  // faster to process in a filesystem walk.  The goal is to
  // eliminate what we can, and push all ** patterns as far
  // to the right as possible, even if it increases the number
  // of patterns that we have to process.
  preprocess(globParts) {
    if (this.options.noglobstar) {
      for (const partset of globParts) {
        for (let j = 0; j < partset.length; j++) {
          if (partset[j] === "**") {
            partset[j] = "*";
          }
        }
      }
    }
    const { optimizationLevel = 1 } = this.options;
    if (optimizationLevel >= 2) {
      globParts = this.firstPhasePreProcess(globParts);
      globParts = this.secondPhasePreProcess(globParts);
    } else if (optimizationLevel >= 1) {
      globParts = this.levelOneOptimize(globParts);
    } else {
      globParts = this.adjascentGlobstarOptimize(globParts);
    }
    return globParts;
  }
  // just get rid of adjascent ** portions
  adjascentGlobstarOptimize(globParts) {
    return globParts.map((parts) => {
      let gs = -1;
      while (-1 !== (gs = parts.indexOf("**", gs + 1))) {
        let i = gs;
        while (parts[i + 1] === "**") {
          i++;
        }
        if (i !== gs) {
          parts.splice(gs, i - gs);
        }
      }
      return parts;
    });
  }
  // get rid of adjascent ** and resolve .. portions
  levelOneOptimize(globParts) {
    return globParts.map((parts) => {
      parts = parts.reduce((set, part) => {
        const prev = set[set.length - 1];
        if (part === "**" && prev === "**") {
          return set;
        }
        if (part === "..") {
          if (prev && prev !== ".." && prev !== "." && prev !== "**") {
            set.pop();
            return set;
          }
        }
        set.push(part);
        return set;
      }, []);
      return parts.length === 0 ? [""] : parts;
    });
  }
  levelTwoFileOptimize(parts) {
    if (!Array.isArray(parts)) {
      parts = this.slashSplit(parts);
    }
    let didSomething = false;
    do {
      didSomething = false;
      if (!this.preserveMultipleSlashes) {
        for (let i = 1; i < parts.length - 1; i++) {
          const p = parts[i];
          if (i === 1 && p === "" && parts[0] === "")
            continue;
          if (p === "." || p === "") {
            didSomething = true;
            parts.splice(i, 1);
            i--;
          }
        }
        if (parts[0] === "." && parts.length === 2 && (parts[1] === "." || parts[1] === "")) {
          didSomething = true;
          parts.pop();
        }
      }
      let dd = 0;
      while (-1 !== (dd = parts.indexOf("..", dd + 1))) {
        const p = parts[dd - 1];
        if (p && p !== "." && p !== ".." && p !== "**" && !(this.isWindows && /^[a-z]:$/i.test(p))) {
          didSomething = true;
          parts.splice(dd - 1, 2);
          dd -= 2;
        }
      }
    } while (didSomething);
    return parts.length === 0 ? [""] : parts;
  }
  // First phase: single-pattern processing
  // <pre> is 1 or more portions
  // <rest> is 1 or more portions
  // <p> is any portion other than ., .., '', or **
  // <e> is . or ''
  //
  // **/.. is *brutal* for filesystem walking performance, because
  // it effectively resets the recursive walk each time it occurs,
  // and ** cannot be reduced out by a .. pattern part like a regexp
  // or most strings (other than .., ., and '') can be.
  //
  // <pre>/**/../<p>/<p>/<rest> -> {<pre>/../<p>/<p>/<rest>,<pre>/**/<p>/<p>/<rest>}
  // <pre>/<e>/<rest> -> <pre>/<rest>
  // <pre>/<p>/../<rest> -> <pre>/<rest>
  // **/**/<rest> -> **/<rest>
  //
  // **/*/<rest> -> */**/<rest> <== not valid because ** doesn't follow
  // this WOULD be allowed if ** did follow symlinks, or * didn't
  firstPhasePreProcess(globParts) {
    let didSomething = false;
    do {
      didSomething = false;
      for (let parts of globParts) {
        let gs = -1;
        while (-1 !== (gs = parts.indexOf("**", gs + 1))) {
          let gss = gs;
          while (parts[gss + 1] === "**") {
            gss++;
          }
          if (gss > gs) {
            parts.splice(gs + 1, gss - gs);
          }
          let next = parts[gs + 1];
          const p = parts[gs + 2];
          const p2 = parts[gs + 3];
          if (next !== "..")
            continue;
          if (!p || p === "." || p === ".." || !p2 || p2 === "." || p2 === "..") {
            continue;
          }
          didSomething = true;
          parts.splice(gs, 1);
          const other = parts.slice(0);
          other[gs] = "**";
          globParts.push(other);
          gs--;
        }
        if (!this.preserveMultipleSlashes) {
          for (let i = 1; i < parts.length - 1; i++) {
            const p = parts[i];
            if (i === 1 && p === "" && parts[0] === "")
              continue;
            if (p === "." || p === "") {
              didSomething = true;
              parts.splice(i, 1);
              i--;
            }
          }
          if (parts[0] === "." && parts.length === 2 && (parts[1] === "." || parts[1] === "")) {
            didSomething = true;
            parts.pop();
          }
        }
        let dd = 0;
        while (-1 !== (dd = parts.indexOf("..", dd + 1))) {
          const p = parts[dd - 1];
          if (p && p !== "." && p !== ".." && p !== "**") {
            didSomething = true;
            const needDot = dd === 1 && parts[dd + 1] === "**";
            const splin = needDot ? ["."] : [];
            parts.splice(dd - 1, 2, ...splin);
            if (parts.length === 0)
              parts.push("");
            dd -= 2;
          }
        }
      }
    } while (didSomething);
    return globParts;
  }
  // second phase: multi-pattern dedupes
  // {<pre>/*/<rest>,<pre>/<p>/<rest>} -> <pre>/*/<rest>
  // {<pre>/<rest>,<pre>/<rest>} -> <pre>/<rest>
  // {<pre>/**/<rest>,<pre>/<rest>} -> <pre>/**/<rest>
  //
  // {<pre>/**/<rest>,<pre>/**/<p>/<rest>} -> <pre>/**/<rest>
  // ^-- not valid because ** doens't follow symlinks
  secondPhasePreProcess(globParts) {
    for (let i = 0; i < globParts.length - 1; i++) {
      for (let j = i + 1; j < globParts.length; j++) {
        const matched = this.partsMatch(globParts[i], globParts[j], !this.preserveMultipleSlashes);
        if (matched) {
          globParts[i] = [];
          globParts[j] = matched;
          break;
        }
      }
    }
    return globParts.filter((gs) => gs.length);
  }
  partsMatch(a, b, emptyGSMatch = false) {
    let ai = 0;
    let bi = 0;
    let result = [];
    let which = "";
    while (ai < a.length && bi < b.length) {
      if (a[ai] === b[bi]) {
        result.push(which === "b" ? b[bi] : a[ai]);
        ai++;
        bi++;
      } else if (emptyGSMatch && a[ai] === "**" && b[bi] === a[ai + 1]) {
        result.push(a[ai]);
        ai++;
      } else if (emptyGSMatch && b[bi] === "**" && a[ai] === b[bi + 1]) {
        result.push(b[bi]);
        bi++;
      } else if (a[ai] === "*" && b[bi] && (this.options.dot || !b[bi].startsWith(".")) && b[bi] !== "**") {
        if (which === "b")
          return false;
        which = "a";
        result.push(a[ai]);
        ai++;
        bi++;
      } else if (b[bi] === "*" && a[ai] && (this.options.dot || !a[ai].startsWith(".")) && a[ai] !== "**") {
        if (which === "a")
          return false;
        which = "b";
        result.push(b[bi]);
        ai++;
        bi++;
      } else {
        return false;
      }
    }
    return a.length === b.length && result;
  }
  parseNegate() {
    if (this.nonegate)
      return;
    const pattern = this.pattern;
    let negate = false;
    let negateOffset = 0;
    for (let i = 0; i < pattern.length && pattern.charAt(i) === "!"; i++) {
      negate = !negate;
      negateOffset++;
    }
    if (negateOffset)
      this.pattern = pattern.slice(negateOffset);
    this.negate = negate;
  }
  // set partial to true to test if, for example,
  // "/a/b" matches the start of "/*/b/*/d"
  // Partial means, if you run out of file before you run
  // out of pattern, then that's fine, as long as all
  // the parts match.
  matchOne(file, pattern, partial = false) {
    let fileStartIndex = 0;
    let patternStartIndex = 0;
    if (this.isWindows) {
      const fileDrive = typeof file[0] === "string" && /^[a-z]:$/i.test(file[0]);
      const fileUNC = !fileDrive && file[0] === "" && file[1] === "" && file[2] === "?" && /^[a-z]:$/i.test(file[3]);
      const patternDrive = typeof pattern[0] === "string" && /^[a-z]:$/i.test(pattern[0]);
      const patternUNC = !patternDrive && pattern[0] === "" && pattern[1] === "" && pattern[2] === "?" && typeof pattern[3] === "string" && /^[a-z]:$/i.test(pattern[3]);
      const fdi = fileUNC ? 3 : fileDrive ? 0 : void 0;
      const pdi = patternUNC ? 3 : patternDrive ? 0 : void 0;
      if (typeof fdi === "number" && typeof pdi === "number") {
        const [fd, pd] = [
          file[fdi],
          pattern[pdi]
        ];
        if (fd.toLowerCase() === pd.toLowerCase()) {
          pattern[pdi] = fd;
          patternStartIndex = pdi;
          fileStartIndex = fdi;
        }
      }
    }
    const { optimizationLevel = 1 } = this.options;
    if (optimizationLevel >= 2) {
      file = this.levelTwoFileOptimize(file);
    }
    if (pattern.includes(GLOBSTAR)) {
      return this.#matchGlobstar(file, pattern, partial, fileStartIndex, patternStartIndex);
    }
    return this.#matchOne(file, pattern, partial, fileStartIndex, patternStartIndex);
  }
  #matchGlobstar(file, pattern, partial, fileIndex, patternIndex) {
    const firstgs = pattern.indexOf(GLOBSTAR, patternIndex);
    const lastgs = pattern.lastIndexOf(GLOBSTAR);
    const [head, body, tail] = partial ? [
      pattern.slice(patternIndex, firstgs),
      pattern.slice(firstgs + 1),
      []
    ] : [
      pattern.slice(patternIndex, firstgs),
      pattern.slice(firstgs + 1, lastgs),
      pattern.slice(lastgs + 1)
    ];
    if (head.length) {
      const fileHead = file.slice(fileIndex, fileIndex + head.length);
      if (!this.#matchOne(fileHead, head, partial, 0, 0)) {
        return false;
      }
      fileIndex += head.length;
      patternIndex += head.length;
    }
    let fileTailMatch = 0;
    if (tail.length) {
      if (tail.length + fileIndex > file.length)
        return false;
      let tailStart = file.length - tail.length;
      if (this.#matchOne(file, tail, partial, tailStart, 0)) {
        fileTailMatch = tail.length;
      } else {
        if (file[file.length - 1] !== "" || fileIndex + tail.length === file.length) {
          return false;
        }
        tailStart--;
        if (!this.#matchOne(file, tail, partial, tailStart, 0)) {
          return false;
        }
        fileTailMatch = tail.length + 1;
      }
    }
    if (!body.length) {
      let sawSome = !!fileTailMatch;
      for (let i2 = fileIndex; i2 < file.length - fileTailMatch; i2++) {
        const f = String(file[i2]);
        sawSome = true;
        if (f === "." || f === ".." || !this.options.dot && f.startsWith(".")) {
          return false;
        }
      }
      return partial || sawSome;
    }
    const bodySegments = [[[], 0]];
    let currentBody = bodySegments[0];
    let nonGsParts = 0;
    const nonGsPartsSums = [0];
    for (const b of body) {
      if (b === GLOBSTAR) {
        nonGsPartsSums.push(nonGsParts);
        currentBody = [[], 0];
        bodySegments.push(currentBody);
      } else {
        currentBody[0].push(b);
        nonGsParts++;
      }
    }
    let i = bodySegments.length - 1;
    const fileLength = file.length - fileTailMatch;
    for (const b of bodySegments) {
      b[1] = fileLength - (nonGsPartsSums[i--] + b[0].length);
    }
    return !!this.#matchGlobStarBodySections(file, bodySegments, fileIndex, 0, partial, 0, !!fileTailMatch);
  }
  // return false for "nope, not matching"
  // return null for "not matching, cannot keep trying"
  #matchGlobStarBodySections(file, bodySegments, fileIndex, bodyIndex, partial, globStarDepth, sawTail) {
    const bs = bodySegments[bodyIndex];
    if (!bs) {
      for (let i = fileIndex; i < file.length; i++) {
        sawTail = true;
        const f = file[i];
        if (f === "." || f === ".." || !this.options.dot && f.startsWith(".")) {
          return false;
        }
      }
      return sawTail;
    }
    const [body, after] = bs;
    while (fileIndex <= after) {
      const m = this.#matchOne(file.slice(0, fileIndex + body.length), body, partial, fileIndex, 0);
      if (m && globStarDepth < this.maxGlobstarRecursion) {
        const sub = this.#matchGlobStarBodySections(file, bodySegments, fileIndex + body.length, bodyIndex + 1, partial, globStarDepth + 1, sawTail);
        if (sub !== false) {
          return sub;
        }
      }
      const f = file[fileIndex];
      if (f === "." || f === ".." || !this.options.dot && f.startsWith(".")) {
        return false;
      }
      fileIndex++;
    }
    return partial || null;
  }
  #matchOne(file, pattern, partial, fileIndex, patternIndex) {
    let fi;
    let pi;
    let pl;
    let fl;
    for (fi = fileIndex, pi = patternIndex, fl = file.length, pl = pattern.length; fi < fl && pi < pl; fi++, pi++) {
      this.debug("matchOne loop");
      let p = pattern[pi];
      let f = file[fi];
      this.debug(pattern, p, f);
      if (p === false || p === GLOBSTAR) {
        return false;
      }
      let hit;
      if (typeof p === "string") {
        hit = f === p;
        this.debug("string match", p, f, hit);
      } else {
        hit = p.test(f);
        this.debug("pattern match", p, f, hit);
      }
      if (!hit)
        return false;
    }
    if (fi === fl && pi === pl) {
      return true;
    } else if (fi === fl) {
      return partial;
    } else if (pi === pl) {
      return fi === fl - 1 && file[fi] === "";
    } else {
      throw new Error("wtf?");
    }
  }
  braceExpand() {
    return braceExpand(this.pattern, this.options);
  }
  parse(pattern) {
    assertValidPattern(pattern);
    const options = this.options;
    if (pattern === "**")
      return GLOBSTAR;
    if (pattern === "")
      return "";
    let m;
    let fastTest = null;
    if (m = pattern.match(starRE)) {
      fastTest = options.dot ? starTestDot : starTest;
    } else if (m = pattern.match(starDotExtRE)) {
      fastTest = (options.nocase ? options.dot ? starDotExtTestNocaseDot : starDotExtTestNocase : options.dot ? starDotExtTestDot : starDotExtTest)(m[1]);
    } else if (m = pattern.match(qmarksRE)) {
      fastTest = (options.nocase ? options.dot ? qmarksTestNocaseDot : qmarksTestNocase : options.dot ? qmarksTestDot : qmarksTest)(m);
    } else if (m = pattern.match(starDotStarRE)) {
      fastTest = options.dot ? starDotStarTestDot : starDotStarTest;
    } else if (m = pattern.match(dotStarRE)) {
      fastTest = dotStarTest;
    }
    const re = AST.fromGlob(pattern, this.options).toMMPattern();
    if (fastTest && typeof re === "object") {
      Reflect.defineProperty(re, "test", { value: fastTest });
    }
    return re;
  }
  makeRe() {
    if (this.regexp || this.regexp === false)
      return this.regexp;
    const set = this.set;
    if (!set.length) {
      this.regexp = false;
      return this.regexp;
    }
    const options = this.options;
    const twoStar = options.noglobstar ? star2 : options.dot ? twoStarDot : twoStarNoDot;
    const flags = new Set(options.nocase ? ["i"] : []);
    let re = set.map((pattern) => {
      const pp = pattern.map((p) => {
        if (p instanceof RegExp) {
          for (const f of p.flags.split(""))
            flags.add(f);
        }
        return typeof p === "string" ? regExpEscape2(p) : p === GLOBSTAR ? GLOBSTAR : p._src;
      });
      pp.forEach((p, i) => {
        const next = pp[i + 1];
        const prev = pp[i - 1];
        if (p !== GLOBSTAR || prev === GLOBSTAR) {
          return;
        }
        if (prev === void 0) {
          if (next !== void 0 && next !== GLOBSTAR) {
            pp[i + 1] = "(?:\\/|" + twoStar + "\\/)?" + next;
          } else {
            pp[i] = twoStar;
          }
        } else if (next === void 0) {
          pp[i - 1] = prev + "(?:\\/|\\/" + twoStar + ")?";
        } else if (next !== GLOBSTAR) {
          pp[i - 1] = prev + "(?:\\/|\\/" + twoStar + "\\/)" + next;
          pp[i + 1] = GLOBSTAR;
        }
      });
      const filtered = pp.filter((p) => p !== GLOBSTAR);
      if (this.partial && filtered.length >= 1) {
        const prefixes = [];
        for (let i = 1; i <= filtered.length; i++) {
          prefixes.push(filtered.slice(0, i).join("/"));
        }
        return "(?:" + prefixes.join("|") + ")";
      }
      return filtered.join("/");
    }).join("|");
    const [open, close] = set.length > 1 ? ["(?:", ")"] : ["", ""];
    re = "^" + open + re + close + "$";
    if (this.partial) {
      re = "^(?:\\/|" + open + re.slice(1, -1) + close + ")$";
    }
    if (this.negate)
      re = "^(?!" + re + ").+$";
    try {
      this.regexp = new RegExp(re, [...flags].join(""));
    } catch {
      this.regexp = false;
    }
    return this.regexp;
  }
  slashSplit(p) {
    if (this.preserveMultipleSlashes) {
      return p.split("/");
    } else if (this.isWindows && /^\/\/[^/]+/.test(p)) {
      return ["", ...p.split(/\/+/)];
    } else {
      return p.split(/\/+/);
    }
  }
  match(f, partial = this.partial) {
    this.debug("match", f, this.pattern);
    if (this.comment) {
      return false;
    }
    if (this.empty) {
      return f === "";
    }
    if (f === "/" && partial) {
      return true;
    }
    const options = this.options;
    if (this.isWindows) {
      f = f.split("\\").join("/");
    }
    const ff = this.slashSplit(f);
    this.debug(this.pattern, "split", ff);
    const set = this.set;
    this.debug(this.pattern, "set", set);
    let filename = ff[ff.length - 1];
    if (!filename) {
      for (let i = ff.length - 2; !filename && i >= 0; i--) {
        filename = ff[i];
      }
    }
    for (const pattern of set) {
      let file = ff;
      if (options.matchBase && pattern.length === 1) {
        file = [filename];
      }
      const hit = this.matchOne(file, pattern, partial);
      if (hit) {
        if (options.flipNegate) {
          return true;
        }
        return !this.negate;
      }
    }
    if (options.flipNegate) {
      return false;
    }
    return this.negate;
  }
  static defaults(def) {
    return minimatch.defaults(def).Minimatch;
  }
};
minimatch.AST = AST;
minimatch.Minimatch = Minimatch;
minimatch.escape = escape;
minimatch.unescape = unescape;

// src/core/skill-dir.ts
import { homedir } from "node:os";
import path6 from "node:path";
var SKILL_DIR_MARKER = "<skill-dir>";
var expandSkillDirMarkers = (content, skillDir) => content.replaceAll(SKILL_DIR_MARKER, skillDir);
var resolveReadPath = (requestedPath, cwd) => {
  const withoutAtPrefix = requestedPath.startsWith("@") ? requestedPath.slice(1) : requestedPath;
  const expandedHome = withoutAtPrefix === "~" ? homedir() : /^~[\\/]/.test(withoutAtPrefix) ? path6.join(homedir(), withoutAtPrefix.slice(2)) : withoutAtPrefix;
  return path6.resolve(cwd, expandedHome);
};
var expandSkillDirMarkersForRead = (content, args, cwd) => {
  if (!content.includes(SKILL_DIR_MARKER) || typeof args.path !== "string") {
    return content;
  }
  const requestedPath = resolveReadPath(args.path, cwd);
  if (path6.basename(requestedPath) !== "SKILL.md") return content;
  return expandSkillDirMarkers(content, path6.dirname(requestedPath));
};

// src/providers/project-root-guard.ts
import fs from "node:fs";
import { homedir as homedir2 } from "node:os";
import path7 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var UNICODE_SPACES = /[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g;
var isWithin = (root, candidate) => {
  const relative2 = path7.relative(root, candidate);
  return relative2 === "" || relative2 !== ".." && !relative2.startsWith(`..${path7.sep}`) && !path7.isAbsolute(relative2);
};
var normalizeToolPath = (input) => {
  let normalized = input.replace(UNICODE_SPACES, " ");
  if (normalized.startsWith("@")) normalized = normalized.slice(1);
  if (/^file:\/\//i.test(normalized)) normalized = fileURLToPath2(normalized);
  if (normalized === "~") return homedir2();
  if (normalized.startsWith("~/") || process.platform === "win32" && normalized.startsWith("~\\")) {
    return path7.join(homedir2(), normalized.slice(2));
  }
  return normalized;
};
var realpath = (value) => typeof fs.realpathSync.native === "function" ? fs.realpathSync.native(value) : fs.realpathSync(value);
var ProjectRootGuard = class {
  cwd;
  canonicalRoot;
  constructor(cwd) {
    this.cwd = path7.resolve(cwd);
    this.canonicalRoot = realpath(this.cwd);
  }
  assertPath(input, action) {
    if (typeof input !== "string" || input.length === 0) {
      throw new Error(`${action} requires a non-empty path inside the project root`);
    }
    let normalized;
    try {
      normalized = normalizeToolPath(input);
    } catch {
      throw new Error(`${action} received an invalid file URL or path: ${input}`);
    }
    const absolute = path7.isAbsolute(normalized) ? path7.resolve(normalized) : path7.resolve(this.cwd, normalized);
    let existing = absolute;
    for (; ; ) {
      try {
        const stat = fs.lstatSync(existing);
        if (stat.isSymbolicLink()) {
          try {
            realpath(existing);
          } catch {
            throw new Error(`${action} path uses a dangling symlink: ${input}`);
          }
        }
        break;
      } catch (error) {
        if (error instanceof Error && !(error.code === "ENOENT" || error.code === "ENOTDIR")) {
          throw error;
        }
        const parent = path7.dirname(existing);
        if (parent === existing) {
          throw new Error(`${action} path has no accessible project ancestor: ${input}`);
        }
        existing = parent;
      }
    }
    const canonicalAncestor = realpath(existing);
    if (!isWithin(this.canonicalRoot, canonicalAncestor)) {
      throw new Error(`${action} path escapes the project root through a symlink or junction: ${input}`);
    }
    try {
      const canonicalTarget2 = realpath(absolute);
      if (!isWithin(this.canonicalRoot, canonicalTarget2)) {
        throw new Error(`${action} path escapes the project root through a symlink or junction: ${input}`);
      }
      return canonicalTarget2;
    } catch (error) {
      const code = error.code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }
    const canonicalTarget = path7.resolve(canonicalAncestor, path7.relative(existing, absolute));
    if (!isWithin(this.canonicalRoot, canonicalTarget)) {
      throw new Error(`${action} path escapes the project root through a symlink or junction: ${input}`);
    }
    return canonicalTarget;
  }
};

// src/providers/write-diff-limits.ts
var configuredMaxBytes = Number.parseInt(
  process.env.CODE_PREVIEW_MAX_WRITE_DIFF_BYTES ?? "",
  10
);
var MAX_WRITE_DIFF_BYTES = Number.isFinite(configuredMaxBytes) && configuredMaxBytes > 0 ? configuredMaxBytes : 2e5;
var configuredMaxChangedLineCells = Number.parseInt(
  process.env.CODE_PREVIEW_MAX_WRITE_DIFF_CHANGED_LINE_CELLS ?? "",
  10
);
var MAX_WRITE_DIFF_CHANGED_LINE_CELLS = Number.isFinite(configuredMaxChangedLineCells) && configuredMaxChangedLineCells > 0 ? configuredMaxChangedLineCells : 1e6;
var writeContentForPreview = (content) => Buffer.byteLength(content, "utf8") <= MAX_WRITE_DIFF_BYTES ? content : void 0;

// src/kiro/tools-provider.ts
var TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];
var MAX_BYTES = 5e4;
var MAX_READ_LINES = 2e3;
var MAX_EDIT_CHARS = 2e6;
var MAX_WRITE_BYTES = 8 * 1024 * 1024;
var MAX_IMAGE_BYTES = 16 * 1024 * 1024;
var MAX_SEARCH_FILE_BYTES = 4 * 1024 * 1024;
var MAX_WALK_FILES = 1e5;
var MAX_WALK_DIRECTORIES = 2e4;
var MAX_WALK_DEPTH = 64;
var MAX_GITIGNORE_BYTES = 1024 * 1024;
var MAX_BASH_OUTPUT_BYTES = 64 * 1024 * 1024;
var MAX_BASH_COMMAND_BYTES = 256 * 1024;
var IMAGE_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp"
};
var schemas = {
  read: {
    description: "Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to 2000 lines or 50KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.",
    inputSchema: { type: "object", required: ["path"], properties: {
      path: { type: "string", description: "Path to the file to read (relative or absolute)" },
      offset: { type: "number", description: "Line number to start reading from (1-indexed)" },
      limit: { type: "number", description: "Maximum number of lines to read" }
    } }
  },
  bash: {
    description: "Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last 2000 lines or 50KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.",
    inputSchema: { type: "object", required: ["command"], properties: {
      command: { type: "string", description: "Bash command to execute" },
      timeout: { type: "number", description: "Timeout in seconds (optional, no default timeout)" }
    } }
  },
  edit: {
    description: "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
    inputSchema: { type: "object", required: ["path", "edits"], properties: {
      path: { type: "string", description: "Path to the file to edit (relative or absolute)" },
      edits: { type: "array", items: { type: "object", required: ["oldText", "newText"], properties: {
        oldText: { type: "string", description: "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call." },
        newText: { type: "string", description: "Replacement text for this targeted edit." }
      } }, description: "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead." }
    } }
  },
  write: {
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    inputSchema: { type: "object", required: ["path", "content"], properties: {
      path: { type: "string", description: "Path to the file to write (relative or absolute)" },
      content: { type: "string", description: "Content to write to the file" }
    } }
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
      limit: { type: "number", description: "Maximum number of matches to return (default: 100)" }
    } }
  },
  find: {
    description: "Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to 1000 results or 50KB (whichever is hit first).",
    inputSchema: { type: "object", required: ["pattern"], properties: {
      pattern: { type: "string", description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'" },
      path: { type: "string", description: "Directory to search in (default: current directory)" },
      limit: { type: "number", description: "Maximum number of results (default: 1000)" }
    } }
  },
  ls: {
    description: "List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output is truncated to 500 entries or 50KB (whichever is hit first).",
    inputSchema: { type: "object", properties: {
      path: { type: "string", description: "Directory to list (default: current directory)" },
      limit: { type: "number", description: "Maximum number of entries to return (default: 500)" }
    } }
  }
};
var riskFor = (name) => name === "bash" ? "execute" : name === "edit" || name === "write" ? "write" : "read";
var stringArg = (args, key) => {
  const value = args[key];
  if (typeof value !== "string") throw new Error(`k.${key === "command" ? "bash" : key} requires a ${key} string`);
  return value;
};
var positiveInteger = (value, fallback, minimum = 0) => typeof value === "number" && Number.isFinite(value) ? Math.max(minimum, Math.floor(value)) : fallback;
var truncateBytes = (value, fromEnd = false) => {
  if (Buffer.byteLength(value) <= MAX_BYTES) return { text: value, truncated: false };
  let bytes = Buffer.from(value);
  bytes = fromEnd ? bytes.subarray(bytes.length - MAX_BYTES) : bytes.subarray(0, MAX_BYTES);
  return { text: bytes.toString("utf8"), truncated: true };
};
var truncateLines = (value, limit, fromEnd = false) => {
  const lines = value.split("\n");
  if (lines.length <= limit) return { text: value, truncated: false };
  return { text: (fromEnd ? lines.slice(-limit) : lines.slice(0, limit)).join("\n"), truncated: true };
};
var escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var normalizeRelative = (root, file) => path8.relative(root, file).split(path8.sep).join("/");
var matchesGlob = (file, pattern) => minimatch(file, pattern, {
  dot: true,
  matchBase: !pattern.includes("/"),
  maxGlobstarRecursion: 64
});
var byteLength2 = (value) => Buffer.byteLength(value, "utf8");
var abortReason = (signal, fallback) => {
  const reason = signal?.reason;
  return reason instanceof Error ? reason : new Error(typeof reason === "string" ? reason : fallback);
};
var KiroToolsProvider = class {
  name = "k";
  description = "Kiro Fabric's built-in coding tools";
  #cwd;
  #guard;
  #readArtifact;
  #protectedRoots;
  constructor(cwd, options = {}) {
    this.#guard = new ProjectRootGuard(cwd);
    this.#cwd = this.#guard.canonicalRoot;
    this.#readArtifact = options.readArtifact;
    this.#protectedRoots = (options.protectedRoots ?? []).map((root) => path8.resolve(root));
  }
  #isProtected(target) {
    const resolved = path8.resolve(target);
    return this.#protectedRoots.some(
      (root) => resolved === root || resolved.startsWith(root + path8.sep)
    );
  }
  #assertNotProtected(target, action) {
    if (this.#isProtected(target)) {
      throw new Error(`${action} refuses access to the managed immutable runtime`);
    }
  }
  async list(request, context) {
    const names = this.#readArtifact ? [...TOOL_NAMES, "readArtifact"] : [...TOOL_NAMES];
    const descriptors4 = await Promise.all(names.map((name) => this.describe(name, context)));
    const query = request.query?.toLowerCase();
    return descriptors4.filter((item) => item !== void 0).filter((item) => !query || `${item.name} ${item.description}`.toLowerCase().includes(query));
  }
  async describe(actionName, _context) {
    if (actionName === "readArtifact" && this.#readArtifact) return {
      name: actionName,
      description: "Read a bounded chunk of an opaque overflow artifact returned by fabric_exec.",
      inputSchema: { type: "object", properties: {
        id: { type: "string", pattern: "^ka_[a-f0-9]{48}$" },
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1, maximum: 16e3 }
      }, required: ["id"], additionalProperties: false },
      risk: "read",
      namespace: "ephemeral"
    };
    if (!TOOL_NAMES.includes(actionName)) return void 0;
    const name = actionName;
    return { name, ...schemas[name], risk: riskFor(name), namespace: "builtin" };
  }
  prepareArguments(actionName, args) {
    if (!TOOL_NAMES.includes(actionName)) return args;
    if (actionName === "bash") return args;
    const target = actionName === "grep" || actionName === "find" || actionName === "ls" ? args.path ?? "." : args.path;
    const resolved = this.#guard.assertPath(target, `k.${actionName}`);
    this.#assertNotProtected(resolved, `k.${actionName}`);
    return args;
  }
  async invoke(actionName, args, context) {
    throwIfAborted(context.signal);
    if (actionName === "readArtifact" && this.#readArtifact) {
      const call = () => this.#readArtifact({
        id: args.id,
        ...args.offset !== void 0 ? { offset: args.offset } : {},
        ...args.limit !== void 0 ? { limit: args.limit } : {}
      });
      return runAbortable(context.signal, call);
    }
    if (!TOOL_NAMES.includes(actionName)) throw new Error(`Unknown Kiro Fabric tool: k.${actionName}`);
    const name = actionName;
    if (name === "bash") return this.#bash(args, context);
    const requested = name === "grep" || name === "find" || name === "ls" ? args.path ?? "." : args.path;
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
  async #read(target, args, context) {
    const mimeType = IMAGE_TYPES[path8.extname(target).toLowerCase()];
    if (mimeType) {
      const stat = await runAbortable(context.signal, () => fs2.stat(target));
      if (!stat.isFile()) throw new Error(`k.read requires a regular file: ${String(args.path)}`);
      if (stat.size > MAX_IMAGE_BYTES) throw new Error(`k.read refuses images over ${MAX_IMAGE_BYTES} bytes`);
      const data = await runAbortable(context.signal, () => fs2.readFile(target));
      const note = `Read image file [${mimeType}]`;
      context.attachMedia?.([{ type: "image", data: data.toString("base64"), mimeType }], note);
      return note;
    }
    const offset = positiveInteger(args.offset, 1, 1);
    const limit = Math.min(positiveInteger(args.limit, MAX_READ_LINES, 1), MAX_READ_LINES);
    const stream = createReadStream(target, { encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    const onAbort = () => {
      stream.destroy(abortReason(context.signal, "k.read aborted"));
    };
    context.signal?.addEventListener("abort", onAbort, { once: true });
    const selected = [];
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
        if (byteLength2(line) > remainingBytes) {
          selected.push(Buffer.from(line).subarray(0, remainingBytes).toString("utf8"));
          break;
        }
        selected.push(line);
        selectedBytes += separatorBytes + byteLength2(line);
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
  async #write(target, args, context) {
    const content = stringArg(args, "content");
    const contentBytes = byteLength2(content);
    if (contentBytes > MAX_WRITE_BYTES) throw new Error(`k.write refuses content over ${MAX_WRITE_BYTES} bytes`);
    let before = null;
    let existingMode;
    try {
      const stat = await fs2.stat(target);
      if (!stat.isFile()) throw new Error(`k.write target is not a regular file: ${String(args.path)}`);
      existingMode = stat.mode & 511;
      before = stat.size <= MAX_WRITE_DIFF_BYTES ? { kind: "content", content: await fs2.readFile(target, "utf8") } : { kind: "skipped", reason: "previous file too large", byteLength: stat.size, maxBytes: MAX_WRITE_DIFF_BYTES };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    throwIfAborted(context.signal);
    await runAbortable(context.signal, () => {
      writeFileAtomic(target, content, existingMode === void 0 ? void 0 : { mode: existingMode });
    });
    const result = { ok: true, output: `Successfully wrote ${contentBytes} bytes to ${target}`, details: null };
    const previewContent = writeContentForPreview(content);
    context.attachPreview?.({
      result,
      ...previewContent !== void 0 ? { writeContent: previewContent } : {},
      writeByteLength: contentBytes,
      writeLineCount: content.length === 0 ? 0 : content.split("\n").length,
      codePreviewBeforeWrite: before,
      writeBeforeCaptured: true
    });
    return result;
  }
  async #edit(target, args, context) {
    const stat = await runAbortable(context.signal, () => fs2.stat(target));
    if (!stat.isFile()) throw new Error(`k.edit target is not a regular file: ${String(args.path)}`);
    const source = await runAbortable(context.signal, () => fs2.readFile(target, "utf8"));
    if (source.length > MAX_EDIT_CHARS) throw new Error(`k.edit refuses files over ${MAX_EDIT_CHARS} characters; use scoped unique edits`);
    let parsedEdits = args.edits;
    if (typeof parsedEdits === "string") {
      try {
        parsedEdits = JSON.parse(parsedEdits);
      } catch {
      }
    }
    const raw = Array.isArray(parsedEdits) ? [...parsedEdits] : [];
    if (typeof args.oldText === "string" && typeof args.newText === "string") raw.push({ oldText: args.oldText, newText: args.newText, all: args.all });
    if (raw.length === 0) throw new Error("k.edit requires at least one edit");
    const changes = raw.map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`k.edit edits[${index}] must be an object`);
      const edit = entry;
      if (typeof edit.oldText !== "string" || typeof edit.newText !== "string" || edit.oldText.length === 0) throw new Error(`k.edit edits[${index}] requires non-empty oldText and newText strings`);
      const oldText = edit.oldText;
      const newText = edit.newText;
      const positions = [];
      for (let at = source.indexOf(oldText); at >= 0; at = source.indexOf(oldText, at + Math.max(1, oldText.length))) positions.push(at);
      if (positions.length === 0) throw new Error(`k.edit edits[${index}] oldText was not found`);
      const all = args.all === true || edit.all === true;
      if (!all && positions.length !== 1) throw new Error(`k.edit edits[${index}] found ${positions.length} occurrences; add all:true or use a unique anchor`);
      return (all ? positions : positions.slice(0, 1)).map((start) => ({ start, end: start + oldText.length, text: newText, index }));
    }).flat().sort((a, b) => a.start - b.start);
    for (let index = 1; index < changes.length; index += 1) if (changes[index].start < changes[index - 1].end) throw new Error("k.edit edits contain overlapping regions");
    let next = source;
    for (const change of [...changes].reverse()) next = next.slice(0, change.start) + change.text + next.slice(change.end);
    if (byteLength2(next) > MAX_WRITE_BYTES) throw new Error(`k.edit result exceeds ${MAX_WRITE_BYTES} bytes`);
    throwIfAborted(context.signal);
    await runAbortable(context.signal, () => {
      writeFileAtomic(target, next, { mode: stat.mode & 511 });
    });
    const firstChangedLine = source.slice(0, changes[0].start).split("\n").length;
    const displayPath = String(args.path);
    const diff = createTwoFilesPatch(displayPath, displayPath, source, next, void 0, void 0, { context: 3 }).replace(/^={3,}\n/u, "").trimEnd();
    const details = { diff, patch: diff, firstChangedLine };
    const result = { ok: true, output: `Successfully replaced ${raw.length} block(s) in ${String(args.path)}.`, details };
    context.attachPreview?.({ result, details });
    return result;
  }
  async #ls(target, args, context) {
    const entries = await runAbortable(context.signal, () => fs2.readdir(target, { withFileTypes: true }));
    const limit = Math.min(positiveInteger(args.limit, 500, 1), 500);
    const text = entries.filter((entry) => !this.#isProtected(path8.join(target, entry.name))).sort((left, right) => left.name.localeCompare(right.name)).slice(0, limit).map((entry) => entry.name + (entry.isDirectory() ? "/" : "")).join("\n");
    return truncateBytes(text).text;
  }
  async #ignoreFrame(directory) {
    const file = path8.join(directory, ".gitignore");
    let stat;
    try {
      stat = await fs2.stat(file);
    } catch (error) {
      if (error.code === "ENOENT") return void 0;
      throw error;
    }
    if (!stat.isFile()) return void 0;
    if (stat.size > MAX_GITIGNORE_BYTES) throw new Error(`k.find/k.grep refuses .gitignore files over ${MAX_GITIGNORE_BYTES} bytes`);
    return { root: directory, matcher: (0, import_ignore.default)().add(await fs2.readFile(file, "utf8")) };
  }
  #isIgnored(full, directory, frames) {
    let ignored = false;
    for (const frame of frames) {
      const relative2 = normalizeRelative(frame.root, full);
      if (!relative2 || relative2 === ".." || relative2.startsWith("../")) continue;
      const result = frame.matcher.test(directory ? `${relative2}/` : relative2);
      if (result.ignored) ignored = true;
      else if (result.unignored) ignored = false;
    }
    return ignored;
  }
  async #ancestorIgnoreFrames(directory) {
    const relative2 = path8.relative(this.#cwd, directory);
    if (!relative2 || relative2 === ".") return [];
    const segments = relative2.split(path8.sep).filter(Boolean);
    const frames = [];
    let current = this.#cwd;
    for (const segment of segments.slice(0, -1)) {
      const frame = await this.#ignoreFrame(current);
      if (frame) frames.push(frame);
      current = path8.join(current, segment);
    }
    const parentFrame = await this.#ignoreFrame(current);
    if (parentFrame) frames.push(parentFrame);
    return frames;
  }
  async *#walk(root, signal, state = { files: 0, directories: 0 }, inheritedFrames = [], depth = 0) {
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
    const entries = (await fs2.readdir(root, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      throwIfAborted(signal);
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path8.join(root, entry.name);
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
  async #find(target, args, context) {
    const pattern = stringArg(args, "pattern");
    const limit = positiveInteger(args.limit, 1e3, 1);
    const matches = [];
    let bytes = 0;
    for await (const file of this.#walk(target, context.signal)) {
      const relative2 = normalizeRelative(target, file);
      if (!matchesGlob(relative2, pattern)) continue;
      const nextBytes = byteLength2(relative2) + (matches.length === 0 ? 0 : 1);
      if (matches.length >= limit || bytes + nextBytes > MAX_BYTES) break;
      matches.push(relative2);
      bytes += nextBytes;
    }
    return matches.join("\n");
  }
  async #grep(target, args, context) {
    const pattern = stringArg(args, "pattern");
    const flags = args.ignoreCase === true ? "i" : "";
    const matcher = new RegExp(args.literal === true ? escapeRegex(pattern) : pattern, flags);
    const stat = await runAbortable(context.signal, () => fs2.stat(target));
    const glob = typeof args.glob === "string" ? args.glob : void 0;
    const limit = positiveInteger(args.limit, 100, 1);
    const contextLines = positiveInteger(args.context, 0, 0);
    const output = [];
    let outputBytes = 0;
    let matches = 0;
    const files = stat.isDirectory() ? this.#walk(target, context.signal) : (async function* () {
      yield target;
    })();
    fileLoop: for await (const file of files) {
      throwIfAborted(context.signal);
      const relative2 = stat.isDirectory() ? normalizeRelative(target, file) : path8.basename(file);
      if (glob && !matchesGlob(relative2, glob)) continue;
      let source;
      try {
        const fileStat = await fs2.stat(file);
        if (!fileStat.isFile() || fileStat.size > MAX_SEARCH_FILE_BYTES) continue;
        source = await fs2.readFile(file, "utf8");
      } catch {
        continue;
      }
      if (source.includes("\0")) continue;
      const lines = source.split("\n");
      for (let line = 0; line < lines.length && matches < limit; line += 1) {
        matcher.lastIndex = 0;
        if (!matcher.test(lines[line])) continue;
        matches += 1;
        for (let shown = Math.max(0, line - contextLines); shown <= Math.min(lines.length - 1, line + contextLines); shown += 1) {
          const rendered = `${relative2}:${shown + 1}:${lines[shown].slice(0, 500)}`;
          const nextBytes = byteLength2(rendered) + (output.length === 0 ? 0 : 1);
          if (outputBytes + nextBytes > MAX_BYTES) break fileLoop;
          output.push(rendered);
          outputBytes += nextBytes;
        }
      }
      if (matches >= limit) break;
    }
    return output.join("\n");
  }
  async #bash(args, context) {
    const command = stringArg(args, "command");
    if (byteLength2(command) > MAX_BASH_COMMAND_BYTES) throw new Error(`k.bash refuses commands over ${MAX_BASH_COMMAND_BYTES} bytes`);
    const timeoutMs = typeof args.timeout === "number" && args.timeout > 0 ? args.timeout * 1e3 : void 0;
    const fullOutputPath = path8.join(os2.tmpdir(), `kiro-fabric-bash-${crypto.randomUUID()}.log`);
    const outputFile = await fs2.open(fullOutputPath, "wx", 384);
    let result;
    try {
      result = await new Promise((resolve, reject) => {
        const shell = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "/bin/bash";
        const child = spawn(shell, ["-c", command], {
          cwd: this.#cwd,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32"
        });
        if (!child.pid) {
          reject(new Error("k.bash failed to launch bash"));
          return;
        }
        const tree = createProcessTreeController(child.pid, { ambientHelpers: false });
        let tail = Buffer.alloc(0);
        let totalBytes = 0;
        let writeChain = Promise.resolve();
        let terminationError;
        let stopPromise;
        let timer;
        let finished = false;
        const requestStop = (error) => {
          if (terminationError) return;
          terminationError = error;
          stopPromise = tree.terminate().then(() => void 0, (stopError) => {
            terminationError = stopError instanceof Error ? stopError : new Error(String(stopError));
          });
        };
        const enqueue = (raw, preview, stream) => {
          const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
          const remaining = Math.max(0, MAX_BASH_OUTPUT_BYTES - totalBytes);
          const captured = remaining >= chunk.length ? chunk : chunk.subarray(0, remaining);
          totalBytes += chunk.length;
          if (captured.length > 0) {
            tail = Buffer.concat([tail, captured]);
            if (tail.length > MAX_BYTES) tail = tail.subarray(tail.length - MAX_BYTES);
            stream?.pause();
            writeChain = writeChain.then(async () => {
              await outputFile.write(captured);
            }).catch((error) => {
              requestStop(error instanceof Error ? error : new Error(String(error)));
            }).finally(() => stream?.resume());
          }
          if (preview) {
            const boundedPreview = truncateLines(tail.toString("utf8"), MAX_READ_LINES, true).text;
            context.attachPreview?.({ result: boundedPreview, bashCommand: command });
            context.update(`bash: ${boundedPreview.slice(-500) || "running"}`);
          }
          if (totalBytes > MAX_BASH_OUTPUT_BYTES) requestStop(new Error(`k.bash output exceeded the ${MAX_BASH_OUTPUT_BYTES}-byte safety limit`));
        };
        const abort = () => requestStop(abortReason(context.signal, "k.bash aborted"));
        const finish = async (code, signal) => {
          if (finished) return;
          finished = true;
          if (timer) clearTimeout(timer);
          context.signal?.removeEventListener("abort", abort);
          try {
            await writeChain;
            await stopPromise;
            await outputFile.close();
          } catch (error) {
            reject(error);
            return;
          }
          if (terminationError) {
            reject(terminationError);
            return;
          }
          if (signal) {
            reject(new Error(`k.bash terminated by ${signal}`));
            return;
          }
          resolve({ output: tail.toString("utf8"), code, totalBytes });
        };
        context.signal?.addEventListener("abort", abort, { once: true });
        child.stdout?.on("data", (chunk) => enqueue(chunk, true, child.stdout));
        child.stderr?.on("data", (chunk) => enqueue(chunk, false, child.stderr));
        child.once("error", (error) => requestStop(error));
        child.once("close", (code, signal) => {
          void finish(code, signal);
        });
        if (timeoutMs !== void 0) {
          timer = setTimeout(() => requestStop(new Error(`k.bash timed out after ${args.timeout} seconds`)), timeoutMs);
        }
      });
    } catch (error) {
      await outputFile.close().catch(() => void 0);
      await fs2.rm(fullOutputPath, { force: true });
      throw error;
    }
    throwIfAborted(context.signal);
    const byLines = truncateLines(result.output, MAX_READ_LINES, true);
    const bounded2 = truncateBytes(byLines.text, true);
    const truncated = result.totalBytes > byteLength2(result.output) || byLines.truncated || bounded2.truncated;
    let details = null;
    if (truncated) {
      details = { fullOutputPath, truncation: { truncated: true } };
    } else {
      await fs2.rm(fullOutputPath, { force: true });
    }
    if (result.code !== 0) {
      const fullOutputHint = truncated ? `
[Full output: ${fullOutputPath}]` : "";
      throw new Error(`${bounded2.text}${fullOutputHint}

Command exited with code ${result.code ?? 1}`);
    }
    const normalized = { ok: true, output: bounded2.text || "(no output)", details };
    context.attachPreview?.({ result: normalized, bashCommand: command, details });
    return normalized;
  }
};

// src/kiro/agents-host.ts
import { fileURLToPath as fileURLToPath3 } from "node:url";
import { isAbsolute, relative, sep as sep2 } from "node:path";

// src/kiro/agent-manager.ts
import { randomUUID as randomUUID5 } from "node:crypto";
import fs4 from "node:fs";
import os3 from "node:os";
import path9 from "node:path";

// src/log-tail.ts
import fs3 from "node:fs";
var READ_CHUNK_BYTES = 64 * 1024;
var DEFAULT_READ_MAX_BYTES = 8 * 1024 * 1024;
var parseLine = (offset, raw) => {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { offset, raw };
  }
  return { offset, raw, parsed };
};
var completeLines = (buffer, bufferStart, fileEnd) => {
  const lines = [];
  let start = 0;
  let first = true;
  for (let index = 0; index < buffer.length; index++) {
    if (buffer[index] !== 10) continue;
    if (!first || bufferStart === 0) {
      const raw = buffer.subarray(start, index).toString("utf8").replace(/\r$/, "");
      if (raw) lines.push({ offset: bufferStart + start, raw });
    }
    first = false;
    start = index + 1;
  }
  if (fileEnd === bufferStart + buffer.length && start < buffer.length) {
    if (!first || bufferStart === 0) {
      const raw = buffer.subarray(start).toString("utf8").replace(/\r$/, "");
      if (raw) lines.push({ offset: bufferStart + start, raw });
    }
  }
  return lines;
};
var readJsonlPageFromDescriptor = (descriptor, limit, before, knownSize, maxBytes) => {
  try {
    const size = knownSize ?? fs3.fstatSync(descriptor).size;
    const fileEnd = typeof before === "number" && Number.isSafeInteger(before) ? Math.max(0, Math.min(before, size)) : size;
    const boundedLimit = Math.max(1, Math.trunc(limit));
    const boundedBytes = Math.max(
      1,
      Math.trunc(maxBytes ?? DEFAULT_READ_MAX_BYTES)
    );
    const chunks = [];
    let bufferStart = fileEnd;
    let bufferedBytes = 0;
    let newlineCount = 0;
    while (bufferStart > 0 && newlineCount <= boundedLimit && bufferedBytes < boundedBytes) {
      const length = Math.min(READ_CHUNK_BYTES, bufferStart, boundedBytes - bufferedBytes);
      const chunkStart = bufferStart - length;
      const chunk = Buffer.allocUnsafe(length);
      const bytesRead = fs3.readSync(descriptor, chunk, 0, length, chunkStart);
      if (bytesRead <= 0) break;
      const captured = chunk.subarray(0, bytesRead);
      chunks.push(captured);
      for (const byte of captured) {
        if (byte === 10) newlineCount += 1;
      }
      bufferedBytes += bytesRead;
      bufferStart = chunkStart;
    }
    const buffer = Buffer.concat(chunks.reverse(), bufferedBytes);
    const records = completeLines(buffer, bufferStart, fileEnd);
    const selected = records.slice(-boundedLimit);
    const hasMore = selected.length > 0 && (records.length > selected.length || bufferStart > 0);
    return {
      lines: selected.map((line) => parseLine(line.offset, line.raw)),
      hasMore,
      ...hasMore ? { before: selected[0].offset } : {}
    };
  } catch {
    return { lines: [], hasMore: false };
  }
};
var readJsonlPage = (filePath, limit, before, maxBytes) => {
  let descriptor;
  try {
    descriptor = fs3.openSync(filePath, "r");
    return readJsonlPageFromDescriptor(descriptor, limit, before, void 0, maxBytes);
  } catch {
    return { lines: [], hasMore: false };
  } finally {
    if (descriptor !== void 0) {
      try {
        fs3.closeSync(descriptor);
      } catch {
      }
    }
  }
};

// src/kiro/agent-manager.ts
var STATUS_POLL_MS = 100;
var TRANSPORT_EXIT_GRACE_MS = 1e3;
var MIN_TIMEOUT_MS = 1e3;
var MAX_TIMEOUT_MS = 24 * 36e5;
var MAX_NAME_LENGTH = 60;
var terminalStatuses = /* @__PURE__ */ new Set(["completed", "failed", "stopped", "timed_out"]);
var delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
var safeName = (value) => value.replace(/[\r\n\t]+/g, " ").trim().slice(0, MAX_NAME_LENGTH) || "Fabric agent";
var unavailableUsage = () => ({
  availability: "unavailable",
  reason: "runner-does-not-report",
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0
});
var isRecord3 = (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value;
  return typeof record.id === "string" && typeof record.name === "string" && typeof record.task === "string" && typeof record.status === "string" && ["queued", "running", "completed", "failed", "stopped", "timed_out"].includes(record.status) && record.runner === "kiro" && typeof record.cwd === "string" && typeof record.startedAt === "number" && typeof record.updatedAt === "number" && typeof record.turns === "number" && typeof record.toolCalls === "number" && typeof record.text === "string" && typeof record.usage === "object" && record.usage !== null;
};
var readRecord = (filePath) => {
  try {
    const value = JSON.parse(fs4.readFileSync(filePath, "utf8"));
    return isRecord3(value) ? value : void 0;
  } catch {
    return void 0;
  }
};
var writeRecord = (filePath, record) => {
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs4.writeFileSync(temporary, JSON.stringify({ ...record, format: 2 }, null, 2), {
    encoding: "utf8",
    mode: 384
  });
  fs4.renameSync(temporary, filePath);
};
var KiroAgentManager = class {
  constructor(cwd, config, options) {
    this.cwd = cwd;
    this.config = config;
    this.#workerPath = options.workerPath;
    this.#managedTempRoot = options.runRoot === void 0 && process.env.KIRO_FABRIC_RUN_ROOT === void 0;
    this.#runRoot = options.runRoot ?? process.env.KIRO_FABRIC_RUN_ROOT ?? fs4.mkdtempSync(path9.join(os3.tmpdir(), "kiro-fabric-runs-"));
    this.#projectRoot = options.projectRoot ?? cwd;
    this.#kiroBinary = options.kiroBinary ?? process.env.KIRO_FABRIC_KIRO_BINARY ?? "kiro-cli";
  }
  #workerPath;
  #runRoot;
  #managedTempRoot;
  #projectRoot;
  #kiroBinary;
  #runs = /* @__PURE__ */ new Map();
  #waiters = [];
  #active = 0;
  #closing = false;
  get kiroBinaryForDiscovery() {
    return this.#kiroBinary;
  }
  resolveCwd(requestedCwd) {
    if (requestedCwd === void 0) return this.cwd;
    if (typeof requestedCwd !== "string" || requestedCwd.trim().length === 0) {
      throw new Error(`Invalid Fabric agent cwd ${JSON.stringify(requestedCwd)}: path must not be empty`);
    }
    const candidate = path9.isAbsolute(requestedCwd) ? requestedCwd : path9.resolve(this.cwd, requestedCwd);
    try {
      const canonical = fs4.realpathSync(candidate);
      fs4.accessSync(canonical, fs4.constants.R_OK | fs4.constants.X_OK);
      if (!fs4.statSync(canonical).isDirectory()) throw new Error("path is not a directory");
      return canonical;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid Fabric agent cwd ${JSON.stringify(requestedCwd)}: ${reason}`);
    }
  }
  async #acquire(signal) {
    if (this.#closing) throw new Error("Kiro agent manager is closing");
    if (signal?.aborted) throw new Error("Agent launch aborted");
    while (this.#active >= Math.max(1, this.config.maxConcurrent)) {
      await new Promise((resolve, reject) => {
        const wake = () => {
          signal?.removeEventListener("abort", abort);
          resolve();
        };
        const abort = () => {
          const index = this.#waiters.indexOf(wake);
          if (index >= 0) this.#waiters.splice(index, 1);
          reject(new Error("Agent launch aborted"));
        };
        this.#waiters.push(wake);
        signal?.addEventListener("abort", abort, { once: true });
      });
      if (this.#closing) throw new Error("Kiro agent manager is closing");
      if (signal?.aborted) throw new Error("Agent launch aborted");
    }
    if (this.#closing) throw new Error("Kiro agent manager is closing");
    this.#active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
      this.#waiters.shift()?.();
    };
  }
  async spawn(request, signal) {
    if (this.#closing) throw new Error("Kiro agent manager is closing");
    if (!this.config.enabled) throw new Error("Agents are disabled in Fabric configuration");
    if (!request.task.trim()) throw new Error("Agent task must not be empty");
    if (request.runner !== void 0 && request.runner !== "kiro") {
      throw new Error(`Kiro agent manager supports only the Kiro runner, not ${request.runner}`);
    }
    if (request.recursive) throw new Error("Kiro runner does not support recursive Fabric");
    if (request.worktree) throw new Error("Kiro agent manager does not support worktrees");
    if (request.residency === "durable") throw new Error("Kiro agent manager supports session-local agents only");
    const selectedTransport = request.transport ?? this.config.transport;
    if (selectedTransport !== "auto" && selectedTransport !== "process") {
      throw new Error(`Kiro agent manager supports only process transport, not ${selectedTransport}`);
    }
    if (this.config.maxTokensPerChild > 0) {
      throw new Error("Kiro runner does not report token usage; set agents.maxTokensPerChild to 0");
    }
    if (this.config.budgetUsd > 0) {
      throw new Error("Kiro runner does not report usage and cannot enforce an active Fabric cost budget");
    }
    const agentCwd = this.resolveCwd(request.cwd);
    const tools = parseKiroChildTools(request.tools ?? this.config.defaultTools);
    const release = await this.#acquire(signal);
    let launchDirectory;
    try {
      if (this.#closing) throw new Error("Kiro agent manager is closing");
      const id = randomUUID5().replaceAll("-", "");
      const name = safeName(request.name ?? request.task.split("\n", 1)[0] ?? "Fabric agent");
      const runDirectory = path9.join(this.#runRoot, id);
      launchDirectory = runDirectory;
      fs4.mkdirSync(runDirectory, { recursive: true });
      const taskFile = path9.join(runDirectory, "task.txt");
      const statusFile = path9.join(runDirectory, "status.json");
      const logFile = path9.join(runDirectory, "events.jsonl");
      const steerFile = path9.join(runDirectory, "steer.jsonl");
      const schemaFile = request.schema ? path9.join(runDirectory, "schema.json") : void 0;
      const contextFile = request.kiroContext ? path9.join(runDirectory, "kiro-context.json") : void 0;
      fs4.writeFileSync(taskFile, request.task, { encoding: "utf8", mode: 384 });
      if (schemaFile) fs4.writeFileSync(schemaFile, JSON.stringify(request.schema, null, 2), { mode: 384 });
      if (contextFile) fs4.writeFileSync(contextFile, JSON.stringify(request.kiroContext, null, 2), { mode: 384 });
      const timeoutMs = Math.max(
        MIN_TIMEOUT_MS,
        Math.min(MAX_TIMEOUT_MS, Math.floor(Math.max(this.config.timeoutMs, request.timeoutMs ?? 0)))
      );
      const thinking = request.suppressThinkingDefault ? request.thinking : request.thinking ?? this.config.thinking;
      const residency = request.kiroResidency ?? "resident";
      const workerArguments = [
        "--id",
        id,
        "--name",
        name,
        "--runner",
        "kiro",
        "--task-file",
        taskFile,
        "--status-file",
        statusFile,
        "--log-file",
        logFile,
        "--cwd",
        agentCwd,
        "--kiro-binary",
        this.#kiroBinary,
        "--timeout-ms",
        String(timeoutMs),
        "--tools",
        JSON.stringify(tools),
        "--transport",
        "process",
        ...request.model ? ["--model", request.model] : [],
        ...thinking ? ["--thinking", thinking] : [],
        ...request.systemPrompt?.trim() ? ["--system-prompt", request.systemPrompt.trim()] : [],
        "--project-root",
        this.#projectRoot,
        "--run-root",
        path9.join(runDirectory, "nested"),
        ...residency === "one-shot" ? [] : ["--steer-file", steerFile],
        ...contextFile ? ["--kiro-context-file", contextFile] : [],
        "--kiro-residency",
        residency,
        ...schemaFile ? ["--schema-file", schemaFile] : []
      ];
      const processHandle = await spawnDetached(
        this.#workerPath,
        workerArguments,
        agentCwd,
        { ambientHelpers: false }
      );
      const transport = {
        kind: "process",
        sessionId: String(processHandle.pid),
        isAlive: processHandle.isAlive,
        stop: processHandle.stop
      };
      let resolveResult;
      const result = new Promise((resolve) => {
        resolveResult = resolve;
      });
      if (signal?.aborted || this.#closing) {
        await transport.stop();
        throw new Error(this.#closing ? "Kiro agent manager is closing" : "Agent launch aborted");
      }
      const managed = {
        id,
        name,
        task: request.task,
        cwd: agentCwd,
        runDirectory,
        statusFile,
        transport,
        result,
        resolve: resolveResult,
        release,
        settled: false,
        residency,
        abortSignal: signal,
        abortHandler: void 0,
        ...request.model ? { model: request.model } : {},
        ...thinking ? { thinking } : {}
      };
      if (signal) {
        managed.abortHandler = () => void this.stop(id);
        signal.addEventListener("abort", managed.abortHandler, { once: true });
      }
      this.#runs.set(id, managed);
      launchDirectory = void 0;
      void this.#monitor(managed, timeoutMs);
      return this.#handle(managed, "running");
    } catch (error) {
      if (launchDirectory) fs4.rmSync(launchDirectory, { recursive: true, force: true });
      release();
      throw error;
    }
  }
  async run(request, signal) {
    const handle = await this.spawn(request, signal);
    return this.wait(handle.id);
  }
  async wait(id) {
    const managed = this.#require(id);
    if (!managed.settled) {
      if (!managed.result) throw new Error(`Agent ${id} has no pending result`);
      return managed.result;
    }
    const record = readRecord(managed.statusFile) ?? managed.latestRecord;
    if (!record || !terminalStatuses.has(record.status)) {
      throw new Error(`Agent ${id} settled without a result`);
    }
    return this.#metadata(record, managed);
  }
  detachSignal(id) {
    const managed = this.#require(id);
    if (managed.abortSignal && managed.abortHandler) {
      managed.abortSignal.removeEventListener("abort", managed.abortHandler);
    }
    managed.abortSignal = void 0;
    managed.abortHandler = void 0;
  }
  status(id) {
    const managed = this.#require(id);
    const record = readRecord(managed.statusFile) ?? managed.latestRecord;
    if (!record) return this.#handle(managed, "running");
    managed.latestRecord = record;
    return structuredClone(this.#metadata(record, managed));
  }
  list() {
    return [...this.#runs.keys()].map((id) => this.status(id));
  }
  async stop(id) {
    const managed = this.#require(id);
    if (managed.settled) return this.wait(id);
    const existing = readRecord(managed.statusFile);
    if (existing && terminalStatuses.has(existing.status)) {
      const result2 = this.#metadata(existing, managed);
      this.#settle(managed, result2);
      return result2;
    }
    await managed.transport.stop();
    const terminal = readRecord(managed.statusFile);
    const result = terminal && terminalStatuses.has(terminal.status) ? this.#metadata(terminal, managed) : this.#failure(managed, "stopped", "Agent stopped");
    if (!terminal || !terminalStatuses.has(terminal.status)) writeRecord(managed.statusFile, result);
    this.#settle(managed, result);
    return result;
  }
  async cleanup(id) {
    const managed = this.#require(id);
    if (!managed.settled) throw new Error("Cannot clean up a running agent");
    fs4.rmSync(managed.runDirectory, { recursive: true, force: true });
    this.#runs.delete(id);
    return { cleaned: !fs4.existsSync(managed.runDirectory) };
  }
  readLog(id, opts = {}) {
    const managed = this.#require(id);
    const logFile = path9.join(managed.runDirectory, "events.jsonl");
    const page = readJsonlPage(logFile, Math.max(1, Math.min(opts.lines ?? 200, 5e3)), opts.before);
    const status = readRecord(managed.statusFile);
    return {
      id,
      runDirectory: managed.runDirectory,
      logFile,
      events: page.lines,
      hasMore: page.hasMore,
      ...page.before !== void 0 ? { before: page.before } : {},
      ...status ? { status: this.#metadata(status, managed) } : {}
    };
  }
  steer(id, message, data) {
    return this.#appendSteer(id, { type: "steer", message, data });
  }
  followUp(id, message, data) {
    return this.#appendSteer(id, { type: "follow_up", message, data });
  }
  setSteeringMode(id, mode) {
    return this.#appendSteer(id, { type: "set_steering_mode", mode });
  }
  setFollowUpMode(id, mode) {
    return this.#appendSteer(id, { type: "set_follow_up_mode", mode });
  }
  #appendSteer(id, entry) {
    const managed = this.#require(id);
    if (managed.residency === "one-shot") {
      throw new Error(`Fabric agent ${id} is one-shot; steering has no target`);
    }
    const record = readRecord(managed.statusFile);
    if (managed.settled || record && terminalStatuses.has(record.status)) {
      throw new Error(`Fabric agent ${id} already finished (${record?.status ?? "settled"}); steering has no target`);
    }
    const messageId = randomUUID5();
    const line = JSON.stringify({ ...entry, id: messageId, ts: Date.now() }) + "\n";
    const bytes = Buffer.byteLength(line, "utf8");
    if (bytes > MAX_AGENT_STEER_LINE_BYTES) {
      throw new Error(`Fabric agent steering command is too large (${bytes} bytes; maximum ${MAX_AGENT_STEER_LINE_BYTES})`);
    }
    fs4.appendFileSync(path9.join(managed.runDirectory, "steer.jsonl"), line, { encoding: "utf8", mode: 384 });
    return { queued: true, messageId };
  }
  async close() {
    this.#closing = true;
    while (this.#waiters.length > 0) this.#waiters.shift()?.();
    const running = [...this.#runs.values()].filter((run) => !run.settled);
    await Promise.allSettled(running.map((run) => this.stop(run.id)));
    if (this.#managedTempRoot || !this.config.retainRuns) {
      fs4.rmSync(this.#runRoot, { recursive: true, force: true });
    }
  }
  #require(id) {
    const managed = this.#runs.get(id);
    if (!managed) throw new Error(`Unknown Fabric agent id: ${id}`);
    return managed;
  }
  #handle(managed, status) {
    return {
      id: managed.id,
      name: managed.name,
      status,
      runner: "kiro",
      transport: "process",
      cwd: managed.cwd,
      ...managed.transport.sessionId ? { sessionId: managed.transport.sessionId } : {},
      ...managed.model ? { model: managed.model } : {},
      ...managed.thinking ? { thinking: managed.thinking } : {}
    };
  }
  #metadata(record, managed) {
    return {
      ...record,
      runner: "kiro",
      transport: "process",
      cwd: managed.cwd,
      ...managed.transport.sessionId ? { sessionId: managed.transport.sessionId } : {},
      ...managed.model && !record.model ? { model: managed.model } : {},
      ...managed.thinking && !record.thinking ? { thinking: managed.thinking } : {}
    };
  }
  #failure(managed, status, error) {
    const now = Date.now();
    return {
      id: managed.id,
      name: managed.name,
      task: managed.task,
      status,
      runner: "kiro",
      transport: "process",
      cwd: managed.cwd,
      startedAt: now,
      updatedAt: now,
      finishedAt: now,
      turns: 0,
      toolCalls: 0,
      text: "",
      error,
      usage: unavailableUsage(),
      ...managed.transport.sessionId ? { sessionId: managed.transport.sessionId } : {},
      ...managed.model ? { model: managed.model } : {},
      ...managed.thinking ? { thinking: managed.thinking } : {}
    };
  }
  #settle(managed, result) {
    if (managed.settled) return;
    managed.settled = true;
    managed.latestRecord = result;
    if (managed.abortSignal && managed.abortHandler) {
      managed.abortSignal.removeEventListener("abort", managed.abortHandler);
    }
    managed.abortSignal = void 0;
    managed.abortHandler = void 0;
    managed.release();
    managed.resolve?.(result);
    managed.resolve = void 0;
    managed.result = void 0;
  }
  async #monitor(managed, timeoutMs) {
    const deadline = Date.now() + timeoutMs + TRANSPORT_EXIT_GRACE_MS;
    let deadSince;
    while (!managed.settled) {
      const record = readRecord(managed.statusFile);
      if (record) managed.latestRecord = record;
      if (record && terminalStatuses.has(record.status)) {
        this.#settle(managed, this.#metadata(record, managed));
        return;
      }
      if (Date.now() >= deadline) {
        await managed.transport.stop();
        const timedOut = this.#failure(managed, "timed_out", `Agent timed out after ${timeoutMs}ms`);
        writeRecord(managed.statusFile, timedOut);
        this.#settle(managed, timedOut);
        return;
      }
      const alive = await managed.transport.isAlive();
      if (!alive) {
        deadSince ??= Date.now();
        if (Date.now() - deadSince >= TRANSPORT_EXIT_GRACE_MS) {
          const failed = this.#failure(managed, "failed", "Agent transport exited without a result");
          writeRecord(managed.statusFile, failed);
          this.#settle(managed, failed);
          return;
        }
      } else {
        deadSince = void 0;
      }
      await delay(STATUS_POLL_MS);
    }
  }
};

// src/kiro/agent-actions.ts
var semanticContextSchema = {
  type: "object",
  description: "Bounded semantic context transferred to the Kiro ACP child before its task; this is not a native transcript handoff",
  properties: {
    objective: { type: "string", minLength: 1, maxLength: KIRO_SEMANTIC_CONTEXT_MAX_OBJECTIVE_CHARS },
    facts: {
      type: "array",
      maxItems: KIRO_SEMANTIC_CONTEXT_MAX_ITEMS,
      items: { type: "string", minLength: 1, maxLength: KIRO_SEMANTIC_CONTEXT_MAX_ITEM_CHARS }
    },
    relevantFiles: {
      type: "array",
      maxItems: KIRO_SEMANTIC_CONTEXT_MAX_ITEMS,
      items: { type: "string", minLength: 1, maxLength: KIRO_SEMANTIC_CONTEXT_MAX_ITEM_CHARS }
    },
    constraints: {
      type: "array",
      maxItems: KIRO_SEMANTIC_CONTEXT_MAX_ITEMS,
      items: { type: "string", minLength: 1, maxLength: KIRO_SEMANTIC_CONTEXT_MAX_ITEM_CHARS }
    },
    exclusions: {
      type: "array",
      maxItems: KIRO_SEMANTIC_CONTEXT_MAX_ITEMS,
      items: { type: "string", minLength: 1, maxLength: KIRO_SEMANTIC_CONTEXT_MAX_ITEM_CHARS }
    }
  },
  additionalProperties: false
};
var runProperties = {
  task: { type: "string", description: "A self-contained task for the Kiro ACP child" },
  name: { type: "string" },
  runner: {
    type: "string",
    enum: ["kiro"],
    description: "Only `kiro` is accepted; it launches the configured `kiro-cli` binary over ACP."
  },
  transport: { type: "string", enum: ["auto", "process"] },
  model: { type: "string", description: "Kiro v3 model ID applied through the ACP session configuration." },
  thinking: { type: "string", enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] },
  tools: { type: "array", items: { type: "string" } },
  timeoutMs: {
    type: "number",
    description: "Optional longer wall-clock limit in milliseconds. Values below the configured default are ignored."
  },
  cwd: { type: "string", description: "Must resolve to the managed Kiro project root." },
  schema: { type: "object", description: "Optional JSON Schema for validated structured output" },
  context: semanticContextSchema
};
var runSchema = {
  type: "object",
  properties: runProperties,
  required: ["task"],
  additionalProperties: false
};
var idSchema = {
  type: "object",
  properties: { id: { type: "string" } },
  required: ["id"],
  additionalProperties: false
};
var messageSchema = {
  type: "object",
  properties: { id: { type: "string" }, message: { type: "string" }, data: {} },
  required: ["id", "message"],
  additionalProperties: false
};
var modeSchema = {
  type: "object",
  properties: { id: { type: "string" }, mode: { type: "string", enum: ["all", "one-at-a-time"] } },
  required: ["id", "mode"],
  additionalProperties: false
};
var KIRO_AGENT_ACTION_DESCRIPTORS = [
  {
    name: "run",
    description: "Run one narrowly scoped Kiro ACP child with trusted-shell verification and wait for its result; omitted models use capability routing when those models are advertised, otherwise Kiro auto",
    inputSchema: runSchema,
    risk: "agent"
  },
  {
    name: "spawn",
    description: "Start one narrowly scoped Kiro ACP child with trusted-shell verification and return its local handle immediately; fan out at most four non-overlapping tasks",
    inputSchema: runSchema,
    risk: "agent"
  },
  { name: "wait", description: "Wait for a Kiro ACP child started by this managed Kiro session", inputSchema: idSchema, risk: "read" },
  { name: "status", description: "Get the latest status of a Kiro ACP child started by this managed Kiro session", inputSchema: idSchema, risk: "read" },
  {
    name: "list",
    description: "List Kiro ACP children started by this managed Kiro session",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    risk: "read"
  },
  {
    name: "models",
    description: "List Kiro models discovered from `kiro-cli chat --v3 --list-models --format json` (cached, non-billable)",
    inputSchema: {
      type: "object",
      properties: { runner: { type: "string", enum: ["kiro"] }, refresh: { type: "boolean" } },
      additionalProperties: false
    },
    risk: "execute"
  },
  { name: "stop", description: "Stop a Kiro ACP child started by this managed Kiro session", inputSchema: idSchema, risk: "agent" },
  { name: "cleanup", description: "Remove a completed Kiro ACP child's retained run files", inputSchema: idSchema, risk: "write" },
  { name: "steer", description: "Steer a running Kiro ACP child between turns", inputSchema: messageSchema, risk: "agent" },
  { name: "followUp", description: "Queue a follow-up turn for a running Kiro ACP child", inputSchema: messageSchema, risk: "agent" },
  { name: "setSteeringMode", description: "Set how queued steering messages are delivered to a Kiro ACP child", inputSchema: modeSchema, risk: "agent" },
  { name: "setFollowUpMode", description: "Set how queued follow-up messages are delivered to a Kiro ACP child", inputSchema: modeSchema, risk: "agent" },
  {
    name: "log",
    description: "Read a Kiro ACP child's retained Fabric event log",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Kiro ACP child run ID" },
        lines: { type: "number", minimum: 1, description: "Page line limit (default 200)" },
        before: { type: "number", minimum: 0, description: "Exclusive line cursor returned by a previous page to load older entries" }
      },
      required: ["id"],
      additionalProperties: false
    },
    risk: "read"
  }
];

// src/providers/arg-normalization.ts
var normalizeForm = (key) => key.toLowerCase().replace(/[^a-z0-9]/g, "");
var KEY_SYNONYM_CLASSES = [
  ["session", "sessionId", "id", "file", "path"],
  ["hypothesisId", "id"],
  ["id", "agentId", "actorId", "runId"],
  ["query", "q"],
  ["limit", "max", "pageSize"],
  ["task", "prompt", "instructions"],
  ["label", "labels", "name", "title"],
  ["summary", "description"],
  ["text", "message", "body"],
  ["check", "command", "cmd", "script", "predicate"],
  ["files", "paths"],
  ["ifVersion", "versionRef", "version"],
  ["indices", "index"]
];
var KEY_CLASS_FORMS = KEY_SYNONYM_CLASSES.map(
  (cls) => new Set(cls.map(normalizeForm))
);
var ENUM_VALUE_CLASSES = [
  ["project", "cwd", "repo", "repository", "workspace", "checkout", "tree"],
  ["global", "all"],
  ["permanent", "pinned", "sticky", "durable"]
];
var VALUE_CLASS_FORMS = ENUM_VALUE_CLASSES.map(
  (cls) => new Set(cls.map(normalizeForm))
);
var numericKind = (property) => {
  if (!property || typeof property !== "object") return void 0;
  const schema = property;
  if (schema.type === "number" || schema.type === "integer") return "scalar";
  if (schema.type === "array") {
    const items = schema.items;
    if (items && typeof items === "object" && (items.type === "number" || items.type === "integer")) {
      return "array";
    }
  }
  return void 0;
};
var stringEnumValues = (property) => {
  if (!property || typeof property !== "object") return void 0;
  const schema = property;
  if (Array.isArray(schema.enum)) {
    const values = schema.enum.filter(
      (entry) => typeof entry === "string"
    );
    return values.length > 0 ? values : void 0;
  }
  for (const branch of [schema.oneOf, schema.anyOf]) {
    if (!Array.isArray(branch)) continue;
    const consts = branch.map(
      (entry) => entry && typeof entry === "object" ? entry.const : void 0
    ).filter((entry) => typeof entry === "string");
    if (consts.length > 0) return consts;
  }
  return void 0;
};
var deriveEnumValueMap = (values) => {
  const map = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Map();
  for (const value of values) {
    const form = normalizeForm(value);
    seen.set(form, seen.has(form) ? void 0 : value);
  }
  for (const [form, value] of seen) if (value !== void 0) map.set(form, value);
  for (const classForms of VALUE_CLASS_FORMS) {
    const members = values.filter((value) => classForms.has(normalizeForm(value)));
    if (members.length !== 1) continue;
    const [hit] = members;
    for (const form of classForms) {
      if (form !== normalizeForm(hit) && !map.has(form)) map.set(form, hit);
    }
  }
  return map;
};
var deriveAction = (inputSchema, explicit) => {
  const properties = inputSchema && typeof inputSchema === "object" && inputSchema.properties && typeof inputSchema.properties === "object" ? inputSchema.properties : void 0;
  const declared = new Set(Object.keys(properties ?? {}));
  const declaredForms = /* @__PURE__ */ new Map();
  const ambiguousForms = /* @__PURE__ */ new Set();
  for (const key of declared) {
    const form = normalizeForm(key);
    if (declaredForms.has(form)) {
      ambiguousForms.add(form);
      declaredForms.delete(form);
    } else if (!ambiguousForms.has(form)) {
      declaredForms.set(form, key);
    }
  }
  const singulars = /* @__PURE__ */ new Map();
  for (const key of declared) {
    const form = normalizeForm(key);
    if (!form.endsWith("s")) continue;
    const singular = form.slice(0, -1);
    if (!singular || declaredForms.has(singular) || singular === form) continue;
    if (singulars.get(singular) !== void 0) singulars.delete(singular);
    else singulars.set(singular, key);
  }
  for (const form of ambiguousForms) singulars.delete(form);
  const numerics = new Set(explicit?.numerics ?? []);
  const numericArrays = new Set(explicit?.numericArrays ?? []);
  const values = /* @__PURE__ */ new Map();
  if (properties) {
    for (const [key, property] of Object.entries(properties)) {
      const kind = numericKind(property);
      if (kind === "scalar") numerics.add(key);
      else if (kind === "array") numericArrays.add(key);
      const enumValues = stringEnumValues(property);
      if (enumValues) values.set(key, new Map(deriveEnumValueMap(enumValues)));
    }
  }
  for (const [key, remaps] of Object.entries(explicit?.values ?? {})) {
    const map = values.get(key) ?? /* @__PURE__ */ new Map();
    for (const [spelling, target] of Object.entries(remaps)) {
      map.set(normalizeForm(spelling), target);
    }
    values.set(key, map);
  }
  return { declared, declaredForms, singulars, numerics, numericArrays, values, aliases: explicit?.aliases };
};
var lexiconRepair = (form, declaredForms) => {
  const candidates = /* @__PURE__ */ new Set();
  for (const classForms of KEY_CLASS_FORMS) {
    if (!classForms.has(form)) continue;
    for (const [declaredForm, declaredKey] of declaredForms) {
      if (declaredForm !== form && classForms.has(declaredForm)) {
        candidates.add(declaredKey);
      }
    }
  }
  return candidates.size === 1 ? [...candidates][0] : void 0;
};
var applyDerived = (args, derived) => {
  const out = { ...args };
  const repair = (alias, canonical) => {
    if (!(alias in out) || alias === canonical) return;
    if (!(canonical in out)) out[canonical] = out[alias];
    delete out[alias];
  };
  for (const [alias, canonical] of Object.entries(derived.aliases ?? {})) {
    repair(alias, canonical);
  }
  for (const key of [...Object.keys(out)]) {
    if (derived.declared.has(key)) continue;
    const form = normalizeForm(key);
    const canonical = derived.declaredForms.get(form) ?? derived.singulars.get(form) ?? lexiconRepair(form, derived.declaredForms);
    if (canonical && canonical !== key) repair(key, canonical);
  }
  for (const key of derived.numerics) {
    const value = out[key];
    if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
      out[key] = Number(value);
    }
  }
  for (const key of derived.numericArrays) {
    const value = out[key];
    if (Array.isArray(value)) {
      out[key] = value.map(
        (entry) => typeof entry === "string" && entry.trim() !== "" && !Number.isNaN(Number(entry)) ? Number(entry) : entry
      );
    }
  }
  for (const [key, remaps] of derived.values) {
    const value = out[key];
    if (typeof value === "string") {
      const next = remaps.get(normalizeForm(value));
      if (next !== void 0) out[key] = next;
    }
  }
  if (derived.declared.size > 0) {
    for (const key of Object.keys(out)) {
      if (derived.declared.has(key) && (out[key] === null || out[key] === void 0)) {
        delete out[key];
      }
    }
  }
  return out;
};
var actionArgNormalizer = (describeActions, table = {}) => {
  const derived = /* @__PURE__ */ new Map();
  for (const descriptor of describeActions()) {
    derived.set(
      descriptor.name,
      deriveAction(
        descriptor.inputSchema,
        table[descriptor.name]
      )
    );
  }
  return (actionName, args) => {
    if (!args || typeof args !== "object" || Array.isArray(args)) return args;
    const action = derived.get(actionName);
    return action ? applyDerived(args, action) : args;
  };
};

// src/kiro/model-inventory.ts
import { execFile } from "node:child_process";
var PROBE_TIMEOUT_MS = 15e3;
var cache = /* @__PURE__ */ new Map();
var inFlight = /* @__PURE__ */ new Map();
var AUTO_MODEL = {
  runner: "kiro",
  provider: "kiro",
  id: "auto",
  name: "auto",
  key: "kiro/auto",
  isDefault: true
};
var KIRO_MODEL_LIST_ARGUMENTS = [
  "chat",
  "--v3",
  "--list-models",
  "--format",
  "json"
];
var isRecord4 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var jsonModelRows = (value) => {
  if (Array.isArray(value)) return value;
  if (!isRecord4(value)) return [];
  for (const key of ["models", "availableModels", "items", "data"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate;
    if (isRecord4(candidate)) {
      const nested = jsonModelRows(candidate);
      if (nested.length > 0) return nested;
    }
  }
  return [];
};
var parseJsonModels = (output) => {
  let parsed;
  try {
    parsed = JSON.parse(output.trim());
  } catch {
    return [];
  }
  const root = isRecord4(parsed) ? parsed : void 0;
  const defaultId = typeof root?.default_model === "string" && root.default_model || typeof root?.defaultModel === "string" && root.defaultModel || void 0;
  return jsonModelRows(parsed).flatMap((value) => {
    const row = isRecord4(value) ? value : void 0;
    const id = typeof value === "string" ? value : typeof row?.id === "string" ? row.id : typeof row?.modelId === "string" ? row.modelId : typeof row?.model_id === "string" ? row.model_id : void 0;
    if (!id || !/^[a-z0-9][a-z0-9._-]*$/iu.test(id)) return [];
    const displayName = typeof row?.name === "string" && row.name.trim() || typeof row?.displayName === "string" && row.displayName.trim() || typeof row?.model_name === "string" && row.model_name.trim() || typeof row?.description === "string" && row.description.trim() || id;
    const rawMultiplier = row?.creditMultiplier ?? row?.credit_multiplier ?? row?.rate_multiplier ?? row?.rateMultiplier ?? row?.credits ?? row?.multiplier;
    const creditMultiplier = typeof rawMultiplier === "number" && Number.isFinite(rawMultiplier) ? rawMultiplier : typeof rawMultiplier === "string" && /^[0-9]+(?:\.[0-9]+)?x?$/i.test(rawMultiplier) ? Number(rawMultiplier.replace(/x$/i, "")) : void 0;
    return [{
      runner: "kiro",
      provider: "kiro",
      id,
      name: displayName === id ? id : `${id} \u2014 ${displayName}`,
      key: `kiro/${id}`,
      ...creditMultiplier !== void 0 ? { creditMultiplier } : {},
      isDefault: row?.isDefault === true || row?.default === true || row?.selected === true || id === defaultId || id === "auto"
    }];
  });
};
var parseKiroModelList = (output) => {
  const jsonEntries = parseJsonModels(output);
  if (jsonEntries.length > 0) return jsonEntries;
  const entries = [];
  for (const rawLine of output.split("\n")) {
    const line = rawLine.replace(/\s+$/g, "");
    const match2 = /^([* ]?)\s{0,4}([a-z0-9][a-z0-9._-]*)\s+((?:[0-9]+(?:\.[0-9]+)?x)|-----)\s+credits\s*(.*)$/iu.exec(line);
    if (!match2) continue;
    const [, marker, id, rawMultiplier, description] = match2;
    const multiplier = rawMultiplier;
    entries.push({
      runner: "kiro",
      provider: "kiro",
      id,
      name: description?.trim() ? `${id} \u2014 ${description.trim()}` : id,
      key: `kiro/${id}`,
      ...multiplier === "-----" ? {} : { creditMultiplier: Number(multiplier.slice(0, -1)) },
      isDefault: marker === "*"
    });
  }
  return entries;
};
var listKiroModels = (binary = "kiro-cli", refresh = false) => {
  const cached = cache.get(binary);
  if (cached && !refresh) return Promise.resolve(cached.entries);
  const active = inFlight.get(binary);
  if (active) return active;
  const probe = assertSupportedKiro(binary).then((identity) => new Promise((resolve) => {
    assertSupportedKiroUnchanged(identity);
    execFile(
      identity.executablePath,
      [...KIRO_MODEL_LIST_ARGUMENTS],
      { timeout: PROBE_TIMEOUT_MS, env: { ...process.env, NO_COLOR: "1", TERM: "dumb" } },
      (error, stdout, stderr) => {
        try {
          const parsed = error ? [] : parseKiroModelList(`${stdout}
${stderr}`.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, ""));
          resolve(parsed.length > 0 ? parsed : [{ ...AUTO_MODEL }]);
        } finally {
          identity.dispose();
        }
      }
    );
  })).catch(() => [{ ...AUTO_MODEL }]).then((entries) => {
    cache.set(binary, { entries, probedAt: Date.now() });
    return entries;
  });
  inFlight.set(binary, probe);
  void probe.finally(() => {
    if (inFlight.get(binary) === probe) inFlight.delete(binary);
  });
  return probe;
};

// src/kiro/model-router.ts
var SMALL_MODEL = "claude-haiku-4.5";
var CODE_MODEL = "qwen3-coder-next";
var COMPLEX_MODEL = "claude-opus-4.8";
var SMALL_THINKING = "low";
var CODE_THINKING = "low";
var COMPLEX_THINKING = "medium";
var DEFAULT_MODEL = "claude-opus-4.8";
var DEFAULT_THINKING = "medium";
var MAX_CLASSIFIED_TASK_CHARS = 8e3;
var SMALL_TASK_MAX_CHARS = 280;
var SIMPLE_TASK_MAX_CHARS = 500;
var COMPLEX_TASK_MIN_CHARS = 1200;
var CHEAP_EDIT_HINT = /\b(typo|spelling|punctuation|whitespace|copy[- ]?edit|rename|reformat)\b/iu;
var CODE_HINT = /\b(api|bug|build|class|code|codebase|compile|component|database|debug|dependency|edit|endpoint|error|fix|function|implement|implementation|lint|method|module|package|parse|parser|patch|query|refactor|repository|rewrite|schema|script|spec|test|typecheck)\b|\b(?:src|tests?|lib|packages?)\/|\b[\w./-]+\.(?:c|cc|cpp|css|go|html|java|js|jsx|json|md|mjs|py|rs|sh|sql|ts|tsx|yaml|yml)\b/iu;
var IMPLEMENTATION_HINT = /\b(build|code|debug|edit|fix|implement|implementation|patch|refactor|rewrite|test)\b/iu;
var COMPLEX_HINT = /\b(architect|architecture|audit|comprehensive|concurrency|deep[- ]?review|design|distributed|investigate|migration|optimi[sz]e|performance|race condition|root cause|security|strategy|threat model|trade[- ]?offs?)\b/iu;
var REVIEW_HINT = /\b(review|analyze|analysis|analy[sz]e|assess|inspect|evaluate|examine|verify|verification|diagnose|explain why|justify)\b/iu;
var SIMPLE_HINT = /\b(count|describe|explain|find|list|locate|read|reword|show|summari[sz]e|translate)\b/iu;
var REASONING_DENSITY_HINT = /\b(linearizable|correctness proof|prove|invariant|invariants|deadlock|livelock|data race|use[- ]after[- ]free|memory safety|cryptograph|protocol flaw|soundness|byzantine|formal|exploit|cve-)\b/iu;
var normalizeTask = (task) => task.slice(0, MAX_CLASSIFIED_TASK_CHARS).replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
var stepCount = (task) => (task.match(/(?:^|\n)\s*(?:[-*]|\d+[.)])\s+/gu) ?? []).length;
var resolveKiroTaskRoute = (task) => {
  const rawTask = task.slice(0, MAX_CLASSIFIED_TASK_CHARS);
  const normalized = normalizeTask(rawTask);
  if (!normalized) return {};
  const isSmall = normalized.length <= SMALL_TASK_MAX_CHARS;
  const isCheapEdit = CHEAP_EDIT_HINT.test(normalized);
  const isCode = CODE_HINT.test(normalized);
  const isImplementation = IMPLEMENTATION_HINT.test(normalized);
  const isReview = REVIEW_HINT.test(normalized);
  const isReasoningDense = REASONING_DENSITY_HINT.test(normalized);
  const isComplex = COMPLEX_HINT.test(normalized) || isReview || isReasoningDense || normalized.length >= COMPLEX_TASK_MIN_CHARS || stepCount(rawTask) >= 3;
  if (isSmall && isCheapEdit && !isComplex) {
    return { model: SMALL_MODEL, thinking: SMALL_THINKING };
  }
  if (isComplex && !isImplementation) {
    return { model: COMPLEX_MODEL, thinking: COMPLEX_THINKING };
  }
  if (isImplementation && (isReasoningDense || COMPLEX_HINT.test(normalized))) {
    return { model: COMPLEX_MODEL, thinking: COMPLEX_THINKING };
  }
  if (isCode) return { model: CODE_MODEL, thinking: CODE_THINKING };
  if (isComplex) return { model: COMPLEX_MODEL, thinking: COMPLEX_THINKING };
  if (isSmall || normalized.length <= SIMPLE_TASK_MAX_CHARS && SIMPLE_HINT.test(normalized)) {
    return { model: SMALL_MODEL, thinking: SMALL_THINKING };
  }
  return { model: DEFAULT_MODEL, thinking: DEFAULT_THINKING };
};

// src/kiro/agents-host.ts
var DEFAULT_WORKER_PATH = fileURLToPath3(new URL("./agent-worker-entry.js", import.meta.url));
var KIRO_PORTABLE_TOOLS = /* @__PURE__ */ new Set([
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls"
]);
var normalizeKiroAgentArgs = actionArgNormalizer(
  () => KIRO_AGENT_ACTION_DESCRIPTORS
);
var isTransport = (value) => value === "auto" || value === "process";
var stringArray = (value, label) => {
  if (value === void 0) return void 0;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value;
};
var isWithinOrEqual = (root, candidate) => {
  const child = relative(root, candidate);
  if (child === "" || child === ".") return true;
  if (isAbsolute(child)) return false;
  return child.split(sep2).filter(Boolean)[0] !== "..";
};
var progressLabel = (status) => {
  const currentTool = "currentTool" in status && status.currentTool ? ` \xB7 ${status.currentTool}` : "";
  return `Agent ${status.name}: ${status.status}${currentTool}`;
};
var createKiroAgentManager = (options) => {
  const cwd = resolveKiroProjectRoot(options.cwd);
  const defaultTools = options.config.defaultTools.filter(
    (tool) => KIRO_PORTABLE_TOOLS.has(tool)
  );
  return new KiroAgentManager(cwd, {
    ...options.config,
    runner: "kiro",
    defaultTools
  }, {
    workerPath: options.workerPath ?? DEFAULT_WORKER_PATH,
    ...options.runRoot ? { runRoot: options.runRoot } : {},
    projectRoot: cwd,
    ...options.kiroBinary ? { kiroBinary: options.kiroBinary } : {}
  });
};
var KiroAgentsProvider = class {
  constructor(manager, availableModelIds) {
    this.manager = manager;
    this.availableModelIds = availableModelIds;
  }
  name = "agents";
  description = "Up to four scoped, non-recursive Kiro CLI ACP children with trusted-shell verification";
  async list(request) {
    const query = request.query?.toLowerCase();
    const listed = query ? KIRO_AGENT_ACTION_DESCRIPTORS.filter(
      (descriptor) => `${descriptor.name} ${descriptor.description}`.toLowerCase().includes(query)
    ) : KIRO_AGENT_ACTION_DESCRIPTORS;
    return request.limit === void 0 ? listed : listed.slice(0, request.limit);
  }
  async describe(actionName) {
    return KIRO_AGENT_ACTION_DESCRIPTORS.find(
      (descriptor) => descriptor.name === actionName
    );
  }
  prepareArguments(actionName, args) {
    return normalizeKiroAgentArgs(actionName, args);
  }
  async #wait(id, context) {
    const pending = this.manager.wait(id);
    let previous = "";
    const report = () => {
      try {
        const message = progressLabel(this.manager.status(id));
        if (message === previous) return;
        previous = message;
        context.update(message);
      } catch {
      }
    };
    report();
    const timer = setInterval(report, 500);
    timer.unref?.();
    try {
      return await pending;
    } finally {
      clearInterval(timer);
      report();
    }
  }
  async #request(args, oneShot = false) {
    if (args.runner !== void 0 && args.runner !== "kiro") {
      throw new Error(
        `Managed Kiro can spawn only ACP-backed Kiro agents; received runner ${JSON.stringify(args.runner)}`
      );
    }
    if (args.residency === "durable") {
      throw new Error(
        "Managed Kiro supports session-local ACP children only; durable residency is unavailable"
      );
    }
    if (args.recursive === true) {
      throw new Error("Kiro ACP children cannot recursively spawn Fabric agents");
    }
    if (args.worktree === true) {
      throw new Error(
        "Managed Kiro ACP spawning does not support worktree creation; launch Kiro from the intended worktree instead"
      );
    }
    const task = typeof args.task === "string" ? args.task : "";
    if (!task.trim()) throw new Error("Agent task must not be empty");
    let cwd;
    if (typeof args.cwd === "string") {
      cwd = this.manager.resolveCwd(args.cwd);
      if (!isWithinOrEqual(this.manager.cwd, cwd) || cwd !== this.manager.cwd) {
        throw new Error(
          "Managed Kiro ACP children must use the directory where kiro-cli was launched"
        );
      }
    }
    const tools = stringArray(args.tools, "Kiro child tools");
    const transport = isTransport(args.transport) ? args.transport : void 0;
    const explicitThinking = isFabricThinking(args.thinking) ? args.thinking : void 0;
    const requestedModel = typeof args.model === "string" ? args.model.trim() : void 0;
    const explicitlyAuto = requestedModel?.toLowerCase() === "auto";
    const route = requestedModel ? void 0 : resolveKiroTaskRoute(task);
    const routedModelAvailable = !route?.model || new Set(
      this.availableModelIds ?? (await this.#models(false)).flatMap((entry) => typeof entry.id === "string" ? [entry.id] : [])
    ).has(route.model);
    const useKiroAuto = explicitlyAuto || !routedModelAvailable;
    const model = useKiroAuto ? void 0 : requestedModel || route?.model;
    const thinking = explicitThinking ?? (useKiroAuto ? void 0 : route?.thinking);
    const schema = typeof args.schema === "object" && args.schema !== null && !Array.isArray(args.schema) ? args.schema : void 0;
    const kiroContext = args.context === void 0 ? void 0 : normalizeKiroSemanticContext(args.context);
    return {
      task,
      runner: "kiro",
      ...oneShot ? { kiroResidency: "one-shot" } : {},
      ...useKiroAuto ? { suppressThinkingDefault: true } : {},
      ...typeof args.name === "string" ? { name: args.name } : {},
      ...transport ? { transport } : {},
      ...model ? { model } : {},
      ...thinking ? { thinking } : {},
      ...tools ? { tools } : {},
      ...typeof args.timeoutMs === "number" ? { timeoutMs: args.timeoutMs } : {},
      ...cwd ? { cwd } : {},
      ...schema ? { schema } : {},
      ...kiroContext ? { kiroContext } : {},
      residency: "session"
    };
  }
  async invoke(actionName, args, context) {
    switch (actionName) {
      case "run": {
        const handle = await this.manager.spawn(await this.#request(args, true), context.signal);
        context.activity?.({ type: "entity", id: handle.id, kind: "agent", name: handle.name });
        context.update(
          `Agent ${handle.name} started via kiro/${handle.transport} \xB7 model ${handle.model ?? "auto"}`
        );
        return this.#wait(handle.id, context);
      }
      case "spawn": {
        const handle = await this.manager.spawn(await this.#request(args), context.signal);
        this.manager.detachSignal(handle.id);
        context.activity?.({ type: "entity", id: handle.id, kind: "agent", name: handle.name });
        context.update(
          `Agent ${handle.name} started via kiro/${handle.transport} \xB7 model ${handle.model ?? "auto"}`
        );
        return handle;
      }
      case "wait": {
        const id = String(args.id);
        const status = this.manager.status(id);
        context.activity?.({ type: "entity", id, kind: "agent", name: status.name });
        return this.#wait(id, context);
      }
      case "status":
        return this.manager.status(String(args.id));
      case "list":
        return this.manager.list();
      case "models": {
        if (args.runner !== void 0 && args.runner !== "kiro") {
          throw new Error("Managed Kiro exposes model selection only for the Kiro runner");
        }
        return this.#models(args.refresh === true);
      }
      case "stop":
        return this.manager.stop(String(args.id));
      case "cleanup":
        return this.manager.cleanup(String(args.id));
      case "steer":
        return this.manager.steer(String(args.id), String(args.message), args.data);
      case "followUp":
        return this.manager.followUp(String(args.id), String(args.message), args.data);
      case "setSteeringMode":
        return this.manager.setSteeringMode(
          String(args.id),
          args.mode === "all" ? "all" : "one-at-a-time"
        );
      case "setFollowUpMode":
        return this.manager.setFollowUpMode(
          String(args.id),
          args.mode === "all" ? "all" : "one-at-a-time"
        );
      case "log": {
        return this.manager.readLog(String(args.id), {
          ...typeof args.lines === "number" ? { lines: args.lines } : {},
          ...typeof args.before === "number" ? { before: args.before } : {}
        });
      }
      default:
        throw new Error(
          `agents.${actionName} is unavailable in managed Kiro; only session-local ACP child operations are mounted`
        );
    }
  }
  async #models(refresh) {
    const binary = this.manager.kiroBinaryForDiscovery ?? "kiro-cli";
    return listKiroModels(binary, refresh);
  }
  async close() {
    await this.manager.close();
  }
};
var createKiroAgentsProvider = (options) => new KiroAgentsProvider(
  createKiroAgentManager(options),
  options.availableModelIds
);

// src/providers/mcp-provider.ts
import path12 from "node:path";

// src/providers/mcp-descriptor-cache.ts
import fs5 from "node:fs/promises";
import fsSync from "node:fs";
import os4 from "node:os";
import path10 from "node:path";
var MCP_DESCRIPTOR_CACHE_VERSION = 1;
var expandHome = (input) => {
  if (!input.startsWith("~")) return input;
  const home = os4.homedir();
  if (input === "~") return home;
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path10.join(home, input.slice(2));
  }
  return input;
};
var legacyMcporterDir = () => path10.join(os4.homedir(), ".mcporter");
var mcporterConfigDir = () => {
  const raw = process.env.XDG_CONFIG_HOME;
  if (raw && raw.trim().length > 0) {
    const resolved = expandHome(raw.trim());
    if (path10.isAbsolute(resolved)) return path10.join(resolved, "mcporter");
  }
  return legacyMcporterDir();
};
var mcporterConfigCandidates = () => {
  const base = mcporterConfigDir();
  const candidates = [path10.join(base, "mcporter.json"), path10.join(base, "mcporter.jsonc")];
  const legacy = legacyMcporterDir();
  if (base !== legacy) {
    candidates.push(path10.join(legacy, "mcporter.json"), path10.join(legacy, "mcporter.jsonc"));
  }
  return candidates;
};
var pathExists = (filePath) => {
  try {
    fsSync.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
};
var mcpConfigLayerPaths = (rootDir, configPath) => {
  const explicitRaw = configPath ?? process.env.MCPORTER_CONFIG;
  if (explicitRaw && explicitRaw.trim().length > 0) {
    return [path10.resolve(expandHome(explicitRaw.trim()))];
  }
  const paths = [];
  const home = mcporterConfigCandidates().find(pathExists);
  if (home) paths.push(home);
  const projectPath = path10.resolve(rootDir, "config", "mcporter.json");
  if (pathExists(projectPath)) paths.push(projectPath);
  return paths;
};
var statConfigLayers = async (rootDir, configPath) => {
  const stats = await Promise.all(
    mcpConfigLayerPaths(rootDir, configPath).map(async (layerPath) => {
      try {
        const stat = await fs5.stat(layerPath);
        return { path: layerPath, mtimeMs: stat.mtimeMs, size: stat.size };
      } catch {
        return void 0;
      }
    })
  );
  return stats.filter((stat) => stat !== void 0);
};
var sameConfigLayers = (left, right) => left.length === right.length && left.every((layer, index) => {
  const other = right[index];
  return other !== void 0 && layer.path === other.path && layer.size === other.size && Math.abs(layer.mtimeMs - other.mtimeMs) <= 1;
});
var hashServerDefinition = (definition) => stableJsonHash(definition);
var isRecord5 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var parseCachedServer = (value) => {
  if (!isRecord5(value)) return void 0;
  const tools = Array.isArray(value.tools) ? value.tools.filter(
    (tool) => isRecord5(tool) && typeof tool.name === "string"
  ) : void 0;
  if (typeof value.definitionHash !== "string" || tools === void 0) return void 0;
  return {
    definitionHash: value.definitionHash,
    transport: typeof value.transport === "string" ? value.transport : "unknown",
    description: typeof value.description === "string" ? value.description : null,
    fetchedAt: typeof value.fetchedAt === "string" ? value.fetchedAt : "",
    stale: value.stale === true,
    tools
  };
};

// src/providers/mcp-advisory.ts
import path11 from "node:path";

// src/providers/mcp-provider.ts
var TOOL_METADATA_TTL_MS = 6e4;
var REVALIDATE_CONCURRENCY = 3;
var REVALIDATE_SERVER_TIMEOUT_MS = 2e4;
var MIN_REVALIDATE_SERVER_TIMEOUT_MS = 5e3;
var NOTIFY_DEBOUNCE_MS = 100;
var PERSIST_DEBOUNCE_MS = 150;
var unambiguousRawNames = (names) => {
  const unique = [...new Set(names)];
  const counts = /* @__PURE__ */ new Map();
  for (const name of unique) {
    const alias = sanitizeMcpRefPart(name);
    counts.set(alias, (counts.get(alias) ?? 0) + 1);
  }
  return new Set(unique.filter((name) => counts.get(sanitizeMcpRefPart(name)) === 1));
};
var unambiguousTools = (tools) => {
  const names = unambiguousRawNames(tools.map((tool) => tool.name));
  return tools.filter((tool) => names.has(tool.name));
};
var emptyObjectSchema = {
  type: "object",
  properties: {},
  additionalProperties: false
};
var managementDescriptors = [
  {
    name: "$servers",
    description: "List MCP servers discovered by mcporter",
    inputSchema: emptyObjectSchema,
    risk: "read",
    namespace: "management"
  },
  {
    name: "$reload",
    description: "Close MCP connections and reload mcporter configuration",
    inputSchema: emptyObjectSchema,
    risk: "network",
    namespace: "management"
  },
  {
    name: "$register",
    description: "Register an ephemeral MCP server in the pooled mcporter runtime",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        command: { type: "string" },
        args: { type: "array", items: { type: "string" } },
        cwd: { type: "string" },
        baseUrl: { type: "string" },
        headers: { type: "object", additionalProperties: { type: "string" } },
        env: { type: "object", additionalProperties: { type: "string" } },
        overwrite: { type: "boolean" }
      },
      required: ["name"],
      additionalProperties: false
    },
    risk: "execute",
    namespace: "management"
  },
  {
    name: "$call",
    description: "Call an MCP tool by explicit server and tool name",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string" },
        tool: { type: "string" },
        args: { type: "object", additionalProperties: true }
      },
      required: ["server", "tool"],
      additionalProperties: false
    },
    risk: "network",
    namespace: "management"
  }
];
var normalizeSchema = (schema) => typeof schema === "object" && schema !== null && !Array.isArray(schema) ? schema : emptyObjectSchema;
var normalizeMcpResult = (result) => {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return result;
  const record = result;
  if (!Array.isArray(record.content)) return result;
  const text = record.content.filter(
    (part) => typeof part === "object" && part !== null && part.type === "text" && typeof part.text === "string"
  ).map((part) => part.text).join("\n");
  if (record.isError === true) throw new Error(text || "MCP tool returned an error");
  return {
    text,
    content: record.content,
    structuredContent: record.structuredContent ?? null
  };
};
var withTimeout = (operation, timeoutMs, onTimeout) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    onTimeout?.();
    reject(new Error(`MCP server listing timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  timer.unref?.();
  operation.then(
    (value) => {
      clearTimeout(timer);
      resolve(value);
    },
    (error) => {
      clearTimeout(timer);
      reject(error);
    }
  );
});
var McpProvider = class {
  constructor(cwd, config, options = {}) {
    this.cwd = cwd;
    this.config = config;
    this.#store = options.cache;
    this.#hooks = options.hooks ?? {};
  }
  name = "mcp";
  description = "External MCP tools discovered and pooled by mcporter";
  #runtime;
  #runtimeCreation;
  #toolMetadata = /* @__PURE__ */ new Map();
  // Completed legacy listings only. Direct mcp.<server>.<tool> resolution must
  // never turn a cache miss into server contact before the registry can gate
  // the call; cold callers use the statically described mcp.call facade.
  #legacyToolSnapshots = /* @__PURE__ */ new Map();
  #store;
  #hooks;
  #generation = 0;
  #closed = false;
  #hydration;
  #layerStats = [];
  #servers = /* @__PURE__ */ new Map();
  #pending = /* @__PURE__ */ new Map();
  #revalidateQueue = [];
  #revalidateQueued = /* @__PURE__ */ new Set();
  #recontacted = /* @__PURE__ */ new Set();
  #revalidating;
  #autoKicked = false;
  #dirtyPersist = false;
  #dirtyNotify = false;
  #persistTimer;
  #notifyTimer;
  get #cacheOn() {
    return this.config.cache.enabled;
  }
  async list(request, context) {
    if (!this.config.enabled) return [];
    if (!this.#cacheOn) return this.#listLegacy(request, context);
    await this.#hydrate();
    this.#kickRevalidation();
    const query = request.query?.toLowerCase();
    const filterQuery = (descriptors4) => query ? descriptors4.filter(
      (descriptor) => `${descriptor.name} ${descriptor.description}`.toLowerCase().includes(query)
    ) : descriptors4;
    if (request.namespace) {
      const server = await this.#resolveKnownServer(request.namespace);
      if (!server) return [];
      let entry = this.#servers.get(server);
      if (!entry) {
        entry = await this.#fetchServerTools(server).catch(() => void 0);
        if (!entry) return [];
      }
      return filterQuery(unambiguousTools(entry.tools).map((tool) => this.#toolDescriptor(server, tool)));
    }
    return [
      ...managementDescriptors,
      ...filterQuery(this.sliceDescriptors())
    ];
  }
  async describe(actionName, context) {
    const management = managementDescriptors.find((descriptor) => descriptor.name === actionName);
    if (management) return management;
    if (!this.config.enabled) return void 0;
    if (!this.#cacheOn) return this.#describeLegacy(actionName, context);
    const parsed = this.#parseToolName(actionName);
    if (!parsed) return void 0;
    await this.#hydrate();
    const server = await this.#resolveKnownServer(parsed.server);
    if (!server) return void 0;
    const entry = this.#servers.get(server);
    const tool = entry ? this.#resolveTool(entry.tools, parsed.tool) : void 0;
    return tool ? this.#toolDescriptor(server, tool) : void 0;
  }
  async invoke(actionName, args, context) {
    if (!this.config.enabled) throw new Error("MCP support is disabled in Fabric configuration");
    if (actionName === "$servers") {
      const runtime = await this.#getRuntime();
      return runtime.listServers().map((server) => {
        const definition = runtime.getDefinition(server);
        if (!this.#cacheOn) {
          return {
            name: server,
            description: definition.description ?? null,
            transport: definition.command.kind
          };
        }
        const entry = this.#servers.get(server);
        return {
          name: server,
          description: definition.description ?? null,
          transport: definition.command.kind,
          tools: entry?.tools.length ?? 0,
          stale: entry === void 0 || entry.stale
        };
      });
    }
    if (actionName === "$reload") {
      await this.#resetRuntime();
      if (this.#cacheOn) {
        this.#servers.clear();
        this.#pending.clear();
        this.#recontacted.clear();
        this.#hydration = void 0;
        await this.#hydrate();
        this.#kickRevalidation(true);
      }
      return { servers: (await this.#getRuntime()).listServers() };
    }
    if (actionName === "$register") {
      if (!this.config.allowDynamicServers) {
        throw new Error("Dynamic MCP server registration is disabled in Fabric configuration");
      }
      const definition = this.#serverDefinition(args);
      const runtime = await this.#getRuntime();
      runtime.registerDefinition(definition, { overwrite: args.overwrite === true });
      this.#toolMetadata.delete(definition.name);
      if (this.#cacheOn) {
        void this.#hydrate().then(() => {
          this.#servers.delete(definition.name);
          this.#pending.set(definition.name, {
            definitionHash: hashServerDefinition(definition),
            transport: definition.command.kind,
            description: definition.description ?? null,
            ephemeral: true
          });
          this.#scheduleRevalidate([definition.name]);
        }).catch(() => void 0);
      }
      return { registered: definition.name };
    }
    if (actionName === "$call") {
      const server = String(args.server);
      const tool = String(args.tool);
      const toolArgs = typeof args.args === "object" && args.args !== null && !Array.isArray(args.args) ? args.args : {};
      return this.#call(server, tool, toolArgs, context.signal, {
        preferExactRaw: true,
        validateInputSchema: true,
        allowDiscovery: true
      });
    }
    const parsed = this.#parseToolName(actionName);
    if (!parsed) throw new Error(`Invalid MCP action: ${actionName}`);
    return this.#call(parsed.server, parsed.tool, args, context.signal);
  }
  /** Resolve transport from configuration only; this never connects or lists tools. */
  async configuredServerTransport(requested) {
    const runtime = await this.#getRuntime();
    const server = this.#resolveServerName(runtime, requested);
    if (!server) return void 0;
    const kind = runtime.getDefinition(server).command.kind;
    return kind === "stdio" || kind === "http" ? kind : void 0;
  }
  async close() {
    this.#closed = true;
    this.#revalidateQueue.length = 0;
    this.#revalidateQueued.clear();
    if (this.#notifyTimer) clearTimeout(this.#notifyTimer);
    if (this.#persistTimer) clearTimeout(this.#persistTimer);
    this.#notifyTimer = void 0;
    this.#persistTimer = void 0;
    if (this.#dirtyPersist) await this.#persistNow().catch(() => void 0);
    await this.#resetRuntime();
  }
  // Fire-and-forget session warm-up: hydrate from the descriptor cache, then
  // start the background revalidation policy. Never awaited by session start.
  warmup() {
    if (!this.config.enabled || !this.#cacheOn) return;
    void this.#hydrate().then(() => this.#kickRevalidation()).catch(() => void 0);
  }
  // Provider-fidelity descriptors for everything currently known, cached or
  // ephemeral. Advisory consumers wrap entries with toMcpAdvisoryDescriptor.
  sliceDescriptors() {
    const descriptors4 = [];
    const visibleServers = unambiguousRawNames([
      ...this.#servers.keys(),
      ...this.#pending.keys()
    ]);
    for (const [server, entry] of this.#servers) {
      if (!visibleServers.has(server)) continue;
      for (const tool of unambiguousTools(entry.tools)) {
        descriptors4.push(this.#toolDescriptor(server, tool));
      }
    }
    return descriptors4;
  }
  // Test/ops hook: await hydration and any in-flight background revalidation,
  // then flush pending persistence and notifications.
  async settle() {
    await this.#hydrate();
    while (this.#revalidating) await this.#revalidating;
    if (this.#notifyTimer) {
      clearTimeout(this.#notifyTimer);
      this.#notifyTimer = void 0;
    }
    if (this.#dirtyNotify) this.#notifyNow();
    if (this.#persistTimer) {
      clearTimeout(this.#persistTimer);
      this.#persistTimer = void 0;
    }
    if (this.#dirtyPersist) await this.#persistNow().catch(() => void 0);
  }
  async #call(serverName, toolName, args, signal, options = {}) {
    const preferExactRaw = options.preferExactRaw === true;
    if (!this.#cacheOn) return this.#callLegacy(serverName, toolName, args, signal, options);
    if (signal?.aborted) throw new Error("MCP call cancelled");
    await this.#hydrate();
    const server = await this.#resolveKnownServer(serverName, preferExactRaw);
    if (!server) throw new Error(`Unknown MCP server: ${serverName}`);
    let entry = this.#servers.get(server);
    let tool = entry ? this.#resolveTool(entry.tools, toolName, preferExactRaw) : void 0;
    if (!tool && options.allowDiscovery) {
      entry = await this.#fetchServerTools(server).catch(() => void 0);
      tool = entry ? this.#resolveTool(entry.tools, toolName, preferExactRaw) : void 0;
    }
    if (signal?.aborted) throw new Error("MCP call cancelled");
    if (!tool) throw new Error(`Unknown MCP tool: ${serverName}.${toolName}`);
    if (options.validateInputSchema) this.#validateExplicitCallArgs(tool, args);
    try {
      this.#hooks.onToolUse?.(server);
    } catch {
    }
    const runtime = await this.#getRuntime();
    const firstContact = !this.#recontacted.has(server);
    if (firstContact) this.#recontacted.add(server);
    const operation = runtime.callTool(server, tool.name, {
      args,
      timeoutMs: this.config.callTimeoutMs,
      disableOAuth: this.config.disableOAuth
    });
    try {
      const result = await this.#withAbort(operation, signal, () => runtime.close(server));
      return normalizeMcpResult(result);
    } catch (error) {
      const existing = this.#servers.get(server);
      if (existing) {
        existing.stale = true;
        this.#schedulePersist();
        this.#scheduleNotify();
      }
      this.#scheduleRevalidate([server]);
      throw error;
    } finally {
      if (firstContact) this.#scheduleRevalidate([server]);
    }
  }
  async #withAbort(operation, signal, abort) {
    if (!signal) return operation;
    if (signal.aborted) throw new Error("MCP call cancelled");
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        void Promise.resolve(abort()).catch(() => void 0);
        reject(new Error("MCP call cancelled"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      void operation.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        }
      );
    });
  }
  // Session-opening hydration: adopt the persisted descriptor cache. Never
  // spawns a server — config-only operations at worst.
  #hydrate() {
    if (!this.#cacheOn) return Promise.resolve();
    this.#hydration ??= this.#hydrateInternal().catch(() => void 0);
    return this.#hydration;
  }
  async #hydrateInternal() {
    const generation = this.#generation;
    const snapshot2 = this.#store ? await this.#store.load().catch(() => void 0) : void 0;
    this.#layerStats = await statConfigLayers(this.cwd, this.config.configPath);
    if (generation !== this.#generation) return;
    if (snapshot2 && sameConfigLayers(snapshot2.layers, this.#layerStats)) {
      for (const [name, raw] of Object.entries(snapshot2.servers)) {
        const parsed = parseCachedServer(raw);
        if (parsed) this.#servers.set(name, this.#toWorking(parsed, false));
      }
      this.#scheduleNotify();
      return;
    }
    try {
      const runtime = await this.#getRuntime();
      for (const definition of runtime.getDefinitions()) {
        const hash = hashServerDefinition(definition);
        const recorded = snapshot2?.servers[definition.name];
        const parsed = recorded ? parseCachedServer(recorded) : void 0;
        if (parsed && parsed.definitionHash === hash) {
          this.#servers.set(definition.name, this.#toWorking(parsed, false));
        } else {
          const existing = this.#pending.get(definition.name);
          this.#pending.set(definition.name, {
            definitionHash: hash,
            transport: definition.command.kind,
            description: definition.description ?? null,
            ephemeral: existing?.ephemeral ?? false
          });
        }
      }
      this.#dirtyPersist = true;
      this.#schedulePersist();
    } catch {
      if (snapshot2) {
        for (const [name, raw] of Object.entries(snapshot2.servers)) {
          const parsed = parseCachedServer(raw);
          if (parsed && !this.#servers.has(name)) {
            this.#servers.set(name, this.#toWorking(parsed, false));
          }
        }
        console.warn(
          "[kiro-fabric] MCP config could not be parsed; serving last-known cached MCP tools."
        );
      }
    }
    this.#scheduleNotify();
  }
  #toWorking(cached, ephemeral) {
    return {
      definitionHash: cached.definitionHash,
      transport: cached.transport,
      description: cached.description,
      fetchedAt: cached.fetchedAt,
      stale: cached.stale,
      ephemeral,
      tools: cached.tools.map((tool) => ({ ...tool }))
    };
  }
  #kickRevalidation(forceAll = false) {
    if (this.#closed || !this.#cacheOn) return;
    if (!forceAll && this.#autoKicked) return;
    this.#autoKicked = true;
    const policy = this.config.cache.revalidate;
    if (policy === "off" && !forceAll) return;
    const targets = forceAll || policy === "all" ? [...this.#servers.keys(), ...this.#pending.keys()] : [...this.#pending.keys()];
    this.#scheduleRevalidate(targets);
  }
  #scheduleRevalidate(servers) {
    if (this.#closed || !this.#cacheOn) return;
    for (const server of servers) {
      if (this.#revalidateQueued.has(server)) continue;
      this.#revalidateQueued.add(server);
      this.#revalidateQueue.push(server);
    }
    if (this.#revalidating || this.#revalidateQueue.length === 0) return;
    this.#revalidating = this.#drainRevalidation().catch(() => void 0).finally(() => {
      this.#revalidating = void 0;
      if (this.#revalidateQueue.length > 0 && !this.#closed) this.#scheduleRevalidate([]);
    });
    void this.#revalidating;
  }
  async #drainRevalidation() {
    const generation = this.#generation;
    const deadline = Date.now() + Math.max(1e3, this.config.cache.revalidateBudgetMs);
    const perServerTimeout = Math.max(
      MIN_REVALIDATE_SERVER_TIMEOUT_MS,
      Math.min(REVALIDATE_SERVER_TIMEOUT_MS, this.config.cache.revalidateBudgetMs)
    );
    while (!this.#closed && generation === this.#generation) {
      if (Date.now() > deadline) break;
      const batch = [];
      while (batch.length < REVALIDATE_CONCURRENCY && this.#revalidateQueue.length > 0) {
        const next = this.#revalidateQueue.shift();
        if (next === void 0) break;
        this.#revalidateQueued.delete(next);
        batch.push(next);
      }
      if (batch.length === 0) break;
      const results = await Promise.allSettled(
        batch.map((server) => this.#fetchServerTools(server, perServerTimeout))
      );
      results.forEach((result, index) => {
        if (result.status !== "rejected") return;
        const server = batch[index];
        if (server === void 0) return;
        const existing = this.#servers.get(server);
        if (existing) {
          existing.stale = true;
          this.#schedulePersist();
          this.#scheduleNotify();
        }
      });
    }
  }
  // Live tool listing for exactly one server; on success updates the working
  // copy, persistence, and advisory slice. Used by the background revalidator
  // and by explicit single-server fetches.
  async #fetchServerTools(server, timeoutMs) {
    const generation = this.#generation;
    const runtime = await this.#getRuntime();
    const listing = runtime.listTools(server, {
      includeSchema: true,
      disableOAuth: this.config.disableOAuth
    });
    const tools = timeoutMs === void 0 ? await listing : await withTimeout(listing, timeoutMs, () => {
      void runtime.close(server).catch(() => void 0);
    });
    if (generation !== this.#generation || this.#closed) {
      throw new Error(`MCP server listing superseded: ${server}`);
    }
    let definition;
    try {
      definition = runtime.getDefinition(server);
    } catch {
      this.#pending.delete(server);
      this.#servers.delete(server);
      this.#schedulePersist();
      this.#scheduleNotify();
      throw new Error(`Unknown MCP server: ${server}`);
    }
    const pending = this.#pending.get(server);
    const entry = {
      definitionHash: hashServerDefinition(definition),
      transport: definition.command.kind,
      description: definition.description ?? null,
      fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
      stale: false,
      ephemeral: pending?.ephemeral ?? false,
      tools
    };
    this.#servers.set(server, entry);
    this.#pending.delete(server);
    this.#schedulePersist();
    this.#scheduleNotify();
    return entry;
  }
  // Resolve a requested (possibly sanitized) name to the raw server name
  // across the working copy, pending set, and — as a config-only fallback —
  // the runtime's definition list.
  async #resolveKnownServer(requested, preferExactRaw = false) {
    const runtime = await this.#getRuntime();
    const servers = [.../* @__PURE__ */ new Set([
      ...this.#servers.keys(),
      ...this.#pending.keys(),
      ...runtime.listServers()
    ])];
    if (preferExactRaw && servers.includes(requested)) return requested;
    const aliases = servers.filter((name) => sanitizeMcpRefPart(name) === requested);
    if (aliases.length > 0) return aliases.length === 1 ? aliases[0] : void 0;
    return servers.includes(requested) ? requested : void 0;
  }
  #schedulePersist() {
    if (!this.#store || this.#closed) return;
    this.#dirtyPersist = true;
    if (this.#persistTimer) return;
    this.#persistTimer = setTimeout(() => {
      this.#persistTimer = void 0;
      void this.#persistNow().catch(() => void 0);
    }, PERSIST_DEBOUNCE_MS);
    this.#persistTimer.unref?.();
  }
  #persistNow() {
    this.#dirtyPersist = false;
    if (!this.#store) return Promise.resolve();
    const servers = {};
    for (const [name, entry] of this.#servers) {
      if (entry.ephemeral) continue;
      servers[name] = {
        definitionHash: entry.definitionHash,
        transport: entry.transport,
        description: entry.description,
        fetchedAt: entry.fetchedAt,
        stale: entry.stale,
        tools: entry.tools.map((tool) => ({
          name: tool.name,
          ...tool.description !== void 0 ? { description: tool.description } : {},
          ...tool.inputSchema !== void 0 ? { inputSchema: tool.inputSchema } : {},
          ...tool.outputSchema !== void 0 ? { outputSchema: tool.outputSchema } : {}
        }))
      };
    }
    return this.#store.save({
      version: MCP_DESCRIPTOR_CACHE_VERSION,
      layers: this.#layerStats,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      servers
    });
  }
  #scheduleNotify() {
    if (this.#closed) return;
    this.#dirtyNotify = true;
    if (this.#notifyTimer) return;
    this.#notifyTimer = setTimeout(() => {
      this.#notifyTimer = void 0;
      this.#notifyNow();
    }, NOTIFY_DEBOUNCE_MS);
    this.#notifyTimer.unref?.();
  }
  #notifyNow() {
    if (!this.#dirtyNotify || this.#closed) return;
    this.#dirtyNotify = false;
    try {
      this.#hooks.onSliceChanged?.(this.sliceDescriptors());
    } catch {
    }
  }
  async #getRuntime() {
    if (this.#closed) throw new Error("MCP provider is closed");
    if (this.#runtime) return this.#runtime;
    const generation = this.#generation;
    if (this.#runtimeCreation?.generation === generation) {
      return this.#runtimeCreation.promise;
    }
    const promise = import("./dist-DZGRWJGK.js").then(({ createRuntime }) => createRuntime({
      rootDir: this.cwd,
      ...this.config.configPath ? { configPath: this.config.configPath } : {},
      clientInfo: { name: "kiro-fabric", version: "0.1.0" }
    })).then(async (runtime) => {
      if (this.#closed || generation !== this.#generation) {
        await runtime.close().catch(() => void 0);
        throw new Error("MCP runtime creation was superseded");
      }
      this.#runtime = runtime;
      return runtime;
    });
    const creation = { generation, promise };
    this.#runtimeCreation = creation;
    void promise.finally(() => {
      if (this.#runtimeCreation === creation) this.#runtimeCreation = void 0;
    }).catch(() => void 0);
    return promise;
  }
  async #resetRuntime() {
    this.#generation += 1;
    const runtime = this.#runtime;
    const creation = this.#runtimeCreation?.promise;
    this.#runtime = void 0;
    this.#runtimeCreation = void 0;
    this.#toolMetadata.clear();
    this.#legacyToolSnapshots.clear();
    await Promise.allSettled([
      runtime?.close() ?? Promise.resolve(),
      creation?.then(() => void 0, () => void 0) ?? Promise.resolve()
    ]);
  }
  #serverDefinition(args) {
    const name = String(args.name ?? "").trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
      throw new Error("Dynamic MCP server names may contain letters, numbers, dots, underscores, and hyphens");
    }
    const description = typeof args.description === "string" ? args.description : void 0;
    const env = this.#stringRecord(args.env);
    if (typeof args.command === "string" && args.command.trim()) {
      const commandArgs = Array.isArray(args.args) ? args.args.filter((value) => typeof value === "string") : [];
      return {
        name,
        ...description ? { description } : {},
        command: {
          kind: "stdio",
          command: args.command,
          args: commandArgs,
          cwd: path12.resolve(this.cwd, typeof args.cwd === "string" ? args.cwd : ".")
        },
        ...env ? { env } : {}
      };
    }
    if (typeof args.baseUrl === "string" && args.baseUrl.trim()) {
      const headers = this.#stringRecord(args.headers);
      return {
        name,
        ...description ? { description } : {},
        command: {
          kind: "http",
          url: new URL(args.baseUrl),
          ...headers ? { headers } : {}
        },
        ...env ? { env } : {}
      };
    }
    throw new Error("Dynamic MCP registration requires either command or baseUrl");
  }
  #stringRecord(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
    const entries = Object.entries(value);
    if (entries.some((entry) => typeof entry[1] !== "string")) {
      throw new Error("MCP environment and header values must be strings");
    }
    return Object.fromEntries(entries);
  }
  #resolveServerName(runtime, requested, preferExactRaw = false) {
    const servers = runtime.listServers();
    if (preferExactRaw && servers.includes(requested)) return requested;
    const aliases = servers.filter((server) => sanitizeMcpRefPart(server) === requested);
    if (aliases.length > 0) return aliases.length === 1 ? aliases[0] : void 0;
    return servers.includes(requested) ? requested : void 0;
  }
  #resolveTool(tools, requested, preferExactRaw = false) {
    if (preferExactRaw) {
      const exact = tools.find((tool) => tool.name === requested);
      if (exact) return exact;
    }
    const aliases = tools.filter((tool) => sanitizeMcpRefPart(tool.name) === requested);
    if (aliases.length > 0) return aliases.length === 1 ? aliases[0] : void 0;
    return tools.find((tool) => tool.name === requested);
  }
  #parseToolName(actionName) {
    const separator = actionName.indexOf(".");
    if (separator <= 0 || separator === actionName.length - 1) return void 0;
    return { server: actionName.slice(0, separator), tool: actionName.slice(separator + 1) };
  }
  #toolDescriptor(server, tool) {
    return {
      name: `${server}.${tool.name}`,
      description: tool.description ?? `${tool.name} on MCP server ${server}`,
      inputSchema: normalizeSchema(tool.inputSchema),
      ...tool.outputSchema ? { outputSchema: normalizeSchema(tool.outputSchema) } : {},
      risk: "network",
      namespace: server
    };
  }
  // Live-everything path preserved for mcp.cache.enabled: false — the
  // pre-cache behavior with its 60s in-process metadata TTL.
  async #listLegacy(request, _context) {
    const runtime = await this.#getRuntime();
    const resolvedNamespace = request.namespace ? this.#resolveServerName(runtime, request.namespace) : void 0;
    const configuredServers = runtime.listServers();
    const visibleServers = unambiguousRawNames(configuredServers);
    const servers = request.namespace ? resolvedNamespace === void 0 ? [] : [resolvedNamespace] : configuredServers.filter((server) => visibleServers.has(server));
    const settled = await Promise.allSettled(
      servers.map(async (server) => {
        const tools = await this.#listToolsLegacy(runtime, server, false, _context.signal);
        return unambiguousTools(tools).map((tool) => this.#toolDescriptor(server, tool));
      })
    );
    const descriptors4 = settled.flatMap(
      (entry) => entry.status === "fulfilled" ? entry.value : []
    );
    const query = request.query?.toLowerCase();
    const filtered = query ? descriptors4.filter(
      (descriptor) => `${descriptor.name} ${descriptor.description}`.toLowerCase().includes(query)
    ) : descriptors4;
    return request.namespace ? filtered : [...managementDescriptors, ...filtered];
  }
  async #describeLegacy(actionName, _context) {
    const parsed = this.#parseToolName(actionName);
    if (!parsed) return void 0;
    const runtime = await this.#getRuntime();
    const server = this.#resolveServerName(runtime, parsed.server);
    if (!server) return void 0;
    const tools = this.#legacyToolSnapshots.get(server);
    if (!tools) return void 0;
    const tool = this.#resolveTool(tools, parsed.tool);
    return tool ? this.#toolDescriptor(server, tool) : void 0;
  }
  async #callLegacy(serverName, toolName, args, signal, options = {}) {
    if (signal?.aborted) throw new Error("MCP call cancelled");
    const preferExactRaw = options.preferExactRaw === true;
    const runtime = await this.#getRuntime();
    const server = this.#resolveServerName(runtime, serverName, preferExactRaw);
    if (!server) throw new Error(`Unknown MCP server: ${serverName}`);
    const tool = options.allowDiscovery ? await this.#findToolLegacy(runtime, server, toolName, signal, preferExactRaw) : this.#resolveTool(this.#legacyToolSnapshots.get(server) ?? [], toolName, preferExactRaw);
    if (signal?.aborted) throw new Error("MCP call cancelled");
    if (!tool) throw new Error(`Unknown MCP tool: ${serverName}.${toolName}`);
    if (options.validateInputSchema) this.#validateExplicitCallArgs(tool, args);
    const operation = runtime.callTool(server, tool.name, {
      args,
      timeoutMs: this.config.callTimeoutMs,
      disableOAuth: this.config.disableOAuth
    });
    try {
      const result = await this.#withAbort(operation, signal, () => runtime.close(server));
      return normalizeMcpResult(result);
    } catch (error) {
      this.#toolMetadata.delete(server);
      this.#legacyToolSnapshots.delete(server);
      throw error;
    }
  }
  #validateExplicitCallArgs(tool, args) {
    const validation = validateSchemaValue(tool.inputSchema, args, {
      pathPrefix: "/args",
      includeInstancePath: true
    });
    if (validation.status !== "invalid") return;
    throw new FabricTraceSafeError(
      `Invalid arguments for mcp.call: ${validation.message}`
    );
  }
  async #listToolsLegacy(runtime, server, refresh = false, signal) {
    const cached = this.#toolMetadata.get(server);
    if (!refresh && cached && cached.expiresAt > Date.now()) {
      return this.#withAbort(cached.promise, signal, () => runtime.close(server));
    }
    const promise = withTimeout(
      runtime.listTools(server, {
        includeSchema: true,
        disableOAuth: this.config.disableOAuth
      }),
      Math.min(this.config.callTimeoutMs, REVALIDATE_SERVER_TIMEOUT_MS),
      () => {
        void runtime.close(server).catch(() => void 0);
      }
    );
    const entry = { expiresAt: Date.now() + TOOL_METADATA_TTL_MS, promise };
    this.#toolMetadata.set(server, entry);
    try {
      const tools = await this.#withAbort(promise, signal, () => runtime.close(server));
      this.#legacyToolSnapshots.set(server, tools);
      return tools;
    } catch (error) {
      if (this.#toolMetadata.get(server) === entry) this.#toolMetadata.delete(server);
      throw error;
    }
  }
  async #findToolLegacy(runtime, server, requested, signal, preferExactRaw = false) {
    const cached = this.#resolveTool(
      await this.#listToolsLegacy(runtime, server, false, signal),
      requested,
      preferExactRaw
    );
    if (cached) return cached;
    return this.#resolveTool(
      await this.#listToolsLegacy(runtime, server, true, signal),
      requested,
      preferExactRaw
    );
  }
};

// src/kiro/mcp-provider.ts
var descriptors = [
  {
    name: "$servers",
    description: "List MCP servers configured for this project without connecting to them",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    risk: "read",
    namespace: "management"
  },
  {
    name: "$call",
    description: "Call one configured MCP tool after network approval; stdio servers also require execute approval",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string", minLength: 1 },
        tool: { type: "string", minLength: 1 },
        args: { type: "object", additionalProperties: true }
      },
      required: ["server", "tool"],
      additionalProperties: false
    },
    risk: "network",
    namespace: "management"
  }
];
var KiroMcpProvider = class {
  name = "mcp";
  description = "On-demand calls to explicitly configured MCP servers (no background contact or dynamic registration)";
  #delegate;
  constructor(cwd, config) {
    this.#delegate = new McpProvider(cwd, {
      ...config,
      allowDynamicServers: false,
      cache: {
        ...config.cache,
        // This facade never delegates list/describe, so the legacy metadata
        // path is still approval-safe and avoids the shared cache provider's
        // post-call background revalidation.
        enabled: false,
        revalidate: "off"
      }
    });
  }
  async list(request, _context) {
    const query = request.query?.normalize("NFKC").trim().toLowerCase();
    const filtered = query ? descriptors.filter(
      (descriptor) => `${descriptor.name} ${descriptor.description}`.toLowerCase().includes(query)
    ) : descriptors;
    return filtered.slice(0, Math.max(1, Math.min(request.limit ?? 100, 100)));
  }
  async describe(actionName, _context) {
    return descriptors.find((descriptor) => descriptor.name === actionName);
  }
  async invoke(actionName, args, context) {
    if (actionName !== "$servers" && actionName !== "$call") {
      throw new Error(
        "Managed Kiro MCP federation requires mcp.call({ server, tool, args }); dynamic server/tool paths are not exposed"
      );
    }
    if (actionName === "$call") {
      const server = String(args.server);
      const transport = await this.#delegate.configuredServerTransport(server);
      if (!transport) {
        throw new Error(`Unknown or unsupported configured MCP server: ${server}`);
      }
      if (transport === "stdio") {
        const approval = context;
        if (!approval.approve) {
          throw new Error("stdio MCP execution approval is unavailable; refusing to start server");
        }
        const stdioAction = {
          name: "$stdio",
          ref: "mcp.$stdio",
          provider: "mcp",
          description: "Start a configured stdio MCP server executable",
          inputSchema: descriptors[1].inputSchema,
          risk: "execute",
          namespace: "management"
        };
        const lease = await approval.approve(stdioAction, args, approval.approvalScope);
        lease.consume(stdioAction, args, approval.approvalScope);
      }
    }
    return this.#delegate.invoke(actionName, args, context);
  }
  async close() {
    await this.#delegate.close();
  }
};

// src/kiro/memory-provider.ts
import fs7 from "node:fs";
import path14 from "node:path";

// src/kiro/memory.ts
import crypto2 from "node:crypto";
import fs6 from "node:fs";
import path13 from "node:path";
var DEFAULT_MAX_NAMESPACE_ENTRIES = 128;
var DEFAULT_MAX_NAMESPACE_BYTES = 256 * 1024;
var DEFAULT_MAX_ENTRY_BYTES = 16 * 1024;
var MEMORY_DIR = "memory";
var MEMORY_OWNER = "kiro-fabric";
var MEMORY_FORMAT = 1;
var OWNERSHIP_MARKER = ".kiro-fabric-owner";
var MAX_FILE_NAME_BYTES = 240;
var MUTATION_LOCK = ".kiro-fabric-mutation-lock";
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
var hashNamespace = (namespace) => crypto2.createHash("sha256").update(namespace).digest("hex").slice(0, 16);
var isWithinOrEqual2 = (root, candidate) => {
  const relative2 = path13.relative(root, candidate);
  if (relative2 === "" || relative2 === ".") return true;
  if (path13.isAbsolute(relative2)) return false;
  return relative2.split(path13.sep).filter(Boolean)[0] !== "..";
};
var lstatOrNull = (target) => {
  try {
    return fs6.lstatSync(target);
  } catch {
    return null;
  }
};
var errorCode = (error) => error instanceof Error && "code" in error ? String(error.code) : void 0;
var delay2 = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
var withNamespaceMutationLock = async (namespaceRoot, operation) => {
  const lockPath = path13.join(namespaceRoot, MUTATION_LOCK);
  const deadline = Date.now() + MUTATION_LOCK_TIMEOUT_MS;
  let identity;
  while (!identity) {
    try {
      fs6.mkdirSync(lockPath, { mode: 448 });
      const stat = fs6.lstatSync(lockPath);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new KiroMemoryScopeError("Kiro memory mutation lock is not a real directory");
      }
      identity = { dev: stat.dev, ino: stat.ino };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      let stat;
      try {
        stat = fs6.lstatSync(lockPath);
      } catch (statError) {
        if (errorCode(statError) === "ENOENT") continue;
        throw statError;
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new KiroMemoryScopeError("Kiro memory mutation lock is foreign");
      }
      if (Date.now() - stat.mtimeMs > STALE_MUTATION_LOCK_MS) {
        try {
          fs6.rmdirSync(lockPath);
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
    return await operation();
  } finally {
    try {
      const current = fs6.lstatSync(lockPath);
      if (current.isDirectory() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino) fs6.rmdirSync(lockPath);
    } catch {
    }
  }
};
var ensureDirectory = (target) => {
  fs6.mkdirSync(target, { recursive: true, mode: 448 });
  const stat = fs6.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new KiroMemoryScopeError(`Kiro memory directory must be a real directory: ${target}`);
  }
  try {
    fs6.chmodSync(target, 448);
  } catch {
  }
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
  let descriptor;
  try {
    descriptor = fs6.openSync(
      filePath,
      fs6.constants.O_RDONLY | (fs6.constants.O_NOFOLLOW ?? 0)
    );
    const stat = fs6.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 8 * 1024) {
      throw new KiroMemoryScopeError(`Kiro memory ownership marker is invalid: ${filePath}`);
    }
    if (process.platform !== "win32" && (stat.mode & 63) !== 0) {
      throw new KiroMemoryScopeError(`Kiro memory ownership marker is not private: ${filePath}`);
    }
    return JSON.parse(fs6.readFileSync(descriptor, "utf8"));
  } catch (error) {
    if (error instanceof KiroMemoryScopeError) throw error;
    throw new KiroMemoryScopeError(
      `Kiro memory directory is foreign or its ownership marker is unreadable: ${filePath}`
    );
  } finally {
    if (descriptor !== void 0) fs6.closeSync(descriptor);
  }
};
var ensureOwnedDirectory = (memoryRoot, target, marker) => {
  assertNoSymlinkComponents(memoryRoot, target);
  const existing = lstatOrNull(target);
  let created = false;
  if (!existing) {
    try {
      fs6.mkdirSync(target, { mode: 448 });
      created = true;
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }
  }
  const stat = fs6.lstatSync(target);
  assertPrivateDirectory(target, stat);
  const markerPath = path13.join(target, OWNERSHIP_MARKER);
  if (created) {
    const temporaryMarker = path13.join(
      target,
      `.kiro-fabric-owner-${process.pid}-${crypto2.randomBytes(8).toString("hex")}.tmp`
    );
    try {
      const descriptor = fs6.openSync(
        temporaryMarker,
        fs6.constants.O_WRONLY | fs6.constants.O_CREAT | fs6.constants.O_EXCL | (fs6.constants.O_NOFOLLOW ?? 0),
        384
      );
      try {
        fs6.writeFileSync(descriptor, `${JSON.stringify(marker)}
`, "utf8");
        fs6.fsyncSync(descriptor);
      } finally {
        fs6.closeSync(descriptor);
      }
      fs6.linkSync(temporaryMarker, markerPath);
      fs6.unlinkSync(temporaryMarker);
    } catch (error) {
      try {
        fs6.unlinkSync(temporaryMarker);
      } catch {
      }
      try {
        fs6.rmdirSync(target);
      } catch {
      }
      throw error;
    }
  } else if (!lstatOrNull(markerPath)) {
    let entries = [];
    try {
      entries = fs6.readdirSync(target);
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
  if (!isWithinOrEqual2(root, target)) {
    throw new KiroMemoryScopeError(`Kiro memory path escapes its root: ${target}`);
  }
  let cursor = root;
  const relative2 = path13.relative(root, target);
  for (const part of relative2.split(path13.sep).filter(Boolean)) {
    cursor = path13.join(cursor, part);
    const stat = lstatOrNull(cursor);
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      throw new KiroMemoryScopeError(`Kiro memory path crosses a symlink: ${cursor}`);
    }
  }
};
var canonicalDirectory = (root) => {
  const candidate = path13.resolve(assertMemoryToken(root, "root"));
  ensureDirectory(candidate);
  const canonical = fs6.realpathSync(candidate);
  const stat = fs6.statSync(canonical);
  if (!stat.isDirectory()) {
    throw new KiroMemoryScopeError(`Kiro memory root is not a directory: ${canonical}`);
  }
  return canonical;
};
var memoryNamespaceRoot = (root, namespace) => path13.join(root, MEMORY_DIR, `${encodeName(namespace)}-${hashNamespace(namespace)}`);
var entryPath = (namespaceRoot, key) => (() => {
  const name = `${encodeName(key)}.json`;
  if (utf8Bytes(name) > MAX_FILE_NAME_BYTES) {
    throw new KiroMemoryScopeError(
      `Kiro memory key is too long after filesystem-safe encoding`
    );
  }
  return path13.join(namespaceRoot, name);
})();
var actorStoreKey = (actorId, key) => `actor/${assertMemoryToken(actorId, "actorId")}/${assertMemoryToken(key, "key")}`;
var readEntry = (filePath) => {
  const raw = fs6.readFileSync(filePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new KiroMemoryScopeError(`Kiro memory entry is foreign or malformed: ${filePath}`);
  }
  if (!parsed || typeof parsed !== "object" || parsed.format !== MEMORY_FORMAT || parsed.owner !== MEMORY_OWNER || parsed.kind !== "memory-entry" || typeof parsed.namespace !== "string" || typeof parsed.key !== "string" || typeof parsed.updatedAt !== "string" || !("value" in parsed)) {
    throw new Error(`Kiro memory entry is malformed: ${filePath}`);
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
  const directory = path13.dirname(filePath);
  const temporary = path13.join(
    directory,
    `.${path13.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );
  let descriptor;
  try {
    descriptor = fs6.openSync(temporary, "wx", 384);
    fs6.writeFileSync(descriptor, content, "utf8");
    fs6.fsyncSync(descriptor);
    fs6.closeSync(descriptor);
    descriptor = void 0;
    fs6.renameSync(temporary, filePath);
    try {
      const directoryDescriptor = fs6.openSync(directory, "r");
      try {
        fs6.fsyncSync(directoryDescriptor);
      } finally {
        fs6.closeSync(directoryDescriptor);
      }
    } catch {
    }
    try {
      fs6.chmodSync(filePath, 384);
    } catch {
    }
  } catch (error) {
    if (descriptor !== void 0) fs6.closeSync(descriptor);
    try {
      fs6.rmSync(temporary, { force: true });
    } catch {
    }
    throw error;
  }
};
var listEntryFiles = (namespaceRoot) => {
  try {
    return fs6.readdirSync(namespaceRoot, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => path13.join(namespaceRoot, entry.name)).sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
};
var collectNamespaceEntries = (namespaceRoot) => listEntryFiles(namespaceRoot).map((filePath) => readEntry(filePath));
var assertEntryFits = (namespaceRoot, next, targetPath) => {
  const entries = collectNamespaceEntries(namespaceRoot);
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
  if (entryCount > DEFAULT_MAX_NAMESPACE_ENTRIES) {
    throw new Error(
      `Kiro memory namespace ${JSON.stringify(next.namespace)} exceeds ${DEFAULT_MAX_NAMESPACE_ENTRIES} entries`
    );
  }
  if (totalBytes > DEFAULT_MAX_NAMESPACE_BYTES) {
    throw new Error(
      `Kiro memory namespace ${JSON.stringify(next.namespace)} exceeds ${DEFAULT_MAX_NAMESPACE_BYTES} bytes`
    );
  }
};
var openKiroMemory = (namespace, root) => {
  const memoryNamespace = assertMemoryToken(namespace, "namespace");
  const memoryRoot = canonicalDirectory(root);
  const scopedRoot = path13.join(memoryRoot, MEMORY_DIR);
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
    const normalizedKey2 = assertMemoryToken(key, "key");
    const filePath = entryPath(namespaceRoot, normalizedKey2);
    assertNoSymlinkComponents(memoryRoot, filePath);
    if (!isWithinOrEqual2(namespaceRoot, filePath)) {
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
      const entry = readEntry(filePath);
      if (entry.namespace !== memoryNamespace) {
        throw new Error(`Kiro memory namespace mismatch for key ${JSON.stringify(entry.key)}`);
      }
      return entry;
    },
    async set(key, value) {
      return withNamespaceMutationLock(namespaceRoot, () => {
        const normalizedKey2 = assertMemoryToken(key, "key");
        const filePath = resolveEntryPath(normalizedKey2);
        let encodedValue;
        try {
          encodedValue = JSON.stringify(value);
        } catch {
          encodedValue = void 0;
        }
        if (encodedValue === void 0) {
          throw new TypeError("Kiro memory values must be JSON-serializable");
        }
        const normalizedValue = JSON.parse(encodedValue);
        const existing = lstatOrNull(filePath);
        if (existing) {
          if (!existing.isFile() || existing.isSymbolicLink()) {
            throw new KiroMemoryScopeError(`Kiro memory entry must be a real file: ${filePath}`);
          }
          const previous = readEntry(filePath);
          if (previous.namespace !== memoryNamespace || previous.key !== normalizedKey2) {
            throw new KiroMemoryScopeError(
              `Refusing foreign Kiro memory entry collision for ${JSON.stringify(normalizedKey2)}`
            );
          }
        }
        const entry = {
          namespace: memoryNamespace,
          key: normalizedKey2,
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
        assertEntryFits(namespaceRoot, entry, filePath);
        writeJsonAtomic(filePath, content);
        return entry;
      });
    },
    async list() {
      const entries = collectNamespaceEntries(namespaceRoot).filter((entry) => entry.namespace === memoryNamespace).sort((left, right) => left.key.localeCompare(right.key));
      if (entries.length > DEFAULT_MAX_NAMESPACE_ENTRIES) {
        throw new Error(
          `Kiro memory namespace ${JSON.stringify(memoryNamespace)} exceeds ${DEFAULT_MAX_NAMESPACE_ENTRIES} entries`
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
    async store(actorId, key) {
      return this.get(actorStoreKey(actorId, key));
    },
    async search(query, limit = 8) {
      const needle = query.trim().toLowerCase();
      if (!needle) return [];
      const capped = Math.max(1, Math.min(Math.floor(limit), DEFAULT_MAX_NAMESPACE_ENTRIES));
      const scored = [];
      for (const entry of collectNamespaceEntries(namespaceRoot)) {
        if (entry.namespace !== memoryNamespace) continue;
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
      return collectNamespaceEntries(namespaceRoot).filter((entry) => entry.namespace === memoryNamespace).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map((entry) => ({ key: entry.key, bytes: entry.bytes, updatedAt: entry.updatedAt }));
    }
  };
};

// src/kiro/memory-provider.ts
var descriptors2 = [
  {
    name: "get",
    description: "Read one value from this project's persistent Kiro memory namespace",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string", minLength: 1, maxLength: 512 } },
      required: ["key"],
      additionalProperties: false
    },
    risk: "read",
    namespace: "kiro-project"
  },
  {
    name: "set",
    description: "Persist one bounded JSON value in this project's Kiro memory namespace",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", minLength: 1, maxLength: 512 },
        value: {}
      },
      required: ["key", "value"],
      additionalProperties: false
    },
    risk: "write",
    namespace: "kiro-project"
  },
  {
    name: "search",
    description: "Search this project's persistent Kiro memory by key and JSON value; results are ranked and bounded",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 2e3 },
        limit: { type: "number", minimum: 1, maximum: 32 }
      },
      required: ["query"],
      additionalProperties: false
    },
    risk: "read",
    namespace: "kiro-project"
  },
  {
    name: "index",
    description: "List bounded metadata for this project's Kiro memory keys without returning stored values",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    risk: "read",
    namespace: "kiro-project"
  }
];
var KiroMemoryProvider = class {
  name = "memory";
  description = "Project-isolated, bounded persistent memory for managed Kiro sessions";
  #cwd;
  #root;
  #namespace;
  #binding;
  constructor(options) {
    this.#cwd = fs7.realpathSync(options.cwd);
    this.#root = path14.resolve(options.root);
    this.#namespace = `project:${sha256Bytes(this.#cwd)}`;
  }
  async list(request, _context) {
    const query = request.query?.normalize("NFKC").trim().toLowerCase();
    const filtered = query ? descriptors2.filter(
      (descriptor) => `${descriptor.name} ${descriptor.description}`.toLowerCase().includes(query)
    ) : descriptors2;
    return filtered.slice(0, Math.max(1, Math.min(request.limit ?? 100, 100)));
  }
  async describe(actionName, _context) {
    return descriptors2.find((descriptor) => descriptor.name === actionName);
  }
  async invoke(actionName, args, _context) {
    const memory = this.#memory();
    switch (actionName) {
      case "get":
        return memory.get(String(args.key));
      case "set":
        return memory.set(String(args.key), args.value);
      case "search":
        return memory.search(
          String(args.query),
          typeof args.limit === "number" ? args.limit : void 0
        );
      case "index":
        return memory.index();
      default:
        throw new Error(`Unknown managed Kiro memory action: ${actionName}`);
    }
  }
  #memory() {
    this.#binding ??= openKiroMemory(this.#namespace, this.#root);
    return this.#binding;
  }
};

// src/mesh/store.ts
import { randomUUID as randomUUID6 } from "node:crypto";
import fs8 from "node:fs";
import path15 from "node:path";
var MeshCompareAndSwapError = class extends Error {
  constructor(key, expectedVersion, actualVersion) {
    super(
      `Mesh compare-and-swap failed for ${key}: expected version ${expectedVersion}, found ${actualVersion}`
    );
    this.key = key;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
    this.name = "MeshCompareAndSwapError";
  }
};
var TOPIC_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/;
var KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,255}$/;
var LOCK_TIMEOUT_MS = 1e4;
var STALE_LOCK_MS = 3e4;
var DEFAULT_MAX_EVENT_LOG_BYTES = 64 * 1024 * 1024;
var DEFAULT_RETAINED_EVENT_LOG_BYTES = 16 * 1024 * 1024;
var DEFAULT_MAX_STATE_BYTES = 32 * 1024 * 1024;
var DEFAULT_MAX_STATE_TOMBSTONES = 1e4;
var EVENT_READ_PAGE_BYTES = 4 * 1024 * 1024;
var EVENT_READ_CHUNK_BYTES = 64 * 1024;
var CURSOR_OFFSET_BASE = 2 ** 32;
var delay3 = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
var errorCode2 = (error) => error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : void 0;
var serializeLockOwner = (owner) => `${JSON.stringify(owner)}
`;
var parseLockOwner = (serialized) => {
  try {
    const value = JSON.parse(serialized);
    if (value.format !== 2 || typeof value.token !== "string" || !value.token || !Number.isSafeInteger(value.pid) || Number(value.pid) <= 0 || !Number.isSafeInteger(value.createdAt) || value.bootId !== void 0 && typeof value.bootId !== "string" || value.processStart !== void 0 && typeof value.processStart !== "string") return void 0;
    return value;
  } catch {
    const [token, pidText, createdText, ...extra] = serialized.trim().split("\n");
    const pid = Number(pidText);
    const createdAt = Number(createdText);
    if (!token || extra.length > 0 || !Number.isSafeInteger(pid) || pid <= 0 || !Number.isFinite(createdAt)) {
      return void 0;
    }
    return { format: 2, token, pid, createdAt };
  }
};
var jsonClone = (value) => {
  const serialized = JSON.stringify(value);
  if (serialized === void 0) throw new Error("Mesh values must be JSON-serializable");
  return JSON.parse(serialized);
};
var isMeshStateFile = (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value) || value.format !== 1) {
    return false;
  }
  const entries = value.entries;
  return typeof entries === "object" && entries !== null && !Array.isArray(entries);
};
var recoverConcatenatedState = (serialized) => {
  const snapshots = [];
  let documents = 0;
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < serialized.length; index += 1) {
    const character = serialized[index];
    if (start < 0) {
      if (/\s/.test(character)) continue;
      if (character !== "{") return void 0;
      start = index;
      depth = 1;
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth !== 0) continue;
      try {
        const parsed = JSON.parse(serialized.slice(start, index + 1));
        documents += 1;
        if (isMeshStateFile(parsed)) snapshots.push(parsed);
      } catch {
        return void 0;
      }
      start = -1;
    }
  }
  return start < 0 && documents > 1 ? snapshots.at(-1) : void 0;
};
var readState = (filePath, maxBytes) => {
  try {
    const stat = fs8.statSync(filePath);
    if (stat.size > maxBytes) throw new Error(`state exceeds ${maxBytes} bytes`);
    const serialized = fs8.readFileSync(filePath, "utf8");
    try {
      const parsed = JSON.parse(serialized);
      if (isMeshStateFile(parsed)) return parsed;
      throw new Error("invalid state format");
    } catch (error) {
      const recovered = recoverConcatenatedState(serialized);
      if (recovered) return recovered;
      throw error;
    }
  } catch (error) {
    if (errorCode2(error) === "ENOENT") return { format: 1, entries: {} };
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read Fabric mesh state: ${message}`);
  }
};
var atomicWrite = (filePath, value, maxBytes = Number.POSITIVE_INFINITY) => {
  const serialized = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw new Error(`Fabric mesh state exceeds ${maxBytes} bytes`);
  }
  writeFileAtomic(filePath, serialized);
};
var compactStateTombstones = (state, maxTombstones) => {
  state.versions ??= {};
  const orderedKeys = [];
  const seen = /* @__PURE__ */ new Set();
  for (const key of state.tombstoneOrder ?? []) {
    if (state.entries[key] || state.versions[key] === void 0 || seen.has(key)) continue;
    seen.add(key);
    orderedKeys.push(key);
  }
  for (const key of Object.keys(state.versions)) {
    if (state.entries[key] || seen.has(key)) continue;
    seen.add(key);
    orderedKeys.push(key);
  }
  const retainedKeys = orderedKeys.slice(-maxTombstones);
  const retained = new Set(retainedKeys);
  for (const key of Object.keys(state.versions)) {
    if (!state.entries[key] && !retained.has(key)) delete state.versions[key];
  }
  state.tombstoneOrder = retainedKeys;
};
var MeshStore = class {
  constructor(root, maxEventBytes, maxReadEvents, options = {}) {
    this.root = root;
    this.maxEventBytes = maxEventBytes;
    this.maxReadEvents = maxReadEvents;
    this.#eventsPath = path15.join(root, "events.jsonl");
    this.#statePath = path15.join(root, "state.json");
    this.#counterPath = path15.join(root, "sequence");
    this.#generationPath = path15.join(root, "generation");
    this.#lockPath = path15.join(root, ".lock");
    this.#maxEventLogBytes = Math.min(
      CURSOR_OFFSET_BASE - 1,
      Math.max(maxEventBytes + 2, Math.floor(options.maxEventLogBytes ?? DEFAULT_MAX_EVENT_LOG_BYTES))
    );
    this.#retainedEventLogBytes = Math.min(
      this.#maxEventLogBytes - 1,
      Math.max(
        maxEventBytes + 1,
        Math.floor(options.retainedEventLogBytes ?? DEFAULT_RETAINED_EVENT_LOG_BYTES)
      )
    );
    this.#maxStateBytes = Math.max(
      maxEventBytes * 2,
      Math.floor(options.maxStateBytes ?? DEFAULT_MAX_STATE_BYTES)
    );
    this.#maxStateTombstones = Math.max(
      1,
      Math.floor(options.maxStateTombstones ?? DEFAULT_MAX_STATE_TOMBSTONES)
    );
    this.#lockTimeoutMs = Math.max(100, Math.floor(options.lockTimeoutMs ?? LOCK_TIMEOUT_MS));
    this.#staleLockMs = Math.max(100, Math.floor(options.staleLockMs ?? STALE_LOCK_MS));
    fs8.mkdirSync(root, { recursive: true, mode: 448 });
  }
  #eventsPath;
  #statePath;
  #counterPath;
  #generationPath;
  #lockPath;
  #maxEventLogBytes;
  #retainedEventLogBytes;
  #maxStateBytes;
  #maxStateTombstones;
  #lockTimeoutMs;
  #staleLockMs;
  #stateCache;
  async publish(input) {
    const [event] = await this.publishBatch([input]);
    return event;
  }
  /**
   * Publish several independent events under one lock, writing every record in a
   * single append with contiguous, non-reused sequences. Semantics match
   * repeated {@link publish} calls: records are written before the counter is
   * advanced, a torn trailing line stays repairable, and compaction runs once
   * after the batch. Validation is preflighted so a validation error leaves the
   * log and counter untouched. An empty batch is a no-op.
   */
  async publishBatch(inputs) {
    if (inputs.length === 0) return [];
    const prepared = inputs.map((input) => this.#prepareEvent(input));
    return this.#withLock(() => {
      this.#repairEventLog();
      const first = Math.max(this.#readSequence(), this.#readLastEventSequence()) + 1;
      const events = prepared.map((part, index) => ({ ...part, sequence: first + index }));
      const buffer = events.map((event) => `${JSON.stringify(event)}
`).join("");
      if (Buffer.byteLength(buffer, "utf8") > this.maxEventBytes * events.length) {
        throw new Error(`Mesh batch exceeds ${this.maxEventBytes} bytes per event`);
      }
      let descriptor;
      try {
        descriptor = fs8.openSync(this.#eventsPath, "a", 384);
        fs8.writeFileSync(descriptor, buffer);
        fs8.fsyncSync(descriptor);
      } finally {
        if (descriptor !== void 0) fs8.closeSync(descriptor);
      }
      fsyncDirectory(this.root);
      atomicWrite(this.#counterPath, events[events.length - 1].sequence);
      this.#compactEventLog();
      return events.map((event) => jsonClone(event));
    });
  }
  #prepareEvent(input) {
    this.#validateTopic(input.topic);
    if (input.to !== void 0 && !input.to.trim()) throw new Error("Mesh recipient is empty");
    const eventData = input.data === void 0 ? void 0 : jsonClone(input.data);
    const data = {
      id: randomUUID6(),
      sequence: 0,
      // assigned under the lock in publishBatch
      topic: input.topic,
      kind: input.kind?.trim() || "message",
      from: jsonClone(input.from),
      ...input.to ? { to: input.to } : {},
      ...input.text !== void 0 ? { text: input.text } : {},
      ...eventData !== void 0 ? { data: eventData } : {},
      createdAt: Date.now()
    };
    const line = JSON.stringify(data);
    if (Buffer.byteLength(line, "utf8") > this.maxEventBytes) {
      throw new Error(`Mesh event exceeds ${this.maxEventBytes} bytes`);
    }
    const { sequence: _sequence, ...event } = data;
    return event;
  }
  read(input = {}) {
    if (input.topic !== void 0) this.#validateTopic(input.topic);
    const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 100), this.maxReadEvents));
    const events = input.after === void 0 ? this.#readRecentEvents(input, limit) : this.#readEventsAfter(Math.max(0, Math.floor(input.after)), input, limit);
    return events.map((event) => jsonClone(event));
  }
  latestSequence() {
    return Math.max(this.#readSequence(), this.#readLastEventSequence());
  }
  latestOffset() {
    const generation = this.#readGeneration();
    let descriptor;
    let completeOffset = 0;
    try {
      descriptor = fs8.openSync(this.#eventsPath, "r");
      const size = fs8.fstatSync(descriptor).size;
      if (size > 0) {
        const lastByte = Buffer.allocUnsafe(1);
        fs8.readSync(descriptor, lastByte, 0, 1, size - 1);
        if (lastByte[0] === 10) {
          completeOffset = size;
        } else {
          const readBytes = Math.min(size, this.maxEventBytes + 1);
          const tail = Buffer.allocUnsafe(readBytes);
          fs8.readSync(descriptor, tail, 0, readBytes, size - readBytes);
          const newline = tail.lastIndexOf(10);
          completeOffset = newline >= 0 ? size - readBytes + newline + 1 : 0;
        }
      }
    } catch (error) {
      if (errorCode2(error) !== "ENOENT") throw error;
    } finally {
      if (descriptor !== void 0) fs8.closeSync(descriptor);
    }
    if (this.#readGeneration() !== generation) return this.latestOffset();
    return this.#encodeCursor(generation, completeOffset);
  }
  tail(cursor, limit = 100) {
    const boundedLimit = Math.max(1, Math.min(Math.floor(limit), this.maxReadEvents));
    const generation = this.#readGeneration();
    const decoded = this.#decodeCursor(cursor);
    let descriptor;
    try {
      descriptor = fs8.openSync(this.#eventsPath, "r");
      const size = fs8.fstatSync(descriptor).size;
      let position = decoded.generation === generation ? Math.min(decoded.offset, size) : 0;
      if (position > 0) {
        const previousByte = Buffer.allocUnsafe(1);
        fs8.readSync(descriptor, previousByte, 0, 1, position - 1);
        if (previousByte[0] !== 10) position = 0;
      }
      if (position >= size) {
        if (this.#readGeneration() !== generation) return this.tail(cursor, limit);
        return { events: [], nextOffset: this.#encodeCursor(generation, position) };
      }
      const chunkBytes = Math.min(
        size - position,
        Math.max(this.maxEventBytes + 1, EVENT_READ_PAGE_BYTES)
      );
      const buffer = Buffer.allocUnsafe(chunkBytes);
      const bytesRead = fs8.readSync(descriptor, buffer, 0, chunkBytes, position);
      const events = [];
      let lineStart = 0;
      let consumed = 0;
      for (let index = 0; index < bytesRead; index++) {
        if (buffer[index] !== 10) continue;
        const line = buffer.subarray(lineStart, index).toString("utf8").trim();
        lineStart = index + 1;
        consumed = lineStart;
        if (line) {
          try {
            const event = JSON.parse(line);
            if (typeof event.sequence === "number") events.push(event);
          } catch {
          }
        }
        if (events.length >= boundedLimit) break;
      }
      if (this.#readGeneration() !== generation) return this.tail(cursor, limit);
      return {
        events: events.map((event) => jsonClone(event)),
        nextOffset: this.#encodeCursor(generation, position + consumed)
      };
    } catch (error) {
      if (errorCode2(error) === "ENOENT") {
        if (this.#readGeneration() !== generation) return this.tail(cursor, limit);
        return { events: [], nextOffset: this.#encodeCursor(generation, 0) };
      }
      throw error;
    } finally {
      if (descriptor !== void 0) fs8.closeSync(descriptor);
    }
  }
  #readRecentEvents(input, limit) {
    let events = [];
    let before;
    while (events.length < limit) {
      const page = readJsonlPage(
        this.#eventsPath,
        this.maxReadEvents,
        before,
        Math.max(this.maxEventBytes + 1, EVENT_READ_PAGE_BYTES)
      );
      const pageEvents = [];
      for (const line of page.lines) {
        const parsed = line.parsed;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
        const event = parsed;
        if (typeof event.sequence !== "number" || !this.#eventMatches(event, input)) continue;
        pageEvents.push(event);
      }
      events = [...pageEvents, ...events].slice(-limit);
      if (!page.hasMore || page.before === void 0 || page.before === before) break;
      before = page.before;
    }
    return events;
  }
  #readEventsAfter(after, input, limit) {
    let descriptor;
    try {
      descriptor = fs8.openSync(this.#eventsPath, "r");
      const size = fs8.fstatSync(descriptor).size;
      const events = [];
      let position = 0;
      let lineChunks = [];
      let lineBytes = 0;
      let skippingOversizedLine = false;
      let reachedLimit = false;
      const emitLine = () => {
        if (!skippingOversizedLine && lineBytes > 0) {
          const decoded = Buffer.concat(lineChunks, lineBytes).toString("utf8");
          const line = decoded.endsWith(String.fromCharCode(13)) ? decoded.slice(0, -1) : decoded;
          try {
            const event = JSON.parse(line);
            if (typeof event.sequence === "number" && event.sequence > after && this.#eventMatches(event, input)) {
              events.push(event);
              reachedLimit = events.length >= limit;
            }
          } catch {
          }
        }
        lineChunks = [];
        lineBytes = 0;
        skippingOversizedLine = false;
      };
      while (position < size && !reachedLimit) {
        const readLength = Math.min(EVENT_READ_CHUNK_BYTES, size - position);
        const chunk = Buffer.allocUnsafe(readLength);
        const bytesRead = fs8.readSync(descriptor, chunk, 0, readLength, position);
        if (bytesRead <= 0) break;
        position += bytesRead;
        const captured = chunk.subarray(0, bytesRead);
        let segmentStart = 0;
        while (segmentStart < captured.length && !reachedLimit) {
          const newline = captured.indexOf(10, segmentStart);
          const segmentEnd = newline < 0 ? captured.length : newline;
          const segment = captured.subarray(segmentStart, segmentEnd);
          if (!skippingOversizedLine) {
            if (lineBytes + segment.length <= this.maxEventBytes) {
              if (segment.length > 0) lineChunks.push(segment);
              lineBytes += segment.length;
            } else {
              lineChunks = [];
              lineBytes = 0;
              skippingOversizedLine = true;
            }
          }
          if (newline < 0) break;
          emitLine();
          segmentStart = newline + 1;
        }
      }
      if (!reachedLimit && (lineBytes > 0 || skippingOversizedLine)) emitLine();
      return events;
    } catch (error) {
      if (errorCode2(error) === "ENOENT") return [];
      throw error;
    } finally {
      if (descriptor !== void 0) fs8.closeSync(descriptor);
    }
  }
  #eventMatches(event, input) {
    if (input.topic !== void 0 && event.topic !== input.topic) return false;
    if (input.to !== void 0 && event.to !== input.to) return false;
    return true;
  }
  get(key) {
    this.#validateKey(key);
    const entry = this.#readCachedState().entries[key];
    return entry ? jsonClone(entry) : void 0;
  }
  list(prefix = "", limit = 100) {
    const boundedLimit = Math.max(1, Math.min(Math.floor(limit), this.maxReadEvents));
    return this.listAll(prefix).slice(0, boundedLimit);
  }
  /** Internal project-state scan for host-managed indexes that must reconcile every key. */
  listAll(prefix = "") {
    if (prefix) this.#validateKey(prefix);
    return Object.values(this.#readCachedState().entries).filter((entry) => !prefix || entry.key.startsWith(prefix)).sort((left, right) => left.key.localeCompare(right.key)).map((entry) => jsonClone(entry));
  }
  async put(input) {
    this.#validateKey(input.key);
    const value = jsonClone(input.value);
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > this.maxEventBytes) {
      throw new Error(`Mesh state value exceeds ${this.maxEventBytes} bytes`);
    }
    return this.#withLock(() => {
      const state = readState(this.#statePath, this.#maxStateBytes);
      const existing = state.entries[input.key];
      const storedVersion = state.versions?.[input.key];
      const actualVersion = existing?.version ?? (typeof storedVersion === "number" && Number.isSafeInteger(storedVersion) ? storedVersion : 0);
      if (input.ifVersion !== void 0) {
        if (actualVersion !== input.ifVersion) {
          throw new MeshCompareAndSwapError(input.key, input.ifVersion, actualVersion);
        }
      }
      const entry = {
        key: input.key,
        value,
        version: actualVersion + 1,
        updatedAt: Date.now(),
        updatedBy: jsonClone(input.identity)
      };
      state.entries[input.key] = entry;
      state.versions ??= {};
      state.versions[input.key] = entry.version;
      state.tombstoneOrder = (state.tombstoneOrder ?? []).filter((key) => key !== input.key);
      compactStateTombstones(state, this.#maxStateTombstones);
      atomicWrite(this.#statePath, state, this.#maxStateBytes);
      this.#cacheState(state);
      return jsonClone(entry);
    });
  }
  async delete(input) {
    this.#validateKey(input.key);
    return this.#withLock(() => {
      const state = readState(this.#statePath, this.#maxStateBytes);
      const existing = state.entries[input.key];
      const storedVersion = state.versions?.[input.key];
      const actualVersion = existing?.version ?? (typeof storedVersion === "number" && Number.isSafeInteger(storedVersion) ? storedVersion : 0);
      if (!existing) {
        if (input.ifVersion !== void 0 && input.ifVersion !== actualVersion) {
          throw new MeshCompareAndSwapError(input.key, input.ifVersion, actualVersion);
        }
        this.#cacheState(state);
        return { deleted: false };
      }
      if (input.ifVersion !== void 0 && existing.version !== input.ifVersion) {
        throw new MeshCompareAndSwapError(input.key, input.ifVersion, existing.version);
      }
      delete state.entries[input.key];
      state.versions ??= {};
      state.versions[input.key] = existing.version;
      state.tombstoneOrder = [
        ...(state.tombstoneOrder ?? []).filter((key) => key !== input.key),
        input.key
      ];
      compactStateTombstones(state, this.#maxStateTombstones);
      atomicWrite(this.#statePath, state, this.#maxStateBytes);
      this.#cacheState(state);
      return { deleted: true, version: existing.version };
    });
  }
  #readCachedState() {
    try {
      const stat = fs8.statSync(this.#statePath);
      const cached = this.#stateCache;
      if (cached && cached.device === stat.dev && cached.inode === stat.ino && cached.size === stat.size && cached.modifiedAt === stat.mtimeMs) {
        return cached.state;
      }
    } catch (error) {
      this.#stateCache = void 0;
      if (errorCode2(error) === "ENOENT") return { format: 1, entries: {} };
      throw error;
    }
    const state = readState(this.#statePath, this.#maxStateBytes);
    this.#cacheState(state);
    return state;
  }
  #cacheState(state) {
    try {
      const stat = fs8.statSync(this.#statePath);
      this.#stateCache = {
        device: stat.dev,
        inode: stat.ino,
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        state
      };
    } catch {
      this.#stateCache = void 0;
    }
  }
  async #withLock(operation) {
    fs8.mkdirSync(this.root, { recursive: true, mode: 448 });
    const deadline = Date.now() + this.#lockTimeoutMs;
    const token = randomUUID6();
    const ownerPath = path15.join(this.#lockPath, "owner");
    const owner = {
      format: 2,
      token,
      createdAt: Date.now(),
      ...processInstanceIdentity()
    };
    const ownerBytes = serializeLockOwner(owner);
    while (true) {
      try {
        fs8.mkdirSync(this.#lockPath, { mode: 448 });
        fs8.writeFileSync(ownerPath, ownerBytes, { encoding: "utf8", mode: 384, flag: "wx" });
        break;
      } catch (error) {
        if (errorCode2(error) !== "EEXIST") throw error;
        if (this.#clearStaleLock(ownerPath)) continue;
        if (Date.now() >= deadline) throw new Error("Timed out waiting for the Fabric mesh lock");
        await delay3(10);
      }
    }
    try {
      return operation();
    } finally {
      try {
        const current = parseLockOwner(fs8.readFileSync(ownerPath, "utf8"));
        if (current?.token === token) {
          fs8.rmSync(this.#lockPath, { recursive: true, force: true });
        }
      } catch {
      }
    }
  }
  // Returns true when a stale lock was removed and acquisition should retry.
  // A lock is stale when it outlived the stale window without a live owner:
  // either the owner file names a dead process, or the owner file is missing
  // or corrupt — the owner crashed between creating the lock directory and
  // writing the owner file — and the untouched lock directory itself is
  // stale. Removal re-reads the state it judged stale so a freshly rotated
  // owner is never deleted mid-check.
  #clearStaleLock(ownerPath) {
    let lockModifiedAt;
    let owner;
    try {
      owner = fs8.readFileSync(ownerPath, "utf8");
    } catch {
      try {
        lockModifiedAt = fs8.statSync(this.#lockPath).mtimeMs;
      } catch {
        return false;
      }
    }
    if (owner !== void 0) {
      const parsed = parseLockOwner(owner);
      if (parsed && Date.now() - parsed.createdAt <= this.#staleLockMs) return false;
      if (parsed && processInstanceIsAlive(parsed)) return false;
      try {
        if (fs8.readFileSync(ownerPath, "utf8") !== owner) return false;
        fs8.rmSync(this.#lockPath, { recursive: true, force: true });
        return true;
      } catch {
        return false;
      }
    }
    if (lockModifiedAt === void 0 || Date.now() - lockModifiedAt <= this.#staleLockMs) {
      return false;
    }
    try {
      if (fs8.statSync(this.#lockPath).mtimeMs !== lockModifiedAt) return false;
      fs8.rmSync(this.#lockPath, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }
  #readGeneration() {
    try {
      const parsed = JSON.parse(fs8.readFileSync(this.#generationPath, "utf8"));
      return typeof parsed === "number" && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
    } catch {
      return 0;
    }
  }
  #encodeCursor(generation, offset) {
    const cursor = generation * CURSOR_OFFSET_BASE + offset;
    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      throw new Error("Fabric mesh cursor exhausted its safe integer range");
    }
    return cursor;
  }
  #decodeCursor(cursor) {
    if (!Number.isSafeInteger(cursor) || cursor < 0) return { generation: -1, offset: 0 };
    return {
      generation: Math.floor(cursor / CURSOR_OFFSET_BASE),
      offset: cursor % CURSOR_OFFSET_BASE
    };
  }
  #compactEventLog() {
    let descriptor;
    try {
      descriptor = fs8.openSync(this.#eventsPath, "r");
      const size = fs8.fstatSync(descriptor).size;
      if (size <= this.#maxEventLogBytes) return;
      const readBytes = Math.min(
        size,
        this.#retainedEventLogBytes + this.maxEventBytes + 1
      );
      const buffer = Buffer.allocUnsafe(readBytes);
      const bytesRead = fs8.readSync(descriptor, buffer, 0, readBytes, size - readBytes);
      const captured = buffer.subarray(0, bytesRead);
      const retentionBoundary = Math.max(0, captured.length - this.#retainedEventLogBytes);
      const newline = retentionBoundary === 0 ? -1 : captured.indexOf(10, retentionBoundary);
      const retainedStart = retentionBoundary === 0 ? 0 : newline >= 0 ? newline + 1 : captured.length;
      const retained = captured.subarray(retainedStart);
      fs8.closeSync(descriptor);
      descriptor = void 0;
      atomicWrite(this.#generationPath, this.#readGeneration() + 1);
      writeFileAtomic(this.#eventsPath, retained);
    } catch (error) {
      if (errorCode2(error) !== "ENOENT") throw error;
    } finally {
      if (descriptor !== void 0) fs8.closeSync(descriptor);
    }
  }
  #repairEventLog() {
    let descriptor;
    try {
      descriptor = fs8.openSync(this.#eventsPath, "r+");
      const size = fs8.fstatSync(descriptor).size;
      if (size === 0) return;
      const lastByte = Buffer.allocUnsafe(1);
      fs8.readSync(descriptor, lastByte, 0, 1, size - 1);
      if (lastByte[0] === 10) return;
      const readBytes = Math.min(size, this.maxEventBytes + 1);
      const tail = Buffer.allocUnsafe(readBytes);
      fs8.readSync(descriptor, tail, 0, readBytes, size - readBytes);
      const newline = tail.lastIndexOf(10);
      fs8.ftruncateSync(descriptor, newline >= 0 ? size - readBytes + newline + 1 : 0);
      fs8.fsyncSync(descriptor);
    } catch (error) {
      if (errorCode2(error) !== "ENOENT") throw error;
    } finally {
      if (descriptor !== void 0) fs8.closeSync(descriptor);
    }
  }
  #readLastEventSequence() {
    let descriptor;
    try {
      descriptor = fs8.openSync(this.#eventsPath, "r");
      const size = fs8.fstatSync(descriptor).size;
      if (size === 0) return 0;
      const readBytes = Math.min(size, this.maxEventBytes + 1);
      const tail = Buffer.allocUnsafe(readBytes);
      fs8.readSync(descriptor, tail, 0, readBytes, size - readBytes);
      const lines = tail.toString("utf8").trim().split("\n");
      for (let index = lines.length - 1; index >= 0; index--) {
        const line = lines[index];
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          if (typeof parsed.sequence === "number" && Number.isSafeInteger(parsed.sequence)) {
            return parsed.sequence;
          }
        } catch {
        }
      }
      return 0;
    } catch (error) {
      if (errorCode2(error) === "ENOENT") return 0;
      throw error;
    } finally {
      if (descriptor !== void 0) fs8.closeSync(descriptor);
    }
  }
  #readSequence() {
    try {
      const parsed = JSON.parse(fs8.readFileSync(this.#counterPath, "utf8"));
      return typeof parsed === "number" && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
    } catch (error) {
      if (errorCode2(error) === "ENOENT") return 0;
      return 0;
    }
  }
  #validateTopic(topic) {
    if (!TOPIC_PATTERN.test(topic)) throw new Error(`Invalid Fabric mesh topic: ${topic}`);
  }
  #validateKey(key) {
    const unsafeSegment = key.split(/[/:]/).some(
      (segment) => segment === "__proto__" || segment === "prototype" || segment === "constructor"
    );
    if (!KEY_PATTERN.test(key) || unsafeSegment) {
      throw new Error(`Invalid Fabric mesh key: ${key}`);
    }
  }
};

// src/state/store.ts
import { createHash as createHash5 } from "node:crypto";
import path17 from "node:path";

// src/state/complexity.ts
import fs9 from "node:fs";
import path16 from "node:path";
var isWordStart = (character) => character !== void 0 && (character >= "a" && character <= "z" || character >= "A" && character <= "Z" || character === "_" || character === "$");
var isWordPart = (character) => isWordStart(character) || character !== void 0 && character >= "0" && character <= "9";
var regularExpressionPrefixWords = /* @__PURE__ */ new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield"
]);
var canStartRegularExpression = (previous) => {
  if (!previous) return true;
  if (previous.kind === "punctuation") {
    return "([{=,:;!&|?+-*%^~<>".includes(previous.value);
  }
  return regularExpressionPrefixWords.has(previous.value);
};
var tokenize3 = (source) => {
  const tokens = [];
  let scan;
  const skipQuoted = (start) => {
    const quote = source[start];
    let index = start + 1;
    while (index < source.length) {
      if (source[index] === "\\") {
        index += 2;
      } else if (source[index] === quote) {
        return index + 1;
      } else {
        index++;
      }
    }
    return index;
  };
  const scanJsx = (start) => {
    let index = start + 1;
    let selfClosing = false;
    while (index < source.length) {
      if (source[index] === "'" || source[index] === '"') {
        index = skipQuoted(index);
      } else if (source[index] === "{") {
        tokens.push({ value: "{", kind: "punctuation" });
        index = scan(index + 1, true);
        tokens.push({ value: "}", kind: "punctuation" });
      } else if (source[index] === ">") {
        let previous = index - 1;
        while (previous > start && source[previous]?.trim().length === 0) previous--;
        selfClosing = source[previous] === "/";
        index++;
        break;
      } else {
        index++;
      }
    }
    if (selfClosing) return index;
    while (index < source.length) {
      if (source[index] === "{") {
        tokens.push({ value: "{", kind: "punctuation" });
        index = scan(index + 1, true);
        tokens.push({ value: "}", kind: "punctuation" });
      } else if (source[index] === "<" && source[index + 1] === "/") {
        index += 2;
        while (index < source.length && source[index] !== ">") index++;
        return Math.min(source.length, index + 1);
      } else if (source[index] === "<") {
        index = scanJsx(index);
      } else {
        index++;
      }
    }
    return index;
  };
  const canStartJsx = (next) => {
    if (next !== ">" && !isWordStart(next)) return false;
    const previous = tokens[tokens.length - 1];
    if (!previous) return true;
    if (previous.kind === "word") return previous.value === "return";
    return ["(", "[", "{", "=", ",", ":", "?", "=>", "&&", "||"].includes(
      previous.value
    );
  };
  scan = (start, stopAtClosingBrace) => {
    let index = start;
    while (index < source.length) {
      const character = source[index];
      const next = source[index + 1];
      if (stopAtClosingBrace && character === "}") return index + 1;
      if (character === "<" && canStartJsx(next)) {
        index = scanJsx(index);
        continue;
      }
      if (character === "{") {
        tokens.push({ value: "{", kind: "punctuation" });
        index = scan(index + 1, true);
        tokens.push({ value: "}", kind: "punctuation" });
        continue;
      }
      if (character === "/" && next === "/") {
        index += 2;
        while (index < source.length && source[index] !== "\n") index++;
        continue;
      }
      if (character === "/" && next === "*") {
        index += 2;
        while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
          index++;
        }
        index = Math.min(source.length, index + 2);
        continue;
      }
      if (character === "'" || character === '"') {
        index = skipQuoted(index);
        continue;
      }
      if (character === "`") {
        index++;
        while (index < source.length) {
          if (source[index] === "\\") {
            index += 2;
          } else if (source[index] === "`") {
            index++;
            break;
          } else if (source[index] === "$" && source[index + 1] === "{") {
            tokens.push({ value: "{", kind: "punctuation" });
            index = scan(index + 2, true);
            tokens.push({ value: "}", kind: "punctuation" });
          } else {
            index++;
          }
        }
        continue;
      }
      if (character === "/" && next !== "=" && canStartRegularExpression(tokens[tokens.length - 1])) {
        index++;
        let inCharacterClass = false;
        while (index < source.length) {
          if (source[index] === "\\") {
            index += 2;
          } else if (source[index] === "[") {
            inCharacterClass = true;
            index++;
          } else if (source[index] === "]") {
            inCharacterClass = false;
            index++;
          } else if (source[index] === "/" && !inCharacterClass) {
            index++;
            while (isWordPart(source[index])) index++;
            break;
          } else {
            index++;
          }
        }
        continue;
      }
      if (isWordStart(character)) {
        const wordStart = index;
        index++;
        while (isWordPart(source[index])) index++;
        tokens.push({ value: source.slice(wordStart, index), kind: "word" });
        continue;
      }
      if (character !== void 0 && character.trim().length > 0) {
        const twoCharacters = `${character}${next ?? ""}`;
        if (["?.", "??", "&&", "||", "=>"].includes(twoCharacters)) {
          tokens.push({ value: twoCharacters, kind: "punctuation" });
          index += 2;
        } else {
          tokens.push({ value: character, kind: "punctuation" });
          index++;
        }
        continue;
      }
      index++;
    }
    return index;
  };
  scan(0, false);
  return tokens;
};
var followedBy = (tokens, index, value) => tokens[index + 1]?.value === value;
var countTypeScriptJavaScript = (source) => {
  const tokens = tokenize3(source);
  const switchBodies = [];
  let waitingForSwitchBody = false;
  let count = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]?.value;
    if (token === "switch") waitingForSwitchBody = true;
    if (token === "{") {
      switchBodies.push(waitingForSwitchBody);
      waitingForSwitchBody = false;
      continue;
    }
    if (token === "}") {
      switchBodies.pop();
      continue;
    }
    if ((token === "if" || token === "for" || token === "while") && followedBy(tokens, index, "(")) {
      count++;
      continue;
    }
    if (token === "catch" && (followedBy(tokens, index, "(") || followedBy(tokens, index, "{"))) {
      count++;
      continue;
    }
    if (switchBodies[switchBodies.length - 1] === true) {
      if (token === "default" && followedBy(tokens, index, ":")) {
        count++;
      } else if (token === "case") {
        count++;
      }
    }
  }
  return count;
};
var typeScriptJavaScriptComplexity = {
  language: "typescript/javascript",
  extensions: [".ts", ".js", ".tsx", ".jsx"],
  count: countTypeScriptJavaScript
};
var languageComplexities = [
  typeScriptJavaScriptComplexity
];
var MAX_COMPLEXITY_FILE_BYTES = 2 * 1024 * 1024;
var complexityForFile = (file, languages = languageComplexities) => {
  const extension = path16.extname(file).toLowerCase();
  return languages.find((language) => language.extensions.includes(extension));
};
var containedBy = (root, candidate) => {
  const relative2 = path16.relative(root, candidate);
  return relative2 === "" || relative2 !== ".." && !relative2.startsWith(`..${path16.sep}`) && !path16.isAbsolute(relative2);
};
var countFileComplexity = (requestedFile, root) => {
  const language = complexityForFile(requestedFile);
  if (!language) return void 0;
  const requestedStats = fs9.lstatSync(requestedFile);
  if (requestedStats.isSymbolicLink()) {
    throw new Error(`State complexity input must not be a symlink: ${requestedFile}`);
  }
  const file = fs9.realpathSync(requestedFile);
  if (root && !containedBy(fs9.realpathSync(root), file)) {
    throw new Error(`State complexity file resolves outside the project cwd: ${requestedFile}`);
  }
  const lexical = fs9.lstatSync(file);
  if (!lexical.isFile() || lexical.isSymbolicLink()) {
    throw new Error(`State complexity input must be a regular non-symlink file: ${requestedFile}`);
  }
  if (lexical.size > MAX_COMPLEXITY_FILE_BYTES) {
    throw new Error(`State complexity input exceeds ${MAX_COMPLEXITY_FILE_BYTES} bytes: ${requestedFile}`);
  }
  const descriptor = fs9.openSync(
    file,
    fs9.constants.O_RDONLY | (fs9.constants.O_NOFOLLOW ?? 0)
  );
  try {
    const opened = fs9.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== lexical.dev || opened.ino !== lexical.ino) {
      throw new Error(`State complexity input changed during validation: ${requestedFile}`);
    }
    if (opened.size > MAX_COMPLEXITY_FILE_BYTES) {
      throw new Error(`State complexity input exceeds ${MAX_COMPLEXITY_FILE_BYTES} bytes: ${requestedFile}`);
    }
    return {
      file: requestedFile,
      language: language.language,
      count: language.count(fs9.readFileSync(descriptor, "utf8"))
    };
  } finally {
    fs9.closeSync(descriptor);
  }
};

// src/state/evidence-runner.ts
import { spawn as spawn2 } from "node:child_process";
import { createHash as createHash4 } from "node:crypto";
var COMMAND_OUTPUT_MAX_BYTES = 32 * 1024;
var errorMessage = (error) => error instanceof Error ? error.message : String(error);
var truncateUtf82 = (value, maxBytes) => {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return { value, omittedBytes: 0 };
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 192) === 128) end--;
  const bounded2 = bytes.subarray(0, end).toString("utf8");
  return { value: bounded2, omittedBytes: bytes.length - end };
};
var terminateWindowsTree = (child) => new Promise((resolve) => {
  if (child.pid === void 0) {
    resolve();
    return;
  }
  let settled = false;
  let timeout;
  const finish = () => {
    if (settled) return;
    settled = true;
    if (timeout) clearTimeout(timeout);
    resolve();
  };
  const treeKillCommand = ["task", "kill"].join("");
  const killer = spawn2(treeKillCommand, ["/pid", String(child.pid), "/T", "/F"], {
    windowsHide: true,
    stdio: "ignore"
  });
  killer.once("error", () => {
    try {
      child.kill("SIGKILL");
    } catch {
    }
    finish();
  });
  killer.once("close", finish);
  timeout = setTimeout(() => {
    try {
      killer.kill("SIGKILL");
      child.kill("SIGKILL");
    } catch {
    }
    finish();
  }, 1e3);
  timeout.unref?.();
});
var terminateProcessTree = async (child) => {
  if (process.platform === "win32") {
    await terminateWindowsTree(child);
    return;
  }
  if (child.pid === void 0) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
    }
  }
};
var runCommand = (command, options) => new Promise((resolve) => {
  let settled = false;
  let outputBytes = 0;
  const outputChunks = [];
  let retainedBytes = 0;
  const outputHash = createHash4("sha256");
  let timer;
  let terminationReason;
  let termination;
  let child;
  const collect = (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    outputBytes += bytes.length;
    outputHash.update(bytes);
    if (retainedBytes >= COMMAND_OUTPUT_MAX_BYTES) return;
    const retained = bytes.subarray(
      0,
      Math.min(bytes.length, COMMAND_OUTPUT_MAX_BYTES - retainedBytes)
    );
    outputChunks.push(retained);
    retainedBytes += retained.length;
  };
  const finish = (status, exitCode, error) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener("abort", abort);
    const retained = Buffer.concat(outputChunks);
    const boundedOutput = truncateUtf82(retained.toString("utf8"), retained.length);
    resolve({
      status,
      exitCode,
      output: boundedOutput.value,
      outputBytes,
      outputOmittedBytes: outputBytes - Buffer.byteLength(boundedOutput.value, "utf8"),
      outputDigest: `sha256:${outputHash.digest("hex")}`,
      ...error !== void 0 ? { error } : {}
    });
  };
  const terminate = (reason) => {
    if (terminationReason !== void 0) return;
    terminationReason = reason;
    if (timer) clearTimeout(timer);
    termination = terminateProcessTree(child);
    if (process.platform === "win32") {
      void termination.then(() => {
        const fallback = setTimeout(() => {
          child.stdout?.removeListener("data", collect);
          child.stderr?.removeListener("data", collect);
          child.stdout?.destroy();
          child.stderr?.destroy();
          finish("error", null, reason);
        }, 100);
        fallback.unref?.();
      });
    }
  };
  const abort = () => terminate("aborted");
  try {
    child = spawn2(command, {
      shell: true,
      cwd: options.cwd,
      detached: process.platform !== "win32",
      windowsHide: true
    });
  } catch (error) {
    finish("error", null, errorMessage(error));
    return;
  }
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  child.once("error", (error) => finish("error", null, errorMessage(error)));
  child.once("close", (code) => {
    void (async () => {
      if (termination) await termination;
      if (terminationReason !== void 0) {
        finish("error", null, terminationReason);
        return;
      }
      const exitCode = typeof code === "number" ? code : null;
      if (exitCode === null) {
        finish("error", null, "process terminated by signal");
        return;
      }
      finish(exitCode === 0 ? "confirmed" : "violated", exitCode);
    })();
  });
  if (options.timeoutMs > 0) {
    timer = setTimeout(
      () => terminate(`timeout after ${options.timeoutMs}ms`),
      options.timeoutMs
    );
    timer.unref?.();
  }
  if (options.signal) {
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) abort();
  }
});

// src/state/store.ts
var STATE_TOPIC = "fabric.state";
var CURRENT_KEY = "state/current";
var GOAL_KEY = "state/goal";
var COMPLEXITY_KEY_PREFIX = "state/complexity/";
var CAS_RETRY_LIMIT = 8;
var REPORT_TEXT_MAX_BYTES = 8 * 1024;
var EVENT_TEXT_MAX_BYTES = 1024;
var EVENT_OUTPUT_MAX_BYTES = 4 * 1024;
var EVENT_RESULT_LIMIT = 8;
var EVENT_TARGET_LIMIT = 16;
var EVENT_ROLLBACK_LIMIT = 8;
var TRANSITION_PROTOCOL_VERSION = 1;
var DURABLE_HEAD_PROTOCOL_VERSION = 2;
var HEAD_COMMIT_PROOF_VERSION = 1;
var errorMessage2 = (error) => error instanceof Error ? error.message : String(error);
var isCasError = (error) => error instanceof Error && /compare-and-swap failed/.test(error.message);
var toStringArray = (value) => {
  if (!Array.isArray(value)) return void 0;
  const items = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) items.push(item);
  }
  return items.length > 0 ? items : void 0;
};
var digest2 = (value) => `sha256:${createHash5("sha256").update(JSON.stringify(value)).digest("hex")}`;
var truncateUtf83 = (value, maxBytes) => {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return { value, omittedBytes: 0 };
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 192) === 128) end--;
  const bounded2 = bytes.subarray(0, end).toString("utf8");
  return { value: bounded2, omittedBytes: bytes.length - end };
};
var boundedError = (error) => truncateUtf83(errorMessage2(error), REPORT_TEXT_MAX_BYTES).value;
var casActualVersion = (error) => {
  const match2 = errorMessage2(error).match(/found (\d+)$/);
  return match2 ? Number(match2[1]) : void 0;
};
var toComplexityRecord = (value) => {
  if (!value || typeof value !== "object") return void 0;
  const raw = value;
  if (!Array.isArray(raw.files) || typeof raw.netDelta !== "number") {
    return void 0;
  }
  const files = [];
  for (const item of raw.files) {
    if (!item || typeof item !== "object") continue;
    const delta = item;
    if (typeof delta.file !== "string" || typeof delta.supported !== "boolean") {
      continue;
    }
    files.push({
      file: delta.file,
      supported: delta.supported,
      ...typeof delta.language === "string" ? { language: delta.language } : {},
      ...typeof delta.previous === "number" ? { previous: delta.previous } : {},
      ...typeof delta.current === "number" ? { current: delta.current } : {},
      ...typeof delta.delta === "number" ? { delta: delta.delta } : {},
      ...typeof delta.baseline === "boolean" ? { baseline: delta.baseline } : {}
    });
  }
  return { files, netDelta: raw.netDelta };
};
var transitionReference = (event) => {
  const data = event.data;
  return data && typeof data.transitionId === "string" ? data.transitionId : void 0;
};
var committedTransitionIds = (events) => {
  const committed = /* @__PURE__ */ new Set();
  const rejected = /* @__PURE__ */ new Set();
  for (const event of events) {
    const transitionId = transitionReference(event);
    if (!transitionId) continue;
    if (event.kind === "transition.committed") committed.add(transitionId);
    if (event.kind === "transition.rejected") rejected.add(transitionId);
  }
  for (const transitionId of rejected) committed.delete(transitionId);
  return committed;
};
var toRecord = (event, committedIds) => {
  if (event.kind !== "transition") return void 0;
  const data = event.data;
  if (!data || typeof data !== "object") return void 0;
  if (data.phase === "proposed" && (committedIds === void 0 || !committedIds.has(event.id))) {
    return void 0;
  }
  if (data.phase === "rejected") return void 0;
  const label = typeof data.label === "string" ? data.label : "";
  const to = typeof data.to === "string" ? data.to : "";
  const summary = typeof data.summary === "string" ? data.summary : "";
  const kind = data.kind === "representation" ? "representation" : "state";
  const ts = typeof data.ts === "number" ? data.ts : event.createdAt;
  const from = typeof data.from === "string" ? data.from : void 0;
  const evidence = toStringArray(data.evidence);
  const tags = toStringArray(data.tags);
  const complexity = toComplexityRecord(data.complexity);
  const certificationStatus = data.certificationStatus === "pending" ? "pending" : void 0;
  if (!label || !to) return void 0;
  return {
    transitionId: event.id,
    sequence: event.sequence,
    label,
    ...from !== void 0 ? { from } : {},
    to,
    summary,
    ...evidence !== void 0 ? { evidence } : {},
    ...tags !== void 0 ? { tags } : {},
    kind,
    ...complexity !== void 0 ? { complexity } : {},
    ...certificationStatus !== void 0 ? { certificationStatus } : {},
    ts
  };
};
var toHeadRecord = (head) => {
  if (typeof head.transitionSequence !== "number" || !Number.isSafeInteger(head.transitionSequence) || head.transitionSequence < 1) {
    return void 0;
  }
  return {
    transitionId: head.transitionId,
    sequence: head.transitionSequence,
    label: head.label,
    ...head.from !== void 0 ? { from: head.from } : {},
    to: head.to,
    summary: head.summary,
    ...head.evidence !== void 0 ? { evidence: head.evidence } : {},
    ...head.tags !== void 0 ? { tags: head.tags } : {},
    kind: head.kind,
    ...head.complexity !== void 0 ? { complexity: head.complexity } : {},
    ...head.certificationStatus !== void 0 ? { certificationStatus: head.certificationStatus } : {},
    ts: head.ts
  };
};
var toCertificationTarget = (value) => {
  if (!value || typeof value !== "object") return void 0;
  const target = value;
  if (typeof target.transitionId !== "string" || typeof target.label !== "string" || typeof target.to !== "string") {
    return void 0;
  }
  return {
    transitionId: target.transitionId,
    label: target.label,
    to: target.to
  };
};
var toCertificationHead = (value) => {
  if (value === null) return null;
  if (!value || typeof value !== "object") return null;
  const head = value;
  if (typeof head.transitionId !== "string" || typeof head.label !== "string" || typeof head.to !== "string" || typeof head.version !== "number") {
    return null;
  }
  return {
    transitionId: head.transitionId,
    label: head.label,
    ...typeof head.labelDigest === "string" ? { labelDigest: head.labelDigest } : {},
    ...typeof head.labelOmittedBytes === "number" ? { labelOmittedBytes: head.labelOmittedBytes } : {},
    to: head.to,
    ...typeof head.toDigest === "string" ? { toDigest: head.toDigest } : {},
    ...typeof head.toOmittedBytes === "number" ? { toOmittedBytes: head.toOmittedBytes } : {},
    version: head.version
  };
};
var verificationTargets = (event) => {
  if (event.kind !== "state.certified" && event.kind !== "state.violated") return [];
  const data = event.data;
  if (!data || !Array.isArray(data.targets)) return [];
  return data.targets.map(toCertificationTarget).filter((target) => target !== void 0);
};
var latestTransitionOutcomes = (events) => {
  const latest = /* @__PURE__ */ new Map();
  for (const event of events) {
    if (event.kind !== "state.certified" && event.kind !== "state.violated") continue;
    for (const target of verificationTargets(event)) {
      latest.set(target.transitionId, {
        event,
        phase: event.kind === "state.certified" ? "certified" : "violated"
      });
    }
  }
  return latest;
};
var toCertificate = (event, currentHead, latestOutcomes) => {
  if (event.kind !== "state.certified") return void 0;
  const data = event.data;
  if (!data || !Array.isArray(data.targets) || typeof data.evidenceDigest !== "string" || typeof data.resultDigest !== "string") {
    return void 0;
  }
  const targets = data.targets.map(toCertificationTarget).filter((target) => target !== void 0);
  if (targets.length === 0) return void 0;
  const head = toCertificationHead(data.head);
  const currentTarget = currentHead === null ? void 0 : targets.find((target) => target.transitionId === currentHead.transitionId);
  const latestCurrentOutcome = currentTarget ? latestOutcomes?.get(currentTarget.transitionId) : void 0;
  const current = head !== null && currentHead !== null && currentTarget !== void 0 && head.transitionId === currentHead.transitionId && (head.labelDigest ? head.labelDigest === digest2(currentHead.label) : head.label === currentHead.label) && (head.toDigest ? head.toDigest === digest2(currentHead.to) : head.to === currentHead.to) && head.version === currentHead.version && (latestCurrentOutcome === void 0 || latestCurrentOutcome.phase === "certified" && latestCurrentOutcome.event.sequence === event.sequence);
  return {
    certificateId: event.id,
    sequence: event.sequence,
    certificationStatus: "certified",
    targets,
    head,
    evidenceDigest: data.evidenceDigest,
    resultDigest: data.resultDigest,
    ts: typeof data.ts === "number" ? data.ts : event.createdAt,
    current
  };
};
var durableCurrentCertificate = (head, latestOutcomes) => {
  const certificate = head.certificate;
  if (!certificate || certificate.certificationStatus !== "certified" || typeof certificate.certificateId !== "string" || typeof certificate.sequence !== "number" || !Array.isArray(certificate.targets) || typeof certificate.evidenceDigest !== "string" || typeof certificate.resultDigest !== "string" || typeof certificate.ts !== "number") {
    return void 0;
  }
  const certificateHead = toCertificationHead(certificate.head);
  const targets = certificate.targets.map(toCertificationTarget).filter((target2) => target2 !== void 0);
  const target = targets.find(
    (item) => item.transitionId === head.transitionId && item.label === head.label && item.to === head.to
  );
  const latestOutcome = latestOutcomes?.get(head.transitionId);
  if (!target || certificateHead === null || certificateHead.transitionId !== head.transitionId || (certificateHead.labelDigest ? certificateHead.labelDigest !== digest2(head.label) : certificateHead.label !== head.label) || (certificateHead.toDigest ? certificateHead.toDigest !== digest2(head.to) : certificateHead.to !== head.to) || certificateHead.version !== head.version || latestOutcome !== void 0 && (latestOutcome.phase !== "certified" || latestOutcome.event.sequence !== certificate.sequence)) {
    return void 0;
  }
  return {
    ...certificate,
    targets,
    head: certificateHead,
    current: true
  };
};
var toVerifyResult = (claim, command, result) => {
  const boundedClaim = truncateUtf83(claim, REPORT_TEXT_MAX_BYTES);
  const boundedCommand = truncateUtf83(command, REPORT_TEXT_MAX_BYTES);
  const boundedResultError = result.error ? truncateUtf83(result.error, REPORT_TEXT_MAX_BYTES) : void 0;
  return {
    claim: boundedClaim.value,
    claimDigest: digest2(claim),
    ...boundedClaim.omittedBytes > 0 ? { claimOmittedBytes: boundedClaim.omittedBytes } : {},
    command: boundedCommand.value,
    commandDigest: digest2(command),
    ...boundedCommand.omittedBytes > 0 ? { commandOmittedBytes: boundedCommand.omittedBytes } : {},
    status: result.status,
    exitCode: result.exitCode,
    output: result.output,
    outputBytes: result.outputBytes,
    outputOmittedBytes: result.outputOmittedBytes,
    outputDigest: result.outputDigest,
    ...boundedResultError ? {
      error: boundedResultError.value,
      errorDigest: digest2(result.error),
      ...boundedResultError.omittedBytes > 0 ? { errorOmittedBytes: boundedResultError.omittedBytes } : {}
    } : {}
  };
};
var toEventResult = (result) => {
  const claim = truncateUtf83(result.claim, EVENT_TEXT_MAX_BYTES);
  const command = truncateUtf83(result.command, EVENT_TEXT_MAX_BYTES);
  const output = truncateUtf83(result.output, EVENT_OUTPUT_MAX_BYTES);
  const error = result.error ? truncateUtf83(result.error, EVENT_TEXT_MAX_BYTES) : void 0;
  return {
    ...result,
    claim: claim.value,
    claimOmittedBytes: (result.claimOmittedBytes ?? 0) + claim.omittedBytes,
    command: command.value,
    commandOmittedBytes: (result.commandOmittedBytes ?? 0) + command.omittedBytes,
    output: output.value,
    outputOmittedBytes: result.outputOmittedBytes + output.omittedBytes,
    ...error ? {
      error: error.value,
      errorOmittedBytes: (result.errorOmittedBytes ?? 0) + error.omittedBytes
    } : {}
  };
};
var toEventFailure = (failure) => {
  const message = truncateUtf83(failure.message, EVENT_TEXT_MAX_BYTES).value;
  const transitionId = failure.transitionId ? truncateUtf83(failure.transitionId, EVENT_TEXT_MAX_BYTES).value : void 0;
  const label = failure.label ? truncateUtf83(failure.label, EVENT_TEXT_MAX_BYTES).value : void 0;
  const command = failure.command ? truncateUtf83(failure.command, EVENT_TEXT_MAX_BYTES).value : void 0;
  const error = failure.error ? truncateUtf83(failure.error, EVENT_TEXT_MAX_BYTES).value : void 0;
  return {
    ...failure,
    message,
    ...transitionId !== void 0 ? { transitionId } : {},
    ...label !== void 0 ? { label } : {},
    ...command !== void 0 ? { command } : {},
    ...error !== void 0 ? { error } : {}
  };
};
var StateStore = class {
  constructor(store) {
    this.store = store;
  }
  toHead(entry) {
    const value = entry.value;
    return { ...value, version: entry.version };
  }
  get() {
    const storedHead = this.getHead();
    const goalEntry = this.store.get(GOAL_KEY);
    const goal = goalEntry ? goalEntry.value : null;
    const ledgers = this.complexityLedgers();
    const history = this.history({});
    const lastComplexity = history.transitions.filter((transition) => transition.complexity !== void 0).at(-1)?.complexity;
    const headRecord = storedHead ? history.transitions.find(
      (transition) => transition.transitionId === storedHead.transitionId
    ) : void 0;
    const head = storedHead ? (() => {
      const { certificate: _storedCertificate, ...baseHead } = storedHead;
      return headRecord?.certificate ? {
        ...baseHead,
        certificationStatus: "certified",
        certificate: headRecord.certificate
      } : baseHead;
    })() : null;
    const complexity = {
      files: ledgers.length,
      decisionPoints: ledgers.reduce((total, ledger) => total + ledger.count, 0),
      lastNetDelta: lastComplexity?.netDelta ?? 0
    };
    return {
      head,
      goal,
      complexity,
      certification: {
        current: history.certifications.find((certificate) => certificate.current) ?? null,
        recent: history.certifications.slice(0, 20)
      }
    };
  }
  getHead() {
    const entry = this.store.get(CURRENT_KEY);
    if (!entry) return null;
    const head = this.toHead(entry);
    if (head.protocolVersion === DURABLE_HEAD_PROTOCOL_VERSION) {
      const proof = head.commitProof;
      const hasValidSequence = typeof head.transitionSequence === "number" && Number.isSafeInteger(head.transitionSequence) && head.transitionSequence > 0;
      if (!hasValidSequence || proof?.version !== HEAD_COMMIT_PROOF_VERSION) {
        return null;
      }
      if (proof.status === "committed") return head;
      if (proof.status !== "pending") return null;
      return committedTransitionIds(this.stateEvents()).has(head.transitionId) ? head : null;
    }
    const events = this.stateEvents();
    const committedIds = committedTransitionIds(events);
    if (head.protocolVersion === TRANSITION_PROTOCOL_VERSION) {
      return committedIds.has(head.transitionId) ? head : null;
    }
    const proposal = events.find(
      (event) => event.kind === "transition" && event.id === head.transitionId
    );
    if (!proposal) return head;
    const data = proposal.data;
    return data?.phase === "proposed" && !committedIds.has(proposal.id) ? null : head;
  }
  async transition(input, identity, cwd = process.cwd()) {
    const physicalCurrent = this.store.get(CURRENT_KEY);
    const current = this.getHead();
    const expectedVersion = physicalCurrent?.version ?? this.lastDeletedVersion(CURRENT_KEY);
    if (physicalCurrent && !current) {
      throw new Error(
        "State contention: current head belongs to an uncommitted or quarantined proposal"
      );
    }
    const currentTo = current?.to;
    const force = input.force === true;
    if (!force && currentTo !== void 0 && input.from !== void 0) {
      if (input.from !== currentTo) {
        throw new Error(
          `State from-mismatch: head is at "${currentTo}", but transition declares from "${input.from}"`
        );
      }
    }
    const ts = Date.now();
    const preparedComplexity = input.complexity ? this.prepareComplexity(input.complexity.files, cwd, ts) : void 0;
    const isComplexityReduction = preparedComplexity !== void 0 && preparedComplexity.record.netDelta < 0;
    if (isComplexityReduction && !input.evidence?.some((command) => command.trim().length > 0)) {
      throw new Error(
        `State complexity reduction rejected: net decision-point delta is ${preparedComplexity.record.netDelta}. Reducing branches is also achievable by deleting error handling; attach at least one replayable behavior-preservation evidence command to separate abstraction from vandalism. The reduction remains pending until a later state.verify() succeeds.`
      );
    }
    const kind = input.kind ?? "state";
    const data = {
      protocolVersion: TRANSITION_PROTOCOL_VERSION,
      phase: "proposed",
      label: input.label,
      to: input.to,
      summary: input.summary,
      kind,
      ts,
      ...input.from !== void 0 ? { from: input.from } : {},
      ...input.evidence ? { evidence: input.evidence } : {},
      ...input.tags ? { tags: input.tags } : {},
      ...preparedComplexity ? { complexity: preparedComplexity.record } : {},
      ...isComplexityReduction ? { certificationStatus: "pending" } : {}
    };
    const event = await this.store.publish({
      topic: STATE_TOPIC,
      kind: "transition",
      from: identity,
      text: input.summary,
      data
    });
    const applied = [];
    let headWrite;
    let commitMarkerPublished = false;
    try {
      for (const update of preparedComplexity?.updates ?? []) {
        const written = await this.store.put({
          key: update.key,
          value: update.value,
          ifVersion: update.expectedVersion,
          identity
        });
        applied.push({ key: update.key, before: update.before, written });
      }
      const payload = {
        protocolVersion: DURABLE_HEAD_PROTOCOL_VERSION,
        commitProof: {
          version: HEAD_COMMIT_PROOF_VERSION,
          status: "pending"
        },
        transitionSequence: event.sequence,
        label: input.label,
        ...input.from !== void 0 ? { from: input.from } : {},
        to: input.to,
        summary: input.summary,
        kind,
        ...preparedComplexity ? { complexity: preparedComplexity.record } : {},
        transitionId: event.id,
        ts,
        ...input.evidence ? { evidence: input.evidence } : {},
        ...input.tags ? { tags: input.tags } : {},
        ...isComplexityReduction ? { certificationStatus: "pending" } : {}
      };
      const advanced = await this.advanceHeadWithBefore({
        payload,
        from: input.from,
        force,
        expectedVersion,
        identity
      });
      headWrite = {
        key: CURRENT_KEY,
        before: advanced.before,
        written: advanced.entry
      };
      await this.store.publish({
        topic: STATE_TOPIC,
        kind: "transition.committed",
        from: identity,
        text: "state transition committed",
        data: {
          protocolVersion: TRANSITION_PROTOCOL_VERSION,
          phase: "committed",
          transitionId: event.id,
          ts: Date.now()
        }
      });
      commitMarkerPublished = true;
      const committedHead = await this.markHeadCommitted(advanced.entry, identity);
      return { event, head: this.toHead(committedHead) };
    } catch (error) {
      if (commitMarkerPublished) {
        throw new Error(
          `State transition committed, but its durable head proof remains pending: ${boundedError(error)}`,
          { cause: error }
        );
      }
      const rollback = await this.rollbackWrites(
        [...headWrite ? [headWrite] : [], ...applied.reverse()],
        identity
      );
      let reportingError;
      try {
        const deletedChunks = [];
        for (let index = 0; index < rollback.deleted.length; index += EVENT_ROLLBACK_LIMIT) {
          deletedChunks.push(
            rollback.deleted.slice(index, index + EVENT_ROLLBACK_LIMIT).map((item) => ({
              key: truncateUtf83(item.key, REPORT_TEXT_MAX_BYTES).value,
              version: item.version
            }))
          );
        }
        if (deletedChunks.length === 0) deletedChunks.push([]);
        for (let index = 0; index < deletedChunks.length; index++) {
          await this.store.publish({
            topic: STATE_TOPIC,
            kind: "transition.rejected",
            from: identity,
            text: rollback.errors.length > 0 ? "state transition quarantined" : "state transition rejected",
            data: {
              protocolVersion: TRANSITION_PROTOCOL_VERSION,
              phase: "rejected",
              transitionId: event.id,
              error: truncateUtf83(errorMessage2(error), EVENT_TEXT_MAX_BYTES).value,
              rollback: {
                restored: rollback.errors.length === 0,
                deleted: deletedChunks[index],
                errors: index === 0 ? rollback.errors.slice(0, EVENT_ROLLBACK_LIMIT).map((item) => truncateUtf83(item, EVENT_TEXT_MAX_BYTES).value) : [],
                omittedErrorCount: Math.max(
                  0,
                  rollback.errors.length - EVENT_ROLLBACK_LIMIT
                ),
                chunk: { index, count: deletedChunks.length }
              },
              quarantine: rollback.errors.length > 0,
              ts: Date.now()
            }
          });
        }
      } catch (publishError) {
        reportingError = boundedError(publishError);
      }
      const detail = [
        `State transition rejected: ${boundedError(error)}`,
        ...rollback.errors.length > 0 ? [`rollback quarantine: ${rollback.errors.join("; ")}`] : [],
        ...reportingError ? [`rejection reporting failed: ${reportingError}`] : []
      ].join("; ");
      throw new Error(detail, { cause: error });
    }
  }
  async markHeadCommitted(pending, identity) {
    const value = pending.value;
    try {
      return await this.store.put({
        key: CURRENT_KEY,
        value: {
          ...value,
          commitProof: {
            version: HEAD_COMMIT_PROOF_VERSION,
            status: "committed"
          }
        },
        ifVersion: pending.version,
        identity
      });
    } catch (error) {
      if (!isCasError(error)) throw error;
      const current = this.store.get(CURRENT_KEY);
      if (current && current.value.transitionId === value.transitionId && current.value.commitProof?.version === HEAD_COMMIT_PROOF_VERSION && current.value.commitProof?.status === "committed") {
        return current;
      }
      return pending;
    }
  }
  // Advance the compare-and-swap head pointer for a durable proposal. The
  // proposal remains invisible until its commit marker. On CAS contention we
  // re-read, re-validate `from` against the new head, and retry — a bounded
  // number of times. If `from` no longer chains from the current head, the
  // transition is rejected with the actual current label (Schema's surprise:
  // the plan's assumed state was voided by a concurrent writer).
  async advanceHead(input) {
    return (await this.advanceHeadWithBefore(input)).entry;
  }
  async advanceHeadWithBefore(input) {
    let version = input.expectedVersion;
    for (let attempt = 0; attempt < CAS_RETRY_LIMIT; attempt++) {
      const before = this.store.get(CURRENT_KEY);
      try {
        const entry = await this.store.put({
          key: CURRENT_KEY,
          value: input.payload,
          ifVersion: version,
          identity: input.identity
        });
        return { entry, before };
      } catch (error) {
        if (!isCasError(error)) throw error;
        const current = this.store.get(CURRENT_KEY);
        const actualTo = current ? current.value.to : void 0;
        if (!input.force) {
          if (current && input.from !== void 0 && actualTo !== void 0) {
            if (input.from !== actualTo) {
              throw new Error(
                `State contention: head is at "${actualTo}", cannot transition from "${input.from}"`
              );
            }
          } else if (current && input.from === void 0) {
            throw new Error(
              `State contention: head advanced to "${actualTo ?? "<unknown>"}" before transition`
            );
          }
        }
        version = current?.version ?? casActualVersion(error) ?? 0;
      }
    }
    throw new Error(
      `State contention: compare-and-swap retries exhausted after ${CAS_RETRY_LIMIT} attempts`
    );
  }
  async rollbackWrites(writes, identity) {
    const deleted = [];
    const errors = [];
    for (const write of writes) {
      try {
        if (write.before) {
          await this.store.put({
            key: write.key,
            value: write.before.value,
            ifVersion: write.written.version,
            identity
          });
        } else {
          const result = await this.store.delete({
            key: write.key,
            ifVersion: write.written.version
          });
          if (result.deleted && result.version !== void 0) {
            deleted.push({ key: write.key, version: result.version });
          }
        }
      } catch (error) {
        errors.push(`${write.key}: ${boundedError(error)}`);
      }
    }
    return { deleted, errors };
  }
  stateEvents() {
    return this.store.read({ topic: STATE_TOPIC, limit: this.store.maxReadEvents });
  }
  lastDeletedVersion(key) {
    const events = this.stateEvents();
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index];
      if (event?.kind !== "transition.rejected") continue;
      const data = event.data;
      const rollback = data?.rollback;
      if (!rollback || !Array.isArray(rollback.deleted)) continue;
      for (const item of rollback.deleted) {
        if (!item || typeof item !== "object") continue;
        const deleted = item;
        if (deleted.key === key && typeof deleted.version === "number") {
          return deleted.version;
        }
      }
    }
    return 0;
  }
  history(input = {}) {
    const events = this.stateEvents();
    const committedIds = committedTransitionIds(events);
    const currentHead = this.getHead();
    const records = [];
    for (const event of events) {
      const record = toRecord(event, committedIds);
      if (record) records.push(record);
    }
    if (currentHead && !records.some((record) => record.transitionId === currentHead.transitionId)) {
      const currentRecord = toHeadRecord(currentHead);
      if (currentRecord) records.push(currentRecord);
    }
    records.sort((left, right) => left.sequence - right.sequence);
    let lastRepresentation = -1;
    for (let index = records.length - 1; index >= 0; index--) {
      if (records[index]?.kind === "representation") {
        lastRepresentation = index;
        break;
      }
    }
    const visibleRecords = input.includeArchived || lastRepresentation < 0 ? records : records.slice(lastRepresentation);
    const visibleIds = new Set(visibleRecords.map((record) => record.transitionId));
    const latestOutcomes = latestTransitionOutcomes(events);
    const eventCertifications = events.map((event) => toCertificate(event, currentHead, latestOutcomes)).filter((certificate) => certificate !== void 0).filter(
      (certificate) => certificate.targets.every((target) => visibleIds.has(target.transitionId))
    ).reverse();
    const durableCertificate = currentHead ? durableCurrentCertificate(currentHead, latestOutcomes) : void 0;
    const certifications = durableCertificate ? [
      durableCertificate,
      ...eventCertifications.filter(
        (certificate) => certificate.certificateId !== durableCertificate.certificateId
      )
    ] : eventCertifications;
    const certificatesBySequence = new Map(
      certifications.map((certificate) => [certificate.sequence, certificate])
    );
    const latestCertificate = /* @__PURE__ */ new Map();
    for (const record of visibleRecords) {
      const outcome = latestOutcomes.get(record.transitionId);
      if (outcome?.phase !== "certified") continue;
      const certificate = certificatesBySequence.get(outcome.event.sequence);
      if (certificate) latestCertificate.set(record.transitionId, certificate);
    }
    if (durableCertificate) {
      latestCertificate.set(currentHead.transitionId, durableCertificate);
    }
    const archiveBoundaryId = input.includeArchived !== true && lastRepresentation > 0 ? records[lastRepresentation]?.transitionId : void 0;
    const filtered = (input.label ? visibleRecords.filter(
      (record) => record.label === input.label || record.to === input.label || record.from === input.label && record.transitionId !== archiveBoundaryId
    ) : visibleRecords).map((record) => {
      const certificate = latestCertificate.get(record.transitionId);
      return certificate ? { ...record, certificationStatus: "certified", certificate } : record;
    });
    const limited = input.limit !== void 0 && input.limit > 0 ? filtered.slice(0, input.limit) : filtered;
    const labelSet = /* @__PURE__ */ new Set();
    const limitedIds = /* @__PURE__ */ new Set();
    for (const record of limited) {
      limitedIds.add(record.transitionId);
      if (record.from && record.transitionId !== archiveBoundaryId) {
        labelSet.add(record.from);
      }
      labelSet.add(record.to);
      labelSet.add(record.label);
    }
    return {
      transitions: limited,
      labels: [...labelSet],
      certifications: certifications.filter(
        (certificate) => certificate.targets.some((target) => limitedIds.has(target.transitionId))
      )
    };
  }
  complexity(input) {
    const requestedFiles = input.files ?? this.complexityLedgers().map((entry) => entry.file);
    const files = [];
    let netDelta = 0;
    for (const file of this.normalizeComplexityFiles(requestedFiles, input.cwd)) {
      const measured = countFileComplexity(path17.resolve(input.cwd, file), input.cwd);
      if (!measured) {
        files.push({ file, supported: false });
        continue;
      }
      const ledger = this.readComplexityLedger(file);
      const delta = ledger ? measured.count - ledger.count : 0;
      netDelta += delta;
      files.push({
        file,
        supported: true,
        language: measured.language,
        current: measured.count,
        ...ledger ? {
          recorded: ledger.count,
          delta,
          recordedDelta: ledger.lastDelta
        } : { delta: 0 }
      });
    }
    return { files, netDelta };
  }
  prepareComplexity(files, cwd, ts) {
    const deltas = [];
    const updates = [];
    let netDelta = 0;
    for (const file of this.normalizeComplexityFiles(files, cwd)) {
      const measured = countFileComplexity(path17.resolve(cwd, file), cwd);
      if (!measured) {
        deltas.push({ file, supported: false });
        continue;
      }
      const entry = this.store.get(this.complexityKey(file));
      const previous = entry ? entry.value.count : void 0;
      const delta = previous === void 0 ? 0 : measured.count - previous;
      netDelta += delta;
      deltas.push({
        file,
        supported: true,
        language: measured.language,
        ...previous !== void 0 ? { previous } : {},
        current: measured.count,
        delta,
        baseline: previous === void 0
      });
      const key = this.complexityKey(file);
      updates.push({
        key,
        value: {
          file,
          language: measured.language,
          count: measured.count,
          lastDelta: delta,
          ts
        },
        expectedVersion: entry?.version ?? this.lastDeletedVersion(key),
        before: entry
      });
    }
    return { record: { files: deltas, netDelta }, updates };
  }
  complexityLedgers() {
    return this.store.list(COMPLEXITY_KEY_PREFIX, this.store.maxReadEvents).map((entry) => entry.value).filter(
      (value) => typeof value.file === "string" && typeof value.language === "string" && typeof value.count === "number" && typeof value.lastDelta === "number"
    );
  }
  readComplexityLedger(file) {
    const entry = this.store.get(this.complexityKey(file));
    return entry ? entry.value : void 0;
  }
  complexityKey(file) {
    return `${COMPLEXITY_KEY_PREFIX}${file}`;
  }
  normalizeComplexityFiles(files, cwd) {
    const normalized = /* @__PURE__ */ new Set();
    for (const file of files) {
      if (!file.trim()) continue;
      const relative2 = path17.relative(cwd, path17.resolve(cwd, file));
      if (relative2 === ".." || relative2.startsWith(`..${path17.sep}`) || path17.isAbsolute(relative2)) {
        throw new Error(`State complexity file must be inside the project cwd: ${file}`);
      }
      normalized.add(relative2.split(path17.sep).join("/"));
    }
    return [...normalized];
  }
  async goal(input, identity) {
    const value = {
      check: input.check,
      ...input.description !== void 0 ? { description: input.description } : {}
    };
    return this.store.put({
      key: GOAL_KEY,
      value,
      identity
    });
  }
  async checkGoal(input) {
    const entry = this.store.get(GOAL_KEY);
    if (!entry) throw new Error("No goal set");
    const goal = entry.value;
    const result = await runCommand(goal.check, {
      cwd: input.cwd,
      timeoutMs: input.timeoutMs ?? 3e4,
      ...input.signal ? { signal: input.signal } : {}
    });
    const passed = result.status === "confirmed";
    if (passed) {
      const check = truncateUtf83(goal.check, EVENT_TEXT_MAX_BYTES);
      const output = truncateUtf83(result.output, EVENT_OUTPUT_MAX_BYTES);
      await this.store.publish({
        topic: STATE_TOPIC,
        kind: "state.goal.met",
        from: input.identity,
        text: "goal met",
        data: {
          check: check.value,
          checkDigest: digest2(goal.check),
          checkOmittedBytes: check.omittedBytes,
          output: output.value,
          outputBytes: result.outputBytes,
          outputOmittedBytes: result.outputOmittedBytes + output.omittedBytes,
          outputDigest: result.outputDigest,
          exitCode: result.exitCode
        }
      });
    }
    return {
      passed,
      output: result.output,
      exitCode: result.exitCode,
      ...result.error !== void 0 ? { error: result.error } : {}
    };
  }
  async persistCurrentCertificate(certificate, verificationHead, identity) {
    const current = this.store.get(CURRENT_KEY);
    const currentValue = current?.value;
    if (!current || current.version !== verificationHead.version || currentValue?.transitionId !== verificationHead.transitionId || currentValue.label !== verificationHead.label || currentValue.to !== verificationHead.to) {
      return { ...certificate, current: false };
    }
    const certificateHead = certificate.head;
    if (certificateHead === null) return { ...certificate, current: false };
    const nextVersion = current.version + 1;
    const durableCertificate = {
      ...certificate,
      head: { ...certificateHead, version: nextVersion },
      current: true
    };
    try {
      const written = await this.store.put({
        key: CURRENT_KEY,
        value: {
          ...currentValue,
          certificate: durableCertificate
        },
        ifVersion: current.version,
        identity
      });
      return written.version === nextVersion ? durableCertificate : { ...durableCertificate, current: false };
    } catch (error) {
      if (isCasError(error)) return { ...certificate, current: false };
      throw error;
    }
  }
  async revokeCurrentCertificate(verificationHead, identity) {
    const current = this.store.get(CURRENT_KEY);
    const currentValue = current?.value;
    if (!current || current.version !== verificationHead.version || currentValue?.transitionId !== verificationHead.transitionId || currentValue.label !== verificationHead.label || currentValue.to !== verificationHead.to || currentValue.certificate === void 0) {
      return;
    }
    const { certificate: _certificate, ...withoutCertificate } = currentValue;
    try {
      await this.store.put({
        key: CURRENT_KEY,
        value: withoutCertificate,
        ifVersion: current.version,
        identity
      });
    } catch (error) {
      if (!isCasError(error)) throw error;
    }
  }
  async verify(input) {
    const verificationHead = this.getHead();
    const boundedHeadLabel = verificationHead ? truncateUtf83(verificationHead.label, EVENT_TEXT_MAX_BYTES) : void 0;
    const boundedHeadTo = verificationHead ? truncateUtf83(verificationHead.to, EVENT_TEXT_MAX_BYTES) : void 0;
    const headIdentity = verificationHead && boundedHeadLabel && boundedHeadTo ? {
      transitionId: verificationHead.transitionId,
      label: boundedHeadLabel.value,
      labelDigest: digest2(verificationHead.label),
      ...boundedHeadLabel.omittedBytes > 0 ? { labelOmittedBytes: boundedHeadLabel.omittedBytes } : {},
      to: boundedHeadTo.value,
      toDigest: digest2(verificationHead.to),
      ...boundedHeadTo.omittedBytes > 0 ? { toOmittedBytes: boundedHeadTo.omittedBytes } : {},
      version: verificationHead.version
    } : null;
    let targets;
    if (input.labels !== void 0) {
      const matches = /* @__PURE__ */ new Map();
      for (const label of input.labels.filter((item) => item.trim().length > 0)) {
        const { transitions } = this.history({
          label,
          includeArchived: input.includeArchived === true
        });
        for (const transition of transitions) {
          matches.set(transition.transitionId, transition);
        }
      }
      targets = [...matches.values()].sort(
        (left, right) => left.sequence - right.sequence
      );
    } else if (verificationHead) {
      const { transitions } = this.history({
        includeArchived: input.includeArchived === true
      });
      const match2 = transitions.find(
        (record) => record.transitionId === verificationHead.transitionId
      );
      targets = match2 ? [match2] : [];
    } else {
      targets = [];
    }
    const certificationTargets = targets.map((target) => ({
      transitionId: target.transitionId,
      label: target.label,
      to: target.to
    }));
    const evidenceDigest = digest2(
      targets.map((target) => ({
        transitionId: target.transitionId,
        label: target.label,
        to: target.to,
        evidence: target.evidence ?? []
      }))
    );
    const results = [];
    const failures = [];
    if (targets.length === 0) {
      failures.push({
        reason: "missing-target",
        message: input.labels === void 0 ? "No current state transition is available to verify" : "No active state transitions matched the requested labels"
      });
    }
    for (const target of targets) {
      const evidence = target.evidence ?? [];
      if (evidence.length === 0) {
        failures.push({
          reason: "missing-evidence",
          message: `Transition "${target.label}" has no executable evidence`,
          transitionId: target.transitionId,
          label: target.label
        });
      }
      for (const command of evidence) {
        const result = input.signal?.aborted ? {
          status: "error",
          exitCode: null,
          output: "",
          outputBytes: 0,
          outputOmittedBytes: 0,
          outputDigest: digest2(""),
          error: "aborted before execution"
        } : await runCommand(command, {
          cwd: input.cwd,
          timeoutMs: input.timeoutMs ?? 3e4,
          ...input.signal ? { signal: input.signal } : {}
        });
        results.push(toVerifyResult(target.summary, command, result));
      }
    }
    for (const result of results) {
      if (result.status === "confirmed") continue;
      failures.push({
        reason: result.status === "violated" ? "nonzero-exit" : "execution-error",
        message: result.status === "violated" ? `Evidence exited nonzero (${result.exitCode ?? "unknown"}): ${result.command}` : `Evidence could not be confirmed: ${result.command}${result.error ? ` (${result.error})` : ""}`,
        command: result.command,
        status: result.status,
        exitCode: result.exitCode,
        ...result.error !== void 0 ? { error: result.error } : {}
      });
    }
    let certified = results.length > 0 && failures.length === 0 && results.every((result) => result.status === "confirmed");
    let resultDigest = digest2({ results, failures });
    const boundedTargets = certificationTargets.map((target) => ({
      transitionId: truncateUtf83(target.transitionId, EVENT_TEXT_MAX_BYTES).value,
      label: truncateUtf83(target.label, EVENT_TEXT_MAX_BYTES).value,
      to: truncateUtf83(target.to, EVENT_TEXT_MAX_BYTES).value
    }));
    const targetChunks = [];
    for (let index = 0; index < boundedTargets.length; index += EVENT_TARGET_LIMIT) {
      targetChunks.push(boundedTargets.slice(index, index + EVENT_TARGET_LIMIT));
    }
    if (targetChunks.length === 0) targetChunks.push([]);
    const targetsCurrentHead = verificationHead !== null && certificationTargets.some(
      (target) => target.transitionId === verificationHead.transitionId
    );
    const publishViolation = async () => {
      const nonConfirmed = results.filter((result) => result.status !== "confirmed");
      try {
        for (let index = 0; index < targetChunks.length; index++) {
          await this.store.publish({
            topic: STATE_TOPIC,
            kind: "state.violated",
            from: input.identity,
            text: "state certification blocked",
            data: {
              certified: false,
              head: headIdentity,
              evidenceDigest,
              resultDigest,
              targets: targetChunks[index],
              targetChunk: { index, count: targetChunks.length },
              results: index === 0 ? nonConfirmed.slice(0, EVENT_RESULT_LIMIT).map(toEventResult) : [],
              omittedResultCount: Math.max(0, nonConfirmed.length - EVENT_RESULT_LIMIT),
              reasons: index === 0 ? failures.slice(0, EVENT_RESULT_LIMIT).map(toEventFailure) : [],
              omittedReasonCount: Math.max(0, failures.length - EVENT_RESULT_LIMIT),
              ts: Date.now()
            }
          });
        }
        return void 0;
      } catch (error) {
        return boundedError(error);
      }
    };
    const recordViolation = async () => {
      let revocationError;
      if (targetsCurrentHead && verificationHead) {
        try {
          await this.revokeCurrentCertificate(verificationHead, input.identity);
        } catch (error) {
          revocationError = `current certificate revocation failed: ${boundedError(error)}`;
        }
      }
      const publishError = await publishViolation();
      return [revocationError, publishError].filter((value) => value !== void 0).join("; ") || void 0;
    };
    if (!certified) {
      const reportingError = await recordViolation();
      return {
        results,
        certified: false,
        violated: true,
        certificationStatus: "failed",
        evidenceDigest,
        resultDigest,
        failures,
        ...reportingError ? { reportingError } : {}
      };
    }
    const ts = Date.now();
    try {
      let certificateEvent;
      for (let index = 0; index < targetChunks.length; index++) {
        const event = await this.store.publish({
          topic: STATE_TOPIC,
          kind: "state.certified",
          from: input.identity,
          text: "state certified",
          data: {
            certificationStatus: "certified",
            targets: targetChunks[index],
            targetChunk: { index, count: targetChunks.length },
            head: headIdentity,
            evidenceDigest,
            resultDigest,
            ts
          }
        });
        if (certificateEvent === void 0 || targetChunks[index]?.some(
          (target) => target.transitionId === headIdentity?.transitionId
        )) {
          certificateEvent = event;
        }
      }
      if (!certificateEvent) throw new Error("State certificate event was not recorded");
      const certificate = toCertificate(certificateEvent, this.getHead());
      if (!certificate) throw new Error("State certificate event was malformed");
      const durableCertificate = verificationHead && certificate.current ? await this.persistCurrentCertificate(
        certificate,
        verificationHead,
        input.identity
      ) : certificate;
      return {
        results,
        certified: true,
        violated: false,
        certificationStatus: "certified",
        evidenceDigest,
        resultDigest,
        failures,
        certificate: durableCertificate
      };
    } catch (error) {
      certified = false;
      const certificationReportingError = boundedError(error);
      failures.push({
        reason: "reporting-error",
        message: `Certification could not be recorded: ${certificationReportingError}`,
        error: certificationReportingError
      });
      resultDigest = digest2({ results, failures });
      const violationReportingError = await recordViolation();
      const reportingError = violationReportingError ? `${certificationReportingError}; violation reporting failed: ${violationReportingError}` : certificationReportingError;
      return {
        results,
        certified,
        violated: true,
        certificationStatus: "failed",
        evidenceDigest,
        resultDigest,
        failures,
        reportingError
      };
    }
  }
};

// src/providers/state-provider.ts
var STATE_ENTITY_ID = "fabric-state";
var transitionSchema = {
  type: "object",
  properties: {
    label: {
      type: "string",
      description: 'Name of this transition (the move), e.g. "applied auth patch"'
    },
    from: {
      type: "string",
      description: "State label this transition moves from. Must equal the current head's to-label when a head exists; rejected on mismatch unless force is set."
    },
    to: {
      type: "string",
      description: "Resulting state label (the new world-model version)"
    },
    summary: { type: "string", description: "Short human-readable claim this transition asserts" },
    evidence: {
      type: "array",
      items: { type: "string" },
      description: "Trusted shell commands attached as evidence. Attachment is not certification; state.verify must run at least one command and confirm every result."
    },
    tags: { type: "array", items: { type: "string" } },
    kind: {
      type: "string",
      enum: ["state", "representation"],
      description: 'Default "state". "representation" revises the state schema and archives all earlier labels.'
    },
    complexity: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: { type: "string" },
          description: "Project-relative TS/JS/TSX/JSX files whose decision points this transition changes."
        }
      },
      required: ["files"],
      additionalProperties: false
    },
    force: {
      type: "boolean",
      description: "Override the from-mismatch and contention guards."
    }
  },
  required: ["label", "to", "summary"],
  additionalProperties: false
};
var verifySchema = {
  type: "object",
  properties: {
    labels: {
      type: "array",
      items: { type: "string" },
      description: "Verify transitions matching these labels (by transition.label, from, or to). Omit to verify the current head; an empty or unmatched selection fails closed."
    },
    includeArchived: {
      type: "boolean",
      description: "Also replay evidence from labels before the last representation transition."
    },
    timeoutMs: { type: "number", minimum: 1, description: "Per-command timeout (default 30s)" }
  },
  additionalProperties: false
};
var historySchema = {
  type: "object",
  properties: {
    label: { type: "string", description: "Filter transitions by label, from, or to" },
    limit: { type: "number", minimum: 1 },
    includeArchived: {
      type: "boolean",
      description: "Reveal labels before the last representation transition."
    }
  },
  additionalProperties: false
};
var complexitySchema = {
  type: "object",
  properties: {
    files: {
      type: "array",
      items: { type: "string" },
      description: "Project-relative files to count. Omit to inspect all recorded files."
    }
  },
  additionalProperties: false
};
var goalSchema = {
  type: "object",
  properties: {
    check: {
      type: "string",
      description: "Executable shell predicate; exit 0 means the goal is met."
    },
    description: { type: "string" }
  },
  required: ["check"],
  additionalProperties: false
};
var checkGoalSchema = {
  type: "object",
  properties: { timeoutMs: { type: "number", minimum: 1 } },
  additionalProperties: false
};
var emptySchema = { type: "object", properties: {}, additionalProperties: false };
var descriptors3 = [
  {
    name: "transition",
    description: "Append a labeled, validated state transition and compare-and-swap advance the head",
    inputSchema: transitionSchema,
    risk: "write",
    namespace: "state"
  },
  {
    name: "get",
    description: "Return the current state head, goal, compact complexity summary, recent labels, and current/recent certification state",
    inputSchema: emptySchema,
    risk: "read",
    namespace: "state"
  },
  {
    name: "history",
    description: "Fold the transition log from its representation archive boundary into an ordered label graph",
    inputSchema: historySchema,
    risk: "read",
    namespace: "state"
  },
  {
    name: "complexity",
    description: "Count current structural decision points and compare them with the complexity ledger",
    inputSchema: complexitySchema,
    risk: "read",
    namespace: "state"
  },
  {
    name: "verify",
    description: "Re-run evidence for the current head (or given labels); fail closed unless at least one command runs and every result is confirmed",
    inputSchema: verifySchema,
    risk: "execute",
    namespace: "state"
  },
  {
    name: "goal",
    description: "Set the executable goal predicate (Schema's is_goal)",
    inputSchema: goalSchema,
    risk: "write",
    namespace: "state"
  },
  {
    name: "checkGoal",
    description: "Run the goal predicate and report pass/fail; publishes state.goal.met when it passes",
    inputSchema: checkGoalSchema,
    risk: "execute",
    namespace: "state"
  }
];
var normalizeStateArgs = actionArgNormalizer(() => descriptors3);
var StateProvider = class {
  name = "state";
  description = "Schema-style labeled transition layer: an append-only timeline of validated transitions with a compare-and-swap head and evidence-based certification over mesh storage";
  #store;
  #identity;
  constructor(store, identity) {
    this.#store = new StateStore(store);
    this.#identity = identity;
  }
  get state() {
    return this.#store;
  }
  async list(request, _context) {
    const query = request.query?.toLowerCase();
    return query ? descriptors3.filter(
      (descriptor) => `${descriptor.name} ${descriptor.description}`.toLowerCase().includes(query)
    ) : descriptors3;
  }
  async describe(actionName, _context) {
    return descriptors3.find((descriptor) => descriptor.name === actionName);
  }
  prepareArguments(actionName, args) {
    return normalizeStateArgs(actionName, args);
  }
  async invoke(actionName, args, context) {
    switch (actionName) {
      case "transition": {
        const label = String(args.label);
        const to = String(args.to);
        const summary = String(args.summary);
        const from = typeof args.from === "string" ? args.from : void 0;
        const evidence = Array.isArray(args.evidence) ? args.evidence.filter((item) => typeof item === "string") : void 0;
        const tags = Array.isArray(args.tags) ? args.tags.filter((item) => typeof item === "string") : void 0;
        const kind = args.kind === "representation" || args.kind === "state" ? args.kind : void 0;
        const complexityFiles = typeof args.complexity === "object" && args.complexity !== null && Array.isArray(args.complexity.files) ? args.complexity.files.filter(
          (item) => typeof item === "string"
        ) : void 0;
        const force = args.force === true;
        const { event, head } = await this.#store.transition(
          {
            label,
            ...from !== void 0 ? { from } : {},
            to,
            summary,
            ...evidence ? { evidence } : {},
            ...tags ? { tags } : {},
            ...kind ? { kind } : {},
            ...complexityFiles ? { complexity: { files: complexityFiles } } : {},
            force
          },
          this.#identity,
          context.cwd
        );
        context.activity?.({
          type: "entity",
          id: STATE_ENTITY_ID,
          kind: "mesh",
          name: `${label} \u2192 ${to}`
        });
        context.update(`State transitioned to "${to}" via "${label}"`);
        return { event, head };
      }
      case "get": {
        const { head, goal, complexity, certification } = this.#store.get();
        const { labels } = this.#store.history({ limit: 20 });
        return { head, goal, complexity, certification, recentLabels: labels };
      }
      case "history": {
        const label = typeof args.label === "string" ? args.label : void 0;
        const limit = typeof args.limit === "number" ? args.limit : void 0;
        const includeArchived = args.includeArchived === true;
        return this.#store.history({
          ...label !== void 0 ? { label } : {},
          ...limit !== void 0 ? { limit } : {},
          includeArchived
        });
      }
      case "complexity": {
        const files = Array.isArray(args.files) ? args.files.filter((item) => typeof item === "string") : void 0;
        return this.#store.complexity({
          ...files ? { files } : {},
          cwd: context.cwd
        });
      }
      case "verify": {
        const labels = Array.isArray(args.labels) ? args.labels.filter((item) => typeof item === "string") : void 0;
        const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : void 0;
        const includeArchived = args.includeArchived === true;
        context.activity?.({
          type: "entity",
          id: STATE_ENTITY_ID,
          kind: "mesh",
          name: "verify"
        });
        const result = await this.#store.verify({
          ...labels ? { labels } : {},
          includeArchived,
          cwd: context.cwd,
          ...timeoutMs !== void 0 ? { timeoutMs } : {},
          ...context.signal ? { signal: context.signal } : {},
          identity: this.#identity
        });
        context.update(
          result.certified ? `State certified: ${result.results.length} evidence command(s) confirmed` : result.reportingError ? `State certification blocked; violation reporting failed: ${result.reportingError}` : "State certification blocked; violation details were published"
        );
        return result;
      }
      case "goal": {
        const check = String(args.check);
        const description = typeof args.description === "string" ? args.description : void 0;
        const entry = await this.#store.goal(
          { check, ...description !== void 0 ? { description } : {} },
          this.#identity
        );
        context.activity?.({
          type: "entity",
          id: STATE_ENTITY_ID,
          kind: "mesh",
          name: "goal"
        });
        return entry;
      }
      case "checkGoal": {
        const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : void 0;
        const result = await this.#store.checkGoal({
          cwd: context.cwd,
          ...timeoutMs !== void 0 ? { timeoutMs } : {},
          ...context.signal ? { signal: context.signal } : {},
          identity: this.#identity
        });
        context.update(
          result.passed ? "Goal met" : "Goal not met"
        );
        return result;
      }
      default:
        throw new Error(`Unknown state action: ${actionName}`);
    }
  }
};

// src/kiro/power/artifacts-provider.ts
var READ_DESCRIPTOR = {
  name: "read",
  description: "Read a bounded chunk of an opaque overflow artifact returned by fabric_exec.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", pattern: "^ka_[a-f0-9]{48}$" },
      offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 16e3 }
    },
    required: ["id"],
    additionalProperties: false
  },
  risk: "read",
  namespace: "ephemeral"
};
var KiroPowerArtifactsProvider = class {
  name = "artifacts";
  description = "Process-local Kiro Power overflow artifacts";
  #store;
  constructor(store) {
    this.#store = store;
  }
  async list(request) {
    const query = request.query?.toLowerCase();
    return !query || `${READ_DESCRIPTOR.name} ${READ_DESCRIPTOR.description}`.toLowerCase().includes(query) ? [READ_DESCRIPTOR] : [];
  }
  async describe(actionName) {
    return actionName === "read" ? READ_DESCRIPTOR : void 0;
  }
  async invoke(actionName, args, context) {
    if (actionName !== "read") throw new Error(`Unknown Kiro Power artifact action: artifacts.${actionName}`);
    throwIfAborted(context.signal);
    return runAbortable(context.signal, () => this.#store.read(
      args.id,
      args.offset,
      args.limit
    ));
  }
};

// src/kiro/artifacts.ts
import { randomBytes } from "node:crypto";
var DEFAULT_TTL_MS = 60 * 60 * 1e3;
var MAX_ARTIFACTS = 32;
var MAX_ARTIFACT_CHARS = 2e6;
var MAX_TOTAL_CHARS = 8e6;
var DEFAULT_READ_CHARS = 12e3;
var MAX_READ_CHARS = 16e3;
var ARTIFACT_ID = /^ka_[a-f0-9]{48}$/;
var KiroArtifactStoreError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "KiroArtifactStoreError";
  }
};
var EphemeralKiroArtifactStore = class {
  #entries = /* @__PURE__ */ new Map();
  #now;
  #totalChars = 0;
  #closed = false;
  constructor(options = {}) {
    this.#now = options.now ?? Date.now;
  }
  #assertOpen() {
    if (this.#closed) throw new KiroArtifactStoreError("artifact store is closed");
  }
  write(content) {
    this.#assertOpen();
    if (content.length > MAX_ARTIFACT_CHARS) {
      throw new KiroArtifactStoreError(
        `artifact exceeds the ${MAX_ARTIFACT_CHARS}-character session limit`
      );
    }
    this.sweep(DEFAULT_TTL_MS, MAX_ARTIFACTS - 1);
    while (this.#entries.size > 0 && this.#totalChars + content.length > MAX_TOTAL_CHARS) {
      this.#remove(this.#oldestId());
    }
    if (this.#totalChars + content.length > MAX_TOTAL_CHARS) {
      throw new KiroArtifactStoreError("artifact session quota exceeded");
    }
    let id;
    do
      id = `ka_${randomBytes(24).toString("hex")}`;
    while (this.#entries.has(id));
    const now = this.#now();
    this.#entries.set(id, { content, createdAt: now, lastReadAt: now });
    this.#totalChars += content.length;
    return id;
  }
  read(id, offset = 0, limit = DEFAULT_READ_CHARS) {
    this.#assertOpen();
    if (!ARTIFACT_ID.test(id)) throw new KiroArtifactStoreError("invalid artifact id");
    const entry = this.#entries.get(id);
    if (!entry) throw new KiroArtifactStoreError("artifact is unavailable or expired");
    const normalizedOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : -1;
    const normalizedLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, MAX_READ_CHARS) : -1;
    if (normalizedOffset < 0 || normalizedLimit < 0) {
      throw new KiroArtifactStoreError("artifact offset and limit must be positive integers");
    }
    entry.lastReadAt = this.#now();
    const text = entry.content.slice(normalizedOffset, normalizedOffset + normalizedLimit);
    const nextOffset = normalizedOffset + text.length;
    return {
      id,
      text,
      offset: normalizedOffset,
      nextOffset,
      totalChars: entry.content.length,
      done: nextOffset >= entry.content.length
    };
  }
  sweep(maxAgeMs = DEFAULT_TTL_MS, maxEntries = MAX_ARTIFACTS) {
    this.#assertOpen();
    const age = Number.isFinite(maxAgeMs) ? Math.max(0, maxAgeMs) : DEFAULT_TTL_MS;
    const keep = Number.isFinite(maxEntries) ? Math.max(0, Math.floor(maxEntries)) : MAX_ARTIFACTS;
    const now = this.#now();
    for (const [id, entry] of this.#entries) {
      if (now - entry.lastReadAt > age) this.#remove(id);
    }
    while (this.#entries.size > keep) this.#remove(this.#oldestId());
  }
  #oldestId() {
    let oldest;
    for (const current of this.#entries) {
      if (!oldest || current[1].lastReadAt < oldest[1].lastReadAt || current[1].lastReadAt === oldest[1].lastReadAt && current[0] < oldest[0]) oldest = current;
    }
    if (!oldest) throw new KiroArtifactStoreError("artifact store is empty");
    return oldest[0];
  }
  #remove(id) {
    const entry = this.#entries.get(id);
    if (!entry) return;
    this.#totalChars -= entry.content.length;
    this.#entries.delete(id);
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#entries.clear();
    this.#totalChars = 0;
  }
};
var createKiroArtifactStore = (_cwd, options = {}) => new EphemeralKiroArtifactStore(options);

// src/kiro/host.ts
var APPROVED_SESSION_RISKS = Symbol("fabric.approvedSessionRisks");
var FabricDenyApprovalFallback = class {
  constructor(config, sessionApprovals, unavailableReason) {
    this.config = config;
    this.sessionApprovals = sessionApprovals;
    this.unavailableReason = unavailableReason;
  }
  async approve(action, args = {}, scope = {}) {
    const mode = this.config[action.risk];
    if (mode === "allow" || this.sessionApprovals.has(action.risk)) return;
    void args;
    void scope;
    throw new Error(
      `${action.ref} requires ${action.risk} approval, but ${this.unavailableReason}`
    );
  }
};

// src/kiro/runtime.ts
var scopeContext = (cwd) => ({
  cwd,
  signal: void 0,
  parentToolCallId: "kiro:scope",
  nestedToolCallId: "kiro:scope",
  extensionContext: makeKiroContext(cwd),
  update() {
  }
});
var applyKiroRuntimeScope = async (runtime, tools) => {
  const parsed = parseKiroChildTools(tools);
  const lease = await runtime.registry.acquireCapabilityView(
    kiroChildToolRefs(parsed),
    scopeContext(runtime.host.cwd)
  );
  if (!lease.satisfied || !lease.view) {
    throw new Error(
      `Kiro child tools are unavailable: ${lease.missing.join(", ") || "<none>"}`
    );
  }
  runtime.service.setCapabilityView(lease.view);
  const previous = runtime.close.bind(runtime);
  runtime.close = async () => {
    await lease.release();
    await previous();
  };
  return parsed;
};
var prepareKiroRuntime = async (options) => {
  const runtime = createKiroRuntime(options);
  if (options.tools) await applyKiroRuntimeScope(runtime, options.tools);
  return runtime;
};
var KIRO_UNAVAILABLE_REASON = "Managed Kiro exposes no MCP elicitation approval bridge; approval-requiring actions fail closed";
var makeKiroContext = (cwd) => ({
  cwd,
  hasUI: false,
  model: void 0,
  modelRegistry: {
    getAvailable: () => [],
    find: () => void 0
  }
});
var createKiroRuntime = (options) => {
  const base = options.config ?? loadFabricConfig({
    cwd: options.cwd,
    agentDir: options.agentDir ?? resolveAgentDir(),
    projectTrusted: false
  });
  if (options.enableSubagents === true) {
    assertKiroAccountingCompatible(base.agents, true);
  }
  const power = options.integration === "power";
  const allowExecute = options.allowExecute === true || !power && /^1$/i.test(process.env.KIRO_FABRIC_ALLOW_SHELL ?? "");
  if (options.enableSubagents === true && !allowExecute) {
    throw new Error(
      "Managed Kiro subagents require trusted-local shell access; install with --allow-shell --subagents"
    );
  }
  const config = {
    ...base,
    fullCodeMode: true,
    executor: {
      ...base.executor,
      // Inner work must settle before the MCP deadline and the profile
      // request timeout, so the outer transport always observes a final
      // result instead of a dead call. Trusted-shell runs get the full
      // 15-minute execution window; orchestration may extend up to it but
      // never past the MCP envelope.
      timeoutMs: allowExecute ? Math.max(base.executor.timeoutMs, KIRO_EXECUTION_TIMEOUT_MS) : Math.min(base.executor.timeoutMs, KIRO_EXECUTION_TIMEOUT_MS)
    },
    agents: options.enableSubagents === true ? {
      ...base.agents,
      // Four scoped children matched the useful native-Kiro comparison;
      // larger fan-outs duplicated review work and increased cost. Agent
      // deadlines must fit inside the Kiro MCP execution envelope: a
      // valid child must settle before the outer call aborts.
      maxConcurrent: Math.min(base.agents.maxConcurrent, 4),
      maxPerExecution: Math.min(base.agents.maxPerExecution, 4),
      maxDepth: 1,
      timeoutMs: Math.min(base.agents.timeoutMs, KIRO_EXECUTION_TIMEOUT_MS)
    } : base.agents,
    approvals: {
      ...base.approvals,
      execute: allowExecute ? "allow" : "deny",
      network: power ? "ask" : base.approvals.network
    },
    mcp: {
      ...base.mcp,
      ...power ? {
        ...options.powerMcpConfigPath ? { configPath: options.powerMcpConfigPath } : {},
        allowDynamicServers: false
      } : {}
    }
  };
  if (power && config.mcp.enabled && !options.powerMcpConfigPath) {
    throw new Error("Power MCP federation requires a PLUGIN_DATA-owned configuration path");
  }
  const registry = new ActionRegistry();
  const artifacts = createKiroArtifactStore();
  const managedNode = process.env.KIRO_FABRIC_NODE_BINARY;
  const protectedRelease = managedNode && path18.isAbsolute(managedNode) ? path18.dirname(path18.dirname(managedNode)) : void 0;
  if (!power) {
    registry.register(
      new KiroToolsProvider(options.cwd, {
        readArtifact: ({ id, offset, limit }) => artifacts.read(id, offset, limit),
        ...protectedRelease ? { protectedRoots: [protectedRelease] } : {}
      })
    );
    registry.markUnavailable("artifacts", "Strict mode exposes overflow artifacts through k.readArtifact");
  } else {
    registry.markUnavailable(
      "k",
      "Power mode intentionally uses Kiro native tools for ordinary repository and shell operations"
    );
    registry.register(new KiroPowerArtifactsProvider(artifacts));
  }
  if (options.tools === void 0 && config.mcp.enabled) {
    registry.register(new KiroMcpProvider(options.cwd, config.mcp));
  } else {
    registry.markUnavailable(
      "mcp",
      options.tools === void 0 ? "disabled by Fabric configuration" : "MCP federation is unavailable inside scoped Kiro ACP children"
    );
  }
  if (options.tools === void 0 && config.memory.enabled) {
    registry.register(new KiroMemoryProvider({
      cwd: options.cwd,
      root: options.memoryRoot ?? path18.join(resolveAgentDir(), "fabric", "kiro-memory")
    }));
  } else {
    registry.markUnavailable(
      "memory",
      options.tools === void 0 ? "disabled by Fabric configuration" : "persistent memory is unavailable inside scoped Kiro ACP children"
    );
  }
  if (options.enableSubagents === true && options.tools === void 0 && config.agents.enabled) {
    registry.register(createKiroAgentsProvider({
      cwd: options.cwd,
      config: config.agents,
      ...options.agentWorkerPath ? { workerPath: options.agentWorkerPath } : {},
      ...options.agentRunRoot ? { runRoot: options.agentRunRoot } : {},
      ...options.kiroBinary ? { kiroBinary: options.kiroBinary } : {},
      ...options.agentAvailableModelIds ? { availableModelIds: options.agentAvailableModelIds } : {}
    }));
  } else {
    registry.markUnavailable(
      "agents",
      options.tools !== void 0 ? "recursive subagents are unavailable inside scoped Kiro ACP children" : power ? "Kiro ACP agents are unavailable until the certified CLI capability probe succeeds" : "managed Kiro subagents require the trusted --allow-shell --subagents opt-in"
    );
  }
  if (power && options.stateRoot) {
    const mesh = new MeshStore(
      options.stateRoot,
      config.mesh.maxEventBytes,
      config.mesh.maxReadEvents
    );
    registry.register(new StateProvider(mesh, {
      id: createHash6("sha256").update(options.stateRoot).digest("hex").slice(0, 24),
      name: "kiro-power",
      kind: "main"
    }));
  } else {
    registry.markUnavailable(
      "state",
      power ? "Power-scoped state is unavailable until a workspace is bound" : "state.* requires the managed project mesh lifecycle"
    );
  }
  for (const [provider, reason] of [
    ["extensions", "captured Pi extension tools require a live Pi extension host"],
    ["mesh", power ? "Power v1 does not expose a durable mesh lifecycle" : "managed Kiro does not own a project mesh lifecycle"],
    ["schema", "schema transactions require Pi-owned workspace and mesh authorization"],
    ["components", "component supervision requires the Pi host lifecycle"],
    ["compact", "Kiro CLI exposes no safe host context-compaction commit boundary"]
  ]) {
    registry.markUnavailable(provider, reason);
  }
  options.registerProviders?.(registry);
  const service = new FabricExecutionService(registry, config);
  const sessionApprovals = new FabricSessionApprovals();
  const host = {
    cwd: options.cwd,
    payload: makeKiroContext(options.cwd),
    // ACP results intentionally report usage as unavailable. Agent-backed
    // workflow helpers would otherwise start a billable child and only then
    // reject while recording usage; omit those helpers before guest execution.
    agentBackedOrchestration: false,
    // No model registry in the Kiro host.
    createApprover() {
      if (power && options.powerApprover) {
        return new KiroPowerFabricApprover(config.approvals, options.powerApprover, options.cwd);
      }
      return new FabricDenyApprovalFallback(
        config.approvals,
        sessionApprovals.approvedRisks,
        power ? "the MCP client does not advertise standards-based elicitation" : KIRO_UNAVAILABLE_REASON
      );
    }
  };
  return {
    service,
    host,
    registry,
    artifacts,
    async close() {
      try {
        await registry.close();
      } finally {
        artifacts.close();
      }
    }
  };
};

// src/kiro/mcp-server.ts
var STRICT_DESCRIPTION = "Execute type-checked TypeScript through Fabric's configured executor for coding tools, MCP, Fabric providers, and discovery.";
var POWER_DESCRIPTION = "Execute checked TypeScript for programmable workflows, memory, bound state, and configured MCP federation. Power ACP agents are unavailable; use Kiro native tools and native subagents outside Fabric for ordinary work.";
var isRecord6 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var supportsKiroPowerElicitation = (capabilities) => {
  if (!isRecord6(capabilities) || !isRecord6(capabilities.elicitation)) return false;
  const elicitation = capabilities.elicitation;
  return Object.keys(elicitation).length === 0 || Object.hasOwn(elicitation, "form");
};
var workspaceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: { type: "string", enum: ["status", "list", "select", "attach", "detach"] },
    rootId: { type: "string", minLength: 1, maxLength: 64 },
    path: { type: "string", minLength: 1, maxLength: 4096 }
  }
};
var workspaceRequest = (value) => {
  if (!isRecord6(value) || typeof value.action !== "string") {
    throw new Error("fabric_workspace requires a closed action request");
  }
  const keys = Object.keys(value);
  switch (value.action) {
    case "status":
    case "list":
    case "detach":
      if (keys.length !== 1) throw new Error(`${value.action} accepts no other fields`);
      return { action: value.action };
    case "select":
      if (keys.length !== 2 || typeof value.rootId !== "string") {
        throw new Error("select requires only rootId");
      }
      return { action: "select", rootId: value.rootId };
    case "attach":
      if (keys.length !== 2 || typeof value.path !== "string") {
        throw new Error("attach requires only path");
      }
      return { action: "attach", path: value.path };
    default:
      throw new Error("unknown fabric_workspace action");
  }
};
var createKiroMcpServer = async (options) => {
  const integration = options.integration ?? "strict";
  if (integration === "internal-child" && options.tools === void 0) {
    throw new Error("internal-child MCP launch requires an explicit tool scope");
  }
  if (integration !== "power" && !options.cwd) {
    throw new Error(`${integration} MCP launch requires cwd`);
  }
  if (integration === "power" && (!options.pluginRoot || !options.pluginData)) {
    throw new Error("power MCP launch requires PLUGIN_ROOT and PLUGIN_DATA");
  }
  const version = options.version ?? (integration === "power" ? String(JSON.parse(readFileSync(path19.join(options.pluginRoot, "package.json"), "utf8")).version) : readPackageVersion());
  const server = new Server(
    { name: "kiro-fabric", version },
    { capabilities: { tools: {} } }
  );
  const active = /* @__PURE__ */ new Set();
  let runtime = options.runtime;
  let runtimeIdentity = options.runtime && integration === "power" ? "<unbound>" : options.cwd ?? "";
  let closing = false;
  let lifecycleTail = Promise.resolve();
  const data = integration === "power" ? prepareKiroPowerDataPaths(options.pluginData) : void 0;
  const runLifecycle = (operation) => {
    const result = lifecycleTail.then(operation, operation);
    lifecycleTail = result.then(() => void 0, () => void 0);
    return result;
  };
  const drainActive = async (reason) => {
    const executions = [...active];
    for (const execution of executions) execution.controller.abort(reason);
    await Promise.allSettled(executions.map((execution) => execution.settled));
  };
  const closeRuntime = async () => {
    const current = runtime;
    runtime = void 0;
    runtimeIdentity = "";
    await current?.close();
  };
  const powerApprover = integration === "power" ? new KiroPowerApprover({
    supported: () => supportsKiroPowerElicitation(server.getClientCapabilities()),
    request: async ({ message, signal, timeoutMs }) => {
      const result = await server.elicitInput({
        mode: "form",
        message,
        requestedSchema: {
          type: "object",
          properties: {
            approved: { type: "boolean", title: "Approve once", default: false }
          },
          required: ["approved"]
        }
      }, { ...signal ? { signal } : {}, timeout: timeoutMs });
      return {
        action: result.action,
        ...isRecord6(result.content) && result.content.approved === true ? { approved: true } : {}
      };
    }
  }) : void 0;
  const binding = integration === "power" ? new KiroPowerWorkspaceBinding({
    pluginRoot: options.pluginRoot,
    pluginData: options.pluginData,
    elicitor: {
      approveWorkspace: (canonicalPath, signal) => powerApprover.approveOnce({
        risk: "write",
        provider: "fabric_workspace",
        action: "attach",
        summary: `Canonical workspace: ${canonicalPath}`,
        ...signal ? { signal } : {}
      })
    }
  }) : void 0;
  const refreshRoots = async () => {
    if (!binding) return;
    await runLifecycle(async () => {
      if (closing) return;
      const previous = binding.boundRoot();
      const capabilities = server.getClientCapabilities();
      if (!capabilities?.roots) {
        binding.updateClientRoots([]);
      } else {
        try {
          const result = await server.listRoots(void 0, { timeout: 2e3 });
          binding.updateClientRoots(result.roots);
        } catch {
          binding.updateClientRoots([]);
        }
      }
      if (previous !== binding.boundRoot()) {
        await drainActive(new Error("MCP workspace roots changed"));
        await closeRuntime();
      }
    });
  };
  const createRuntime = async () => {
    if (integration !== "power") {
      return prepareKiroRuntime({
        cwd: options.cwd,
        integration,
        ...options.tools ? { tools: options.tools } : {},
        ...options.enableSubagents ? { enableSubagents: true } : {}
      });
    }
    const bound = binding.boundRoot();
    const project = bound ? prepareKiroPowerProjectPaths(data.projects, bound) : void 0;
    return prepareKiroRuntime({
      cwd: bound ?? data.root,
      integration: "power",
      agentDir: data.config,
      powerMcpConfigPath: data.mcpConfig,
      memoryRoot: project?.memory ?? path19.join(data.root, "global", "memory"),
      ...project ? { stateRoot: project.state } : {},
      powerApprover
    });
  };
  const runtimeForCurrentIdentity = async () => {
    const identity = integration === "power" ? binding.boundRoot() ?? "<unbound>" : options.cwd;
    if (runtime && runtimeIdentity === identity) return runtime;
    await closeRuntime();
    runtime = await createRuntime();
    runtimeIdentity = identity;
    return runtime;
  };
  const getRuntime = () => runLifecycle(async () => {
    if (closing) throw new Error("MCP server is shutting down");
    return runtimeForCurrentIdentity();
  });
  const acquireExecutionRuntime = (controller) => runLifecycle(async () => {
    if (closing) throw new Error("MCP server is shutting down");
    const current = await runtimeForCurrentIdentity();
    let settle;
    const settled = new Promise((resolve) => {
      settle = resolve;
    });
    const execution = { controller, settled, settle };
    active.add(execution);
    return { current, execution };
  });
  const handleWorkspace = async (request, signal) => runLifecycle(async () => {
    if (closing) throw new Error("MCP server is shutting down");
    const mutating = request.action === "select" || request.action === "attach" || request.action === "detach";
    const previous = binding.boundRoot();
    if (mutating) {
      await drainActive(new Error("Power workspace binding changed"));
    }
    const result = await binding.handle(request, signal);
    if (previous !== binding.boundRoot()) await closeRuntime();
    return result;
  });
  if (integration === "power") {
    server.setNotificationHandler(RootsListChangedNotificationSchema, refreshRoots);
  }
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (integration === "power") await refreshRoots();
    const exec = {
      name: "fabric_exec",
      description: integration === "power" ? POWER_DESCRIPTION : STRICT_DESCRIPTION,
      inputSchema: fabricExecInputSchemaJson(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      }
    };
    if (integration !== "power") return { tools: [exec] };
    return {
      tools: [
        {
          name: "fabric_info",
          description: "Report bounded Kiro Fabric Power capability and lifecycle status without secrets.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false
          }
        },
        {
          name: "fabric_workspace",
          description: "Inspect or explicitly bind the Power to one validated workspace. Manual paths require approve-once MCP elicitation.",
          inputSchema: workspaceSchema,
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: false
          }
        },
        exec
      ]
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (integration === "power") await refreshRoots();
    const name = request.params.name;
    if (integration === "power" && name === "fabric_info") {
      if (Object.keys(request.params.arguments ?? {}).length) {
        return {
          content: [{ type: "text", text: "fabric_info accepts no arguments" }],
          isError: true
        };
      }
      const status = binding.status();
      const current = await getRuntime();
      const providers = new Set(current.registry.providers().map((provider) => provider.name));
      const capabilities = [
        "checked-execution",
        ...providers.has("artifacts") ? ["overflow-artifacts"] : [],
        ...providers.has("memory") ? ["memory"] : [],
        ...providers.has("state") ? ["state"] : [],
        ...providers.has("mcp") ? ["mcp-federation"] : []
      ];
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            integration: "power",
            version,
            runtime: { quickjs: "available" },
            workspace: { ...status, capabilities },
            kiroAcp: {
              status: "unavailable",
              agents: false,
              reason: "real Kiro ACP qualification is a separate fail-closed gate"
            },
            capabilities,
            durability: { guaranteedAcrossPowerDeactivation: false }
          })
        }]
      };
    }
    if (integration === "power" && name === "fabric_workspace") {
      try {
        const parsed = workspaceRequest(request.params.arguments ?? {});
        const result = await handleWorkspace(parsed, extra.signal);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Workspace binding failed: ${error.message}`
          }],
          isError: true
        };
      }
    }
    if (name !== "fabric_exec") {
      return {
        content: [{ type: "text", text: `Unknown tool: ${String(name)}` }],
        isError: true
      };
    }
    const prepared = prepareFabricExecArguments(request.params.arguments ?? {});
    if (!isRecord6(prepared) || !value_exports.Check(fabricExecInputSchema, prepared)) {
      const errors = isRecord6(prepared) ? [...value_exports.Errors(fabricExecInputSchema, prepared)].map((error) => error.message).join("; ") : "arguments must be an object";
      return {
        content: [{ type: "text", text: `Invalid fabric_exec arguments: ${errors}` }],
        isError: true
      };
    }
    const input = prepared;
    const controller = new AbortController();
    const cancel = () => controller.abort(extra.signal.reason);
    if (extra.signal.aborted) cancel();
    else extra.signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => controller.abort(), KIRO_MCP_CALL_TIMEOUT_MS);
    timer.unref?.();
    let execution;
    try {
      const acquired = await acquireExecutionRuntime(controller);
      execution = acquired.execution;
      const current = acquired.current;
      const result = await current.service.execute({
        code: input.code,
        ...input.strings ? { strings: input.strings } : {},
        signal: controller.signal,
        parentToolCallId: `kiro:${randomUUID7()}`,
        host: current.host,
        ...input.tokenBudget !== void 0 ? { tokenBudget: input.tokenBudget } : {},
        ...input.agentBudget !== void 0 ? { maxAgentCalls: input.agentBudget } : {},
        ...normalizeRunDisplay(input.display) ? { display: normalizeRunDisplay(input.display) } : {},
        onPartial() {
        }
      });
      const projected2 = await projectFabricExecutionText({
        result,
        code: input.code,
        resultFormat: input.resultFormat ?? current.service.config.executor.resultFormat,
        maxOutputChars: current.service.config.executor.maxOutputChars,
        writeArtifact: (content) => Promise.resolve(current.artifacts.write(content)),
        ...integration === "power" ? {
          artifactReadHint: (id) => `await tools.call({ ref: "artifacts.read", args: { id: ${JSON.stringify(id)} } })`
        } : {}
      });
      return {
        content: [{ type: "text", text: projected2.text }],
        ...projected2.isError ? { isError: true } : {}
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Fabric adapter error: ${error.message}`
        }],
        isError: true
      };
    } finally {
      clearTimeout(timer);
      if (execution) {
        active.delete(execution);
        execution.settle();
      }
      extra.signal.removeEventListener("abort", cancel);
    }
  });
  await server.connect(new StdioServerTransport());
  let closeTask;
  return {
    close() {
      closeTask ??= (async () => {
        try {
          await runLifecycle(async () => {
            closing = true;
            await drainActive(new Error("Power MCP server shutting down"));
            await closeRuntime();
          });
        } finally {
          await server.close();
        }
      })();
      return closeTask;
    }
  };
};
export {
  createKiroMcpServer,
  supportsKiroPowerElicitation
};
