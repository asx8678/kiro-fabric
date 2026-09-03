import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FABRIC_CONFIG,
  DEFAULT_FABRIC_POWER_CONFIG,
  loadFabricConfig,
  loadFabricPowerConfig,
  normalizeFabricConfig,
  normalizeFabricPowerConfig,
  supportsKiroElicitation,
  supportsKiroPowerElicitation,
} from "../src/index.js";
import { prepareKiroPowerDataPaths } from "../src/kiro/power/data-paths.js";

describe("Agent-only configuration", () => {
  it("exposes only active configured-MCP settings", () => {
    expect(Object.keys(DEFAULT_FABRIC_CONFIG.mcp).sort()).toEqual([
      "callTimeoutMs",
      "disableOAuth",
      "enabled",
    ]);
    const normalized = normalizeFabricConfig({
      mcp: {
        enabled: false,
        callTimeoutMs: 5_000,
      },
    });
    expect(normalized.mcp).toEqual({
      enabled: false,
      disableOAuth: true,
      callTimeoutMs: 5_000,
    });
  });

  it("caps configurable memory limits at the enforced storage bounds", () => {
    expect(normalizeFabricConfig({
      memory: { enabled: true, maxEntries: 10_000, maxValueChars: 2_000_000 },
    }).memory).toEqual({
      enabled: true,
      maxEntries: 128,
      maxValueChars: 16_000,
    });
  });

  it("bounds and privatizes the configured-MCP file under Fabric data", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-plugin-data-"));
    try {
      const data = prepareKiroPowerDataPaths(root);
      expect(fs.statSync(data.mcpConfig).mode & 0o777).toBe(0o600);
      fs.writeFileSync(data.mcpConfig, " ".repeat(1024 * 1024 + 1));
      expect(() => prepareKiroPowerDataPaths(root)).toThrow("exceeds 1048576 bytes");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects configuration path aliases", () => {
    if (process.platform === "win32") return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-config-alias-"));
    try {
      const target = path.join(root, "target.json");
      const alias = path.join(root, "config.json");
      fs.writeFileSync(target, "{}", { mode: 0o600 });
      fs.symlinkSync(target, alias);
      expect(() => loadFabricConfig(alias)).toThrow("private regular file");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects oversized or non-private configuration files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-config-"));
    const file = path.join(root, "config.json");
    try {
      fs.writeFileSync(file, "{}", { mode: 0o600 });
      expect(loadFabricConfig(file)).toEqual(DEFAULT_FABRIC_CONFIG);
      if (process.platform !== "win32") {
        fs.chmodSync(file, 0o644);
        expect(() => loadFabricConfig(file)).toThrow("permissions must be private");
      }
      fs.chmodSync(file, 0o600);
      fs.writeFileSync(file, " ".repeat(256 * 1024 + 1));
      expect(() => loadFabricConfig(file)).toThrow("exceeds 262144 bytes");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("retains the deprecated Power-named configuration aliases", () => {
    expect(DEFAULT_FABRIC_POWER_CONFIG).toBe(DEFAULT_FABRIC_CONFIG);
    expect(normalizeFabricPowerConfig).toBe(normalizeFabricConfig);
    expect(loadFabricPowerConfig).toBe(loadFabricConfig);
    expect(supportsKiroPowerElicitation).toBe(supportsKiroElicitation);
  });
});
