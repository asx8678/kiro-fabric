import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { sha256Bytes, type KiroManagedLayout } from "./managed.js";
import { resolveSourcePackageRoot } from "./runtime-closure.js";

const MANAGED_SKILL_FILES = [
  "fabric-exec/SKILL.md",
  "fabric-exec/references/agents.md",
  "fabric-exec/references/mcp.md",
  "fabric-guide/SKILL.md",
  "fabric-review/SKILL.md",
  "fabric-workflow/SKILL.md",
] as const;

export interface KiroManagedSkillSource {
  sourceRelative: string;
  installedRelative: string;
  installedPath: string;
  bytes: Buffer;
  sha256: string;
}

const skillPrefix = (layout: KiroManagedLayout): string =>
  layout === "project" ? ".kiro/skills" : "skills";

export const managedKiroSkillSources = (
  installRoot: string,
  layout: KiroManagedLayout,
): KiroManagedSkillSource[] => {
  const packageRoot = resolveSourcePackageRoot();
  return MANAGED_SKILL_FILES.map((sourceRelative) => {
    const installedRelative = skillPrefix(layout) + "/" + sourceRelative;
    const strictSource = join(packageRoot, "strict", "skills", ...sourceRelative.split("/"));
    const bytes = readFileSync(existsSync(strictSource)
      ? strictSource
      : join(packageRoot, "skills", ...sourceRelative.split("/")));
    return {
      sourceRelative,
      installedRelative,
      installedPath: join(installRoot, ...installedRelative.split("/")),
      bytes,
      sha256: sha256Bytes(bytes),
    };
  });
};

export const managedKiroSkillBundleSha256 = (
  sources: readonly KiroManagedSkillSource[],
): string => {
  const hash = createHash("sha256");
  hash.update("kiro-fabric-managed-skills-v1\0");
  for (const source of sources) {
    hash.update(source.sourceRelative);
    hash.update("\0");
    hash.update(source.bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
};

/** Exact pinned Kiro 2.20.1 skill allow-list; no resource glob can claim siblings. */
export const managedKiroSkillResources = (layout: KiroManagedLayout): string[] =>
  ["fabric-exec", "fabric-guide", "fabric-review", "fabric-workflow"].map((name) =>
    layout === "project"
      ? `skill://.kiro/skills/${name}/SKILL.md`
      : `skill:///skills/${name}/SKILL.md`,
  );
