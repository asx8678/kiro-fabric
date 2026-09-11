import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { installerSafety as s } from './install-agent-user.mjs';
import { syncDirectory } from './install-transaction.mjs';

const same = (a,b) => a.dev===b.dev && a.ino===b.ino;
const fail = () => { throw Error('Selected launch profile already exists with different content or unsafe publication evidence; preserve it and resolve explicitly'); };

/** Atomic no-replace publication of a small, immutable 0600 control.
 * A final name is linked only AFTER its complete bytes have been fsynced. The
 * sole recoverable two-link state is final + an exact prepared sibling on the
 * SAME inode. Readers never admit that state as an immutable control: finish
 * unlinking the verified sibling first. Unknown/partial preparations are kept.
 * No lock is required: concurrent publishers can only win link(EXCL), or reuse
 * the same complete bytes. Neither the final name nor a foreign sibling is removed.
 * onPhase is a synchronous trusted fault-test hook, not a CLI option.
 * @param {string} file
 * @param {Buffer|string} content
 * @param {{onPhase?:(phase:string)=>void}} [options]
 */
export function publishImmutableProfile(file, content, { onPhase = () => {} } = {}) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  if (bytes.length > 256 * 1024 || !path.isAbsolute(file) || path.resolve(file)!==file) throw Error('Invalid profile publication path/size');
  const directory = path.dirname(file);
  s.assertNoUnsafeSymlinkComponents(directory);
  s.assertSafeDirectory(directory,{private:true});
  if (fs.realpathSync(directory)!==directory) throw Error('Profile directory must be canonical');
  const parent = fs.lstatSync(directory);
  const assertParent = () => {
    s.assertNoUnsafeSymlinkComponents(directory);s.assertSafeDirectory(directory,{private:true});
    if (!same(parent,fs.lstatSync(directory))) throw Error('Profile directory identity changed');
  };
  const prefix = '.'+path.basename(file)+'.';
  const isPrepared = name => name.startsWith(prefix) && /^[a-f0-9]{32}\.prepared$/.test(name.slice(prefix.length));
  const checked = (target, links) => {
    assertParent();
    const fd=fs.openSync(target,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    try {
      const st=fs.fstatSync(fd);
      if (!st.isFile() || st.nlink!==links || (st.mode&0o7777)!==0o600 || st.size!==bytes.length || (typeof process.getuid==='function' && st.uid!==process.getuid()) || !same(st,fs.lstatSync(target)) || !fs.readFileSync(fd).equals(bytes)) fail();
      // Also covers retry after file/parent fsync failure.
      fs.fsyncSync(fd);
      return st;
    } finally { fs.closeSync(fd); }
  };
  const existing = () => {
    assertParent();const st=s.lstat(file);if(!st)return false;
    if(st.isSymbolicLink() || !st.isFile() || ![1,2].includes(st.nlink))fail();
    try {
      if(st.nlink===2){
        const entries=fs.readdirSync(directory);if(entries.length>4096)throw Error('Profile publication recovery capacity');
        const siblings=entries.filter(isPrepared).filter(name=>{const candidate=s.lstat(path.join(directory,name));return candidate && same(candidate,st);});
        if(siblings.length!==1)fail();
        const temporary=path.join(directory,siblings[0]);checked(file,2);checked(temporary,2);
        assertParent();if(!same(st,fs.lstatSync(file))||!same(st,fs.lstatSync(temporary)))fail();
        fs.unlinkSync(temporary);
      }
      checked(file,1);
    } catch(error) {
      // Another publisher/recoverer can complete the one-way 2 -> 1 transition
      // between ANY two checks. Accept only that same inode, fully revalidated;
      // a replacement, extra hardlink or changed bytes still fails closed.
      const current=s.lstat(file);
      if(!current||!same(current,st)||current.nlink!==1)throw error;
      checked(file,1);
    }
    syncDirectory(directory);return true;
  };
  if(existing())return {created:false};
  const temporary=path.join(directory,prefix+randomBytes(16).toString('hex')+'.prepared');
  const fd=fs.openSync(temporary,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600), inode=fs.fstatSync(fd);
  let closed=false;
  const removeOwnPreparation = () => {
    assertParent();const st=s.lstat(temporary);
    if(st){if(!same(st,inode)||!st.isFile()||st.isSymbolicLink()||![1,2].includes(st.nlink))fail();try{fs.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT'||s.lstat(temporary))throw error;}}
  };
  try {
    onPhase('profile-prepared');fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);closed=true;
    onPhase('profile-bytes-synced');if(!same(checked(temporary,1),inode))fail();assertParent();
    try { fs.linkSync(temporary,file); }
    catch(error){if(error.code!=='EEXIST')throw error;removeOwnPreparation();if(!existing())fail();return {created:false};}
    onPhase('profile-linked');
    // A concurrent reader may have completed this exact link/unlink already.
    const final=s.lstat(file);if(!final||!same(final,inode))fail();
    removeOwnPreparation();checked(file,1);syncDirectory(directory);onPhase('profile-published');return {created:true};
  } finally {
    if(!closed)fs.closeSync(fd);
    // Never unlink a replacement, and never remove the final path on failure.
    removeOwnPreparation();syncDirectory(directory);
  }
}
