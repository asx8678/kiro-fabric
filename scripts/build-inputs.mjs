import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const ordered = values => values.sort();
const safePath = name => typeof name === "string" && name.length > 0 && !name.includes("\\") && !path.posix.isAbsolute(name) && name.split("/").every(part => part && part !== "." && part !== "..");
function bytes(root, name) {
  if (!safePath(name)) throw new Error(`Invalid build input path: ${name}`);
  let current = root;
  for (const part of name.split("/")) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Unsupported symbolic build input: ${name}`);
  }
  if (!fs.lstatSync(current).isFile()) throw new Error(`Unsupported build input: ${name}`);
  return fs.readFileSync(current);
}
function inventory(root, directory) {
  const result = [];
  const visit = name => {
    const stat = fs.lstatSync(path.join(root, name));
    if (stat.isSymbolicLink()) throw new Error(`Unsupported symbolic build input: ${name}`);
    if (stat.isDirectory()) for (const child of ordered(fs.readdirSync(path.join(root, name)))) visit(`${name}/${child}`);
    else if (stat.isFile()) result.push(name);
    else throw new Error(`Unsupported build input: ${name}`);
  };
  visit(directory);
  return ordered(result);
}
// Explicit product roots, not Git status: tests, reports, caches and runtime data
// are not inputs. Follow packaging imports so profile and hook implementation
// changes are covered without pulling unrelated metrics/report scripts in.
export function captureBuildInputs(root) {
  const names = new Set(["package.json", "pnpm-lock.yaml", "agent-product.json", "build-toolchain.json", "tsconfig.json", "tsconfig.build.json"]);
  for (const directory of ["src", "skills", "resources"]) for (const name of inventory(root, directory)) names.add(name);
  const queue = ["build.mjs", "build-kiro-closure.mjs", "build-inputs.mjs", "normalize-artifact-modes.mjs", "assert-build-artifacts.mjs", "build-agent-dev.mjs", "build-complete-bundle.mjs", "generate-agent-sbom.mjs", "generate-bundle-sbom.mjs", "generate-agent-guidance.mjs", "agent-profile.mjs", "install-agent-user.mjs", "validate-agent-package.mjs", "install-manager.mjs"].map(name => `scripts/${name}`);
  while (queue.length) {
    const name = queue.pop();
    if (names.has(name)) continue;
    names.add(name);
    const text = bytes(root, name).toString("utf8");
    for (const match of text.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)["'](\.[^"']+)["']/gu)) {
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1]));
      if (!names.has(dependency)) queue.push(dependency);
    }
  }
  const files = ordered([...names]).map(name => ({ path: name, sha256: hash(bytes(root, name)) }));
  return { schemaVersion: 1, files, digest: hash(JSON.stringify(files)) };
}
export function validateBuildInputProvenance(expected) {
  if (!expected || expected.schemaVersion !== 1 || !Array.isArray(expected.files) || !/^[a-f0-9]{64}$/u.test(expected.digest ?? "") ||
      expected.files.some((entry, i) => !entry || !safePath(entry.path) || !/^[a-f0-9]{64}$/u.test(entry.sha256 ?? "") || (i > 0 && expected.files[i - 1].path >= entry.path)) ||
      hash(JSON.stringify(expected.files)) !== expected.digest) throw new Error("Invalid build input provenance; rebuild required");
  return expected;
}
export function assertBuildInputs(root, expected) {
  validateBuildInputProvenance(expected);
  if (captureBuildInputs(root).digest !== expected.digest) throw new Error("Build inputs changed since build or during capture; rebuild required");
}
// Validate stored closure bytes before deciding a stale-input cache miss. A bad
// existing closure is corruption, not permission to hide it behind a rebuild.
export function verifyClosureIntegrity(closure) {
  let manifest;
  try { manifest = JSON.parse(bytes(closure, "closure-manifest.json").toString("utf8")); }
  catch (cause) { throw new Error("Invalid or missing closure manifest; rebuild required", { cause }); }
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || !manifest.files.length || !/^[a-f0-9]{64}$/u.test(manifest.contentDigest ?? "")) throw new Error("Invalid closure manifest");
  const actual = inventory(path.dirname(closure), path.basename(closure)).map(name => name.slice(path.basename(closure).length + 1)).filter(name => name !== "closure-manifest.json");
  const declared = manifest.files.map(entry => entry?.path);
  if (declared.some(name => !safePath(name)) || new Set(declared).size !== declared.length || JSON.stringify(ordered([...declared])) !== JSON.stringify(actual)) throw new Error("Closure manifest file inventory mismatch");
  const digest = createHash("sha256");
  for (const entry of manifest.files) {
    const content = bytes(closure, entry.path);
    if (!Number.isSafeInteger(entry.bytes) || content.length !== entry.bytes || hash(content) !== entry.sha256) throw new Error(`Closure manifest checksum mismatch: ${entry.path}`);
    digest.update(entry.path).update("\0").update(content);
  }
  if (digest.digest("hex") !== manifest.contentDigest) throw new Error("Closure content digest mismatch");
  return manifest;
}
export function verifyBuildClosure(root, closure = path.join(root, "dist/kiro-agent-closure")) {
  const manifest = verifyClosureIntegrity(closure);
  assertBuildInputs(root, manifest.buildInputs);
  return manifest;
}
// Verify the captured resource bytes too, not only the checkout after copying.
// This prevents a changed-then-restored resource from mixing generations.
export function verifyCapturedInputs(staging, initial, mappings) {
  for (const [source, target] of mappings) {
    const expected = initial.buildInputs.files.filter(entry => entry.path === source || entry.path.startsWith(`${source}/`));
    if (!expected.length) throw new Error(`Unrecorded capture source: ${source}`);
    const stat = fs.lstatSync(path.join(staging, target));
    const actual = stat.isDirectory() ? inventory(staging, target) : [target];
    const wanted = expected.map(entry => target + entry.path.slice(source.length)).sort();
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`Captured input inventory mismatch: ${source}`);
    for (const entry of expected) if (hash(bytes(staging, target + entry.path.slice(source.length))) !== entry.sha256) throw new Error(`Captured input checksum mismatch: ${entry.path}`);
  }
}
export function verifyBuildCapture(root, closure, initial) {
  const captured = verifyBuildClosure(root, closure);
  if (captured.contentDigest !== initial.contentDigest || captured.buildInputs.digest !== initial.buildInputs.digest) throw new Error("Build changed during capture");
  return captured;
}
