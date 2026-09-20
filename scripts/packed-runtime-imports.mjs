import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/** Validate literal relative ESM dependencies against the exact packed inventory.
 * Parse syntax, not strings/comments such as Git's "rename from " markers.
 * Computed imports and bare packages are outside this inventory check.
 * @param {Iterable<string>} files
 * @param {(file: string) => string} read
 */
export function assertPackedRuntimeImports(files, read = file => fs.readFileSync(file, "utf8")) {
  const included = new Set(files);
  for (const file of included) {
    if (!file.endsWith(".js")) continue;
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    /** @param {import('typescript').Node} node */
    const visit = node => {
      const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined;
      if (specifier && (ts.isStringLiteral(specifier) || ts.isNoSubstitutionTemplateLiteral(specifier)) && specifier.text.startsWith(".")) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier.text));
        if (!included.has(target)) throw new Error(`packed runtime import is missing: ${file} -> ${target}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}
