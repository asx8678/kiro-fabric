import { removeFixtureSync } from "../../fixture-cleanup.mjs";
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { sharedEsbuildOptions } from '../../../scripts/esbuild-common.mjs';
import { compileSourceBinding } from '../../../scripts/build-fovea-native.mjs';
import { createNativeSourcePlatform, type PosixProvenanceBinding } from '../../../src/fovea/source-platform-native.js';

/** Test-only binding admission for source lifecycle comparisons. Keep the real
 * engine entrypoint, child process, IPC, parser, native I/O and host behavior.
 * Only generation admission is substituted; this is not an installed-generation
 * or native Kiro UI qualification. No runtime override or dist build is added. */
export async function createNativeLifecyclePlatform() {
  if (process.platform !== 'darwin') throw new Error('Darwin lifecycle fixture only');
  fs.mkdirSync('.tmp', { recursive: true });
  const directory = fs.realpathSync(fs.mkdtempSync(path.resolve('.tmp/fovea-lifecycle-native-')));
  fs.chmodSync(directory, 0o700);
  const close = () => removeFixtureSync(directory, { recursive: true, force: true });
  try {
    const binary = path.join(directory, 'source-platform.node'), entrypoint = path.join(directory, 'engine-entry.mjs');
    compileSourceBinding(process.cwd(), binary);
    const binding = createRequire(import.meta.url)(binary) as PosixProvenanceBinding;
    if (binding.provenanceAbiVersion !== 1) throw new Error('Lifecycle fixture requires provenance ABI 1');
    const platform = createNativeSourcePlatform(binding);
    let substitutions = 0;
    await build({
      ...sharedEsbuildOptions, splitting: false, packages: 'external',
      entryPoints: [path.resolve('src/fovea/engine-entry.ts')], outfile: entrypoint,
      plugins: [{ name: 'test-only-native-admission', setup(builder) {
        builder.onResolve({ filter: /^\.\/native-source-loader\.js$/ }, args => {
          if (args.importer !== path.resolve('src/fovea/engine.ts')) throw new Error('Unexpected native loader fixture importer');
          substitutions++;
          return { path: 'fixture-native-loader', namespace: 'lifecycle-fixture' };
        });
        builder.onLoad({ filter: /.*/, namespace: 'lifecycle-fixture' }, () => ({
          loader: 'ts', resolveDir: process.cwd(), contents: [
            `import { createRequire } from 'node:module';`,
            `import { createNativeSourcePlatform } from ${JSON.stringify(path.resolve('src/fovea/source-platform-native.ts'))};`,
            `export async function loadManagedSourcePlatform() { return createNativeSourcePlatform(createRequire(import.meta.url)(${JSON.stringify(binary)})); }`,
          ].join('\n'),
        }));
      } }],
    });
    if (substitutions !== 1) throw new Error('Native lifecycle admission substitution drifted');
    return { platform, entrypoint, close };
  } catch (error) { close(); throw error; }
}
