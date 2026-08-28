#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatHumanReport, runContextCertification } from "./certification/run-context.mjs";
import { assertArtifactOutsideCheckout } from "./certification/artifact-path.mjs";
import { captureGitBinding } from "./certification/git-binding.mjs";
import { CONTEXT_CERTIFICATION_KIND } from "./certification/readiness-reports.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const parseArgs = (argv) => {
  if (argv.length === 0) return {};
  if (argv.length === 2 && argv[0] === "--json" && argv[1] && !argv[1].startsWith("--")) {
    return { jsonPath: path.resolve(argv[1]) };
  }
  throw new Error("Usage: node scripts/certify-context.mjs [--json <path>]");
};

try {
  const { jsonPath } = parseArgs(process.argv.slice(2));
  assertArtifactOutsideCheckout(root, jsonPath, "--json");
  const result = await runContextCertification();
  const report = {
    ...result,
    kind: CONTEXT_CERTIFICATION_KIND,
    identity: captureGitBinding(root),
    finishedAt: new Date().toISOString(),
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (jsonPath) fs.writeFileSync(jsonPath, json, "utf8");
  process.stdout.write(`${formatHumanReport(report)}\n\n${json}`);
  if (!report.evaluation.passed) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`Context certification failed to execute: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
