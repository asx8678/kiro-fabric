import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { fixture } from "./bundle-fixture.js";
import { installCompleteGeneration } from "../scripts/managed-installation.mjs";

// Real transaction/lock control over inert bundle bytes. No client runs and all
// fixtures, including failed transaction evidence, remain available for review.
it.each([false, true])("preserves operation errors and commit state when release fails (committed=%s)", async committed => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "managed-errors-"));
  const bundle = await fixture();
  console.warn(`[managed error fixtures] retained ${root} and ${bundle}`);
  const userHome = path.join(root, "home"), kiroHome = path.join(userHome, ".kiro");
  fs.mkdirSync(userHome, { mode: 0o700 });
  const recovery = { detail: "candidate validation failed" };
  const original = Object.assign(new Error("candidate validation failure"), { name: "CandidateValidationError", recovery });
  const cleanup = new Error("lock release failure");
  let released = false, validated = false;
  let error: unknown;
  try {
    await installCompleteGeneration(bundle, {
      kiroHome, userHome, env: {}, provenance: "source",
      validateCandidate: async () => { validated = true; if (!committed) throw original; },
      onPhase: (phase: string) => { if (phase === "release-before-remove") { released = true; throw cleanup; } },
    });
  } catch (failure) { error = failure; }
  expect(validated, String(error)).toBe(true);
  expect(released).toBe(true);
  expect(error).toMatchObject({ committed, recoveryRequired: true });
  if (committed) {
    expect(error).toBe(cleanup);
    expect(fs.existsSync(path.join(kiroHome, "kiro-fabric/install-owner.json"))).toBe(true);
  } else {
    assert.ok(error instanceof AggregateError);
    expect(error.name).toBe("AggregateError");
    expect(error.errors).toEqual([original, cleanup]);
    expect(error.cause).toBe(original);
    expect(error).toHaveProperty("recovery", recovery);
  }
});
