import { removeFixtureSync } from "./fixture-cleanup.mjs";
import { test, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fixture } from './bundle-fixture.js';
import { canonical, createBundleManifest, validateBundle } from '../scripts/bundle-contract.mjs';
import { installCompleteGeneration, inspectCompleteInstallation, recoverCompleteInstallation, rollbackCompleteGeneration, retireCompleteInstallation } from '../scripts/managed-installation.mjs';
import { acquireInstallationLock } from '../scripts/installer-lock.mjs';
import { installerSafety as s } from '../scripts/install-agent-user.mjs';
import { hasInstallationRecovery } from './installer-capability-fixture.js';

async function setup() {
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'lifecycle-controls-'))),bundle=await fixture(),userHome=path.join(root,'home'),kiroHome=path.join(userHome,'.kiro');
 fs.mkdirSync(userHome,{mode:0o700});
 const opts={kiroHome,userHome,env:{},provenance:'source',validateCandidate:async(root:string)=>{await validateBundle(root);}};
 return {root,bundle,userHome,kiroHome,opts,cleanup(){removeFixtureSync(root,{recursive:true,force:true});removeFixtureSync(bundle,{recursive:true,force:true});}};
}
async function change(bundle:string,value='next') {const prior=(await validateBundle(bundle)).manifest;fs.writeFileSync(path.join(bundle,'app/main.js'),value);const next=await createBundleManifest(bundle,prior);fs.writeFileSync(path.join(bundle,'bundle-manifest.json'),canonical(next)+'\n');return next.digest;}
const interruption=(phase:string)=>({onPhase:(p:string)=>{if(p===phase)throw Error('fixture interruption');}});

// Actual c0f65e9 modules, NOT reimplemented expectations. Only relative import
// specifiers are relocated. No archived manager is executed out of user data.
test('real c0f65e9 -> current -> rollback restores original profile and passes BOTH inspectors',async()=>{
 const f=await setup();try {
  const repo=fileURLToPath(new URL('../',import.meta.url)),scripts=path.join(repo,'scripts');
  const oldProfile=path.join(f.root,'historical-agent-profile.mjs'),oldManager=path.join(f.root,'historical-managed.mjs');
  const history=path.join(repo,'tests/fixtures/installer-history/c0f65e9');
  const profileBytes=fs.readFileSync(path.join(history,'agent-profile.mjs.txt'));
  const source=fs.readFileSync(path.join(history,'managed-installation.mjs.txt'),'utf8');
  // Exact historical blobs; tests require neither Git nor a full-history clone.
  expect(s.hash(profileBytes)).toBe('b89b9985afddb38fa281ba56e4dd8d0156a9e348ea9f63a3ce0a37719466b91f');
  expect(s.hash(source)).toBe('1d746e5539f4e916ead5150e7bf743c6b0c9fa9562320b98cead1efb37fb0c37');
  fs.writeFileSync(oldProfile,profileBytes,{mode:0o600});
  fs.writeFileSync(oldManager,source.replace(/from (['"])(\.\/[^'"]+)\1/g,(_m,q,relative)=>`from ${q}${pathToFileURL(relative==='./agent-profile.mjs'?oldProfile:path.resolve(scripts,relative)).href}${q}`),{mode:0o600});
  const run=(code:string)=>spawnSync(process.execPath,['--input-type=module','-e',`import * as old from ${JSON.stringify(pathToFileURL(oldManager).href)};${code}`],{encoding:'utf8',env:{HOME:f.userHome,KIRO_HOME:f.kiroHome,PATH:''},timeout:15000});
  const installed=run(`console.log(JSON.stringify(await old.installCompleteGeneration(${JSON.stringify(f.bundle)},{...${JSON.stringify(f.opts)},validateCandidate:async()=>{}})));`);
  expect(installed.status,installed.stderr).toBe(0);const a=JSON.parse(installed.stdout),original=fs.readFileSync(a.paths.profile);
  expect(JSON.parse(original.toString()).mcpServers.fabric.env.KIRO_FABRIC_RUN_DECLARATION).toBeUndefined();
  expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('active');
  fs.writeFileSync(path.join(a.paths.data,'fabric/sentinel'),'retained user state',{mode:0o600});
  await change(f.bundle);const b=await installCompleteGeneration(f.bundle,f.opts);
  // Negative compatibility control: the real old inspector detects HEAD's new
  // profile declaration. This reproduces the previously committed rollback bug.
  const incompatible=run(`await old.inspectCompleteInstallation(${JSON.stringify(f.kiroHome)});`);
  expect(incompatible.status).not.toBe(0);expect(incompatible.stderr).toContain('profile generation binding mismatch');
  let checked=false;
  const rollback=await rollbackCompleteGeneration(f.kiroHome,{validateCandidate:async(root:string,context:any)=>{
   checked=true;expect((await validateBundle(root)).digest).toBe(a.digest);
   expect(Buffer.from(JSON.stringify(context.profile,null,2)+'\n')).toEqual(original);
  }});
  expect(checked).toBe(true);expect(rollback.owner.currentRuntime).toBe(a.digest);expect(rollback.owner.previousRuntime).toBe(b.digest);
  expect(Object.keys(rollback.owner)).toEqual(Object.keys(a.owner));expect(fs.readFileSync(a.paths.profile)).toEqual(original);
  expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('active');
  const compatible=run(`console.log((await old.inspectCompleteInstallation(${JSON.stringify(f.kiroHome)})).status);`);
  expect(compatible.status,compatible.stderr).toBe(0);expect(compatible.stdout.trim()).toBe('active');
  expect(fs.readFileSync(a.paths.launcher,'utf8')).toContain(a.digest);
  expect(fs.readFileSync(path.join(a.paths.data,'fabric/sentinel'),'utf8')).toBe('retained user state');
 } finally {f.cleanup();}
});

test('retained target without original profile evidence refuses BEFORE candidate validation or controls',async()=>{
 const f=await setup();try {const a=await installCompleteGeneration(f.bundle,f.opts);await change(f.bundle);await installCompleteGeneration(f.bundle,f.opts);
  const store=path.join(a.paths.base,'profile-snapshots');for(const name of fs.readdirSync(store))fs.unlinkSync(path.join(store,name));fs.rmdirSync(store);
  const before=fs.readFileSync(a.paths.manifest);let called=false;
  await expect(rollbackCompleteGeneration(f.kiroHome,{validateCandidate:async()=>{called=true;}})).rejects.toThrow(/Target-compatible profile unavailable/);
  expect(called).toBe(false);expect(fs.readFileSync(a.paths.manifest)).toEqual(before);expect(fs.readdirSync(path.dirname(a.paths.journal))).toEqual([]);
 }finally{f.cleanup();}
});

test.each(['bytes','hardlink','directory mode','foreign file','copied installation','strict tools'])('profile snapshot guard preserves %s evidence',async kind=>{
 const f=await setup();try {const a=await installCompleteGeneration(f.bundle,f.opts);await change(f.bundle);await installCompleteGeneration(f.bundle,f.opts);
  const store=path.join(a.paths.base,'profile-snapshots');let record=path.join(store,fs.readdirSync(store)[0]!);
  if(kind==='bytes')fs.appendFileSync(record,'changed');
  if(kind==='hardlink')fs.linkSync(record,path.join(f.root,'external-link'));
  if(kind==='directory mode')fs.chmodSync(store,0o750);
  if(kind==='foreign file')fs.writeFileSync(path.join(store,'unknown'),'keep',{mode:0o600});
  if(kind==='copied installation'||kind==='strict tools'){
   const r=JSON.parse(fs.readFileSync(record,'utf8'));
   if(kind==='copied installation')r.installationId='f'.repeat(32);
   else {const owner=JSON.parse(Buffer.from(r.ownerBase64,'base64').toString()),profile=JSON.parse(Buffer.from(r.profileBase64,'base64').toString());profile.tools.push('execute_bash');const raw=JSON.stringify(profile,null,2)+'\n';owner.profileSha256=s.hash(raw);r.ownerBase64=Buffer.from(JSON.stringify(owner,null,2)+'\n').toString('base64');r.profileBase64=Buffer.from(raw).toString('base64');}
   const bytes=JSON.stringify(r,null,2)+'\n';fs.unlinkSync(record);record=path.join(store,r.generation+'.'+s.hash(bytes)+'.json');fs.writeFileSync(record,bytes,{mode:0o600});
  }
  const before=fs.readFileSync(a.paths.manifest),evidence=fs.readFileSync(record);
  await expect(rollbackCompleteGeneration(f.kiroHome,{validateCandidate:f.opts.validateCandidate})).rejects.toThrow();
  expect(fs.readFileSync(a.paths.manifest)).toEqual(before);expect(fs.readFileSync(record)).toEqual(evidence);
 }finally{f.cleanup();}
});

test('offline recovery is read-only for absent/healthy/retired states and has no prerequisites',async()=>{
 const f=await setup();try {
  expect(await recoverCompleteInstallation(f.kiroHome,{env:{PATH:''}})).toMatchObject({outcome:'noop',status:'absent',recovered:false,committed:false,owner:null,dataPreserved:true});
  expect(fs.existsSync(f.kiroHome)).toBe(false);
  const a=await installCompleteGeneration(f.bundle,f.opts),before=fs.readFileSync(a.paths.manifest),mtime=fs.statSync(a.paths.manifest).mtimeMs;
  expect(await recoverCompleteInstallation(f.kiroHome)).toMatchObject({outcome:'noop',status:'active',recovered:false});
  expect(fs.readFileSync(a.paths.manifest)).toEqual(before);expect(fs.statSync(a.paths.manifest).mtimeMs).toBe(mtime);
  await retireCompleteInstallation(f.kiroHome);expect((await recoverCompleteInstallation(f.kiroHome)).status).toBe('retired');
 }finally{f.cleanup();}
});

test.each(['candidate-root-owned','copied:app/main.js','generation-published','profile-published','owner-committed'])('offline recovery reconciles only existing evidence after %s',async phase=>{
 const f=await setup();try {
  const a=await installCompleteGeneration(f.bundle,f.opts);fs.writeFileSync(path.join(a.paths.data,'fabric/sentinel'),'keep',{mode:0o600});await change(f.bundle);
  await expect(installCompleteGeneration(f.bundle,{...f.opts,...interruption(phase)})).rejects.toThrow('fixture interruption');
  const recovered=await recoverCompleteInstallation(f.kiroHome,{env:{PATH:''},validateCandidate:()=>{throw Error('must not run smoke');},onPhase:(phase:string)=>{expect(phase).not.toBe('before-candidate-validation');}});
  expect(recovered).toMatchObject({outcome:'recovered',recovered:true,committed:phase==='owner-committed',dataPreserved:true,status:'active'});
  expect(recovered.owner.currentRuntime===a.digest).toBe(phase!=='owner-committed');
  expect(fs.readdirSync(path.dirname(a.paths.journal))).toEqual([]);expect(fs.readdirSync(a.paths.runtime)).toHaveLength(phase==='owner-committed'?2:1);
  expect(await recoverCompleteInstallation(f.kiroHome)).toMatchObject({outcome:'noop',recovered:false,committed:false});
  expect(fs.readFileSync(path.join(a.paths.data,'fabric/sentinel'),'utf8')).toBe('keep');
 }finally{f.cleanup();}
});

test('offline first-install candidate cleanup stays absent, never activates',async()=>{
 const f=await setup();try{await expect(installCompleteGeneration(f.bundle,{...f.opts,...interruption('generation-published')})).rejects.toThrow();
  expect(await recoverCompleteInstallation(f.kiroHome)).toMatchObject({status:'absent',owner:null,recovered:true,committed:false});
  expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('absent');
 }finally{f.cleanup();}
});

test.each(['journal schema','foreign profile','partial candidate','unknown transaction','home alias','live lock'])('offline recovery preserves/refuses %s',async kind=>{
 const f=await setup();let unlock:(()=>void)|undefined;try{
  const a=await installCompleteGeneration(f.bundle,f.opts);await change(f.bundle);
  if(kind!=='live lock'&&kind!=='home alias')await expect(installCompleteGeneration(f.bundle,{...f.opts,...interruption(kind==='partial candidate'?'copied:app/main.js':'profile-published')})).rejects.toThrow();
  let evidence=a.paths.manifest;
  if(kind==='journal schema'){evidence=a.paths.journal;const j=JSON.parse(fs.readFileSync(evidence,'utf8'));j.schemaVersion=99;fs.writeFileSync(evidence,JSON.stringify(j));}
  if(kind==='foreign profile'){evidence=a.paths.profile;fs.writeFileSync(evidence,'foreign bytes');}
  if(kind==='partial candidate'){const stage=fs.readdirSync(a.paths.runtime).find(n=>n.startsWith('.candidate-'))!;evidence=path.join(a.paths.runtime,stage,'app/main.js');fs.writeFileSync(evidence,'partial');}
  if(kind==='unknown transaction'){evidence=path.join(path.dirname(a.paths.journal),'foreign.json');fs.writeFileSync(evidence,'unknown',{mode:0o600});}
  let home=f.kiroHome;if(kind==='home alias'){home=path.join(f.root,'alias');fs.symlinkSync(f.kiroHome,home);}
  if(kind==='live lock')unlock=acquireInstallationLock(a.paths.base);
  const before=fs.readFileSync(evidence);await expect(recoverCompleteInstallation(home)).rejects.toThrow();expect(fs.readFileSync(evidence)).toEqual(before);
 }finally{unlock?.();f.cleanup();}
});

test.each(['owner fields','generation profile','native tools','release schema','snapshot','foreign runtime'])('offline preflight preserves all controls and journal for %s conflict',async kind=>{
 const f=await setup();try{
  const a=await installCompleteGeneration(f.bundle,f.opts);await change(f.bundle);
  await expect(installCompleteGeneration(f.bundle,{...f.opts,...interruption('profile-published')})).rejects.toThrow();
  const j=JSON.parse(fs.readFileSync(a.paths.journal,'utf8'));
  if(['owner fields','generation profile','native tools','release schema'].includes(kind)){
   const owner=JSON.parse(Buffer.from(j.controls.manifest.after,'base64').toString());
   const replace=(name:string,raw:string)=>{j.controls[name].after=Buffer.from(raw).toString('base64');j.controls[name].afterSha256=s.hash(raw);};
   if(kind==='owner fields')owner.unknown=true;
   if(kind==='generation profile'||kind==='native tools'){
    const profile=JSON.parse(Buffer.from(j.controls.profile.after,'base64').toString());
    if(kind==='generation profile')profile.mcpServers.fabric.env.KIRO_FABRIC_RUNTIME_ROOT='/unbound/runtime';else profile.tools.push('execute_bash');
    const raw=JSON.stringify(profile,null,2)+'\n';replace('profile',raw);owner.profileSha256=s.hash(raw);fs.writeFileSync(a.paths.profile,raw);
   }
   if(kind==='release schema'){const raw=JSON.stringify({schema:99})+'\n';replace('releaseState',raw);owner.releaseStateSha256=s.hash(raw);}
   replace('manifest',JSON.stringify(owner,null,2)+'\n');j.afterOwnerSha256=j.controls.manifest.afterSha256;fs.writeFileSync(a.paths.journal,JSON.stringify(j)+'\n');
  }
  if(kind==='snapshot'){const store=path.join(a.paths.base,'profile-snapshots');fs.appendFileSync(path.join(store,fs.readdirSync(store)[0]!), 'foreign');}
  if(kind==='foreign runtime')fs.mkdirSync(path.join(a.paths.runtime,'foreign'),{mode:0o700});
  const controls=[a.paths.journal,a.paths.manifest,a.paths.profile],before=controls.map(file=>fs.readFileSync(file));
  await expect(recoverCompleteInstallation(f.kiroHome)).rejects.toThrow();expect(controls.map(file=>fs.readFileSync(file))).toEqual(before);
 }finally{f.cleanup();}
});

test('a reused snapshot is directory-synced again before any live-control transaction',async()=>{
 const f=await setup();let spy:ReturnType<typeof vi.spyOn>|undefined;try{
  const a=await installCompleteGeneration(f.bundle,f.opts),owner=fs.readFileSync(a.paths.manifest),store=path.join(a.paths.base,'profile-snapshots');await change(f.bundle);
  const original=fs.fsyncSync;let failed=false;
  spy=vi.spyOn(fs,'fsyncSync').mockImplementation(fd=>{const st=fs.fstatSync(fd),target=fs.existsSync(store)?fs.statSync(store):null;if(target&&st.isDirectory()&&st.dev===target.dev&&st.ino===target.ino){failed=true;throw Error('fixture snapshot parent fsync');}return original(fd);});
  await expect(installCompleteGeneration(f.bundle,f.opts)).rejects.toThrow('fixture snapshot parent fsync');expect(failed).toBe(true);expect(fs.readFileSync(a.paths.manifest)).toEqual(owner);
  spy.mockRestore();let synced=false;const target=fs.statSync(store);
  spy=vi.spyOn(fs,'fsyncSync').mockImplementation(fd=>{const st=fs.fstatSync(fd);if(st.isDirectory()&&st.dev===target.dev&&st.ino===target.ino)synced=true;return original(fd);});
  await installCompleteGeneration(f.bundle,{...f.opts,onPhase:(p:string)=>{if(p==='journal-synced')expect(synced).toBe(true);}});
  expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('active');
 }finally{spy?.mockRestore();f.cleanup();}
});

test('offline postcommit fsync failure reports the prior actual commit, retaining replay evidence',async()=>{
 const f=await setup();let spy:ReturnType<typeof vi.spyOn>|undefined;try{
  const a=await installCompleteGeneration(f.bundle,f.opts);await change(f.bundle);
  await expect(installCompleteGeneration(f.bundle,{...f.opts,...interruption('owner-committed')})).rejects.toThrow();
  const parent=fs.statSync(a.paths.base),original=fs.fsyncSync;let armed=false,failed=false;
  spy=vi.spyOn(fs,'fsyncSync').mockImplementation(fd=>{const st=fs.fstatSync(fd);if(armed&&!failed&&st.isDirectory()&&st.dev===parent.dev&&st.ino===parent.ino){failed=true;throw Error('fixture replay fsync');}return original(fd);});
  await expect(recoverCompleteInstallation(f.kiroHome,{onPhase:(phase:string)=>{if(phase==='acquired')armed=true;}})).rejects.toMatchObject({message:'fixture replay fsync',committed:true,recoveryRequired:true});
  expect(failed).toBe(true);expect(fs.existsSync(a.paths.journal)).toBe(true);spy.mockRestore();
  expect(await recoverCompleteInstallation(f.kiroHome)).toMatchObject({recovered:true,committed:true});
 }finally{spy?.mockRestore();f.cleanup();}
});

test.each([undefined,'original','different'])('postcommit rollback retry preserves explicit target semantics (%s)',async target=>{
 const f=await setup();try{
  const a=await installCompleteGeneration(f.bundle,f.opts);await change(f.bundle);const b=await installCompleteGeneration(f.bundle,f.opts);
  await expect(rollbackCompleteGeneration(f.kiroHome,{validateCandidate:f.opts.validateCandidate,...interruption('owner-committed')})).rejects.toMatchObject({committed:true});
  let calls=0;const result=await rollbackCompleteGeneration(f.kiroHome,{...(target?{digest:target==='original'?a.digest:b.digest}:{}),validateCandidate:async()=>{calls++;}});
  expect(result.owner.currentRuntime).toBe(target==='different'?b.digest:a.digest);expect(calls).toBe(target==='different'?1:0);
  if(!target)expect(result).toMatchObject({outcome:'recovered',recovered:true,committed:true,priorAction:'retained-activation',recovery:{targetDigest:a.digest}});
 }finally{f.cleanup();}
});

test.skipIf(!hasInstallationRecovery).each(['owner-committed','cleaned'])('SIGKILL rollback after %s recovers its committed target, not the reversed default',async phase=>{
 const f=await setup();try{
  const a=await installCompleteGeneration(f.bundle,f.opts);await change(f.bundle);await installCompleteGeneration(f.bundle,f.opts);
  const module=new URL('../scripts/managed-installation.mjs',import.meta.url).href;
  const child=spawnSync(process.execPath,['--input-type=module','-e',`import {rollbackCompleteGeneration} from ${JSON.stringify(module)};await rollbackCompleteGeneration(${JSON.stringify(f.kiroHome)},{validateCandidate:async()=>{},onPhase:p=>{if(p===${JSON.stringify(phase)})process.kill(process.pid,'SIGKILL');}});`],{env:{HOME:f.userHome,KIRO_HOME:f.kiroHome,PATH:''},encoding:'utf8',timeout:15000});
  expect(child.stderr).toBe('');expect(child.signal).toBe('SIGKILL');
  const result=await rollbackCompleteGeneration(f.kiroHome,{validateCandidate:async()=>{throw Error('must not perform another rollback');}});
  expect(result).toMatchObject({outcome:'recovered',committed:true,recovered:true,owner:{currentRuntime:a.digest}});
  expect((await recoverCompleteInstallation(f.kiroHome)).recovered).toBe(false);
 }finally{f.cleanup();}
});

test.skipIf(!hasInstallationRecovery)('offline lock-only first-install SIGKILL recovery does not initialize data',async()=>{
 const f=await setup();try{
  const module=new URL('../scripts/managed-installation.mjs',import.meta.url).href;
  const child=spawnSync(process.execPath,['--input-type=module','-e',`import {installCompleteGeneration} from ${JSON.stringify(module)};await installCompleteGeneration(${JSON.stringify(f.bundle)},{...${JSON.stringify(f.opts)},validateCandidate:async()=>{},onPhase:p=>{if(p==='owner-initialized')process.kill(process.pid,'SIGKILL');}});`],{env:{HOME:f.userHome,PATH:''},encoding:'utf8',timeout:15000});
  expect(child.stderr).toBe('');expect(child.signal).toBe('SIGKILL');
  const result=await recoverCompleteInstallation(f.kiroHome);expect(result).toMatchObject({status:'absent',owner:null,recovered:true,committed:false});
  expect(fs.existsSync(path.join(f.kiroHome,'kiro-fabric/data'))).toBe(false);
 }finally{f.cleanup();}
});
