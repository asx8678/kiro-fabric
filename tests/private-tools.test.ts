import { test, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fixtureTools } from './bundle-fixture.js';
import { checkToolPins, sha256 } from '../scripts/bundle-contract.mjs';
import { readFile, mkdtemp, rm, readdir, lstat, chmod, realpath, mkdir, writeFile } from 'node:fs/promises';
import { acquirePrivateTools, acquirePrivateToolsForTest, downloadVerified, extractPinnedMember } from '../scripts/build-private-tools.mjs';
test('four real pinned closures with finite measured sizes',async()=>{const c=JSON.parse(await readFile(new URL('../build-toolchain.json',import.meta.url),'utf8'));expect(Object.keys(c.targets)).toHaveLength(4);for(const target of Object.values(c.targets) as any[])for(const tool of ['node','rg']){const p=target[tool];expect(p.sha256).toMatch(/^[a-f0-9]{64}$/);expect(p.size).toBeGreaterThan(1000000);expect(p.members.length).toBeGreaterThan(1);expect(p.members[0].sha256).toMatch(/^[a-f0-9]{64}$/);}});
test('extracts the exact pinned upstream member using native GNU or BSD tar',async()=>{
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'private-tools-tar-')));
 try{
  const member='upstream/LICENSE',bytes=Buffer.from('portable upstream notice\n');
  await mkdir(path.join(root,'upstream'));
  await writeFile(path.join(root,member),bytes);
  const archive=path.join(root,'archive with spaces.tar.gz');
  execFileSync('tar',['-czf',archive,'-C',root,member],{env:{PATH:'/usr/bin:/bin',LANG:'C'},timeout:10000});
  expect(extractPinnedMember(archive,member)).toEqual(bytes);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('unsupported target, transport and member fail closed',async()=>{await expect(acquirePrivateTools('windows-x64','/not-used')).rejects.toThrow();await expect(downloadVerified('http://example.com/a',{sha256:'a'.repeat(64)})).rejects.toThrow();expect(()=>extractPinnedMember('/not-used','../evil')).toThrow();});

test('actual acquisition return pins match every installed binary and notice',async()=>{
 const destination=await realpath(await mkdtemp(tmpdir()+'/private-tools-test-')),pins=fixtureTools(),qualification={production:'BLOCKED: fixture only'};
 const members=Object.values(pins).flatMap(pin=>pin.members);
 const dependencies={pins,qualification,download:async()=>Buffer.from('archive'),extract:(archive:string,member:string)=>{expect(readFileSync(archive).toString()).toBe('archive');const m=members.find(m=>m.member===member)!;return Buffer.from('fixture '+m.path);}};
 try{
  const result=await acquirePrivateToolsForTest('linux-x64',destination,dependencies);expect(result.tools).toEqual(pins);expect(result.qualification).toEqual(qualification);expect(result.target).toBe('linux-x64');
  const inventory=[];for(const member of members){const bytes=await readFile(destination+'/'+member.path),stat=await lstat(destination+'/'+member.path);expect(stat.mode&0o7777).toBe(member.path.startsWith('tools/')?0o700:0o600);expect(stat.uid).toBe(process.getuid?.());inventory.push({path:member.path,size:bytes.length,sha256:sha256(bytes)});}
  checkToolPins(result.tools,inventory,'linux-x64');expect(result.bytes).toBe(members.reduce((n,m)=>n+m.size,0));
 }finally{await rm(destination,{recursive:true,force:true});}
});
test('bad acquisition bytes and unsafe destinations fail before installing any member',async()=>{
 const destination=await realpath(await mkdtemp(tmpdir()+'/private-tools-fail-')),pins=fixtureTools();let calls=0;
 const dependencies={pins,qualification:{production:'BLOCKED'},download:async()=>{calls++;return Buffer.from('archive');},extract:()=>Buffer.from('invalid member')};
 try{
  await expect(acquirePrivateToolsForTest('linux-x64',destination,dependencies)).rejects.toThrow(/member mismatch/);expect(await readdir(destination)).toEqual([]);
  await expect(acquirePrivateToolsForTest('linux-x64',destination,{...dependencies,download:async()=>Buffer.from('tampered')})).rejects.toThrow(/capture mismatch/);expect(await readdir(destination)).toEqual([]);
  calls=0;await chmod(destination,0o755);await expect(acquirePrivateToolsForTest('linux-x64',destination,dependencies)).rejects.toThrow(/destination/);expect(calls).toBe(0);
 }finally{await rm(destination,{recursive:true,force:true});}
});
