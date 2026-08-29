import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  bin?: Record<string, string>;
  exports?: Record<string, unknown>;
}

const packageName = (specifier: string): string =>
  specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : (specifier.split("/")[0] ?? specifier);

describe("package manifest", () => {
  it("installs every Kiro worker import as a runtime dependency", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    ) as PackageManifest;
    const worker = fs.readFileSync(path.join(root, "src", "kiro", "agent-worker-entry.ts"), "utf8");
    const imports = [...worker.matchAll(/\bfrom\s+["']([^"']+)["']/g)]
      .map((match) => match[1])
      .filter((specifier): specifier is string =>
        Boolean(specifier && !specifier.startsWith(".") && !specifier.startsWith("node:")),
      )
      .map(packageName);

    for (const dependency of new Set(imports)) {
      expect(
        manifest.dependencies?.[dependency],
        `${dependency} is imported by the Kiro worker but is not installed at runtime`,
      ).toBeDefined();
    }
  });

  it("exposes the Kiro kernel, adapter, and management bins", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    ) as PackageManifest;
    expect(manifest.bin).toEqual({
      "kiro-fabric": "./dist/kiro/cli-entry.js",
      "kiro-fabric-mcp": "./dist/kiro/mcp-entry.js",
      "kiro-fabric-setup": "./dist/kiro/setup-entry.js",
    });
    expect(manifest.exports).toMatchObject({
      "./protocol": {
        types: "./dist/protocol.d.ts",
        import: "./dist/protocol.js",
      },
      "./kernel": {
        types: "./dist/kernel/index.d.ts",
        import: "./dist/kernel/index.js",
      },
      "./kiro": {
        types: "./dist/kiro/index.d.ts",
        import: "./dist/kiro/index.js",
      },
    });
  });

  it("keeps Kiro release consumer installs independent of Pi packages", () => {
    const root = path.resolve(import.meta.dirname, "..");
    for (const file of [
      "certify-release-a.mjs",
      "certify-release-a-real.mjs",
      "certify-release-b-real.mjs",
      "certify-release-d-real.mjs",
    ]) {
      const source = fs.readFileSync(path.join(root, "scripts", file), "utf8");
      expect(source).not.toContain("@earendil-works/pi-coding-agent@");
      expect(source).not.toContain("@earendil-works/pi-tui@");
    }
  });

  it("keeps legacy Pi host packages development-only", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    ) as PackageManifest;
    const production = {
      ...manifest.dependencies,
      ...manifest.peerDependencies,
    };
    for (const dependency of [
      "@earendil-works/pi-ai",
      "@earendil-works/pi-coding-agent",
      "@earendil-works/pi-tui",
    ]) {
      expect(production).not.toHaveProperty(dependency);
      expect(manifest.devDependencies).toHaveProperty(dependency, "0.84.2");
    }
  });
});
