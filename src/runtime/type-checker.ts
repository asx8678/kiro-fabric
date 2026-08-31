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

/**
 * `strict` reports all semantic diagnostics. `schema-relaxed` leaves argument
 * value/shape correctness to the runtime schema validator, while still
 * rejecting syntax errors, missing names, and other non-schema failures.
 */
export type FabricCompilerCheckingMode = "strict" | "schema-relaxed";

export interface FabricCompilerRequest {
  code: string;
  declarations: string;
  mode: FabricCompilerCheckingMode;
}

export type FabricCompilerWorkerResponse =
  | { ok: true; result: FabricTypeCheckResult }
  | { ok: false; error: string };

export const DEFAULT_COMPILER_TIMEOUT_MS = 10_000;
const MAX_COMPILER_DIAGNOSTICS = 50;
const MAX_DIAGNOSTIC_MESSAGE_CHARS = 4_096;
const COMPILER_MEMORY_MB = 128;

const relaxedCompilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: false,
  noEmit: false,
  sourceMap: true,
  skipLibCheck: true,
  lib: ["lib.es2022.d.ts"],
};

const compilerOptionsFor = (mode: FabricCompilerCheckingMode): ts.CompilerOptions =>
  mode === "strict"
    ? { ...relaxedCompilerOptions, strict: true }
    : relaxedCompilerOptions;

const TYPE_CORRECTNESS_CODES = new Set<number>([
  2339, 2551,
  2322, 2345, 2367,
  2531, 2532, 18047, 18048,
  7006, 7008, 7019, 7031, 7032, 7033, 7034,
]);

let nextCheckerId = 0;

export const normalizeTypeScriptPath = (fileName: string): string =>
  fileName.replaceAll("\\", "/");

/** Guest programs execute inside this wrapper; user code starts on wrapped line 2. */
export const wrapFabricGuestCode = (code: string): string =>
  `async function __kiroFabricMain() {\n${code}\n}\n`;

class FabricTypeChecker {
  readonly #guestFile: string;
  readonly #declarationFile: string;
  readonly #baseHost = ts.createCompilerHost(relaxedCompilerOptions, true);
  readonly #stableFiles = new Map<string, ts.SourceFile>();
  readonly #declarationSource: ts.SourceFile;
  readonly #host: ts.CompilerHost;
  #sourceText = "";
  #sourceFile: ts.SourceFile;
  #program: ts.Program | undefined;

  constructor(readonly declarations: string) {
    const id = ++nextCheckerId;
    this.#guestFile = normalizeTypeScriptPath(path.resolve(`/__kiro_fabric_guest_${id}.ts`));
    this.#declarationFile = normalizeTypeScriptPath(
      path.resolve(`/__kiro_fabric_globals_${id}.d.ts`),
    );
    this.#sourceFile = ts.createSourceFile(
      this.#guestFile,
      "",
      ts.ScriptTarget.ES2022,
      true,
    );
    this.#declarationSource = ts.createSourceFile(
      this.#declarationFile,
      declarations,
      ts.ScriptTarget.ES2022,
      true,
    );
    const isGuestFile = (fileName: string): boolean =>
      this.#baseHost.getCanonicalFileName(normalizeTypeScriptPath(fileName)) ===
      this.#baseHost.getCanonicalFileName(this.#guestFile);
    const isDeclarationFile = (fileName: string): boolean =>
      this.#baseHost.getCanonicalFileName(normalizeTypeScriptPath(fileName)) ===
      this.#baseHost.getCanonicalFileName(this.#declarationFile);
    this.#host = {
      ...this.#baseHost,
      fileExists: (fileName) =>
        isGuestFile(fileName) ||
        isDeclarationFile(fileName) ||
        this.#baseHost.fileExists(fileName),
      readFile: (fileName) => {
        if (isGuestFile(fileName)) return this.#sourceText;
        if (isDeclarationFile(fileName)) return this.declarations;
        return this.#baseHost.readFile(fileName);
      },
      getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
        if (isGuestFile(fileName)) return this.#sourceFile;
        if (isDeclarationFile(fileName)) return this.#declarationSource;
        const cached = this.#stableFiles.get(fileName);
        if (cached) return cached;
        const source = this.#baseHost.getSourceFile(
          fileName,
          languageVersion,
          onError,
          shouldCreateNewSourceFile,
        );
        if (source) this.#stableFiles.set(fileName, source);
        return source;
      },
    };
  }

  check(code: string, mode: FabricCompilerCheckingMode): FabricTypeCheckResult {
    const compilerOptions = compilerOptionsFor(mode);
    this.#sourceText = wrapFabricGuestCode(code);
    this.#sourceFile = ts.createSourceFile(
      this.#guestFile,
      this.#sourceText,
      ts.ScriptTarget.ES2022,
      true,
    );
    const program = ts.createProgram({
      rootNames: [this.#declarationFile, this.#guestFile],
      options: compilerOptions,
      host: this.#host,
      ...(this.#program ? { oldProgram: this.#program } : {}),
    });
    this.#program = program;
    const diagnostics = [
      ...program.getSyntacticDiagnostics(this.#sourceFile),
      ...program
        .getSemanticDiagnostics(this.#sourceFile)
        .filter((diagnostic) => mode === "strict" || !TYPE_CORRECTNESS_CODES.has(diagnostic.code)),
    ].slice(0, MAX_COMPILER_DIAGNOSTICS);
    const errors = diagnostics.map((diagnostic) => {
      const flattened = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      const message = flattened.length > MAX_DIAGNOSTIC_MESSAGE_CHARS
        ? `${flattened.slice(0, MAX_DIAGNOSTIC_MESSAGE_CHARS)}…[truncated]`
        : flattened;
      if (!diagnostic.file || diagnostic.start === undefined) {
        return { line: 0, column: 0, message };
      }
      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return {
        line: Math.max(1, position.line),
        column: position.character + 1,
        message,
      };
    });
    if (errors.length > 0) return { errors };

    let javascript: string | undefined;
    let sourceMap: string | undefined;
    program.emit(this.#sourceFile, (fileName, content) => {
      if (fileName.endsWith(".js.map")) sourceMap = content;
      else if (fileName.endsWith(".js")) javascript = content;
    });
    return {
      errors,
      ...(javascript ? { javascript } : {}),
      ...(sourceMap ? { sourceMap } : {}),
    };
  }
}

const checkerCache = new Map<string, FabricTypeChecker>();
const MAX_CHECKERS = 4;

const checkerFor = (declarations: string): FabricTypeChecker => {
  const cached = checkerCache.get(declarations);
  if (cached) {
    checkerCache.delete(declarations);
    checkerCache.set(declarations, cached);
    return cached;
  }
  const checker = new FabricTypeChecker(declarations);
  checkerCache.set(declarations, checker);
  while (checkerCache.size > MAX_CHECKERS) {
    const oldest = checkerCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    checkerCache.delete(oldest);
  }
  return checker;
};

export interface FabricTranspileResult {
  code: string;
  sourceMap?: string;
}

export const transpileFabricCodeWithSourceMap = (code: string): FabricTranspileResult => {
  const result = ts.transpileModule(wrapFabricGuestCode(code), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      sourceMap: true,
    },
  });
  return {
    code: result.outputText,
    ...(result.sourceMapText ? { sourceMap: result.sourceMapText } : {}),
  };
};

export const typeCheckFabricCode = (
  code: string,
  declarations: string,
  mode: FabricCompilerCheckingMode = "schema-relaxed",
): FabricTypeCheckResult => checkerFor(declarations).check(code, mode);

export interface FabricCompilerWorkerOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  workerUrl?: URL;
}

/** Runs the compiler outside the host event loop. A worker is never reused:
 * timed-out, aborted, failed, or oversized work therefore cannot poison a
 * later compilation cache. The worker-local checker cache dies on exit. */
export const typeCheckFabricCodeInWorker = (
  request: FabricCompilerRequest,
  options: FabricCompilerWorkerOptions = {},
): Promise<FabricTypeCheckResult> => new Promise((resolve, reject) => {
  if (options.signal?.aborted) {
    reject(options.signal.reason ?? new Error("Fabric compiler aborted"));
    return;
  }
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? DEFAULT_COMPILER_TIMEOUT_MS, 60_000));
  // Vitest/dev imports this source module directly, while the worker must use
  // the same compiled artifact that production ships (Node cannot resolve the
  // source's `.js` specifiers inside a raw TypeScript worker).
  const defaultWorkerUrl = import.meta.url.endsWith(".ts")
    ? new URL("../../dist/runtime/compiler-worker-entry.js", import.meta.url)
    : new URL("../runtime/compiler-worker-entry.js", import.meta.url);
  const worker = new Worker(
    options.workerUrl ?? defaultWorkerUrl,
    { resourceLimits: { maxOldGenerationSizeMb: COMPILER_MEMORY_MB, stackSizeMb: 4 } },
  );
  let settled = false;
  const finish = (error?: Error, result?: FabricTypeCheckResult): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    void worker.terminate();
    if (error) reject(error);
    else resolve(result!);
  };
  const onAbort = (): void => finish(new Error("Fabric compiler aborted"));
  const timer = setTimeout(
    () => finish(new Error(`Fabric compiler timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  timer.unref();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  worker.once("message", (response: FabricCompilerWorkerResponse) => {
    if (response.ok) finish(undefined, response.result);
    else finish(new Error(`Fabric compiler failed: ${response.error}`));
  });
  worker.once("error", (error: unknown) => finish(new Error(
    `Fabric compiler worker failed: ${error instanceof Error ? error.message : String(error)}`,
  )));
  worker.once("exit", (code) => {
    if (!settled) finish(new Error(`Fabric compiler worker exited before replying (${code})`));
  });
  worker.postMessage(request);
});
