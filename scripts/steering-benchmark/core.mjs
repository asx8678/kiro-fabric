import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

/** @param {unknown} value @returns {Record<string, unknown>} */
export function object(value) { assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), 'expected object'); return /** @type {Record<string, unknown>} */ (value); }
/** @param {string | Buffer} value */
export function sha(value) { return createHash('sha256').update(value).digest('hex'); }
/** @param {unknown} value @returns {string} */
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') { const o = object(value); return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}'; }
  const text = JSON.stringify(value); assert.notEqual(text, undefined, 'non-JSON value'); return text;
}
/** @param {unknown} value */
export function digest(value) { return sha(canonical(value)); }
/** @param {string} file @returns {unknown} */
export function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
/** @param {string} file @param {unknown} value @param {boolean} [exclusive] */
export function save(file, value, exclusive = true) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: exclusive ? 'wx' : 'w' }); }
/** @param {string} root @param {string} name */
function inside(root, name) {
  assert.ok(name && !path.isAbsolute(name) && !name.split(/[\\/]/).some(x => x === '..' || x === ''), 'unsafe relative path');
  return path.join(root, name);
}
/** @param {string} root @param {Record<string,string>} files */
export function putFiles(root, files) {
  for (const [name, text] of Object.entries(files)) { const file = inside(root, name); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, text, { mode: 0o600, flag: 'wx' }); }
}
/** Inventory includes directories, modes, links, and all hidden files; never follows links.
 * @typedef {{kind:'file'|'directory'|'symlink'|'special', mode:number, hash?:string, bytes?:number}} Entry
 * @param {string} root @param {{maxFiles?:number,maxBytes?:number}} [limits] @returns {Record<string,Entry>}
 */
export function inventory(root, limits = {}) {
  /** @type {Record<string,Entry>} */ const entries = {};
  let count = 0, bytes = 0;
  /** @param {string} rel */
  function visit(rel) {
    const file = rel ? inside(root, rel) : root, st = fs.lstatSync(file);
    assert.ok(++count <= (limits.maxFiles ?? 10000), 'inventory entry limit');
    const mode = st.mode & 0o777;
    if (st.isSymbolicLink()) entries[rel] = { kind: 'symlink', mode, hash: sha(fs.readlinkSync(file)) };
    else if (st.isDirectory()) { entries[rel] = { kind: 'directory', mode }; for (const name of fs.readdirSync(file).sort()) visit(rel ? rel + '/' + name : name); }
    else if (st.isFile()) { bytes += st.size; assert.ok(bytes <= (limits.maxBytes ?? 32 * 1024 * 1024), 'inventory byte limit'); entries[rel] = { kind: 'file', mode, hash: sha(fs.readFileSync(file)), bytes: st.size }; }
    else entries[rel] = { kind: 'special', mode };
  }
  visit(''); return entries;
}
/** @param {string} file */
export function regularText(file) { const st = fs.lstatSync(file); assert.ok(st.isFile() && !st.isSymbolicLink() && st.size <= 1024 * 1024, 'expected bounded regular file'); return fs.readFileSync(file, 'utf8'); }
/** @param {Record<string,Entry>} before @param {Record<string,Entry>} after @param {string[]} allowed */
export function checkScope(before, after, allowed) {
  for (const [name, entry] of Object.entries(before)) {
    if (!allowed.includes(name)) assert.deepEqual(after[name], entry, 'scope: ' + name);
    else { assert.equal(after[name]?.kind, 'file', 'scope: missing or non-file ' + name); assert.equal(after[name]?.mode, entry.mode, 'scope: changed mode ' + name); }
  }
  for (const [name, entry] of Object.entries(after)) {
    assert.ok(name in before || allowed.includes(name), 'scope: unexpected ' + name);
    if (!(name in before)) assert.ok(entry.kind === 'file' && entry.mode === 0o600, 'scope: unsafe new file ' + name);
  }
}
/** @param {unknown} error */
export function errorText(error) { return error instanceof Error ? error.message : String(error); }
export const limitations = [
  'Benign disposable-workspace benchmark, not OS containment: agents can tamper with audit files, traces, or controller-accessible files. No network-prevention claim.',
  'No trust-all-tools, adversarial injections, Git/GitHub execution, installed-profile changes, or automatic retries. Existing tool approval policy applies; denial is recorded as failure.',
  'ACP outer calls and fixture command records are counted; unobserved inner effects, escaped processes, transient/outside-workspace writes, routed Auto model, caches and settled billing are not independently proven.',
  'Local spend admission and cancellation are not provider-enforced charge ceilings. Unknown charges remain unknown, never zero.',
  'POSIX process groups required for live collection; Windows live runs fail preflight. Two repetitions give descriptive comparisons, not causal or reliability proof.'
];
