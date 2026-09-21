#!/usr/bin/env node
// Development-only paired cold diagnostics. No patched oracle, cached facts or
// output normalization beyond the existing isolated-root relocation contract.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createScope, runBounded } from './fovea-capability-probe.mjs';
import { referencePrerequisites } from './qualify-fovea-references.mjs';
import { archivePinnedReference, inventory, compareOutputs, normalizeOutput, PINNED, REFERENCE_CLOCK_MS, NUMERICAL_TOLERANCE } from './fovea-reference-harness.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = value => createHash('sha256').update(value).digest('hex');
/** Reconstruct the EXACT identity preimage, not a replacement graph identity.
 * @param {any} state */
export function identityPreimages(state) {
  const graph = state.graph;
  const nodes = graph.nodes.map(n => JSON.stringify([n.id, n.kind, n.file, n.line, n.lang, n.sig]) + '\0').join('');
  const edges = graph.edges.map(e => JSON.stringify([e.a, e.b, e.kind, e.w, e.evidence]) + '\n').join('');
  const generation = createHash('sha1').update(nodes).update(edges).digest('hex').slice(0, 12);
  const version = createHash('sha1').update(Object.entries(state.facts).map(([file, value]) => `${file}:${/** @type {any} */(value).sha1}`).sort().join('\n'))
    .update('\0').update(state.files.join('\n')).update('\0').update(state.rulesSha).update('\0').update(generation)
    .update('\0').update(JSON.stringify(state.extraction)).update('\0').update(JSON.stringify(state.discovery)).digest('hex').slice(0, 12);
  return { generation, version, verified: state.generation === generation && state.version === version, nodePreimageSha256: sha(nodes), edgePreimageSha256: sha(edges) };
}
/** Pure causal diagnostics. Sorting here compares MULTISETS ONLY; it never
 * changes either output or the strict parity verdict.
 * @param {any} expected @param {any} actual */
export function diagnoseReferencePair(expected, actual) {
  const left = identityPreimages(expected.state), right = identityPreimages(actual.state);
  const differences = compareOutputs(expected.outputs, actual.outputs);
  const multiset = entries => entries.map(entry => JSON.stringify(entry)).sort();
  const nodes = state => state.graph.nodes.map(n => [n.id, n.kind, n.file, n.line, n.lang, n.sig]);
  // Graph edges are index-addressed: compare semantic endpoints for diagnosis,
  // while retaining the original numeric endpoints in the identity preimage.
  const edges = state => state.graph.edges.map(e => [state.graph.nodes[e.a]?.id, state.graph.nodes[e.b]?.id, e.kind, e.w, e.evidence]);
  return { qualified: differences.length === 0 && left.verified && right.verified,
    differences, identities: { reference: left, native: right },
    graphNodeMultisetEqual: JSON.stringify(multiset(nodes(expected.state))) === JSON.stringify(multiset(nodes(actual.state))),
    graphEdgeMultisetEqual: JSON.stringify(multiset(edges(expected.state))) === JSON.stringify(multiset(edges(actual.state))),
    orderedNodeDifferences: compareOutputs(nodes(expected.state), nodes(actual.state)),
    orderedEdgeDifferences: compareOutputs(expected.state.graph.edges, actual.state.graph.edges),
    factDifferences: compareOutputs(expected.state.facts, actual.state.facts),
    nonGenerationVersionDifferences: differences.filter(key => !/^\$\.(sketch|focus|dwell|impact)\.details\.(generation|version)$/.test(key)),
    note: 'All differences, including generation/version, remain binding. Multiset equality is diagnosis, never parity.' };
}
/** @param {any} value */
export function assertNonemptyReference(value) {
  if (!value?.state?.graph?.nodes?.length || !Object.keys(value.state.facts ?? {}).length ||
      !value.outputs?.focus?.details?.nodes?.length || !value.state.files?.length ||
      !identityPreimages(value.state).verified) throw Error('Empty discovery or invalid graph identity; no reference qualification');
}
export async function runReferenceDiagnostics() {
  const pins = referencePrerequisites();
  const results = [];
  for (const budget of [512, 16000]) {
    const scope = createScope();
    const source = await archivePinnedReference(scope, pins.reference, PINNED.upstreamCommit, 'pi-fovea');
    await archivePinnedReference(scope, pins.hostReference, PINNED.referenceHostCommit, 'pi-fabric');
    fs.cpSync(path.join(source, 'tests/fixtures/mini'), scope.workspace, { recursive: true, dereference: false });
    const sourceBefore = inventory(path.join(source, 'src')), fixtureBefore = inventory(scope.workspace);
    const values = {};
    for (const label of ['reference', 'reference-repeat', 'native', 'native-repeat']) {
      const native = label.startsWith('native'), storage = path.join(scope.root, 'tmp');
      fs.rmSync(storage, { recursive: true }); fs.mkdirSync(storage, { mode: 0o700 });
      const core = native ? path.join(repo, 'src/fovea/core') : path.join(source, 'src/core');
      const driver = path.join(scope.root, label + '.ts');
      fs.writeFileSync(driver, [
        `Date.now=()=>${REFERENCE_CLOCK_MS};`,
        `const {sketch,focus,dwell,impact}=await import(${JSON.stringify(path.join(core, 'ops.ts'))});`,
        `const {getState}=await import(${JSON.stringify(path.join(core, 'state.ts'))});`,
        `const {LANG_BY_EXT}=await import(${JSON.stringify(path.join(core, 'astgrep.ts'))});`,
        `const root=${JSON.stringify(scope.workspace)}, budget=${budget};`,
        'async function run(){const outputs={languages:LANG_BY_EXT,sketch:await sketch(root,budget),focus:await focus(root,"GetUser",budget),dwell:await dwell(root,2,budget),impact:await impact(root,{symbols:["GetUser"],budget,includeUncommitted:false})};const s=getState(root);return {outputs,state:{generation:s.generation,version:s.version,graph:s.graph,facts:s.facts,files:s.files,rulesSha:s.store.rulesSha,extraction:s.extraction,discovery:s.discovery}};}',
        ...(native ? [`const {coreContext}=await import(${JSON.stringify(path.join(core, 'context.ts'))});`,
          `const ctx={store:new Map(),sessionStore:new Map(),parserPath:${JSON.stringify(pins.parser)},storageRoot:${JSON.stringify(storage)},signal:new AbortController().signal,gitPath:'/usr/bin/git',sourceRoot:root,snapshotRoot:root,gitFailures:[],focusKey:'reference',spills:new Map()};`,
          'process.stdout.write(JSON.stringify(await coreContext.run(ctx,run)));'] : ['process.stdout.write(JSON.stringify(await run()));']),
      ].join('\n'), { flag: 'wx', mode: 0o600 });
      const r = await runBounded('bun', [driver], { cwd: source, env: { ...scope.env, FOVEA_AST_GREP: pins.parser, PI_CODING_AGENT_DIR: path.join(scope.home, 'agent') }, timeoutMs: 60000, maxBytes: 16777216 });
      if (r.error || r.exitCode !== 0 || r.stopReason) throw Error(`Paired ${label} failed; preserve ${scope.root}: ${r.error ?? r.exitCode}`);
      values[label] = JSON.parse(r.stdout);
      fs.writeFileSync(path.join(scope.root, label + '-raw.json'), r.stdout, { flag: 'wx', mode: 0o600 });
      assertNonemptyReference(values[label]);
      if (JSON.stringify(sourceBefore) !== JSON.stringify(inventory(path.join(source, 'src'))) || JSON.stringify(fixtureBefore) !== JSON.stringify(inventory(scope.workspace))) throw Error('Reference source/fixture changed');
    }
    const referenceReport = { schemaVersion: 2, referenceCommit: PINNED.upstreamCommit, hostReferenceCommit: PINNED.referenceHostCommit,
      referenceStatus: 'executed', hostReferenceStatus: 'archived-not-executed', parserVersion: 'ast-grep 0.45.3', tolerance: NUMERICAL_TOLERANCE,
      parameters: { budget, clock: REFERENCE_CLOCK_MS }, fixtureInventory: inventory(path.join(source, 'tests')), outputs: normalizeOutput(values.reference.outputs, scope.root) };
    fs.writeFileSync(path.join(scope.root, 'reference-report.json'), JSON.stringify(referenceReport), { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(path.join(scope.root, 'native-output.json'), JSON.stringify(normalizeOutput(values.native.outputs, scope.root)), { flag: 'wx', mode: 0o600 });
    const report = { budget, scope: scope.root, pins, inputInventory: fixtureBefore, sourceInventory: sourceBefore,
      comparison: diagnoseReferencePair(values.reference, values.native),
      referenceRepeat: diagnoseReferencePair(values.reference, values['reference-repeat']),
      nativeRepeat: diagnoseReferencePair(values.native, values['native-repeat']),
      sourceUnchanged: true, fixtureUnchanged: true, rawHashes: Object.fromEntries(Object.keys(values).map(label => [label, sha(fs.readFileSync(path.join(scope.root, label + '-raw.json')))])) };
    fs.writeFileSync(path.join(scope.root, 'diagnosis.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    results.push({ budget, report: path.join(scope.root, 'diagnosis.json'), comparison: report.comparison.differences.length,
      referenceRepeat: report.referenceRepeat.differences.length, nativeRepeat: report.nativeRepeat.differences.length,
      identityVerified: Object.values(values).every(v => identityPreimages(v.state).verified) });
  }
  return results;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw Error('No arguments; requires exact FOVEA_REFERENCE_ROOT/FOVEA_HOST_REFERENCE_ROOT/FOVEA_REFERENCE_PARSER');
  const results = await runReferenceDiagnostics(); console.log(JSON.stringify(results, null, 2));
  process.exitCode = results.every(r => r.comparison === 0 && r.referenceRepeat === 0 && r.nativeRepeat === 0) ? 0 : 1;
}
