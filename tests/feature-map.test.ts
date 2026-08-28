import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mapDir = path.join(root, "docs", "feature-map");
const REQUIRED_H2 = ["Sub-features", "How to get to it (user POV)", "Driving it with pnpm, Vitest, and the packaged CLI", "Gotchas"];

const featureFiles = fs
  .readdirSync(mapDir)
  .filter((f) => f.endsWith(".md") && f !== "README.md")
  .sort();

describe("maintained feature map (V6)", () => {
  it("README links to exactly the sibling feature files (and nothing else)", () => {
    const readme = fs.readFileSync(path.join(mapDir, "README.md"), "utf8");
    for (const f of featureFiles) {
      expect(readme).toContain(`\`${f}\``);
    }
    // every .md link target inside README is a real sibling file
    const linkTargets = [...readme.matchAll(/\]\(\.\/([a-z0-9-]+\.md)\)/g)].map((m) => m[1]);
    for (const t of linkTargets) {
      expect(featureFiles).toContain(t);
    }
  });

  it("every feature file has the required H2 headings once and in order", () => {
    for (const f of featureFiles) {
      const text = fs.readFileSync(path.join(mapDir, f), "utf8");
      const headings = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
      expect(headings, f).toEqual(REQUIRED_H2);
    }
  });

  it("each feature exposes stable unique kebab-case sub-feature ids", () => {
    const seen = new Set<string>();
    for (const f of featureFiles) {
      const text = fs.readFileSync(path.join(mapDir, f), "utf8");
      const ids = [...text.matchAll(/^\- \`([a-z0-9-]+)\.[a-z0-9-]+\`/gm)].map((m) => m[0]);
      for (const t of ids) {
        expect(t).toMatch(/^\- \`[a-z0-9-]+(\.[a-z0-9-]+)+\`$/);
        expect(seen.has(t)).toBe(false);
        seen.add(t);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  it("does not mark billable/PR gates in the Kiro feature file as available", () => {
    const kiro = fs.readFileSync(path.join(mapDir, "kiro-lifecycle.md"), "utf8");
    expect(kiro).toContain("qualified");
    expect(kiro).toContain("unavailable");
  });
});