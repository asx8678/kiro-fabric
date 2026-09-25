// Decision-only activation regressions. No installer/candidate/native execution.
// The sole subprocess allowance is host Node --check on captured generated text.
// Usage: node scripts/verification/activation-admission-probe.mjs <private-output-dir>
// Retains every fixture. VM/launch guards are assertions, not an OS sandbox.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.argv.length !== 3) throw Error('Pass one existing private output directory');
const output = fs.realpathSync(path.resolve(process.argv[2]));
const stat = fs.lstatSync(output);
assert.ok(stat.isDirectory() && stat.uid === process.getuid?.() && !(stat.mode & 0o077), 'private owned output required');
const root = fs.realpathSync(fileURLToPath(new URL('../..', import.meta.url)));
const retainedRoot = fs.mkdtempSync(path.join(output, 'activation-admission-controls-'));
const syntaxOnly = childProcess.spawnSync;
let forbiddenAttempts = 0, syntaxChecks = 0;
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  childProcess[name] = () => { forbiddenAttempts++; throw Error('Activation admission probe forbids execution'); };
}
process.dlopen = () => { forbiddenAttempts++; throw Error('Activation admission probe forbids native loading'); };
syncBuiltinESMExports();
const { readRegular, LIMITS, sha256 } = await import('../bundle-contract.mjs');
const { exists, cacheDirectory } = await import('../installer-artifacts.mjs');
const checks = [];
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const inputs = ['scripts/verification/w5-callers-legacy.mjs', 'scripts/verification/activation-bundle.mjs',
  'scripts/install-agent-user.mjs', 'scripts/verification/fixtures/w5/install-agent-user.pre-w5.mjs.txt'];
const hashes = () => Object.fromEntries(inputs.map(name => [name, sha256(read(name))]));
const before = hashes();
const mkdir = label => { const dir = path.join(retainedRoot, label); fs.mkdirSync(dir, { mode: 0o700 }); return dir; };
const checkSyntax = (file, expected = 0) => {
  assert.ok(path.relative(retainedRoot, file).split(path.sep).every(p => p && p !== '..'));
  const result = syntaxOnly(process.execPath, ['--check', file], {
    cwd: retainedRoot, env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 15000,
  });
  syntaxChecks++;
  assert.equal(result.error, undefined, 'syntax probe spawn error');
  assert.equal(result.signal, null, 'syntax probe signal');
  assert.equal(result.status, expected, result.stderr);
  return result.stderr;
};

// Exercise the actual loader transformation but capture text instead of importing
// either generated installer. The original guarded CLI branch never executes.
let loaderText = read(inputs[0]);
assert.equal(loaderText.split('return import(pathToFileURL(cacheFile).href);').length, 2);
loaderText = loaderText.replace(/^import .*;\n/gmu, '').replace(/^export /gmu, '')
  .replace('return import(pathToFileURL(cacheFile).href);', 'return text;');
const loader = vm.runInNewContext(loaderText + '\n({loadMaintainedInstaller,loadHistoricalInstaller})', {
  fs, path, createHash, pathToFileURL,
});
const trustLine = 'const nodePath = assertTrustedExecutable(fs.realpathSync(process.execPath));';
const inertLine = 'const nodePath = fs.realpathSync(process.execPath); // probe only:';
for (const inertTrust of [false, true]) {
  const dir = mkdir('maintained-' + inertTrust);
  const result = await loader.loadMaintainedInstaller(root, dir, { inertTrust });
  const text = result.module;
  assert.equal(typeof text, 'string');
  for (const name of ['installUserAgent', 'uninstallUserAgent']) assert.equal((text.match(new RegExp('^export const ' + name + '\\b', 'gm')) ?? []).length, 1);
  assert.equal(text.includes(trustLine), !inertTrust);
  assert.equal(text.includes(inertLine), inertTrust);
  assert.equal(text.includes('from "./'), false);
  checkSyntax(path.join(dir, 'w5-callers-maintained-entry.mjs'));
  checks.push('maintained-loader-' + (inertTrust ? 'inert' : 'enforced'));
  if (!inertTrust) {
    const mutant = path.join(dir, 'duplicate-export-before-fix.mjs');
    fs.writeFileSync(mutant, text + '\nexport { installUserAgent, uninstallUserAgent };\n', { flag: 'wx', mode: 0o600 });
    assert.match(checkSyntax(mutant, 1), /Duplicate export/u);
    checks.push('old-duplicate-export-rejected');
  }
}
const historicalDir = mkdir('historical');
const historical = await loader.loadHistoricalInstaller(root, historicalDir);
assert.equal(historical.available, true);
assert.equal(historical.digest, '43c1932d604a66117d26cba1fbfd5e11eed0b7891e58a300b04df720730fdc6b');
assert.equal(historical.module.includes(trustLine), false);
assert.equal(historical.module.includes(inertLine), true);
assert.equal((historical.module.match(/export \{ installUserAgent, uninstallUserAgent \};/gu) ?? []).length, 1);
assert.equal(historical.module.includes('from "./'), false);
checkSyntax(path.join(historicalDir, 'w5-callers-historic-entry.mjs'));
checks.push('pinned-historical-loader');

const bundleText = read(inputs[1]);
const start = bundleText.indexOf('export async function resolvePublicActiveBundle(');
const end = bundleText.indexOf('/** Independently admit', start);
assert.ok(start >= 0 && end > start);
const resolverText = bundleText.slice(start, end).replace('export async function', 'async function');
for (const kind of ['absent', 'dangling', 'symlink', 'directory', 'oversized', 'mode', 'invalid', 'valid', 'changed']) {
  const repo = mkdir('pointer-' + kind), cache = path.join(repo, '.tmp');
  fs.mkdirSync(cache, { mode: 0o700 });
  const pointer = path.join(cache, 'complete-bundle.json'), target = path.join(repo, 'target');
  const bytes = 'inert pointer decision data\n';
  if (kind === 'dangling' || kind === 'symlink') {
    if (kind === 'symlink') fs.writeFileSync(target, 'retain target', { flag: 'wx', mode: 0o600 });
    fs.symlinkSync(target, pointer);
  } else if (kind === 'directory') fs.mkdirSync(pointer, { mode: 0o700 });
  else if (kind !== 'absent') fs.writeFileSync(pointer, kind === 'oversized' ? Buffer.alloc(LIMITS.manifest + 1) : bytes, { flag: 'wx', mode: kind === 'mode' ? 0o640 : 0o600 });
  if (kind === 'mode') fs.chmodSync(pointer, 0o640); // exact fixture mode under any umask
  let validations = 0, admissions = 0, reads = 0;
  const digest = 'a'.repeat(64), selected = { root: path.join(cache, 'kiro-fabric-bundle-darwin-arm64-' + digest), digest, manifest: { target: 'darwin-arm64' } };
  const resolve = vm.runInNewContext(resolverText + '\nresolvePublicActiveBundle', {
    fs, path, exists, cacheDirectory, sha256, LIMITS,
    readRegular: async (file, max, options) => {
      assert.equal(file, pointer); assert.equal(max, LIMITS.manifest); assert.equal(options.mode, 0o600);
      reads++; return readRegular(file, max, options);
    },
    validateActiveCompleteBundle: async () => { validations++; if (kind === 'invalid') throw Error('inert invalid shared pointer'); return selected; },
    admitCurrentActivationBundle: async () => { admissions++; if (kind === 'changed') fs.appendFileSync(pointer, 'drift'); return { digest }; },
  });
  if (kind === 'absent') { assert.equal(await resolve(repo), null); assert.equal(reads, 0); }
  else if (kind === 'valid') { assert.equal((await resolve(repo)).publicPointerSha256, sha256(bytes)); assert.equal(reads, 2); assert.equal(admissions, 1); }
  else { await assert.rejects(resolve(repo), kind === 'changed' ? /Public selection changed/u : undefined); }
  assert.equal(validations, ['invalid', 'valid', 'changed'].includes(kind) ? 1 : 0);
  if (kind === 'dangling' || kind === 'symlink') assert.equal(fs.readlinkSync(pointer), target);
  if (kind === 'symlink') assert.equal(fs.readFileSync(target, 'utf8'), 'retain target');
  checks.push('pointer-' + kind);
}
assert.deepEqual(hashes(), before, 'input source or historical pin changed during controls');
assert.equal(forbiddenAttempts, 0);
const report = path.join(retainedRoot, 'results.json');
fs.writeFileSync(report, JSON.stringify({ ok: true, qualification: false, checks, syntaxChecks,
  forbiddenAttempts, sourceHashes: before, candidateExecutions: 0,
  limits: 'resolver validators are inert; syntax checking is not installer execution', retainedRoot }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ ok: true, qualification: false, checks: checks.length, syntaxChecks, forbiddenAttempts, report }));
