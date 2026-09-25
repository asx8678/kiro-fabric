import { gunzipSync, createGzip } from 'node:zlib';import { createHash, randomBytes } from 'node:crypto';
import { pinnedDirectoryIdentity, pinnedEntryIdentity, runPinnedDirectoryOperation, writePinnedDirectoryStream } from './pinned-directory-child.mjs';
import { captureDirectoryAncestry } from '../src/installation/filesystem-boundary.mjs';
import { extractPrivateEntries } from './private-extraction.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { LIMITS, safePath, canonical, checkManifest, sha256, validateBundle, readRegular, captureRegular, hashRegular, byteOrder } from './bundle-contract.mjs';
/** @typedef {{path:string,mode:number,data:Buffer}} ArchiveEntry */
const block=512;
/** @param {number} n @param {number} len */
function octal(n,len){const s=n.toString(8);if(s.length>=len)throw Error('USTAR numeric overflow');return s.padStart(len-1,'0')+'\0';}
/** @param {string} name @param {number} size @param {number} mode */
function header(name,size,mode,flavor='bundle',directory=false,modifiedAt=0){
 const b=Buffer.alloc(block);let prefix='';
 if(Buffer.byteLength(name)>100){
  // Choose the rightmost VALID byte split for both encodings. An earlier slash
  // may fit even when the last slash gives a prefix longer than 155 bytes.
  let i=name.lastIndexOf('/');
  while(i>0&&(Buffer.byteLength(name.slice(0,i))>155||Buffer.byteLength(name.slice(i+1))>100))i=name.lastIndexOf('/',i-1);
  if(i<=0)throw Error('USTAR path bound');prefix=name.slice(0,i);name=name.slice(i+1);
 }
 if(Buffer.byteLength(name)>100||Buffer.byteLength(prefix)>155)throw Error('USTAR path bound');
 b.write(name,0,100);b.write(octal(mode,8),100);b.write(octal(0,8),108);b.write(octal(0,8),116);b.write(octal(size,12),124);b.write(octal(0,12),136);b.fill(32,148,156);b[156]=48;b.write('ustar\0',257);b.write('00',263);b.write(prefix,345,155);
 if(flavor==='legacy'){b.write(octal(modifiedAt,12),136);b[156]=directory?53:48;b.write(octal(0,8),329);b.write(octal(0,8),337);}
 const sum=b.reduce((a,v)=>a+v,0);b.write(sum.toString(8).padStart(6,'0')+'\0 ',148);return b;
}/** @param {Buffer} b @param {number} start @param {number} len */
function text(b,start,len){const field=b.subarray(start,start+len);const end=field.indexOf(0);if(end>=0&&field.subarray(end).some(v=>v!==0))throw Error('USTAR string padding');const raw=end<0?field:field.subarray(0,end);const s=raw.toString('utf8');if(!Buffer.from(s).equals(raw))throw Error('Invalid UTF8');return s;}
/** @param {Buffer} b @param {number} start @param {number} len */
function number(b,start,len){const s=b.subarray(start,start+len).toString('ascii');if(!/^[0-7]+\0$/.test(s))throw Error('USTAR number');return parseInt(s,8);}
/** @internal Raw-USTAR parser seam. Production callers use parseBundleArchive/
 * extractBundleArchiveBytes, which gunzip first; hostile-header fault cases need to
 * feed mutation bytes straight to the restricted reader. Not a root/package export.
 * @param {Buffer} raw */
export function parseBundleTar(raw){return validateEntries(parseRestrictedTar(raw,'bundle'));}
/** Only the two repository-owned encodings; not a general tar reader.
 * @param {Buffer} raw @param {'bundle'|'legacy'} flavor */
function parseRestrictedTar(raw,flavor){
 const legacy=flavor==='legacy';
 const countLimit=legacy?500:LIMITS.entries+1,payloadLimit=legacy?LEGACY_ARCHIVE_LIMITS.payload:LIMITS.bytes+LIMITS.manifest;
 const tarLimit=legacy?LEGACY_ARCHIVE_LIMITS.tar:LIMITS.bytes+LIMITS.manifest+LIMITS.entries*1024;
 if(!Buffer.isBuffer(raw)||raw.length>tarLimit||raw.length%512)throw Error('Tar size bound');
 const entries=[];const seen=new Set();let offset=0,total=0;
 while(offset+512<=raw.length){
  const b=raw.subarray(offset,offset+512);
  if(b.every(v=>v===0)){if(raw.length-offset!==1024||raw.subarray(offset).some(v=>v!==0))throw Error('Trailing/truncated tar');if(legacy)validateLegacyPaths(entries);return entries;}
  if(entries.length>=countLimit)throw Error('Archive count bound');
  const name=text(b,0,100),prefix=text(b,345,155);const p=safePath(prefix?prefix+'/'+name:name);
  const size=number(b,124,12),mode=number(b,100,8);
  // Comparing the entire canonical header rejects links, PAX, GNU, sparse,
  // ownership, timestamps, reserved bytes and malformed checksums together.
  const directory=legacy&&b[156]===53,modifiedAt=legacy?number(b,136,12):0;
  if(size>(legacy?LEGACY_ARCHIVE_LIMITS.payload:LIMITS.file)||
    (legacy&&(!Number.isSafeInteger(modifiedAt)||mode!==(directory?448:384)||(directory&&size!==0)))||
    !b.equals(header(p,size,mode,flavor,directory,modifiedAt)))throw Error('Noncanonical/unsupported USTAR header');
  if(seen.has(p.toLowerCase()))throw Error('Duplicate archive path');seen.add(p.toLowerCase());
  total+=size;if(total>payloadLimit)throw Error('Expansion bound');
  const end=offset+512+size,next=offset+512+Math.ceil(size/512)*512;
  if(next>raw.length||raw.subarray(end,next).some(v=>v!==0))throw Error('Truncated/nonzero padding');
  entries.push({path:p,mode,data:raw.subarray(offset+512,end)});offset=next;
 }
 throw Error('Missing tar terminator');
}
// 500 headers + at most 511 padding bytes each + two terminal blocks.
export const LEGACY_ARCHIVE_LIMITS = Object.freeze({entries:500,payload:64*1024*1024,archive:80*1024*1024,tar:64*1024*1024+500*1023+1024,sbom:8*1024*1024});
/** @param {ArchiveEntry[]} entries */
function validateLegacyPaths(entries){
 const byPath=new Map(entries.map(e=>[e.path,e]));const aliases=new Map();
 for(const e of entries){const parts=e.path.split('/');for(let i=1;i<=parts.length;i++){
  const p=parts.slice(0,i).join('/'),key=p.toLowerCase();
  if(aliases.has(key)&&aliases.get(key)!==p)throw Error('Case directory collision');aliases.set(key,p);
  if(i<parts.length&&byPath.get(p)?.mode!==448)throw Error('Missing directory/file prefix collision');
 }}
}
/** Capture a bounded regular single-link file through one descriptor, before allocation/read.
 * @param {string} file @param {number} limit */
export function captureLegacyArtifact(file,limit){
 const before=fs.lstatSync(file);
 if(!before.isFile()||before.nlink!==1||before.size>limit)throw Error('Artifact type/size bound');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const s=fs.fstatSync(fd);
  if(!s.isFile()||s.nlink!==1||s.dev!==before.dev||s.ino!==before.ino||s.size>limit)throw Error('Artifact changed/type/size bound');
  const bytes=Buffer.alloc(s.size);let offset=0;
  while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,null);if(!n)throw Error('Artifact truncated');offset+=n;}
  const after=fs.fstatSync(fd);
  if(fs.readSync(fd,Buffer.alloc(1),0,1,null)!==0||after.size!==s.size||after.mtimeMs!==s.mtimeMs||after.ctimeMs!==s.ctimeMs)throw Error('Artifact changed during capture');
  return bytes;
 }finally{fs.closeSync(fd);}
}
/** @internal Legacy parser seam. Legacy mutation fixtures parse selected raw
 * archives in-process; public extractLegacyAgentArchiveBytes extracts immediately and
 * cannot expose the parsed entry model. Used in production by extractLegacyAgentArchiveBytes
 * at :95. Not a root/package export. @param {Buffer} bytes */
export function parseLegacyAgentArchive(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length>LEGACY_ARCHIVE_LIMITS.archive)throw Error('Archive bound');
 return {entries:parseRestrictedTar(gunzipSync(bytes,{maxOutputLength:LEGACY_ARCHIVE_LIMITS.tar}),'legacy')};
}
/** Parse the entire snapshot before any destination operation. Caller validates package inventory.
 * @param {Buffer} bytes @param {string} output */
export function extractLegacyAgentArchiveBytes(bytes,output){
 const parsed=parseLegacyAgentArchive(bytes);
 extractPrivateEntries([...parsed.entries].sort((a,b)=>a.path.split('/').length-b.path.split('/').length),output,true);
 return parsed;
}
/** @param {ArchiveEntry[]} entries */
function validateEntries(entries){
 const m=entries.find(e=>e.path==='bundle-manifest.json');if(!m||m.mode!==384||m.data.length>LIMITS.manifest)throw Error('Missing/unsafe manifest');
 const manifest=JSON.parse(m.data.toString());if(!m.data.equals(Buffer.from(canonical(manifest)+'\n')))throw Error('Manifest encoding');checkManifest(manifest);
 if(entries.length!==manifest.inventory.length+1)throw Error('Archive inventory count');
 for(const e of manifest.inventory){const actual=entries.find(a=>a.path===e.path);if(!actual||actual.mode!==e.mode||actual.data.length!==e.size||sha256(actual.data)!==e.sha256)throw Error('Archive inventory mismatch');}
 return {entries,manifest,digest:manifest.digest};
}
/** Stream deterministic USTAR/gzip to an EXCLUSIVE private pending file, not a
 * public archive. <=64KiB payload/compressor/output buffers with backpressure;
 * manifest metadata remains separately bounded by LIMITS.manifest.
 * Every member is hashed through captureRegular to EOF, including its growth
 * probe, before trusting the bytes already sent to the PRIVATE compressor/file.
 * A separate final bundle validation detects later inventory/manifest drift.
 * Caller must still check checkout/source drift BEFORE publishing/renaming output.
 * Existing Buffer encoders/parsers and createBundleArchive remain compatible.
 * @param {string} root @param {string} output
 * @param {{maxBytes?:number}} [options] Lower-only compressed-size ceiling.
 */
export async function writeBundleArchive(root,output,options={}){
 return writeBundleArchiveForTest(root,output,{},options);
}
/** @internal Internal mutation fixture seam; no hook is selectable by CLI/environment.
 * Production writeBundleArchive at :119 calls the empty-hook path and public
 * writeBundleArchive exposes no member/chunk/validation hooks, so fault-injection tests
 * cannot exercise mid-stream drift, bound and beforeValidation failure without it.
 * Not a root/package export.
 * @param {string} root @param {string} output @param {any} hooks
 * @param {{maxBytes?:number}} [options] */
export async function writeBundleArchiveForTest(root,output,hooks,{maxBytes=LIMITS.archive}={}){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>LIMITS.archive)throw Error('Invalid compressed archive bound');
 const bundle=await validateBundle(root);root=bundle.root;output=path.resolve(output);
 const relative=path.relative(root,output);
 if(relative===''||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))throw Error('Archive output must be outside the source bundle');
 const parent=path.dirname(output),guard=captureDirectoryAncestry(parent),parentStat=fs.lstatSync(parent,{bigint:true});
 if((parentStat.mode&0o7777n)!==0o700n||parentStat.uid!==BigInt(process.getuid()))throw Error('Archive output parent must be private/current-user owned');
 try{fs.lstatSync(output);throw Object.assign(Error('EEXIST: archive output exists'),{code:'EEXIST'});}catch(error){if(error.code!=='ENOENT')throw error;}
 const fd=fs.openSync(parent,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 const parentIdentity=pinnedDirectoryIdentity(parentStat),equal=(a,b)=>canonical(a)===canonical(b);
 const check=()=>{guard.check();if(!equal(pinnedDirectoryIdentity(fs.fstatSync(fd,{bigint:true})),parentIdentity))throw Error('Archive output directory changed');};
 const captureName=`.archive-capture-${randomBytes(16).toString('hex')}`,capturePath=path.join(parent,captureName);
 const base={fd,cwd:parent,parent:parentIdentity,check};
 let gzip,completion,written,failure,verified=false;
 try{
  check();let size=0,tarBytes=0;const digest=createHash('sha256');
  const tarBound=LIMITS.bytes+LIMITS.manifest+LIMITS.entries*1024;
  gzip=createGzip({level:9,chunkSize:64*1024});const compressor=gzip;
  // The child owns the output descriptor on every host. Its verified cwd/fd3
  // protocol is portable to Darwin and never traverses /dev/fd/N as a directory.
  const compressed=async function*(){for await(const chunk of compressor){size+=chunk.length;if(size>maxBytes)throw Error('Compressed bound');digest.update(chunk);yield chunk;}};
  completion=writePinnedDirectoryStream({...base,name:captureName,mode:384,maxBytes},compressed()).then(result=>({result,error:null}),error=>({result:null,error}));
  const send=async bytes=>{
   tarBytes+=bytes.length;if(tarBytes>tarBound)throw Error('Tar bound');
   await new Promise((resolve,reject)=>compressor.write(bytes,error=>error?reject(error):resolve()));
  };
  const manifestBytes=Buffer.from(canonical(bundle.manifest)+'\n');
  const entries=[...bundle.inventory,{path:'bundle-manifest.json',mode:384,size:manifestBytes.length,sha256:sha256(manifestBytes)}].sort((a,b)=>byteOrder(a.path,b.path));
  if(entries.length>LIMITS.entries+1)throw Error('Archive count bound');
  for(const entry of entries){
   safePath(entry.path);await hooks.beforeMember?.(entry.path);
   await captureRegular(path.join(root,entry.path),Math.min(entry.size,entry.path==='bundle-manifest.json'?LIMITS.manifest:LIMITS.file),async(input,expectedSize)=>{
    if(expectedSize!==entry.size)throw Error('Archive member size changed');
    await send(header(entry.path,entry.size,entry.mode));
    const buffer=Buffer.alloc(Math.min(expectedSize+1,64*1024)),hash=createHash('sha256');let length=0;
    while(length<=expectedSize){
     const r=await input.read(buffer,0,Math.min(buffer.length,expectedSize+1-length),null);if(!r.bytesRead)break;
     length+=r.bytesRead;if(length>expectedSize)throw Error('Archive member grew during capture');
     const chunk=buffer.subarray(0,r.bytesRead);hash.update(chunk);await send(chunk);
     await hooks.afterChunk?.(entry.path,length);
    }
    if(length!==entry.size||hash.digest('hex')!==entry.sha256)throw Error('Archive member checksum/size changed');
    return {value:null,length};
   },{mode:entry.mode});
   await send(Buffer.alloc((block-entry.size%block)%block));await hooks.afterMember?.(entry.path);
  }
  await send(Buffer.alloc(1024));gzip.end();
  const completed=await completion;if(completed.error)throw completed.error;written=completed.result;
  const archiveDigest=digest.digest('hex');check();
  const outputBytes=await hashRegular(capturePath,maxBytes,{mode:384});check();
  if(outputBytes.size!==size||outputBytes.sha256!==archiveDigest||Number(written.size)!==size)throw Error('Private archive output checksum changed');
  await hooks.beforeValidation?.(capturePath);
  // Independent end-of-capture validation is NOT replaced by an integrity index.
  const final=await validateBundle(root);
  if(final.digest!==bundle.digest)throw Error('Bundle changed during archive capture');
  check();
  if(!equal(pinnedEntryIdentity(fs.lstatSync(capturePath,{bigint:true})),written))throw Error('Private archive output changed');
  // Only now expose the requested private pending name; caller still checks
  // source checkout drift before publishing its public development archive.
  runPinnedDirectoryOperation({...base,operation:'rename',name:captureName,target:path.basename(output),expected:written});
  verified=true;return {path:output,size,sha256:archiveDigest,digest:bundle.digest};
 }catch(error){
  gzip?.destroy(error);
  const completed=completion?await completion:null;
  written??=completed?.result;
  failure=completed?.error??error;throw failure;
 }finally{
  gzip?.destroy();if(completion)await completion;
  try{
   if(!verified){
    // A successful child gives an exact cleanup identity. A killed/failed child
    // does not: preserve its internal private partial file as recovery evidence,
    // NEVER guess ownership from a pathname or publish the requested output.
    try{
     const actual=pinnedEntryIdentity(fs.lstatSync(capturePath,{bigint:true}));
     if(written&&equal(actual,written))runPinnedDirectoryOperation({...base,operation:'unlink',name:captureName,expected:written});
     else if(failure)failure.recoveryPath=capturePath;
    }catch(error){if(error.code!=='ENOENT'&&failure)failure.recoveryPath=capturePath;}
   }
  }finally{fs.closeSync(fd);}
 }
}/** @param {Buffer} bytes */
export function parseBundleArchive(bytes){if(bytes.length>LIMITS.archive)throw Error('Archive bound');return parseBundleTar(gunzipSync(bytes,{maxOutputLength:LIMITS.bytes+LIMITS.manifest+LIMITS.entries*1024}));}
/** @param {string} archive @param {string} output */
export async function extractBundleArchive(archive,output){
 return extractBundleArchiveBytes(await readRegular(archive,LIMITS.archive),output);
}
/** Extract a private snapshot of previously verified bytes, never reread a source pathname.
 * @param {Buffer} bytes @param {string} output */
export async function extractBundleArchiveBytes(bytes,output){
 if(!Buffer.isBuffer(bytes)||bytes.length>LIMITS.archive)throw Error('Archive bound');
 const parsed=parseBundleArchive(Buffer.from(bytes));
 // No destination operation occurs before the complete parser/inventory pass.
 const guard=extractPrivateEntries(parsed.entries,output);
 const bundle=await validateBundle(guard.root);guard.check();
 if(bundle.digest!==parsed.digest)throw Error('Extracted bundle identity changed');
 return bundle;
}
