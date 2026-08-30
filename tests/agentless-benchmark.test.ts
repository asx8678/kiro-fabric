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

  it("drains a background Pi child after the stage leader exits normally", async () => {
    const root = temporaryDirectory();
    const workdir = join(root, "workdir");
    const bin = join(root, "bin");
    const sessions = join(root, "sessions");
    const logs = join(root, "logs");
    const artifacts = join(root, "artifacts");
    const agent = join(root, "agent");
    const prompt = join(root, "prompt.txt");
    const count = join(root, "calls.txt");
    const childPidFile = join(root, "background-child.pid");
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
calls=0
[[ ! -f "$FAKE_PI_COUNT_FILE" ]] || calls=$(cat "$FAKE_PI_COUNT_FILE")
calls=$((calls + 1))
printf '%s' "$calls" > "$FAKE_PI_COUNT_FILE"
if [[ "$calls" -eq 1 ]]; then
  bash -c 'trap "" TERM; sleep 1000' &
  printf '%s' "$!" > "$FAKE_PI_CHILD_PID_FILE"
  exit 0
fi
printf 'repaired\n' > app.txt
printf 'repair complete\n'
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
        FAKE_PI_CHILD_PID_FILE: childPidFile,
      },
    );

    expect(readFileSync(count, "utf8")).toBe("2");
    expect(readFileSync(join(workdir, "app.txt"), "utf8")).toBe("repaired\n");
    const childPid = Number(readFileSync(childPidFile, "utf8"));
    expect(() => process.kill(childPid, 0)).toThrow();
  }, 10_000);

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

  it("keeps blinded selective-prewalk treatment and telemetry controller-only", () => {
    const root = temporaryDirectory();
    const repository = join(root, `blinded-cell-${process.pid}-${Date.now()}.git`);
    const cache = join(ROOT, "bench", ".cache", repository.split("/").at(-1)!.replace(/\.git$/, ""));
    temporaryDirectories.push(cache);
    const task = join(root, "task");
    const sharedAgent = join(root, "shared-agent");
    const controller = join(root, "controller");
    const cell = join(root, "public", "kestrel", "blinded-treatment", "rep0");
    const bin = join(root, "bin");
    const applied = join(root, "applied-treatment.txt");
    mkdirSync(repository);
    mkdirSync(task);
    mkdirSync(sharedAgent);
    mkdirSync(controller);
    mkdirSync(bin);
    writeFileSync(join(repository, "app.txt"), "original\n");
    run("git", ["init", "-q"], repository);
    run("git", ["config", "user.email", "test@example.com"], repository);
    run("git", ["config", "user.name", "Test"], repository);
    run("git", ["add", "app.txt"], repository);
    run("git", ["commit", "-qm", "fixture"], repository);
    const baseRef = run("git", ["rev-parse", "HEAD"], repository).trim();
    writeFileSync(join(sharedAgent, "auth.json"), "{}\n");
    writeFileSync(join(sharedAgent, "settings.json"), "{}\n");
    writeFileSync(join(task, "task.json"), JSON.stringify({
      slug: "blinded-treatment",
      repo: repository,
      base_ref: baseRef,
      agent_timeout_s: 5,
      verify_timeout_s: 5,
    }));
    writeFileSync(join(task, "prompt.txt"), "Repair app.txt.\n");
    writeFileSync(join(task, "verify.sh"), `#!/usr/bin/env bash
python3 - "$2" <<'PY'
import json, sys
path = sys.argv[1]
value = json.load(open(path))
value.update({"reward_binary": 1, "reward_partial": 1, "checks": {"repair": 1}})
json.dump(value, open(path, "w"))
PY
`);
    chmodSync(join(task, "verify.sh"), 0o755);
    writeFileSync(join(bin, "pi"), `#!/usr/bin/env bash
set -eu
python3 - "$PI_CODING_AGENT_DIR/fabric.json" "$FAKE_APPLIED_FILE" <<'PY'
import json, sys
value = json.load(open(sys.argv[1]))
open(sys.argv[2], "w").write(value["prewalk"]["activation"])
PY
session=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--session-dir" ]]; then session="$2"; shift 2; else shift; fi
done
mkdir -p "$session"
cat > "$session/session.jsonl" <<'JSONL'
{"type":"custom","customType":"kiro-fabric-prewalk-decision","data":{"activation":"gated","eligible":true,"armed":true,"reason":"multiple-concerns"}}
{"message":{"role":"custom","customType":"kiro-fabric-prewalk-armed","details":{"activation":"gated"},"content":"neutral prewalk handoff"}}
{"message":{"role":"assistant","usage":{"input":2,"output":1,"totalTokens":3},"content":[]}}
JSONL
printf 'repaired\n' > app.txt
`);
    chmodSync(join(bin, "pi"), 0o755);

    const completed = spawnSync(
      "bash",
      [CELL_RUNNER, task, "fabric-local-gated", "0", cell, sharedAgent],
      {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          BENCH_ARM: "kestrel",
          BENCH_PAIR: "blinded-treatment/rep0",
          BENCH_CONTROLLER_DIR: controller,
          FAKE_APPLIED_FILE: applied,
        },
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(completed.status, completed.stderr).toBe(0);
    expect(readFileSync(applied, "utf8")).toBe("gated");
    expect(existsSync(join(sharedAgent, "fabric.json"))).toBe(false);
    const sharedAgentText = ["auth.json", "settings.json"]
      .map((name) => readFileSync(join(sharedAgent, name), "utf8"))
      .join("\n");
    expect(sharedAgentText).not.toContain("fabric-local-gated");
    expect(sharedAgentText).not.toContain('"activation":"gated"');
    expect(existsSync(join(cell, "session-store"))).toBe(false);

    const resultText = readFileSync(join(cell, "result.json"), "utf8");
    const sessionText = readFileSync(join(cell, "session", "0000-session.jsonl"), "utf8");
    for (const publicText of [resultText, sessionText]) {
      expect(publicText).not.toContain("fabric-local-gated");
      expect(publicText).not.toContain('"activation":"gated"');
      expect(publicText).not.toContain("kiro-fabric-prewalk-decision");
    }
    expect(JSON.parse(resultText)).not.toHaveProperty("prewalk_activation");

    const privateCell = join(controller, "cells", "kestrel", "blinded-treatment", "rep0");
    expect(JSON.parse(readFileSync(join(privateCell, "agent", "fabric.json"), "utf8"))).toMatchObject({
      prewalk: { activation: "gated" },
    });
    expect(JSON.parse(readFileSync(join(privateCell, "treatment.json"), "utf8"))).toMatchObject({
      config: "fabric-local-gated",
      prewalk_activation: "gated",
      prewalk_gate_decisions: 1,
      prewalk_automatic_arms: 1,
    });
    expect(readFileSync(join(privateCell, "session-store", "session.jsonl"), "utf8")).toContain(
      '"activation":"gated"',
    );
  }, 15_000);

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

  it("deblinds controller telemetry without publishing a treatment summary", () => {
    const runDirectory = temporaryDirectory();
    const task = "superjson-error-stack-serialization";
    const arm = "kestrel";
    const cell = join(runDirectory, arm, task, "rep0");
    const controllerCell = join(runDirectory, "controller", "cells", arm, task, "rep0");
    mkdirSync(join(cell, "session"), { recursive: true });
    mkdirSync(controllerCell, { recursive: true });
    writeFileSync(join(cell, "result.json"), JSON.stringify({
      reward_binary: 1,
      reward_partial: 1,
      combined_total_tokens: 10,
    }));
    writeFileSync(join(cell, "session", "session.jsonl"), "");
    writeFileSync(join(runDirectory, "controller", "arm-map.json"), JSON.stringify({
      pairs: [{ arms: { "fabric-local-gated": arm } }],
    }));
    writeFileSync(join(controllerCell, "treatment.json"), JSON.stringify({
      config: "fabric-local-gated",
      prewalk_activation: "gated",
      prewalk_gate_decisions: 2,
      prewalk_gate_eligible: 1,
      prewalk_automatic_arms: 1,
      prewalk_gate_reasons: { "multiple-concerns": 1 },
    }));

    run("python3", [
      MUTATION_RUNNER,
      "--tasks",
      task,
      "--report",
      join(runDirectory, "controller", "verifier-mutation-report.json"),
    ], ROOT);
    run("python3", [ANALYZER, runDirectory], ROOT);

    expect(existsSync(join(runDirectory, "analysis-summary.json"))).toBe(false);
    const summary = JSON.parse(
      readFileSync(join(runDirectory, "controller", "analysis-summary.json"), "utf8"),
    );
    expect(summary.per_config["fabric-local-gated"]).toMatchObject({
      n: 1,
      prewalk_activation: "gated",
      prewalk_gate_decisions: 2,
      prewalk_automatic_arms: 1,
    });
    expect(summary.per_config).not.toHaveProperty(arm);
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
