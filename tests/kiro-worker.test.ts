import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_FABRIC_CONFIG } from "../src/config.js";
import { projectAgentTranscript } from "../src/ui/transcript.js";
import { AgentManager } from "../src/agents/manager.js";
import {
  createRunningRecord,
  latestRunText,
  updateRunRecord,
  writeRunRecord,
} from "../src/worker/run-record.js";
import { parseWorkerOptions } from "../src/worker/options.js";
import { installKiroProfile } from "../src/kiro/install.js";
import { sha256Bytes } from "../src/kiro/managed.js";
import {
  assertKiroWorkerLaunch,
  buildKiroChildEnvironment,
  buildKiroAcpArguments,
  buildKiroPromptBlocks,
  createBoundedKiroLogAppender,
  formatKiroSemanticContext,
  kiroSessionProfileFingerprint,
  mapKiroEffort,
  MAX_KIRO_CONTEXT_BLOCK_CHARS,
  readKiroSteerCommands,
  redactKiroAcpEvidence,
  runKiroWorker,
  type KiroWorkerRecordHelpers,
} from "../src/kiro/acp-worker.js";
import { managedPaths, readManifest } from "../src/kiro/managed.js";
import { materializeKiroRunProfile } from "../src/kiro/run-profile.js";
import type { KiroProfileDocument } from "../src/kiro/profile.js";
import type { AgentWorkerOptions } from "../src/agents/types.js";
import type { KiroAgentWorkerOptions } from "../src/kiro/agent-worker-options.js";

type KiroTestWorkerOptions = AgentWorkerOptions & KiroAgentWorkerOptions;

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const fakeKiro = join(repoRoot, "tests", "fixtures", "kiro", "fake-kiro-worker.mjs");
const poisonPi = join(repoRoot, "tests", "fixtures", "missing-pi-binary");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const tempRoot = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
};

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const initGitRepository = (prefix: string): string => {
  const root = tempRoot(prefix);
  git(root, "init", "-q");
  git(root, "config", "user.email", "kiro-fabric-tests@example.invalid");
  git(root, "config", "user.name", "Pi Fabric tests");
  writeFileSync(join(root, "README.md"), "test repository\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  git(root, "add", ".");
  git(root, "commit", "-qm", "initial");
  return realpathSync(root);
};

const writeWrapper = (dir: string): string => {
  const wrapper = join(dir, "fake-kiro");
  writeFileSync(
    wrapper,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeKiro)} "$@"\n`,
    { mode: 0o755 },
  );
  chmodSync(wrapper, 0o755);
  return wrapper;
};

const installFake = async (projectRoot: string, wrapper: string) => {
  const mcpEntryPath = join(projectRoot, "dummy-mcp.js");
  writeFileSync(mcpEntryPath, "export {};\n", { encoding: "utf8", mode: 0o600 });
  await installKiroProfile({
    projectRoot,
    kiroBinary: wrapper,
    mcpEntryPath,
  });
};

const installUserFake = async (
  installRoot: string,
  kiroHome: string,
  wrapper: string,
) => {
  const mcpEntryPath = join(installRoot, "dummy-user-mcp.js");
  writeFileSync(mcpEntryPath, "export {};\n", { encoding: "utf8", mode: 0o600 });
  await installKiroProfile({
    projectRoot: installRoot,
    kiroBinary: wrapper,
    mcpEntryPath,
    scope: "user",
    kiroHome,
    allowTools: true,
  });
};

/**
 * Recompute the security-profile fingerprint the worker will derive for a
 * project, so resume tests can present the matching digest the session was
 * "created" with. Reads the installed profile from disk and canonicalizes cwd
 * exactly like assertKiroWorkerLaunch does.
 */
const fingerprintFor = (
  projectRoot: string,
  extra: Partial<AgentWorkerOptions> = {},
): string => {
  // Reproduce the worker's run-scoped profile: same projectRoot/cwd/tools and
  // the manifest's mcpEntryPath (which assertKiroWorkerLaunch prefers over the
  // default). This is the exact input materializeKiroRunProfile regenerates.
  const canonicalRoot = realpathSync(projectRoot);
  const manifest = readManifest(canonicalRoot);
  const lease = materializeKiroRunProfile({
    projectRoot: canonicalRoot,
    cwd: canonicalRoot,
    tools: [],
    ...(manifest?.runtime.mcpEntryPath
      ? { mcpEntryPath: manifest.runtime.mcpEntryPath }
      : {}),
  });
  const fp = kiroSessionProfileFingerprint({
    profile: lease.profile,
    cwd: canonicalRoot,
    ...(typeof extra.model === "string" ? { model: extra.model } : {}),
    ...(typeof extra.thinking === "string" ? { thinking: extra.thinking } : {}),
  });
  lease.cleanup();
  return fp;
};

/** Resume options carrying the matching security-profile fingerprint. */
const resumeOptions = (
  projectRoot: string,
  runnerSessionId: string,
  extra: Partial<AgentWorkerOptions> = {},
): Partial<AgentWorkerOptions> => ({
  runnerSessionId,
  kiroSessionProfileSha256: fingerprintFor(projectRoot, extra),
  ...extra,
} as Partial<AgentWorkerOptions>);

const workerOptions = (
  projectRoot: string,
  wrapper: string,
  extra: Partial<AgentWorkerOptions> = {},
): KiroTestWorkerOptions => {
  const runDir = join(projectRoot, "run");
  mkdirSync(runDir, { recursive: true });
  const taskFile = extra.taskFile ?? join(runDir, "task.txt");
  if (!extra.taskFile) {
    writeFileSync(taskFile, "do the work", {
      encoding: "utf8",
      mode: 0o600,
    });
  }
  return {
    id: "run1",
    name: "kiro-test",
    statusFile: join(runDir, "status.json"),
    lifecycleFile: join(runDir, "lifecycle.jsonl"),
    logFile: join(runDir, "events.jsonl"),
    cwd: projectRoot,
    projectRoot,
    piBinary: poisonPi,
    claudeBinary: "claude",
    vedaBinary: "veda",
    kiroBinary: wrapper,
    vedaBackend: "agy",
    vedaPersona: "navigator-chat",
    timeoutMs: 4_000,
    depth: 1,
    fullCodeMode: false,
    extensions: false,
    tools: [],
    grantedRisks: [],
    transport: "process",
    ...extra,
    taskFile,
    runner: "kiro",
  };
};

// These legacy helpers are exercised only through Kiro-valued fixture
// options; the production worker has the same explicit compatibility bridge.
const helpers = {
  createRunningRecord,
  writeRunRecord,
  updateRunRecord,
  latestRunText,
} as unknown as KiroWorkerRecordHelpers;

const inboundFrames = (
  logFile: string,
): Array<{ method?: string; params?: Record<string, unknown> }> => {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { event?: string; frame?: { method?: string; params?: Record<string, unknown> } })
    .filter((entry) => entry.event === "inbound")
    .map((entry) => entry.frame ?? {});
};

const inboundMethods = (logFile: string): string[] =>
  inboundFrames(logFile)
    .filter((frame) => typeof frame.method === "string")
    .map((frame) => frame.method!);

describe("Kiro ACP argument builder", () => {
  it("uses only v3 relay flags and keeps model/effort for session controls", () => {
    const argv = buildKiroAcpArguments({ model: "m1", thinking: "off" });
    expect(argv).toEqual([
      "acp",
      "--agent-engine",
      "v3",
      "--auth-method",
      "cli",
    ]);
    expect(argv).not.toContain("--trust-all-tools");
    expect(argv).not.toContain("--agent");
    expect(argv).not.toContain("--model");
    expect(argv).not.toContain("--effort");
    expect(mapKiroEffort("minimal")).toBe("low");
    expect(mapKiroEffort("xhigh")).toBe("xhigh");
    expect(mapKiroEffort("max")).toBe("max");
  });
});

describe("Kiro ACP child boundary", () => {
  it("passes only explicit OS/auth selectors and replaces inherited KIRO_HOME", () => {
    const environment = buildKiroChildEnvironment(
      {
        PATH: "/usr/bin:/bin",
        HOME: "/Users/example",
        home: "LOWERCASE-HOME-MUST-NOT-OVERRIDE",
        LANG: "en_US.UTF-8",
        AWS_PROFILE: "kiro-test",
        KIRO_HOME: "/ambient/kiro",
        AWS_SECRET_ACCESS_KEY: "AWS-SECRET-MUST-NOT-PASS",
        GITHUB_TOKEN: "GITHUB-TOKEN-MUST-NOT-PASS",
        NODE_OPTIONS: "--require /tmp/ambient-hook.cjs",
        SSH_AUTH_SOCK: "/tmp/ambient-agent.sock",
        CI: "true",
      },
      "/isolated/run/.kiro",
    );

    expect(environment).toEqual({
      PATH: "/usr/bin:/bin",
      HOME: "/Users/example",
      LANG: "en_US.UTF-8",
      AWS_PROFILE: "kiro-test",
      KIRO_HOME: "/isolated/run/.kiro",
    });
    expect(JSON.stringify(environment)).not.toMatch(
      /AWS-SECRET-MUST-NOT-PASS|GITHUB-TOKEN-MUST-NOT-PASS|ambient-hook|ambient-agent/,
    );
  });

  it("retains metadata-only ACP evidence without prompts, thoughts, tool args, or credentials", () => {
    const evidence = redactKiroAcpEvidence({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-secret",
        update: {
          sessionUpdate: "thought_chunk",
          prompt: "PROMPT-MUST-NOT-BE-RETAINED",
          thought: "THOUGHT-MUST-NOT-BE-RETAINED",
          toolArguments: { command: "TOOL-ARGS-MUST-NOT-BE-RETAINED" },
          authorization: "Bearer TOKEN-MUST-NOT-BE-RETAINED",
        },
      },
    });

    expect(evidence).toMatchObject({
      type: "kiro_acp_evidence",
      redacted: true,
      frameKind: "notification",
      method: "session/update",
      sessionUpdate: "thought_chunk",
      bytes: expect.any(Number),
    });
    expect(evidence).not.toHaveProperty("frame");
    expect(JSON.stringify(evidence)).not.toMatch(
      /session-secret|PROMPT-MUST|THOUGHT-MUST|TOOL-ARGS-MUST|TOKEN-MUST/,
    );
  });

  it("enforces a cumulative byte quota on retained ACP logs", () => {
    const root = tempRoot("kiro-fabric-log-quota-");
    const logFile = join(root, "events.jsonl");
    const append = createBoundedKiroLogAppender(logFile, 1_024);
    append({ type: "message_update", text: "x".repeat(700) });
    append({ type: "kiro_acp_evidence", bytes: 700, padding: "y".repeat(700) });
    append({ type: "worker_stderr", text: "z".repeat(700) });
    append({
      type: "message_end",
      message: { role: "assistant", content: "\u0000".repeat(8) },
    });

    expect(statSync(logFile).size).toBeLessThanOrEqual(1_024);
    const retained = readFileSync(logFile, "utf8");
    expect(retained).toContain("kiro_log_quota_reached");
    expect(retained).toContain('"type":"message_end"');
  });

  it("injects a clearly delimited, bounded semantic handoff before the initial task", () => {
    const context = {
      objective: "Review the Kiro adapter",
      facts: ["The runtime is QuickJS"],
      relevantFiles: ["src/kiro/runtime.ts"],
      constraints: ["Keep the child environment minimal"],
      exclusions: ["Do not enable recursive agents"],
    };
    const block = formatKiroSemanticContext(context);
    expect(block).toContain("BEGIN FABRIC SEMANTIC CONTEXT");
    expect(block).toContain('"facts"');
    expect(block).toContain('"relevantFiles"');
    expect(block).toContain('"constraints"');
    expect(block).toContain('"exclusions"');
    expect(block).toContain("END FABRIC SEMANTIC CONTEXT");

    const promptRoot = tempRoot("kiro-fabric-context-prompt-");
    const blocks = buildKiroPromptBlocks(
      workerOptions(promptRoot, "/kiro", { kiroContext: context }),
      "perform the current task",
      [],
    );
    expect(blocks.map((entry) => entry.text)).toEqual([
      block,
      "perform the current task",
    ]);

    const hostile = `${'"\\\u0000'.repeat(5_000)}TAIL-MUST-NOT-BE-DROPPED`;
    expect(() => formatKiroSemanticContext({ objective: hostile }))
      .toThrow(/exceeds 4000 characters/);
    const largestValid = formatKiroSemanticContext({ objective: "x".repeat(4_000) });
    expect(largestValid).toBeDefined();
    expect(largestValid!.length).toBeLessThanOrEqual(MAX_KIRO_CONTEXT_BLOCK_CHARS);
  });
});

describe("Kiro worker preflight", () => {
  it("requires a managed profile and validates managed source/worktree cwd combinations", async () => {
    const source = initGitRepository("kiro-fabric-kiro-preflight-source-");
    const wrapper = writeWrapper(source);
    const previousKiroHome = process.env.KIRO_HOME;
    process.env.KIRO_HOME = tempRoot("kiro-fabric-kiro-empty-home-");
    try {
      expect(() =>
        assertKiroWorkerLaunch(workerOptions(source, wrapper)),
      ).toThrow(/managed kiro-fabric profile/);
    } finally {
      if (previousKiroHome === undefined) delete process.env.KIRO_HOME;
      else process.env.KIRO_HOME = previousKiroHome;
    }
    await installFake(source, wrapper);
    expect(assertKiroWorkerLaunch(workerOptions(source, wrapper)).projectRoot).toBe(
      realpathSync(source),
    );

    const worktreeRoot = tempRoot("kiro-fabric-kiro-preflight-worktree-");
    const worktreePath = join(worktreeRoot, "checkout");
    const branch = "kiro-fabric-preflight-worktree";
    git(source, "worktree", "add", "-q", "-b", branch, worktreePath, "HEAD");
    try {
      const worktreeReal = realpathSync(worktreePath);
      expect(
        assertKiroWorkerLaunch(
          workerOptions(source, wrapper, {
            projectRoot: source,
            worktree: worktreePath,
            cwd: worktreePath,
          }),
        ),
      ).toMatchObject({
        projectRoot: realpathSync(source),
        executionRoot: worktreeReal,
        cwd: worktreeReal,
      });

      const subdir = join(worktreePath, "packages", "app");
      mkdirSync(subdir, { recursive: true });
      expect(
        assertKiroWorkerLaunch(
          workerOptions(source, wrapper, {
            projectRoot: source,
            worktree: worktreePath,
            cwd: subdir,
          }),
        ),
      ).toMatchObject({
        projectRoot: realpathSync(source),
        executionRoot: worktreeReal,
        cwd: realpathSync(subdir),
      });

      const sibling = join(worktreeRoot, "sibling");
      mkdirSync(sibling, { recursive: true });
      expect(() =>
        assertKiroWorkerLaunch(
          workerOptions(source, wrapper, {
            projectRoot: source,
            worktree: worktreePath,
            cwd: sibling,
          }),
        ),
      ).toThrow(/worktree|execution root|cwd/i);

      expect(() =>
        assertKiroWorkerLaunch(
          workerOptions(source, wrapper, {
            projectRoot: source,
            worktree: join(worktreeRoot, "missing"),
            cwd: worktreePath,
          }),
        ),
      ).toThrow(/worktree|exist|directory/i);
    } finally {
      try {
        git(source, "worktree", "remove", "--force", worktreePath);
      } catch {
        // Best-effort test cleanup before the source repository is removed.
      }
      try {
        git(source, "branch", "-D", branch);
      } catch {
        // The worktree removal may already have deleted its branch.
      }
    }
  });

  it("rejects broad v3 permissions even when the profile and manifest hashes agree", async () => {
    const root = initGitRepository("kiro-fabric-kiro-v3-permissions-");
    const wrapper = writeWrapper(root);
    await installFake(root, wrapper);
    const profilePath = join(root, ".kiro", "agents", "kiro-fabric.json");
    const manifestPath = join(root, ".kiro", ".kiro-fabric", "install.json");
    const profile = JSON.parse(readFileSync(profilePath, "utf8"));
    profile.permissions.rules = [{ capability: "mcp", match: ["*"], effect: "allow" }];
    const profileText = `${JSON.stringify(profile, null, 2)}\n`;
    writeFileSync(profilePath, profileText);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.profile.installedSha256 = sha256Bytes(profileText);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    expect(() => assertKiroWorkerLaunch(workerOptions(root, wrapper)))
      .toThrow(/broad or unknown permission/i);
  });

  it("rejects a pre-v3 managed tuple before launching ACP", async () => {
    const root = initGitRepository("kiro-fabric-kiro-v2-manifest-");
    const wrapper = writeWrapper(root);
    await installFake(root, wrapper);
    const manifestPath = join(root, ".kiro", ".kiro-fabric", "install.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.runtime.agentEngine = "v2";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    expect(() => assertKiroWorkerLaunch(workerOptions(root, wrapper)))
      .toThrow(/reinstall.*2\.20\.1.*v3/i);
  });
});

describe("runKiroWorker", () => {
  it("uses a global managed profile from a different launch root, including --allow-tools installs", async () => {
    const installRoot = tempRoot("kiro-fabric-kiro-global-install-");
    const launchRoot = tempRoot("kiro-fabric-kiro-global-launch-");
    const kiroHome = tempRoot("kiro-fabric-kiro-global-home-");
    const wrapper = writeWrapper(installRoot);
    await installUserFake(installRoot, kiroHome, wrapper);
    const previousKiroHome = process.env.KIRO_HOME;
    process.env.KIRO_HOME = kiroHome;
    try {
      const options = workerOptions(launchRoot, wrapper);
      const preflight = assertKiroWorkerLaunch(options);
      expect(preflight).toMatchObject({
        projectRoot: realpathSync(launchRoot),
        executionRoot: realpathSync(launchRoot),
        cwd: realpathSync(launchRoot),
      });
      expect(preflight.manifest.projectRoot).toBe(realpathSync(installRoot));

      const record = await runKiroWorker(options, helpers);
      expect(record).toMatchObject({
        status: "completed",
        runner: "kiro",
        cwd: launchRoot,
      });
    } finally {
      if (previousKiroHome === undefined) delete process.env.KIRO_HOME;
      else process.env.KIRO_HOME = previousKiroHome;
    }
  });

  it("transfers the bounded semantic context packet in the initial ACP prompt", async () => {
    const root = tempRoot("kiro-fabric-kiro-context-transfer-");
    const wrapper = writeWrapper(root);
    await installFake(root, wrapper);
    process.env.FAKE_KIRO_WORKER_SCENARIO = "prompt-echo";
    try {
      const record = await runKiroWorker(
        workerOptions(root, wrapper, {
          kiroContext: {
            objective: "Review the adapter",
            facts: ["Streaming uses ACP chunks"],
            relevantFiles: ["src/kiro/acp-worker.ts"],
            constraints: ["Do not expose ambient secrets"],
            exclusions: ["No recursive delegation"],
          },
        }),
        helpers,
      );
      expect(record.status).toBe("completed");
      expect(record.text).toContain("BEGIN FABRIC SEMANTIC CONTEXT");
      expect(record.text).toContain("Streaming uses ACP chunks");
      expect(record.text).toContain("src/kiro/acp-worker.ts");
      expect(record.text).toContain("Do not expose ambient secrets");
      expect(record.text).toContain("No recursive delegation");
      expect(record.text.indexOf("BEGIN FABRIC SEMANTIC CONTEXT")).toBeLessThan(
        record.text.indexOf("do the work"),
      );
    } finally {
      delete process.env.FAKE_KIRO_WORKER_SCENARIO;
    }
  });

  it("completes a new session, projects text/tools, and keeps usage unavailable", async () => {
    const root = tempRoot("kiro-fabric-kiro-happy-");
    const wrapper = writeWrapper(root);
    await installFake(root, wrapper);
    const logFile = join(root, "kiro.log");
    const options = workerOptions(root, wrapper);
    const record = await runKiroWorker(options, helpers);
    expect(record.status).toBe("completed");
    expect(record.runner).toBe("kiro");
    expect(record.kiroAgentEngine).toBe("v3");
    expect(record.text).toBe("界面 🚀");
    expect(record.toolCalls).toBe(1);
    expect(record.turns).toBe(1);
    expect(record.runnerSessionId).toMatch(/^fake-acp-session-/);
    expect(record.model).toBe("kiro-test-model");
    expect(record.usage).toEqual({
      availability: "unavailable",
      reason: "runner-does-not-report",
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
    });
    const events = readFileSync(options.logFile, "utf8");
    expect(events).toContain("agent_start");
    expect(events).toContain("tool_execution_start");
    expect(events).not.toContain("tokens.usage");
    expect(existsSync(poisonPi)).toBe(false);
    const parsed = events
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const transcript = projectAgentTranscript(parsed);
    expect(transcript.entries.some((entry) => entry.kind === "assistant" && entry.text?.includes("界面"))).toBe(
      true,
    );
  });

  it("applies model, effort, and supervised policy as v3 session controls", async () => {
    const root = tempRoot("kiro-fabric-kiro-v3-controls-");
    const wrapper = writeWrapper(root);
    await installFake(root, wrapper);
    const logFile = join(root, "v3-controls.log");
    process.env.FAKE_KIRO_WORKER_LOG = logFile;
    try {
      const record = await runKiroWorker(
        workerOptions(root, wrapper, { model: "m1", thinking: "max" }),
        helpers,
      );
      expect(record.status).toBe("completed");
      expect(record.model).toBe("m1");
      const controls = inboundFrames(logFile)
        .filter((frame) => frame.method === "session/set_config_option")
        .map((frame) => frame.params);
      expect(controls).toEqual([
        { sessionId: expect.any(String), configId: "model", value: "m1" },
        { sessionId: expect.any(String), configId: "effort", value: "max" },
        { sessionId: expect.any(String), configId: "autopilot", value: "off" },
      ]);
    } finally {
      delete process.env.FAKE_KIRO_WORKER_LOG;
    }
  });

  it("sends the canonical effective worktree cwd in session/new", async () => {
    const source = initGitRepository("kiro-fabric-kiro-worktree-run-");
    const wrapper = writeWrapper(source);
    await installFake(source, wrapper);
    const worktreeRoot = tempRoot("kiro-fabric-kiro-worktree-run-checkout-");
    const worktreePath = join(worktreeRoot, "checkout");
    const branch = "kiro-fabric-run-worktree";
    git(source, "worktree", "add", "-q", "-b", branch, worktreePath, "HEAD");
    const subdir = join(worktreePath, "packages", "app");
    mkdirSync(subdir, { recursive: true });
    const logFile = join(source, "worktree-run.log");
    process.env.FAKE_KIRO_WORKER_LOG = logFile;
    try {
      const record = await runKiroWorker(
        workerOptions(source, wrapper, {
          projectRoot: source,
          worktree: worktreePath,
          cwd: subdir,
        }),
        helpers,
      );
      expect(record.status).toBe("completed");
      expect(inboundFrames(logFile).find((frame) => frame.method === "session/new")).toMatchObject({
        method: "session/new",
        params: {
          cwd: realpathSync(subdir),
          mcpServers: [{ name: "fabric" }],
          _meta: {
            kiro: {
              customAgents: [{ id: "kiro-fabric", tools: ["@fabric/fabric_exec"] }],
            },
          },
        },
      });
    } finally {
      delete process.env.FAKE_KIRO_WORKER_LOG;
      try {
        git(source, "worktree", "remove", "--force", worktreePath);
      } catch {
        // Best-effort test cleanup before the source repository is removed.
      }
      try {
        git(source, "branch", "-D", branch);
      } catch {
        // The worktree removal may already have deleted its branch.
      }
    }
  });

  it("loads an existing session and ignores replayed text", async () => {
    const root = tempRoot("kiro-fabric-kiro-load-");
    const wrapper = writeWrapper(root);
    await installFake(root, wrapper);
    const logFile = join(root, "kiro.log");
    process.env.FAKE_KIRO_WORKER_SCENARIO = "load";
    process.env.FAKE_KIRO_WORKER_LOG = logFile;
    try {
      const record = await runKiroWorker(
        workerOptions(root, wrapper, resumeOptions(root, "saved-session")),
        helpers,
      );
      expect(record.status).toBe("completed");
      expect(record.text).toBe("界面 🚀");
      expect(record.text).not.toContain("REPLAYED");
      expect(record.runnerSessionId).toBe("saved-session");
      expect(inboundMethods(logFile)).toEqual([
        "initialize",
        "session/load",
        "session/set_mode",
        "session/set_config_option",
        "session/prompt",
      ]);
    } finally {
      delete process.env.FAKE_KIRO_WORKER_SCENARIO;
      delete process.env.FAKE_KIRO_WORKER_LOG;
    }
  });

  it("accepts a successful session/load response that omits sessionId", async () => {
    const root = tempRoot("kiro-fabric-kiro-load-no-id-");
    const wrapper = writeWrapper(root);
    await installFake(root, wrapper);
    process.env.FAKE_KIRO_WORKER_SCENARIO = "load-no-id";
    try {
      const record = await runKiroWorker(
        workerOptions(root, wrapper, resumeOptions(root, "saved-session")),
        helpers,
      );
      expect(record.status).toBe("completed");
      expect(record.runnerSessionId).toBe("saved-session");
      expect(record.model).toBe("kiro-loaded-model");
    } finally {
      delete process.env.FAKE_KIRO_WORKER_SCENARIO;
    }
  });

  it("allows Kiro's decorated fabric_exec call once and rejects hidden tools", async () => {
    const root = tempRoot("kiro-fabric-kiro-perm-");
    const wrapper = writeWrapper(root);
    await installFake(root, wrapper);
    process.env.FAKE_KIRO_WORKER_SCENARIO = "permission-fabric";
    process.env.FAKE_KIRO_WORKER_LOG = join(root, "allow.log");
    try {
      const allowed = await runKiroWorker(workerOptions(root, wrapper), helpers);
      expect(allowed.status).toBe("completed");
      expect(allowed.text).toBe("allowed");
      const allowLog = readFileSync(join(root, "allow.log"), "utf8");
      expect(allowLog).toContain("allow-once-1");
      expect(allowLog).not.toContain("allow_always");
    } finally {
      delete process.env.FAKE_KIRO_WORKER_SCENARIO;
      delete process.env.FAKE_KIRO_WORKER_LOG;
    }

    process.env.FAKE_KIRO_WORKER_SCENARIO = "permission-hidden";
    process.env.FAKE_KIRO_WORKER_LOG = join(root, "deny.log");
    try {
      const denied = await runKiroWorker(workerOptions(root, wrapper), helpers);
      expect(denied.status).toBe("failed");
      expect(denied.error ?? "").toMatch(/unmanaged tool/);
      expect(readFileSync(join(root, "deny.log"), "utf8")).toContain("reject-1");
    } finally {
      delete process.env.FAKE_KIRO_WORKER_SCENARIO;
      delete process.env.FAKE_KIRO_WORKER_LOG;
    }
  });

  it("ignores unknown vendor notifications", async () => {
    const root = tempRoot("kiro-fabric-kiro-vendor-notification-");
    const wrapper = writeWrapper(root);
    await installFake(root, wrapper);
    process.env.FAKE_KIRO_WORKER_SCENARIO = "vendor-notification";
    try {
      const record = await runKiroWorker(workerOptions(root, wrapper), helpers);
      expect(record.status).toBe("completed");
      expect(record.error).toBeUndefined();
      expect(record.text).toBe("界面 🚀");
    } finally {
      delete process.env.FAKE_KIRO_WORKER_SCENARIO;
    }
  });

  it("fails closed on malformed frames, unknown requests, and injected usage", async () => {
    const root = tempRoot("kiro-fabric-kiro-fail-");
    const wrapper = writeWrapper(root);
    await installFake(root, wrapper);

    process.env.FAKE_KIRO_WORKER_SCENARIO = "malformed";
    const malformed = await runKiroWorker(workerOptions(root, wrapper), helpers);
    expect(malformed.status).toBe("failed");
    expect(malformed.error ?? "").toMatch(/malformed JSON/);

    process.env.FAKE_KIRO_WORKER_SCENARIO = "unknown-request";
    const unknown = await runKiroWorker(workerOptions(root, wrapper), helpers);
    expect(unknown.status).toBe("failed");
    expect(unknown.error ?? "").toMatch(/unsupported ACP request/);

    process.env.FAKE_KIRO_WORKER_SCENARIO = "usage-inject";
    const injected = await runKiroWorker(workerOptions(root, wrapper), helpers);
    expect(injected.status).toBe("completed");
    expect(injected.usage.availability).toBe("unavailable");
    expect(injected.usage.cost).toBe(0);
    delete process.env.FAKE_KIRO_WORKER_SCENARIO;
  });

  it("times out a hanging prompt and does not treat ACP usage as accounting", async () => {
    const root = tempRoot("kiro-fabric-kiro-timeout-");
    const wrapper = writeWrapper(root);
    await installFake(root, wrapper);
    process.env.FAKE_KIRO_WORKER_SCENARIO = "hang";
    process.env.FAKE_KIRO_WORKER_LOG = join(root, "hang.log");
    try {
      const record = await runKiroWorker(
        workerOptions(root, wrapper, { timeoutMs: 400 }),
        helpers,
      );
      expect(record.status).toBe("timed_out");
      expect(inboundMethods(join(root, "hang.log"))).toContain("session/cancel");
    } finally {
      delete process.env.FAKE_KIRO_WORKER_SCENARIO;
      delete process.env.FAKE_KIRO_WORKER_LOG;
    }
  });
});

describe("Kiro steering journal parsing", () => {
  it("preserves complete commands beyond the per-poll budget", () => {
    const root = tempRoot("kiro-fabric-kiro-steer-parser-");
    const file = join(root, "steer.jsonl");
    const commands = Array.from({ length: 300 }, (_, index) => ({
      type: "steer",
      message: `message-${index}`,
    }));
    writeFileSync(file, commands.map((command) => JSON.stringify(command)).join("\n") + "\n");
    const state = { offset: 0, remainder: Buffer.alloc(0), skippingOversizedLine: false };

    const first = readKiroSteerCommands(file, state);
    const second = readKiroSteerCommands(file, state);

    expect(first).toHaveLength(256);
    expect(second).toHaveLength(44);
    expect([...first, ...second].map((command) => command.message)).toEqual(
      commands.map((command) => command.message),
    );
  });

  it("skips one oversized line without losing a following complete command", () => {
    const root = tempRoot("kiro-fabric-kiro-steer-oversized-");
    const file = join(root, "steer.jsonl");
    writeFileSync(
      file,
      `${JSON.stringify({ type: "steer", message: "x".repeat(70 * 1024) })}\n${JSON.stringify({ type: "follow_up", message: "preserved" })}\n`,
    );
    const state = { offset: 0, remainder: Buffer.alloc(0), skippingOversizedLine: false };
    expect(readKiroSteerCommands(file, state)).toEqual([
      { type: "follow_up", message: "preserved" },
    ]);
  });
});

describe("AgentManager Kiro controls", () => {
  it("rejects invalid tools and compact but queues steer and follow-up", async () => {
    const root = tempRoot("kiro-fabric-kiro-manager-");
    const manager = new AgentManager(root, { ...DEFAULT_FABRIC_CONFIG.agents, timeoutMs: 2_000 }, {
      workerPath: resolve(repoRoot, "tests/fixtures/fake-worker.mjs"),
      runRoot: join(root, "runs"),
      kiroBinary: writeWrapper(root),
    });
    await expect(manager.run({ task: "nope", runner: "kiro", tools: ["__proto__"] })).rejects.toThrow(
      /invalid Kiro child tool/,
    );
    const handle = await manager.spawn({ task: "HANG", runner: "kiro" });
    expect(manager.steer(handle.id, "nope")).toEqual({
      queued: true,
      messageId: expect.any(String),
    });
    expect(manager.followUp(handle.id, "nope")).toEqual({
      queued: true,
      messageId: expect.any(String),
    });
    expect(() => manager.steer(handle.id, "x".repeat(70 * 1024))).toThrow(/too large/);
    expect(() => manager.compact(handle.id)).toThrow(/cannot be compacted/);
    await manager.stop(handle.id);
    await manager.close();
  });
});

describe("runKiroWorker resident session", () => {
  it("steers and follows up within a fresh resident session", async () => {
    const root = tempRoot("kiro-fabric-kiro-resident-");
    const wrapper = writeWrapper(root);
    await installFake(root, wrapper);
    const steerFile = join(root, "run", "steer.jsonl");
    const logFile = join(root, "resident.log");
    mkdirSync(join(root, "run"), { recursive: true });
    writeFileSync(steerFile, "", { encoding: "utf8", mode: 0o600 });
    process.env.FAKE_KIRO_WORKER_SCENARIO = "resident";
    process.env.FAKE_KIRO_WORKER_LOG = logFile;
    process.env.KIRO_FABRIC_KIRO_IDLE_MS = "700";
    try {
      const options = workerOptions(root, wrapper, { steerFile });
      const run = runKiroWorker(options, helpers);
      await new Promise((resolve) => setTimeout(resolve, 200));
      appendFileSync(
        steerFile,
        `${JSON.stringify({ type: "steer", id: "s1", message: "turn two please", ts: Date.now() })}\n${JSON.stringify({ type: "follow_up", id: "s2", message: "and turn three", ts: Date.now() })}\n`,
        { encoding: "utf8" },
      );
      const record = await run;
      expect(record.status).toBe("completed");
      expect(record.turns).toBe(3);
      expect(record.text).toContain("and turn three");
      const events = readFileSync(options.logFile, "utf8");
      expect(events).toContain("turn two please");
      expect(events).toContain("and turn three");
      expect(record.pendingMessages).toEqual({ steering: [], followUp: [] });
      const methods = inboundMethods(logFile);
      expect(methods.filter((method) => method === "session/prompt").length).toBeGreaterThanOrEqual(3);
      expect(methods.slice(-2)).toEqual(["session/prompt", "session/prompt"]);
    } finally {
      delete process.env.FAKE_KIRO_WORKER_SCENARIO;
      delete process.env.FAKE_KIRO_WORKER_LOG;
      delete process.env.KIRO_FABRIC_KIRO_IDLE_MS;
    }
  });

  it("retains later all-mode messages when an earlier dispatch fails", async () => {
    const root = tempRoot("kiro-fabric-kiro-resident-all-failure-");
    const wrapper = writeWrapper(root);
    await installFake(root, wrapper);
    const steerFile = join(root, "run", "steer.jsonl");
    mkdirSync(join(root, "run"), { recursive: true });
    writeFileSync(steerFile, "", { encoding: "utf8", mode: 0o600 });
    process.env.FAKE_KIRO_WORKER_SCENARIO = "resident-refuse-second";
    process.env.KIRO_FABRIC_KIRO_IDLE_MS = "700";
    try {
      const options = workerOptions(root, wrapper, { steerFile });
      const run = runKiroWorker(options, helpers);
      await new Promise((resolve) => setTimeout(resolve, 200));
      appendFileSync(
        steerFile,
        [
          { type: "set_steering_mode", mode: "all" },
          { type: "steer", message: "fails first" },
          { type: "steer", message: "must remain queued" },
        ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
      );
      const record = await run;
      expect(record.status).toBe("failed");
      expect(record.pendingMessages?.steering).toEqual([
        "fails first",
        "must remain queued",
      ]);
    } finally {
      delete process.env.FAKE_KIRO_WORKER_SCENARIO;
      delete process.env.KIRO_FABRIC_KIRO_IDLE_MS;
    }
  });

  it("logs streamed deltas linearly and throttles status snapshots", async () => {
    const root = tempRoot("kiro-fabric-kiro-chunked-");
    const wrapper = writeWrapper(root);
    await installFake(root, wrapper);
    process.env.FAKE_KIRO_WORKER_SCENARIO = "chunked-stream";
    try {
      const options = workerOptions(root, wrapper);
      const record = await runKiroWorker(options, helpers);
      expect(record.status).toBe("completed");
      expect(record.text).toContain("chunk-0000;");
      expect(record.text).toContain("chunk-0099;");

      const events = readFileSync(options.logFile, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const updates = events.filter((event) => event.type === "message_update");
      expect(updates).toHaveLength(100);
      expect(updates.every((event) => event.delta === true)).toBe(true);
      // Each event carries only the incoming delta — never the cumulative
      // answer — so the log grows linearly rather than quadratically.
      const loggedBytes = updates.reduce(
        (sum, event) =>
          sum + String((event.message as { content?: unknown }).content ?? "").length,
        0,
      );
      expect(loggedBytes).toBe(record.text.length);
      expect(
        updates.every((event) =>
          String((event.message as { content?: unknown }).content).length < 100,
        ),
      ).toBe(true);
      const replayedPartial = projectAgentTranscript(updates);
      expect(replayedPartial.entries).toEqual([
        expect.objectContaining({
          kind: "assistant",
          text: record.text,
          status: "running",
        }),
      ]);
      const statusBytes = readFileSync(options.statusFile, "utf8");
      expect(statusBytes).toContain('"status": "completed"');
    } finally {
      delete process.env.FAKE_KIRO_WORKER_SCENARIO;
    }
  });

  it("settles a resident session after its idle grace", async () => {
    const root = tempRoot("kiro-fabric-kiro-resident-idle-");
    const wrapper = writeWrapper(root);
    await installFake(root, wrapper);
    const steerFile = join(root, "run", "steer.jsonl");
    const logFile = join(root, "resident-idle.log");
    mkdirSync(join(root, "run"), { recursive: true });
    writeFileSync(steerFile, "", { encoding: "utf8", mode: 0o600 });
    process.env.FAKE_KIRO_WORKER_SCENARIO = "resident";
    process.env.FAKE_KIRO_WORKER_LOG = logFile;
    process.env.KIRO_FABRIC_KIRO_IDLE_MS = "150";
    try {
      const record = await runKiroWorker(
        workerOptions(root, wrapper, { steerFile }),
        helpers,
      );
      expect(record.status).toBe("completed");
      expect(record.turns).toBe(1);
      expect(inboundMethods(logFile).filter((method) => method === "session/prompt")).toHaveLength(1);
    } finally {
      delete process.env.FAKE_KIRO_WORKER_SCENARIO;
      delete process.env.FAKE_KIRO_WORKER_LOG;
      delete process.env.KIRO_FABRIC_KIRO_IDLE_MS;
    }
  });

  it("resumes a resident session via session/load", async () => {
    const root = tempRoot("kiro-fabric-kiro-resident-load-");
    const wrapper = writeWrapper(root);
    await installFake(root, wrapper);
    const steerFile = join(root, "run", "steer.jsonl");
    const logFile = join(root, "resident-load.log");
    mkdirSync(join(root, "run"), { recursive: true });
    writeFileSync(steerFile, "", { encoding: "utf8", mode: 0o600 });
    process.env.FAKE_KIRO_WORKER_SCENARIO = "resident-load";
    process.env.FAKE_KIRO_WORKER_LOG = logFile;
    process.env.KIRO_FABRIC_KIRO_IDLE_MS = "600";
    try {
      const options = workerOptions(root, wrapper, {
        ...resumeOptions(root, "saved-session"),
        steerFile,
      });
      const run = runKiroWorker(options, helpers);
      await new Promise((resolve) => setTimeout(resolve, 200));
      appendFileSync(
        steerFile,
        `${JSON.stringify({ type: "steer", id: "s1", message: "turn two please", ts: Date.now() })}\n`,
        { encoding: "utf8" },
      );
      const record = await run;
      expect(record.status).toBe("completed");
      expect(record.runnerSessionId).toBe("saved-session");
      expect(inboundFrames(logFile).map((frame) => frame.method).slice(0, 6)).toEqual([
        "initialize",
        "session/load",
        "session/set_mode",
        "session/set_config_option",
        "session/prompt",
        "session/prompt",
      ]);
    } finally {
      delete process.env.FAKE_KIRO_WORKER_SCENARIO;
      delete process.env.FAKE_KIRO_WORKER_LOG;
      delete process.env.KIRO_FABRIC_KIRO_IDLE_MS;
    }
  });
});

describe("Kiro ACP security", () => {
  it("refuses to load a legacy durable session without a v3 runtime home", async () => {
    const root = tempRoot("kiro-fabric-kiro-legacy-session-");
    const wrapper = writeWrapper(root);
    await installFake(root, wrapper);
    const actorRoot = join(root, "actor");
    mkdirSync(join(actorRoot, "kiro-runtime"), { recursive: true });
    const fixtureLog = join(root, "legacy-session.jsonl");
    process.env.FAKE_KIRO_WORKER_LOG = fixtureLog;
    try {
      const record = await runKiroWorker(workerOptions(root, wrapper, {
        actorId: "actor-1",
        sessionFile: join(actorRoot, "session.jsonl"),
        runnerSessionId: "legacy-v2-session",
      }), helpers);
      expect(record.status).toBe("failed");
      expect(record.error).toMatch(/v2 sessions cannot be resumed by v3/i);
      expect(existsSync(fixtureLog)).toBe(false);
    } finally {
      delete process.env.FAKE_KIRO_WORKER_LOG;
    }
  });

  it("does not expose ambient secrets, credential sockets, CI state, or runtime hooks to the child", async () => {
    const root = tempRoot("kiro-fabric-kiro-environment-");
    const wrapper = writeWrapper(root);
    await installFake(root, wrapper);
    const fixtureLog = join(root, "child-environment.jsonl");
    const inherited = new Map(
      [
        "FAKE_KIRO_WORKER_SCENARIO",
        "FAKE_KIRO_WORKER_LOG",
        "AWS_SECRET_ACCESS_KEY",
        "GITHUB_TOKEN",
        "SSH_AUTH_SOCK",
        "NODE_OPTIONS",
        "CI",
      ].map((name) => [name, process.env[name]]),
    );
    process.env.FAKE_KIRO_WORKER_SCENARIO = "environment";
    process.env.FAKE_KIRO_WORKER_LOG = fixtureLog;
    process.env.AWS_SECRET_ACCESS_KEY = "AWS-SECRET-MUST-NOT-PASS";
    process.env.GITHUB_TOKEN = "GITHUB-TOKEN-MUST-NOT-PASS";
    process.env.SSH_AUTH_SOCK = "/tmp/ambient-agent.sock";
    process.env.NODE_OPTIONS = "--no-warnings";
    process.env.CI = "true";
    try {
      const record = await runKiroWorker(workerOptions(root, wrapper), helpers);
      expect(record.status).toBe("completed");
      const entries = readFileSync(fixtureLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { event?: string; env?: Record<string, string> });
      const childEnvironment = entries.find((entry) => entry.event === "environment")?.env;
      expect(childEnvironment).toMatchObject({
        FAKE_KIRO_WORKER_SCENARIO: "environment",
        FAKE_KIRO_WORKER_LOG: fixtureLog,
        KIRO_HOME: expect.stringContaining(".kiro"),
      });
      expect(childEnvironment).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
      expect(childEnvironment).not.toHaveProperty("GITHUB_TOKEN");
      expect(childEnvironment).not.toHaveProperty("SSH_AUTH_SOCK");
      expect(childEnvironment).not.toHaveProperty("NODE_OPTIONS");
      expect(childEnvironment).not.toHaveProperty("CI");
    } finally {
      for (const [name, value] of inherited) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("writes only redacted metadata for sensitive ACP notifications", async () => {
    const root = tempRoot("kiro-fabric-kiro-evidence-");
    const wrapper = writeWrapper(root);
    await installFake(root, wrapper);
    process.env.FAKE_KIRO_WORKER_SCENARIO = "sensitive-evidence";
    try {
      const options = workerOptions(root, wrapper);
      const record = await runKiroWorker(options, helpers);
      expect(record.status).toBe("completed");
      const retained = readFileSync(options.logFile, "utf8");
      expect(retained).not.toMatch(
        /ACP-PROMPT-MUST|ACP-THOUGHT-MUST|ACP-TOOL-ARGS-MUST|ACP-TOKEN-MUST|ACP-STDERR-MUST|ACP-TOOL-ID-MUST|ACP-TOOL-TITLE-MUST/,
      );
      expect(record.stderr).toMatch(/stderr redacted \(\d+ bytes\)/i);
      const evidence = retained
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((entry) => entry.method === "other");
      expect(evidence).toMatchObject({
        type: "kiro_acp_evidence",
        redacted: true,
        frameKind: "notification",
        method: "other",
        bytes: expect.any(Number),
      });
      expect(evidence).not.toHaveProperty("frame");
      expect(retained).not.toContain("_kiro.dev/sensitive_evidence");
    } finally {
      delete process.env.FAKE_KIRO_WORKER_SCENARIO;
    }
  });

  it("denies a permission spoof that only relabels a hidden tool", async () => {
    const root = tempRoot("kiro-fabric-kiro-spoof-");
    const wrapper = writeWrapper(root);
    await installFake(root, wrapper);
    process.env.FAKE_KIRO_WORKER_SCENARIO = "permission-spoof";
    process.env.FAKE_KIRO_WORKER_LOG = join(root, "spoof.log");
    try {
      const record = await runKiroWorker(workerOptions(root, wrapper), helpers);
      expect(record.status).toBe("failed");
      expect(record.error ?? "").toMatch(/unmanaged tool/);
      expect(readFileSync(join(root, "spoof.log"), "utf8")).toContain("reject-1");
      expect(readFileSync(join(root, "spoof.log"), "utf8")).not.toContain("allow-once-1");
    } finally {
      delete process.env.FAKE_KIRO_WORKER_SCENARIO;
      delete process.env.FAKE_KIRO_WORKER_LOG;
    }
  });

  it("rejects resume without the matching security-profile fingerprint", async () => {
    const root = tempRoot("kiro-fabric-kiro-fingerprint-");
    const wrapper = writeWrapper(root);
    await installFake(root, wrapper);

    const missing = await runKiroWorker(
      workerOptions(root, wrapper, { runnerSessionId: "saved-session" }),
      helpers,
    );
    expect(missing.status).toBe("failed");
    expect(missing.error ?? "").toMatch(/no security-profile fingerprint/);

    const mismatched = await runKiroWorker(
      workerOptions(root, wrapper, {
        runnerSessionId: "saved-session",
        kiroSessionProfileSha256: "0".repeat(64),
      }),
      helpers,
    );
    expect(mismatched.status).toBe("failed");
    expect(mismatched.error ?? "").toMatch(/different agent profile or security configuration/);
  });

  it("rejects session/load identity switches and pre-handshake spoofed text", async () => {
    const root = tempRoot("kiro-fabric-kiro-switch-");
    const wrapper = writeWrapper(root);
    await installFake(root, wrapper);
    process.env.FAKE_KIRO_WORKER_SCENARIO = "load-switch";
    try {
      const switched = await runKiroWorker(
        workerOptions(root, wrapper, resumeOptions(root, "saved-A")),
        helpers,
      );
      expect(switched.status).toBe("failed");
      expect(switched.error ?? "").toMatch(/different sessionId/);
      expect(switched.text).toBe("");
    } finally {
      delete process.env.FAKE_KIRO_WORKER_SCENARIO;
    }

    process.env.FAKE_KIRO_WORKER_SCENARIO = "handshake-spoof";
    try {
      const spoofed = await runKiroWorker(workerOptions(root, wrapper), helpers);
      expect(spoofed.status).toBe("failed");
      expect(spoofed.text).not.toContain("spoofed-before-handshake");
    } finally {
      delete process.env.FAKE_KIRO_WORKER_SCENARIO;
    }
  });

  it("discards late text and fails a result+malformed chunk", async () => {
    const root = tempRoot("kiro-fabric-kiro-late-");
    const wrapper = writeWrapper(root);
    await installFake(root, wrapper);
    process.env.FAKE_KIRO_WORKER_SCENARIO = "late-text";
    try {
      const late = await runKiroWorker(workerOptions(root, wrapper), helpers);
      expect(late.status).toBe("completed");
      expect(late.text).not.toContain("LATE");
    } finally {
      delete process.env.FAKE_KIRO_WORKER_SCENARIO;
    }

    process.env.FAKE_KIRO_WORKER_SCENARIO = "late-malformed";
    try {
      const malformed = await runKiroWorker(workerOptions(root, wrapper), helpers);
      expect(malformed.status).toBe("failed");
      expect(malformed.error ?? "").toMatch(/malformed JSON/);
    } finally {
      delete process.env.FAKE_KIRO_WORKER_SCENARIO;
    }

    process.env.FAKE_KIRO_WORKER_SCENARIO = "oversized";
    try {
      const oversized = await runKiroWorker(workerOptions(root, wrapper), helpers);
      expect(oversized.status).toBe("failed");
      expect(oversized.error ?? "").toMatch(/oversized|malformed/);
    } finally {
      delete process.env.FAKE_KIRO_WORKER_SCENARIO;
    }
  });
});

describe("parseWorkerOptions kiro binary", () => {
  it("requires --kiro-binary", () => {
    expect(
      parseWorkerOptions([
        "node",
        "worker.js",
        "--id",
        "run1",
        "--name",
        "test",
        "--runner",
        "kiro",
        "--task-file",
        "/tmp/task.txt",
        "--status-file",
        "/tmp/status.json",
        "--lifecycle-file",
        "/tmp/lifecycle.jsonl",
        "--log-file",
        "/tmp/events.jsonl",
        "--cwd",
        "/tmp",
        "--pi-binary",
        "pi",
        "--claude-binary",
        "claude",
        "--veda-binary",
        "veda",
        "--veda-backend",
        "agy",
        "--veda-persona",
        "navigator-chat",
        "--timeout-ms",
        "1000",
        "--depth",
        "1",
        "--full-code-mode",
        "false",
        "--extensions",
        "false",
        "--tools",
        "[]",
        "--granted-risks",
        "[]",
        "--transport",
        "process",
        "--kiro-binary",
        "/bin/kiro-cli",
      ]).kiroBinary,
    ).toBe("/bin/kiro-cli");
    expect(() =>
      parseWorkerOptions([
        "node",
        "worker.js",
        "--id",
        "run1",
        "--name",
        "test",
        "--runner",
        "pi",
        "--task-file",
        "/tmp/task.txt",
        "--status-file",
        "/tmp/status.json",
        "--lifecycle-file",
        "/tmp/lifecycle.jsonl",
        "--log-file",
        "/tmp/events.jsonl",
        "--cwd",
        "/tmp",
        "--pi-binary",
        "pi",
        "--claude-binary",
        "claude",
        "--veda-binary",
        "veda",
        "--veda-backend",
        "agy",
        "--veda-persona",
        "navigator-chat",
        "--timeout-ms",
        "1000",
        "--depth",
        "1",
        "--full-code-mode",
        "false",
        "--extensions",
        "false",
        "--tools",
        "[]",
        "--granted-risks",
        "[]",
        "--transport",
        "process",
      ]),
    ).toThrow(/Missing worker argument: --kiro-binary/);
  });
});
