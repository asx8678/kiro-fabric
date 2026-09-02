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
  | { ok: true; result: FabricTypeCheckResult }
  | { ok: false; error: string };

const DEFAULT_COMPILER_TIMEOUT_MS = 10_000;
const MAX_COMPILER_DIAGNOSTICS = 50;
const MAX_DIAGNOSTIC_MESSAGE_CHARS = 4_096;
const COMPILER_MEMORY_MB = 128;
const FORBIDDEN_MODULE_MESSAGE = "Guest modules and external references are not allowed";

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
const wrapFabricGuestCode = (code: string): string =>
  `async function __kiroFabricMain(): Promise<JsonValue> {\n${code}\n}\n`;

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
  const result = ts.transpileModule(wrapFabricGuestCode(code), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, sourceMap: true } });
  return { code: result.outputText, ...(result.sourceMapText ? { sourceMap: result.sourceMapText } : {}) };
};
export const typeCheckFabricCode = (code: string, declarations: string): FabricTypeCheckResult => checkerFor(declarations).check(code);

export interface FabricCompilerWorkerOptions { signal?: AbortSignal; timeoutMs?: number; workerUrl?: URL }
export const typeCheckFabricCodeInWorker = (request: FabricCompilerRequest, options: FabricCompilerWorkerOptions = {}): Promise<FabricTypeCheckResult> => new Promise((resolve, reject) => {
  if (options.signal?.aborted) { reject(options.signal.reason ?? new Error("Fabric compiler aborted")); return; }
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? DEFAULT_COMPILER_TIMEOUT_MS, 60_000));
  const defaultWorkerUrl = import.meta.url.endsWith(".ts") ? new URL("../../dist/runtime/compiler-worker-entry.js", import.meta.url) : new URL("../runtime/compiler-worker-entry.js", import.meta.url);
  const worker = new Worker(options.workerUrl ?? defaultWorkerUrl, { resourceLimits: { maxOldGenerationSizeMb: COMPILER_MEMORY_MB, stackSizeMb: 4 } });
  let settled = false;
  const finish = (error?: Error, result?: FabricTypeCheckResult): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    const complete = (): void => { if (error) reject(error); else resolve(result!); };
    void worker.terminate().then(complete, complete);
  };
  const onAbort = (): void => finish(options.signal?.reason instanceof Error ? options.signal.reason : new Error("Fabric compiler aborted"));
  const timer = setTimeout(() => finish(new Error(`Fabric compiler timed out after ${timeoutMs}ms`)), timeoutMs);
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  worker.once("message", (response: FabricCompilerWorkerResponse) => { if (response.ok) finish(undefined, response.result); else finish(new Error(`Fabric compiler failed: ${response.error}`)); });
  worker.once("error", (error: unknown) => finish(new Error(`Fabric compiler worker failed: ${error instanceof Error ? error.message : String(error)}`)));
  worker.once("exit", (code) => { if (!settled) finish(new Error(`Fabric compiler worker exited before replying (${code})`)); });
  if (!settled) worker.postMessage(request);
});
