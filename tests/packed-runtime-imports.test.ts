import { describe, expect, it } from 'vitest';
import { assertPackedRuntimeImports } from '../scripts/packed-runtime-imports.mjs';

const check = (text: string, dependency = false) => {
  const modules = new Map([['dist/entry.js', text], ...(dependency ? [['dist/chunks/dep.js', 'export default 1;'] as const] : [])]);
  return assertPackedRuntimeImports(modules.keys(), file => modules.get(file)!);
};

describe('packed runtime dependency syntax', () => {
  it('ignores Git rename markers, quoted import text, comments and regex bodies', () => {
    expect(() => check(`
      const from = line.slice("rename from ".length);
      if (line.startsWith("rename to ")) console.log(from);
      const quote = 'import("./missing.js")';
      const pattern = /from\\s*["'](\\.[^"']+)["']/;
      // import "./missing.js";
      /* export { x } from "./missing.js"; */
    `)).not.toThrow();
  });
  it.each([
    'import value from "./chunks/dep.js";',
    'import "./chunks/dep.js";',
    'export { default } from "./chunks/dep.js";',
    'export * from "./chunks/dep.js";',
    'async function load() { return import("./chunks/dep.js"); }',
    'const load = () => import(`./chunks/dep.js`);',
    'import /* comment */ "./chunks/dep.js";',
  ])('validates the exact target of %s', text => {
    expect(() => check(text, true)).not.toThrow();
    expect(() => check(text)).toThrow('packed runtime import is missing: dist/entry.js -> dist/chunks/dep.js');
  });
  it('resolves nested parent imports without permitting missing paths outside the inventory', () => {
    expect(() => assertPackedRuntimeImports(['dist/engine/entry.js', 'dist/shared.js'], file =>
      file.endsWith('entry.js') ? 'import "../shared.js";' : '')).not.toThrow();
    expect(() => check('import "../outside.js";')).toThrow('dist/entry.js -> outside.js');
  });
  it('does not treat bare packages, computed imports or declarations as packed JS files', () => {
    expect(() => assertPackedRuntimeImports(['dist/entry.js', 'dist/index.d.ts'], file => {
      expect(file).toBe('dist/entry.js');
      return 'import fs from "node:fs"; import ts from "typescript"; import(selectedModule);';
    })).not.toThrow();
  });
});
