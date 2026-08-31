// Project-scoped Kiro profile installer. Plans deterministically without
// touching the filesystem (planKiroProfileInstall) and commits under an
// exclusive operation lock (installKiroProfile): verified content-addressed
// backup of displaced user bytes, manifest, then profile. Managed updates
// inherit the original displaced-user backup instead of replacing it.

import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";

import { inspectFabricConfig, type FabricConfig } from "../config.js";
import { resolveAgentDir } from "../core/agent-dir.js";
import { assertKiroAccountingCompatible } from "./accounting-compatibility.js";
import {
  assertSupportedKiro,
  assertSupportedKiroUnchanged,
  assertSupportedNode,
  KIRO_AGENT_ENGINE,
  KIRO_CLI_VERSION,
  type SupportedKiroIdentity,
  type SupportedNodeIdentity,
} from "./compatibility.js";
import {
  acquireOperationLock,
  assertBackupBytes,
  assertExecutableAttestation,
  assertManagedTree,
  attestExecutable,
  assertNoSymlinkComponents,
  backupRelativePath,
  commitManagedFileTransaction,
  copyAttestedExecutable,
  defaultMcpEntryPath,
  ensureManagedDirectory,
  fsyncDirectory,
  KIRO_INSTALL_MANIFEST_FORMAT,
  KiroInstallError,
  lstatOrNull,
  managedFileTransition,
  managedPaths,
  readManagedFileNoFollow,
  readManifest,
  probeManagedTransactionRecovery,
  recoverManagedTransaction,
  readPackageVersion,
  resolveKiroProjectRoot,
  serializeJson,
  sha256Bytes,
  writeExclusive,
  type ExecutableAttestation,
  type KiroBackupRecord,
  type KiroInstallManifest,
  type KiroManagedGrants,
  type KiroManagedLayout,
  type KiroManagedOwnedFile,
} from "./managed.js";
import { resolveKiroInstallRoots } from "./home.js";
import { currentKiroInstallTestOverrides } from "./install-test-seam.js";
import { resolveKiroMcpLaunchEnvironment } from "./mcp-environment.js";
import {
  generateKiroProfile,
  kiroProfilePath,
} from "./profile.js";
import {
  deployRuntimeClosure,
  planRuntimeClosureDeployment,
  resolveSourcePackageRoot,
  hasPendingRuntimeClosureRepair,
  recoverRuntimeClosureRepair,
  removeAttestedRuntimeClosure,
  type RuntimeClosurePlan,
  type RuntimeClosureResult,
  runtimeClosurePath,
  verifyRuntimeClosureAttestation,
} from "./runtime-closure.js";
import {
  managedKiroSkillBundleSha256,
  managedKiroSkillResources,
  managedKiroSkillSources,
  type KiroManagedSkillSource,
} from "./skills.js";

const execFileAsync = promisify(execFile);

export {
  KIRO_INSTALL_MANIFEST_FORMAT,
  KiroInstallError,
  resolveKiroProjectRoot,
};

export type KiroInstallAction =
  | "create"
  | "noop"
  | "adopt"
  | "update"
  | "repair";

export interface KiroInstallOptions {
  /** Explicit project root; defaults to the invocation cwd. Never walks up. */
  projectRoot?: string;
  /** Absolute path to the built MCP entry. Defaults to dist/kiro/mcp-entry.js. */
  mcpEntryPath?: string;
  /** Bootstrap Node to certify before mutation; never persisted for format-3 installs. */
  nodePath?: string;
  /** Kiro binary used for --version / agent validate; default "kiro-cli". */
  kiroBinary?: string;
  /** Replace an unknown or user-modified regular profile (backup first). */
  force?: boolean;
  /** `user` writes into the Kiro home (default ~/.kiro), not <project>/.kiro. */
  scope?: KiroManagedLayout;
  /** Override Kiro home for `scope: "user"`. Defaults to $KIRO_HOME or ~/.kiro. */
  kiroHome?: string;
  /** Trusted-local opt-in: allow execute-risk actions such as `k.bash`. */
  allowShell?: boolean;
  /** Enable bounded Kiro ACP child fan-out; requires allowShell. */
  enableSubagents?: boolean;
  /** Fabric configuration override for deterministic preflight tests. */
  fabricConfig?: FabricConfig;
  /** Trusted-local opt-in: auto-approve the single Fabric tool via an exact v3 MCP rule. */
  allowTools?: boolean;
  /** Restore a damaged same-digest runtime from this invocation's trusted artifact. */
  repairRuntime?: boolean;
}

interface KiroSkillInstallPlan extends KiroManagedSkillSource {
  existingSha256: string | null;
  backupPath: string | null;
  backup: KiroBackupRecord | null;
  captureBackup: boolean;
}

export interface KiroInstallPlan {
  projectRoot: string;
  installRoot: string;
  layout: KiroManagedLayout;
  profilePath: string;
  manifestPath: string;
  backupDir: string;
  action: KiroInstallAction | "blocked";
  profileJson: string;
  profileSha256: string;
  manifestJson: string;
  existingSha256: string | null;
  backupPath: string | null;
  /** True when this plan must write a new backup of current profile bytes. */
  captureBackup: boolean;
  blockedReason: string | null;
  requiresForce: boolean;
  skills: KiroSkillInstallPlan[];
  activation: {
    path: string;
    expectedSha256: string | null;
    nextBytes: string;
  } | null;
  grants: {
    before: KiroManagedGrants | null;
    after: KiroManagedGrants;
    changed: Array<keyof KiroManagedGrants>;
  };
}

interface KiroInstallOperation {
  kind: "runtime" | "profile" | "skill" | "manifest";
  action: "publish" | "repair" | "activate" | "create" | "update" | "noop";
  path: string;
  sha256?: string;
}

export interface KiroInstallResult {
  ok: boolean;
  dryRun: boolean;
  action: KiroInstallAction;
  projectRoot: string;
  profilePath: string;
  manifestPath: string;
  backupPath: string | null;
  profileSha256: string;
  runtimeClosure?: RuntimeClosureResult;
  /** Ordered exact deployment plan; dry-run and real install share this shape. */
  operations: KiroInstallOperation[];
  /** Explicit before/after advanced-grant diff. */
  grants: KiroInstallPlan["grants"];
}

const buildManifest = (
  options: Required<Pick<KiroInstallOptions, "nodePath" | "mcpEntryPath">> & {
    kiroIdentity?: SupportedKiroIdentity;
  },
  projectRoot: string,
  layout: KiroManagedLayout,
  profileDigest: string,
  backup: KiroBackupRecord | null,
  skills: readonly KiroSkillInstallPlan[],
  closure: RuntimeClosurePlan | undefined,
  previous: KiroInstallManifest | null,
  grants: KiroManagedGrants,
): KiroInstallManifest => ({
  format: closure ? KIRO_INSTALL_MANIFEST_FORMAT : 1,
  owner: "kiro-fabric",
  packageVersion: readPackageVersion(),
  projectRoot,
  profile: {
    path: managedPaths(projectRoot, layout).profileRelative,
    installedSha256: profileDigest,
    ...(backup ? { backup } : {}),
  },
  runtime: {
    nodePath: options.nodePath,
    mcpEntryPath: options.mcpEntryPath,
    ...(options.kiroIdentity
      ? {
          kiroBinaryPath: closure?.runtimeKiroPath ?? options.kiroIdentity.sourcePath,
          kiroSourcePath: options.kiroIdentity.sourcePath,
          kiroSha256: options.kiroIdentity.sha256,
        }
      : {}),
    kiroCliVersion: options.kiroIdentity?.version ?? KIRO_CLI_VERSION,
    agentEngine: KIRO_AGENT_ENGINE,
    ...(closure
      ? {
          closure: closure.attestation,
          // Keep launch/status verification and eventual uninstall bounded:
          // current plus the immediately preceding active generation only.
          generations: [
            closure.attestation,
            ...(previous?.runtime.closure && previous.runtime.closure.root !== closure.attestation.root
              ? [previous.runtime.closure]
              : []),
          ],
          managerEntryPath: closure.managementEntryPath,
          nodeSha256: closure.attestation.files.find((file) => file.path.endsWith("/bin/node") || file.path.endsWith("/bin/node.exe"))!.installedSha256,
        }
      : {}),
  },
  ...(closure
    ? {
        skills: {
          bundleSha256: managedKiroSkillBundleSha256(skills),
          files: skills
            .map((skill): KiroManagedOwnedFile => ({
              path: skill.installedRelative,
              installedSha256: skill.sha256,
              ...(skill.backup ? { backup: skill.backup } : {}),
            }))
            .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
        },
      }
    : {}),
  grants,
  ...(layout === "user" ? { scope: "user" as const } : {}),
});

const backupRecordsEqual = (
  left: KiroBackupRecord | undefined,
  right: KiroBackupRecord | undefined,
): boolean => {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.path === right.path && left.sha256 === right.sha256;
};

const manifestIsCurrent = (
  existing: KiroInstallManifest,
  desired: KiroInstallManifest,
): boolean =>
  existing.format === desired.format &&
  existing.packageVersion === desired.packageVersion &&
  existing.runtime.nodePath === desired.runtime.nodePath &&
  existing.runtime.mcpEntryPath === desired.runtime.mcpEntryPath &&
  existing.runtime.kiroBinaryPath === desired.runtime.kiroBinaryPath &&
  existing.runtime.kiroSourcePath === desired.runtime.kiroSourcePath &&
  existing.runtime.kiroCliVersion === desired.runtime.kiroCliVersion &&
  existing.runtime.kiroSha256 === desired.runtime.kiroSha256 &&
  existing.runtime.agentEngine === desired.runtime.agentEngine &&
  existing.runtime.managerEntryPath === desired.runtime.managerEntryPath &&
  existing.runtime.nodeSha256 === desired.runtime.nodeSha256 &&
  JSON.stringify(existing.grants ?? null) === JSON.stringify(desired.grants ?? null) &&
  existing.profile.installedSha256 === desired.profile.installedSha256 &&
  existing.profile.path === desired.profile.path &&
  backupRecordsEqual(existing.profile.backup, desired.profile.backup) &&
  JSON.stringify(existing.skills ?? null) === JSON.stringify(desired.skills ?? null) &&
  JSON.stringify(existing.runtime.closure ?? null) ===
    JSON.stringify(desired.runtime.closure ?? null) &&
  JSON.stringify(existing.runtime.generations ?? (existing.runtime.closure ? [existing.runtime.closure] : null)) ===
    JSON.stringify(desired.runtime.generations ?? null);

export const readManagedKiroGrants = (
  options: Pick<KiroInstallOptions, "projectRoot" | "scope" | "kiroHome"> = {},
): KiroManagedGrants | null => {
  const roots = resolveKiroInstallRoots(options);
  const manifest = readManifest(roots.installRoot, roots.layout);
  if (!manifest) return null;
  const profile = readManagedFileNoFollow(
    roots.installRoot,
    kiroProfilePath(roots.installRoot, roots.layout),
  );
  if (!profile || sha256Bytes(profile) !== manifest.profile.installedSha256) {
    throw new KiroInstallError("ownership", "cannot preserve grants from an unverified managed profile");
  }
  try {
    const document = JSON.parse(profile.toString("utf8")) as {
      mcpServers?: { fabric?: { env?: Record<string, unknown> } };
    };
    const env = document.mcpServers?.fabric?.env ?? {};
    const grants: KiroManagedGrants = {
      allowShell: env.KIRO_FABRIC_ALLOW_SHELL === "1",
      enableSubagents: env.KIRO_FABRIC_ENABLE_SUBAGENTS === "1",
      allowTools: env.KIRO_FABRIC_ALLOW_TOOLS === "1",
    };
    if (grants.enableSubagents && !grants.allowShell) {
      throw new Error("subagent grant lacks shell grant");
    }
    if (manifest.grants && JSON.stringify(manifest.grants) !== JSON.stringify(grants)) {
      throw new Error("manifest grant state differs from the verified profile");
    }
    return grants;
  } catch (error) {
    throw new KiroInstallError(
      "manifest",
      "cannot recover advanced grants from the managed profile: " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
};

/** Scan JSON and Markdown agents for any name that can resolve as kiro-fabric. */
const findNameCollision = (agentsDir: string, ownProfilePath: string): string | null => {
  const stat = lstatOrNull(agentsDir);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) return null;
  for (const entry of readdirSync(agentsDir)) {
    const candidate = join(agentsDir, entry);
    if (candidate === ownProfilePath) continue;
    const entryStat = lstatOrNull(candidate);
    const extension = extname(entry).toLowerCase();
    if (!entryStat?.isFile() || entryStat.isSymbolicLink() || ![".json", ".md"].includes(extension)) {
      continue;
    }
    const filenameName = basename(entry, extension);
    try {
      const source = readFileSync(candidate, "utf8");
      let declaredName: unknown;
      if (extension === ".json") {
        const parsed = JSON.parse(source) as { name?: unknown };
        declaredName = typeof parsed.name === "string" ? parsed.name : filenameName;
      } else {
        const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/u.exec(source);
        const parsed = frontmatter ? parseYaml(frontmatter[1]!) as unknown : undefined;
        declaredName =
          parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
          typeof (parsed as Record<string, unknown>).name === "string"
            ? (parsed as Record<string, unknown>).name
            : filenameName;
      }
      if (declaredName === "kiro-fabric") return candidate;
    } catch {
      // A malformed same-name file can still shadow or break discovery; fail closed.
      if (filenameName === "kiro-fabric") return candidate;
    }
  }
  return null;
};

export const planKiroProfileInstall = (
  options: KiroInstallOptions = {},
  planning: {
    allowMissingMcpEntry?: boolean;
    closure?: RuntimeClosurePlan;
    /** Certified by installKiroProfile before any managed-tree mutation. */
    kiroIdentity?: SupportedKiroIdentity;
  } = {},
): KiroInstallPlan => {
  const { layout, installRoot, projectRoot: root } = resolveKiroInstallRoots(options);
  const nodePath = options.nodePath ?? process.execPath;
  const mcpEntryPath = options.mcpEntryPath ?? defaultMcpEntryPath();
  if (!isAbsolute(mcpEntryPath)) {
    throw new KiroInstallError("fs", `MCP entry path must be absolute: ${mcpEntryPath}`);
  }
  if (!planning.allowMissingMcpEntry && !existsSync(mcpEntryPath)) {
    throw new KiroInstallError("fs", `MCP entry not found (run pnpm build first): ${mcpEntryPath}`);
  }
  assertManagedTree(installRoot, layout);

  const paths = managedPaths(installRoot, layout);
  const profilePath = kiroProfilePath(installRoot, layout);
  const skillSources = planning.closure
    ? managedKiroSkillSources(installRoot, layout)
    : [];
  const skillBundleSha256 = planning.closure
    ? managedKiroSkillBundleSha256(skillSources)
    : undefined;
  const profile = generateKiroProfile({
    projectRoot: root,
    mcpEntryPath,
    nodePath,
    ...(layout === "user" ? { kiroHome: installRoot } : {}),
    ...(planning.kiroIdentity
      ? {
          kiroBinaryPath: planning.closure?.runtimeKiroPath ?? planning.kiroIdentity.sourcePath,
          kiroCliVersion: planning.kiroIdentity.version,
          kiroSha256: planning.kiroIdentity.sha256,
        }
      : {}),
    ...(options.allowShell ? { allowShell: true } : {}),
    ...(options.enableSubagents ? { enableSubagents: true } : {}),
    ...(options.allowTools ? { allowTools: true } : {}),
    ...(planning.closure
      ? {
          resources: managedKiroSkillResources(layout),
          skillBundleSha256: skillBundleSha256!,
        }
      : {}),
  });
  const profileEnv = profile.mcpServers.fabric?.env;
  if (profileEnv?.KIRO_FABRIC_ENFORCE_PROJECT_ROOT === "1") {
    resolveKiroMcpLaunchEnvironment(profileEnv, root);
  }
  const profileJson = serializeJson(profile);
  const profileSha256 = sha256Bytes(profileJson);

  const collision =
    findNameCollision(paths.agentsDir, profilePath) ??
    (layout === "user" && resolve(root) !== resolve(installRoot)
      ? findNameCollision(join(root, ".kiro", "agents"), profilePath)
      : null);
  if (collision) {
    throw new KiroInstallError(
      "collision",
      `another profile already declares or can resolve as name "kiro-fabric": ${collision}`,
    );
  }

  const manifest = readManifest(installRoot, layout);
  // Preflight only the active generation. Historical ownership is retained for
  // bounded rollback/uninstall cleanup, not paid on every launch or update.
  const activeGeneration = manifest?.runtime.closure;
  if (activeGeneration) {
    const generationRoot = join(installRoot, ...activeGeneration.root.split("/"));
    const repairingPlannedGeneration =
      options.repairRuntime === true && activeGeneration.digest === planning.closure?.digest;
    if (existsSync(generationRoot) && !repairingPlannedGeneration) {
      verifyRuntimeClosureAttestation(installRoot, activeGeneration);
    }
  }
  let existingSha256: string | null = null;
  let existingBytes: Buffer | null = null;
  const profileStat = lstatOrNull(profilePath);
  if (profileStat) {
    if (profileStat.isSymbolicLink()) {
      throw new KiroInstallError("symlink", `refusing profile symlink: ${profilePath}`);
    }
    if (!profileStat.isFile()) {
      throw new KiroInstallError(
        "collision",
        `profile target is not a regular file: ${profilePath}`,
      );
    }
    existingBytes = readFileSync(profilePath);
    existingSha256 = sha256Bytes(existingBytes);
  }

  let action: KiroInstallPlan["action"];
  let blockedReason: string | null = null;
  let requiresForce = false;

  if (existingSha256 === null) {
    action = manifest ? "repair" : "create";
  } else if (existingSha256 === profileSha256) {
    action = manifest ? "noop" : "adopt";
  } else if (manifest) {
    if (existingSha256 === manifest.profile.installedSha256) {
      action = "update";
    } else {
      action = options.force ? "update" : "blocked";
      if (!options.force) {
        blockedReason = "profile modified externally; use --force to overwrite";
        requiresForce = true;
      }
    }
  } else {
    action = options.force ? "create" : "blocked";
    if (!options.force) {
      blockedReason = "unmanaged profile exists; use --force to back up and replace";
      requiresForce = true;
    }
  }

  if (options.force && action === "blocked") {
    action = manifest ? "update" : "create";
  }

  let backupRecord: KiroBackupRecord | null = null;
  let captureBackup = false;

  const captureCurrent = (): void => {
    if (!existingSha256) return;
    backupRecord = {
      path: backupRelativePath(existingSha256, layout),
      sha256: existingSha256,
    };
    captureBackup = true;
  };

  if (action === "adopt" || (action === "create" && existingBytes)) {
    captureCurrent();
  } else if (
    action === "update" &&
    options.force &&
    manifest &&
    existingSha256 &&
    existingSha256 !== manifest.profile.installedSha256
  ) {
    captureCurrent();
  } else if ((action === "update" || action === "repair" || action === "noop") && manifest?.profile.backup) {
    backupRecord = manifest.profile.backup;
    assertBackupBytes(installRoot, backupRecord);
  }

  const previousSkills = new Map(
    (manifest?.skills?.files ?? []).map((file) => [file.path, file] as const),
  );
  const skillPlans: KiroSkillInstallPlan[] = skillSources.map((source) => {
    assertNoSymlinkComponents(installRoot, source.installedPath);
    const stat = lstatOrNull(source.installedPath);
    if (stat && (stat.isSymbolicLink() || !stat.isFile())) {
      throw new KiroInstallError(
        "collision",
        "managed skill target is not a regular file: " + source.installedPath,
      );
    }
    const current = stat ? readFileSync(source.installedPath) : null;
    const currentHash = current ? sha256Bytes(current) : null;
    const previous = previousSkills.get(source.installedRelative);
    let backup = previous?.backup ?? null;
    let capture = false;
    const captureCurrentSkill = (): void => {
      if (!currentHash) return;
      backup = { path: backupRelativePath(currentHash, layout), sha256: currentHash };
      capture = true;
    };
    if (previous) {
      if (currentHash !== null && currentHash !== previous.installedSha256) {
        if (!options.force) {
          action = "blocked";
          blockedReason ??= "managed skill modified externally; use --force to overwrite: " + source.installedRelative;
          requiresForce = true;
        } else {
          captureCurrentSkill();
        }
      } else if (backup) {
        assertBackupBytes(installRoot, backup);
      }
    } else if (currentHash !== null) {
      if (currentHash !== source.sha256 && !options.force) {
        action = "blocked";
        blockedReason ??= "unmanaged skill exists; use --force to back up and replace: " + source.installedRelative;
        requiresForce = true;
      } else {
        captureCurrentSkill();
      }
    }
    return {
      ...source,
      existingSha256: currentHash,
      backupPath: backup ? join(installRoot, ...backup.path.split("/")) : null,
      backup,
      captureBackup: capture,
    };
  });

  const grantsAfter: KiroManagedGrants = {
    allowShell: options.allowShell === true,
    enableSubagents: options.enableSubagents === true,
    allowTools: options.allowTools === true,
  };
  const inferredBefore: KiroManagedGrants | null = manifest
    ? manifest.grants ?? (() => {
        if (!existingBytes || sha256Bytes(existingBytes) !== manifest.profile.installedSha256) return null;
        try {
          const document = JSON.parse(existingBytes.toString("utf8")) as {
            mcpServers?: { fabric?: { env?: Record<string, unknown> } };
          };
          const env = document.mcpServers?.fabric?.env ?? {};
          return {
            allowShell: env.KIRO_FABRIC_ALLOW_SHELL === "1",
            enableSubagents: env.KIRO_FABRIC_ENABLE_SUBAGENTS === "1",
            allowTools: env.KIRO_FABRIC_ALLOW_TOOLS === "1",
          };
        } catch {
          return null;
        }
      })()
    : null;
  const desiredManifest = buildManifest(
    {
      nodePath,
      mcpEntryPath,
      ...(planning.kiroIdentity ? { kiroIdentity: planning.kiroIdentity } : {}),
    },
    root,
    layout,
    profileSha256,
    backupRecord,
    skillPlans,
    planning.closure,
    manifest,
    grantsAfter,
  );
  if (action === "noop" && manifest && !manifestIsCurrent(manifest, desiredManifest)) {
    action = "update";
  }

  const backupPath = backupRecord
    ? join(installRoot, ...backupRecord.path.split("/"))
    : null;

  const activation = planning.closure
    ? (() => {
        const path = join(runtimeClosurePath(installRoot, layout), ".closure-current");
        const current = readManagedFileNoFollow(installRoot, path);
        return {
          path,
          expectedSha256: current === null ? null : sha256Bytes(current),
          nextBytes: planning.closure.digest + "\n",
        };
      })()
    : null;

  return {
    projectRoot: root,
    installRoot,
    layout,
    profilePath,
    manifestPath: paths.manifest,
    backupDir: paths.backupDir,
    action,
    profileJson,
    profileSha256,
    manifestJson: serializeJson(desiredManifest),
    existingSha256,
    backupPath,
    captureBackup,
    blockedReason,
    requiresForce,
    skills: skillPlans,
    activation,
    grants: {
      before: inferredBefore,
      after: grantsAfter,
      changed: (Object.keys(grantsAfter) as Array<keyof KiroManagedGrants>).filter((key) =>
        inferredBefore ? inferredBefore[key] !== grantsAfter[key] : grantsAfter[key],
      ),
    },
  };
};

const runKiro = async (
  kiro: string | SupportedKiroIdentity,
  args: string[],
): Promise<{ stdout: string; stderr: string }> => {
  const staged = typeof kiro === "string" ? await assertSupportedKiro(kiro) : undefined;
  const identity: SupportedKiroIdentity = typeof kiro === "string" ? staged! : kiro;
  try {
    assertExecutableAttestation(identity);
    const { stdout, stderr } = await execFileAsync(identity.executablePath, args, {
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    });
    assertExecutableAttestation(identity);
    return { stdout: String(stdout), stderr: String(stderr) };
  } catch (error) {
    const err = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
      code?: string;
      killed?: boolean;
      signal?: string;
    };
    const detail = `${err.stdout ?? ""}\n${err.stderr ?? ""}`.trim();
    const timedOut = err.killed === true || err.code === "ETIMEDOUT" || err.signal === "SIGTERM";
    throw new KiroInstallError(
      "kiro-validate",
      `kiro-cli ${args.join(" ")} ${timedOut ? "timed out" : "failed"}` +
        (detail ? `: ${detail.slice(0, 2000)}` : `: ${err.message ?? String(error)}`),
    );
  } finally {
    staged?.dispose();
  }
};

/** Require the centralized exact product/version/executable policy. */
export const assertKiroVersion = async (
  kiroBinary = "kiro-cli",
): Promise<SupportedKiroIdentity> => {
  try {
    return await assertSupportedKiro(kiroBinary);
  } catch (error) {
    throw new KiroInstallError(
      "kiro-version",
      error instanceof Error ? error.message : String(error),
    );
  }
};

/** Prove the pinned CLI exposes the v3 ACP engine and CLI-owned auth path. */
export const assertKiroV3Capabilities = async (
  kiro: string | SupportedKiroIdentity = "kiro-cli",
): Promise<void> => {
  const { stdout, stderr } = await runKiro(kiro, ["acp", "--help"]);
  const text = `${stdout}\n${stderr}`;
  if (
    !/--agent-engine\b/.test(text) ||
    !/\bv3\b/.test(text) ||
    !/--auth-method\b/.test(text) ||
    !/\bcli\b/.test(text)
  ) {
    throw new KiroInstallError(
      "kiro-version",
      "kiro-cli does not advertise the required v3 ACP engine with CLI-owned authentication",
    );
  }
};

// Kiro 2.20.1 emits diagnostics as line-oriented severity records while also
// returning status 0. Match a diagnostic prefix, not free-standing words in a
// success summary (for example, "0 failed").
const ERROR_DIAGNOSTIC = /^\s*(?:error|fatal|invalid)\s*[:\[]/imu;

/**
 * Validate a profile document with `kiro-cli agent validate`. Kiro 2.20.1
 * can exit 0 while still printing error diagnostics, so output is parsed too.
 */
export const validateKiroProfile = async (
  profileJson: string,
  kiro: string | SupportedKiroIdentity = "kiro-cli",
): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), "kiro-fabric-kiro-validate-"));
  try {
    const candidate = join(dir, "profile.json");
    await writeFile(candidate, profileJson, { mode: 0o600 });
    const { stdout, stderr } = await runKiro(kiro, [
      "agent",
      "validate",
      "--path",
      candidate,
    ]);
    const combined = `${stdout}\n${stderr}`;
    if (ERROR_DIAGNOSTIC.test(combined)) {
      throw new KiroInstallError(
        "kiro-validate",
        `kiro-cli agent validate reported an error: ${combined.trim().slice(0, 2000)}`,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const resultFromPlan = (
  plan: KiroInstallPlan,
  dryRun: boolean,
  runtimeClosure?: RuntimeClosureResult,
): KiroInstallResult => {
  const operations: KiroInstallOperation[] = [];
  if (runtimeClosure) {
    operations.push({
      kind: "runtime",
      action: runtimeClosure.action === "noop" ? "noop" : runtimeClosure.action,
      path: join(runtimeClosure.runtimeDir, runtimeClosure.digest),
      sha256: runtimeClosure.digest,
    });
  }
  operations.push({
    kind: "profile",
    action: plan.existingSha256 === null
      ? "create"
      : plan.existingSha256 === plan.profileSha256 ? "noop" : "update",
    path: plan.profilePath,
    sha256: plan.profileSha256,
  });
  for (const skill of plan.skills) {
    operations.push({
      kind: "skill",
      action: skill.existingSha256 === null
        ? "create"
        : skill.existingSha256 === skill.sha256 ? "noop" : "update",
      path: skill.installedPath,
      sha256: skill.sha256,
    });
  }
  operations.push({
    kind: "manifest",
    action: plan.action === "create" || plan.action === "adopt" ? "create"
      : plan.action === "noop" ? "noop" : "update",
    path: plan.manifestPath,
    sha256: sha256Bytes(plan.manifestJson),
  });
  return {
    ok: true,
    dryRun,
    action: plan.action as KiroInstallAction,
    projectRoot: plan.projectRoot,
    profilePath: plan.profilePath,
    manifestPath: plan.manifestPath,
    backupPath: plan.backupPath,
    profileSha256: plan.profileSha256,
    ...(runtimeClosure ? { runtimeClosure } : {}),
    operations,
    grants: plan.grants,
  };
};

const cleanupSupersededRuntimeGenerations = (plan: KiroInstallPlan): void => {
  const previous = readManifest(plan.installRoot, plan.layout);
  if (!previous?.runtime.closure) return;
  const desired = JSON.parse(plan.manifestJson) as KiroInstallManifest;
  const retained = new Set((desired.runtime.generations ?? []).map((generation) => generation.root));
  for (const generation of previous.runtime.generations ?? [previous.runtime.closure]) {
    // Never remove the generation activated by the still-current manifest.
    if (generation.root !== previous.runtime.closure.root && !retained.has(generation.root)) {
      removeAttestedRuntimeClosure(plan.installRoot, plan.layout, generation);
    }
  }
};

const commitInstall = (plan: KiroInstallPlan): void => {
  if (plan.action === "blocked") {
    throw new KiroInstallError("collision", plan.blockedReason ?? "profile collision");
  }
  const paths = managedPaths(plan.installRoot, plan.layout);
  assertManagedTree(plan.installRoot, plan.layout);
  if (plan.layout === "project") {
    ensureManagedDirectory(join(plan.installRoot, ".kiro"));
  }
  ensureManagedDirectory(paths.agentsDir);
  ensureManagedDirectory(paths.manifestDir);
  ensureManagedDirectory(plan.backupDir);
  assertManagedTree(plan.installRoot, plan.layout);

  if (plan.captureBackup && plan.backupPath && plan.existingSha256) {
    const current = readManagedFileNoFollow(plan.installRoot, plan.profilePath);
    if (current === null || sha256Bytes(current) !== plan.existingSha256) {
      throw new KiroInstallError(
        "concurrency",
        `profile changed while installing: ${plan.profilePath}`,
      );
    }
    const existingBackup = lstatOrNull(plan.backupPath);
    if (!existingBackup) {
      writeExclusive(plan.backupPath, current, 0o600);
    } else {
      assertNoSymlinkComponents(plan.installRoot, plan.backupPath);
      if (existingBackup.isSymbolicLink() || !existingBackup.isFile()) {
        throw new KiroInstallError("backup", `backup target is not a regular file: ${plan.backupPath}`);
      }
      if (sha256Bytes(readFileSync(plan.backupPath)) !== plan.existingSha256) {
        throw new KiroInstallError("backup", `recorded backup hash mismatch: ${plan.backupPath}`);
      }
    }
  } else if (plan.backupPath) {
    const manifest = JSON.parse(plan.manifestJson) as KiroInstallManifest;
    if (manifest.profile.backup) assertBackupBytes(plan.installRoot, manifest.profile.backup);
  }

  for (const skill of plan.skills) {
    const current = readManagedFileNoFollow(plan.installRoot, skill.installedPath);
    const currentHash = current === null ? null : sha256Bytes(current);
    if (currentHash !== skill.existingSha256) {
      throw new KiroInstallError(
        "concurrency",
        "managed skill changed while installing: " + skill.installedPath,
      );
    }
    if (skill.captureBackup && skill.backupPath && current) {
      const existingBackup = lstatOrNull(skill.backupPath);
      if (!existingBackup) {
        writeExclusive(skill.backupPath, current, 0o600);
      } else {
        assertNoSymlinkComponents(plan.installRoot, skill.backupPath);
        if (existingBackup.isSymbolicLink() || !existingBackup.isFile()) {
          throw new KiroInstallError("backup", "skill backup target is not a regular file");
        }
        if (sha256Bytes(readFileSync(skill.backupPath)) !== skill.existingSha256) {
          throw new KiroInstallError("backup", "skill backup hash mismatch");
        }
      }
    } else if (skill.backup) {
      assertBackupBytes(plan.installRoot, skill.backup);
    }
  }

  // The activation/recovery transaction journal covers profile, every owned
  // skill leaf, then manifest last. Recovery is
  // idempotent and never exposes a manifest that describes partial skill bytes.
  const currentManifest = readManagedFileNoFollow(plan.installRoot, plan.manifestPath);
  commitManagedFileTransaction(
    plan.installRoot,
    plan.layout,
    "install",
    [
      ...(plan.activation
        ? [{
            path: plan.activation.path,
            transition: managedFileTransition(
              plan.activation.expectedSha256,
              plan.activation.nextBytes,
            ),
          }]
        : []),
      {
        path: plan.profilePath,
        transition: managedFileTransition(plan.existingSha256, plan.profileJson),
      },
      ...plan.skills.map((skill) => ({
        path: skill.installedPath,
        transition: managedFileTransition(skill.existingSha256, skill.bytes),
      })),
      {
        path: plan.manifestPath,
        transition: managedFileTransition(
          currentManifest === null ? null : sha256Bytes(currentManifest),
          plan.manifestJson,
        ),
      },
    ],
  );
  fsyncDirectory(paths.agentsDir);
  if (plan.skills.length > 0) fsyncDirectory(paths.skillsDir);
  fsyncDirectory(paths.manifestDir);
};

export const installKiroProfile = async (
  options: KiroInstallOptions & { dryRun?: boolean } = {},
): Promise<KiroInstallResult> => {
  const testOverrides = currentKiroInstallTestOverrides();
  const skipRuntimeClosure = testOverrides?.skipRuntimeClosure === true;
  const runtimeNodeSourcePath = testOverrides?.runtimeNodeSourcePath;
  if (options.enableSubagents === true) {
    const fabricConfig = options.fabricConfig ?? inspectFabricConfig({
      cwd: options.projectRoot ?? process.cwd(),
      agentDir: resolveAgentDir(),
      projectTrusted: false,
    });
    assertKiroAccountingCompatible(fabricConfig.agents, true);
  }

  let stagedNodeDir: string | undefined;
  let stagedNode: ExecutableAttestation | undefined;
  let kiroIdentity: SupportedKiroIdentity | undefined;
  try {
    if (!skipRuntimeClosure) {
      stagedNodeDir = mkdtempSync(join(tmpdir(), "kiro-fabric-node-stage-"));
      const source = attestExecutable(runtimeNodeSourcePath ?? options.nodePath ?? process.execPath);
      stagedNode = copyAttestedExecutable(source, join(stagedNodeDir, process.platform === "win32" ? "node.exe" : "node"));
    }

    let nodeIdentity: SupportedNodeIdentity;
    try {
      // Production probes the private staged inode that is subsequently hashed
      // and copied. Unit fixtures may inject a deliberately tiny non-Node
      // runtime, so only that test-internal path probes the requested bootstrap.
      nodeIdentity = await assertSupportedNode(
        runtimeNodeSourcePath ? options.nodePath ?? process.execPath : stagedNode?.path ?? options.nodePath ?? process.execPath,
      );
    } catch (error) {
      throw new KiroInstallError(
        "kiro-version",
        error instanceof Error ? error.message : String(error),
      );
    }
    const requestedKiroBinary = options.kiroBinary ?? "kiro-cli";
    kiroIdentity = await assertKiroVersion(requestedKiroBinary);
    const kiroBinary = kiroIdentity.executablePath;
    await assertKiroV3Capabilities(kiroIdentity);

    const roots = resolveKiroInstallRoots(options);
    // A killed activation leaves its fsynced journal behind. Recover it before
    // reading the manifest/profile so all owned leaves converge together.
    const recoveryPaths = managedPaths(roots.installRoot, roots.layout);
    if (existsSync(recoveryPaths.transaction)) {
      if (options.dryRun) {
        probeManagedTransactionRecovery(roots.installRoot, roots.layout);
        throw new KiroInstallError(
          "concurrency",
          "a recoverable lifecycle transaction is pending; dry-run left it unchanged",
        );
      }
      const recoveryLock = acquireOperationLock(roots.installRoot, roots.layout);
      try {
        recoverManagedTransaction(roots.installRoot, roots.layout);
      } finally {
        recoveryLock.release();
      }
    }
    if (options.repairRuntime) {
      const existingClosure = readManifest(roots.installRoot, roots.layout)?.runtime.closure;
      if (existingClosure) {
        const sourceRoot = resolve(resolveSourcePackageRoot());
        const installedReleaseRoot = resolve(
          roots.installRoot,
          ...existingClosure.root.split("/"),
        );
        if (sourceRoot === installedReleaseRoot) {
          try {
            verifyRuntimeClosureAttestation(roots.installRoot, existingClosure);
          } catch {
            throw new KiroInstallError(
              "ownership",
              "installed release is damaged and cannot be its own repair source; run repair from a trusted package or source bootstrap artifact",
            );
          }
        }
      }
    }
    const closurePlan = skipRuntimeClosure
      ? undefined
      : planRuntimeClosureDeployment(roots.installRoot, roots.layout, {
          nodeSourcePath: stagedNode!.path,
          nodeAttestation: stagedNode!,
          kiroAttestation: kiroIdentity,
          ...(options.repairRuntime ? { repairExisting: true } : {}),
        });
    if (
      options.dryRun && closurePlan &&
      hasPendingRuntimeClosureRepair(roots.installRoot, roots.layout, closurePlan.digest)
    ) {
      throw new KiroInstallError(
        "concurrency",
        "a recoverable runtime repair is pending; dry-run left it unchanged",
      );
    }
    const effectiveMcpEntry = closurePlan?.mcpEntryPath ?? options.mcpEntryPath;
    const planOptions: KiroInstallOptions = {
      ...options,
      nodePath: closurePlan?.runtimeNodePath ?? nodeIdentity.executablePath,
      kiroBinary,
      ...(effectiveMcpEntry ? { mcpEntryPath: effectiveMcpEntry } : {}),
    };
    const planned = planKiroProfileInstall(planOptions, {
      allowMissingMcpEntry: closurePlan?.action === "publish" || closurePlan?.action === "repair",
      ...(closurePlan ? { closure: closurePlan } : {}),
      kiroIdentity,
    });
    if (planned.action === "blocked") {
      throw new KiroInstallError("collision", planned.blockedReason ?? "profile collision");
    }
    await validateKiroProfile(planned.profileJson, kiroIdentity);
    if (options.dryRun) return resultFromPlan(planned, true, closurePlan);

    const lock = acquireOperationLock(planned.installRoot, planned.layout);
    try {
      recoverManagedTransaction(planned.installRoot, planned.layout);
      if (closurePlan) recoverRuntimeClosureRepair(roots.installRoot, roots.layout, closurePlan.attestation);
      if (stagedNode) assertExecutableAttestation(stagedNode);
      assertSupportedKiroUnchanged(kiroIdentity);
      const lockedClosurePlan = skipRuntimeClosure
        ? undefined
        : planRuntimeClosureDeployment(roots.installRoot, roots.layout, {
            nodeSourcePath: stagedNode!.path,
            nodeAttestation: stagedNode!,
            kiroAttestation: kiroIdentity,
            ...(options.repairRuntime ? { repairExisting: true } : {}),
          });
      if (closurePlan && lockedClosurePlan?.digest !== closurePlan.digest) {
        throw new KiroInstallError("concurrency", "runtime closure changed after preflight");
      }
      const lockedMcpEntry = lockedClosurePlan?.mcpEntryPath ?? options.mcpEntryPath;
      assertSupportedKiroUnchanged(kiroIdentity);
      const lockedKiroIdentity = kiroIdentity;
      const lockedOptions: KiroInstallOptions = {
        ...options,
        nodePath: lockedClosurePlan?.runtimeNodePath ?? nodeIdentity.executablePath,
        kiroBinary,
        ...(lockedMcpEntry ? { mcpEntryPath: lockedMcpEntry } : {}),
      };
      const plan = planKiroProfileInstall(lockedOptions, {
        allowMissingMcpEntry: lockedClosurePlan?.action === "publish" || lockedClosurePlan?.action === "repair",
        ...(lockedClosurePlan ? { closure: lockedClosurePlan } : {}),
        kiroIdentity: lockedKiroIdentity,
      });
      if (plan.action === "blocked") {
        throw new KiroInstallError("collision", plan.blockedReason ?? "profile collision");
      }
      if (plan.profileSha256 !== planned.profileSha256) {
        throw new KiroInstallError("concurrency", "generated profile changed after preflight");
      }

      const closureResult = lockedClosurePlan
        ? deployRuntimeClosure(roots.installRoot, roots.layout, {
            ...(options.force !== undefined ? { force: options.force } : {}),
            expectedDigest: lockedClosurePlan.digest,
            nodeSourcePath: stagedNode!.path,
            nodeAttestation: stagedNode!,
            kiroAttestation: lockedKiroIdentity,
            ...(options.repairRuntime ? { repairExisting: true } : {}),
            activate: false,
          })
        : undefined;
      const activationCurrent = plan.activation
        ? readManagedFileNoFollow(plan.installRoot, plan.activation.path)
        : null;
      const activationNeeded = plan.activation !== null &&
        sha256Bytes(plan.activation.nextBytes) !== (activationCurrent === null ? null : sha256Bytes(activationCurrent));
      if (plan.action !== "noop" || activationNeeded) {
        cleanupSupersededRuntimeGenerations(plan);
        commitInstall(plan);
      }
      return resultFromPlan(plan, false, closureResult);
    } finally {
      lock.release();
    }
  } finally {
    kiroIdentity?.dispose();
    if (stagedNodeDir) rmSync(stagedNodeDir, { recursive: true, force: true });
  }
};
