import fs from 'node:fs';
import path from 'node:path';
if(!process.cwd().startsWith('/tmp/kiro-fabric-audit-'))throw Error('Disposable checkout required');
const p=JSON.parse(fs.readFileSync('package.json','utf8'));
const results=[];
for(const [name,declared] of Object.entries({...p.dependencies,...p.devDependencies})){
 const local=JSON.parse(fs.readFileSync(path.join('node_modules',name,'package.json'),'utf8'));
 const source='https://registry.npmjs.org/'+encodeURIComponent(name)+'/latest';
 try{
  const response=await fetch(source,{signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('HTTP '+response.status);
  const data=await response.json();
  results.push({name,declared,resolved:local.version,localLicense:local.license??null,registryLatest:data.version,registryLatestLicense:data.license??null,source,retrievedUtc:new Date().toISOString()});
 }catch(error){results.push({name,declared,resolved:local.version,localLicense:local.license??null,registryLatest:'Unknown—not externally verified',source,error:error.message});}
}
console.log(JSON.stringify({method:'Read existing dependency package manifests and public npm latest metadata; no installation and no source or private metadata upload. Latest tag is not a compatibility recommendation. Exact-version license files are separately scoped.',results},null,2));
