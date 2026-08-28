#!/usr/bin/env node
// Opt-in Release-C crash rehearsal. Never billable and never real-network by
// default: refuses unless REHEARSER_REAL=1 and only runs fake-Kiro durable
// crash/resume coverage in throwaway temp repos created by the targeted tests.

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REAL_GATE = "REHEARSER_REAL";
const BILLABLE_SPIKE = "KIRO_PHASE0_BILLABLE";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testFiles = [
  "tests/reliability-session-resume.test.ts",
  "tests/reliability-no-duplicate-mailbox.test.ts",
  "tests/reliability-crash-single-owner.test.ts",
  "tests/reliability-rollback.test.ts",
  "tests/kiro-process-lifecycle.test.ts",
];
const checks = [
  {
    key: "resume-session-load",
    label: "runnerSessionId survives and resume uses session/load",
    file: testFiles[0],
  },
  {
    key: "exactly-once-delivery",
    label: "pre-crash pending delivery is delivered exactly once",
    file: testFiles[1],
  },
  {
    key: "stale-owner-refused",
    label: "stale second owner is refused without stepping over current",
    file: testFiles[2],
  },
  {
    key: "rollback-no-mutation",
    label: "future state is rejected without mutating persisted bytes",
    file: testFiles[3],
  },
  {
    key: "actual-sigkill-tree",
    label: "a stubborn detached process tree is terminated through real SIGKILL escalation",
    file: testFiles[4],
  },
];

const fail = (message) => {
  throw new Error(message);
};

const gateMessage = `refusing to run: set ${REAL_GATE}=1 (non-billable fake-Kiro durable crash rehearsal only)`;
let summaryLine = "FAIL: not started";

try {
  if (process.env[REAL_GATE] !== "1") fail(gateMessage);
  if (process.env[BILLABLE_SPIKE] === "1") {
    fail(`refusing to run: ${BILLABLE_SPIKE}=1 is set`);
  }

  const run = spawnSync(
    "pnpm",
    ["exec", "vitest", "run", ...testFiles],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        KIRO_PHASE0_BILLABLE: "0",
      },
      timeout: 180_000,
    },
  );

  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  if (run.status !== 0) {
    fail(
      `vitest failed (${run.status ?? run.signal ?? "unknown"}); tail=${JSON.stringify(output.slice(-4000))}`,
    );
  }

  const report = {
    ok: true,
    nonBillable: true,
    realNetwork: false,
    command: `pnpm exec vitest run ${testFiles.join(" ")}`,
    checks: checks.map((check) => ({
      key: check.key,
      ok: true,
      file: check.file,
      label: check.label,
    })),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  summaryLine = `PASS: Release-C rehearsal proved resume, recoverable mailbox delivery, exact epoch fencing, fail-closed rollback, and real SIGKILL tree escalation`;
} catch (error) {
  summaryLine = `FAIL: ${error instanceof Error ? error.message : String(error)}`;
  process.exitCode = 1;
} finally {
  process.stdout.write(`${summaryLine}\n`);
}
