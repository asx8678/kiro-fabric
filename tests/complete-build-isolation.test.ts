import fs from 'node:fs';
import path from 'node:path';
import * as child from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { removeFixtureSync } from './fixture-cleanup.mjs';
import { packagingFixture, fixtureDependencies, put } from './installer-packaging-fixture.js';
import { buildCompleteBundleForTest } from '../scripts/build-complete-bundle.mjs';
import { buildCompleteCandidate } from '../scripts/build-complete-candidate.mjs';
import { assertCandidateSource, assertCleanReleaseCheckout } from '../scripts/prepare-complete-release.mjs';
import { verifyBuildClosure } from '../scripts/build-inputs.mjs';
vi.mock('node:child_process', { spy: true });
const roots: string[] = [];
function setup() {
  const root = packagingFixture(); roots.push(root);
  const closure = path.join(root, '.tmp/isolated-closure');
  fs.cpSync(path.join(root, 'dist/kiro-agent-closure'), closure, { recursive: true });
  // Model the foreign host's tracked Darwin output. It must not be consulted,
  // rewritten, removed or copied into a Linux candidate.
  put(root, 'dist/kiro-agent-closure/fovea/source-platform.json', '{"platform":"darwin","arch":"arm64"}');
  put(root, 'dist/kiro-agent-closure/fovea/source-platform.node', 'tracked Darwin sentinel');
  put(root, 'dist/kiro-agent-closure/closure-manifest.json', 'pre-existing tracked modification');
  const deps = fixtureDependencies();
  deps.provenance = root => ({ kind: 'local-source', sourceDigest: verifyBuildClosure(root, closure).buildInputs.digest, gitHead: 'a'.repeat(40), dirty: false });
  return { root, closure, deps, options: { root, closure, target: 'linux-x64', archive: false } };
}
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
it('captures and reuses isolated exact bytes without consulting or changing tracked native output', async () => {
  const f = setup(), bytes = fs.readFileSync(path.join(f.closure, 'closure-manifest.json'));
  const first = await buildCompleteBundleForTest(f.options, f.deps);
  expect(fs.readFileSync(path.join(first.root, 'app/closure-manifest.json'))).toEqual(bytes);
  expect(fs.existsSync(path.join(first.root, 'app/fovea/source-platform.node'))).toBe(false);
  expect(first.provenance.dirty).toBe(false);
  expect(first.provenance.sourceDigest).toBe(verifyBuildClosure(f.root, f.closure).buildInputs.digest);
  expect((await buildCompleteBundleForTest(f.options, f.deps)).reused).toBe(true);
  fs.appendFileSync(path.join(f.closure, 'closure-manifest.json'), '\n');
  const next = await buildCompleteBundleForTest(f.options, f.deps);
  expect(next.root).not.toBe(first.root); // semantically equal JSON is not equal bytes
  expect(fs.readFileSync(path.join(next.root, 'app/closure-manifest.json'))).toEqual(Buffer.concat([bytes, Buffer.from('\n')]));
  expect(fs.readFileSync(path.join(f.root, 'dist/kiro-agent-closure/closure-manifest.json'), 'utf8')).toBe('pre-existing tracked modification');
  expect(fs.readFileSync(path.join(f.root, 'dist/kiro-agent-closure/fovea/source-platform.node'), 'utf8')).toBe('tracked Darwin sentinel');
});
it('rejects isolated corruption, real source drift and manifest drift during capture', async () => {
  const f = setup();
  const compile = f.deps.compileManager;
  f.deps.compileManager = async (...args) => { await compile(...args); fs.appendFileSync(path.join(f.closure, 'closure-manifest.json'), '\n'); };
  await expect(buildCompleteBundleForTest(f.options, f.deps)).rejects.toThrow('Closure manifest changed');
  expect(fs.existsSync(path.join(f.root, '.tmp/complete-bundle.json'))).toBe(false);
  fs.appendFileSync(path.join(f.closure, 'kiro/mcp-entry.js'), 'corrupted');
  await expect(buildCompleteBundleForTest(f.options, f.deps)).rejects.toThrow(/checksum/);
  const other = setup(); put(other.root, 'src/real-source-change.ts', 'export {};');
  await expect(buildCompleteBundleForTest(other.options, other.deps)).rejects.toThrow(/Build inputs changed/);
});
it.each([' M src/real.ts\n', '?? real-source.ts\n', 'M  scripts/build-kiro-closure.mjs\n'])('rejects dirty Git status %j before candidate output', async status => {
  const f = setup(), commit = 'a'.repeat(40);
  const git = vi.spyOn(child, 'execFileSync').mockImplementation((file, args) => {
    expect(file).toBe('git');
    return (args as string[])[0] === 'rev-parse' ? commit + '\n' : status;
  });
  const before = fs.readdirSync(path.join(f.root, '.tmp'));
  await expect(buildCompleteCandidate(commit, f.root)).rejects.toThrow('exact clean checkout');
  expect(fs.readdirSync(path.join(f.root, '.tmp'))).toEqual(before);
  expect(git).toHaveBeenCalledTimes(2);
  expect(() => assertCandidateSource({ manifest: { schema: 2, provenance: { kind: 'local-source', gitHead: commit, dirty: true, sourceDigest: 'b'.repeat(64) } } }, commit, 'b'.repeat(64))).toThrow('clean exact-commit');
});
it('accepts clean exact Git identity without excluding any real source paths', () => {
  const commit = 'a'.repeat(40), git = vi.spyOn(child, 'execFileSync').mockImplementation((_file, args) => (args as string[])[0] === 'rev-parse' ? commit + '\n' : '');
  expect(() => assertCleanReleaseCheckout(process.cwd(), commit)).not.toThrow();
  expect(git.mock.calls[1]![1]).toEqual(['status', '--porcelain', '--untracked-files=all']);
});
