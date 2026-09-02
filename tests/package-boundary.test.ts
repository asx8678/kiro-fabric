import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { validatePowerPackage } from "../scripts/validate-power-package.mjs";

const root = path.resolve(".");
const files = (directory: string): string[] => {
  const result: string[] = [];
  const visit = (current: string) => { for (const entry of fs.readdirSync(current, { withFileTypes: true })) { if ([".git", "node_modules", ".tmp"].includes(entry.name)) continue; const target = path.join(current, entry.name); if (entry.isDirectory()) visit(target); else result.push(target); } };
  visit(directory); return result;
};

describe("Power product boundary", () => {
  it("validates the exact staged package and sole closure", () => {
    const result = validatePowerPackage(path.join(root, ".tmp", "kiro-fabric-power"));
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(root, "dist", "kiro-closure"))).toBe(false);
    const closure = files(path.join(root, "dist", "kiro-power-closure")).map((file) => path.relative(root, file));
    const removedEntries = ["agent-worker", "management-entry", `node-${"process"}-runtime`];
    expect(closure.some((file) => removedEntries.some((entry) => file.includes(entry)))).toBe(false);
  });

  it("contains no forbidden packages or removed launch identifiers", () => {
    const selectedRoots = [
      "src", "tests", "scripts", "docs", "skills", ".github", ".kiro",
      "AGENTS.md", "README.md", "STATUS.md", "SECURITY.md", "CHANGELOG.md",
      "THIRD_PARTY_NOTICES.md", "package.json", "pnpm-lock.yaml", "plugin.json",
      "mcp.json", "knip.json",
    ];
    const selected = selectedRoots.flatMap((entry) => {
      const target = path.join(root, entry);
      return fs.statSync(target).isDirectory() ? files(target) : [target];
    });
    const body = selected.map((file) => fs.readFileSync(file, "utf8")).join("\n");
    const forbidden = [
      `@earendil-works/${"pi"}-`, `@mariozechner/${"pi"}-`, `PI_CODING_${"AGENT"}_DIR`,
      `managed-${"main"}`, `internal-${"child"}`, `kiro-fabric-${"dev"}`,
      `--${"agent"} kiro-fabric`, `node-${"process"}-runtime`, `fullCode${"Mode"}`,
    ];
    for (const term of forbidden) expect(body).not.toContain(term);
    expect(body).not.toContain(String.fromCodePoint(960));
    expect(body).not.toMatch(new RegExp(`\\b(?:${["k", "pi", "agents"].join("|")})\\.[A-Za-z_$]`, "u"));
    expect(body).not.toContain(`.${"pi"}/`);
  });

  it("keeps only the focused Power provider and release implementations", () => {
    for (const removed of [
      "src/providers/mcp-provider.ts",
      "src/providers/mcp-descriptor-cache.ts",
      "scripts/certify-closure-size.mjs",
      "scripts/prune-dist-declarations.mjs",
      "scripts/report-release-size.mjs",
      "scripts/sync-power-manifests.mjs",
    ]) {
      expect(fs.existsSync(path.join(root, removed)), removed).toBe(false);
    }
    const policy = spawnSync(process.execPath, ["scripts/package-policy.mjs"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(policy.status, policy.stderr).toBe(0);
  });

  it("packs every relative runtime dependency and no source tree", () => {
    const packed = spawnSync("pnpm", ["pack", "--dry-run", "--json", "--config.ignore-scripts=true"], {
      cwd: root,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(packed.status, packed.stderr).toBe(0);
    const report = JSON.parse(packed.stdout);
    const document = Array.isArray(report) ? report[0] : report;
    const included = new Set<string>(document.files.map((entry: { path: string }) => entry.path));
    for (const required of ["dist/index.js", "dist/index.d.ts", "dist/runtime/compiler-worker-entry.js"]) {
      expect(included.has(required), required).toBe(true);
    }
    expect([...included].some((file) => /^dist\/chunks\/[^/]+\.js$/u.test(file))).toBe(true);
    expect([...included].some((file) => file.startsWith("src/") || file.startsWith("tests/") || file.startsWith("scripts/"))).toBe(false);
    for (const file of [...included].filter((entry) => entry.endsWith(".js"))) {
      const text = fs.readFileSync(path.join(root, file), "utf8");
      for (const match of text.matchAll(/(?:from\s*|import\()\s*["'](\.[^"']+)["']/gu)) {
        const target = path.normalize(path.join(path.dirname(file), match[1]!)).replaceAll("\\", "/");
        expect(included.has(target), `${file} -> ${target}`).toBe(true);
      }
    }
  });

  it("removes the user export subsystem", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.scripts["power:export:user"]).toBeUndefined();
    expect(fs.existsSync(path.join(root, "scripts/power-user-install.mjs"))).toBe(false);
    expect(fs.existsSync(path.join(root, "scripts/run-kiro-power-real-driver.mjs"))).toBe(true);
  });

  it("MCP certification reports exactly three tools", () => {
    const result = spawnSync(process.execPath, ["scripts/certify-kiro-power.mjs"], { cwd: root, encoding: "utf8", timeout: 60_000 });
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.tools).toEqual(["fabric_info", "fabric_workspace", "fabric_exec"]);
    expect(report.customAgentSelected).toBe(false);
  });
});
