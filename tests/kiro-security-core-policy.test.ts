import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Kiro security grant help", () => {
  it("describes --allow-tools as fabric_exec meta-capability authority", () => {
    const entry = path.resolve("dist/kiro/setup-entry.js");
    const help = execFileSync(process.execPath, [entry, "--help"], { encoding: "utf8" });

    expect(help).toContain("--allow-tools");
    expect(help).toContain("fabric_exec meta-capability");
    expect(help).toContain("all configured Fabric providers/tools");
  });
});
