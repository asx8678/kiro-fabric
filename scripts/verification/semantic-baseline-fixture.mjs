// Real Fovea engine semantic-baseline fixture helpers. OFFLINE only; not native
// qualification. Retains every fixture. Bundles the current checkout's src into
// a driver that runs under an EXPLICITLY SUPPLIED installed generation's Node so
// the real Darwin native source binding, real ast-grep parser and real
// FoveaEngine/Host execute. No native client, chat, auth or network is used.
//
// Admission is explicitly scoped and pre-execution. Candidate selection never
// inspects the real account home, an implicit install tree, credentials or
// arbitrary temp code. The complete bundle (manifest/inventory/target/version
// plus exact Node/parser/native/metadata/closure identities) is validated in
// this verifier's Node BEFORE any candidate code, native binary or candidate
// Node executes. Execution descriptors are derived only from the validated
// result, and the generation is revalidated immediately before each spawn.
// Validation and spawn remain separate syscalls: absent OS file-descriptor
// pinning of the candidate executable, no atomic containment is claimed against
// a writer that races the revalidation window.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { build } from "esbuild";

const SEMANTIC_PREFIX = "semantic-baseline";
export const SEMANTIC_BUNDLE_ENV = "KIRO_FABRIC_SEMANTIC_BUNDLE";
export const SEMANTIC_MANIFEST_ENV = "KIRO_FABRIC_SEMANTIC_EXPECTED_MANIFEST_SHA256";
export const SEMANTIC_DIGEST_ENV = "KIRO_FABRIC_SEMANTIC_EXPECTED_GENERATION_DIGEST";

const TRUSTED_GITS = process.platform === "darwin"
  ? ["/Library/Developer/CommandLineTools/usr/bin/git"]
  : ["/usr/bin/git"];

const sha256 = value => createHash("sha256").update(value).digest("hex");
const isHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/** Resolve only relative to this trusted verifier module, never arbitrary cwd. */
async function loadContract() {
  return import(new URL("../../src/installation/bundle-contract.mjs", import.meta.url).href);
}

/** Separate operator/harness trust input. Never infer anchors from the candidate. */
function expectedIdentity(env) {
  const manifestSha256 = env?.[SEMANTIC_MANIFEST_ENV];
  const digest = env?.[SEMANTIC_DIGEST_ENV];
  if (!isHash(manifestSha256) || !isHash(digest)) {
    throw new Error(`separately trusted ${SEMANTIC_MANIFEST_ENV} and ${SEMANTIC_DIGEST_ENV} are required (lowercase SHA-256)`);
  }
  return { manifestSha256, digest };
}

/** Explicit-only candidate selection. No home/install/credential/tmp discovery. */
export function selectSemanticCandidate(env = process.env) {
  const raw = env?.[SEMANTIC_BUNDLE_ENV];
  if (raw === undefined || raw === null || raw === "") return { state: "unset" };
  if (typeof raw !== "string" || raw.includes("\0") || !path.isAbsolute(raw)) {
    return { state: "invalid", reason: `${SEMANTIC_BUNDLE_ENV} must be an absolute generation root` };
  }
  return { state: "explicit", root: raw.length > 1 ? raw.replace(/\/+$/, "") : raw };
}

/** @param {any} bundle @param {string} file */
function inventoryIdentity(bundle, file) {
  const entry = bundle.inventory.find(item => item.path === file);
  if (!entry || !isHash(entry.sha256)) throw new Error(`admitted generation is missing a valid identity for ${file}`);
  return entry.sha256;
}

/** Derive the execution descriptor ONLY from the completely validated result. */
function describeAdmittedGeneration(bundle, canonical) {
  const manifest = bundle.manifest;
  const parserPin = manifest.tools?.["ast-grep"];
  const parserMember = Array.isArray(parserPin?.members) ? parserPin.members.find(member => member.path === "tools/ast-grep") : undefined;
  const parserSha256 = inventoryIdentity(bundle, "tools/ast-grep");
  if (parserMember && parserMember.sha256 !== parserSha256) throw new Error("admitted parser pin and inventory disagree");
  const metadataBytes = fs.readFileSync(path.join(bundle.root, "app/fovea/source-platform.json"));
  if (sha256(metadataBytes) !== inventoryIdentity(bundle, "app/fovea/source-platform.json")) {
    throw new Error("admitted native metadata changed while capturing C input claim");
  }
  const installedCSourceSha256 = JSON.parse(metadataBytes.toString()).sourceSha256;
  if (!isHash(installedCSourceSha256)) throw new Error("admitted native C input claim is missing");
  return {
    installedCSourceSha256,
    root: bundle.root,
    digest: bundle.digest,
    schema: manifest.schema,
    target: manifest.target,
    version: bundle.version,
    node: path.join(bundle.root, "tools/node"),
    parser: { path: path.join(bundle.root, "tools/ast-grep"), sha256: parserSha256, version: parserPin?.version, generationRoot: bundle.root },
    identities: {
      "tools/node": inventoryIdentity(bundle, "tools/node"),
      "tools/ast-grep": parserSha256,
      "app/fovea/source-platform.node": inventoryIdentity(bundle, "app/fovea/source-platform.node"),
      "app/fovea/source-platform.json": inventoryIdentity(bundle, "app/fovea/source-platform.json"),
      "app/closure-manifest.json": inventoryIdentity(bundle, "app/closure-manifest.json"),
    },
    manifestSha256: sha256(Buffer.from(canonical(manifest) + "\n")),
  };
}

/** Complete trusted host-side admission. Reads and hashes only; nothing from the
 * candidate bundle is executed, required or dlopen'd here. Reuses the production
 * validateInstalledBundle (schema/browser retirement, manifest digest, complete
 * inventory, tool pins, native/metadata/closure identities) unchanged. */
export async function admitSemanticGeneration(candidate, trustEnv = process.env) {
  if (!candidate || candidate.state === "unset") {
    return { ok: false, code: "unavailable", reason: `${SEMANTIC_BUNDLE_ENV} is not set; no implicit home, install-tree, credential or temp-code discovery is performed` };
  }
  if (candidate.state !== "explicit") {
    return { ok: false, code: "invalid-override", reason: candidate.reason ?? "invalid explicit generation root" };
  }
  let expected;
  try { expected = expectedIdentity(trustEnv); }
  catch (error) { return { ok: false, code: "unavailable", reason: error.message }; }
  const hostTarget = `${process.platform}-${process.arch}`;
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch)) {
    return { ok: false, code: "unavailable", reason: `semantic native lane does not support host ${hostTarget}` };
  }
  const root = candidate.root;
  let stat;
  try { stat = fs.lstatSync(root); } catch { return { ok: false, code: "invalid-override", reason: `explicit generation root is not readable: ${root}` }; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return { ok: false, code: "invalid-override", reason: `explicit generation root must be a real directory (not a symlink): ${root}` };
  }
  let canonicalRoot;
  try { canonicalRoot = fs.realpathSync(root); } catch { return { ok: false, code: "invalid-override", reason: `explicit generation root cannot be canonicalized: ${root}` }; }
  if (canonicalRoot !== root) {
    return { ok: false, code: "invalid-override", reason: `explicit generation root must be canonical (no symlink, alias or path indirection): ${root}` };
  }
  let contract;
  try { contract = await loadContract(); } catch (error) { return { ok: false, code: "unavailable", reason: `cannot load the production admission contract: ${error.message}` }; }
  let bundle;
  try { bundle = await contract.validateInstalledBundle(root); }
  catch (error) { return { ok: false, code: "invalid-override", reason: `explicit generation failed complete host-side admission: ${error.message}` }; }
  try {
    if (bundle.manifest.target !== hostTarget) throw new Error(`host target mismatch: expected ${hostTarget}, got ${bundle.manifest.target}`);
    const manifestSha256 = sha256(Buffer.from(contract.canonical(bundle.manifest) + "\n"));
    if (manifestSha256 !== expected.manifestSha256 || bundle.digest !== expected.digest) {
      throw new Error("independent trusted manifest SHA-256 / generation digest mismatch");
    }
    return { ok: true, generation: describeAdmittedGeneration(bundle, contract.canonical), bundle };
  }
  catch (error) { return { ok: false, code: "invalid-override", reason: `explicit generation identity is incomplete: ${error.message}` }; }
}

/** Revalidate the full generation immediately before any spawn. This narrows the
 * admission-to-spawn substitution window but does not atomically close it. */
export async function revalidateSemanticGeneration(generation, trustEnv = process.env) {
  if (!generation || typeof generation.root !== "string") throw new Error("no admitted semantic generation is available to revalidate");
  const admitted = await admitSemanticGeneration({ state: "explicit", root: generation.root }, trustEnv);
  if (!admitted.ok) throw new Error(`semantic generation revalidation failed: ${admitted.reason}`);
  const next = admitted.generation;
  // Includes all native identities, schema/target/version and parser version/root.
  if (!isDeepStrictEqual(next, generation)) throw new Error("semantic generation identity changed between admission and spawn");
  return next;
}

/** Validated descriptor for the maintained cases, or undefined when unavailable. */
export async function discoverGeneration(env = process.env) {
  const result = await admitSemanticGeneration(selectSemanticCandidate(env), env);
  return result.ok ? result.generation : undefined;
}

export async function inspectSemanticAdmission(env = process.env) {
  const result = await admitSemanticGeneration(selectSemanticCandidate(env), env);
  return result.ok ? { available: true, generation: result.generation } : { available: false, code: result.code, reason: result.reason };
}

export function semanticPrerequisite(detail) {
  const base = "real Fovea engine semantic baseline requires an explicitly supplied, completely admitted retained generation. " +
    `Set ${SEMANTIC_BUNDLE_ENV} to an absolute generation root (bundle-manifest schema 2, supported Darwin host target ${process.platform}-${process.arch}, tools/node, app/fovea/source-platform.node, app/fovea/source-platform.json, app/closure-manifest.json and tools/ast-grep 0.45.3). ` +
    `Separately supply trusted ${SEMANTIC_MANIFEST_ENV} and ${SEMANTIC_DIGEST_ENV}; candidate self-hashes are not trust anchors. ` +
    "Discovery is explicitly scoped: no real account home, install tree, credential or arbitrary temp-code search is performed. No fake/inert baseline is reported.";
  return detail ? `${base} Admission detail: ${detail}` : base;
}

/** Git-initialize a retained fixture workspace so host-enabled Git discovery
 * indexes the fixture itself instead of an enclosing repository. */
function initGitWorkspace(context, directory) {
  let last = "";
  for (const git of TRUSTED_GITS) {
    if (!fs.existsSync(git)) continue;
    const result = context.spawn(git, ["init", "-q", directory], { timeoutMs: 30000 });
    if (result.ok) return git;
    last = result.stderr || result.spawnError || "unknown failure";
  }
  throw new Error("semantic fixture requires a trusted git for its retained workspace: " + (last || "no trusted git found"));
}

/** Retained workspace under the case fixtures root with an exact Git boundary. */
export function createSemanticWorkspace(context, label, files) {
  const root = fs.mkdtempSync(path.join(context.fixturesRoot, `${SEMANTIC_PREFIX}-workspace-${label}-`));
  fs.chmodSync(root, 0o700);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, content, { mode: 0o600 });
  }
  const git = initGitWorkspace(context, root);
  return { root, git };
}

export function createPrivateDirectory(context, label) {
  const directory = fs.mkdtempSync(path.join(context.fixturesRoot, `${SEMANTIC_PREFIX}-${label}-`));
  fs.chmodSync(directory, 0o700);
  return directory;
}

/** esbuild-bundle the current checkout's engine entry and offline driver. */
export async function buildSemanticDriver(context, label) {
  const directory = createPrivateDirectory(context, `driver-${label}`);
  const root = context.root;
  const engineSource = `import ${JSON.stringify(path.join(root, "src/fovea/engine-entry.ts"))};\n`;
  const engineBuilt = await build({
    stdin: { contents: engineSource, resolveDir: root, loader: "ts" }, bundle: true, packages: "external",
    absWorkingDir: root, metafile: true,
    platform: "node", format: "esm", target: "node24", write: false, logLevel: "silent",
  });
  const engineFile = path.join(directory, "engine-entry.mjs");
  fs.writeFileSync(engineFile, engineBuilt.outputFiles[0].contents, { mode: 0o600, flag: "wx" });

  const driverBuilt = await build({
    stdin: { contents: semanticDriverSource(root), resolveDir: root, loader: "ts" }, bundle: true, packages: "external",
    absWorkingDir: root, metafile: true,
    platform: "node", format: "esm", target: "node24", write: false, logLevel: "silent",
  });
  const driverFile = path.join(directory, "driver.mjs");
  fs.writeFileSync(driverFile, driverBuilt.outputFiles[0].contents, { mode: 0o600, flag: "wx" });

  return {
    directory, driverFile, engineFile,
    // Post-build identity observations of all esbuild file inputs; external
    // packages and concurrent source-write races remain outside this evidence.
    buildInputs: Object.fromEntries([...new Set([...Object.keys(engineBuilt.metafile.inputs),
      ...Object.keys(driverBuilt.metafile.inputs)])].filter(file => file !== "<stdin>").sort()
      .map(file => [file, sha256(fs.readFileSync(path.resolve(root, file)))])),
    driverSha256: sha256(driverBuilt.outputFiles[0].contents),
    engineSha256: sha256(engineBuilt.outputFiles[0].contents),
  };
}

/** Source/build/parser identity bound at run time. */
export function semanticIdentity(context, generation, artifacts) {
  const files = ["package.json", "src/fovea/engine.ts", "src/fovea/host.ts", "src/fovea/core/sync.ts",
    "src/kiro/host-session-adapter.ts", "src/fovea/parser-executable.ts", "src/fovea/delivery.ts", "src/fovea/source-platform-native.c"];
  const source = {};
  for (const file of files) source[file] = sha256(fs.readFileSync(path.join(context.root, file)));
  return {
    generationDigest: generation.digest, generationTarget: generation.target,
    generationSchema: generation.schema, manifestSha256: generation.manifestSha256,
    admittedIdentities: generation.identities,
    installedCSourceSha256: generation.installedCSourceSha256,
    currentCSourceSha256: source["src/fovea/source-platform-native.c"],
    sameCSource: generation.installedCSourceSha256 === source["src/fovea/source-platform-native.c"],
    buildInputs: artifacts.buildInputs,
    limits: "AS02 detached settlement unqualified; AS03 current JS / installed C mixed-generation, not native qualification",
    parserSha256: generation.parser.sha256, parserVersion: generation.parser.version,
    driverSha256: artifacts.driverSha256, engineSha256: artifacts.engineSha256, source,
    qualification: "local real-engine semantic evidence only; not native model-input receipt provenance",
  };
}

function writeSemanticRequest(_context, artifacts, request) {
  const file = path.join(artifacts.directory, `request-${request.scenario}.json`);
  fs.writeFileSync(file, JSON.stringify(request, null, 2), { mode: 0o600, flag: "wx" });
  return file;
}

/** Run the offline driver under the admitted generation's Node. The complete
 * generation is revalidated immediately before spawn and the spawn uses only the
 * freshly validated descriptor. Validation and spawn are still separate
 * syscalls, so this narrows the admission-to-spawn substitution window without
 * atomically closing it; no OS containment is claimed absent executable
 * file-descriptor pinning of the candidate Node/parser/native. */
export async function runSemanticScenario(context, generation, artifacts, request, timeoutMs = 120000, trustEnv = process.env) {
  const fresh = await revalidateSemanticGeneration(generation, trustEnv);
  if (Object.hasOwn(request, "parser") && !isDeepStrictEqual(request.parser, fresh.parser)) {
    throw new Error("semantic request parser identity does not match freshly admitted parser");
  }
  // Publish only after validation, from fresh parser data rather than caller data.
  const finalRequest = { ...structuredClone(request), parser: { ...fresh.parser } };
  const requestFile = writeSemanticRequest(context, artifacts, finalRequest);
  // The write intervened: retain a full immediate pre-spawn identity/anchor check.
  const immediate = await revalidateSemanticGeneration(fresh, trustEnv);
  const result = context.spawn(immediate.node, [artifacts.driverFile, requestFile], { timeoutMs });
  if (!result.ok) throw new Error(`semantic driver failed: ${result.spawnError ?? result.stderr ?? result.code}`);
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch (error) { throw new Error(`semantic driver returned invalid JSON: ${String(error)}: ${result.stdout.slice(0, 400)}`); }
  if (!parsed || parsed.ok !== true || !parsed.out) throw new Error("semantic driver reported failure: " + JSON.stringify(parsed).slice(0, 800));
  return parsed.out;
}

function semanticDriverSource(root) {
  const enginePath = JSON.stringify(path.join(root, "src/fovea/engine.ts"));
  const hostPath = JSON.stringify(path.join(root, "src/fovea/host.ts"));
  const adapterPath = JSON.stringify(path.join(root, "src/kiro/host-session-adapter.ts"));
  const contextPath = JSON.stringify(path.join(root, "src/kiro/fovea-context.ts"));
  return [
    'import fs from "node:fs";',
    'import path from "node:path";',
    `import { FoveaEngine } from ${enginePath};`,
    `import { FoveaHost } from ${hostPath};`,
    `import { KiroHostSessionAdapter } from ${adapterPath};`,
    `import { FoveaResponseDelivery } from ${contextPath};`,
    '',
    'const req = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));',
    'const out = { scenario: req.scenario, runtime: { node: process.version, execPath: process.execPath } };',
    'const base = { conversationId: req.conversationId, conversationEpoch: 0, rootId: req.rootId, root: req.workspace, authorizationEpoch: 0 };',
    'const syncArgs = (extra) => ({ maxTokens: 512, scope: "repository", files: req.observed, ...(extra || {}) });',
    'const nullSig = "00000000-0000-0000-0000-000000000000";',
    'const reason = (error) => String(error && error.message ? error.message : error);',
    'let storageCounter = 0;',
    'function freshStorage() { const dir = path.join(req.storageRoot, "engine-" + (++storageCounter)); fs.mkdirSync(dir, { mode: 0o700 }); return dir; }',
    'async function withEngine(fn, parser) { const engine = new FoveaEngine({ parser: parser || req.parser, storageRoot: freshStorage() }); try { return await fn(engine); } finally { try { await engine.close(); } catch (error) { out.closeError = reason(error); } } }',
    'const sync = (engine, extra) => engine.query({ ...base, operation: "sync", args: syncArgs(extra) });',
    'const focus = (engine, extra) => engine.query({ ...base, operation: "focus", args: { query: "alpha", maxTokens: 512, ...(extra || {}) } });',
    'const commit = (engine, id) => engine.query({ ...base, operation: "sync", args: { commitPreparationId: id } });',
    'const attempt = (promise) => Promise.resolve(promise).then(value => ({ ok: value }), error => ({ error: reason(error) }));',
    '',
    'switch (req.scenario) {',
    '  case "engine-baseline": {',
    '    await withEngine(async (engine) => {',
    '      out.first = await sync(engine);',
    '      fs.rmSync(path.join(req.workspace, req.deleted));',
    '      out.second = await sync(engine);',
    '      out.wrongCommit = await attempt(commit(engine, nullSig));',
    '      out.commit = await commit(engine, out.second.syncPreparationId);',
    '      out.recommit = await attempt(commit(engine, out.second.syncPreparationId));',
    '      out.third = await sync(engine);',
    '    });',
    '    break;',
    '  }',
    '  case "engine-superseded": {',
    '    await withEngine(async (engine) => {',
    '      out.first = await sync(engine);',
    '      fs.rmSync(path.join(req.workspace, req.deleted));',
    '      out.prepared1 = await sync(engine);',
    '      fs.rmSync(path.join(req.workspace, req.deleted2));',
    '      out.prepared2 = await sync(engine);',
    '      out.staleCommit = await attempt(commit(engine, out.prepared1.syncPreparationId));',
    '      out.freshCommit = await commit(engine, out.prepared2.syncPreparationId);',
    '    });',
    '    break;',
    '  }',
    '  case "engine-focus": {',
    '    await withEngine(async (engine) => {',
    '      out.first = await sync(engine);',
    '      out.focus1 = await focus(engine);',
    '      fs.rmSync(path.join(req.workspace, req.deleted));',
    '      out.prepared = await sync(engine);',
    '      out.focus2 = await focus(engine, { fresh: true });',
    '      out.commit = await commit(engine, out.prepared.syncPreparationId);',
    '      out.dwell = await engine.query({ ...base, operation: "dwell", args: { factor: 2, maxTokens: 512 } });',
    '    });',
    '    break;',
    '  }',
    '  case "engine-negative-control": {',
    '    await withEngine(async (engine) => {',
    '      out.first = await sync(engine);',
    '      fs.appendFileSync(path.join(req.workspace, "alpha.ts"), "// comment-only change\\n");',
    '      out.commentOnly = await sync(engine);',
    '      fs.rmSync(path.join(req.workspace, req.deleted));',
    '      out.deletion = await sync(engine);',
    '    });',
    '    break;',
    '  }',
    '  case "engine-identity-control": {',
    '    await withEngine(async (engine) => {',
    '      const tampered = { ...req.parser, sha256: "0".repeat(64) };',
    '      const bad = new FoveaEngine({ parser: tampered, storageRoot: freshStorage() });',
    '      out.tampered = await attempt(bad.query({ ...base, operation: "sync", args: syncArgs() }));',
    '      try { await bad.close(); } catch (error) { out.tamperedCloseError = reason(error); }',
    '      out.valid = await sync(engine);',
    '    });',
    '    break;',
    '  }',
    '  case "host-receipt": {',
    '    await runHost(false);',
    '    break;',
    '  }',
    '  case "host-ack-failure": {',
    '    await runHost(true);',
    '    break;',
    '  }',
    '  default: throw new Error("unknown semantic scenario: " + req.scenario);',
    '}',
    '',
    'async function runHost(failFirstAck) {',
    '  const host = new FoveaHost({ dataRoot: req.dataRoot, configFile: req.configFile, parser: req.parser, entrypoint: req.engineEntry });',
    '  const stat = fs.statSync(req.workspace, { bigint: true });',
    '  const client = host.bind({ canonicalPath: req.workspace, deviceId: String(stat.dev), fileId: String(stat.ino), conversationId: req.conversationId, conversationEpoch: 0, authorizationEpoch: 0 });',
    '  const invocation = { cwd: req.workspace };',
    '  const adapter = new KiroHostSessionAdapter();',
    '  adapter.attach(async () => {});',
    '  const delivery = new FoveaResponseDelivery();',
    '  const workspaceContext = { current: async () => ({ status: "verified", roots: [] }), invalidate() {} };',
    '  try {',
    '    client.observer.observe({ phase: "access", paths: req.observed });',
    '    out.baseline = await client.invoke("sync", {}, invocation);',
    '    fs.rmSync(path.join(req.workspace, req.deleted));',
    '    const claim = await client.collectContext(invocation, 4096);',
    '    if (!claim) throw new Error("real host produced no delivery claim; semantic baseline did not detect the source change");',
    '    out.claim = { noticeId: claim.notices[0].noticeId, text: claim.notices[0].text, origin: claim.notices[0].origin };',
    '    const session = adapter.openSession({ conversationId: req.conversationId, conversationEpoch: 0, workspaceContext });',
    '    const turn = adapter.beginTurn(session);',
    '    let acknowledgements = 0;',
    '    const bound = adapter.bindDelivery(turn, claim, async id => {',
    '      acknowledgements += 1;',
    '      if (failFirstAck && acknowledgements === 1) throw new Error("simulated receipt failure");',
    '      return client.acknowledgeDelivery(id, invocation);',
    '    });',
    '    out.bound = !!bound;',
    '    out.preAck = await adapter.acknowledgeModelInput(turn, claim.notices[0].noticeId);',
    '    out.tracked = delivery.track(7, bound, turn.signal, "original output");',
    '    await delivery.send({ id: 7, result: { content: [{ type: "text", text: "original output" }] } }, async () => {});',
    '    out.emitted = (await client.invoke("status", {}, invocation)).notices.emitted;',
    '    if (failFirstAck) {',
    '      out.failedAck = await attempt(adapter.acknowledgeModelInput(turn, claim.notices[0].noticeId));',
    '      out.retainedAfterFailure = (await client.invoke("status", {}, invocation)).notices.emitted;',
    '      out.autoRetry = await adapter.acknowledgeModelInput(turn, claim.notices[0].noticeId);',
    '      out.acknowledgementsAfterFailure = acknowledgements;',
    '      out.explicitRetry = await attempt(client.acknowledgeDelivery(claim.notices[0].noticeId, invocation));',
    '    } else {',
    '      out.ack = await adapter.acknowledgeModelInput(turn, claim.notices[0].noticeId);',
    '      out.duplicate = await adapter.acknowledgeModelInput(turn, claim.notices[0].noticeId);',
    '      out.foreign = await adapter.acknowledgeModelInput(adapter.beginTurn(session), claim.notices[0].noticeId);',
    '      const ended = adapter.beginTurn(session); adapter.endTurn(ended);',
    '      out.stale = await attempt(adapter.acknowledgeModelInput(ended, claim.notices[0].noticeId));',
    '      out.secondAck = await attempt(client.acknowledgeDelivery(claim.notices[0].noticeId, invocation));',
    '    }',
    '    out.acknowledgements = acknowledgements;',
    '    out.finalNotices = (await client.invoke("status", {}, invocation)).notices;',
    '    out.status = await client.invoke("status", {}, invocation);',
    '    await adapter.close();',
    '  } finally {',
    '    try { delivery.close(); } catch (error) { out.deliveryClose = reason(error); }',
    '    try { await client.close(); } catch (error) { out.clientClose = reason(error); }',
    '    try { await adapter.close(); } catch (error) { out.adapterClose = reason(error); }',
    '    try { await host.close(); } catch (error) { out.hostClose = reason(error); }',
    '  }',
    '}',
    '',
    'console.log(JSON.stringify({ ok: true, out }));',
  ].join("\n");
}
