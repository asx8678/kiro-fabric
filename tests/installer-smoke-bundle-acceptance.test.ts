import fs from "node:fs";
import { expect, it } from "vitest";
import { smokeCandidate } from "../scripts/installer-smoke.mjs";

// Main/test:built supplies the real bundle. Missing/stale staging must fail,
// never skip or silently replace the private runtime with a fixture.
it("requires structured read AND grep over the actual staged native bundle MCP transport", async () => {
  const staged = JSON.parse(fs.readFileSync(".tmp/complete-bundle.json", "utf8"));
  expect(typeof staged.root).toBe("string");
  expect(await smokeCandidate(staged.root)).toEqual({ integrity: "PASS", privateTools: "PASS", backend: "PASS", authenticatedKiro: "NOT TESTED" });
}, 60000);
