import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const RUNNER = join(ROOT, "bench", "run-agentless.sh");
const ANALYZER = join(ROOT, "bench", "analyze.py");
const MUTATION_RUNNER = join(ROOT, "bench", "mutation_verifiers.py");
const BLINDED_RUNNER = join(ROOT, "bench", "run-matrix-blinded.sh");
const CELL_RUNNER = join(ROOT, "bench", "run-cell.sh");
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

  it("kills and waits for an active Pi process tree when interrupted", async () => {
    const root = temporaryDirectory();
    const workdir = join(root, "workdir");
    const bin = join(root, "bin");
    const sessions = join(root, "sessions");
    const logs = join(root, "logs");
    const artifacts = join(root, "artifacts");
    const agent = join(root, "agent");
    const prompt = join(root, "prompt.txt");
    const piPidFile = join(root, "pi.pid");
    const childPidFile = join(root, "pi-child.pid");
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
set -u
printf '%s' "$$" > "$FAKE_PI_PID_FILE"
trap '' TERM
sleep 1000 &
child=$!
printf '%s' "$child" > "$FAKE_PI_CHILD_PID_FILE"
wait "$child"
`,
    );
    chmodSync(fakePi, 0o755);

    const runner = spawn(
      "bash",
      [RUNNER, workdir, prompt, sessions, logs, artifacts, agent, "301"],
      {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          FAKE_PI_PID_FILE: piPidFile,
          FAKE_PI_CHILD_PID_FILE: childPidFile,
        },
        stdio: "ignore",
      },
    );
    const deadline = Date.now() + 5_000;
    while ((!existsSync(piPidFile) || !existsSync(childPidFile)) && Date.now() < deadline) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    }
    expect(existsSync(piPidFile)).toBe(true);
    expect(existsSync(childPidFile)).toBe(true);
    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error("agentless runner did not exit after SIGTERM")), 5_000);
      runner.once("exit", (code, signal) => {
        clearTimeout(timer);
        resolvePromise({ code, signal });
      });
    });
    runner.kill("SIGTERM");
    const exit = await exitPromise;
    expect(exit).toEqual({ code: 143, signal: null });

    for (const file of [piPidFile, childPidFile]) {
      const pid = Number(readFileSync(file, "utf8"));
      let alive = true;
      for (let attempt = 0; attempt < 50 && alive; attempt += 1) {
        try {
          process.kill(pid, 0);
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
        } catch {
          alive = false;
        }
      }
      expect(alive, `process ${pid} from ${file} survived cleanup`).toBe(false);
    }
  }, 10_000);

  it("fails malformed cell setup before Pi can make a model call", () => {
    const root = temporaryDirectory();
    const task = join(root, "task");
    const agent = join(root, "agent");
    const bin = join(root, "bin");
    const marker = join(root, "pi-called");
    mkdirSync(task);
    mkdirSync(agent);
    mkdirSync(bin);
    writeFileSync(join(task, "task.json"), JSON.stringify({ slug: "broken" }));
    writeFileSync(join(task, "prompt.txt"), "Do not run.\n");
    writeFileSync(join(task, "verify.sh"), "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(join(task, "verify.sh"), 0o755);
    writeFileSync(join(bin, "pi"), `#!/usr/bin/env bash\ntouch ${JSON.stringify(marker)}\n`);
    chmodSync(join(bin, "pi"), 0o755);

    const completed = spawnSync(
      "bash",
      [CELL_RUNNER, task, "baseline", "0", join(root, "cell"), agent],
      {
        cwd: root,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
        encoding: "utf8",
      },
    );
    expect(completed.status).toBe(2);
    expect(completed.stderr).toContain("invalid task configuration");
    expect(existsSync(marker)).toBe(false);
  });

  it("records expected agent failure and surfaces verifier infrastructure failure", () => {
    const root = temporaryDirectory();
    const repository = join(root, `run-cell-${process.pid}-${Date.now()}.git`);
    const cache = join(ROOT, "bench", ".cache", repository.split("/").at(-1)!.replace(/\.git$/, ""));
    temporaryDirectories.push(cache);
    const task = join(root, "task");
    const agent = join(root, "agent");
    const bin = join(root, "bin");
    mkdirSync(repository);
    mkdirSync(task);
    mkdirSync(agent);
    mkdirSync(bin);
    writeFileSync(join(repository, "app.txt"), "original\n");
    run("git", ["init", "-q"], repository);
    run("git", ["config", "user.email", "test@example.com"], repository);
    run("git", ["config", "user.name", "Test"], repository);
    run("git", ["add", "app.txt"], repository);
    run("git", ["commit", "-qm", "fixture"], repository);
    const baseRef = run("git", ["rev-parse", "HEAD"], repository).trim();
    writeFileSync(join(task, "task.json"), JSON.stringify({
      slug: "expected-failures",
      repo: repository,
      base_ref: baseRef,
      agent_timeout_s: 5,
      verify_timeout_s: 5,
    }));
    writeFileSync(join(task, "prompt.txt"), "Attempt repair.\n");
    writeFileSync(join(task, "verify.sh"), `#!/usr/bin/env bash
python3 - "$2" <<'PY'
import json, sys
value = json.load(open(sys.argv[1]))
value.update({"reward_binary": 0, "reward_partial": 0, "checks": {"infra": 0}})
json.dump(value, open(sys.argv[1], "w"))
PY
exit 6
`);
    chmodSync(join(task, "verify.sh"), 0o755);
    writeFileSync(join(bin, "pi"), "#!/usr/bin/env bash\nexit 7\n");
    chmodSync(join(bin, "pi"), 0o755);
    const cell = join(root, "cell");

    const completed = spawnSync(
      "bash",
      [CELL_RUNNER, task, "baseline", "0", cell, agent],
      {
        cwd: root,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(completed.status).toBe(1);
    expect(readFileSync(join(cell, "agent-exit-code.txt"), "utf8").trim()).toBe("7");
    expect(readFileSync(join(cell, "verifier-exit-code.txt"), "utf8").trim()).toBe("6");
    expect(JSON.parse(readFileSync(join(cell, "result.json"), "utf8"))).toMatchObject({
      reward_binary: 0,
      checks: { infra: 0 },
    });
    expect(completed.stderr).toContain("verifier infrastructure failed");
  }, 15_000);

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
    const task = "superjson-error-stack-serialization";
    const cell = join(runDirectory, "agentless", task, "rep0");
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

    run("python3", [
      MUTATION_RUNNER,
      "--tasks",
      task,
      "--report",
      join(runDirectory, "verifier-mutation-report.json"),
    ], ROOT);
    run("python3", [ANALYZER, runDirectory], ROOT);
    const summary = JSON.parse(readFileSync(join(runDirectory, "analysis-summary.json"), "utf8"));
    expect(summary.per_config.agentless.reads).toBe(1);
    expect(summary.per_config.agentless.whole_file_reads_pct).toBe(100);
  });
});
