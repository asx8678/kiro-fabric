// Setup console tests for src/kiro/setup.ts. All Kiro subprocess calls go
// through the fake non-billable binary (tests/fixtures/kiro/fake-kiro.mjs) via
// --kiro-binary / PATH shims, and installs run against isolated temp
// KIRO_HOME / KIRO_FABRIC_MCP_ENTRY overrides so the real ~/.kiro is untouched.
// runKiroSetup(argv) mirrors runKiroCli(argv): it resolves to the process exit
// code and writes output through process.stdout.write / process.stderr.write.

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runKiroSetup, runMenuAction } from "../src/kiro/setup.js";
import { withPrivateKiroLauncherFixtures } from "../src/kiro/compatibility-test-seam.js";
import {
  managedFileTransition,
  sha256Bytes,
  writeManagedTransactionJournal,
} from "../src/kiro/managed.js";

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
    const fixtures: string[] = [];
    const visit = (directory: string): void => {
      if (!existsSync(directory)) return;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (entry.isFile()) {
          try {
            if (readFileSync(path).subarray(0, 2).toString() === "#!") fixtures.push(path);
          } catch { /* sealed or concurrently absent fixture */ }
        }
      }
    };
    if (typeof base === "string") visit(base);
    const invoke = () => runKiroSetup(argv);
    const code = fixtures.length > 0
      ? await withPrivateKiroLauncherFixtures(fixtures, invoke)
      : await invoke();
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

const makeRemovable = (dir: string): void => {
  if (!existsSync(dir)) return;
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return;
  chmodSync(dir, 0o700);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) makeRemovable(join(dir, entry.name));
  }
};

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "kiro-fabric-setup-test-"));
  roots.push(base);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    makeRemovable(root);
    rmSync(root, { recursive: true, force: true });
  }
});

describe("source installer bootstrap", () => {
  const installer = join(repoRoot, "scripts", "install-kiro-fabric.sh");

  const runInstaller = (
    entry: string,
    args: string[] = [],
    env: NodeJS.ProcessEnv = {},
  ) =>
    spawnSync("sh", [installer, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        KIRO_FABRIC_SETUP_ENTRY: entry,
        KIRO_FABRIC_AUTO_BUILD: "0",
        KIRO_HOME: join(base, "user-kiro"),
        ...env,
      },
    });

  const writeArgRecorder = (): string => {
    const entry = join(base, "fake-setup.mjs");
    writeFileSync(
      entry,
      'process.stdout.write(JSON.stringify(process.argv.slice(2)) + "\\n");\n',
    );
    return entry;
  };

  itPosix("turns a bare invocation into an approval-gated user install", () => {
    const run = runInstaller(writeArgRecorder());
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout.trim())).toEqual([
      "install",
      "--user",
      "--project-root",
      repoRoot,
    ]);
  });

  itPosix("forces user scope while preserving only explicit tool approval", () => {
    const entry = writeArgRecorder();
    const added = runInstaller(entry, ["install", "--dry-run"]);
    const preserved = runInstaller(entry, [
      "update",
      "--user",
      "--allow-tools",
      "--dry-run",
    ]);
    const repair = runInstaller(entry, ["repair", "--dry-run"]);
    const doctor = runInstaller(entry, ["doctor", "--json"]);
    const uninstall = runInstaller(entry, ["uninstall", "--dry-run"]);
    expect(added.status).toBe(0);
    expect(JSON.parse(added.stdout.trim())).toEqual([
      "install",
      "--dry-run",
      "--user",
      "--project-root",
      repoRoot,
    ]);
    expect(preserved.status).toBe(0);
    expect(JSON.parse(preserved.stdout.trim())).toEqual([
      "update",
      "--user",
      "--allow-tools",
      "--dry-run",
      "--project-root",
      repoRoot,
    ]);
    expect(repair.status).toBe(0);
    expect(JSON.parse(repair.stdout.trim())).toEqual([
      "repair",
      "--dry-run",
      "--user",
      "--project-root",
      repoRoot,
    ]);
    expect(doctor.status).toBe(0);
    expect(JSON.parse(doctor.stdout.trim())).toEqual([
      "doctor",
      "--json",
      "--user",
      "--project-root",
      repoRoot,
    ]);
    expect(uninstall.status).toBe(0);
    expect(JSON.parse(uninstall.stdout.trim())).toEqual([
      "uninstall",
      "--dry-run",
      "--user",
      "--project-root",
      repoRoot,
    ]);
  });

  itPosix("defaults sessions to the checkout and preserves an explicit project root", () => {
    const entry = writeArgRecorder();
    const launch = runInstaller(entry, ["launch"]);
    const explicit = runInstaller(entry, ["status", "--json", "--project-root", base]);
    expect(launch.status).toBe(0);
    expect(JSON.parse(launch.stdout.trim())).toEqual([
      "launch",
      "--project-root",
      repoRoot,
    ]);
    expect(explicit.status).toBe(0);
    expect(JSON.parse(explicit.stdout.trim())).toEqual([
      "status",
      "--json",
      "--project-root",
      base,
    ]);
    expect(`${launch.stdout}${launch.stderr}${explicit.stdout}${explicit.stderr}`).not.toContain(
      "\u001b[",
    );
  });

  itPosix("accepts a dotless future Node major version", () => {
    const entry = writeArgRecorder();
    const bin = project("dotless-node-bin");
    writeFileSync(
      join(bin, "node"),
      [
        "#!/bin/sh",
        "if [ \"$1\" = \"--version\" ]; then echo v25; exit 0; fi",
        "exec \"$REAL_NODE\" \"$@\"",
      ].join("\n") + "\n",
      { mode: 0o755 },
    );
    const run = spawnSync("sh", [installer, "status", "--json"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        REAL_NODE: process.execPath,
        KIRO_FABRIC_SETUP_ENTRY: entry,
        KIRO_FABRIC_AUTO_BUILD: "0",
      },
    });
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout.trim())[0]).toBe("status");
  });
  itPosix("does not prepare a missing build before non-interactive consent", () => {
    const missing = join(base, "missing-setup.mjs");
    const bin = project("unconfirmed-build-bin");
    const marker = join(base, "unexpected-pnpm-call");
    writeFileSync(
      join(bin, "pnpm"),
      "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$PREPARE_MARKER\"\n",
      { mode: 0o755 },
    );

    const run = runInstaller(missing, ["install", "--dry-run"], {
      KIRO_FABRIC_AUTO_BUILD: "",
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      PREPARE_MARKER: marker,
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/source preparation requires consent/i);
    expect(existsSync(marker)).toBe(false);
  });

  itPosix("uses --yes as explicit consent for source preparation", () => {
    const missing = join(base, "approved-setup.mjs");
    const bin = project("confirmed-build-bin");
    const marker = join(base, "pnpm-calls");
    writeFileSync(
      join(bin, "pnpm"),
      [
        "#!/bin/sh",
        "if [ \"$1\" = --version ]; then printf '%s\\n' '11.20.0'; exit 0; fi",
        "printf '%s\\n' \"$*\" >> \"$PREPARE_MARKER\"",
        "if [ \"$1\" = run ] && [ \"$2\" = build ]; then",
        "  printf '%s\\n' 'process.stdout.write(JSON.stringify(process.argv.slice(2)));' > \"$ENTRY_TARGET\"",
        "fi",
      ].join("\n") + "\n",
      { mode: 0o755 },
    );

    const run = runInstaller(missing, ["install", "--dry-run", "--yes"], {
      ENTRY_TARGET: missing,
      KIRO_FABRIC_AUTO_BUILD: "",
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      PREPARE_MARKER: marker,
    });

    expect(run.status).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("install --frozen-lockfile\nrun build\n");
    expect(JSON.parse(run.stdout.trim())).toEqual([
      "install",
      "--dry-run",
      "--yes",
      "--user",
      "--project-root",
      repoRoot,
    ]);
  });

  itPosix("rejects an unpinned pnpm before installing dependencies", () => {
    const missing = join(base, "missing-setup.mjs");
    const bin = project("wrong-pnpm-bin");
    const marker = join(base, "pnpm-calls");
    writeFileSync(
      join(bin, "pnpm"),
      "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 10.0.0; else printf '%s\\n' \"$*\" >> \"$PREPARE_MARKER\"; fi\n",
      { mode: 0o755 },
    );

    const run = runInstaller(missing, ["install", "--dry-run", "--yes"], {
      KIRO_FABRIC_AUTO_BUILD: "",
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      PREPARE_MARKER: marker,
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("requires pnpm 11.20.0");
    expect(existsSync(marker)).toBe(false);
  });

  itPosix("gives an actionable error when automatic builds are disabled", () => {
    const missing = join(base, "missing-setup.mjs");
    const run = spawnSync("sh", [installer], {
      encoding: "utf8",
      env: {
        ...process.env,
        KIRO_FABRIC_SETUP_ENTRY: missing,
        KIRO_FABRIC_AUTO_BUILD: "0",
      },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("setup entry not found");
    expect(run.stderr).toContain("pnpm install && pnpm run build");
  });
});

describe("runKiroSetup usage", () => {
  it("propagates ordinary nonzero interactive action exits", async () => {
    await expect(runMenuAction(async () => 37)).resolves.toBe(37);
  });

  itPosix("exits 2 with usage guidance for an unknown command", async () => {
    const run = await runSetup(["frobnicate"]);
    expect(run.code).toBe(2);
    expect(`${run.stderr}\n${run.stdout}`).toMatch(/usage/i);
  });

  itPosix("emits exactly one structured object for every --json usage failure", async () => {
    const run = await runSetup(["frobnicate", "--json"]);
    expect(run.code).toBe(2);
    expect(run.stderr).toBe("");
    expect(parseJsonStdout(run.stdout)).toMatchObject({
      ok: false,
      error: { code: "usage", message: expect.stringMatching(/unknown command/) },
    });
    expect(run.stdout.trim().split("\n").filter((line) => line.trim() === "{")).toHaveLength(1);
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
  itPosix("refuses a noninteractive install without --yes", async () => {
    const root = project("unconfirmed-project");
    const home = project("unconfirmed-home");
    const run = await runSetup([
      "install",
      "--user",
      "--project-root",
      root,
      "--kiro-home",
      home,
    ]);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/refusing.*without a terminal.*--yes/i);
    expect(existsSync(join(home, "agents", "kiro-fabric.json"))).toBe(false);
  });

  itPosix("installs an exact auto-approved user profile into the isolated Kiro home", async () => {
    const root = project("install-project");
    const home = project("install-home");
    const wrapper = writeFakeKiroWrapper(join(base, "fake-kiro"));
    vi.stubEnv("KIRO_FABRIC_MCP_ENTRY", mcpEntry);
    const run = await runSetup([
      "install",
      "--user",
      "--allow-tools",
      "--yes",
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
    ) as {
      mcpServers: { fabric: { env: Record<string, string> } };
      permissions: {
        rules: Array<{ capability: string; match: string[]; effect: string }>;
      };
    };
    expect(profile.mcpServers.fabric.env.KIRO_FABRIC_PROJECT_ROOT).toBe(
      realpathSync(root),
    );
    expect(profile.mcpServers.fabric.env.KIRO_FABRIC_ALLOW_TOOLS).toBe("1");
    expect(profile.permissions.rules).toEqual([
      { capability: "mcp", match: ["fabric/fabric_exec"], effect: "allow" },
    ]);
  });
});

describe("runKiroSetup update", () => {
  itPosix("fails with one JSON object when no managed installation exists", async () => {
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
      "--json",
    ]);
    expect(run.code).toBe(1);
    expect(run.stderr).toBe("");
    expect(parseJsonStdout(run.stdout)).toMatchObject({
      ok: false,
      error: { code: "manifest", message: expect.stringMatching(/no managed installation to update/i) },
    });
  });

  itPosix("preserves advanced grants and reports explicit revoke/reset diffs", async () => {
    const root = project("grant-update-project");
    const home = project("grant-update-home");
    const wrapper = writeFakeKiroWrapper(join(base, "fake-kiro-grants"));
    vi.stubEnv("KIRO_FABRIC_MCP_ENTRY", mcpEntry);
    const common = [
      "--user", "--project-root", root, "--kiro-home", home,
      "--kiro-binary", wrapper, "--yes", "--json",
    ];
    const installed = await runSetup(["install", "--allow-shell", "--allow-tools", ...common]);
    expect(installed.code).toBe(0);
    const updated = await runSetup(["update", ...common]);
    expect(updated.code).toBe(0);
    expect(parseJsonStdout(updated.stdout).grants).toEqual({
      before: { allowShell: true, enableSubagents: false, allowTools: true },
      after: { allowShell: true, enableSubagents: false, allowTools: true },
      changed: [],
    });

    const revoked = await runSetup(["repair", "--revoke-tools", ...common]);
    expect(revoked.code).toBe(0);
    expect(parseJsonStdout(revoked.stdout).grants).toEqual({
      before: { allowShell: true, enableSubagents: false, allowTools: true },
      after: { allowShell: true, enableSubagents: false, allowTools: false },
      changed: ["allowTools"],
    });

    const reset = await runSetup(["update", "--reset-grants", ...common]);
    expect(reset.code).toBe(0);
    expect(parseJsonStdout(reset.stdout).grants).toEqual({
      before: { allowShell: true, enableSubagents: false, allowTools: false },
      after: { allowShell: false, enableSubagents: false, allowTools: false },
      changed: ["allowShell"],
    });
  }, 120_000);

  itPosix("recovers an interrupted transaction under lock before preserving grants", async () => {
    const root = project("grant-recovery-project");
    const home = project("grant-recovery-home");
    const wrapper = writeFakeKiroWrapper(join(base, "fake-kiro-grant-recovery"));
    const common = [
      "--user", "--project-root", root, "--kiro-home", home,
      "--kiro-binary", wrapper, "--yes", "--json",
    ];
    expect((await runSetup(["install", ...common])).code).toBe(0);

    const canonicalHome = realpathSync(home);
    const profilePath = join(canonicalHome, "agents", "kiro-fabric.json");
    const manifestPath = join(canonicalHome, ".kiro-fabric", "install.json");
    const profileBefore = readFileSync(profilePath);
    const manifestBefore = readFileSync(manifestPath);
    const profile = JSON.parse(profileBefore.toString("utf8"));
    profile.mcpServers.fabric.env.KIRO_FABRIC_ALLOW_SHELL = "1";
    const profileAfter = JSON.stringify(profile, null, 2) + "\n";
    const manifest = JSON.parse(manifestBefore.toString("utf8"));
    manifest.profile.installedSha256 = sha256Bytes(profileAfter);
    manifest.grants = { allowShell: true, enableSubagents: false, allowTools: false };
    const manifestAfter = JSON.stringify(manifest, null, 2) + "\n";
    writeManagedTransactionJournal(canonicalHome, "user", {
      format: 2,
      owner: "kiro-fabric",
      operation: "install",
      layout: "user",
      root: canonicalHome,
      createdAt: Date.now(),
      files: [
        { path: "agents/kiro-fabric.json", transition: managedFileTransition(sha256Bytes(profileBefore), profileAfter) },
        { path: ".kiro-fabric/install.json", transition: managedFileTransition(sha256Bytes(manifestBefore), manifestAfter) },
      ],
    });

    const unconfirmed = await runSetup(["update", ...common.filter((value) => value !== "--yes")]);
    expect(unconfirmed.code).toBe(1);
    expect(unconfirmed.stdout).toMatch(/refusing to recover and update/);
    expect(existsSync(join(canonicalHome, ".kiro-fabric", "transaction.json"))).toBe(true);
    expect(readFileSync(profilePath)).toEqual(profileBefore);
    expect(readFileSync(manifestPath)).toEqual(manifestBefore);

    const dryRun = await runSetup(["update", "--dry-run", ...common]);
    expect(dryRun.code).toBe(1);
    expect(dryRun.stdout).toMatch(/dry-run left it unchanged/);
    expect(existsSync(join(canonicalHome, ".kiro-fabric", "transaction.json"))).toBe(true);
    expect(readFileSync(profilePath)).toEqual(profileBefore);
    expect(readFileSync(manifestPath)).toEqual(manifestBefore);

    const updated = await runSetup(["update", ...common]);
    expect(updated.code).toBe(0);
    expect(parseJsonStdout(updated.stdout).grants).toMatchObject({
      before: { allowShell: true, enableSubagents: false, allowTools: false },
      after: { allowShell: true, enableSubagents: false, allowTools: false },
    });
    expect(existsSync(join(canonicalHome, ".kiro-fabric", "transaction.json"))).toBe(false);
  }, 120_000);
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
        'if [ "$1" = "--version" ]; then echo "kiro-cli 2.20.1"; exit 0; fi',
        'if [ "$1" = "acp" ] && [ "$2" = "--help" ]; then echo "--agent-engine v3 --auth-method cli"; exit 0; fi',
        'if [ "$1" = "agent" ] && [ "$2" = "validate" ]; then exit 0; fi',
        'printf "%s\\n" "$*" >> "$KIRO_SETUP_LAUNCH_LOG"',
        'pwd >> "$KIRO_SETUP_LAUNCH_LOG"',
        "exit 0",
      ].join("\n") + "\n",
      { mode: 0o755 },
    );
    vi.stubEnv("HOME", home);
    vi.stubEnv("KIRO_HOME", home);
    vi.stubEnv("PATH", bin);
    vi.stubEnv("KIRO_SETUP_LAUNCH_LOG", log);
    const installed = await runSetup([
      "install", "--yes", "--project-root", root,
      "--kiro-binary", join(bin, "kiro-cli"), "--json",
    ]);
    expect(installed.code).toBe(0);
    const run = await runSetup(["launch", "--project-root", root]);
    expect(run.code).toBe(0);
    const lines = readFileSync(log, "utf8").trim().split("\n");
    expect(lines[0]?.split(/\s+/)).toEqual(["--v3", "--agent", "kiro-fabric"]);
    expect(lines[1]).toBe(realpathSync(root));
  });

  itPosix("rejects legacy managed launch and installed doctor with update guidance", async () => {
    const root = project("legacy-managed-selection");
    const wrapper = writeFakeKiroWrapper(join(base, "fake-kiro-legacy-selection"));
    const installed = await runSetup([
      "install", "--yes", "--json", "--project-root", root, "--kiro-binary", wrapper,
    ]);
    expect(installed.code).toBe(0);
    const manifestPath = join(root, ".kiro", ".kiro-fabric", "install.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.format = 2;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });

    const launch = await runSetup(["launch", "--project-root", root]);
    expect(launch.code).toBe(1);
    expect(launch.stderr).toMatch(/legacy format-2.*update.*repair/i);

    const doctor = await runSetup(["doctor", "--project-root", root, "--json"]);
    expect(doctor.code).toBe(1);
    const report = parseJsonStdout(doctor.stdout) as { checks: Array<{ id: string; message: string }> };
    expect(report.checks.find((check) => check.id === "install.manifest")?.message)
      .toMatch(/legacy format-2.*update.*repair/i);
  }, 120_000);

  itPosix("refuses an unhealthy project install instead of falling back to a healthy user install", async () => {
    const root = project("launch-unhealthy-project");
    const home = project("launch-healthy-user-home");
    const wrapper = writeFakeKiroWrapper(join(base, "fake-kiro-launch-fallback"));
    const installed = await runSetup([
      "install", "--user", "--yes", "--json", "--project-root", root,
      "--kiro-home", home, "--kiro-binary", wrapper,
    ]);
    expect(installed.code).toBe(0);
    const projectManifest = join(root, ".kiro", ".kiro-fabric", "install.json");
    mkdirSync(join(root, ".kiro", ".kiro-fabric"), { recursive: true });
    writeFileSync(projectManifest, "{ malformed\n", { mode: 0o600 });

    const run = await runSetup(["launch", "--project-root", root]);
    expect(run.code).toBe(1);
    expect(run.stderr).toMatch(/selected project installation is unhealthy/i);
  }, 120_000);

  it("rejects contradictory grant changes during argument parsing", async () => {
    const subagents = await runSetup(["update", "--subagents", "--revoke-shell", "--yes"]);
    expect(subagents.code).toBe(2);
    expect(subagents.stderr).toContain("--subagents conflicts with --revoke-shell");

    const reset = await runSetup(["repair", "--reset-grants", "--revoke-tools", "--yes"]);
    expect(reset.code).toBe(2);
    expect(reset.stderr).toContain("--reset-grants conflicts with other grant-changing flags");
  });

  // Timeout detection and real TTY SIGINT cancellation require process-level
  // fixtures; direct confirmation cancellation is covered by the exit-code path.
});
