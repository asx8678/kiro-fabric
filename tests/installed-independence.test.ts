import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { extractBundleArchiveBytes } from '../scripts/bundle-archive.mjs';
import { canonical, createBundleManifest, validateBundle, sha256 } from '../scripts/bundle-contract.mjs';
import { installCompleteGeneration, completeGenerationLauncher } from '../scripts/managed-installation.mjs';
import { smokeCandidate } from '../scripts/installer-smoke.mjs';

type Backend = { command: string; args: string[]; env: Record<string, string> };

// Raw MCP transport deliberately launches the installed profile, not source or a test backend.
async function checkedLocalTools(backend: Backend, cwd: string, env: Record<string, string>, { handoff, roots = 'client', sentinel = 'independence-sentinel' }: { handoff?: string; roots?: 'client' | 'empty' | 'unsupported'; sentinel?: string } = {}) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(backend.command, backend.args, { cwd, env: { ...env, ...backend.env, ...(handoff ? { KIRO_FABRIC_LAUNCH_WORKSPACE: handoff } : {}) }, stdio: ['pipe', 'pipe', 'pipe'] });
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
          if (frame.method === 'roots/list') send({ jsonrpc: '2.0', id: frame.id, result: { roots: roots === 'client' ? [{ uri: pathToFileURL(cwd).href, name: 'independence' }] : [] } });
          else if (frame.method === 'elicitation/create') send({ jsonrpc: '2.0', id: frame.id, result: { action: 'decline' } });
          else if (frame.id === 1 && !frame.method) {
            expect(frame.error).toBeUndefined();
            send({ jsonrpc: '2.0', method: 'notifications/initialized' });
            send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
          } else if (frame.id === 2 && !frame.method) {
            expect(frame.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual(['fabric_exec', 'fabric_info', 'fabric_workspace']);
            send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fabric_exec', arguments: { code: 'return {read: await local.read({path:"probe.txt",limit:1}), grep: await local.grep({pattern:payloads.sentinel,path:"."}), shell: await local.shell({command:"printf shell-enabled"})};', payloads: { sentinel } } } });
          } else if (frame.id === 3 && !frame.method) {
            expect(frame.error).toBeUndefined();
            expect(frame.result.isError, JSON.stringify(frame.result)).not.toBe(true);
            const result = JSON.stringify(frame.result);
            expect(result).toContain('read'); expect(result).toContain('grep');
            expect(result).toContain('shell-enabled');
            expect(result.split(sentinel).length - 1).toBeGreaterThanOrEqual(2);
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
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: { ...(roots === 'unsupported' ? {} : { roots: {} }), elicitation: { form: {} } }, clientInfo: { name: 'installed-independence-test', version: '1' } } });
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
    await fs.writeFile(fake, '#!/bin/sh\ncase "$*" in\n  --version) printf "kiro-cli 2.21.1\\n" ;;\n  "agent validate --help") printf "%s\\n" "--path" ;;\n  "--v3 --agent kiro-fabric"|"--agent kiro-fabric --v3") printf "%s\\n" "$PWD" "$HOME" "$KIRO_HOME" "$@" > "$FAKE_KIRO_CAPTURE"; printf "%s\\n" "$KIRO_FABRIC_LAUNCH_WORKSPACE" > "$FAKE_KIRO_CAPTURE.workspace" ;;\n  *) exit 91 ;;\nesac\n', { mode: 0o700 });
    const env = { HOME: home, SHELL: '/bin/bash', KIRO_HOME: kiroHome, TMPDIR: temporary, PATH: bin, LANG: 'C', LC_ALL: 'C', FAKE_KIRO_CAPTURE: path.join(root, 'client-contract') };
    expect(await fs.readdir(bin)).toEqual(['kiro-cli']);
    expect(Object.hasOwn(env, 'NODE_PATH')).toBe(false);
    const opts = { kiroHome, userHome: home, env: {}, provenance: 'source', validateCandidate: smokeCandidate };
    // Reproduce an ordinary existing Kiro home with the older Pi Fabric profile.
    await fs.mkdir(kiroHome, { mode: 0o755 }); await fs.chmod(kiroHome, 0o755);
    await fs.mkdir(path.join(kiroHome, 'agents'), { mode: 0o755 }); await fs.chmod(path.join(kiroHome, 'agents'), 0o755);
    const oldRoot = path.join(kiroHome, '.kiro-fabric'), oldProfile = '{"name":"kiro-fabric","description":"old Pi Fabric"}\n';
    await fs.mkdir(oldRoot, { mode: 0o700 });
    await fs.writeFile(path.join(kiroHome, 'agents/kiro-fabric.json'), oldProfile, { mode: 0o600 });
    await fs.writeFile(path.join(oldRoot, 'install.json'), JSON.stringify({ format: 1, owner: 'kiro-fabric', scope: 'user', profile: { path: 'agents/kiro-fabric.json', installedSha256: sha256(oldProfile) } }), { mode: 0o600 });
    const managerModule = new URL('../scripts/install-manager.mjs', import.meta.url).href;
    const preparation = spawnSync(process.execPath, ['--input-type=module', '-e', `import {runManager} from ${JSON.stringify(managerModule)}; process.exitCode = await runManager(['install','--kiro-home',process.argv[1],'--migrate-pi-fabric','--yes','--non-interactive','--json'], {context:{kind:'bootstrap'},sourceBundle:process.argv[2]});`, kiroHome, bundleRoot], { cwd, env, encoding: 'utf8', timeout: 90_000, maxBuffer: 1024 * 1024 });
    expect(preparation.status, preparation.stdout + preparation.stderr).toBe(0);
    expect(preparation.stderr).toBe('');
    const installed = JSON.parse(preparation.stdout);
    expect(installed.outcome).toBe('activated');
    expect(installed.warnings).toContainEqual(expect.stringContaining(`Launch from your project directory with: ${installed.commands.start}`));
    expect(installed.warnings).toContainEqual(expect.stringContaining('kiro-cli --v3 --agent kiro-fabric works without shell setup'));
    expect(installed.shellIntegration).toMatchObject({ status: 'configured', file: path.join(home, '.bashrc') });
    const shell = spawnSync('/bin/bash', ['--norc', '-c', '. "$HOME/.bashrc"; kiro-cli --v3'], { cwd, env, encoding: 'utf8' });
    expect(shell.status, shell.stderr).toBe(0);
    expect((await fs.readFile(env.FAKE_KIRO_CAPTURE, 'utf8')).trimEnd().split('\n')).toEqual([cwd, home, kiroHome, '--agent', 'kiro-fabric', '--v3']);
    const shellWorkspace = (await fs.readFile(env.FAKE_KIRO_CAPTURE + '.workspace', 'utf8')).trimEnd();
    expect(shellWorkspace).toBe(cwd);
    expect(installed.homePreparation.permissions).toHaveLength(2);
    expect(await fs.readFile(installed.homePreparation.legacyProfileBackup, 'utf8')).toBe(oldProfile);
    expect((await fs.stat(kiroHome)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(path.join(kiroHome, 'agents'))).mode & 0o777).toBe(0o700);
    const generation = path.join(installed.paths.runtime, installed.digest);
    const profileBytes = await fs.readFile(installed.paths.profile);
    const profile = JSON.parse(profileBytes.toString());
    expect(profile.tools).toEqual(['@fabric/fabric_exec']);
    expect(profile.allowedTools).toEqual(['@fabric/fabric_exec']);
    expect(profile.resources).toEqual([`skill://${generation}/resources/skills/fabric-exec/SKILL.md`, `file://${generation}/resources/steering/fabric.md`]);
    expect(profile.mcpServers.fabric.command).toBe(path.join(generation, 'tools/node'));
    expect(profile.mcpServers.fabric.args).toEqual([path.join(generation, 'app/kiro/mcp-entry.js')]);
    expect(profile.mcpServers.fabric.env).toEqual({ KIRO_FABRIC_LAUNCH_WORKSPACE: '${KIRO_FABRIC_LAUNCH_WORKSPACE}', KIRO_FABRIC_RUN_DECLARATION: '${KIRO_FABRIC_RUN_DECLARATION}', KIRO_FABRIC_WORKSPACE_SOURCE: 'launch-cwd', KIRO_FABRIC_RUNTIME_ROOT: path.join(generation, 'app'), KIRO_FABRIC_DATA_ROOT: installed.paths.data, KIRO_FABRIC_EXPECTED_NODE: path.join(generation, 'tools/node'), KIRO_FABRIC_BUNDLE_ROOT: generation, KIRO_FABRIC_RG: path.join(generation, 'tools/rg') });
    expect(await fs.readFile(installed.paths.launcher)).toEqual(completeGenerationLauncher(installed.digest));
    // A fresh install must work without either a shell handoff or roots capability.
    await fs.writeFile(path.join(cwd, 'probe.txt'), 'independence-sentinel\n', { mode: 0o600 });
    await checkedLocalTools(profile.mcpServers.fabric, cwd, env, { roots: 'unsupported' });
    for (const executable of [installed.paths.launcher, profile.mcpServers.fabric.command, path.join(generation, 'tools/rg')]) expect((await fs.stat(executable)).mode & 0o777).toBe(0o700);
    const controls = async () => Promise.all([installed.paths.manifest, installed.paths.profile, installed.paths.launcher].map(file => fs.readFile(file)));
    const beforeNoop = await controls();
    expect((await installCompleteGeneration(bundleRoot, opts)).noop).toBe(true);
    expect(await controls()).toEqual(beforeNoop);
    // Exercise the real source frontend's presentation on a verified same-bundle no-op.
    // This trusted developer API call occurs before the acquisition fixtures are removed.
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
    const update = JSON.parse(run(['update', '--yes', '--non-interactive', '--json'], 4));
    expect(update.error).toMatch(/Source installation.*trusted checkout/s);
    const signedUpdate = JSON.parse(run(['update', '--version', '1.0.0', '--yes', '--non-interactive', '--json'], 8));
    expect(signedUpdate.error).toMatch(/production.*trust root|trust root.*production/i);
    expect(await controls()).toEqual(beforeDoctor);
    run(['update', '--source', '--yes', '--json'], 2);
    const data = path.join(installed.paths.data, 'fabric', 'independence-data');
    await fs.writeFile(data, 'preserve across rollback and retirement', { mode: 0o600 });
    await fs.writeFile(path.join(cwd, 'probe.txt'), 'independence-sentinel\n', { mode: 0o600 });
    // A cached retained-generation profile must still launch its own private tools.
    await checkedLocalTools(profile.mcpServers.fabric, cwd, env);
    // Explicit launcher handoff still works; direct launches need neither it nor roots.
    await checkedLocalTools(profile.mcpServers.fabric, cwd, env, { handoff: shellWorkspace, roots: 'empty' });
    const updatedProfile = JSON.parse(await fs.readFile(installed.paths.profile, 'utf8'));
    const secondProject = path.join(root, "another project ' ü");
    await fs.mkdir(secondProject, { mode: 0o700 });
    const secondSentinel = 'independence-sentinel-second-project';
    await fs.writeFile(path.join(secondProject, 'probe.txt'), secondSentinel + '\n', { mode: 0o600 });
    // Startup admission is deliberately fail-fast under the installation lock.
    // Launch separately to test per-project binding, not simultaneous admission.
    await checkedLocalTools(updatedProfile.mcpServers.fabric, cwd, env, { roots: 'empty' });
    await checkedLocalTools(updatedProfile.mcpServers.fabric, secondProject, env, { roots: 'unsupported', sentinel: secondSentinel });
    // Fixture setup leaves a real SIGKILL stale owner. Reclamation below MUST
    // run the installed bundled manager/private Node, with acquisition files gone.
    const lockModule = new URL('../scripts/installer-lock.mjs', import.meta.url).href;
    const dead = spawnSync(profile.mcpServers.fabric.command, ['--input-type=module', '-e', `import {acquireInstallationLock} from ${JSON.stringify(lockModule)}; acquireInstallationLock(process.argv[1], {onPhase(phase) {if (phase === 'owner-initialized') process.kill(process.pid, 'SIGKILL');}});`, installed.paths.base], { cwd, env, encoding: 'utf8', timeout: 10000 });
    expect(dead.error).toBeUndefined(); expect(dead.signal, dead.stderr).toBe('SIGKILL');
    expect(JSON.parse(run(['doctor', '--json'], 7)).outcome).toBe('recovery-required');
    const rollback = JSON.parse(run(['rollback', '--yes', '--non-interactive', '--json']));
    expect((await fs.readdir(installed.paths.base)).filter(name => name.startsWith('.install-lock-quarantine-'))).toHaveLength(1);
    expect(rollback.digest).toBe(installed.digest);
    expect(await fs.readFile(installed.paths.profile)).toEqual(profileBytes);
    await checkedLocalTools(profile.mcpServers.fabric, cwd, env);
    expect((await validateBundle(path.join(installed.paths.runtime, next.digest))).digest).toBe(next.digest);
    const rg = path.join(generation, 'tools/rg'), originalRg = await fs.readFile(rg), marker = path.join(root, 'corrupt-executed');
    await fs.writeFile(rg, `#!/bin/sh\nprintf executed > '${marker}'\n`);
    try { run(['doctor', '--json'], 5); await expect(fs.stat(marker)).rejects.toMatchObject({ code: 'ENOENT' }); }
    finally { await fs.writeFile(rg, originalRg); }
    const retired = JSON.parse(run(['uninstall', '--yes', '--non-interactive', '--json']));
    expect(retired.status).toBe('retired');
    expect(retired.shellIntegration.status).toBe('removed');
    await expect(fs.stat(path.join(home, '.bashrc'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(installed.paths.profile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(run(['doctor', '--json'])).outcome).toBe('retired');
    run(['start'], 4);
    expect(JSON.parse(run(['uninstall', '--yes', '--non-interactive', '--json'])).noop).toBe(true);
    expect(await fs.readFile(data, 'utf8')).toBe('preserve across rollback and retirement');
    console.info(`Installed independence PASS: ${bundle.manifest.target} ${bundle.digest}; fake Kiro contract only; authenticated/native release qualification BLOCKED`);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}, 240_000);
