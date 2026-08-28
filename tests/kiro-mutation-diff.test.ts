import { describe, expect, it } from "vitest";
import type { FabricCallAudit } from "../src/core/action-registry.js";
import {
  colorizeReturnedMutationDiffs,
  colorizeUnifiedDiff,
  formatMutationDiffs,
} from "../src/kiro/mutation-diff.js";

const audit = (overrides: Partial<FabricCallAudit>): FabricCallAudit => ({
  ref: "k.edit",
  nestedToolCallId: "nested-diff-test",
  startedAt: 1,
  endedAt: 2,
  success: true,
  ...overrides,
});

describe("Kiro mutation diff projection", () => {
  it("colors edit metadata, hunks, removals, and additions", () => {
    const diff = [
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -1 +1 @@",
      "-const value = 1;",
      "+const value = 2;",
    ].join("\n");
    const output = formatMutationDiffs([
      audit({
        args: { path: "src/example.ts" },
        preview: { details: { diff } },
      }),
    ]);

    expect(output).toContain("\x1b[2mk.edit src/example.ts  +1 −1\x1b[0m");
    expect(output).toContain("\x1b[36m@@ -1 +1 @@\x1b[0m");
    expect(output).toContain("\x1b[31m-const value = 1;\x1b[0m");
    expect(output).toContain("\x1b[32m+const value = 2;\x1b[0m");
  });

  it("creates a compact unified diff from a write preview", () => {
    const output = formatMutationDiffs([
      audit({
        ref: "k.write",
        args: { path: "src/output.ts" },
        preview: {
          writeBeforeCaptured: true,
          writeContent: "alpha\ngamma\n",
          codePreviewBeforeWrite: { kind: "content", content: "alpha\nbeta\n" },
        },
      }),
    ]);

    expect(output).toContain("k.write src/output.ts  +1 −1");
    expect(output).toContain("\x1b[2m--- a/src/output.ts\x1b[0m");
    expect(output).toContain("\x1b[31m-beta\x1b[0m");
    expect(output).toContain("\x1b[32m+gamma\x1b[0m");
  });

  it("shows writes that intentionally empty a file", () => {
    const output = formatMutationDiffs([
      audit({
        ref: "k.write",
        args: { path: "src/empty.ts" },
        preview: {
          writeBeforeCaptured: true,
          writeContent: "",
          codePreviewBeforeWrite: { kind: "content", content: "remove me\n" },
        },
      }),
    ]);

    expect(output).toContain("k.write src/empty.ts  +0 −1");
    expect(output).toContain("\x1b[31m-remove me\x1b[0m");
  });

  it("colors returned diffs in place while omitting duplicate blocks", () => {
    const diff = "-old\n+new";
    const success = audit({ preview: { details: { diff } } });
    const failed = audit({ success: false, preview: { details: { diff: "-bad\n+worse" } } });
    const returned = `result details:\n${diff}`;

    expect(formatMutationDiffs([success, failed], returned)).toBeUndefined();
    expect(colorizeReturnedMutationDiffs(returned, [success, failed]))
      .toContain("\x1b[31m-old\x1b[0m\n\x1b[32m+new\x1b[0m");
    expect(colorizeReturnedMutationDiffs(returned, [success, failed])).not.toContain("worse");
    expect(colorizeUnifiedDiff(diff)).not.toContain("worse");
  });
});
