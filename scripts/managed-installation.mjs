import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { installerSafety as s, resolveKiroHome } from './install-agent-user.mjs';
import { validateBundle, checkManifest, canonical, readRegular } from './bundle-contract.mjs';
import { checkReleaseAdmission } from './release-trust.mjs';
import { generateAgentProfile } from './agent-profile.mjs';
import { readGenerationProfiles, retainGenerationProfile } from './installer-profile-store.mjs';
import { acquireInstallationLock, inspectInstallationLock } from './installer-lock.mjs';
import { transactionPaths, readControl, readTransaction, syncDirectory, recoverInstallTransaction, activateInstallTransaction } from './install-transaction.mjs';

const HASH=/^[a-f0-9]{64}$/, TX=/^[a-f0-9]{32}$/;
const OWNER='kiro-fabric-agent-user-install';
const bytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const digest=value=>value===null?null:s.hash(value);
const exact=(v,keys)=>{if(!v||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join()!==[...keys].sort().join())throw Error('invalid ownership fields');};
const mkdir=dir=>s.ensureDirectory(dir,{private:true,parentPrivate:false},[]);
function home(input,opts={}) { return resolveKiroHome(opts.env??{},opts.userHome??homedir(),{kiroHome:input}); }
export function completeGenerationLauncher(name) {
 if(!HASH.test(name))throw Error('invalid launcher generation');
 return Buffer.from('#!/bin/sh\nset -eu\nunset NODE_OPTIONS NODE_PATH NODE_REPL_EXTERNAL_MODULE NODE_EXTRA_CA_CERTS NODE_TLS_REJECT_UNAUTHORIZED NODE_V8_COVERAGE NODE_REDIRECT_WARNINGS NODE_COMPILE_CACHE OPENSSL_CONF OPENSSL_MODULES SSL_CERT_FILE SSL_CERT_DIR LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT LD_DEBUG LD_DEBUG_OUTPUT LD_PROFILE LD_ORIGIN_PATH DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH DYLD_FRAMEWORK_PATH DYLD_FALLBACK_LIBRARY_PATH DYLD_FALLBACK_FRAMEWORK_PATH DYLD_ROOT_PATH DYLD_IMAGE_SUFFIX DYLD_VERSIONED_LIBRARY_PATH DYLD_VERSIONED_FRAMEWORK_PATH ENV BASH_ENV CDPATH\ncase "$0" in */*) bindir=${0%/*} ;; *) printf "%s\n" "invoke the installed launcher by its exact path" >&2; exit 1 ;; esac\nbase=$(CDPATH= cd -P -- "$bindir/.." && pwd -P)\nexec "$base/runtime/'+name+'/tools/node" "$base/runtime/'+name+'/manager/install-manager.mjs" "$@"\n');
}
function profileFor(p,name) {
 const root=path.join(p.runtime,name);
 return generateAgentProfile({nodePath:path.join(root,'tools/node'),runtimeRoot:path.join(root,'app'),dataRoot:p.data,skillPath:path.join(root,'resources/skills/fabric-exec/SKILL.md'),steeringPath:path.join(root,'resources/steering/fabric.md'),bundleRoot:root,rgPath:path.join(root,'tools/rg')});
}
function validateGenerationProfile(p,name,raw) {
 const profile=JSON.parse(raw.toString()),expectedProfile=profileFor(p,name),server=profile.mcpServers?.fabric,expected=expectedProfile.mcpServers.fabric;
 // Hash-verified older profiles may OMIT forward-compatible environment keys;
 // declared values and every generation path must still agree exactly.
 for(const key of ['KIRO_FABRIC_LAUNCH_WORKSPACE','KIRO_FABRIC_WORKSPACE_SOURCE','KIRO_FABRIC_RUN_DECLARATION'])if(server?.env&&!Object.hasOwn(server.env,key))delete expected.env[key];
 if(!server||server.command!==expected.command||JSON.stringify(server.args)!==JSON.stringify(expected.args)||JSON.stringify(server.env)!==JSON.stringify(expected.env)||JSON.stringify(profile.resources)!==JSON.stringify(expectedProfile.resources))throw Error('profile generation binding mismatch');
 for(const key of ['tools','allowedTools','includePowers','includeMcpJson','permissions'])if(JSON.stringify(profile[key])!==JSON.stringify(expectedProfile[key]))throw Error('profile strict Code Mode mismatch');
 if(Object.keys(profile.mcpServers).join()!=='fabric')throw Error('profile strict Code Mode server mismatch');
}
function retainedProfile(state,p,name) {
 const raw=readGenerationProfiles(p,state.owner,{validateOwner,validateProfile:validateGenerationProfile}).get(name);
 if(!raw)throw Error('Target-compatible profile unavailable for retained generation; preserve installation and original controls');
 return raw;
}
function validateOwner(o,p,kiroHome) {
 exact(o,['schemaVersion','owner','installationId','kiroHome','dataRoot','status','currentRuntime','previousRuntime','runtimeGenerations','profileSha256','launcherSha256','releaseStateSha256','transactionId',...(o.legacy!==undefined?['legacy']:[])]);
 if(o.schemaVersion!==3||o.owner!==OWNER||!TX.test(o.installationId)||o.kiroHome!==kiroHome||o.dataRoot!==p.data||!['active','retired'].includes(o.status)||!TX.test(o.transactionId)||!HASH.test(o.currentRuntime)||!(o.previousRuntime===null||HASH.test(o.previousRuntime))||!HASH.test(o.launcherSha256)||!(o.releaseStateSha256===null||HASH.test(o.releaseStateSha256))||!(o.status==='retired'?o.profileSha256===null:HASH.test(o.profileSha256)))throw Error('invalid complete ownership identity');
 if(!Array.isArray(o.runtimeGenerations)||o.runtimeGenerations.length<1||o.runtimeGenerations.length>256)throw Error('generation capacity/identity');
 const seen=new Set();for(const r of o.runtimeGenerations){exact(r,['name','manifestSha256']);if(!HASH.test(r.name)||!HASH.test(r.manifestSha256)||seen.has(r.name))throw Error('invalid generation record');seen.add(r.name);}
 if(!seen.has(o.currentRuntime)||(o.previousRuntime!==null&&!seen.has(o.previousRuntime)))throw Error('missing active generation');
 return o;
}
function legacyNames(legacy,p) {
 if(!legacy)return [];
 exact(legacy,['manifestBase64','evidence']);
 const raw=Buffer.from(legacy.manifestBase64,'base64');if(raw.toString('base64')!==legacy.manifestBase64||raw.length>4*1024*1024)throw Error('invalid legacy evidence');
 const m=JSON.parse(raw.toString());if(m.owner!==OWNER||![1,2].includes(m.schemaVersion))throw Error('invalid legacy owner');
 const e=legacy.evidence;
 if(m.schemaVersion===1){exact(e,['skillRoot','skillTree','runtimeRoot','runtimeTree']);if(e.skillRoot!==path.join(p.skills,'fabric-exec')||e.runtimeRoot!==path.join(p.runtime,m.packageDigest)||!HASH.test(m.packageDigest))throw Error('invalid legacy paths');s.assertSameTree(e.skillRoot,e.skillTree,'preserved legacy skill');s.assertSameTree(e.runtimeRoot,e.runtimeTree,'preserved uncertain legacy runtime');return [m.packageDigest];}
 exact(e,['skill','runtimeGenerations']);if(JSON.stringify(e.skill)!==JSON.stringify(m.skill)||JSON.stringify(e.runtimeGenerations)!==JSON.stringify(m.runtimeGenerations)||!Array.isArray(e.runtimeGenerations)||e.runtimeGenerations.length>256)throw Error('invalid legacy inventories');
 s.assertSameTree(path.join(p.skills,'fabric-exec'),e.skill,'legacy skill');for(const r of e.runtimeGenerations){if(!HASH.test(r.name))throw Error('invalid legacy generation');s.assertSameTree(path.join(p.runtime,r.name),r.tree,'legacy runtime');}return e.runtimeGenerations.map(r=>r.name);
}
function releaseState(p,owner,raw=readControl(p.releaseState)) {
 if(digest(raw)!==owner.releaseStateSha256)throw Error('modified release state');if(!raw)return null;
 const v=JSON.parse(raw.toString());exact(v,['schema','product','highestVersion','highestDigest','accepted']);if(v.schema!==1||v.product!=='kiro-fabric'||!Array.isArray(v.accepted)||v.accepted.length<1||v.accepted.length>256)throw Error('invalid release state');
 const seen=new Set();for(const r of v.accepted){exact(r,['version','digest']);if(typeof r.version!=='string'||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(r.version)||!HASH.test(r.digest)||seen.has(r.version))throw Error('invalid accepted release');seen.add(r.version);}
 if(!v.accepted.some(r=>r.version===v.highestVersion&&r.digest===v.highestDigest))throw Error('invalid highest release');return v;
}
/** Read-only: never locks, replays, initializes data or probes external clients. */
export async function inspectCompleteInstallation(kiroHome,{verifyGenerations=true}={}) {
 kiroHome=home(kiroHome);const p=transactionPaths(kiroHome);
 for(const dir of [p.base,p.runtime,p.data,path.join(p.base,'bin'),path.join(p.base,'.transactions')])if(s.lstat(dir))s.assertSafeDirectory(dir,{private:true});
 if(s.lstat(path.dirname(p.journal))){for(const name of fs.readdirSync(path.dirname(p.journal)))if(!['active.json','candidate.json'].includes(name))throw Error('recovery-required: foreign transaction material');}
 if(s.lstat(p.journal)||s.lstat(path.join(p.base,'.transactions/candidate.json')))return {owner:null,paths:p,generations:[],status:'recovery-required'};
 const raw=readControl(p.manifest);
 if(!raw){if(s.lstat(p.profile)||s.lstat(p.launcher)||s.lstat(p.releaseState)||s.lstat(path.join(p.base,'profile-snapshots'))||(s.lstat(p.runtime)&&fs.readdirSync(p.runtime).length))throw Error('unowned installation targets');return {owner:null,paths:p,generations:[],status:'absent'};}
 const parsed=JSON.parse(raw.toString());if(parsed.schemaVersion!==3){const legacy=s.readLegacyInstallation(kiroHome);return {owner:null,paths:p,generations:[],status:'legacy',legacy};}
 const owner=validateOwner(parsed,p,kiroHome),oldNames=legacyNames(owner.legacy,p);
 if(!raw.equals(bytes(owner)))throw Error('noncanonical ownership bytes');
 for(const dir of [p.base,p.runtime,p.data,path.join(p.data,'fabric'),path.dirname(p.launcher),path.dirname(p.journal)]){s.assertSafeDirectory(dir,{private:true});if((fs.lstatSync(dir).mode&0o7777)!==0o700)throw Error('managed directory mode must be 0700');}
 const known=new Set([...owner.runtimeGenerations.map(r=>r.name),...oldNames]);
 for(const name of fs.readdirSync(p.runtime)){if(!known.has(name))throw Error('unowned runtime entry: '+name);}
 const generations=[];for(const r of owner.runtimeGenerations){const root=path.join(p.runtime,r.name),rawManifest=readControl(path.join(root,'bundle-manifest.json'));if(!rawManifest||s.hash(rawManifest)!==r.manifestSha256)throw Error('modified generation manifest');const m=JSON.parse(rawManifest.toString());checkManifest(m);if(rawManifest.toString()!==canonical(m)+'\n'||m.digest!==r.name)throw Error('generation identity mismatch');generations.push(verifyGenerations?await validateBundle(root):{root,digest:m.digest,manifest:m,version:m.version,inventory:m.inventory});}
 if(digest(readControl(p.profile))!==owner.profileSha256||digest(readControl(p.launcher,0o700))!==owner.launcherSha256)throw Error('modified profile/launcher');
 if(owner.launcherSha256!==s.hash(completeGenerationLauncher(owner.currentRuntime)))throw Error('launcher binding mismatch');
 if(owner.status==='active')validateGenerationProfile(p,owner.currentRuntime,readControl(p.profile));
 readGenerationProfiles(p,owner,{validateOwner,validateProfile:validateGenerationProfile});
 releaseState(p,owner);return {owner,paths:p,generations,status:owner.status};
}
function candidatePath(p){return path.join(p.base,'.transactions/candidate.json');}
function candidateRecord(p) {
 const raw=readControl(candidatePath(p));if(!raw)return null;const c=JSON.parse(raw.toString());exact(c,['schemaVersion','transactionId','kiroHome','baseIdentity','stageIdentity','purpose','manifest']);exact(c.baseIdentity,['dev','ino']);if(c.stageIdentity!==null){exact(c.stageIdentity,['dev','ino']);if(!/^\d+$/.test(c.stageIdentity.dev)||!/^\d+$/.test(c.stageIdentity.ino))throw Error('candidate inode identity');}const st=fs.lstatSync(p.base);if(!['activate','validate-retained'].includes(c.purpose)||c.schemaVersion!==1||c.kiroHome!==path.dirname(p.base)||!TX.test(c.transactionId)||c.baseIdentity.dev!==String(st.dev)||c.baseIdentity.ino!==String(st.ino))throw Error('recovery-required: candidate identity');checkManifest(c.manifest);return c;
}
// Only remove the exact bounded subset recorded before copying. Unknown or
// partially-written bytes are conflicts, never an excuse for recursive rm.
function discardCandidateTree(root,m) {
 if(!s.lstat(root))return;s.assertSafeDirectory(root,{private:true});
 const expected=new Map([...m.inventory,{path:'bundle-manifest.json',mode:0o600,size:Buffer.byteLength(canonical(m)+'\n'),sha256:s.hash(canonical(m)+'\n')}].map(r=>[r.path,r]));
 const files=[],dirs=[];
 const walk=(rel)=>{const dir=path.join(root,rel);s.assertSafeDirectory(dir,{private:true});if((fs.lstatSync(dir).mode&0o7777)!==0o700)throw Error('candidate directory mode');for(const n of fs.readdirSync(dir)){const r=rel?rel+'/'+n:n,target=path.join(root,r),st=s.lstat(target);if(st.isDirectory()&&!st.isSymbolicLink()){if(![...expected.keys()].some(candidateName=>candidateName.startsWith(r+'/')))throw Error('foreign candidate directory');walk(r);}else{const e=expected.get(r);if(!e||!st.isFile()||st.isSymbolicLink()||st.nlink!==1||(st.mode&0o7777)!==e.mode||st.size!==e.size||s.hash(fs.readFileSync(target))!==e.sha256)throw Error('recovery-required: conflicting candidate bytes');s.assertSafeFile(target);files.push(target);}}dirs.push(dir);};
 walk('');for(const f of files)fs.unlinkSync(f);for(const d of dirs)fs.rmdirSync(d);syncDirectory(path.dirname(root));
}
async function recoverCandidate(p) {
 const c=candidateRecord(p);if(!c)return {recovered:false};
 const raw=readControl(p.manifest),o=raw?JSON.parse(raw.toString()):null;
 const target=path.join(p.runtime,c.manifest.digest),stage=path.join(p.runtime,'.candidate-'+c.transactionId);
 for(const root of c.purpose==='activate'?[target,stage]:[stage]){const st=s.lstat(root);if(st&&(!c.stageIdentity||String(st.dev)!==c.stageIdentity.dev||String(st.ino)!==c.stageIdentity.ino))throw Error('recovery-required: candidate root identity changed');}
 if(c.purpose==='validate-retained'&&!(o?.schemaVersion===3&&o.runtimeGenerations?.some(r=>r.name===c.manifest.digest)))throw Error('recovery-required: retained validation owner missing');
 if(o?.schemaVersion===3&&o.runtimeGenerations?.some(r=>r.name===c.manifest.digest)){validateOwner(o,p,path.dirname(p.base));const b=await validateBundle(target);if(canonical(b.manifest)!==canonical(c.manifest))throw Error('candidate committed mismatch');}
 else discardCandidateTree(target,c.manifest);
 discardCandidateTree(stage,c.manifest);syncDirectory(p.runtime);fs.unlinkSync(candidatePath(p));syncDirectory(path.dirname(candidatePath(p)));return {recovered:true,transactionId:c.transactionId,targetDigest:c.manifest.digest,purpose:c.purpose};
}
async function publishGeneration(bundle,p,transactionId,onPhase,validateCandidate,retained=false,profile=bytes(profileFor(p,bundle.digest))) {
 const disk=fs.statfsSync(p.base,{bigint:true});if(disk.bavail*disk.bsize<BigInt(bundle.bytes)*2n+16n*1024n*1024n)throw Error('insufficient free space for candidate and bounded transaction backups');
 const marker=candidatePath(p);if(s.lstat(marker))throw Error('pending candidate');const st=fs.lstatSync(p.base);
 const stage=path.join(p.runtime,'.candidate-'+transactionId),target=path.join(p.runtime,bundle.digest);if(s.lstat(stage)||(!retained&&s.lstat(target)))throw Error('unowned candidate collision');
 const record={schemaVersion:1,transactionId,kiroHome:path.dirname(p.base),baseIdentity:{dev:String(st.dev),ino:String(st.ino)},stageIdentity:null,purpose:retained?'validate-retained':'activate',manifest:bundle.manifest};
 s.atomicWrite(marker,bytes(record));await onPhase('candidate-journal-synced');
 if(!retained&&s.lstat(target))throw Error('unowned candidate collision');fs.mkdirSync(stage,{mode:0o700});syncDirectory(p.runtime);
 const stageStat=fs.lstatSync(stage);record.stageIdentity={dev:String(stageStat.dev),ino:String(stageStat.ino)};s.atomicWrite(marker,bytes(record));await onPhase('candidate-root-owned');
 for(const r of [...bundle.inventory,{path:'bundle-manifest.json',mode:0o600,size:Buffer.byteLength(canonical(bundle.manifest)+'\n'),sha256:s.hash(canonical(bundle.manifest)+'\n')}]){
 await onPhase('before-copy:'+r.path);const source=path.join(bundle.root,r.path),destination=path.join(stage,r.path);mkdir(path.dirname(destination));const data=await readRegular(source,r.size);if(data.length!==r.size||s.hash(data)!==r.sha256)throw Error('source changed while copying');fs.writeFileSync(destination,data,{flag:'wx',mode:r.mode});await onPhase('copied-bytes:'+r.path);const fd=fs.openSync(destination,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDirectory(path.dirname(destination));await onPhase('copied:'+r.path);
 }
 await validateBundle(stage);await validateBundle(bundle.root);
 await onPhase('before-candidate-validation');await validateCandidate(stage,{profile:JSON.parse(profile.toString()),kiroHome:path.dirname(p.base),dataRoot:p.data});await onPhase('candidate-validated');
 await validateBundle(stage);await validateBundle(bundle.root);
 if(retained){await recoverCandidate(p);return await validateBundle(bundle.root);}
 const syncTree=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true}))if(entry.isDirectory())syncTree(path.join(dir,entry.name));syncDirectory(dir);};syncTree(stage);await onPhase('candidate-synced');if(s.lstat(target))throw Error('unowned generation appeared before publication');const verifiedStage=fs.lstatSync(stage);if(String(verifiedStage.dev)!==record.stageIdentity.dev||String(verifiedStage.ino)!==record.stageIdentity.ino)throw Error('candidate root changed before publication');fs.renameSync(stage,target);syncDirectory(p.runtime);await onPhase('generation-published');return await validateBundle(target);
}
// Verify the semantic controls as well as journal hashes BEFORE restoring or
// deleting any evidence. The offline entrypoint must not "clean" an unknown
// owner/profile/release schema and only discover the conflict after cleanup.
function validateRecoveryEvidence(kiroHome,p) {
 const journal=readTransaction(kiroHome),candidate=candidateRecord(p);if(!journal&&!candidate)return;
 const current=readControl(p.manifest),selected=current?JSON.parse(current.toString()):null;
 const known=new Set();let legacy=false;
 const verify=(raw,profile,launcher,trust)=>{
  if(!raw)return;
  const o=JSON.parse(raw.toString());if(o.schemaVersion!==3){legacy=true;return;}
  validateOwner(o,p,kiroHome);
  if(!raw.equals(bytes(o))||digest(profile)!==o.profileSha256||digest(launcher)!==o.launcherSha256||o.launcherSha256!==s.hash(completeGenerationLauncher(o.currentRuntime)))throw Error('recovery-required: invalid generation control binding');
  if(o.status==='active')validateGenerationProfile(p,o.currentRuntime,profile);
  releaseState(p,o,trust);
  for(const r of o.runtimeGenerations)known.add(r.name);
  for(const name of legacyNames(o.legacy,p))known.add(name);
 };
 if(journal){
  for(const side of ['before','after']){
   const control=name=>journal.controls[name][side]===null?null:Buffer.from(journal.controls[name][side],'base64');
   verify(control('manifest'),control('profile'),control('launcher'),control('releaseState'));
  }
 }else verify(current,readControl(p.profile),readControl(p.launcher,0o700),readControl(p.releaseState));
 if(selected?.schemaVersion===3)readGenerationProfiles(p,validateOwner(selected,p,kiroHome),{validateOwner,validateProfile:validateGenerationProfile});
 if(candidate){known.add(candidate.manifest.digest);known.add('.candidate-'+candidate.transactionId);}
 if(!legacy&&s.lstat(p.runtime))for(const name of fs.readdirSync(p.runtime))if(!known.has(name))throw Error('recovery-required: foreign runtime evidence preserved');
}
async function mutate(kiroHome,opts,action,{initialize=true}={}) {
 kiroHome=home(kiroHome,opts);const p=transactionPaths(kiroHome),onPhase=opts.onPhase??(()=>{}),transactionId=randomBytes(16).toString('hex');
 // Resolve and diagnose before creating any paths. Confirmation belongs to Main.
 const preliminary=await inspectCompleteInstallation(kiroHome);
 if(preliminary.status==='recovery-required'){readTransaction(kiroHome);candidateRecord(p);}
 if(initialize){mkdir(kiroHome);mkdir(p.base);}else{s.assertSafeDirectory(p.base,{private:true});}
 const lockEvidence=inspectInstallationLock(p.base);
 const recover=preliminary.status!=='absent'||(lockEvidence.status==='stale'&&TX.test(lockEvidence.owner?.transactionId));
 const release=acquireInstallationLock(p.base,{recover,transactionId,onPhase});
 try {
  validateRecoveryEvidence(kiroHome,p);
  const transaction=await recoverInstallTransaction(kiroHome,{onPhase}),candidate=await recoverCandidate(p);
  const state=await inspectCompleteInstallation(kiroHome);
  const locks=release.recovered??[],committedLock=locks.find(r=>r.owner.transactionId===state.owner?.transactionId);
  const recovery={transaction,candidate,locks,recovered:transaction.recovered||candidate.recovered||locks.length>0,committed:transaction.committed===true||!!committedLock,priorAction:transaction.recovered?transaction.action:committedLock?'existing-owner':null,targetDigest:transaction.recovered?transaction.targetDigest:committedLock?state.owner.currentRuntime:null};
  if(initialize)for(const dir of [path.dirname(p.profile),p.runtime,p.data,path.join(p.data,'fabric'),path.dirname(p.launcher),path.dirname(p.journal)])mkdir(dir);
  return await action(state,{p,transactionId,onPhase,kiroHome,recovery});
 }
 catch(error){
  if(JSON.parse(readControl(p.manifest)?.toString()??'null')?.transactionId===transactionId){error.committed=true;if(error.recoveryRequired===undefined)error.recoveryRequired=true;}
  else if(error.committed===undefined)error.committed=false;
  // A failed candidate can leave valid replay evidence before owner publication.
  // Report that state even though activation has not committed. Never erase it here.
  if(s.lstat(p.journal)||s.lstat(candidatePath(p)))error.recoveryRequired=true;
  throw error;
 }
 finally {try{release();}catch(error){error.committed=JSON.parse(readControl(p.manifest)?.toString()??'null')?.transactionId===transactionId;error.recoveryRequired=true;throw error;}}
}
function nextOwner(state,p,kiroHome,transactionId,name,manifestSha256) {
 const old=state.owner,records=old?[...old.runtimeGenerations]:[];if(!records.some(r=>r.name===name)){if(records.length>=256)throw Error('generation capacity reached; nothing removed');records.push({name,manifestSha256});}
 const o={schemaVersion:3,owner:OWNER,installationId:old?.installationId??randomBytes(16).toString('hex'),kiroHome,dataRoot:p.data,status:'active',currentRuntime:name,previousRuntime:old?(old.currentRuntime===name?old.previousRuntime:old.currentRuntime):null,runtimeGenerations:records,profileSha256:s.hash(bytes(profileFor(p,name))),launcherSha256:s.hash(completeGenerationLauncher(name)),releaseStateSha256:old?.releaseStateSha256??null,transactionId};
 if(old?.legacy)o.legacy=old.legacy;
 if(state.legacy){const r=state.legacy;o.legacy={manifestBase64:r.bytes.toString('base64'),evidence:r.legacy??{skill:r.manifest.skill,runtimeGenerations:r.manifest.runtimeGenerations}};}
 return o;
}
function resultAliases(owner,p,noop=false) {
 const manifest=owner?JSON.parse(readControl(path.join(p.runtime,owner.currentRuntime,'bundle-manifest.json')).toString()):null;
 return {outcome:noop?'noop':owner?.status==='retired'?'retired':'activated',version:manifest?.version??null,generation:owner?.currentRuntime??null,dataRoot:p.data,warnings:owner?.legacy?['Legacy runtime and shared skills remain at their exact paths; legacy starts cannot be fenced.']:[]};
}
async function commit(state,ctx,o,trust,profile=o.status==='retired'?null:bytes(profileFor(ctx.p,o.currentRuntime))) {
 const {p,transactionId,onPhase,kiroHome}=ctx;
 const old=state.owner;
 if(old){if(digest(readControl(p.manifest))!==s.hash(bytes(old))||digest(readControl(p.profile))!==old.profileSha256||digest(readControl(p.launcher,0o700))!==old.launcherSha256||digest(readControl(p.releaseState))!==old.releaseStateSha256)throw Error('control changed before activation');}
 else if(!state.legacy&&(readControl(p.manifest)!==null||readControl(p.profile)!==null||readControl(p.launcher,0o700)!==null||readControl(p.releaseState)!==null))throw Error('unowned control appeared before activation');
 // Recheck all old immutable resources immediately before the first live write.
 // A candidate marker is expected here, so verify via the already bound records.
 for(const r of o.runtimeGenerations){const b=await validateBundle(path.join(p.runtime,r.name));if(b.digest!==r.name||s.hash(canonical(b.manifest)+'\n')!==r.manifestSha256)throw Error('generation changed before activation');}
 const candidate=candidateRecord(p);if(candidate){const st=fs.lstatSync(path.join(p.runtime,candidate.manifest.digest));if(String(st.dev)!==candidate.stageIdentity?.dev||String(st.ino)!==candidate.stageIdentity?.ino)throw Error('candidate inode changed before activation');}
 if(state.legacy){if(!readControl(p.manifest)?.equals(state.legacy.bytes)||digest(readControl(p.profile))!==state.legacy.manifest.profileSha256||readControl(p.launcher,0o700)!==null||readControl(p.releaseState)!==null)throw Error('legacy controls changed');legacyNames(o.legacy,p);}
 const allowed=new Set([...o.runtimeGenerations.map(r=>r.name),...legacyNames(o.legacy,p)]);for(const name of fs.readdirSync(p.runtime))if(!allowed.has(name))throw Error('unowned runtime appeared before activation');
 if(digest(profile)!==o.profileSha256)throw Error('Profile activation binding mismatch');
 retainGenerationProfile(p,state.owner,{validateOwner,validateProfile:validateGenerationProfile});
 await onPhase('profile-snapshot-retained');
 const result=await activateInstallTransaction(kiroHome,{transactionId,onPhase,after:{profile,launcher:completeGenerationLauncher(o.currentRuntime),releaseState:trust,manifest:bytes(o)}});
 await recoverCandidate(p);return {...result,...resultAliases(o,p),owner:o,paths:p,status:o.status,digest:o.currentRuntime,dataPreserved:true,restartRequired:o.status!=='retired'};
}
/** validateCandidate is trusted manager code, never a CLI/env validation bypass. */
export async function installCompleteGeneration(bundleRoot,opts={}) {
 if(!['source','release'].includes(opts.provenance))throw Error('explicit provenance required');
 if(typeof opts.validateCandidate!=='function')throw Error('trusted candidate validation callback required');
 const bundle=await validateBundle(bundleRoot),kiroHome=home(opts.kiroHome,opts);
 const incomingState=await inspectCompleteInstallation(kiroHome);
 const exactRetained=incomingState.owner?.runtimeGenerations.some(r=>r.name===bundle.digest)&&bundle.root===path.join(incomingState.paths.runtime,bundle.digest);
 if(!exactRetained)s.assertNoPathOverlap(kiroHome,bundle.root,'incoming bundle');
 if(opts.provenance==='source'&&bundle.manifest.provenance.kind!=='local-source')throw Error('source provenance mismatch');
 return mutate(kiroHome,opts,async(state,ctx)=>{
 const {p,transactionId,onPhase}=ctx;let trust=readControl(p.releaseState);
 if(opts.provenance==='release'){
 const m=opts.releaseMetadata;if(!m||m.bundleDigest!==bundle.digest||m.version!==bundle.version||m.target!==bundle.manifest.target||m.sourceCommit!==bundle.manifest.provenance.sourceCommit)throw Error('trusted release identity mismatch');
 const old=state.owner?releaseState(p,state.owner):null;checkReleaseAdmission(m,old);
 if(!old||!old.accepted.some(r=>r.version===m.version))trust=bytes({schema:1,product:'kiro-fabric',highestVersion:m.version,highestDigest:m.bundleDigest,accepted:[...(old?.accepted??[]),{version:m.version,digest:m.bundleDigest}]});
 }
 if(state.owner?.status==='active'&&state.owner.currentRuntime===bundle.digest&&digest(trust)===state.owner.releaseStateSha256)return {...resultAliases(state.owner,p,true),committed:false,noop:true,owner:state.owner,paths:p,status:'active',digest:bundle.digest,dataPreserved:true,restartRequired:false};
 const o=nextOwner(state,p,ctx.kiroHome,transactionId,bundle.digest,s.hash(canonical(bundle.manifest)+'\n'));o.releaseStateSha256=digest(trust);
 const retained=state.owner?.runtimeGenerations.some(r=>r.name===bundle.digest);
 const profile=retained?retainedProfile(state,p,bundle.digest):bytes(profileFor(p,bundle.digest));o.profileSha256=s.hash(profile);
 await publishGeneration(retained?await validateBundle(path.join(p.runtime,bundle.digest)):bundle,p,transactionId,onPhase,opts.validateCandidate,retained,profile);
 return commit(state,ctx,o,trust,profile);
 });
}
export async function rollbackCompleteGeneration(kiroHome,opts={}) {
 if(opts.digest!==undefined&&(typeof opts.digest!=='string'||!HASH.test(opts.digest)))throw Error('Invalid explicit rollback digest');
 return mutate(kiroHome,opts,async(state,ctx)=>{
  // Recovery may have committed A <- B already. Do not reinterpret the now
  // reversed previousRuntime as a NEW default rollback. Explicit digests still
  // mean exactly what the caller requested, including an intentional new target.
  if(opts.digest===undefined&&ctx.recovery.committed)return recoveryResult(state,ctx);
  if(state.status!=='active')throw Error('install first: rollback requires active complete installation');
  const name=opts.digest??state.owner.previousRuntime;
  if(!name||!state.owner.runtimeGenerations.some(r=>r.name===name))throw Error('no retained complete rollback target');
  if(name===state.owner.currentRuntime)return {...resultAliases(state.owner,ctx.p,true),noop:true,committed:false,owner:state.owner,paths:ctx.p,status:'active',digest:name,dataPreserved:true,restartRequired:false};
  if(typeof opts.validateCandidate!=='function')throw Error('trusted candidate compatibility validation required');
  const profile=retainedProfile(state,ctx.p,name),candidate=await validateBundle(path.join(ctx.p.runtime,name));
  await publishGeneration(candidate,ctx.p,ctx.transactionId,ctx.onPhase,opts.validateCandidate,true,profile);
  const o=nextOwner(state,ctx.p,ctx.kiroHome,ctx.transactionId,name,s.hash(canonical(candidate.manifest)+'\n'));o.profileSha256=s.hash(profile);
  return commit(state,ctx,o,readControl(ctx.p.releaseState),profile);
 });
}
function recoveryResult(state,ctx) {
 const r=ctx.recovery;
 return {...resultAliases(state.owner,ctx.p,!r.recovered),outcome:r.recovered?'recovered':'noop',recovered:r.recovered,noop:!r.recovered,committed:r.committed,recovery:r,priorAction:r.priorAction,owner:state.owner,paths:ctx.p,status:state.status,digest:state.owner?.currentRuntime??null,dataPreserved:true,restartRequired:r.committed&&state.status==='active'};
}
/** Offline reconciliation ONLY: no release admission, client discovery, smoke,
 * new candidate, activation, data initialization, or prerequisite callback.
 * Existing evidence is verified then replayed under the shared core lock. The
 * unchanged lock implementation may refuse unqualified stale-lock recovery.
 * opts: {env?,userHome?,onPhase?}; returns a structured, idempotent recovery result.
 */
export async function recoverCompleteInstallation(kiroHome,opts={}) {
 kiroHome=home(kiroHome,opts);const state=await inspectCompleteInstallation(kiroHome),p=state.paths;
 if(!s.lstat(p.base)||state.status!=='recovery-required'&&inspectInstallationLock(p.base).status==='absent')return recoveryResult(state,{p,recovery:{recovered:false,committed:false,transaction:{recovered:false},candidate:{recovered:false},locks:[],priorAction:null,targetDigest:null}});
 return mutate(kiroHome,opts,async(state,ctx)=>recoveryResult(state,ctx),{initialize:false});
}
export async function retireCompleteInstallation(kiroHome,opts={}) {
 const refusePurge=committed=>{throw Object.assign(Error('purge-data unavailable: complete process inactivity visibility is unqualified; all data preserved'),{committed,dataPreserved:true,recoveryRequired:false,code:'INSTALL_PURGE_UNAVAILABLE'});};
 const initial=await inspectCompleteInstallation(home(kiroHome,opts));
 if(initial.status==='absent'){if(opts.purgeData)refusePurge(false);return {...resultAliases(null,initial.paths,true),noop:true,committed:false,owner:null,paths:initial.paths,status:'absent',dataPreserved:true,restartRequired:false};}
 return mutate(kiroHome,opts,async(state,ctx)=>{
 if(state.status==='absent'||state.status==='retired'){if(opts.purgeData)refusePurge(false);return {...resultAliases(state.owner,ctx.p,true),noop:true,committed:false,owner:state.owner,paths:ctx.p,status:state.status,dataPreserved:true,restartRequired:false};}
 if(state.status!=='active')throw Error('legacy retirement requires migration; exact legacy paths preserved');
 const o={...state.owner,status:'retired',profileSha256:null,transactionId:ctx.transactionId};const result=await commit(state,ctx,o,readControl(ctx.p.releaseState));
 // Fence new schema-3 admissions first. Negative process scans are NOT proof
 // of inactivity; the unqualified purge capability never reaches deletion.
 if(opts.purgeData)refusePurge(true);return result;
 });
}
