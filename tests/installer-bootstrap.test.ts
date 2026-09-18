import { test, expect } from 'vitest';
import { readFile, writeFile, mkdtemp, mkdir, rm, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fixture, fixtureTools } from './bundle-fixture.js';
import { signedRelease } from './release-fixture.js';
import { canonical, createBundleManifest, sha256, compatibilityFor } from '../scripts/bundle-contract.mjs';
import { createBundleArchive } from '../scripts/bundle-archive.mjs';
import { generateInstallerBootstrap, assertProductionBootstrapReady } from '../scripts/generate-installer-bootstrap.mjs';
import { detectInstallerPlatform } from '../scripts/installer-platform.mjs';

async function bootstrapFixture(target='linux-x64'){
 const root=await fixture(),temp=await mkdtemp(tmpdir()+'/bootstrap-test-');
 try{
  const previous=JSON.parse(await readFile(root+'/bundle-manifest.json','utf8'));
  previous.target=target;previous.compatibility=compatibilityFor(target);previous.tools=fixtureTools(target);
  // Fixture executable reports the exact argv only; not a native qualification.
  const node=Buffer.from('#!/bin/bash\nprintf "ARG:%s\\n" "$@"\n');await writeFile(root+'/tools/node',node);
  const member=previous.tools.node.members.find((m:{path:string})=>m.path==='tools/node');member.size=node.length;member.sha256=sha256(node);
  const manifest=await createBundleManifest(root,{...previous,provenance:{kind:'release',sourceCommit:'a'.repeat(40)}});
  await writeFile(root+'/bundle-manifest.json',canonical(manifest)+'\n');await createBundleArchive(root,temp+'/bundle.tar.gz');
  const archiveBytes=await readFile(temp+'/bundle.tar.gz'),sbomBytes=Buffer.from('fixture SBOM');const capture={...signedRelease(archiveBytes,{sbom:{size:sbomBytes.length,sha256:sha256(sbomBytes)},bundleDigest:manifest.digest,target,compatibility:compatibilityFor(target),archive:{url:'https://github.com/asx8678/kiro-fabric/releases/download/v1.0.0/kiro-fabric-1.0.0-'+target+'.tar.gz',size:archiveBytes.length,sha256:sha256(archiveBytes)}}),sbomBytes};capture.verify(capture.metadataBytes,capture.signatureBytes,{archiveBytes,sbomBytes});
  const script=generateInstallerBootstrap([capture]);await writeFile(temp+'/install.sh',script,{mode:0o600});
  await writeFile(temp+'/bundle.tar.gz.spdx.json',capture.sbomBytes);
  await writeFile(temp+'/bundle.tar.gz.release.json',capture.metadataBytes);await writeFile(temp+'/bundle.tar.gz.release.sig',capture.signatureBytes);
  await mkdir(temp+'/bin');
  // System tools live in /bin or /usr/bin on macOS; sha256sum is not shipped there.
  for(const tool of ['tar','gzip','mktemp','wc','chmod','rm','cat','shasum']){
   const executable=['/usr/bin/'+tool,'/bin/'+tool].find(file=>spawnSync('/bin/test',['-x',file]).status===0);
   if(!executable)throw Error('Missing fixture prerequisite: '+tool);
   await symlink(executable,temp+'/bin/'+tool);
  }
  // These fixtures test pinned selection independently of the machine running Vitest.
  await writeFile(temp+'/bin/uname','#!/bin/bash\ncase "$1" in -s) printf "Linux\\n" ;; -m) printf "x86_64\\n" ;; -r) printf "6.8.0\\n" ;; esac\n',{mode:0o700});
  await writeFile(temp+'/bin/getconf','#!/bin/bash\nprintf "glibc 2.39\\n"\n',{mode:0o700});
  await writeFile(temp+'/bin/sysctl','#!/bin/bash\nprintf "%s\\n" "${FIXTURE_TRANSLATED:-0}"\n',{mode:0o700});
  // Exercise the preferred sha256sum interface using the native portable hash tool.
  await writeFile(temp+'/bin/sha256sum','#!/bin/bash\nexec shasum -a 256 "$@"\n',{mode:0o700});
  // Real platform tools may cold-start slowly under the full suite; this is a
  // harness safety bound, not a bootstrap performance requirement.
  const run=(args:string[]=[],env:Record<string,string>={})=>{
   const result=spawnSync('/bin/bash',[temp+'/install.sh',...args],{encoding:'utf8',timeout:15000,env:{PATH:temp+'/bin',HOME:temp,...env}});
   expect(result.error,result.stderr).toBeUndefined();
   return result;
  };
  return {root,temp,capture,script,run,cleanup:async()=>{await rm(root,{recursive:true,force:true});await rm(temp,{recursive:true,force:true});}};
 }catch(e){await rm(root,{recursive:true,force:true});await rm(temp,{recursive:true,force:true});throw e;}
}
test('production generator CLI fails before reading inputs or writing output',()=>{
 expect(()=>assertProductionBootstrapReady()).toThrow(/trust root.*BLOCKED/);
 const result=spawnSync(process.execPath,['scripts/generate-installer-bootstrap.mjs','/not-read'],{encoding:'utf8'});expect(result.status).not.toBe(0);expect(result.stderr).toMatch(/trust root.*BLOCKED/);
});
test('reproducible pinned Bash syntax, safe argv and local signed-sidecar handoff',async()=>{
 const f=await bootstrapFixture();try{
  expect(generateInstallerBootstrap([f.capture])).toBe(f.script);
  expect(spawnSync('/bin/bash',['-n',f.temp+'/install.sh']).status).toBe(0);
  const home=f.temp+'/home with spaces;$(no-eval)';
  const result=f.run(['--from-archive',f.temp+'/bundle.tar.gz','--version','1.0.0','--kiro-home',home,'--yes','--non-interactive']);
  expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('ARG:install\nARG:--from-archive\nARG:/tmp/kiro-fabric-bootstrap.');expect(result.stdout).toContain('ARG:--kiro-home\nARG:'+home+'\nARG:--yes\nARG:--non-interactive');
  const manager=result.stdout.split('\n')[0]!.slice(4);await expect(lstat(manager)).rejects.toThrow();await expect(lstat(home)).rejects.toThrow();
  // Empty forwarded array remains safe under Bash's nounset behavior.
  expect(f.run(['--from-archive',f.temp+'/bundle.tar.gz']).status).toBe(0);
 }finally{await f.cleanup();}
});
test('rejects unsupported arguments/version/home before prerequisites or state',async()=>{
 const f=await bootstrapFixture();try{
  for(const args of [['--version','2.0.0'],['--version'],['--from-source'],['--from-archive','relative'],['--kiro-home','/'],['--kiro-home','relative'],['--kiro-home','/tmp/x/../y'],['--signature-disable']]){
   const result=f.run(args,{PATH:'/nonexistent'});expect(result.status).not.toBe(0);expect(result.stderr).not.toContain('missing prerequisite');expect(result.stdout).toBe('');
  }
  const missing=f.run([],{PATH:'/nonexistent'});expect(missing.stderr).toContain('missing prerequisite: uname');
  const noCurl=f.run([]);expect(noCurl.stderr).toContain('missing prerequisite: curl');
 }finally{await f.cleanup();}
});
test('invalid whole archive hash fails before extraction, local sidecars are mandatory',async()=>{
 const f=await bootstrapFixture();try{
  const bad=Buffer.from(f.capture.archiveBytes);bad[bad.length-1]=bad[bad.length-1]!^1;await writeFile(f.temp+'/bad.tar.gz',bad);
  const result=f.run(['--from-archive',f.temp+'/bad.tar.gz']);expect(result.stderr).toContain('sha256 mismatch');expect(result.stdout).toBe('');
  await rm(f.temp+'/bundle.tar.gz.release.sig');const missing=f.run(['--from-archive',f.temp+'/bundle.tar.gz']);expect(missing.status).not.toBe(0);expect(missing.stderr).toContain('unsafe local archive/sidecar');
  await symlink(f.temp+'/bundle.tar.gz',f.temp+'/link');expect(f.run(['--from-archive',f.temp+'/link']).stderr).toContain('unsafe local');
 }finally{await f.cleanup();}
});
test.each(['missing','same-size','oversized'])('signed SBOM %s fails before bootstrap extraction or execution',async kind=>{
 const f=await bootstrapFixture();try{
  const file=f.temp+'/bundle.tar.gz.spdx.json';
  if(kind==='missing')await rm(file);
  if(kind==='same-size')await writeFile(file,Buffer.alloc(f.capture.sbomBytes.length));
  if(kind==='oversized')await writeFile(file,Buffer.alloc(f.capture.sbomBytes.length+1));
  const result=f.run(['--from-archive',f.temp+'/bundle.tar.gz']);
  expect(result.status).not.toBe(0);expect(result.stdout).toBe('');expect(result.stderr).toMatch(/unsafe local|sha256 mismatch|oversized local/);
  expect(()=>generateInstallerBootstrap([{...f.capture,sbomBytes:Buffer.alloc(f.capture.sbomBytes.length)}])).toThrow(/SBOM/);
 }finally{await f.cleanup();}
});
test('member hash failure prevents execution even after a valid whole archive',async()=>{
 const f=await bootstrapFixture();try{
  await rm(f.temp+'/bin/tar');await writeFile(f.temp+'/bin/tar','#!/bin/bash\nprintf "wrong"\n',{mode:0o700});
  const result=f.run(['--from-archive',f.temp+'/bundle.tar.gz']);expect(result.status).not.toBe(0);expect(result.stderr).toContain('size mismatch');expect(result.stdout).toBe('');
 }finally{await f.cleanup();}
});
const curlFixture=`#!/bin/bash
out='' headers='' url='' globoff=''
while [ "$#" -gt 0 ]; do
 case "$1" in
  --output) out=$2; shift 2 ;; --dump-header) headers=$2; shift 2 ;;
  --globoff) globoff=1; shift ;;
  --proto|--tlsv1.2|--silent|--show-error|-q) if [ "$1" = --proto ]; then shift 2; else shift; fi ;;
  --connect-timeout|--max-time|--max-filesize|--write-out) shift 2 ;;
  --) shift; url=$1; shift ;; *) exit 88 ;;
 esac
done
[ "$globoff" = 1 ] || exit 89
printf '%s\\n' "$url" >> "$FIXTURE_LOG"
if [ "\${FIXTURE_MODE:-}" = offline ]; then exit 7; fi
if [ "\${FIXTURE_MODE:-}" = redirect ]; then
 printf 'HTTP/1.1 302 Found\\r\\nLocation: https://github.com/loop\\r\\n\\r\\n' > "$headers"; : > "$out"; printf 302; exit 0
fi
if [ "\${FIXTURE_MODE:-}" = escape ]; then
 printf 'HTTP/1.1 302 Found\\r\\nLocation: https://evil.test/no\\r\\n\\r\\n' > "$headers"; : > "$out"; printf 302; exit 0
fi
printf 'HTTP/1.1 200 OK\\r\\n\\r\\n' > "$headers"
case "$url" in *.spdx.json) /bin/cat "$FIXTURE_ARCHIVE.spdx.json" > "$out" ;; *.release.json) /bin/cat "$FIXTURE_ARCHIVE.release.json" > "$out" ;; *.release.sig) /bin/cat "$FIXTURE_ARCHIVE.release.sig" > "$out" ;; *) /bin/cat "$FIXTURE_ARCHIVE" > "$out" ;; esac
if [ "\${FIXTURE_MODE:-}" = oversize ]; then printf extra >> "$out"; fi
printf 200
`;
test('bounded curl fixture downloads all sidecars, no fallback on offline/redirect/oversize',async()=>{
 const f=await bootstrapFixture();try{
  await writeFile(f.temp+'/bin/curl',curlFixture,{mode:0o700});const env={FIXTURE_ARCHIVE:f.temp+'/bundle.tar.gz',FIXTURE_LOG:f.temp+'/requests'};
  const result=f.run([],env);expect(result.status,result.stderr).toBe(0);expect((await readFile(env.FIXTURE_LOG,'utf8')).trim().split('\n')).toHaveLength(4);
  for(const [mode,message,count] of [['offline','offline',1],['redirect','redirect limit',5],['escape','unapproved HTTPS redirect',1],['oversize','oversized',1]] as const){
   await writeFile(env.FIXTURE_LOG,'');const failed=f.run([],{...env,FIXTURE_MODE:mode});expect(failed.status).not.toBe(0);expect(failed.stderr).toContain(message);expect(failed.stdout).toBe('');expect((await readFile(env.FIXTURE_LOG,'utf8')).trim().split('\n')).toHaveLength(count);
  }
 }finally{await f.cleanup();}
});
test('generator rejects unmatching captures and unsupported/missing closure',async()=>{
 const f=await bootstrapFixture();try{
  expect(()=>generateInstallerBootstrap([{...f.capture,archiveBytes:Buffer.from('bad')}])).toThrow(/archive mismatch/);
  expect(()=>generateInstallerBootstrap([f.capture,f.capture])).toThrow(/target\/version/);
  expect(()=>generateInstallerBootstrap([{...f.capture,metadata:{...f.capture.metadata,bundleDigest:'c'.repeat(64)}}])).toThrow(/manifest\/release/);
  expect(()=>generateInstallerBootstrap([])).toThrow();
 }finally{await f.cleanup();}
});

test('platform mapping and upstream system floors reject unsupported hosts before mktemp',async()=>{
 const f=await bootstrapFixture();try{
  await rm(f.temp+'/bin/uname');await writeFile(f.temp+'/bin/uname','#!/bin/bash\ncase "$1" in -s) printf "%s\\n" "${FIXTURE_OS:-Linux}" ;; -m) printf "%s\\n" "${FIXTURE_ARCH:-x86_64}" ;; -r) printf "%s\\n" "${FIXTURE_KERNEL:-6.8.0}" ;; esac\n',{mode:0o700});
  await rm(f.temp+'/bin/getconf');await writeFile(f.temp+'/bin/getconf','#!/bin/bash\nprintf "%s\\n" "${FIXTURE_LIBC:-glibc 2.39}"\n',{mode:0o700});
  await writeFile(f.temp+'/bin/sw_vers','#!/bin/bash\nprintf "%s\\n" "${FIXTURE_MACOS:-13.5}"\n',{mode:0o700});
  await rm(f.temp+'/bin/mktemp');await writeFile(f.temp+'/bin/mktemp','#!/bin/bash\nprintf "STATE CREATED" >&2\nexit 77\n',{mode:0o700});
  for(const [env,message] of [
   [{FIXTURE_OS:'FreeBSD'},'unsupported platform'],[{FIXTURE_ARCH:'riscv64'},'unsupported platform'],[{FIXTURE_LIBC:'musl 1.2'},'unsupported libc'],[{FIXTURE_LIBC:'glibc 2.27'},'unsupported glibc'],[{FIXTURE_KERNEL:'4.17.0'},'unsupported kernel'],[{FIXTURE_OS:'Darwin',FIXTURE_MACOS:'13.4'},'unsupported macOS'],[{FIXTURE_ARCH:'aarch64'},'unsupported target'],[{FIXTURE_OS:'Darwin',FIXTURE_ARCH:'arm64'},'unsupported target'],
  ] as [Record<string,string>,string][]){const r=f.run(['--from-archive',f.temp+'/bundle.tar.gz'],env);expect(r.stderr).toContain(message);expect(r.stderr).not.toContain('STATE CREATED');}
  for(const kernel of ['4.18.0','4.18+local','6.12.25+rpt-rpi-2712','6.12.0+','6.6.87.2-microsoft-standard-WSL2']){
   expect(detectInstallerPlatform({platform:'linux',arch:'x64',glibc:'2.28',osVersion:kernel}).target).toBe('linux-x64');
   const floors=f.run(['--from-archive',f.temp+'/bundle.tar.gz'],{FIXTURE_LIBC:'glibc 2.28',FIXTURE_KERNEL:kernel});expect(floors.stderr,kernel).toContain('STATE CREATED');
  }
  for(const kernel of ['4.17.99+local','6','6.12.','6.12..0','6.12.abc','6.12.0 vendor']){
   expect(()=>detectInstallerPlatform({platform:'linux',arch:'x64',glibc:'2.28',osVersion:kernel})).toThrow();
   const rejected=f.run(['--from-archive',f.temp+'/bundle.tar.gz'],{FIXTURE_KERNEL:kernel});expect(rejected.stderr,kernel).toContain('unsupported kernel');expect(rejected.stderr,kernel).not.toContain('STATE CREATED');
  }
 }finally{await f.cleanup();}
});
test('portable shasum fallback works without sha256sum',async()=>{
 const f=await bootstrapFixture();try{
  await rm(f.temp+'/bin/sha256sum');
  const result=f.run(['--from-archive',f.temp+'/bundle.tar.gz']);expect(result.status,result.stderr).toBe(0);
 }finally{await f.cleanup();}
});

test.each([
 ['darwin-arm64', '1'],
 ['darwin-x64', '0'],
 ['darwin-x64', ''],
])('translated Intel shell selects %s with sysctl observation %j',async(target,translated)=>{
 const f=await bootstrapFixture(target);try{
  await rm(f.temp+'/bin/uname');
  await writeFile(f.temp+'/bin/uname','#!/bin/bash\ncase "$1" in -s) printf "Darwin\\n" ;; -m) printf "x86_64\\n" ;; esac\n',{mode:0o700});
  await writeFile(f.temp+'/bin/sw_vers','#!/bin/bash\nprintf "13.5\\n"\n',{mode:0o700});
  await writeFile(f.temp+'/bin/sysctl','#!/bin/bash\n[ "$*" = "-in sysctl.proc_translated" ] || exit 90\nprintf "%s\\n" "$FIXTURE_TRANSLATED"\n',{mode:0o700});
  const result=f.run(['--from-archive',f.temp+'/bundle.tar.gz'],{FIXTURE_TRANSLATED:translated});
  expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('ARG:install');
  const invalid=f.run(['--from-archive',f.temp+'/bundle.tar.gz'],{FIXTURE_TRANSLATED:'unknown'});
  expect(invalid.status).not.toBe(0);expect(invalid.stderr).toContain('unsupported Rosetta observation');expect(invalid.stdout).toBe('');
  await rm(f.temp+'/bin/sysctl');
  expect(f.run(['--from-archive',f.temp+'/bundle.tar.gz']).stderr).toContain('missing prerequisite: sysctl');
 }finally{await f.cleanup();}
});

test('four pinned target mappings select their matching archive (simulated hosts, not native qualification)',async()=>{
 const fixtures=[];try{
  for(const target of ['darwin-arm64','darwin-x64','linux-arm64','linux-x64'])fixtures.push(await bootstrapFixture(target));
  const script=generateInstallerBootstrap(fixtures.map(f=>f.capture));expect(generateInstallerBootstrap(fixtures.map(f=>f.capture).reverse())).toBe(script);
  for(const f of fixtures){
   await writeFile(f.temp+'/install.sh',script);const target=f.capture.metadata.target;
   await rm(f.temp+'/bin/uname');await writeFile(f.temp+'/bin/uname','#!/bin/bash\ncase "$1" in -s) printf "%s\\n" "'+(target.startsWith('darwin')?'Darwin':'Linux')+'" ;; -m) printf "%s\\n" "'+(target.endsWith('x64')?'x86_64':target.startsWith('darwin')?'arm64':'aarch64')+'" ;; -r) printf "6.8.0\\n" ;; esac\n',{mode:0o700});
   await writeFile(f.temp+'/bin/sw_vers','#!/bin/bash\nprintf "13.5\\n"\n',{mode:0o700});
   const result=f.run(['--from-archive',f.temp+'/bundle.tar.gz']);expect(result.status,result.stderr).toBe(0);
  }
 }finally{for(const f of fixtures)await f.cleanup();}
});
