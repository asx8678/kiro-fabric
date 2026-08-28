import {
  createSyntheticSourceInfo,
  defineTool,
  type ExtensionAPI,
  type ExtensionRunner,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapturedToolCatalog } from "../src/capture/catalog.js";
import { coreOverridePromptGuidance } from "../src/core/core-override-guidance.js";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { FabricState } from "../src/fabric-state.js";

const runner = {
  createContext: () => ({ cwd: process.cwd() }),
  getActiveTools: () => [],
} as unknown as ExtensionRunner;

// The full-code guidance path selects "participant" instead of "main" whenever
// a Fabric parent-run variable is inherited from an outer session. Tests in
// this file exercise the main-agent prompt, so explicitly isolate that state.
const inheritedParentRun = process.env.KIRO_FABRIC_PARENT_RUN;
beforeEach(() => {
  process.env.KIRO_FABRIC_PARENT_RUN = "";
});
afterEach(() => {
  if (inheritedParentRun === undefined) delete process.env.KIRO_FABRIC_PARENT_RUN;
  else process.env.KIRO_FABRIC_PARENT_RUN = inheritedParentRun;
});

const captured = (name: string, snippet?: string, guidelines?: string[]) => defineTool({
  name,
  label: name,
  description: `${name} override`,
  ...(snippet !== undefined ? { promptSnippet: snippet } : {}),
  ...(guidelines !== undefined ? { promptGuidelines: guidelines } : {}),
  parameters: Type.Object({ value: Type.Optional(Type.String()) }),
  async execute() {
    return { content: [{ type: "text" as const, text: "ok" }], details: {} };
  },
});

describe("core override prompt guidance", () => {
  it("keeps authored metadata under the pi identity and ignores other captured tools", () => {
    const catalog = new CapturedToolCatalog();
    catalog.replace(
      [
        {
          definition: captured("read", "structure-aware reads", ["Prefer symbol IDs when available."]),
          sourceInfo: createSyntheticSourceInfo("/extensions/organon/index.ts", { source: "test" }),
        },
        {
          definition: captured("deploy", "not a core slot", ["Do not advertise this here."]),
          sourceInfo: createSyntheticSourceInfo("/extensions/deploy/index.ts", { source: "test" }),
        },
      ],
      runner,
      DEFAULT_FABRIC_CONFIG.capture,
      "/extensions/kiro-fabric/index.ts",
    );

    const guidance = coreOverridePromptGuidance(catalog);
    expect(guidance).toContain("pi.read");
    expect(guidance).toContain("structure-aware reads");
    expect(guidance).toContain("Prefer symbol IDs when available.");
    expect(guidance).not.toContain("deploy");
    expect(guidance).not.toContain("extensions.read");
  });

  it("tracks replacement and removal without persisted prompt state", () => {
    const catalog = new CapturedToolCatalog();
    const replace = (snippet: string) => catalog.replace(
      [{
        definition: captured("edit", snippet),
        sourceInfo: createSyntheticSourceInfo("/extensions/editor/index.ts", { source: "test" }),
      }],
      runner,
      DEFAULT_FABRIC_CONFIG.capture,
      "/extensions/kiro-fabric/index.ts",
    );

    replace("first effective schema");
    expect(coreOverridePromptGuidance(catalog)).toContain("first effective schema");
    replace("replacement effective schema");
    expect(coreOverridePromptGuidance(catalog)).toContain("replacement effective schema");
    expect(coreOverridePromptGuidance(catalog)).not.toContain("first effective schema");
    catalog.clear();
    expect(coreOverridePromptGuidance(catalog)).toBe("");
  });


  it("adds no prose when an override has no prompt metadata", () => {
    const catalog = new CapturedToolCatalog();
    catalog.replace(
      [{
        definition: captured("read"),
        sourceInfo: createSyntheticSourceInfo("/extensions/reader/index.ts", { source: "test" }),
      }],
      runner,
      DEFAULT_FABRIC_CONFIG.capture,
      "/extensions/kiro-fabric/index.ts",
    );
    expect(coreOverridePromptGuidance(catalog)).toBe("");
  });
});
