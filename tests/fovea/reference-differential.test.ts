import { removeFixtureSync } from "../fixture-cleanup.mjs";
import { expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildSync } from 'esbuild';
import { createParserSchedule, createParserTape } from './fixtures/cold-inputs.mjs';
import { archivePinnedReference, inventory, compareOutputs, normalizeOutput, NUMERICAL_TOLERANCE, PINNED, REFERENCE_CLOCK_MS } from '../../scripts/fovea-reference-harness.mjs';
import { createScope } from '../../scripts/fovea-capability-probe.mjs';

const parser = path.resolve(process.env.FOVEA_REFERENCE_PARSER ?? '.tmp/fovea-parser/ast-grep');
const reference = path.resolve(process.env.FOVEA_REFERENCE_ROOT ?? '../pi-fovea');
// Missing private development prerequisites are visible skips, never fabricated goldens.
it.skipIf(!fs.existsSync(parser) || !fs.existsSync(path.join(reference, '.git'))).each([512, 16000])(
  'compares actual pinned operations using exact oracle facts under a v17 test header (budget %i)', (budget) => {
    const scope = createScope();
    let oracleRoot: string | undefined;
    let passed = false;
    try {
      const run = spawnSync(process.execPath, [path.resolve('scripts/fovea-reference-harness.mjs'), '--reference', reference, '--host-reference', process.env.FOVEA_HOST_REFERENCE_ROOT ?? '../pi-fabric', '--parser', parser, '--query', 'GetUser', '--budget', String(budget)], {
        encoding: 'utf8', timeout: 60000, maxBuffer: 1048576, cwd: scope.workspace, env: scope.env,
      });
      expect(run.error).toBeUndefined(); expect(run.status, run.stdout).toBe(0);
      const summary = JSON.parse(run.stdout);
      oracleRoot = path.dirname(summary.report);
      const oracle = JSON.parse(fs.readFileSync(summary.report, 'utf8'));
      expect(oracle.referenceCommit).toBe(PINNED.upstreamCommit);
      expect(oracle.referenceStatus).toBe('executed');
      expect(oracle.parserVersion).toBe('ast-grep 0.45.3');
      expect(oracle.tolerance).toEqual(NUMERICAL_TOLERANCE);
      expect(oracle.parameters.clock).toBe(REFERENCE_CLOCK_MS);
      const root = path.join(oracleRoot!, 'workspace');
      // Explicit fixture-only cache-header transcode: preserve every recorded
      // fact byte; this checks operation parity, NOT cache compatibility or
      // independent cold extraction. Production refuses v16 caches.
      const storage = path.join(oracleRoot!, 'tmp');
      const cache = path.join(storage, `pi-fovea-${createHash('sha1').update(root).digest('hex').slice(0, 16)}.json`);
      const originalCache = fs.readFileSync(cache), newline = originalCache.indexOf(10);
      expect(newline).toBeGreaterThan(0);
      const header = JSON.parse(originalCache.subarray(0, newline).toString()); expect(header.fovea).toBe(16);
      const factsBytes = originalCache.subarray(newline + 1);
      fs.writeFileSync(cache, Buffer.concat([Buffer.from(JSON.stringify({ ...header, fovea: 17 }) + '\n'), factsBytes]));
      expect(fs.readFileSync(cache).subarray(fs.readFileSync(cache).indexOf(10) + 1)).toEqual(factsBytes);

      // This adapter changes host ownership only. No output keys are deleted,
      // sorted, rounded or patched to make the port agree with its oracle.
      const driver = path.join(scope.root, 'native.ts');
      fs.writeFileSync(driver, [
        `Date.now = () => ${REFERENCE_CLOCK_MS};`,
        `const { coreContext } = await import(${JSON.stringify(path.resolve('src/fovea/core/context.ts'))});`,
        `const { sketch, focus, dwell, impact } = await import(${JSON.stringify(path.resolve('src/fovea/core/ops.ts'))});`,
        `const { LANG_BY_EXT } = await import(${JSON.stringify(path.resolve('src/fovea/core/astgrep.ts'))});`,
        `const root = ${JSON.stringify(root)};`,
        `const ctx = { store:new Map(), sessionStore:new Map(), parserPath:${JSON.stringify(parser)}, storageRoot:${JSON.stringify(storage)}, signal:new AbortController().signal, gitPath:'/usr/bin/git', sourceRoot:root, snapshotRoot:root, gitFailures:[], focusKey:'reference', spills:new Map() };`,
        `const result = await coreContext.run(ctx, async () => ({ languages:LANG_BY_EXT, sketch:await sketch(root,${budget}), focus:await focus(root,'GetUser',${budget}), dwell:await dwell(root,2,${budget}), impact:await impact(root,{symbols:['GetUser'],budget:${budget},includeUncommitted:false}) }));`,
        'process.stdout.write(JSON.stringify(result));',
      ].join('\n'), { flag: 'wx', mode: 0o600 });
      const native = spawnSync('bun', [driver], { encoding: 'utf8', timeout: 60000, maxBuffer: 16777216, cwd: scope.workspace, env: { ...scope.env, TMPDIR: storage } });
      expect(native.error).toBeUndefined(); expect(native.status, native.stderr.slice(0,2000)).toBe(0);
      const actual = normalizeOutput(JSON.parse(native.stdout), oracleRoot);
      const differences = compareOutputs(oracle.outputs, actual);
      fs.writeFileSync(path.join(scope.root, 'native-output.json'), JSON.stringify(actual), { flag: 'wx', mode: 0o600 });
      fs.writeFileSync(path.join(scope.root, 'differences.json'), JSON.stringify({ oracleReport: summary.report, tolerance: NUMERICAL_TOLERANCE, differences }), { flag: 'wx', mode: 0o600 });
      expect(differences, `private evidence: ${scope.root}`).toEqual([]);
      passed = true;
    } finally {
      if (passed) {
        if (oracleRoot) removeFixtureSync(oracleRoot, { recursive: true, force: true });
        removeFixtureSync(scope.root, { recursive: true, force: true });
      }
    }
  }, 150000,
);

// Supplement (do not alter) the exact pinned mini corpus with small syntax
// fixtures for symbol languages absent there. These are inert source text.
const unusualSources = {
  'unusual/sample.c': 'int twice_c(int value) { return value * 2; }\n',
  'unusual/sample.cpp': 'class Counter { public: int twice_cpp(int value) { return value * 2; } };\n',
  'unusual/sample.lua': 'function twice_lua(value)\n  return value * 2\nend\n',
  'unusual/sample.php': '<?php\nfunction twice_php($value) { return $value * 2; }\n',
  'unusual/sample.swift': 'func twice_swift(_ value: Int) -> Int { return value * 2 }\n',
  'unusual/sample.scala': 'object Counter { def twice_scala(value: Int): Int = value * 2 }\n',
  'unusual/sample.hs': 'twice_haskell :: Int -> Int\ntwice_haskell value = value * 2\n',
  'unusual/sample.sh': 'twice_bash() { echo "$(( $1 * 2 ))"; }\n',
  'unusual/sample.js': 'export function twice_js(value) { return value * 2; }\n',
  'unusual/main.bend': 'import ./math.bend as M\ntype Shape is Data:\n  Circle{r: U32}\nlaw twice_positive:\n  for x: U32\n  {M.twice(x) == x + x : U32}\ndef main() -> U32:\n  return M.twice(2)\n',
  'unusual/math.bend': 'def twice(x: U32) -> U32:\n  return x + x\n',
};
const familyQueries = ['server/schema.graphql', 'contracts/users.proto', 'server/trpc.ts', 'server/orpc.ts', 'server/hono.ts', 'users.changed', ...Object.keys(unusualSources)];
// Known unqualified cold-extraction gate, not a default-suite pass. Independent
// parser runs and source-read completion can reorder raw facts/rule plans even
// within the exact reference. Keep strict failures visible when explicitly run;
// never sort away a mismatch or turn reference nondeterminism into parity.
it.skipIf(process.env.FOVEA_COLD_FAMILY_PROBE !== '1' || !fs.existsSync(parser) || !fs.existsSync(path.join(reference, '.git'))).each([512, 16000])(
  'UNQUALIFIED opt-in cold family parity including reference repeatability (budget %i)', budget => compareColdFamily(budget, false), 300000,
);

// Scheduled parser bytes from one run are dependencies, not warmed facts.
// v17 publishes deterministic rule/source order, so the old uncontrolled tape
// contract is no longer an equality claim. No output normalizer sorts facts.
it.skipIf(!fs.existsSync(parser) || !fs.existsSync(path.join(reference, '.git'))).each([512, 16000])(
  'compares cold cores on FIFO reads and exact scheduled parser bytes (budget %i)', budget => compareColdFamily(budget, true), 300000,
);

// A new input-schedule contract: invoke the real pinned parser independently in
// each process, not a tape. Keep the unmodified cold gate above separate.
it.skipIf(!fs.existsSync(parser) || !fs.existsSync(path.join(reference, '.git'))).each([512, 16000])(
  'compares independently parsed cold cores under an explicit rule-order schedule (budget %i)', budget => compareColdFamily(budget, true, true), 300000,
);

// Production uses the real batched parser and concurrent source reads, with no
// fixture schedule/tape. Compare to the independently stabilized pinned oracle,
// then a fresh production repeat. Uncontrolled upstream remains a separate gate.
it.skipIf(!fs.existsSync(parser) || !fs.existsSync(path.join(reference, '.git'))).each([512, 16000])(
  'production batched cold core matches scheduled reference and repeats exactly (budget %i)', budget => compareColdFamily(budget, true, true, true), 300000,
);
async function compareColdFamily(budget: number, controlled: boolean, scheduled = false, production = false) {
    const scope = createScope(); let passed = false;
    try {
      const archived = await archivePinnedReference(scope, reference, PINNED.upstreamCommit, 'pi-fovea');
      const sourceBefore = inventory(path.join(archived, 'src'));
      const fixture = path.join(archived, 'tests/fixtures/mini'); inventory(fixture);
      fs.cpSync(fixture, scope.workspace, { recursive: true, dereference: false });
      fs.mkdirSync(path.join(scope.workspace, 'unusual'), { mode: 0o700 });
      for (const [file, text] of Object.entries(unusualSources)) fs.writeFileSync(path.join(scope.workspace, file), text, { mode: 0o600 });
      const inputs = inventory(scope.workspace);
      const parserHash = createHash('sha256').update(fs.readFileSync(parser)).digest('hex');
      const pin = JSON.parse(fs.readFileSync('build-toolchain.json', 'utf8')).targets[`${process.platform}-${process.arch}`]['ast-grep'];
      expect(parserHash).toBe(pin.members.find((m: any) => m.path === 'tools/ast-grep').sha256);
      const storage = path.join(scope.root, 'comparison-storage');
      const tapeSchedule = controlled && !scheduled ? createParserSchedule({ directory: path.join(scope.root, 'tape-schedule'), workspace: scope.workspace, storage, parser }) : null;
      const tape = tapeSchedule ? createParserTape({ directory: path.join(scope.root, 'parser-tape'), workspace: scope.workspace, storage, parser, recordParser: tapeSchedule.wrapper('capture') }) : null;
      const schedule = scheduled ? createParserSchedule({ directory: path.join(scope.root, 'parser-schedule'), workspace: scope.workspace, storage, parser }) : null;
      const rawOutputs: Record<string, string> = {};
      const execute = (label: string, native: boolean) => {
        const selectedParser = production && native ? parser : schedule ? schedule.wrapper(label) : tape ? tape.wrapper(label, label === 'reference' ? 'record' : 'replay') : parser;
        const core = native ? path.resolve('src/fovea/core') : path.join(archived, 'src/core');
        // Same storage path, emptied between runs: path relocation only, no
        // sharing of parsed facts, graph state or disclosure history.
        removeFixtureSync(storage, { recursive: true, force: true }); fs.mkdirSync(storage, { mode: 0o700 });
        const driver = path.join(scope.root, `${label}-family.ts`);
        fs.writeFileSync(driver, [
          `Date.now = () => ${REFERENCE_CLOCK_MS};`,
          ...(controlled && !(production && native) ? [
            `const { installSourceReadQueue } = await import(${JSON.stringify(path.resolve('tests/fovea/fixtures/cold-inputs.mjs'))});`,
            `const sourceQueue = installSourceReadQueue(${JSON.stringify(scope.workspace)});`,
          ] : []),
          `const { sketch, focus, dwell, impact } = await import(${JSON.stringify(path.join(core, 'ops.ts'))});`,
          `const { ensureState } = await import(${JSON.stringify(path.join(core, 'state.ts'))});`,
          `const { LANG_BY_EXT } = await import(${JSON.stringify(path.join(core, 'astgrep.ts'))});`,
          `const root = ${JSON.stringify(scope.workspace)}, budget = ${budget};`,
          'const run = async () => {',
          ' const state = await ensureState(root);',
          ' const result = { languages: LANG_BY_EXT, facts: state.facts, graph: { ...state.graph, byName: [...state.graph.byName], byFile: [...state.graph.byFile] }, extraction: state.extraction, discovery: state.discovery, sketch: await sketch(root, budget), queries: [] };',
          ` for (const query of ${JSON.stringify(familyQueries)}) result.queries.push({ query, focus: await focus(root, query, budget, { fresh: true }), dwell: await dwell(root, 2, budget), impact: await impact(root, { symbols: [query], budget, includeUncommitted: false }) });`,
          ' return result;',
          '};',
          ...(native ? [
            `const { coreContext } = await import(${JSON.stringify(path.join(core, 'context.ts'))});`,
            `const ctx = { store:new Map(), sessionStore:new Map(), parserPath:${JSON.stringify(selectedParser)}, storageRoot:${JSON.stringify(storage)}, signal:new AbortController().signal, gitPath:'/usr/bin/git', sourceRoot:root, snapshotRoot:root, gitFailures:[], focusKey:'reference', spills:new Map() };`,
            'const result = await coreContext.run(ctx, run);',
          ] : ['const result = await run();']),
          ...(controlled && !(production && native) ? ['await sourceQueue.restore();', 'if (sourceQueue.count < 46) throw Error("FIFO source adapter was not exercised");'] : []),
          'process.stdout.write(JSON.stringify(result));',
        ].join('\n'), { mode: 0o600, flag: 'wx' });
        // Node's builtin live exports are explicitly synchronized by the FIFO
        // adapter. Bundle TypeScript only; do not rewrite reference modules.
        const executable = controlled ? `${driver}.mjs` : driver;
        if (controlled) buildSync({ entryPoints: [driver], outfile: executable, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
        const run = spawnSync(controlled ? process.execPath : 'bun', [executable], { cwd: scope.workspace, env: { ...scope.env, TMPDIR: storage, FOVEA_AST_GREP: selectedParser }, encoding: 'utf8', timeout: 120000, maxBuffer: 16777216 });
        expect(run.error).toBeUndefined(); expect(run.status, run.stderr.slice(0, 2000)).toBe(0);
        rawOutputs[label] = run.stdout;
        const value = normalizeOutput(JSON.parse(run.stdout), scope.root);
        fs.writeFileSync(path.join(scope.root, `${label}-family.json`), JSON.stringify(value), { mode: 0o600, flag: 'wx' });
        return value;
      };
      const expected = execute('reference', false), repeat = execute('reference-repeat', false), actual = execute('native', true);
      if (production) execute('native-repeat', true);
      const scheduleEvidence = schedule?.inspect();
      if (scheduleEvidence) {
        expect(scheduleEvidence.replayedCalls).toBe(0);
        expect(scheduleEvidence.runs).toHaveLength(production ? 2 : 3);
        for (const run of scheduleEvidence.runs) {
          expect(run.launches).toBeGreaterThan(run.calls);
          expect(run.requests).toEqual(scheduleEvidence.runs[0]!.requests);
        }
      }
      const tapeEvidence = tape?.inspect();
      if (tapeEvidence) {
        expect(tapeEvidence.parserSha256).toBe(parserHash);
        expect(tapeEvidence.calls).toBeGreaterThan(0);
        expect(tapeEvidence.runs).toHaveLength(3);
      }
      const differences = compareOutputs(expected, actual), referenceRepeatDifferences = compareOutputs(expected, repeat);
      const report = { referenceCommit: PINNED.upstreamCommit, parserHash, productionNative: production, ...(production ? { nativeByteIdentical: rawOutputs.native === rawOutputs['native-repeat'] } : {}), inputContract: production ? 'production-batched-v17-vs-scheduled-reference-v1' : scheduled ? 'fifo-source-rule-order-live-parser-v1' : controlled ? 'fifo-source-rule-order-parser-tape-v2' : 'independent-cold-v1', independentCold: !controlled, ...(tapeEvidence ? { tapeEvidence, tapeScheduleEvidence: tapeSchedule!.inspect() } : {}), ...(scheduleEvidence ? { scheduleEvidence, referenceByteIdentical: rawOutputs.reference === rawOutputs['reference-repeat'], outputSha256: Object.fromEntries(Object.entries(rawOutputs).map(([label, text]) => [label, createHash('sha256').update(text).digest('hex')])) } : {}), qualified: false, controlledInputsMatched: false, acceptanceVerified: false, clock: REFERENCE_CLOCK_MS, budget, queries: familyQueries, inputs, tolerance: NUMERICAL_TOLERANCE, differences, referenceRepeatDifferences };
      // Equality on empty discovery is not parity. Preserve diagnostic differences
      // first, but publish success only after coverage, inventories and exact-byte
      // assertions below all succeed. Failures retain an explicitly unqualified report.
      const reportPath = path.join(scope.root, 'family-comparison.json');
      fs.writeFileSync(reportPath, JSON.stringify(report), { mode: 0o600, flag: 'wx' });
      expect(inventory(scope.workspace)).toEqual(inputs); expect(inventory(path.join(archived, 'src'))).toEqual(sourceBefore);
      for (const output of [expected, repeat, actual]) {
        expect(output.extraction).toEqual({ failed: [], unreadable: [], oversized: [], generated: [] });
        expect(Object.keys(output.facts)).toEqual(expect.arrayContaining(Object.keys(unusualSources)));
        expect(output.queries).toHaveLength(familyQueries.length);
        for (const query of output.queries) expect(query.focus.details.nodes.length, query.query).toBeGreaterThan(0);
        const anchors = output.graph.anchors as { kind: string; id: string }[];
        for (const kind of ['rpc', 'graphql', 'trpc', 'orpc', 'channel']) expect(anchors.some(a => a.kind === kind), kind).toBe(true);
        for (const id of ['RPC users.v1.Users/GetUser', 'GRAPHQL QUERY user', 'GET /posts']) expect(anchors.some(a => a.id === id), id).toBe(true);
        expect(output.graph.edges.some((e: any) => e.kind === 'join' && e.evidence?.key?.includes('users.changed'))).toBe(true);
      }
      expect({ differences, referenceRepeatDifferences }, `${controlled ? 'CONTROLLED INPUT' : 'UNQUALIFIED'} private evidence: ${scope.root}`).toEqual({ differences: [], referenceRepeatDifferences: [] });
      if (scheduled) expect(rawOutputs['reference-repeat'], `byte-identical reference rerun: ${scope.root}`).toBe(rawOutputs.reference);
      if (production) {
        expect(rawOutputs['native-repeat'], `byte-identical production rerun: ${scope.root}`).toBe(rawOutputs.native);
        expect(rawOutputs.native, `byte-identical scheduled reference / production: ${scope.root}`).toBe(rawOutputs.reference);
      }
      fs.writeFileSync(reportPath, JSON.stringify({ ...report, qualified: !controlled, controlledInputsMatched: controlled, acceptanceVerified: true }), { mode: 0o600 });
      passed = true;
    } finally { if (passed && process.env.FOVEA_RETAIN_CONTROLLED_REPORT !== '1') removeFixtureSync(scope.root, { recursive: true, force: true }); }
}

