import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { guestTypeDeclarations } from "../src/runtime/guest-types.js";

describe("managed Kiro unavailable workflow surfaces", () => {
  it("does not ship schema/state skills or declare those guest globals", () => {
    expect(fs.existsSync("skills/fabric-schema/SKILL.md")).toBe(false);
    const declarations = guestTypeDeclarations(true, {
      coreToolNamespace: "k",
      agentBackedOrchestration: false,
      excludeGlobals: ["state", "schema", "mesh", "components", "compact", "extensions"],
    });
    expect(declarations).not.toContain("declare const state:");
    expect(declarations).not.toContain("declare const schema:");
    expect(fs.readFileSync("docs/skills.md", "utf8"))
      .toContain("schema transactions");
  });
});
