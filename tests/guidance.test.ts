import { removeFixtureSync } from "./fixture-cleanup.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LOCAL_GUEST_DECLARATIONS } from "../src/providers/local-contract.js";
import { GUIDANCE_FILES, renderAgentGuidance } from "../scripts/generate-agent-guidance.mjs";
import { FabricBootstrapProvider } from "../src/kiro/bootstrap-provider.js";
import { BUNDLED_GUIDANCE } from "../src/kiro/generated-guidance.js";
import { fabricGuestDeclarations } from "../src/runtime/guest-types.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";
import { FabricDeadline } from "../src/runtime/deadline.js";

const root = path.resolve(import.meta.dirname, "..");
const temporary: string[] = [];
afterEach(() => { for (const file of temporary.splice(0)) removeFixtureSync(file, { recursive: true, force: true }); });

describe("compiled task guidance", () => {
  it("type-checks executable Fovea, grounding, continuity and review examples", () => {
    const fovea = BUNDLED_GUIDANCE.skill.split("## Fovea-first code navigation")[1]!.match(/```ts\n([\s\S]*?)```/)?.[1];
    const grounding = BUNDLED_GUIDANCE.guide.split("## Browser-backed web grounding")[1]!.match(/```ts\n([\s\S]*?)```/)?.[1];
    const continuity = BUNDLED_GUIDANCE.recipes.match(/```ts\n(\/\/ Recipe: resume the explicitly selected durable task after restart or compaction\n[\s\S]*?)\n```/)?.[1];
    const review = [...BUNDLED_GUIDANCE.review.matchAll(/```ts\n([\s\S]*?)\n```/g)].map(match => match[1]!);
    expect(fovea).toBeDefined();
    expect(grounding).toBeDefined();
    expect(continuity).toBeDefined();
    expect(review.length).toBeGreaterThan(0);
    for (const code of [fovea!, grounding!, continuity!, ...review, 'return await local.find({pattern:"**/*",hidden:true,limit:200});']) {
      expect(typeCheckFabricCode(code, fabricGuestDeclarations).errors, code).toEqual([]);
    }
    expect(LOCAL_GUEST_DECLARATIONS.length).toBeGreaterThan(0);
    expect(fabricGuestDeclarations).toContain(LOCAL_GUEST_DECLARATIONS);
    expect(fabricGuestDeclarations.length).toBeGreaterThan(LOCAL_GUEST_DECLARATIONS.length);
  });

  it("matches every canonical Markdown byte and the checked generated source", () => {
    for (const [topic, file] of Object.entries(GUIDANCE_FILES)) {
      expect(BUNDLED_GUIDANCE[topic as keyof typeof BUNDLED_GUIDANCE]).toBe(fs.readFileSync(path.join(root, file), "utf8"));
    }
    expect(fs.readFileSync(path.join(root, "src/kiro/generated-guidance.ts"), "utf8")).toBe(renderAgentGuidance(root));
    expect(Object.isFrozen(BUNDLED_GUIDANCE)).toBe(true);
    const product = JSON.parse(fs.readFileSync(path.join(root, "agent-product.json"), "utf8"));
    // Fovea is a packaged reference, not a compiled fabric.help topic.
    expect(product.bundledAgentResources).toEqual([...Object.values(GUIDANCE_FILES), "skills/fabric-exec/references/fovea.md"]);
    expect(fs.readFileSync(path.join(root, "skills/fabric-exec/references/fovea.md"), "utf8").trim()).not.toBe("");
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

  it.each([512, 20000])("reconstructs bundled help and expanded API with bounded default pages and EOF (%i)", async budget => {
    const provider = new FabricBootstrapProvider(budget);
    for (const [topic, source] of Object.entries({ ...BUNDLED_GUIDANCE, api: fabricGuestDeclarations })) {
      let text = "", offset = 0;
      do {
        // Exercise omitted offset/limit first, then exact continuation offsets.
        const args = offset ? { topic, offset } : { topic };
        const page = await provider.invoke("help", args, { cwd: "/not-a-workspace" }) as { topic: string; text: string; truncated: boolean; nextOffset?: number };
        expect(page.topic).toBe(topic);
        expect(JSON.stringify(page).length).toBeLessThanOrEqual(budget);
        expect(page.text).toBe(source.slice(offset, offset + page.text.length));
        expect(page.text.length).toBeGreaterThan(0);
        expect(page.text.length).toBeLessThanOrEqual(16000);
        if (budget === 20000 && page.truncated) expect(page.text.length).toBeGreaterThan(1000);
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

  it("preserves UTF-16 offsets and explicit limits at the minimum budget", async () => {
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
