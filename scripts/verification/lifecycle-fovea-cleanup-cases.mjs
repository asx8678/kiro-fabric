// Real task-owned filesystem probes; all fixture directories and Git metadata retained.
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {build} from 'esbuild';import {createHash} from 'node:crypto';
async function api(context,fixture){
 const source='src/fovea/scratch-owner.ts',ownerText=fs.readFileSync(path.join(context.root,source),'utf8');assert.doesNotMatch(ownerText,/\b(?:rm|rmSync|unlinkSync|rmdirSync)\s*\(/u);
 const contents=`export {FoveaScratchOwner} from ${JSON.stringify(path.join(context.root,source))};export {coreContext} from ${JSON.stringify(path.join(context.root,'src/fovea/core/context.ts'))};export {maintainTempStorage} from ${JSON.stringify(path.join(context.root,'src/fovea/core/temp-storage.ts'))};export {fence} from 'w4-owned-fs';`;
 const result=await build({stdin:{contents,resolveDir:context.root},bundle:true,platform:'node',format:'esm',target:'node24',packages:'external',write:false,logLevel:'silent',plugins:[{name:'repository-removal-fence',setup(b){
  b.onResolve({filter:/^(?:node:fs\/promises|w4-owned-fs)$/},a=>a.namespace==='w4-fs'?{path:'node:fs/promises',external:true}:{path:'owned-fs',namespace:'w4-fs'});
  b.onLoad({filter:/.*/,namespace:'w4-fs'},()=>({contents:`import * as real from 'node:fs/promises';export * from 'node:fs/promises';export const fence={block:false,calls:[],failOnce:false};const run=(kind,args)=>{if(fence.block){fence.calls.push({kind,path:args[0]});throw new Error('repository/uncertainty fence: no removal permitted');}if(fence.failOnce){fence.failOnce=false;throw new Error('controlled one-shot EIO');}return real[kind](...args);};export const unlink=(...args)=>run('unlink',args),rmdir=(...args)=>run('rmdir',args),rm=(...args)=>run('rm',args);`,loader:'js'}));
 }}]});const entry=path.join(fixture,'owner.mjs');fs.writeFileSync(entry,result.outputFiles[0].contents,{flag:'wx',mode:0o600});return {api:await import(pathToFileURL(entry).href),hash:createHash('sha256').update(ownerText).digest('hex')};
}
export function createFoveaCleanupCases(){return [{id:'LC25',title:'Fovea scratch disposal proves ownership and preserves repositories and uncertain trees',effects:'bounded real file/empty-directory disposal in exclusive task-owned non-repository scratch; Git/replacement fixtures retained; no processes/network',deadlineMs:60000,run:async context=>{
 const fixture=fs.mkdtempSync(path.join(context.fixturesRoot,'fovea-cleanup-')),loaded=await api(context,fixture),facts=[];
 const write=(file,text='owned')=>fs.writeFileSync(file,text,{flag:'wx',mode:0o600});
 for(const kind of ['safe','git-directory','git-file','git-link','bare','symlink','hardlink','privacy-drift','replacement','replacement-file','unknown-generated-directory','missing-owned-tree','unknown-top-level','entry-bound','depth-bound','captured-file-changed']){
  const parent=fs.mkdtempSync(path.join(fixture,kind+'-')),foreign=path.join(parent,'foreign');fs.mkdirSync(foreign,{mode:0o700});const foreignFile=path.join(foreign,'keep');write(foreignFile,'foreign evidence');
  const limits=kind==='entry-bound'?{maxEntries:3}:kind==='depth-bound'?{maxDepth:1}:{};
  const owner=new loaded.api.FoveaScratchOwner(parent,limits);const root=await owner.createRoot(),stage=await owner.createStage();write(path.join(stage,'source.ts'),'export const value=1;');let marker;
  if(kind.startsWith('git-')){marker=path.join(stage,'.git');if(kind==='git-directory'){fs.mkdirSync(marker,{mode:0o700});write(path.join(marker,'keep'));}else if(kind==='git-file')write(marker,'gitdir: ../foreign\n');else fs.symlinkSync(foreign,marker);}
  if(kind==='bare'){write(path.join(stage,'HEAD'),'ref: refs/heads/main\n');fs.mkdirSync(path.join(stage,'objects'),{mode:0o700});fs.mkdirSync(path.join(stage,'refs'),{mode:0o700});marker=path.join(stage,'HEAD');}
  if(kind==='symlink')fs.symlinkSync(foreignFile,path.join(stage,'link.ts'));
  if(kind==='hardlink')fs.linkSync(foreignFile,path.join(stage,'link.ts'));
  if(kind==='privacy-drift')fs.chmodSync(path.join(stage,'source.ts'),0o620);
  if(kind==='replacement'||kind==='missing-owned-tree'){fs.renameSync(stage,path.join(parent,'retained-original'));if(kind==='replacement'){fs.mkdirSync(stage,{mode:0o700});fs.mkdirSync(path.join(stage,'.git'),{mode:0o700});marker=path.join(stage,'.git','keep');write(marker,'replacement repository');}}
  if(kind==='replacement-file'){fs.renameSync(stage,path.join(parent,'retained-original'));write(stage,'preserve replacement file');}
  if(kind==='unknown-generated-directory'){fs.mkdirSync(path.join(root,'managed-parser'),{mode:0o700});write(path.join(root,'managed-parser','foreign'),'preserve unknown directory');}
  if(kind==='unknown-top-level')write(path.join(root,'not-a-generated-file'),'preserve unknown');
  if(kind==='entry-bound'){write(path.join(stage,'two.ts'));write(path.join(stage,'three.ts'));}
  if(kind==='depth-bound'){fs.mkdirSync(path.join(stage,'deep'),{mode:0o700});write(path.join(stage,'deep','source.ts'));}
  if(kind==='captured-file-changed'){const file=path.join(root,'managed-parser');write(file,'first');await owner.captureFile(file);fs.writeFileSync(file,'changed');}
  loaded.api.fence.block=kind!=='safe';loaded.api.fence.calls=[];
  const close=owner.close();assert.equal(owner.close(),close,'close shares exact operation');
  if(kind==='safe'){await close;assert.equal(fs.existsSync(root),false);}
  else{await assert.rejects(close);await assert.rejects(owner.close());assert.ok(fs.existsSync(root));if(marker)assert.ok(fs.lstatSync(marker));await assert.rejects(owner.createStage());}
  assert.equal(loaded.api.fence.calls.length,0,'unsafe cleanup must be refused before any deletion');loaded.api.fence.block=false;
  assert.equal(fs.readFileSync(foreignFile,'utf8'),'foreign evidence');facts.push({kind,status:'passed',fixture:parent,repositoryMarker:marker,foreignPreserved:true});
 }
 // Repository controls always fence removals, even if a future implementation regresses.
 for(const kind of ['ancestor-repository','maintenance-repository','maintenance-safe','maintenance-no-authority','vanished-captured-file','sticky-cleanup-failure','active-cache-preserved']){
  const parent=fs.mkdtempSync(path.join(fixture,kind+'-')),owner=new loaded.api.FoveaScratchOwner(parent),root=await owner.createRoot();const fence=loaded.api.fence;fence.calls=[];fence.block=false;
  if(kind==='ancestor-repository'){const stage=await owner.createStage();write(path.join(stage,'source.ts'));fs.mkdirSync(path.join(root,'.git'),{mode:0o700});fence.block=true;await assert.rejects(owner.removeTree(stage));assert.ok(fs.existsSync(path.join(stage,'source.ts')));await assert.rejects(owner.close());}
  if(kind.startsWith('maintenance-')){const stale=path.join(root,'pi-fovea-aaaaaaaaaaaaaaaa.json'),fresh=path.join(root,'pi-fovea-bbbbbbbbbbbbbbbb.json');write(stale);write(fresh);fs.utimesSync(stale,0,0);if(kind==='maintenance-repository')fs.mkdirSync(path.join(root,'.git'),{mode:0o700});fence.block=kind!=='maintenance-safe';const ctx={store:new Map(),sessionStore:new Map(),storageRoot:root,...(kind==='maintenance-no-authority'?{}:{cleanupTemporary:(file,stat,available)=>owner.removeTemporary(file,stat,available)})};await loaded.api.coreContext.run(ctx,()=>loaded.api.maintainTempStorage(root));assert.equal(fs.existsSync(stale),kind!=='maintenance-safe');assert.ok(fs.existsSync(fresh));assert.equal(fence.calls.length,0);if(kind==='maintenance-repository')await assert.rejects(owner.close());else{fence.block=false;await owner.close();}}
  if(kind==='vanished-captured-file'){const file=path.join(root,'managed-parser');write(file);await owner.captureFile(file);fs.renameSync(file,path.join(parent,'retained-original'));fence.block=true;await assert.rejects(owner.removeFile(file));await assert.rejects(owner.close());assert.ok(fs.existsSync(root));}
  if(kind==='sticky-cleanup-failure'){const stage=await owner.createStage();write(path.join(stage,'source.ts'));fence.failOnce=true;await assert.rejects(owner.removeTree(stage));await assert.rejects(owner.close());assert.equal(fs.existsSync(root),false,'retry cleanup still attempted, without erasing failure');}
  if(kind==='active-cache-preserved'){const file=path.join(root,'pi-fovea-aaaaaaaaaaaaaaaa.json');write(file);let checks=0;assert.equal(await owner.removeTemporary(file,fs.statSync(file),()=>++checks===1),false);assert.ok(fs.existsSync(file));await owner.close();}
  assert.equal(fence.calls.length,0);fence.block=false;facts.push({kind,status:'passed',fixture:parent});
 }
 // Snapshot moves transfer only an explicitly captured identity, never overwrite a target.
 const parent=fs.mkdtempSync(path.join(fixture,'move-')),owner=new loaded.api.FoveaScratchOwner(parent);const root=await owner.createRoot(),stage=await owner.createStage();write(path.join(stage,'a.ts'));const target=path.join(root,'root-00000000-0000-0000-0000-000000000000');await owner.moveStage(stage,target);await owner.removeTree(stage);assert.equal(fs.existsSync(target),true);await owner.removeTree(target);await owner.close();facts.push({kind:'snapshot-ownership-transfer',status:'passed',fixture:parent});
 return {variants:facts,sourceHash:loaded.hash,fixture,retained:true,recursiveRemoval:false};
}}];}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const root=process.cwd(),fixturesRoot=fs.mkdtempSync(path.join(root,'.tmp/fovea-cleanup-proof-'));let report;try{report={status:'passed',facts:await createFoveaCleanupCases()[0].run({root,fixturesRoot})};}catch(error){report={status:'failed',error:{message:error.message,stack:error.stack}};process.exitCode=1;}fs.writeFileSync(path.join(fixturesRoot,'report.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify({status:report.status,variants:report.facts?.variants.length,error:report.error,report:path.join(fixturesRoot,'report.json')}));}
