import { afterAll, beforeAll, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { extractBundleArchiveBytes } from '../../scripts/bundle-archive.mjs';
import { validateBundle, sha256 } from '../../scripts/bundle-contract.mjs';
import { inspectCompleteInstallation } from '../../scripts/managed-installation.mjs';

// A bundle-schema migration, NOT the unrelated ownership-schema 1/2 -> 3 fixtures.
const BASELINE = '1dd4df19aac5e3ab4e404a4b43a133e59da6488a';
const repository = path.resolve(import.meta.dirname, '../..');
const newManager = pathToFileURL(path.join(repository, 'scripts/install-manager.mjs')).href;
let root: string, oldBundle: string, newBundle: string, oldDigest: string, newDigest: string;
const subprocessBudget = 90_000; // Harness budget only; production smoke deadlines are unchanged.

function checked(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, expected: number | 'SIGKILL' = 0) {
  const r = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: subprocessBudget, maxBuffer: 2 * 1024 * 1024 });
  expect(r.error, `${command}: ${r.stderr}`).toBeUndefined();
  if (expected === 'SIGKILL') expect(r.signal, r.stdout + r.stderr).toBe('SIGKILL');
  else { expect(r.signal).toBeNull(); expect(r.status, r.stdout + r.stderr).toBe(expected); }
  return r;
}
async function put(file: string, content: string | Buffer, mode = 0o600) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, content, { mode });
  await fs.chmod(file, mode);
}
async function copyPrivate(source: string, destination: string) {
  const st = await fs.lstat(source);
  expect(st.isSymbolicLink()).toBe(false);
  if (st.isDirectory()) {
    await fs.mkdir(destination, { recursive: true, mode: 0o700 });
    for (const name of await fs.readdir(source)) await copyPrivate(path.join(source, name), path.join(destination, name));
  } else { expect(st.isFile()).toBe(true); await put(destination, await fs.readFile(source)); }
}

beforeAll(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'fovea-historical-manager-')));
  await fs.chmod(root, 0o700);
  // Capture once: owner staging may subsequently move its active pointer. No network,
  // signing, checkout reset, worktree, or changes to any already-retained generation.
  const staged = JSON.parse(await fs.readFile(path.join(repository, '.tmp/complete-bundle.json'), 'utf8'));
  newBundle = path.join(root, 'schema-2');
  const current = await extractBundleArchiveBytes(await fs.readFile(staged.archive), newBundle);
  expect(current.digest).toBe(staged.digest);
  expect(current.manifest.schema).toBe(2);
  expect(current.manifest.target).toBe(`${process.platform}-${process.arch}`);
  newDigest = current.digest;
  const source = path.join(root, 'baseline'), archive = path.join(root, 'baseline.tar');
  await fs.mkdir(source, { mode: 0o700 });
  const archiveEnv = { PATH: process.env.PATH, HOME: root, LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' };
  checked('git', ['archive', '--format=tar', `--output=${archive}`, BASELINE], repository, archiveEnv);
  checked('tar', ['-xf', archive, '-C', source], root, archiveEnv);
  oldBundle = path.join(root, 'schema-1');
  await copyPrivate(path.join(source, 'dist/kiro-agent-closure'), path.join(oldBundle, 'app'));
  await copyPrivate(path.join(source, 'skills/fabric-exec'), path.join(oldBundle, 'resources/skills/fabric-exec'));
  await copyPrivate(path.join(source, 'resources/steering/fabric.md'), path.join(oldBundle, 'resources/steering/fabric.md'));
  const pins = JSON.parse(await fs.readFile(path.join(source, 'build-toolchain.json'), 'utf8')).targets[current.manifest.target];
  for (const tool of ['node', 'rg']) {
    expect(pins[tool]).toEqual(current.manifest.tools[tool]);
    for (const member of pins[tool].members) {
      const bytes = await fs.readFile(path.join(newBundle, member.path));
      expect(sha256(bytes)).toBe(member.sha256);
      await put(path.join(oldBundle, member.path), bytes, member.path === `tools/${tool}` ? 0o700 : 0o600);
    }
  }
  await fs.mkdir(path.join(oldBundle, 'manager'), { mode: 0o700 });
  // Fixture-only compilation of unchanged archived manager sources, matching the
  // historical packager flags. Do not compile today's manager into a schema-1 shell.
  const compiled = await build({ absWorkingDir: source, entryPoints: ['scripts/install-manager.mjs'], outfile: path.join(oldBundle, 'manager/install-manager.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24', splitting: false, sourcemap: false, metafile: true, logLevel: 'silent' });
  for (const input of Object.keys(compiled.metafile!.inputs)) {
    expect(path.resolve(source, input).startsWith(source + path.sep)).toBe(true);
    expect(input).not.toMatch(/node_modules|(?:^|\/)tests\//);
  }
  await fs.chmod(path.join(oldBundle, 'manager/install-manager.mjs'), 0o600);
  const script = `import fs from 'node:fs';
    import {createBundleManifest,canonical,validateBundle,compatibilityFor} from ${JSON.stringify(pathToFileURL(path.join(source, 'scripts/bundle-contract.mjs')).href)};
    import {captureBuildInputs,verifyClosureIntegrity} from ${JSON.stringify(pathToFileURL(path.join(source, 'scripts/build-inputs.mjs')).href)};
    const source=process.argv[1],bundle=process.argv[2],target=process.argv[3];
    verifyClosureIntegrity(source+'/dist/kiro-agent-closure');
    const tools=JSON.parse(fs.readFileSync(source+'/build-toolchain.json')).targets[target];
    const version=JSON.parse(fs.readFileSync(source+'/package.json')).version;
    const m=await createBundleManifest(bundle,{version,target,tools,compatibility:compatibilityFor(target),provenance:{kind:'local-source',gitHead:${JSON.stringify(BASELINE)},sourceDigest:captureBuildInputs(source).digest,dirty:false}});
    fs.writeFileSync(bundle+'/bundle-manifest.json',canonical(m)+'\\n',{mode:0o600});
    await validateBundle(bundle); console.log(JSON.stringify(m));`;
  const result = checked(path.join(oldBundle, 'tools/node'), ['--input-type=module', '-e', script, source, oldBundle, current.manifest.target], root, { HOME: root, PATH: '/usr/bin:/bin', LANG: 'C' });
  const historical = JSON.parse(result.stdout);
  expect(historical.schema).toBe(1);
  expect(historical.provenance.gitHead).toBe(BASELINE);
  expect(historical.inventory.some((r: { path: string }) => /fovea|ast-grep/.test(r.path))).toBe(false);
  expect((await validateBundle(oldBundle)).digest).toBe(historical.digest);
  oldDigest = historical.digest;
}, 120_000);

afterAll(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); });

async function installedFixture() {
  const dir = await fs.mkdtemp(path.join(root, 'case-'));
  const home = path.join(dir, 'home'), cwd = path.join(dir, 'workspace'), bin = path.join(dir, 'bin'), temporary = path.join(dir, 'tmp');
  for (const p of [home, cwd, bin, temporary]) await fs.mkdir(p, { mode: 0o700 });
  const kiroHome = path.join(home, '.kiro');
  // Only a client prerequisite stub. All managers, runtimes, tools and MCP are real;
  // this fixture makes no authenticated/native Kiro qualification claim.
  await put(path.join(bin, 'kiro-cli'), '#!/bin/sh\ncase "$*" in\n--version) printf "kiro-cli 2.21.1\\n" ;;\n"agent validate --help") printf "%s\\n" --path ;;\n*) exit 91 ;;\nesac\n', 0o700);
  await put(path.join(cwd, 'probe.txt'), 'historical-manager-sentinel\n');
  await put(path.join(cwd, 'analysis.ts'), 'export function historicalMigrationProbe() { return 1; }\n');
  const env = { HOME: home, KIRO_HOME: kiroHome, TMPDIR: temporary, PATH: `${bin}:/usr/bin:/bin`, LANG: 'C', LC_ALL: 'C' };
  const source = (module: string, bundle: string | undefined, command = 'install', expected = 0) => {
    const code = `import {runManager} from ${JSON.stringify(module)}; process.exitCode=await runManager(${JSON.stringify([command, '--kiro-home', kiroHome, '--yes', '--non-interactive', '--json', ...(['install', 'update'].includes(command) ? ['--no-shell-integration'] : [])])},${bundle ? `{sourceBundle:${JSON.stringify(bundle)}}` : '{}'});`;
    return JSON.parse(checked(path.join(oldBundle, 'tools/node'), ['--input-type=module', '-e', code], cwd, env, expected).stdout);
  };
  const initial = source(pathToFileURL(path.join(oldBundle, 'manager/install-manager.mjs')).href, oldBundle);
  expect(initial).toMatchObject({ outcome: 'activated', digest: oldDigest, committed: true });
  const paths = initial.paths;
  const oldConfig = Buffer.from('{"schemaVersion":1,"tracing":{"enabled":false}}\n');
  const oldConfigFile = path.join(paths.data, 'fabric/config/config.json');
  await put(oldConfigFile, oldConfig);
  const userData = path.join(paths.data, 'fabric/historical-user-state.txt');
  await put(userData, 'retain across admission, rollback and recovery\n');
  const oldRoot = path.join(paths.runtime, oldDigest);
  const oldProfile = await fs.readFile(paths.profile), oldOwner = await fs.readFile(paths.manifest);
  const originalManifest = await fs.readFile(path.join(oldRoot, 'bundle-manifest.json'));
  const run = (args: string[], expected = 0, generation?: string) => {
    const command = generation ? path.join(paths.runtime, generation, 'tools/node') : paths.launcher;
    const argv = generation ? [path.join(paths.runtime, generation, 'manager/install-manager.mjs'), ...args] : args;
    return JSON.parse(checked(command, argv, cwd, env, expected).stdout);
  };
  const controls = async () => Promise.all([paths.manifest, paths.profile, paths.launcher].map(p => fs.readFile(p)));
  const immutableOld = async () => {
    expect(await fs.readFile(path.join(oldRoot, 'bundle-manifest.json'))).toEqual(originalManifest);
    expect((await validateBundle(oldRoot)).digest).toBe(oldDigest); // validates EVERY retained byte and mode
    const owner = JSON.parse(await fs.readFile(paths.manifest, 'utf8'));
    expect(Object.keys(owner).sort()).toEqual(Object.keys(JSON.parse(oldOwner.toString())).sort());
    expect(owner.schemaVersion).toBe(3); // no new fields sneaked into old ownership schema
    expect(await fs.readFile(oldConfigFile)).toEqual(oldConfig);
    expect(await fs.readFile(userData, 'utf8')).toBe('retain across admission, rollback and recovery\n');
    for (const generation of owner.runtimeGenerations) expect(Object.keys(generation).sort()).toEqual(['manifestSha256', 'name']);
  };
  return { dir, cwd, env, kiroHome, paths, oldRoot, oldProfile, oldOwner, source, run, controls, immutableOld };
}

type Fixture = Awaited<ReturnType<typeof installedFixture>>;

// Keep actual backend processes alive across activation/rollback. Admissions are
// sequential (the production lock is fail-fast), then requests run concurrently.
async function backend(f: Fixture, profileBytes: Buffer) {
  const profile = JSON.parse(profileBytes.toString()).mcpServers.fabric;
  const child = spawn(profile.command, profile.args, { cwd: f.cwd, env: { ...f.env, ...profile.env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', diagnostic = '', nextId = 0, ended = false;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const fail = (e: Error) => { for (const request of pending.values()) request.reject(e); pending.clear(); };
  const send = (value: unknown) => child.stdin.write(JSON.stringify(value) + '\n');
  child.stdin.on('error', fail);
  child.stderr.setEncoding('utf8').on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-8000); });
  child.stdout.setEncoding('utf8').on('data', chunk => {
    buffer += chunk;
    if (buffer.length > 1024 * 1024) { fail(Error('MCP output bound exceeded')); child.kill('SIGTERM'); return; }
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      try {
        const frame = JSON.parse(line);
        if (frame.method === 'roots/list') send({ jsonrpc: '2.0', id: frame.id, result: { roots: [{ uri: pathToFileURL(f.cwd).href, name: 'historical' }] } });
        else if (frame.method === 'elicitation/create') send({ jsonrpc: '2.0', id: frame.id, result: { action: 'accept', content: { approved: true } } });
        else if (!frame.method && pending.has(frame.id)) {
          const request = pending.get(frame.id)!; pending.delete(frame.id);
          if (frame.error) request.reject(Error(JSON.stringify(frame.error))); else request.resolve(frame.result);
        }
      } catch (e) { fail(e as Error); }
    }
  });
  child.once('error', fail);
  const closed = new Promise<{ code: number | null; signal: string | null }>(resolve => child.once('close', (code, signal) => {
    ended = true; fail(Error(`MCP closed ${code}/${signal}: ${diagnostic}`)); resolve({ code, signal });
  }));
  const request = async (method: string, params: unknown) => {
    if (ended) throw Error(`MCP already closed: ${diagnostic}`);
    const id = ++nextId;
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await new Promise<any>((resolve, reject) => {
        timer = setTimeout(() => { pending.delete(id); reject(Error(`MCP ${method} timed out: ${diagnostic}`)); }, 45_000);
        pending.set(id, { resolve, reject }); send({ jsonrpc: '2.0', id, method, params });
      });
    } finally { clearTimeout(timer!); }
  };
  const close = async () => {
    child.stdin.end();
    const killer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    try { expect(await closed, diagnostic).toEqual({ code: 0, signal: null }); } finally { clearTimeout(killer); }
  };
  try {
    await request('initialize', { protocolVersion: '2024-11-05', capabilities: { roots: {}, elicitation: { form: {} } }, clientInfo: { name: 'historical-manager-test', version: '1' } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const tools = await request('tools/list', {});
    expect(tools.tools.map((t: { name: string }) => t.name).sort()).toEqual(['fabric_exec', 'fabric_info', 'fabric_workspace']);
  } catch (e) { child.kill('SIGKILL'); await closed; throw e; }
  return {
    child, close,
    async exec(code: string) {
      const result = await request('tools/call', { name: 'fabric_exec', arguments: { code, resultFormat: 'json' } });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      return JSON.parse(result.content[0].text);
    },
  };
}
const readProbe = 'return await local.read({path:"probe.txt",limit:1});';

async function assertSnapshot(f: Fixture, generation: string, profile: Buffer, owner?: Buffer) {
  const dir = path.join(f.paths.base, 'profile-snapshots');
  const names = (await fs.readdir(dir)).filter(name => name.startsWith(generation + '.'));
  expect(names).toHaveLength(1);
  const raw = await fs.readFile(path.join(dir, names[0]!));
  expect(names[0]).toBe(`${generation}.${sha256(raw)}.json`);
  const snapshot = JSON.parse(raw.toString());
  expect(Buffer.from(snapshot.profileBase64, 'base64')).toEqual(profile);
  if (owner) expect(Buffer.from(snapshot.ownerBase64, 'base64')).toEqual(owner);
}

test('real pinned installed manager rejects schema 2 without changing controls; public update is not source migration', async () => {
  const f = await installedFixture();
  try {
    expect(f.run(['doctor', '--json']).outcome).toBe('healthy');
    const controls = await f.controls();
    const publicUpdate = f.run(['update', '--yes', '--non-interactive', '--json'], 4);
    expect(publicUpdate.error).toMatch(/Source installation.*trusted checkout/s);
    // Execute the INSTALLED old compiled module with its OWN private Node. This
    // trusted source-admission API is not a public unsigned-archive CLI bypass.
    const installedModule = pathToFileURL(path.join(f.oldRoot, 'manager/install-manager.mjs')).href;
    const code = `import {runManager} from ${JSON.stringify(installedModule)}; process.exitCode=await runManager(['update','--yes','--non-interactive','--no-shell-integration','--json'],{sourceBundle:${JSON.stringify(newBundle)}});`;
    const rejected = JSON.parse(checked(path.join(f.oldRoot, 'tools/node'), ['--input-type=module', '-e', code], f.cwd, f.env, 5).stdout);
    expect(rejected).toMatchObject({ error: 'Manifest identity', committed: false, dataPreserved: true, recoveryRequired: false });
    // Preflight backup is allowed: rejection means no activation, not zero writes.
    expect((await fs.stat(rejected.configurationBackup.path)).isDirectory()).toBe(true);
    expect(await f.controls()).toEqual(controls);
    expect(await fs.readdir(f.paths.runtime)).toEqual([oldDigest]);
    expect(await fs.readdir(path.join(f.paths.base, '.transactions'))).toEqual([]);
    await f.immutableOld();
  } finally { await fs.rm(f.dir, { recursive: true, force: true }); }
}, 120_000);

test('trusted-new-source handoff, concurrent schema 1/2 backends and rollback preserve original profiles and new settings', async () => {
  const f = await installedFixture();
  const clients: Awaited<ReturnType<typeof backend>>[] = [];
  try {
    const old = await backend(f, f.oldProfile); clients.push(old);
    expect(JSON.stringify(await old.exec(readProbe))).toContain('historical-manager-sentinel');
    const upgraded = f.source(newManager, newBundle);
    expect(upgraded).toMatchObject({ outcome: 'activated', digest: newDigest, owner: { currentRuntime: newDigest, previousRuntime: oldDigest } });
    expect((await inspectCompleteInstallation(f.kiroHome)).generations.map((g: any) => g.manifest.schema).sort()).toEqual([1, 2]);
    await assertSnapshot(f, oldDigest, f.oldProfile, f.oldOwner);
    const newProfile = await fs.readFile(f.paths.profile);
    const newer = await backend(f, newProfile); clients.push(newer);
    expect(newer.child.pid).not.toBe(old.child.pid);
    const concurrent = await Promise.all([old.exec(readProbe), newer.exec('return {map:await repo.focus({query:"historicalMigrationProbe",maxTokens:256}),settings:await repo.settings()};')]);
    expect(JSON.stringify(concurrent[0])).toContain('historical-manager-sentinel');
    expect(concurrent[1].map).toMatchObject({ status: 'ok', advisory: true });
    expect(concurrent[1].map.reads).toContainEqual(expect.objectContaining({ path: 'analysis.ts', expectedSha256: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    const configured = await newer.exec('const s=await repo.settings(); s.config.tools.defaultBudget=768; return await repo.configure({scope:"global",expectedRevision:s.revisions.global,config:s.config});');
    expect(JSON.stringify(configured)).toContain('768');
    const configFile = path.join(f.paths.data, 'fabric/config/fovea.v1.json');
    const config = await fs.readFile(configFile);
    expect(JSON.parse(config.toString())).toMatchObject({ schemaVersion: 1, tools: { defaultBudget: 768 } });
    expect((await fs.stat(configFile)).mode & 0o777).toBe(0o600);
    const beforeOldDoctor = await f.controls();
    expect(f.run(['doctor', '--json'], 5, oldDigest).checks.find((c: any) => c.id === 'installation')).toMatchObject({ status: 'FAIL', detail: 'Manifest identity' });
    expect(await f.controls()).toEqual(beforeOldDoctor);
    const rolled = f.run(['rollback', '--yes', '--non-interactive', '--json']);
    expect(rolled).toMatchObject({ outcome: 'activated', digest: oldDigest, owner: { currentRuntime: oldDigest, previousRuntime: newDigest } });
    expect(await fs.readFile(f.paths.profile)).toEqual(f.oldProfile);
    await assertSnapshot(f, newDigest, newProfile);
    expect(await fs.readFile(configFile)).toEqual(config);
    await f.immutableOld();
    // Old manager cannot inspect the retained schema-2 bundle even after rollback;
    // keeping new data/generation is mandatory, not a reason to delete either.
    const oldDoctor = f.run(['doctor', '--json'], 5);
    expect(oldDoctor.checks.find((c: any) => c.id === 'installation')).toMatchObject({ status: 'FAIL', detail: 'Manifest identity' });
    const freshOld = await backend(f, f.oldProfile); clients.push(freshOld);
    const afterRollback = await Promise.all([old.exec(readProbe), freshOld.exec(readProbe), newer.exec('return await repo.settings();')]);
    expect(JSON.stringify(afterRollback.slice(0, 2))).toContain('historical-manager-sentinel');
    expect(afterRollback[2]).toMatchObject({ scope: 'global', config: { tools: { defaultBudget: 768 } } });
    expect(f.source(newManager, newBundle).digest).toBe(newDigest);
    expect(await fs.readFile(f.paths.profile)).toEqual(newProfile);
    expect(await fs.readFile(configFile)).toEqual(config);
    await assertSnapshot(f, oldDigest, f.oldProfile, f.oldOwner);
    await f.immutableOld();
  } finally {
    await Promise.all(clients.map(client => client.close()));
    await fs.rm(f.dir, { recursive: true, force: true });
  }
}, 180_000);

test.each(['profile-published', 'owner-committed'])('SIGKILL during cross-schema activation at %s retains evidence until trusted-new-source recovery', async phase => {
  const f = await installedFixture();
  try {
    const controlModule = pathToFileURL(path.join(repository, 'scripts/managed-installation.mjs')).href;
    const smokeModule = pathToFileURL(path.join(repository, 'scripts/installer-smoke.mjs')).href;
    const code = `import {installCompleteGeneration} from ${JSON.stringify(controlModule)}; import {smokeCandidate} from ${JSON.stringify(smokeModule)};
      await installCompleteGeneration(${JSON.stringify(newBundle)},{kiroHome:${JSON.stringify(f.kiroHome)},provenance:'source',validateCandidate:smokeCandidate,onPhase(name){if(name===${JSON.stringify(phase)})process.kill(process.pid,'SIGKILL');}});`;
    checked(path.join(oldBundle, 'tools/node'), ['--input-type=module', '-e', code], f.cwd, f.env, 'SIGKILL');
    const journal = path.join(f.paths.base, '.transactions/active.json'), candidate = path.join(f.paths.base, '.transactions/candidate.json');
    const evidence = await Promise.all([journal, candidate].map(file => fs.readFile(file)));
    expect(JSON.parse(evidence[1]!.toString()).manifest.schema).toBe(2);
    const transaction = JSON.parse(evidence[0]!.toString());
    expect(Buffer.from(transaction.controls.profile.before, 'base64')).toEqual(f.oldProfile);
    expect(Buffer.from(transaction.controls.manifest.before, 'base64')).toEqual(f.oldOwner);
    const controls = await f.controls();
    expect(f.run(['doctor', '--json'], 7, oldDigest).outcome).toBe('recovery-required');
    const refusal = f.run(['recover', '--yes', '--json'], 5, oldDigest);
    expect(refusal).toMatchObject({ error: 'Manifest identity', committed: false, dataPreserved: true });
    expect(await Promise.all([journal, candidate].map(file => fs.readFile(file)))).toEqual(evidence);
    expect(await f.controls()).toEqual(controls);
    const recovered = f.source(newManager, undefined, 'recover');
    const committed = phase === 'owner-committed';
    expect(recovered).toMatchObject({ outcome: 'recovered', committed, digest: committed ? newDigest : oldDigest, dataPreserved: true, recovery: { transaction: { recovered: true, committed }, candidate: { recovered: true } } });
    expect(await fs.readdir(path.dirname(journal))).toEqual([]);
    expect(f.source(newManager, undefined, 'recover')).toMatchObject({ outcome: 'noop', committed: false });
    const side = committed ? 'after' : 'before';
    expect(await f.controls()).toEqual(['manifest', 'profile', 'launcher'].map(name => Buffer.from(transaction.controls[name][side], 'base64')));
    expect((await fs.readdir(f.paths.runtime)).sort()).toEqual((committed ? [oldDigest, newDigest] : [oldDigest]).sort());
    await assertSnapshot(f, oldDigest, f.oldProfile, f.oldOwner);
    await f.immutableOld();
    expect((await inspectCompleteInstallation(f.kiroHome)).status).toBe('active');
  } finally { await fs.rm(f.dir, { recursive: true, force: true }); }
}, 120_000);
