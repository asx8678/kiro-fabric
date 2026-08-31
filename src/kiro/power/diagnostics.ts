import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_FABRIC_CONFIG } from "../../config.js";
import { inspectKiroCompatibility } from "../compatibility.js";
import { resolveSourcePackageRoot } from "../runtime-closure.js";
import { resolveKiroPowerLaunchContext } from "./launch-context.js";
import { prepareKiroPowerDataPaths } from "./data-paths.js";
import { prepareKiroRuntime } from "../runtime.js";

export interface KiroPowerDoctorReport {
  ok: boolean;
  nonBillable: true;
  modelTurnsRequested: 0;
  checks: Array<{ id: string; status: "pass" | "fail" | "skip"; message: string }>;
  kiroAcp: "unavailable" | "incompatible";
}

export const runKiroPowerDoctor = async (): Promise<KiroPowerDoctorReport> => {
  const checks: KiroPowerDoctorReport["checks"] = [];
  const run = async (id: string, operation: () => string | Promise<string>) => {
    try { checks.push({ id, status: "pass", message: await operation() }); }
    catch (error) { checks.push({ id, status: "fail", message: (error as Error).message }); }
  };
  await run("power.node", () => {
    if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Node 24 or newer is required");
    return `Node ${process.version} at ${process.execPath}`;
  });
  const root = resolveSourcePackageRoot();
  await run("power.launcher", () => {
    const mcp = JSON.parse(readFileSync(path.join(root, "mcp.json"), "utf8")) as {
      mcpServers?: { fabric?: { command?: unknown; args?: unknown } };
    };
    const server = mcp.mcpServers?.fabric;
    const expected = "${PLUGIN_ROOT}/dist/kiro-power-closure/kiro/mcp-entry.js";
    if (server?.command !== "node" || !Array.isArray(server.args) || server.args[0] !== expected) {
      throw new Error("release manifest does not launch the bundled runtime closure");
    }
    if (!existsSync(path.join(root, "dist", "kiro-power-closure", "kiro", "mcp-entry.js"))) {
      throw new Error("bundled Power runtime closure is absent");
    }
    return "bundled runtime closure available without activation-time download";
  });
  await run("power.manifests", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    const plugin = JSON.parse(readFileSync(path.join(root, "plugin.json"), "utf8"));
    const mcp = JSON.parse(readFileSync(path.join(root, "mcp.json"), "utf8"));
    if (plugin.version !== pkg.version || !mcp.mcpServers?.fabric) throw new Error("Power manifests are missing or out of sync");
    return `Agent Plugins 1.0.0 manifests synchronized at ${pkg.version}`;
  });
  await run("power.skills", () => {
    for (const name of ["fabric-exec", "fabric-orchestration"]) if (!existsSync(path.join(root, "skills", name, "SKILL.md"))) throw new Error(`missing ${name} skill`);
    return "Power skills present";
  });
  const temp = mkdtempSync(path.join(tmpdir(), "kiro-fabric-power-doctor-"));
  const pluginData = path.join(temp, "data");
  const pluginRoot = path.join(temp, "plugin");
  try {
    const { mkdirSync } = await import("node:fs"); mkdirSync(pluginData); mkdirSync(pluginRoot);
    let powerData: ReturnType<typeof prepareKiroPowerDataPaths> | undefined;
    await run("power.launch", () => {
      const launch = resolveKiroPowerLaunchContext({ PLUGIN_ROOT: pluginRoot, PLUGIN_DATA: pluginData });
      powerData = prepareKiroPowerDataPaths(launch.pluginData);
      return "PLUGIN_ROOT/PLUGIN_DATA confinement and writable data verified";
    });
    await run("power.quickjs", async () => {
      const config = structuredClone(DEFAULT_FABRIC_CONFIG);
      config.executor.runtime = "quickjs";
      const runtime = await prepareKiroRuntime({
        cwd: pluginData,
        integration: "power",
        config,
        powerMcpConfigPath: powerData!.mcpConfig,
      });
      try {
        const result = await runtime.service.execute({ code: "return 'ok'", signal: undefined, parentToolCallId: "doctor:power", host: runtime.host, onPartial() {} });
        if (!result.success) throw new Error("checked QuickJS probe failed");
      } finally { await runtime.close(); }
      return "checked QuickJS base available; workspace remains unbound";
    });
  } finally { rmSync(temp, { recursive: true, force: true }); }
  const kiro = await inspectKiroCompatibility(process.env.KIRO_FABRIC_KIRO_BINARY ?? "kiro-cli");
  const kiroAcp: KiroPowerDoctorReport["kiroAcp"] =
    kiro.ok || kiro.state === "not-found" ? "unavailable" : "incompatible";
  checks.push({
    id: "power.kiro-acp",
    status: "skip",
    message: kiro.ok
      ? `kiro-cli ${kiro.version} is present; Power ACP agents remain omitted until the no-prompt ACP client gate is qualified`
      : `optional Kiro ACP agents ${kiroAcp}: ${kiro.state}`,
  });
  return { ok: checks.every((entry) => entry.status !== "fail"), nonBillable: true, modelTurnsRequested: 0, checks, kiroAcp };
};
