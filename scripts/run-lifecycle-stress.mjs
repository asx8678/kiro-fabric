#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rawIterations = process.argv.find((value) => value.startsWith("--iterations="))?.split("=")[1] ?? "10";
const iterations = Number(rawIterations);
if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 100) {
  throw new Error("--iterations must be an integer from 1 to 100");
}

const suites = [
  "tests/kiro-process-lifecycle.test.ts",
  "tests/agentless-benchmark.test.ts",
];
const diagnosticsDir = path.join(root, ".tmp", "process-diagnostics");
const diagnosticPath = path.join(diagnosticsDir, "lifecycle-stress-failure.txt");
fs.rmSync(diagnosticsDir, { recursive: true, force: true });

for (let iteration = 1; iteration <= iterations; iteration += 1) {
  const completed = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    [
      "exec", "vitest", "run", ...suites,
      "--config", "vitest.process.config.ts",
      "--maxWorkers=1", "--reporter=dot",
    ],
    { cwd: root, encoding: "utf8", timeout: 120_000 },
  );
  if (completed.status !== 0) {
    fs.mkdirSync(diagnosticsDir, { recursive: true });
    const ps = process.platform === "win32"
      ? "process snapshot unavailable on Windows"
      : spawnSync("/bin/ps", ["-axo", "pid=,ppid=,pgid=,state=,command="], {
          encoding: "utf8",
        }).stdout;
    fs.writeFileSync(diagnosticPath, [
      `iteration=${iteration}`,
      `status=${completed.status ?? "signal"}`,
      "stdout:", completed.stdout.slice(-16_000),
      "stderr:", completed.stderr.slice(-16_000),
      "processes:", String(ps).slice(-16_000),
    ].join("\n"));
    process.stderr.write(`lifecycle stress failed at iteration ${iteration}; ${diagnosticPath}\n`);
    process.exit(1);
  }
  process.stdout.write(`lifecycle stress ${iteration}/${iterations}: pass\n`);
}

process.stdout.write(`${JSON.stringify({ ok: true, iterations, suites })}\n`);
