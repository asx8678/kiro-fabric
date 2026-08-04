import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { getDocs } from "../../src/docs.js";
import { listPromptIds, loadPrompt, renderPrompt } from "../../src/prompts.js";
import { checkProgram } from "../../src/checker.js";

describe("canonical prompts and examples",()=>{
 const approved = ["fabric-guide","fabric-workflow","fabric-council","fabric-fusion","fabric-context-decompose","evidence-ledger","evidence-change","spec-audit"];
 const provisional = ["guide","checked-workflow","council","conditional-fusion","context-decomposition"];

 it("exposes approved workflow IDs through packaged docs without provisional aliases",()=>{
  const ids=listPromptIds();
  expect(ids).toEqual(expect.arrayContaining(approved));
  for(const id of provisional)expect(ids).not.toContain(id);
  for(const id of ids)expect(getDocs(`prompt:${id}`)).toBe(loadPrompt(id));
  for(const id of approved)expect(getDocs()).toContain(`prompt:${id}`);
 });
 it("renders variables literally and rejects unresolved variables",()=>{
  const literal = "$&/$`/$'/\\bin/{{LITERAL}}/fabric-lite";
  expect(renderPrompt("parent-agent",{FABRIC_LITE_CLI:literal})).toContain(literal);
  expect(()=>renderPrompt("parent-agent")).toThrow(/Missing prompt variables.*FABRIC_LITE_CLI/);
 });
 it("all shipped examples pass checkProgram and fusion requires Kiro metadata",async()=>{const dir=path.resolve("examples");for(const name of (await readdir(dir)).filter(x=>x.endsWith(".ts"))){const source=await readFile(path.join(dir,name),"utf8"),checked=checkProgram(source);expect(checked.diagnostics, name).toEqual([]);expect(checked.ok,name).toBe(true);if(name==="conditional-fusion.ts")expect(source).toContain(`resolutionSource === "kiro-metadata"`);}});
 it("evidence workflows retain conservative defaults",()=>{expect(loadPrompt("evidence-change")).toMatch(/Default to a proposal when writes are denied/);expect(loadPrompt("spec-audit")).toMatch(/only when every applicable check has verified evidence/);expect(loadPrompt("fabric-fusion")).toMatch(/at least two successful calls/);});
 it("encodes bounded audit, change, context, and delivery mechanics",()=>{
  expect(loadPrompt("evidence-ledger")).toMatch(/bounded `glob`\/`grep` first, then bounded `read`\/`readMany`/);
  expect(loadPrompt("spec-audit")).toMatch(/symbols, registrations, configuration, behavior, and validation/);
  expect(loadPrompt("evidence-change")).toMatch(/exact preimage[\s\S]*preserve that preimage[\s\S]*smallest exact patch[\s\S]*read back[\s\S]*related call sites[\s\S]*smallest relevant allowlisted checks/);
  expect(loadPrompt("evidence-change")).toMatch(/a write is not completion/);
  expect(loadPrompt("repository-delivery")).toMatch(/Verification after change is mandatory[\s\S]*smallest relevant requested allowlisted validation/);
  expect(loadPrompt("fabric-context-decompose")).toMatch(/objective, owned scope, evidence pointers, relevant changes, open errors or contradictions, status, expected output\/check, and the exact omitted count and reason/);
  expect(loadPrompt("parent-agent")).toMatch(/exact diagnostic and declared contract[\s\S]*one narrow type\/schema repair[\s\S]*do not guess APIs or permissions, or re-analyze/);
  expect(loadPrompt("parent-agent")).toMatch(/Default to deterministic APIs with zero child AI calls[\s\S]*at most one bounded AI call[\s\S]*only when the user explicitly requests a multi-agent workflow/);
  expect(loadPrompt("parent-agent")).toMatch(/fabric\.git\.commit\(\{ message, paths \}\)[\s\S]*no push API exists/);
  expect(loadPrompt("workspace-policy")).toMatch(/Rebuild every artifact consumed[\s\S]*documented comprehensive check when authorized/);
 });
 it("keeps installed owned prompt and parent-agent snapshots exact",async()=>{
  const owned=["parent-agent","evidence-ledger","spec-audit","evidence-change","repository-delivery","fabric-context-decompose","workspace-policy"];
  for(const id of owned)expect(await readFile(path.resolve(`.kiro/prompts/${id}.md`),"utf8"),id).toBe(loadPrompt(id));
  const agent=JSON.parse(await readFile(path.resolve(".kiro/agents/fabric-lite.json"),"utf8")) as {prompt:string};
  expect(agent.prompt).toBe(renderPrompt("parent-agent",{FABRIC_LITE_CLI:"/Users/adam2/projects/kiro-fabric/dist/cli/main.js"}));
 });
 it("documents advisory escalation without model authorization",async()=>{
  const security=await readFile(path.resolve("docs/SECURITY.md"),"utf8");
  expect(security).toMatch(/Authorization is deterministic and default-deny/);
  expect(security).toMatch(/model output[\s\S]*cannot authorize/);
  expect(security).toMatch(/critical[\s\S]*high[\s\S]*medium[\s\S]*low/);
  expect(security).toMatch(/rubric[\s\S]*never grants authorization/);
 });
});