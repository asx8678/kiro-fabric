import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { extractBundleArchiveBytes } from '../scripts/bundle-archive.mjs';
import { canonical, createBundleManifest, validateBundle } from '../scripts/bundle-contract.mjs';
import { installCompleteGeneration, completeGenerationLauncher } from '../scripts/managed-installation.mjs';
import { smokeCandidate } from '../scripts/installer-smoke.mjs';

type Backend = { command: string; args: string[]; env: Record<string, string> };

// Raw MCP transport deliberately launches the installed profile, not source or a test backend.
async function checkedReadGrep(backend: Backend, cwd: string, env: Record<string, string>) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(backend.command, backend.args, { cwd, env: { ...env, ...backend.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', stderr = '', passed = false, failure: Error | undefined;
    const fail = (error: Error) => { failure ??= error; child.kill('SIGTERM'); };
    const timeout = setTimeout(() => fail(new Error('Installed MCP timed out')), 40_000);
    const killer = setTimeout(() => child.kill('SIGKILL'), 43_000);
    const send = (frame: unknown) => { if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(frame) + '\n'); };
    child.stdin.on('error', fail);
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-6000); });
    child.stdout.setEncoding('utf8').on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) return fail(new Error('MCP output bound exceeded'));
      while (buffer.includes('\n')) {
        const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        try {
          const frame = JSON.parse(line);
          if (frame.method === 'roots/list') send({ jsonrpc: '2.0', id: frame.id, result: { roots: [{ uri: pathToFileURL(cwd).href, name: 'independence' }] } });
          else if (frame.method === 'elicitation/create') send({ jsonrpc: '2.0', id: frame.id, result: { action: 'decline' } });
          else if (frame.id === 1 && !frame.method) {
            expect(frame.error).toBeUndefined();
            send({ jsonrpc: '2.0', method: 'notifications/initialized' });
            send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
          } else if (frame.id === 2 && !frame.method) {
            expect(frame.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual(['fabric_exec', 'fabric_info', 'fabric_workspace']);
            send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fabric_exec', arguments: { code: 'return {read: await local.read({path:"probe.txt",limit:1}), grep: await local.grep({pattern:"independence-sentinel",path:"."})};' } } });
          } else if (frame.id === 3 && !frame.method) {
            expect(frame.error).toBeUndefined();
            expect(frame.result.isError, JSON.stringify(frame.result)).not.toBe(true);
            const result = JSON.stringify(frame.result);
            expect(result).toContain('read'); expect(result).toContain('grep');
            expect(result.match(/independence-sentinel/g)?.length).toBeGreaterThanOrEqual(2);
            passed = true; child.stdin.end();
          }
        } catch (error) { fail(error as Error); }
      }
    });
    child.once('error', error => { clearTimeout(timeout); clearTimeout(killer); reject(error); });
    child.once('close', code => {
      clearTimeout(timeout); clearTimeout(killer);
      if (failure || !passed || code !== 0) reject(failure ?? new Error(`Installed MCP exit ${code}: ${stderr}`));
      else resolve();
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: { roots: {}, elicitation: { form: {} } }, clientInfo: { name: 'installed-independence-test', version: '1' } } });
  });
}

// Requires a real native complete bundle staged by Main/test:built. Missing staging is
// a failure, never a synthetic binary fallback or native-qualification claim.
test('real installed bundle survives disposable acquisition removal (fake Kiro contract only)', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'installed-independence-'));
  await fs.chmod(root, 0o700);
  try {
    const home = path.join(root, 'home ü % #'), kiroHome = path.join(home, '.kiro');
    const cwd = path.join(root, 'unrelated project'), bin = path.join(root, 'minimal-bin'), temporary = path.join(root, 'tmp');
    for (const dir of [home, cwd, bin, temporary]) await fs.mkdir(dir, { mode: 0o700 });
    // Capture archive bytes exactly once. Subsequent Main rebuilds cannot change this fixture.
    const staged = JSON.parse(await fs.readFile(new URL('../.tmp/complete-bundle.json', import.meta.url), 'utf8'));
    const captured = await fs.readFile(staged.archive);
    const archive = path.join(root, 'disposable.tar.gz'), bundleRoot = path.join(root, 'disposable-stage');
    await fs.writeFile(archive, captured, { mode: 0o600 });
    const bundle = await extractBundleArchiveBytes(captured, bundleRoot);
    expect(bundle.digest).toBe(staged.digest);
    expect(bundle.manifest.target).toBe(`${process.platform}-${process.arch}`);
    const fake = path.join(bin, 'kiro-cli');
    await fs.writeFile(fake, '#!/bin/sh\ncase "$*" in\n  --version) printf "kiro-cli 2.21.1\\n" ;;\n  "agent validate --help") printf "%s\\n" "--path" ;;\n  "--v3 --agent kiro-fabric") printf "%s\\n" "$PWD" "$HOME" "$KIRO_HOME" "$@" > "$FAKE_KIRO_CAPTURE" ;;\n  *) exit 91 ;;\nesac\n', { mode: 0o700 });
    const env = { HOME: home, KIRO_HOME: kiroHome, TMPDIR: temporary, PATH: bin, LANG: 'C', LC_ALL: 'C', FAKE_KIRO_CAPTURE: path.join(root, 'client-contract') };
    expect(await fs.readdir(bin)).toEqual(['kiro-cli']);
    expect(Object.hasOwn(env, 'NODE_PATH')).toBe(false);
    const opts = { kiroHome, userHome: home, env: {}, provenance: 'source', validateCandidate: smokeCandidate };
    const installed = await installCompleteGeneration(bundleRoot, opts);
    const generation = path.join(installed.paths.runtime, installed.digest);
    const profileBytes = await fs.readFile(installed.paths.profile);
    const profile = JSON.parse(profileBytes.toString());
    expect(profile.tools).toEqual(['@fabric/fabric_exec']);
    expect(profile.allowedTools).toEqual(['@fabric/fabric_exec']);
    expect(profile.resources).toEqual([`skill://${generation}/resources/skills/fabric-exec/SKILL.md`, `file://${generation}/resources/steering/fabric.md`]);
    expect(profile.mcpServers.fabric.command).toBe(path.join(generation, 'tools/node'));
    expect(profile.mcpServers.fabric.args).toEqual([path.join(generation, 'app/kiro/mcp-entry.js')]);
    expect(profile.mcpServers.fabric.env).toEqual({ KIRO_FABRIC_RUNTIME_ROOT: path.join(generation, 'app'), KIRO_FABRIC_DATA_ROOT: installed.paths.data, KIRO_FABRIC_EXPECTED_NODE: path.join(generation, 'tools/node'), KIRO_FABRIC_BUNDLE_ROOT: generation, KIRO_FABRIC_RG: path.join(generation, 'tools/rg') });
    expect(await fs.readFile(installed.paths.launcher)).toEqual(completeGenerationLauncher(installed.digest));
    for (const executable of [installed.paths.launcher, profile.mcpServers.fabric.command, path.join(generation, 'tools/rg')]) expect((await fs.stat(executable)).mode & 0o777).toBe(0o700);
    const controls = async () => Promise.all([installed.paths.manifest, installed.paths.profile, installed.paths.launcher].map(file => fs.readFile(file)));
    const beforeNoop = await controls();
    expect((await installCompleteGeneration(bundleRoot, opts)).noop).toBe(true);
    expect(await controls()).toEqual(beforeNoop);
    // Exercise the real source frontend's presentation on a verified same-bundle no-op.
    // This trusted developer API call occurs before the acquisition fixtures are removed.
    const managerModule = new URL('../scripts/install-manager.mjs', import.meta.url).href;
    const noOp = spawnSync(process.execPath, ['--input-type=module', '-e', `import { runManager } from ${JSON.stringify(managerModule)}; process.exitCode = await runManager(['install','--kiro-home',process.argv[1],'--yes','--non-interactive','--json'], {context:{kind:'bootstrap'},sourceBundle:process.argv[2]});`, kiroHome, bundleRoot], { cwd, env, encoding: 'utf8', timeout: 90_000, maxBuffer: 1024 * 1024 });
    expect(noOp.status, noOp.stdout + noOp.stderr).toBe(0);
    expect(JSON.parse(noOp.stdout)).toMatchObject({ committed: false, outcome: 'noop', restartRequired: false });
    // A genuine second full source generation; no production unsigned-archive CLI bypass.
    await fs.appendFile(path.join(bundleRoot, 'resources/steering/fabric.md'), '\n<!-- independence revision -->\n');
    const next = await createBundleManifest(bundleRoot, bundle.manifest);
    await fs.writeFile(path.join(bundleRoot, 'bundle-manifest.json'), canonical(next) + '\n');
    await installCompleteGeneration(bundleRoot, opts);
    await fs.rm(bundleRoot, { recursive: true }); await fs.unlink(archive);
    await expect(fs.stat(bundleRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(archive)).rejects.toMatchObject({ code: 'ENOENT' });
    const run = (args: string[], expected: number | 'failure' = 0) => {
      const result = spawnSync(installed.paths.launcher, args, { cwd, env, encoding: 'utf8', timeout: 90_000, maxBuffer: 1024 * 1024 });
      expect(result.error).toBeUndefined();
      if (expected === 'failure') expect(result.status, result.stdout + result.stderr).toBeGreaterThan(0);
      else expect(result.status, result.stdout + result.stderr).toBe(expected);
      return result.stdout;
    };
    const beforeDoctor = await controls();
    const doctor = JSON.parse(run(['doctor', '--json']));
    expect(doctor.outcome).toBe('healthy');
    expect(doctor.checks.filter((check: { id: string }) => ['private-node', 'private-rg'].includes(check.id)).map((check: { status: string }) => check.status)).toEqual(['PASS', 'PASS']);
    expect(await controls()).toEqual(beforeDoctor);
    run(['start']);
    expect((await fs.readFile(env.FAKE_KIRO_CAPTURE, 'utf8')).trimEnd().split('\n')).toEqual([cwd, home, kiroHome, '--v3', '--agent', 'kiro-fabric']);
    const update = JSON.parse(run(['update', '--yes', '--non-interactive', '--json'], 8));
    expect(update.error).toMatch(/production.*trust root|trust root.*production/i);
    expect(await controls()).toEqual(beforeDoctor);
    run(['update', '--source', '--yes', '--json'], 2);
    const data = path.join(installed.paths.data, 'fabric', 'independence-data');
    await fs.writeFile(data, 'preserve across rollback and retirement', { mode: 0o600 });
    await fs.writeFile(path.join(cwd, 'probe.txt'), 'independence-sentinel\n', { mode: 0o600 });
    // A cached retained-generation profile must still launch its own private tools.
    await checkedReadGrep(profile.mcpServers.fabric, cwd, env);
    const rollback = JSON.parse(run(['rollback', '--yes', '--non-interactive', '--json']));
    expect(rollback.digest).toBe(installed.digest);
    expect(await fs.readFile(installed.paths.profile)).toEqual(profileBytes);
    await checkedReadGrep(profile.mcpServers.fabric, cwd, env);
    expect((await validateBundle(path.join(installed.paths.runtime, next.digest))).digest).toBe(next.digest);
    const rg = path.join(generation, 'tools/rg'), originalRg = await fs.readFile(rg), marker = path.join(root, 'corrupt-executed');
    await fs.writeFile(rg, `#!/bin/sh\nprintf executed > '${marker}'\n`);
    try { run(['doctor', '--json'], 5); await expect(fs.stat(marker)).rejects.toMatchObject({ code: 'ENOENT' }); }
    finally { await fs.writeFile(rg, originalRg); }
    expect(JSON.parse(run(['uninstall', '--yes', '--non-interactive', '--json'])).status).toBe('retired');
    await expect(fs.stat(installed.paths.profile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(run(['doctor', '--json'])).outcome).toBe('retired');
    run(['start'], 4);
    expect(JSON.parse(run(['uninstall', '--yes', '--non-interactive', '--json'])).noop).toBe(true);
    expect(await fs.readFile(data, 'utf8')).toBe('preserve across rollback and retirement');
    console.info(`Installed independence PASS: ${bundle.manifest.target} ${bundle.digest}; fake Kiro contract only; authenticated/native release qualification BLOCKED`);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}, 240_000);
