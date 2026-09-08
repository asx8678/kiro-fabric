import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdir, writeFile, chmod, lstat } from 'node:fs/promises';
import path from 'node:path';
import fs from 'node:fs';
import { LIMITS, safePath, canonical, checkManifest, sha256, validateBundle, readRegular, byteOrder } from './bundle-contract.mjs';
/** @typedef {{path:string,mode:number,data:Buffer}} ArchiveEntry */
const block=512;
/** @param {number} n @param {number} len */
function octal(n,len){const s=n.toString(8);if(s.length>=len)throw Error('USTAR numeric overflow');return s.padStart(len-1,'0')+'\0';}
/** @param {string} name @param {number} size @param {number} mode */
function header(name,size,mode,flavor='bundle',directory=false,modifiedAt=0){
 const b=Buffer.alloc(block);let prefix='';if(Buffer.byteLength(name)>100){let i=name.lastIndexOf('/');if(flavor==='legacy')while(i>0&&(Buffer.byteLength(name.slice(0,i))>155||Buffer.byteLength(name.slice(i+1))>100))i=name.lastIndexOf('/',i-1);prefix=name.slice(0,i);name=name.slice(i+1);}
 if(Buffer.byteLength(name)>100||Buffer.byteLength(prefix)>155)throw Error('USTAR path bound');
 b.write(name,0,100);b.write(octal(mode,8),100);b.write(octal(0,8),108);b.write(octal(0,8),116);b.write(octal(size,12),124);b.write(octal(0,12),136);b.fill(32,148,156);b[156]=48;b.write('ustar\0',257);b.write('00',263);b.write(prefix,345,155);
 if(flavor==='legacy'){b.write(octal(modifiedAt,12),136);b[156]=directory?53:48;b.write(octal(0,8),329);b.write(octal(0,8),337);}
 const sum=b.reduce((a,v)=>a+v,0);b.write(sum.toString(8).padStart(6,'0')+'\0 ',148);return b;
}
/** @param {ArchiveEntry[]} entries */
export function encodeBundleTar(entries){
 const parts=[];let bytes=1024;if(entries.length>LIMITS.entries+1)throw Error('Archive count bound');
 for(const e of entries){safePath(e.path);bytes+=512+Math.ceil(e.data.length/512)*512;if(bytes>LIMITS.bytes+LIMITS.manifest+LIMITS.entries*1024)throw Error('Tar bound');parts.push(header(e.path,e.data.length,e.mode),e.data,Buffer.alloc((512-e.data.length%512)%512));}
 return Buffer.concat([...parts,Buffer.alloc(1024)]);
}
/** @param {Buffer} b @param {number} start @param {number} len */
function text(b,start,len){const field=b.subarray(start,start+len);const end=field.indexOf(0);if(end>=0&&field.subarray(end).some(v=>v!==0))throw Error('USTAR string padding');const raw=end<0?field:field.subarray(0,end);const s=raw.toString('utf8');if(!Buffer.from(s).equals(raw))throw Error('Invalid UTF8');return s;}
/** @param {Buffer} b @param {number} start @param {number} len */
function number(b,start,len){const s=b.subarray(start,start+len).toString('ascii');if(!/^[0-7]+\0$/.test(s))throw Error('USTAR number');return parseInt(s,8);}
/** @param {Buffer} raw */
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
/** @param {Buffer} bytes */
export function parseLegacyAgentArchive(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length>LEGACY_ARCHIVE_LIMITS.archive)throw Error('Archive bound');
 return {entries:parseRestrictedTar(gunzipSync(bytes,{maxOutputLength:LEGACY_ARCHIVE_LIMITS.tar}),'legacy')};
}
/** Parse the entire snapshot before any destination operation. Caller validates package inventory.
 * @param {Buffer} bytes @param {string} output */
export function extractLegacyAgentArchiveBytes(bytes,output){
 const parsed=parseLegacyAgentArchive(bytes);
 fs.mkdirSync(output,{mode:448});fs.chmodSync(output,448);
 for(const e of [...parsed.entries].sort((a,b)=>a.path.split('/').length-b.path.split('/').length)){
  const target=path.join(output,e.path);
  if(e.mode===448){fs.mkdirSync(target,{mode:448});fs.chmodSync(target,448);}
  else{fs.writeFileSync(target,e.data,{flag:'wx',mode:384});fs.chmodSync(target,384);}
 }
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
/** @param {string} root @param {string} output */
export async function createBundleArchive(root,output){
 const bundle=await validateBundle(root);const entries=[];
 for(const e of bundle.inventory)entries.push({path:e.path,mode:e.mode,data:await readRegular(path.join(root,e.path),LIMITS.file)});
 entries.push({path:'bundle-manifest.json',mode:384,data:Buffer.from(canonical(bundle.manifest)+'\n')});entries.sort((a,b)=>byteOrder(a.path,b.path));
 const raw=encodeBundleTar(entries);parseBundleTar(raw);const archive=gzipSync(raw,{level:9});if(archive.length>LIMITS.archive)throw Error('Compressed bound');
 await writeFile(output,archive,{flag:'wx',mode:384});return {path:output,size:archive.length,sha256:sha256(archive),digest:bundle.digest};
}
/** @param {Buffer} bytes */
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
 try{await lstat(output);throw Error('Destination already exists');}catch(e){if(!(e instanceof Error)||!('code' in e)||e.code!=='ENOENT')throw e;}
 await mkdir(output,{mode:448});await chmod(output,448);
 for(const e of parsed.entries){const parent=path.dirname(path.join(output,e.path));await mkdir(parent,{recursive:true,mode:448});await writeFile(path.join(output,e.path),e.data,{flag:'wx',mode:e.mode});await chmod(path.join(output,e.path),e.mode);}
 return validateBundle(output);
}
