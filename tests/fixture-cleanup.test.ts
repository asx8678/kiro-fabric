import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureCleanupDecision, removeFixture, removeFixtureSync } from "./fixture-cleanup.mjs";

const roots: string[] = [];
function fixture() { const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "preserved-fixture-"))); roots.push(root); return root; }
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) removeFixtureSync(root, { recursive: true, force: true }); });

describe("repository-preserving test teardown", () => {
  it.each(["directory", "worktree", "symlink", "case-folded"])("retains the whole ancestor fixture for a nested %s marker", async kind => {
    const root = fixture(), repo = path.join(root, "nested", "repo"); fs.mkdirSync(repo, { recursive: true });
    const marker = path.join(repo, kind === "case-folded" ? ".GIT" : ".git");
    if (kind === "directory" || kind === "case-folded") fs.mkdirSync(marker);
    else if (kind === "worktree") fs.writeFileSync(marker, "gitdir: ../retained\n");
    else fs.symlinkSync("absent", marker);
    fs.writeFileSync(path.join(root, "sentinel"), "preserved");
    expect(fixtureCleanupDecision(root)).toEqual({ remove: false, reason: "Git metadata" });
    removeFixtureSync(root, { recursive: true, force: true }); await removeFixture(root, { recursive: true, force: true });
    expect(fs.lstatSync(marker)).toBeDefined(); expect(fs.readFileSync(path.join(root, "sentinel"), "utf8")).toBe("preserved");
  });
  it("preserves an actual git-init fixture without creating commits or deleting its metadata", () => {
    const root = fixture(), repo = path.join(root, "repo");
    const result = spawnSync("git", ["init", "--quiet", repo], { encoding: "utf8", timeout: 15000 });
    expect(result.error).toBeUndefined(); expect(result.status, result.stderr).toBe(0);
    const before = fs.readFileSync(path.join(repo, ".git", "HEAD"));
    expect(fixtureCleanupDecision(root).remove).toBe(false);
    removeFixtureSync(root, { recursive: true, force: true });
    expect(fs.readFileSync(path.join(repo, ".git", "HEAD"))).toEqual(before);
  });
  it("preserves bare repository layouts and direct metadata removal requests", async () => {
    const root = fixture(); for (const name of ["objects", "refs"]) fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, "HEAD"), "ref: refs/heads/main\n");
    expect(fixtureCleanupDecision(root)).toEqual({ remove: false, reason: "bare Git repository" });
    await removeFixture(root, { recursive: true, force: true }); expect(fs.existsSync(path.join(root, "HEAD"))).toBe(true);
    expect(fixtureCleanupDecision(path.join(root, ".git", "objects")).remove).toBe(false);
  });
  it("removes inspected non-repository fixtures through sync and async APIs", async () => {
    const a = fixture(), b = fixture(); fs.writeFileSync(path.join(a, "generated"), "owned");
    removeFixtureSync(pathToFileURL(a), { recursive: true, force: true }); await removeFixture(b, { recursive: true, force: true });
    expect(fs.existsSync(a)).toBe(false); expect(fs.existsSync(b)).toBe(false);
  });
  it("does not follow links out of the fixture", () => {
    const outside = fixture(), root = fixture(); fs.mkdirSync(path.join(outside, ".git")); fs.symlinkSync(outside, path.join(root, "alias"));
    expect(fixtureCleanupDecision(root).remove).toBe(true); removeFixtureSync(root, { recursive: true, force: true });
    expect(fs.existsSync(path.join(outside, ".git"))).toBe(true);
  });
  it.skipIf(process.getuid?.() === 0)("retains an uninspectable fixture instead of treating an error as an empty tree", () => {
    const root = fixture(); fs.chmodSync(root, 0o000);
    try { expect(fixtureCleanupDecision(root)).toEqual({ remove: false, reason: "inspection unavailable" }); }
    finally { fs.chmodSync(root, 0o700); }
    expect(fs.existsSync(root)).toBe(true);
  });
  it("does not consume production stat/readdir fault injections while inspecting a repository", () => {
    const root = fixture(); fs.mkdirSync(path.join(root, ".git"));
    const stat = vi.spyOn(fs, "lstatSync").mockImplementation(() => { throw Object.assign(new Error("mock absent"), { code: "ENOENT" }); });
    const read = vi.spyOn(fs, "readdirSync").mockImplementation(() => { throw new Error("production fault"); });
    expect(fixtureCleanupDecision(root).remove).toBe(false); expect(stat).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });
  it("refuses unbounded traversal and unsafe cleanup roots", () => {
    const root = fixture(); let leaf = root;
    for (let i = 0; i < 130; i++) { leaf = path.join(leaf, "x"); fs.mkdirSync(leaf); }
    expect(fixtureCleanupDecision(root)).toEqual({ remove: false, reason: "inspection bound reached" });
    expect(fixtureCleanupDecision(process.cwd()).remove).toBe(false); expect(fixtureCleanupDecision(path.parse(root).root).remove).toBe(false);
  });
  it("keeps explicit test rm calls behind the helper, without patching production fs", () => {
    const violations: string[] = [];
    const walk = (directory: string) => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name); if (entry.isDirectory()) { walk(file); continue; }
      if (!/\.(ts|mjs)$/.test(file) || file.endsWith("fixture-cleanup.mjs")) continue;
      const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const aliases = new Set<string>();
      for (const node of source.statements) if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && /^(node:)?fs(\/promises)?$/.test(node.moduleSpecifier.text)) {
        const clause = node.importClause; if (clause?.name) aliases.add(clause.name.text);
        if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) aliases.add(clause.namedBindings.name.text);
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const name of clause.namedBindings.elements) if (["rm", "rmSync"].includes((name.propertyName ?? name.name).text)) violations.push(file + ": raw removal import");
      }
      const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["rm", "rmSync"].includes(node.expression.name.text)) {
        let base: ts.Expression = node.expression.expression; if (ts.isPropertyAccessExpression(base) && base.name.text === "promises") base = base.expression;
        if (ts.isIdentifier(base) && aliases.has(base.text)) violations.push(file + ": raw removal call");
      } ts.forEachChild(node, visit); }; visit(source);
    } }; walk("tests"); expect(violations).toEqual([]);
  });
  it("retains a case-folded bare repository layout", () => {
    const root = fixture(); for (const name of ["objects", "refs"]) fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, "head"), "ref: refs/heads/main\n");
    expect(fixtureCleanupDecision(root)).toEqual({ remove: false, reason: "bare Git repository" });
    removeFixtureSync(root, { recursive: true, force: true });
    expect(fs.readFileSync(path.join(root, "head"), "utf8")).toBe("ref: refs/heads/main\n");
  });
  it("bounds a single directory with a pathological entry count mid-stream", () => {
    const root = fixture();
    for (let i = 0; i < 25_001; i++) fs.writeFileSync(path.join(root, `entry-${i}`), "");
    expect(fixtureCleanupDecision(root)).toEqual({ remove: false, reason: "inspection bound reached" });
    expect(fs.existsSync(root)).toBe(true);
    const leaf = path.join(root, "leaf"); fs.mkdirSync(leaf);
    // A tiny target must not bypass the budget while scanning its wide parent.
    expect(fixtureCleanupDecision(leaf)).toEqual({ remove: false, reason: "inspection bound reached" });
  });

  // The following cases assert the decision only. None of them call a removal
  // API: a dangerous target that is wrongly authorized would destroy a kept
  // repository. The afterEach hook still runs the guard over each fixture, so
  // these repository fixtures remain retained.
  it("refuses an intermediate symlink alias into Git metadata objects", () => {
    const root = fixture(), repo = path.join(root, "repo");
    fs.mkdirSync(path.join(repo, ".git", "objects"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".git", "objects", "sentinel"), "preserved");
    fs.symlinkSync(path.join(repo, ".git"), path.join(root, "metadata-alias"));
    expect(fixtureCleanupDecision(path.join(root, "metadata-alias", "objects"))).toEqual({ remove: false, reason: "symlinked cleanup ancestry" });
    expect(fs.readFileSync(path.join(repo, ".git", "objects", "sentinel"), "utf8")).toBe("preserved");
  });
  it("refuses a target reached through an intermediate alias of an unsafe root", () => {
    const owned = fixture(), root = fixture();
    fs.symlinkSync(os.tmpdir(), path.join(root, "tmp-alias"));
    expect(fixtureCleanupDecision(path.join(root, "tmp-alias", path.basename(owned)))).toEqual({ remove: false, reason: "symlinked cleanup ancestry" });
    expect(fs.existsSync(owned)).toBe(true);
  });
  it("refuses a direct bare-repository metadata subtree target", () => {
    const root = fixture(); for (const name of ["objects", "refs"]) fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, "HEAD"), "ref: refs/heads/main\n");
    expect(fixtureCleanupDecision(path.join(root, "objects"))).toEqual({ remove: false, reason: "bare Git repository" });
    expect(fs.readFileSync(path.join(root, "HEAD"), "utf8")).toBe("ref: refs/heads/main\n");
  });
  it("refuses ancestry depth exhaustion before authorizing a bare metadata descendant", () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, "HEAD"), "ref: refs/heads/main\n");
    fs.mkdirSync(path.join(root, "refs"));
    let leaf = path.join(root, "objects"); fs.mkdirSync(leaf);
    for (let i = 0; i < 130; i++) { leaf = path.join(leaf, "x"); fs.mkdirSync(leaf); }
    fs.writeFileSync(path.join(leaf, "sentinel"), "preserved");
    expect(fixtureCleanupDecision(leaf)).toEqual({ remove: false, reason: "inspection bound reached" });
    expect(fs.readFileSync(path.join(leaf, "sentinel"), "utf8")).toBe("preserved");
  });
  it("keeps final-symlink unlink semantics without following the link", () => {
    const outside = fixture(), root = fixture();
    fs.mkdirSync(path.join(outside, "kept"));
    fs.symlinkSync(outside, path.join(root, "alias"));
    expect(fixtureCleanupDecision(path.join(root, "alias"))).toEqual({ remove: true, reason: "inspected generated fixture" });
    expect(fs.existsSync(path.join(outside, "kept"))).toBe(true);
  });
  it("fails closed when symlinked ancestry cannot be inspected", () => {
    const root = fixture();
    fs.symlinkSync(path.join(root, "b"), path.join(root, "a"));
    fs.symlinkSync(path.join(root, "a"), path.join(root, "b"));
    expect(fixtureCleanupDecision(path.join(root, "a", "child"))).toEqual({ remove: false, reason: "inspection unavailable" });
  });
});
