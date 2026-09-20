import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, expect, test, vi } from 'vitest';
import { captureDirectoryIdentity, assertDirectoryIdentity, validateDirectoryIdentity } from '../scripts/installer-directory-identity.mjs';
import { installerSafety as s } from '../scripts/install-agent-user.mjs';
import { fixture } from './bundle-fixture.js';
import { canonical, createBundleManifest, validateBundle } from '../scripts/bundle-contract.mjs';
import { installCompleteGeneration, inspectCompleteInstallation, recoverCompleteInstallation, rollbackCompleteGeneration } from '../scripts/managed-installation.mjs';
import { readTransaction } from '../scripts/install-transaction.mjs';
import { managerErrorResult } from '../scripts/install-manager.mjs';

const roots:string[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function temp(){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'installer-volume-')));roots.push(root);return root;}
const uuid='01234567-89ab-cdef-0123-456789abcdef',other='11111111-2222-3333-4444-555555555555';
const device='/dev/disk999s1';
function plist(id=uuid){return `<plist><dict><key>DeviceNode</key><string>${device}</string><key>FilesystemType</key><string>apfs</string><key>VolumeUUID</key><string>${id}</string></dict></plist>`;}
// Mock only OS volume discovery, not directory identity or installer validation.
// Integration tests run on Linux too; a separate probe uses the real macOS tool.
function volumeOS(root:string){
 const dev=fs.lstatSync(root,{bigint:true}).dev,read=fs.readdirSync,stat=fs.lstatSync,exec=childProcess.execFileSync;
 const state={xml:plist(),unavailable:false,rdev:dev,uid:0n,symlink:false,duplicate:false};
 vi.spyOn(os,'platform').mockReturnValue('darwin');
 vi.spyOn(fs,'readdirSync').mockImplementation(((file:any,...args:any[])=>String(file)==='/dev'?['disk999s1',...(state.duplicate?['disk999s2']:[])]:Reflect.apply(read,fs,[file,...args])) as any);
 vi.spyOn(fs,'lstatSync').mockImplementation(((file:any,...args:any[])=>{
  if(String(file).startsWith('/dev/disk999s'))return {dev:1n,ino:9n,rdev:state.rdev,uid:state.uid,isBlockDevice:()=>!state.symlink};
  if(String(file)==='/usr/sbin/diskutil')return {uid:0,mode:0o100755,nlink:1,isFile:()=>true,isSymbolicLink:()=>false};
  return Reflect.apply(stat,fs,[file,...args]);
 }) as any);
 const calls=vi.spyOn(childProcess,'execFileSync').mockImplementation(((file:any,...args:any[])=>{if(file!=='/usr/sbin/diskutil')return Reflect.apply(exec,childProcess,[file,...args]);if(state.unavailable)throw Error('OS volume unavailable');return state.xml;}) as any);
 return {state,calls};
}

test('stable volume plus exact inode survives dev renumber; legacy dev and null-volume never do',()=>{
 const root=temp(),{calls}=volumeOS(root),id=captureDirectoryIdentity(root);
 expect(id.volume).toEqual({kind:'darwin-apfs-volume-uuid',uuid});
 const moved={...id,dev:String(BigInt(id.dev)+1n)};
 expect(()=>assertDirectoryIdentity(root,moved,2)).not.toThrow();
 expect(()=>assertDirectoryIdentity(root,{dev:moved.dev,ino:id.ino},1)).toThrow(/device mismatch/);
 expect(()=>assertDirectoryIdentity(root,{...moved,volume:null},2)).toThrow(/device mismatch/);
 expect(()=>assertDirectoryIdentity(root,{dev:id.dev,ino:id.ino},1)).not.toThrow();
 expect(calls).toHaveBeenCalledWith('/usr/sbin/diskutil',['info','-plist',device],expect.objectContaining({timeout:3000,maxBuffer:128*1024,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'C',LC_ALL:'C'}}));
});

test.each(['wrong volume','unavailable','inode replacement','symlink directory','unsafe mode'])('stable identity refuses %s even with matching dev',kind=>{
 const root=temp(),dir=path.join(root,'owned');fs.mkdirSync(dir,{mode:0o700});const {state}=volumeOS(root),id=captureDirectoryIdentity(dir);
 if(kind==='wrong volume')state.xml=plist(other);
 if(kind==='unavailable')state.unavailable=true;
 if(kind==='inode replacement'){fs.renameSync(dir,dir+'.original');fs.mkdirSync(dir,{mode:0o700});}
 if(kind==='symlink directory'){fs.renameSync(dir,dir+'.original');fs.symlinkSync(dir+'.original',dir);}
 if(kind==='unsafe mode')fs.chmodSync(dir,0o770);
 expect(()=>assertDirectoryIdentity(dir,id,2)).toThrow();
});

test.each(['missing UUID','duplicate UUID','wrong node','container UUID only','unsupported filesystem','non-root device','wrong rdev','non-block device','duplicate device'])('OS discovery refuses %s and never invents stable evidence',kind=>{
 const root=temp(),{state}=volumeOS(root);
 if(kind==='missing UUID')state.xml=plist().replace(/<key>VolumeUUID<\/key><string>[^<]+<\/string>/,'');
 if(kind==='duplicate UUID')state.xml=plist()+`<key>VolumeUUID</key><string>${uuid}</string>`;
 if(kind==='wrong node')state.xml=plist().replace(device,'/dev/disk998');
 if(kind==='container UUID only')state.xml=plist().replace('VolumeUUID','APFSVolumeGroupID');
 if(kind==='unsupported filesystem')state.xml=plist().replace('apfs','nfs');
 if(kind==='non-root device')state.uid=123n;
 if(kind==='wrong rdev')state.rdev++;
 if(kind==='non-block device')state.symlink=true;
 if(kind==='duplicate device')state.duplicate=true;
 expect(captureDirectoryIdentity(root).volume).toBeNull();
 const st=fs.lstatSync(root,{bigint:true});
 expect(()=>assertDirectoryIdentity(root,{dev:String(st.dev),ino:String(st.ino),volume:{kind:'darwin-apfs-volume-uuid',uuid}},2)).toThrow(/volume mismatch or unavailable/);
});

test.each([
 {dev:'1',ino:'2',volume:{kind:'container-uuid',uuid}},
 {dev:'1',ino:'2',volume:{kind:'darwin-apfs-volume-uuid',uuid:uuid.toUpperCase()}},
 {dev:'1',ino:'2',volume:{kind:'darwin-apfs-volume-uuid',uuid,extra:true}},
 {dev:1,ino:'2',volume:null}, {dev:'1',ino:'02',volume:null}, {dev:'1',ino:'2'},
])('versioned identity rejects malformed or downgraded shape %#',id=>expect(()=>validateDirectoryIdentity(id,2)).toThrow(/schema invalid/));

test('unsupported platform retains exact device checks',()=>{
 const root=temp();vi.spyOn(os,'platform').mockReturnValue('linux');const id=captureDirectoryIdentity(root);
 expect(id.volume).toBeNull();expect(()=>assertDirectoryIdentity(root,id,2)).not.toThrow();
 expect(()=>assertDirectoryIdentity(root,{...id,dev:String(BigInt(id.dev)+1n)},2)).toThrow(/device mismatch/);
});

test.skipIf(process.platform!=='darwin')('native APFS volume query binds temporary directory, not installation state',()=>{
 const root=temp(),id=captureDirectoryIdentity(root);expect(id.volume?.kind).toBe('darwin-apfs-volume-uuid');
 expect(()=>assertDirectoryIdentity(root,{...id,dev:String(BigInt(id.dev)+1n)},2)).not.toThrow();
 expect(()=>assertDirectoryIdentity(root,{...id,volume:{kind:'darwin-apfs-volume-uuid',uuid:other}},2)).toThrow(/volume mismatch/);
});

async function setup(){const root=temp(),bundle=await fixture();roots.push(bundle);const userHome=path.join(root,'home'),kiroHome=path.join(userHome,'.kiro');fs.mkdirSync(userHome,{mode:0o700});volumeOS(root);return {root,bundle,kiroHome,opts:{kiroHome,userHome,env:{},provenance:'source',validateCandidate:async()=>{}}};}
async function change(bundle:string,value='next'){const prior=(await validateBundle(bundle)).manifest;fs.writeFileSync(path.join(bundle,'app/main.js'),value);const next=await createBundleManifest(bundle,prior);fs.writeFileSync(path.join(bundle,'bundle-manifest.json'),canonical(next)+'\n');return next.digest;}
function transform(file:string,edit:(r:any)=>void,snapshot=false){const r=JSON.parse(fs.readFileSync(file,'utf8'));edit(r);const raw=JSON.stringify(r,null,2)+'\n';if(snapshot){fs.unlinkSync(file);file=path.join(path.dirname(file),r.generation+'.'+s.hash(raw)+'.json');}fs.writeFileSync(file,raw,{mode:0o600});return file;}
function identities(r:any){return [r.baseIdentity,r.storeIdentity,r.stageIdentity].filter(Boolean);}
function renumber(r:any){for(const id of identities(r))id.dev=String(BigInt(id.dev)+101n);}
function legacy(r:any){r.schemaVersion=1;for(const id of identities(r))delete id.volume;}
function snapshotFiles(base:string){const store=path.join(base,'profile-snapshots');return fs.existsSync(store)?fs.readdirSync(store).map(n=>path.join(store,n)):[];}
function evidence(p:any){return [p.profile,p.launcher,p.manifest,p.journal,path.join(p.base,'.transactions/candidate.json'),...snapshotFiles(p.base)].filter(file=>fs.existsSync(file)).map(file=>({file,raw:fs.readFileSync(file)}));}
function unchanged(records:ReturnType<typeof evidence>){for(const {file,raw} of records)expect(fs.readFileSync(file)).toEqual(raw);}

test('renumbered snapshots inspect without rewriting and rollback preserves original profile and owner schema',async()=>{
 const f=await setup(),a=await installCompleteGeneration(f.bundle,f.opts),profile=fs.readFileSync(a.paths.profile);await change(f.bundle);await installCompleteGeneration(f.bundle,f.opts);
 const snapshots=snapshotFiles(a.paths.base).map(file=>transform(file,renumber,true)),before=evidence(a.paths);
 expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('active');expect((await recoverCompleteInstallation(f.kiroHome)).recovered).toBe(false);unchanged(before);
 const result=await rollbackCompleteGeneration(f.kiroHome,{validateCandidate:async()=>{}});
 expect(result.owner.currentRuntime).toBe(a.digest);expect(result.owner.schemaVersion).toBe(3);expect(Object.keys(result.owner)).toEqual(Object.keys(a.owner));expect(fs.readFileSync(a.paths.profile)).toEqual(profile);
 for(const file of snapshots)expect(fs.readFileSync(file)).toEqual(before.find(r=>r.file===file)!.raw);
});

test.each(['candidate-root-owned','copied:app/main.js','generation-published','profile-published','owner-committed'])('offline replay after %s accepts only UUID-bound renumbered evidence',async phase=>{
 const f=await setup(),a=await installCompleteGeneration(f.bundle,f.opts),owner=fs.readFileSync(a.paths.manifest),profile=fs.readFileSync(a.paths.profile),next=await change(f.bundle);
 fs.writeFileSync(path.join(a.paths.data,'fabric/sentinel'),'keep',{mode:0o600});
 await expect(installCompleteGeneration(f.bundle,{...f.opts,onPhase:(p:string)=>{if(p===phase)throw Error('interrupted');}})).rejects.toThrow('interrupted');
 for(const file of [a.paths.journal,path.join(a.paths.base,'.transactions/candidate.json')])if(fs.existsSync(file))transform(file,renumber);
 for(const file of snapshotFiles(a.paths.base))transform(file,renumber,true);
 const snapshots=evidence(a.paths).filter(r=>r.file.includes('/profile-snapshots/'));
 if(fs.existsSync(a.paths.journal))expect(readTransaction(f.kiroHome)?.schemaVersion).toBe(2);
 const recovered=await recoverCompleteInstallation(f.kiroHome,{validateCandidate:()=>{throw Error('no smoke during recovery');}});
 expect(recovered).toMatchObject({recovered:true,committed:phase==='owner-committed',status:'active'});
 expect(recovered.owner.currentRuntime).toBe(phase==='owner-committed'?next:a.digest);
 if(phase!=='owner-committed'){expect(fs.readFileSync(a.paths.manifest)).toEqual(owner);expect(fs.readFileSync(a.paths.profile)).toEqual(profile);}
 unchanged(snapshots);expect(fs.readFileSync(path.join(a.paths.data,'fabric/sentinel'),'utf8')).toBe('keep');expect((await recoverCompleteInstallation(f.kiroHome)).recovered).toBe(false);
});

test.each(['snapshot','transaction','candidate'])('legacy %s accepts matching dev/ino but ambiguous renumber never mutates evidence',async kind=>{
 const f=await setup(),a=await installCompleteGeneration(f.bundle,f.opts);await change(f.bundle);
 if(kind==='snapshot')await installCompleteGeneration(f.bundle,f.opts);
 else await expect(installCompleteGeneration(f.bundle,{...f.opts,onPhase:(p:string)=>{if(p==='profile-published')throw Error('interrupted');}})).rejects.toThrow('interrupted');
 let file=kind==='snapshot'?snapshotFiles(a.paths.base)[0]!:kind==='transaction'?a.paths.journal:path.join(a.paths.base,'.transactions/candidate.json');
 file=transform(file,legacy,kind==='snapshot');
 if(kind==='snapshot')expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('active');
 if(kind==='transaction')expect(readTransaction(f.kiroHome)?.schemaVersion).toBe(1);
 const original=fs.readFileSync(file);file=transform(file,renumber,kind==='snapshot');const before=evidence(a.paths);
 const failure=await recoverCompleteInstallation(f.kiroHome).catch(e=>e);
 expect(failure).toMatchObject({code:'INSTALL_DIRECTORY_IDENTITY',recoveryRequired:true});expect(managerErrorResult(failure)).toMatchObject({exitCode:7,dataPreserved:true});unchanged(before);
 // Restore the fixture's original known identity, not production auto-repair.
 if(kind==='snapshot'){fs.unlinkSync(file);file=path.join(path.dirname(file),JSON.parse(original.toString()).generation+'.'+s.hash(original)+'.json');}fs.writeFileSync(file,original,{mode:0o600});
 expect((await recoverCompleteInstallation(f.kiroHome)).status).toBe('active');
});

test.each(['foreign profile','foreign candidate bytes','foreign snapshot'])('matching volume evidence cannot authorize %s',async kind=>{
 const f=await setup(),a=await installCompleteGeneration(f.bundle,f.opts);await change(f.bundle);
 await expect(installCompleteGeneration(f.bundle,{...f.opts,onPhase:(p:string)=>{if(p==='profile-published')throw Error('interrupted');}})).rejects.toThrow('interrupted');
 const marker=path.join(a.paths.base,'.transactions/candidate.json');
 for(const file of [a.paths.journal,marker])transform(file,renumber);
 for(const file of snapshotFiles(a.paths.base))transform(file,renumber,true);
 let foreign=a.paths.profile;
 if(kind==='foreign snapshot')foreign=snapshotFiles(a.paths.base)[0]!;
 if(kind==='foreign candidate bytes')foreign=path.join(a.paths.runtime,JSON.parse(fs.readFileSync(marker,'utf8')).manifest.digest,'app/main.js');
 fs.appendFileSync(foreign,'foreign');const original=fs.readFileSync(foreign),before=evidence(a.paths);
 await expect(recoverCompleteInstallation(f.kiroHome)).rejects.toThrow();
 // Candidate content conflicts may be found after precommit controls have been
 // restored, but the unknown bytes and candidate ownership marker must survive.
 if(kind!=='foreign candidate bytes')unchanged(before);
 else expect(fs.readFileSync(marker)).toEqual(before.find(r=>r.file===marker)!.raw);
 expect(fs.readFileSync(foreign)).toEqual(original);
});

// Exact pre-change implementation, including its strict sidecar readers. This
// deliberately does NOT equate unchanged owner fields with manager compatibility.
function oldManager(f:Awaited<ReturnType<typeof setup>>){
 const scripts=fileURLToPath(new URL('../scripts/',import.meta.url)),history=fileURLToPath(new URL('./fixtures/installer-history/020d86c/',import.meta.url));
 const hashes:Record<string,string>={'managed-installation':'2bf7d18abd798c5e5875d5ac893f49208304111bfc7ba132c4f769079e0e43c2','installer-profile-store':'eda234d4b320a8bb8ca0e8481fa76b9804d6616a5eb2177131fea3aa9a9e9dc2','install-transaction':'1a58dca0784c726dcd83a139dc9760d7f88c939283e5c7ba0d2a7f1733991c08'};
 const target=path.join(f.root,'historical-manager');fs.mkdirSync(target,{mode:0o700});
 for(const [name,hash] of Object.entries(hashes)){
  const source=fs.readFileSync(path.join(history,name+'.mjs.txt'),'utf8');expect(s.hash(source)).toBe(hash);
  fs.writeFileSync(path.join(target,name+'.mjs'),source.replace(/from (['"])(\.\/[^'"]+)\1/g,(_m,q,relative)=>{
   const local=Object.hasOwn(hashes,path.basename(relative,'.mjs'));
   return `from ${q}${pathToFileURL(path.resolve(local?target:scripts,relative)).href}${q}`;
  }),{mode:0o600});
 }
 return (body:string)=>{
  const result=childProcess.spawnSync(process.execPath,['--input-type=module','-e',`import * as old from ${JSON.stringify(pathToFileURL(path.join(target,'managed-installation.mjs')).href)};const opts=${JSON.stringify(f.opts)};opts.validateCandidate=async()=>{};${body}`],{encoding:'utf8',env:{HOME:f.opts.userHome,KIRO_HOME:f.kiroHome,PATH:''},timeout:15000});
  expect(result.error).toBeUndefined();return result;
 };
}
const oldInstall='console.log(JSON.stringify(await old.installCompleteGeneration(BUNDLE,opts)));';

test('strict 020d86c manager accepts unchanged owner fields but refuses new snapshot sidecars without mutation',async()=>{
 const f=await setup(),run=oldManager(f),install=oldInstall.replace('BUNDLE',JSON.stringify(f.bundle));
 const first=run(install);expect(first.status,first.stderr).toBe(0);const a=JSON.parse(first.stdout);
 await change(f.bundle);const second=run(install);expect(second.status,second.stderr).toBe(0);
 for(const file of snapshotFiles(a.paths.base))expect(JSON.parse(fs.readFileSync(file,'utf8')).schemaVersion).toBe(1);
 expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('active');
 // Prove the actual archived manager still checks exact ownership fields.
 const owner=fs.readFileSync(a.paths.manifest);transform(a.paths.manifest,r=>{r.unrecognizedIdentityClaim=true;});
 const extra=run('await old.inspectCompleteInstallation(opts.kiroHome);');expect(extra.status).not.toBe(0);expect(extra.stderr).toContain('invalid ownership fields');fs.writeFileSync(a.paths.manifest,owner);
 const healthy=run('await old.inspectCompleteInstallation(opts.kiroHome);');expect(healthy.status,healthy.stderr).toBe(0);
 await change(f.bundle,'third');const current=await installCompleteGeneration(f.bundle,f.opts);expect(Object.keys(current.owner)).toEqual(Object.keys(a.owner));
 const before=evidence(a.paths),refused=run('await old.inspectCompleteInstallation(opts.kiroHome);');
 expect(refused.status).not.toBe(0);expect(refused.stderr).toContain('Profile snapshot identity mismatch');unchanged(before);
 expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('active');
});

test.each(['journal-synced','candidate-root-owned'])('actual strict old manager refuses schema-2 evidence at %s without replay',async phase=>{
 const f=await setup(),run=oldManager(f),a=await installCompleteGeneration(f.bundle,f.opts);await change(f.bundle);
 await expect(installCompleteGeneration(f.bundle,{...f.opts,onPhase:(p:string)=>{if(p===phase)throw Error('interrupted');}})).rejects.toThrow('interrupted');
 const before=evidence(a.paths),refused=run('await old.recoverCompleteInstallation(opts.kiroHome);');expect(refused.status).not.toBe(0);
 expect(refused.stderr).toMatch(/invalid journal fields|journal identity|invalid ownership fields|candidate identity/);unchanged(before);
});

test.each(['snapshot','transaction','candidate'])('actual old-manager legacy %s with same inode/different stored dev remains ambiguous and fail-closed',async kind=>{
 const f=await setup(),run=oldManager(f),install=oldInstall.replace('BUNDLE',JSON.stringify(f.bundle)),first=run(install);expect(first.status,first.stderr).toBe(0);const a=JSON.parse(first.stdout);await change(f.bundle);
 const phase=kind==='transaction'?'profile-published':'candidate-root-owned';
 const second=run((kind==='snapshot'?'':`opts.onPhase=p=>{if(p===${JSON.stringify(phase)})throw Error('fixture interruption');};`)+install);
 if(kind==='snapshot')expect(second.status,second.stderr).toBe(0);else {expect(second.status).not.toBe(0);expect(second.stderr).toContain('fixture interruption');}
 const file=kind==='snapshot'?snapshotFiles(a.paths.base)[0]!:kind==='transaction'?a.paths.journal:path.join(a.paths.base,'.transactions/candidate.json');
 const record=JSON.parse(fs.readFileSync(file,'utf8'));expect(record.schemaVersion).toBe(1);for(const id of identities(record))expect(Object.keys(id)).toEqual(['dev','ino']);
 // Alter only fixture evidence to reproduce the observed mismatch, without
 // claiming what caused it or supplying invented prior UUID evidence.
 transform(file,renumber,kind==='snapshot');const before=evidence(a.paths);
 await expect(recoverCompleteInstallation(f.kiroHome)).rejects.toMatchObject({code:'INSTALL_DIRECTORY_IDENTITY',recoveryRequired:true});unchanged(before);
 const cli=childProcess.spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/install-manager.mjs',import.meta.url)),'recover','--kiro-home',f.kiroHome,'--yes','--non-interactive','--json'],{encoding:'utf8',env:{HOME:f.opts.userHome,KIRO_HOME:f.kiroHome,PATH:''},timeout:15000});
 expect(cli.error).toBeUndefined();expect(cli.status,cli.stderr).toBe(7);expect(JSON.parse(cli.stdout)).toMatchObject({exitCode:7,recoveryRequired:true,dataPreserved:true});unchanged(before);
});

test.each(['candidate volume','candidate inode','snapshot volume','transaction volume'])('wrong %s blocks BEFORE replay restores any live controls',async kind=>{
 const f=await setup(),a=await installCompleteGeneration(f.bundle,f.opts);await change(f.bundle);
 await expect(installCompleteGeneration(f.bundle,{...f.opts,onPhase:(p:string)=>{if(p==='profile-published')throw Error('interrupted');}})).rejects.toThrow('interrupted');
 if(kind.startsWith('candidate'))transform(path.join(a.paths.base,'.transactions/candidate.json'),r=>{if(kind.endsWith('inode'))r.stageIdentity.ino=String(BigInt(r.stageIdentity.ino)+1n);else r.stageIdentity.volume.uuid=other;});
 if(kind==='snapshot volume')transform(snapshotFiles(a.paths.base)[0]!,r=>{r.storeIdentity.volume.uuid=other;},true);
 if(kind==='transaction volume')transform(a.paths.journal,r=>{r.baseIdentity.volume.uuid=other;});
 const before=evidence(a.paths);await expect(recoverCompleteInstallation(f.kiroHome)).rejects.toThrow(/identity/);unchanged(before);
});
