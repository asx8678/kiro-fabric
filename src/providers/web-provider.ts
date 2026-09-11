import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { webSearchSnippet, webOpenSnippet } from "./web-snippets.js";
import { assertPublicWebInput } from "./web-privacy.js";
import { throwIfAbortedOrExpired } from "../async-settlement.js";
import { schemaValidationMessage } from "../schema-validation.js";
import type { FabricActionDescriptor, FabricInvocationContext, FabricProvider } from "../protocol.js";

const jsonTree = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const object = (properties: Record<string, unknown>, required: string[] = []) => jsonTree({ type: "object", properties, required, additionalProperties: false });
const string = { type: "string" };
const boolean = { type: "boolean" };
const integer = { type: "integer", minimum: 0 };
const WEB_QUERY_MAX = 500;
const WEB_URL_MAX = 8192;
const WEB_SELECTOR_MAX = 1000;
const WEB_SEARCH_LIMIT_MAX = 10;
const WEB_OPEN_MAX_CHARS = 100_000;
const DEFAULT_SEARCH_TIMEOUT_MS = 45_000;
const DEFAULT_OPEN_TIMEOUT_MS = 45_000;
const DEFAULT_OPEN_SELECTOR = "article, main, [role=main]";
const MISSING_BROWSER_HARNESS = "browser-harness-js is required for web.search/web.open but was not found";

export interface BrowserHarnessExecutable { path: string; dev: number; ino: number }
export interface WebSearchResult { title: string; url: string; snippet: string }
export interface WebSearchOutput { source: "google"; query: string; results: WebSearchResult[] }
export interface WebOpenOutput { url: string; finalUrl: string; title: string; text: string; chars: number; truncated: boolean; selector: string }

const rawSchemas: Record<string, Record<string, unknown>> = {
  search: object({
    query: { type: "string", minLength: 1, maxLength: WEB_QUERY_MAX },
    limit: { type: "integer", minimum: 1, maximum: WEB_SEARCH_LIMIT_MAX },
  }, ["query"]),
  open: object({
    url: { type: "string", minLength: 1, maxLength: WEB_URL_MAX },
    selector: { type: "string", minLength: 1, maxLength: WEB_SELECTOR_MAX },
    wait: { enum: ["networkIdle", "almostIdle", "load"] },
    settleMs: { type: "integer", minimum: 0, maximum: 10_000 },
    maxChars: { type: "integer", minimum: 1, maximum: WEB_OPEN_MAX_CHARS },
  }, ["url"]),
};

const outputSchemas: Record<string, Record<string, unknown>> = {
  search: object({
    source: { const: "google" },
    query: string,
    results: { type: "array", maxItems: WEB_SEARCH_LIMIT_MAX, items: object({ title: string, url: string, snippet: string }, ["title", "url", "snippet"]) },
  }, ["source", "query", "results"]),
  open: object({
    url: string,
    finalUrl: string,
    title: string,
    text: string,
    chars: integer,
    truncated: boolean,
    selector: string,
  }, ["url", "finalUrl", "title", "text", "chars", "truncated", "selector"]),
};

const descriptions: Record<string, string> = {
  search: "Browser-backed Google web search through browser-harness-js/CDP. Opens an isolated background tab in a fresh private Chromium context (no default-profile cookies), returns bounded {title,url,snippet} results, and closes the tab. Use to ground current/open-world facts before relying on memory or stale training data. Requires browser-harness-js on PATH and a Chromium browser with remote debugging and private-context support available. Network risk; read-only open-world emission.",
  open: "Open one http(s) URL through browser-harness-js/CDP and extract bounded readable text from article/main/[role=main] or a caller-supplied selector. Use after web.search to inspect a source page that may block curl/simple HTTP clients. Closes the isolated tab. Network risk; read-only open-world emission.",
};

const descriptors: readonly FabricActionDescriptor[] = Object.keys(rawSchemas).map((name) => ({
  name,
  description: descriptions[name]!,
  inputSchema: rawSchemas[name]!,
  outputSchema: outputSchemas[name]!,
  risk: "network",
  namespace: "web",
  effect: { kind: "emission", resources: [name === "search" ? "web:google-search" : "web:open-url"] },
  annotations: { title: name === "search" ? "Search the web" : "Open a web page", readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const errorCode = (error: unknown): string | undefined =>
  isRecord(error) && typeof error.code === "string" ? error.code : undefined;
const clip = (value: unknown, maximum: number): string =>
  (typeof value === "string" ? value : value == null ? "" : String(value)).slice(0, maximum);
const squish = (value: unknown, maximum: number): string =>
  clip(value, maximum).replace(/\s+/gu, " ").trim();
const pathDirectories = (): string[] => (process.env.PATH ?? "").split(path.delimiter).filter((entry) => path.isAbsolute(entry));

/** browser-harness-js needs browser profile discovery and its own local daemon
 * state, but not ambient language loader hooks or credentials. This is an
 * allowlist for a host command, not sandboxing. */
export const browserHarnessEnvironment = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "TERM", "TZ", "USER", "LOGNAME",
    "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "LOCALAPPDATA", "APPDATA",
    "CDP_REPL_PORT", "CDP_REPL_LOG", "BROWSER_HARNESS_JS_HOME", "CDP_RECORD", "CDP_RECORDINGS_DIR",
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  env.PATH = pathDirectories().join(path.delimiter);
  return env;
};

export function verifyBrowserHarnessExecutable(executable: BrowserHarnessExecutable): void {
  let stat: fs.Stats;
  try { stat = fs.lstatSync(executable.path); }
  catch (error) {
    if (errorCode(error) === "ENOENT") throw new Error(MISSING_BROWSER_HARNESS);
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== executable.dev || stat.ino !== executable.ino ||
      (stat.mode & 0o022) !== 0 || (stat.mode & 0o111) === 0 ||
      (process.getuid && stat.uid !== 0 && stat.uid !== process.getuid())) {
    throw new Error("browser-harness-js executable identity or trust changed; restart after repairing it");
  }
}

const executableCandidate = (target: string): BrowserHarnessExecutable => {
  const real = fs.realpathSync(target);
  const stat = fs.lstatSync(real);
  const executable: BrowserHarnessExecutable = { path: real, dev: stat.dev, ino: stat.ino };
  verifyBrowserHarnessExecutable(executable);
  // Discovery performs no subprocess or browser work before network approval.
  return executable;
};

export function resolveBrowserHarnessExecutable(command = "browser-harness-js"): BrowserHarnessExecutable {
  if (path.isAbsolute(command)) return executableCandidate(command);
  if (!command.trim() || command.includes("\0") || command.includes("/") || command.includes("\\")) {
    throw new Error("browser-harness-js command must be absolute or a bare executable name");
  }
  for (const directory of pathDirectories()) {
    try { return executableCandidate(path.join(directory, command)); }
    catch (error) {
      const code = errorCode(error);
      if (["ENOENT", "ENOTDIR"].includes(code ?? "")) continue;
      if (error instanceof Error && error.message === MISSING_BROWSER_HARNESS) continue;
      throw error;
    }
  }
  throw new Error(MISSING_BROWSER_HARNESS);
}

interface HarnessRunOptions {
  executable: BrowserHarnessExecutable;
  code: string;
  timeoutMs: number;
  maxStdoutChars: number;
  signal?: AbortSignal;
  deadline?: FabricInvocationContext["deadline"];
}

const runBrowserHarness = async (options: HarnessRunOptions): Promise<string> => {
  verifyBrowserHarnessExecutable(options.executable);
  throwIfAbortedOrExpired(options.signal, options.deadline);
  const remaining = options.deadline ? Math.floor(options.deadline.remainingMs()) : options.timeoutMs;
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs, remaining));
  return await new Promise<string>((resolve, reject) => {
    // One opaque JS argument, never shell interpolation. execFile bounds both
    // streams and destroys its pipes on timeout, even if the CLI's curl is alive.
    // The shared harness daemon is deliberately not killed: cancellation is not
    // rollback of a browser request. The snippet has its own bounded wait/cleanup.
    execFile(options.executable.path, [options.code], {
      cwd: path.dirname(options.executable.path),
      env: browserHarnessEnvironment(),
      encoding: "utf8",
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: options.maxStdoutChars * 4,
      ...(options.signal ? { signal: options.signal } : {}),
    }, (error, stdout) => {
      try { throwIfAbortedOrExpired(options.signal, options.deadline); }
      catch { reject(new Error("browser-harness-js cancelled or deadline expired")); return; }
      if (error) {
        const detail = error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "output exceeded Fabric bounds"
          : error.killed ? "timed out"
          : "request failed; check browser connectivity and private-context support. Raw diagnostics withheld for privacy";
        reject(new Error(`browser-harness-js failed: ${detail}`));
      } else if (stdout.length > options.maxStdoutChars) {
        reject(new Error("browser-harness-js output exceeded Fabric bounds"));
      } else resolve(stdout.trim());
    });
  });
};

const jsonFromHarness = async (options: HarnessRunOptions, action: string): Promise<Record<string, unknown>> => {
  const text = await runBrowserHarness(options);
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new Error(`browser-harness-js returned invalid JSON for web.${action}`); }
  if (!isRecord(parsed)) throw new Error(`browser-harness-js returned invalid result for web.${action}`);
  return parsed;
};

const normalizeHttpUrl = (value: unknown): string => {
  if (typeof value !== "string" || value.length < 1 || value.length > WEB_URL_MAX) throw new Error("web.open url must be a bounded string");
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error("web.open url must be an absolute http(s) URL"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("web.open url must use http or https");
  if (parsed.username || parsed.password) throw new Error("web.open url must not contain credentials");
  assertPublicWebInput(value);
  const text = parsed.toString();
  if (text.length > WEB_URL_MAX) throw new Error("web.open normalized URL is too long");
  return text;
};

const pageBudget = (timeoutMs: number, context: FabricInvocationContext): number =>
  Math.max(1, Math.floor(Math.min(30_000, timeoutMs, context.deadline?.remainingMs() ?? timeoutMs) - 1_000));

export class WebProvider implements FabricProvider {
  readonly name = "web";
  readonly description = "Browser-backed web search and page reading through browser-harness-js";
  readonly #executable: BrowserHarnessExecutable;
  readonly #searchTimeoutMs: number;
  readonly #openTimeoutMs: number;
  constructor(options: { executable?: BrowserHarnessExecutable; executablePath?: string; searchTimeoutMs?: number; openTimeoutMs?: number } = {}) {
    this.#executable = Object.freeze({ ...(options.executable ?? resolveBrowserHarnessExecutable(options.executablePath ?? "browser-harness-js")) });
    verifyBrowserHarnessExecutable(this.#executable);
    this.#searchTimeoutMs = options.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
    this.#openTimeoutMs = options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.#searchTimeoutMs) || this.#searchTimeoutMs < 1 || this.#searchTimeoutMs > 900_000) throw new Error("web searchTimeoutMs must be 1..900000");
    if (!Number.isSafeInteger(this.#openTimeoutMs) || this.#openTimeoutMs < 1 || this.#openTimeoutMs > 900_000) throw new Error("web openTimeoutMs must be 1..900000");
  }
  async list(): Promise<FabricActionDescriptor[]> { return jsonTree([...descriptors]); }
  async describe(actionName: string): Promise<FabricActionDescriptor | undefined> {
    const descriptor = descriptors.find((entry) => entry.name === actionName);
    return descriptor ? jsonTree(descriptor) : undefined;
  }
  prepareArguments(actionName: string, args: Record<string, unknown>): Record<string, unknown> {
    const rawSchema = rawSchemas[actionName];
    if (!rawSchema) throw new Error(`Unknown web action: ${actionName}`);
    const invalid = schemaValidationMessage(rawSchema, args);
    if (invalid) throw new Error(`Invalid web.${actionName} arguments: ${invalid}`);
    if (actionName === "search") {
      const query = typeof args.query === "string" ? args.query.normalize("NFKC").trim() : "";
      if (!query || query.length > WEB_QUERY_MAX) throw new Error("web.search query must be 1..500 characters");
      assertPublicWebInput(query);
      const limit = args.limit === undefined ? 5 : args.limit;
      if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > WEB_SEARCH_LIMIT_MAX) throw new Error("web.search limit must be 1..10");
      return { query, limit: limit as number };
    }
    if (actionName === "open") {
      const url = normalizeHttpUrl(args.url);
      const selector = args.selector === undefined ? DEFAULT_OPEN_SELECTOR : args.selector;
      if (typeof selector !== "string" || selector.length < 1 || selector.length > WEB_SELECTOR_MAX || selector.includes("\0")) throw new Error("web.open selector must be a bounded CSS selector");
      const wait = args.wait === undefined ? "networkIdle" : args.wait;
      if (wait !== "networkIdle" && wait !== "almostIdle" && wait !== "load") throw new Error("web.open wait must be networkIdle, almostIdle, or load");
      const settleMs = args.settleMs === undefined ? 0 : args.settleMs;
      if (!Number.isSafeInteger(settleMs) || (settleMs as number) < 0 || (settleMs as number) > 10_000) throw new Error("web.open settleMs must be 0..10000");
      const maxChars = args.maxChars === undefined ? 20_000 : args.maxChars;
      if (!Number.isSafeInteger(maxChars) || (maxChars as number) < 1 || (maxChars as number) > WEB_OPEN_MAX_CHARS) throw new Error("web.open maxChars must be 1..100000");
      return { url, selector, wait, settleMs: settleMs as number, maxChars: maxChars as number };
    }
    throw new Error(`Unknown web action: ${actionName}`);
  }
  effectResources(actionName: string, args: Record<string, unknown>): readonly string[] {
    if (actionName === "search") return ["web:google-search"];
    if (actionName === "open" && typeof args.url === "string") {
      try { return [`web:origin:${new URL(args.url).origin}`]; }
      catch { return ["web:open-url"]; }
    }
    return ["web"];
  }
  async invoke(actionName: string, args: Record<string, unknown>, context: FabricInvocationContext): Promise<unknown> {
    throwIfAbortedOrExpired(context.signal, context.deadline);
    const prepared = this.prepareArguments(actionName, args);
    if (actionName === "search") return this.#search(prepared, context);
    if (actionName === "open") return this.#open(prepared, context);
    throw new Error(`Unknown web action: ${actionName}`);
  }
  async #search(args: Record<string, unknown>, context: FabricInvocationContext): Promise<WebSearchOutput> {
    const query = args.query as string;
    const limit = args.limit as number;
    const raw = await jsonFromHarness({
      executable: this.#executable,
      code: webSearchSnippet(query, limit, pageBudget(this.#searchTimeoutMs, context)),
      timeoutMs: this.#searchTimeoutMs,
      maxStdoutChars: 120_000,
      ...(context.signal ? { signal: context.signal } : {}),
      ...(context.deadline ? { deadline: context.deadline } : {}),
    }, "search");
    if (!Array.isArray(raw.results)) throw new Error("browser-harness-js returned invalid results for web.search");
    const results = raw.results.slice(0, limit).map((item): WebSearchResult => {
      const record = isRecord(item) ? item : {};
      return { title: squish(record.title, 300), url: typeof record.url === "string" && record.url.length <= WEB_URL_MAX ? record.url : "", snippet: squish(record.snippet, 600) };
    }).filter((item) => {
      try { item.url = normalizeHttpUrl(item.url); return Boolean(item.title); } catch { return false; }
    });
    return { source: "google", query, results };
  }
  async #open(args: Record<string, unknown>, context: FabricInvocationContext): Promise<WebOpenOutput> {
    const url = args.url as string;
    const selector = args.selector as string;
    const wait = args.wait as "networkIdle" | "almostIdle" | "load";
    const settleMs = args.settleMs as number;
    const maxChars = args.maxChars as number;
    const raw = await jsonFromHarness({
      executable: this.#executable,
      code: webOpenSnippet(url, selector, wait, settleMs, maxChars, pageBudget(this.#openTimeoutMs, context)),
      timeoutMs: this.#openTimeoutMs,
      maxStdoutChars: Math.min(1_000_000, maxChars * 6 + 20_000),
      ...(context.signal ? { signal: context.signal } : {}),
      ...(context.deadline ? { deadline: context.deadline } : {}),
    }, "open");
    if (typeof raw.text !== "string" || typeof raw.finalUrl !== "string" || typeof raw.title !== "string") throw new Error("browser-harness-js returned invalid result for web.open");
    const text = clip(raw.text, maxChars);
    const chars = Number.isSafeInteger(raw.chars) && (raw.chars as number) >= 0 ? raw.chars as number : text.length;
    return {
      url,
      finalUrl: normalizeHttpUrl(raw.finalUrl),
      title: squish(raw.title, 500),
      text,
      chars,
      truncated: raw.truncated === true || chars > text.length,
      selector,
    };
  }
}
