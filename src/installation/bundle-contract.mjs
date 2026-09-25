import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { captureDirectoryAncestry, readDirectoryBounded } from './filesystem-boundary.mjs';
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
const isHash = v => typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
/** @param {any} v */
export const isStable = v => typeof v==='string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v) && v.split('.').every(n=>Number.isSafeInteger(Number(n)));
/** @param {any} p @returns {string} */
export function safePath(p) {
  if (typeof p !== 'string' || Buffer.byteLength(p)>240 || p !== p.normalize('NFC') || /[\\:\x00-\x1f\x7f]/.test(p) || p.split('/').some(s=>!s || s==='.' || s==='..' || /[. ]$/.test(s))) throw Error('Unsafe bundle path');
  return p;
}
/** @param {string} p */
function roleFor(p) {
  safePath(p);
  if(p==='tools/node'||p==='tools/rg'||p==='tools/ast-grep') return 'executable';
  if(p==='manager/install-manager.mjs') return 'manager';
  if(p.startsWith('app/browser/')) throw Error('Obsolete browser bundle resources are not supported');
  if(p.startsWith('app/')) return 'app';
  if(p==='resources/steering/fabric.md'||p==='resources/skills/fabric-exec/SKILL.md'||p.startsWith('resources/skills/fabric-exec/references/')) return 'resource';
  if(p.startsWith('notices/')) return 'notice';
  throw Error('Unknown bundle entry: '+p);
}
/** @internal Schema-1 app closure. Test-local mirrors drift; fixtures build against the live list.
 * Called in production by checkManifest/createManifestFor/validateBundleFor (schema 1).
 * No public accessor exists for the exact admitted path set, and duplicating it risks
 * mask drift between fixture bytes and the admission contract. Not a root/package export. */
export const REQUIRED_APP = ['app/kiro/mcp-entry.js','app/runtime/compiler-worker-entry.js','app/runtime/sandbox-worker-entry.js','app/package.json','app/closure-manifest.json'];
// Older owned generations predate the sandbox worker. This historical contract
// is for retained-installation verification only, never new bundle admission.
/** @internal Schema-2 historical app closure. Test fixtures must materialize the
 * exact legacy-native member set; validateInstalledBundle's member list is otherwise
 * inaccessible and a hand mirror would silently diverge. Used in production by
 * checkManifestFor for schema 2. Not a root/package export. */
export const FOVEA_REQUIRED_APP = [...REQUIRED_APP, 'app/fovea/engine-entry.js', 'app/kiro/fovea-hook.js', 'app/fovea/component.json', 'app/fovea/upstream.json', 'app/fovea/UPSTREAM-LICENSE.txt', 'app/fovea/ast-grep-LICENSE.txt', 'tools/ast-grep', 'resources/skills/fabric-exec/references/fovea.md'];
const DARWIN_SOURCE_APP = ['app/fovea/source-platform.node', 'app/fovea/source-platform.json'];
const HISTORICAL_REQUIRED_APP = REQUIRED_APP.filter(p => p !== 'app/runtime/sandbox-worker-entry.js');
// Obsolete browser schema 3 is rejected for both new and historical bundles.
// Preserve those generations and their data for explicit operator recovery;
// never downgrade their manifests or admit their resources unchecked.
/** Stable upstream platform contract; never derived from running node --version.
 * Evidence: https://github.com/nodejs/node/blob/v24.20.0/BUILDING.md
 * Schema 2 additionally binds the measured linux-x64 parser ELF GLIBC_2.34 floor.
 * @param {string} target @param {number} [schema] */
export function compatibilityFor(target,schema=1){
 if(!TARGETS.includes(target)||![1,2].includes(schema))throw Error('Unsupported target/schema');
 const linux=target.startsWith('linux-');
 return {minNode:'24.20.0',minKiro:'2.21.1',minGlibc:linux?(schema>=2&&target==='linux-x64'?'2.34':'2.28'):null,minKernel:linux?'4.18':null,minMacOS:linux?null:'13.5',libc:linux?'glibc':'system'};
}
/** Release metadata may describe either reviewed generation version. Bundle
 * admission always passes its explicit schema.
 * @param {any} value @param {string} target @param {number} [schema] */
export function checkCompatibility(value,target,schema){
 exactFields(value,['minNode','minKiro','minGlibc','minKernel','minMacOS','libc']);
 if(!(schema===undefined?[1,2]:[schema]).some(version=>canonical(value)===canonical(compatibilityFor(target,version))))throw Error('Compatibility mismatch');
}
/** @param {any} p */
function checkProvenance(p){
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
 * @param {any} tools @param {any[] | undefined} [inventory] @param {string} [target] @param {number} [schema] */
export function checkToolPins(tools,inventory,target,schema=tools&&Object.hasOwn(tools,'ast-grep')?2:1){
 if(![1,2].includes(schema))throw Error('Unsupported tool schema');
 exactFields(tools,schema>=2?['node','rg','ast-grep']:['node','rg']);
 if(schema>=2)checkParserPin(tools['ast-grep'],inventory,target);
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
/** Closed npm platform archive/member contract. Whole SHA-512 is the pinned
 * reference lock identity; SHA-256 and member hashes bind the captured artifact.
 * @param {any} pin @param {any[] | undefined} inventory @param {string} [target] */
function checkParserPin(pin,inventory,target){
 exactFields(pin,['version','url','size','sha256','integrity','members']);
 if(pin.version!=='0.45.3'||!isHash(pin.sha256)||!/^sha512-[A-Za-z0-9+/]{86}==$/.test(pin.integrity)||!Number.isSafeInteger(pin.size)||pin.size<1||pin.size>32*1024*1024)throw Error('Invalid parser pin');
 pinURL(pin.url,['registry.npmjs.org']);
 const targets=target===undefined?TARGETS:[target];
 if(!targets.some(t=>TARGETS.includes(t)&&pin.url==='https://registry.npmjs.org/@ast-grep/cli-'+t+(t.startsWith('linux')?'-gnu':'')+'/-/cli-'+t+(t.startsWith('linux')?'-gnu':'')+'-0.45.3.tgz'))throw Error('Parser target URL mismatch');
 const required=[['package/ast-grep','tools/ast-grep'],['package/package.json','notices/ast-grep-package.json'],['package/README.md','notices/ast-grep-README.md']];
 if(!Array.isArray(pin.members)||pin.members.length!==required.length)throw Error('Parser members');
 for(const [member,destination] of required){
  const m=pin.members.find((/** @type {any} */ m)=>m.path===destination);
  exactFields(m,['member','path','size','sha256']);
  if(m.member!==member||!Number.isSafeInteger(m.size)||m.size<1||m.size>64*1024*1024||!isHash(m.sha256))throw Error('Invalid parser member');
  if(inventory){const e=inventory.find(e=>e.path===destination);if(!e||e.size!==m.size||e.sha256!==m.sha256)throw Error('Parser inventory mismatch: '+destination);}
 }
}
/** @param {any} inventory @param {string[]} requiredApp */
function checkInventoryFor(inventory, requiredApp) {
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
 for(const p of [...requiredApp,'tools/node','tools/rg','manager/install-manager.mjs','resources/steering/fabric.md','resources/skills/fabric-exec/SKILL.md','notices/node-LICENSE','notices/rg-LICENSE-MIT','notices/rg-COPYING','notices/rg-UNLICENSE'])if(!inventory.some(e=>e.path===p&&e.size>0))throw Error('Missing required entry: '+p);
 if(!inventory.some(e=>e.path.startsWith('resources/skills/fabric-exec/references/')))throw Error('Missing resource closure');
 return bytes;
}
/** @param {any} payload */
/** @internal Production digest seam used by checkManifestFor and createManifestFor.
 * Historical-manifest tests must reconstruct pre-sandbox-worker bytes with the same
 * domain separator; public createBundleManifest always injects the current closure.
 * Not a root/package export. @param {any} payload */
export function manifestDigest(payload){return sha256('kiro-fabric.bundle.v1\0'+canonical(payload));}
/** @param {any} m */
export function checkManifest(m){ return checkManifestFor(m, REQUIRED_APP); }
/** Historical shape check only; caller must bind the manifest to owned installation evidence.
 * @param {any} m */
export function checkInstalledManifest(m){ return checkManifestFor(m, HISTORICAL_REQUIRED_APP, true); }
/** @param {any} m @param {string[]} requiredApp @param {boolean} [historical] */
function checkManifestFor(m, requiredApp, historical=false){
 exactFields(m,['compatibility','digest','inventory','product','provenance','schema','target','tools','version']);
 if(m.schema===3)throw Error('Obsolete browser bundle schema 3 is not supported; preserve the generation and data for recovery');
 if(![1,2].includes(m.schema)||m.product!==PRODUCT||!TARGETS.includes(m.target)||!isStable(m.version))throw Error('Manifest identity');
 checkCompatibility(m.compatibility,m.target,m.schema);checkProvenance(m.provenance);
 // A retained pre-native schema-2 generation may lack both assets, but any
 // declared native pair remains mandatory. Callers must bind historical bytes
 // to the recorded owner hash; this flag is never exposed to new admission.
 const nativeRequired=m.target.startsWith('darwin-')&&(!historical||(Array.isArray(m.inventory)&&m.inventory.some(e=>DARWIN_SOURCE_APP.includes(e?.path))));
 const required=m.schema===2?[...FOVEA_REQUIRED_APP,...(nativeRequired?DARWIN_SOURCE_APP:[])]:requiredApp;
 const bytes=checkInventoryFor(m.inventory,required);checkToolPins(m.tools,m.inventory,m.target,m.schema);
 if(m.schema===1&&m.inventory.some((/** @type {any} */ e)=>e.path==='tools/ast-grep'))throw Error('Parser requires schema 2');
 const {digest,...payload}=m;if(!isHash(digest)||digest!==manifestDigest(payload))throw Error('Manifest digest mismatch');return bytes;
}
/** @param {import('node:fs').Stats} s */
function owned(s){if(typeof process.getuid!=='function'||s.uid!==process.getuid())throw Error('File ownership mismatch');}
/** @typedef {{mode?:number}} CaptureOptions */
/** @param {import('node:fs').Stats} a @param {import('node:fs').Stats} b */
const sameFile=(a,b)=>b.isFile()&&b.nlink===1&&a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mode===b.mode&&a.uid===b.uid&&a.gid===b.gid&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
/** Capture through an owned, nonblocking no-follow descriptor. consume must read
 * through EOF (including an extra-byte growth probe), returning the observed length.
 * Only the resolved result is verified; callback effects must remain private until
 * success. This does not promise the caller's pathname remains unchanged later.
 * @template T
 * @param {string} file @param {number} max
 * @param {(handle: import('node:fs/promises').FileHandle, size: number) => Promise<{value:T,length:number}>} consume
 * @param {CaptureOptions} [options] */
export async function captureRegular(file,max,consume,{mode}={}){
 if(!Number.isSafeInteger(max)||max<0||mode!==undefined&&(!Number.isInteger(mode)||mode<0||mode>4095))throw Error('Invalid capture bound/mode');
 const before=await lstat(file);owned(before);
 if(!before.isFile()||before.nlink!==1||before.size>max)throw Error('Unsafe or oversized file: '+file);
 if(mode!==undefined&&(before.mode&4095)!==mode)throw Error('File mode/type');
 const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const s=await handle.stat();owned(s);
  if(!sameFile(before,s)||s.size>max||mode!==undefined&&(s.mode&4095)!==mode)throw Error('File changed');
  const {value,length}=await consume(handle,s.size);
  const after=await handle.stat(),named=await lstat(file);
  if(length!==s.size||!sameFile(s,after)||!sameFile(s,named))throw Error('File changed');
  return value;
 }finally{await handle.close();}
}
/** Read bounded metadata bytes; large inventory members use streaming hashes.
 * @param {string} file @param {number} max @param {CaptureOptions} [options] */
export async function readRegular(file,max,options={}){
 return captureRegular(file,max,async(handle,size)=>{
  const buffer=Buffer.alloc(size+1);let length=0;
  while(length<buffer.length){const r=await handle.read(buffer,length,buffer.length-length,null);if(!r.bytesRead)break;length+=r.bytesRead;}
  return {value:buffer.subarray(0,length),length};
 },options);
}
/** Hash through <=64KiB buffers with the same descriptor-bound checks.
 * @param {string} file @param {number} max @param {CaptureOptions} [options] */
export async function hashRegular(file,max,options={}){
 return captureRegular(file,max,async(handle,size)=>{
  const buffer=Buffer.alloc(Math.min(size+1,64*1024)),hash=createHash('sha256');let length=0;
  while(length<=size){
   const r=await handle.read(buffer,0,Math.min(buffer.length,size+1-length),null);
   if(!r.bytesRead)break;
   length+=r.bytesRead;hash.update(buffer.subarray(0,r.bytesRead));
  }
  return {value:{size:length,sha256:hash.digest('hex')},length};
 },options);
}
/** Bundle roots are private; trusted/sticky ancestors are not bundle contents.
 * @param {string} root */
async function checkRoot(root){
 const guard=captureDirectoryAncestry(root,{label:'Unsafe root component'});
 const s=await lstat(guard.root);owned(s);if((s.mode&4095)!==448)throw Error('Unsafe bundle root mode');
 guard.check();return guard;
}
/** Iterative bounded enumeration: no whole attacker-controlled readdir array.
 * @param {string} root */
async function scan(root){
 /** @type {any[]} */const inventory=[];const aliases=new Set(),directories=[];let count=0,total=0;
 const pending=[''];
 while(pending.length){
  const rel=/** @type {string} */(pending.pop()),directory=path.join(root,rel),guard=captureDirectoryAncestry(directory,{label:'Directory changed'});
  const names=await readDirectoryBounded(directory,LIMITS.entries*2-count);count+=names.length;guard.check();
  for(const name of names.sort(byteOrder)){
   const p=rel?rel+'/'+name:name;safePath(p);
   const key=p.toLowerCase();if(aliases.has(key))throw Error('Case collision');aliases.add(key);
   const s=await lstat(path.join(root,p));owned(s);
   if(s.isDirectory()){if((s.mode&4095)!==448)throw Error('Directory mode');pending.push(p);directories.push(p);}
   else{
    const role=p==='bundle-manifest.json'?'manifest':roleFor(p),mode=role==='executable'?448:384;
    if(!s.isFile()||s.nlink!==1||(s.mode&4095)!==mode)throw Error('File mode/type');
    if(p==='bundle-manifest.json'){await hashRegular(path.join(root,p),LIMITS.manifest,{mode});continue;}
    const digest=await hashRegular(path.join(root,p),Math.min(LIMITS.file,LIMITS.bytes-total),{mode});
    total+=digest.size;if(total>LIMITS.bytes)throw Error('Bundle byte bound');
    inventory.push({path:p,role,type:'file',mode,...digest});
   }
   guard.check();
  }
  guard.check();
 }
 for(const p of directories)if(!inventory.some(e=>e.path.startsWith(p+'/')))throw Error('Empty/unknown directory');
 return inventory.sort((a,b)=>byteOrder(a.path,b.path));
}
/** @param {string} root @param {{version:string,target:string,compatibility:any,provenance:any,tools:any,schema?:number}} options */
export async function createBundleManifest(root,options){ return createManifestFor(root,options,REQUIRED_APP); }
/** @param {string} root @param {{version:string,target:string,compatibility:any,provenance:any,tools:any,schema?:number}} options @param {string[]} requiredApp @param {boolean} [historical] */
async function createManifestFor(root,{version,target,compatibility,provenance,tools,schema},requiredApp,historical=false){
 const guard=await checkRoot(root);root=guard.root;
 // New callers may omit schema for the legacy tool-key default. A supplied
 // schema is authoritative; validation reconstructs that exact generation.
 const resolvedSchema=schema??(Object.hasOwn(tools,'ast-grep')?2:1);
 const payload={schema:resolvedSchema,product:PRODUCT,version,target,compatibility,provenance,tools,inventory:await scan(root)};
 guard.check();const manifest={...payload,digest:manifestDigest(payload)};checkManifestFor(manifest,requiredApp,historical);
 await checkNativeSourceFiles(root,manifest,historical);guard.check();return manifest;
}
/** Inspect native bytes without executing them, independent of the validator host.
 * Inventory hashes alone cannot detect rehashed omission or metadata lies.
 * @param {string} root @param {any} manifest @param {boolean} [historical] */
async function checkNativeSourceFiles(root, manifest, historical=false) {
 const present = DARWIN_SOURCE_APP.some(name => manifest.inventory.some(e => e.path === name));
 if (!present && (historical || !(manifest.schema >= 2 && manifest.target.startsWith('darwin-')))) return;
 if (manifest.schema !== 2 || !manifest.target.startsWith('darwin-')) throw Error('Native source target mismatch');
 const capture = async (name, limit) => {
  const entry = manifest.inventory.find(e => e.path === name);
  if (!entry) throw Error('Native source artifact missing: ' + name);
  const bytes = await readRegular(path.join(root, name), limit, { mode: 384 });
  if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) throw Error('Native source inventory mismatch');
  return bytes;
 };
 const bytes = await capture(DARWIN_SOURCE_APP[0], 2 * 1024 * 1024);
 const metadata = JSON.parse((await capture(DARWIN_SOURCE_APP[1], 4096)).toString());
 const closure = JSON.parse((await capture('app/closure-manifest.json', LIMITS.manifest)).toString());
 const sources = closure.buildInputs?.files?.filter(e => e.path === 'src/fovea/source-platform-native.c');
 exactFields(metadata, ['schemaVersion', 'abiVersion', 'platform', 'arch', 'minimumMacOS', 'sourceSha256', 'sha256']);
 if (metadata.schemaVersion !== 1 || metadata.abiVersion !== 1 || metadata.platform !== 'darwin' ||
     `darwin-${metadata.arch}` !== manifest.target || metadata.minimumMacOS !== '13.5' ||
     sources?.length !== 1 || !isHash(sources[0].sha256) || metadata.sourceSha256 !== sources[0].sha256 ||
     metadata.sha256 !== sha256(bytes)) throw Error('Native source artifact identity mismatch');
 const cpu = metadata.arch === 'arm64' ? 0x0100000c : 0x01000007;
 if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== cpu ||
     bytes.readUInt32LE(12) !== 8) throw Error('Native source Mach-O architecture/type mismatch');
}
/** Strict admission for all new builds, archives and candidates. @param {string} root */
export async function validateBundle(root){ return validateBundleFor(root,REQUIRED_APP); }
/** Verify historical owned bytes, not eligibility for new installation or rollback.
 * Caller must verify the owner-recorded manifest hash and generation digest.
 * Every declared file (including a declared sandbox worker) is still required.
 * @param {string} root */
export async function validateInstalledBundle(root){ return validateBundleFor(root,HISTORICAL_REQUIRED_APP,true); }
/** @param {string} root @param {string[]} requiredApp @param {boolean} [historical] */
async function validateBundleFor(root,requiredApp,historical=false){
 const guard=await checkRoot(root);root=guard.root;
 const raw=await readRegular(path.join(root,'bundle-manifest.json'),LIMITS.manifest,{mode:384}),manifest=JSON.parse(raw.toString('utf8'));
 if(!raw.equals(Buffer.from(canonical(manifest)+'\n')))throw Error('Noncanonical manifest bytes');
 const bytes=checkManifestFor(manifest,requiredApp,historical),actual=await createManifestFor(root,manifest,requiredApp,historical);
 if(canonical(actual)!==canonical(manifest))throw Error('Bundle inventory mismatch');
 guard.check();return {root,digest:manifest.digest,manifest,version:manifest.version,inventory:manifest.inventory,bytes};
}
