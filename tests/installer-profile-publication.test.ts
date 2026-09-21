import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { afterEach, expect, test, vi } from 'vitest';
import { prepareLaunchProfile } from '../scripts/launch-profile.mjs';
import { publishImmutableProfile } from '../scripts/installer-profile-publication.mjs';
import { installerSafety as s } from '../scripts/install-agent-user.mjs';

const roots:string[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))removeFixtureSync(root,{recursive:true,force:true});});
function setup(){const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'profile-publication-')));roots.push(home);const directory=path.join(home,'agents');fs.mkdirSync(directory,{mode:0o700});return {home,directory,file:path.join(directory,'kiro-fabric-review-'+'a'.repeat(12)+'.json'),installation:{status:'active',owner:{currentRuntime:'a'.repeat(64)}}};}
const module=new URL('../scripts/installer-profile-publication.mjs',import.meta.url).href;
const launchModule=new URL('../scripts/launch-profile.mjs',import.meta.url).href;

test('first-byte ENOSPC never leaves a partial final profile and real selection retry succeeds',()=>{
 const f=setup(),original=fs.writeFileSync;let injected=false;
 vi.spyOn(fs,'writeFileSync').mockImplementation((...args:Parameters<typeof fs.writeFileSync>)=>{if(typeof args[0]==='number'&&!injected){injected=true;original(args[0],'{');throw Object.assign(Error('fixture ENOSPC'),{code:'ENOSPC'});}return original(...args);});
 expect(()=>prepareLaunchProfile(f.home,f.installation,'review')).toThrow('fixture ENOSPC');expect(injected).toBe(true);expect(fs.existsSync(f.file)).toBe(false);
 vi.restoreAllMocks();expect(prepareLaunchProfile(f.home,f.installation,'review').created).toBe(true);
 expect(JSON.parse(fs.readFileSync(f.file,'utf8')).tools).toEqual(['@fabric/fabric_exec']);expect(fs.statSync(f.file).nlink).toBe(1);
 expect(prepareLaunchProfile(f.home,f.installation,'review').created).toBe(false);
});

test.each(['profile-prepared','profile-bytes-synced','profile-linked','profile-published'])('real SIGKILL at %s publishes no partial final and converges without clobber',phase=>{
 const f=setup(),content='{"only":"complete bytes"}\n';
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import {publishImmutableProfile} from ${JSON.stringify(module)};publishImmutableProfile(${JSON.stringify(f.file)},${JSON.stringify(content)},{onPhase:p=>{if(p===${JSON.stringify(phase)})process.kill(process.pid,'SIGKILL');}});`],{env:{HOME:f.home,PATH:''},encoding:'utf8',timeout:15000});
 expect(child.stderr).toBe('');expect(child.signal).toBe('SIGKILL');
 const linked=phase==='profile-linked',published=linked||phase==='profile-published';
 expect(fs.existsSync(f.file)).toBe(published);
 if(published)expect(fs.readFileSync(f.file,'utf8')).toBe(content);
 if(linked){expect(fs.statSync(f.file).nlink).toBe(2);expect(()=>s.assertSafeFile(f.file)).toThrow();}
 const unknown=fs.readdirSync(f.directory).filter(n=>n.endsWith('.prepared')).map(n=>({file:path.join(f.directory,n),bytes:fs.readFileSync(path.join(f.directory,n))}));
 expect(publishImmutableProfile(f.file,content).created).toBe(!published);
 expect(fs.readFileSync(f.file,'utf8')).toBe(content);expect(s.assertSafeFile(f.file).nlink).toBe(1);expect(fs.statSync(f.file).mode&0o7777).toBe(0o600);
 if(!linked)for(const e of unknown)expect(fs.readFileSync(e.file)).toEqual(e.bytes); // No proof of ownership after death: keep unrelated preparations.
 expect(publishImmutableProfile(f.file,content).created).toBe(false);
});

test('SIGKILL after one byte retains uncertain preparation but real launch selection can retry',()=>{
 const f=setup();
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import fs from 'node:fs';import {prepareLaunchProfile} from ${JSON.stringify(launchModule)};const write=fs.writeFileSync;fs.writeFileSync=(file,...args)=>{if(typeof file==='number'){write(file,'{');process.kill(process.pid,'SIGKILL');}return write(file,...args);};prepareLaunchProfile(${JSON.stringify(f.home)},${JSON.stringify(f.installation)},'review');`],{env:{HOME:f.home,PATH:''},encoding:'utf8',timeout:15000});
 expect(child.stderr).toBe('');expect(child.signal).toBe('SIGKILL');expect(fs.existsSync(f.file)).toBe(false);
 const material=fs.readdirSync(f.directory);expect(material).toHaveLength(1);const partial=path.join(f.directory,material[0]!);expect(fs.readFileSync(partial,'utf8')).toBe('{');
 expect(prepareLaunchProfile(f.home,f.installation,'review').created).toBe(true);expect(fs.readFileSync(partial,'utf8')).toBe('{');
 expect(prepareLaunchProfile(f.home,f.installation,'review').created).toBe(false);
});

test.each(['profile-bytes-synced','profile-linked'])('foreign final replacement during %s is never overwritten or deleted',phase=>{
 const f=setup();
 expect(()=>publishImmutableProfile(f.file,'owned',{onPhase:p=>{if(p===phase){if(fs.existsSync(f.file))fs.unlinkSync(f.file);fs.writeFileSync(f.file,'foreign',{mode:0o600,flag:'wx'});}}})).toThrow();
 expect(fs.readFileSync(f.file,'utf8')).toBe('foreign');expect(fs.statSync(f.file).nlink).toBe(1);
 expect(()=>publishImmutableProfile(f.file,'owned')).toThrow(/different content/);expect(fs.readFileSync(f.file,'utf8')).toBe('foreign');
});

test('a replaced prepared inode is never removed by cleanup',()=>{
 const f=setup();let replaced='';
 expect(()=>publishImmutableProfile(f.file,'owned',{onPhase:p=>{if(p==='profile-bytes-synced'){replaced=path.join(f.directory,fs.readdirSync(f.directory)[0]!);fs.renameSync(replaced,path.join(f.home,'original'));fs.writeFileSync(replaced,'foreign',{mode:0o600});}}})).toThrow();
 expect(fs.readFileSync(replaced,'utf8')).toBe('foreign');expect(fs.existsSync(f.file)).toBe(false);
});

test.each(['hardlink','symlink','mode','parent alias'])('publication refuses %s even when profile bytes match',kind=>{
 const f=setup();publishImmutableProfile(f.file,'owned');
 if(kind==='hardlink')fs.linkSync(f.file,path.join(f.home,'unknown-link'));
 if(kind==='symlink'){fs.renameSync(f.file,path.join(f.home,'original'));fs.symlinkSync(path.join(f.home,'original'),f.file);}
 if(kind==='mode')fs.chmodSync(f.file,0o640);
 let file=f.file;if(kind==='parent alias'){const alias=path.join(f.home,'alias');fs.symlinkSync(f.directory,alias);file=path.join(alias,path.basename(f.file));}
 expect(()=>publishImmutableProfile(file,'owned')).toThrow();expect(fs.readFileSync(f.file,'utf8')).toBe('owned');
});

test('parent fsync failure leaves complete single-link final and matching retry fsyncs parent',()=>{
 const f=setup(),parent=fs.statSync(f.directory),original=fs.fsyncSync;let failures=0,syncs=0;
 vi.spyOn(fs,'fsyncSync').mockImplementation(fd=>{const st=fs.fstatSync(fd);if(st.isDirectory()&&st.ino===parent.ino&&st.dev===parent.dev){failures++;throw Error('fixture parent sync');}return original(fd);});
 expect(()=>publishImmutableProfile(f.file,'owned')).toThrow('fixture parent sync');expect(failures).toBeGreaterThan(0);
 expect(fs.readFileSync(f.file,'utf8')).toBe('owned');expect(fs.statSync(f.file).nlink).toBe(1);
 vi.restoreAllMocks();vi.spyOn(fs,'fsyncSync').mockImplementation(fd=>{const st=fs.fstatSync(fd);if(st.isDirectory()&&st.ino===parent.ino&&st.dev===parent.dev)syncs++;return original(fd);});
 expect(publishImmutableProfile(f.file,'owned').created).toBe(false);expect(syncs).toBeGreaterThan(0);
});

test('concurrent real publishers converge to one complete immutable final',async()=>{
 const f=setup(),content='complete concurrent content';
 const children=Array.from({length:6},()=>new Promise<{code:number|null,error:string,out:string}>((resolve,reject)=>{
  const child=spawn(process.execPath,['--input-type=module','-e',`import {publishImmutableProfile} from ${JSON.stringify(module)};console.log(JSON.stringify(publishImmutableProfile(${JSON.stringify(f.file)},${JSON.stringify(content)},{onPhase:p=>{if(p==='profile-linked')Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,75);}})));`],{env:{HOME:f.home,PATH:''},stdio:['ignore','pipe','pipe']});let error='',out='';child.stderr.on('data',b=>error+=b);child.stdout.on('data',b=>out+=b);child.on('error',reject);child.on('exit',code=>resolve({code,error,out}));
 }));
 const results=await Promise.all(children);for(const result of results){expect(result.error).toBe('');expect(result.code).toBe(0);}
 expect(results.map(r=>JSON.parse(r.out)).filter(r=>r.created)).toHaveLength(1);
 expect(fs.readFileSync(f.file,'utf8')).toBe(content);expect(fs.statSync(f.file).nlink).toBe(1);expect(fs.readdirSync(f.directory)).toEqual([path.basename(f.file)]);
});
