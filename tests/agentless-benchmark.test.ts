import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const RUNNER = join(ROOT, "bench", "run-agentless.sh");
const ANALYZER = join(ROOT, "bench", "analyze.py");
const BLINDED_RUNNER = join(ROOT, "bench", "run-matrix-blinded.sh");
const temporaryDirectories: string[] = [];

const temporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "kiro-agentless-test-"));
  temporaryDirectories.push(directory);
  return directory;
};

const run = (command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): string =>
  execFileSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("agentless benchmark comparator", () => {
  it("runs exactly two fixed calls, discards localization writes, and bounds the handoff", () => {
    const root = temporaryDirectory();
    const workdir = join(root, "workdir");
    const bin = join(root, "bin");
    const sessions = join(root, "sessions");
    const logs = join(root, "logs");
    const artifacts = join(root, "artifacts");
    const agent = join(root, "agent");
    const prompt = join(root, "prompt.txt");
    const count = join(root, "calls.txt");
    mkdirSync(workdir);
    mkdirSync(bin);
    mkdirSync(agent);
    writeFileSync(join(workdir, "app.txt"), "original\n");
    writeFileSync(prompt, "Repair app.txt.\n");
    run("git", ["init", "-q"], workdir);
    run("git", ["config", "user.email", "test@example.com"], workdir);
    run("git", ["config", "user.name", "Test"], workdir);
    run("git", ["add", "app.txt"], workdir);
    run("git", ["commit", "-qm", "fixture"], workdir);

    const fakePi = join(bin, "pi");
    writeFileSync(
      fakePi,
      `#!/usr/bin/env bash
set -eu
count=0
[[ ! -f "$FAKE_PI_COUNT_FILE" ]] || count=$(cat "$FAKE_PI_COUNT_FILE")
count=$((count + 1))
printf '%s' "$count" > "$FAKE_PI_COUNT_FILE"
prompt="\${!#}"
if [[ "$prompt" == *"localization phase"* ]]; then
  printf 'must not survive\n' > localization-write.txt
  python3 - <<'PY'
print("src/app.ts:target " + "x" * 20000)
PY
elif [[ "$prompt" == *"repair phase"* && "$prompt" == *"localization output truncated"* ]]; then
  printf 'repaired\n' > app.txt
  printf 'repair complete\n'
else
  exit 9
fi
`,
    );
    chmodSync(fakePi, 0o755);

    run(
      "bash",
      [RUNNER, workdir, prompt, sessions, logs, artifacts, agent, "301"],
      root,
      {
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        FAKE_PI_COUNT_FILE: count,
      },
    );

    expect(readFileSync(count, "utf8")).toBe("2");
    expect(readFileSync(join(workdir, "app.txt"), "utf8")).toBe("repaired\n");
    expect(() => readFileSync(join(workdir, "localization-write.txt"))).toThrow();
    const report = readFileSync(join(artifacts, "localization.txt"));
    expect(report.byteLength).toBeLessThanOrEqual(16_384);
    expect(report.toString()).toContain("[localization output truncated]");

    const stages = JSON.parse(readFileSync(join(artifacts, "agentless-stages.json"), "utf8"));
    expect(stages).toMatchObject({
      orchestration: "localization-repair-verification",
      model_calls: 2,
      max_localization_bytes: 16_384,
    });
    expect(stages.stages.map((stage: { name: string }) => stage.name)).toEqual([
      "localization",
      "repair",
      "verification",
    ]);
    expect(stages.stages[0].timeout_s + stages.stages[1].timeout_s).toBe(301);
  });

  it("previews an agentless matrix without credentials or model calls", () => {
    const runId = `agentless-dry-${process.pid}-${Date.now()}`;
    const output = run(
      "bash",
      [
        BLINDED_RUNNER,
        "--dry-run",
        "--run-id",
        runId,
        "--tasks",
        "scc-bounded-memory-spilling",
        "--configs",
        "baseline,agentless,fabric-local",
        "--reps",
        "1",
        "--seed",
        "agentless-test",
      ],
      ROOT,
    );
    expect(output).toContain("no credentials read, no cells launched, no network/model activity");
    expect(output.match(/arm=/g)).toHaveLength(3);
    expect(() => readFileSync(join(ROOT, "bench", "results", runId, "manifest.json"))).toThrow();
  });

  it("counts agentless direct reads through the existing baseline metrics", () => {
    const runDirectory = temporaryDirectory();
    const cell = join(runDirectory, "agentless", "task", "rep0");
    mkdirSync(join(cell, "session"), { recursive: true });
    writeFileSync(
      join(cell, "result.json"),
      JSON.stringify({ reward_binary: 1, reward_partial: 1, combined_total_tokens: 10 }),
    );
    writeFileSync(
      join(cell, "session", "session.jsonl"),
      `${JSON.stringify({
        message: {
          role: "assistant",
          content: [{ type: "toolCall", name: "read", arguments: { path: "src/app.ts" } }],
        },
      })}\n`,
    );

    run("python3", [ANALYZER, runDirectory], ROOT);
    const summary = JSON.parse(readFileSync(join(runDirectory, "analysis-summary.json"), "utf8"));
    expect(summary.per_config.agentless.reads).toBe(1);
    expect(summary.per_config.agentless.whole_file_reads_pct).toBe(100);
  });
});
