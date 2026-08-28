// Project-scoped Kiro profile installer. Plans deterministically without
// touching the filesystem (planKiroProfileInstall) and commits under an
// exclusive operation lock (installKiroProfile): verified content-addressed
// backup of displaced user bytes, manifest, then profile. Managed updates
// inherit the original displaced-user backup instead of replacing it.

import { execFile } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

import { inspectFabricConfig, type FabricConfig } from "../config.js";
import { resolveAgentDir } from "../core/agent-dir.js";
import { assertKiroAccountingCompatible } from "./accounting-compatibility.js";
import {
  acquireOperationLock,
  assertBackupBytes,
  assertManagedTree,
  assertNoSymlinkComponents,
  backupRelativePath,
  commitManagedTransaction,
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
  recoverManagedTransaction,
  readPackageVersion,
  resolveKiroProjectRoot,
  serializeJson,
  sha256Bytes,
  writeExclusive,
  type KiroBackupRecord,
  type KiroInstallManifest,
  type KiroManagedLayout,
} from "./managed.js";
import { resolveKiroInstallRoots } from "./home.js";
import {
  generateKiroProfile,
  kiroProfilePath,
  KIRO_AGENT_ENGINE,
  KIRO_CLI_VERSION,
} from "./profile.js";
import {
  deployRuntimeClosure,
  runtimeClosureMcpEntry,
  type RuntimeClosureResult,
} from "./runtime-closure.js";

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
  /** Node executable embedded in the profile; defaults to process.execPath. */
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
  /**
   * Skip runtime closure deployment. When true, the profile points directly
   * at the mcpEntryPath (legacy behavior for testing). Default: false.
   */
  skipRuntimeClosure?: boolean;
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
}

const buildManifest = (
  options: Required<Pick<KiroInstallOptions, "nodePath" | "mcpEntryPath">>,
  projectRoot: string,
  layout: KiroManagedLayout,
  profileDigest: string,
  backup: KiroBackupRecord | null,
): KiroInstallManifest => ({
  format: KIRO_INSTALL_MANIFEST_FORMAT,
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
    kiroCliVersion: KIRO_CLI_VERSION,
    agentEngine: KIRO_AGENT_ENGINE,
  },
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
  existing.packageVersion === desired.packageVersion &&
  existing.runtime.nodePath === desired.runtime.nodePath &&
  existing.runtime.mcpEntryPath === desired.runtime.mcpEntryPath &&
  existing.runtime.kiroCliVersion === desired.runtime.kiroCliVersion &&
  existing.runtime.agentEngine === desired.runtime.agentEngine &&
  existing.profile.installedSha256 === desired.profile.installedSha256 &&
  existing.profile.path === desired.profile.path &&
  backupRecordsEqual(existing.profile.backup, desired.profile.backup);

/** Scan sibling local profiles for a duplicate `name` declaration. */
const findNameCollision = (agentsDir: string, ownProfilePath: string): string | null => {
  const stat = lstatOrNull(agentsDir);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) return null;
  for (const entry of readdirSync(agentsDir)) {
    const path = join(agentsDir, entry);
    if (path === ownProfilePath) continue;
    const entryStat = lstatOrNull(path);
    if (!entryStat?.isFile() || entryStat.isSymbolicLink() || !entry.endsWith(".json")) {
      continue;
    }
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { name?: unknown };
      if (parsed.name === "kiro-fabric") return path;
    } catch {
      // malformed sibling JSON is not a collision
    }
  }
  return null;
};

export const planKiroProfileInstall = (
  options: KiroInstallOptions = {},
): KiroInstallPlan => {
  const { layout, installRoot, projectRoot: root } = resolveKiroInstallRoots(options);
  const nodePath = options.nodePath ?? process.execPath;
  const mcpEntryPath = options.mcpEntryPath ?? defaultMcpEntryPath();
  if (!isAbsolute(mcpEntryPath)) {
    throw new KiroInstallError("fs", `MCP entry path must be absolute: ${mcpEntryPath}`);
  }
  if (!existsSync(mcpEntryPath)) {
    throw new KiroInstallError("fs", `MCP entry not found (run pnpm build first): ${mcpEntryPath}`);
  }
  assertManagedTree(installRoot, layout);

  const paths = managedPaths(installRoot, layout);
  const profilePath = kiroProfilePath(installRoot, layout);
  const profile = generateKiroProfile({
    projectRoot: root,
    mcpEntryPath,
    nodePath,
    ...(options.allowShell ? { allowShell: true } : {}),
    ...(options.enableSubagents ? { enableSubagents: true } : {}),
    ...(options.allowTools ? { allowTools: true } : {}),
  });
  const profileJson = serializeJson(profile);
  const profileSha256 = sha256Bytes(profileJson);

  const collision = findNameCollision(paths.agentsDir, profilePath);
  if (collision) {
    throw new KiroInstallError(
      "collision",
      `another profile already declares name "kiro-fabric": ${collision}`,
    );
  }

  const manifest = readManifest(installRoot, layout);
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

  const desiredManifest = buildManifest(
    { nodePath, mcpEntryPath },
    root,
    layout,
    profileSha256,
    backupRecord,
  );
  if (action === "noop" && manifest && !manifestIsCurrent(manifest, desiredManifest)) {
    action = "update";
  }

  const backupPath = backupRecord
    ? join(installRoot, ...backupRecord.path.split("/"))
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
  };
};

const runKiro = async (
  kiroBinary: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> => {
  try {
    const { stdout, stderr } = await execFileAsync(kiroBinary, args, {
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    });
    return { stdout: String(stdout), stderr: String(stderr) };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const detail = `${err.stdout ?? ""}\n${err.stderr ?? ""}`.trim();
    throw new KiroInstallError(
      "kiro-validate",
      `kiro-cli ${args.join(" ")} failed${detail ? `: ${detail.slice(0, 2000)}` : `: ${err.message ?? String(error)}`}`,
    );
  }
};

/** Require exactly the supported Kiro version. */
export const assertKiroVersion = async (kiroBinary = "kiro-cli"): Promise<void> => {
  const { stdout, stderr } = await runKiro(kiroBinary, ["--version"]);
  const text = `${stdout}\n${stderr}`.trim();
  const match = /(?:^|\s)(\d+\.\d+\.\d+)\s*$/m.exec(text);
  if (!match || match[1] !== KIRO_CLI_VERSION) {
    throw new KiroInstallError(
      "kiro-version",
      `unsupported kiro-cli version "${text}"; expected ${KIRO_CLI_VERSION}`,
    );
  }
};

/** Prove the pinned CLI exposes the v3 ACP engine and CLI-owned auth path. */
export const assertKiroV3Capabilities = async (
  kiroBinary = "kiro-cli",
): Promise<void> => {
  const { stdout, stderr } = await runKiro(kiroBinary, ["acp", "--help"]);
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

const ERROR_DIAGNOSTIC = /\b(error|invalid|missing|failed)\b/i;

/**
 * Validate a profile document with `kiro-cli agent validate`. Kiro 2.20.1
 * can exit 0 while still printing error diagnostics, so output is parsed too.
 */
export const validateKiroProfile = async (
  profileJson: string,
  kiroBinary = "kiro-cli",
): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), "kiro-fabric-kiro-validate-"));
  try {
    const candidate = join(dir, "profile.json");
    await writeFile(candidate, profileJson, { mode: 0o600 });
    const { stdout, stderr } = await runKiro(kiroBinary, [
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
): KiroInstallResult => ({
  ok: true,
  dryRun,
  action: plan.action as KiroInstallAction,
  projectRoot: plan.projectRoot,
  profilePath: plan.profilePath,
  manifestPath: plan.manifestPath,
  backupPath: plan.backupPath,
  profileSha256: plan.profileSha256,
  ...(runtimeClosure ? { runtimeClosure } : {}),
});

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

  // Journal both leaves before either replacement. Recovery is idempotent:
  // each leaf may be either its exact expected bytes or exact target bytes.
  const currentManifest = readManagedFileNoFollow(plan.installRoot, plan.manifestPath);
  commitManagedTransaction(
    plan.installRoot,
    plan.layout,
    "install",
    managedFileTransition(plan.existingSha256, plan.profileJson),
    managedFileTransition(
      currentManifest === null ? null : sha256Bytes(currentManifest),
      plan.manifestJson,
    ),
  );
  fsyncDirectory(paths.agentsDir);
  fsyncDirectory(paths.manifestDir);
};

export const installKiroProfile = async (
  options: KiroInstallOptions & { dryRun?: boolean } = {},
): Promise<KiroInstallResult> => {
  if (options.enableSubagents === true) {
    const fabricConfig = options.fabricConfig ?? inspectFabricConfig({
      cwd: options.projectRoot ?? process.cwd(),
      agentDir: resolveAgentDir(),
      projectTrusted: false,
    });
    assertKiroAccountingCompatible(fabricConfig.agents, true);
  }

  if (!options.dryRun) {
    const roots = resolveKiroInstallRoots(options);
    const transaction = managedPaths(roots.installRoot, roots.layout).transaction;
    if (existsSync(transaction)) {
      const recoveryLock = acquireOperationLock(roots.installRoot, roots.layout);
      try {
        recoverManagedTransaction(roots.installRoot, roots.layout);
      } finally {
        recoveryLock.release();
      }
    }
  }

  // Deploy the runtime closure (copies dist/ and node_modules into the managed tree)
  // so the profile does not depend on the source checkout or npm global path.
  let closureResult: RuntimeClosureResult | undefined;
  let effectiveMcpEntry = options.mcpEntryPath;
  if (!options.skipRuntimeClosure && !options.dryRun) {
    const roots = resolveKiroInstallRoots(options);
    closureResult = deployRuntimeClosure(roots.installRoot, roots.layout, {
      ...(options.force !== undefined ? { force: options.force } : {}),
    });
    effectiveMcpEntry = closureResult.mcpEntryPath;
  } else if (!options.skipRuntimeClosure && options.dryRun) {
    // During dry-run, compute what the closure path WOULD be without deploying.
    // But only use it if it already exists (from a prior install).
    const roots = resolveKiroInstallRoots(options);
    const candidatePath = runtimeClosureMcpEntry(roots.installRoot, roots.layout);
    if (existsSync(candidatePath)) {
      effectiveMcpEntry = candidatePath;
    }
  }

  const planOptions: KiroInstallOptions = {
    ...options,
    ...(effectiveMcpEntry ? { mcpEntryPath: effectiveMcpEntry } : {}),
  };
  const planned = planKiroProfileInstall(planOptions);
  if (planned.action === "blocked") {
    throw new KiroInstallError("collision", planned.blockedReason ?? "profile collision");
  }

  const kiroBinary = options.kiroBinary ?? "kiro-cli";
  await assertKiroVersion(kiroBinary);
  await assertKiroV3Capabilities(kiroBinary);
  await validateKiroProfile(planned.profileJson, kiroBinary);

  if (options.dryRun) return resultFromPlan(planned, true, closureResult);

  const lock = acquireOperationLock(planned.installRoot, planned.layout);
  try {
    recoverManagedTransaction(planned.installRoot, planned.layout);
    const plan = planKiroProfileInstall(planOptions);
    if (plan.action === "blocked") {
      throw new KiroInstallError("collision", plan.blockedReason ?? "profile collision");
    }
    if (plan.action === "noop") return resultFromPlan(plan, false, closureResult);
    commitInstall(plan);
    return resultFromPlan(plan, false, closureResult);
  } finally {
    lock.release();
  }
};
