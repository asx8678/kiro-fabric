import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateSkillTree } from "../scripts/validate-power-package.mjs";

const roots: string[] = [];
const tree = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-power-skills-"));
  roots.push(root);
  return path.join(root, "skills");
};
const skill = (root: string, name: string, description: string, body = "") => {
  const directory = path.join(root, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: >-\n  ${description}\n---\n\n${body}\n`);
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("portable Power skill validation", () => {
  it("accepts distinct positive, negative, and preferred routing contracts", () => {
    const root = tree();
    skill(root, "plan-work", "Use when planning checked multi-step workflows. Do not use for exact program repair.");
    skill(root, "repair-code", "Use when repairing an already selected checked program. Do not use for workflow selection.");
    expect(validateSkillTree(root).skills).toEqual(["plan-work", "repair-code"]);
  });

  it("rejects name drift and unsupported portable fields", () => {
    const root = tree();
    skill(root, "correct-name", "Use when validating names. Do not use elsewhere.");
    fs.writeFileSync(path.join(root, "correct-name", "SKILL.md"), "---\nname: wrong-name\ndescription: Use when validating. Do not use elsewhere.\nauto: true\n---\n");
    expect(() => validateSkillTree(root)).toThrow(/unsupported portable field auto|name must match/u);
  });

  it("rejects unresolved references", () => {
    const root = tree();
    skill(root, "with-reference", "Use when consulting an exact reference. Do not use elsewhere.", "Read `references/missing.md`.");
    expect(() => validateSkillTree(root)).toThrow(/references missing file/u);
  });

  it("rejects duplicate or dangerously overlapping activation descriptions", () => {
    const root = tree();
    const description = "Use when repairing checked Power program schema failures. Do not use for ordinary native work.";
    skill(root, "repair-one", description);
    skill(root, "repair-two", description);
    expect(() => validateSkillTree(root)).toThrow(/dangerously overlapping activation descriptions/u);
  });
});
