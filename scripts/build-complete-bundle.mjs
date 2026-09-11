import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { acquirePrivateTools, verifyPrivateToolCache } from "./build-private-tools.mjs";
import { canonical, createBundleManifest, validateBundle, sha256, checkToolPins } from "./bundle-contract.mjs";
import { writeBundleArchive } from "./bundle-archive.mjs";
import { detectInstallerPlatform, compatibilityFor, assertUnprivilegedInstaller } from "./installer-platform.mjs";
import { captureBuildInputs, validateBuildInputProvenance, verifyBuildClosure, verifyClosureIntegrity, verifyBuildCapture, verifyCapturedInputs } from "./build-inputs.mjs";
import { artifactRecords, artifactKind, cacheDirectory, exists, privateDirectory, publishCacheJson, readCacheJson, recordInstallerArtifact, withInstallerArtifactLease } from "./installer-artifacts.mjs";

const mappings = [["skills/fabric-exec", "resources/skills/fabric-exec"], ["resources/steering/fabric.md", "resources/steering/fabric.md"]];
const defaultRoot = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function copyClosure(source, target) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) throw new Error("Unsafe source closure ownership");
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { mode: 0o700 });
    for (const name of fs.readdirSync(source).sort()) copyClosure(path.join(source, name), path.join(target, name));
  } else {
    if (!stat.isFile() || stat.nlink !== 1) throw new Error("Unsupported source closure entry");
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); fs.chmodSync(target, 0o600);
  }
}
export function sourceProvenance(root) {
  const git = args => execFileSync("git", args, { cwd: root, env: { PATH: process.env.PATH, LANG: "C", GIT_OPTIONAL_LOCKS: "0" }, encoding: "utf8", timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  const head = git(["rev-parse", "HEAD"]).trim();
  if (!/^[a-f0-9]{40}$/u.test(head)) throw new Error("Cannot establish source Git identity");
  return { kind: "local-source", sourceDigest: captureBuildInputs(root).digest, gitHead: head, dirty: git(["status", "--porcelain", "-z"]).length > 0 };
}
async function compileManager(root, outfile) {
  // Source bootstrap (including reuse lookup) remains built-in-only until a miss.
  const { build } = await import("esbuild");
  const result = await build({ entryPoints: [path.join(root, "scripts", "install-manager.mjs")], outfile, bundle: true, platform: "node", format: "esm", target: "node24", splitting: false, sourcemap: false, metafile: true, logLevel: "silent" });
  for (const input of Object.keys(result.metafile.inputs)) if (input.includes("node_modules/") || /(?:^|\/)tests\//u.test(input)) throw new Error("Installed manager must contain only reviewed built-in-only implementation modules");
  fs.chmodSync(outfile, 0o600);
}
const dependencies = { provenance: sourceProvenance, compileManager, acquireTools: acquirePrivateTools };
function contextFor(root, target, initialBuild, deps) {
  target ??= detectInstallerPlatform().target;
  if (!["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"].includes(target)) throw new Error("Unsupported bundle target");
  const provenance = deps.provenance(root), rawToolchain = fs.readFileSync(path.join(root, "build-toolchain.json"));
  const pins = JSON.parse(rawToolchain.toString("utf8")).targets[target]; checkToolPins(pins, undefined, target);
  const identity = { schema: 1, inputs: initialBuild.buildInputs.digest, closure: sha256(fs.readFileSync(path.join(root, "dist/kiro-agent-closure/closure-manifest.json"))), toolchain: sha256(rawToolchain), target,
    host: { node: process.version, platform: process.platform, arch: process.arch }, provenance };
  if (provenance.sourceDigest !== identity.inputs) throw new Error("Source changed during bundle lookup");
  return { root, target, initialBuild, provenance, pins, identity, deps };
}
const equal = (a, b) => canonical(a) === canonical(b);
/** Validate the pointer even on a miss: corruption cannot disappear behind rebuild. */
export async function validateActiveCompleteBundle(parent) {
  const pointer = path.join(parent, "complete-bundle.json");
  if (!exists(pointer)) return null;
  const previous = await readCacheJson(pointer), name = path.basename(previous?.root ?? "");
  if (artifactKind(name) !== "bundle" || previous.root !== path.join(parent, name) || name !== `kiro-fabric-bundle-${previous.target}-${previous.digest}`) throw new Error("Unsafe complete-bundle pointer; preserve and inspect it");
  const verified = await validateBundle(previous.root);
  if (verified.digest !== previous.digest || verified.manifest.target !== previous.target || !equal(verified.manifest.provenance, previous.provenance)) throw new Error("Active complete bundle drifted; preserve and inspect it");
  return verified;
}
function verifySelected(context, verified) {
  const { root, target, initialBuild, provenance, pins } = context;
  if (path.basename(verified.root) !== `kiro-fabric-bundle-${verified.manifest.target}-${verified.digest}`) throw new Error("Digest-named bundle identity conflict");
  if (verified.manifest.target !== target || !equal(verified.manifest.tools, pins) || !equal(verified.manifest.provenance, provenance)) throw new Error("Bundle reuse record does not match selected bytes");
  verifyBuildCapture(root, path.join(verified.root, "app"), initialBuild);
  if (sha256(fs.readFileSync(path.join(verified.root, "app/closure-manifest.json"))) !== context.identity.closure) throw new Error("Selected closure manifest bytes differ from reuse inputs");
  verifyCapturedInputs(verified.root, initialBuild, mappings);
}
function verifyBoundary(context) {
  verifyBuildCapture(context.root, path.join(context.root, "dist/kiro-agent-closure"), context.initialBuild);
  if (sha256(fs.readFileSync(path.join(context.root, "dist/kiro-agent-closure/closure-manifest.json"))) !== context.identity.closure) throw new Error("Closure manifest changed during capture");
  if (!equal(context.deps.provenance(context.root), context.provenance)) throw new Error("Source changed during bundle capture");
}
async function lookup(context, parent, active) {
  const cache = path.join(parent, `private-tools-${sha256(canonical(context.pins))}`);
  if (exists(cache)) await verifyPrivateToolCache(cache, context.pins, context.target);
  // Records select candidates only. No timestamp/hash index is a trust authority.
  for (const record of await artifactRecords(parent, "bundle")) {
    if (!equal(record.identity, context.identity)) continue;
    const destination = path.join(parent, record.generation);
    const verified = active?.root === destination ? active : await validateBundle(destination);
    if (verified.digest !== record.digest) throw new Error("Existing bundle identity conflict");
    verifySelected(context, verified); verifyBoundary(context);
    return verified;
  }
  return null;
}
function resultFor(context, verified, archive, reused) {
  return { root: verified.root, digest: verified.digest, version: verified.version, target: context.target, bytes: verified.bytes, archive,
    provenance: verified.manifest.provenance, reused, qualification: "local-source; native full-bundle qualification pending" };
}
async function publish(context, parent, selected, archiveRequested, reused) {
  // Independent publication validation remains on both fresh and reused paths.
  const verified = await validateBundle(selected.root);
  if (verified.digest !== selected.digest) throw new Error("Selected bundle changed before publication");
  verifySelected(context, verified); verifyBoundary(context);
  let archive = null;
  if (archiveRequested) {
    archive = path.join(parent, `kiro-fabric-${context.target}.tar.gz`);
    const pending = path.join(parent, `.archive-${randomBytes(16).toString("hex")}.tar.gz`);
    let pendingIdentity;
    try {
      await writeBundleArchive(verified.root, pending);
      pendingIdentity = fs.lstatSync(pending);
      verifyBoundary(context); // source drift must refuse BEFORE archive publication
      if (exists(archive)) { const s = fs.lstatSync(archive); if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.uid !== process.getuid?.()) throw new Error("Unsafe previous development archive"); }
      fs.renameSync(pending, archive);
    } finally {
      // The writer cleans failed captures itself. Do not erase replaced/unsafe
      // pending-file evidence it deliberately preserved. After success, clean
      // only the same private inode if the checkout publication check failed.
      if (pendingIdentity && exists(pending)) {
        const now = fs.lstatSync(pending);
        if (now.isFile() && now.nlink === 1 && now.dev === pendingIdentity.dev && now.ino === pendingIdentity.ino && now.mode === pendingIdentity.mode && now.uid === pendingIdentity.uid && now.size === pendingIdentity.size && now.mtimeMs === pendingIdentity.mtimeMs && now.ctimeMs === pendingIdentity.ctimeMs) fs.unlinkSync(pending);
      }
    }
  }
  const result = resultFor(context, verified, archive, reused);
  await recordInstallerArtifact(parent, { schema: 1, kind: "bundle", generation: path.basename(verified.root), digest: verified.digest, identity: context.identity });
  await publishCacheJson(path.join(parent, "complete-bundle.json"), result);
  const published = await validateBundle(result.root);
  if (published.digest !== verified.digest) throw new Error("Published complete bundle changed");
  verifyBoundary(context);
  return result;
}
/** Source frontend fast path, BEFORE pnpm install/build. Built-in-only; never
 * downloads, compiles, copies, archives or creates a generation. Requires an
 * intact dist/kiro-agent-closure with current buildInputs, matching host Node,
 * target/toolchain/pins, Git HEAD AND dirty state, and a recorded validated bundle.
 * Returns null for absent/stale inputs (caller may build); corruption THROWS.
 * Hold withInstallerArtifactLease(root, async () => { lookup/build/activate })
 * around the ENTIRE use of the returned root. The inner lookup lease alone ends
 * on return and does not protect a later activation. Result.archive is null. */
export async function findReusableSourceBundle(options = {}) {
  return findReusableSourceBundleForTest(options, dependencies);
}
/** Internal fixture seam; not selectable by CLI/environment. */
export async function findReusableSourceBundleForTest(options, deps) {
  assertUnprivilegedInstaller();
  const root = fs.realpathSync(options.root ?? defaultRoot()), parent = cacheDirectory(root);
  if (!parent) return null;
  return withInstallerArtifactLease(root, async () => {
    const active = await validateActiveCompleteBundle(parent);
    const closure = path.join(root, "dist/kiro-agent-closure");
    if (!exists(closure)) return null;
    const initialBuild = verifyClosureIntegrity(closure);
    validateBuildInputProvenance(initialBuild.buildInputs);
    if (captureBuildInputs(root).digest !== initialBuild.buildInputs.digest) return null;
    verifyBuildClosure(root); // validate provenance shape, not just its claimed digest
    const context = contextFor(root, options.target, initialBuild, deps);
    const selected = await lookup(context, parent, active);
    return selected ? publish(context, parent, selected, false, true) : null;
  });
}
/** Already-built closure entrypoint. archive:false avoids unused source archives;
 * explicit/default archive generation always uses deterministic bundle-archive. */
export async function buildCompleteBundle(options = {}) {
  return buildCompleteBundleForTest(options, dependencies);
}
/** Internal fixture seam; only dependencies vary, all validation/publication runs. */
export async function buildCompleteBundleForTest(options, deps) {
  assertUnprivilegedInstaller();
  const root = fs.realpathSync(options.root ?? defaultRoot());
  const initialBuild = verifyBuildClosure(root); // fail BEFORE creating .tmp/acquiring
  const context = contextFor(root, options.target, initialBuild, deps);
  return withInstallerArtifactLease(root, async () => {
    const parent = cacheDirectory(root, true), active = await validateActiveCompleteBundle(parent);
    const reused = await lookup(context, parent, active);
    if (reused) return publish(context, parent, reused, options.archive !== false, true);
    const pins = context.pins, cache = path.join(parent, `private-tools-${sha256(canonical(pins))}`);
    if (!exists(cache)) {
      const acquiring = path.join(parent, `.private-tools-${randomBytes(16).toString("hex")}`);
      fs.mkdirSync(acquiring, { mode: 0o700 });
      try {
        await deps.acquireTools(context.target, acquiring, root); await verifyPrivateToolCache(acquiring, pins, context.target);
        if (exists(cache)) await verifyPrivateToolCache(cache, pins, context.target);
        else fs.renameSync(acquiring, cache);
      } finally { if (exists(acquiring)) fs.rmSync(acquiring, { recursive: true }); }
    }
    await verifyPrivateToolCache(cache, pins, context.target);
    await recordInstallerArtifact(parent, { schema: 1, kind: "tools", generation: path.basename(cache), digest: sha256(canonical(pins)), identity: { target: context.target, pins } });
    const staging = path.join(parent, `.complete-bundle-${randomBytes(16).toString("hex")}`);
    fs.mkdirSync(staging, { mode: 0o700 });
    try {
      copyClosure(path.join(root, "dist/kiro-agent-closure"), path.join(staging, "app"));
      for (const tool of ["node", "rg"]) for (const member of pins[tool].members) {
        const file = path.join(staging, member.path);
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.copyFileSync(path.join(cache, member.path), file, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(file, member.path === `tools/${tool}` ? 0o700 : 0o600);
      }
      fs.mkdirSync(path.join(staging, "manager"), { mode: 0o700 });
      await deps.compileManager(root, path.join(staging, "manager/install-manager.mjs"));
      fs.mkdirSync(path.join(staging, "resources/skills"), { recursive: true, mode: 0o700 });
      copyClosure(path.join(root, "skills/fabric-exec"), path.join(staging, "resources/skills/fabric-exec"));
      fs.mkdirSync(path.join(staging, "resources/steering"), { mode: 0o700 });
      copyClosure(path.join(root, "resources/steering/fabric.md"), path.join(staging, "resources/steering/fabric.md"));
      verifyCapturedInputs(staging, initialBuild, mappings);
      verifyBuildCapture(root, path.join(staging, "app"), initialBuild); verifyBoundary(context);
      const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
      const manifest = await createBundleManifest(staging, { version: pkg.version, target: context.target, compatibility: compatibilityFor(context.target), provenance: context.provenance, tools: pins });
      fs.writeFileSync(path.join(staging, "bundle-manifest.json"), canonical(manifest) + "\n", { mode: 0o600, flag: "wx" });
      const verified = await validateBundle(staging);
      const destination = path.join(parent, `kiro-fabric-bundle-${context.target}-${verified.digest}`);
      if (exists(destination)) {
        privateDirectory(destination);
        const previous = await validateBundle(destination);
        if (previous.digest !== verified.digest) throw new Error("Existing bundle identity conflict");
      } else fs.renameSync(staging, destination);
      return await publish(context, parent, { ...verified, root: destination }, options.archive !== false, false);
    } finally { if (exists(staging)) fs.rmSync(staging, { recursive: true }); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === "--target")) throw new Error("Usage: build-complete-bundle.mjs [--target TARGET]");
  console.log(JSON.stringify(await buildCompleteBundle(args.length ? { target: args[1] } : {})));
}
