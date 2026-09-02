import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runKiroAgentValidator,
  smokeDevelopmentMcp,
  validateDevelopmentProfile,
  validateWithInstalledKiro,
} from "../scripts/validate-dev-agent.mjs";

const scratch: string[] = [];
afterEach(() => {
  for (const directory of scratch.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("repository development-agent non-billable validation", () => {
  it("passes the fixture validator and detects its exit-zero negative control", () => {
    const { profilePath } = validateDevelopmentProfile();
    const fixture = path.resolve("tests/fixtures/kiro/fake-kiro.mjs");
    expect(runKiroAgentValidator({ command: process.execPath, args: [fixture] }, profilePath))
      .toMatch(/agent config is valid/i);

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-dev-negative-"));
    scratch.push(directory);
    const invalid = path.join(directory, "invalid.json");
    fs.writeFileSync(invalid, JSON.stringify({ includeMcpJson: false, includePowers: false, permissions: { rules: [] } }));
    expect(() => runKiroAgentValidator({ command: process.execPath, args: [fixture] }, invalid))
      .toThrow(/reported|rejected|missing required field: name/i);
  });

  it("reports a missing supported Kiro CLI without making a model call", () => {
    const { profilePath } = validateDevelopmentProfile();
    const absent = path.join(os.tmpdir(), `missing-kiro-cli-${process.pid}`);
    expect(validateWithInstalledKiro(profilePath, absent, false)).toMatchObject({ status: "unavailable" });
    expect(() => validateWithInstalledKiro(profilePath, absent, true)).toThrow(/supported kiro-cli 2\.20\.1 is missing/i);
  });

  it("starts the code-only MCP and executes pure, repository-read, and shell programs", async () => {
    await expect(smokeDevelopmentMcp()).resolves.toEqual({ tools: ["fabric_exec"], result: "42" });
  }, 30_000);

  it("rejects an invalid working directory in both validation and the confined launcher", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-dev-wrong-cwd-"));
    scratch.push(directory);
    const validator = spawnSync(process.execPath, [path.resolve("scripts/validate-dev-agent.mjs")], {
      cwd: directory,
      encoding: "utf8",
    });
    expect(validator.status).toBe(1);
    expect(validator.stderr).toMatch(/invalid working directory.*run from repository root/i);

    const launcher = spawnSync(process.execPath, [path.resolve("scripts/run-kiro-fabric-dev.mjs")], {
      cwd: directory,
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(launcher.status).toBe(1);
    expect(launcher.stderr).toMatch(/must start from repository root/iu);
  });
});
