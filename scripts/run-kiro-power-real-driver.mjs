#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";

const outputIndex = process.argv.indexOf("--output");
const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
const driver = process.env.KIRO_POWER_REAL_DRIVER;
if (!driver || !path.isAbsolute(driver) || !output) {
  throw new Error("KIRO_POWER_REAL_DRIVER must name an absolute clean-machine driver executable and --output is required");
}
const result = spawnSync(driver, [
  "--checkout", path.resolve("."),
  "--output", path.resolve(output),
], {
  stdio: "inherit",
  env: process.env,
  timeout: 45 * 60_000,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
