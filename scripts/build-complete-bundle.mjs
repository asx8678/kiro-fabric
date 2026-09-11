import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { acquirePrivateTools } from "./build-private-tools.mjs";
import { canonical, createBundleManifest, validateBundle, sha256 } from "./bundle-contract.mjs";
import { createBundleArchive } from "./bundle-archive.mjs";
import { detectInstallerPlatform, compatibilityFor, assertUnprivilegedInstaller } from "./installer-platform.mjs";

import { captureBuildInputs, verifyBuildClosure, verifyBuildCapture, verifyCapturedInputs } from "./build-inputs.mjs";

const ownDirectory = (directory) => {
  const s = fs.lstatSync(directory);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077) || (process.getuid && s.uid !== process.getuid())) throw new Error(`Unsafe private build directory: ${directory}`);
};
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
  const git = args => execFileSync("git", args, { cwd: root, env: { PATH: process.env.PATH, LANG: "C" }, encoding: "utf8", timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  const head = git(["rev-parse", "HEAD"]).trim();
  if (!/^[a-f0-9]{40}$/u.test(head)) throw new Error("Cannot establish source Git identity");
  return { kind: "local-source", sourceDigest: captureBuildInputs(root).digest, gitHead: head, dirty: git(["status", "--porcelain", "-z"]).length > 0 };
}
function verifyCachedTools(root, pins) {
  ownDirectory(root);
  for (const tool of ["node", "rg"]) for (const member of pins[tool].members) {
    const file = path.join(root, member.path), s = fs.lstatSync(file);
    const mode = member.path === `tools/${tool}` ? 0o700 : 0o600;
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || (s.mode & 0o7777) !== mode || s.size !== member.size || (process.getuid && s.uid !== process.getuid()) || sha256(fs.readFileSync(file)) !== member.sha256) throw new Error("Pinned private-tool cache drifted; preserve and inspect it");
  }
}
/** Build with the already-built app closure. Developer entrypoint only, never imported by installed management. */
export async function buildCompleteBundle(options = {}) {
  assertUnprivilegedInstaller();
  const root = fs.realpathSync(options.root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const initialBuild = verifyBuildClosure(root);
  const initialProvenance = sourceProvenance(root);
  const platform = detectInstallerPlatform();
  const target = options.target ?? platform.target;
  if (!["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"].includes(target)) throw new Error("Unsupported bundle target");
  const temporary = path.join(root, ".tmp");
  if (!fs.existsSync(temporary)) fs.mkdirSync(temporary, { mode: 0o700 });
  ownDirectory(temporary);
  const toolchain = JSON.parse(fs.readFileSync(path.join(root, "build-toolchain.json"), "utf8"));
  const pins = toolchain.targets[target];
  const cache = path.join(temporary, `private-tools-${sha256(canonical(pins))}`);
  if (!fs.existsSync(cache)) {
    const acquiring = path.join(temporary, `.private-tools-${randomBytes(16).toString("hex")}`);
    fs.mkdirSync(acquiring, { mode: 0o700 });
    try { await acquirePrivateTools(target, acquiring); verifyCachedTools(acquiring, pins); fs.renameSync(acquiring, cache); }
    finally { if (fs.existsSync(acquiring)) fs.rmSync(acquiring, { recursive: true }); }
  }
  verifyCachedTools(cache, pins);
  const staging = path.join(temporary, `.complete-bundle-${randomBytes(16).toString("hex")}`);
  fs.mkdirSync(staging, { mode: 0o700 });
  try {
    copyClosure(path.join(root, "dist", "kiro-agent-closure"), path.join(staging, "app"));
    for (const tool of ["node", "rg"]) for (const member of pins[tool].members) {
      const file = path.join(staging, member.path);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.copyFileSync(path.join(cache, member.path), file, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(file, member.path === `tools/${tool}` ? 0o700 : 0o600);
    }
    fs.mkdirSync(path.join(staging, "manager"), { mode: 0o700 });
    // Source bootstrap must be loadable before frozen dependencies are installed.
    const { build } = await import("esbuild");
    const manager = await build({ entryPoints: [path.join(root, "scripts", "install-manager.mjs")], outfile: path.join(staging, "manager", "install-manager.mjs"), bundle: true, platform: "node", format: "esm", target: "node24", splitting: false, sourcemap: false, metafile: true, logLevel: "silent" });
    for (const input of Object.keys(manager.metafile.inputs)) if (input.includes("node_modules/") || /(?:^|\/)tests\//u.test(input)) throw new Error("Installed manager must contain only reviewed built-in-only implementation modules");
    fs.chmodSync(path.join(staging, "manager", "install-manager.mjs"), 0o600);
    fs.mkdirSync(path.join(staging, "resources"), { mode: 0o700 });
    fs.mkdirSync(path.join(staging, "resources", "skills"), { mode: 0o700 });
    copyClosure(path.join(root, "skills", "fabric-exec"), path.join(staging, "resources", "skills", "fabric-exec"));
    fs.mkdirSync(path.join(staging, "resources", "steering"), { mode: 0o700 });
    copyClosure(path.join(root, "resources", "steering", "fabric.md"), path.join(staging, "resources", "steering", "fabric.md"));
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    verifyCapturedInputs(staging, initialBuild, [["skills/fabric-exec", "resources/skills/fabric-exec"], ["resources/steering/fabric.md", "resources/steering/fabric.md"]]);
    verifyBuildCapture(root, path.join(staging, "app"), initialBuild);
    const provenance = sourceProvenance(root);
    if (provenance.sourceDigest !== initialProvenance.sourceDigest || provenance.gitHead !== initialProvenance.gitHead) throw new Error("Source changed during bundle capture");
    const manifest = await createBundleManifest(staging, { version: pkg.version, target, compatibility: compatibilityFor(target), provenance, tools: pins });
    fs.writeFileSync(path.join(staging, "bundle-manifest.json"), canonical(manifest) + "\n", { mode: 0o600, flag: "wx" });
    const verified = await validateBundle(staging);
    const destination = path.join(temporary, `kiro-fabric-bundle-${target}-${verified.digest}`);
    if (fs.existsSync(destination)) {
      const previous = await validateBundle(destination);
      if (previous.digest !== verified.digest) throw new Error("Existing bundle identity conflict");
      fs.rmSync(staging, { recursive: true });
    } else fs.renameSync(staging, destination);
    const archive = path.join(temporary, `kiro-fabric-${target}.tar.gz`);
    if (options.archive !== false) {
      const pending = path.join(temporary, `.archive-${randomBytes(16).toString("hex")}.tar.gz`);
      try {
        await createBundleArchive(destination, pending);
        if (fs.existsSync(archive)) { const s = fs.lstatSync(archive); if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || (process.getuid && s.uid !== process.getuid())) throw new Error("Unsafe previous development archive"); }
        fs.renameSync(pending, archive);
      } finally { if (fs.existsSync(pending)) fs.unlinkSync(pending); }
    }
    const result = { root: destination, digest: verified.digest, version: verified.version, target, bytes: verified.bytes, archive, provenance: manifest.provenance, qualification: "local-source; native full-bundle qualification pending" };
    fs.writeFileSync(path.join(temporary, "complete-bundle.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
    return result;
  } finally { if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === "--target")) throw new Error("Usage: build-complete-bundle.mjs [--target TARGET]");
  console.log(JSON.stringify(await buildCompleteBundle(args.length ? { target: args[1] } : {})));
}
