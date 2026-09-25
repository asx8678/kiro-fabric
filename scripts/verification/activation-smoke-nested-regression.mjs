// Real smoke regression, NEVER an inert probe. Requires explicit task ownership
// and independent current schema-2 admission before executing any candidate.
// All task roots and repositories are retained, including failures.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { smokeCandidate } from '../installer-smoke.mjs';
import { admitCurrentActivationBundle, activationBundleIdentity } from './activation-bundle.mjs';
const repoRoot = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
const within = (parent, child) => { const r = path.relative(parent, child); return r !== '' && r !== '..' && !r.startsWith('../') && !path.isAbsolute(r); };
function freshDir(parent, label) { return fs.realpathSync(fs.mkdtempSync(path.join(parent, label + '-'))); }
function readOnlyGit(root, args) {
  const result = spawnSync('/usr/bin/git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'diff.external=', '-c', 'core.attributesFile=/dev/null', '-c', 'protocol.allow=never', '-C', root, ...args],
    { env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 65536 });
  assert.equal(result.error, undefined, 'read-only Git spawn failed: ' + result.error?.message);
  assert.equal(result.signal, null, 'read-only Git terminated by signal');
  assert.equal(result.status, 0, 'read-only Git failed: ' + result.stderr);
  return result;
}
function retentionRoot(log) {
  const records = [...log.matchAll(/\[fabric:task-root\] (\{[^\n]*\})/gu)];
  assert.equal(records.length, 1, 'smoke must report one retained task root');
  const record = JSON.parse(records[0][1]);
  assert.equal(record.policy, 'retain'); assert.equal(record.source, 'candidate-smoke');
  return fs.realpathSync(record.path);
}
export async function runNestedWorkspaceSmokeRegression({ bundleRoot, bundleTaskRoot, taskRoot, externalParent }) {
  if (!taskRoot || !bundleTaskRoot) throw Error('Explicit regression taskRoot and admitted bundleTaskRoot required');
  taskRoot = fs.realpathSync(taskRoot);
  const stat = fs.lstatSync(taskRoot);
  assert.ok(within(path.join(repoRoot, '.tmp'), taskRoot) && stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0, 'regression task root must be a private task-owned descendant of checkout .tmp');
  const admitted = await admitCurrentActivationBundle({ repoRoot, bundleRoot, taskRoot: bundleTaskRoot });
  assert.equal(admitted.schema, 2, 'nested regression requires admitted current schema 2 before smoke');
  const previous = process.env.TMPDIR;
  // Never choose /var/folders itself. Resolve aliases, verify actual access, then
  // exclusive mkdtemp proves writability; failure is retained, not cleaned up.
  const candidates = externalParent ? [externalParent] : [os.tmpdir(), '/tmp'];
  let externalCanonical;
  for (const candidate of candidates) {
    const canonical = fs.realpathSync(candidate);
    if (canonical === repoRoot || within(repoRoot, canonical)) continue;
    const st = fs.statSync(canonical);
    if (!st.isDirectory()) continue;
    try { fs.accessSync(canonical, fs.constants.W_OK | fs.constants.X_OK); externalCanonical = canonical; break; }
    catch (error) { if (externalParent) throw error; }
  }
  if (!externalCanonical) throw Error('No canonical writable external temporary parent');
  const externalTask = freshDir(externalCanonical, 'activation-final-nested-external'); fs.chmodSync(externalTask, 0o700);
  const inRepo = freshDir(taskRoot, 'activation-final-nested-inrepo'); fs.chmodSync(inRepo, 0o700);
  console.error('[activation:retained-roots] ' + JSON.stringify({ taskRoot, externalTask, inRepo, policy: 'retain' }));
  const results = [];
  for (const [label, tmp] of [['external', externalTask], ['in-repo-ignored', inRepo]]) {
    // Rebind current input authority immediately before each executable smoke.
    const current = await admitCurrentActivationBundle({ repoRoot, bundleRoot, taskRoot: bundleTaskRoot });
    assert.equal(current.digest, admitted.digest);
    process.env.TMPDIR = tmp;
    let log = '';
    const originalError = console.error;
    console.error = (...args) => { log += args.join(' ') + '\n'; originalError(...args); };
    let out;
    try { out = await smokeCandidate(admitted.root); }
    finally { console.error = originalError; if (previous === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previous; }
    assert.equal(out.backend, 'PASS');
    const temporary = retentionRoot(log); assert.ok(within(tmp, temporary), 'smoke escaped task-scoped TMPDIR');
    const workspace = fs.realpathSync(path.join(temporary, 'workspace'));
    const own = readOnlyGit(workspace, ['rev-parse', '--show-toplevel']);
    const listing = readOnlyGit(workspace, ['ls-files', '-z', '-co', '--exclude-standard']);
    const files = listing.stdout.split('\0').filter(Boolean).sort();
    assert.equal(own.stdout.trim(), workspace, 'workspace must be its own exclusive Git top level');
    assert.ok(files.includes('probe.txt') && files.includes('fovea-probe.ts'), 'smoke fixture discovery failed');
    results.push({ label, tmp, temporary, workspace, topLevel: own.stdout.trim(), gitFiles: files });
  }
  return { regression: 'nested-tmpdir-smoke', ok: true, bundle: activationBundleIdentity(admitted), detachedNavigatorForcedSettlement: 'unqualified', taskRoot, externalTask, results };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
  const result = await runNestedWorkspaceSmokeRegression({ bundleRoot: option('--bundle'), bundleTaskRoot: option('--bundle-task-root'), taskRoot: option('--task-root'), externalParent: option('--external-parent') });
  console.log(JSON.stringify(result, null, 2));
}
