// Install BEFORE loading either legacy writer. Immutable historical bytes are
// never patched. Recursive cleanup is retained (a recorded harness seam), not
// delegated to rm or a repository-scanning deleter. Serial case worker only.
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';

export function installLegacyCleanupGuard(taskRoot) {
  taskRoot = fs.realpathSync(taskRoot);
  const saved = [], retained = [];
  const guardPath = target => {
    if (typeof target !== 'string') throw Error('legacy cleanup requires a literal task-owned path');
    // Linux's maintained lock release uses its own pinned directory descriptor.
    // Resolve ONLY this exact nonrecursive owner-file capability for scope checks;
    // the actual syscall still uses the production fd path.
    const scoped = /^\/proc\/self\/fd\/\d+\/owner\.json$/u.test(target)
      ? path.join(fs.realpathSync(path.dirname(target)), 'owner.json') : target;
    const full = path.resolve(scoped), rel = path.relative(taskRoot, full);
    if (!rel || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) throw Error('legacy cleanup outside task root refused');
    let cursor = taskRoot;
    for (const part of rel.split(path.sep)) {
      if (part === '.git') throw Error('repository metadata cleanup refused');
      if (fs.existsSync(path.join(cursor, '.git')) || (fs.existsSync(path.join(cursor, 'HEAD')) && fs.existsSync(path.join(cursor, 'objects')) && fs.existsSync(path.join(cursor, 'refs')))) throw Error('repository cleanup refused');
      cursor = path.join(cursor, part);
      try { if (fs.lstatSync(cursor).isSymbolicLink()) throw Error('symlink cleanup refused'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return full;
  };
  const patch = (object, key, value) => { saved.push([object, key, object[key]]); object[key] = value; };
  for (const key of ['rmSync', 'rmdirSync', 'unlinkSync']) {
    const original = fs[key];
    patch(fs, key, (target, options) => {
      const full = guardPath(target);
      const lockMetadata = /\/kiro-fabric\/(?:\.install-lock-release\.json|\.(?:install-lock|install\.lock)(?:\/owner\.json)?)$/u.test(full);
      if (key === 'rmSync' || options?.recursive || !lockMetadata) {
        retained.push({ path: full, operation: key, policy: 'retain' });
        return; // NO recursive removal, including rollback/failure cleanup.
      }
      // unlink cannot remove a directory; rmdir is empty-only. Both remain
      // task-owned/no-symlink/no-.git and cannot recursively delete a repository.
      return original(target, options);
    });
  }
  for (const key of ['rm', 'rmdir', 'unlink']) {
    patch(fs, key, () => { throw Error('asynchronous legacy cleanup refused'); });
    patch(fs.promises, key, async () => { throw Error('asynchronous legacy cleanup refused'); });
  }
  syncBuiltinESMExports();
  let restored = false;
  return { retained, restore() { if (restored) return; restored = true; for (const [object, key, value] of saved.reverse()) object[key] = value; syncBuiltinESMExports(); } };
}
