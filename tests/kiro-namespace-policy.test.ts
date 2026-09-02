import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fabricExecInputSchema } from "../src/kernel/fabric-exec-contract.js";
import {
  KIRO_NAMESPACE_POLICY,
  managedProviderCalls,
  managedRepositoryCalls,
} from "../src/kiro/namespace-policy.js";
import { generateKiroProfile } from "../src/kiro/profile.js";
import { guestTypeDeclarations } from "../src/runtime/guest-types.js";
import { typeCheckFabricCode } from "../src/runtime/type-checker.js";

const markdownFiles = (root: string): string[] => {
  const result: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith(".md")) result.push(target);
    }
  };
  visit(root);
  return result.sort();
};

const codeBlocks = (file: string): string[] =>
  [...fs.readFileSync(file, "utf8").matchAll(/```ts\n([\s\S]*?)\n```/gu)]
    .map((match) => match[1]!);

describe("Kiro semantic namespace policy", () => {
  it("projects the single managed contract into the profile and model-facing schema", () => {
    const profile = generateKiroProfile({
      projectRoot: process.cwd(),
      mcpEntryPath: path.resolve("dist/kiro/mcp-entry.js"),
      allowShell: true,
    });
    for (const api of managedRepositoryCalls(true)) expect(profile.prompt).toContain(api);
    for (const api of managedProviderCalls()) expect(profile.prompt).toContain(api);
    for (const forbidden of KIRO_NAMESPACE_POLICY.forbiddenAlternateIo) {
      expect(profile.prompt).toContain(forbidden);
    }
    const description = (fabricExecInputSchema.properties.code as { description?: string }).description ?? "";
    expect(description).toMatch(/repository I\/O only through `k`/u);
    expect(description).toContain("tools.providers/catalog/search/describe/list/call");
    for (const optional of Object.keys(KIRO_NAMESPACE_POLICY.managedMain.conditionalProviders)) {
      expect(description).toContain(`\`${optional}\``);
    }
  });

  it("keeps managed and additive skill capability views non-contradictory", () => {
    const strict = markdownFiles("strict/skills").map((file) => fs.readFileSync(file, "utf8")).join("\n");
    const power = markdownFiles("skills").map((file) => fs.readFileSync(file, "utf8")).join("\n");
    expect(strict).toMatch(/`k` is the built-in, project-confined coding-tool namespace/u);
    expect(power).toMatch(/mounts no `k\.\*` and no\s+`agents\.\*`/iu);

    const advertisedGeneric = new Set(
      [...strict.matchAll(/`tools\.([a-zA-Z]+)\(\)`/gu)].map((match) => match[1]!),
    );
    expect([...advertisedGeneric].sort()).toEqual(
      [...KIRO_NAMESPACE_POLICY.managedMain.providerAccess.actions].sort(),
    );
    expect(strict).not.toMatch(/(?:unavailable|disabled|forbidden)[^\n]{0,80}`k\.(?:read|grep|find|ls|write|edit)`/iu);
    expect(power).not.toMatch(/\b(?:k|agents)\.[a-zA-Z]+\s*\(/u);
    expect(KIRO_NAMESPACE_POLICY.internalChild.parentOnly).toEqual(["tools", "memory", "mcp", "agents"]);
    expect(KIRO_NAMESPACE_POLICY.power.conditionalProviders).toContain("memory");
  });

  it("type-checks every executable example against its effective capability view", () => {
    const strictDeclarations = guestTypeDeclarations(true, {
      coreToolNamespace: "k",
      agentBackedOrchestration: false,
      excludeGlobals: ["extensions", "mesh", "state", "schema", "components", "compact"],
    });
    const powerDeclarations = guestTypeDeclarations(true, {
      agentBackedOrchestration: false,
      excludeGlobals: ["pi", "agents", "extensions", "mesh", "state", "schema", "components", "compact"],
    });
    for (const [root, declarations] of [["strict/skills", strictDeclarations], ["skills", powerDeclarations]] as const) {
      for (const file of markdownFiles(root)) {
        for (const [index, code] of codeBlocks(file).entries()) {
          expect(typeCheckFabricCode(code, declarations).errors, `${file} block ${index + 1}`).toEqual([]);
          for (const forbidden of KIRO_NAMESPACE_POLICY.forbiddenAlternateIo) {
            expect(code, `${file} block ${index + 1}`).not.toMatch(
              new RegExp(`\\b${forbidden.replaceAll(".", "\\.")}\\b`, "u"),
            );
          }
        }
      }
    }
  });

  it("awaits every promise-returning API shown in executable examples", () => {
    for (const file of [...markdownFiles("strict/skills"), ...markdownFiles("skills")]) {
      for (const [index, code] of codeBlocks(file).entries()) {
        for (const api of KIRO_NAMESPACE_POLICY.promiseApis) {
          const escaped = api.replaceAll(".", "\\.");
          const calls = [...code.matchAll(new RegExp(`^.*\\b${escaped}\\s*\\(`, "gmu"))];
          for (const call of calls) {
            expect(call[0], `${file} block ${index + 1}: ${api} must be awaited`)
              .toMatch(new RegExp(`\\bawait\\s+${escaped}\\s*\\(`, "u"));
          }
        }
      }
    }
  });
});
