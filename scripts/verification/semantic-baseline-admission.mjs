// Maintained decision-only semantic admission controls, not FN/native qualification.
// No candidate execution, Git initialization, build or cleanup. All fixtures remain.
// Run under a harness that blocks child_process and process.dlopen before import.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  SEMANTIC_BUNDLE_ENV, SEMANTIC_MANIFEST_ENV, SEMANTIC_DIGEST_ENV,
  selectSemanticCandidate, admitSemanticGeneration, inspectSemanticAdmission,
  discoverGeneration, revalidateSemanticGeneration, runSemanticScenario,
} from "./semantic-baseline-fixture.mjs";
import { canonical, compatibilityFor, createBundleManifest, FOVEA_REQUIRED_APP,
  validateInstalledBundle } from "../../src/installation/bundle-contract.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
function directory(parent, label) {
  const root = fs.mkdtempSync(path.join(parent, "admission-" + label + "-"));
  fs.chmodSync(root, 0o700);
  return root;
}

/** Retained copy, no subprocess/cleanup. Reflink when supported, otherwise copy. */
function cloneRetainedGeneration(source, parent, label) {
  const destination = path.join(directory(parent, "clone-" + label), "generation");
  // fs.cpSync creates directories with default modes on this Node/macOS.
  // Materialize only the validated inventory with explicit private directories.
  const manifest = JSON.parse(fs.readFileSync(path.join(source, "bundle-manifest.json"), "utf8"));
  fs.mkdirSync(destination, { mode: 0o700 });
  for (const relative of ["bundle-manifest.json", ...manifest.inventory.map(entry => entry.path)]) {
    if (typeof relative !== "string" || relative.split("/").some(part => !part || part === "." || part === "..") || path.isAbsolute(relative)) {
      throw new Error("unsafe retained clone member");
    }
    const file = path.join(destination, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.copyFileSync(path.join(source, relative), file, fs.constants.COPYFILE_FICLONE | fs.constants.COPYFILE_EXCL);
  }
  return destination;
}

/** Legacy malformed-shape control, retained in addition to the complete fixture. */
function createInertCounterfeitCandidate(parent, _markerPath = undefined) {
  const root = directory(parent, "malformed");
  fs.writeFileSync(path.join(root, "bundle-manifest.json"), '{"schema":3}', { mode: 0o600, flag: "wx" });
  return root;
}

/** Complete schema-2 counterfeit DATA. Strict constructor and validator accept
 * its self-consistency, not its authenticity. Never execute any member.
 * template is used for public pin claims only, NEVER for expected trust anchors. */
async function createCompleteCounterfeitCandidate(parent, template, target = template.target) {
  const root = directory(parent, "complete-counterfeit");
  const m = structuredClone(template);
  m.target = target;
  m.compatibility = compatibilityFor(target, 2);
  m.provenance = { kind: "local-source", sourceDigest: sha256("inert semantic control"), gitHead: null, dirty: true };
  if (target !== template.target) {
    const triples = { "darwin-arm64": "aarch64-apple-darwin", "darwin-x64": "x86_64-apple-darwin" };
    const replace = value => value.replaceAll(template.target, target).replaceAll(triples[template.target], triples[target]);
    for (const pin of Object.values(m.tools)) {
      pin.url = replace(pin.url);
      if (pin.checksumUrl) pin.checksumUrl = replace(pin.checksumUrl);
      for (const member of pin.members) member.member = replace(member.member);
    }
  }
  const native = Buffer.alloc(32);
  native.writeUInt32LE(0xfeedfacf, 0);
  native.writeUInt32LE(target.endsWith("arm64") ? 0x0100000c : 0x01000007, 4);
  native.writeUInt32LE(8, 12);
  const sourceSha256 = sha256("inert C source claim");
  const metadata = { schemaVersion: 1, abiVersion: 1, platform: "darwin", arch: target.split("-")[1], minimumMacOS: "13.5", sourceSha256, sha256: sha256(native) };
  const entries = [...new Set([...FOVEA_REQUIRED_APP, ...template.inventory.filter(e => !e.path.startsWith("app/")).map(e => e.path),
    "app/fovea/source-platform.node", "app/fovea/source-platform.json"])];
  for (const relative of entries) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const bytes = relative === "app/fovea/source-platform.node" ? native
      : relative === "app/fovea/source-platform.json" ? JSON.stringify(metadata)
      : relative === "app/closure-manifest.json" ? JSON.stringify({ buildInputs: { files: [{ path: "src/fovea/source-platform-native.c", sha256: sourceSha256 }] } })
      : relative.startsWith("tools/") ? "#!/bin/sh\nexit 0\n" : "inert semantic admission data\n";
    fs.writeFileSync(file, bytes, { mode: relative.startsWith("tools/") ? 0o700 : 0o600, flag: "wx" });
  }
  for (const pin of Object.values(m.tools)) for (const member of pin.members) {
    const bytes = fs.readFileSync(path.join(root, member.path));
    member.size = bytes.length;
    member.sha256 = sha256(bytes);
  }
  const manifest = await createBundleManifest(root, m);
  fs.writeFileSync(path.join(root, "bundle-manifest.json"), canonical(manifest) + "\n", { mode: 0o600, flag: "wx" });
  await validateInstalledBundle(root); // Prove FULL self-consistency, read-only.
  return { root, manifest };
}

/** @param {{fixturesRoot?:string, env?:Record<string,string|undefined>, homeHint?:string,
 * checkoutRoot?:string, expectedDigest?:string, only?:string[]}} [options] */
export async function runSemanticAdmissionChecks(options = {}) {
  const parent = options.fixturesRoot;
  if (typeof parent !== "string" || !fs.existsSync(parent)) throw new Error("semantic admission checks require an existing retained fixtures root");
  const env = options.env ?? process.env;
  const candidate = selectSemanticCandidate(env);
  const withRoot = root => ({ ...env, [SEMANTIC_BUNDLE_ENV]: root });
  const checks = {};
  const spawnCalls = [];
  const run = async (name, fn) => {
    if (options.only && !options.only.includes(name)) return;
    try {
      const facts = await fn();
      checks[name] = facts?.skipped ? { ok: false, status: "skipped", facts } : { ok: true, status: "passed", facts };
    } catch (error) { checks[name] = { ok: false, status: "failed", error: error instanceof Error ? error.message : String(error) }; }
  };
  const rejectAdmission = async (input, pattern) => {
    const result = await inspectSemanticAdmission(input);
    assert.equal(result.available, false, "candidate must be unavailable before any spawn");
    assert.match(result.reason, pattern);
    assert.equal(await discoverGeneration(input), undefined, "no runnable descriptor may be published");
    return result;
  };
  const recordRun = async (generation, request, trustEnv = env, afterWrite = undefined) => {
    const own = directory(parent, "request");
    const calls = [];
    const context = { fixturesRoot: parent, root: options.checkoutRoot, spawn(command, args) {
      const call = { command, args, request: JSON.parse(fs.readFileSync(args[1], "utf8")) };
      calls.push(call); spawnCalls.push(call);
      return { ok: false, spawnError: "SEMANTIC_RECORDER_NOT_EXECUTED" };
    } };
    // Optional synchronous, task-owned mutation exactly after request publication.
    const write = fs.writeFileSync;
    if (afterWrite) fs.writeFileSync = function(file, ...args) {
      const result = write.call(fs, file, ...args);
      if (String(file).startsWith(own + path.sep)) afterWrite();
      return result;
    };
    let error;
    try { await runSemanticScenario(context, generation, { directory: own, driverFile: path.join(own, "never-executed.mjs") }, request, 120000, trustEnv); }
    catch (failure) { error = failure.message; }
    finally { fs.writeFileSync = write; }
    return { calls, error, requests: fs.readdirSync(own), directory: own };
  };
  const rejectRun = async (generation, request, pattern, trustEnv = env) => {
    const result = await recordRun(generation, request, trustEnv);
    assert.equal(result.calls.length, 0, "rejection must precede intercepted spawn");
    assert.equal(result.requests.length, 0, "failed initial validation must not publish a request");
    assert.match(result.error, pattern);
    return result;
  };

  await run("unset-is-unavailable", () => rejectAdmission({}, /not set/));
  await run("no-home-fallback", () => rejectAdmission({ HOME: options.homeHint, KIRO_HOME: options.homeHint }, /not set/));
  for (const [name, value, pattern] of [["empty", "", /not set/], ["relative", "relative/generation", /absolute/],
    ["NUL", "/invalid\0path", /absolute/]]) {
    await run(name + "-override-unavailable", () => rejectAdmission(withRoot(value), pattern));
  }
  const positive = await admitSemanticGeneration(candidate, env);
  const needsPositive = () => ({ skipped: "requires explicit positive root AND separately supplied trusted manifest SHA-256 and generation digest", admission: positive.reason });
  await run("positive-read-only-admission", async () => {
    if (candidate.state !== "explicit") return needsPositive();
    assert.equal(positive.ok, true, positive.reason);
    const generation = positive.generation;
    assert.equal(generation.manifestSha256, env[SEMANTIC_MANIFEST_ENV]);
    assert.equal(generation.digest, env[SEMANTIC_DIGEST_ENV]);
    if (options.expectedDigest) assert.equal(generation.digest, options.expectedDigest);
    assert.equal(generation.target, `${process.platform}-${process.arch}`);
    assert.deepEqual(await revalidateSemanticGeneration(generation, env), generation);
    return { generation, readOnly: true };
  });
  for (const key of [SEMANTIC_MANIFEST_ENV, SEMANTIC_DIGEST_ENV]) {
    for (const [name, value] of [["missing", undefined], ["malformed", "bad"], ["wrong", "0".repeat(64)]]) {
      await run(`${key}-${name}`, async () => {
        if (!positive.ok) return needsPositive();
        const input = { ...env, [key]: value };
        const admission = await rejectAdmission(input, name === "wrong" ? /trusted.*mismatch/ : /separately trusted/);
        const preSpawn = await rejectRun(positive.generation, { scenario: "control" }, /revalidation failed/, input);
        return { admission, preSpawn };
      });
    }
  }
  await run("missing-absolute-override", async () => {
    if (!positive.ok) return needsPositive();
    return rejectAdmission(withRoot(path.join(parent, "does-not-exist")), /not readable/);
  });
  await run("malformed-counterfeit", async () => {
    if (!positive.ok) return needsPositive();
    return rejectAdmission(withRoot(createInertCounterfeitCandidate(parent)), /admission/);
  });
  let counterfeit;
  await run("FULL-self-consistent-counterfeit", async () => {
    if (!positive.ok) return needsPositive();
    counterfeit = await createCompleteCounterfeitCandidate(parent, positive.bundle.manifest);
    const result = await rejectAdmission(withRoot(counterfeit.root), /independent trusted.*mismatch/);
    const forged = { ...structuredClone(positive.generation), root: counterfeit.root };
    const preSpawn = await rejectRun(forged, { scenario: "control" }, /independent trusted.*mismatch/);
    return { root: counterfeit.root, selfConsistentDigest: counterfeit.manifest.digest, result, preSpawn };
  });
  await run("FULL-rehashed-foreign-target", async () => {
    if (!positive.ok) return needsPositive();
    const foreign = await createCompleteCounterfeitCandidate(parent, positive.bundle.manifest, process.arch === "arm64" ? "darwin-x64" : "darwin-arm64");
    // Still supply the independent genuine anchors. The host gate precedes the
    // hash gate, so this specifically witnesses wrong-target pre-execution refusal.
    const result = await rejectAdmission(withRoot(foreign.root), /host target mismatch/);
    const preSpawn = await rejectRun({ ...positive.generation, root: foreign.root }, { scenario: "control" }, /host target mismatch/);
    return { root: foreign.root, selfConsistentDigest: foreign.manifest.digest, result, preSpawn };
  });
  await run("symlink-alias", async () => {
    if (!positive.ok) return needsPositive();
    const alias = path.join(directory(parent, "alias"), "generation");
    fs.symlinkSync(positive.generation.root, alias);
    return rejectAdmission(withRoot(alias), /not a symlink/);
  });
  for (const relative of ["tools/node", "tools/ast-grep", "app/fovea/source-platform.node", "app/fovea/source-platform.json", "app/closure-manifest.json"]) {
    await run("modified-" + relative, async () => {
      if (!positive.ok) return needsPositive();
      const root = cloneRetainedGeneration(positive.generation.root, parent, "modified");
      const intact = await inspectSemanticAdmission(withRoot(root));
      assert.equal(intact.available, true, `intact clone prerequisite: ${intact.reason}`);
      fs.appendFileSync(path.join(root, relative), "\n");
      return rejectAdmission(withRoot(root), relative === "app/fovea/source-platform.node"
        ? /Native source artifact identity mismatch/ : /inventory mismatch/i);
    });
  }
  const fields = ["root", "digest", "schema", "target", "version", "node", "manifestSha256", "installedCSourceSha256"];
  const parserFields = ["path", "sha256", "version", "generationRoot"];
  if (positive.ok) fields.push(...Object.keys(positive.generation.identities).map(key => "identities:" + key));
  for (const field of [...fields, ...parserFields.map(key => "parser:" + key)]) {
    await run("forged-generation/" + field, async () => {
      if (!positive.ok) return needsPositive();
      const forged = structuredClone(positive.generation);
      const [group, key] = field.split(":");
      if (key) forged[group][key] = "forged";
      else forged[field] = field === "root" ? counterfeit?.root ?? parent : field === "schema" ? 1 : "forged";
      return rejectRun(forged, { scenario: "control", parser: positive.generation.parser }, /identity|revalidation/);
    });
  }
  for (const field of [...parserFields, "all", "extra", "null"]) {
    await run("independent-request-parser/" + field, async () => {
      if (!positive.ok) return needsPositive();
      const parser = field === "null" ? null : { ...positive.generation.parser };
      if (field === "all") Object.assign(parser, { path: path.join(counterfeit.root, "tools/ast-grep"), generationRoot: counterfeit.root, version: "0.45.3", sha256: sha256(fs.readFileSync(path.join(counterfeit.root, "tools/ast-grep"))) });
      else if (parser) parser[field] = "forged";
      return rejectRun(positive.generation, { scenario: "control", parser }, /request parser identity/);
    });
  }
  await run("changed-node-before-request", async () => {
    if (!positive.ok) return needsPositive();
    const root = cloneRetainedGeneration(positive.generation.root, parent, "stale");
    const generation = await discoverGeneration(withRoot(root));
    assert.ok(generation, (await inspectSemanticAdmission(withRoot(root))).reason);
    fs.appendFileSync(path.join(root, "tools/node"), "\n");
    return rejectRun(generation, { scenario: "control" }, /revalidation failed/);
  });
  await run("changed-node-after-request-before-spawn", async () => {
    if (!positive.ok) return needsPositive();
    const root = cloneRetainedGeneration(positive.generation.root, parent, "immediate");
    const generation = await discoverGeneration(withRoot(root));
    assert.ok(generation, (await inspectSemanticAdmission(withRoot(root))).reason);
    const result = await recordRun(generation, { scenario: "control" }, env, () => fs.appendFileSync(path.join(root, "tools/node"), "\n"));
    assert.equal(result.calls.length, 0, "post-write identity change must not reach spawn");
    assert.equal(result.requests.length, 1, "control must reach request publication before mutation");
    assert.match(result.error, /revalidation failed/);
    return result;
  });
  for (const key of [SEMANTIC_MANIFEST_ENV, SEMANTIC_DIGEST_ENV]) {
    await run("anchor-changed-after-request/" + key, async () => {
      if (!positive.ok) return needsPositive();
      const trustEnv = { ...env };
      const result = await recordRun(positive.generation, { scenario: "control" }, trustEnv, () => { trustEnv[key] = "0".repeat(64); });
      assert.equal(result.calls.length, 0, "post-write anchor change must not reach spawn");
      assert.equal(result.requests.length, 1, "anchor control must reach request publication");
      assert.match(result.error, /revalidation failed:.*independent trusted.*mismatch/);
      return result;
    });
  }
  for (const suppliedParser of [false, true]) {
    await run("positive-recorder-fresh-parser-" + suppliedParser, async () => {
      if (!positive.ok) return needsPositive();
      const request = { scenario: "control", ...(suppliedParser ? { parser: { ...positive.generation.parser } } : {}) };
      const result = await recordRun(positive.generation, request);
      assert.equal(result.calls.length, 1, "genuine admission reaches recorder exactly once");
      assert.equal(result.calls[0].command, positive.generation.node);
      assert.deepEqual(result.calls[0].request.parser, positive.generation.parser);
      assert.equal(result.error, "semantic driver failed: SEMANTIC_RECORDER_NOT_EXECUTED");
      return result;
    });
  }
  const count = status => Object.values(checks).filter(check => check.status === status).length;
  return { schemaVersion: 2, qualification: false, explicitOverride: candidate.state,
    counts: { passed: count("passed"), failed: count("failed"), skipped: count("skipped") },
    selectedControls: options.only ?? null,
    spawnCalls, checks, ok: Object.keys(checks).length > 0 &&
      (!options.only || options.only.every(name => Object.hasOwn(checks, name))) &&
      Object.values(checks).every(check => check.status === "passed"),
    limits: ["recorder-only, no FN/native execution", "AS02 detached settlement unqualified", "AS03 current JS / installed C mixed-generation"] };
}
