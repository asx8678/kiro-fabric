import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNativeFixturePolicy, removeNativeFixturePolicy } from '../scripts/steering-benchmark/native-policy.mjs';
import { sha } from '../scripts/steering-benchmark/core.mjs';

describe('temporary current-v3 workspace-only shell consent', () => {
  it('uses the observed native root hash; removes only its own policy and preserves global settings', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-policy-'));
    try {
      const home=path.join(root,'home'),workspace=path.join(root,'workspace');fs.mkdirSync(home);fs.mkdirSync(workspace);
      fs.mkdirSync(path.join(home,'.kiro'));fs.mkdirSync(path.join(home,'.kiro/settings'));
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
  it('refuses changed consent, symlink parents and an invalid consent option', () => {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'native-policy-drift-'));
    try {
      const home=path.join(root,'home'),workspace=path.join(root,'workspace');fs.mkdirSync(home);fs.mkdirSync(workspace);
      const policy=createNativeFixturePolicy(workspace,process.execPath,home);fs.appendFileSync(policy.path,' ');
      expect(()=>removeNativeFixturePolicy(policy)).toThrow('content drift');expect(fs.existsSync(policy.path)).toBe(true);
      const alias=path.join(root,'alias-home');fs.mkdirSync(alias);fs.symlinkSync(path.join(home,'.kiro'),path.join(alias,'.kiro'));
      expect(()=>createNativeFixturePolicy(workspace,process.execPath,alias)).toThrow('unsafe');
    } finally {fs.rmSync(root,{recursive:true,force:true});}
  });
});
