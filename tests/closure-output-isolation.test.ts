import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { verifyBuildClosure } from '../scripts/build-inputs.mjs';
import { removeFixtureSync } from './fixture-cleanup.mjs';

it('builds real host closure/native bytes in fresh output, preserving tracked dist', () => {
  const root = fs.realpathSync('.');
  function inventory(dir: string): unknown[] {
    return fs.readdirSync(dir).sort().flatMap(name => {
      const file = path.join(dir, name);
      return fs.lstatSync(file).isDirectory() ? inventory(file) : [[path.relative(root, file), createHash('sha256').update(fs.readFileSync(file)).digest('hex')]];
    });
  }
  const before = inventory(path.join(root, 'dist'));
  const sharedEvidence = path.join(root, '.tmp/agent-reachability.json');
  const evidenceBefore = fs.existsSync(sharedEvidence) ? fs.readFileSync(sharedEvidence) : undefined;
  const generation = fs.mkdtempSync(path.join(root, '.tmp/closure-output-test-'));
  const closure = path.join(generation, 'closure');
  try {
    const build = spawnSync(process.execPath, ['scripts/build-kiro-closure.mjs', '--outdir', closure], { encoding: 'utf8', timeout: 90000 });
    expect(build.error).toBeUndefined(); expect(build.status, build.stderr).toBe(0);
    const manifest = verifyBuildClosure(root, closure);
    expect(manifest.files.length).toBeGreaterThan(0);
    const reachability = path.join(generation, 'closure-agent-reachability.json');
    expect(JSON.parse(fs.readFileSync(reachability, 'utf8'))).toMatchObject({ schemaVersion: 1, sourceInputs: expect.any(Array) });
    expect(inventory(path.join(root, 'dist'))).toEqual(before);
    expect(fs.existsSync(sharedEvidence) ? fs.readFileSync(sharedEvidence) : undefined).toEqual(evidenceBefore);
    if (process.platform === 'darwin') {
      const metadata = JSON.parse(fs.readFileSync(path.join(closure, 'fovea/source-platform.json'), 'utf8'));
      expect(metadata.arch).toBe(process.arch);
      const binary = path.join(closure, 'fovea/source-platform.node');
      expect(metadata.sha256).toBe(createHash('sha256').update(fs.readFileSync(binary)).digest('hex'));
      expect(createRequire(import.meta.url)(binary).platform).toBe('darwin');
    } else expect(fs.existsSync(path.join(closure, 'fovea/source-platform.node'))).toBe(false);
    const occupied = spawnSync(process.execPath, ['scripts/build-kiro-closure.mjs', '--outdir', closure], { encoding: 'utf8', timeout: 30000 });
    expect(occupied.error).toBeUndefined(); expect(occupied.status).not.toBe(0); expect(occupied.stderr).toContain('EEXIST');
    expect(verifyBuildClosure(root, closure)).toEqual(manifest);
    expect(fs.existsSync(reachability)).toBe(true);
    expect(inventory(path.join(root, 'dist'))).toEqual(before);
  } finally { removeFixtureSync(generation, { recursive: true, force: true }); }
}, 120000);
