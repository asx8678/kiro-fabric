import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FABRIC_POWER_CONFIG,
  loadFabricPowerConfig,
  normalizeFabricPowerConfig,
} from "../src/config.js";
import { prepareKiroPowerDataPaths } from "../src/kiro/power/data-paths.js";

describe("Power-only configuration", () => {
  it("exposes only active configured-MCP settings", () => {
    expect(Object.keys(DEFAULT_FABRIC_POWER_CONFIG.mcp).sort()).toEqual([
      "callTimeoutMs",
      "disableOAuth",
      "enabled",
    ]);
    const normalized = normalizeFabricPowerConfig({
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
    expect(normalizeFabricPowerConfig({
      memory: { enabled: true, maxEntries: 10_000, maxValueChars: 2_000_000 },
    }).memory).toEqual({
      enabled: true,
      maxEntries: 128,
      maxValueChars: 16_000,
    });
  });

  it("bounds and privatizes the configured-MCP file under plugin data", () => {
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
      expect(() => loadFabricPowerConfig(alias)).toThrow("private regular file");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects oversized or non-private configuration files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-config-"));
    const file = path.join(root, "config.json");
    try {
      fs.writeFileSync(file, "{}", { mode: 0o600 });
      expect(loadFabricPowerConfig(file)).toEqual(DEFAULT_FABRIC_POWER_CONFIG);
      if (process.platform !== "win32") {
        fs.chmodSync(file, 0o644);
        expect(() => loadFabricPowerConfig(file)).toThrow("permissions must be private");
      }
      fs.chmodSync(file, 0o600);
      fs.writeFileSync(file, " ".repeat(256 * 1024 + 1));
      expect(() => loadFabricPowerConfig(file)).toThrow("exceeds 262144 bytes");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
