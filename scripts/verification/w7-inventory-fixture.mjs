// W7 contract fixture helpers. Real source modules are bundled with esbuild into
// case-owned fixture roots; no production file is edited and no build output is
// required. External effects stay inert: every provider receives a task-owned
// private root and a borrowed stub Navigator client.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

/** @type {import("esbuild").BuildOptions} */
const COMMON = {
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node24",
  write: false,
  logLevel: "silent",
};

const CORE_ENTRIES = [
  ["ActionRegistry", "src/core/action-registry.ts"],
  ["createKiroRuntime", "src/kiro/runtime.ts"],
  ["normalizeFabricConfig", "src/config.ts"],
  ["loadFabricConfig", "src/config.ts"],
  ["DEFAULT_FABRIC_CONFIG", "src/config.ts"],
  ["remoteRef", "src/core/remote-identity.ts"],
  ["KiroMemoryProvider", "src/kiro/memory-provider.ts"],
  ["StateProvider", "src/providers/state-provider.ts"],
  ["ReviewProvider", "src/providers/review-provider.ts"],
  ["ProbeProvider", "src/providers/probe-provider.ts"],
  ["ContinuityProvider", "src/providers/continuity-provider.ts"],
  ["KiroMcpProvider", "src/kiro/mcp-provider.ts"],
  ["LocalCodingProvider", "src/providers/local-provider.ts"],
  ["FoveaProvider", "src/providers/repo-provider.ts"],
];

const INVENTORY_ENTRIES = [
  ["FABRIC_RUNTIME_PROVIDER_INVENTORY", "src/kiro/provider-inventory.ts"],
  ["FABRIC_RUNTIME_PROVIDER_NAMES", "src/kiro/provider-inventory.ts"],
  ["FABRIC_RUNTIME_PROVIDER_REQUIREMENTS", "src/kiro/provider-inventory.ts"],
];

/** @param {{root:string, fixturesRoot:string}} context */
async function bundle(context, label, entries) {
  const contents = entries
    .map(([symbol, file]) => `export { ${symbol} } from ${JSON.stringify(path.join(context.root, file))};`)
    .join("\n");
  const result = await build({ ...COMMON, stdin: { contents, resolveDir: context.root } });
  const file = path.join(context.fixturesRoot, `w7-${label}-api.mjs`);
  fs.writeFileSync(file, result.outputFiles[0].contents, { flag: "wx", mode: 0o600 });
  return await import(pathToFileURL(file).href);
}

/** Real production classes from source (no inventory dependency). */
export async function loadW7Core(context) { return await bundle(context, "core", CORE_ENTRIES); }

/** Current-inventory metadata; deliberately separate so a missing module is a
 * focused failure rather than an unloadable core. */
export async function loadW7Inventory(context) { return await bundle(context, "inventory", INVENTORY_ENTRIES); }

/** Public root bundle for additive export checks. */
export async function loadW7Index(context) {
  const contents = `export * from ${JSON.stringify(path.join(context.root, "src/index.ts"))};`;
  const result = await build({ ...COMMON, stdin: { contents, resolveDir: context.root } });
  const file = path.join(context.fixturesRoot, "w7-index-api.mjs");
  fs.writeFileSync(file, result.outputFiles[0].contents, { flag: "wx", mode: 0o600 });
  return await import(pathToFileURL(file).href);
}

/** Semantic check that src/index.ts exports the FabricProviderRequirements type.
 * The TypeScript checker resolves the export for real; diagnostics are filtered
 * to the generated probe so unrelated files never mask or inflate the result. */
export async function checkRootTypeExport(context, location = "src") {
  if (!["src", "dist"].includes(location)) throw new Error("invalid type-probe location");
  const typescript = (await import("typescript")).default;
  const configPath = path.join(context.root, "tsconfig.json");
  const read = typescript.readConfigFile(configPath, typescript.sys.readFile);
  if (read.error) throw new Error("tsconfig.json could not be read");
  const parsed = typescript.parseJsonConfigFileContent(read.config, typescript.sys, context.root);
  const probe = path.join(context.fixturesRoot, `w7-${location}-type-probe.ts`);
  const relative = path.relative(path.dirname(probe), path.join(context.root, location, "index.js")).split(path.sep).join("/");
  const specifier = relative.startsWith(".") ? relative : "./" + relative;
  const source = [
    `import type { FabricProviderRequirements } from ${JSON.stringify(specifier)};`,
    `import { FABRIC_RUNTIME_PROVIDER_INVENTORY } from ${JSON.stringify(specifier)};`,
    "const probe: FabricProviderRequirements = { verifiedWorkspace: true, settlement: false };",
    "export const size = FABRIC_RUNTIME_PROVIDER_INVENTORY.length + (probe.settlement === false ? 0 : 1);",
  ].join("\n");
  fs.writeFileSync(probe, source, { mode: 0o600 });
  const program = typescript.createProgram({ rootNames: [probe], options: parsed.options });
  const diagnostics = typescript.getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file && path.resolve(diagnostic.file.fileName) === path.resolve(probe))
    .map((diagnostic) => typescript.flattenDiagnosticMessageText(diagnostic.messageText, " "));
  return { ok: diagnostics.length === 0, diagnostics };
}

/** Create and canonicalize a private case-owned directory. */
export function privateDir(parent, name) {
  const directory = path.join(parent, name);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return fs.realpathSync(directory);
}
