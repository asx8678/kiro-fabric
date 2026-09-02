#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "./atomic-file.mjs";
import { validatePowerPackage } from "./validate-power-package.mjs";

export const createPowerArchive = (packageInput, outputInput, options = {}) => {
  const evidence = validatePowerPackage(path.resolve(packageInput));
  const stage = evidence.root;
  const output = path.resolve(outputInput);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-power-archive-"));
  fs.chmodSync(temporary, 0o700);
  const tarPath = path.join(temporary, "package.tar");
  const epoch = String(options.sourceDateEpoch ?? process.env.SOURCE_DATE_EPOCH ?? "0");
  try {
    const tar = spawnSync("tar", [
      "--sort=name", `--mtime=@${epoch}`, "--owner=0", "--group=0", "--numeric-owner",
      "--format=posix", "--pax-option=delete=atime,delete=ctime", "-C", stage, "-cf", tarPath, ".",
    ], { encoding: "utf8" });
    if (tar.error) throw tar.error;
    if (tar.status !== 0) throw new Error(`deterministic tar failed: ${tar.stderr}`);
    const gzip = spawnSync("gzip", ["-n", "-9", "-c", tarPath], { encoding: null, maxBuffer: 80 * 1024 * 1024 });
    if (gzip.error) throw gzip.error;
    if (gzip.status !== 0) throw new Error(`deterministic gzip failed: ${gzip.stderr?.toString() ?? ""}`);
    const bytes = Buffer.from(gzip.stdout);
    const digest = createHash("sha256").update(bytes).digest("hex");
    writeFileAtomic(output, bytes);
    return { output, digest, bytes: bytes.length, packageDigest: evidence.digest };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const valueAfter = (flag) => { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1] : undefined; };
  const result = createPowerArchive(
    valueAfter("--package") ?? ".tmp/kiro-fabric-power",
    valueAfter("--output") ?? ".tmp/kiro-fabric-power.tar.gz",
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
