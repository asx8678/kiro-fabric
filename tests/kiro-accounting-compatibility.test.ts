import { describe, expect, it } from "vitest";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import {
  assertKiroAccountingCompatible,
  kiroAccountingIncompatibility,
} from "../src/kiro/accounting-compatibility.js";

const agents = () => structuredClone(DEFAULT_FABRIC_CONFIG.agents);

describe("Kiro accounting compatibility", () => {
  it("rejects every positive ceiling selected for Kiro ACP", () => {
    const config = agents();
    config.runner = "kiro";
    config.budgetUsd = 1;
    config.maxTokensPerChild = 10;
    expect(kiroAccountingIncompatibility(config)).toContain("agents.budgetUsd");
    expect(kiroAccountingIncompatibility(config)).toContain("agents.maxTokensPerChild");
    expect(() => assertKiroAccountingCompatible(config)).toThrow("Kiro ACP does not report usage");
  });

  it("allows disabled ceilings and ignores non-Kiro runners unless forced", () => {
    const config = agents();
    config.runner = "pi";
    config.budgetUsd = 1;
    expect(kiroAccountingIncompatibility(config)).toBeUndefined();
    expect(kiroAccountingIncompatibility(config, true)).toContain("agents.budgetUsd");
    config.budgetUsd = 0;
    expect(kiroAccountingIncompatibility(config, true)).toBeUndefined();
  });
});
