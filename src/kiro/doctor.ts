// Read-only, non-billable Kiro doctor. Runs against an isolated temporary
// workspace — never writes .kiro into the user's project — and:
//   1. pins the supported Node/Kiro tuple,
//   2. shape-checks the generated profile,
//   3. validates it with kiro-cli (plus a negative control that must produce
//      a diagnostic, since Kiro 2.20.1 can exit 0 on invalid profiles),
//   4. negotiates MCP initialize/tools/list and executes a deterministic
//      fabric_exec call with the actual built adapter,
//   5. starts real ACP, injects/activates the v3 agent, restarts ACP and reloads
//      the same empty session, then deletes it — with zero session/prompt frames.

import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { inspectFabricConfig, type FabricConfig } from "../config.js";
import { resolveAgentDir } from "../core/agent-dir.js";
import { fabricExecInputSchemaJson } from "../kernel/fabric-exec-contract.js";
import { assertKiroAccountingCompatible } from "./accounting-compatibility.js";
import {
  assertSupportedNode,
  KIRO_ACP_AUTH_METHOD,
  KIRO_AGENT_ENGINE,
  KIRO_BINARY_ENV,
  KIRO_CLI_VERSION,
  KIRO_VERSION_ENV,
  sameExecutableIdentity,
  type SupportedKiroIdentity,
} from "./compatibility.js";
import { generateKiroProfile } from "./profile.js";
import { spawnJsonRpcProcess } from "./supervisor.js";
import {
  assertKiroV3Capabilities,
  assertKiroVersion,
  validateKiroProfile,
} from "./install.js";
import {
  lstatOrNull,
  readPackageVersion,
  managedPaths,
  readManagedFileNoFollow,
  readManifest,
  sha256Bytes,
  type KiroInstallManifest,
  type KiroManagedLayout,
} from "./managed.js";
import { resolveKiroInstallRoots } from "./home.js";
import {
  runtimeClosurePath,
  verifyRuntimeClosureAttestation,
} from "./runtime-closure.js";
import { managedKiroSkillBundleSha256 } from "./skills.js";
import {
  assertKiroV3AgentModeAvailable,
  buildKiroV3SessionParams,
  KIRO_V3_AGENT_MODE,
} from "./v3-session.js";

export interface KiroDoctorCheck {
  id: string;
  status: "pass" | "fail" | "skipped";
  durationMs: number;
  message: string;
}

export interface KiroDoctorReport {
  schemaVersion: 1;
  kind: "kiro-fabric.kiro-doctor";
  ok: boolean;
  nonBillable: true;
  modelTurnsRequested: 0;
  observed: {
    node: { path: string; version: string };
    kiro: { path: string; version: string | null };
    agentEngine: typeof KIRO_AGENT_ENGINE;
    authMethod: typeof KIRO_ACP_AUTH_METHOD;
    platform: NodeJS.Platform;
    arch: string;
  };
  checks: KiroDoctorCheck[];
  summary: { passed: number; failed: number; skipped: number };
}

export interface KiroDoctorOptions {
  kiroBinary?: string;
  mcpEntryPath?: string;
  /** Fabric configuration override for deterministic read-only probes. */
  fabricConfig?: FabricConfig;
  /** Opt in to read-only verification of a concrete managed installation. */
  checkInstalled?: boolean;
  projectRoot?: string;
  scope?: KiroManagedLayout;
  kiroHome?: string;
}

const defaultMcpEntry = (): string => {
  const layout = join(import.meta.dirname, "mcp-entry.js");
  if (existsSync(layout)) return layout;
  return resolve(import.meta.dirname, "..", "kiro", "mcp-entry.js");
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, i) => deepEqual(value, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return (
      aKeys.length === bKeys.length &&
      aKeys.every((key) => key in b && deepEqual(a[key], b[key]))
    );
  }
  return false;
};

export const runKiroDoctor = async (
  options: KiroDoctorOptions = {},
): Promise<KiroDoctorReport> => {
  let kiroBinary = options.kiroBinary ?? "kiro-cli";
  let managedKiroBinaryPath: string | undefined;
  let observedKiro: SupportedKiroIdentity | undefined;
  const mcpEntryPath =
    options.mcpEntryPath ?? defaultMcpEntry();
  const checks: KiroDoctorCheck[] = [];
  let tupleFailed = false;

  const run = async (
    id: string,
    probe: () => Promise<string>,
  ): Promise<boolean> => {
    const started = Date.now();
    try {
      const message = await probe();
      checks.push({ id, status: "pass", durationMs: Date.now() - started, message });
      return true;
    } catch (error) {
      checks.push({
        id,
        status: "fail",
        durationMs: Date.now() - started,
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };
  const skip = (id: string, message: string): void => {
    checks.push({ id, status: "skipped", durationMs: 0, message });
  };

  if (options.checkInstalled || options.projectRoot || options.kiroHome) {
    const roots = resolveKiroInstallRoots(options);
    const paths = managedPaths(roots.installRoot, roots.layout);
    const manifestOk = await run("install.manifest", async () => {
      const manifest = readManifest(roots.installRoot, roots.layout);
      if (!manifest) throw new Error("managed install manifest is absent");
      const profile = readManagedFileNoFollow(roots.installRoot, paths.profile);
      if (!profile) throw new Error("managed installed profile is absent");
      if (sha256Bytes(profile) !== manifest.profile.installedSha256) {
        throw new Error("managed installed profile hash mismatch");
      }
      if (manifest.runtime.kiroBinaryPath) {
        managedKiroBinaryPath = manifest.runtime.kiroBinaryPath;
        if (options.kiroBinary === undefined) kiroBinary = managedKiroBinaryPath;
        const document = JSON.parse(profile.toString("utf8")) as {
          mcpServers?: { fabric?: { env?: Record<string, unknown> } };
        };
        const env = document.mcpServers?.fabric?.env;
        if (
          env?.[KIRO_BINARY_ENV] !== manifest.runtime.kiroBinaryPath ||
          env?.[KIRO_VERSION_ENV] !== manifest.runtime.kiroCliVersion
        ) {
          throw new Error("managed profile Kiro executable identity does not match manifest");
        }
      }
      return manifest.format === 1
        ? "legacy format-1 profile ownership verified"
        : "format-2 profile and manifest ownership verified";
    });
    const installedManifest: KiroInstallManifest | null = manifestOk
      ? readManifest(roots.installRoot, roots.layout)
      : null;
    if (!manifestOk || !installedManifest) {
      skip("install.skills", "dependency_failed");
      skip("install.runtime-closure", "dependency_failed");
    } else if (installedManifest.format === 1) {
      skip("install.skills", "legacy format-1 manifest has no skill attestation");
      skip("install.runtime-closure", "legacy format-1 manifest has no closure attestation");
    } else {
      await run("install.skills", async () => {
        const records = installedManifest!.skills?.files;
        if (!records || records.length === 0) throw new Error("managed skill attestation is absent");
        const sources = records.map((record) => {
          const path = join(roots.installRoot, ...record.path.split("/"));
          const bytes = readManagedFileNoFollow(roots.installRoot, path);
          if (!bytes) throw new Error("managed skill is absent: " + record.path);
          if (sha256Bytes(bytes) !== record.installedSha256) {
            throw new Error("managed skill hash mismatch: " + record.path);
          }
          const marker = record.path.indexOf("skills/");
          return {
            sourceRelative: record.path.slice(marker + "skills/".length),
            installedRelative: record.path,
            installedPath: path,
            bytes,
            sha256: record.installedSha256,
          };
        });
        if (managedKiroSkillBundleSha256(sources) !== installedManifest!.skills!.bundleSha256) {
          throw new Error("managed skill bundle digest mismatch");
        }
        return records.length + " managed skill files verified";
      });
      await run("install.runtime-closure", async () => {
        const closure = installedManifest!.runtime.closure;
        if (!closure) throw new Error("runtime closure attestation is absent");
        verifyRuntimeClosureAttestation(roots.installRoot, closure);
        const marker = join(runtimeClosurePath(roots.installRoot, roots.layout), ".closure-current");
        const stat = lstatOrNull(marker);
        if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
          throw new Error("runtime closure marker is missing or invalid");
        }
        if (readFileSync(marker, "utf8").trim() !== closure.digest) {
          throw new Error("runtime closure marker digest mismatch");
        }
        return closure.files.length + " runtime closure files verified";
      });
    }
  }

  await run("config.accounting", async () => {
    const config = options.fabricConfig ?? inspectFabricConfig({
      cwd: process.cwd(),
      agentDir: resolveAgentDir(),
      projectTrusted: false,
    });
    assertKiroAccountingCompatible(config.agents);
    return config.agents.runner === "kiro"
      ? "configured Kiro accounting ceilings are disabled"
      : `configured agent runner ${config.agents.runner} does not use Kiro ACP`;
  });

  const workspace = await mkdtemp(join(tmpdir(), "kiro-fabric-kiro-doctor-"));
  const projectRoot = join(workspace, "project");
  await mkdir(projectRoot, { recursive: true });

  try {
    await run("tuple", async () => {
      const node = await assertSupportedNode(process.execPath);
      const kiro = await assertKiroVersion(kiroBinary);
      if (
        managedKiroBinaryPath &&
        (!sameExecutableIdentity(kiro.executablePath, managedKiroBinaryPath) ||
          kiro.version !== KIRO_CLI_VERSION)
      ) {
        throw new Error("selected Kiro executable does not match the managed manifest identity");
      }
      await assertKiroV3Capabilities(kiro.executablePath);
      kiroBinary = kiro.executablePath;
      observedKiro = kiro;
      return `Node ${node.version} + kiro-cli ${kiro.version} / ${KIRO_AGENT_ENGINE} / auth ${KIRO_ACP_AUTH_METHOD}`;
    }).then((ok) => {
      tupleFailed = !ok;
    });

    const profile = generateKiroProfile({
      projectRoot,
      mcpEntryPath,
      nodePath: process.execPath,
      ...(observedKiro
        ? {
            kiroBinaryPath: observedKiro.executablePath,
            kiroCliVersion: observedKiro.version,
          }
        : {}),
    });
    const profileJson = JSON.stringify(profile, null, 2) + "\n";

    const shapeOk = await run("profile.shape", async () => {
      const keys = Object.keys(profile.mcpServers);
      if (keys.length !== 1 || keys[0] !== "fabric") {
        throw new Error(`expected exactly one MCP server "fabric", got ${JSON.stringify(keys)}`);
      }
      if (JSON.stringify(profile.tools) !== JSON.stringify(["@fabric/fabric_exec"])) {
        throw new Error("profile tools must be exactly @fabric/fabric_exec");
      }
      if (JSON.stringify(profile.allowedTools) !== JSON.stringify(["@fabric/fabric_exec"])) {
        throw new Error("profile allowedTools compatibility mirror must be exactly @fabric/fabric_exec");
      }
      if (profile.includeMcpJson !== false) throw new Error("includeMcpJson must be false");
      if (profile.includePowers !== false) throw new Error("includePowers must be false");
      const rules = profile.permissions.rules;
      if (
        rules.length !== 1 ||
        rules[0]?.capability !== "mcp" ||
        rules[0]?.effect !== "ask" ||
        rules[0]?.match?.length !== 1 ||
        rules[0]?.match[0] !== "fabric/fabric_exec"
      ) {
        throw new Error("default profile must carry exactly one exact Fabric ask rule");
      }
      if (JSON.stringify(profile).includes("--trust-all-tools")) {
        throw new Error("profile contains --trust-all-tools");
      }
      return "fail-closed profile shape";
    });

    let profileValid = false;
    if (!tupleFailed && shapeOk) {
      profileValid = await run("profile.validate", async () => {
        await validateKiroProfile(profileJson, kiroBinary);
        return "kiro-cli agent validate clean";
      });
      await run("profile.negative-control", async () => {
        const invalid = { ...profile } as Record<string, unknown>;
        delete invalid.name;
        let diagnosed = false;
        try {
          await validateKiroProfile(JSON.stringify(invalid, null, 2) + "\n", kiroBinary);
        } catch {
          diagnosed = true;
        }
        if (!diagnosed) {
          throw new Error("validator accepted a profile missing required name; validator is not proving anything");
        }
        return "invalid profile produces a diagnostic";
      });
    } else {
      skip("profile.validate", "dependency_failed");
      skip("profile.negative-control", "dependency_failed");
    }

    // --- actual built MCP adapter over stdio ---
    const mcp = spawnJsonRpcProcess({
      argv: [process.execPath, mcpEntryPath],
      cwd: projectRoot,
      env: { ...process.env, KIRO_FABRIC_PROJECT_ROOT: projectRoot },
      timeoutMs: 30_000,
    });
    let mcpOk = true;
    mcpOk =
      (await run("mcp.initialize", async () => {
        const result = (await mcp.call<Record<string, unknown>>("initialize", {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "kiro-fabric-doctor", version: "1" },
        })) as Record<string, unknown>;
        const serverInfo = result.serverInfo as { name?: string } | undefined;
        if (serverInfo?.name !== "kiro-fabric") {
          throw new Error(`unexpected serverInfo: ${JSON.stringify(serverInfo)}`);
        }
        if (!isRecord(result.capabilities) || !("tools" in result.capabilities)) {
          throw new Error("tools capability missing");
        }
        mcp.notify("notifications/initialized", {});
        return "initialize negotiated";
      })) && mcpOk;

    if (mcpOk) {
      await run("mcp.tools-list", async () => {
        const result = (await mcp.call<{ tools?: unknown[] }>("tools/list", {}));
        const tools = result.tools ?? [];
        if (tools.length !== 1) throw new Error(`expected exactly one tool, got ${tools.length}`);
        const tool = tools[0] as { name?: string; inputSchema?: unknown };
        if (tool.name !== "fabric_exec") throw new Error(`unexpected tool ${String(tool.name)}`);
        if (!deepEqual(tool.inputSchema, fabricExecInputSchemaJson())) {
          throw new Error("inputSchema differs from the kernel golden schema");
        }
        return "exactly fabric_exec with the golden schema";
      }).then((ok) => {
        mcpOk = ok;
      });
    } else {
      skip("mcp.tools-list", "dependency_failed");
    }

    if (mcpOk) {
      await run("mcp.fabric-exec", async () => {
        const result = await mcp.call<{
          content?: Array<{ type?: unknown; text?: unknown }>;
          isError?: unknown;
        }>("tools/call", {
          name: "fabric_exec",
          arguments: { code: "return 1 + 2;" },
        });
        const text = result.content?.find((entry) => entry.type === "text")?.text;
        if (result.isError === true || text !== "3") {
          throw new Error(`fabric_exec deterministic probe failed: ${JSON.stringify(result).slice(0, 500)}`);
        }
        return "fabric_exec returned the deterministic result 3";
      });
    } else {
      skip("mcp.fabric-exec", "dependency_failed");
    }

    await run("mcp.shutdown", async () => {
      const { escalated } = await mcp.terminate();
      if (escalated) throw new Error("MCP server ignored SIGTERM; SIGKILL required");
      return "process group reaped";
    });

    // --- real ACP startup, v3 binding, and cross-process reload; zero prompts ---
    // Only meaningful when the Kiro tuple and profile validation already
    // passed; otherwise skip the whole ACP group instead of waiting out a
    // 60s timeout against a binary that cannot serve ACP.
    if (tupleFailed || !profileValid) {
      skip("acp.initialize", "dependency_failed");
      skip("acp.session-new", "dependency_failed");
      skip("acp.no-prompt", "dependency_failed");
      skip("acp.shutdown", "dependency_failed");
      skip("acp.resume-initialize", "dependency_failed");
      skip("acp.session-load", "dependency_failed");
      skip("acp.resume-no-prompt", "dependency_failed");
      skip("acp.session-delete", "dependency_failed");
      skip("acp.resume-shutdown", "dependency_failed");
    } else {
      const doctorKiroHome = join(workspace, "kiro-runtime-v3", ".kiro");
      await mkdir(doctorKiroHome, { recursive: true });
      const acpArgv = [
        kiroBinary,
        "acp",
        "--agent-engine",
        KIRO_AGENT_ENGINE,
        "--auth-method",
        KIRO_ACP_AUTH_METHOD,
      ];
      const spawnDoctorAcp = () => spawnJsonRpcProcess({
        argv: acpArgv,
        cwd: projectRoot,
        env: { ...process.env, KIRO_HOME: doctorKiroHome },
        timeoutMs: 60_000,
      });
      const initializeAcp = async (
        acp: ReturnType<typeof spawnJsonRpcProcess>,
      ): Promise<void> => {
        const result = await acp.call<Record<string, unknown>>("initialize", {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: {
            name: "kiro-fabric-doctor",
            version: readPackageVersion(),
          },
        });
        if (
          result.protocolVersion !== 1 ||
          !isRecord(result.agentCapabilities)
        ) {
          throw new Error(`unexpected ACP initialize result: ${JSON.stringify(result).slice(0, 300)}`);
        }
      };
      const activateAgent = async (
        acp: ReturnType<typeof spawnJsonRpcProcess>,
        sessionId: string,
      ): Promise<void> => {
        await acp.call("session/set_mode", {
          sessionId,
          modeId: KIRO_V3_AGENT_MODE,
        });
        await acp.call("session/set_config_option", {
          sessionId,
          configId: "autopilot",
          value: "off",
        });
      };
      const assertNoPrompt = (acp: ReturnType<typeof spawnJsonRpcProcess>): string => {
        if (acp.outboundMethods.includes("session/prompt")) {
          throw new Error("doctor sent session/prompt; that would be a billable turn");
        }
        return `outbound methods: ${acp.outboundMethods.join(", ") || "(none)"}`;
      };

      const acp = spawnDoctorAcp();
      let acpOk = await run("acp.initialize", async () => {
        await initializeAcp(acp);
        return "ACP initialize negotiated";
      });
      let createdSessionId: string | undefined;
      if (acpOk) {
        acpOk = await run("acp.session-new", async () => {
          const result = await acp.call<Record<string, unknown>>(
            "session/new",
            buildKiroV3SessionParams(profile, projectRoot),
          );
          assertKiroV3AgentModeAvailable(result);
          createdSessionId = typeof result.sessionId === "string" ? result.sessionId : undefined;
          if (!createdSessionId) throw new Error("session/new returned no sessionId");
          await activateAgent(acp, createdSessionId);
          return `session ${createdSessionId}; injected mode ${KIRO_V3_AGENT_MODE}`;
        });
      } else {
        skip("acp.session-new", "dependency_failed");
      }

      const noPromptOk = await run("acp.no-prompt", async () => assertNoPrompt(acp));
      const shutdownOk = await run("acp.shutdown", async () => {
        const { escalated } = await acp.terminate();
        if (escalated) throw new Error("kiro acp ignored SIGTERM; SIGKILL required");
        return "process group reaped";
      });

      if (!acpOk || !noPromptOk || !shutdownOk || !createdSessionId) {
        skip("acp.resume-initialize", "dependency_failed");
        skip("acp.session-load", "dependency_failed");
        skip("acp.resume-no-prompt", "dependency_failed");
        skip("acp.session-delete", "dependency_failed");
        skip("acp.resume-shutdown", "dependency_failed");
      } else {
        const resumeSessionId = createdSessionId;
        const resumed = spawnDoctorAcp();
        const resumeInitOk = await run("acp.resume-initialize", async () => {
          await initializeAcp(resumed);
          return "second ACP process initialized";
        });
        if (resumeInitOk) {
          await run("acp.session-load", async () => {
            const result = await resumed.call<Record<string, unknown>>("session/load", {
              sessionId: resumeSessionId,
              ...buildKiroV3SessionParams(profile, projectRoot),
            });
            assertKiroV3AgentModeAvailable(result);
            if (typeof result.sessionId === "string" && result.sessionId !== resumeSessionId) {
              throw new Error("session/load returned a different sessionId");
            }
            await activateAgent(resumed, resumeSessionId);
            return `reloaded session ${resumeSessionId} with injected mode ${KIRO_V3_AGENT_MODE}`;
          });
        } else {
          skip("acp.session-load", "dependency_failed");
        }
        await run("acp.resume-no-prompt", async () => assertNoPrompt(resumed));
        if (resumeInitOk) {
          await run("acp.session-delete", async () => {
            await resumed.call("_kiro/session/delete", { sessionId: resumeSessionId });
            return "empty doctor session deleted";
          });
        } else {
          skip("acp.session-delete", "dependency_failed");
        }
        await run("acp.resume-shutdown", async () => {
          const { escalated } = await resumed.terminate();
          if (escalated) throw new Error("resumed kiro acp ignored SIGTERM; SIGKILL required");
          return "second process group reaped";
        });
      }
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }

  const passed = checks.filter((check) => check.status === "pass").length;
  const failed = checks.filter((check) => check.status === "fail").length;
  const skipped = checks.filter((check) => check.status === "skipped").length;

  return {
    schemaVersion: 1,
    kind: "kiro-fabric.kiro-doctor",
    ok: failed === 0,
    nonBillable: true,
    modelTurnsRequested: 0,
    observed: {
      node: { path: process.execPath, version: process.versions.node },
      kiro: {
        path: observedKiro?.executablePath ?? kiroBinary,
        version: tupleFailed ? null : observedKiro?.version ?? null,
      },
      agentEngine: KIRO_AGENT_ENGINE,
      authMethod: KIRO_ACP_AUTH_METHOD,
      platform: process.platform,
      arch: process.arch,
    },
    checks,
    summary: { passed, failed, skipped },
  };
};
