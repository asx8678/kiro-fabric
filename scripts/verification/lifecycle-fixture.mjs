// Source-only lifecycle fixture: inert providers/transports; generated files are retained.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

/** @param {{root:string, fixturesRoot:string}} context */
export async function loadLifecycleApi(context) {
  const entries = [
    ["ActionRegistry", "src/core/action-registry.ts"],
    ["KiroMcpProvider", "src/kiro/mcp-provider.ts"],
    ["FabricExecutionService", "src/execution-service.ts"],
    ["FabricCompilerPool", "src/runtime/type-checker.ts"],
    ["QuickJsRuntime", "src/runtime/quickjs-runtime.ts"],
    ["createKiroRuntime", "src/kiro/runtime.ts"],
    ["KiroHostSessionAdapter", "src/kiro/host-session-adapter.ts"],
    ["normalizeFabricConfig", "src/config.ts"],
  ];
  const contents = entries.map(([symbol, file]) => `export { ${symbol} } from ${JSON.stringify(path.join(context.root, file))};`).join("\n");
  const result = await build({ stdin: { contents, resolveDir: context.root }, bundle: true,
    packages: "external", platform: "node", format: "esm", target: "node24", write: false, logLevel: "silent" });
  const file = path.join(context.fixturesRoot, "lifecycle-source-api.mjs");
  fs.writeFileSync(file, result.outputFiles[0].contents, { flag: "wx", mode: 0o600 });
  return await import(pathToFileURL(file).href);
}
