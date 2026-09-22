#!/usr/bin/env node
// Clean release build only: no tracked dist/guidance writes, installs or signing.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildCompleteBundle } from './build-complete-bundle.mjs';
import { assertCleanReleaseCheckout, assertCandidateSource } from './prepare-complete-release.mjs';
import { captureBuildInputs, assertBuildInputs } from './build-inputs.mjs';
import { cacheDirectory } from './installer-artifacts.mjs';
import { validateBundle } from './bundle-contract.mjs';

export async function buildCompleteCandidate(commit, root = process.cwd()) {
  root = fs.realpathSync(root);
  assertCleanReleaseCheckout(root, commit); // before ANY output mutation
  const inputs = captureBuildInputs(root);
  const parent = cacheDirectory(root, true);
  const generation = fs.mkdtempSync(path.join(parent, 'candidate-build-'));
  const closure = path.join(generation, 'closure');
  // Fresh output, retained on success/failure. Native outputs follow this exact
  // directory; Linux never removes the checked-in Darwin native artifacts.
  execFileSync(process.execPath, [path.join(root, 'scripts/build-kiro-closure.mjs'), '--outdir', closure], { cwd: root, stdio: 'inherit' });
  assertBuildInputs(root, inputs);
  assertCleanReleaseCheckout(root, commit);
  const result = await buildCompleteBundle({ root, closure, archive: false });
  assertBuildInputs(root, inputs);
  assertCleanReleaseCheckout(root, commit);
  assertCandidateSource(await validateBundle(result.root), commit, inputs.digest);
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [commit, extra] = process.argv.slice(2);
  if (!commit || extra) throw Error('Usage: build-complete-candidate.mjs COMMIT');
  console.log(JSON.stringify(await buildCompleteCandidate(commit)));
}
