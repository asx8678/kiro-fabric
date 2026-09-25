// W5 portable Agent-package fixture: stage a validation-ready package solely from
// the current repository inputs plus the built dist closure, under a caller-owned
// fixture root. No session-local .tmp packaging record is read, and nothing
// outside the supplied fixture root is written. The staged package is validated
// with the real validator so callers can rely on its digest.
//
// This mirrors the production staging copy rules in scripts/build-agent-dev.mjs
// (private directories, 0600 files, exact helper closure) without depending on
// the installer-artifact cache.

import fs from "node:fs";
import path from "node:path";
import { validateAgentPackage } from "../validate-agent-package.mjs";

const SCRIPTS = ["agent-profile.mjs", "install-agent-user.mjs", "validate-agent-package.mjs"];
const HELPERS = [
  ["src/installation/filesystem-boundary.mjs", "filesystem-boundary.mjs"],
  ["src/installation/installer-lock.mjs", "installer-lock.mjs"],
  ["src/installation/pinned-recovery.mjs", "pinned-recovery.mjs"],
];

const copy = (source, target) => {
  const stats = fs.lstatSync(source);
  if (stats.isSymbolicLink() || (!stats.isDirectory() && (!stats.isFile() || stats.nlink !== 1))) throw new Error("unsafe package input: " + source);
  if (stats.isDirectory()) {
    fs.mkdirSync(target, { mode: 0o700 });
    for (const entry of fs.readdirSync(source).sort()) copy(path.join(source, entry), path.join(target, entry));
  } else {
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(target, 0o600);
  }
};

/** @param {string} repoRoot @param {string} fixturesRoot @param {string} [label] */
export function stagePortableAgentPackage(repoRoot, fixturesRoot, label = "pkg") {
  const dir = fs.mkdtempSync(path.join(fixturesRoot, label + "-"));
  fs.chmodSync(dir, 0o700);
  const root = fs.realpathSync(dir);

  copy(path.join(repoRoot, "dist", "kiro-agent-closure"), path.join(root, "runtime"));
  fs.mkdirSync(path.join(root, "skills"), { mode: 0o700 });
  copy(path.join(repoRoot, "skills", "fabric-exec"), path.join(root, "skills", "fabric-exec"));
  copy(path.join(repoRoot, "agent-product.json"), path.join(root, "agent-product.json"));
  fs.mkdirSync(path.join(root, "scripts"), { mode: 0o700 });
  for (const name of SCRIPTS) copy(path.join(repoRoot, "scripts", name), path.join(root, "scripts", name));
  for (const [source, target] of HELPERS) copy(path.join(repoRoot, source), path.join(root, "scripts", target));

  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ name: pkg.name, version: pkg.version, type: "module", private: true, engines: { node: ">=24" }, scripts: { "install:agent": "node scripts/install-agent-user.mjs ." } }, null, 2)}\n`, { mode: 0o600 });

  const validated = validateAgentPackage(root);
  return { root, validated };
}
