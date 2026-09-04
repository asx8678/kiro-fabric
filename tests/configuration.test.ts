import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CURRENT_FABRIC_CONFIG_SCHEMA_VERSION,
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

  it("migrates legacy configuration in memory and rejects future versions without mutation", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-config-version-"));
    const file = path.join(root, "config.json");
    try {
      const legacy = `${JSON.stringify({ tracing: { enabled: true } })}\n`;
      fs.writeFileSync(file, legacy, { mode: 0o600 });
      const legacyStats = fs.statSync(file, { bigint: true });
      expect(loadFabricConfig(file).tracing.enabled).toBe(true);
      expect(fs.readFileSync(file, "utf8")).toBe(legacy);
      const loadedStats = fs.statSync(file, { bigint: true });
      expect(loadedStats.ino).toBe(legacyStats.ino);
      expect(loadedStats.mtimeNs).toBe(legacyStats.mtimeNs);
      expect(loadedStats.ctimeNs).toBe(legacyStats.ctimeNs);
      expect(fs.readdirSync(root)).toEqual(["config.json"]);
      expect(loadFabricConfig(file).tracing.enabled).toBe(true);

      const current = `${JSON.stringify({
        schemaVersion: CURRENT_FABRIC_CONFIG_SCHEMA_VERSION,
        tracing: { enabled: false },
      })}\n`;
      fs.writeFileSync(file, current, { mode: 0o600 });
      expect(loadFabricConfig(file).tracing.enabled).toBe(false);
      expect(fs.readFileSync(file, "utf8")).toBe(current);

      const future = `${JSON.stringify({ schemaVersion: CURRENT_FABRIC_CONFIG_SCHEMA_VERSION + 1 })}\n`;
      fs.writeFileSync(file, future, { mode: 0o600 });
      expect(() => loadFabricConfig(file)).toThrow("newer than supported");
      expect(fs.readFileSync(file, "utf8")).toBe(future);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not rewrite malformed configuration", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-config-invalid-"));
    const file = path.join(root, "config.json");
    const invalid = `${JSON.stringify({ unknown: { enabled: true } })}\n`;
    try {
      fs.writeFileSync(file, invalid, { mode: 0o600 });
      expect(() => loadFabricConfig(file)).toThrow("unknown configuration section");
      expect(fs.readFileSync(file, "utf8")).toBe(invalid);

      const invalidValue = `${JSON.stringify({ tracing: { enabled: "yes" } })}\n`;
      fs.writeFileSync(file, invalidValue, { mode: 0o600 });
      expect(() => loadFabricConfig(file)).toThrow("invalid configuration value: tracing.enabled");
      expect(fs.readFileSync(file, "utf8")).toBe(invalidValue);

      const callerDefaults = structuredClone(DEFAULT_FABRIC_CONFIG);
      callerDefaults.executor.maxTimeoutMs = 10_000;
      callerDefaults.mcp.callTimeoutMs = 10_000;
      const invalidForCaller = `${JSON.stringify({ mcp: { callTimeoutMs: 20_000 } })}\n`;
      fs.writeFileSync(file, invalidForCaller, { mode: 0o600 });
      expect(() => loadFabricConfig(file, callerDefaults)).toThrow("invalid configuration value: mcp.callTimeoutMs");
      expect(fs.readFileSync(file, "utf8")).toBe(invalidForCaller);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a same-inode configuration change during a bounded read", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-config-read-race-"));
    const file = path.join(root, "config.json");
    const original = `${JSON.stringify({ executor: { timeoutMs: 5_000 }, tracing: { enabled: true } })}\n`;
    const replacement = `${JSON.stringify({ executor: { timeoutMs: 6_000 }, tracing: { enabled: true } })}\n`;
    expect(replacement.length).toBe(original.length);
    fs.writeFileSync(file, original, { mode: 0o600 });
    const fixedTime = new Date("2020-01-01T00:00:00.000Z");
    fs.utimesSync(file, fixedTime, fixedTime);
    const originalRead = fs.readSync.bind(fs);
    let injected = false;
    const injectedRead = (descriptor: number, buffer: Buffer, offset: number, length: number, position: number | null): number => {
      const count = originalRead(descriptor, buffer, offset, Math.min(length, 16), position);
      if (!injected) {
        injected = true;
        fs.writeFileSync(file, replacement, { mode: 0o600 });
        fs.utimesSync(file, fixedTime, fixedTime);
      }
      return count;
    };
    const read = vi.spyOn(fs, "readSync").mockImplementation(injectedRead as never);
    try {
      expect(() => loadFabricConfig(file)).toThrow("changed while it was being read");
      expect(fs.readFileSync(file, "utf8")).toBe(replacement);
    } finally {
      read.mockRestore();
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
