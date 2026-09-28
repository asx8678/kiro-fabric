import { removeFixtureSync } from '../fixture-cleanup.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { coreContext, type CoreContext } from '../../src/fovea/core/context.js';
import { diffHunks, prFiles, uncommittedFiles } from '../../src/fovea/core/git.js';
import { impact } from '../../src/fovea/core/ops.js';
import { resolveFoveaGit } from '../../src/fovea/git-executable.js';
import { FoveaProvider } from '../../src/providers/repo-provider.js';
import { pinnedParser } from "./installed-parser.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });
const parser = pinnedParser().path;
const git = resolveFoveaGit();
function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fovea-git-boundary-'))); roots.push(base);
  const root = path.join(base, 'source'); fs.mkdirSync(root, { mode: 0o700 });
  const context: CoreContext = { store: new Map(), sessionStore: new Map(), parserPath: parser, storageRoot: base,
    sourceRoot: root, snapshotRoot: root, signal: new AbortController().signal, gitPath: git, gitFailures: [], focusKey: 'test', spills: new Map() };
  return { base, root, context };
}
function initialize(root: string, base: string) {
  // No commits, checkout/reset, hooks or remote access. Teardown retains this repository.
  execFileSync(git!, ['-c', 'core.hooksPath=/dev/null', 'init', '--template=', root], { timeout: 10_000, stdio: 'pipe',
    env: { HOME: base, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
}
function peer(f: ReturnType<typeof fixture>, commit: string) {
  const log = path.join(f.base, 'argv.jsonl'), file = path.join(f.base, 'git-peer');
  fs.writeFileSync(file, `#!${process.execPath}\nimport fs from 'node:fs';\nconst args = process.argv.slice(2);\nfs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args)+'\\n');\nif(args.includes('--verify')) process.stdout.write(${JSON.stringify(commit)}+'\\n');\nelse if(args.includes('--show-prefix')) process.stdout.write('\\n');\nelse if(args.includes('--name-only')) process.stdout.write(' leading.ts\\0nested/new\\nline.ts\\0');\n`, { mode: 0o700 });
  f.context.gitPath = file;
  return () => fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]);
}

it('public impact rejects option-shaped bases before dispatch and remains read-only', async () => {
  const invoke = vi.fn(async () => ({}));
  const provider = new FoveaProvider({ rootId: 'root', observer: { observe() {}, gap() {} }, invoke, async close() {} });
  for (const base of ['--output=target', '-R', 'HEAD\n', '\0HEAD']) await expect(provider.invoke('impact', { base }, { cwd: process.cwd() })).rejects.toThrow(/Invalid repo arguments/);
  expect(invoke).not.toHaveBeenCalled();
  expect(await provider.describe('impact')).toMatchObject({ risk: 'read', effect: { kind: 'read' }, annotations: { readOnlyHint: true } });
  await provider.invoke('impact', { base: 'feature/topic~1' }, { cwd: process.cwd() });
  expect(invoke).toHaveBeenCalledOnce();
});

it.each(['a'.repeat(40), 'b'.repeat(64)])('gives diff only a verified commit ID, preserving NUL-delimited paths (%s)', async commit => {
  const f = fixture(), calls = peer(f, commit);
  await coreContext.run(f.context, async () => {
    expect(await prFiles(f.root, 'feature/topic~1')).toEqual([' leading.ts', 'nested/new\nline.ts']);
    expect(await diffHunks(f.root, 'feature/topic~1')).toEqual(new Map());
  });
  const recorded = calls();
  expect(recorded.filter(args => args.includes('--verify'))).toHaveLength(2);
  for (const args of recorded.filter(args => args.includes('--verify'))) expect(args.slice(-4)).toEqual(['rev-parse', '--verify', '--end-of-options', 'feature/topic~1^{commit}']);
  for (const args of recorded.filter(args => args.includes('diff'))) {
    expect(args).toContain(`${commit}...HEAD`); expect(args.join(' ')).not.toContain('feature/topic');
    expect(args).toContain('--no-ext-diff'); expect(args).toContain('--no-textconv');
  }
});

it.each(['', 'a'.repeat(40)+'\n'+'b'.repeat(40), '--output=target', 'x'.repeat(2048)])('rejects non-commit or oversized resolver output without diff (%s)', async commit => {
  const f = fixture(), calls = peer(f, commit);
  await coreContext.run(f.context, async () => {
    await expect(prFiles(f.root, 'HEAD')).rejects.toThrow(/one commit/);
    await expect(diffHunks(f.root, 'HEAD')).rejects.toThrow(/one commit/);
  });
  expect(calls().some(args => args.includes('diff'))).toBe(false);
});

describe.skipIf(!git)('real Git impact boundaries', () => {
  it('rejects output injection without truncating a symlink target outside the repository', async () => {
    const f = fixture(); initialize(f.root, f.base);
    const victim = path.join(f.base, 'victim.txt'); fs.writeFileSync(victim, 'KEEP\n');
    const output = path.join(f.root, 'output'); fs.symlinkSync(victim, `${output}...HEAD`);
    await coreContext.run(f.context, async () => {
      for (const run of [prFiles, diffHunks]) await expect(run(f.root, `--output=${output}`)).rejects.toThrow(/Invalid impact base/);
      expect(f.context.gitFailures).toEqual([]);
    });
    expect(fs.readFileSync(victim, 'utf8')).toBe('KEEP\n');
  });
  it('keeps legitimate HEAD analysis working without creating fixture commits', async () => {
    const f = fixture(), checkout = fs.realpathSync(process.cwd());
    f.context.sourceRoot = checkout; f.context.snapshotRoot = checkout;
    await coreContext.run(f.context, async () => {
      expect(await prFiles(checkout, 'HEAD')).toEqual([]);
      expect(await diffHunks(checkout, 'HEAD')).toBeInstanceOf(Map);
      await expect(prFiles(checkout, 'HEAD:package.json')).rejects.toThrow(/one commit/);
    });
  });
  it('enumerates nested untracked files rather than collapsing their directory', async () => {
    const f = fixture(); initialize(f.root, f.base);
    fs.mkdirSync(path.join(f.root, 'nested/deeper'), { recursive: true });
    fs.writeFileSync(path.join(f.root, 'nested/deeper/new.ts'), 'export const added = 1;\n');
    fs.writeFileSync(path.join(f.root, 'nested/ spaced.ts'), '// another file\n');
    await coreContext.run(f.context, async () => expect(await uncommittedFiles(f.root)).toEqual(['nested/ spaced.ts', 'nested/deeper/new.ts']));
  });
  it.skipIf(!fs.existsSync(parser))('default impact seeds newly created nested source files end to end', async () => {
    const f = fixture(); initialize(f.root, f.base);
    fs.mkdirSync(path.join(f.root, 'nested/deeper'), { recursive: true });
    fs.writeFileSync(path.join(f.root, 'nested/deeper/new.ts'), 'export function added() { return 1; }\n');
    await coreContext.run(f.context, async () => {
      const result = await impact(f.root, {});
      expect(result.details.seeds).toBeGreaterThan(0);
      expect(result.text).not.toContain('no seed files');
    });
  });
});
