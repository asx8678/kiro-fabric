import { removeFixtureSync } from "../fixture-cleanup.mjs";
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FOVEA_CONFIG, FoveaConfiguration, MAX_FOVEA_PROJECT_PROFILES } from '../../src/fovea/config.js';

const cleanup: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of cleanup.splice(0)) removeFixtureSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fovea-config-project-')));
  fs.chmodSync(dir, 0o700); cleanup.push(dir);
  const file = path.join(dir, 'fovea.v1.json');
  const profile = (key: string) => `${file}.project-${createHash('sha256').update(key).digest('hex')}.json`;
  return { dir, file, profile, store: new FoveaConfiguration(file) };
}
function config(budget: number) { const value = structuredClone(DEFAULT_FOVEA_CONFIG); value.tools.defaultBudget = budget; return value; }

describe('exact-worktree private project settings', () => {
  it.each(['session', 'project', 'global'] as const)('presents unsupported ackClean without changing %s storage or revision semantics', scope => {
    const f = fixture();
    const initial = f.store.read('A');
    expect(initial.settingSupport['sync.ackClean']).toMatchObject({ supported: false, requested: false, effective: false });
    const value = config(1024); value.sync.ackClean = true;
    const written = f.store.update(value, scope, 'absent', 'A');
    expect(written.config).toEqual(value);
    expect(written.settingSupport['sync.ackClean']).toMatchObject({ supported: false, requested: true, effective: false, reason: expect.stringContaining('UI notifications are unsupported') });
    expect(f.store.read('A')).toEqual(written);
    // Presentation data cannot become an authority/configuration field.
    expect(() => f.store.update({ ...value, settingSupport: written.settingSupport }, scope, written.revision, 'A')).toThrow(/Invalid/);
    if (scope === 'session') {
      expect(fs.readdirSync(f.dir)).toEqual([]);
      expect(written.revision).toBe(createHash('sha256').update(JSON.stringify(value)).digest('hex'));
      f.store.reload('A'); expect(f.store.read('A')).toEqual(initial);
    } else {
      const text = fs.readFileSync(scope === 'global' ? f.file : f.profile('A'), 'utf8');
      expect(JSON.parse(text)).toEqual(value); expect(text).not.toContain('settingSupport');
      expect(written.revision).toBe(createHash('sha256').update(text).digest('hex'));
      f.store.reload('A'); expect(f.store.read('A')).toEqual(written);
    }
    const returned = f.store.read('A'); returned.settingSupport['sync.ackClean'].reason = 'caller changed';
    expect(f.store.read('A').settingSupport['sync.ackClean'].reason).not.toBe('caller changed');
  });
  it('isolates A/B, child and linked-worktree identities and never reads workspace files', () => {
    const f = fixture(), a = 'verified-A', b = 'verified-B';
    fs.mkdirSync(path.join(f.dir, '.fovea'), { mode: 0o700 });
    fs.writeFileSync(path.join(f.dir, '.fovea', 'config.json'), '{not trusted');
    const read = vi.spyOn(fs, 'openSync');
    expect(f.store.read(a)).toMatchObject({ scope: 'defaults', revisions: { global: 'absent', project: 'absent' } });
    const written = f.store.update(config(1024), 'project', 'absent', a);
    expect(written).toMatchObject({ scope: 'project', config: config(1024) });
    for (const key of [b, `${a}/child`, 'linked-worktree-A', undefined]) expect(f.store.read(key).config).toEqual(DEFAULT_FOVEA_CONFIG);
    f.store.update(config(2048), 'project', 'absent', b);
    expect(f.store.read(a).config).toEqual(config(1024));
    expect(f.store.read(b).config).toEqual(config(2048));
    expect(read.mock.calls.every(([name]) => !String(name).includes('/.fovea/'))).toBe(true);
    expect(fs.existsSync(f.file)).toBe(false);
    expect(JSON.parse(fs.readFileSync(f.profile(a), 'utf8'))).toEqual(config(1024));
    expect(path.basename(f.profile(a))).not.toContain(a);
  });

  it('deliberately gives host-session overrides precedence and exposes writable layer revisions', () => {
    const f = fixture();
    const global = f.store.update(config(768), 'global', 'absent');
    f.store.update(config(1024), 'project', 'absent', 'A');
    const session = f.store.update(config(2048), 'session', f.store.read('A').revision, 'A');
    expect(session).toMatchObject({ scope: 'session', revisions: { global: global.revision } });
    expect(f.store.read('B').config).toEqual(config(2048));
    const project = f.store.update(config(4096), 'project', session.revisions.project!, 'A');
    expect(project.config).toEqual(config(2048));
    expect(project.revisions.project).not.toBe(session.revisions.project);
    // Global publication historically clears session overrides, but not projects.
    const result = f.store.update(config(8192), 'global', project.revisions.global, 'A');
    expect(result).toMatchObject({ scope: 'project', config: config(4096) });
    expect(f.store.read('B')).toMatchObject({ scope: 'global', config: config(8192) });
    expect(result.revisions.session).toBeUndefined();
  });

  it('retains legacy no-key global/session APIs and fixes global update under session override', () => {
    const f = fixture(), initial = f.store.read();
    f.store.update(config(1024), 'session', initial.revision);
    expect(fs.readdirSync(f.dir)).toEqual([]);
    f.store.reload(); expect(f.store.read()).toEqual(initial);
    f.store.update(config(2048), 'session', initial.revision);
    const written = f.store.update(config(4096), 'global', f.store.read().revisions.global);
    expect(written).toMatchObject({ scope: 'global', config: config(4096) });
    expect(() => f.store.update(config(1024), 'global', initial.revision)).toThrow(/changed/);
    expect(fs.statSync(f.file).mode & 0o777).toBe(0o600);
  });

  it('reloads persisted exact-root profiles and clears only ephemeral session settings', () => {
    const f = fixture(); f.store.update(config(1024), 'project', 'absent', 'A');
    const prior = f.store.read('A');
    f.store.update(config(2048), 'session', prior.revision, 'A');
    f.store.reload('A'); expect(f.store.read('A')).toEqual(prior);
    expect(new FoveaConfiguration(f.file).read('A')).toEqual(prior);
    expect(new FoveaConfiguration(f.file).read('B').scope).toBe('defaults');
  });

  it('rejects stale project revisions across instances without affecting siblings', () => {
    const f = fixture(), other = new FoveaConfiguration(f.file);
    const stale = other.read('A').revisions.project!;
    f.store.update(config(1024), 'project', stale, 'A');
    expect(() => other.update(config(2048), 'project', stale, 'A')).toThrow(/changed/);
    other.update(config(2048), 'project', stale, 'B');
    expect(f.store.read('A').config).toEqual(config(1024));
    fs.writeFileSync(f.file + '.lock', '', { mode: 0o600 });
    expect(() => other.update(config(4096), 'project', other.read('A').revisions.project!, 'A')).toThrow();
    expect(fs.existsSync(f.file + '.lock')).toBe(true);
  });

  it('bounds stored profiles without silently evicting settings and allows existing updates at capacity', () => {
    const f = fixture();
    for (let i = 0; i < MAX_FOVEA_PROJECT_PROFILES; i++) f.store.update(config(1024), 'project', 'absent', String(i));
    expect(() => f.store.update(config(2048), 'project', 'absent', 'overflow')).toThrow(/limit/);
    f.store.update(config(2048), 'project', f.store.read('0').revisions.project!, '0');
    expect(fs.readdirSync(f.dir)).toHaveLength(MAX_FOVEA_PROJECT_PROFILES);
    expect(f.store.read('1').config).toEqual(config(1024));
  });

  it.each(['corrupt', 'version', 'symlink', 'hardlink', 'mode', 'oversize', 'directory'])('fails closed on %s profiles, even under a session override', kind => {
    const f = fixture(); f.store.update(config(1024), 'project', 'absent', 'A');
    f.store.update(config(2048), 'session', f.store.read('A').revision, 'A');
    const file = f.profile('A');
    if (kind === 'corrupt') fs.writeFileSync(file, '{');
    if (kind === 'version') fs.writeFileSync(file, JSON.stringify({ ...config(1024), schemaVersion: 2 }));
    if (kind === 'symlink') { fs.renameSync(file, file + '.real'); fs.symlinkSync(file + '.real', file); }
    if (kind === 'hardlink') fs.linkSync(file, file + '.link');
    if (kind === 'mode') fs.chmodSync(file, 0o640);
    if (kind === 'oversize') fs.writeFileSync(file, ' '.repeat(8193));
    if (kind === 'directory') { fs.unlinkSync(file); fs.mkdirSync(file, { mode: 0o700 }); }
    expect(() => f.store.read('A')).toThrow();
    expect(() => f.store.update(config(4096), 'project', 'absent', 'A')).toThrow();
    expect(() => f.store.reload('A')).toThrow();
  });

  it('rejects unsafe storage ancestry, invalid keys/scopes and authority fields without writes', () => {
    const f = fixture();
    for (const key of ['', 'a'.repeat(4097), 'a\0b']) expect(() => f.store.read(key)).toThrow(/identity/);
    expect(() => f.store.update(config(1024), 'project', 'absent')).toThrow(/identity/);
    expect(() => f.store.update(config(1024), 'bogus' as 'global', 'absent')).toThrow(/scope/);
    for (const extra of [{ executable: '/bin/sh' }, { root: '/' }, { network: true }, { env: {} }, { schemaVersion: 2 }]) {
      expect(() => f.store.update({ ...config(1024), ...extra }, 'project', 'absent', 'A')).toThrow(/Invalid/);
    }
    expect(fs.readdirSync(f.dir)).toEqual([]);
    fs.chmodSync(f.dir, 0o750); expect(() => f.store.read('A')).toThrow(/private/);
    fs.chmodSync(f.dir, 0o700);
    fs.symlinkSync(f.dir, path.join(f.dir, 'alias'));
    expect(() => new FoveaConfiguration(path.join(f.dir, 'alias', 'config.json'))).toThrow(/canonical/);
  });

  it('keeps fovea.v1 enum types strict and rejects unknown nested authority fields', () => {
    const f = fixture();
    for (const value of [
      { ...config(1024), sync: { ...config(1024).sync, mode: ['enabled'] } },
      { ...config(1024), sync: { ...config(1024).sync, scope: ['session'] } },
      { ...config(1024), tools: { ...config(1024).tools, grepMode: ['augment'] } },
      { ...config(1024), tools: { ...config(1024).tools, executable: '/bin/sh' } },
    ]) expect(() => f.store.update(value, 'project', 'absent', 'A')).toThrow(/Invalid/);
    expect(fs.readdirSync(f.dir)).toEqual([]);
  });

  it('publishes private complete JSON atomically and cleans failed publication artifacts', () => {
    const f = fixture();
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('publication denied'); });
    expect(() => f.store.update(config(1024), 'project', 'absent', 'A')).toThrow(/publication denied/);
    expect(fs.readdirSync(f.dir)).toEqual([]); rename.mockRestore();
    f.store.update(config(1024), 'project', 'absent', 'A');
    const old = fs.openSync(f.profile('A'), 'r');
    try {
      f.store.update(config(2048), 'project', f.store.read('A').revisions.project!, 'A');
      expect(JSON.parse(fs.readFileSync(old, 'utf8'))).toEqual(config(1024));
      expect(JSON.parse(fs.readFileSync(f.profile('A'), 'utf8'))).toEqual(config(2048));
    } finally { fs.closeSync(old); }
    expect(fs.statSync(f.profile('A')).mode & 0o777).toBe(0o600);
    expect(fs.statSync(f.profile('A')).nlink).toBe(1);
    expect(fs.readdirSync(f.dir)).toEqual([path.basename(f.profile('A'))]);
  });
});
