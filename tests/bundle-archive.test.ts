import { removeFixture as rm } from "./fixture-cleanup.mjs";
import { test, expect } from 'vitest';
import { mkdtemp, readFile, lstat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fixture } from './bundle-fixture.js';
import { writeBundleArchive, extractBundleArchive, parseBundleArchive, parseBundleTar, extractBundleArchiveBytes } from '../scripts/bundle-archive.mjs';
test('deterministic archive and pre-extraction hostile rejection',async()=>{const root=await fixture(),tmp=await mkdtemp(tmpdir()+'/archive-test-');try{await writeBundleArchive(root,tmp+'/a');await writeBundleArchive(root,tmp+'/b');const bytes=await readFile(tmp+'/a');expect(bytes.equals(await readFile(tmp+'/b'))).toBe(true);const b=await extractBundleArchive(tmp+'/a',tmp+'/out');expect(b.version).toBe('1.0.0');const raw=gunzipSync(bytes);for(const offset of [0,100,148,156,257,500]){const bad=Buffer.from(raw);bad[offset]=255;expect(()=>parseBundleTar(bad)).toThrow();}expect(()=>parseBundleTar(Buffer.concat([raw,Buffer.alloc(512)]))).toThrow();expect(()=>parseBundleTar(raw.subarray(0,raw.length-512))).toThrow();await writeFile(tmp+'/evil',gzipSync(raw.subarray(0,1024)));await expect(extractBundleArchive(tmp+'/evil',tmp+'/absent')).rejects.toThrow();await expect(lstat(tmp+'/absent')).rejects.toThrow();expect(parseBundleArchive(bytes).entries.length).toBe(17);}finally{await rm(root,{recursive:true,force:true});await rm(tmp,{recursive:true,force:true});}});

test('captured extraction never rereads a subsequently replaced archive pathname',async()=>{
 const root=await fixture(),temp=await mkdtemp(tmpdir()+'/archive-capture-');try{
  await writeBundleArchive(root,temp+'/bundle');const captured=await readFile(temp+'/bundle');await writeFile(temp+'/bundle','replaced');
  const result=await extractBundleArchiveBytes(captured,temp+'/out');expect(result.version).toBe('1.0.0');
  await expect(extractBundleArchiveBytes(Buffer.from('invalid'),temp+'/absent')).rejects.toThrow();await expect(lstat(temp+'/absent')).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});await rm(temp,{recursive:true,force:true});}
});
