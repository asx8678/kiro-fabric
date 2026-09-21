import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
const candidate = fs.readFileSync('.github/workflows/complete-bundle-candidate.yml', 'utf8');
const promotion = fs.readFileSync('.github/workflows/complete-release.yml', 'utf8');
describe('complete-bundle protected workflows', () => {
  it('uses native four-target manual candidate jobs without signing credentials', () => {
    for (const t of ['darwin-arm64','darwin-x64','linux-arm64','linux-x64']) expect(candidate).toContain(`target: ${t}`);
    for (const text of ['workflow_dispatch:', 'github.ref_protected == true', 'environment: complete-release-qualification', 'prepare-complete-release.mjs', 'native-smoke.json', 'Missing runners are PENDING']) expect(candidate).toContain(text);
    expect(candidate).not.toContain('secrets.'); expect(candidate).not.toContain('contents: write');
  });
  it('verifies signed tag and protected exact commit before checkout/download', () => {
    for (const text of ['.verification.verified', 'test "$commit" = "$EXPECTED"', 'github.ref_protected == true', 'needs.verify.outputs.commit', 'test "$(jq -r \'.head_sha\' <<<"$run")" = "$COMMIT"', 'test "$(jq -r \'.head_branch\' <<<"$run")" = "$DEFAULT_BRANCH"', 'workflow_dispatch', '.conclusion']) expect(promotion).toContain(text);
    expect(promotion.indexOf('Require reviewed static production root')).toBeLessThan(promotion.indexOf('gh run download'));
    expect(promotion).toContain('pnpm run check');
  });
  it('promotes only captured complete assets behind separate release approval', () => {
    expect(promotion).toContain('complete-release-promotion.mjs "$RUNNER_TEMP/complete-private" "$RUNNER_TEMP/complete-assets" "$COMMIT" "$TAG"');
    expect(promotion).toContain('needs: [verify, qualify]'); expect(promotion).toContain('environment: release');
    expect(promotion).not.toContain('kiro-fabric-agent.tar.gz'); expect(promotion.match(/secrets\.[A-Z_]+/g)).toEqual(['secrets.COMPLETE_RELEASE_INPUTS_PASSPHRASE']);
    expect(promotion).not.toContain('witnesses/'); expect(promotion).toContain('fail_on_unmatched_files: true');
  });
  it('transports encrypted witnesses, removes plaintext before upload and rebinds immutable tags', () => {
    expect(promotion).toContain('complete-inputs/inputs.enc');
    expect(promotion.indexOf('Remove decrypted qualification witnesses')).toBeLessThan(promotion.indexOf('uses: actions/upload-artifact'));
    expect(promotion).toContain('test "$(jq -r \'.object.sha\' <<<"$ref")" = "$TAG_OBJECT"');
    expect(promotion).toContain('index("update") != null and index("deletion") != null');
    expect(promotion).toContain('(.bypass_actors | length) == 0');
    expect(promotion.indexOf('Require immutable tags')).toBeLessThan(promotion.indexOf('uses: softprops/action-gh-release'));
  });
  it('pins every action by full revision', () => { for (const text of [candidate,promotion]) for (const m of text.matchAll(/uses: (\S+)/g)) expect(m[1]).toMatch(/@[a-f0-9]{40}$/); });
  it.each(['v$(touch injected)', 'v1.0.0; exit 0', 'v01.0.0', 'v1.0.0\ntrue', '--help'])('treats hostile tag %j as data and refuses it before network', tag => {
    const expression = promotion.split('\n').find(line => line.trimStart().startsWith('[[ "$TAG"'))!.trim();
    const r = spawnSync('bash', ['--noprofile','--norc','-euc',expression], { env: { PATH: '/usr/bin:/bin', TAG: tag }, encoding:'utf8', timeout: 15000 });
    expect(r.error).toBeUndefined(); expect(r.status).not.toBe(0);
  });
});
