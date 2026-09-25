// W5 activation qualification support: stage a genuine, validator-passing complete
// bundle ENTIRELY offline and under a caller-owned fixture root.
//
// The bundle is assembled from the current built closure plus the repository's
// verified private-tool cache; the manifest is produced by the real shared
// bundle contract (`createBundleManifest`) and re-validated by `validateBundle`.
// Nothing outside the supplied fixture root is written. No network access and no
// download path is reachable: the pinned private-tool cache is verified first and
// a miss is a hard error, never an acquisition.
//
// Assembly reproduces the production `buildCompleteBundle` pre-copy and
// post-assembly VALIDATION steps:
//   - `verifyBuildClosure` refuses a closure whose recorded build inputs do not
//     match the current checkout, and refuses corrupted/mixed closure bytes;
//   - the exact original closure-manifest bytes are captured up front and
//     re-checked after copying (the same exact-manifest identity production's
//     `verifyBoundary` re-verifies);
//   - source provenance and build-input identity are captured up front and must
//     be unchanged through assembly;
//   - `verifyBuildCapture` + `verifyCapturedInputs` bind the ORIGINAL closure and
//     the copied app/resources to that same captured identity.
// A stale or mixed closure is therefore refused, never relabelled as current.
//
// This deliberately does NOT use buildCompleteBundle(), and it is NOT the public
// publisher boundary. It does not perform production's early unprivileged/native
// source target/context gates, does not validate or publish the active shared
// pointer, does not use cache leases or publication gates, and does not perform
// post-publication checks. It never writes shared state. A bundle produced here
// is a task-owned helper generation, not a public publisher result; only
// `resolvePublicActiveBundle` accepts a genuine public-produced active bundle.
// The bytes here are the production contract bytes: current dist closure, pinned
// tool members, esbuild-compiled production manager.

import fs from "node:fs";
import path from "node:path";
import { canonical, createBundleManifest, validateBundle, sha256, compatibilityFor, readRegular, LIMITS } from "../bundle-contract.mjs";
import { verifyBuildClosure, verifyBuildCapture, verifyCapturedInputs, assertBuildInputs } from "../build-inputs.mjs";
import { verifyPrivateToolCache } from "../build-private-tools.mjs";
import { detectInstallerPlatform } from "../installer-platform.mjs";
import { sourceProvenance, validateActiveCompleteBundle } from "../build-complete-bundle.mjs";
import { cacheDirectory, exists } from "../installer-artifacts.mjs";

const RESOURCE_MAPPINGS = [["skills/fabric-exec", "resources/skills/fabric-exec"], ["resources/steering/fabric.md", "resources/steering/fabric.md"]];

const copyClosure = (source, target) => {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink() || stat.uid !== process.getuid?.()) throw new Error("Unsafe source closure ownership: " + source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { mode: 0o700 });
    for (const name of fs.readdirSync(source).sort()) copyClosure(path.join(source, name), path.join(target, name));
  } else {
    if (!stat.isFile() || stat.nlink !== 1) throw new Error("Unsupported source closure entry: " + source);
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target, 0o600);
  }
};

async function compileProductionManager(repoRoot, outfile) {
  const { build } = await import("esbuild");
  const result = await build({ entryPoints: [path.join(repoRoot, "scripts", "install-manager.mjs")], outfile, bundle: true, platform: "node", format: "esm", target: "node24", splitting: false, sourcemap: false, metafile: true, logLevel: "silent" });
  for (const input of Object.keys(result.metafile.inputs)) if (input.includes("node_modules/") || /(?:^|\/)tests\//u.test(input)) throw new Error("Installed manager must contain only reviewed built-in-only implementation modules");
  fs.chmodSync(outfile, 0o600);
}

/** Resolve and verify the repository's pinned private-tool cache without any
 * download path. @param {string} repoRoot @param {string} target */
async function resolveVerifiedToolCache(repoRoot, target) {
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, "build-toolchain.json"), "utf8"));
  const pins = config.targets[target];
  if (!pins?.node?.sha256 || !pins?.rg?.sha256) throw new Error("Private tool pins unavailable");
  const cache = path.join(repoRoot, ".tmp", "private-tools-" + sha256(canonical(pins)));
  if (!fs.existsSync(cache)) throw new Error("No verified offline private-tool cache for the current pins; download path refused");
  await verifyPrivateToolCache(cache, pins, target);
  return { pins, cache, digest: sha256(canonical(pins)) };
}

/** Resolve the genuine PUBLIC-produced active bundle, read-only, when the
 * checkout has a valid shared `.tmp/complete-bundle.json`. Returns null when no
 * pointer exists. A present-but-invalid pointer is a hard error: it is never
 * hidden behind a helper fallback. The selected bundle is re-bound to the current
 * source and ORIGINAL closure (exact closure-manifest bytes included) before it is
 * trusted. This reads the shared pointer; it never writes the pointer, cache or a
 * build, and it is NOT the helper's own publisher. */
export async function resolvePublicActiveBundle(repoRoot) {
  repoRoot = fs.realpathSync(repoRoot);
  const parent = cacheDirectory(repoRoot);
  const pointer = parent && path.join(parent, 'complete-bundle.json');
  if (!pointer || !exists(pointer)) return null;
  const pointerSha = sha256(await readRegular(pointer, LIMITS.manifest, { mode: 0o600 }));
  const selected = await validateActiveCompleteBundle(parent);
  if (!selected) throw Error('Present public pointer did not select a bundle; preserve and inspect it');
  if (path.basename(selected.root) !== `kiro-fabric-bundle-${selected.manifest.target}-${selected.digest}`) throw Error('Public digest-named identity conflict');
  const admitted = await admitCurrentActivationBundle({ repoRoot, bundleRoot: selected.root, publicSelection: true });
  if (admitted.digest !== selected.digest || sha256(await readRegular(pointer, LIMITS.manifest, { mode: 0o600 })) !== pointerSha) throw Error('Public selection changed during admission; preserve and inspect it');
  return { ...admitted, publicPointerSha256: pointerSha };
}

/** Independently admit executable bytes against CURRENT captured inputs, not
 * candidate-supplied claims. Explicit task selection does not consult, repair or
 * silently fall back from the shared pointer. It is labelled non-public. */
export async function admitCurrentActivationBundle({ repoRoot, bundleRoot, taskRoot = undefined, publicSelection = false }) {
  repoRoot = fs.realpathSync(repoRoot);
  const root = fs.realpathSync(bundleRoot);
  if (!publicSelection) {
    if (!taskRoot) throw Error('Explicit activation base requires its task-owned root');
    taskRoot = fs.realpathSync(taskRoot);
    const st = fs.lstatSync(taskRoot), relative = path.relative(taskRoot, root);
    if (!st.isDirectory() || st.uid !== process.getuid?.() || (st.mode & 0o077) || taskRoot === repoRoot || taskRoot === cacheDirectory(repoRoot) || !relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) throw Error('Activation base must be inside a private caller-owned task root, not the shared cache');
  }
  const closureRoot = path.join(repoRoot, 'dist', 'kiro-agent-closure');
  const initialBuild = verifyBuildClosure(repoRoot, closureRoot);
  const closureManifestPath = path.join(closureRoot, 'closure-manifest.json');
  const closureManifestSha = sha256(fs.readFileSync(closureManifestPath));
  const rawToolchain = fs.readFileSync(path.join(repoRoot, 'build-toolchain.json'));
  const toolchainSha256 = sha256(rawToolchain);
  const target = detectInstallerPlatform().target;
  const nativeFile = path.join(closureRoot, 'fovea/source-platform.json');
  if (fs.existsSync(nativeFile)) {
    const native = JSON.parse(fs.readFileSync(nativeFile, 'utf8'));
    if (native.schemaVersion !== 1 || native.abiVersion !== 1 || native.platform !== 'darwin' || !['arm64', 'x64'].includes(native.arch) || `${native.platform}-${native.arch}` !== target) throw Error('Native source artifact does not match current target');
  }
  const pins = JSON.parse(rawToolchain.toString('utf8')).targets[target];
  if (!pins?.node || !pins?.rg) throw Error('Current toolchain pins absent');
  const schema = Object.hasOwn(pins, 'ast-grep') ? 2 : 1;
  const provenance = sourceProvenance(repoRoot);
  if (provenance.sourceDigest !== initialBuild.buildInputs.digest) throw Error('Source changed during activation admission');
  const verified = await validateBundle(root), manifest = verified.manifest;
  if (manifest.target !== target || manifest.schema !== schema || canonical(manifest.tools) !== canonical(pins) || canonical(manifest.provenance) !== canonical(provenance)) throw Error('Activation selection does not match current pins/target/schema/provenance');
  const version = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
  if (manifest.version !== version) throw Error('Activation selection version differs from current source');
  verifyBuildCapture(repoRoot, path.join(root, 'app'), initialBuild);
  if (sha256(fs.readFileSync(path.join(root, 'app/closure-manifest.json'))) !== closureManifestSha) throw Error('Selected closure manifest bytes differ from current original');
  verifyCapturedInputs(root, initialBuild, RESOURCE_MAPPINGS);
  verifyBuildCapture(repoRoot, closureRoot, initialBuild);
  assertBuildInputs(repoRoot, initialBuild.buildInputs);
  if (sha256(fs.readFileSync(closureManifestPath)) !== closureManifestSha || sha256(fs.readFileSync(path.join(repoRoot, 'build-toolchain.json'))) !== toolchainSha256 || canonical(sourceProvenance(repoRoot)) !== canonical(provenance)) throw Error('Current inputs changed during activation admission');
  return { ...verified, root, taskRoot: publicSelection ? null : taskRoot, target, schema, provenance, toolchainSha256, toolsDigest: sha256(canonical(pins)), producer: publicSelection ? 'public-buildCompleteBundle' : 'activation-bundle-helper', source: publicSelection ? 'public-active' : 'explicit-task-base', selection: publicSelection ? 'public-pointer' : 'explicit-task-base; shared pointer not selected or modified', buildInputsDigest: initialBuild.buildInputs.digest, closureContentDigest: initialBuild.contentDigest, closureManifestSha };
}

/** Stage a genuine complete bundle from current built inputs under fixtureRoot.
 * A stale/mixed closure, changed source identity or changed copied resources is
 * refused before/after assembly. @param {{repoRoot:string, fixtureRoot:string, label?:string, closure?:string, qualificationMarker?:string|null, baseBundle?:Awaited<ReturnType<typeof admitCurrentActivationBundle>>|null}} options */
export async function stageGenuineCompleteBundle({ repoRoot, fixtureRoot, label = "activation-bundle", closure = path.join("dist", "kiro-agent-closure"), qualificationMarker = null, baseBundle = null }) {
  repoRoot = fs.realpathSync(repoRoot);
  const closureRoot = path.resolve(repoRoot, closure);
  const closureManifestPath = path.join(closureRoot, "closure-manifest.json");
  if (!fs.existsSync(closureManifestPath)) throw new Error("current built closure absent; cannot stage a genuine bundle");
  // Production boundary checks BEFORE any copy. This refuses a stale closure
  // whose recorded build inputs differ from the current checkout, and refuses
  // corrupted/mixed closure bytes.
  const initialBuild = verifyBuildClosure(repoRoot, closureRoot);
  const closureManifestSha = sha256(fs.readFileSync(closureManifestPath));
  const provenance = sourceProvenance(repoRoot);
  const target = detectInstallerPlatform().target;
  const admittedBase = baseBundle ? await admitCurrentActivationBundle({ repoRoot, bundleRoot: baseBundle.root, ...(baseBundle.source === 'public-active' ? { publicSelection: true } : { taskRoot: baseBundle.taskRoot }) }) : null;
  const { pins, cache } = admittedBase ? { pins: admittedBase.manifest.tools, cache: admittedBase.root } : await resolveVerifiedToolCache(repoRoot, target);
  const root = fs.mkdtempSync(path.join(fixtureRoot, label + "-"));
  fs.chmodSync(root, 0o700);
  try {
    copyClosure(closureRoot, path.join(root, "app"));
    for (const tool of Object.keys(pins)) for (const member of pins[tool].members) {
      const file = path.join(root, member.path);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.copyFileSync(path.join(cache, member.path), file, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(file, member.path === "tools/" + tool ? 0o700 : 0o600);
    }
    fs.mkdirSync(path.join(root, "manager"), { mode: 0o700 });
    await compileProductionManager(repoRoot, path.join(root, "manager", "install-manager.mjs"));
    fs.mkdirSync(path.join(root, "resources", "skills"), { recursive: true, mode: 0o700 });
    copyClosure(path.join(repoRoot, "skills", "fabric-exec"), path.join(root, "resources", "skills", "fabric-exec"));
    fs.mkdirSync(path.join(root, "resources", "steering"), { mode: 0o700 });
    copyClosure(path.join(repoRoot, "resources", "steering", "fabric.md"), path.join(root, "resources", "steering", "fabric.md"));
    // A caller-supplied, clearly labelled qualification notice produces a
    // distinct-but-runnable generation for the update/rollback matrix without
    // touching the app closure. It is an allowed bundle notice entry.
    if (qualificationMarker !== null) {
      fs.mkdirSync(path.join(root, "notices"), { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(root, "notices", "ACTIVATION-QUALIFICATION.txt"), String(qualificationMarker) + "\n", { mode: 0o600, flag: "wx" });
    }
    // Preserved current input identity must survive assembly, and the copied
    // app/resources must bind to the same captured closure and source identity.
    // The ORIGINAL closure is re-checked exactly like production verifyBoundary:
    // its capture must still bind and its exact manifest bytes must be unchanged.
    assertBuildInputs(repoRoot, initialBuild.buildInputs);
    verifyBuildCapture(repoRoot, closureRoot, initialBuild);
    if (sha256(fs.readFileSync(closureManifestPath)) !== closureManifestSha) throw new Error("Original closure manifest changed during bundle assembly");
    if (canonical(sourceProvenance(repoRoot)) !== canonical(provenance)) throw new Error("Source identity changed during bundle assembly");
    verifyBuildCapture(repoRoot, path.join(root, "app"), initialBuild);
    verifyCapturedInputs(root, initialBuild, RESOURCE_MAPPINGS);
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    const schema = Object.hasOwn(pins, "ast-grep") ? 2 : 1;
    const manifest = await createBundleManifest(root, { version: pkg.version, target, compatibility: compatibilityFor(target, schema), provenance, tools: pins, schema });
    fs.writeFileSync(path.join(root, "bundle-manifest.json"), canonical(manifest) + "\n", { mode: 0o600, flag: "wx" });
    const verified = await admitCurrentActivationBundle({ repoRoot, bundleRoot: root, taskRoot: fixtureRoot });
    if (verified.closureManifestSha !== closureManifestSha || verified.buildInputsDigest !== initialBuild.buildInputs.digest || verified.toolsDigest !== sha256(canonical(pins))) throw Error("Assembly inputs drifted before independent admission");
    return { ...verified, rootRaw: root, source: "task-staged" };
  } catch (error) {
    // Fixtures are always retained; report the root for inspection.
    error.fixtureRoot = root;
    throw error;
  }
}

export const activationBundleIdentity = bundle => ({ digest: bundle.digest, version: bundle.version, target: bundle.target, schema: bundle.schema, source: bundle.source, producer: bundle.producer, selection: bundle.selection, taskRoot: bundle.taskRoot, provenance: bundle.provenance, toolchainSha256: bundle.toolchainSha256, toolsDigest: bundle.toolsDigest, buildInputsDigest: bundle.buildInputsDigest, closureContentDigest: bundle.closureContentDigest, closureManifestSha: bundle.closureManifestSha, publicPointerSha256: bundle.publicPointerSha256 ?? null, bytes: bundle.bytes });
