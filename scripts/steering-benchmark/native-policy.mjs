import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { sha, save, regularText } from './core.mjs';

/** Native CLI v3 stores workspace consent under HOME, keyed by normalized root SHA-256's first 16 hex chars.
 * This is opt-in consent for benign fixtures, NOT shell confinement or a network sandbox.
 * @param {string} workspace @param {string} python @param {string} [home] */
export function createNativeFixturePolicy(workspace, python, home = os.homedir()) {
  assert.notEqual(process.platform, 'win32', 'POSIX native fixture policy required');
  const canonical = fs.realpathSync(workspace), userHome = fs.realpathSync(home);
  const key = sha(canonical.replace(/\\/g, '/')).slice(0, 16);
  /** @param {string} directory */
  function directory(directory) {
    try { fs.mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const st = fs.lstatSync(directory); assert.ok(st.isDirectory() && !st.isSymbolicLink() && !(st.mode & 0o022) && (typeof process.getuid !== 'function' || st.uid === process.getuid()), 'unsafe native policy parent');
  }
  const kiro = path.join(userHome, '.kiro'), parent = path.join(kiro, 'workspace-roots'); directory(kiro); directory(parent);
  const root = path.join(parent, key);
  // Exclusive directory creation refuses existing user/other-session consent, even when empty.
  fs.mkdirSync(root, { mode: 0o700 });
  const file = path.join(root, 'permissions.json');
  const rules = [{ capability: 'shell', match: ['node *', 'python3 -B *', python + ' -B *', 'cd *'], effect: 'allow' }];
  try { save(file, { rules }); } catch (error) { fs.rmdirSync(root); throw error; }
  const st = fs.lstatSync(file), dir = fs.lstatSync(root);
  return { workspace: canonical, path: file, sha256: sha(regularText(file)), device: st.dev, inode: st.ino, directoryDevice: dir.dev, directoryInode: dir.ino, rules };
}
/** Remove only the exact file this controller created. Never recursively delete user policy directories.
 * @param {ReturnType<typeof createNativeFixturePolicy>} policy */
export function removeNativeFixturePolicy(policy) {
  const root = path.dirname(policy.path), dir = fs.lstatSync(root), st = fs.lstatSync(policy.path);
  assert.ok(dir.isDirectory() && !dir.isSymbolicLink() && dir.dev === policy.directoryDevice && dir.ino === policy.directoryInode, 'native policy directory drift');
  assert.ok(st.isFile() && !st.isSymbolicLink() && st.nlink === 1 && st.dev === policy.device && st.ino === policy.inode && (st.mode & 0o777) === 0o600, 'native policy identity drift');
  assert.equal(sha(regularText(policy.path)), policy.sha256, 'native policy content drift');
  fs.unlinkSync(policy.path);
  if (!fs.readdirSync(root).length) fs.rmdirSync(root);
}
