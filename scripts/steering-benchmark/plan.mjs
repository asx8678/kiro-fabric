import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { CASES, ALL_CASES, makeCase, caseHashes } from './cases.mjs';
import { AGENT_PROMPTS, generateAgentProfile } from '../agent-profile.mjs';
import { object, readJson, regularText, digest, sha, inventory, limitations } from './core.mjs';

export const ARMS = ['old', 'pass1', 'pass2', 'fabric', 'native'];
/** @typedef {'standard'|'review'|'minimal'} GuidanceMode */
/** @typedef {{profile:string,runtimePaths:string[],configPaths:string[],guidanceMode?:GuidanceMode}} ArmConfig */
/** @typedef {{cli:string,python:string,runtimePaths:string[],cliConfigPaths:string[],arms:Record<string,ArmConfig>,nativeMode:string,repetitions:number,seed:string,plannedCredits:number,creditCeiling:number,priorCredits:number,reserveCredits:number,maxCalls:number,timeoutMs:number,maxOutputBytes:number,env:Record<string,string>,snapshotCliSettings?:boolean,cases?:string[],model?:string,effort?:string,nativeTrustTools?:string[],nativeWorkspacePermissions?:boolean,runIndices?:number[],singleRunCreditLimit?:number}} Config */
/** @typedef {{index:number,caseId:string,round:number,seed:string,arm:string,qualification:boolean,hashes:ReturnType<typeof caseHashes>,sourceIndex?:number}} Run */
/** @param {unknown} value @param {string} name */
function text(value, name) { assert.ok(typeof value === 'string' && value.length > 0 && !/[\x00-\x1f]/.test(value), 'invalid ' + name); return String(value); }
/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max */
function number(value, fallback, min, max) { const n = value ?? fallback; assert.ok(typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max, 'numeric bounds'); return Number(n); }
/** Resolve a named executable via declared PATH, without running a shell or scanning directories.
 * @param {string} name @param {string} [searchPath] */
export function executable(name, searchPath = process.env.PATH ?? '') {
  const candidates = name.includes('/') || name.includes('\\') ? [path.resolve(name)] : searchPath.split(path.delimiter).filter(Boolean).map(p => path.resolve(p, name));
  const found = candidates.find(p => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } });
  assert.ok(found, 'executable unavailable: ' + name); return fs.realpathSync(found);
}
/** @param {unknown} values @param {string} base @returns {string[]} */
function paths(values, base) { assert.ok(Array.isArray(values) && values.length > 0, 'declare nonempty identity paths'); return values.map(v => path.resolve(base, text(v, 'identity path'))); }
/** @param {unknown} value @param {string} base @returns {Config} */
export function parseConfig(value, base) {
  const raw = object(value), arms = object(raw.arms);
  assert.ok(raw.snapshotCliSettings === undefined || typeof raw.snapshotCliSettings === 'boolean', 'snapshotCliSettings must be boolean');
  assert.ok(raw.nativeWorkspacePermissions === undefined || typeof raw.nativeWorkspacePermissions === 'boolean', 'nativeWorkspacePermissions must be boolean');
  assert.ok(Object.keys(arms).every(a => ARMS.includes(a) && a !== 'native'), 'unknown Fabric arm; native is implicit');
  const cases = raw.cases === undefined ? CASES : raw.cases;
  assert.ok(Array.isArray(cases) && cases.length > 0 && cases.every(c => typeof c === 'string' && ALL_CASES.includes(c)) && new Set(cases).size === cases.length, 'invalid/duplicate cases');
  const effort = raw.effort === undefined ? undefined : text(raw.effort, 'effort');
  assert.ok(effort === undefined || ['low', 'medium', 'high', 'xhigh', 'max'].includes(effort), 'invalid effort');
  const nativeTrustTools = raw.nativeTrustTools ?? ['fs_read', 'fs_write', 'shell'];
  assert.ok(Array.isArray(nativeTrustTools) && nativeTrustTools.length > 0 && nativeTrustTools.every(t => ['fs_read', 'fs_write', 'shell', 'str_replace', 'execute_bash'].includes(t)) && new Set(nativeTrustTools).size === nativeTrustTools.length, 'invalid native fixture tools');
  const runIndices = raw.runIndices === undefined ? undefined : /** @type {number[]} */ (raw.runIndices);
  const singleRunCreditLimit = number(raw.singleRunCreditLimit, 0.8, 0.1, 5);
  assert.ok(runIndices === undefined || Array.isArray(runIndices) && runIndices.length > 0 && runIndices.length <= 1020 && runIndices.every((n, i) => Number.isSafeInteger(n) && n >= 0 && (i === 0 || n > runIndices[i - 1])), 'invalid continuation runIndices');
  /** @type {Record<string,string>} */ const env = {};
  for (const [key, v] of Object.entries(raw.env ? object(raw.env) : {})) env[key] = text(v, 'environment value');
  /** @type {Record<string,ArmConfig>} */ const parsedArms = {};
  for (const name of Object.keys(arms)) {
    const a = object(arms[name]), guidanceMode = a.guidanceMode;
    assert.ok(guidanceMode === undefined || guidanceMode === 'standard' || guidanceMode === 'review' || guidanceMode === 'minimal', 'invalid guidance mode');
    parsedArms[name] = { profile: path.resolve(base, text(a.profile, name + ' profile')), runtimePaths: paths(a.runtimePaths, base), configPaths: paths(a.configPaths, base), ...(guidanceMode === undefined ? {} : { guidanceMode: /** @type {GuidanceMode} */ (guidanceMode) }) };
  }
  const config = {
    cli: executable(text(raw.cli ?? 'kiro-cli', 'CLI'), env.PATH), python: executable(text(raw.python ?? 'python3', 'Python'), env.PATH),
    runtimePaths: paths(raw.runtimePaths, base), cliConfigPaths: paths(raw.cliConfigPaths, base), arms: parsedArms,
    snapshotCliSettings: raw.snapshotCliSettings === true, cases, ...(effort === undefined ? {} : { effort }), ...(runIndices === undefined ? {} : { runIndices }), singleRunCreditLimit, nativeTrustTools, nativeWorkspacePermissions: raw.nativeWorkspacePermissions === true, model: text(raw.model ?? 'auto', 'model'),
    nativeMode: text(raw.nativeMode ?? 'vibe', 'native mode'), repetitions: number(raw.repetitions, 2, 2, 20), seed: text(raw.seed ?? 'steering-v1', 'seed'),
    plannedCredits: number(raw.plannedCredits, 20, 0.8, 40), creditCeiling: number(raw.creditCeiling, 40, 5.8, 40), priorCredits: number(raw.priorCredits, 0, 0, 40), reserveCredits: number(raw.reserveCredits, 5, 5, 39),
    maxCalls: number(raw.maxCalls, 40, 1, 40), timeoutMs: number(raw.timeoutMs, 150000, 10, 150000), maxOutputBytes: number(raw.maxOutputBytes, 8 * 1024 * 1024, 128, 8 * 1024 * 1024), env
  };
  assert.ok(Number.isInteger(config.repetitions) && Number.isInteger(config.maxCalls) && Number.isInteger(config.maxOutputBytes), 'integer limits required');
  assert.ok(config.priorCredits + config.plannedCredits + config.reserveCredits <= config.creditCeiling, 'planned stop must leave reserve within <=40 ceiling');
  return config;
}
/** @param {Config} config @returns {Run[]} */
export function schedule(config) {
  /** @type {Run[]} */ const runs = [];
  const active = ARMS.filter(a => a === 'native' || a in config.arms);
  for (let round = 0; round < config.repetitions; round++) for (const [caseIndex, caseId] of (config.cases ?? CASES).entries()) {
    const seed = sha(config.seed + '/' + round + '/' + caseId);
    const rotation = (caseIndex + Math.floor(round / 2)) % active.length;
    let order = active.map((_, i) => active[(i + rotation) % active.length]); if (round % 2) order = order.reverse();
    const s = makeCase(caseId, seed, config.python);
    for (const arm of order) if (!(s.qualification && arm === 'native')) runs.push({ index: runs.length, caseId, round, seed, arm, qualification: s.qualification, hashes: caseHashes(s) });
  }
  // Complete broad paired coding coverage before the deliberately pathological output stress.
  const ordered = [...runs.filter(r => !['range', 'bug-checkout'].includes(r.caseId)), ...runs.filter(r => r.caseId === 'bug-checkout'), ...runs.filter(r => r.caseId === 'range')].map((run, index) => ({ ...run, index }));
  if (config.runIndices === undefined) return ordered;
  assert.ok(config.runIndices.every(index => index < ordered.length), 'continuation index outside schedule');
  return config.runIndices.map((sourceIndex, index) => ({ ...ordered[sourceIndex], index, sourceIndex }));
}
/** @param {string} file */
export function artifact(file) {
  // Keep both the declared path and resolved target: changing a current alias is drift even for equal bytes.
  const real = fs.realpathSync(file), st = fs.statSync(real);
  assert.ok(st.isDirectory() || st.isFile() && st.size <= 1024 * 1024 * 1024, 'identity artifact type/byte limit');
  const content = st.isDirectory() ? digest(inventory(real, { maxFiles: 50000, maxBytes: 1024 * 1024 * 1024 })) : sha(fs.readFileSync(real));
  return { path: file, realPath: real, digest: content };
}
/** @param {ArmConfig} arm */
export function profileSnapshot(arm) {
  const raw = regularText(arm.profile), profile = object(JSON.parse(raw)), servers = object(profile.mcpServers), fabric = object(servers.fabric), env = object(fabric.env);
  assert.deepEqual(profile.tools, ['@fabric/fabric_exec'], 'strict Fabric tools'); assert.equal(fabric.waitForReady, true, 'waitForReady required');
  assert.equal(profile.includeMcpJson, false, 'profile must disable inherited MCP'); assert.equal(profile.includePowers, false, 'profile must disable powers');
  assert.deepEqual(Object.keys(servers), ['fabric'], 'unexpected MCP servers');
  const bundle = text(env.KIRO_FABRIC_BUNDLE_ROOT, 'complete standalone bundle root'); assert.ok(path.isAbsolute(bundle), 'absolute bundle root required');
  const app = path.join(bundle, 'app'), node = path.join(bundle, 'tools', 'node');
  assert.equal(env.KIRO_FABRIC_RUNTIME_ROOT, app, 'coherent app root'); assert.equal(fabric.command, node, 'coherent Node');
  assert.equal(env.KIRO_FABRIC_EXPECTED_NODE, node); assert.equal(env.KIRO_FABRIC_RG, path.join(bundle, 'tools', 'rg'));
  assert.deepEqual(fabric.args, [path.join(app, 'kiro', 'mcp-entry.js')], 'coherent entry');
  // Exact current prompt bytes identify a mode, not an arm label. Older/custom
  // profiles remain comparable as unknown instead of being mislabeled standard.
  const guidanceMode = Object.entries(AGENT_PROMPTS).find(([, prompt]) => prompt === profile.prompt)?.[0] ?? 'unknown';
  if (arm.guidanceMode !== undefined) assert.equal(guidanceMode, arm.guidanceMode, 'declared guidance mode must match profile prompt');
  const expectedResources = guidanceMode === 'minimal' ? []
    : [`skill://${path.join(bundle, 'resources', 'skills', 'fabric-exec', 'SKILL.md')}`, `file://${path.join(bundle, 'resources', 'steering', 'fabric.md')}`];
  assert.deepEqual(profile.resources, expectedResources, 'coherent resources for the guidance mode');
  if (guidanceMode !== 'unknown') {
    const expected = generateAgentProfile({ nodePath: node, runtimeRoot: app, dataRoot: text(env.KIRO_FABRIC_DATA_ROOT, 'private data root'),
      skillPath: path.join(bundle, 'resources', 'skills', 'fabric-exec', 'SKILL.md'), steeringPath: path.join(bundle, 'resources', 'steering', 'fabric.md'),
      guidanceMode: /** @type {GuidanceMode} */ (guidanceMode) });
    assert.deepEqual(profile.hooks ?? [], expected.hooks, 'coherent hooks for the guidance mode');
  }
  assert.ok(arm.runtimePaths.includes(bundle), 'bundle root must be frozen explicitly');
  const data = text(env.KIRO_FABRIC_DATA_ROOT, 'private data root'); assert.ok(path.isAbsolute(data), 'absolute data root');
  assert.ok(!data.startsWith(bundle + path.sep) && data !== bundle, 'mutable data cannot be in immutable bundle');
  assert.ok(arm.configPaths.every(p => p.startsWith(data + path.sep)), 'config must belong to declared private data root');
  const reviewPath = path.join(bundle, 'resources', 'skills', 'fabric-exec', 'references', 'review.md');
  let reviewHelp = null;
  try {
    const text = regularText(reviewPath);
    assert.ok(text.trim() && !text.includes('\0') && text.length <= 100000, 'invalid frozen review guidance');
    reviewHelp = { path: reviewPath, sha256: sha(text), text };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { raw, profile, guidanceMode, dataRoot: data, profileIdentity: artifact(arm.profile), reviewHelp };
}
function harnessIdentity() {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const files = [path.join(directory, '..', 'steering-benchmark.mjs'), path.join(directory, '..', 'agent-profile.mjs'), ...fs.readdirSync(directory).filter(n => n.endsWith('.mjs')).sort().map(n => path.join(directory, n))];
  return files.map(file => ({ file: path.relative(path.join(directory, '..'), file), hash: sha(fs.readFileSync(file)) }));
}
/** Global settings share a volatile session DB, so re-read their bounded projection rather than hashing that DB.
 * @param {Config} config */
function cliSettings(config) {
  if (!config.snapshotCliSettings) return null;
  const result = spawnSync(config.cli, ['settings', '--global', '--format', 'json', 'list'], { env: { ...process.env, ...config.env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000, maxBuffer: 131072 });
  assert.ok(!result.error && result.status === 0, 'CLI settings snapshot failed');
  return object(JSON.parse(result.stdout));
}
/** @param {Config} config */
function identity(config) {
  const profiles = Object.fromEntries(Object.entries(config.arms).map(([name, arm]) => [name, profileSnapshot(arm)]));
  const roots = Object.values(profiles).map(p => fs.realpathSync(p.dataRoot)); assert.equal(new Set(roots).size, roots.length, 'arm data roots must be isolated');
  const paths = [...new Set([config.cli, config.python, process.execPath, ...config.runtimePaths, ...config.cliConfigPaths, ...Object.values(config.arms).flatMap(a => [...a.runtimePaths, ...a.configPaths])])].sort();
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([k]) => !['_', 'SHLVL', 'PWD', 'OLDPWD'].includes(k)));
  return { artifacts: paths.map(artifact), profiles, cliSettings: cliSettings(config), node: process.version, platform: process.platform, arch: process.arch, environmentDigest: digest({ ...inherited, ...config.env }), harness: harnessIdentity(), requestedModel: config.model ?? 'auto', requestedEffort: config.effort ?? null, actualRoutedModel: null, cacheUsage: null, settledBilling: null };
}
/** @param {string} manifest */
export function createPlan(manifest) {
  const config = parseConfig(readJson(manifest), path.dirname(path.resolve(manifest)));
  return { schemaVersion: 1, manifestPath: path.resolve(manifest), manifestDigest: sha(fs.readFileSync(manifest)), config, identity: identity(config), runs: schedule(config), limitations };
}
/** @typedef {ReturnType<typeof createPlan>} Plan */
/** @param {Plan} plan */
export function verifyPlan(plan) {
  assert.equal(sha(fs.readFileSync(plan.manifestPath)), plan.manifestDigest, 'manifest drift');
  assert.deepEqual(identity(plan.config), plan.identity, 'runtime/config/profile/environment/harness drift');
  assert.deepEqual(schedule(plan.config), plan.runs, 'plan/prompt/fixture/oracle drift');
}
/** @typedef {{index:number,credits:number|null,stopReason:string|null,state:string}} ChargeRow */
/** @param {Config} config @param {ChargeRow[]} rows @param {number} total */
export function budgetGate(config, rows, total) {
  assert.ok(rows.every(r => r.state === 'finished' && r.credits !== null && Number.isFinite(r.credits) && r.credits >= 0 && !r.stopReason), 'incomplete attempt, missing usage, or prior safety stop');
  assert.ok(rows.every(r => Number(r.credits) <= config.singleRunCreditLimit), 'single-run credits above limit');
  const spent = rows.reduce((sum, r) => sum + Number(r.credits), 0);
  const projected = rows.length >= 8 ? spent / rows.length * total : null;
  assert.ok(projected === null || projected <= config.plannedCredits, 'projected planned-credit stop');
  assert.ok(spent + config.singleRunCreditLimit <= config.plannedCredits && config.priorCredits + spent + config.singleRunCreditLimit + config.reserveCredits <= config.creditCeiling, 'credit stop/reserve');
  return { spent, projected };
}
