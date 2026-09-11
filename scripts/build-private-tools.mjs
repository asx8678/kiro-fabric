import { readFile, mkdir, mkdtemp, writeFile, rm, chmod, lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha256, TARGETS, checkToolPins } from './bundle-contract.mjs';
import { captureArtifactTree } from './installer-artifacts.mjs';
const HOSTS=new Set(['nodejs.org','github.com','release-assets.githubusercontent.com']);
/** Bounded upstream acquisition, one overall deadline including redirect bodies.
 * @param {string} url @param {{sha256:string,size?:number,max?:number}} options */
export async function downloadVerified(url,{sha256:digest,size,max=96*1024*1024}){
 if(!/^[a-f0-9]{64}$/.test(digest)||!Number.isSafeInteger(max)||max<1||max>192*1024*1024||size!==undefined&&(!Number.isSafeInteger(size)||size<1||size>max))throw Error('Invalid tool download pin');
 let current=new URL(url);const signal=AbortSignal.timeout(120000);
 for(let i=0;i<=4;i++){
  if(current.protocol!=='https:'||current.username||current.password||current.port||current.hash||!HOSTS.has(current.hostname))throw Error('Unapproved tool URL');
  const response=await fetch(current,{redirect:'manual',signal});
  if([301,302,303,307,308].includes(response.status)){
   await response.body?.cancel();const location=response.headers.get('location');if(i===4||!location)throw Error('Tool redirect limit/location');current=new URL(location,current);continue;
  }
  if(response.status!==200||!response.body){await response.body?.cancel();throw Error('Tool download failed');}
  const length=response.headers.get('content-length');if(length!==null&&(!/^(0|[1-9]\d*)$/.test(length)||!Number.isSafeInteger(Number(length))||Number(length)>max||size!==undefined&&Number(length)!==size)){await response.body.cancel();throw Error('Tool download size');}
  const chunks=[];let bytes=0;
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>max||(size!==undefined&&bytes>size))throw Error('Tool download bound');chunks.push(Buffer.from(chunk));}
  const data=Buffer.concat(chunks);if((size!==undefined&&bytes!==size)||length!==null&&bytes!==Number(length)||sha256(data)!==digest)throw Error('Tool archive digest/size mismatch');return data;
 }
 throw Error('Tool redirect limit');
}
/** Fixed-member extraction only after whole upstream archive verification.
 * @param {string} archive @param {string} member @param {number} [max] */
export function extractPinnedMember(archive,member,max=160*1024*1024){
 if(!/^[A-Za-z0-9._/-]+$/.test(member)||member.split('/').includes('..')||member.startsWith('/'))throw Error('Unsafe fixed upstream member');
 // Only called after archive pin verification. Never used for bundle/untrusted tar.
 return execFileSync('tar',['-xOzf',archive,'--',member],{maxBuffer:max,timeout:30000,env:{PATH:'/usr/bin:/bin',LANG:'C'}});
}
/** Acquire the pinned binary and all legal notices; return the exact pin records.
 * @param {string} target @param {string} destination @param {string} [configRoot] */
export async function acquirePrivateTools(target,destination,configRoot){
 if(!TARGETS.includes(target))throw Error('Unsupported target');
 const config=JSON.parse(await readFile(configRoot ? path.join(configRoot,'build-toolchain.json') : new URL('../build-toolchain.json',import.meta.url),'utf8'));
 const pins=config.targets[target];if(!pins?.node?.sha256||!pins?.rg?.sha256)throw Error('Private tool pins unavailable');
 return acquirePrivateToolsForTest(target,destination,{pins,qualification:config.qualification,download:downloadVerified,extract:extractPinnedMember});
}
/** Verify the exact binary/notice closure with <=64KiB streaming hash buffers.
 * Pins/size/mode/single-link/inode/ancestry checks are independent of any receipt.
 * Extra files AND extra/empty directories are drift, never ignored cache debris.
 * @param {string} root @param {any} pins @param {string} target */
export async function verifyPrivateToolCache(root,pins,target){
 checkToolPins(pins,undefined,target);
 const members=Object.values(pins).flatMap(pin=>pin.members);
 const captured=await captureArtifactTree(root,members.map(member=>({path:member.path,size:member.size,mode:member.path.startsWith('tools/')?0o700:0o600})));
 const expected=members.map(member=>member.path).sort();
 if(JSON.stringify(captured.files.map(file=>file.path).sort())!==JSON.stringify(expected)||
    JSON.stringify(captured.entries.filter(entry=>entry.type==='directory').map(entry=>entry.path).sort())!==JSON.stringify(['','notices','tools']))throw Error('Pinned private-tool cache inventory drifted; preserve and inspect it');
 for(const member of members){const file=captured.files.find(file=>file.path===member.path);
  if(file.size!==member.size||file.sha256!==member.sha256||file.mode!==(member.path.startsWith('tools/')?0o700:0o600))throw Error('Pinned private-tool cache drifted; preserve and inspect it');
 }
 checkToolPins(pins,captured.files,target);
 return captured;
}
/** Internal fixture seam for acquisition; never selectable by CLI or environment.
 * @param {string} target @param {string} destination
 * @param {{pins:any,qualification:any,download:typeof downloadVerified,extract:typeof extractPinnedMember}} dependencies */
export async function acquirePrivateToolsForTest(target,destination,{pins,qualification,download,extract}){
 if(!TARGETS.includes(target))throw Error('Unsupported target');
 checkToolPins(pins,undefined,target);
 const root=await lstat(destination);
 if(!root.isDirectory()||root.isSymbolicLink()||(root.mode&4095)!==448||root.uid!==process.getuid?.()||await realpath(destination)!==path.resolve(destination))throw Error('Unsafe private tool destination');
 const temp=await mkdtemp(path.join(tmpdir(),'fabric-tools-'));
 try{
  const files=[];
  for(const tool of ['node','rg']){const pin=pins[tool];const archive=await download(pin.url,pin);if(archive.length!==pin.size||sha256(archive)!==pin.sha256)throw Error('Tool archive capture mismatch');const archivePath=path.join(temp,tool+'.tar.gz');await writeFile(archivePath,archive,{mode:384});
   for(const member of pin.members){const bytes=extract(archivePath,member.member);if(bytes.length!==member.size||sha256(bytes)!==member.sha256)throw Error('Installed tool member mismatch');files.push({path:member.path,bytes,mode:member.path==='tools/'+tool?448:384});}
  }
  for(const file of files){if(!/^(tools\/(node|rg)|notices\/[a-zA-Z0-9._-]+)$/.test(file.path))throw Error('Unsafe pin destination');const parent=path.dirname(path.join(destination,file.path));await mkdir(parent,{recursive:true,mode:448});const s=await lstat(parent);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&4095)!==448||s.uid!==process.getuid?.())throw Error('Unsafe private tool directory');await writeFile(path.join(destination,file.path),file.bytes,{flag:'wx',mode:file.mode});await chmod(path.join(destination,file.path),file.mode);}
  return {target,tools:pins,bytes:files.reduce((n,f)=>n+f.bytes.length,0),qualification};
 }finally{await rm(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==4)throw Error('Usage: build-private-tools.mjs TARGET DESTINATION');
 await acquirePrivateTools(process.argv[2],path.resolve(process.argv[3]));
}
