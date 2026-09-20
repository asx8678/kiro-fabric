#!/usr/bin/env node
// Explicit development qualification, not a build/install step or native UI claim.
// No downloads, credentials, implicit sibling repositories or report overwrites.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PINNED } from './fovea-reference-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const modules = ['tests/fovea/reference-lifecycle.test.ts', 'tests/fovea/reference-differential.test.ts'];

/** Fail before test discovery, rather than turning absent or wrong refs into skips.
 * @param {NodeJS.ProcessEnv} [env] */
export function referencePrerequisites(env = process.env) {
  const keys = ['FOVEA_REFERENCE_ROOT', 'FOVEA_HOST_REFERENCE_ROOT', 'FOVEA_REFERENCE_PARSER'];
  for (const key of keys) if (!env[key]?.trim()) throw Error(`Qualification requires ${key}`);
  const reference = path.resolve(env.FOVEA_REFERENCE_ROOT), hostReference = path.resolve(env.FOVEA_HOST_REFERENCE_ROOT), parser = path.resolve(env.FOVEA_REFERENCE_PARSER);
  const probeEnv = { PATH: env.PATH ?? '/usr/bin:/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  for (const [directory, commit, label] of [[reference, PINNED.upstreamCommit, 'Fovea'], [hostReference, PINNED.referenceHostCommit, 'host']]) {
    const r = spawnSync('git', ['-C', directory, 'cat-file', '-t', commit], { encoding: 'utf8', env: probeEnv, timeout: 15000 });
    if (r.error || r.status !== 0 || r.stdout.trim() !== 'commit') throw Error(`Qualification requires exact ${label} commit ${commit} in ${directory}`);
    // The differential module intentionally admits Git stores, never unpacked or
    // dirty reference source. Both modules archive the pinned object themselves.
    if (!fs.existsSync(path.join(directory, '.git'))) throw Error(`Qualification requires a Git worktree/store with .git: ${directory}`);
  }
  const pins = JSON.parse(fs.readFileSync(path.join(repo, 'build-toolchain.json'), 'utf8'));
  const target = `${process.platform}-${process.arch}`, pin = pins.targets[target]?.['ast-grep'];
  const member = pin?.members.find(m => m.path === 'tools/ast-grep');
  const stat = fs.statSync(parser);
  if (!member || !stat.isFile() || stat.size !== member.size || hash(fs.readFileSync(parser)) !== member.sha256) throw Error('Qualification requires exact platform-pinned parser bytes');
  const version = spawnSync(parser, ['--version'], { encoding: 'utf8', env: probeEnv, timeout: 15000 });
  if (version.error || version.status !== 0 || version.stdout.trim() !== 'ast-grep 0.45.3') throw Error('Qualification parser version probe failed');
  const bun = spawnSync('bun', ['--version'], { encoding: 'utf8', env: probeEnv, timeout: 15000 });
  if (bun.error || bun.status !== 0) throw Error('Qualification differential modules require bun');
  return { reference, hostReference, parser, target, referenceCommit: PINNED.upstreamCommit, hostReferenceCommit: PINNED.referenceHostCommit, parserSha256: member.sha256, bunVersion: bun.stdout.trim() };
}

/** Only the declared uncontrolled-cold gate may remain skipped.
 * @param {any} report */
export function qualificationSkips(report) {
  const residual = [];
  for (const module of modules) {
    const file = report.testResults?.find(f => path.resolve(f.name) === path.join(repo, module));
    if (!file?.assertionResults?.length) throw Error(`Qualification module missing: ${module}`);
    for (const test of file.assertionResults) {
      if (test.status === 'passed') continue;
      const name = test.fullName;
      if (!['pending', 'skipped', 'todo'].includes(test.status)) throw Error(`Qualification test did not pass: ${name}`);
      const cold = module.endsWith('reference-differential.test.ts') && name.startsWith('UNQUALIFIED opt-in cold family parity');
      if (!cold) throw Error(`Unexpected qualification skip: ${name}`);
      residual.push({ module, name, reason: 'separate uncontrolled-cold opt-in gate' });
    }
  }
  return residual;
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log('FOVEA_REFERENCE_ROOT=<git> FOVEA_HOST_REFERENCE_ROOT=<git> FOVEA_REFERENCE_PARSER=<pinned binary> node scripts/qualify-fovea-references.mjs\nRuns complete lifecycle and differential modules; fails missing/wrong references. No downloads or builds. Writes a unique report under .tmp/fovea-reference-qualification; preserves .tmp/vitest-report.json. All lifecycle cases must execute; uncontrolled-cold residual gates are reported, not qualified.');
    return 0;
  }
  if (argv.length) throw Error('Qualification takes no arguments; use explicit reference environment variables');
  const prerequisites = referencePrerequisites();
  const original = path.join(repo, '.tmp/vitest-report.json');
  const originalHash = fs.existsSync(original) ? hash(fs.readFileSync(original)) : null;
  const parent = path.join(repo, '.tmp/fovea-reference-qualification');
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const directory = fs.mkdtempSync(path.join(parent, 'run-'));
  const reportPath = path.join(directory, 'vitest.json');
  const args = [path.join(repo, 'node_modules/vitest/vitest.mjs'), 'run', ...modules, '--reporter=default', '--reporter=json', `--outputFile=${reportPath}`];
  fs.writeFileSync(path.join(directory, 'inputs.json'), JSON.stringify({ ...prerequisites, modules, originalReportSha256: originalHash, command: [process.execPath, ...args] }, null, 2) + '\n', { mode: 0o600 });
  console.log(`Qualification evidence: ${directory}`);
  const result = spawnSync(process.execPath, args, { cwd: repo, stdio: 'inherit', timeout: 1200000,
    env: { ...process.env, FOVEA_REFERENCE_ROOT: prerequisites.reference, FOVEA_HOST_REFERENCE_ROOT: prerequisites.hostReference, FOVEA_REFERENCE_PARSER: prerequisites.parser } });
  const afterHash = fs.existsSync(original) ? hash(fs.readFileSync(original)) : null;
  if (originalHash !== afterHash) throw Error('Original suite report changed during qualification');
  if (result.error || result.status !== 0) throw Error(`Qualification modules failed; evidence: ${directory}`);
  const residual = qualificationSkips(JSON.parse(fs.readFileSync(reportPath, 'utf8')));
  fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify({ status: 'passed', surface: 'pinned-components-fixture-runner', qualifiedNative: false, originalReportSha256: originalHash, residual }, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ status: 'passed', report: reportPath, residual }));
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
