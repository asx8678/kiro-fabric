import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ActionRegistry } from "../src/core/action-registry.js";
import { LocalCodingProvider } from "../src/providers/local-provider.js";
import type { LocalFindResult, LocalGrepResult, LocalReadResult } from "../src/providers/local-contract.js";
import { schemaValidationMessage } from "../src/schema-validation.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";
import { fabricGuestDeclarations } from "../src/runtime/guest-types.js";

const fixtures: { base: string; provider: LocalCodingProvider }[] = [];
afterEach(async () => {
  for (const { base, provider } of fixtures.splice(0)) {
    await provider.close();
    fs.rmSync(base, { recursive: true, force: true });
  }
});
function fixture(budget = 20000) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-review-coverage-")));
  const root = path.join(base, "workspace"); fs.mkdirSync(root);
  const provider = new LocalCodingProvider({ root, lockRoot: path.join(base, "locks"), maxResultChars: budget });
  fixtures.push({ base, provider });
  const registry = new ActionRegistry(); registry.register(provider);
  const put = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  const call = (name: string, args: Record<string, unknown>) => registry.invoke(`local.${name}`, args, {
    cwd: root, audits: [], maxResultChars: budget,
    approve: async action => { expect(action.risk).toBe("read"); },
  });
  return { root, provider, put, call };
}

describe("review coverage contracts", () => {
  it("finds hidden CI consumers recursively without dropping ignore rules or VCS exclusions", async () => {
    const f = fixture();
    f.put(".azure-pipelines/cleanup.yml", "filePath: scripts/cleanup.ps1\n");
    f.put(".github/workflows/test.yml", "run: validate\n");
    f.put(".git/config", "filePath: secret\n");
    f.put("nested/.hg/store", "filePath: secret\n");
    f.put(".svn/entries", "filePath: secret\n");
    f.put(".gitignore", "ignored/\n");
    f.put("ignored/.azure-pipelines/decoy.yml", "filePath: decoy\n");
    f.put("scripts/cleanup.ps1", "$apiKeys[$idx]\n");
    const normal = await f.call("grep", { pattern: "filePath", path: "." }) as LocalGrepResult;
    expect(normal).toEqual({ scope: { path: ".", hidden: false, ignoreFiles: true }, matches: [], truncated: false, scopeExhausted: true });
    const hidden = await f.call("grep", { pattern: "filePath", path: ".", hidden: true }) as LocalGrepResult;
    expect(hidden).toEqual({ scope: { path: ".", hidden: true, ignoreFiles: true }, matches: [{ path: ".azure-pipelines/cleanup.yml", line: 1, text: "filePath: scripts/cleanup.ps1" }], truncated: false, scopeExhausted: true });
    const found = await f.call("find", { pattern: "**/*", hidden: true }) as LocalFindResult;
    expect(found.paths).toEqual([".azure-pipelines/cleanup.yml", ".github/workflows/test.yml", ".gitignore", "scripts/cleanup.ps1"]);
    expect(found.scope).toEqual({ path: ".", glob: "**/*", hidden: true, ignoreFiles: true });
    expect(found.truncated).toBe(false);
    for (const [name, value] of [["grep", hidden], ["find", found]] as const) {
      const descriptor = await f.provider.describe(name);
      expect(schemaValidationMessage(descriptor!.outputSchema!, { ...value })).toBeUndefined();
    }
    for (const pattern of ["ignored/**", ".git/**", "nested/.hg/**", ".svn/**"]) {
      expect(await f.call("find", { pattern, hidden: true })).toEqual({ scope: { path: ".", glob: pattern, hidden: true, ignoreFiles: true }, paths: [], truncated: false, scopeExhausted: true });
    }
    await expect(f.call("grep", { pattern: "secret", path: ".git", hidden: true })).rejects.toThrow("VCS metadata");
    await expect(f.call("find", { pattern: "*", path: ".git/config", hidden: true })).rejects.toThrow("VCS metadata");
    expect(await f.call("grep", { pattern: "filePath", path: ".azure-pipelines" })).toMatchObject({ scope: { path: ".azure-pipelines", hidden: false, ignoreFiles: true }, matches: hidden.matches });
  });

  it("preserves hidden glob opt-in, ignore files outside git, limits and alias protection", async () => {
    const f = fixture(512);
    f.put(".ignore", "excluded/\n");
    f.put("excluded/.job.yml", "needle\n");
    for (let i = 0; i < 8; i++) f.put(`.ci/job-${i}.yml`, "needle\n");
    expect(await f.call("find", { pattern: ".ci/**" })).toMatchObject({ paths: [], truncated: false, scope: { hidden: false } });
    const found = await f.call("find", { pattern: ".ci/**", hidden: true, limit: 2 }) as LocalFindResult;
    expect(found.paths).toEqual([".ci/job-0.yml", ".ci/job-1.yml"]);
    expect(found.truncated).toBe(true);
    expect(JSON.stringify(found).length).toBeLessThanOrEqual(512);
    expect(await f.call("grep", { pattern: "needle", hidden: true, glob: "excluded/**" })).toMatchObject({ matches: [], scope: { glob: "excluded/**", hidden: true } });
    fs.symlinkSync(path.join(f.root, ".ci/job-0.yml"), path.join(f.root, ".ci/symlink.yml"));
    const safe = await f.call("find", { pattern: ".ci/**", hidden: true }) as LocalFindResult;
    expect(safe.paths).not.toContain(".ci/symlink.yml");
    fs.linkSync(path.join(f.root, ".ci/job-0.yml"), path.join(f.root, ".ci/hardlink.yml"));
    await expect(f.call("find", { pattern: ".ci/**", hidden: true })).rejects.toThrow(/hardlink/);
  });

  it("rejects unbounded scope metadata even when a search has no matches", async () => {
    const f = fixture(256);
    await expect(f.call("grep", { pattern: "absent", glob: "x".repeat(1000), hidden: true })).rejects.toThrow("result budget");
    await expect(f.call("find", { pattern: "x".repeat(1000), hidden: true })).rejects.toThrow("result budget");
  });

  it("distinguishes a complete requested range from a partially reviewed file", async () => {
    const f = fixture();
    f.put("rules.txt", Array.from({ length: 260 }, (_, i) => `rule ${i + 1}`).join("\r\n"));
    const first = await f.call("read", { path: "rules.txt", limit: 200 }) as LocalReadResult;
    expect(first).toMatchObject({ totalLines: 260, truncated: true, nextOffset: 201 });
    const tail = await f.call("read", { path: "rules.txt", offset: first.nextOffset, limit: 200 }) as LocalReadResult;
    expect(tail).toMatchObject({ totalLines: 260, truncated: false, sha256: first.sha256 });
    expect(first.text + tail.text).toBe(fs.readFileSync(path.join(f.root, "rules.txt"), "utf8"));
    expect(await f.call("read", { path: "rules.txt", offset: 41, limit: 4 })).toMatchObject({ totalLines: 260, nextOffset: 45, truncated: true });
    expect(await f.call("read", { path: "rules.txt", offset: 261 })).toMatchObject({ text: "", totalLines: 260, truncated: false });
    f.put("empty", ""); f.put("newline", "\n");
    expect(await f.call("read", { path: "empty" })).toMatchObject({ text: "", totalLines: 0, truncated: false });
    expect(await f.call("read", { path: "newline" })).toMatchObject({ text: "\n", totalLines: 1, truncated: false });
  });

  it("registers and type-checks the exact new public API while rejecting invented overrides", async () => {
    const f = fixture();
    for (const code of [
      'const r = await local.find({pattern:"**/*",hidden:true}); return {paths:r.paths,scope:r.scope};',
      'const r = await local.grep({pattern:"x",hidden:false}); return r.scope.ignoreFiles;',
      'const r = await local.read({path:"x"}); return r.totalLines;',
    ]) expect(typeCheckFabricCode(code, fabricGuestDeclarations).errors, code).toEqual([]);
    for (const code of ['return await local.find({pattern:"*",hidden:1});', 'return await local.grep({pattern:"x",noIgnore:true});']) {
      expect(typeCheckFabricCode(code, fabricGuestDeclarations).errors.length).toBeGreaterThan(0);
    }
    for (const name of ["grep", "find"]) {
      await expect(f.call(name, { pattern: "x", hidden: "true" })).rejects.toThrow("Invalid arguments");
      expect((await f.provider.describe(name))!.description).toContain("Returned scope");
    }
  });
});
