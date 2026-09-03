#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { builtinModules, createRequire } from "node:module";
import { build } from "esbuild";
import { uniquePackageRecords } from "./package-identity.mjs";

const root = path.resolve(".");
const outdir = path.join(root, "dist", "kiro-agent-closure");
const product = JSON.parse(fs.readFileSync(path.join(root, "agent-product.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (product.entrypoint !== "src/kiro/mcp-entry.ts") throw new Error("Agent product entrypoint drifted");
const allowedDirect = new Set(product.allowedPackageDependencies);
for (const dependency of Object.keys(pkg.dependencies ?? {})) {
  if (!allowedDirect.has(dependency)) throw new Error(`Agent dependency is not allowed by agent-product.json: ${dependency}`);
}
for (const allowed of allowedDirect) {
  if (!Object.hasOwn(pkg.dependencies ?? {}, allowed)) throw new Error(`Agent manifest allows an unused direct dependency: ${allowed}`);
}

fs.rmSync(outdir, { recursive: true, force: true });
const external = [...new Set(builtinModules.flatMap((name) => [name, name.startsWith("node:") ? name.slice(5) : `node:${name}`]))];
// jsonc-parser advertises a legacy UMD `main` before its ESM `module`. The UMD
// entry contains runtime-relative CommonJS requires that cannot be relocated
// into a single-file esbuild closure. Resolve the ESM entry from mcporter's own
// dependency graph and bind this one package explicitly; all implementation
// modules are then statically included in the archive.
const mcporterRequire = createRequire(import.meta.resolve("mcporter"));
const jsoncParserEsm = mcporterRequire.resolve("jsonc-parser/lib/esm/main.js");
const banner = `import { createRequire as __createRequire } from "node:module";\nimport { fileURLToPath as __fileURLToPath } from "node:url";\nimport { dirname as __dirnameOf } from "node:path";\nglobalThis.__filename = __fileURLToPath(import.meta.url);\nglobalThis.__dirname = __dirnameOf(globalThis.__filename);\nconst require = __createRequire(import.meta.url);\n`;
const result = await build({
  entryPoints: [product.entrypoint, product.runtimeAssets.compilerWorker],
  outdir,
  outbase: "src",
  entryNames: "[dir]/[name]",
  chunkNames: "chunks/[name]-[hash]",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  splitting: true,
  sourcemap: false,
  metafile: true,
  alias: { "jsonc-parser": jsoncParserEsm },
  logLevel: "info",
  external,
  banner: { js: banner },
});
const normalize = (value) => value.replaceAll("\\", "/");
const inputs = Object.keys(result.metafile.inputs).map(normalize).sort();
const jsoncParserInputs = inputs.filter((input) => input.includes("/jsonc-parser/") || input.startsWith("jsonc-parser/"));
if (!jsoncParserInputs.some((input) => input.endsWith("/lib/esm/main.js")) ||
    jsoncParserInputs.some((input) => input.includes("/lib/umd/"))) {
  throw new Error("Agent closure did not statically bind jsonc-parser's relocatable ESM implementation");
}
const sourceInputs = inputs.filter((input) => input.startsWith("src/"));
for (const forbidden of product.forbiddenRuntimeModules) {
  const hit = sourceInputs.find((input) => forbidden.endsWith("/") ? input.startsWith(forbidden) : input === forbidden);
  if (hit) throw new Error(`Agent closure reached forbidden runtime module: ${hit}`);
}
const packageName = (input) => {
  const suffix = input.split("node_modules/").at(-1);
  if (!suffix || suffix === input) return undefined;
  const parts = suffix.split("/");
  return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
};
const packageNames = [...new Set(inputs.map(packageName).filter(Boolean))].sort();
for (const dependency of Object.keys(pkg.dependencies ?? {})) {
  if (!packageNames.includes(dependency)) throw new Error(`Direct dependency is not reached by the Agent closure: ${dependency}`);
}
const legacyHost = String.fromCodePoint(112, 105);
if (packageNames.some((name) => name.startsWith(`@earendil-works/${legacyHost}-`) || name.startsWith(`@mariozechner/${legacyHost}-`))) throw new Error("Agent closure reached a forbidden package");
const discoveredPackageRecords = [];
for (const input of inputs) {
  const name = packageName(input);
  if (!name) continue;
  let cursor = path.dirname(path.resolve(root, input));
  let found;
  while (cursor !== path.dirname(cursor)) {
    const manifest = path.join(cursor, "package.json");
    if (fs.existsSync(manifest)) {
      const candidate = JSON.parse(fs.readFileSync(manifest, "utf8"));
      if (candidate.name === name) { found = { candidate, root: cursor }; break; }
    }
    cursor = path.dirname(cursor);
  }
  if (!found) throw new Error(`Unable to resolve package version for closure input: ${name}`);
  const version = String(found.candidate.version);
  discoveredPackageRecords.push({
    name,
    version,
    license: typeof found.candidate.license === "string" && found.candidate.license ? found.candidate.license : "NOASSERTION",
    root: found.root,
  });
}
const records = uniquePackageRecords(discoveredPackageRecords);
const packageInputs = records.map(({ name, version, license }) => ({ name, version, license }));

const tsLib = path.join(root, "node_modules", "typescript", "lib");
const chunks = path.join(outdir, "chunks");
fs.mkdirSync(chunks, { recursive: true, mode: 0o755 });
const libraries = new Set();
const queue = ["lib.es2022.d.ts"];
while (queue.length) {
  const name = queue.pop();
  if (libraries.has(name)) continue;
  const source = path.join(tsLib, name);
  if (!fs.existsSync(source)) throw new Error(`TypeScript guest library is missing: ${name}`);
  libraries.add(name);
  const text = fs.readFileSync(source, "utf8");
  for (const match of text.matchAll(/<reference lib="([^"]+)"/gu)) queue.push(`lib.${match[1]}.d.ts`);
}
for (const name of [...libraries].sort()) fs.copyFileSync(path.join(tsLib, name), path.join(chunks, name));
fs.writeFileSync(path.join(outdir, "package.json"), `${JSON.stringify({ name: "kiro-fabric-agent-runtime", version: pkg.version, type: "module", private: true }, null, 2)}\n`);

const noticeParts = ["Kiro Fabric bundled third-party license notices\n"];
for (const record of records) {
  const candidates = fs.readdirSync(record.root).filter((name) => /^(?:licen[cs]e|notice|thirdpartynotice)/iu.test(name)).sort();
  if (!candidates.length) throw new Error(`Bundled dependency has no discoverable license text: ${record.name}@${record.version}`);
  noticeParts.push(`\n===== ${record.name}@${record.version} (${record.license}) =====\n`);
  for (const name of candidates) {
    const target = path.join(record.root, name);
    if (fs.lstatSync(target).isFile()) noticeParts.push(`\n--- ${name} ---\n${fs.readFileSync(target, "utf8")}\n`);
  }
}
fs.writeFileSync(path.join(outdir, "THIRD_PARTY_NOTICES.txt"), noticeParts.join(""));

const kiroProviderFiles = new Set([
  "src/kiro/artifacts.ts",
  "src/kiro/mcp-provider.ts",
  "src/kiro/memory-provider.ts",
  "src/kiro/memory.ts",
  "src/kiro/power/artifacts-provider.ts",
]);
const classify = (file) => file.startsWith("src/providers/") || kiroProviderFiles.has(file)
  ? "mounted-provider"
  : file.startsWith("src/kiro/")
    ? "agent-runtime"
    : "checked-execution-kernel";
const byClass = Object.groupBy(sourceInputs, classify);
const evidenceDirectory = path.join(root, ".tmp");
fs.mkdirSync(evidenceDirectory, { recursive: true, mode: 0o700 });
const evidenceStats = fs.lstatSync(evidenceDirectory);
if (!evidenceStats.isDirectory() || evidenceStats.isSymbolicLink()) throw new Error(".tmp must be a regular checkout-local directory");
if (process.platform !== "win32" && typeof process.getuid === "function" && evidenceStats.uid !== process.getuid()) throw new Error(".tmp must be owned by the current user");
fs.chmodSync(evidenceDirectory, 0o700);
fs.writeFileSync(path.join(evidenceDirectory, "agent-reachability.json"), `${JSON.stringify({
  schemaVersion: 1,
  entrypoints: [product.entrypoint, product.runtimeAssets.compilerWorker],
  sourceInputs,
  classifications: Object.fromEntries(Object.entries(byClass).map(([key, files]) => [key, files])),
  packageInputs,
  packaging: [
    "scripts/package-policy.mjs",
    "scripts/build.mjs",
    "scripts/build-kiro-closure.mjs",
    "scripts/assert-build-artifacts.mjs",
    "scripts/build-agent-dev.mjs",
    "scripts/validate-agent-package.mjs",
    "scripts/assert-kiro-home-unchanged.mjs",
    "scripts/certify-kiro-agent.mjs",
    "scripts/real-client-evidence.mjs",
    "scripts/certify-kiro-agent-real.mjs",
    "scripts/generate-agent-sbom.mjs",
    "scripts/create-agent-archive.mjs",
    "scripts/package-identity.mjs",
    "scripts/release-candidate-report.mjs",
  ],
}, null, 2)}\n`);

const files = [];
const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (entry.isFile()) files.push(target);
    else throw new Error(`Unsupported closure entry: ${target}`);
  }
};
walk(outdir);
const digest = createHash("sha256");
const evidenceFiles = files.map((file) => {
  const relative = normalize(path.relative(outdir, file));
  const content = fs.readFileSync(file);
  digest.update(relative).update("\0").update(content);
  return { path: relative, bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") };
});
const manifest = {
  schemaVersion: 1,
  product: product.product,
  entrypoint: "kiro/mcp-entry.js",
  compilerWorker: "runtime/compiler-worker-entry.js",
  executor: "quickjs",
  sourceInputs,
  packageInputs,
  files: evidenceFiles,
  contentDigest: digest.digest("hex"),
};
fs.writeFileSync(path.join(outdir, "closure-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const forbiddenText = [
  `@earendil-works/${legacyHost}-`, `@mariozechner/${legacyHost}-`,
  `PI_CODING_${"AGENT"}_DIR`, `managed-${"main"}`, `internal-${"child"}`,
  `kiro-fabric-${"dev"}`, `node-${"process"}-runtime`, `agent-${"worker"}-entry`,
  `management-${"entry"}`, String.fromCodePoint(960),
];
for (const file of files.filter((file) => file.endsWith(".js") || file.endsWith(".json"))) {
  const text = fs.readFileSync(file, "utf8");
  for (const term of forbiddenText) if (text.includes(term)) throw new Error(`Forbidden runtime term ${JSON.stringify(term)} in ${path.relative(root, file)}`);
  if (text.includes(root)) throw new Error(`Closure contains source-checkout absolute path: ${path.relative(root, file)}`);
}
const finalFiles = [...files, path.join(outdir, "closure-manifest.json")];
const bytes = finalFiles.reduce((total, file) => total + fs.statSync(file).size, 0);
console.log(`Agent closure built: ${finalFiles.length} files, ${bytes} bytes, ${sourceInputs.length} source modules`);
