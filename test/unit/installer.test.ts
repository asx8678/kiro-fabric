import { expect, it } from "vitest";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { installKiro, validateInstalled, verifyPromptManifest } from "../../src/installer.js";
import { loadPrompt } from "../../src/prompts.js";

it("writes portable PATH-based executable config, not a machine absolute path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-install-portable-"));
  const previousPath = process.env.PATH;
  try {
    // Shadow kiro-cli on PATH so the installer resolves it through PATH for
    // install-time validation while persisting the portable command name.
    const bin = path.join(root, "bin");
    await mkdir(bin, { recursive: true });
    const executable = path.join(bin, "kiro-cli");
    await writeFile(executable, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo kiro-test; fi\nexit 0\n");
    await chmod(executable, 0o755);
    process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`;
    const result = await installKiro({ root, cliPath: "dist/cli/main.js", executable: "kiro-cli", force: false, dryRun: false });
    const config = JSON.parse(await readFile(path.join(root, ".fabric-lite/config.json"), "utf8")) as { runner: { executable: string } };
    expect(config.runner.executable).toBe("kiro-cli");
    expect(config.runner.executable).not.toMatch(/^\//);
    expect(result.launch).toBe("kiro-cli --agent fabric-lite");
    // Resolved absolute path is used only for install-time validation.
    expect(result.kiroVersion).toBe("kiro-test");
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await rm(root, { recursive: true, force: true });
  }
});

it("dry-run previews existing conflicts without overwriting", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-install-"));
  try {
    const executable = path.join(root, "fake-kiro");
    await writeFile(executable, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo kiro-test; exit 0; fi\nexit 0\n");
    await chmod(executable, 0o755);
    await mkdir(path.join(root, ".fabric-lite"));
    const configPath = path.join(root, ".fabric-lite/config.json");
    await writeFile(configPath, "existing\n");
    const result = await installKiro({ root, cliPath: "dist/cli/main.js", executable, force: false, dryRun: true });
    expect(result.kept).toContain(configPath);
    expect(result.conflicts).not.toContain(configPath);
    expect(await import("node:fs/promises").then(fs => fs.readFile(configPath, "utf8"))).toBe("existing\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("creates editable config by default and read-only config with --allow-write read", async () => {
  const readRoot = await mkdtemp(path.join(tmpdir(), "fabric-install-read-"));
  const editRoot = await mkdtemp(path.join(tmpdir(), "fabric-install-edit-"));
  const home = await mkdtemp(path.join(tmpdir(), "fabric-install-wa-home-"));
  try {
    const makeKiro = async (root: string) => {
      const executable = path.join(root, "fake-kiro");
      await writeFile(executable, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo kiro-test; fi\nexit 0\n");
      await chmod(executable, 0o755);
      return executable;
    };
    const readExe = await makeKiro(readRoot);
    const editExe = await makeKiro(editRoot);

    // Explicit read-only mode never grants writes.
    await installKiro({ root: readRoot, home, cliPath: "dist/cli/main.js", executable: readExe, force: false, dryRun: false, writeAccess: "read" });
    const readConfig = JSON.parse(await readFile(path.join(readRoot, ".fabric-lite/config.json"), "utf8")) as { mutation: { enabled: boolean }; filesystem: { allowWrite: string[] } };
    expect(readConfig.mutation.enabled).toBe(false);
    expect(readConfig.filesystem.allowWrite).toEqual([]);

    // Default: mutation enabled with a workspace-wide allowlist.
    await installKiro({ root: editRoot, home, cliPath: "dist/cli/main.js", executable: editExe, force: false, dryRun: false });
    const editConfig = JSON.parse(await readFile(path.join(editRoot, ".fabric-lite/config.json"), "utf8")) as { mutation: { enabled: boolean }; filesystem: { allowWrite: string[] } };
    expect(editConfig.mutation.enabled).toBe(true);
    expect(editConfig.filesystem.allowWrite).toEqual(["**"]);
  } finally {
    await rm(readRoot, { recursive: true, force: true });
    await rm(editRoot, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

it("does not flip an existing user-owned config even with --allow-write workspace and --force", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-install-preserve-"));
  const home = await mkdtemp(path.join(tmpdir(), "fabric-install-preserve-home-"));
  try {
    const executable = path.join(root, "fake-kiro");
    await writeFile(executable, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo kiro-test; fi\nexit 0\n");
    await chmod(executable, 0o755);
    const options = { root, home, cliPath: "dist/cli/main.js", executable, force: false, dryRun: false };
    const first = await installKiro(options);
    const configPath = path.join(root, ".fabric-lite/config.json");
    expect(first.kept).not.toContain(configPath);

    // User customizes the policy to read-only.
    await writeFile(configPath, "custom-readonly\n");
    const reinstalled = await installKiro({ ...options, force: true, writeAccess: "workspace" });
    expect(reinstalled.kept).toContain(configPath);
    expect(reinstalled.backups.some(file => file.startsWith(`${configPath}.bak-`))).toBe(false);
    expect(await readFile(configPath, "utf8")).toBe("custom-readonly\n");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

it("validates installed agents in both home and project locations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-validate-root-"));
  const home = await mkdtemp(path.join(tmpdir(), "fabric-validate-home-"));
  try {
    const executable = path.join(root, "fake-kiro");
    await writeFile(executable, "#!/bin/sh\ncase \"$4\" in *fabric-lite-worker.json) exit 7;; esac\nexit 0\n");
    await chmod(executable, 0o755);
    for (const base of [home, root]) {
      await mkdir(path.join(base, ".kiro/agents"), { recursive: true });
      await writeFile(path.join(base, ".kiro/agents/fabric-lite.json"), "{}\n");
      await writeFile(path.join(base, ".kiro/agents/fabric-lite-worker.json"), "{}\n");
    }

    const results = await validateInstalled(executable, root, home);
    expect(results.map((result) => result.path)).toEqual([
      path.join(home, ".kiro/agents/fabric-lite.json"),
      path.join(home, ".kiro/agents/fabric-lite-worker.json"),
      path.join(root, ".kiro/agents/fabric-lite.json"),
      path.join(root, ".kiro/agents/fabric-lite-worker.json"),
    ]);
    expect(results.map((result) => result.ok)).toEqual([true, false, true, false]);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

it("reports missing project agents even when home agents exist", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-validate-root-"));
  const home = await mkdtemp(path.join(tmpdir(), "fabric-validate-home-"));
  try {
    const executable = path.join(root, "fake-kiro");
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, 0o755);
    await mkdir(path.join(home, ".kiro/agents"), { recursive: true });
    for (const name of ["fabric-lite.json", "fabric-lite-worker.json"]) {
      await writeFile(path.join(home, ".kiro/agents", name), "{}\n");
    }

    const results = await validateInstalled(executable, root, home);
    expect(results.slice(0, 2).every((result) => result.ok)).toBe(true);
    expect(results.slice(2)).toEqual([
      { path: path.join(root, ".kiro/agents/fabric-lite.json"), ok: false, message: "not installed" },
      { path: path.join(root, ".kiro/agents/fabric-lite-worker.json"), ok: false, message: "not installed" },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

it("installs canonical prompts, detects drift, omits source-only policy elsewhere, and backs up on force", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fabric-install-root-"));
  const home = await mkdtemp(path.join(tmpdir(), "fabric-install-home-"));
  try {
    const executable = path.join(root, "fake-kiro");
    await writeFile(executable, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo kiro-test; fi\nexit 0\n");
    await chmod(executable, 0o755);
    const options = { root, home, cliPath: "dist/cli/main.js", executable, force: false, dryRun: false };
    const first = await installKiro(options);
    expect(first.prompts).not.toContain("workspace-policy");
    const approved = ["fabric-guide","fabric-workflow","fabric-council","fabric-fusion","fabric-context-decompose","evidence-ledger","evidence-change","spec-audit"];
    expect(first.prompts).toEqual(expect.arrayContaining(approved));
    const guide = path.join(root, ".kiro/prompts/fabric-guide.md");
    expect(await readFile(guide, "utf8")).toBe(loadPrompt("fabric-guide"));
    for (const provisional of ["guide","checked-workflow","council","conditional-fusion","context-decomposition"]) {
      await expect(readFile(path.join(root, `.kiro/prompts/${provisional}.md`), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect((await verifyPromptManifest(root)).ok).toBe(true);
    await writeFile(guide, "local drift\n");
    expect((await verifyPromptManifest(root)).changed).toContain(guide);
    const forced = await installKiro({ ...options, force: true });
    expect(forced.backups.some(file => file.startsWith(`${guide}.bak-`))).toBe(true);
    expect(await readFile(guide, "utf8")).toBe(loadPrompt("fabric-guide"));

    // config.json is user-owned: created on first install, kept untouched on
    // reinstall — even with --force and local policy customizations.
    const configPath = path.join(root, ".fabric-lite/config.json");
    await writeFile(configPath, "custom-policy\n");
    const reinstalled = await installKiro({ ...options, force: true });
    expect(reinstalled.kept).toContain(configPath);
    expect(reinstalled.backups.some(file => file.startsWith(`${configPath}.bak-`))).toBe(false);
    expect(await readFile(configPath, "utf8")).toBe("custom-policy\n");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});