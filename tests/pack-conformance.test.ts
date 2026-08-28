import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  files?: string[];
  main?: string;
  types?: string;
  bin?: Record<string, string>;
  exports?: Record<string, unknown>;
}

const root = path.resolve(import.meta.dirname, "..");
const FORBIDDEN_PREFIXES = ["src/", "tests/", "scripts/", "node_modules/"];

const normalizeRelative = (value: string): string => value.replace(/^\.\//, "");

const collectStrings = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
  return [];
};

const parseStableAllowlist = (script: string): string[] => {
  const body = script.match(/const stable = \[(?<body>[\s\S]*?)\];/)?.groups?.body;
  expect(body, "stable build allowlist should exist").toBeDefined();
  if (!body) throw new Error("stable build allowlist missing");
  return [...body.matchAll(/"([^"]+)"/g)].map((entry) => entry[1]!);
};

const requiredDistPaths = (stable: readonly string[]): string[] => {
  const declarations = stable.map((file) => file.replace(/\.js$/, ".d.ts"));
  return [
    ...stable,
    ...stable.map((file) => `${file}.map`),
    ...declarations,
    ...declarations.map((file) => `${file}.map`),
    "chunks/*.js",
    "chunks/*.js.map",
  ];
};

describe("pack conformance", () => {
  it("keeps the published manifest scoped to dist/docs/skills and top-level docs", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    ) as PackageManifest;

    expect(manifest.files).toEqual([
      "dist/",
      "!dist/**/*.map",
      "!dist/worker.js",
      "skills/",
      "docs/skills.md",
      "docs/kiro/installer.md",
      "docs/kiro/parity-qualification.md",
      "docs/kiro/capabilities-2.19.1.md",
      "docs/kiro/capabilities-2.20.1-v3.md",
      "docs/kiro/release-a.md",
      "README.md",
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
    ]);

    for (const file of manifest.files ?? []) {
      const normalized = normalizeRelative(file);
      expect(
        FORBIDDEN_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(prefix)),
        `${file} must not publish forbidden source/test/script/vendor trees`,
      ).toBe(false);
    }
  });

  it("keeps all exported runtime entrypoints under dist", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    ) as PackageManifest;

    const exportedPaths = [
      manifest.main,
      manifest.types,
      ...Object.values(manifest.bin ?? {}),
      ...collectStrings(manifest.exports),
    ].filter((value): value is string => typeof value === "string");

    expect(exportedPaths.length).toBeGreaterThan(0);
    for (const target of exportedPaths) {
      const normalized = normalizeRelative(target);
      expect(normalized.startsWith("dist/"), `${target} must stay inside dist/`).toBe(true);
      expect(
        FORBIDDEN_PREFIXES.some((prefix) => normalized.includes(`/${prefix}`) || normalized.startsWith(prefix)),
        `${target} must not point at forbidden trees`,
      ).toBe(false);
    }
  });

  it("keeps the build artifact allowlist free of src/tests/scripts/node_modules payloads", () => {
    const script = fs.readFileSync(path.join(root, "scripts", "assert-build-artifacts.mjs"), "utf8");
    const stable = parseStableAllowlist(script);
    const allowlist = requiredDistPaths(stable);

    expect(stable.length).toBeGreaterThan(0);
    expect(stable).toContain("protocol.js");
    expect(stable).toContain("verification/index.js");
    for (const entry of allowlist) {
      expect(
        FORBIDDEN_PREFIXES.some((prefix) => entry === prefix || entry.startsWith(prefix) || entry.includes(`/${prefix}`)),
        `${entry} must not allow foreign source/test/script/vendor artifacts into dist/`,
      ).toBe(false);
    }
  });

  it("ships the verification JavaScript and declaration entrypoint", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    ) as PackageManifest;

    expect(manifest.exports).toMatchObject({
      "./verification": {
        types: "./dist/verification/index.d.ts",
        import: "./dist/verification/index.js",
      },
    });
  });
});
