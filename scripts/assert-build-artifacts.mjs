#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const stable = [
  "index.js",
  "protocol.js",
  "kernel/index.js",
  "kiro/index.js",
  "kiro/mcp-entry.js",
  "kiro/agent-worker-entry.js",
  "kiro/cli-entry.js",
  "verification/index.js",
];
const compatibilityFixtures = ["worker.js"];
const declarations = stable.map((file) => file.replace(/\.js$/, ".d.ts"));
const required = [
  ...stable,
  ...compatibilityFixtures,
  ...stable.map((file) => `${file}.map`),
  ...compatibilityFixtures.map((file) => `${file}.map`),
  ...declarations,
  ...declarations.map((file) => `${file}.map`),
];
const missing = required.filter((file) => !existsSync(join(dist, file)));
if (missing.length > 0) throw new Error(`Missing build artifacts:\n${missing.join("\n")}`);

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
const declarationStack = declarations.map((file) => join(dist, file));
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

for (const file of ["kiro/cli-entry.js", "kiro/mcp-entry.js"]) {
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
