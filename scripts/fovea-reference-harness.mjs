#!/usr/bin/env node
// Development-only pinned oracle. Never imports from or writes into upstream.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createScope, runBounded } from './fovea-capability-probe.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REFERENCE_CLOCK_MS = 1700000000000;
export const NUMERICAL_TOLERANCE = Object.freeze({ absolute: 1e-12, relative: 1e-10 });
export const PINNED = JSON.parse(fs.readFileSync(path.join(repo, 'src/fovea/upstream.json'), 'utf8'));

export function parseArgs(argv) {
  const result = { query: 'main', budget: 512, reference: path.resolve(repo, '../pi-fovea'), hostReference: path.resolve(repo, '../pi-fabric'), parser: 'ast-grep', fixture: 'tests/fixtures/mini', installDev: false };
  const keys = { '--reference': 'reference', '--host-reference': 'hostReference', '--parser': 'parser', '--fixture': 'fixture', '--query': 'query', '--budget': 'budget' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--install-dev') { result.installDev = true; continue; }
    const key = keys[argv[i]];
    if (!key || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('invalid arguments');
    result[key] = key === 'budget' ? Number(argv[++i]) : argv[++i];
  }
  if (!Number.isSafeInteger(result.budget) || result.budget < 256 || result.budget > 16000 || result.query.length > 512) throw new Error('invalid query/budget');
  if (result.parser.includes(path.sep)) result.parser = path.resolve(result.parser);
  if (path.isAbsolute(result.fixture) || result.fixture.split(/[\\/]/).some(p => p === '..' || p === '.') || !result.fixture.startsWith('tests/fixtures/')) throw new Error('fixture must be inside pinned tests/fixtures');
  return result;
}

/** Compare actual oracle results, without deleting missing nodes, warnings or edges. */
export function compareOutputs(expected, actual, tolerance = NUMERICAL_TOLERANCE, at = '$') {
  if (typeof expected === 'number' && typeof actual === 'number') {
    return Number.isFinite(expected) && Number.isFinite(actual) && Math.abs(expected - actual) <= tolerance.absolute + tolerance.relative * Math.abs(expected) ? [] : [at];
  }
  if (expected === actual) return [];
  if (!expected || !actual || typeof expected !== 'object' || typeof actual !== 'object' || Array.isArray(expected) !== Array.isArray(actual)) return [at];
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  return keys.flatMap(key => !Object.hasOwn(expected, key) || !Object.hasOwn(actual, key) ? [`${at}.${key}`] : compareOutputs(expected[key], actual[key], tolerance, `${at}.${key}`));
}

// Only isolated-root relocation is normalized. No score, ordering, timing,
// warning, selected file, edge or history value is discarded.
export function normalizeOutput(value, root) {
  if (typeof value === 'string') return value.split(root).join('<scratch>');
  if (Array.isArray(value)) return value.map(item => normalizeOutput(item, root));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeOutput(item, root)]));
  return value;
}

export function inventory(root) {
  const files = [];
  let totalBytes = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('reference fixture symlink rejected');
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) { const stat = fs.statSync(full); totalBytes += stat.size; if (stat.size > 8 * 1024 * 1024 || totalBytes > 64 * 1024 * 1024 || files.length >= 10000) throw new Error('fixture inventory limit'); files.push({ path: path.relative(root, full).split(path.sep).join('/'), sha256: createHash('sha256').update(fs.readFileSync(full)).digest('hex') }); }
      else throw new Error('special fixture rejected');
    }
  };
  walk(root); return files;
}

/** Export exact objects into private development storage; never use a dirty checkout as oracle. */
export async function archivePinnedReference(scope, source, commit, name) {
  if (!['pi-fovea', 'pi-fabric'].includes(name) || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('invalid reference identity');
  const execute = (cmd, args) => runBounded(cmd, args, { cwd: scope.root, env: scope.env, timeoutMs: 300000, maxBytes: 1048576 });
  const probe = await execute('git', ['-C', path.resolve(source), 'cat-file', '-t', commit]);
  if (probe.exitCode !== 0 || probe.stopReason || probe.stdout.trim() !== 'commit') throw new Error('pinned commit object unavailable');
  const dest = path.join(scope.root, name); fs.mkdirSync(dest, { mode: 0o700 });
  const tar = path.join(scope.root, `${name}.tar`);
  const archived = await execute('git', ['-C', path.resolve(source), 'archive', '--format=tar', `--output=${tar}`, commit]);
  if (archived.exitCode !== 0 || archived.stopReason || !fs.existsSync(tar) || fs.statSync(tar).size > 64 * 1024 * 1024) throw new Error('archive failed or exceeded limit');
  const extracted = await execute('tar', ['-xf', tar, '-C', dest, '--no-same-owner', '--no-same-permissions']);
  fs.unlinkSync(tar);
  if (extracted.exitCode !== 0 || extracted.stopReason) throw new Error('extraction failed');
  return dest;
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') { console.log('Pinned isolated reference oracle: --reference <git repo> --host-reference <git repo> --parser <binary> --fixture tests/fixtures/mini --query <symbol> --budget 256..16000 [--install-dev]. Reports in a new private scratch tree.'); return 0; }
  const options = parseArgs(argv);
  const scope = createScope();
  const report = { schemaVersion: 2, status: 'environment-blocked', referenceCommit: PINNED.upstreamCommit, hostReferenceCommit: PINNED.referenceHostCommit, tolerance: NUMERICAL_TOLERANCE, parameters: { fixture: options.fixture, query: options.query, budget: options.budget, clock: REFERENCE_CLOCK_MS, history: 'plain copied fixture; no git history' }, blockers: [], referenceStatus: 'untested', hostReferenceStatus: 'untested', outputs: null, fixtureInventory: [] };
  const execute = (cmd, args, cwd = scope.root, maxBytes = 1048576) => runBounded(cmd, args, { cwd, env: scope.env, timeoutMs: 300000, maxBytes });
  const archive = async (source, commit, name) => {
    try { return await archivePinnedReference(scope, source, commit, name); }
    catch (error) { report.blockers.push(`${name}: ${error.message}`); return null; }
  };
  const reference = await archive(options.reference, PINNED.upstreamCommit, 'pi-fovea');
  const host = await archive(options.hostReference, PINNED.referenceHostCommit, 'pi-fabric');
  report.hostReferenceStatus = host ? 'archived-not-executed' : 'environment-blocked';
  const parser = await execute(options.parser, ['--version']);
  const parserVersion = parser.stdout.trim();
  const parserOk = parser.exitCode === 0 && !parser.stopReason && parserVersion === 'ast-grep 0.45.3';
  if (!parserOk) report.blockers.push('parser: actual ast-grep 0.45.3 required');
  report['parserVersion'] = /^ast-grep \d+\.\d+\.\d+$/.test(parserVersion) ? parserVersion : null;
  const bun = await execute('bun', ['--version']);
  if (bun.exitCode !== 0) report.blockers.push('bun unavailable');
  if (reference) {
    report.fixtureInventory = inventory(path.join(reference, 'tests'));
    if (options.installDev) {
      const install = await execute('bun', ['install', '--frozen-lockfile', '--ignore-scripts'], reference);
      if (install.exitCode !== 0 || install.stopReason) report.blockers.push('frozen isolated development dependency install failed');
    }
    if (parserOk && bun.exitCode === 0 && !report.blockers.some(x => x.includes('dependency'))) {
      const fixture = path.join(reference, options.fixture);
      const workspace = scope.workspace;
      // Check the entire copied tree before following anything.
      inventory(fixture);
      fs.cpSync(fixture, workspace, { recursive: true, errorOnExist: false, dereference: false });
      const driver = path.join(reference, 'phase0-driver.ts');
      fs.writeFileSync(driver, [
        `Date.now = () => ${REFERENCE_CLOCK_MS};`,
        'const { sketch, focus, dwell, impact } = await import("./src/core/ops.ts");',
        'const { LANG_BY_EXT } = await import("./src/core/astgrep.ts");',
        'const [root, query, budget] = process.argv.slice(2);',
        'const b = Number(budget);',
        'const result = { languages: LANG_BY_EXT, sketch: await sketch(root,b), focus: await focus(root,query,b), dwell: await dwell(root,2,b), impact: await impact(root,{symbols:[query],budget:b,includeUncommitted:false}) };',
        'process.stdout.write(JSON.stringify(result));',
      ].join('\n'), { flag: 'wx', mode: 0o600 });
      const result = await runBounded('bun', [driver, workspace, options.query, String(options.budget)], { cwd: reference, env: { ...scope.env, FOVEA_AST_GREP: options.parser, PI_CODING_AGENT_DIR: path.join(scope.home, 'agent') }, timeoutMs: 300000, maxBytes: 16777216 });
      if (result.exitCode !== 0 || result.stopReason) report.blockers.push('pinned oracle execution failed (private stderr not persisted)');
      else {
        try { report.outputs = normalizeOutput(JSON.parse(result.stdout), scope.root); report.referenceStatus = 'executed'; }
        catch { report.blockers.push('pinned oracle emitted invalid JSON'); }
      }
    }
  }
  report.status = report.referenceStatus === 'executed' ? 'reference-executed' : 'environment-blocked';
  const out = path.join(scope.root, 'reference-report.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: report.status, report: out, blockers: report.blockers }));
  return report.status === 'reference-executed' ? 0 : 3;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().then(code => { process.exitCode = code; }).catch(() => { console.error('reference harness failed safely'); process.exitCode = 2; });
