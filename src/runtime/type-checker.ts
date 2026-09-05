import path from "node:path";
import { Worker } from "node:worker_threads";
import ts from "typescript";

export interface FabricTypeError {
  line: number;
  column: number;
  message: string;
}

export interface FabricTypeCheckResult {
  errors: FabricTypeError[];
  javascript?: string;
  sourceMap?: string;
}

export interface FabricCompilerRequest {
  code: string;
  declarations: string;
}

export type FabricCompilerWorkerResponse =
  | { id: number; ok: true; result: FabricTypeCheckResult }
  | { id: number; ok: false; error: string };

const DEFAULT_COMPILER_TIMEOUT_MS = 10_000;
const MAX_COMPILER_DIAGNOSTICS = 50;
const MAX_DIAGNOSTIC_MESSAGE_CHARS = 4_096;
const COMPILER_MEMORY_MB = 128;
const FORBIDDEN_MODULE_MESSAGE = "Guest modules and external references are not allowed";
const GUEST_WRAPPER_INTEGRITY_MESSAGE = "Guest code must remain inside the generated Fabric wrapper";

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  noEmit: false,
  sourceMap: true,
  skipLibCheck: true,
  lib: ["lib.es2022.d.ts"],
  types: [],
};

let nextCheckerId = 0;
const normalizeTypeScriptPath = (fileName: string): string => fileName.replaceAll("\\", "/");
const standardLibraryRoot = normalizeTypeScriptPath(path.dirname(ts.getDefaultLibFilePath(compilerOptions)));
const standardLibraryName = /^lib(?:\.[a-z0-9.-]+)?\.d\.ts$/u;
const standardLibraryPath = (fileName: string): boolean => {
  const normalized = normalizeTypeScriptPath(path.resolve(fileName));
  return path.posix.dirname(normalized) === standardLibraryRoot && standardLibraryName.test(path.posix.basename(normalized));
};

/** Guest programs execute inside this wrapper; user code starts on wrapped line 2. */
const GUEST_WRAPPER_PREFIX = "async function __kiroFabricMain(): Promise<JsonValue> {\n";
const GUEST_WRAPPER_SUFFIX = "\n}\n";
const wrapFabricGuestCode = (code: string): string => `${GUEST_WRAPPER_PREFIX}${code}${GUEST_WRAPPER_SUFFIX}`;

const isExpectedMainDeclaration = (statement: ts.Statement): statement is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(statement) &&
  statement.name?.text === "__kiroFabricMain" &&
  statement.parameters.length === 0 &&
  statement.body !== undefined &&
  statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true;

const wrappedSourceIsIntact = (source: ts.SourceFile, text: string): boolean => {
  if (source.statements.length !== 1 || !isExpectedMainDeclaration(source.statements[0]!)) return false;
  const body = source.statements[0].body!;
  return body.getStart(source, false) === GUEST_WRAPPER_PREFIX.length - 2 &&
    body.getEnd() === text.length - 1;
};

export const assertFabricTranspiledWrapper = (javascript: string): void => {
  const emitted = ts.createSourceFile("fabric-guest.js", javascript, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const statements = [...emitted.statements];
  const directive = statements[0];
  if (directive && ts.isExpressionStatement(directive) && ts.isStringLiteral(directive.expression) && directive.expression.text === "use strict") statements.shift();
  if (statements.length !== 1 || !isExpectedMainDeclaration(statements[0]!)) {
    throw new Error(GUEST_WRAPPER_INTEGRITY_MESSAGE);
  }
};

const forbiddenModuleNode = (source: ts.SourceFile): ts.Node | undefined => {
  if (source.referencedFiles.length || source.typeReferenceDirectives.length || source.libReferenceDirectives.length) return source;
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isImportEqualsDeclaration(node) ||
      ts.isImportTypeNode(node) ||
      (ts.isCallExpression(node) && (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")
      )) ||
      (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name))
    ) found = node;
    else ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

class FabricTypeChecker {
  readonly #guestFile: string;
  readonly #declarationFile: string;
  readonly #baseHost = ts.createCompilerHost(compilerOptions, true);
  readonly #stableFiles = new Map<string, ts.SourceFile>();
  readonly #declarationSource: ts.SourceFile;
  readonly #host: ts.CompilerHost;
  #sourceText = "";
  #sourceFile: ts.SourceFile;
  #program: ts.Program | undefined;

  constructor(readonly declarations: string) {
    const id = ++nextCheckerId;
    this.#guestFile = normalizeTypeScriptPath(path.resolve(`/__kiro_fabric_guest_${id}.ts`));
    this.#declarationFile = normalizeTypeScriptPath(path.resolve(`/__kiro_fabric_globals_${id}.d.ts`));
    this.#sourceFile = ts.createSourceFile(this.#guestFile, "", ts.ScriptTarget.ES2022, true);
    this.#declarationSource = ts.createSourceFile(this.#declarationFile, declarations, ts.ScriptTarget.ES2022, true);
    const canonical = (fileName: string): string => this.#baseHost.getCanonicalFileName(normalizeTypeScriptPath(fileName));
    const isGuestFile = (fileName: string): boolean => canonical(fileName) === canonical(this.#guestFile);
    const isDeclarationFile = (fileName: string): boolean => canonical(fileName) === canonical(this.#declarationFile);
    const allowed = (fileName: string): boolean => isGuestFile(fileName) || isDeclarationFile(fileName) || standardLibraryPath(fileName);
    this.#host = {
      ...this.#baseHost,
      fileExists: allowed,
      readFile: (fileName) => {
        if (isGuestFile(fileName)) return this.#sourceText;
        if (isDeclarationFile(fileName)) return this.declarations;
        return standardLibraryPath(fileName) ? this.#baseHost.readFile(fileName) : undefined;
      },
      directoryExists: (directoryName) => normalizeTypeScriptPath(path.resolve(directoryName)) === standardLibraryRoot,
      getDirectories: () => [],
      realpath: (fileName) => allowed(fileName) ? normalizeTypeScriptPath(path.resolve(fileName)) : normalizeTypeScriptPath(fileName),
      resolveModuleNames: (moduleNames) => moduleNames.map(() => undefined),
      getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
        if (isGuestFile(fileName)) return this.#sourceFile;
        if (isDeclarationFile(fileName)) return this.#declarationSource;
        if (!standardLibraryPath(fileName)) return undefined;
        const normalized = normalizeTypeScriptPath(path.resolve(fileName));
        const cached = this.#stableFiles.get(normalized);
        if (cached) return cached;
        const source = this.#baseHost.getSourceFile(normalized, languageVersion, onError, shouldCreateNewSourceFile);
        if (source) this.#stableFiles.set(normalized, source);
        return source;
      },
    };
  }

  check(code: string): FabricTypeCheckResult {
    const references = ts.preProcessFile(code, true, true);
    if (references.referencedFiles.length || references.typeReferenceDirectives.length || references.libReferenceDirectives.length || references.importedFiles.length) {
      return { errors: [{ line: 1, column: 1, message: FORBIDDEN_MODULE_MESSAGE }] };
    }
    this.#sourceText = wrapFabricGuestCode(code);
    this.#sourceFile = ts.createSourceFile(this.#guestFile, this.#sourceText, ts.ScriptTarget.ES2022, true);
    if (!wrappedSourceIsIntact(this.#sourceFile, this.#sourceText)) {
      return { errors: [{ line: 1, column: 1, message: GUEST_WRAPPER_INTEGRITY_MESSAGE }] };
    }
    const forbidden = forbiddenModuleNode(this.#sourceFile);
    if (forbidden) {
      const position = this.#sourceFile.getLineAndCharacterOfPosition(forbidden.getStart(this.#sourceFile, false));
      return { errors: [{ line: Math.max(1, position.line), column: position.character + 1, message: FORBIDDEN_MODULE_MESSAGE }] };
    }
    const program = ts.createProgram({
      rootNames: [this.#declarationFile, this.#guestFile],
      options: compilerOptions,
      host: this.#host,
      ...(this.#program ? { oldProgram: this.#program } : {}),
    });
    this.#program = program;
    const diagnostics = [...program.getSyntacticDiagnostics(this.#sourceFile), ...program.getSemanticDiagnostics(this.#sourceFile)]
      .slice(0, MAX_COMPILER_DIAGNOSTICS);
    const errors = diagnostics.map((diagnostic) => {
      const flattened = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      const message = flattened.length > MAX_DIAGNOSTIC_MESSAGE_CHARS ? `${flattened.slice(0, MAX_DIAGNOSTIC_MESSAGE_CHARS)}…[truncated]` : flattened;
      if (!diagnostic.file || diagnostic.start === undefined) return { line: 0, column: 0, message };
      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return { line: Math.max(1, position.line), column: position.character + 1, message };
    });
    if (errors.length > 0) return { errors };

    let javascript: string | undefined;
    let sourceMap: string | undefined;
    program.emit(this.#sourceFile, (fileName, content) => {
      if (fileName.endsWith(".js.map")) sourceMap = content;
      else if (fileName.endsWith(".js")) javascript = content;
    });
    if (javascript) {
      try { assertFabricTranspiledWrapper(javascript); }
      catch { return { errors: [{ line: 1, column: 1, message: GUEST_WRAPPER_INTEGRITY_MESSAGE }] }; }
    }
    return { errors, ...(javascript ? { javascript } : {}), ...(sourceMap ? { sourceMap } : {}) };
  }
}

const checkerCache = new Map<string, FabricTypeChecker>();
const MAX_CHECKERS = 4;
const checkerFor = (declarations: string): FabricTypeChecker => {
  const cached = checkerCache.get(declarations);
  if (cached) { checkerCache.delete(declarations); checkerCache.set(declarations, cached); return cached; }
  const checker = new FabricTypeChecker(declarations);
  checkerCache.set(declarations, checker);
  while (checkerCache.size > MAX_CHECKERS) {
    const oldest = checkerCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    checkerCache.delete(oldest);
  }
  return checker;
};

export interface FabricTranspileResult { code: string; sourceMap?: string }
export const transpileFabricCodeWithSourceMap = (code: string): FabricTranspileResult => {
  const wrapped = wrapFabricGuestCode(code);
  const source = ts.createSourceFile("fabric-guest.ts", wrapped, ts.ScriptTarget.ES2022, true);
  if (!wrappedSourceIsIntact(source, wrapped)) throw new Error(GUEST_WRAPPER_INTEGRITY_MESSAGE);
  const result = ts.transpileModule(wrapped, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, sourceMap: true } });
  assertFabricTranspiledWrapper(result.outputText);
  return { code: result.outputText, ...(result.sourceMapText ? { sourceMap: result.sourceMapText } : {}) };
};
export const typeCheckFabricCode = (code: string, declarations: string): FabricTypeCheckResult => checkerFor(declarations).check(code);

export interface FabricCompilerWorkerOptions { signal?: AbortSignal; timeoutMs?: number; workerUrl?: URL }

/** Reuse is safe because the compiler host, not worker freshness, constrains
 * inputs. Each execution service owns its pool; no service closes another's
 * active compiler. Admission rejects rather than retaining an unbounded queue. */
const COMPILER_WORKER_IDLE_MS = 30_000;
const COMPILER_WORKER_MAX_USES = 250;

interface FabricCompilerWorkerState {
  worker: Worker;
  uses: number;
  poolable: boolean;
  idleTimer: NodeJS.Timeout | undefined;
  pending: { id: number; finish: (error?: Error, result?: FabricTypeCheckResult) => void } | undefined;
  termination?: Promise<void>;
}

const defaultCompilerWorkerUrl = (): URL => import.meta.url.endsWith(".ts")
  ? new URL("../../dist/runtime/compiler-worker-entry.js", import.meta.url)
  : new URL("../runtime/compiler-worker-entry.js", import.meta.url);

export class FabricCompilerPool {
  readonly #workers = new Set<FabricCompilerWorkerState>();
  #idle: FabricCompilerWorkerState | undefined;
  #nextId = 0;
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(readonly maxWorkers = 4) {
    if (!Number.isSafeInteger(maxWorkers) || maxWorkers < 1 || maxWorkers > 64) throw new Error("Invalid Fabric compiler worker limit");
  }

  #detachIdle(state: FabricCompilerWorkerState): void {
    if (state.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = undefined; }
    if (this.#idle === state) this.#idle = undefined;
  }

  #terminate(state: FabricCompilerWorkerState): Promise<void> {
    this.#detachIdle(state);
    return state.termination ??= state.worker.terminate().catch(() => undefined).then(() => { this.#workers.delete(state); });
  }

  #acquire(workerUrl?: URL): FabricCompilerWorkerState {
    if (workerUrl === undefined && this.#idle) {
      const state = this.#idle;
      this.#detachIdle(state);
      return state;
    }
    if (this.#workers.size >= this.maxWorkers) throw new Error("Fabric compiler concurrency limit reached");
    const state: FabricCompilerWorkerState = {
      worker: new Worker(workerUrl ?? defaultCompilerWorkerUrl(), { resourceLimits: { maxOldGenerationSizeMb: COMPILER_MEMORY_MB, stackSizeMb: 4 } }),
      uses: 0, poolable: workerUrl === undefined, idleTimer: undefined, pending: undefined,
    };
    this.#workers.add(state);
    state.worker.unref();
    state.worker.on("message", (response: FabricCompilerWorkerResponse) => {
      const pending = state.pending;
      if (!pending || pending.id !== response.id) return;
      if (response.ok) pending.finish(undefined, response.result);
      else pending.finish(new Error(`Fabric compiler failed: ${response.error}`));
    });
    state.worker.on("error", (error: unknown) => {
      state.pending?.finish(new Error(`Fabric compiler worker failed: ${error instanceof Error ? error.message : String(error)}`));
      void this.#terminate(state);
    });
    state.worker.on("exit", (code: number) => {
      this.#detachIdle(state);
      state.pending?.finish(new Error(`Fabric compiler worker exited before replying (${code})`));
      this.#workers.delete(state);
    });
    return state;
  }

  check(request: FabricCompilerRequest, options: FabricCompilerWorkerOptions = {}): Promise<FabricTypeCheckResult> {
    return new Promise((resolve, reject) => {
      if (this.#closed) { reject(new Error("Fabric compiler pool is closed")); return; }
      if (options.signal?.aborted) { reject(options.signal.reason ?? new Error("Fabric compiler aborted")); return; }
      const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? DEFAULT_COMPILER_TIMEOUT_MS, 60_000));
      const state = this.#acquire(options.workerUrl);
      const id = ++this.#nextId;
      let settled = false;
      const finish = (error?: Error, result?: FabricTypeCheckResult): void => {
        if (settled) return;
        settled = true;
        state.pending = undefined;
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        const complete = (): void => { if (error) reject(error); else resolve(result!); };
        if (error) { void this.#terminate(state).then(complete); return; }
        state.uses += 1;
        // Retain at most one warm idle worker; concurrent completions cannot
        // overwrite an owned worker and lose its shutdown handle.
        if (!this.#closed && !this.#idle && state.poolable && state.uses < COMPILER_WORKER_MAX_USES) {
          this.#idle = state;
          state.idleTimer = setTimeout(() => { void this.#terminate(state); }, COMPILER_WORKER_IDLE_MS);
          state.idleTimer.unref();
          complete();
        } else { void this.#terminate(state).then(complete); }
      };
      const onAbort = (): void => finish(options.signal?.reason instanceof Error ? options.signal.reason : new Error("Fabric compiler aborted"));
      const timer = setTimeout(() => finish(new Error(`Fabric compiler timed out after ${timeoutMs}ms`)), timeoutMs);
      state.pending = { id, finish };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted) onAbort();
      if (!settled) {
        try { state.worker.postMessage({ id, ...request }); }
        catch (error) { finish(error instanceof Error ? error : new Error("Fabric compiler dispatch failed")); }
      }
    });
  }

  close(): Promise<void> {
    this.#closed = true;
    return this.#closing ??= Promise.all([...this.#workers].map((state) => {
      state.pending?.finish(new Error("Fabric compiler pool is closed"));
      return this.#terminate(state);
    })).then(() => undefined);
  }
}

// Standalone callers retain the existing API, with independent bounded ownership.
let standaloneCompilerPool = new FabricCompilerPool();
export const shutdownFabricCompilerWorker = async (): Promise<void> => {
  const previous = standaloneCompilerPool;
  standaloneCompilerPool = new FabricCompilerPool();
  await previous.close();
};
export const typeCheckFabricCodeInWorker = (request: FabricCompilerRequest, options: FabricCompilerWorkerOptions = {}): Promise<FabricTypeCheckResult> => standaloneCompilerPool.check(request, options);
