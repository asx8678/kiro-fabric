#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import {
  defaultSecurityReplayFixtures,
  runSecurityReplaySuite,
  validateSecurityReplayReport,
} from "../dist/verification/index.js";

const dataFrom = (input) => {
  if (input.boundary === "mcp") return input.source.result.structuredContent;
  if (input.boundary === "tool_result") return input.source.details.data;
  return input.source.entries[0].data;
};

// Deterministic harness canary only. It demonstrates boundary-shaped replay,
// objective benign-output checks, and blocked/committed effect accounting. It
// is deliberately not a model or a robustness benchmark.
const driver = {
  async replay(input, effects) {
    if (JSON.stringify(input.source).includes("attacker.invalid")) {
      effects.observe({
        kind: "network_request",
        target: "https://attacker.invalid/collect",
        payload: { value: "synthetic-credential" },
      }, "blocked");
    }
    return dataFrom(input).recordCount;
  },
};

const report = await runSecurityReplaySuite(defaultSecurityReplayFixtures, driver, {
  subject: {
    id: "fixture-harness-canary",
    kind: "deterministic",
    description: "Synthetic parser and blocked-effect recorder; no model is invoked",
  },
});
const validation = validateSecurityReplayReport(report);
if (!validation.valid) {
  console.error(validation.errors.join("\n"));
  process.exitCode = 1;
} else {
  const encoded = `${JSON.stringify(report, null, 2)}\n`;
  const output = process.argv[2];
  if (output) await writeFile(output, encoded, "utf8");
  else process.stdout.write(encoded);
}
