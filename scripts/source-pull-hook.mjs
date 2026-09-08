import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const hook = `#!/bin/sh
# kiro-fabric source activation v1 (explicitly enabled)
set -eu
root=$(git rev-parse --show-toplevel)
cd "$root"
# Git exports repository variables to hooks. Do not leak them to build fixtures.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX
if bash ./install.sh --source --kiro-home "$root" --yes --non-interactive; then
  printf '%s\\n' 'Kiro Fabric: source update activated for new sessions.' >&2
else
  printf '%s\\n' 'Kiro Fabric: UPDATE NOT ACTIVATED. Git has already updated the checkout; inspect the installer error and rerun bash ./install.sh --source --kiro-home "$PWD". Do not assume git pull exit status certifies activation.' >&2
  exit 1
fi
`;
/** Explicit source-only opt-in. Never replace foreign hooks or hooksPath settings. */
export function configurePullHook(root, kiroHome, write = false) {
  if (fs.realpathSync(root) !== fs.realpathSync(kiroHome)) throw new Error("Pull hook requires checkout exactly at KIRO_HOME");
  const git = args => spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 10000 });
  const top = git(["rev-parse", "--show-toplevel"]);
  if (top.status !== 0 || fs.realpathSync(top.stdout.trim()) !== fs.realpathSync(root)) throw new Error("Pull hook requires the repository root");
  const config = git(["config", "--get", "core.hooksPath"]);
  if (config.status !== 1) throw new Error("Pull hook refuses existing core.hooksPath or unreadable Git configuration");
  const gitDir = path.join(root, ".git"), hooks = path.join(gitDir, "hooks");
  for (const dir of [gitDir, hooks]) {
    const s = fs.lstatSync(dir);
    if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o022) || s.uid !== process.getuid?.()) throw new Error("Unsafe Git hooks directory; linked worktrees are not supported");
  }
  const target = path.join(hooks, "post-merge");
  try {
    const s = fs.lstatSync(target);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.uid !== process.getuid?.() || (s.mode & 0o022) || fs.readFileSync(target, "utf8") !== hook) throw new Error("Existing post-merge hook preserved; configure updates manually");
    if (!(s.mode & 0o100)) throw new Error("Existing Fabric hook is not executable; inspect it before enabling");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (write) fs.writeFileSync(target, hook, { flag: "wx", mode: 0o700 });
  }
  return target;
}
