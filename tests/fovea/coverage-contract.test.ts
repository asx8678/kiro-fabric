import { removeFixture as rm } from "../fixture-cleanup.mjs";
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { FoveaEngine, type EngineResult } from '../../src/fovea/engine.js';
import { SourceAccess } from '../../src/fovea/source-access.js';
import { sourcePlatform } from '../../src/fovea/source-platform.js';
import { boundResultDetails } from '../../src/fovea/core/result-budget.js';
import { REPO_ACTION_DESCRIPTORS, REPO_GUEST_DECLARATIONS, REPO_NAVIGATION_SCHEMA, type RepoCoverage } from '../../src/providers/repo-contract.js';
import { validateSchemaValue } from '../../src/schema-validation.js';
import { typeCheckFabricCode } from '../../src/runtime/type-checker.js';
import { fabricGuestDeclarations } from '../../src/runtime/guest-types.js';
import { pinnedParser } from "./installed-parser.js";

// NavigationResult is module-private in src/fovea/engine.ts; recover the exact
// structural type from the public EngineResult union without re-exporting it.
type NavigationResult = Extract<EngineResult, { status: 'ok' | 'no-match' }>;

// REPO_COVERAGE_SCHEMA is now module-private; the public REPO_NAVIGATION_SCHEMA
// embeds the identical schema via structuredClone(REPO_COVERAGE_SCHEMA).
const REPO_COVERAGE_SCHEMA = (REPO_NAVIGATION_SCHEMA.properties as Record<string, unknown>).coverage as Record<string, unknown>;

// The standalone captureSourceSnapshot wrapper was removed; every call goes
// through the public SourceAccess method on a fresh platform.
const captureAccess = (): SourceAccess => new SourceAccess(sourcePlatform());

const parser = pinnedParser();
const directories: string[] = [];
const engines: FoveaEngine[] = [];
afterEach(async () => {
  await Promise.all(engines.splice(0).map(engine => engine.close()));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'fabric-coverage-')); directories.push(base);
  const root = join(base, 'source'), storage = join(base, 'storage');
  await mkdir(root, { mode: 0o700 }); await mkdir(storage, { mode: 0o700 });
  return { root, storage };
}
const valid = (value: unknown) => expect(validateSchemaValue(REPO_COVERAGE_SCHEMA, value)).toEqual({ status: 'valid' });
const invalid = (value: unknown) => expect(validateSchemaValue(REPO_COVERAGE_SCHEMA, value).status, JSON.stringify(value).slice(0, 250)).toBe('invalid');

it('registers bounded, closed coverage on every navigation action, with no delegated schema keywords', () => {
  const navigation = REPO_ACTION_DESCRIPTORS.filter(action => action.outputSchema);
  expect(navigation.map(action => action.name)).toEqual(['sketch', 'focus', 'augment', 'dwell', 'impact']);
  for (const action of navigation) expect(action.outputSchema).toEqual(REPO_NAVIGATION_SCHEMA);
  const visit = (schema: Record<string, unknown>) => {
    if (schema.type === 'object') {
      expect(schema.additionalProperties).toBe(false);
      expect(schema.properties).toBeDefined();
      for (const child of Object.values(schema.properties as Record<string, Record<string, unknown>>)) visit(child);
    } else if (schema.type === 'array') {
      expect(schema.maxItems).toBeTypeOf('number'); visit(schema.items as Record<string, unknown>);
    } else if (schema.type === 'string') {
      expect(schema.maxLength !== undefined || schema.enum !== undefined).toBe(true);
    } else if (schema.type === 'integer' || Array.isArray(schema.type)) {
      expect(schema.minimum).toBeTypeOf('number'); expect(schema.maximum).toBeTypeOf('number');
    }
  };
  visit(REPO_COVERAGE_SCHEMA);
  valid({}); // The recursive transport budget gives no unconditional field guarantees.
});

it('preserves unknown omissions, source reasons, recording and import uncertainty without inventing discovery source', () => {
  const coverage: RepoCoverage = {
    source: { sourceFiles: 2, sourceBytes: 100, entriesVisited: 10, capped: true, maxFiles: 2, maxFileBytes: 1024, maxBytes: 2048,
      counts: { excluded: 3, oversized: 1, generated: 1, unavailableOrSymlink: 1 },
      examples: { excluded: ['node_modules'], oversized: ['large.ts'], generated: ['generated.ts'], unavailableOrSymlink: ['link.ts'] },
      projectRules: 'host-approved-hash', trustedRulesSha256: 'a'.repeat(64) },
    recording: 'truncated', omittedSupported: null, capped: true, excludedPolicies: ['nested repositories until enrolled'],
    imports: { sites: 3, resolved: 1, possible: 1, unresolved: 1, capped: 0, unsupportedLanguages: ['python'], examplesOmitted: 0,
      examples: [{ file: 'app.ts', line: 1, spec: './plugins/${name}.js', status: 'possible', reason: 'runtime values are not evaluated' }] },
    gitFailures: ['Git executable not configured'],
  };
  valid(coverage);
  for (const recording of ['complete', 'partial', 'truncated']) valid({ recording });
  for (const status of ['possible', 'unresolved', 'capped']) valid({ imports: { examples: [{ status }] } });
  valid({ omittedSupported: 0 });
  valid({ source: { examples: { entryCap: [''] } } }); // Root-level reports may use the empty prefix.
  invalid({ source: 'walk' }); invalid({ source: 'git' });
});

it('rejects malformed scalar fields, unknown keys at every object level and oversized collections', () => {
  const malformed: unknown[] = [null, [], 'coverage', { unknown: 1 }, { recording: 'unknown' }, { capped: 1 },
    { omittedSupported: -1 }, { omittedSupported: 0.5 }, { omittedSupported: 'unknown' },
    { indexedFiles: Number.MAX_SAFE_INTEGER + 1 }, { extractedFiles: Infinity }, { candidateFilesSeen: NaN },
    { source: { unknown: true } }, { source: { sourceFiles: '2' } }, { source: { sourceBytes: -1 } },
    { source: { counts: { excluded: '3' } } }, { source: { counts: { invented: 1 } } },
    { source: { examples: { invented: [] } } }, { source: { examples: { excluded: [1] } } },
    { source: { examples: { excluded: Array(21).fill('a') } } }, { source: { projectRules: 'trusted' } },
    { source: { trustedRulesSha256: 'bad' } }, { source: { capped: 'yes' } },
    { imports: { unknown: 0 } }, { imports: { possible: -1 } }, { imports: { unresolved: 1.5 } },
    { imports: { capped: true } }, { imports: { examplesOmitted: -1 } }, { imports: { unsupportedLanguages: [false] } },
    { imports: { examples: [{ unknown: true }] } }, { imports: { examples: [{ line: -1 }] } },
    { imports: { examples: [{ status: 'exact' }] } }, { imports: { examples: [{ reason: {} }] } },
    { imports: { examples: [{ spec: 'x'.repeat(161) }] } }, { imports: { examples: Array(21).fill({}) } },
    { gitFailures: Array(11).fill('failure') }, { excludedExamples: Array(21).fill('a') },
    { generatedFiles: Array(1001).fill('a') }, { unreadableFiles: ['x'.repeat(100_001)] },
    { detailsTruncated: false }, { detailsOmitted: 0 }, { detailsOmitted: '1' }];
  for (const value of malformed) invalid(value);
});

it('accepts actual budget truncation inside source/import objects without promising complete fields', () => {
  const raw = {
    source: { sourceFiles: 1, counts: { excluded: 2 }, examples: { excluded: ['node_modules', 'dist'] }, projectRules: 'untrusted-skipped' },
    recording: 'complete', omittedSupported: 0,
    imports: { sites: 1, examples: [{ file: 'a.ts', line: 1, spec: 'missing', status: 'unresolved', reason: 'not resolved' }], examplesOmitted: 0 },
    gitFailures: ['Git executable not configured'],
  };
  let partialSource = false, partialImport = false, missingSource = false;
  for (let nodes = 1; nodes <= 40; nodes++) {
    const bounded = boundResultDetails(raw, 100_000, nodes);
    valid(bounded);
    if (bounded.detailsTruncated) {
      expect(bounded.detailsOmitted).toBeGreaterThan(0);
      const coverage = bounded as RepoCoverage;
      missingSource ||= coverage.source === undefined;
      partialSource ||= coverage.source !== undefined && coverage.source.projectRules === undefined;
      partialImport ||= coverage.imports !== undefined && coverage.imports.examplesOmitted === undefined;
    }
  }
  expect({ partialSource, partialImport, missingSource }).toEqual({ partialSource: true, partialImport: true, missingSource: true });
  const charLimited = boundResultDetails({ generatedFiles: Array(1000).fill('x'.repeat(200)), ...raw }, 100_000, 4000);
  valid(charLimited); expect(charLimited.detailsTruncated).toBe(true);
  expect((charLimited.source as RepoCoverage['source'])?.projectRules).toBeUndefined();
  // Even a truncated packet must not admit new or wrongly typed fields.
  invalid({ ...charLimited, imports: { possible: 'unknown' } });
});

it('keeps native and guest coverage declarations identical and rejects open/untyped guest access', async () => {
  const source = await readFile(resolve('src/providers/repo-contract.ts'), 'utf8');
  const declarations = (text: string) => {
    const file = ts.createSourceFile('contract.ts', text, ts.ScriptTarget.Latest, true);
    return new Map(file.statements.filter(statement => (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) && /Coverage/.test(statement.name.text))
      .map(statement => [(statement as ts.InterfaceDeclaration | ts.TypeAliasDeclaration).name.text, statement.getText(file).replace(/^export /, '')]));
  };
  expect(declarations(REPO_GUEST_DECLARATIONS)).toEqual(declarations(source));
  for (const code of [
    'const c: RepoCoverage = {omittedSupported:null,source:{counts:{excluded:2}},imports:{examples:[{status:"possible"}]}}; return c;',
    'const c: RepoCoverage = (await repo.sketch()).coverage; const n: number | undefined = c.source?.sourceFiles; const omitted: number | null | undefined = c.omittedSupported; return {n:n ?? null,omitted:omitted ?? null};',
    'const c: RepoCoverage = {detailsTruncated:true, source:{}, imports:{examples:[{}]}}; return c;',
    'return await repo.sketch();',
  ]) expect(typeCheckFabricCode(code, fabricGuestDeclarations).errors, code).toEqual([]);
  for (const code of [
    'const c: RepoCoverage = {source:"walk"}; return c;',
    'const c: RepoCoverage = {source:{sourceFiles:"2"}}; return c;',
    'const c: RepoCoverage = {source:{counts:{invented:1}}}; return c;',
    'const c: RepoCoverage = {imports:{examples:[{status:"exact"}]}}; return c;',
    'const c: RepoCoverage = {recording:"unknown"}; return c;',
    'const c: RepoCoverage = {detailsTruncated:false}; return c;',
    'const c = (await repo.focus({query:"x"})).coverage; return c.invented;',
    'const c = (await repo.sketch()).coverage; const n: number = c.source.sourceFiles; return n;',
  ]) expect(typeCheckFabricCode(code, fabricGuestDeclarations).errors.length, code).toBeGreaterThan(0);
});

describe.skipIf(process.platform !== 'linux')('native source and navigation coverage', () => {
  it('validates real source counts, exclusions and caps without changing snapshot shape', async () => {
    const { root, storage } = await fixture();
    await writeFile(join(root, 'a.ts'), 'export const value = 1;');
    await writeFile(join(root, 'z.ts'), 'x'.repeat(1024));
    await writeFile(join(root, 'note.txt'), 'unsupported');
    await mkdir(join(root, '.fovea')); await mkdir(join(root, 'node_modules'));
    await symlink('/etc/passwd', join(root, 'escape.ts'));
    const snapshot = await captureAccess().captureSourceSnapshot(root, storage, undefined, { maxFileBytes: 128 });
    valid({ source: snapshot.coverage });
    expect(snapshot.coverage).toMatchObject({ sourceFiles: 1, sourceBytes: 23, capped: false, projectRules: 'untrusted-skipped',
      counts: { excluded: 1, oversized: 1, unsupported: 1, untrustedProjectRules: 1, unavailableOrSymlink: 1 } });
    const cappedStorage = join(storage, 'capped'); await mkdir(cappedStorage);
    const capped = await captureAccess().captureSourceSnapshot(root, cappedStorage, undefined, { maxFiles: 1 });
    valid({ source: capped.coverage }); expect(capped.coverage.capped).toBe(true);
  });

  it('admits the warm snapshot-reuse marker on the navigation coverage contract', async () => {
    const { root, storage } = await fixture();
    await writeFile(join(root, 'stable.ts'), 'export const stable = 1;\n');
    const first = await captureAccess().captureSourceSnapshot(root, storage, undefined, {});
    const reusedStorage = join(storage, 'reused'); await mkdir(reusedStorage);
    const second = await captureAccess().captureSourceSnapshot(root, reusedStorage, undefined, { previous: { id: first.id, root: first.root, hashes: first.hashes } });
    expect(second.coverage.reusedPreviousSnapshot).toBe(true);
    valid({ source: second.coverage });
  });

  it.skipIf(!existsSync(parser.path))('validates real sketch/focus/dwell/impact, transient augmentation and no-match host packet projections', async () => {
    const { root, storage } = await fixture();
    await mkdir(join(root, 'plugins'));
    await writeFile(join(root, 'math.ts'), 'export function calculateTotal(value: number) { return value + 1; }\n');
    await writeFile(join(root, 'consumer.ts'), 'import { calculateTotal } from "./math.js";\nimport missing from "external-missing";\nexport function checkout(name: string) { return import(`./plugins/${name}.js`); }\nexport const total = calculateTotal(3);\n');
    await writeFile(join(root, 'plugins', 'one.ts'), 'export const plugin = 1;\n');
    await writeFile(join(root, 'jobs.rb'), 'def work\n  1\nend\n');
    await writeFile(join(root, 'note.txt'), 'not a supported source');
    await mkdir(join(root, 'node_modules'));
    const engine = new FoveaEngine({ parser, storageRoot: storage }); engines.push(engine);
    const query = async (operation: string, args: Record<string, unknown> = {}) => {
      const result = await engine.query({ root, rootId: 'root', authorizationEpoch: 1, conversationId: 'coverage', conversationEpoch: 1, operation, args }) as NavigationResult;
      valid(result.coverage);
      // host.ts deliberately projects engine details into a retained result, not the public packet.
      const { details: _details, ...navigation } = result;
      const packet = { ...navigation, schemaVersion: 1, advisory: true, resultId: 'result', rootId: 'root' };
      expect(validateSchemaValue(REPO_NAVIGATION_SCHEMA, packet)).toEqual({ status: 'valid' });
      return result;
    };
    const sketch = await query('sketch');
    expect(sketch.coverage).toMatchObject({ recording: 'complete', omittedSupported: 0,
      source: { sourceFiles: 4, counts: { excluded: 1, unsupported: 1 }, projectRules: 'untrusted-skipped' },
      imports: { resolved: 1, possible: 1, unresolved: 1, unsupportedLanguages: ['Ruby'] } });
    const focus = await query('focus', { query: 'calculateTotal', fresh: true });
    expect(focus.status).toBe('ok'); expect(focus.reads.length).toBeGreaterThan(0);
    await query('dwell', { focusId: focus.focusId });
    await query('impact', { files: ['math.ts'], includeUncommitted: false });
    const transient = await query('focus', { query: 'checkout', fresh: true, transient: true });
    expect(transient.focusId).toBeUndefined();
    const miss = await query('focus', { query: 'totallyAbsentIdentifierZZZ' }); expect(miss.status).toBe('no-match');
  });
});
