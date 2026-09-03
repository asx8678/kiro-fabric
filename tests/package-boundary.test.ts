import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { isPackedPackageFileAllowed } from "../scripts/package-policy.mjs";
import { validateAgentPackage } from "../scripts/validate-agent-package.mjs";

const root = path.resolve(".");
const files = (directory: string): string[] => {
  const result: string[] = [];
  const visit = (current: string) => { for (const entry of fs.readdirSync(current, { withFileTypes: true })) { if ([".git", "node_modules", ".tmp"].includes(entry.name)) continue; const target = path.join(current, entry.name); if (entry.isDirectory()) visit(target); else result.push(target); } };
  visit(directory); return result;
};

describe("Agent product boundary", () => {
  it("keeps the file-by-file audit complete and documented repository paths live", () => {
    const documentation = [
      ...files(path.join(root, "docs")).filter((file) => file.endsWith(".md")),
      ...["README.md", "STATUS.md", "SECURITY.md"].map((file) => path.join(root, file)),
    ];
    for (const file of documentation) {
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(/`((?:src|scripts|tests|docs|skills)\/[^`\s,)]+)`/gu)) {
        const referenced = match[1]!.replace(/[.:;]+$/u, "");
        expect(fs.existsSync(path.join(root, referenced)), `${path.relative(root, file)} -> ${referenced}`).toBe(true);
      }
    }
    const audit = fs.readFileSync(path.join(root, "docs", "audit.md"), "utf8");
    const audited = [
      ...files(path.join(root, "src")).filter((file) => file.endsWith(".ts")),
      ...files(path.join(root, "scripts")).filter((file) => file.endsWith(".mjs")),
      ...files(path.join(root, "tests")).filter((file) => file.endsWith(".test.ts")),
    ];
    for (const file of audited) {
      const relative = path.relative(root, file).replaceAll("\\", "/");
      expect(audit, `missing audit inventory entry: ${relative}`).toContain(`\`${relative}\``);
    }
  });

  it("keeps the checkout-local Agent launchable and CI on Agent tests", () => {
    const profile = JSON.parse(fs.readFileSync(path.join(root, ".kiro", "agents", "kiro-fabric.json"), "utf8"));
    expect(profile.includePowers).toBe(false);
    expect(profile.includeMcpJson).toBe(false);
    expect(Object.keys(profile.mcpServers)).toEqual(["fabric"]);
    expect(profile.mcpServers.fabric).toEqual({ command: "node", args: ["./scripts/run-agent-dev.mjs"] });
    expect(profile.resources).toEqual(["file://skills/fabric-exec/SKILL.md"]);
    const launched = spawnSync(process.execPath, [path.join(root, "scripts", "run-agent-dev.mjs")], {
      cwd: path.dirname(root),
      encoding: "utf8",
      input: "",
      timeout: 30_000,
    });
    expect(launched.status, launched.stderr).toBe(0);
    const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
    expect(workflow).toContain("tests/agent-user-install.test.ts");
    expect(workflow).not.toContain("tests/power-user-install.test.ts");
  });

  it("validates the exact staged package and sole closure", () => {
    const result = validateAgentPackage(path.join(root, ".tmp", "kiro-fabric-agent"));
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(root, "dist", "kiro-closure"))).toBe(false);
    const closure = files(path.join(root, "dist", "kiro-agent-closure")).map((file) => path.relative(root, file));
    const removedEntries = ["agent-worker", "management-entry", `node-${"process"}-runtime`];
    expect(closure.some((file) => removedEntries.some((entry) => file.includes(entry)))).toBe(false);
  });

  it("contains no forbidden packages or removed launch identifiers", () => {
    const selectedRoots = [
      "src", "tests", "scripts", "docs", "skills", ".github", ".kiro",
      "AGENTS.md", "README.md", "STATUS.md", "SECURITY.md", "CHANGELOG.md",
      "THIRD_PARTY_NOTICES.md", "package.json", "pnpm-lock.yaml", "agent-product.json", "knip.json",
    ];
    const selected = selectedRoots.flatMap((entry) => {
      const target = path.join(root, entry);
      return fs.statSync(target).isDirectory() ? files(target) : [target];
    });
    const body = selected.map((file) => fs.readFileSync(file, "utf8")).join("\n");
    const forbidden = [
      `@earendil-works/${"pi"}-`, `@mariozechner/${"pi"}-`, `PI_CODING_${"AGENT"}_DIR`,
      `managed-${"main"}`, `internal-${"child"}`, `kiro-fabric-${"dev"}`,
      `fullCode${"Mode"}`,
    ];
    for (const term of forbidden) expect(body).not.toContain(term);
    expect(body).not.toContain(String.fromCodePoint(960));
    expect(body).not.toMatch(new RegExp(`\\b(?:${["k", "pi", "agents"].join("|")})\\.[A-Za-z_$]`, "u"));
    expect(body).not.toContain(`.${"pi"}/`);
  });

  it("keeps only the focused Agent provider and release implementations", () => {
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
    for (const file of included) expect(isPackedPackageFileAllowed(file), file).toBe(true);
    for (const unexpected of [
      "src/index.ts", "docs/unlisted.md", "dist/chunks/nested/chunk.js",
      "dist/../src/escape.d.ts", "skills/fabric-exec/../secret", "dist\\index.d.ts",
    ]) expect(isPackedPackageFileAllowed(unexpected), unexpected).toBe(false);
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
    expect(fs.existsSync(path.join(root, "scripts/run-kiro-agent-real-driver.mjs"))).toBe(true);
  });

  it("MCP certification reports exactly three tools", () => {
    const result = spawnSync(process.execPath, ["scripts/certify-kiro-agent.mjs"], { cwd: root, encoding: "utf8", timeout: 60_000 });
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.tools).toEqual(["fabric_info", "fabric_workspace", "fabric_exec"]);
    expect(report.customAgentSelected).toBe(true);
    expect(report.powerActivated).toBe(false);
  });
});
