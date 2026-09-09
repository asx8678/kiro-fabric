import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, readdir, realpath, open } from 'node:fs/promises';
import path from 'node:path';
export const PRODUCT = 'kiro-fabric';
export const TARGETS = ['darwin-arm64','darwin-x64','linux-arm64','linux-x64'];
// Provisional ceilings, not native qualification evidence.
export const LIMITS = Object.freeze({entries:4096,file:160*1024*1024,bytes:384*1024*1024,archive:192*1024*1024,manifest:2*1024*1024});
/** @param {string | NodeJS.ArrayBufferView} bytes */
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
/** @param {string} a @param {string} b */
export const byteOrder = (a,b) => Buffer.compare(Buffer.from(a),Buffer.from(b));
/** @param {any} value @returns {string} */
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && Object.getPrototypeOf(value) === Object.prototype) return '{'+Object.keys(value).sort(byteOrder).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  throw Error('Noncanonical metadata');
}
/** Exact plain-object fields, including nested schemas. @param {any} value @param {string[]} keys */
export function exactFields(value,keys){
 if(!value || Object.getPrototypeOf(value)!==Object.prototype || canonical(Object.keys(value).sort())!==canonical([...keys].sort())) throw Error('Invalid schema fields: '+keys.join(','));
}
/** @param {any} v */
export const isHash = v => typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
/** @param {any} v */
export const isStable = v => typeof v==='string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v) && v.split('.').every(n=>Number.isSafeInteger(Number(n)));
/** @param {any} p @returns {string} */
export function safePath(p) {
  if (typeof p !== 'string' || Buffer.byteLength(p)>240 || p !== p.normalize('NFC') || /[\\:\x00-\x1f\x7f]/.test(p) || p.split('/').some(s=>!s || s==='.' || s==='..' || /[. ]$/.test(s))) throw Error('Unsafe bundle path');
  return p;
}
/** @param {string} p */
export function roleFor(p) {
  safePath(p);
  if(p==='tools/node'||p==='tools/rg') return 'executable';
  if(p==='manager/install-manager.mjs') return 'manager';
  if(p.startsWith('app/')) return 'app';
  if(p==='resources/steering/fabric.md'||p==='resources/skills/fabric-exec/SKILL.md'||p.startsWith('resources/skills/fabric-exec/references/')) return 'resource';
  if(p.startsWith('notices/')) return 'notice';
  throw Error('Unknown bundle entry: '+p);
}
export const REQUIRED_APP = ['app/kiro/mcp-entry.js','app/runtime/compiler-worker-entry.js','app/package.json','app/closure-manifest.json'];
/** Stable upstream platform contract; never derived from running node --version.
 * Evidence: https://github.com/nodejs/node/blob/v24.20.0/BUILDING.md
 * @param {string} target */
export function compatibilityFor(target){
 if(!TARGETS.includes(target))throw Error('Unsupported target');
 const linux=target.startsWith('linux-');
 return {minNode:'24.20.0',minKiro:'2.21.1',minGlibc:linux?'2.28':null,minKernel:linux?'4.18':null,minMacOS:linux?null:'13.5',libc:linux?'glibc':'system'};
}
/** @param {any} value @param {string} target */
export function checkCompatibility(value,target){
 exactFields(value,['minNode','minKiro','minGlibc','minKernel','minMacOS','libc']);
 if(canonical(value)!==canonical(compatibilityFor(target)))throw Error('Compatibility mismatch');
}
/** @param {any} p */
export function checkProvenance(p){
 if(p?.kind==='local-source'){
  exactFields(p,['kind','sourceDigest','gitHead','dirty']);
  if(!isHash(p.sourceDigest)||(p.gitHead!==null && (typeof p.gitHead!=='string'|| !/^[a-f0-9]{40}$/.test(p.gitHead)))||typeof p.dirty!=='boolean')throw Error('Invalid source provenance');
 }else if(p?.kind==='release'){
  exactFields(p,['kind','sourceCommit']);
  if(typeof p.sourceCommit!=='string'||!/^[a-f0-9]{40}$/.test(p.sourceCommit))throw Error('Invalid release provenance');
 }else throw Error('Invalid provenance kind');
}
/** @param {any} url @param {string[]} hosts */
function pinURL(url,hosts){
 if(typeof url!=='string')throw Error('Invalid pin URL');
 const u=new URL(url);
 if(u.protocol!=='https:'||!hosts.includes(u.hostname)||u.port||u.username||u.password||u.hash||u.search)throw Error('Unapproved pin URL');
}
/** Validate the actual acquirePrivateTools().tools shape, optionally against inventory.
 * @param {any} tools @param {any[] | undefined} [inventory] @param {string} [target] */
export function checkToolPins(tools,inventory,target){
 exactFields(tools,['node','rg']);
 const destinations=new Set();let total=0;
 for(const tool of ['node','rg']){
  const pin=tools[tool];exactFields(pin,['version','url','size','sha256','checksumUrl','members']);
  const required=tool==='node'?['tools/node','notices/node-LICENSE']:['tools/rg','notices/rg-LICENSE-MIT','notices/rg-COPYING','notices/rg-UNLICENSE'];
  if(!Array.isArray(pin.members)||pin.members.length!==required.length)throw Error('Tool members');
  if(pin.version!==(tool==='node'?'24.20.0':'14.1.1')||!isHash(pin.sha256)||!Number.isSafeInteger(pin.size)||pin.size<1||pin.size>LIMITS.archive)throw Error('Invalid tool pin');
  const hosts=tool==='node'?['nodejs.org']:['github.com'];pinURL(pin.url,hosts);pinURL(pin.checksumUrl,hosts);
  const base=tool==='node'?'https://nodejs.org/dist/v24.20.0/':'https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/';
  if(typeof target==='string'){
   if(!TARGETS.includes(target))throw Error('Unsupported tool target');
   const triples={'darwin-arm64':'aarch64-apple-darwin','darwin-x64':'x86_64-apple-darwin','linux-arm64':'aarch64-unknown-linux-gnu','linux-x64':'x86_64-unknown-linux-musl'};
   const name=tool==='node'?'node-v24.20.0-'+target:'ripgrep-14.1.1-'+triples[/** @type {keyof typeof triples} */(target)];
   if(pin.url!==base+name+'.tar.gz')throw Error('Tool target URL mismatch');
   for(const m of pin.members||[]){
    const suffix=m.path==='tools/node'?'bin/node':m.path==='tools/rg'?'rg':typeof m.path==='string'?m.path.replace('notices/'+tool+'-',''):'';
    if(m.member!==name+'/'+suffix)throw Error('Tool target member mismatch');
   }
  }
  if(!pin.url.startsWith(base)||!pin.url.endsWith('.tar.gz')||pin.checksumUrl!==(tool==='node'?base+'SHASUMS256.txt':pin.url+'.sha256'))throw Error('Tool pin upstream mismatch');
  const members=new Set();
  for(const m of pin.members){
   exactFields(m,['member','path','size','sha256']);safePath(m.member);safePath(m.path);
   if(!/^[A-Za-z0-9._/-]+$/.test(m.member)||!required.includes(m.path)||destinations.has(m.path)||members.has(m.member)||!Number.isSafeInteger(m.size)||m.size<1||m.size>LIMITS.file||!isHash(m.sha256))throw Error('Invalid tool member');
   total+=m.size;if(total>LIMITS.bytes)throw Error('Tool closure byte bound');
   destinations.add(m.path);members.add(m.member);
   if(inventory){const e=inventory.find(e=>e.path===m.path);if(!e||e.size!==m.size||e.sha256!==m.sha256)throw Error('Tool inventory mismatch: '+m.path);}
  }
 }
}
/** @param {any} inventory */
export function checkInventory(inventory) {
 if(!Array.isArray(inventory)||inventory.length>LIMITS.entries)throw Error('Inventory bound');
 const seen=new Set();const aliases=new Map();let bytes=0;let previous='';
 for(const e of inventory){
  exactFields(e,['mode','path','role','sha256','size','type']);const role=roleFor(e.path);const key=e.path.toLowerCase();
  if(seen.has(key)||(previous&&byteOrder(previous,e.path)>=0))throw Error('Inventory collision/order');
  const segments=e.path.split('/');
  for(let i=1;i<=segments.length;i++){const part=segments.slice(0,i).join('/'),fold=part.toLowerCase();if(i<segments.length&&seen.has(fold))throw Error('Path collision');if(aliases.has(fold)&&aliases.get(fold)!==part)throw Error('Case directory collision');aliases.set(fold,part);}
  seen.add(key);previous=e.path;
  if(e.role!==role||e.type!=='file'||e.mode!==(role==='executable'?448:384)||!Number.isSafeInteger(e.size)||e.size<0||e.size>LIMITS.file||!isHash(e.sha256))throw Error('Invalid inventory entry');
  bytes+=e.size;
 }
 if(bytes>LIMITS.bytes)throw Error('Bundle byte bound');
 for(const p of [...REQUIRED_APP,'tools/node','tools/rg','manager/install-manager.mjs','resources/steering/fabric.md','resources/skills/fabric-exec/SKILL.md','notices/node-LICENSE','notices/rg-LICENSE-MIT','notices/rg-COPYING','notices/rg-UNLICENSE'])if(!inventory.some(e=>e.path===p&&e.size>0))throw Error('Missing required entry: '+p);
 if(!inventory.some(e=>e.path.startsWith('resources/skills/fabric-exec/references/')))throw Error('Missing resource closure');
 return bytes;
}
/** @param {any} payload */
export function manifestDigest(payload){return sha256('kiro-fabric.bundle.v1\0'+canonical(payload));}
/** @param {any} m */
export function checkManifest(m){
 exactFields(m,['compatibility','digest','inventory','product','provenance','schema','target','tools','version']);
 if(m.schema!==1||m.product!==PRODUCT||!TARGETS.includes(m.target)||!isStable(m.version))throw Error('Manifest identity');
 checkCompatibility(m.compatibility,m.target);checkProvenance(m.provenance);
 const bytes=checkInventory(m.inventory);checkToolPins(m.tools,m.inventory,m.target);
 const {digest,...payload}=m;if(!isHash(digest)||digest!==manifestDigest(payload))throw Error('Manifest digest mismatch');return bytes;
}
/** @param {import('node:fs').Stats} s */
function owned(s){if(typeof process.getuid!=='function'||s.uid!==process.getuid())throw Error('File ownership mismatch');}
/** Capture through an owned no-follow handle, then check both inode and name.
 * This is capture, not a promise that the caller's pathname remains unchanged.
 * @template T
 * @param {string} file @param {number} max
 * @param {(handle: import('node:fs/promises').FileHandle, size: number) => Promise<{value:T,length:number}>} consume */
async function captureRegular(file,max,consume){
 const before=await lstat(file);owned(before);
 if(!before.isFile()||before.nlink!==1||before.size>max)throw Error('Unsafe or oversized file: '+file);
 const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const s=await handle.stat();owned(s);
  if(!s.isFile()||s.nlink!==1||s.size>max||s.ino!==before.ino||s.dev!==before.dev)throw Error('File changed');
  const {value,length}=await consume(handle,s.size);
  const after=await handle.stat(),named=await lstat(file);
  if(length!==s.size||s.ino!==named.ino||s.dev!==named.dev||s.mtimeMs!==after.mtimeMs||s.ctimeMs!==after.ctimeMs||s.mode!==after.mode||s.uid!==after.uid||after.nlink!==1)throw Error('File changed');
  return value;
 }finally{await handle.close();}
}
/** Read bounded metadata bytes; large inventory members use streaming hashes.
 * @param {string} file @param {number} max */
export async function readRegular(file,max){
 return captureRegular(file,max,async(handle,size)=>{
  const buffer=Buffer.alloc(size+1);let length=0;
  while(length<buffer.length){const r=await handle.read(buffer,length,buffer.length-length,null);if(!r.bytesRead)break;length+=r.bytesRead;}
  return {value:buffer.subarray(0,length),length};
 });
}
/** Hash large binaries without allocating a Node-executable-sized buffer.
 * Read one extra byte to detect growth; retain the same capture trust checks.
 * @param {string} file @param {number} max */
async function hashRegular(file,max){
 return captureRegular(file,max,async(handle,size)=>{
  const buffer=Buffer.alloc(Math.min(size+1,64*1024)),hash=createHash('sha256');let length=0;
  while(length<=size){
   const r=await handle.read(buffer,0,Math.min(buffer.length,size+1-length),null);
   if(!r.bytesRead)break;
   length+=r.bytesRead;hash.update(buffer.subarray(0,r.bytesRead));
  }
  return {value:{size:length,sha256:hash.digest('hex')},length};
 });
}
/** Reject symlink components; ancestors may be shared (e.g. /tmp), bundle root may not.
 * @param {string} root */
async function checkRoot(root){
 const absolute=path.resolve(root);let current=path.parse(absolute).root;
 for(const part of absolute.slice(current.length).split('/').filter(Boolean)){current=path.join(current,part);const s=await lstat(current);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Unsafe root component');}
 const s=await lstat(absolute);owned(s);if((s.mode&4095)!==448)throw Error('Unsafe bundle root mode');
}
/** @param {string} root */
async function scan(root){
 /** @type {any[]} */ const inventory=[];const aliases=new Set();let count=0,total=0;
 /** @param {string} rel */
 async function walk(rel){
  for(const name of (await readdir(path.join(root,rel))).sort(byteOrder)){
   const p=rel?rel+'/'+name:name;safePath(p);if(++count>LIMITS.entries*2)throw Error('Tree bound');
   const key=p.toLowerCase();if(aliases.has(key))throw Error('Case collision');aliases.add(key);
   const s=await lstat(path.join(root,p));owned(s);
   if(s.isDirectory()){if((s.mode&4095)!==448)throw Error('Directory mode');await walk(p);if(!inventory.some(e=>e.path.startsWith(p+'/')))throw Error('Empty/unknown directory');}
   else{
    const role=p==='bundle-manifest.json'?'manifest':roleFor(p),mode=role==='executable'?448:384;
    if(!s.isFile()||s.nlink!==1||(s.mode&4095)!==mode)throw Error('File mode/type');
    if(p==='bundle-manifest.json')continue;
    total+=s.size;if(total>LIMITS.bytes)throw Error('Bundle byte bound');
    const digest=await hashRegular(path.join(root,p),LIMITS.file);inventory.push({path:p,role,type:'file',mode,...digest});
   }
  }
 }
 await walk('');return inventory.sort((a,b)=>byteOrder(a.path,b.path));
}
/** @param {string} root @param {{version:string,target:string,compatibility:any,provenance:any,tools:any}} options */
export async function createBundleManifest(root,{version,target,compatibility,provenance,tools}){
 await checkRoot(root);
 const payload={schema:1,product:PRODUCT,version,target,compatibility,provenance,tools,inventory:await scan(root)};
 const manifest={...payload,digest:manifestDigest(payload)};checkManifest(manifest);return manifest;
}
/** @param {string} root */
export async function validateBundle(root){
 await checkRoot(root);
 const raw=await readRegular(path.join(root,'bundle-manifest.json'),LIMITS.manifest),manifest=JSON.parse(raw.toString('utf8'));
 if(!raw.equals(Buffer.from(canonical(manifest)+'\n')))throw Error('Noncanonical manifest bytes');
 const bytes=checkManifest(manifest),actual=await createBundleManifest(root,manifest);
 if(canonical(actual)!==canonical(manifest))throw Error('Bundle inventory mismatch');
 return {root:await realpath(root),digest:manifest.digest,manifest,version:manifest.version,inventory:manifest.inventory,bytes};
}
