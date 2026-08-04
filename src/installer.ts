import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type { FabricConfig } from "./config.js";
import { defaults } from "./config.js";
import { FabricError } from "./errors.js";
import { loadPrompt, promptFiles, renderPrompt } from "./prompts.js";
import { runProcess } from "./runners/kiro.js";
import type { WriteAccessMode } from "./cli/args.js";

export interface InstallOptions {
  root: string;
  cliPath: string;
  executable: string;
  force: boolean;
  dryRun: boolean;
  home?: string;
  writeAccess?: WriteAccessMode;
}

interface PromptManifest {
  version: 1;
  files: Record<string, string>;
}

/**
 * Web access for Fabric Lite agents. kiro-cli 2.16 ships no built-in
 * web_search/web_fetch tool, so internet access is provided through MCP
 * servers (started on demand by Kiro; uvx resolves them without API keys):
 * - fetch: the reference MCP fetch server (read a URL, markdown extraction)
 * - ddg-search: DuckDuckGo search MCP server (web search, no key required)
 */
const WEB_MCP_SERVERS = {
  // mcp-server-fetch imports McpError, removed in mcp >= 1.23; pin the pair.
  fetch: {
    command: "uvx",
    args: ["--from", "mcp-server-fetch==2026.7.10", "--with", "mcp<1.23", "mcp-server-fetch"],
  },
  "ddg-search": { command: "uvx", args: ["duckduckgo-mcp-server"] },
};
const WEB_TOOLS = ["@fetch", "@ddg-search"];

function agents(cli: string) {
  return {
    "fabric-lite-worker.json": {
      name: "fabric-lite-worker",
      description: "Bounded Fabric Lite reasoning worker with web search/fetch",
      prompt: loadPrompt("worker-agent"),
      mcpServers: WEB_MCP_SERVERS,
      tools: [...WEB_TOOLS],
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
      mcpServers: WEB_MCP_SERVERS,
      tools: ["shell", ...WEB_TOOLS],
      toolAliases: {},
      allowedTools: [],
      resources: [],
      toolsSettings: {
        shell: {
          // Kiro persists trusted shell commands as glob patterns. The parent
          // agent uses shell only to invoke the Fabric Lite CLI, which
          // enforces its own permission policy, so pre-trust every CLI
          // invocation (quoted or unquoted) and read-only pipeline helpers
          // like `head`/`tail` to avoid an approval prompt per run.
          allowedCommands: [cli, `${cli} *`, `'${cli}'`, `'${cli}' *`],
          autoAllowReadonly: true,
        },
      },
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
    return (
      JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).name === "fabric-lite"
    );
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
  // The generated config references kiro-cli portably as a PATH-resolvable
  // command name, never a machine-specific absolute path. When a command name
  // is supplied, resolve it to an absolute path only for install-time
  // subprocess calls (--version, agent validate). An explicitly configured
  // non-absolute command name is preserved in the config; an absolute path
  // (resolved here for validation, or supplied directly) falls back to the
  // portable default "kiro-cli". Machine-specific executables remain
  // configurable at runtime via KIRO_CLI_PATH or a user-edited config.json
  // (which the installer never overwrites).
  const persistedExecutable = path.isAbsolute(options.executable) ? "kiro-cli" : options.executable;
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
    const kept: string[] = [];
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

    // config.json is user-owned policy (allowWrite, allowCommit, permissions),
    // unlike the installer-owned agents and prompts above: create it when
    // missing, never overwrite or back it up — even with --force.
    const configPath = path.join(options.root, ".fabric-lite/config.json");
    if (await exists(configPath)) {
      kept.push(configPath);
    } else if (!options.dryRun) {
      // Write access is configured only when creating a fresh config. Editable
      // mode is the default and allowlists the workspace root-wide; callers can
      // explicitly select read-only. The safe-write path still denies traversal,
      // sensitive paths, and symlink escapes.
      const writeAccess = options.writeAccess ?? "workspace";
      const editable = writeAccess === "workspace";
      const config: FabricConfig = {
        ...defaults,
        projectRoot: ".",
        runner: { ...defaults.runner, executable: persistedExecutable },
        filesystem: {
          ...defaults.filesystem,
          allowWrite: editable ? ["**"] : [],
        },
        mutation: {
          ...defaults.mutation,
          enabled: editable,
        },
      };
      await mkdir(path.dirname(configPath), { recursive: true });
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    }

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
      kept,
      launch: `${persistedExecutable} --agent fabric-lite`,
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
