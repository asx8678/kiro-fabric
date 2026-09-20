import fs from 'node:fs';
import os from 'node:os';
import childProcess from 'node:child_process';
import { installerSafety as s } from './install-agent-user.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DECIMAL=/^(0|[1-9][0-9]*)$/;
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join()===keys.sort().join();
function refusal(detail) {
 return Object.assign(Error('recovery-required: directory identity '+detail+'; preserve evidence (legacy dev/ino cannot prove device renumbering)'),{code:'INSTALL_DIRECTORY_IDENTITY',recoveryRequired:true});
}
function statDirectory(directory) {
 s.assertNoUnsafeSymlinkComponents(directory);s.assertSafeDirectory(directory,{private:true});
 return fs.lstatSync(directory,{bigint:true});
}
const sameStat=(a,b)=>a.dev===b.dev&&a.ino===b.ino;

// Only a volume UUID, NOT an APFS container/group UUID, mount name, device name,
// statfs fsid or boot ID, survives device renumbering and identifies this volume.
// Resolve via root-owned block-device rdev, so firmlinks and nested mounts do not
// accidentally select the system volume. No PATH lookup or inherited environment.
// Unsupported filesystems/platforms keep the strict dev/ino contract. No cache:
// a hot-plug may reuse a dev number during the lifetime of this process.
function stableVolume(stat) {
 if(os.platform()!=='darwin')return null;
 try {
  const names=fs.readdirSync('/dev');if(names.length>4096)return null;
  const matches=[];
  for(const name of names.filter(n=>/^disk[0-9]+(?:s[0-9]+)*$/.test(n))){
   const node='/dev/'+name,st=fs.lstatSync(node,{bigint:true});
   if(st.isBlockDevice()&&st.uid===0n&&st.rdev===stat.dev)matches.push({node,st});
  }
  if(matches.length!==1)return null;
  const {node,st}=matches[0];
  const executable=s.assertTrustedExecutable('/usr/sbin/diskutil');
  const xml=childProcess.execFileSync(executable,['info','-plist',node],{encoding:'utf8',env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'C',LC_ALL:'C'},timeout:3000,maxBuffer:128*1024,stdio:['ignore','pipe','ignore']});
  // diskutil is trusted system output, not an arbitrary plist parser. Require
  // unique scalar keys, a supported filesystem, and the exact queried node.
  const scalar=key=>{const found=[...xml.matchAll(new RegExp('<key>'+key+'</key>\\s*<string>([^<]*)</string>','g'))];return found.length===1?found[0][1]:null;};
  const uuid=scalar('VolumeUUID')?.toLowerCase();
  const after=fs.lstatSync(node,{bigint:true});
  if(!sameStat(st,after)||!after.isBlockDevice()||after.uid!==0n||after.rdev!==stat.dev||scalar('DeviceNode')!==node||scalar('FilesystemType')!=='apfs'||!UUID.test(uuid??''))return null;
  return {kind:'darwin-apfs-volume-uuid',uuid};
 } catch { return null; }
}

/** New evidence uses sidecar schema 2; installation owner schema 3 is unchanged.
 * A null volume is explicitly dev-bound, never permission for inode-only replay.
 */
export function captureDirectoryIdentity(directory) {
 const before=statDirectory(directory),volume=stableVolume(before),after=statDirectory(directory);
 if(!sameStat(before,after))throw refusal('changed during capture');
 return {dev:String(before.dev),ino:String(before.ino),volume};
}
export function validateDirectoryIdentity(record,schemaVersion) {
 if(![1,2].includes(schemaVersion)||!exact(record,schemaVersion===1?['dev','ino']:['dev','ino','volume'])||typeof record.dev!=='string'||typeof record.ino!=='string'||!DECIMAL.test(record.dev)||!DECIMAL.test(record.ino))throw refusal('schema invalid');
 if(schemaVersion===2&&record.volume!==null&&(!exact(record.volume,['kind','uuid'])||record.volume.kind!=='darwin-apfs-volume-uuid'||typeof record.volume.uuid!=='string'||!UUID.test(record.volume.uuid)))throw refusal('volume schema invalid');
 return record;
}
/** Stable evidence is checked even when dev matches: reused device numbers must
 * not make a different volume acceptable. Missing OS evidence never downgrades.
 * Existing snapshots/journals are never reanchored or rewritten by this reader.
 */
export function assertDirectoryIdentity(directory,record,schemaVersion) {
 validateDirectoryIdentity(record,schemaVersion);
 const before=statDirectory(directory);
 if(String(before.ino)!==record.ino)throw refusal('inode mismatch');
 if(schemaVersion===2&&record.volume!==null){
  const live=stableVolume(before);
  if(!live||live.kind!==record.volume.kind||live.uuid!==record.volume.uuid)throw refusal('volume mismatch or unavailable');
 }else if(String(before.dev)!==record.dev)throw refusal('device mismatch without stable volume evidence');
 if(!sameStat(before,statDirectory(directory)))throw refusal('changed during verification');
}
