import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  prepareKiroPowerDataPaths,
  prepareKiroPowerProjectPaths,
  type KiroPowerWorkspaceIdentity,
} from "../src/kiro/power/data-paths.js";

const roots: string[] = [];
const temporary = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-migration-"));
  fs.chmodSync(root, 0o700);
  roots.push(root);
  return root;
};
afterEach(() => { while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true }); });
const workspaceId = (identity: KiroPowerWorkspaceIdentity, generation: 2 | 3): string => createHash("sha256")
  .update(`kiro-fabric-power-workspace-v${generation}\0`).update(identity.canonicalPath).update("\0")
  .update(identity.deviceId).update("\0").update(identity.fileId).digest("hex");

describe("retained Power data migration", () => {
  it("migrates the prior MCP filename once with private permissions", () => {
    const pluginData = temporary();
    const config = path.join(pluginData, "fabric", "config");
    fs.mkdirSync(config, { recursive: true, mode: 0o700 });
    fs.chmodSync(path.join(pluginData, "fabric"), 0o700);
    const legacy = { mcpServers: { fixture: { command: "fixture", args: [] } }, imports: [] };
    fs.writeFileSync(path.join(config, "mcporter.json"), `${JSON.stringify(legacy)}\n`, { mode: 0o600 });
    const first = prepareKiroPowerDataPaths(pluginData);
    expect(JSON.parse(fs.readFileSync(first.mcpConfig, "utf8"))).toEqual(legacy);
    expect(fs.statSync(first.mcpConfig).mode & 0o777).toBe(0o600);
    const second = prepareKiroPowerDataPaths(pluginData);
    expect(second.mcpConfig).toBe(first.mcpConfig);
    expect(fs.existsSync(path.join(first.root, "migration-report.json"))).toBe(true);
  });

  it("maps only an identity-verified v2 workspace generation and preserves retained data", () => {
    const pluginData = temporary();
    const data = prepareKiroPowerDataPaths(pluginData);
    const workspace = temporary();
    const stats = fs.statSync(workspace);
    const identity: KiroPowerWorkspaceIdentity = {
      schemaVersion: 1,
      canonicalPath: fs.realpathSync(workspace),
      deviceId: String(stats.dev),
      fileId: String(stats.ino),
    };
    const legacy = path.join(data.projects, workspaceId(identity, 2));
    fs.mkdirSync(path.join(legacy, "state"), { recursive: true, mode: 0o700 });
    fs.chmodSync(legacy, 0o700);
    fs.writeFileSync(path.join(legacy, "workspace-identity.json"), `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
    fs.writeFileSync(path.join(legacy, "state", "preserved.fixture"), "retained", { mode: 0o600 });
    const migrated = prepareKiroPowerProjectPaths(data.projects, identity);
    expect(path.basename(migrated.root)).toBe(workspaceId(identity, 3));
    expect(fs.existsSync(path.join(migrated.state, "preserved.fixture"))).toBe(false);
    expect(fs.existsSync(legacy)).toBe(false);
    const quarantined = path.join(data.projects, ".quarantine", `workspace-v2-${workspaceId(identity, 2)}`);
    expect(fs.readFileSync(path.join(quarantined, "state", "preserved.fixture"), "utf8")).toBe("retained");
    expect(prepareKiroPowerProjectPaths(data.projects, identity).root).toBe(migrated.root);
  });

  it("fails closed when the prior workspace identity does not match", () => {
    const data = prepareKiroPowerDataPaths(temporary());
    const identity: KiroPowerWorkspaceIdentity = { schemaVersion: 1, canonicalPath: "/verified", deviceId: "1", fileId: "2" };
    const legacy = path.join(data.projects, workspaceId(identity, 2));
    fs.mkdirSync(legacy, { mode: 0o700 });
    fs.writeFileSync(path.join(legacy, "workspace-identity.json"), JSON.stringify({ ...identity, fileId: "foreign" }), { mode: 0o600 });
    expect(() => prepareKiroPowerProjectPaths(data.projects, identity)).toThrow("does not match");
    expect(fs.existsSync(legacy)).toBe(true);
  });
});
