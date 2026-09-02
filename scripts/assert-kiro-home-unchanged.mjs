#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.argv.length < 4) throw new Error("Usage: assert-kiro-home-unchanged <command> <args...>");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "kiro-home-sentinel-"));
const home = path.join(temporary, "home");
const kiroHome = path.join(temporary, "kiro-home");
const toolCache = path.join(temporary, "tool-cache");
for (const directory of [home, kiroHome, toolCache]) fs.mkdirSync(directory, { mode: 0o700 });
for (const directory of [home, kiroHome]) {
  fs.writeFileSync(path.join(directory, "sentinel.bin"), Buffer.from([0, 1, 2, 3, 255]), { mode: 0o600 });
}
const snapshot = (root) => {
  const digest = createHash("sha256");
  const visit = (directory) => { for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const target = path.join(directory, entry.name); digest.update(path.relative(root, target)).update("\0"); if (entry.isDirectory()) visit(target); else digest.update(fs.readFileSync(target)); } };
  visit(root); return digest.digest("hex");
};
const before = { home: snapshot(home), kiroHome: snapshot(kiroHome) };
const result = spawnSync(process.argv[2], process.argv.slice(3), {
  stdio: "inherit",
  env: {
    ...process.env,
    HOME: home,
    KIRO_HOME: kiroHome,
    COREPACK_HOME: path.join(toolCache, "corepack"),
    XDG_CACHE_HOME: path.join(toolCache, "cache"),
    XDG_CONFIG_HOME: path.join(toolCache, "config"),
    XDG_DATA_HOME: path.join(toolCache, "data"),
    NPM_CONFIG_CACHE: path.join(toolCache, "npm"),
  },
});
const after = { home: snapshot(home), kiroHome: snapshot(kiroHome) };
fs.rmSync(temporary, { recursive: true, force: true });
if (before.home !== after.home) throw new Error("quality command modified HOME");
if (before.kiroHome !== after.kiroHome) throw new Error("quality command modified KIRO_HOME");
if (result.error) throw result.error;
process.exit(result.status ?? 1);
