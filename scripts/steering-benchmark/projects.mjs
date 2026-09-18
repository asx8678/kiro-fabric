import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { sha, putFiles, inventory, checkScope } from './core.mjs';
import { collect } from './stream.mjs';

export const BUG_CASES = ['bug-money', 'bug-page', 'bug-config', 'bug-cache', 'bug-inventory', 'bug-retry', 'bug-csv', 'bug-batch', 'bug-checkout'];
/** TinyShop has no third-party dependencies. Reference implementations and held-out checks stay in the controller.
 * @param {string} seed */
function catalog(seed) {
  const n = parseInt(sha(seed).slice(0, 6), 16) % 80 + 20;
  return {
    money: {
      contract: 'totalCents(items, discountBps=0): sum integer priceCents * quantity, apply the integer basis-point discount (0..10000), then Math.round once. Reject negative/non-safe-integer prices or quantities and invalid discounts with RangeError. Do not mutate inputs.',
      source: `export function totalCents(items, discountBps = 0) {\n  if (!Number.isInteger(discountBps) || discountBps < 0 || discountBps > 10000) throw new RangeError('discount');\n  for (const item of items) if (![item.priceCents, item.quantity].every(v => Number.isSafeInteger(v) && v >= 0)) throw new RangeError('item');\n  return Math.round(items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0) * (10000 - discountBps) / 10000);\n}\n`,
      from: 'item.priceCents * item.quantity', to: 'item.priceCents',
      public: `assert.equal(totalCents([{priceCents:${n},quantity:3}], 0), ${n * 3});`,
      hidden: `for (let p=1;p<40;p++) for (const q of [0,1,2,7]) for (const d of [0,125,2500,10000]) assert.equal(totalCents([{priceCents:p,quantity:q},{priceCents:5,quantity:2}],d), Math.round((p*q+10)*(10000-d)/10000));\nassert.equal(totalCents([],10000),0);\nfor (const v of [-1,1.5,NaN,'3',Infinity]) { assert.throws(()=>totalCents([{priceCents:v,quantity:1}]),RangeError); assert.throws(()=>totalCents([],v),RangeError); }\nconst frozen=Object.freeze([Object.freeze({priceCents:101,quantity:2})]); assert.equal(totalCents(frozen,2500),152);`,
      imports: 'totalCents',
    },
    page: {
      contract: 'paginate(items,page,size): 1-based page, positive integer page and size or RangeError; return {items,totalPages}; totalPages is ceil(length/size), empty input gives zero; pages beyond the end return an empty list. Do not mutate input.',
      source: `export function paginate(items, page, size) {\n  if (![page,size].every(v => Number.isSafeInteger(v) && v > 0)) throw new RangeError('page');\n  return {items:items.slice((page-1)*size,page*size),totalPages:Math.ceil(items.length/size)};\n}\n`,
      from: '(page-1)*size,page*size', to: 'page*size,(page+1)*size',
      public: `assert.deepEqual(paginate([${n},2,3],1,2),{items:[${n},2],totalPages:2});`,
      hidden: `for(let length=0;length<25;length++) for(const size of [1,3,8]) { const input=Object.freeze(Array.from({length},(_,i)=>i)); for(let page=1;page<12;page++) assert.deepEqual(paginate(input,page,size),{items:Array.from(input).slice((page-1)*size,page*size),totalPages:Math.ceil(length/size)}); }\nfor(const v of [0,-1,1.5,NaN,'2']) {assert.throws(()=>paginate([],v,2),RangeError);assert.throws(()=>paginate([],1,v),RangeError);}`,
      imports: 'paginate',
    },
    config: {
      contract: 'readOptions(env): {port,debug}; PORT defaults to 3000 only when undefined and otherwise must be a string of ASCII digits representing 0..65535; DEBUG defaults to false, accepts only case-insensitive true/false or 1/0 (no whitespace); reject all other values with RangeError. Port zero and debug false must be preserved.',
      source: `export function readOptions(env) {\n  const raw = env.PORT === undefined ? '3000' : env.PORT;\n  if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw) || Number(raw)>65535) throw new RangeError('PORT');\n  const debug = env.DEBUG === undefined ? 'false' : env.DEBUG;\n  if (typeof debug !== 'string' || !/^(true|false|1|0)$/i.test(debug)) throw new RangeError('DEBUG');\n  return {port:Number(raw),debug:/^(true|1)$/i.test(debug)};\n}\n`,
      from: 'port:Number(raw),debug:/^(true|1)$/i.test(debug)', to: 'port:Number(raw)||3000,debug:Boolean(debug)',
      public: `assert.deepEqual(readOptions({PORT:'0',DEBUG:'false'}),{port:0,debug:false});`,
      hidden: `assert.deepEqual(readOptions({}),{port:3000,debug:false});\nfor(const port of ['0','1','${n}','65535','0005']) for(const flag of ['true','TRUE','1','false','FALSE','0']) assert.deepEqual(readOptions({PORT:port,DEBUG:flag}),{port:Number(port),debug:['true','1'].includes(flag.toLowerCase())});\nfor(const v of ['',null,2,'-1','1.1','65536','１２',' 2']) assert.throws(()=>readOptions({PORT:v}),RangeError);\nfor(const v of ['',null,true,'yes',' false']) assert.throws(()=>readOptions({DEBUG:v}),RangeError);`,
      imports: 'readOptions',
    },
    cache: {
      contract: 'TTLCache(clock): set(key,value,ttlMs) rejects negative/non-finite TTL with RangeError; get(key) returns undefined at now >= insertion time + ttlMs, otherwise the original value including false/0. set replaces prior TTL. The clock is injected, no real timers.',
      source: `export class TTLCache {\n  constructor(clock) { this.clock=clock; this.entries=new Map(); }\n  set(key,value,ttlMs) { if(!Number.isFinite(ttlMs)||ttlMs<0) throw new RangeError('ttl'); this.entries.set(key,{value,expires:this.clock()+ttlMs}); }\n  get(key) { const entry=this.entries.get(key); if(!entry) return undefined; if(this.clock()>=entry.expires) {this.entries.delete(key);return undefined;} return entry.value; }\n}\n`,
      from: 'this.clock()>=entry.expires', to: 'this.clock()>entry.expires',
      public: `let now=${n};const cache=new TTLCache(()=>now);cache.set('a',0,10);now+=10;assert.equal(cache.get('a'),undefined);`,
      hidden: `for(const value of [0,false,'',null,7]) {let now=100;const cache=new TTLCache(()=>now);cache.set('x',value,5);assert.equal(cache.get('x'),value);now=104;assert.equal(cache.get('x'),value);now=105;assert.equal(cache.get('x'),undefined);cache.set('x',value,0);assert.equal(cache.get('x'),undefined);cache.set('x',1,2);cache.set('x',value,9);now=108;assert.equal(cache.get('x'),value);now=114;assert.equal(cache.get('x'),undefined);}\nfor(const ttl of [-1,Infinity,NaN,'2']) assert.throws(()=>new TTLCache(()=>0).set('x',1,ttl),RangeError);`,
      imports: 'TTLCache',
    },
    inventory: {
      contract: 'reserve(stock,lines): return a new stock object, never mutate inputs. Aggregate duplicate SKUs before checking availability; integer quantities >=0 only. Unknown SKUs, invalid quantities, or insufficient stock throw RangeError. Failed reservations must be atomic.',
      source: `export function reserve(stock, lines) {\n  const needed=new Map();\n  for(const {sku,quantity} of lines) { if(!Object.hasOwn(stock,sku)||!Number.isSafeInteger(quantity)||quantity<0) throw new RangeError('line'); needed.set(sku,(needed.get(sku)||0)+quantity); }\n  for(const [sku,quantity] of needed) if(quantity>stock[sku]) throw new RangeError('stock');\n  const result={...stock}; for(const [sku,quantity] of needed) result[sku]-=quantity; return result;\n}\n`,
      from: '(needed.get(sku)||0)+quantity', to: 'quantity',
      public: `assert.deepEqual(reserve({a:10},[{sku:'a',quantity:2},{sku:'a',quantity:3}]),{a:5});`,
      hidden: `for(let qty=0;qty<20;qty++){const stock=Object.freeze({a:50,b:9});const lines=Object.freeze([Object.freeze({sku:'a',quantity:qty}),Object.freeze({sku:'a',quantity:qty})]);assert.deepEqual(reserve(stock,lines),{a:50-qty*2,b:9});}\nconst stock={a:3,b:4};assert.throws(()=>reserve(stock,[{sku:'a',quantity:2},{sku:'a',quantity:2}]),RangeError);assert.deepEqual(stock,{a:3,b:4});\nfor(const line of [{sku:'missing',quantity:0},{sku:'a',quantity:-1},{sku:'a',quantity:1.1},{sku:'a',quantity:'1'}]) assert.throws(()=>reserve(stock,[line]),RangeError);`,
      imports: 'reserve',
    },
    retry: {
      contract: 'retry(operation,maxAttempts): positive safe integer maxAttempts or RangeError; await operation(attempt) with 1-based attempt numbers until the first fulfillment (including false/0). Retry rejections up to the exact maximum; throw the last original error if all fail. No calls after success and no sleeping.',
      source: `export async function retry(operation,maxAttempts) {\n  if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1) throw new RangeError('attempts');\n  let last;for(let attempt=1;attempt<=maxAttempts;attempt++) {try{return await operation(attempt);}catch(error){last=error;}} throw last;\n}\n`,
      from: 'attempt<=maxAttempts', to: 'attempt<maxAttempts',
      public: `let calls=0;assert.equal(await retry(async()=>{calls++;if(calls<3)throw Error('retry');return ${n};},3),${n});assert.equal(calls,3);`,
      hidden: `for(const value of [0,false,null,'ok']) {const calls=[];assert.equal(await retry(async n=>{calls.push(n);return value;},4),value);assert.deepEqual(calls,[1]);}\nfor(const count of [1,2,7]){const error=new Error('last');const calls=[];await assert.rejects(retry(async n=>{calls.push(n);throw error;},count),e=>e===error);assert.deepEqual(calls,Array.from({length:count},(_,i)=>i+1));}\nfor(const v of [0,-1,1.5,'2']) await assert.rejects(retry(async()=>1,v),RangeError);`,
      imports: 'retry',
    },
    csv: {
      contract: 'parseRow(text): parse ONE comma-separated record. Preserve whitespace and empty fields. Quoted fields can contain commas and escaped double quotes (""). After closing quote only comma/end is valid; reject unclosed quotes, quotes within bare fields, or CR/LF with SyntaxError. Empty text means one empty field.',
      source: `export function parseRow(text) {\n  if(/[\\r\\n]/.test(text)) throw new SyntaxError('newline');\n  const fields=[];let field='',quoted=false,closed=false;\n  for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;}else if(c===','){fields.push(field);field='';closed=false;}else if(c==='"'&&field===''&&!closed){quoted=true;}else{if(c==='"'||closed)throw new SyntaxError('quote');field+=c;}}\n  if(quoted)throw new SyntaxError('unclosed');fields.push(field);return fields;\n}\n`,
      from: "if(text[i+1]==='\"'){field+='\"';i++;}", to: "if(text[i+1]==='\"'){i++;}",
      public: `assert.deepEqual(parseRow('"snow,雪","a""b",'),['snow,雪','a"b','']);`,
      hidden: `for(const fields of [[''],['a','b'],['','x',''],[' café ','雪,ice','a"b'],['"','""','  ']]) {const encoded=fields.map(s=>'"'+s.replaceAll('"','""')+'"').join(',');assert.deepEqual(parseRow(encoded),fields);}\nassert.deepEqual(parseRow(' a,b '),[' a','b ']);assert.deepEqual(parseRow(''),['']);\nfor(const text of ['"abc','a"b','"x"z','"x" ','a\\nb','a\\rb']) assert.throws(()=>parseRow(text),SyntaxError);`,
      imports: 'parseRow',
    },
    batch: {
      contract: 'loadBatch(ids,load): invoke load once per ID in input order and resolve to values in that SAME order regardless of completion order. Reject if any load rejects, including synchronous throws; do not mutate IDs. All IDs should be launched without awaiting earlier completion.',
      source: `export async function loadBatch(ids,load) { return await Promise.all(ids.map(id=>load(id))); }\n`,
      from: 'return await Promise.all(ids.map(id=>load(id)));', to: 'const result=[];await Promise.all(ids.map(async id=>{result.push(await load(id));}));return result;',
      public: `const waits=new Map();const promise=loadBatch(['a','b'],id=>new Promise(resolve=>waits.set(id,resolve)));waits.get('b')('B');waits.get('a')('A');assert.deepEqual(await promise,['A','B']);`,
      hidden: `for(const count of [0,1,${n % 5 + 4}]){const ids=Object.freeze(Array.from({length:count},(_,i)=>i));const callbacks=[];const p=loadBatch(ids,id=>new Promise(resolve=>callbacks.push([id,resolve])));assert.equal(callbacks.length,count);for(const [id,resolve] of callbacks.reverse())resolve(id*2);assert.deepEqual(await p,ids.map(id=>id*2));}\nconst error=new Error('load');await assert.rejects(loadBatch([1],()=>{throw error;}),e=>e===error);await assert.rejects(loadBatch([1],async()=>{throw error;}),e=>e===error);`,
      imports: 'loadBatch',
    },
  };
}
/** @param {string} id @param {string} seed @param {boolean} [hidden] */
export function projectChecks(id, seed, hidden = false) {
  const modules = catalog(seed), selected = id === 'bug-checkout' ? Object.keys(modules) : [id.slice(4)];
  let text = "import assert from 'node:assert/strict';\n";
  for (const key of selected) {
    const item = modules[key]; assert.ok(item, 'unknown project');
    text += `import { ${item.imports} } from '../src/${key}.mjs';\n`;
    text += `{\n${hidden ? item.hidden : item.public}\n}\n`;
  }
  return text + `console.log(${JSON.stringify(JSON.stringify({ ok: true, modules: selected.length, boundary: hidden ? 'held-out' : 'public' }))});\n`;
}
/** @param {string} id @param {string} seed @returns {import('./cases.mjs').Case} */
export function makeBugCase(id, seed) {
  assert.ok(BUG_CASES.includes(id), 'unknown bug case');
  const modules = catalog(seed), selected = id === 'bug-checkout' ? Object.keys(modules) : [id.slice(4)];
  /** @type {Record<string,string>} */ const files = {};
  /** @type {Record<string,string>} */ const solution = {};
  for (const [key, item] of Object.entries(modules)) {
    const name = `src/${key}.mjs`;
    assert.equal(item.source.split(item.from).length, 2, 'unique mutation');
    files[name] = selected.includes(key) ? item.source.replace(item.from, item.to) : item.source;
    if (selected.includes(key)) solution[name] = item.source;
  }
  files['package.json'] = JSON.stringify({ name: 'tinyshop-bug-lab', private: true, type: 'module', scripts: { test: 'node tests/public.mjs' } }, null, 2) + '\n';
  files['tests/checks.mjs'] = projectChecks(id, seed);
  files['execution-audit.jsonl'] = '';
  files['tests/public.mjs'] = `import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sources=${JSON.stringify(Object.keys(files).filter(p => p.startsWith('src/')))};
const fixtures=${JSON.stringify([...Object.keys(files).filter(p => p.startsWith('src/') && !Object.hasOwn(solution, p)), 'package.json', 'README.md', 'tests/checks.mjs', 'tests/public.mjs'])};
const hashes=names=>Object.fromEntries(names.map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')]));
const audit=path.join(root,'execution-audit.jsonl'),pre=hashes(sources),fixtureHashes=hashes(fixtures);
let exit=0;
try { await import('./checks.mjs'); } catch(error) { console.error(error);exit=1; }
const text=fs.readFileSync(audit,'utf8');
fs.appendFileSync(audit,JSON.stringify({seq:text.trim()?text.trimEnd().split('\\n').length:0,kind:${JSON.stringify(id)},pre,post:hashes(sources),fixtures:fixtureHashes,exit})+'\\n');
process.exitCode=exit;
`;
  files['README.md'] = '# TinyShop bug lab\n\nDependency-free Node >=24 project. Run `node tests/public.mjs`.\nPublic tests are examples, not the complete contract.\n\n' + Object.entries(modules).map(([key, item]) => `## src/${key}.mjs\n${item.contract}\n`).join('\n');
  const allowed = [...Object.keys(solution), 'execution-audit.jsonl'];
  return { id, seed, files, allowed, sources: Object.keys(files).filter(p => p.startsWith('src/')), solution, expected: { status: 'fixed' }, noTools: false, json: true, qualification: false,
    prompt: `Work only inside this disposable workspace. No network, installing dependencies, persistent memory, or delegation. Fix the TinyShop bug(s) in ${Object.keys(solution).join(', ')} to satisfy README.md. Reproduce with node tests/public.mjs, fix the source, then run that command again, exactly twice total. Tests append execution-audit.jsonl; never edit that audit manually. Only edit the listed source files; preserve tests, package.json and all other files. Public examples are incomplete: handle the documented edge cases. Return only raw JSON {"status":"fixed"} when verified, otherwise {"status":"blocked"}. No commentary or fences.`,
  };
}
/** Execute candidate code only in a fresh private copy, with controller-owned held-out tests.
 * This is for benign coding trials, not an OS sandbox for hostile code.
 * @param {import('./cases.mjs').Case} spec @param {Record<string,string>} sources */
export async function probeProject(spec, sources) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tinyshop-oracle-'));
  try {
    putFiles(root, { ...spec.files, ...sources, 'tests/held-out.mjs': projectChecks(spec.id, spec.seed, true) });
    const before = inventory(root);
    const results = [];
    for (const name of ['public', 'held-out']) {
      const result = await collect({ executable: process.execPath, args: [`tests/${name}.mjs`], cwd: root, env: { PATH: '/usr/bin:/bin', HOME: root, TMPDIR: root }, maxOutputBytes: 65536, timeoutMs: 10000 });
      assert.ok(!result.stopReason && !result.spawnError && result.code === 0, `${name} project contract: ${result.stderr.slice(-2000)}`);
      checkScope(before, inventory(root), ['execution-audit.jsonl']);
      results.push({ boundary: name, exit: result.code, wallMs: result.wallMs });
    }
    return { ok: true, results };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
