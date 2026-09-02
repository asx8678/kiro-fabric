#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { validatePowerPackage } from "./validate-power-package.mjs";

const valueAfter = (flag) => { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; };
const stageInput = path.resolve(valueAfter("--package") ?? ".tmp/kiro-fabric-power");
const output = path.resolve(valueAfter("--output") ?? ".tmp/kiro-fabric-power.tar.gz");
validatePowerPackage(stageInput);
const stage = fs.realpathSync(stageInput);
fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
const temporaryTar = `${output}.${process.pid}.tmp.tar`;
const temporaryGzip = `${output}.${process.pid}.tmp`;
const epoch = process.env.SOURCE_DATE_EPOCH ?? "0";
try {
  const tar = spawnSync("tar", [
    "--sort=name", `--mtime=@${epoch}`, "--owner=0", "--group=0", "--numeric-owner",
    "--format=posix", "--pax-option=delete=atime,delete=ctime", "-C", stage, "-cf", temporaryTar, ".",
  ], { encoding: "utf8" });
  if (tar.error) throw tar.error;
  if (tar.status !== 0) throw new Error(`deterministic tar failed: ${tar.stderr}`);
  const gzip = spawnSync("gzip", ["-n", "-9", "-c", temporaryTar], { encoding: null, maxBuffer: 80 * 1024 * 1024 });
  if (gzip.error) throw gzip.error;
  if (gzip.status !== 0) throw new Error(`deterministic gzip failed: ${gzip.stderr?.toString() ?? ""}`);
  fs.writeFileSync(temporaryGzip, gzip.stdout, { mode: 0o600 });
  fs.renameSync(temporaryGzip, output);
  const bytes = fs.readFileSync(output);
  const digest = createHash("sha256").update(bytes).digest("hex");
  process.stdout.write(`${JSON.stringify({ output, digest, bytes: bytes.length })}\n`);
} finally {
  fs.rmSync(temporaryTar, { force: true });
  fs.rmSync(temporaryGzip, { force: true });
}
