// Setup console tests for src/kiro/setup.ts. All Kiro subprocess calls go
// through the fake non-billable binary (tests/fixtures/kiro/fake-kiro.mjs) via
// --kiro-binary / PATH shims, and installs run against isolated temp
// KIRO_HOME / KIRO_FABRIC_MCP_ENTRY overrides so the real ~/.kiro is untouched.
// runKiroSetup(argv) mirrors runKiroCli(argv): it resolves to the process exit
// code and writes output through process.stdout.write / process.stderr.write.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runKiroSetup } from "../src/kiro/setup.js";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const fakeKiro = join(repoRoot, "tests", "fixtures", "kiro", "fake-kiro.mjs");
const mcpEntry = join(repoRoot, "dist", "kiro", "mcp-entry.js");

// POSIX sh fixtures and PATH shims are Linux/macOS-only; be explicit.
const itPosix = process.platform === "win32" ? it.skip : it;

interface SetupRun {
  code: number;
  stdout: string;
  stderr: string;
}

const runSetup = async (argv: string[]): Promise<SetupRun> => {
  const out: string[] = [];
  const err: string[] = [];
  const outSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
  const errSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(((chunk: unknown) => {
      err.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
  try {
    const code = await runKiroSetup(argv);
    return { code, stdout: out.join(""), stderr: err.join("") };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
};

const parseJsonStdout = (stdout: string): Record<string, unknown> =>
  JSON.parse(stdout.trim()) as Record<string, unknown>;

let base: string;
const roots: string[] = [];

const project = (name: string): string => {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  return dir;
};

/** Executable sh wrapper that runs the shared fake-kiro.mjs fixture. */
const writeFakeKiroWrapper = (path: string): string => {
  writeFileSync(
    path,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeKiro)} "$@"\n`,
    { mode: 0o755 },
  );
  chmodSync(path, 0o755);
  return path;
};

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "kiro-fabric-setup-test-"));
  roots.push(base);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("runKiroSetup usage", () => {
  itPosix("exits 2 with usage guidance for an unknown command", async () => {
    const run = await runSetup(["frobnicate"]);
    expect(run.code).toBe(2);
    expect(`${run.stderr}\n${run.stdout}`).toMatch(/usage/i);
  });

  itPosix("exits 2 for a bare invocation when stdin/stdout are not TTYs", async () => {
    // Vitest pipes stdio, so the numbered interactive menu must not appear.
    const run = await runSetup([]);
    expect(run.code).toBe(2);
    expect(`${run.stderr}\n${run.stdout}`).toMatch(/usage/i);
    expect(`${run.stderr}\n${run.stdout}`).not.toMatch(/\n\s*1\)/);
  });
});

describe("runKiroSetup status --json", () => {
  itPosix("reports node plus empty per-scope state in an isolated home", async () => {
    const home = project("status-home");
    const root = project("status-project");
    vi.stubEnv("HOME", home);
    vi.stubEnv("KIRO_HOME", join(home, "absent"));
    const run = await runSetup(["status", "--json", "--project-root", root]);
    expect(run.code).toBe(0);
    const parsed = parseJsonStdout(run.stdout);
    expect(Object.keys(parsed)).toEqual(
      expect.arrayContaining(["node", "kiro", "scopes"]),
    );
    expect(parsed.node).toMatchObject({
      version: expect.stringMatching(/^v?\d+\./),
      ok: true,
    });
    expect(parsed.kiro).toMatchObject({ state: expect.any(String) });
    expect(parsed.scopes).toMatchObject({
      user: { installed: false },
      project: { installed: false },
    });
  });

  itPosix("classifies a missing kiro-cli as not-found with empty PATH", async () => {
    const home = project("status-notfound-home");
    const root = project("status-notfound-project");
    vi.stubEnv("HOME", home);
    vi.stubEnv("KIRO_HOME", join(home, "absent"));
    vi.stubEnv("PATH", "");
    const run = await runSetup(["status", "--json", "--project-root", root]);
    expect(run.code).toBe(0);
    const parsed = parseJsonStdout(run.stdout);
    expect(parsed.kiro).toMatchObject({ state: "not-found" });
  });

  itPosix("classifies an unparsable multi-token version as unparsable", async () => {
    const home = project("status-unparsable-home");
    const root = project("status-unparsable-project");
    const bin = project("status-bin");
    writeFileSync(join(bin, "kiro-cli"), '#!/bin/sh\necho "1.2 3.4"\n', {
      mode: 0o755,
    });
    vi.stubEnv("HOME", home);
    vi.stubEnv("KIRO_HOME", join(home, "absent"));
    vi.stubEnv("PATH", bin);
    const run = await runSetup(["status", "--json", "--project-root", root]);
    expect(run.code).toBe(0);
    const parsed = parseJsonStdout(run.stdout);
    expect(parsed.kiro).toMatchObject({ state: "unparsable" });
  });
});

describe("runKiroSetup install --user --json", () => {
  itPosix("installs the user-scope profile into the isolated kiro home", async () => {
    const root = project("install-project");
    const home = project("install-home");
    const wrapper = writeFakeKiroWrapper(join(base, "fake-kiro"));
    vi.stubEnv("KIRO_FABRIC_MCP_ENTRY", mcpEntry);
    const run = await runSetup([
      "install",
      "--user",
      "--json",
      "--project-root",
      root,
      "--kiro-home",
      home,
      "--kiro-binary",
      wrapper,
    ]);
    expect(run.code).toBe(0);
    const parsed = parseJsonStdout(run.stdout);
    expect(parsed).toMatchObject({ ok: true, action: "create" });
    const homeRoot = realpathSync(home);
    expect(existsSync(join(homeRoot, "agents", "kiro-fabric.json"))).toBe(true);
    expect(existsSync(join(root, ".kiro"))).toBe(false);
    const profile = JSON.parse(
      readFileSync(join(homeRoot, "agents", "kiro-fabric.json"), "utf8"),
    ) as { mcpServers: { fabric: { env: Record<string, string> } } };
    expect(profile.mcpServers.fabric.env.KIRO_FABRIC_PROJECT_ROOT).toBe(
      realpathSync(root),
    );
  });
});

describe("runKiroSetup update", () => {
  itPosix("fails with exit 1 when no managed installation exists", async () => {
    const root = project("update-project");
    const home = project("update-home");
    const wrapper = writeFakeKiroWrapper(join(base, "fake-kiro"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("KIRO_HOME", home);
    const run = await runSetup([
      "update",
      "--user",
      "--project-root",
      root,
      "--kiro-home",
      home,
      "--kiro-binary",
      wrapper,
    ]);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/no managed installation to update/i);
  });
});

describe("runKiroSetup uninstall --user --json", () => {
  itPosix("is a noop exit 0 when nothing is installed", async () => {
    const root = project("uninstall-project");
    const home = project("uninstall-home");
    const run = await runSetup([
      "uninstall",
      "--user",
      "--json",
      "--project-root",
      root,
      "--kiro-home",
      home,
    ]);
    expect(run.code).toBe(0);
    const parsed = parseJsonStdout(run.stdout);
    expect(parsed).toMatchObject({ ok: true, action: "noop" });
    expect(
      existsSync(join(realpathSync(home), "agents", "kiro-fabric.json")),
    ).toBe(false);
  });
});

describe("runKiroSetup launch", () => {
  itPosix("spawns kiro-cli with the v3 agent argv and the project cwd", async () => {
    const root = project("launch-project");
    const home = project("launch-home");
    const log = join(base, "launch-args.txt");
    const bin = project("launch-bin");
    writeFileSync(
      join(bin, "kiro-cli"),
      [
        "#!/bin/sh",
        'if [ "$1" != "--version" ]; then',
        '  printf "%s\\n" "$*" >> "$KIRO_SETUP_LAUNCH_LOG"',
        '  pwd >> "$KIRO_SETUP_LAUNCH_LOG"',
        "fi",
        "exit 0",
      ].join("\n") + "\n",
      { mode: 0o755 },
    );
    vi.stubEnv("HOME", home);
    vi.stubEnv("KIRO_HOME", home);
    vi.stubEnv("PATH", bin);
    vi.stubEnv("KIRO_SETUP_LAUNCH_LOG", log);
    // --json is accepted for a uniform flag surface; the launch contract is
    // the spawned argv and cwd, which the fake records for assertion.
    const run = await runSetup(["launch", "--json", "--project-root", root]);
    expect(run.code).toBe(0);
    const lines = readFileSync(log, "utf8").trim().split("\n");
    expect(lines[0]?.split(/\s+/)).toEqual(["--v3", "--agent", "kiro-fabric"]);
    expect(lines[1]).toBe(realpathSync(root));
  });

  // The timeout detection class and the interactive-cancel exit 130 path are
  // not asserted here: the former is too slow for a unit suite, the latter
  // requires a real interactive TTY session.
});
