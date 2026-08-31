import { build, type Metafile } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";

const ENTRY_POINTS = [
  "src/kiro/mcp-entry.ts",
  "src/kiro/agent-worker-entry.ts",
] as const;
const FORBIDDEN_INPUT_ROOTS = ["src/actors/", "src/residency/"] as const;
const FORBIDDEN_INPUT_FILES = new Set([
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
]);

const normalizePath = (value: string): string => value.replaceAll("\\", "/");

const packageNameFromInput = (input: string): string | null => {
  const segments = normalizePath(input).split("/");
  const nodeModulesIndex = segments.lastIndexOf("node_modules");
  if (nodeModulesIndex < 0 || nodeModulesIndex + 1 >= segments.length) return null;
  const first = segments[nodeModulesIndex + 1];
  if (!first) return null;
  return first.startsWith("@")
    ? `${first}/${segments[nodeModulesIndex + 2] ?? ""}`
    : first;
};

describe("Power-only closure graph", () => {
  it("contains only the MCP process entry and excludes unavailable role sources", async () => {
    const result = await build({
      entryPoints: ["src/kiro/mcp-entry.ts"],
      outdir: "dist/.power-closure-graph-test",
      outbase: "src",
      entryNames: "[dir]/[name]",
      chunkNames: "chunks/[name]-[hash]",
      bundle: true,
      write: false,
      metafile: true,
      platform: "node",
      format: "esm",
      target: "node24",
      splitting: true,
      logLevel: "silent",
    });
    const inputs = Object.keys(result.metafile.inputs).map(normalizePath);
    const entries = Object.values(result.metafile.outputs)
      .map((output) => output.entryPoint && normalizePath(output.entryPoint))
      .filter((entry): entry is string => entry !== undefined);
    expect(entries).toContain("src/kiro/mcp-entry.ts");
    expect(inputs).not.toContain("src/kiro/agent-worker-entry.ts");
    expect(inputs).not.toContain("src/kiro/management-entry.ts");
    expect(inputs).not.toContain("src/kiro/acp-worker.ts");
  }, 30_000);
});

describe("Kiro deployable closure graph", () => {
  let metafile!: Metafile;

  beforeAll(async () => {
    const result = await build({
      entryPoints: [...ENTRY_POINTS],
      outdir: "dist/.closure-graph-test",
      outbase: "src",
      entryNames: "[dir]/[name]",
      chunkNames: "chunks/[name]-[hash]",
      bundle: true,
      write: false,
      metafile: true,
      platform: "node",
      format: "esm",
      target: "node24",
      splitting: true,
      logLevel: "silent",
    });
    metafile = result.metafile;
  }, 30_000);

  it("keeps both stable process entries in the graph", () => {
    const emittedEntries = Object.values(metafile.outputs)
      .map((output) => output.entryPoint && normalizePath(output.entryPoint))
      .filter((entry): entry is string => entry !== undefined);

    expect(emittedEntries).toEqual(expect.arrayContaining([...ENTRY_POINTS]));
  });

  it("does not pull generic managers, runner implementations, transports, actors, or residency", () => {
    const forbidden = Object.keys(metafile.inputs)
      .map(normalizePath)
      .filter(
        (input) =>
          FORBIDDEN_INPUT_FILES.has(input) ||
          FORBIDDEN_INPUT_ROOTS.some((root) => input.startsWith(root)),
      );

    expect(forbidden).toEqual([]);
  });

  it("does not bundle generic Pi runtime packages", () => {
    const forbiddenPackages = [...new Set(
      Object.keys(metafile.inputs)
        .map(packageNameFromInput)
        .filter((name): name is string => name?.startsWith("@earendil-works/") === true),
    )].sort();

    expect(forbiddenPackages).toEqual([]);
  });
});
