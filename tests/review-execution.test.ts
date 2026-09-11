import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeFabricConfig } from "../src/config.js";
import { ActionRegistry } from "../src/core/action-registry.js";
import { FabricExecutionService } from "../src/execution-service.js";
import { LocalCodingProvider } from "../src/providers/local-provider.js";
import { fabricGuestDeclarations } from "../src/runtime/guest-types.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";
import { projectFabricExecutionText } from "../src/kiro/projection.js";

const fixtures: { base: string; service: FabricExecutionService }[] = [];
afterEach(async () => {
  for (const { base, service } of fixtures.splice(0)) {
    await service.close();
    fs.rmSync(base, { recursive: true, force: true });
  }
});
function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fabric-review-exec-")));
  const root = path.join(base, "workspace"); fs.mkdirSync(root);
  const registry = new ActionRegistry();
  registry.register(new LocalCodingProvider({ root, lockRoot: path.join(base, "locks") }));
  const service = new FabricExecutionService(registry, normalizeFabricConfig({ executor: { timeoutMs: 10000 } }), root);
  fixtures.push({ base, service });
  return { root, service };
}
const approver = {
  prepareApproval(action: { risk: string }) { expect(action.risk).toBe("read"); return { decision: "allow" as const }; },
  async approve() { throw new Error("Unexpected interactive approval"); },
};

describe("review programs through checked execution", () => {
  it("explains both observed dictionary failures without running any preceding effect", async () => {
    const { root, service } = fixture();
    for (const [annotation, expectedCode] of [["", 7053], [": Record<string, unknown>", 2322]] as const) {
      const code = `await local.write({path:"unwanted",content:"must not run"});
const dirs = ["."]; const out${annotation} = {};
for (const d of dirs) out[d] = await local.list({path:d});
return out;`;
      const result = await service.execute({ code, approver });
      expect(result).toMatchObject({ success: false, status: "failed", error: "TypeScript validation failed", audits: [] });
      expect(result.typeErrors).toContainEqual(expect.objectContaining({ code: expectedCode, line: expectedCode === 7053 ? 3 : 4, hint: expect.stringContaining("JsonObject") }));
      expect(fs.existsSync(path.join(root, "unwanted"))).toBe(false);
      const projected = projectFabricExecutionText({ result, resultFormat: "json", maxOutputChars: 5000, writeArtifact() { throw new Error("Unexpected overflow"); } });
      expect(JSON.parse(projected.text).typeErrors[0].hint).toContain("JsonObject");
      expect(projected.isError).toBe(true);
    }
    const wrongArgument = typeCheckFabricCode('return await local.read({path:42});', fabricGuestDeclarations);
    expect(wrongArgument.errors).toContainEqual(expect.objectContaining({ code: 2322 }));
    expect(wrongArgument.errors[0]?.hint).toBeUndefined();
  });

  it("executes typed dictionary and inferred parallel repairs with structured results", async () => {
    const { root, service } = fixture();
    fs.mkdirSync(path.join(root, "scripts"));
    fs.writeFileSync(path.join(root, "scripts/task.ts"), "export const ready = true;\n");
    for (const annotation of ["JsonObject", "Record<string, LocalListResult>"]) {
      const result = await service.execute({ code: `const out: ${annotation} = {};
for (const d of ["scripts"]) out[d] = await local.list({path:d}); return out;`, approver });
      expect(result).toMatchObject({ success: true, value: { scripts: { entries: [{ path: "scripts/task.ts", type: "file" }], truncated: false } } });
    }
    const result = await service.execute({ code: 'return await parallel(["scripts"], path => local.list({path}));', approver });
    expect(result).toMatchObject({ success: true, value: [{ entries: [{ path: "scripts/task.ts", type: "file" }], truncated: false }] });
    expect(typeCheckFabricCode('const out: JsonObject = {}; out.invalid = () => 1; return out;', fabricGuestDeclarations).errors.length).toBeGreaterThan(0);
  });

  it("executes the shipped numbered-evidence recipe preserving ranges, CRLF, Unicode and EOF", async () => {
    const { root, service } = fixture();
    fs.writeFileSync(path.join(root, "rules.txt"), "first\r\n\r\n  café 🛰\r\nlast");
    fs.writeFileSync(path.join(root, "empty.txt"), "");
    const guide = fs.readFileSync(new URL("../skills/fabric-exec/references/review.md", import.meta.url), "utf8");
    const code = [...guide.matchAll(/```ts\n([\s\S]*?)\n```/g)].map(m => m[1]!).find(c => c.includes("// Recipe: numbered review evidence"));
    expect(code).toBeDefined();
    const windows = [{ path: "rules.txt", offset: 2, limit: 2 }, { path: "rules.txt", offset: 4 }, { path: "empty.txt" }, { path: "rules.txt", offset: 99 }];
    const result = await service.execute({ code: code!, payloads: { windows: JSON.stringify(windows) }, approver });
    expect(result.success, result.error).toBe(true);
    expect(result.value).toMatchObject({ complete: true, remaining: [] });
    const rows = (result.value as { files: { sha256: string }[] }).files;
    expect(rows).toEqual([
      { path: "rules.txt", startLine: 2, endLine: 3, totalLines: 4, nextOffset: 4, truncated: true, sha256: rows[0]!.sha256, source: "2: \n3:   café 🛰" },
      { path: "rules.txt", startLine: 4, endLine: 4, totalLines: 4, truncated: false, sha256: rows[0]!.sha256, source: "4: last" },
      { path: "empty.txt", startLine: 1, endLine: null, totalLines: 0, truncated: false, sha256: rows[2]!.sha256, source: "" },
      { path: "rules.txt", startLine: 99, endLine: null, totalLines: 4, truncated: false, sha256: rows[0]!.sha256, source: "" },
    ]);
    expect(rows[0]!.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("runs the shipped literal Bash recipe without outer expansion, scratch files or hidden exits", async () => {
    const { root, service } = fixture();
    const guide = fs.readFileSync(new URL("../skills/fabric-exec/references/review.md", import.meta.url), "utf8");
    const code = [...guide.matchAll(/```ts\n([\s\S]*?)\n```/g)].map(m => m[1]!).find(c => c.includes("// Recipe: literal Bash probe"))!;
    const input = '$(touch unexpected) `touch unexpected` "quotes" \\ $HOME\nsecond line';
    const script = 'review_value=inner\nprintf "%s\\n" "$review_value" "$1"\nprintf "probe error" >&2\nexit 7';
    const executionApprover = {
      prepareApproval(action: { risk: string }) { expect(action.risk).toBe("execute"); return { decision: "allow" as const }; },
      async approve() { throw new Error("Unexpected interactive approval"); },
    };
    const result = await service.execute({ code, payloads: { script, input }, approver: executionApprover });
    expect(result).toMatchObject({ success: true, value: { ok: false, exitCode: 7, stdout: `inner\n${input}\n`, stderr: "probe error", truncated: false } });
    expect(fs.readdirSync(root)).toEqual([]);
    for (const invalid of ['{command:"true",script:"true"}', '{command:"true",args:["x"]}', '{script:"true",interpreter:"zsh"}']) {
      expect(typeCheckFabricCode(`return await local.shell(${invalid});`, fabricGuestDeclarations).errors.length).toBeGreaterThan(0);
    }
  });

  it("finds hidden CI callers through the shipped recipe, preserving evidence scope", async () => {
    const { root, service } = fixture();
    fs.mkdirSync(path.join(root, ".ci"));
    fs.writeFileSync(path.join(root, ".ci/check.yml"), "run: node scripts/validate-config.mjs\n");
    const guide = fs.readFileSync(new URL("../skills/fabric-exec/references/review.md", import.meta.url), "utf8");
    const code = [...guide.matchAll(/```ts\n([\s\S]*?)\n```/g)].map(m => m[1]!).find(c => c.includes("// Recipe: review callers"))!;
    const result = await service.execute({ code, payloads: { symbol: "validate-config.mjs" }, approver });
    expect(result).toMatchObject({ success: true, value: {
      search: { scope: { path: ".", hidden: true, ignoreFiles: true }, truncated: false,
        matches: [{ path: ".ci/check.yml", line: 1, text: "run: node scripts/validate-config.mjs" }] },
      evidence: { complete: true, remaining: [], files: [{ path: ".ci/check.yml", startLine: 1, endLine: 1, source: "1: run: node scripts/validate-config.mjs" }] },
    } });
    expect(result.audits.map(audit => audit.ref)).toEqual(["local.grep", "local.readMany"]);
  });

  it("composes search and numbered overlapping source reads in one shipped program", async () => {
    const { root, service } = fixture();
    fs.mkdirSync(path.join(root, ".ci"));
    const lines = ["pipeline:", "  run: dispatch(record)", "  retry: dispatch(failed)", "  policy: conditional", "end"];
    fs.writeFileSync(path.join(root, ".ci/check.yml"), lines.join("\n"));
    const guide = fs.readFileSync(new URL("../skills/fabric-exec/references/recipes.md", import.meta.url), "utf8");
    const code = [...guide.matchAll(/```ts\n([\s\S]*?)\n```/g)].map(m => m[1]!).find(c => c.includes("// Recipe: discover then read without a model round trip"))!;
    const result = await service.execute({ code, payloads: { symbol: "dispatch", path: "." }, approver });
    expect(result.success, result.error).toBe(true);
    expect(result.audits.map(audit => audit.ref)).toEqual(["local.grep", "local.readMany"]);
    expect(result.value).toMatchObject({
      search: { scope: { path: ".", hidden: true, ignoreFiles: true }, truncated: false, matches: [{ line: 2 }, { line: 3 }] },
      evidence: { complete: true, remaining: [], files: [{ path: ".ci/check.yml", startLine: 1, endLine: 5, totalLines: 5, source: lines.map((line, i) => `${i + 1}: ${line}`).join("\n") }] },
    });
    const absent = await service.execute({ code, payloads: { symbol: "not-present", path: "." }, approver });
    expect(absent.success, absent.error).toBe(true);
    expect(absent.audits.map(audit => audit.ref)).toEqual(["local.grep"]);
    expect(absent.value).toMatchObject({ search: { scope: { path: ".", hidden: true, ignoreFiles: true }, matches: [], truncated: false }, evidence: { files: [], remaining: [], complete: true } });
    fs.writeFileSync(path.join(root, ".ci/many.yml"), "dispatch(record)\n".repeat(20));
    const partial = await service.execute({ code, payloads: { symbol: "dispatch", path: "." }, approver });
    expect(partial.success, partial.error).toBe(true);
    expect(partial.value).toMatchObject({ search: { truncated: true }, evidence: { complete: true, remaining: [] } });
  });

  it.each([
    ['response=$(curl --url https://fixture.invalid/build?branch=main&api-version=1)', 0],
    ['response=$(curl --url "https://fixture.invalid/build?branch=main&api-version=1")', 0],
    ['response=$(curl --url "https://fixture.invalid/build?branch=main&api-version=1"', 2],
  ])("checks the original and proposed correction without executing shell effects: %s", async (input, exitCode) => {
    const { root, service } = fixture();
    const guide = fs.readFileSync(new URL("../skills/fabric-exec/references/review.md", import.meta.url), "utf8");
    const code = [...guide.matchAll(/```ts\n([\s\S]*?)\n```/g)].map(m => m[1]!).find(c => c.includes("// Recipe: literal Bash probe"))!;
    const result = await service.execute({ code, payloads: { script: 'bash --noprofile --norc -n -c "$1"', input },
      approver: { prepareApproval: () => ({ decision: "allow" as const }), async approve() {} } });
    expect(result).toMatchObject({ success: true, value: { ok: exitCode === 0, exitCode, stdout: "", truncated: false } });
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("falsifies the Bash null-fallback claim under explicit non-nounset semantics", async () => {
    const { service } = fixture();
    const result = await service.execute({
      code: 'return await local.shell({script:payloads.script,interpreter:"bash",settle:true});',
      payloads: { script: 'set +u\nunset null\nbuildid=null\n[[ "$buildid" -eq "null" ]] && buildid="latest"\nprintf "%s" "$buildid"' },
      approver: { prepareApproval: () => ({ decision: "allow" as const }), async approve() {} },
    });
    expect(result).toMatchObject({ success: true, value: { ok: true, exitCode: 0, stdout: "latest", stderr: "", truncated: false } });
  });

  it("reproduces the URL background operator without losing captured stdout or contacting a service", async () => {
    const { service } = fixture();
    const script = `curl() { printf '%s\\n' "$@" >&2; printf '{"id":123}'; }
response=$(curl --url https://fixture.invalid/build?branch=main&api-version=1)
status=$?
printf '%s' "$response"
exit "$status"`;
    const result = await service.execute({
      code: 'return await local.shell({script:payloads.script,interpreter:"bash",settle:true});',
      payloads: { script },
      approver: { prepareApproval: () => ({ decision: "allow" as const }), async approve() {} },
    });
    expect(result).toMatchObject({ success: true, value: { ok: false, exitCode: 127, stdout: '{"id":123}', truncated: false } });
    const stderr = (result.value as { stderr: string }).stderr;
    expect(stderr).toContain("https://fixture.invalid/build?branch=main\n");
    expect(stderr).toContain("api-version=1: command not found");
  });
});
