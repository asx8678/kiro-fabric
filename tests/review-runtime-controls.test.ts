import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// Optional real-language qualification, never a Node imitation of these semantics.
// Missing runtimes are explicit skips; installed-but-broken runtimes fail the probe.
const present = (name: string, args: string[]) => (spawnSync(name, args, { timeout: 5000, stdio: 'ignore' }).error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT';
const helm = present('helm', ['version', '--short']);
const pwsh = present('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()']);

describe('optional real-runtime review counterexamples (offline)', () => {
  it.skipIf(!helm)('Helm whitespace renders; a non-default key exposes the actual casing defect', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-helm-control-'));
    try {
      fs.mkdirSync(path.join(root, 'templates'));
      fs.writeFileSync(path.join(root, 'Chart.yaml'), 'apiVersion: v2\nname: review-controls\nversion: 0.1.0\n');
      fs.writeFileSync(path.join(root, 'values.yaml'), 'job:\n  restartPolicy: OnFailure\n');
      const source = `apiVersion: v1
kind: Pod
metadata:
 {{- $name := .Release.Name }}
  name: {{ $name }}
spec:
  restartPolicy: {{ default "Never" .Values.job.RestartPolicy }}
  containers:
  - name: fixture
    image: fixture.invalid/image:unused
`;
      const template = path.join(root, 'templates/pod.yaml');
      fs.writeFileSync(template, source);
      const render = () => {
        // No lookup, dependencies, server dry-run, installation or deployment.
        const r = spawnSync('helm', ['template', 'review', root], { encoding: 'utf8', timeout: 10000 });
        expect(r.error).toBeUndefined();
        expect(r.status, r.stderr).toBe(0);
        expect(r.stdout).toMatch(/metadata:\n  name: review\n/);
        return r.stdout;
      };
      expect(render()).toContain('restartPolicy: Never');
      fs.writeFileSync(template, source.replace('.Values.job.RestartPolicy', '.Values.job.restartPolicy'));
      expect(render()).toContain('restartPolicy: OnFailure');
    } finally { removeFixtureSync(root, { recursive: true, force: true }); }
  });

  it.skipIf(!pwsh)('PowerShell guards, negative index and XML property iteration disprove unconditional defects', () => {
    const script = `$ErrorActionPreference = 'Stop'
Set-StrictMode -Off
$apiKeys = @('staging-label', 'production-label')
$selected = $apiKeys[$apiKey.Length-1]
$images = @{}
$iterations = 0
foreach ($key in $images.Keys) { $iterations++; $ignored = 1 / $images.Count }
[xml]$xml = '<CVEWhiteList><Image id="first"/><Image id="second"/></CVEWhiteList>'
$nodes = $xml.CVEWhiteList.Image
foreach ($node in $nodes) { $node.ParentNode.RemoveChild($node) | Out-Null }
$strictFailure = $false
try { Set-StrictMode -Version Latest; $ignored = $apiKey.Length } catch { $strictFailure = $true }
[pscustomobject]@{ selected = $selected; iterations = $iterations; remaining = $xml.SelectNodes('/CVEWhiteList/Image').Count; strictFailure = $strictFailure } | ConvertTo-Json -Compress
`;
    const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 10000 });
    expect(r.error).toBeUndefined();
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ selected: 'production-label', iterations: 0, remaining: 0, strictFailure: true });
  });
});
