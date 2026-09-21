import { removeFixtureSync } from "../fixture-cleanup.mjs";
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { compareOutputs, inventory, normalizeOutput, NUMERICAL_TOLERANCE, parseArgs, PINNED } from '../../scripts/fovea-reference-harness.mjs';

describe('pinned reference harness', () => {
  it('pins exact fovea/host objects and predeclares numeric tolerance', () => {
    expect(PINNED.upstreamCommit).toBe('b594483868d27b7eb37a9b185c59ce812f8a9c01');
    expect(PINNED.referenceHostCommit).toBe('2ee51683452dc359702880f408e0b8a4bfcb9646');
    expect(NUMERICAL_TOLERANCE).toEqual({ absolute: 1e-12, relative: 1e-10 });
    expect(Object.isFrozen(NUMERICAL_TOLERANCE)).toBe(true);
  });
  it('rejects traversal, non-reference fixtures, invalid budgets and unknown flags', () => {
    for (const args of [['--fixture','/tmp'], ['--fixture','tests/fixtures/../secret'], ['--fixture','src'], ['--budget','NaN'], ['--budget','16001'], ['--allow-live']]) expect(() => parseArgs(args)).toThrow();
  });
  it('preserves exact structure/order/warnings and only tolerates predeclared numerical error', () => {
    const actual = { nodes: ['a','b'], score: 0.25, warning: 'missing' };
    expect(compareOutputs(actual, { ...actual, score: 0.25 + 1e-12 })).toEqual([]);
    expect(compareOutputs(actual, { ...actual, score: 0.251 })).toEqual(['$.score']);
    expect(compareOutputs(actual, { ...actual, nodes: ['b','a'] })).toEqual(['$.nodes.0','$.nodes.1']);
    expect(compareOutputs(actual, { nodes: actual.nodes, score: actual.score })).toEqual(['$.warning']);
    expect(compareOutputs({ score: NaN }, { score: NaN })).toEqual(['$.score']);
    expect(normalizeOutput({ warning: '/scratch/warning', score: 1 }, '/scratch')).toEqual({ warning: '<scratch>/warning', score: 1 });
  });
  // Actual oracle output is intentionally not faked by port-adjusted goldens.
  // Main supplies a successful report from the exact parser+commit run.
  it.skipIf(!process.env.FOVEA_REFERENCE_REPORT)('checks actual pinned output report and complete source-fixture inventory', () => {
    const report = JSON.parse(fs.readFileSync(process.env.FOVEA_REFERENCE_REPORT!, 'utf8'));
    expect(report.referenceCommit).toBe(PINNED.upstreamCommit);
    expect(report.referenceStatus).toBe('executed'); expect(report.parserVersion).toBe('ast-grep 0.45.3');
    expect(report.tolerance).toEqual(NUMERICAL_TOLERANCE);
    expect(Object.keys(report.outputs).sort()).toEqual(['dwell','focus','impact','languages','sketch']);
    expect(report.fixtureInventory.some((entry: {path: string}) => entry.path === 'coverage-corpus.test.ts')).toBe(true);
    expect(report.fixtureInventory.some((entry: {path: string}) => entry.path.endsWith('.proto'))).toBe(true);
  });
  it.skipIf(!process.env.FOVEA_REFERENCE_REPORT || !process.env.FOVEA_NATIVE_OUTPUT)('compares independently produced native outputs against the actual pinned oracle', () => {
    const reference = JSON.parse(fs.readFileSync(process.env.FOVEA_REFERENCE_REPORT!, 'utf8'));
    expect(reference.referenceCommit).toBe(PINNED.upstreamCommit);
    expect(reference.referenceStatus).toBe('executed');
    expect(reference.parserVersion).toBe('ast-grep 0.45.3');
    expect(reference.tolerance).toEqual(NUMERICAL_TOLERANCE);
    const actual = JSON.parse(fs.readFileSync(process.env.FOVEA_NATIVE_OUTPUT!, 'utf8'));
    expect(compareOutputs(reference.outputs, actual)).toEqual([]);
  });
  it('imports without executing the oracle or creating production dependencies', () => {
    const result = spawnSync(process.execPath, ['scripts/fovea-reference-harness.mjs','--help'], { encoding:'utf8', timeout:15000 });
    expect(result.error).toBeUndefined(); expect(result.status).toBe(0);
    const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
    expect(Object.keys(pkg.dependencies).some(name => /pi-fovea|pi-fabric|pi-coding-agent/.test(name))).toBe(false);
  });
  it('inventory rejects symlinks rather than reading outside the reference', () => {
    const root = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'reference-inventory-'));
    try { fs.symlinkSync('/etc', path.join(root,'escape')); expect(() => inventory(root)).toThrow('symlink'); }
    finally { removeFixtureSync(root,{recursive:true,force:true}); }
  });
});
