import path from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_PROMPT, generateAgentProfile } from "../scripts/agent-profile.mjs";
import { FIRST_PROMPT_GUIDANCE } from "../src/kiro/first-prompt-guidance.js";

describe("task-focused standing guidance", () => {
  it("binds each step to an unresolved requirement rather than activity for its own sake", () => {
    for (const clause of ["next unresolved check", "Each step must resolve an open check", "Follow the user's latest scope", "necessary dependencies and checks are in scope, optional cleanup is not", "not unrequested reports", "Reuse established facts only while relevant inputs are unchanged", "source or configuration changes invalidate dependent verification"]) expect(AGENT_PROMPT).toContain(clause);
    expect(AGENT_PROMPT).toContain("When acceptance is satisfied, stop and deliver");
    expect(AGENT_PROMPT).toContain("Never label a request complete while a required outcome remains blocked");
  });

  it("changes unproductive attempts without weakening verification or effect safety", () => {
    expect(AGENT_PROMPT).toContain("If an attempt adds no evidence, change the hypothesis or method");
    for (const clause of ["never blindly replay an effectful program", "Never hide failures or skip required checks", "required repository validation/builds", "productive next step"]) expect(AGENT_PROMPT).toContain(clause);
  });

  it("reserves broad review bootstrap for broad scope and leaves focused requests focused", () => {
    expect(AGENT_PROMPT).toContain("Do not invent a broad audit for a focused task");
    expect(AGENT_PROMPT).toContain("For reviews: trace core paths and success/failure/non-default scenarios");
    expect(AGENT_PROMPT).toContain("Answer, plan and review do not authorize implementation");
    expect(FIRST_PROMPT_GUIDANCE).toContain("answer, plan, review or authorized implementation");
    expect(FIRST_PROMPT_GUIDANCE).toContain("do not widen scope by default");
    expect(FIRST_PROMPT_GUIDANCE).toContain("Resume the next unresolved acceptance check");
    expect(FIRST_PROMPT_GUIDANCE).toContain("Stop at acceptance or report the exact blocker without claiming completion");
  });

  it("keeps task rules in the generated profile without adding first-turn prompt noise", () => {
    const profile = generateAgentProfile({ nodePath: path.resolve("/node"), runtimeRoot: path.resolve("/runtime"), dataRoot: path.resolve("/data"), skillPath: path.resolve("/skills/SKILL.md") });
    expect(profile.prompt).toBe(AGENT_PROMPT);
    expect(profile.tools).toEqual(["@fabric/fabric_exec"]);
    // Measured pre-change first-turn guidance was 9,077 characters. This is a
    // static size/contract guard, not proof of model quality or billed tokens.
    // Reallocate some freed hook budget to admission/severity, not a larger total prompt.
    expect(AGENT_PROMPT.length).toBeLessThanOrEqual(8_600);
    expect(AGENT_PROMPT.length + FIRST_PROMPT_GUIDANCE.length).toBeLessThanOrEqual(9_077);
    expect(FIRST_PROMPT_GUIDANCE.length).toBeLessThan(400);
  });
});
