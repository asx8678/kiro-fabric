#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const manifest = JSON.parse(
  readFileSync(resolve(REPOSITORY_ROOT, "package.json"), "utf8"),
);

const collectCondition = (value, condition) => {
  if (!value || typeof value !== "object") return [];
  const direct = value[condition];
  const nested = Object.values(value).flatMap((entry) => collectCondition(entry, condition));
  return typeof direct === "string" ? [direct, ...nested] : nested;
};

const unique = (values) => [...new Set(values.map((value) => value.replace(/^\.\//u, "")))];
const sorted = (values) => [...values].sort();
const sameMembers = (left, right) =>
  JSON.stringify(sorted(unique(left))) === JSON.stringify(sorted(unique(right)));

/**
 * Every compiled public entrypoint. `exported: false` marks an internally
 * referenced worker binary (for example the Kiro ACP agent worker, which is
 * shipped under `files` and located at runtime via a relative URL) that is
 * built and published but intentionally NOT part of the module/Bin export
 * surface. Distinguishing these two facets keeps the package-surface
 * assertion in `assertPackagePolicy()` consistent with the manifest.
 */
export const PUBLIC_ENTRYPOINTS = [
  { source: "src/index.ts", runtime: "dist/index.js", declaration: "dist/index.d.ts", exported: true },
  { source: "src/protocol.ts", runtime: "dist/protocol.js", declaration: "dist/protocol.d.ts", exported: true },
  { source: "src/kernel/index.ts", runtime: "dist/kernel/index.js", declaration: "dist/kernel/index.d.ts", exported: true },
  { source: "src/kiro/index.ts", runtime: "dist/kiro/index.js", declaration: "dist/kiro/index.d.ts", exported: true },
  { source: "src/kiro/mcp-entry.ts", runtime: "dist/kiro/mcp-entry.js", exported: true },
  { source: "src/kiro/agent-worker-entry.ts", runtime: "dist/kiro/agent-worker-entry.js", exported: false },
  { source: "src/runtime/compiler-worker-entry.ts", runtime: "dist/runtime/compiler-worker-entry.js", exported: false },
  { source: "src/kiro/cli-entry.ts", runtime: "dist/kiro/cli-entry.js", exported: true },
  { source: "src/kiro/setup-entry.ts", runtime: "dist/kiro/setup-entry.js", exported: true },
  { source: "src/verification/index.ts", runtime: "dist/verification/index.js", declaration: "dist/verification/index.d.ts", exported: true },
];

export const PUBLIC_SOURCE_ENTRYPOINTS = PUBLIC_ENTRYPOINTS.map(({ source }) => source);
/** Every runtime artifact built and shipped, including internal worker binaries. */
export const BUILT_RUNTIME_ARTIFACTS = PUBLIC_ENTRYPOINTS.map(({ runtime }) => runtime);
/** The subset of runtime artifacts reachable via the package export surface (main/Bin/exports). */
export const PUBLIC_RUNTIME_ARTIFACTS = PUBLIC_ENTRYPOINTS
  .filter(({ exported }) => exported)
  .map(({ runtime }) => runtime);
export const PUBLIC_DECLARATION_ROOTS = PUBLIC_ENTRYPOINTS
  .filter(({ exported }) => exported)
  .flatMap(({ declaration }) => declaration ? [declaration] : []);
export const PACKAGE_FILES = [...(manifest.files ?? [])];
export const PUBLISHED_DECLARATION_ARTIFACTS = PACKAGE_FILES
  .filter((file) => file.startsWith("dist/") && file.endsWith(".d.ts"));
export const PACKAGE_BIN_ARTIFACTS = unique(Object.values(manifest.bin ?? {}));
export const REMOVED_BUILD_ARTIFACTS = ["dist/worker.js", "dist/worker.js.map"];

export const assertPackagePolicy = () => {
  const manifestRuntime = unique([
    ...(typeof manifest.main === "string" ? [manifest.main] : []),
    ...Object.values(manifest.bin ?? {}),
    ...collectCondition(manifest.exports, "import"),
  ]);
  const manifestDeclarations = unique([
    ...(typeof manifest.types === "string" ? [manifest.types] : []),
    ...collectCondition(manifest.exports, "types"),
  ]);

  if (!sameMembers(manifestRuntime, PUBLIC_RUNTIME_ARTIFACTS)) {
    throw new Error(
      `package runtime entrypoints drifted from scripts/package-policy.mjs:\n${manifestRuntime.join("\n")}`,
    );
  }
  if (!sameMembers(manifestDeclarations, PUBLIC_DECLARATION_ROOTS)) {
    throw new Error(
      `package declaration roots drifted from scripts/package-policy.mjs:\n${manifestDeclarations.join("\n")}`,
    );
  }
  if (new Set(PACKAGE_FILES).size !== PACKAGE_FILES.length) {
    throw new Error("package.json files contains duplicate entries");
  }
  for (const artifact of [...BUILT_RUNTIME_ARTIFACTS, ...PUBLISHED_DECLARATION_ARTIFACTS]) {
    if (!PACKAGE_FILES.includes(artifact)) {
      throw new Error(`public artifact is missing from package.json files: ${artifact}`);
    }
  }
  for (const source of PUBLIC_SOURCE_ENTRYPOINTS) {
    if (!existsSync(resolve(REPOSITORY_ROOT, source))) {
      throw new Error(`public source entrypoint does not exist: ${source}`);
    }
  }
};
