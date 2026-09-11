import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { generateKeyPairSync, sign } from 'node:crypto';
import type https from 'node:https';
import { afterEach, expect, test, vi } from 'vitest';
import { canonical, sha256, compatibilityFor } from '../scripts/bundle-contract.mjs';
import { releaseSigningBytes, verifyReleaseForTest, verifyRelease, verifyReleaseSidecarsCapturedForTest, verifyReleaseSidecarsCaptured, checkReleaseSbom } from '../scripts/release-trust.mjs';
import { downloadHttpsForTest, discoverReleaseForTest, discoverRelease, RELEASE_API } from '../scripts/release-download.mjs';

const roots:string[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
// Reuses its fragment buffer deliberately, to test capture rather than references.
function fragments(size:number,fragmentSize:number):typeof https.request{
 return ((_url:URL,_options:unknown,callback:(res:any)=>void)=>{
  const req:any=new EventEmitter(),res:any=new EventEmitter();res.statusCode=200;res.headers={};res.complete=true;
  req.destroy=()=>{res.destroyed=true;};res.destroy=req.destroy;
  req.end=()=>{req.emit('socket',{connecting:false});queueMicrotask(()=>{
   callback(res);const fragment=Buffer.alloc(fragmentSize,37);
   for(let i=0;i<size&&!res.destroyed;i+=fragmentSize)res.emit('data',fragment.subarray(0,Math.min(size-i,fragmentSize)));
   fragment.fill(0);if(!res.destroyed)res.emit('end');
  });};return req;
 }) as typeof https.request;
}
test.each([1,32768])('fragmented download (%i-byte chunks) has bounded allocation count and owns captured bytes',async chunkSize=>{
 const size=256*1024+1,alloc=vi.spyOn(Buffer,'alloc'),copy=vi.spyOn(Buffer,'from');
 const captured=await downloadHttpsForTest('https://github.com/fixture',{maxBytes:size,expectedSize:size},fragments(size,chunkSize));
 const allocationSizes=alloc.mock.calls.map(([n])=>n);
 expect(allocationSizes.length).toBeLessThanOrEqual(6);expect(Math.max(...allocationSizes)).toBeLessThanOrEqual(size);
 expect(allocationSizes.reduce((a,b)=>a+b,0)).toBeLessThanOrEqual(size*3+chunkSize);
 expect(copy.mock.calls.filter(args=>Buffer.isBuffer(args[0]))).toHaveLength(0);
 expect(captured.length).toBe(size);expect(captured.every(byte=>byte===37)).toBe(true);
});
test('fragment overrun, signed truncation and invalid limits never yield a partial capture',async()=>{
 await expect(downloadHttpsForTest('https://github.com/fixture',{maxBytes:3},fragments(4,1))).rejects.toThrow(/oversized/);
 await expect(downloadHttpsForTest('https://github.com/fixture',{maxBytes:4,expectedSize:4},fragments(3,1))).rejects.toThrow(/truncated/);
 let called=false;const noRequest=(()=>{called=true;throw Error('must not request');}) as typeof https.request;
 for(const maxBytes of [0,NaN,Infinity,-1])await expect(downloadHttpsForTest('https://github.com/fixture',{maxBytes},noRequest)).rejects.toThrow(/limits/);
 await expect(downloadHttpsForTest('https://foreign.invalid/fixture',{maxBytes:3},noRequest)).rejects.toThrow(/unapproved/);expect(called).toBe(false);
});
function signed(){
 const archiveBytes=Buffer.from('fixture archive'),sbomBytes=Buffer.from('fixture signed SBOM');
 const metadata={schema:1,product:'kiro-fabric',version:'1.0.0',sourceCommit:'a'.repeat(40),target:'linux-x64',compatibility:compatibilityFor('linux-x64'),archive:{url:'https://github.com/asx8678/kiro-fabric/releases/download/v1.0.0/kiro-fabric-1.0.0-linux-x64.tar.gz',size:archiveBytes.length,sha256:sha256(archiveBytes)},bundleDigest:'b'.repeat(64),sbom:{size:sbomBytes.length,sha256:sha256(sbomBytes)}};
 const keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({type:'spki',format:'pem'}),metadataBytes=Buffer.from(canonical(metadata)+'\n'),signatureBytes=Buffer.from(sign(null,releaseSigningBytes(metadata),keys.privateKey).toString('base64')+'\n');
 return {metadata,archiveBytes,sbomBytes,metadataBytes,signatureBytes,publicKey,verify:(m:Buffer,s:Buffer,e:any)=>verifyReleaseForTest(m,s,publicKey,e)};
}
function local(){
 const f=signed(),root=fs.mkdtempSync(path.join(tmpdir(),'release-capture-'));roots.push(root);fs.chmodSync(root,0o700);
 const archive=path.join(root,'release.tar.gz');
 for(const [suffix,bytes] of [['',f.archiveBytes],['.spdx.json',f.sbomBytes],['.release.json',f.metadataBytes],['.release.sig',f.signatureBytes]] as const)fs.writeFileSync(archive+suffix,bytes,{mode:0o600});
 return {...f,root,archive};
}
test('local signed sidecar capture binds and returns both artifacts; pathname changes cannot change returned bytes',async()=>{
 const f=local(),capture=await verifyReleaseSidecarsCapturedForTest(f.archive,f.publicKey,{target:'linux-x64'});
 expect(capture.metadata).toEqual(f.metadata);expect(capture.sbomBytes).toEqual(f.sbomBytes);expect(capture.archiveBytes).toEqual(f.archiveBytes);
 fs.writeFileSync(f.archive+'.spdx.json','changed');fs.writeFileSync(f.archive,'changed');
 expect(capture.sbomBytes).toEqual(f.sbomBytes);expect(capture.archiveBytes).toEqual(f.archiveBytes);
 expect(()=>f.verify(f.metadataBytes,f.signatureBytes,{sbomBytes:Buffer.alloc(f.sbomBytes.length)})).toThrow(/SBOM/);
 expect(()=>checkReleaseSbom(f.metadata,Buffer.alloc(f.sbomBytes.length-1))).toThrow(/SBOM/);
});
test.each(['missing','short','same-size','oversized','symlink','hardlink'])('local signed SBOM %s fails before unavailable archive capture',async kind=>{
 const f=local(),sbom=f.archive+'.spdx.json';fs.unlinkSync(f.archive);
 if(kind==='missing')fs.unlinkSync(sbom);
 if(kind==='short')fs.writeFileSync(sbom,f.sbomBytes.subarray(1));
 if(kind==='same-size')fs.writeFileSync(sbom,Buffer.alloc(f.sbomBytes.length));
 if(kind==='oversized')fs.appendFileSync(sbom,'x');
 if(kind==='symlink'){fs.renameSync(sbom,sbom+'.original');fs.symlinkSync(sbom+'.original',sbom);}
 if(kind==='hardlink')fs.linkSync(sbom,sbom+'.link');
 const error=await verifyReleaseSidecarsCapturedForTest(f.archive,f.publicKey).then(()=>null,e=>e as Error);
 expect(error).toBeInstanceOf(Error);expect(error!.message).toMatch(/SBOM|oversized|Unsafe|spdx[.]json/);
});
test('signature failure and production refusal precede artifact access; fixture keys never enable production',async()=>{
 const f=local();fs.unlinkSync(f.archive);fs.unlinkSync(f.archive+'.spdx.json');fs.writeFileSync(f.archive+'.release.sig',Buffer.alloc(89));
 await expect(verifyReleaseSidecarsCapturedForTest(f.archive,f.publicKey)).rejects.toThrow(/Signature/);
 expect(()=>verifyRelease(f.metadataBytes,f.signatureBytes)).toThrow(/blocked/);
 await expect(verifyReleaseSidecarsCaptured('/nonexistent/fixture')).rejects.toThrow(/blocked/);
 await expect(discoverRelease({target:'linux-x64'})).rejects.toThrow(/trust-root blocked/);
});
function discovery(){
 const f=signed(),url=f.metadata.archive.url,name=url.split('/').at(-1),release={tag_name:'v1.0.0',draft:false,prerelease:false,assets:['','.release.json','.release.sig','.spdx.json'].map(s=>({name:name+s,browser_download_url:url+s}))};
 const responses=new Map([[RELEASE_API+'/latest',Buffer.from(JSON.stringify(release))],[url,f.archiveBytes],[url+'.release.json',f.metadataBytes],[url+'.release.sig',f.signatureBytes],[url+'.spdx.json',f.sbomBytes]]),calls:string[]=[];
 const download=async(u:string,options:{maxBytes:number,expectedSize?:number})=>{calls.push(u);if(u===url+'.spdx.json')expect(options).toEqual({maxBytes:f.sbomBytes.length,expectedSize:f.sbomBytes.length});const bytes=responses.get(u);if(!bytes)throw Error('fixture unavailable');return bytes;};
 return {...f,url,release,responses,calls,download};
}
test('discovery verifies the signed SBOM before archive download and preserves the captured artifact',async()=>{
 const f=discovery(),result=await discoverReleaseForTest({target:'linux-x64'},f);
 expect(result.sbomBytes).toEqual(f.sbomBytes);expect(f.calls.indexOf(f.url+'.spdx.json')).toBeLessThan(f.calls.indexOf(f.url));
});
test.each(['missing','tampered','oversized','foreign','duplicate','signature'])('discovery SBOM/signature %s refuses before archive download',async kind=>{
 const f=discovery();
 if(kind==='missing')f.release.assets.pop();
 if(kind==='foreign')f.release.assets.at(-1)!.browser_download_url='https://foreign.invalid/sbom';
 if(kind==='duplicate')f.release.assets.push(f.release.assets.at(-1)!);
 if(kind==='tampered')f.responses.set(f.url+'.spdx.json',Buffer.alloc(f.sbomBytes.length));
 if(kind==='oversized')f.responses.set(f.url+'.spdx.json',Buffer.concat([f.sbomBytes,Buffer.from('x')]));
 if(kind==='signature')f.responses.set(f.url+'.release.sig',Buffer.alloc(89));
 f.responses.set(RELEASE_API+'/latest',Buffer.from(JSON.stringify(f.release)));
 await expect(discoverReleaseForTest({target:'linux-x64'},f)).rejects.toThrow();expect(f.calls).not.toContain(f.url);
 if(kind==='signature')expect(f.calls).not.toContain(f.url+'.spdx.json');
});
