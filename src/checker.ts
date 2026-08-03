import ts from "typescript";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
export interface Diagnostic { code: number; category: "error" | "warning"; message: string; line: number; column: number; sourceLine?: string }
export interface CheckResult { ok: boolean; diagnostics: Diagnostic[] }
const prefix = "async function __fabricMain(): Promise<unknown> {\n";
const suffix = "\n}\n";
function declarations(): string { return readFileSync(process.env.FABRIC_LITE_TYPES ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../types/fabric-lite.d.ts"), "utf8"); }
export function checkProgram(body: string): CheckResult {
 const diagnostics: Diagnostic[] = [];
 if (body.length > 100_000) diagnostics.push({ code: 9001, category: "error", message: "Program exceeds 100000 characters", line: 1, column: 1 });
 const scan = ts.createSourceFile("body.ts", body, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
 const visit = (node: ts.Node): void => { if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isImportEqualsDeclaration(node) || (ts.isCallExpression(node) && ((node.expression.kind === ts.SyntaxKind.ImportKeyword) || (ts.isIdentifier(node.expression) && node.expression.text === "require")))) { const p = scan.getLineAndCharacterOfPosition(node.getStart(scan)); diagnostics.push({ code: 9002, category: "error", message: "Imports, exports, and require are not allowed", line: p.line + 1, column: p.character + 1 }); } ts.forEachChild(node, visit); }; visit(scan);
 let hasReturn = false; const returns = (n: ts.Node): void => { if (ts.isFunctionLike(n)) return; if (ts.isReturnStatement(n)) hasReturn = true; ts.forEachChild(n, returns); }; ts.forEachChild(scan, returns);
 if (!hasReturn) diagnostics.push({ code: 9003, category: "error", message: "Program must return a value", line: Math.max(1, body.split("\n").length), column: 1 });
 const fileName = "/program.ts", dtsName = "/fabric-lite.d.ts", source = prefix + body + suffix, options: ts.CompilerOptions = { strict: true, noImplicitAny: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, useUnknownInCatchVariables: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, noEmit: true, skipLibCheck: true, lib: ["lib.es2022.d.ts"] };
 const host = ts.createCompilerHost(options); const originalGet = host.getSourceFile.bind(host); host.getSourceFile = (name, lang, onError, fresh) => name === fileName ? ts.createSourceFile(name, source, lang, true) : name === dtsName ? ts.createSourceFile(name, declarations(), lang, true) : originalGet(name, lang, onError, fresh); host.fileExists = (name) => name === fileName || name === dtsName || ts.sys.fileExists(name); host.readFile = (name) => name === fileName ? source : name === dtsName ? declarations() : ts.sys.readFile(name);
 const program = ts.createProgram([fileName, dtsName], options, host);
 for (const d of ts.getPreEmitDiagnostics(program)) { if (d.file?.fileName !== fileName) continue; const pos = d.file.getLineAndCharacterOfPosition(d.start ?? 0); const line = Math.max(1, pos.line); const sourceLine = body.split("\n")[line - 1]; diagnostics.push({ code: d.code, category: d.category === ts.DiagnosticCategory.Warning ? "warning" : "error", message: ts.flattenDiagnosticMessageText(d.messageText, "\n"), line, column: pos.character + 1, ...(sourceLine === undefined ? {} : { sourceLine }) }); }
 return { ok: !diagnostics.some(d => d.category === "error"), diagnostics };
}