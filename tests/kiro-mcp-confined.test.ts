// The built Kiro MCP stdio entry must never die before the initialize
// handshake when a confined trusted profile refuses to start: kiro-cli
// otherwise reports an opaque "connection closed: initialize response"
// instead of the fail-closed reason. This test spawns the real
// dist/kiro/mcp-entry.js exactly like kiro-cli does (newline JSON-RPC) from
// an ambient cwd outside the recorded project root and requires the child to
// answer initialize with a JSON-RPC error naming the confinement.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { spawnJsonRpcProcess } from "../src/kiro/supervisor.js";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const mcpEntry = path.join(repoRoot, "dist", "kiro", "mcp-entry.js");
const node = process.execPath;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const fixture = () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-fabric-confined-"));
  // macOS /tmp resolves through /private; canonicalize first so the test root
  // is not seen as "reached through a symlink" by the confinement precheck.
  const canonicalBase = fs.realpathSync(base);
  roots.push(base);
  const project = fs.mkdtempSync(path.join(canonicalBase, "project-"));
  const ambient = fs.mkdtempSync(path.join(canonicalBase, "ambient-"));
  const identity = fs.statSync(project, { bigint: true });
  return { base, project: fs.realpathSync(project), ambient: fs.realpathSync(ambient), identity };
};

const confinedEnv = (
  project: string,
  identity: fs.BigIntStats,
): NodeJS.ProcessEnv => ({
  ...process.env,
  KIRO_FABRIC_HOST: "kiro-v3",
  KIRO_FABRIC_PROFILE_KIND: "managed-main",
  KIRO_FABRIC_PROJECT_ROOT: project,
  KIRO_FABRIC_PROJECT_ROOT_DEV: String(identity.dev),
  KIRO_FABRIC_PROJECT_ROOT_INO: String(identity.ino),
  KIRO_FABRIC_ENFORCE_PROJECT_ROOT: "1",
  KIRO_FABRIC_ALLOW_SHELL: "1",
  KIRO_FABRIC_ENABLE_SUBAGENTS: "1",
  KIRO_FABRIC_ALLOW_TOOLS: "1",
});

describe.skipIf(!fs.existsSync(mcpEntry))("Kiro MCP entry fail-closed diagnostics", () => {
  it("serves the confinement reason over initialize instead of closing the connection", async () => {
    const { project, ambient, identity } = fixture();
    const child = spawnJsonRpcProcess({
      argv: [node, mcpEntry],
      cwd: ambient,
      env: confinedEnv(project, identity),
      timeoutMs: 15_000,
    });
    try {
      await expect(child.call("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "kiro-mcp-confined", version: "1" },
      })).rejects.toThrow(/outside that project|kiro-fabric MCP server failed to start/i);
    } finally {
      await child.terminate(200, 1_000);
    }
  }, 20_000);

  it("still starts from inside the unchanged confined project", async () => {
    const { project, identity } = fixture();
    const child = spawnJsonRpcProcess({
      argv: [node, mcpEntry],
      cwd: project,
      env: confinedEnv(project, identity),
      timeoutMs: 15_000,
    });
    try {
      const result = (await child.call<{ serverInfo?: { name?: string } }>("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "kiro-mcp-confined", version: "1" },
      }));
      expect(result.serverInfo?.name).toBe("kiro-fabric");
    } finally {
      await child.terminate(200, 1_000);
    }
  }, 20_000);
});
