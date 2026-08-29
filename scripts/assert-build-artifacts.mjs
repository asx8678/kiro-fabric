#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
  assertPackagePolicy,
  BUILT_RUNTIME_ARTIFACTS,
  PACKAGE_BIN_ARTIFACTS,
  PUBLISHED_DECLARATION_ARTIFACTS,
  PUBLIC_DECLARATION_ROOTS,
  REMOVED_BUILD_ARTIFACTS,
  REPOSITORY_ROOT,
} from "./package-policy.mjs";

assertPackagePolicy();

const root = REPOSITORY_ROOT;
const dist = join(root, "dist");
const fromDist = (file) => file.replace(/^dist\//u, "");
const stable = BUILT_RUNTIME_ARTIFACTS.map(fromDist);
const declarations = PUBLISHED_DECLARATION_ARTIFACTS.map(fromDist);
const declarationRoots = PUBLIC_DECLARATION_ROOTS.map(fromDist);
const required = [
  ...stable,
  ...stable.map((file) => `${file}.map`),
  ...declarations,
  ...declarations.map((file) => `${file}.map`),
];
const missing = required.filter((file) => !existsSync(join(dist, file)));
if (missing.length > 0) throw new Error(`Missing build artifacts:\n${missing.join("\n")}`);
for (const artifact of REMOVED_BUILD_ARTIFACTS) {
  const removed = fromDist(artifact);
  if (existsSync(join(dist, removed))) throw new Error(`Removed legacy artifact still exists: ${removed}`);
}

const emittedDeclarations = [];
const declarationDirectories = [dist];
const SKIPPED_DECLARATION_DIRECTORIES = ["kiro-closure"];
while (declarationDirectories.length > 0) {
  const directory = declarationDirectories.pop();
  if (!directory) continue;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    // The kiro-closure bundle is a self-contained runtime payload with its own
    // nested private declarations and package.json. It is published under the
    // `dist/kiro-closure/**/*` glob and is independent of the public entry
    // declaration allowlist.
    if (entry.isDirectory() && SKIPPED_DECLARATION_DIRECTORIES.includes(entry.name)) continue;
    if (entry.isDirectory()) declarationDirectories.push(file);
    else if (entry.name.endsWith(".d.ts")) emittedDeclarations.push(relative(dist, file));
  }
}
const publishedDeclarationSet = new Set(declarations);
const unpublishedDeclarations = emittedDeclarations
  .filter((file) => !publishedDeclarationSet.has(file))
  .sort();
if (unpublishedDeclarations.length > 0) {
  throw new Error(
    `Emitted declarations are missing from the package allowlist:\n${unpublishedDeclarations.join("\n")}`,
  );
}

const chunks = join(dist, "chunks");
const chunkFiles = existsSync(chunks)
  ? readdirSync(chunks).filter((file) => file.endsWith(".js"))
  : [];
if (chunkFiles.length === 0) throw new Error("Build did not produce dynamic chunks");
for (const chunk of chunkFiles) {
  if (!existsSync(join(chunks, `${chunk}.map`))) {
    throw new Error(`Missing source map for chunk ${chunk}`);
  }
}

const staticImport = /(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g;
const visited = new Set();
const stack = [join(dist, "index.js")];
while (stack.length > 0) {
  const file = stack.pop();
  if (!file || visited.has(file)) continue;
  visited.add(file);
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(staticImport)) {
    const specifier = match[1];
    if (specifier?.startsWith(".")) stack.push(resolve(dirname(file), specifier));
  }
}
const initialSource = [...visited].map((file) => readFileSync(file, "utf8")).join("\n");
for (const forbidden of ["src/fabric-runtime-state.ts", "src/capture/interceptor.ts", "src/prewalk/arm.ts", "@earendil-works/pi-tui"]) {
  if (initialSource.includes(forbidden)) {
    throw new Error(`Kiro public entry contains removed Pi runtime marker: ${forbidden}`);
  }
}

const declarationImports = (source) => [
  ...source.matchAll(/(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g),
  ...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
].map((match) => match[1]).filter(Boolean);

const declarationTarget = (file, specifier) => {
  const base = resolve(dirname(file), specifier);
  const candidates = [
    base,
    base.replace(/\.(?:c|m)?js$/u, ".d.ts"),
    `${base}.d.ts`,
    join(base, "index.d.ts"),
  ];
  return candidates.find((candidate) => candidate.endsWith(".d.ts") && existsSync(candidate));
};

// Consumers install the Kiro package without Pi. Follow every declaration
// reachable from a public entry and reject accidental Pi host type leakage.
const declarationStack = declarationRoots.map((file) => join(dist, file));
const declarationVisited = new Set();
const forbiddenDeclarationImports = [
  "@earendil-works/",
  "@mariozechner/pi-",
];
while (declarationStack.length > 0) {
  const file = declarationStack.pop();
  if (!file || declarationVisited.has(file)) continue;
  declarationVisited.add(file);
  const source = readFileSync(file, "utf8");
  const forbiddenImport = forbiddenDeclarationImports.find((marker) => source.includes(marker));
  if (forbiddenImport) {
    throw new Error(
      `Public declaration graph imports a development-only Pi package (${forbiddenImport}): ${relative(dist, file)}`,
    );
  }
  for (const specifier of declarationImports(source)) {
    if (!specifier.startsWith(".")) continue;
    const target = declarationTarget(file, specifier);
    if (target) declarationStack.push(target);
  }
}

for (const artifact of PACKAGE_BIN_ARTIFACTS) {
  const file = fromDist(artifact);
  const text = readFileSync(join(dist, file), "utf8");
  if (!text.startsWith("#!/usr/bin/env node")) {
    throw new Error(`missing shebang: ${file}`);
  }
}
for (const file of stable) {
  const checked = spawnSync(process.execPath, ["--check", join(dist, file)], { encoding: "utf8" });
  if (checked.status !== 0) throw new Error(checked.stderr || `Syntax check failed: ${file}`);
}
await Promise.all(
  stable.map((file) =>
    import(new URL(`../dist/${file}`, import.meta.url)),
  ),
);
console.log(`build artifacts and lazy startup graph verified (${visited.size} startup files, ${declarationVisited.size} declaration files, ${chunkFiles.length} chunks)`);
