import fs from 'node:fs';
import path from 'node:path';
import { installerSafety as s } from './install-agent-user.mjs';
import { readControl, syncDirectory } from './install-transaction.mjs';
import { publishImmutableProfile } from './installer-profile-publication.mjs';
import { captureDirectoryIdentity, assertDirectoryIdentity, validateDirectoryIdentity } from './installer-directory-identity.mjs';

const KIND='kiro-fabric-generation-profile';
const bytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const directory=p=>path.join(p.base,'profile-snapshots');
const exact=(v,keys)=>{if(!v||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).sort().join()!==keys.sort().join())throw Error('Invalid profile snapshot fields');};

/** Separate, private content-addressed ownership evidence. No schema-3 owner
 * fields are added: real older managers reject unknown ownership fields.
 * Each snapshot binds the original canonical owner/profile hashes, installation,
 * generation inventory, and both directory inodes. This is local integrity,
 * NOT a signed/authenticated release or permission to execute retained JS.
 */
export function readGenerationProfiles(p,owner,{validateOwner,validateProfile}) {
  const dir=directory(p), profiles=new Map();if(!s.lstat(dir))return profiles;
  s.assertNoUnsafeSymlinkComponents(dir);s.assertSafeDirectory(dir,{private:true});
  if(fs.realpathSync(dir)!==dir||(fs.lstatSync(dir).mode&0o7777)!==0o700)throw Error('Unsafe profile snapshot directory');
  const entries=fs.readdirSync(dir);if(entries.length>256)throw Error('Profile snapshot capacity');
  const records=[];
  for(const name of entries){
    const match=/^([a-f0-9]{64})\.([a-f0-9]{64})\.json$/.exec(name);
    if(!match)throw Error('Unowned profile snapshot material preserved');
    const raw=readControl(path.join(dir,name));if(!raw||raw.length>256*1024||s.hash(raw)!==match[2])throw Error('Modified profile snapshot');
    const r=JSON.parse(raw.toString());exact(r,['schemaVersion','kind','kiroHome','installationId','baseIdentity','storeIdentity','generation','manifestSha256','ownerBase64','profileBase64']);
    if(![1,2].includes(r.schemaVersion)||r.kind!==KIND||!owner||r.kiroHome!==owner.kiroHome||r.installationId!==owner.installationId||r.generation!==match[1]||!raw.equals(bytes(r)))throw Error('Profile snapshot identity mismatch');
    validateDirectoryIdentity(r.baseIdentity,r.schemaVersion);validateDirectoryIdentity(r.storeIdentity,r.schemaVersion);
    const record=owner.runtimeGenerations.find(g=>g.name===r.generation);
    if(!record||record.manifestSha256!==r.manifestSha256||profiles.has(r.generation))throw Error('Unbound or duplicate generation profile snapshot');
    if(typeof r.ownerBase64!=='string'||typeof r.profileBase64!=='string')throw Error('Invalid profile snapshot encoding');
    const original=Buffer.from(r.ownerBase64,'base64'),profile=Buffer.from(r.profileBase64,'base64');
    if(original.toString('base64')!==r.ownerBase64||profile.toString('base64')!==r.profileBase64||profile.length>65536)throw Error('Invalid profile snapshot encoding/bound');
    const captured=validateOwner(JSON.parse(original.toString()),p,owner.kiroHome);
    if(!original.equals(bytes(captured))||captured.installationId!==owner.installationId||captured.status!=='active'||captured.currentRuntime!==r.generation||captured.profileSha256!==s.hash(profile)||!captured.runtimeGenerations.some(g=>g.name===r.generation&&g.manifestSha256===record.manifestSha256))throw Error('Profile snapshot ownership binding mismatch');
    validateProfile(p,r.generation,profile);profiles.set(r.generation,profile);records.push(r);
  }
  // Validate ALL newer evidence before it can corroborate an older snapshot.
  // No volume identity is inferred from today's inode or written into history.
  for(const r of records.filter(r=>r.schemaVersion===2)){
    assertDirectoryIdentity(p.base,r.baseIdentity,2);assertDirectoryIdentity(dir,r.storeIdentity,2);
  }
  for(const r of records.filter(r=>r.schemaVersion===1)){
    // A fully bound newer snapshot from this same installation must attest
    // BOTH exact historical dev/ino pairs and both live volume UUIDs. An
    // unrelated generation/store, null-volume record or legacy-only history
    // cannot authorize device renumbering. Journals/candidates are unaffected.
    const witness=records.find(w=>w.schemaVersion===2&&['baseIdentity','storeIdentity'].every(key=>
      w[key].volume!==null&&w[key].dev===r[key].dev&&w[key].ino===r[key].ino));
    const identity=witness??r;
    assertDirectoryIdentity(p.base,identity.baseIdentity,identity.schemaVersion);
    assertDirectoryIdentity(dir,identity.storeIdentity,identity.schemaVersion);
  }
  return profiles;
}

/** Caller holds the core installation lock and has verified the active owner.
 * Capture BEFORE changing the live controls (including retirement). Never
 * invent a profile for an older, already-retained generation without evidence.
 */
export function retainGenerationProfile(p,owner,validators) {
  if(!owner||owner.status!=='active')return;
  const profile=readControl(p.profile);
  if(!profile||s.hash(profile)!==owner.profileSha256||!readControl(p.manifest)?.equals(bytes(owner)))throw Error('Profile changed before snapshot capture');
  validators.validateProfile(p,owner.currentRuntime,profile);
  const existing=readGenerationProfiles(p,owner,validators).get(owner.currentRuntime);
  if(existing){if(!existing.equals(profile))throw Error('Original generation profile snapshot differs; preserve both controls');syncDirectory(directory(p));syncDirectory(p.base);return;}
  const dir=directory(p);s.ensureDirectory(dir,{private:true},[]);syncDirectory(p.base);
  const record={schemaVersion:2,kind:KIND,kiroHome:owner.kiroHome,installationId:owner.installationId,baseIdentity:captureDirectoryIdentity(p.base),storeIdentity:captureDirectoryIdentity(dir),generation:owner.currentRuntime,manifestSha256:owner.runtimeGenerations.find(g=>g.name===owner.currentRuntime).manifestSha256,ownerBase64:bytes(owner).toString('base64'),profileBase64:profile.toString('base64')};
  const raw=bytes(record);publishImmutableProfile(path.join(dir,record.generation+'.'+s.hash(raw)+'.json'),raw);
  readGenerationProfiles(p,owner,validators);
}
