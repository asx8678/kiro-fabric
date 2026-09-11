import { mkdtemp, mkdir, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBundleManifest, canonical, compatibilityFor, REQUIRED_APP, sha256 } from '../scripts/bundle-contract.mjs';
export function fixtureTools(target='linux-x64'){
 const make=(tool:string,paths:string[])=>{
  const base=tool==='node'?'https://nodejs.org/dist/v24.20.0/':'https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/';
  const triples:Record<string,string>={'darwin-arm64':'aarch64-apple-darwin','darwin-x64':'x86_64-apple-darwin','linux-arm64':'aarch64-unknown-linux-gnu','linux-x64':'x86_64-unknown-linux-musl'};
  const name=tool==='node'?'node-v24.20.0-'+target:'ripgrep-14.1.1-'+triples[target];
  const url=base+name+'.tar.gz';
  return {version:tool==='node'?'24.20.0':'14.1.1',url,size:7,sha256:sha256('archive'),checksumUrl:tool==='node'?base+'SHASUMS256.txt':url+'.sha256',members:paths.map(p=>({member:name+'/'+(p==='tools/node'?'bin/node':p==='tools/rg'?'rg':path.basename(p).replace(tool+'-','')),path:p,size:Buffer.byteLength('fixture '+p),sha256:sha256('fixture '+p)}))};
 };
 return {node:make('node',['tools/node','notices/node-LICENSE']),rg:make('rg',['tools/rg','notices/rg-LICENSE-MIT','notices/rg-COPYING','notices/rg-UNLICENSE'])};
}
export async function fixture(target='linux-x64'){
 const root=await mkdtemp(path.join(tmpdir(),'bundle-test-'));await chmod(root,0o700);
 const tools=fixtureTools(target);
 for(const p of [...REQUIRED_APP,'app/main.js',...Object.values(tools).flatMap(p=>p.members.map(m=>m.path)),'manager/install-manager.mjs','resources/steering/fabric.md','resources/skills/fabric-exec/SKILL.md','resources/skills/fabric-exec/references/api.md']){
  await mkdir(path.dirname(path.join(root,p)),{recursive:true,mode:0o700});await writeFile(path.join(root,p),'fixture '+p,{mode:p.startsWith('tools/')?0o700:0o600});
 }
 const manifest=await createBundleManifest(root,{version:'1.0.0',target,compatibility:compatibilityFor(target),provenance:{kind:'local-source',sourceDigest:sha256('source'),gitHead:null,dirty:true},tools});
 await writeFile(path.join(root,'bundle-manifest.json'),canonical(manifest)+'\n',{mode:0o600});return root;
}
