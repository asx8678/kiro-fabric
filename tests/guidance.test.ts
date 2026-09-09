import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_PROMPT } from "../scripts/agent-profile.mjs";
import { GUIDANCE_FILES, renderAgentGuidance } from "../scripts/generate-agent-guidance.mjs";
import { FabricBootstrapProvider } from "../src/kiro/bootstrap-provider.js";
import { BUNDLED_GUIDANCE } from "../src/kiro/generated-guidance.js";
import { fabricGuestDeclarations } from "../src/runtime/guest-types.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";
import { FabricDeadline } from "../src/runtime/deadline.js";

const root = path.resolve(import.meta.dirname, "..");
const temporary: string[] = [];
afterEach(() => { for (const file of temporary.splice(0)) fs.rmSync(file, { recursive: true, force: true }); });

const workingRules = [
  /decorative comment separator blocks/i,
  /plain single-line comments and blank lines/i,
  /git reset --hard or git commit --amend unless explicitly asked/i,
  /git reflog/i,
  /commitlint/i,
  /PR templates/i,
  /user-provided file/i,
  /UTF-8 text only, not an image\/PDF reader/i,
  /Never post, edit or delete GitHub comments without explicit permission/i,
  /whole disk, user home or cwd ancestors/i,
  /noninteractive commands/i,
  /file-backed Markdown bodies/i,
  /git commit -F/i,
];

describe("compiled task guidance", () => {
  it.each(workingRules)("keeps critical user policy always on: %s", rule => {
    expect(AGENT_PROMPT).toMatch(rule);
  });

  it("covers detailed GitHub procedures without inventing gh api flags", () => {
    const workflow = BUNDLED_GUIDANCE.workflow;
    expect(workflow).toContain("original top-level review-comment ID");
    expect(workflow).not.toContain("pulls/comments/{id}/replies");
    expect(workflow).toContain("visible progress prose before or between tool calls");
    expect(BUNDLED_GUIDANCE.skill).toContain("Kiro concatenates that text into finalText");
    expect(BUNDLED_GUIDANCE.recipes).toContain("offset:41,limit:4,nextOffset:45");
    expect(BUNDLED_GUIDANCE.skill).not.toContain("each write/network action elicits separately");
    expect(BUNDLED_GUIDANCE.skill).toContain("elicitation occurs only when that policy requires it");
    for (const clause of ["repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies", "resolveReviewThread", "only after the reply succeeds", "No pleasantries", ".github/PULL_REQUEST_TEMPLATE.md", "GIT_EDITOR=true", "EDITOR=true", "--no-edit", "gh api has no --body-file", "--input", "uncommitted edits"]) expect(workflow).toContain(clause);
  });

  it("keeps concise reporting evidence-led and distinguishes API catalogues from programs", () => {
    for (const rule of [/Reduce narration, not verification/i, /passed, failed and not-run checks/i,
      /unless repository rules require it/i, /Preserve warnings and uncertainty/i,
      /identifying delegated evidence as reported/i, /Do not claim live model-quality or token-cost improvements/i]) {
      expect(BUNDLED_GUIDANCE.workflow).toMatch(rule);
    }
    expect(BUNDLED_GUIDANCE.skill).toContain("no routine tool narration or repeated recap");
    expect(BUNDLED_GUIDANCE.guide).toContain("Call-shape catalogue, not an executable program");
    expect(BUNDLED_GUIDANCE.recipes).toContain("stdoutOmitted");
    expect(BUNDLED_GUIDANCE.recipes).toContain("not required acceptance evidence or requested output");
    expect(BUNDLED_GUIDANCE.recipes).not.toMatch(/\b(?:pi|agents|extensions)\./);
  });

  it("retains bounded discovery and live approval readiness guidance", () => {
    const guide = BUNDLED_GUIDANCE.guide;
    expect(guide).toContain("default 200/max 2000 lines per call");
    expect(guide).toContain("pattern` is a glob, not a regular expression");
    expect(guide).toContain("**/*_test.exs");
    expect(guide).toContain("No handler registered for method: _kiro/mcp/elicitation");
    expect(guide).toContain("do not assume every client/version is affected");
    expect(guide).toContain("preserve `ask` policies");
    expect(guide).toContain("not live coding-readiness evidence");
    expect(guide).toContain("explicitly human-approved shell command and file edit");
    expect(guide).toContain("never count automatic fixture approvals as human interaction");
  });

  it("ships actionable review guidance and checked discovery examples without promising model wins", () => {
    const review = BUNDLED_GUIDANCE.review;
    for (const clause of ["coverage ledger", "pipeline -> script", "environment override", "totalLines", "scope", "truncated:false", "try to falsify", "counterexamples", "uninspected scope", "does not authorize edits"]) expect(review).toContain(clause);
    const examples = [...review.matchAll(/```ts\n([\s\S]*?)\n```/g)].map(m => m[1]!);
    expect(examples.length).toBeGreaterThan(0);
    for (const code of examples) expect(typeCheckFabricCode(code, fabricGuestDeclarations).errors).toEqual([]);
    expect(BUNDLED_GUIDANCE.skill).toContain('fabric.help({topic:"review"})');
    expect(BUNDLED_GUIDANCE.guide).toContain("scope:{path,glob?,hidden,ignoreFiles:true}");
    expect(BUNDLED_GUIDANCE.workflow).toContain("reviews/audits are exempt");
  });

  it("matches every canonical Markdown byte and the checked generated source", () => {
    for (const [topic, file] of Object.entries(GUIDANCE_FILES)) {
      expect(BUNDLED_GUIDANCE[topic as keyof typeof BUNDLED_GUIDANCE]).toBe(fs.readFileSync(path.join(root, file), "utf8"));
    }
    expect(fs.readFileSync(path.join(root, "src/kiro/generated-guidance.ts"), "utf8")).toBe(renderAgentGuidance(root));
    expect(Object.isFrozen(BUNDLED_GUIDANCE)).toBe(true);
    const product = JSON.parse(fs.readFileSync(path.join(root, "agent-product.json"), "utf8"));
    expect(product.bundledAgentResources).toEqual(Object.values(GUIDANCE_FILES));
  });

  it("has matching public schemas and checked guest topic declarations", async () => {
    const provider = new FabricBootstrapProvider();
    const descriptor = await provider.describe("help");
    expect(descriptor).toMatchObject({ risk: "read", effect: { kind: "none" } });
    const topics = ["overview", "api", ...Object.keys(GUIDANCE_FILES)];
    expect(descriptor?.inputSchema).toMatchObject({ properties: { topic: { enum: topics } }, additionalProperties: false });
    for (const topic of topics) expect(typeCheckFabricCode(`return await fabric.help({topic:${JSON.stringify(topic)}});`, fabricGuestDeclarations).errors).toEqual([]);
    expect(typeCheckFabricCode('return await fabric.help({topic:"/etc/passwd"});', fabricGuestDeclarations).errors.length).toBeGreaterThan(0);
  });

  it.each([512, 20000])("reconstructs all help with bounded paging, no workspace and EOF (%i)", async budget => {
    const provider = new FabricBootstrapProvider(budget);
    for (const [topic, source] of Object.entries(BUNDLED_GUIDANCE)) {
      let text = "", offset = 0;
      do {
        const page = await provider.invoke("help", { topic, offset, limit: 16000 }, { cwd: "/not-a-workspace" }) as { text: string; truncated: boolean; nextOffset?: number };
        expect(JSON.stringify(page).length).toBeLessThanOrEqual(budget);
        expect(page.text).toBe(source.slice(offset, offset + page.text.length));
        expect(page.text.length).toBeGreaterThan(0);
        text += page.text;
        offset += page.text.length;
        expect(page.truncated).toBe(offset < source.length);
        expect(page.nextOffset).toBe(page.truncated ? offset : undefined);
        expect(offset).toBeLessThanOrEqual(100000);
      } while (offset < source.length);
      expect(text).toBe(source);
      expect(await provider.invoke("help", { topic, offset: 100000 }, { cwd: "/not-a-workspace" })).toEqual({ topic, text: "", truncated: false });
    }
  });

  it("preserves surrogate boundaries at the minimum budget and reconstructs overview", async () => {
    const provider = new FabricBootstrapProvider(262);
    const index = BUNDLED_GUIDANCE.recipes.indexOf("🛰");
    expect(index).toBeGreaterThanOrEqual(0);
    const a = await provider.invoke("help", { topic: "recipes", offset: index, limit: 1 }, { cwd: "/none" }) as { text: string; nextOffset: number };
    const b = await provider.invoke("help", { topic: "recipes", offset: a.nextOffset, limit: 1 }, { cwd: "/none" }) as { text: string; nextOffset: number };
    expect(a.text + b.text).toBe("🛰");
    expect(a.nextOffset).toBe(index + 1); expect(b.nextOffset).toBe(index + 2);
    for (const page of [a, b]) expect(JSON.stringify(page).length).toBeLessThanOrEqual(262);
    const normal = new FabricBootstrapProvider();
    const full = await normal.invoke("help", { topic: "overview" }, { cwd: "/none" }) as { text: string };
    let text = "", offset = 0;
    for (;;) {
      const page = await normal.invoke("help", { topic: "overview", offset, limit: 37 }, { cwd: "/none" }) as { text: string; truncated: boolean; nextOffset: number };
      text += page.text;
      if (!page.truncated) break;
      expect(page.nextOffset).toBeGreaterThan(offset); offset = page.nextOffset;
    }
    expect(text).toBe(full.text);
    expect(text).toContain("skill/guide/recipes/workflow");
  });

  it("validates direct callers, cancellation and too-small help budgets", async () => {
    const provider = new FabricBootstrapProvider();
    for (const args of [{ topic: "/etc/passwd" }, { topic: "workflow", path: "/etc/passwd" }, { topic: "recipes", offset: -1 }, { topic: "guide", offset: 100001 }, { topic: "skill", limit: 0 }, { topic: "skill", limit: NaN }]) {
      await expect(provider.invoke("help", args, { cwd: "/not-a-workspace" })).rejects.toThrow("Invalid fabric.help");
    }
    for (const budget of [261, NaN, Infinity]) await expect(new FabricBootstrapProvider(budget).invoke("help", { topic: "skill" }, { cwd: "/not-a-workspace" })).rejects.toThrow("budget too small");
    let now = 0;
    const deadline = new FabricDeadline(10, 10, () => now);
    now = 11;
    await expect(provider.invoke("help", { topic: "skill" }, { cwd: "/none", deadline })).rejects.toThrow("Execution timed out");
    const controller = new AbortController(); controller.abort();
    await expect(provider.invoke("help", { topic: "skill" }, { cwd: "/not-a-workspace", signal: controller.signal })).rejects.toThrow();
  });

  it("generates escaped UTF-8 text deterministically and rejects unpageable or invalid sources", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-guidance-")); temporary.push(fixture);
    const content = 'quotes " and slash \\ and café 🛰\nnext\tline\n';
    for (const relative of Object.values(GUIDANCE_FILES)) {
      fs.mkdirSync(path.dirname(path.join(fixture, relative)), { recursive: true });
      fs.writeFileSync(path.join(fixture, relative), content);
    }
    const rendered = renderAgentGuidance(fixture);
    expect(rendered).toContain(JSON.stringify(content));
    expect(renderAgentGuidance(fixture)).toBe(rendered);
    const file = path.join(fixture, GUIDANCE_FILES.skill);
    const bom = "\uFEFF" + content;
    fs.writeFileSync(file, bom);
    expect(renderAgentGuidance(fixture)).toContain(JSON.stringify(bom));
    for (const bad of [" ", "a".repeat(100001), "invalid\0text", Buffer.from([0xff, 0xfe])]) {
      fs.writeFileSync(file, bad);
      expect(() => renderAgentGuidance(fixture)).toThrow();
    }
  });
});
