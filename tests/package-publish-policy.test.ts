import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

interface PackEntry {
  filename: string;
  files: Array<{ path: string }>;
}

const packEntry = (): PackEntry => {
  const raw = execFileSync("npm", ["pack", "--ignore-scripts", "--dry-run", "--json"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: path.join(os.tmpdir(), "kiro-fabric-npm-cache") },
  });
  const parsed = JSON.parse(raw) as PackEntry[] | Record<string, PackEntry>;
  const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  if (!entry) throw new Error("npm pack returned no package entry");
  return entry;
};

describe("published package policy", () => {
  it("supports current npm JSON output and excludes source maps", () => {
    const entry = packEntry();
    expect(entry.filename).toMatch(/\.tgz$/);
    const files = new Set(entry.files.map(({ path: file }) => file));
    expect(files).toContain("dist/index.js");
    expect(files).toContain("dist/index.d.ts");
    expect(files).toContain("dist/kiro/cli-entry.js");
    expect(files).toContain("dist/kiro/mcp-entry.js");
    expect(files).toContain("dist/kiro/setup-entry.js");
    expect(files).not.toContain("dist/worker.js");
    expect([...files].filter((file) => file.endsWith(".map"))).toEqual([]);

    const declarationLeaks = [...files]
      .filter((file) => file.startsWith("dist/") && file.endsWith(".d.ts"))
      .filter((file) => /@earendil-works\/|@mariozechner\/pi-/u.test(
        fs.readFileSync(path.join(root, file), "utf8"),
      ));
    expect(declarationLeaks).toEqual([]);
  }, 30_000);
});
