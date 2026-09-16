import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createNativeFixturePolicy, removeNativeFixturePolicy } from '../scripts/steering-benchmark/native-policy.mjs';
import { save, sha } from '../scripts/steering-benchmark/core.mjs';
import { init, runOne } from '../scripts/steering-benchmark/runner.mjs';

describe('temporary current-v3 workspace-only shell consent', () => {
  it('uses the observed native root hash; removes only its own policy and preserves global settings', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-policy-'));
    try {
      // Explicit private modes: fixture must not depend on process umask.
      const home=path.join(root,'home'),workspace=path.join(root,'workspace');fs.mkdirSync(home,{mode:0o700});fs.mkdirSync(workspace,{mode:0o700});
      fs.mkdirSync(path.join(home,'.kiro'),{mode:0o700});fs.mkdirSync(path.join(home,'.kiro/settings'),{mode:0o700});
      const global=path.join(home,'.kiro/settings/permissions.json');fs.writeFileSync(global,'{"rules":[]}');
      const policy=createNativeFixturePolicy(workspace,process.execPath,home);
      expect(policy.path).toBe(path.join(home,'.kiro/workspace-roots',sha(fs.realpathSync(workspace)).slice(0,16),'permissions.json'));
      expect(policy.rules[0]?.capability).toBe('shell');expect(policy.rules[0]?.match).toContain('node *');
      expect(()=>createNativeFixturePolicy(workspace,process.execPath,home)).toThrow();
      fs.writeFileSync(path.join(path.dirname(policy.path),'other-session.txt'),'keep');
      removeNativeFixturePolicy(policy);
      expect(fs.existsSync(policy.path)).toBe(false);expect(fs.readFileSync(global,'utf8')).toBe('{"rules":[]}');
      expect(fs.readFileSync(path.join(path.dirname(policy.path),'other-session.txt'),'utf8')).toBe('keep');
    } finally {fs.rmSync(root,{recursive:true,force:true});}
  });
  it.each(['override', 'relative', 'inherited', 'missing'])('runner uses effective client HOME for %s consent without controller-home fallback', async mode => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-policy-home-'));
    const controllerHome = path.join(root, 'controller'), clientHome = path.join(root, 'client');
    fs.mkdirSync(controllerHome); if (mode !== 'missing') fs.mkdirSync(clientHome);
    vi.stubEnv('HOME', controllerHome);
    try {
      const marker = path.join(root, 'identity.json'), manifest = path.join(root, 'manifest.json'), output = path.join(root, 'output');
      save(marker, {});
      // Node is a local fake client: --version succeeds, Kiro chat args fail.
      save(manifest, { cli: process.execPath, python: process.execPath, runtimePaths: [marker], cliConfigPaths: [marker], arms: {}, cases: ['explain'], nativeWorkspacePermissions: true, env: mode === 'inherited' ? {} : { HOME: mode === 'relative' ? path.relative(path.join(output, 'runs/0000/workspace'), clientHome) : clientHome } });
      await init(manifest, output);
      const row = await runOne(output);
      expect(row.state).toBe('finished'); expect(row.ok).toBe(false);
      if (mode === 'missing') {
        expect(row.stopReason).toBe('execution-error'); expect(row.nativePermission).toBeUndefined(); expect(row.command).toBeUndefined();
      } else {
        const workspace = fs.realpathSync(path.join(output, 'runs/0000/workspace'));
        const expectedHome = mode === 'inherited' ? controllerHome : clientHome;
        expect(row.nativePermission?.path).toBe(path.join(expectedHome, '.kiro/workspace-roots', sha(workspace).slice(0, 16), 'permissions.json'));
        expect(fs.existsSync(row.nativePermission!.path)).toBe(false);
        expect(fs.readdirSync(path.join(expectedHome, '.kiro/workspace-roots'))).toEqual([]);
        expect(row.stopReason).toBe('client-failure');
      }
      if (mode !== 'inherited') expect(fs.readdirSync(controllerHome)).toEqual([]);
    } finally { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('refuses changed consent, symlink parents and an invalid consent option', () => {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-policy-drift-'));
    try {
      const home=path.join(root,'home'),workspace=path.join(root,'workspace');fs.mkdirSync(home,{mode:0o700});fs.mkdirSync(workspace,{mode:0o700});
      const policy=createNativeFixturePolicy(workspace,process.execPath,home);fs.appendFileSync(policy.path,' ');
      expect(()=>removeNativeFixturePolicy(policy)).toThrow('content drift');expect(fs.existsSync(policy.path)).toBe(true);
      const alias=path.join(root,'alias-home');fs.mkdirSync(alias);fs.symlinkSync(path.join(home,'.kiro'),path.join(alias,'.kiro'));
      expect(()=>createNativeFixturePolicy(workspace,process.execPath,alias)).toThrow('unsafe');
    } finally {fs.rmSync(root,{recursive:true,force:true});}
  });
});
