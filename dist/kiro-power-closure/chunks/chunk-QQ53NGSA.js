import { createRequire as __kfCreateRequire } from "node:module";
import { fileURLToPath as __kfFileURLToPath } from "node:url";
import { dirname as __kfDirname } from "node:path";
globalThis.__filename = __kfFileURLToPath(import.meta.url);
globalThis.__dirname = __kfDirname(globalThis.__filename);
const require = __kfCreateRequire(import.meta.url);

import {
  effectiveFabricSourceLimit,
  fabricSourceLimitError,
  fabricTranspiledLimitError,
  runAbortable,
  settleWithin
} from "./chunk-7PM3D3KB.js";
import {
  transpileFabricCodeWithSourceMap
} from "./chunk-7W2AG64Q.js";

// node_modules/.pnpm/@jitl+quickjs-singlefile-mjs-release-sync@0.32.0/node_modules/@jitl/quickjs-singlefile-mjs-release-sync/dist/index.mjs
var variant = { type: "sync", importFFI: () => import("./ffi-OJPXGYPQ.js").then((mod) => mod.QuickJSFFI), importModuleLoader: () => import("./emscripten-module-Q67P5WYC-BGOVPOTY.js").then((mod) => mod.default) };
var src_default = variant;

// node_modules/.pnpm/quickjs-emscripten-core@0.32.0/node_modules/quickjs-emscripten-core/dist/index.mjs
async function newQuickJSWASMModuleFromVariant(variantOrPromise) {
  let variant2 = smartUnwrap(await variantOrPromise), [wasmModuleLoader, QuickJSFFI, { QuickJSWASMModule: QuickJSWASMModule2 }] = await Promise.all([variant2.importModuleLoader().then(smartUnwrap), variant2.importFFI(), import("./module-ES6BEMUI-IZREND4X.js").then(smartUnwrap)]), wasmModule = await wasmModuleLoader();
  wasmModule.type = "sync";
  let ffi = new QuickJSFFI(wasmModule);
  return new QuickJSWASMModule2(wasmModule, ffi);
}
function smartUnwrap(val) {
  return val && "default" in val && val.default ? val.default && "default" in val.default && val.default.default ? val.default.default : val.default : val;
}

// src/runtime/quickjs-runtime.ts
import { performance } from "node:perf_hooks";

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
var quickJsModulePromise;
var quickJsModule = () => {
  quickJsModulePromise ??= newQuickJSWASMModuleFromVariant(src_default);
  return quickJsModulePromise;
};
var CORE_TOOL_NAMESPACE_TOKEN = "__FABRIC_CORE_TOOL_NAMESPACE__";
var AGENT_BACKED_ORCHESTRATION_TOKEN = "__FABRIC_AGENT_BACKED_ORCHESTRATION__";
var DEFAULT_AGENT_RUNNER_TOKEN = "__FABRIC_DEFAULT_AGENT_RUNNER__";
var UNACCOUNTED_AGENT_RUNNERS_TOKEN = "__FABRIC_UNACCOUNTED_AGENT_RUNNERS__";
var GUEST_SETUP_TEMPLATE = `
(() => {
const __fabricBridge = globalThis.__fabricHostCall;
delete globalThis.__fabricHostCall;
const __coreToolNamespace = "__FABRIC_CORE_TOOL_NAMESPACE__";
const __agentBackedOrchestration = __FABRIC_AGENT_BACKED_ORCHESTRATION__;
const __defaultAgentRunner = __FABRIC_DEFAULT_AGENT_RUNNER__;
const __unaccountedAgentRunners = new Set(__FABRIC_UNACCOUNTED_AGENT_RUNNERS__);
const __coreToolLabel = __coreToolNamespace === "pi" ? "Pi core tool" : "Kiro Fabric core tool";
const __successfulCalls = [];
const __resolvedCallRef = (ref, args) =>
  ref === "fabric.$call" && args && typeof args.ref === "string" ? args.ref : ref;
const __recordSuccessfulCall = (ref, args) => {
  __successfulCalls.push(Object.freeze({ ref: __resolvedCallRef(ref, args) }));
};
const __handoffFacts = () => {
  const calls = Object.freeze(__successfulCalls.slice());
  const count = (ref) => {
    if (ref === undefined) return calls.length;
    const refs = new Set(Array.isArray(ref) ? ref : [ref]);
    return calls.reduce((total, call) => total + (refs.has(call.ref) ? 1 : 0), 0);
  };
  return Object.freeze({ calls, count });
};
const __call = async (ref, args) => {
  const normalizedArgs = args ?? {};
  const value = await __fabricBridge(ref, normalizedArgs);
  __recordSuccessfulCall(ref, normalizedArgs);
  return value;
};
const __piToolNames = ["read","bash","edit","write","grep","find","ls"];
const __toolsBase = {
  providers: () => __call("fabric.$providers", {}),
  catalog: (args = {}) => __call("fabric.$catalog", args),
  list: (args = {}) => __call("fabric.$list", args),
  search: (args) => __call(
    "fabric.$search",
    typeof args === "string" ? { query: args } : args,
  ),
  describe: (args) => __call("fabric.$describe", args),
  call: (args) => __call("fabric.$call", args),
  progress: (args) => __call("fabric.$progress", args),
  models: () => __call("fabric.$models", {}),
};
// tools is discovery + generic calls only. The proxy keeps the seven discovery
// methods and turns a core-tool name (read/bash/edit/...) into an actionable
// error pointing at pi.<name>, so a model that writes tools.read(...) learns
// the fix in one turn instead of looping on "tools.read is not a function".
globalThis.tools = new Proxy(__toolsBase, {
  get(target, property) {
    if (property === "then" || typeof property === "symbol") return undefined;
    const name = String(property);
    if (__piToolNames.indexOf(name) >= 0) {
      return () => {
        throw new Error(
          "tools." + name + " is not available on the discovery API. tools is discovery + generic calls only (providers/catalog/list/search/describe/call/models). For the " + __coreToolLabel + ", call " + __coreToolNamespace + "." + name + "(args), e.g. " + __coreToolNamespace + "." + name + "({ ... })."
        );
      };
    }
    return target[property];
  },
  set() { return true; },
  deleteProperty() { return true; },
});
const __piStringFields = { bash: "command", read: "path", ls: "path", grep: "pattern", find: "pattern" };
// Per-tool key aliases. The runtime normalizes them to the canonical form
// before the host validates args; unit-converting aliases are handled separately
// in __normalizePiArgs. This lets a model that writes { query, regex, ... }
// or { file } instead of { pattern } / { path } still succeeds on the first
// call. Keep these in sync with the PiToolsApi overloads in guest-types.ts so
// the type-checker accepts the same spellings it coercion-handles at runtime.
const __piArgAliases = {
  bash: {
    cmd: "command", shell: "command", cmdline: "command", script: "command",
    commandLine: "command",
  },
  find: {
    query: "pattern", regex: "pattern", search: "pattern", name: "pattern",
    filename: "pattern", glob: "pattern", expression: "pattern", include: "pattern",
    max: "limit",
  },
  grep: {
    query: "pattern", regex: "pattern", search: "pattern", q: "pattern",
    expression: "pattern", text: "pattern",
    ic: "ignoreCase", caseInsensitive: "ignoreCase",
    globPattern: "glob",
    max: "limit", ctx: "context",
  },
  read: {
    file: "path", absolutePath: "path", file_path: "path", filePath: "path",
    filepath: "path", pathname: "path", target_file: "path", targetFile: "path",
    absolute_path: "path", fileAbsolutePath: "path",
    max: "limit", start: "offset",
  },
  ls: {
    dir: "path", file: "path", folder: "path", absolutePath: "path",
    file_path: "path", filePath: "path", filepath: "path", pathname: "path",
    target_file: "path", targetFile: "path", absolute_path: "path",
    fileAbsolutePath: "path", directory: "path", directoryPath: "path",
    max: "limit",
  },
  edit: {
    file: "path", absolutePath: "path", file_path: "path", filePath: "path",
    filepath: "path", pathname: "path", target_file: "path", targetFile: "path",
    absolute_path: "path", fileAbsolutePath: "path",
    old: "oldText", old_string: "oldText", oldString: "oldText",
    old_str: "oldText", oldStr: "oldText", from: "oldText",
    old_value: "oldText", old_text: "oldText", oldContent: "oldText",
    old_content: "oldText",
    new: "newText", replacement: "newText", new_string: "newText",
    newString: "newText", new_str: "newText", newStr: "newText",
    to: "newText", new_value: "newText", new_text: "newText",
    newContent: "newText", new_content: "newText",
  },
  write: {
    file: "path", absolutePath: "path", file_path: "path", filePath: "path",
    filepath: "path", pathname: "path", target_file: "path", targetFile: "path",
    absolute_path: "path", fileAbsolutePath: "path",
    contents: "content", body: "content", text: "content", data: "content",
    fileContent: "content",
  },
};
// Multi-arg positional order, used only when a call passes >= 2 args and the
// (primary, options) merge in __positionalToArgs does not apply. One-field
// tools (read/bash/ls) stay absent: their two-arg form is a bare string plus
// an options object, repaired by the merge instead of a wrong-arity (2554)
// type error; only a non-object second arg still fails 2554.
const __piPositionalFields = {
  grep: ["pattern", "path", "limit"],
  find: ["pattern", "path", "limit"],
  write: ["path", "content"],
  edit: ["path", "oldText", "newText"],
};
// Models often pass numbers as strings ("20"); coerce the known numeric
// option fields so the host schema sees a number. Non-numeric strings pass
// through untouched and fail host validation exactly as before. Kept in sync
// with the numeric optionals in the PiToolsApi overloads in guest-types.ts.
const __piNumericFields = {
  read: ["offset", "limit"],
  grep: ["limit", "context"],
  find: ["limit"],
  ls: ["limit"],
  bash: ["timeout"],
};
const __piOptionalFields = {
  read: ["offset", "limit"],
  grep: ["path", "glob", "ignoreCase", "literal", "context", "limit"],
  find: ["path", "limit"],
  ls: ["path", "limit"],
  bash: ["timeout"],
};
// (primary, options) two-arg merge for the string-primary tools:
// pi.read("index.ts", { limit: 120 }) becomes { path: "index.ts", limit: 120 }.
// A plain-object second arg is never a valid positional value for these tools
// (grep/find take (pattern, path, limit) strings/numbers), so merging is
// unambiguous; the positional string wins the primary field on conflict. The
// merged object flows through the same alias, unit, and numeric normalization
// in __normalizePiArgs as any other options object.
const __positionalToArgs = (name, rest) => {
  const first = rest[0];
  const second = rest[1];
  const primaryField = __piStringFields[name];
  if (
    rest.length === 2 &&
    typeof first === "string" &&
    primaryField !== undefined &&
    second !== null && typeof second === "object" && !Array.isArray(second)
  ) {
    const merged = Object.assign({}, second);
    merged[primaryField] = first;
    return merged;
  }
  const order = __piPositionalFields[name];
  if (!order) return rest.length > 0 ? first : {};
  const out = {};
  for (let i = 0; i < rest.length && i < order.length; i++) {
    const v = rest[i];
    if (v !== undefined) out[order[i]] = v;
  }
  return out;
};
const __normalizePiArgs = (name, args) => {
  const field = __piStringFields[name];
  if (typeof args === "string" && field) return { [field]: args };
  if (args === null || typeof args !== "object" || Array.isArray(args)) return args;
  const aliases = __piArgAliases[name];
  let out = args;
  if (name === "bash" && "timeoutMs" in out) {
    out = Object.assign({}, args);
    if (!("timeout" in out)) {
      const timeoutMs = out.timeoutMs;
      if (timeoutMs !== null && timeoutMs !== undefined) {
        out.timeout = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) / 1000 : timeoutMs;
      }
    }
    delete out.timeoutMs;
  }
  // settle is a guest-only directive (settles nonzero exits instead of
  // rejecting); strip it so it never reaches the host/bash schema.
  if (name === "bash" && "settle" in out) {
    if (out === args) out = Object.assign({}, args);
    delete out.settle;
  }
  if (aliases) {
    for (const alias in aliases) {
      const canonical = aliases[alias];
      if (alias in out) {
        if (out === args) out = Object.assign({}, args);
        if (!(canonical in out)) out[canonical] = out[alias];
        delete out[alias];
      }
    }
  }
  const numerics = __piNumericFields[name];
  if (numerics) {
    for (const key of numerics) {
      const value = out[key];
      if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
        if (out === args) out = Object.assign({}, args);
        out[key] = Number(value);
      }
    }
  }
  const optionalFields = __piOptionalFields[name];
  if (optionalFields) {
    for (const key of optionalFields) {
      if (out[key] !== null && out[key] !== undefined) continue;
      if (!(key in out)) continue;
      if (out === args) out = Object.assign({}, args);
      delete out[key];
    }
  }
  if (name === "edit" && Array.isArray(out.edits)) {
    let changed = false;
    const editAliases = __piArgAliases.edit;
    const edits = out.edits.map((entry) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return entry;
      let edit = entry;
      for (const alias in editAliases) {
        const canonical = editAliases[alias];
        if (canonical !== "oldText" && canonical !== "newText") continue;
        if (!(alias in edit)) continue;
        if (edit === entry) edit = Object.assign({}, entry);
        if (!(canonical in edit)) edit[canonical] = edit[alias];
        delete edit[alias];
        changed = true;
      }
      return edit;
    });
    if (changed) {
      if (out === args) out = Object.assign({}, args);
      out.edits = edits;
    }
  }
  if (name === "edit" && !Array.isArray(out.edits) && ("oldText" in out || "newText" in out)) {
    if (out === args) out = Object.assign({}, args);
    const edit = {};
    if ("oldText" in out) edit.oldText = out.oldText;
    if ("newText" in out) edit.newText = out.newText;
    out.edits = [edit];
    delete out.oldText;
    delete out.newText;
  }
  return out;
};
// bash/edit/write resolve envelope objects { ok, output, details }, and the
// type-checker deliberately suppresses property-miss (2339) diagnostics, so
// result.trim() on an envelope typechecks and then dies with QuickJS's terse
// "not a function" \u2014 an error models cannot localize (observed: misdirected
// debugging spirals probing unrelated globals). Guard envelopes with a proxy
// that throws an actionable TypeError for string-method access and iteration,
// naming the tool and the .output fix. Ordinary reads (ok/output/details/
// exitCode/error), destructuring, 'in' checks, and JSON marshaling pass through.
const __piEnvelopeTools = { bash: true, edit: true, write: true };
const __piEnvelopeStringTraps = new Set([
  "anchor", "at", "big", "blink", "bold", "charAt", "charCodeAt", "codePointAt",
  "concat", "endsWith", "fixed", "fontcolor", "fontsize", "includes", "indexOf",
  "italics", "lastIndexOf", "length", "link", "localeCompare", "match", "matchAll",
  "normalize", "padEnd", "padStart", "repeat", "replace", "replaceAll", "search",
  "slice", "small", "split", "startsWith", "strike", "sub", "substr", "substring",
  "sup", "toLocaleLowerCase", "toLocaleUpperCase", "toLowerCase", "toUpperCase",
  "trim", "trimEnd", "trimStart",
]);
const __piEnvelopeGuard = (name, value) => {
  if (value === null || typeof value !== "object" || typeof value.ok !== "boolean") return value;
  return new Proxy(value, {
    get(target, property, receiver) {
      if (property === Symbol.iterator || property === Symbol.asyncIterator) {
        throw new TypeError(
          __coreToolNamespace + "." + name + "(...) resolves an envelope { ok, output, details }, which is not iterable. " +
          "Iterate the text instead: (await " + __coreToolNamespace + "." + name + "(...)).output.split('\\\\n')"
        );
      }
      if (typeof property === "string" && __piEnvelopeStringTraps.has(property)) {
        throw new TypeError(
          __coreToolNamespace + "." + name + "(...) resolves an envelope { ok, output, details }, not a string, so ." + property +
          " is unavailable on it. Read the text first: const out = (await " + __coreToolNamespace + "." + name + "(...)).output; then out." + property +
          "(...). bash rejects on a nonzero exit \u2014 pass settle: true to receive an ok:false envelope instead."
        );
      }
      return Reflect.get(target, property, receiver);
    },
  });
};
// The pi proxy accepts: a bare string (primary field), an options object, a
// (primary, options) two-arg merge for the string-primary tools, or a
// positional spread mapped by __piPositionalFields. 0/1 args preserve the
// legacy (args = {}) default so existing programs are unchanged.
globalThis[__coreToolNamespace] = new Proxy({}, {
  get(_target, property) {
    if (property === "then") return undefined;
    const name = String(property);
    return (...rest) => {
      let args;
      if (rest.length <= 1) {
        const first = rest.length === 1 ? rest[0] : undefined;
        args = first === undefined ? {} : first;
      } else {
        args = __positionalToArgs(name, rest);
      }
      // bash rejects on an ordinary nonzero exit; settle:true returns
      // {ok:false, exitCode, ...} instead (opt-in). Other failures still reject.
      const settle = name === "bash" &&
        typeof args === "object" && args !== null && args.settle === true;
      const call = __call(__coreToolNamespace + "." + name, __normalizePiArgs(name, args));
      const promise = settle ? call.catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        const match = /(?:^|\\n\\n)Command exited with code (\\d+)$/.exec(message);
        if (!match) throw error;
        return {
          ok: false,
          output: message.slice(0, match.index),
          details: null,
          exitCode: Number(match[1]),
          error: message,
        };
      }) : call;
      return __piEnvelopeTools[name] === true
        ? promise.then((value) => __piEnvelopeGuard(name, value))
        : promise;
    };
  },
});
const __piStrings = (typeof globalThis["\u03C0"] === "object" && globalThis["\u03C0"] !== null) ? globalThis["\u03C0"] : {};
globalThis["\u03C0"] = new Proxy(__piStrings, {
  get(target, property) {
    if (typeof property === "symbol") return undefined;
    const name = String(property);
    if (name === "then" || name === "toJSON" || name === "constructor") return undefined;
    if (Object.prototype.hasOwnProperty.call(target, name)) return target[name];
    if (__piToolNames.indexOf(name) >= 0) {
      throw new Error(
        "\u03C0." + name + " is the strings accessor, not a tool. For the " + __coreToolLabel + ", call " + __coreToolNamespace + "." + name + "(args)."
      );
    }
    const provided = Object.keys(target);
    throw new Error(
      "\u03C0." + name + " is not defined. \u03C0 only exposes keys from the fabric_exec strings parameter" +
      (provided.length ? " (provided: " + provided.join(", ") + ")" : " (none provided)") +
      ". Pass strings: { " + name + ": '...' } to use \u03C0." + name + "."
    );
  },
  ownKeys(target) { return Reflect.ownKeys(target); },
  getOwnPropertyDescriptor(target, prop) { return Reflect.getOwnPropertyDescriptor(target, prop); },
  has(target, prop) { return Object.prototype.hasOwnProperty.call(target, prop); }
});
// Stable providers share a lazy dispatch proxy; the guest declarations keep
// their known actions typed while the registry remains the runtime authority.
// extensions' per-tool surface is additionally rendered from the captured
// catalog by guestTypeDeclarations (runtime/dynamic-guest-types.ts).
const __providerProxy = (provider) => new Proxy({}, {
  get(_target, property) {
    if (property === "then" || typeof property === "symbol") return undefined;
    return (args = {}) => __call(provider + "." + String(property), args);
  },
});
globalThis.extensions = __providerProxy("extensions");
globalThis.memory = __providerProxy("memory");
globalThis.state = __providerProxy("state");
globalThis.schema = __providerProxy("schema");
globalThis.components = __providerProxy("components");
globalThis.compact = __providerProxy("compact");
const __createActor = async (args = {}) => {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new TypeError("agents.create expects an options object");
  }
  const request = { ...args };
  const validWhile = request.validWhile;
  if (validWhile !== undefined) {
    if (typeof validWhile !== "function") {
      throw new TypeError("agents.create validWhile must be a pure predicate function");
    }
    const source = Function.prototype.toString.call(validWhile);
    if (source.trimStart().startsWith("async")) {
      throw new TypeError("agents.create validWhile must be synchronous");
    }
    request.validWhile = { version: 1, source };
  }
  return __call("agents.create", request);
};
const __handoff = async (args = {}) => {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new TypeError("agents.handoff expects an options object");
  }
  const request = { ...args };
  const when = request.when;
  delete request.when;
  if (when !== undefined) {
    if (typeof when !== "function") {
      throw new TypeError("agents.handoff when must be a pure predicate function");
    }
    const decision = when(__handoffFacts());
    if (decision && typeof decision.then === "function") {
      throw new TypeError("agents.handoff when must return a boolean synchronously");
    }
    if (decision !== true) {
      throw new Error("agents.handoff predicate returned false; no agent was started");
    }
  }
  return __call("agents.handoff", request);
};
globalThis.agents = Object.freeze({
  run: (args) => __call("agents.run", args),
  handoff: __handoff,
  spawn: (args) => __call("agents.spawn", args),
  wait: (args) => __call("agents.wait", args),
  status: (args) => __call("agents.status", args),
  list: (args = {}) => __call("agents.list", args),
  members: (args = {}) => __call("agents.members", args),
  self: () => __call("agents.self", {}),
  main: () => __call("agents.main", {}),
  peers: () => __call("agents.peers", {}),
  subscribe: (args) => __call("agents.subscribe", args),
  subscriptions: (args = {}) => __call("agents.subscriptions", args),
  unsubscribe: (args) => __call("agents.unsubscribe", args),
  models: (args = {}) => __call("agents.models", args),
  stop: (args) => __call("agents.stop", args),
  cleanup: (args) => __call("agents.cleanup", args),
  create: __createActor,
  ask: (args) => __call("agents.ask", args),
  tell: (args) => __call("agents.tell", args),
  steer: (args) => __call("agents.steer", args),
  followUp: (args) => __call("agents.followUp", args),
  setSteeringMode: (args) => __call("agents.setSteeringMode", args),
  setFollowUpMode: (args) => __call("agents.setFollowUpMode", args),
  actorStatus: (args) => __call("agents.actorStatus", args),
  setModel: (args) => __call("agents.setModel", args),
  setThinking: (args) => __call("agents.setThinking", args),
  setTools: (args) => __call("agents.setTools", args),
  setEvents: (args) => __call("agents.setEvents", args),
  setDeliveryPolicy: (args) => __call("agents.setDeliveryPolicy", args),
  setInstructions: (args) => __call("agents.setInstructions", args),
  actors: () => __call("agents.actors", {}),
  messages: (args) => __call("agents.messages", args),
  clearMessages: (args) => __call("agents.clearMessages", args),
  remove: (args) => __call("agents.remove", args),
  import: (args) => __call("agents.import", args),
  export: (args) => __call("agents.export", args),
  log: (args) => __call("agents.log", args),
});
globalThis.mesh = Object.freeze({
  self: () => __call("mesh.self", {}),
  publish: (args) => __call("mesh.publish", args),
  read: (args = {}) => __call("mesh.read", args),
  members: (args = {}) => __call("mesh.members", args),
  get: (args) => __call("mesh.get", args),
  list: (args = {}) => __call("mesh.list", args),
  put: (args) => __call("mesh.put", args),
  delete: (args) => __call("mesh.delete", args),
});
// The mcp proxy itself stays schema-less \u2014 the registry validates args at
// dispatch \u2014 but guestTypeDeclarations renders per-server argument types from
// the live descriptor cache (runtime/dynamic-guest-types.ts), so known tools
// fail type-check on argument-shape mistakes before this proxy ever runs.
const __fullMcpApi = new Proxy({}, {
  get(_target, server) {
    if (server === "then") return undefined;
    if (server === "servers") return () => __call("mcp.$servers", {});
    if (server === "reload") return () => __call("mcp.$reload", {});
    if (server === "register") return (args) => __call("mcp.$register", args);
    if (server === "call") return (args) => __call("mcp.$call", args);
    return new Proxy({}, {
      get(_serverTarget, tool) {
        if (tool === "then") return undefined;
        return (args = {}) => __call("mcp." + String(server) + "." + String(tool), args);
      },
    });
  },
});
globalThis.mcp = __coreToolNamespace === "k"
  ? Object.freeze({
      servers: () => __call("mcp.$servers", {}),
      call: (args) => __call("mcp.$call", args),
    })
  : __fullMcpApi;
let __workflowSpentTokens = 0;
const __workflowBudgetTotal = Number.isFinite(globalThis.__fabricTokenBudget)
  ? Math.max(0, globalThis.__fabricTokenBudget)
  : Number.POSITIVE_INFINITY;
const __recordAgentUsage = (result) => {
  const usage = result && result.usage;
  if (usage && usage.availability === "unavailable") {
    throw new Error("Fabric workflow token budget cannot be enforced because agent usage is unavailable");
  }
  if (usage) __workflowSpentTokens += Number(usage.input || 0) + Number(usage.output || 0);
  return result;
};
const __assertAccountableAgentRun = (args) => {
  const runner = String((args && args.runner) || __defaultAgentRunner || "pi");
  if (__unaccountedAgentRunners.has(runner)) {
    throw new Error(
      "Fabric workflow cannot launch runner " + runner +
      " because its usage is unavailable before execution; call agents.run directly without a workflow budget"
    );
  }
};
const __workflowAgent = async (prompt, options = {}) => {
  if (__workflowSpentTokens >= __workflowBudgetTotal) {
    throw new Error("Fabric workflow token budget exhausted");
  }
  const { label, ...agentOptions } = options;
  const workerName = String(label || agentOptions.name || "Fabric workflow agent");
  __assertAccountableAgentRun(agentOptions);
  const result = __recordAgentUsage(await agents.run({
    ...agentOptions,
    ...(label && !agentOptions.name ? { name: label } : {}),
    task: prompt,
  }));
  if (!result || result.status !== "completed") {
    const reason = result && result.error ? result.error : "agent did not complete";
    throw new Error(workerName + " failed: " + reason);
  }
  return result.value !== undefined ? result.value : result.text;
};
let __nextWorkflowSpanId = 0;
const __workflowSpanMetadata = (kind, items, options, stageCount) => {
  const itemCount = Array.isArray(items) ? items.length : undefined;
  let concurrency;
  if (kind === "parallel" && itemCount !== undefined) {
    if (itemCount === 0) concurrency = 0;
    else {
      const concurrencyOpt = typeof options === "number" ? { concurrency: options } : options ?? {};
      const requested = Number(concurrencyOpt.concurrency ?? itemCount);
      if (Number.isFinite(requested) && requested >= 1) {
        concurrency = Math.max(1, Math.min(itemCount, Math.floor(requested)));
      }
    }
  }
  return {
    kind,
    ...(itemCount !== undefined ? { itemCount } : {}),
    ...(stageCount !== undefined ? { stageCount } : {}),
    ...(concurrency !== undefined ? { concurrency } : {}),
  };
};
const __withWorkflowSpan = async (metadata, body) => {
  const id = "span-" + __nextWorkflowSpanId++;
  await __call("fabric.$spanStart", { id, ...metadata });
  try {
    const value = await body();
    await __call("fabric.$spanEnd", { id, outcome: "succeeded" });
    return value;
  } catch (error) {
    try { await __call("fabric.$spanEnd", { id, outcome: "failed" }); } catch { /* preserve the workflow error */ }
    throw error;
  }
};
const __runParallel = async (thunks, options) => {
  if (!Array.isArray(thunks) || thunks.some((thunk) => typeof thunk !== "function")) {
    throw new TypeError("workflow.parallel expects an array of functions or (items, mapper)");
  }
  if (thunks.length === 0) return [];
  const concurrencyOpt = typeof options === "number" ? { concurrency: options } : options ?? {};
  const requestedConcurrency = Number(concurrencyOpt.concurrency ?? thunks.length);
  if (!Number.isFinite(requestedConcurrency) || requestedConcurrency < 1) {
    throw new RangeError("workflow.parallel concurrency must be a positive finite number");
  }
  const concurrency = Math.max(1, Math.min(thunks.length || 1, Math.floor(requestedConcurrency)));
  const results = new Array(thunks.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < thunks.length) {
      const index = cursor++;
      results[index] = await thunks[index]();
    }
  }));
  return results;
};
const __workflowParallel = async (items, arg2, arg3) => {
  const options = typeof arg2 === "function" ? arg3 : arg2;
  return __withWorkflowSpan(
    __workflowSpanMetadata("parallel", items, options),
    async () => {
      if (typeof arg2 === "function") {
        if (!Array.isArray(items)) throw new TypeError("workflow.parallel expects an array as the first argument");
        return __runParallel(items.map((item, index) => () => arg2(item, index)), arg3);
      }
      return __runParallel(items, arg2);
    },
  );
};
const __workflowPipeline = async (items, ...stages) =>
  __withWorkflowSpan(
    __workflowSpanMetadata("pipeline", items, undefined, stages.length),
    async () => {
      if (!Array.isArray(items) || stages.some((stage) => typeof stage !== "function")) {
        throw new TypeError("workflow.pipeline expects an array followed by stage functions");
      }
      return __workflowParallel(items.map((original, index) => async () => {
        let value = original;
        for (const stage of stages) value = await stage(value, original, index);
        return value;
      }));
    },
  );
const __workflow = {
  parallel: __workflowParallel,
  pipeline: __workflowPipeline,
  configure: (args) => __call("fabric.$configure", args),
  phase: (nameOrInput, options = {}) => {
    const input =
      nameOrInput && typeof nameOrInput === "object" && !Array.isArray(nameOrInput)
        ? { ...nameOrInput }
        : { ...options, name: nameOrInput };
    return __call("fabric.$phase", input);
  },
  item: (args) => __call("fabric.$item", args),
  event: (args) => __call("fabric.$event", args),
  log: (...values) => print(...values),
  budget: Object.freeze({
    total: __workflowBudgetTotal,
    spent: () => __workflowSpentTokens,
    remaining: () => Math.max(0, __workflowBudgetTotal - __workflowSpentTokens),
  }),
};
if (__agentBackedOrchestration) __workflow.agent = __workflowAgent;
globalThis.workflow = Object.freeze(__workflow);
globalThis.parallel = __workflowParallel;
globalThis.pipeline = __workflowPipeline;
globalThis.phase = workflow.phase;
globalThis.log = workflow.log;
globalThis.budget = workflow.budget;
if (__agentBackedOrchestration) globalThis.agent = __workflowAgent;
globalThis.console = Object.freeze({ log: print, info: print, warn: print, error: print });
const __timerCallbacks = new Map();
let __nextTimerId = 1;
globalThis.setTimeout = (callback, ms = 0) => {
  const id = __nextTimerId++;
  __timerCallbacks.set(id, { callback, interval: false });
  __call("fabric.$timer", { ms }).then(() => {
    const entry = __timerCallbacks.get(id);
    if (!entry) return;
    __timerCallbacks.delete(id);
    try { entry.callback(); } catch { /* swallow timer callback errors */ }
  });
  return id;
};
globalThis.setInterval = (callback, ms = 0) => {
  const id = __nextTimerId++;
  __timerCallbacks.set(id, { callback, interval: true });
  const schedule = () => {
    __call("fabric.$timer", { ms }).then(() => {
      const entry = __timerCallbacks.get(id);
      if (!entry) return;
      try { entry.callback(); } catch { /* swallow timer callback errors */ }
      if (__timerCallbacks.has(id)) schedule();
    });
  };
  schedule();
  return id;
};
globalThis.clearTimeout = (id) => { __timerCallbacks.delete(id); };
globalThis.clearInterval = (id) => { __timerCallbacks.delete(id); };
})();
`;
var guestSetupForCoreToolNamespace = (namespace = "pi", agentBackedOrchestration = true, orchestration = {}) => GUEST_SETUP_TEMPLATE.replace(CORE_TOOL_NAMESPACE_TOKEN, namespace).replace(
  AGENT_BACKED_ORCHESTRATION_TOKEN,
  agentBackedOrchestration ? "true" : "false"
).replace(DEFAULT_AGENT_RUNNER_TOKEN, JSON.stringify(orchestration.defaultAgentRunner ?? "pi")).replace(
  UNACCOUNTED_AGENT_RUNNERS_TOKEN,
  JSON.stringify(orchestration.unaccountedAgentRunners ?? [])
);
var GUEST_SETUP = guestSetupForCoreToolNamespace();
var formatValue = (value) => {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};
var jsonText = (value) => {
  const serialized = JSON.stringify(value);
  if (serialized === void 0) return "null";
  return serialized;
};
var jsonHandle = (context, jsonObject, jsonParse, value) => {
  if (value === void 0) return context.undefined;
  if (value === null) return context.null;
  if (typeof value === "string") return context.newString(value);
  if (typeof value === "boolean") return value ? context.true : context.false;
  if (typeof value === "number") {
    return Number.isFinite(value) ? context.newNumber(value) : context.null;
  }
  const serialized = context.newString(jsonText(value));
  try {
    return context.unwrapResult(context.callFunction(jsonParse, jsonObject, serialized));
  } finally {
    serialized.dispose();
  }
};
var HOST_TASK_SETTLE_GRACE_MS = 250;
var QUICKJS_MAX_STACK_SIZE_BYTES = 256 * 1024;
var QUICKJS_GC_LIST_ASSERTION = "list_empty(&rt->gc_obj_list)";
var disposeQuickJsContext = (context) => {
  try {
    context.dispose();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(QUICKJS_GC_LIST_ASSERTION) && message.includes("JS_FreeRuntime")) return;
    throw error;
  }
};
var QuickJsRuntime = class {
  async execute(code, hostCall, options) {
    if (options.signal?.aborted) {
      return {
        value: void 0,
        logs: [],
        terminationReason: "aborted",
        error: "Execution cancelled"
      };
    }
    const sourceError = fabricSourceLimitError(
      code,
      effectiveFabricSourceLimit(options.maxSourceBytes)
    );
    if (sourceError) {
      return {
        value: void 0,
        logs: [],
        terminationReason: "runtime_error",
        error: sourceError
      };
    }
    const suppliedTranspiledError = options.transpiledCode === void 0 ? void 0 : fabricTranspiledLimitError(options.transpiledCode);
    if (suppliedTranspiledError) {
      return {
        value: void 0,
        logs: [],
        terminationReason: "runtime_error",
        error: suppliedTranspiledError
      };
    }
    if (!Number.isSafeInteger(options.memoryLimitBytes) || options.memoryLimitBytes < 1 || options.memoryLimitBytes > 4294967295) {
      return {
        value: void 0,
        logs: [],
        terminationReason: "runtime_error",
        error: "QuickJS memory limit must be an integer between 1 byte and 4294967295 bytes (WASM32 maximum)"
      };
    }
    const module = await quickJsModule();
    const context = module.newContext();
    const runtime = context.runtime;
    const jsonObject = context.getProp(context.global, "JSON");
    const jsonParse = context.getProp(jsonObject, "parse");
    const executionStartedAt = performance.now();
    let effectiveTimeoutMs = options.timeoutMs;
    let executionDeadlineAt = executionStartedAt + effectiveTimeoutMs;
    let interruptedByDeadline = false;
    runtime.setMemoryLimit(options.memoryLimitBytes);
    runtime.setMaxStackSize(QUICKJS_MAX_STACK_SIZE_BYTES);
    runtime.setInterruptHandler(() => {
      if (options.signal?.aborted === true) return true;
      if (performance.now() <= executionDeadlineAt) return false;
      interruptedByDeadline = true;
      return true;
    });
    const logs = [];
    const maxLogChars = options.maxLogChars ?? 1e5;
    let logChars = 0;
    let logsTruncated = false;
    const pendingHostPromises = /* @__PURE__ */ new Set();
    const hostTasks = /* @__PURE__ */ new Set();
    const pendingTimers = /* @__PURE__ */ new Set();
    let closing = false;
    let cancelled = false;
    let timedOut = false;
    let timeout;
    let rejectDeadline;
    let abortHandler;
    let activePromiseHandle;
    let executionGate;
    let pendingResolution;
    const hostAbortController = new AbortController();
    const abortHostCalls = (reason) => {
      if (!hostAbortController.signal.aborted) {
        hostAbortController.abort(new Error(reason));
      }
    };
    const rejectExecutionGate = (message) => {
      if (!executionGate || executionGate.alive === false) return;
      const errorHandle = context.newError(message);
      executionGate.reject(errorHandle);
      errorHandle.dispose();
      runtime.executePendingJobs();
    };
    const timeoutMessage = () => `Execution timed out after ${effectiveTimeoutMs}ms`;
    const expireDeadline = () => {
      if (closing || cancelled || timedOut) return;
      timedOut = true;
      const message = timeoutMessage();
      abortHostCalls(message);
      rejectExecutionGate(message);
      rejectDeadline?.(new Error(message));
    };
    const scheduleDeadline = () => {
      if (!rejectDeadline || closing || cancelled || timedOut) return;
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(expireDeadline, Math.max(0, executionDeadlineAt - performance.now()));
    };
    const extendExecutionTimeout = (ref, args) => {
      const requestedTimeoutMs = options.minimumTimeoutMsForHostCall?.(ref, args);
      if (typeof requestedTimeoutMs !== "number" || !Number.isFinite(requestedTimeoutMs)) {
        return;
      }
      const requestedDurationMs = Math.max(1, Math.floor(requestedTimeoutMs));
      const nextDeadlineAt = executionStartedAt + requestedDurationMs;
      if (nextDeadlineAt <= executionDeadlineAt) return;
      effectiveTimeoutMs = requestedDurationMs;
      executionDeadlineAt = nextDeadlineAt;
      scheduleDeadline();
    };
    try {
      const hostFunction = context.newFunction(
        "__fabricHostCall",
        (referenceHandle, argsHandle) => {
          const reference = context.getString(referenceHandle);
          const dumpedArgs = context.dump(argsHandle);
          const args = typeof dumpedArgs === "object" && dumpedArgs !== null && !Array.isArray(dumpedArgs) ? dumpedArgs : {};
          extendExecutionTimeout(reference, args);
          const promise = context.newPromise();
          pendingHostPromises.add(promise);
          void promise.settled.then(() => pendingHostPromises.delete(promise));
          if (reference === "fabric.$timer") {
            const ms = Math.max(0, Number(args.ms ?? 0));
            const timer = setTimeout(() => {
              if (closing || promise.alive === false) return;
              promise.resolve(context.undefined);
              runtime.executePendingJobs();
            }, ms);
            timer.unref?.();
            pendingTimers.add(timer);
            void promise.settled.then(() => pendingTimers.delete(timer));
            return promise.handle;
          }
          const task = runAbortable(
            hostAbortController.signal,
            () => hostCall(reference, args, hostAbortController.signal)
          ).then((value2) => {
            if (closing || promise.alive === false) return;
            const handle = jsonHandle(context, jsonObject, jsonParse, value2);
            promise.resolve(handle);
            handle.dispose();
          }).catch((error) => {
            if (closing || promise.alive === false) return;
            const errorHandle = context.newError(
              error instanceof Error ? error.message : String(error)
            );
            promise.reject(errorHandle);
            errorHandle.dispose();
          }).finally(() => {
            if (!closing) runtime.executePendingJobs();
          });
          hostTasks.add(task);
          void task.finally(() => hostTasks.delete(task));
          return promise.handle;
        }
      );
      context.setProp(context.global, "__fabricHostCall", hostFunction);
      hostFunction.dispose();
      const printFunction = context.newFunction("print", (...handles) => {
        if (logsTruncated) return;
        const line = handles.map((handle) => formatValue(context.dump(handle))).join(" ");
        const remaining = maxLogChars - logChars;
        if (line.length > remaining) {
          if (remaining > 0) logs.push(line.slice(0, remaining));
          logs.push("[Pi Fabric log output truncated]");
          logsTruncated = true;
          return;
        }
        logs.push(line);
        logChars += line.length;
      });
      context.setProp(context.global, "print", printFunction);
      printFunction.dispose();
      const strings = jsonHandle(context, jsonObject, jsonParse, options.strings ?? {});
      context.setProp(context.global, "\u03C0", strings);
      strings.dispose();
      const tokenBudget = context.newNumber(options.tokenBudget ?? Number.POSITIVE_INFINITY);
      context.setProp(context.global, "__fabricTokenBudget", tokenBudget);
      tokenBudget.dispose();
      const setupResult = context.evalCode(
        guestSetupForCoreToolNamespace(
          options.coreToolNamespace,
          options.agentBackedOrchestration !== false,
          {
            ...options.defaultAgentRunner ? { defaultAgentRunner: options.defaultAgentRunner } : {},
            ...options.unaccountedAgentRunners ? { unaccountedAgentRunners: options.unaccountedAgentRunners } : {}
          }
        ),
        "kiro-fabric-setup.js"
      );
      if (setupResult.error) {
        const deadlineExceeded = interruptedByDeadline || performance.now() > executionDeadlineAt;
        if (deadlineExceeded) timedOut = true;
        const error = options.signal?.aborted ? "Execution cancelled" : deadlineExceeded ? timeoutMessage() : formatValue(context.dump(setupResult.error));
        setupResult.error.dispose();
        abortHostCalls(error);
        return {
          value: void 0,
          logs,
          terminationReason: options.signal?.aborted ? "aborted" : deadlineExceeded ? "timed_out" : "runtime_error",
          error
        };
      }
      setupResult.value.dispose();
      executionGate = context.newPromise();
      context.setProp(context.global, "__fabricExecutionGate", executionGate.handle);
      const guestBundle = options.transpiledCode === void 0 ? transpileFabricCodeWithSourceMap(code) : { code: options.transpiledCode, sourceMap: options.transpiledSourceMap };
      const transpiledError = fabricTranspiledLimitError(guestBundle.code);
      if (transpiledError) {
        abortHostCalls(transpiledError);
        return {
          value: void 0,
          logs,
          terminationReason: "runtime_error",
          error: transpiledError
        };
      }
      const guestStackMap = createGuestStackMap(guestBundle.sourceMap);
      const guestLineCount = guestBundle.code.split("\n").length;
      const wrappedCode = `${guestBundle.code}
Promise.race([__kiroFabricMain(), globalThis.__fabricExecutionGate])`;
      const evaluation = context.evalCode(wrappedCode, "kiro-fabric-guest.js");
      runtime.executePendingJobs();
      if (evaluation.error) {
        const deadlineExceeded = interruptedByDeadline || performance.now() > executionDeadlineAt;
        if (deadlineExceeded) timedOut = true;
        const error = options.signal?.aborted ? "Execution cancelled" : deadlineExceeded ? timeoutMessage() : remapGuestErrorText(formatValue(context.dump(evaluation.error)), guestStackMap, guestLineCount);
        evaluation.error.dispose();
        abortHostCalls(error);
        return {
          value: void 0,
          logs,
          terminationReason: options.signal?.aborted ? "aborted" : deadlineExceeded ? "timed_out" : "runtime_error",
          error
        };
      }
      activePromiseHandle = evaluation.value;
      const cancellation = new Promise((_resolve, reject) => {
        abortHandler = () => {
          cancelled = true;
          hostAbortController.abort(options.signal?.reason);
          rejectExecutionGate("Execution cancelled");
          reject(new Error("Execution cancelled"));
        };
        if (options.signal?.aborted) abortHandler();
        else options.signal?.addEventListener("abort", abortHandler, { once: true });
      });
      void cancellation.catch(() => void 0);
      const deadline = new Promise((_resolve, reject) => {
        rejectDeadline = reject;
        scheduleDeadline();
      });
      pendingResolution = context.resolvePromise(activePromiseHandle);
      runtime.executePendingJobs();
      const resolution = await Promise.race([pendingResolution, deadline, cancellation]);
      pendingResolution = void 0;
      activePromiseHandle.dispose();
      activePromiseHandle = void 0;
      if (resolution.error) {
        const deadlineExceeded = timedOut || interruptedByDeadline || performance.now() > executionDeadlineAt;
        if (deadlineExceeded) timedOut = true;
        const error = options.signal?.aborted ? "Execution cancelled" : deadlineExceeded ? timeoutMessage() : remapGuestErrorText(formatValue(context.dump(resolution.error)), guestStackMap, guestLineCount);
        resolution.error.dispose();
        abortHostCalls(error);
        return {
          value: void 0,
          logs,
          terminationReason: options.signal?.aborted ? "aborted" : deadlineExceeded ? "timed_out" : "runtime_error",
          error
        };
      }
      const value = context.dump(resolution.value);
      resolution.value.dispose();
      return { value, logs, terminationReason: "completed" };
    } catch (error) {
      const deadlineExceeded = timedOut || interruptedByDeadline || performance.now() > executionDeadlineAt;
      if (deadlineExceeded) timedOut = true;
      abortHostCalls(error instanceof Error ? error.message : String(error));
      return {
        value: void 0,
        logs,
        terminationReason: cancelled ? "aborted" : deadlineExceeded ? "timed_out" : "runtime_error",
        error: cancelled ? "Execution cancelled" : deadlineExceeded ? timeoutMessage() : error instanceof Error ? error.message : String(error)
      };
    } finally {
      if (timeout) clearTimeout(timeout);
      for (const timer of pendingTimers) clearTimeout(timer);
      if (abortHandler) options.signal?.removeEventListener("abort", abortHandler);
      if (hostTasks.size > 0) {
        const settled = await settleWithin(hostTasks, HOST_TASK_SETTLE_GRACE_MS);
        if (!settled) {
          abortHostCalls("Fabric guest execution ended before its host calls settled");
          await settleWithin(hostTasks, HOST_TASK_SETTLE_GRACE_MS);
        }
        runtime.executePendingJobs();
      }
      closing = true;
      if (timedOut || cancelled || pendingHostPromises.size > 0) {
        const cleanupMessage = cancelled ? "Execution cancelled" : timedOut ? timeoutMessage() : "Fabric guest execution ended before its host calls settled";
        if (!hostAbortController.signal.aborted) hostAbortController.abort(new Error(cleanupMessage));
        rejectExecutionGate(cleanupMessage);
        const errorHandle = context.newError(cleanupMessage);
        for (const promise of pendingHostPromises) promise.reject(errorHandle);
        errorHandle.dispose();
        runtime.executePendingJobs();
        await new Promise((resolve) => setImmediate(resolve));
        const settled = await Promise.race([
          pendingResolution ? pendingResolution.catch(() => void 0) : Promise.resolve(void 0),
          new Promise((resolve) => {
            const timer = setTimeout(() => resolve(void 0), 1e3);
            timer.unref?.();
          })
        ]);
        if (settled?.error) settled.error.dispose();
        if (settled?.value) settled.value.dispose();
        for (const promise of pendingHostPromises) {
          if (promise.alive !== false) promise.dispose();
        }
      }
      if (activePromiseHandle?.alive !== false) activePromiseHandle?.dispose();
      if (executionGate?.alive !== false) executionGate?.dispose();
      runtime.executePendingJobs();
      jsonParse.dispose();
      jsonObject.dispose();
      disposeQuickJsContext(context);
    }
  }
};

export {
  createGuestStackMap,
  remapGuestErrorText,
  guestSetupForCoreToolNamespace,
  GUEST_SETUP,
  QuickJsRuntime
};
