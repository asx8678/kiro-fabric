import { removeFixtureSync } from "./fixture-cleanup.mjs";
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
  it("allows reads and execution while direct writes and network still require consent by default", () => {
    const expected = { read: "allow", write: "ask", execute: "allow", network: "ask" };
    expect(DEFAULT_FABRIC_CONFIG.approvals).toEqual(expected);
    expect(normalizeFabricConfig({}).approvals).toEqual(expected);
    expect(normalizeFabricConfig({ approvals: { write: "deny" } }).approvals).toEqual({ ...expected, write: "deny" });
  });
  it("documents the actual missing-policy defaults in the configuration guide", () => {
    expect(DEFAULT_FABRIC_CONFIG.approvals).toEqual({ read: "allow", write: "ask", execute: "allow", network: "ask" });
    const guide = fs.readFileSync(new URL("../docs/configuration.md", import.meta.url), "utf8");
    expect(guide).toContain('defaults are `read: "allow"`, `write: "ask"`, `execute: "allow"`, `network: "ask"`');
  });
  it.each(["allow", "ask", "deny"] as const)("preserves explicit execute=%s policy", (execute) => {
    expect(normalizeFabricConfig({ schemaVersion: 1, approvals: { execute } }).approvals.execute).toBe(execute);
    expect(normalizeFabricConfig({ approvals: { execute } }).approvals.execute).toBe(execute);
    for (const risk of ["read", "write", "execute", "network"] as const) {
      expect(normalizeFabricConfig({ approvals: { [risk]: execute } }).approvals[risk]).toBe(execute);
    }
  });
  it.each([undefined, 1])("loads schema %s policies without rewriting explicit consent", (schemaVersion) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-safe-defaults-"));
    const file = path.join(root, "config.json");
    try {
      expect(loadFabricConfig(file).approvals).toEqual(DEFAULT_FABRIC_CONFIG.approvals);
      expect(fs.existsSync(file)).toBe(false);
      const bytes = JSON.stringify({ schemaVersion, approvals: { write: "allow", network: "deny" } });
      fs.writeFileSync(file, bytes, { mode: 0o600 });
      const before = fs.statSync(file, { bigint: true });
      expect(loadFabricConfig(file).approvals).toEqual({ read: "allow", write: "allow", execute: "allow", network: "deny" });
      expect(fs.readFileSync(file, "utf8")).toBe(bytes);
      const after = fs.statSync(file, { bigint: true });
      expect([after.ino, after.mtimeNs, after.ctimeNs]).toEqual([before.ino, before.mtimeNs, before.ctimeNs]);
    } finally { removeFixtureSync(root, { recursive: true, force: true }); }
  });
  it("normalizes a finite per-service execution admission limit", () => {
    expect(normalizeFabricConfig({}).executor.maxConcurrentExecutions).toBe(4);
    expect(normalizeFabricConfig({ executor: { maxConcurrentExecutions: 2 } }).executor.maxConcurrentExecutions).toBe(2);
    expect(normalizeFabricConfig({ executor: { maxConcurrentExecutions: 1000 } }).executor.maxConcurrentExecutions).toBe(64);
    expect(normalizeFabricConfig({ executor: { maxConcurrentExecutions: 0 } }).executor.maxConcurrentExecutions).toBe(1);
  });
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

  it("never derives a provider call timeout above the execution maximum", () => {
    const tight = normalizeFabricConfig({ executor: { timeoutMs: 500, maxTimeoutMs: 500 } });
    expect(tight.executor.maxTimeoutMs).toBe(500);
    expect(tight.mcp.callTimeoutMs).toBe(500);
    expect((tight as { web?: unknown }).web).toBeUndefined();
    const explicit = normalizeFabricConfig({ executor: { timeoutMs: 500, maxTimeoutMs: 500 }, mcp: { callTimeoutMs: 20_000 } });
    expect(explicit.mcp.callTimeoutMs).toBe(500);
    expect((explicit as { web?: unknown }).web).toBeUndefined();
    const generous = normalizeFabricConfig({ executor: { timeoutMs: 5_000, maxTimeoutMs: 900_000 } });
    expect(generous.mcp.callTimeoutMs).toBe(120_000);
    expect((generous as { web?: unknown }).web).toBeUndefined();
  });

  it("rejects every removed web/browser configuration section without rewriting files", () => {
    const removed = [
      { web: {} },
      { web: { enabled: false } },
      { web: { searchTimeoutMs: 20_000 } },
      { web: { openTimeoutMs: 20_000 } },
      { browser: {} },
      { browser: { enabled: false } },
    ];
    for (const input of removed) expect(() => normalizeFabricConfig(input)).toThrow(/no longer supported/);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fabric-config-browser-"));
    const file = path.join(root, "config.json");
    try {
      const bytes = JSON.stringify({ web: { searchTimeoutMs: 20_000 }, approvals: { write: "allow" }, privacy: { mode: "restricted-web" } });
      fs.writeFileSync(file, bytes, { mode: 0o600 });
      expect(() => loadFabricConfig(file)).toThrow(/no longer supported/);
      // Byte-preserving rejection: the file is never rewritten.
      expect(fs.readFileSync(file, "utf8")).toBe(bytes);
      // Removing only the removed section preserves approvals and privacy settings.
      const retained = JSON.stringify({ approvals: { write: "allow" }, privacy: { mode: "restricted-web" } });
      fs.writeFileSync(file, retained, { mode: 0o600 });
      const loaded = loadFabricConfig(file);
      expect(loaded.approvals.write).toBe("allow");
      expect(loaded.privacy.mode).toBe("restricted-web");
      expect(fs.readFileSync(file, "utf8")).toBe(retained);
    } finally { removeFixtureSync(root, { recursive: true, force: true }); }
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
      removeFixtureSync(root, { recursive: true, force: true });
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
      removeFixtureSync(root, { recursive: true, force: true });
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
      removeFixtureSync(root, { recursive: true, force: true });
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
      removeFixtureSync(root, { recursive: true, force: true });
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
      removeFixtureSync(root, { recursive: true, force: true });
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
        // WSL/filesystems with coarse ctime ticks can otherwise make this
        // same-size, restored-mtime rewrite invisible to a version-stat check.
        // Establish an actual ctime transition before testing its rejection.
        const before = fs.fstatSync(descriptor, { bigint: true }).ctimeNs;
        const deadline = Date.now() + 1_000;
        const pause = new Int32Array(new SharedArrayBuffer(4));
        do {
          fs.writeFileSync(file, replacement, { mode: 0o600 });
          fs.utimesSync(file, fixedTime, fixedTime);
          if (fs.fstatSync(descriptor, { bigint: true }).ctimeNs !== before) break;
          Atomics.wait(pause, 0, 0, 10);
        } while (Date.now() < deadline);
        expect(fs.fstatSync(descriptor, { bigint: true }).ctimeNs, "fixture must advance ctime").not.toBe(before);
      }
      return count;
    };
    const read = vi.spyOn(fs, "readSync").mockImplementation(injectedRead as never);
    try {
      expect(() => loadFabricConfig(file)).toThrow("changed while it was being read");
      expect(fs.readFileSync(file, "utf8")).toBe(replacement);
    } finally {
      read.mockRestore();
      removeFixtureSync(root, { recursive: true, force: true });
    }
  });

  it("retains the deprecated Power-named configuration aliases", () => {
    expect(DEFAULT_FABRIC_POWER_CONFIG).toBe(DEFAULT_FABRIC_CONFIG);
    expect(normalizeFabricPowerConfig).toBe(normalizeFabricConfig);
    expect(loadFabricPowerConfig).toBe(loadFabricConfig);
    expect(supportsKiroPowerElicitation).toBe(supportsKiroElicitation);
  });
});
