#!/usr/bin/env node
// Development-only execution of exact upstream lifecycle components. Nothing in
// this file is imported by the product/installer. No credentials or runtime npm.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createScope, runBounded } from './fovea-capability-probe.mjs';
import { archivePinnedReference, inventory, normalizeOutput, PINNED } from './fovea-reference-harness.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
export function lifecycleArgs(argv) {
  const options = { reference: path.resolve(repo, '../pi-fovea'), hostReference: path.resolve(repo, '../pi-fabric'), parser: path.join(repo, '.tmp/fovea-parser/ast-grep') };
  const keys = { '--reference': 'reference', '--host-reference': 'hostReference', '--parser': 'parser' };
  for (let i = 0; i < argv.length; i++) {
    const key = keys[argv[i]];
    if (!key || !argv[i + 1] || argv[i + 1].startsWith('--')) throw Error('invalid lifecycle arguments');
    options[key] = path.resolve(argv[++i]);
  }
  return options;
}

export async function runLifecycle(options) {
  const scope = createScope();
  const report = { schemaVersion: 1, surface: 'pinned-components-fixture-runner', qualifiedNative: false,
    status: 'environment-blocked', referenceCommit: PINNED.upstreamCommit, hostReferenceCommit: PINNED.referenceHostCommit,
    parser: null, sources: [], driver: null, toolchain: null, trace: null, blockers: [],
    coverage: 'Original Fovea extension and Pi Fabric capture catalog/wrapper/provider; fixture runner and read/write/edit tools, not a real Pi/Kiro client.' };
  let reference, host;
  for (const [name, source, commit] of [['pi-fovea', options.reference, PINNED.upstreamCommit], ['pi-fabric', options.hostReference, PINNED.referenceHostCommit]]) {
    try { const dir = await archivePinnedReference(scope, source, commit, name); if (name === 'pi-fovea') reference = dir; else host = dir; }
    catch { report.blockers.push(`${name}: pinned archive unavailable`); }
  }
  const pins = JSON.parse(fs.readFileSync(path.join(repo, 'build-toolchain.json'), 'utf8'));
  const pin = pins.targets[`${process.platform}-${process.arch}`]?.['ast-grep'];
  try {
    const actual = fs.realpathSync(options.parser), stat = fs.statSync(actual), expected = pin?.members.find(m => m.path === 'tools/ast-grep');
    if (!expected || !stat.isFile() || stat.size !== expected.size || stat.size > 128 * 1024 * 1024) throw Error('parser size');
    const sha256 = createHash('sha256').update(fs.readFileSync(actual)).digest('hex');
    if (sha256 !== expected.sha256) throw Error('parser hash');
    const probe = await runBounded(actual, ['--version'], { cwd: scope.workspace, env: scope.env });
    if (probe.exitCode !== 0 || probe.stopReason || probe.stdout.trim() !== 'ast-grep 0.45.3') throw Error('parser version');
    options = { ...options, parser: actual };
    report.parser = { version: pin.version, sha256 };
  } catch { report.blockers.push('parser: exact platform-pinned ast-grep 0.45.3 required'); }
  if (!report.blockers.length) {
    try {
      const aliases = { 'fovea-reference/extension': path.join(reference, 'src/index.ts'),
        'fovea-reference/session': path.join(reference, 'src/core/session.ts'), 'fovea-reference/state': path.join(reference, 'src/core/state.ts'),
        'fovea-reference/sync': path.join(reference, 'src/core/sync.ts'), 'fovea-reference/provenance': path.join(reference, 'src/core/provenance.ts'), 'pi-fabric-reference/catalog': path.join(host, 'src/capture/catalog.ts'),
        'pi-fabric-reference/provider': path.join(host, 'src/providers/captured-tools-provider.ts'), typebox: require.resolve('typebox') };
      const driver = path.join(repo, 'tests/fovea/fixtures/lifecycle-driver.mjs'), out = path.join(scope.root, 'lifecycle-driver.mjs');
      const upstreamBefore = { fovea: inventory(path.join(reference, 'src')), fabric: inventory(path.join(host, 'src')) };
      report.driver = { path: 'tests/fovea/fixtures/lifecycle-driver.mjs', sha256: createHash('sha256').update(fs.readFileSync(driver)).digest('hex') };
      report.toolchain = { node: process.version, esbuild: require('esbuild/package.json').version, typebox: JSON.parse(fs.readFileSync(path.join(repo, 'node_modules/typebox/package.json'), 'utf8')).version };
      // Splitting preserves upstream lazy UI imports: this runner never loads Pi's TUI.
      const compiled = await build({ absWorkingDir: scope.root, entryPoints: [driver], outdir: scope.root, outExtension: { '.js': '.mjs' }, splitting: true, chunkNames: 'lifecycle-chunks/[name]-[hash]', bundle: true, platform: 'node', format: 'esm', target: 'node24', alias: aliases,
        external: ['@earendil-works/pi-coding-agent', '@earendil-works/pi-tui'], metafile: true, logLevel: 'silent' });
      const inputs = Object.keys(compiled.metafile.inputs).map(file => path.resolve(scope.root, file));
      report.sources = inputs.filter(file => file.startsWith(reference + path.sep) || file.startsWith(host + path.sep)).map(file => ({
        path: file.startsWith(reference + path.sep) ? `pi-fovea/${path.relative(reference, file)}` : `pi-fabric/${path.relative(host, file)}`,
        sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
      })).sort((a, b) => a.path.localeCompare(b.path));
      for (const expected of ['pi-fovea/src/index.ts', 'pi-fabric/src/capture/catalog.ts', 'pi-fabric/src/capture/wrapper.ts', 'pi-fabric/src/providers/captured-tools-provider.ts']) {
        if (!report.sources.some(source => source.path === expected)) throw Error('missing source closure');
      }
      fs.writeFileSync(path.join(scope.workspace, 'package.json'), '{"name":"lifecycle-fixture"}\n', { mode: 0o600 });
      fs.writeFileSync(path.join(scope.workspace, 'math.ts'), 'export function calculateTotal(n: number) { return n + 1; }\nexport function checkout() { return calculateTotal(2); }\n', { mode: 0o600 });
      const run = await runBounded(process.execPath, [out, scope.workspace], { cwd: scope.workspace,
        env: { ...scope.env, FOVEA_AST_GREP: options.parser, PI_CODING_AGENT_DIR: path.join(scope.home, 'agent') }, timeoutMs: 120000, maxBytes: 1048576 });
      if (run.exitCode !== 0 || run.stopReason || run.error || run.cleanup !== 'leader-closed') {
        // Only synthetic fixture diagnostics, privately retained; no conversations.
        fs.writeFileSync(path.join(scope.root, 'driver.stderr'), run.stderr, { mode: 0o600 });
        report.status = 'failed'; report.blockers.push('lifecycle driver failed; see private driver.stderr');
      } else {
        report.trace = normalizeOutput(JSON.parse(run.stdout), scope.root);
        report.status = 'executed';
      }
      const upstreamAfter = { fovea: inventory(path.join(reference, 'src')), fabric: inventory(path.join(host, 'src')) };
      if (JSON.stringify(upstreamBefore) !== JSON.stringify(upstreamAfter)) throw Error('reference archive changed');
    } catch (error) {
      report.status = 'failed'; report.blockers.push('lifecycle build/execution/integrity failure');
      fs.writeFileSync(path.join(scope.root, 'harness.stderr'), String(error), { mode: 0o600 });
    }
  }
  const output = path.join(scope.root, 'lifecycle-report.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return { status: report.status, report: output, blockers: report.blockers };
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') { console.log('Pinned component lifecycle trace (not Pi/Kiro UI): --reference <git> --host-reference <git> --parser <pinned binary>. Private reports, no downloads.'); return 0; }
  const result = await runLifecycle(lifecycleArgs(argv));
  console.log(JSON.stringify(result));
  return result.status === 'executed' ? 0 : result.status === 'environment-blocked' ? 3 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().then(code => { process.exitCode = code; }).catch(() => { console.error('lifecycle harness failed safely'); process.exitCode = 2; });
