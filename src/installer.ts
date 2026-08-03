import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type { FabricConfig } from "./config.js";
import { defaults } from "./config.js";
import { FabricError } from "./errors.js";
import { loadPrompt, promptFiles, renderPrompt } from "./prompts.js";
import { runProcess } from "./runners/kiro.js";

export interface InstallOptions {
  root: string;
  cliPath: string;
  executable: string;
  force: boolean;
  dryRun: boolean;
  home?: string;
}

interface PromptManifest {
  version: 1;
  files: Record<string, string>;
}

function agents(cli: string) {
  return {
    "fabric-lite-worker.json": {
      name: "fabric-lite-worker",
      description: "No-tool bounded Fabric Lite reasoning worker",
      prompt: loadPrompt("worker-agent"),
      mcpServers: {},
      tools: [],
      toolAliases: {},
      allowedTools: [],
      resources: [],
      toolsSettings: {},
      includeMcpJson: false,
      model: null,
    },
    "fabric-lite.json": {
      name: "fabric-lite",
      description: "Parent agent for bounded programmable Kiro reasoning",
      prompt: renderPrompt("parent-agent", { FABRIC_LITE_CLI: cli }),
      mcpServers: {},
      tools: ["shell"],
      toolAliases: {},
      allowedTools: [],
      resources: [],
      toolsSettings: {},
      includeMcpJson: false,
      model: null,
    },
  };
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function place(
  file: string,
  content: string,
  force: boolean,
  dryRun: boolean,
  backups: string[],
  conflicts: string[],
): Promise<void> {
  if (await exists(file)) {
    const prior = await readFile(file, "utf8");
    if (prior === content) return;
    if (!force) {
      if (dryRun) {
        conflicts.push(file);
        return;
      }
      throw new FabricError("CONFIG_ERROR", `Refusing to overwrite ${file}; use --force`);
    }
    const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    backups.push(backup);
    if (!dryRun) await rename(file, backup);
  }
  if (!dryRun) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, "utf8");
  }
}

const digest = (content: string): string => createHash("sha256").update(content).digest("hex");

async function isFabricLiteSource(root: string): Promise<boolean> {
  try {
    return JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).name === "fabric-lite";
  } catch {
    return false;
  }
}

async function selectedPrompts(root: string) {
  const source = await isFabricLiteSource(root);
  return promptFiles().filter((file) => source || file.id !== "workspace-policy");
}

function manifestFor(files: Array<{ name: string; content: string }>): PromptManifest {
  return {
    version: 1,
    files: Object.fromEntries(files.map((file) => [file.name, digest(file.content)])),
  };
}

export async function verifyPromptManifest(
  root: string,
): Promise<{ ok: boolean; missing: string[]; changed: string[] }> {
  const directory = path.join(root, ".kiro/prompts");
  const manifestPath = path.join(directory, ".fabric-lite-manifest.json");
  let manifest: PromptManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PromptManifest;
  } catch {
    return { ok: false, missing: [manifestPath], changed: [] };
  }

  const missing: string[] = [];
  const changed: string[] = [];
  for (const [name, expected] of Object.entries(manifest.files)) {
    const file = path.join(directory, name);
    try {
      if (digest(await readFile(file, "utf8")) !== expected) changed.push(file);
    } catch {
      missing.push(file);
    }
  }
  return { ok: missing.length === 0 && changed.length === 0, missing, changed };
}

export async function installKiro(options: InstallOptions) {
  let kiro = options.executable;
  if (!path.isAbsolute(kiro)) {
    const found = await runProcess("which", [kiro], { timeoutMs: 5000 });
    if (found.exitCode === 0 && found.stdout.trim()) kiro = found.stdout.trim();
  }
  const version = await runProcess(kiro, ["--version"], { timeoutMs: 10000 });
  if (version.exitCode !== 0) {
    throw new FabricError("CONFIG_ERROR", "kiro-cli is unavailable");
  }

  const generated = agents(path.resolve(options.cliPath));
  const prompts = await selectedPrompts(options.root);
  const manifest = `${JSON.stringify(manifestFor(prompts), null, 2)}\n`;
  const staging = await mkdtemp(path.join(tmpdir(), "fabric-lite-agents-"));
  try {
    for (const [name, value] of Object.entries(generated)) {
      const file = path.join(staging, name);
      await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
      const validation = await runProcess(kiro, ["agent", "validate", "--path", file], {
        timeoutMs: 20000,
      });
      if (validation.exitCode !== 0) {
        throw new FabricError(
          "CONFIG_ERROR",
          `Generated ${name} failed Kiro validation: ${(validation.stderr || validation.stdout).slice(-1000)}`,
        );
      }
    }

    const backups: string[] = [];
    const conflicts: string[] = [];
    const installHome = options.home ?? homedir();
    for (const [name, value] of Object.entries(generated)) {
      const content = `${JSON.stringify(value, null, 2)}\n`;
      await place(
        path.join(installHome, ".kiro/agents", name),
        content,
        options.force,
        options.dryRun,
        backups,
        conflicts,
      );
      await place(
        path.join(options.root, ".kiro/agents", name),
        content,
        options.force,
        options.dryRun,
        backups,
        conflicts,
      );
    }
    for (const prompt of prompts) {
      await place(
        path.join(options.root, ".kiro/prompts", prompt.name),
        prompt.content,
        options.force,
        options.dryRun,
        backups,
        conflicts,
      );
    }
    await place(
      path.join(options.root, ".kiro/prompts/.fabric-lite-manifest.json"),
      manifest,
      options.force,
      options.dryRun,
      backups,
      conflicts,
    );

    const config: FabricConfig = {
      ...defaults,
      projectRoot: ".",
      runner: { ...defaults.runner, executable: kiro },
    };
    await place(
      path.join(options.root, ".fabric-lite/config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
      options.force,
      options.dryRun,
      backups,
      conflicts,
    );

    const ignore = path.join(options.root, ".gitignore");
    let existing = (await exists(ignore)) ? await readFile(ignore, "utf8") : "";
    for (const line of [".fabric-lite/runs/", ".fabric-lite/cache/"]) {
      if (!existing.split(/\r?\n/).includes(line)) {
        existing += `${existing.endsWith("\n") || !existing ? "" : "\n"}${line}\n`;
      }
    }
    if (!options.dryRun) await writeFile(ignore, existing);

    return {
      ok: true,
      dryRun: options.dryRun,
      kiroVersion: (version.stdout || version.stderr).trim(),
      agents: Object.keys(generated),
      prompts: prompts.map((prompt) => prompt.id),
      locations: [
        path.join(installHome, ".kiro/agents"),
        path.join(options.root, ".kiro/agents"),
        path.join(options.root, ".kiro/prompts"),
      ],
      backups,
      conflicts,
      launch: `${kiro} --agent fabric-lite`,
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export interface InstalledAgentValidation {
  path: string;
  ok: boolean;
  message: string;
}

export async function validateInstalled(
  executable: string,
  root: string,
  home: string = homedir(),
): Promise<InstalledAgentValidation[]> {
  const names = ["fabric-lite.json", "fabric-lite-worker.json"];
  const files = [
    ...names.map((name) => path.join(home, ".kiro/agents", name)),
    ...names.map((name) => path.join(root, ".kiro/agents", name)),
  ];
  const results: InstalledAgentValidation[] = [];
  for (const file of files) {
    if (!(await exists(file))) {
      results.push({ path: file, ok: false, message: "not installed" });
      continue;
    }
    const result = await runProcess(executable, ["agent", "validate", "--path", file], {
      timeoutMs: 20000,
    });
    results.push({
      path: file,
      ok: result.exitCode === 0,
      message: (result.stderr || result.stdout).trim().slice(-500),
    });
  }
  return results;
}