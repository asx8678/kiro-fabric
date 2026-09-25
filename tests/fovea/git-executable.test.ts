import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveFoveaGit } from '../../src/fovea/git-executable.js';

const darwinGit = '/Library/Developer/CommandLineTools/usr/bin/git';
const osGit = '/usr/bin/git';
const explicitGit = '/private-tools/git';

function fixture(platform: NodeJS.Platform, candidate = platform === 'darwin' ? darwinGit : osGit) {
  vi.stubGlobal('process', Object.create(process, { platform: { value: platform } }));
  const file = { mode: 0o100755, uid: 0, nlink: 1, isFile: () => true, isSymbolicLink: () => false };
  const directory = { mode: 0o40755, uid: 0, isDirectory: () => true, isSymbolicLink: () => false };
  const realpath = vi.spyOn(fs, 'realpathSync').mockImplementation(((value: fs.PathLike) => String(value)) as typeof fs.realpathSync);
  const lstat = vi.spyOn(fs, 'lstatSync').mockImplementation(((value: fs.PathLike) => String(value) === candidate ? file : directory) as typeof fs.lstatSync);
  return { file, directory, realpath, lstat };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Fovea fixed Git admission', () => {
  it.each(['darwin', 'linux'] as const)('selects a fixed trusted binary on %s, never PATH or developer environment', platform => {
    const expected = platform === 'darwin' ? darwinGit : osGit;
    const f = fixture(platform);
    vi.stubEnv('PATH', '/attacker/bin');
    vi.stubEnv('DEVELOPER_DIR', '/attacker/xcode');
    vi.stubEnv('GIT_EXECUTABLE', '/attacker/git');
    expect(resolveFoveaGit()).toBe(expected);
    expect(f.realpath).toHaveBeenCalledExactlyOnceWith(expected);
    expect(f.lstat).toHaveBeenCalledWith('/');
    if (platform === 'darwin') expect(f.lstat).not.toHaveBeenCalledWith(osGit);
  });

  it.each(['darwin', 'linux'] as const)('retains explicit trusted host selection on %s', platform => {
    fixture(platform, explicitGit);
    expect(resolveFoveaGit(explicitGit)).toBe(explicitGit);
  });

  it.each(['darwin', 'linux'] as const)('reports an absent optional fixed Git without falling back on %s', platform => {
    const f = fixture(platform);
    f.realpath.mockImplementation(() => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); });
    expect(resolveFoveaGit()).toBeUndefined();
    expect(f.realpath).toHaveBeenCalledTimes(1);
    expect(f.lstat).not.toHaveBeenCalled();
    expect(() => resolveFoveaGit(explicitGit)).toThrow('missing');
  });

  it('does not hide permission errors or fall back to the Darwin shim', () => {
    const f = fixture('darwin');
    f.realpath.mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); });
    expect(() => resolveFoveaGit()).toThrow('denied');
    expect(f.realpath).toHaveBeenCalledTimes(1);
  });

  it('still rejects the explicitly selected hard-linked Apple shim', () => {
    const f = fixture('darwin', osGit); f.file.nlink = 78;
    expect(() => resolveFoveaGit(osGit)).toThrow('Navigator Git executable is not trusted');
  });

  it('rejects hard-linked, writable, non-executable, symlinked, foreign-owned or non-file Git', () => {
    const f = fixture('darwin');
    const trusted = { ...f.file };
    for (const change of [
      { nlink: 2 }, { mode: 0o100775 }, { mode: 0o100757 }, { mode: 0o100644 },
      { uid: (process.getuid?.() ?? 0) + 100_000 }, { isFile: () => false }, { isSymbolicLink: () => true },
    ]) {
      Object.assign(f.file, trusted, change);
      expect(() => resolveFoveaGit()).toThrow('Navigator Git executable is not trusted');
    }
  });

  it('rejects unsafe ancestry instead of relaxing it for Command Line Tools', () => {
    const f = fixture('darwin');
    const trusted = { ...f.directory };
    for (const change of [
      { mode: 0o40775 }, { mode: 0o40757 }, { uid: (process.getuid?.() ?? 0) + 100_000 },
      { isDirectory: () => false }, { isSymbolicLink: () => true },
    ]) {
      Object.assign(f.directory, trusted, change);
      expect(() => resolveFoveaGit()).toThrow('Navigator Git executable ancestry is not trusted');
    }
  });

  it('rejects relative paths and aliases', () => {
    const f = fixture('darwin');
    expect(() => resolveFoveaGit('git')).toThrow('Navigator Git path must be canonical');
    f.realpath.mockReturnValue('/other/git');
    expect(() => resolveFoveaGit()).toThrow('Navigator Git path must be canonical');
  });
});
