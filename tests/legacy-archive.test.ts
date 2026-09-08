import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createAgentArchive } from '../scripts/create-agent-archive.mjs';
import { captureLegacyArtifact, LEGACY_ARCHIVE_LIMITS, parseLegacyAgentArchive, extractLegacyAgentArchiveBytes, parseBundleArchive } from '../scripts/bundle-archive.mjs';
import { validateAgentPackage } from '../scripts/validate-agent-package.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-archive-'));
let raw:Buffer, bytes:Buffer, records:Buffer[];
beforeAll(()=>{
 const archive=path.join(root,'archive');createAgentArchive('.tmp/kiro-fabric-agent',archive,{sourceDateEpoch:1700000000});
 bytes=captureLegacyArtifact(archive,LEGACY_ARCHIVE_LIMITS.archive);raw=gunzipSync(bytes);records=[];
 for(let offset=0;offset<raw.length-1024;){const size=parseInt(raw.subarray(offset+124,offset+135).toString(),8),next=offset+512+Math.ceil(size/512)*512;records.push(Buffer.from(raw.subarray(offset,next)));offset=next;}
});
afterAll(()=>fs.rmSync(root,{recursive:true,force:true}));
function firstRecord():Buffer { const first=records[0]; if(!first)throw Error('Legacy producer fixture has no header'); return first; }
function checksum(b:Buffer){b.fill(32,148,156);b.write(b.subarray(0,512).reduce((a,v)=>a+v,0).toString(8).padStart(6,'0')+'\0 ',148);return b;}
function named(record:Buffer,name:string){const b=Buffer.from(record);b.fill(0,0,100);b.fill(0,345,500);b.write(name,0);return checksum(b);}
function reject(content:Buffer){const out=path.join(root,'absent');expect(()=>extractLegacyAgentArchiveBytes(gzipSync(content),out)).toThrow();expect(fs.existsSync(out)).toBe(false);}
function tar(items:Buffer[]){return Buffer.concat([...items,Buffer.alloc(1024)]);}
test('producer epoch, explicit directories, exact package tree and exclusive output',()=>{
 const parsed=parseLegacyAgentArchive(bytes);expect(parsed.entries.some(e=>e.path==='.')).toBe(false);
 const out=path.join(root,'out');extractLegacyAgentArchiveBytes(bytes,out);
 expect(validateAgentPackage(out).digest).toBe(validateAgentPackage('.tmp/kiro-fabric-agent').digest);
 expect(()=>extractLegacyAgentArchiveBytes(bytes,out)).toThrow();expect(()=>parseBundleArchive(bytes)).toThrow();
});
for(const type of ['1','2','3','4','6','x','g','L','K','S'])test('rejects legacy type '+type,()=>{const b=Buffer.from(firstRecord());b[156]=type.charCodeAt(0);reject(tar([checksum(b)]));});
for(const name of ['../escape','/absolute','a/../../escape','a\\escape','.','a//b','a/./b','a:drive','a.'])test('rejects path '+name,()=>reject(tar([named(firstRecord(),name)])));
for(const offset of [100,108,116,124,136,148,157,257,263,265,329,337,500])test('rejects noncanonical field '+offset,()=>{const b=Buffer.from(firstRecord());b[offset]=255;reject(tar([offset===148?b:checksum(b)]));});
test('rejects invalid UTF8 and string padding',()=>{for(const offset of [0,99]){const b=Buffer.from(firstRecord());b[offset]=255;reject(tar([checksum(b)]));}});
test('rejects duplicate, case and file-prefix collisions in either order',()=>{
 const file=records.find(b=>b[156]===48)!,dir=records.find(b=>b[156]===53)!;
 for(const items of [[named(file,'a'),named(file,'a')],[named(dir,'A'),named(file,'a/f')],[named(file,'a'),named(file,'a/f')],[named(file,'a/f'),named(file,'a')],[named(dir,'a'),named(file,'a')]])reject(tar(items));
});
test('rejects missing directories, truncation, trailing bytes and nonzero padding',()=>{
 reject(tar([named(records.find(b=>b[156]===48)!,'missing/file')]));
 reject(raw.subarray(0,raw.length-512));reject(Buffer.concat([raw,Buffer.alloc(512)]));reject(raw.subarray(0,513));
 const b=Buffer.from(records.find(b=>{const size=parseInt(b.subarray(124,135).toString(),8);return size%512!==0;})!);b[b.length-1]=1;reject(tar([b]));
});
test('enforces count, payload, compressed and bounded gunzip ceilings',()=>{
 const dir=records.find(b=>b[156]===53)!;reject(tar(Array.from({length:501},(_,i)=>named(dir,'d'+i))));
 const b=named(records.find(b=>b[156]===48)!,'big').subarray(0,512);b.write((LEGACY_ARCHIVE_LIMITS.payload+1).toString(8).padStart(11,'0')+'\0',124);reject(tar([checksum(b)]));
 expect(()=>parseLegacyAgentArchive(Buffer.alloc(LEGACY_ARCHIVE_LIMITS.archive+1))).toThrow('Archive bound');
 expect(()=>parseLegacyAgentArchive(gzipSync(Buffer.alloc(LEGACY_ARCHIVE_LIMITS.tar+1)))).toThrow();
});
test('capture rejects oversized, linked and nonregular inputs; captured bytes survive replacement',()=>{
 const file=path.join(root,'capture');fs.writeFileSync(file,bytes);const captured=captureLegacyArtifact(file,LEGACY_ARCHIVE_LIMITS.archive);fs.writeFileSync(file,'replacement');expect(parseLegacyAgentArchive(captured).entries.length).toBeGreaterThan(0);
 expect(()=>captureLegacyArtifact(file,1)).toThrow();fs.symlinkSync(file,file+'-sym');expect(()=>captureLegacyArtifact(file+'-sym',100)).toThrow();fs.linkSync(file,file+'-hard');expect(()=>captureLegacyArtifact(file,100)).toThrow();expect(()=>captureLegacyArtifact(root,100)).toThrow();
});
