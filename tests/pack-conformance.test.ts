import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertPackagePolicy,
  BUILT_RUNTIME_ARTIFACTS,
  PACKAGE_FILES,
  PUBLISHED_DECLARATION_ARTIFACTS,
} from "../scripts/package-policy.mjs";
// ^ The `scripts/package-policy.d.mts` sidecar provides static types for the shared policy.

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

describe("pack conformance", () => {
  it("keeps the published manifest scoped to dist/docs/skills and top-level docs", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    ) as PackageManifest;

    expect(() => assertPackagePolicy()).not.toThrow();
    expect(manifest.files).toEqual(PACKAGE_FILES);
    expect(new Set(manifest.files).size).toBe(manifest.files?.length);

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

  it("keeps the shared build and package policy free of source/test/script/vendor payloads", () => {
    const allowlist = [
      ...BUILT_RUNTIME_ARTIFACTS,
      ...BUILT_RUNTIME_ARTIFACTS.map((file: string) => `${file}.map`),
      ...PUBLISHED_DECLARATION_ARTIFACTS,
      ...PUBLISHED_DECLARATION_ARTIFACTS.map((file: string) => `${file}.map`),
    ];

    expect(BUILT_RUNTIME_ARTIFACTS.length).toBeGreaterThan(0);
    expect(BUILT_RUNTIME_ARTIFACTS).toContain("dist/protocol.js");
    expect(BUILT_RUNTIME_ARTIFACTS).toContain("dist/kiro/agent-worker-entry.js");
    expect(BUILT_RUNTIME_ARTIFACTS).toContain("dist/verification/index.js");
    for (const entry of allowlist) {
      const normalized = normalizeRelative(entry).replace(/^dist\//u, "");
      expect(
        FORBIDDEN_PREFIXES.some((prefix) =>
          normalized === prefix || normalized.startsWith(prefix) || normalized.includes(`/${prefix}`)
        ),
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
