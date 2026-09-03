import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { assertPackagePolicy, isPackedPackageFileAllowed } from "../scripts/package-policy.mjs";
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

  it("keeps the repository and release stage non-discoverable so the global Agent cannot be shadowed", () => {
    for (const candidate of [
      ".kiro/agents/kiro-fabric.json",
      ".kiro/agents/kiro-fabric.md",
      ".kiro/agents/kiro-fabric.yaml",
      ".kiro/agents/kiro-fabric.yml",
      ".kiro/agents/run-fabric-mcp.mjs",
      ".tmp/kiro-fabric-agent/agent.json",
      ".tmp/kiro-fabric-agent/.kiro/agents/kiro-fabric.json",
    ]) {
      expect(fs.existsSync(path.join(root, candidate)), candidate).toBe(false);
    }
    const packageManifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    expect(packageManifest.files.some((entry: string) => entry.startsWith(".kiro/") || entry.includes("kiro-fabric.json"))).toBe(false);
    const releaseStage = validateAgentPackage(path.join(root, ".tmp", "kiro-fabric-agent"));
    expect(releaseStage.inventory.files.some((entry: { path: string }) => entry.path.includes(".kiro/") || entry.path.endsWith("agent.json"))).toBe(false);
    expect(releaseStage.inventory.files.map((entry: { path: string }) => entry.path)).toEqual(expect.arrayContaining([
      "scripts/agent-profile.mjs",
      "scripts/install-agent-user.mjs",
      "scripts/validate-agent-package.mjs",
    ]));
    const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
    expect(workflow).toContain("tests/agent-user-install.test.ts");
    expect(workflow).not.toContain("tests/power-user-install.test.ts");

    const shadowRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-shadow-policy-"));
    try {
      fs.copyFileSync(path.join(root, "package.json"), path.join(shadowRoot, "package.json"));
      fs.copyFileSync(path.join(root, "agent-product.json"), path.join(shadowRoot, "agent-product.json"));
      const agents = path.join(shadowRoot, ".kiro", "agents");
      fs.mkdirSync(agents, { recursive: true });
      for (const name of ["kiro-fabric.md", "kiro-fabric.future-agent-format"]) {
        const shadow = path.join(agents, name);
        fs.writeFileSync(shadow, "---\nname: kiro-fabric\n---\n");
        expect(() => assertPackagePolicy(shadowRoot)).toThrow("discoverable checkout Agent would shadow");
        fs.unlinkSync(shadow);
      }
    } finally {
      fs.rmSync(shadowRoot, { recursive: true, force: true });
    }
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
      "src", "tests", "scripts", "docs", "skills", ".github",
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

  it("publishes an honest library-only npm artifact with every relative runtime dependency", () => {
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
    expect([...included].some((file) => file.startsWith(".kiro/") || file.startsWith("skills/") || file.startsWith("dist/kiro-agent-closure/") || file === "agent-product.json")).toBe(false);
    for (const file of [...included].filter((entry) => entry.endsWith(".js"))) {
      const text = fs.readFileSync(path.join(root, file), "utf8");
      for (const match of text.matchAll(/(?:from\s*|import\()\s*["'](\.[^"']+)["']/gu)) {
        const target = path.normalize(path.join(path.dirname(file), match[1]!)).replaceAll("\\", "/");
        expect(included.has(target), `${file} -> ${target}`).toBe(true);
      }
    }

    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-npm-pack-"));
    try {
      const artifact = spawnSync("pnpm", ["pack", "--json", "--pack-destination", temporary, "--config.ignore-scripts=true"], {
        cwd: root,
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(artifact.status, artifact.stderr).toBe(0);
      const artifactReport = JSON.parse(artifact.stdout);
      const artifactDocument = Array.isArray(artifactReport) ? artifactReport[0] : artifactReport;
      const tarball = path.isAbsolute(artifactDocument.filename)
        ? artifactDocument.filename
        : path.join(temporary, path.basename(artifactDocument.filename));
      const extracted = path.join(temporary, "extracted");
      fs.mkdirSync(extracted, { mode: 0o700 });
      const unpack = spawnSync("tar", ["-xzf", tarball, "-C", extracted], { encoding: "utf8" });
      expect(unpack.status, unpack.stderr).toBe(0);
      const packageRoot = path.join(extracted, "package");
      const extractedPackage = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
      expect(extractedPackage.main).toBe("./dist/index.js");
      expect(fs.existsSync(path.join(packageRoot, "dist", "index.js"))).toBe(true);
      expect(fs.existsSync(path.join(packageRoot, ".kiro"))).toBe(false);
      expect(fs.existsSync(path.join(packageRoot, "scripts", "install-agent-user.mjs"))).toBe(false);

      const modulesState = fs.readFileSync(path.join(root, "node_modules", ".modules.yaml"), "utf8");
      const storeEntry = /^\s*(?:"storeDir"|storeDir):\s*(?:"([^"]+)"|'([^']+)'|([^,\r\n#]+)),?\s*$/mu.exec(modulesState);
      const storePath = (storeEntry?.[1] ?? storeEntry?.[2] ?? storeEntry?.[3] ?? "").trim();
      expect(path.isAbsolute(storePath)).toBe(true);
      expect(fs.statSync(storePath).isDirectory()).toBe(true);

      // Reuse only the repository's lock, pinned resolution policy, and
      // populated content-addressable store. The extracted tarball remains a
      // clean unrelated tree and cannot resolve through checkout modules.
      fs.copyFileSync(path.join(root, "pnpm-lock.yaml"), path.join(packageRoot, "pnpm-lock.yaml"));
      fs.copyFileSync(path.join(root, "pnpm-workspace.yaml"), path.join(packageRoot, "pnpm-workspace.yaml"));
      const install = spawnSync("pnpm", [
        "install",
        "--prod",
        "--offline",
        "--ignore-scripts",
        "--frozen-lockfile",
        "--store-dir",
        storePath,
      ], {
        cwd: packageRoot,
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(install.status, install.stderr || install.stdout).toBe(0);

      const installedModules = fs.realpathSync(path.join(packageRoot, "node_modules"));
      expect(installedModules.startsWith(`${fs.realpathSync(packageRoot)}${path.sep}`)).toBe(true);
      expect(installedModules.startsWith(`${fs.realpathSync(path.join(root, "node_modules"))}${path.sep}`)).toBe(false);

      const dependencies = Object.keys(extractedPackage.dependencies ?? {}).sort();
      expect(dependencies).toEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).dependencies).sort());
      const dependencyProbes = {
        "@jitl/quickjs-singlefile-mjs-release-sync": "@jitl/quickjs-singlefile-mjs-release-sync",
        "@modelcontextprotocol/sdk": "@modelcontextprotocol/sdk/server/index.js",
        mcporter: "mcporter",
        "quickjs-emscripten-core": "quickjs-emscripten-core",
        typebox: "typebox/value",
        typescript: "typescript",
      };
      expect(Object.keys(dependencyProbes).sort()).toEqual(dependencies);
      const importScript = `
        import path from "node:path";
        import { pathToFileURL } from "node:url";
        const entry = pathToFileURL(path.resolve("dist/index.js")).href;
        for (const dependency of ${JSON.stringify(Object.values(dependencyProbes))}) await import(dependency);
        const api = await import(entry);
        if (typeof api.createKiroMcpServer !== "function") process.exit(2);
      `;
      const imported = spawnSync(process.execPath, ["--input-type=module", "--eval", importScript], {
        cwd: packageRoot,
        encoding: "utf8",
        timeout: 30_000,
      });
      expect(imported.status, imported.stderr).toBe(0);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("removes the user export subsystem", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.scripts["power:export:user"]).toBeUndefined();
    expect(fs.existsSync(path.join(root, "scripts/power-user-install.mjs"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".tmp/kiro-fabric-agent/scripts/install-agent-user.mjs"))).toBe(true);
  });

  it("MCP certification reports exactly three tools", () => {
    const result = spawnSync(process.execPath, ["scripts/certify-kiro-agent.mjs"], { cwd: root, encoding: "utf8", timeout: 60_000 });
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.tools).toEqual(["fabric_info", "fabric_workspace", "fabric_exec"]);
    expect(report.scope).toBe("component-mcp-only");
    expect(report.checks).toContain("idempotent-info");
    expect(report.checks).toContain("single-runtime-generation");
    expect(report.checks).toContain("form-elicitation-decline");
    expect(report.checks).not.toContain("bounded-output");
    expect(report.customAgentSelected).toBeUndefined();
    expect(report.powerActivated).toBeUndefined();
  });
});
