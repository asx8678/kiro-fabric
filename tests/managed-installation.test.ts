import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fixture } from './bundle-fixture.js';
import { canonical, createBundleManifest, validateBundle } from '../scripts/bundle-contract.mjs';
import { installCompleteGeneration, inspectCompleteInstallation, rollbackCompleteGeneration, retireCompleteInstallation } from '../scripts/managed-installation.mjs';
import { doctorInstallation, managerErrorResult } from '../scripts/install-manager.mjs';

async function setup(){const root=await fs.mkdtemp(path.join(tmpdir(),'managed-test-')),bundle=await fixture();const kiroHome=path.join(root,'home/.kiro');await fs.mkdir(path.join(root,'home'),{mode:0o700});return {root,bundle,kiroHome,opts:{kiroHome,userHome:path.join(root,'home'),env:{},provenance:'source',validateCandidate:async(candidateRoot:string,context:any)=>{expect(candidateRoot).toContain('/runtime/.candidate-');const candidate=await validateBundle(candidateRoot);expect(context.profile.mcpServers.fabric.env.KIRO_FABRIC_BUNDLE_ROOT).toBe(path.join(path.dirname(candidateRoot),candidate.digest));}},async cleanup(){await fs.rm(root,{recursive:true,force:true});await fs.rm(bundle,{recursive:true,force:true});}};}
async function change(bundle:string,value:string){const old=(await validateBundle(bundle)).manifest;await fs.writeFile(path.join(bundle,'app/main.js'),value);const m=await createBundleManifest(bundle,old);await fs.writeFile(path.join(bundle,'bundle-manifest.json'),canonical(m)+'\n');return m.digest;}

test('upgrades a hash-verified pre-readiness profile without accepting profile tampering', async () => {
 const f = await setup();
 try {
  const installed = await installCompleteGeneration(f.bundle, f.opts);
  const profile = JSON.parse(await fs.readFile(installed.paths.profile, 'utf8'));
  expect(profile.mcpServers.fabric.waitForReady).toBe(true);
  delete profile.mcpServers.fabric.waitForReady;
  const oldBytes = JSON.stringify(profile, null, 2) + '\n';
  await fs.writeFile(installed.paths.profile, oldBytes);
  await expect(inspectCompleteInstallation(f.kiroHome)).rejects.toThrow(/modified profile/);
  // A real old install's ownership record already hashes its pre-readiness profile.
  const owner = JSON.parse(await fs.readFile(installed.paths.manifest, 'utf8'));
  owner.profileSha256 = installerSafety.hash(oldBytes);
  await fs.writeFile(installed.paths.manifest, JSON.stringify(owner, null, 2) + '\n');
  expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('active');
  await change(f.bundle, 'headless readiness upgrade');
  await installCompleteGeneration(f.bundle, f.opts);
  const upgradedBytes = await fs.readFile(installed.paths.profile, 'utf8');
  const upgraded = JSON.parse(upgradedBytes);
  expect(upgraded.mcpServers.fabric.waitForReady).toBe(true);
  expect(upgraded.tools).toEqual(['@fabric/fabric_exec']);
  expect(upgraded.allowedTools).toEqual(['@fabric/fabric_exec']);
  expect((await inspectCompleteInstallation(f.kiroHome)).owner.profileSha256).toBe(installerSafety.hash(upgradedBytes));
 } finally { await f.cleanup(); }
});

test('upgrades a hash-verified profile predating explicit workspace forwarding', async () => {
 const f = await setup();
 try {
  const a = await installCompleteGeneration(f.bundle, f.opts);
  const profile = JSON.parse(await fs.readFile(a.paths.profile, 'utf8'));
  delete profile.mcpServers.fabric.env.KIRO_FABRIC_LAUNCH_WORKSPACE;
  const oldBytes = JSON.stringify(profile, null, 2) + '\n';
  await fs.writeFile(a.paths.profile, oldBytes);
  const owner = JSON.parse(await fs.readFile(a.paths.manifest, 'utf8'));
  owner.profileSha256 = installerSafety.hash(oldBytes);
  await fs.writeFile(a.paths.manifest, JSON.stringify(owner, null, 2) + '\n');
  expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('active');
  await change(f.bundle, 'workspace forwarding upgrade');
  await installCompleteGeneration(f.bundle, f.opts);
  const updated = JSON.parse(await fs.readFile(a.paths.profile, 'utf8'));
  expect(updated.mcpServers.fabric.env.KIRO_FABRIC_LAUNCH_WORKSPACE).toBe('${KIRO_FABRIC_LAUNCH_WORKSPACE}');
 } finally { await f.cleanup(); }
});

test('install, no-op, two upgrades retain every exact resource; rollback preserves live data',async()=>{const f=await setup();try{const a=await installCompleteGeneration(f.bundle,f.opts);const data=path.join(a.paths.data,'fabric/user-state');await fs.writeFile(data,'durable',{mode:0o600});const oldSkill=await fs.readFile(path.join(a.paths.runtime,a.digest,'resources/skills/fabric-exec/SKILL.md'));expect((await installCompleteGeneration(f.bundle,f.opts)).noop).toBe(true);await change(f.bundle,'second');const b=await installCompleteGeneration(f.bundle,f.opts);await change(f.bundle,'third');const c=await installCompleteGeneration(f.bundle,f.opts);expect((await inspectCompleteInstallation(f.kiroHome)).generations).toHaveLength(3);const rollback=await rollbackCompleteGeneration(f.kiroHome,{validateCandidate:f.opts.validateCandidate});expect(rollback.owner.currentRuntime).toBe(b.digest);expect(rollback.owner.previousRuntime).toBe(c.digest);expect(await fs.readFile(data,'utf8')).toBe('durable');expect(await fs.readFile(path.join(a.paths.runtime,a.digest,'resources/skills/fabric-exec/SKILL.md'))).toEqual(oldSkill);}finally{await f.cleanup();}});
test('retirement is idempotent, retains maintenance and trust, install reactivates',async()=>{const f=await setup();try{const a=await installCompleteGeneration(f.bundle,f.opts);const launcher=await fs.readFile(a.paths.launcher);await retireCompleteInstallation(f.kiroHome);expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('retired');await expect(fs.stat(a.paths.profile)).rejects.toThrow();expect(await fs.readFile(a.paths.launcher)).toEqual(launcher);expect((await retireCompleteInstallation(f.kiroHome)).noop).toBe(true);await expect(rollbackCompleteGeneration(f.kiroHome)).rejects.toThrow(/install first/);await expect(retireCompleteInstallation(f.kiroHome,{purgeData:true})).rejects.toThrow(/preserved/);await installCompleteGeneration(f.bundle,f.opts);expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('active');}finally{await f.cleanup();}});
test.each(['profile','launcher','resource','foreign-generation','owner-field'])('modified %s blocks retirement and preserves conflict',async kind=>{const f=await setup();try{const a=await installCompleteGeneration(f.bundle,f.opts);const target=kind==='profile'?a.paths.profile:kind==='launcher'?a.paths.launcher:kind==='resource'?path.join(a.paths.runtime,a.digest,'resources/steering/fabric.md'):kind==='owner-field'?a.paths.manifest:path.join(a.paths.runtime,'a'.repeat(64));if(kind==='foreign-generation')await fs.mkdir(target,{mode:0o700});else if(kind==='owner-field'){const o=JSON.parse(await fs.readFile(target,'utf8'));o.unknown=true;await fs.writeFile(target,JSON.stringify(o));}else await fs.appendFile(target,'foreign');await expect(retireCompleteInstallation(f.kiroHome)).rejects.toThrow();expect(await fs.stat(target)).toBeTruthy();}finally{await f.cleanup();}});
test('precommit candidate failure reports recovery and doctor preserves its evidence',async()=>{const f=await setup();try{
 const failure=await installCompleteGeneration(f.bundle,{...f.opts,validateCandidate:async()=>{throw Error('smoke failed before activation');}}).catch(error=>error);
 expect(failure).toMatchObject({committed:false,recoveryRequired:true});
 expect(managerErrorResult(failure)).toMatchObject({committed:false,exitCode:7,outcome:'recovery-required'});
 const journal=path.join(f.kiroHome,'kiro-fabric/.transactions/candidate.json'),before=await fs.readFile(journal),modified=(await fs.stat(journal)).mtimeMs;
 const diagnostic=await doctorInstallation(f.kiroHome,{PATH:''});
 expect(diagnostic.outcome).toBe('recovery-required');
 expect(diagnostic.checks.find(check=>check.id==='installation')).toMatchObject({status:'FAIL',detail:expect.stringContaining('Interrupted installation requires recovery')});
 expect(diagnostic.checks.find(check=>check.id==='transaction-journal')).toMatchObject({status:'FAIL'});
 expect(diagnostic.checks.find(check=>check.id==='signed-distribution')).toMatchObject({status:'WARNING',detail:expect.stringContaining('BLOCKED')});
 expect(await fs.readFile(journal)).toEqual(before);expect((await fs.stat(journal)).mtimeMs).toBe(modified);
 await installCompleteGeneration(f.bundle,f.opts);expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('active');
 }finally{await f.cleanup();}});
test('doctor preserves foreign atomic-write evidence and returns recovery exit 7',async()=>{const f=await setup();try{
 const installed=await installCompleteGeneration(f.bundle,f.opts),directory=path.join(f.kiroHome,'kiro-fabric/.transactions');
 const evidence=path.join(directory,'.candidate.json.123.0123456789abcdef');await fs.writeFile(evidence,'interrupted atomic-write evidence',{mode:0o600});
 const files=[evidence,installed.paths.manifest,installed.paths.profile,installed.paths.launcher];
 const before=await Promise.all(files.map(async file=>({bytes:await fs.readFile(file),mtime:(await fs.stat(file)).mtimeMs})));
 const module=new URL('../scripts/install-manager.mjs',import.meta.url).href;
 const result=spawnSync(process.execPath,['--input-type=module','-e',`import {runManager} from ${JSON.stringify(module)};process.exitCode=await runManager(['doctor','--kiro-home',process.argv[1],'--json'],{context:{kind:'bootstrap'}});`,f.kiroHome],{env:{HOME:f.root,KIRO_HOME:f.kiroHome,PATH:''},encoding:'utf8',timeout:15000});
 expect(result.status,result.stdout+result.stderr).toBe(7);const diagnostic:Awaited<ReturnType<typeof doctorInstallation>>=JSON.parse(result.stdout);
 expect(diagnostic.outcome).toBe('recovery-required');
 expect(diagnostic.checks.find(check=>check.id==='installation')).toMatchObject({status:'FAIL',detail:expect.stringContaining('foreign transaction material')});
 expect(diagnostic.checks.find(check=>check.id==='transaction-journal')).toMatchObject({status:'FAIL'});
 expect(await Promise.all(files.map(async file=>({bytes:await fs.readFile(file),mtime:(await fs.stat(file)).mtimeMs})))).toEqual(before);
 }finally{await f.cleanup();}});
test('read-only doctor creates nothing and does not touch mtimes',async()=>{const f=await setup();try{expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('absent');await expect(fs.stat(f.kiroHome)).rejects.toThrow();const a=await installCompleteGeneration(f.bundle,f.opts);const before=(await fs.stat(a.paths.manifest)).mtimeMs;await inspectCompleteInstallation(f.kiroHome);expect((await fs.stat(a.paths.manifest)).mtimeMs).toBe(before);}finally{await f.cleanup();}});
test('candidate validation failure fences and next invocation safely retries',async()=>{const f=await setup();try{await expect(installCompleteGeneration(f.bundle,{...f.opts,validateCandidate:async()=>{throw Error('smoke failed');}})).rejects.toThrow(/smoke failed/);expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('recovery-required');await installCompleteGeneration(f.bundle,f.opts);expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('active');}finally{await f.cleanup();}});
test('validation callback mandatory, unowned profile and overlap rejected',async()=>{const f=await setup();try{await expect(installCompleteGeneration(f.bundle,{...f.opts,validateCandidate:undefined})).rejects.toThrow(/callback/);await expect(installCompleteGeneration(f.bundle,{...f.opts,kiroHome:path.join(f.bundle,'destination')})).rejects.toThrow(/overlap/);await fs.mkdir(path.join(f.kiroHome,'agents'),{recursive:true,mode:0o700});const profile=path.join(f.kiroHome,'agents/kiro-fabric.json');await fs.writeFile(profile,'foreign',{mode:0o600});await expect(installCompleteGeneration(f.bundle,f.opts)).rejects.toThrow(/unowned/);expect(await fs.readFile(profile,'utf8')).toBe('foreign');}finally{await f.cleanup();}});

// Legacy fixtures deliberately contain bytes that schema 1 never authenticated.
import { installerSafety } from '../scripts/install-agent-user.mjs';
test.each([1,2])('schema %s migration preserves original runtime and shared skills in place',async schema=>{const f=await setup();try{
 const p=installerSafety.paths(f.kiroHome),name='b'.repeat(64),runtime=path.join(p.runtime,name),skill=path.join(p.skills,'fabric-exec');
 for(const dir of [path.dirname(p.profile),runtime,skill])await fs.mkdir(dir,{recursive:true,mode:0o700});
 await fs.writeFile(p.profile,'legacy profile',{mode:0o600});await fs.writeFile(path.join(skill,'SKILL.md'),'legacy skill',{mode:0o600});await fs.writeFile(path.join(skill,'unknown.md'),'uncertain legacy reference',{mode:0o600});await fs.writeFile(path.join(runtime,'main.js'),'old live backend',{mode:0o600});
 let manifest:any={schemaVersion:1,owner:'kiro-fabric-agent-user-install',packageDigest:name,runtime,profileSha256:installerSafety.hash('legacy profile'),skillSha256:installerSafety.hash('legacy skill')};
 await fs.writeFile(p.manifest,JSON.stringify(manifest)+'\n',{mode:0o600});
 if(schema===2){const r=installerSafety.readLegacyInstallation(f.kiroHome);if(!r?.legacy)throw Error('legacy fixture evidence missing');manifest={schemaVersion:2,owner:manifest.owner,packageDigest:name,currentRuntime:name,previousRuntime:null,profileSha256:manifest.profileSha256,skill:r.legacy.skillTree,runtimeGenerations:[{name,tree:r.legacy.runtimeTree}]};await fs.writeFile(p.manifest,JSON.stringify(manifest)+'\n');}
 const original=await fs.readFile(p.manifest);const a=await installCompleteGeneration(f.bundle,f.opts);
 expect(Buffer.from(a.owner.legacy.manifestBase64,'base64')).toEqual(original);expect(a.owner.previousRuntime).toBeNull();expect(a.owner.runtimeGenerations).toHaveLength(1);
 expect(await fs.readFile(path.join(runtime,'main.js'),'utf8')).toBe('old live backend');expect(await fs.readFile(path.join(skill,'unknown.md'),'utf8')).toBe('uncertain legacy reference');
 await expect(rollbackCompleteGeneration(f.kiroHome,{validateCandidate:f.opts.validateCandidate})).rejects.toThrow(/no retained/);await retireCompleteInstallation(f.kiroHome);expect(await fs.readFile(path.join(skill,'SKILL.md'),'utf8')).toBe('legacy skill');expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('retired');
 }finally{await f.cleanup();}});
async function releaseFixture(bundle:string,version:string){const old=(await validateBundle(bundle)).manifest;const manifest=await createBundleManifest(bundle,{...old,version,provenance:{kind:'release',sourceCommit:'c'.repeat(40)}});await fs.writeFile(bundle+'/bundle-manifest.json',canonical(manifest)+'\n');return {schema:1,product:'kiro-fabric',version,target:manifest.target,sourceCommit:'c'.repeat(40),compatibility:manifest.compatibility,bundleDigest:manifest.digest,archive:{url:`https://github.com/asx8678/kiro-fabric/releases/download/v${version}/kiro-fabric-${version}-${manifest.target}.tar.gz`,size:1,sha256:'d'.repeat(64)},sbom:{size:1,sha256:'e'.repeat(64)}};}
test('trusted release admission binds state; source and rollback do not rewind it',async()=>{const f=await setup();try{const one=await releaseFixture(f.bundle,'1.0.0');const a=await installCompleteGeneration(f.bundle,{...f.opts,provenance:'release',releaseMetadata:one});const two=await releaseFixture(f.bundle,'2.0.0');await installCompleteGeneration(f.bundle,{...f.opts,provenance:'release',releaseMetadata:two});const trust=await fs.readFile(a.paths.releaseState);await rollbackCompleteGeneration(f.kiroHome,{validateCandidate:f.opts.validateCandidate});expect(await fs.readFile(a.paths.releaseState)).toEqual(trust);await expect(installCompleteGeneration(f.bundle,{...f.opts,provenance:'release',releaseMetadata:one})).rejects.toThrow(/identity mismatch/);const old=(await validateBundle(f.bundle)).manifest;const local=await createBundleManifest(f.bundle,{...old,provenance:{kind:'local-source',sourceDigest:'f'.repeat(64),gitHead:null,dirty:true}});await fs.writeFile(f.bundle+'/bundle-manifest.json',canonical(local)+'\n');await installCompleteGeneration(f.bundle,f.opts);expect(await fs.readFile(a.paths.releaseState)).toEqual(trust);await retireCompleteInstallation(f.kiroHome);expect(await fs.readFile(a.paths.releaseState)).toEqual(trust);}finally{await f.cleanup();}});
test('same stable release with changed digest and automatic downgrade are refused',async()=>{const f=await setup();try{const initial=await releaseFixture(f.bundle,'2.0.0');await installCompleteGeneration(f.bundle,{...f.opts,provenance:'release',releaseMetadata:initial});await change(f.bundle,'changed-release');const conflict=await releaseFixture(f.bundle,'2.0.0');await expect(installCompleteGeneration(f.bundle,{...f.opts,provenance:'release',releaseMetadata:conflict})).rejects.toThrow(/Same-version/);const downgrade=await releaseFixture(f.bundle,'1.0.0');await expect(installCompleteGeneration(f.bundle,{...f.opts,provenance:'release',releaseMetadata:downgrade})).rejects.toThrow(/downgrade/);}finally{await f.cleanup();}});

import { spawnSync } from 'node:child_process';
import { completeGenerationLauncher } from '../scripts/managed-installation.mjs';
test('launcher uses no PATH utility, preserves cwd and literal args, clears Node injection',async()=>{const f=await setup();try{const base=path.join(f.root,'installation % # ü'),name='a'.repeat(64),bin=path.join(base,'bin'),tools=path.join(base,'runtime',name,'tools');await fs.mkdir(bin,{recursive:true,mode:0o700});await fs.mkdir(tools,{recursive:true,mode:0o700});const launcher=path.join(bin,'kiro-fabric');await fs.writeFile(launcher,completeGenerationLauncher(name),{mode:0o700});await fs.writeFile(path.join(tools,'node'),'#!/bin/sh\nprintf "%s\\n" "$PWD" "${NODE_OPTIONS-unset}" "${NODE_PATH-unset}" "$@"\n',{mode:0o700});const result=spawnSync(launcher,['space arg','$(no-execution)','ü % #'],{cwd:f.root,env:{HOME:f.opts.userHome,PATH:'/nonexistent',KIRO_HOME:'/cannot-redirect',NODE_OPTIONS:'--require /not-trusted',NODE_PATH:'/not-trusted'},encoding:'utf8'});expect(result.status).toBe(0);expect(result.stderr).toBe('');expect(result.stdout.trim().split('\n')).toEqual([f.root,'unset','unset',path.join(base,'runtime',name,'manager/install-manager.mjs'),'space arg','$(no-execution)','ü % #']);}finally{await f.cleanup();}});
test('uninstall absent is read-only; purge retires first but never deletes user data',async()=>{const f=await setup();try{expect((await retireCompleteInstallation(f.kiroHome)).noop).toBe(true);await expect(fs.stat(f.kiroHome)).rejects.toThrow();const a=await installCompleteGeneration(f.bundle,f.opts);await fs.writeFile(a.paths.data+'/fabric/sentinel','keep',{mode:0o600});await expect(retireCompleteInstallation(f.kiroHome,{purgeData:true})).rejects.toMatchObject({committed:true,dataPreserved:true,recoveryRequired:false,code:'INSTALL_PURGE_UNAVAILABLE'});expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('retired');expect(await fs.readFile(a.paths.data+'/fabric/sentinel','utf8')).toBe('keep');}finally{await f.cleanup();}});
test('candidate smoke cannot accidentally modify immutable payload before commit',async()=>{const f=await setup();try{await expect(installCompleteGeneration(f.bundle,{...f.opts,validateCandidate:async(candidateRoot:string)=>{await fs.appendFile(candidateRoot+'/app/main.js','changed during smoke');}})).rejects.toThrow(/inventory/);await expect(fs.stat(path.join(f.kiroHome,'kiro-fabric/install-owner.json'))).rejects.toThrow();expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('recovery-required');}finally{await f.cleanup();}});
test('candidate cleanup never adopts or deletes a replacement directory inode',async()=>{const f=await setup();try{const b=await validateBundle(f.bundle),target=path.join(f.kiroHome,'kiro-fabric/runtime',b.digest);await expect(installCompleteGeneration(f.bundle,{...f.opts,onPhase:async(p:string)=>{if(p==='candidate-journal-synced')await fs.mkdir(target,{mode:0o700});}})).rejects.toThrow(/collision/);await expect(installCompleteGeneration(f.bundle,f.opts)).rejects.toThrow(/candidate root identity/);expect((await fs.stat(target)).isDirectory()).toBe(true);}finally{await f.cleanup();}});
