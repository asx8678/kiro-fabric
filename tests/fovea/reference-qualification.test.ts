import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { qualificationSkips, referencePrerequisites } from '../../scripts/qualify-fovea-references.mjs';

const files = ['tests/fovea/reference-lifecycle.test.ts', 'tests/fovea/reference-differential.test.ts'];
const report = () => ({ testResults: files.map(name => ({ name: path.resolve(name), assertionResults: [{ fullName: 'fixture pass', status: 'passed' }] })) });
describe('explicit pinned-reference qualification admission', () => {
  it('fails missing references instead of delegating to skipIf', () => {
    expect(() => referencePrerequisites({})).toThrow('FOVEA_REFERENCE_ROOT');
    expect(() => referencePrerequisites({ FOVEA_REFERENCE_ROOT: '.' })).toThrow('FOVEA_HOST_REFERENCE_ROOT');
    expect(() => referencePrerequisites({ FOVEA_REFERENCE_ROOT: '.', FOVEA_HOST_REFERENCE_ROOT: '.' })).toThrow('FOVEA_REFERENCE_PARSER');
    expect(() => referencePrerequisites({ FOVEA_REFERENCE_ROOT: '/nonexistent-fovea', FOVEA_HOST_REFERENCE_ROOT: '.', FOVEA_REFERENCE_PARSER: '/nonexistent-parser' })).toThrow('exact Fovea commit');
  });
  it('CLI qualification with missing refs exits nonzero before any tests run', () => {
    const result = spawnSync(process.execPath, ['scripts/qualify-fovea-references.mjs'], { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 15000 });
    expect(result.error).toBeUndefined(); expect(result.status).toBe(1);
    expect(result.stderr).toContain('Qualification requires FOVEA_REFERENCE_ROOT');
    expect(result.stdout).not.toContain('Qualification evidence:');
  });
  it('rejects missing modules, failures and prerequisite-driven skips', () => {
    expect(() => qualificationSkips({ testResults: [] })).toThrow('module missing');
    for (const status of ['failed', 'skipped', 'pending', 'todo']) {
      const r = report(); r.testResults[0]!.assertionResults[0]!.status = status;
      expect(() => qualificationSkips(r)).toThrow();
    }
  });
  it('allows only uncontrolled-cold residuals and requires every native lifecycle case', () => {
    const r = report();
    r.testResults[1]!.assertionResults.push({ fullName: 'UNQUALIFIED opt-in cold family parity including reference repeatability (budget 512)', status: 'skipped' });
    expect(qualificationSkips(r).map((s: { reason: string }) => s.reason)).toEqual(['separate uncontrolled-cold opt-in gate']);
    r.testResults[0]!.assertionResults.push({ fullName: 'exact pinned lifecycle replay compares own origin using real local publications', status: 'skipped' });
    expect(() => qualificationSkips(r)).toThrow('Unexpected qualification skip');
  });
});
