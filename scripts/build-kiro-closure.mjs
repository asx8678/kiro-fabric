#!/usr/bin/env node
// Builds a self-contained runtime closure bundle for the Kiro MCP adapter.
// Output goes to dist/kiro-closure/ with all dependencies bundled inline.
// This bundle requires zero node_modules at runtime for most functionality.
// The managed closure is host-independent and rejects Pi packages in its
// resolved input graph.

import { build } from "esbuild";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";

const outdir = resolve("dist/kiro-closure");
const powerOutdir = resolve("dist/kiro-power-closure");

// Clean first
rmSync(outdir, { recursive: true, force: true });
rmSync(powerOutdir, { recursive: true, force: true });

// Node built-in modules that must stay external
const nodeBuiltins = [
  "assert", "async_hooks", "buffer", "child_process", "cluster",
  "console", "constants", "crypto", "dgram", "diagnostics_channel",
  "dns", "domain", "events", "fs", "http", "http2", "https",
  "inspector", "module", "net", "os", "path", "perf_hooks",
  "process", "punycode", "querystring", "readline", "repl",
  "stream", "string_decoder", "sys", "timers", "tls", "trace_events",
  "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
];

const external = [
  ...nodeBuiltins.map(m => `node:${m}`),
  ...nodeBuiltins,
];

const closureBanner = `import { createRequire as __kfCreateRequire } from "node:module";
import { fileURLToPath as __kfFileURLToPath } from "node:url";
import { dirname as __kfDirname } from "node:path";
globalThis.__filename = __kfFileURLToPath(import.meta.url);
globalThis.__dirname = __kfDirname(globalThis.__filename);
const require = __kfCreateRequire(import.meta.url);
`;

const result = await build({
  entryPoints: [
    "src/kiro/mcp-entry.ts",
    "src/kiro/agent-worker-entry.ts",
    "src/kiro/management-entry.ts",
  ],
  outdir,
  outbase: "src",
  entryNames: "[dir]/[name]",
  chunkNames: "chunks/[name]-[hash]",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  splitting: true,
  // Production managed runtimes are content-addressed release artifacts;
  // source maps stay in the normal development build rather than every install.
  sourcemap: false,
  metafile: true,
  logLevel: "info",
  external,
  // Supply CommonJS compatibility globals per output chunk without lexical
  // declarations, so bundled modules with their own definitions do not collide.
  banner: { js: closureBanner },
});

// Keep the deployable Kiro graph independent from the generic Pi agent stack.
// These checks use esbuild's resolved input graph, so aliases, re-exports, and
// transitive imports cannot bypass the boundary by avoiding a source marker in
// the emitted JavaScript.
const graphInputs = Object.keys(result.metafile.inputs).map((input) =>
  input.replaceAll("\\", "/"),
);
const forbiddenInputRoots = ["src/actors/", "src/residency/"];
const forbiddenInputFiles = [
  "src/worker.ts",
  "src/agents/manager.ts",
  "src/agents/executor-registry.ts",
  "src/agents/session-export.ts",
  "src/agents/worktree-manager.ts",
  "src/agents/transports/herdr-transport.ts",
  "src/agents/transports/localterm-transport.ts",
  "src/agents/transports/process-transport.ts",
  "src/agents/transports/screen-transport.ts",
  "src/agents/transports/tmux-transport.ts",
];
const forbiddenInputs = graphInputs.filter((input) =>
  forbiddenInputFiles.includes(input) ||
  forbiddenInputRoots.some((root) => input.startsWith(root)),
);
if (forbiddenInputs.length > 0) {
  throw new Error(
    `Kiro closure includes forbidden generic runtime inputs:\n${forbiddenInputs.join("\n")}`,
  );
}

const packageNameFromInput = (input) => {
  const segments = input.split("/");
  const nodeModulesIndex = segments.lastIndexOf("node_modules");
  if (nodeModulesIndex < 0 || nodeModulesIndex + 1 >= segments.length) return null;
  const first = segments[nodeModulesIndex + 1];
  if (!first) return null;
  return first.startsWith("@")
    ? `${first}/${segments[nodeModulesIndex + 2] ?? ""}`
    : first;
};
const forbiddenPackagePrefixes = ["@earendil-works/"];
const forbiddenPackages = [...new Set(
  graphInputs
    .map(packageNameFromInput)
    .filter((name) =>
      name !== null && forbiddenPackagePrefixes.some((prefix) => name.startsWith(prefix)),
    ),
)].sort();
if (forbiddenPackages.length > 0) {
  throw new Error(
    `Kiro closure includes forbidden generic runtime packages:\n${forbiddenPackages.join("\n")}`,
  );
}

// ---- Ship the TypeScript default lib chain the guest type-checker needs ----
// esbuild bundles the TypeScript compiler into a chunk, but its lib/*.d.ts
// files are read from disk at runtime by path.
const copyTypeScriptLibraries = (targetOutdir) => {
  const tsLibDir = join(resolve("."), "node_modules", "typescript", "lib");
  const chunksDir = join(targetOutdir, "chunks");
  const libSet = new Set();
  const queue = ["lib.es2022.d.ts"];
  while (queue.length) {
    const name = queue.pop();
    if (libSet.has(name)) continue;
    const full = join(tsLibDir, name);
    if (!existsSync(full)) {
      throw new Error(`closure lib dependency missing: node_modules/typescript/lib/${name}`);
    }
    libSet.add(name);
    const text = readFileSync(full, "utf8");
    for (const dep of text.matchAll(/<reference lib="([^"]+)"/g)) {
      queue.push(`lib.${dep[1]}.d.ts`);
    }
  }
  mkdirSync(chunksDir, { recursive: true });
  for (const name of libSet) copyFileSync(join(tsLibDir, name), join(chunksDir, name));
};

const writeClosurePackage = (targetOutdir, name) => writeFileSync(
  join(targetOutdir, "package.json"),
  JSON.stringify(
    { name, version: "0.0.0-closure", type: "module", private: true },
    null,
    2,
  ) + "\n",
);

copyTypeScriptLibraries(outdir);
writeClosurePackage(outdir, "kiro-fabric-runtime");


// ---- PR1: production closure correctness assertions ----
// 1. No source maps in the production closure.
let mapCount = 0;
let jsBytes = 0;
let jsFileCount = 0;
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".map")) {
      mapCount++;
      console.error(`closure contains source map: ${full}`);
    } else if (entry.name.endsWith(".js")) {
      jsFileCount++;
      jsBytes += statSync(full).size;
    }
  }
};
walk(outdir);
if (mapCount > 0) throw new Error(`Production closure must not contain source maps (found ${mapCount})`);

// 2. Required entries + metadata present.
// The setup entry is the self-hosted management/lifecycle entry in every
// immutable installed release.
for (const entry of ["mcp-entry.js", "agent-worker-entry.js", "management-entry.js"]) {
  if (!existsSync(join(outdir, "kiro", entry))) {
    throw new Error(`closure entry missing: kiro/${entry}`);
  }
}
if (!existsSync(join(outdir, "package.json"))) {
  throw new Error("closure package.json missing");
}

// 3. No node_modules shipped inline.
if (existsSync(join(outdir, "node_modules"))) {
  throw new Error("closure must not bundle a node_modules directory");
}

console.log(
  `Closure built: ${Object.keys(result.metafile.outputs).length} output files; ` +
  `${jsFileCount} js files, ${(jsBytes / 1024).toFixed(0)} KiB JS, no source maps`,
);

// Power v1 ships only the MCP entry and its reachable graph. Strict-mode
// management and ACP worker entrypoints remain in dist/kiro-closure.
const powerResult = await build({
  entryPoints: ["src/kiro/mcp-entry.ts"],
  outdir: powerOutdir,
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
  logLevel: "info",
  external,
  banner: { js: closureBanner },
});
const powerInputs = Object.keys(powerResult.metafile.inputs).map((input) => input.replaceAll("\\", "/"));
const forbiddenPowerInputs = powerInputs.filter((input) =>
  input === "src/kiro/agent-worker-entry.ts" ||
  input === "src/kiro/management-entry.ts" ||
  input === "src/kiro/acp-worker.ts" ||
  input.startsWith("src/residency/") ||
  input.startsWith("src/actors/"),
);
if (forbiddenPowerInputs.length > 0) {
  throw new Error(`Power closure includes unavailable worker/management inputs:\n${forbiddenPowerInputs.join("\n")}`);
}
copyTypeScriptLibraries(powerOutdir);
writeClosurePackage(powerOutdir, "kiro-fabric-power-runtime");
for (const entry of ["agent-worker-entry.js", "management-entry.js"]) {
  if (existsSync(join(powerOutdir, "kiro", entry))) {
    throw new Error(`Power closure must not contain kiro/${entry}`);
  }
}
if (!existsSync(join(powerOutdir, "kiro", "mcp-entry.js"))) {
  throw new Error("Power closure entry missing: kiro/mcp-entry.js");
}
if (existsSync(join(powerOutdir, "node_modules"))) {
  throw new Error("Power closure must not bundle a node_modules directory");
}
console.log(`Power closure built: ${Object.keys(powerResult.metafile.outputs).length} output files; MCP-only entry graph`);
