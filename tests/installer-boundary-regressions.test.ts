import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { gzipSync } from 'node:zlib';
import { afterEach, expect, test, vi } from 'vitest';
import { fixture } from './bundle-fixture.js';
import { canonical, createBundleManifest, validateBundle, readRegular, hashRegular, safePath } from '../scripts/bundle-contract.mjs';
import { createBundleArchive, extractBundleArchiveBytes, extractLegacyAgentArchiveBytes, encodeBundleTar } from '../scripts/bundle-archive.mjs';
import { captureDirectoryAncestry, readDirectoryBounded, readDirectoryBoundedSync, directoryIsEmpty, trustedDirectoryStat } from '../src/installation/filesystem-boundary.mjs';
import { installerSafety, resolveKiroHome } from '../scripts/install-agent-user.mjs';

const roots:string[]=[];
const temp=()=>{const p=fs.mkdtempSync(path.join(tmpdir(),'installer-boundary-'));fs.chmodSync(p,0o700);roots.push(p);return p;};
afterEach(()=>{vi.restoreAllMocks();syncBuiltinESMExports();for(const root of roots.splice(0))removeFixtureSync(root,{recursive:true,force:true});});
const mkdir=(p:string,mode=0o700)=>{fs.mkdirSync(p,{mode});fs.chmodSync(p,mode);return p;};
async function bundle(){const root=await fixture();roots.push(root);return root;}

// These paths are disposable fixtures, never the installed home.
test('symlink/.. aliases validate and return precisely the same lexical bundle root',async()=>{
 const parent=temp(),root=await bundle(),local=path.join(parent,'bundle');fs.renameSync(root,local);
 const elsewhere=mkdir(path.join(parent,'elsewhere')),child=mkdir(path.join(elsewhere,'child'));
 mkdir(path.join(elsewhere,'bundle'));fs.writeFileSync(path.join(elsewhere,'bundle','sentinel'),'foreign');
 fs.symlinkSync(child,path.join(parent,'jump'));
 const alias=parent+'/jump/../bundle',checked=await validateBundle(alias);
 expect(checked.root).toBe(local);expect((await validateBundle(checked.root)).digest).toBe(checked.digest);
 expect(await createBundleManifest(alias,checked.manifest)).toEqual(checked.manifest);
 const archive=path.join(parent,'alias.tar.gz');await createBundleArchive(alias,archive);
 expect((await extractBundleArchiveBytes(fs.readFileSync(archive),path.join(parent,'out'))).digest).toBe(checked.digest);
 fs.symlinkSync(local,path.join(parent,'direct'));await expect(validateBundle(path.join(parent,'direct'))).rejects.toThrow(/root component/);
 expect(fs.readFileSync(path.join(elsewhere,'bundle','sentinel'),'utf8')).toBe('foreign');
});

test.each(['app/main.js','tools/node','bundle-manifest.json'])('mode substitution during lstat cannot certify stale inventory mode: %s',async member=>{
 const root=await bundle(),target=path.join(root,member),original=fsp.lstat;let changed=false;
 vi.spyOn(fsp,'lstat').mockImplementation((async(...args:Parameters<typeof fsp.lstat>)=>{
  const stat=await original(...args);if(!changed&&String(args[0])===target){changed=true;fs.chmodSync(target,0o644);}return stat;
 }) as typeof fsp.lstat);syncBuiltinESMExports();
 await expect(validateBundle(root)).rejects.toThrow(/mode|File changed/);expect(changed).toBe(true);
});

test('regular-to-FIFO substitution rejects without waiting for a writer; static FIFO and capture bounds reject',async()=>{
 const root=temp(),target=path.join(root,'capture');fs.writeFileSync(target,'ok',{mode:0o600});
 expect((await hashRegular(target,2,{mode:0o600})).size).toBe(2);
 const original=fsp.lstat;let changed=false,slow=false,writer:number|undefined;
 vi.spyOn(fsp,'lstat').mockImplementation((async(...args:Parameters<typeof fsp.lstat>)=>{
  const stat=await original(...args);if(!changed&&String(args[0])===target){changed=true;fs.unlinkSync(target);const p=spawnSync('mkfifo',['-m','600',target],{timeout:2000});expect(p.status).toBe(0);}return stat;
 }) as typeof fsp.lstat);syncBuiltinESMExports();
 // Counterguard prevents an old blocking-open implementation from wedging the suite.
 const timer=setTimeout(()=>{slow=true;writer=fs.openSync(target,fs.constants.O_WRONLY|fs.constants.O_NONBLOCK);},500);
 try{await expect(readRegular(target,2)).rejects.toThrow(/File changed/);expect(changed).toBe(true);expect(slow).toBe(false);}
 finally{clearTimeout(timer);if(writer!==undefined)fs.closeSync(writer);}
 await expect(readRegular(target,2)).rejects.toThrow(/Unsafe/);
 await expect(readRegular(target,NaN)).rejects.toThrow(/bound/);
});

test('descriptor capture rejects hard-link substitution and in-flight mode changes',async()=>{
 const root=temp(),target=path.join(root,'capture');fs.writeFileSync(target,'ok',{mode:0o600});
 const open=fsp.open;
 vi.spyOn(fsp,'open').mockImplementation(async(...args)=>{
  const handle=await open(...args);if(String(args[0])===target)fs.linkSync(target,path.join(root,'alias'));return handle;
 });syncBuiltinESMExports();
 await expect(readRegular(target,2)).rejects.toThrow(/changed/);
 vi.restoreAllMocks();syncBuiltinESMExports();fs.unlinkSync(path.join(root,'alias'));
 vi.spyOn(fsp,'open').mockImplementation(async(...args)=>{
  const handle=await open(...args),read=handle.read.bind(handle);
  vi.spyOn(handle,'read').mockImplementation((async(...readArgs:unknown[])=>{const result=await (read as Function)(...readArgs);fs.chmodSync(target,0o644);return result;}) as typeof handle.read);return handle;
 });syncBuiltinESMExports();await expect(readRegular(target,2,{mode:0o600})).rejects.toThrow(/changed/);
});

async function archive(){const root=await bundle(),parent=temp(),file=path.join(parent,'bundle.tar.gz');await createBundleArchive(root,file);return fs.readFileSync(file);}
function legacyArchive(){
 const raw=encodeBundleTar([{path:'file.json',mode:0o600,data:Buffer.from('fixture')}]);
 raw.write('0000000\0',329);raw.write('0000000\0',337);raw.fill(32,148,156);
 const sum=raw.subarray(0,512).reduce((n,v)=>n+v,0);raw.write(sum.toString(8).padStart(6,'0')+'\0 ',148);return gzipSync(raw);
}
test.each(['bundle','legacy'])('%s extraction rejects unsafe ancestry without writing output or following links',async kind=>{
 const bytes=kind==='bundle'?await archive():legacyArchive(),parent=temp(),victim=mkdir(path.join(parent,'victim'));
 const extract=(output:string)=>kind==='bundle'?extractBundleArchiveBytes(bytes,output):Promise.resolve().then(()=>extractLegacyAgentArchiveBytes(bytes,output));
 fs.symlinkSync(victim,path.join(parent,'link'));await expect(extract(path.join(parent,'link','out'))).rejects.toThrow(/ancestry/);
 expect(fs.readdirSync(victim)).toEqual([]);
 const shared=mkdir(path.join(parent,'shared'),0o777),privateChild=mkdir(path.join(shared,'private'));
 await expect(extract(path.join(privateChild,'out'))).rejects.toThrow(/ancestry/);expect(fs.readdirSync(privateChild)).toEqual([]);
 const good=path.join(parent,'good');await extract(good);await expect(extract(good)).rejects.toThrow(/EEXIST/);
 expect(fs.statSync(good).mode&0o7777).toBe(0o700);
});

// The in-process syscall boundary this case replaces exists only on the Linux
// kernel-alias path (scripts/pinned-directory-child.mjs `anchor`). Darwin always
// routes the effect through the cwd/fd3-verified child, where an in-process fs
// mock cannot observe it; that path is covered by
// tests/installer-extraction-portability.test.ts.
test.skipIf(process.platform !== 'linux').each(['bundle','legacy'])('%s extraction binds mkdir to the captured parent even when replaced at the syscall boundary',async kind=>{
 const bytes=kind==='bundle'?await archive():legacyArchive(),parent=temp(),container=mkdir(path.join(parent,'container')),victim=mkdir(path.join(parent,'victim'));
 const original=fs.mkdirSync;let replaced=false;
 vi.spyOn(fs,'mkdirSync').mockImplementation(((...args:Parameters<typeof fs.mkdirSync>)=>{
  if(!replaced){replaced=true;fs.renameSync(container,container+'-old');fs.symlinkSync(victim,container);}
  return original(...args);
 }) as typeof fs.mkdirSync);
 const run=()=>kind==='bundle'?extractBundleArchiveBytes(bytes,path.join(container,'out')):Promise.resolve().then(()=>extractLegacyAgentArchiveBytes(bytes,path.join(container,'out')));
 await expect(run()).rejects.toThrow(/ancestry|changed/);expect(replaced).toBe(true);expect(fs.readdirSync(victim)).toEqual([]);
 // No rollback through the substituted pathname; retain the original private evidence.
 expect(fs.readdirSync(container+'-old')).toEqual(['out']);expect(fs.readdirSync(path.join(container+'-old','out'))).toEqual([]);
});

test('rightmost valid USTAR byte split round-trips deep ASCII and UTF-8 names deterministically',async()=>{
 const root=await bundle(),previous=(await validateBundle(root)).manifest,parent=temp();
 const names=['app/'+'a'.repeat(70)+'/'+'b'.repeat(70)+'/'+'c'.repeat(20)+'/x.js','app/'+'é'.repeat(35)+'/'+'文'.repeat(23)+'/'+'d'.repeat(20)+'/x.js'];
 for(const name of names){expect(safePath(name)).toBe(name);fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true,mode:0o700});fs.writeFileSync(path.join(root,name),'deep fixture',{mode:0o600});}
 const manifest=await createBundleManifest(root,previous);fs.writeFileSync(path.join(root,'bundle-manifest.json'),canonical(manifest)+'\n');
 await createBundleArchive(root,path.join(parent,'a'));await createBundleArchive(root,path.join(parent,'b'));
 expect(fs.readFileSync(path.join(parent,'a'))).toEqual(fs.readFileSync(path.join(parent,'b')));
 const listing=spawnSync('tar',['-tzf',path.join(parent,'a')],{encoding:'utf8',timeout:5000});expect(listing.status,listing.stderr).toBe(0);for(const name of names)expect(listing.stdout).toContain(name);
 expect((await extractBundleArchiveBytes(fs.readFileSync(path.join(parent,'a')),path.join(parent,'out'))).digest).toBe(manifest.digest);
 expect(()=>encodeBundleTar([{path:'app/'+'é'.repeat(51),mode:0o600,data:Buffer.from('x')}])).toThrow(/USTAR path bound/);
});

test('directory enumeration stops at limit+1, closes handles, and emptiness reads only once',async()=>{
 const root=temp();for(let i=0;i<8;i++)fs.writeFileSync(path.join(root,String(i)),'x');
 const opendir=fsp.opendir;let reads=0,closed=false;
 vi.spyOn(fsp,'opendir').mockImplementation(async(...args)=>{const dir=await opendir(...args),read=dir.read.bind(dir),close=dir.close.bind(dir);vi.spyOn(dir,'read').mockImplementation((async()=>{reads++;return read();}) as typeof dir.read);vi.spyOn(dir,'close').mockImplementation((async()=>{closed=true;return close();}) as typeof dir.close);return dir;});syncBuiltinESMExports();
 await expect(readDirectoryBounded(root,3)).rejects.toThrow(/entry bound/);expect(reads).toBe(4);expect(closed).toBe(true);
 expect(()=>readDirectoryBoundedSync(root,3)).toThrow(/entry bound/);expect(directoryIsEmpty(root)).toBe(false);
 expect((await readDirectoryBounded(root,8)).sort()).toEqual(['0','1','2','3','4','5','6','7']);
});

test('bundle inventory rejects an unbounded directory stream before inspecting any member',async()=>{
 const root=await bundle(),manifest=(await validateBundle(root)).manifest,opendir=fsp.opendir;let reads=0,closed=false;
 vi.spyOn(fsp,'opendir').mockImplementation(async(...args)=>{
  const dir=await opendir(...args);
  if(String(args[0])===root){
   const close=dir.close.bind(dir);
   vi.spyOn(dir,'read').mockImplementation((async()=>({name:'synthetic-'+(++reads)})) as typeof dir.read);
   vi.spyOn(dir,'close').mockImplementation((async()=>{closed=true;return close();}) as typeof dir.close);
  }
  return dir;
 });syncBuiltinESMExports();
 await expect(createBundleManifest(root,manifest)).rejects.toThrow(/entry bound/);expect(reads).toBe(8193);expect(closed).toBe(true);
});
test('source home and Node trust reject writable ancestors, retaining ordinary private source and sticky /tmp semantics',()=>{
 const root=temp(),home=mkdir(path.join(root,'home')),shared=mkdir(path.join(root,'shared'),0o777),child=mkdir(path.join(shared,'private'));
 const executable=path.join(child,'node');fs.writeFileSync(executable,'fixture',{mode:0o700});
 expect(()=>resolveKiroHome({KIRO_HOME:path.join(child,'selected')},home)).toThrow(/ancestry/);
 expect(()=>installerSafety.assertSafeDirectory(child,{private:true})).toThrow(/ancestry/);
 expect(()=>installerSafety.assertTrustedExecutable(executable)).toThrow(/ancestry/);
 fs.chmodSync(shared,0o700);expect(installerSafety.assertTrustedExecutable(executable)).toBe(executable);
 expect(resolveKiroHome({KIRO_HOME:home},root,{sourceRoot:home})).toBe(home);
 expect(captureDirectoryAncestry(home).root).toBe(home);
});

test('private manager-temp counterguards are not weakened by shared ancestry exceptions',()=>{
 const root=temp();expect(installerSafety.assertSafeDirectory(root,{private:true})).toBe(root);
 fs.chmodSync(root,0o755);expect(installerSafety.assertSafeDirectory(root)).toBe(root);
 expect(()=>installerSafety.assertSafeDirectory(root,{private:true})).toThrow(/permissions/);
 fs.chmodSync(root,0o1777);expect(()=>installerSafety.assertSafeDirectory(root,{private:true})).toThrow(/permissions/);
 fs.chmodSync(root,0o700);expect(installerSafety.assertSafeDirectory(root,{private:true})).toBe(root);
});
test('shared policy preserves only trusted root-sticky and exact macOS Applications exceptions',()=>{
 const stat={isDirectory:()=>true,isSymbolicLink:()=>false,uid:0,gid:80,mode:0o40775} as fs.Stats;
 expect(trustedDirectoryStat('/Applications',stat,{platform:'darwin',uid:1001})).toBe(true);
 for(const directory of ['/Applications/sub','/Other'])expect(trustedDirectoryStat(directory,stat,{platform:'darwin',uid:1001})).toBe(false);
 expect(trustedDirectoryStat('/Applications',{...stat,gid:81} as fs.Stats,{platform:'darwin',uid:1001})).toBe(false);
 expect(trustedDirectoryStat('/tmp',{...stat,mode:0o41777} as fs.Stats,{platform:'linux',uid:1001})).toBe(true);
 expect(trustedDirectoryStat('/tmp',{...stat,uid:1002,mode:0o41777} as fs.Stats,{platform:'linux',uid:1001})).toBe(false);
 expect(trustedDirectoryStat('/path',{...stat,uid:1001,mode:0o40777} as fs.Stats,{platform:'win32',uid:1001})).toBe(true);
});
