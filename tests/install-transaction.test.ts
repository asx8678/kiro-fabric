import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fixture } from './bundle-fixture.js';
import { canonical, createBundleManifest, validateBundle } from '../scripts/bundle-contract.mjs';
import { installCompleteGeneration, inspectCompleteInstallation, retireCompleteInstallation, rollbackCompleteGeneration } from '../scripts/managed-installation.mjs';
import { readTransaction, recoverInstallTransaction } from '../scripts/install-transaction.mjs';
import { acquireInstallationLock } from '../scripts/installer-lock.mjs';
import { hasInstallationRecovery } from './installer-capability-fixture.js';
import { doctorInstallation, managerErrorResult } from '../scripts/install-manager.mjs';
// Successful crash recovery requires the same inode-pinned capability as production.
const recoveryTest = test.skipIf(!hasInstallationRecovery);
const moduleURL=new URL('../scripts/managed-installation.mjs',import.meta.url).href;
async function setup(){const root=await fs.mkdtemp(path.join(tmpdir(),'transaction-test-')),bundle=await fixture(),userHome=path.join(root,'home'),kiroHome=path.join(root,'home/.kiro');await fs.mkdir(userHome,{mode:0o700});const opts={kiroHome,userHome,env:{},provenance:'source',validateCandidate:async()=>{}};return {root,bundle,userHome,kiroHome,opts,async cleanup(){await fs.rm(root,{recursive:true,force:true});await fs.rm(bundle,{recursive:true,force:true});}};}
async function upgrade(bundle:string){const old=(await validateBundle(bundle)).manifest;await fs.writeFile(bundle+'/app/main.js','next-generation');const m=await createBundleManifest(bundle,old);await fs.writeFile(bundle+'/bundle-manifest.json',canonical(m)+'\n');return m.digest;}
async function killAt(f:any,phase:string,operation='install'){
 const code=`import {installCompleteGeneration,retireCompleteInstallation,rollbackCompleteGeneration} from ${JSON.stringify(moduleURL)}; const opts=${JSON.stringify({...f.opts,validateCandidate:undefined})};opts.validateCandidate=async()=>{};opts.onPhase=p=>{if(p===${JSON.stringify(phase)})process.kill(process.pid,'SIGKILL')}; await ${operation==='install'?'installCompleteGeneration('+JSON.stringify(f.bundle)+',opts)':operation==='rollback'?'rollbackCompleteGeneration(opts.kiroHome,opts)':'retireCompleteInstallation(opts.kiroHome,opts)'};`;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{env:{PATH:process.env.PATH,HOME:f.userHome,KIRO_HOME:f.kiroHome},stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',b=>{error+=b;});return await new Promise<{signal:NodeJS.Signals|null,code:number|null,error:string}>((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal,error}));});
}
// Harness-only budget: each case performs several durable installs/replays and
// cold process startup. This is not a production recovery deadline; keep all
// recovery assertions intact under full-suite filesystem/CPU load.
const crashReplayHarnessMs = 60_000;
const phases=['candidate-journal-synced','copied:app/main.js','copied:tools/node','candidate-synced','generation-published','before-candidate-validation','candidate-validated','journal-synced','before-profile','profile-published','before-launcher','launcher-published','before-releaseState','releaseState-published','before-manifest','owner-committed','before-cleanup','cleaned'];
recoveryTest.each(phases)('real SIGKILL at %s: next mutation reconciles actual owner and replay is idempotent',async phase=>{const f=await setup();try{const old=await installCompleteGeneration(f.bundle,f.opts);await fs.writeFile(old.paths.data+'/fabric/sentinel','keep',{mode:0o600});const next=await upgrade(f.bundle);const killed=await killAt(f,phase);expect(killed.error).toBe('');expect(killed.signal).toBe('SIGKILL');const result=await installCompleteGeneration(f.bundle,f.opts);expect(result.owner.currentRuntime).toBe(next);expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('active');expect((await installCompleteGeneration(f.bundle,f.opts)).noop).toBe(true);expect(await fs.readFile(old.paths.data+'/fabric/sentinel','utf8')).toBe('keep');expect(await fs.readFile(old.paths.runtime+'/'+old.digest+'/app/main.js','utf8')).toBe('fixture app/main.js');}finally{await f.cleanup();}},crashReplayHarnessMs);
recoveryTest.each(['profile-published','owner-committed'])('retirement death at %s replays through same engine',async phase=>{const f=await setup();try{const a=await installCompleteGeneration(f.bundle,f.opts);expect((await killAt(f,phase,'retire')).signal).toBe('SIGKILL');await retireCompleteInstallation(f.kiroHome);expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('retired');expect(await fs.stat(a.paths.launcher)).toBeTruthy();}finally{await f.cleanup();}},crashReplayHarnessMs);
recoveryTest('foreign controls after precommit death are preserved with journal evidence',async()=>{const f=await setup();try{const a=await installCompleteGeneration(f.bundle,f.opts);await upgrade(f.bundle);expect((await killAt(f,'profile-published')).signal).toBe('SIGKILL');await fs.writeFile(a.paths.profile,'foreign');await expect(installCompleteGeneration(f.bundle,f.opts)).rejects.toThrow(/conflicting profile/);expect(await fs.readFile(a.paths.profile,'utf8')).toBe('foreign');expect(readTransaction(f.kiroHome)).not.toBeNull();}finally{await f.cleanup();}});
test.skipIf(hasInstallationRecovery)('unsupported native recovery preserves crashed transaction and controls',async()=>{
 const f=await setup();try{
  const installed=await installCompleteGeneration(f.bundle,f.opts);await upgrade(f.bundle);
  expect((await killAt(f,'profile-published')).signal).toBe('SIGKILL');
  const controls=[installed.paths.profile,installed.paths.manifest,installed.paths.journal,path.join(installed.paths.base,'.install-lock','owner.json')];
  const before=await Promise.all(controls.map(p=>fs.readFile(p)));
  const diagnostic=await doctorInstallation(f.kiroHome,{PATH:''});
  expect(diagnostic.outcome).toBe('recovery-required');
  expect(diagnostic.checks.find(check=>check.id==='transaction-lock')).toMatchObject({status:'FAIL',detail:expect.stringContaining('Automatic lock recovery unavailable')});
  const failure=await installCompleteGeneration(f.bundle,f.opts).catch(error=>error);
  expect(failure).toMatchObject({code:'INSTALL_LOCK_UNSUPPORTED',recoveryRequired:true});
  expect(managerErrorResult(failure)).toMatchObject({exitCode:7,outcome:'recovery-required',dataPreserved:true});
  expect(await Promise.all(controls.map(p=>fs.readFile(p)))).toEqual(before);
 }finally{await f.cleanup();}
});
test('unknown journal schema is never removed or replayed',async()=>{const f=await setup();try{const a=await installCompleteGeneration(f.bundle,f.opts);await upgrade(f.bundle);await killAt(f,'journal-synced');const j=JSON.parse(await fs.readFile(a.paths.journal,'utf8'));j.schemaVersion=99;await fs.writeFile(a.paths.journal,JSON.stringify(j));await expect(installCompleteGeneration(f.bundle,f.opts)).rejects.toThrow(/journal identity/);expect(JSON.parse(await fs.readFile(a.paths.journal,'utf8')).schemaVersion).toBe(99);}finally{await f.cleanup();}});
recoveryTest('actual committed owner wins over stale control publication phase',async()=>{const f=await setup();try{const a=await installCompleteGeneration(f.bundle,f.opts);const next=await upgrade(f.bundle);await killAt(f,'owner-committed');const release=acquireInstallationLock(a.paths.base,{recover:true});try{expect((await recoverInstallTransaction(f.kiroHome)).committed).toBe(true);expect((await recoverInstallTransaction(f.kiroHome)).recovered).toBe(false);}finally{release();}const result=await installCompleteGeneration(f.bundle,f.opts);expect(result.owner.currentRuntime).toBe(next);expect(result.noop).toBe(true);}finally{await f.cleanup();}});
test('live concurrent lock refuses activation without control mutation',async()=>{const f=await setup();try{const a=await installCompleteGeneration(f.bundle,f.opts);const before=await fs.readFile(a.paths.manifest);const release=acquireInstallationLock(a.paths.base);try{await expect(installCompleteGeneration(f.bundle,f.opts)).rejects.toThrow(/busy/);expect(await fs.readFile(a.paths.manifest)).toEqual(before);}finally{release();}}finally{await f.cleanup();}});

recoveryTest.each(['recovery-restored-profile','recovery-restored-launcher','recovery-restored-releaseState','recovery-before-cleanup','recovery-cleaned'])('real death during replay at %s remains replayable',async phase=>{const f=await setup();try{await installCompleteGeneration(f.bundle,f.opts);await upgrade(f.bundle);expect((await killAt(f,'launcher-published')).signal).toBe('SIGKILL');expect((await killAt(f,phase)).signal).toBe('SIGKILL');await installCompleteGeneration(f.bundle,f.opts);expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('active');}finally{await f.cleanup();}},crashReplayHarnessMs);
recoveryTest('fully initialized first-install lock death is recoverable without existing owner',async()=>{const f=await setup();try{expect((await killAt(f,'owner-initialized')).signal).toBe('SIGKILL');await installCompleteGeneration(f.bundle,f.opts);expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('active');}finally{await f.cleanup();}});
recoveryTest.each(['before-copy:tools/node','copied-bytes:tools/node'])('death around private executable copy at %s recovers',async phase=>{const f=await setup();try{expect((await killAt(f,phase)).signal).toBe('SIGKILL');await installCompleteGeneration(f.bundle,f.opts);expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('active');}finally{await f.cleanup();}});
test('modified old immutable resource after death blocks replay before restoring controls',async()=>{const f=await setup();try{const a=await installCompleteGeneration(f.bundle,f.opts);await upgrade(f.bundle);await killAt(f,'profile-published');const profile=await fs.readFile(a.paths.profile);await fs.appendFile(a.paths.runtime+'/'+a.digest+'/resources/steering/fabric.md','foreign');await expect(installCompleteGeneration(f.bundle,f.opts)).rejects.toThrow();expect(await fs.readFile(a.paths.profile)).toEqual(profile);expect(await fs.stat(a.paths.journal)).toBeTruthy();}finally{await f.cleanup();}});
recoveryTest.each(['releaseState-published','owner-committed'])('release trust replacement SIGKILL at %s follows owner commit',async phase=>{const f=await setup();try{
 const release=async(version:string)=>{const old=(await validateBundle(f.bundle)).manifest;const m=await createBundleManifest(f.bundle,{...old,version,provenance:{kind:'release',sourceCommit:'c'.repeat(40)}});await fs.writeFile(f.bundle+'/bundle-manifest.json',canonical(m)+'\n');return {schema:1,product:'kiro-fabric',version,target:m.target,sourceCommit:'c'.repeat(40),compatibility:m.compatibility,bundleDigest:m.digest,archive:{url:`https://github.com/asx8678/kiro-fabric/releases/download/v${version}/kiro-fabric-${version}-${m.target}.tar.gz`,size:1,sha256:'d'.repeat(64)},sbom:{size:1,sha256:'e'.repeat(64)}};};
 const one=await release('1.0.0');const a=await installCompleteGeneration(f.bundle,{...f.opts,provenance:'release',releaseMetadata:one});const before=await fs.readFile(a.paths.releaseState);const two=await release('2.0.0');const killed=await killAt({...f,opts:{...f.opts,provenance:'release',releaseMetadata:two}},phase);expect(killed.error).toBe('');expect(killed.signal).toBe('SIGKILL');const unlock=acquireInstallationLock(a.paths.base,{recover:true});try{const recovered=await recoverInstallTransaction(f.kiroHome);expect(recovered.committed).toBe(phase==='owner-committed');}finally{unlock();}if(phase==='releaseState-published')expect(await fs.readFile(a.paths.releaseState)).toEqual(before);else expect(JSON.parse(await fs.readFile(a.paths.releaseState,'utf8')).highestVersion).toBe('2.0.0');await installCompleteGeneration(f.bundle,{...f.opts,provenance:'release',releaseMetadata:two});expect(JSON.parse(await fs.readFile(a.paths.releaseState,'utf8')).accepted).toHaveLength(2);
 }finally{await f.cleanup();}},crashReplayHarnessMs);

import nodefs from 'node:fs';
import { vi } from 'vitest';
test.each([
 ['journal-synced','profile'], ['profile-published','profile'], ['launcher-published','launcher'], ['owner-committed','manifest'],
])('replay after %s resyncs the %s parent on every retry even when bytes match',async(phase,control)=>{
 const f=await setup();let spy:ReturnType<typeof vi.spyOn>|undefined;let unlock:(()=>void)|undefined;
 try {
  const a=await installCompleteGeneration(f.bundle,f.opts),before=await fs.readFile(a.paths.profile);await upgrade(f.bundle);
  await expect(installCompleteGeneration(f.bundle,{...f.opts,onPhase:(p:string)=>{if(p===phase)throw Error('fixture interruption');}})).rejects.toThrow('fixture interruption');
  unlock=acquireInstallationLock(a.paths.base);
  const selected=path.dirname(a.paths[control]),target=nodefs.statSync(selected),original=nodefs.fsyncSync;let failed=false;
  spy=vi.spyOn(nodefs,'fsyncSync').mockImplementation(fd=>{const st=nodefs.fstatSync(fd);if(!failed&&st.isDirectory()&&st.dev===target.dev&&st.ino===target.ino){failed=true;throw Error('fixture recovery parent fsync failure');}return original(fd);});
  await expect(recoverInstallTransaction(f.kiroHome)).rejects.toThrow('fixture recovery parent fsync failure');
  expect(failed).toBe(true);expect(readTransaction(f.kiroHome)).not.toBeNull();
  if(phase!=='owner-committed')expect(await fs.readFile(a.paths.profile)).toEqual(before);
  const controls=await Promise.all([a.paths.profile,a.paths.launcher,a.paths.manifest].map(file=>fs.readFile(file)));
  spy.mockRestore();const seen=new Set<string>(),parents=[...new Set([a.paths.profile,a.paths.launcher,a.paths.manifest,a.paths.releaseState].map(file=>path.dirname(file)))];
  const identities=parents.map(dir=>({dir,stat:nodefs.statSync(dir)}));
  spy=vi.spyOn(nodefs,'fsyncSync').mockImplementation(fd=>{const st=nodefs.fstatSync(fd);for(const {dir,stat} of identities)if(st.isDirectory()&&st.dev===stat.dev&&st.ino===stat.ino)seen.add(dir);return original(fd);});
  const recovered=await recoverInstallTransaction(f.kiroHome,{onPhase:p=>{if(p==='recovery-before-cleanup'){expect(readTransaction(f.kiroHome)).not.toBeNull();expect([...seen].sort()).toEqual(parents.sort());}}});
  expect(recovered).toMatchObject({recovered:true,committed:phase==='owner-committed'});
  expect(await Promise.all([a.paths.profile,a.paths.launcher,a.paths.manifest].map(file=>fs.readFile(file)))).toEqual(controls);
  expect(readTransaction(f.kiroHome)).toBeNull();expect((await recoverInstallTransaction(f.kiroHome)).recovered).toBe(false);
 }finally{spy?.mockRestore();unlock?.();await f.cleanup();}
});

test.each([1,2])('owner sync failure %s reports actual commit and next invocation recovers',async failAt=>{const f=await setup();let spy:ReturnType<typeof vi.spyOn>|undefined;try{await installCompleteGeneration(f.bundle,f.opts);const next=await upgrade(f.bundle);const original=nodefs.fsyncSync;let armed=false,count=0;spy=vi.spyOn(nodefs,'fsyncSync').mockImplementation(fd=>{if(armed&&++count===failAt){armed=false;throw Error('injected fsync failure');}return original(fd);});await expect(installCompleteGeneration(f.bundle,{...f.opts,onPhase:(p:string)=>{if(p==='before-manifest')armed=true;}})).rejects.toMatchObject({message:'injected fsync failure',committed:failAt===2,recoveryRequired:true});spy.mockRestore();spy=undefined;await installCompleteGeneration(f.bundle,f.opts);expect((await inspectCompleteInstallation(f.kiroHome)).owner.currentRuntime).toBe(next);}finally{spy?.mockRestore();await f.cleanup();}});

recoveryTest.each(['before-candidate-validation','candidate-validated','owner-committed'])('rollback death at %s preserves both immutable generations and retries exact target',async phase=>{const f=await setup();try{const a=await installCompleteGeneration(f.bundle,f.opts);await upgrade(f.bundle);const b=await installCompleteGeneration(f.bundle,f.opts);const killed=await killAt(f,phase,'rollback');expect(killed.error).toBe('');expect(killed.signal).toBe('SIGKILL');const result=await rollbackCompleteGeneration(f.kiroHome,{digest:a.digest,validateCandidate:async(root:string)=>{expect(path.basename(root)).toMatch(/^\.candidate-[a-f0-9]{32}$/);expect((await validateBundle(root)).digest).toBe(a.digest);}});expect(result.owner.currentRuntime).toBe(a.digest);expect((await inspectCompleteInstallation(f.kiroHome)).generations).toHaveLength(2);expect(await fs.readFile(a.paths.runtime+'/'+a.digest+'/app/main.js','utf8')).toBe('fixture app/main.js');expect(await fs.readFile(b.paths.runtime+'/'+b.digest+'/app/main.js','utf8')).toBe('next-generation');}finally{await f.cleanup();}},crashReplayHarnessMs);
