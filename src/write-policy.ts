import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WriteAccessMode } from "./cli/args.js";
import { loadConfig } from "./config.js";
import { FabricError } from "./errors.js";

export interface UpdatePolicyOptions {
  root: string;
  writeAccess: WriteAccessMode;
  dryRun: boolean;
}

export interface UpdatePolicyReport {
  ok: boolean;
  dryRun: boolean;
  mode: WriteAccessMode;
  changed: boolean;
  config: string;
  filesystem: { allowWrite: string[] };
  mutation: { enabled: boolean; require: "clean" | "checkpoint"; maxDiffChars: unknown };
}

/**
 * Explicitly migrate an existing user-owned `.fabric-lite/config.json` between
 * workspace-editable and read-only mutation policy. Unlike a fresh install
 * (which only applies the `--allow-write` choice on creation), this command
 * rewrites an existing config. It touches only `filesystem.allowWrite` and the
 * mutation fields needed for the requested mode; every other setting (budgets,
 * runner, permissions, shell, cache, etc.) is preserved in place.
 *
 * The existing config is validated before modification, and the new content is
 * written atomically (temp file + rename) so an interrupted write cannot leave
 * a truncated config. `--dry-run` validates and previews the changes without
 * writing.
 */
export async function updateWritePolicy(options: UpdatePolicyOptions) {
  const configPath = path.join(options.root, ".fabric-lite/config.json");

  // Validate the existing config before touching it. loadConfig throws a
  // CONFIG_ERROR if the file is missing or structurally invalid.
  let raw: string;
  try {
    await loadConfig(options.root);
  } catch (error) {
    if (error instanceof FabricError) throw error;
    throw new FabricError("CONFIG_ERROR", `Invalid config in ${path.resolve(configPath)}: ${(error as Error).message}`);
  }
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    throw new FabricError("CONFIG_ERROR", `No config found at ${path.resolve(configPath)}; run install-kiro first`);
  }
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    throw new FabricError("CONFIG_ERROR", `Invalid JSON in ${path.resolve(configPath)}`);
  }
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new FabricError("CONFIG_ERROR", `Invalid config root in ${path.resolve(configPath)}: expected an object`);
  }

  const filesystem = { ...(config.filesystem as Record<string, unknown>) };
  const mutation = { ...(config.mutation as Record<string, unknown>) };
  config.filesystem = filesystem;
  config.mutation = mutation;

  const editable = options.writeAccess === "workspace";
  filesystem.allowWrite = editable ? ["**"] : [];
  mutation.enabled = editable;
  // Editable mode enables checkpoint safety so the first write force-snapshots
  // the dirty worktree; read-only mode keeps the user's diff and require
  // settings untouched.
  if (editable) mutation.require = "checkpoint";

  const next = `${JSON.stringify(config, null, 2)}\n`;
  const changed = next !== raw;
  const report: UpdatePolicyReport = {
    ok: true,
    dryRun: options.dryRun,
    mode: options.writeAccess,
    changed,
    config: path.resolve(configPath),
    filesystem: { allowWrite: editable ? ["**"] : [] },
    mutation: {
      enabled: editable,
      require: (mutation.require as "clean" | "checkpoint") ?? (editable ? "checkpoint" : undefined),
      maxDiffChars: mutation.maxDiffChars,
    },
  };

  if (!options.dryRun && changed) {
    const temp = `${configPath}.tmp-${process.pid}`;
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(temp, next, "utf8");
    await rename(temp, configPath);
  }
  return report;
}