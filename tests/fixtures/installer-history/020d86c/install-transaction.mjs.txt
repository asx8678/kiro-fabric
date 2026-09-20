import fs from 'node:fs';
import path from 'node:path';
import { installerSafety as s } from './install-agent-user.mjs';
import { validateInstalledBundle, canonical } from './bundle-contract.mjs';

const MAX = 8 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const TX = /^[a-f0-9]{32}$/;
const fields = (v, keys) => { if (!v || Object.getPrototypeOf(v) !== Object.prototype || Object.keys(v).sort().join() !== [...keys].sort().join()) throw Error('recovery-required: invalid journal fields'); };
export const transactionPaths = kiroHome => ({ ...s.paths(kiroHome), launcher: path.join(kiroHome,'kiro-fabric/bin/kiro-fabric'), releaseState: path.join(kiroHome,'kiro-fabric/release-state.json'), journal: path.join(kiroHome,'kiro-fabric/.transactions/active.json') });
export function syncDirectory(dir) { const fd=fs.openSync(dir,'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
export function readControl(file, mode=0o600) {
 s.assertNoUnsafeSymlinkComponents(file);
 if (!s.lstat(file)) return null;
 const stat=s.assertSafeFile(file); if ((stat.mode&0o7777)!==mode || stat.size>MAX) throw Error('unsafe control mode/size: '+file);
 return fs.readFileSync(file);
}
const identity = bytes => bytes===null ? null : s.hash(bytes);
const encode = bytes => bytes===null ? null : bytes.toString('base64');
function decode(value) { if(value===null)return null; if(typeof value!=='string'||value.length>MAX*2)throw Error('recovery-required: backup bound'); const bytes=Buffer.from(value,'base64'); if(bytes.toString('base64')!==value)throw Error('recovery-required: backup encoding'); return bytes; }
const names=['profile','launcher','releaseState','manifest'];
const modeFor = name => name==='launcher'?0o700:0o600;
function publishControl(file, bytes, mode=0o600) {
 if(bytes===null) { if(s.lstat(file))fs.unlinkSync(file); syncDirectory(path.dirname(file)); return; }
 // The existing atomic writer syncs bytes before rename. Executable mode is
 // established on the prepared inode, never after publishing a 0600 launcher.
 if(mode===0o600) { s.atomicWrite(file,bytes); return; }
 const temporary=file+'.prepared';
 if(s.lstat(temporary))throw Error('recovery-required: unexpected prepared launcher');
 fs.writeFileSync(temporary,bytes,{flag:'wx',mode});
 try { const fd=fs.openSync(temporary,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);} fs.renameSync(temporary,file);syncDirectory(path.dirname(file)); }
 finally { if(s.lstat(temporary))fs.unlinkSync(temporary); }
}
function rootIdentity(base) { s.assertSafeDirectory(base,{private:true});const st=fs.lstatSync(base);return {dev:String(st.dev),ino:String(st.ino)}; }
export function readTransaction(kiroHome) {
 const p=transactionPaths(kiroHome), raw=readControl(p.journal);if(raw===null)return null;
 const j=JSON.parse(raw.toString());fields(j,['schemaVersion','transactionId','kiroHome','baseIdentity','beforeOwnerSha256','afterOwnerSha256','controls']);
 fields(j.baseIdentity,['dev','ino']);
 if(j.schemaVersion!==1||!TX.test(j.transactionId)||j.kiroHome!==kiroHome||JSON.stringify(j.baseIdentity)!==JSON.stringify(rootIdentity(p.base))||!HASH.test(j.afterOwnerSha256)||(j.beforeOwnerSha256!==null&&!HASH.test(j.beforeOwnerSha256)))throw Error('recovery-required: journal identity');
 fields(j.controls,names);
 for(const name of names){const c=j.controls[name];fields(c,['before','after','beforeSha256','afterSha256']);if(identity(decode(c.before))!==c.beforeSha256||identity(decode(c.after))!==c.afterSha256)throw Error('recovery-required: backup identity');}
 if(j.controls.manifest.beforeSha256!==j.beforeOwnerSha256||j.controls.manifest.afterSha256!==j.afterOwnerSha256)throw Error('recovery-required: owner binding');
 const owner=JSON.parse(decode(j.controls.manifest.after).toString());if(owner.schemaVersion!==3||owner.owner!=='kiro-fabric-agent-user-install'||owner.transactionId!==j.transactionId||owner.kiroHome!==kiroHome||owner.dataRoot!==p.data||owner.profileSha256!==j.controls.profile.afterSha256||owner.launcherSha256!==j.controls.launcher.afterSha256||owner.releaseStateSha256!==j.controls.releaseState.afterSha256)throw Error('recovery-required: owner transaction');
 if(j.controls.manifest.before!==null){const old=JSON.parse(decode(j.controls.manifest.before).toString());if(old.owner!=='kiro-fabric-agent-user-install'||![1,2,3].includes(old.schemaVersion))throw Error('recovery-required: previous owner');if(old.schemaVersion===3&&(old.kiroHome!==kiroHome||old.profileSha256!==j.controls.profile.beforeSha256||old.launcherSha256!==j.controls.launcher.beforeSha256||old.releaseStateSha256!==j.controls.releaseState.beforeSha256))throw Error('recovery-required: previous controls');}
 return j;
}
/** @param {string} kiroHome @param {{onPhase?:(phase:string)=>unknown|Promise<unknown>}} [options] */
export async function recoverInstallTransaction(kiroHome,{onPhase=()=>{}}={}) {
 const p=transactionPaths(kiroHome),j=readTransaction(kiroHome);if(!j)return {recovered:false};
 try {
 const actual=identity(readControl(p.manifest));const committed=actual===j.afterOwnerSha256;
 if(!committed&&actual!==j.beforeOwnerSha256)throw Error('recovery-required: conflicting actual owner');
 const selected=decode(j.controls.manifest[committed?'after':'before']);
 if(selected){const o=JSON.parse(selected.toString());if(o.schemaVersion===3){if(!Array.isArray(o.runtimeGenerations)||o.runtimeGenerations.length>256)throw Error('recovery-required: generation bound');for(const r of o.runtimeGenerations){fields(r,['name','manifestSha256']);if(!HASH.test(r.name)||!HASH.test(r.manifestSha256))throw Error('recovery-required: generation identity');const bundle=await validateInstalledBundle(path.join(p.runtime,r.name));if(bundle.digest!==r.name||s.hash(canonical(bundle.manifest)+'\n')!==r.manifestSha256)throw Error('recovery-required: modified retained generation');}}}
 const next=JSON.parse(decode(j.controls.manifest.after).toString());
 if(next.legacy){const legacy=next.legacy,e=legacy.evidence,m=JSON.parse(Buffer.from(legacy.manifestBase64,'base64').toString());if(m.schemaVersion===1){if(e.runtimeRoot!==path.join(p.runtime,m.packageDigest)||e.skillRoot!==path.join(p.skills,'fabric-exec')||!HASH.test(m.packageDigest))throw Error('recovery-required: legacy path');s.assertSameTree(e.runtimeRoot,e.runtimeTree,'legacy runtime');s.assertSameTree(e.skillRoot,e.skillTree,'legacy skill');}else if(m.schemaVersion===2){s.assertSameTree(path.join(p.skills,'fabric-exec'),e.skill,'legacy skill');if(!Array.isArray(e.runtimeGenerations)||e.runtimeGenerations.length>256)throw Error('legacy capacity');for(const r of e.runtimeGenerations){if(!HASH.test(r.name))throw Error('legacy identity');s.assertSameTree(path.join(p.runtime,r.name),r.tree,'legacy runtime');}}else throw Error('recovery-required: legacy schema');}
 // Validate every control before touching any: foreign bytes are never removed.
 for(const name of names){const c=j.controls[name],h=identity(readControl(p[name],modeFor(name)));if(h!==c.beforeSha256&&h!==c.afterSha256)throw Error('recovery-required: conflicting '+name);if(committed&&h!==c.afterSha256)throw Error('recovery-required: committed control mismatch '+name);}
 if(!committed)for(const name of names.filter(n=>n!=='manifest')) {const c=j.controls[name];if(identity(readControl(p[name],modeFor(name)))!==c.beforeSha256)publishControl(p[name],decode(c.before),modeFor(name));await onPhase('recovery-restored-'+name);}
 // A rename/unlink can have succeeded before its parent fsync failed. Bytes
 // matching on retry are NOT durability evidence. Sync every control parent,
 // including the owner parent on postcommit replay, before deleting the journal.
 for(const dir of new Set(names.map(name=>path.dirname(p[name])))){s.assertNoUnsafeSymlinkComponents(dir);s.assertSafeDirectory(dir);syncDirectory(dir);}
 await onPhase('recovery-controls-synced');
 const before=j.controls.manifest.before===null?null:JSON.parse(decode(j.controls.manifest.before).toString());
 const action=next.status==='retired'?'retirement':before?.status==='retired'?'reactivation':before?.runtimeGenerations?.some(r=>r.name===next.currentRuntime)?'retained-activation':'installation';
 await onPhase('recovery-before-cleanup');fs.unlinkSync(p.journal);syncDirectory(path.dirname(p.journal));await onPhase('recovery-cleaned');return {recovered:true,committed,transactionId:j.transactionId,action,targetDigest:next.currentRuntime};
 } catch(error) {
  error.recoveryRequired=true;error.committed=false;
  try{error.committed=identity(readControl(p.manifest))===j.afterOwnerSha256;}catch{}
  throw error;
 }
}
/** Fixed installation controls only. Caller holds the shared installation lock.
 * @param {string} kiroHome
 * @param {{transactionId:string,after:any,onPhase?:(phase:string)=>unknown|Promise<unknown>}} options
 */
export async function activateInstallTransaction(kiroHome,{transactionId,after,onPhase=()=>{}}) {
 if(!TX.test(transactionId))throw Error('invalid transaction ID');const p=transactionPaths(kiroHome);
 if(s.lstat(p.journal))throw Error('recovery-required: pending transaction');fields(after,names);
 const controls={};for(const name of names){const before=readControl(p[name],modeFor(name)),next=after[name];if(next!==null&&!Buffer.isBuffer(next))throw Error('control bytes required');controls[name]={before:encode(before),after:encode(next),beforeSha256:identity(before),afterSha256:identity(next)};}
 const j={schemaVersion:1,transactionId,kiroHome,baseIdentity:rootIdentity(p.base),beforeOwnerSha256:controls.manifest.beforeSha256,afterOwnerSha256:controls.manifest.afterSha256,controls};
 const bytes=Buffer.from(JSON.stringify(j)+'\n');if(bytes.length>MAX)throw Error('transaction backup capacity');
 s.ensureDirectory(path.dirname(p.journal),{private:true},[]);s.atomicWrite(p.journal,bytes);readTransaction(kiroHome);await onPhase('journal-synced');
 try {
 for(const name of names){if(identity(readControl(p[name],modeFor(name)))!==controls[name].beforeSha256)throw Error('control changed during transaction: '+name);await onPhase('before-'+name);if(controls[name].beforeSha256!==controls[name].afterSha256)publishControl(p[name],after[name],modeFor(name));await onPhase(name==='manifest'?'owner-committed':name+'-published');}
 await onPhase('before-cleanup');fs.unlinkSync(p.journal);syncDirectory(path.dirname(p.journal));await onPhase('cleaned');return {committed:true};
 }catch(error){const committed=identity(readControl(p.manifest))===j.afterOwnerSha256;error.committed=committed;error.recoveryRequired=true;throw error;}
}
