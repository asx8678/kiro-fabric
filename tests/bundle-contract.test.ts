import { test, expect } from 'vitest';
import { writeFile, chmod, rm, link, readFile, symlink, mkdtemp, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBundleManifest, validateBundle, safePath, checkManifest, manifestDigest, compatibilityFor, readRegular, checkToolPins } from '../scripts/bundle-contract.mjs';
import { fixture, fixtureTools } from './bundle-fixture.js';

test('exact inventory, self exclusion, tamper and hardlink rejection',async()=>{const root=await fixture();try{const b=await validateBundle(root);expect(b.inventory).toHaveLength(16);expect(b.inventory.some((e:{path:string})=>e.path==='bundle-manifest.json')).toBe(false);await writeFile(path.join(root,'app/main.js'),'tampered');await expect(validateBundle(root)).rejects.toThrow();await link(path.join(root,'tools/node'),path.join(root,'app/link'));await expect(createBundleManifest(root,b.manifest)).rejects.toThrow();}finally{await rm(root,{recursive:true,force:true});}});
test.each(['../a','/a','a//b','a\\b','a:ads','a.','a\u0000b'])('unsafe path %s',p=>expect(()=>safePath(p)).toThrow());
function resign(m:any){const {digest,...payload}=m;m.digest=manifestDigest(payload);return m;}
test('exact semantic schema rejects truthy placeholders, extra fields and malformed pin types',async()=>{
 const root=await fixture();try{
  const original=(await validateBundle(root)).manifest;
  const changes:((m:any)=>void)[]=[
   m=>m.compatibility={node:24},m=>m.compatibility.minNode='24',m=>m.compatibility.minKernel=null,m=>m.compatibility.extra=true,m=>m.compatibility.minMacOS='13.5',
   m=>m.provenance={kind:'test'},m=>m.provenance.dirty='true',m=>m.provenance.gitHead='a'.repeat(64),m=>m.provenance.sourceDigest=true,m=>m.provenance.extra=1,
   m=>m.tools={fixture:true},m=>m.tools.node.version=24,m=>m.tools.rg.version='15.2.0',m=>m.tools.node.size='1',m=>m.tools.node.size=0,m=>m.tools.node.sha256=true,
   m=>m.tools.node.url='https://evil.test/a',m=>m.tools.node.checksumUrl=m.tools.node.url,m=>m.tools.node.members[0].size='1',m=>m.tools.node.members[0].sha256='a'.repeat(64),m=>m.tools.node.members[0].member='../node',m=>m.tools.node.members[0].extra=1,
   m=>m.tools.rg.members.pop(),m=>m.tools.node.members.push(m.tools.node.members[0]),m=>m.tools.node.extra=1,m=>m.version='01.0.0',m=>m.version='1.0.0-beta',m=>m.extra=1,
   m=>m.inventory.find((e:any)=>e.path==='app/main.js').role='executable',m=>m.inventory.find((e:any)=>e.path==='tools/node').mode=0o600,
  ];
  for(const change of changes){const m=structuredClone(original);change(m);expect(()=>checkManifest(resign(m)),change.toString()).toThrow();}
  for(const required of ['app/kiro/mcp-entry.js','app/runtime/compiler-worker-entry.js','app/runtime/sandbox-worker-entry.js','app/package.json','app/closure-manifest.json','notices/node-LICENSE','notices/rg-COPYING']){
   const m=structuredClone(original);m.inventory=m.inventory.filter((e:any)=>e.path!==required);expect(()=>checkManifest(resign(m))).toThrow(/Missing/);
  }
  for(const provenance of [{kind:'local-source',sourceDigest:'a'.repeat(64),gitHead:'b'.repeat(40),dirty:false},{kind:'release',sourceCommit:'c'.repeat(40)}])expect(()=>checkManifest(resign({...original,provenance}))).not.toThrow();
  for(const provenance of [{kind:'release',sourceCommit:'c'.repeat(64)},{kind:'release',sourceCommit:'c'.repeat(40),dirty:false}])expect(()=>checkManifest(resign({...original,provenance}))).toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
});
test.each(['root','directory','file','executable','manifest'])('exact %s modes are required',async kind=>{
 const root=await fixture();try{
  const target=kind==='root'?root:root+'/'+({directory:'app',file:'app/main.js',executable:'tools/node',manifest:'bundle-manifest.json'}[kind]);
  await chmod(target,kind==='executable'?0o600:0o755);await expect(validateBundle(root)).rejects.toThrow(/mode/);
 }finally{await chmod(root,0o700);await rm(root,{recursive:true,force:true});}
});
test('root, directory and manifest symlinks fail closed',async()=>{
 const root=await fixture(),temp=await mkdtemp(tmpdir()+'/bundle-alias-');try{
  await symlink(root,temp+'/alias');await expect(validateBundle(temp+'/alias')).rejects.toThrow(/root component/);
  await rename(root+'/app',root+'/other');await symlink(root+'/other',root+'/app');await expect(validateBundle(root)).rejects.toThrow();
  await rm(root+'/app');await rename(root+'/other',root+'/app');
  await rename(root+'/bundle-manifest.json',temp+'/manifest');await symlink(temp+'/manifest',root+'/bundle-manifest.json');await expect(validateBundle(root)).rejects.toThrow(/Unsafe/);
 }finally{await rm(root,{recursive:true,force:true});await rm(temp,{recursive:true,force:true});}
});
test('all targets record exact stable upstream compatibility and legal pins',async()=>{
 const config=JSON.parse(await readFile(new URL('../build-toolchain.json',import.meta.url),'utf8'));
 for(const target of Object.keys(config.targets)){
  const c=compatibilityFor(target);expect(c.minNode).toBe('24.20.0');expect(c.minKiro).toBe('2.21.1');expect(c.libc).toBe(target.startsWith('linux')?'glibc':'system');checkToolPins(config.targets[target],undefined,target);
 }
 expect(()=>checkToolPins(fixtureTools())).not.toThrow();
});
test('bounded reads reject foreign ownership and oversized captures',async()=>{
 const root=await fixture();try{
  await expect(readRegular(root+'/tools/node',1)).rejects.toThrow(/oversized/);
  // Root-owned system file is read-only evidence; no chown/sudo or home access.
  if(process.getuid?.()!==0)await expect(readRegular('/usr/bin/env',1024*1024)).rejects.toThrow(/ownership/);
 }finally{await rm(root,{recursive:true,force:true});}
});
